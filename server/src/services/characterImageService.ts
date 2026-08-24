import fs from 'fs';
import path from 'path';

export type CharacterImageSource = 'ymgal' | 'vndb';

export interface CharacterImageCandidate {
  source: CharacterImageSource;
  remoteUrl: string;
}

export interface FetchedImage {
  buffer: Buffer;
  contentType: string;
}

const YMGAL_IMAGE_HOST = 'https://cdn.ymgal.games/';
const VNDB_IMAGE_HOST = 'https://t.vndb.org/';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const YMGAL_PATH_RE = /^archive\/main\/[0-9a-f]{2}\/[0-9a-f]{32}\.(?:jpe?g|png|webp|gif)$/i;
const VNDB_IMAGE_RE = /^([a-z]{2})(\d+)$/i;

function cacheDir(): string {
  return process.env.IMAGE_CACHE_DIR || path.resolve(__dirname, '../../data/image-cache');
}

function contentTypeForPath(filePath: string): string {
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  if (/\.png$/i.test(filePath)) return 'image/png';
  if (/\.gif$/i.test(filePath)) return 'image/gif';
  return 'image/jpeg';
}

/** 由 VNDB 立绘 id（如 ch175652）拼出图床缩略图地址。 */
export function vndbCharacterImageUrl(imageId: string): string | null {
  const match = VNDB_IMAGE_RE.exec(imageId.trim());
  if (!match) return null;
  const prefix = match[1].toLowerCase();
  const digits = match[2];
  return `${VNDB_IMAGE_HOST}${prefix}/${digits.slice(-2)}/${digits}.jpg`;
}

/** 由 YmGal 角色 main_img 相对路径拼出 CDN 地址。 */
export function ymgalCharacterImageUrl(relativePath: string): string | null {
  const trimmed = relativePath.trim();
  if (!YMGAL_PATH_RE.test(trimmed)) return null;
  return `${YMGAL_IMAGE_HOST}${trimmed}`;
}

/** 角色立绘候选：YmGal 优先，VNDB 兜底。 */
export function resolveCharacterImage(character: {
  ymgal_image?: string | null;
  image?: string | null;
}): CharacterImageCandidate[] {
  const candidates: CharacterImageCandidate[] = [];
  if (character.ymgal_image) {
    const remoteUrl = ymgalCharacterImageUrl(character.ymgal_image);
    if (remoteUrl) candidates.push({ source: 'ymgal', remoteUrl });
  }
  if (character.image) {
    const remoteUrl = vndbCharacterImageUrl(character.image);
    if (remoteUrl) candidates.push({ source: 'vndb', remoteUrl });
  }
  return candidates;
}

export function characterImageUrl(character: {
  id: string;
  ymgal_image?: string | null;
  image?: string | null;
}): string | null {
  return resolveCharacterImage(character).length ? `/img/character/${character.id}` : null;
}

function imageCachePath(characterId: string, candidate: CharacterImageCandidate): string {
  const extension = path.extname(new URL(candidate.remoteUrl).pathname).toLowerCase() || '.img';
  const safeId = characterId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(cacheDir(), `${safeId}-${candidate.source}${extension}`);
}

async function readCachedImage(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

async function writeCachedImage(filePath: string, buffer: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, buffer);
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function fetchRemoteImage(remoteUrl: string): Promise<FetchedImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(remoteUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        'User-Agent': 'csgofriberg-image-proxy/1.0',
      },
    });
    if (!response.ok) throw new Error(`IMAGE_FETCH_HTTP_${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
    return { buffer: Buffer.from(arrayBuffer), contentType: response.headers.get('content-type') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

const pendingFetches = new Map<string, Promise<FetchedImage>>();

/** 读本地缓存，未命中则拉取远端并落盘；同源并发只拉一次。 */
export async function fetchCharacterImage(
  characterId: string,
  candidate: CharacterImageCandidate
): Promise<FetchedImage> {
  const cachePath = imageCachePath(characterId, candidate);
  const cached = await readCachedImage(cachePath);
  if (cached) return { buffer: cached, contentType: contentTypeForPath(cachePath) };

  const pendingKey = `${characterId}:${candidate.source}`;
  const existing = pendingFetches.get(pendingKey);
  if (existing) return existing;

  const promise = (async () => {
    const fetched = await fetchRemoteImage(candidate.remoteUrl);
    await writeCachedImage(cachePath, fetched.buffer);
    return { buffer: fetched.buffer, contentType: contentTypeForPath(cachePath) };
  })();
  pendingFetches.set(pendingKey, promise);
  try {
    return await promise;
  } finally {
    pendingFetches.delete(pendingKey);
  }
}
