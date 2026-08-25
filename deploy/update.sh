#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/compose.yaml" ]]; then
  readonly DEPLOY_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/../compose.yaml" ]]; then
  readonly DEPLOY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
else
  echo "Error: compose.yaml was not found next to this script or in its parent directory." >&2
  exit 1
fi

readonly HEALTH_TIMEOUT_SECONDS="${UPDATE_HEALTH_TIMEOUT_SECONDS:-180}"
readonly HEALTH_POLL_SECONDS="${UPDATE_HEALTH_POLL_SECONDS:-2}"
readonly LOCK_DIR="${DEPLOY_DIR}/.update.lock"

log() {
  printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"
}

fail() {
  log "Error: $*" >&2
  exit 1
}

compose() {
  docker compose --project-directory "${DEPLOY_DIR}" -f "${DEPLOY_DIR}/compose.yaml" "$@"
}

# 本地构建镜像（IMAGE 非 ghcr.io）时用 build；从 GHCR 拉取时用 pull。
# IMAGE 优先取 shell 环境变量；未设置时回退读 .env，与 compose 实际使用的镜像保持一致。
ensure_app_image() {
  local image="${IMAGE:-}"
  if [[ -z "${image}" && -f "${DEPLOY_DIR}/.env" ]]; then
    image="$(grep -E '^IMAGE=' "${DEPLOY_DIR}/.env" | tail -1 | cut -d= -f2- || true)"
  fi
  image="${image:-galfriberg:latest}"
  if [[ "${image}" == ghcr.io/* ]]; then
    log "Pulling application images from ${image} ..."
    compose pull migrate app-1 app-2
  else
    log "Building application images (${image}) ..."
    compose build migrate app-1 app-2
  fi
}

cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

show_failure() {
  local service="$1"

  log "Recent ${service} logs:"
  compose logs --no-color --tail 100 "${service}" >&2 || true
}

wait_for_healthy() {
  local service="$1"
  local started_at="${SECONDS}"
  local container_id
  local status

  log "Waiting up to ${HEALTH_TIMEOUT_SECONDS}s for ${service} to become healthy..."

  while (( SECONDS - started_at < HEALTH_TIMEOUT_SECONDS )); do
    container_id="$(compose ps --all -q "${service}")"

    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"

      case "${status}" in
        healthy)
          log "${service} is healthy."
          return 0
          ;;
        exited|dead)
          show_failure "${service}"
          return 1
          ;;
      esac
    fi

    sleep "${HEALTH_POLL_SECONDS}"
  done

  show_failure "${service}"
  return 1
}

update_instance() {
  local service="$1"

  log "Replacing ${service}..."
  if ! compose up -d --no-deps --force-recreate "${service}"; then
    show_failure "${service}"
    compose stop "${service}" || true
    fail "Docker Compose could not replace ${service}. The healthy peer remains running."
  fi

  if ! wait_for_healthy "${service}"; then
    log "${service} did not become healthy; stopping it so Nginx can use the other instance."
    compose stop "${service}" || true
    fail "Rolling update stopped at ${service}. The healthy peer remains running."
  fi
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed or not in PATH."
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is unavailable."

case "${HEALTH_TIMEOUT_SECONDS}" in
  ''|*[!0-9]*) fail "UPDATE_HEALTH_TIMEOUT_SECONDS must be a positive integer." ;;
esac

case "${HEALTH_POLL_SECONDS}" in
  ''|*[!0-9]*) fail "UPDATE_HEALTH_POLL_SECONDS must be a positive integer." ;;
esac

(( HEALTH_TIMEOUT_SECONDS > 0 )) || fail "UPDATE_HEALTH_TIMEOUT_SECONDS must be greater than zero."
(( HEALTH_POLL_SECONDS > 0 )) || fail "UPDATE_HEALTH_POLL_SECONDS must be greater than zero."

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  fail "another update appears to be running (${LOCK_DIR} exists)."
fi
trap cleanup EXIT

cd "${DEPLOY_DIR}"

log "Validating the Compose configuration..."
compose config --quiet

log "Checking the currently running application instances..."
wait_for_healthy app-1 || fail "app-1 is not healthy; update aborted before making changes."
wait_for_healthy app-2 || fail "app-2 is not healthy; update aborted before making changes."

log "Ensuring application images are up to date..."
ensure_app_image

log "Running database migrations..."
compose run --rm migrate

update_instance app-1
update_instance app-2

log "Rolling update completed successfully."
compose ps app-1 app-2

if [[ "${PRUNE_OLD_IMAGES:-0}" == "1" ]]; then
  log "Pruning unused images..."
  docker image prune -f
fi
