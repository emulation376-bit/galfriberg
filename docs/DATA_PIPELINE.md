# Galgame 数据怎么改

这份文档记录这个项目里的 Galgame 数据是怎么维护的
简单说：**数据以 `scripts/游戏名.xlsx` 为准，CSV 和数据库都从它生成**，平时不要直接去改 CSV 或 SQLite。

## 先记住这几件事

1. `scripts/游戏名.xlsx` 是唯一真源，现在有 309 款游戏。
2. 正常链路：
   `游戏名.xlsx` → `scripts/sync_xlsx_to_csv.py` → `scripts/galgame_import.csv` → `import-all` → SQLite。
3. 游戏匹配尽量用 `vndb_id`，不要靠标题。按标题匹配容易踩坑，比如 Re：LieF 被匹配成 Re-leaf、天神乱漫匹配不上。
4. 每次大改前先备份：把要动的文件复制到 `.devlogs/`，名字起得能看出改了什么。

### `游戏名.xlsx` 是从哪来的

它不是脚本自动生成的，而是从月幕 galgame 的导出文件整理出来的手动版本：

1. `scripts/galgame_ymgal_v2.xlsx`：从月幕导出的原始游戏列表，sheet 叫 `galgame_ymgal`，约 343 行。
2. `scripts/xlsx_to_base.py`：只把原始导出里的游戏名、中文名、别名、评分人数、tag、rank 转成 `galgame_base.csv`，作为后续匹配和补数据的基础。
3. 人工在 `scripts/游戏名.xlsx` 里维护完整字段：补 `vndb_id`、脚本/原画/音乐/声优、难度、系列作、时长、tag 等，并修正导出里不可靠的内容。
4. `sync_xlsx_to_csv.py` 只读取 `游戏名.xlsx` 生成 CSV，数据库最终也以它为准。

所以以后改数据就改 `游戏名.xlsx`，不要用 `galgame_ymgal_v2.xlsx` 重新生成覆盖它。

## 日常操作

### 改完 xlsx 后同步

这是最常见的操作：

```bash
python scripts/sync_xlsx_to_csv.py
pnpm --filter server import-all
```

`sync_xlsx_to_csv.py` 会读 xlsx，把 tag 列压缩，按 xlsx 和 VNDB 关系算系列作，同时生成 import 和 merged 两个 CSV。`import-all` 按游戏名幂等 upsert 到 `game_titles`，替换难度和别名，重建 `staff_aliases`。

沙箱环境下 `pnpm ... import-all` 如果报 `uv_os_get_passwd returned ENOMEM`，可以先构建再用编译产物跑：

```bash
pnpm --filter server build
cd server && node dist/db/importAll.js
```

### 新增游戏

在 xlsx 末尾空行填这些列：

- `游戏名`（要和 VNDB 一致）、`vndb_id`
- `中文名`、`别名`（、分隔）
- `发行年份`、`品牌`（、分隔）、`限制级`（R18 / 全年龄）
- `脚本/原画/音乐/声优`（、分隔，声优只取主要角色且非剧透）
- `难度`（beginner/easy/normal）、`平均分`、`评分人数`、`rank`
- `系列作`、`时长`、`时长分钟`
- tag 列（可选）

填完走上面的同步流程。

### 删除游戏

先在 xlsx 里删掉那一行，再同步。注意 `import-all` 不会删 CSV 之外的数据，所以还要手动清理数据库：

```sql
DELETE FROM game_titles WHERE title = '游戏名';
```

`game_difficulties` 和 `game_aliases` 会级联删；如果 `games` 表还引用这个作品，需要先处理。

### 改标签白名单

白名单是 `scripts/galgame_vndb_tags_merged3.xlsx`，列有编号、英文名、中文翻译、出现次数、来源标签。

- 新增、删除、合并标签：先备份，再直接改这个 xlsx。
- 重新算 tag 列：`python scripts/apply_vndb_tags_score.py`。
  规则是命中白名单来源 gid 且 VNDB 评分 ≥ 2.0 就打标，匹配优先用 `vndb_id`，没有才按标题。
- 如果某个游戏的 tag 想自己指定，也可以直接改 xlsx 的 tag 列，然后走正常同步。

## 字段说明

### xlsx / CSV 列

| 列 | 说明 |
|---|---|
| 游戏名 | 原版名称，唯一键 |
| vndb_id | VNDB id，权威匹配键 |
| 中文名 / 别名 | 别名用、分隔 |
| 发行年份 / 品牌 / 限制级 | 品牌可能多个，用、分隔，也有 "Leaf/AQUAPLUS" 这种连写 |
| 脚本 / 原画 / 音乐 / 声优 | 、分隔；声优只算主要角色 |
| 难度 | beginner/easy/normal，可多个 |
| 平均分 / 评分人数 / rank | 外部评分数据 |
| 系列作 | 是/否，VNDB 的 ser/seq/preq 任一命中就算 |
| 时长 | 超短篇(<2h) / 短篇(2–10h) / 中篇(10–30h) / 长篇(30–50h) / 超长篇(>50h) |
| 时长分钟 | VNDB c_length |
| tag1..tagN | 每个格子一个标签 |

