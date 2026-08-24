# Galgame 数据库处理指南（供 AI / 协作者使用）

> 本文件描述 csgofriberg 项目当前唯一的数据处理方式。**一切数据修改以
> `scripts/游戏名.xlsx` 为准**，CSV 与数据库均由它生成，禁止直接改 CSV / SQLite。

## 1. 核心原则

1. **唯一数据源**：`scripts/游戏名.xlsx`（主表，当前 307 款游戏）。
2. **标准链路**：
   `游戏名.xlsx` → `scripts/sync_xlsx_to_csv.py` → `scripts/galgame_import.csv` → 导入 → `server/data/csgofriberg.sqlite3`。
3. **匹配键是 vndb_id**：游戏在 VNDB 的 id（如 `v19587`）是权威标识；
   按标题匹配会出错（已踩坑：Re：LieF 被匹配成 Re-leaf v2695、天神乱漫匹配不上）。
4. 每次修改前先**备份**：复制文件到 `.devlogs/`，按语义命名（如 `xxx.bak_tag`）。

## 2. 文件角色

| 文件 | 角色 |
|---|---|
| `scripts/游戏名.xlsx` | 主表（唯一真源） |
| `scripts/galgame_import.csv` | 应用导入用 CSV（由 xlsx 生成） |
| `scripts/galgame_import.merged.csv` | 同步副本（内容同 import） |
| `scripts/galgame_vndb_tags_merged3.xlsx` | 标签白名单（37 条） |
| `scripts/sync_xlsx_to_csv.py` | xlsx → CSV 同步脚本 |
| `scripts/apply_vndb_tags_score.py` | 按白名单 + VNDB 评分重算 tag 列（vndb_id 优先） |
| `scripts/extract_vndb_tags.py` | VNDB dump 读取工具（被上述脚本复用） |
| `scripts/gen_games_json.py` | 从 import CSV 生成 `server/src/db/seeds/games.json`（Docker 生产种子） |
| `scripts/staff_org_candidates.csv` | staff 机构/厂牌人工裁决表（进行中） |
| `server/data/csgofriberg.sqlite3` | SQLite 数据库 |
| `VNDB/db` | VNDB 本地转储（tags/tags_vn/vn/vn_staff/vn_seiyuu/vn_relations/producers…） |
| `.devlogs/` | 备份与运行日志 |
| `.devlogs/scripts_cleanup_20260809/` | 已归档的历史清洗脚本与中间产物（staff_*.csv、_prune_scenario_va.py 等） |

## 3. 标准操作

### 3.1 修改 xlsx 数据后同步（最常见）

```bash
python scripts/sync_xlsx_to_csv.py
pnpm --filter server import-all
```

同步脚本会：读取 xlsx 的 309 个有名行 → 按行生成 CSV（tag 列压缩、系列作读 xlsx、
缺失时按 VNDB 关系计算）→ 同时写出 import 与 merged 两个 CSV。
`import-all` 按「游戏名」幂等 upsert `game_titles`，替换难度/别名，重建 `staff_aliases`。

> 受限环境（沙箱）下 `pnpm ... import-all` 可能报
> `uv_os_get_passwd returned ENOMEM`：改用编译产物直接跑：
> ```bash
> pnpm --filter server build
> cd server && node dist/db/importAll.js
> ```

### 3.2 修改标签白名单

白名单 = `scripts/galgame_vndb_tags_merged3.xlsx`，列：编号 / 英文名 / 中文翻译 /
出现次数 / 来源标签。

- 新增/删除/合并标签：编辑该 xlsx（先备份），如"新增民俗组"= 加一行并填来源 gid。
- 重新生成 tag 列：`python scripts/apply_vndb_tags_score.py`。
  脚本规则：命中白名单任意来源 gid 且 VNDB 评分 ≥ 2.0 即打标；匹配优先用 CSV 的
  `vndb_id`，缺失才按标题。
- 若以 xlsx 的 tag 列为准：直接改 xlsx tag 列 → 走 3.1。

### 3.3 新增游戏

在 xlsx 末尾空行填入：

- `游戏名`（原版名称，需与 VNDB 一致）、`vndb_id`（权威）
- `中文名`、`别名`（、分隔）
- `发行年份`、`品牌`（、分隔）、`限制级`（R18 / 全年龄）
- `脚本/原画/音乐/声优`（、分隔，来源 VNDB vn_staff/vn_seiyuu，声优只取主要角色且非剧透）
- `难度`（、分隔，beginner/easy/normal）、`平均分`、`评分人数`、`rank`
- `系列作`（是/否）、`时长`（超短篇/短篇/中篇/长篇/超长篇）、`时长分钟`
- tag 列（可选，走白名单口径）

