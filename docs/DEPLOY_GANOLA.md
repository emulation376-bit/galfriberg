# 部署指南（ganola.top）

针对域名 `ganola.top` 的完整部署流程：上传源码 → 服务器本地构建 → 启动 →
HTTPS 反向代理 → 创建管理员 → 日常更新。

镜像默认使用本地构建的 `galfriberg:latest`（见 `deploy/.env.example`）。若要
改为从 GHCR 拉取，把 `.env` 里的 `IMAGE` 设为
`ghcr.io/emulation376-bit/galfriberg:latest`，并把下面的 `build` 命令换成
`pull`。

## 1. 本地打包上传

在项目根目录打包（排除 node_modules、dist、VNDB 题库源等大文件）：

```bash
tar czf galfriberg-src.tgz \
  --exclude='node_modules' --exclude='.git' \
  --exclude='client/dist' --exclude='server/dist' \
  --exclude='VNDB' --exclude='*.sqlite3*' \
  package.json pnpm-lock.yaml pnpm-workspace.yaml \
  client server scripts pow-wasm compose.yaml Dockerfile deploy

scp galfriberg-src.tgz root@<服务器IP>:/opt/
```

## 2. 服务器解压 + 配置

```bash
cd /opt && tar xzf galfriberg-src.tgz
mv csgofriberg-main /opt/galfriberg
cd /opt/galfriberg

cp deploy/.env.example .env && chmod 600 .env && nano .env
```

`.env` 关键项（密钥用 `openssl rand` 生成，互不重复）：

```bash
IMAGE=galfriberg:latest
CORS_ORIGINS=https://ganola.top
JWT_SECRET=<openssl rand -base64 48>
GUEST_ID_SALT=<openssl rand -base64 48>
POSTGRES_PASSWORD=<openssl rand -hex 24>
```

## 3. 构建 + 启动

```bash
# 国内服务器拉不到 gcr.io 基础镜像时用 DaoCloud 镜像源：
docker compose build --build-arg RUNTIME_IMAGE=gcr.m.daocloud.io/distroless/nodejs22-debian12:nonroot
# 能直连 gcr.io 则直接：
# docker compose build

mkdir -p data/pgdata
docker compose up -d
docker compose ps
curl http://127.0.0.1:3000/api/health   # 两个实例都 healthy 即成功
```

## 4. 域名 + HTTPS（ganola.top）

1. DNS：A 记录 `ganola.top` → 服务器 IP。
2. 按 `deploy/README.md` 第 4 节配置 Nginx：`upstream csgofriberg_backend`
   指向 `127.0.0.1:3000/3001`，配置 `/assets/`、`/`、`/socket.io/` 三个
   location（Socket.IO 必须带 WebSocket upgrade 头）。
3. 申请证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ganola.top
```

## 5. 创建管理员

```bash
docker compose run --rm \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='你的密码' \
  app-1 server/dist/db/createAdmin.js
```

## 6. 日常更新

```bash
# 重新打包上传源码后：
cd /opt/galfriberg
sudo ./update.sh    # 自动 build + migrate + 滚动替换 app-1/app-2
```

更新脚本会阻止并发更新、先跑数据库迁移、逐个替换实例并等待健康检查，
任一实例失败会保留另一个继续服务。详见 `deploy/README.md` 第 6 节。

## 7. 备份

```bash
cd /opt/galfriberg
docker compose exec -T postgres \
  pg_dump -U csgofriberg -d csgofriberg -Fc > csgofriberg.dump
```

PostgreSQL 数据在 `./data/pgdata` bind mount，Redis 数据在命名卷中，
更换应用镜像不影响二者。