### game_titles 表

主要字段：`title`（唯一）、`vndb_id`、`title_cn`、`release_year`、`company`、`is_r18`、`scenario_writer`、`artist`、`music_composer`、`voice_actor`、`bgm_score`、`tags`（、分隔）、`is_series`、`length_minutes`、`is_active`、`is_enabled`。

## 标签规则

现在白名单有 37 条，以 xlsx 文件为准。几个容易记错的口径：

- **同性恋**：g97/g1986（百合）、g98/g2002（BL）、g1470/g3084/g3085/g490/g2076（同性恋角色）。只算主角/女主级，双性恋、跨性别、非二元、伪娘都不算。
- **民俗**：g319/g537/g1011/g548/g344/g2318/g1525。
- **疾病**：g167/g281。
- 配角级标签一律不用。历史上因为给配角打同性恋、伪娘、跨性别标签踩过坑，后来都剔了；女主级可以保留，比如石头门琉华子线。
- 新增标签时全表出现率要 ≤50%，按 309 款算就是 ≤154 款。

## Staff 数据

### 现在自动从 VNDB 取

`buildImportCsv.ts` 和 `importAll.ts` 会从 VNDB dump 直接解析 staff，规则在 `server/src/db/vndbData.ts` 的 `resolveStaffForVn`：

- 脚本：`vn_staff` 里 role = `scenario`
- 原画：role = `art` 或 `chardesign`
- 音乐：role = `music`
- 声优：`vn_seiyuu` × `chars_vns`，只算 main/primary 且 spoil=0 的主要角色，按 `staff_id` 去重
- 显示名：有中日字符优先，没有就罗马字
- 别名：以 VNDB `staff_id` 为身份，同一人多署名只保留一个

### 之前的人工清洗

早期做的人工清洗产物都归档在 `.devlogs/scripts_cleanup_20260809/`，规则可以复用：

| 文件 | 用途 |
|---|---|
| `staff_alias_map(.2).csv` | 别名 → staff_id → 规范显示名 |
| `staff_alias_people.csv` | 同人多署名的汇总 |
| `staff_art_notes.csv` | 原画 note 分类统计 |
| `staff_bigcells.csv` / `staff_once_in_crowd.csv` | 栏位人数爆表 / 只出现一次的人 |
| `staff_garbage_candidates.csv` | 垃圾名裁决表 |
| `staff_pruned_final.csv` / `staff_pruned_music.csv` | 已删记录和原因 |
| `staff_stats.csv` | 每个人在各工种的次数 |
| `_prune_scenario_va.py` | 删除脚本栏外围 note，删 side-only 声优和同角色多声优里的 english |

### 正在做的机构/厂牌裁决

`scripts/staff_org_candidates.csv` 在人工处理动画外包工作室、音乐厂牌这类机构署名。列有名称、出现次数、出现列、涉及游戏、建议、理由、处理结果。原则是知名厂牌保留、垃圾名删除、歧义名人工决定。处理结果最终落到 xlsx 的 staff 列，然后走同步。

## 角色数据

角色相关命令：

| 命令 | 作用 |
|---|---|
| `pnpm characters:import` | 按 `game_titles.vndb_id` 从 VNDB dump 导入 main/primary 角色和属性 |
| `pnpm bgm:characters` | 从 Bangumi 数据补充角色的简体中文名，写入 `characters.name_cn` |
| `pnpm mzh:characters -- --limit 50` | 抓萌百的姓名/性别/年龄/身高/发色/瞳色/声优/所属作品等 |
| `pnpm images:import` | 按 YmGal 作品关系 + 角色名匹配写入 `characters.ymgal_image`，没匹配到的用 VNDB 立绘兜底 |
| `pnpm characters:seed` | 从本地 SQLite 生成 `server/src/db/seeds/characters.json`，Docker 首次建库会用它导入角色数据 |

### 人物数据怎么处理

人物数据不是靠 xlsx 维护的，来源是 VNDB dump，再叠加 Bangumi 中文名、萌百字段和 YmGal 立绘。完整顺序一般是：

1. 先保证游戏数据已经导入，`game_titles.vndb_id` 都存在。
2. 跑 `pnpm characters:import`：从 VNDB dump 重建角色基础数据。
   它会按 `game_titles.vndb_id` 关联作品，只保留 main/primary 角色，导入姓名、性别、生日、身高、年龄、立绘 id、trait、声优和参演作品。