然后走 3.1。

### 3.4 删除游戏

- 先在 xlsx 删除该行 → 同步（3.1）。
- `import-all` **不会删除** CSV 之外的行，需要额外清 DB：
  `DELETE FROM game_titles WHERE title = ?`（`game_difficulties` / `game_aliases`
  会级联删除；若 `games` 表有引用需先处理）。

## 4. 字段说明

### xlsx / CSV 列

| 列 | 说明 |
|---|---|
| 游戏名 | 原版名称（唯一键） |
| vndb_id | VNDB id（权威匹配键） |
| 中文名 / 别名 | 别名用、分隔 |
| 发行年份 / 品牌 / 限制级 | 品牌可含多个（、分隔），也存在 "Leaf/AQUAPLUS" 连写 |
| 脚本 / 原画 / 音乐 / 声优 | 、分隔；声优仅主要角色 |
| 难度 | 、分隔（beginner/easy/normal） |
| 平均分 / 评分人数 / rank | 外部评分数据 |
| 系列作 | 是/否（ser/seq/preq 任一命中） |
| 时长 | 超短篇(<2h) / 短篇(2–10h) / 中篇(10–30h) / 长篇(30–50h) / 超长篇(>50h) |
| 时长分钟 | VNDB c_length |
| tag1..tagN | 标签（每格一个） |

### game_titles 表关键字段

`title`（唯一）、`vndb_id`、`title_cn`、`release_year`、`company`、`is_r18`、
`scenario_writer`、`artist`、`music_composer`、`voice_actor`、`bgm_score`、
`tags`（、分隔）、`is_series`（布尔）、`length_minutes`（整数，0=未知）、
`is_active`、`is_enabled`。

## 5. 标签白名单（37 条，来源文件为准）

悬疑、战斗、奇幻、科幻、失忆、血腥/血浆、时间旅行、夏天、超能力、多角恋、魔法、
转生/轮回、阴谋、末日/启示录、岛屿、异次元/平行世界、凶杀、meta、记忆篡改、梦境、
乡村、虚构世界、类型转变、宅邸、仅一位女主角、雪、机甲、战争、电波、反乌托邦、
音乐主题、民俗、**同性恋**、真女主、创作/设计题材、咖啡厅、疾病。

关键口径：

- **同性恋** = g97/g1986（百合）、g98/g2002（BL）、g1470/g3084/g3085/g490/g2076
  （同性恋角色）——**严格口径**，仅主角/女主级；双性恋、跨性别、非二元、伪娘等已剔除。
- **民俗** = g319/g537/g1011/g548/g344/g2318/g1525。
- **疾病** = g167/g281。
- 配角级标签一律不用（历史教训：g251 同性恋配角、g393/g1785 伪娘配角、g2864
  跨性别配角均被剔除；女主级保留，如 g388 伪娘女主——石头门琉华子线）。
- 新增标签时全表出现率需 **≤50%**（309 口径下 ≤154 款）。

## 6. 已知坑与约定

1. **标题匹配会错配**：必须优先 vndb_id（`apply_vndb_tags_score.py` 已修；
   `buildImportCsv.ts` 已修）。
2. **xlsx 被 Excel 占用**：写入报 `PermissionError: [Errno 13]`，需用户先关闭文件。
3. **PowerShell 管道中文乱码**：`python -X utf8 -c "…中文…"` 或 `node -e "…中文…"`
   会把中文字面量弄乱；请用 `.py`/`.cjs` 脚本文件。
4. **品牌合并已执行**：AER LLC./Re,AER LLC.→Acacia；Citrus→Navel；
   TOKYOTOON→HARUKAZE；AKABEiSOFT3、hibiki works→AKABEiSOFT2；
   Team GrisGris→MAGES.。以后新增品牌避免再用子品牌。
5. **别名/品牌分隔符**：品牌列只按「、」切分；逗号、斜杠属于公司名内部
   （如 Regista Co.,Ltd.、Leaf/AQUAPLUS），不可拆分。
6. **数据库删除不可逆**：先备份（复制 sqlite 文件到 `.devlogs/` 或
   `server/data/*.bak`）。

## 7. 验证

- 行数一致：xlsx 有名行 = CSV 行数 = DB `game_titles` 行数（当前 309）。
- 抽查：`SELECT title, company, tags, is_series, length_minutes FROM game_titles WHERE …`
- 检查标签残留：xlsx/CSV/DB 中不应有已删除的标签名。
- 前端改动后需重启 dev 服务或重新构建，内存缓存才会刷新。

