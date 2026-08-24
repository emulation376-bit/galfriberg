# Galgame 数据怎么改

这份文档记录这个项目里的 Galgame 数据是怎么维护的（其实是我拿来给AI读的）

## 关键

1. `scripts/游戏名.xlsx` 是唯一真源，现在有 309 款游戏。
2. 正常链路：
   `游戏名.xlsx` → `scripts/sync_xlsx_to_csv.py` → `scripts/galgame_import.csv` → `import-all` → SQLite。
3. 游戏匹配尽量用 `vndb_id`，不要靠标题。按标题匹配容易匹配不上


### `游戏名.xlsx` 的获取

它不是脚本自动生成的，而是从月幕 galgame 的导出文件整理出来的手动版本：

1. `利用bgm评价数筛选游戏，然后导出游戏名去ymgal数据库中匹配，得到的游戏名、中文名、别名、评分人数、rank后转成xlsx。
2. 人工在 `xlsx` 里维护完整字段：补 `vndb_id`、脚本/原画/音乐/声优、难度、系列作、时长、tag 等，并修正导出里不可靠的内容。
4. `sync_xlsx_to_csv.py` 只读取 `游戏名.xlsx` 生成 CSV，数据库最终也以它为准。

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


