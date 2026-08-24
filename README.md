<div align="center">

# 旮一把 (galfriberg)

**Galgame / 视觉小说作品与角色猜测游戏 —— 类 Wordle 玩法 + 实时多人对战**

[![CI and Docker](https://github.com/emulation376-bit/galfriberg/actions/workflows/docker.yml/badge.svg)](https://github.com/emulation376-bit/galfriberg/actions/workflows/docker.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm workspaces](https://img.shields.io/badge/pnpm-workspaces-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-galfriberg-2496ED?logo=docker&logoColor=white)](https://github.com/emulation376-bit/galfriberg/pkgs/container/galfriberg)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React 18](https://img.shields.io/badge/React_18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?logo=redis&logoColor=white)

[玩法](#玩法) · [功能特性](#功能特性) · [快速开始](#快速开始) · [常用脚本](#常用脚本) · [Docker 生产部署](#docker-生产部署) · [作品数据](#作品数据) · [贡献](#贡献)

</div>

---

## 玩法

### 猜作品

输入视觉小说作品名称，系统按 **发行年份 / 会社 / 限制级 / 剧本 / 配乐 / 原画 / 声优 / 标签 / BGM 评分 / 系列作 / 时长** 逐属性给出对比反馈：

- 🟩 **绿色** —— 该属性与答案完全一致
- 🟨 **黄色** —— 接近（同会社首字、同发售年代、相邻时长档等）
- ↑↓ **箭头** —— 数值型属性提示答案更高或更低

### 猜角色

根据 **性别 / 登场作品区间 / 身高 / 服装 / 身份 / 发型 / 眼睛 / 声优** 锁定角色。

默认 8 次机会；自定义模式可设置为 1-20 次。

## 功能特性

- 🎮 **单人猜作品** —— 新手 / 简单 / 完整 / 自定义难度，进行中的对局可断线续玩
- 🧩 **猜角色** —— 根据角色特征、声优、作品区间等线索锁定角色，支持难度选择与自定义作品池
- 🎛 **自定义模式** —— 按评分人数 / 评分 / 年份筛选作品池，支持自定义猜测次数
- 🌐 **多人联机** —— BO1/3/5/7 赛制、随机匹配、5 位房间码、观战；每小局限时 120 秒，断线即时通知、同身份可重连，30 秒未归判负
- 🔍 **查作品** —— 模糊搜索作品资料
- 📊 **统计与回放** / 🏆 **排行榜** / 📢 **公告**
- 👤 **无需登录** —— 所有模式对匿名访客开放，战绩按浏览器本地标识记账，登录后自动并入账号
- 🛡 **PoW 人机验证** —— 公开接口由 WASM 工作量证明保护（Rust 编译，仓库内置预编译产物）
- 🛠 **管理后台** —— 作品增删改、JSON 批量导入、外部 API Token、公告管理

## 技术栈

| 层        | 技术                                                     |
| --------- | -------------------------------------------------------- |
| 前端      | React 18 + Vite + TypeScript + React Router + Zustand    |
| 后端      | Node.js + Express + TypeScript                           |
| 数据库    | 本地开发支持 SQLite；生产 Docker 镜像固定使用 PostgreSQL |
| 缓存/实时 | Redis + Socket.IO（Redis Adapter 跨实例广播）            |
| 认证      | JWT + bcrypt（HttpOnly Cookie，客户端不存明文令牌）       |
| 校验/测试 | Zod / Vitest                                             |
| PoW       | Rust → WASM + Web Worker                                 |
| 包管理    | pnpm workspaces                                          |

## 快速开始

**环境要求**：Node.js ≥ 22、pnpm、Redis（本地开发可降级为内存模式）；SQLite 开箱即用，无需额外数据库。Rust 工具链可选，仅在需要重新编译 PoW WASM 时安装，默认使用仓库内置的预编译产物。

```bash
pnpm install
cp .env.example .env                 # 可选，有默认值
pnpm migrate                         # 初始化数据库结构并导入种子作品与角色
pnpm dev                             # server: 3000, client: 5173
```

访问 http://localhost:5173 。首次运行 `pnpm migrate` 会创建数据库结构，并在空库中导入种子作品与角色。公开注册的账号默认都是普通用户，创建或重置管理员：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='至少12位强密码' pnpm create-admin
```

### 运行时行为说明

- Redis 默认连接 `redis://127.0.0.1:6379`；生产环境建议 `REDIS_REQUIRED=true`，避免 Redis 故障时降级为仅适合单实例的内存模式
- 生产环境强制要求 PostgreSQL、至少 32 字节随机 `JWT_SECRET` 和 `REDIS_REQUIRED=true`
- 访客显示 ID 使用 HMAC-SHA256 派生，可用 `GUEST_ID_SALT` 配置独立盐（未配置时复用 `JWT_SECRET`）
- 单人进行中的对局只保存在 Redis，**1800 秒（30 分钟）** 无有效操作自动过期；猜中、次数耗尽或查看答案后才写入数据库，主动离开或重新开始只清理临时状态、不产生历史战绩

## 常用脚本

| 命令                              | 说明                                          |
| --------------------------------- | --------------------------------------------- |
| `pnpm dev`                        | 同时启动前后端开发服务                        |
| `pnpm build`                      | 构建 PoW WASM + 前端 + 编译后端               |
| `pnpm start`                      | 生产模式启动（server 托管 client/dist）       |
| `pnpm test`                       | 运行前后端测试                                |
| `pnpm migrate`                    | 初始化数据库结构；首次建库自动导入作品与角色  |
| `pnpm seed`                       | 补充缺失的种子作品与公告                      |
| `pnpm data:build`                 | 由 xlsx 权威列表 + VNDB dump 构建导入 CSV     |
| `pnpm data:import`                | 将 CSV 批量导入数据库（按游戏名幂等 upsert）  |
| `pnpm characters:import`          | 按 VNDB dump 导入角色与结构化属性             |
| `pnpm images:import`              | 按 YmGal 数据匹配并写入角色立绘路径           |
| `pnpm characters:seed`            | 从本地 SQLite 生成 `seeds/characters.json`    |
| `pnpm mzh:characters -- --limit 50` | 按角色名抓取萌百增强字段（可选）            |
| `pnpm --filter server create-admin` | 显式创建或重置管理员                         |
| `pnpm --filter server maintenance` | 维护脚本                                     |
| `pnpm loadtest`                   | 运行 HTTP 缓存接口与多人建房负载测试          |

数据链路相关 Python 脚本（`scripts/` 目录）：

| 脚本 | 作用 |
| ---- | ---- |
| `sync_xlsx_to_csv.py` | 主链路：xlsx → import/merged CSV |
| `apply_vndb_tags_score.py` | 按白名单 + VNDB 评分重算 CSV tag 列 |
| `extract_vndb_tags.py` / `merge_vndb_tags.py` | 从 VNDB dump 提取/合并标签 |
| `gen_games_json.py` | import CSV → Docker 生产种子 `seeds/games.json` |
| `gen_characters_json.py` | SQLite 角色数据 → Docker 生产种子 `seeds/characters.json` |

## 切换 PostgreSQL

修改根目录 `.env`：

```
DB_CLIENT=pg
DB_URL=postgres://user:pass@localhost:5432/csgofriberg
```

## Redis 用途

<details>
<summary>展开查看</summary>

- HTTP 与 Socket.IO 分布式限流
- HttpOnly Cookie 会话、实时角色校验和匿名身份签名绑定
- `/api/players/list` 版本化缓存、ETag 与跨实例失效通知
- 排行榜、公告等热点查询缓存
- 多人房间快照、身份索引、分布式房间锁和匹配队列
- 回合超时、断线判负和房间清理的可恢复调度
- Socket.IO Redis Adapter 跨实例广播
- Redis Stream 多人战绩持久化重试

</details>

## Docker 生产部署

生产环境使用 PostgreSQL 专用的精简 Docker 镜像（distroless 运行时，不含 Rust、pnpm、TypeScript、Vite、源码、测试与 SQLite 驱动）。GitHub Actions 自动执行测试、前后端编译、`linux/amd64` 镜像构建并发布到 [`ghcr.io/emulation376-bit/galfriberg`](https://github.com/emulation376-bit/galfriberg/pkgs/container/galfriberg)。

Docker Compose 部署、自动数据库迁移、管理员创建、更新和回滚方法见 [`deploy/README.md`](deploy/README.md)。

## 作品数据

作品与角色属性主要来自 [**VNDB.org**](https://vndb.org) 、[**月幕galgame**](https://www.ymgal.games/) 、[**Bangumi**](https://bangumi.tv/) 的公开数据；角色立绘来自 YmGal / VNDB，萌百为可选的增强数据来源。

仓库不包含 `VNDB/` 与 `exported_data/` 原始 dump。Docker 首次建库会直接使用 `server/src/db/seeds/*.json` 导入当前作品与角色数据；如需从原始数据重新构建，按 [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) 准备数据后运行：

1. `pnpm data:build` —— xlsx 权威列表 + VNDB dump 构建/重建导入 CSV
2. `pnpm data:import` —— 按「游戏名」幂等 upsert `game_titles`，整体替换该作品的难度与别名
3. `pnpm characters:import` —— 按 VNDB dump 导入角色与结构化属性
4. `pnpm images:import` —— 按 YmGal 作品关系与角色名匹配立绘路径
5. `pnpm characters:seed` —— 生成 Docker 使用的 `seeds/characters.json`

### 外部作品更新 API

管理员可在管理后台的 **API Token** 页生成最长 365 天有效的 Bearer Token。明文只在创建时返回一次，服务端仅保存 SHA-256 哈希；每位管理员最多保留 20 个有效 Token，撤销后立即失效。

外部 API 不需要浏览器 PoW，但保留全局限流与独立的失效关闭限流。请求统一携带：

```http
Authorization: Bearer csgf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

可用端点：

- `POST /api/external/games`：新增单个作品，body 与管理后台新增作品格式相同。
- `PUT /api/external/games/:id`：部分更新作品，只传需要修改的字段。
- `POST /api/external/games/import`：按标题批量 upsert，body 为 `{ "games": [...] }`，单次最多 1000 部。

示例：

```bash
curl -X PUT 'https://example.com/api/external/games/123' \
  -H 'Authorization: Bearer csgf_your_token' \
  -H 'Content-Type: application/json' \
  -d '{"company":"Key","bgm_score":8.6,"difficulties":["normal","easy"]}'
```

外部 API 不提供永久删除；同步源可将 `is_enabled` 设为 `false`，使作品立即退出目标池与猜测列表，同时保留历史对局。

## 项目结构

```
server/src
├── config.ts          # 环境配置
├── db/                # Knex 实例、建表、种子数据、导入链路（buildImportCsv/importAll）
├── middleware/        # 认证、Zod 校验、限流、PoW、错误处理
├── routes/            # auth / players / game / characters / characterImages / stats / admin
├── services/          # 游戏判定、角色线索、立绘代理、作品缓存、房间状态、战绩队列等
└── socket/            # 多人房间系统
client/src
├── api/               # axios 封装、socket 单例、作品列表缓存
├── store/             # auth / theme / guest 等轻量状态
├── i18n/              # 中 / 英 / 日 文案与错误码翻译
├── components/        # Page / GuessBoard / CharacterGuessBoard / GuessInputBar / admin/*
└── pages/             # Home / SingleGame / CharacterGame / MultiLobby / MultiRoom / Stats / ...
```

## 贡献

- 🐛 [问题反馈 / 功能建议](https://github.com/emulation376-bit/galfriberg/issues/new/choose) —— 请使用对应的 issue 模板
- 📚 作品数据问题请参考 [作品数据](#作品数据) 与 [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md)
- 提交 PR 前请运行 `pnpm test` 与 `pnpm build`

## 许可证

本项目基于 [AGPL-3.0](LICENSE) 开源。