## 8. Staff（脚本/原画/音乐/声优）数据处理方法

### 8.1 现行自动口径（VNDB 直取）

`buildImportCsv.ts` / `importAll.ts` 从 VNDB dump 直接解析 staff，规则见
`server/src/db/vndbData.ts` 的 `resolveStaffForVn`：

- **脚本**：`vn_staff` 中 role = `scenario`。
- **原画**：role = `art` 或 `chardesign`（含 Backgrounds 等附属注释行）。
- **音乐**：role = `music`。
- **声优**：`vn_seiyuu` × `chars_vns` 中 **role ∈ main/primary 且 spoil=0** 的主要角色，
  按 `staff_id` 去重。
- 显示名：`pickName` —— 原名含中日字符优先，否则罗马字。
- 别名归并：以 VNDB `staff_id` 为身份键（staff_alias 映射），同一人多署名只保留一个。

### 8.2 历史人工清洗流程（已归档）

早期做过一轮基于 CSV 的人工清洗，产物与脚本已归档到
`.devlogs/scripts_cleanup_20260809/`，规则可复用：

| 文件 | 用途 |
|---|---|
| `staff_alias_map(.2).csv` | 别名 → staff_id → 规范显示名 |
| `staff_alias_people.csv` | 同人多署名的汇总（含"你选的规范名"） |
| `staff_art_notes.csv` | 原画 note 分类统计 |
| `staff_bigcells.csv` / `staff_once_in_crowd.csv` | 栏位人数爆表 / 只出现一次的人 |
| `staff_garbage_candidates.csv` | 垃圾名人工裁决（删/保留/改名） |
| `staff_pruned_final.csv` / `staff_pruned_music.csv` | 已删记录及删除原因 |
| `staff_stats.csv` | 人 → 各工种出现次数 |
| `_prune_scenario_va.py` | 删除规则：脚本栏删外围 note（assistance/guest/sub 等）；声优栏删 **side-only 声优**、同角色多声优里的 **english** |

### 8.3 当前进行的机构/厂牌裁决

`scripts/staff_org_candidates.csv` 正在人工裁决"机构型署名"（动画外包工作室、
音乐厂牌等，如 アトリエ空機関、ジズスタジオ），列：名称 / 出现次数 / 出现列 /
涉及游戏 / 我建议 / 理由 / 你的处理(保留/删/改名)。原则：知名厂牌保留、垃圾名删除、
歧义名人工决定；处理结果最终落到 xlsx 的 staff 列 → 走第 3.1 节同步。

## 9. 现成脚本清单（可直接使用）

### 9.1 数据管道（scripts/）

| 脚本 | 作用 | 用法 |
|---|---|---|
| `sync_xlsx_to_csv.py` | **主链路**：xlsx → import/merged CSV（系列作读 xlsx） | `python scripts/sync_xlsx_to_csv.py` |
| `apply_vndb_tags_score.py` | 按白名单+VNDB 评分重算 CSV tag 列（vndb_id 优先） | `python scripts/apply_vndb_tags_score.py [--csv …] [--min-score 2.0]` |
| `xlsx_to_base.py` | 阶段1：ymgal xlsx → `galgame_base.csv` | `python scripts/xlsx_to_base.py` |
| `extract_bangumi_tags.py` | CSV 游戏 → Bangumi subject.jsonlines → tag 统计 xlsx | `python scripts/extract_bangumi_tags.py [--bgm …]` |
| `extract_vndb_tags.py` | CSV 游戏 → VNDB dump → tag 统计 xlsx（含全量 tag） | `python scripts/extract_vndb_tags.py` |
| `merge_vndb_tags.py` | 重读 VNDB，把细标签按 MERGES 合并精简（游戏级去重） | `python scripts/merge_vndb_tags.py` |
| `merge_vndb_tags_xlsx.py` | 基于已有 tag xlsx 合并精简（不去重） | `python scripts/merge_vndb_tags_xlsx.py` |
| `gen_games_json.py` | import CSV → `server/src/db/seeds/games.json`（Docker 种子） | `python scripts/gen_games_json.py` |

### 9.2 构建 / 安装（scripts/）

| 脚本 | 作用 |
|---|---|
| `build-pow.mjs` / `build-pow.ps1` | 编译 pow-wasm → `client/public/pow/csgofriberg_pow.wasm`（mjs 带源哈希缓存，`FORCE_POW_BUILD=true` 强制） |
| `install-better-sqlite3.mjs` | 把 `vendor/better_sqlite3.node`（Node 24/win32/x64）复制进 node_modules（postinstall 自动跑） |

### 9.3 服务端 / 根命令（pnpm）