3. 跑 `pnpm bgm:characters`：用 Bangumi 的角色数据补 `name_cn`，让前端优先显示简体中文名。
4. 可选：跑 `pnpm mzh:characters -- --limit 50` 抓萌百增强字段，需要先配好 `MOEGIRLPEDIA_USERNAME` 和 `MOEGIRLPEDIA_BOT_PASSWORD`。
5. 跑 `pnpm images:import`：用 YmGal 的作品关系 + 角色名匹配 `main_img`，写入 `characters.ymgal_image`；没匹配到的角色运行时自动走 VNDB 立绘。
6. 如果这次改动要进 Docker，最后跑 `pnpm characters:seed` 重新生成 `seeds/characters.json`，并把这个文件一起提交。

涉及的表：

- `characters`：角色主表，`id` 是 VNDB 角色 id，`image` 是 VNDB 立绘 id，`ymgal_image` 是 YmGal 立绘路径
- `character_names` / `character_aliases`：多语言名称和别名
- `character_traits`：服装 / 身份 / 发型 / 体型 / 眼睛等特征
- `character_voice_actors`：声优
- `character_game_appearances`：角色参演作品（按 VNDB vid 关联）
- `game_characters`：当前题库里作品和角色的关系
- `character_mzh_fields`：萌百增强字段

注意：`characters:import` 会整表重建角色相关数据，所以游戏数据更新后要重跑；`characters:seed` 目前导出的是基础角色数据，不含萌百增强字段。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm data:build` | xlsx_to_base.py + build-import-csv |
| `pnpm data:import` | import-all（CSV → DB） |
| `pnpm --filter server migrate` / `seed` | 建表迁移 / 补种子数据 |
| `pnpm --filter server create-admin` | 创建或重置管理员 |
| `pnpm dev` / `pnpm build` / `pnpm start` / `pnpm test` | 开发、构建、启动、测试 |
| `pnpm --filter server maintenance` / `loadtest` | 维护脚本 / 负载测试 |

其他脚本：

- `python scripts/sync_xlsx_to_csv.py`：xlsx → CSV 主链路
- `python scripts/apply_vndb_tags_score.py`：按白名单和 VNDB 评分重算 tag
- `python scripts/extract_vndb_tags.py` / `extract_bangumi_tags.py`：从 VNDB / Bangumi 提取标签
- `python scripts/gen_games_json.py`：import CSV → `seeds/games.json`（Docker 种子）
- `pnpm build:pow`：编译 PoW WASM
- `pnpm postinstall`：自动复制 `vendor/better_sqlite3.node` 到 node_modules

## 已知的坑

1. **标题匹配会错配**，能走 vndb_id 就走 vndb_id。
2. **Excel 占用文件**时写入会报 `PermissionError: [Errno 13]`，先把 Excel 关掉。
3. **PowerShell 里直接写中文脚本**容易乱码，中文字面量尽量放 `.py` / `.cjs` 文件里。
4. **品牌合并已经做过一轮**：AER LLC./Re,AER LLC.→Acacia，Citrus→Navel，TOKYOTOON→HARUKAZE，AKABEiSOFT3、hibiki works→AKABEiSOFT2，Team GrisGris→MAGES.。以后新增品牌尽量别再用子品牌。
5. **品牌分隔符只认「、」**，逗号和斜杠是公司名的一部分，不能拆。
6. **删数据库前先备份**，SQLite 直接复制到 `.devlogs/` 或 `server/data/*.bak`。

## 验证

- 行数要一致：xlsx 有名行 = CSV 行数 = DB `game_titles` 行数（当前 309）。
- 抽查几个字段：`SELECT title, company, tags, is_series, length_minutes FROM game_titles WHERE ...`
- 检查标签残留：xlsx、CSV、DB 里都不该出现已经删掉的标签。
- 前端改完要重启 dev 或重新构建，内存缓存才会刷新。

## 运行时怎么存

- 本地开发用 SQLite：`server/data/csgofriberg.sqlite3`
- 生产用 PostgreSQL，Docker 编排在 `compose.yaml`
- 进行中的单人对局、房间、限流这些放 Redis；Redis 挂掉时单人局会退回进程内 Map
- 作品库、staff 别名、角色 clue 都有启动时缓存；角色立绘走 `/img/character/:id`，YmGal 优先、VNDB 兜底，缓存写在 `server/data/image-cache`（生产容器里是 `/tmp/image-cache`）

## 还没做 / 想做的

1. 自定义池目前是进程内 Map，多实例部署时跨实例开局会失败，应该改成 Redis key + TTL。
2. 导入链路现在是 Python + TypeScript 两套工具，之后想收敛成一条 `pnpm data:sync` 命令，顺便输出一致性校验报告。
3. 角色 clue 缓存已经在启动时全量预载，之后如果角色数据继续变大，可以再考虑更细的失效策略。