| 命令 | 作用 |
|---|---|
| `pnpm data:build` | xlsx_to_base.py + build-import-csv |
| `pnpm data:import` | import-all（CSV → DB） |
| `pnpm --filter server build-import-csv` | buildImportCsv.ts（阶段2 重建 import CSV） |
| `pnpm --filter server import-all` | importAll.ts（阶段3 upsert 入库） |
| `pnpm --filter server migrate` / `seed` | 建表迁移 / 补种子选手 |
| `pnpm --filter server create-admin` | 创建/重置管理员 |
| `pnpm dev` / `pnpm build` / `pnpm start` / `pnpm test` | 开发/构建/启动/测试 |
| `pnpm --filter server maintenance` / `loadtest` | 维护脚本 / 负载测试 |

### 9.4 角色数据（VNDB + 萌百）

| 命令 | 作用 |
|---|---|
| `pnpm characters:import` | 按当前 `game_titles.vndb_id` 从 VNDB dump 导入 main/primary 角色与结构化属性 |
| `pnpm mzh:characters -- --limit 50` | 按角色名搜索萌百并抓取 姓名/性别/年龄/身高/发色/瞳色/声优/所属作品/萌点 |
| `pnpm images:import` | 按 YmGal 作品关系 + 角色名匹配写入 `characters.ymgal_image`；未匹配的角色由 VNDB 立绘兜底 |
| `pnpm characters:seed` | 从本地 SQLite 生成 `server/src/db/seeds/characters.json`，Docker 首次建库会自动导入角色数据 |

角色主表：`characters` / `character_names` / `character_aliases` / `game_characters`。
萌百增强字段表：`character_mzh_fields`；运行 `mzh:characters` 前需配置
`MOEGIRLPEDIA_USERNAME` 与 `MOEGIRLPEDIA_BOT_PASSWORD`。

## 10. 存储与运行时调用方案

### 分层

- **持久层**：本地开发 SQLite（`server/data/csgofriberg.sqlite3`），生产 PostgreSQL。
- **活动状态层**：Redis。单人进行中对局 30 分钟 TTL；Redis 不可用时降级为进程内 Map。
- **运行时缓存层**：
  - 作品库：`playerCache` 全量载入内存，按难度分组，Redis 版本号 + pub/sub 失效。
  - Staff 别名：`staffResolver` 启动时载入，约 9.8 万条。
  - 角色搜索列表：`getCharacterSearchList` 使用 `queryCache`，TTL 60 秒。
  - 角色 clue：`characterClueCache` 启动时全量预载，按角色 id 共享，
    Redis 可用时由导入流程发布失效，否则重启后重载。
  - 角色立绘：`/img/character/:id` 优先 YmGal CDN、失败回退 VNDB，
    文件缓存到 `server/data/image-cache`。

### 主要数据表

| 表 | 角色 |
|---|---|
| `game_titles` | 作品主表，`title` 唯一，标签存为 `、` 分隔字符串 |
| `game_aliases` / `game_difficulties` | 作品搜索别名与难度池 |
| `games` / `character_games` | 已结算单人战绩（独立维度） |
| `characters` 及 `character_*` 子表 | 角色、名称、别名、trait、声优、参演作品 |
| `staff_aliases` | VNDB staff 身份归一 |
| `match_records` / `match_players` | 多人对局 |

### 调用路径

- 猜作品搜索/开局：`playerCache` 内存命中，不走 DB。
- 猜角色列表：`/characters/list` 走 60 秒缓存；角色详情仍逐次查库。
- 猜测判定：猜作品走 `compareGuess`（纯内存）；猜角色每次猜测会加载目标与猜测双方的
  `character_clue`，是当前角色链路的主要 DB 热点。
- 结算：先写 Redis 活动局，结束后写 `games` / `character_games` 并失效对应缓存。

## 11. 后续优化建议（按优先级）

1. **角色 clue 缓存**：把 `loadCharacterClue` 按角色 id 缓存（导入后失效），
   可把猜角色单局从约 30+ 次子查询降到个位数。（已完成：启动全量预载）
2. **自定义池入 Redis**：`createCustomPool` / `createCustomCharacterPool` 目前是
   进程内 Map，多实例部署下跨实例开局会失败；应改为 Redis key + TTL。
3. **BGM 中文名导入批量写**：`importBangumiCharacterNames` 已改为一次映射 +
   按 500 条批量 upsert。
4. **导入管道统一入口**：`sync_xlsx_to_csv.py` + `import-all` 分属 Python/TS 两套
   工具链，建议收敛为单条 `pnpm data:sync` 命令并输出一致校验报告。
