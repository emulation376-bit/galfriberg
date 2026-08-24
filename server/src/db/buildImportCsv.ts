/**
 * 数据链路 · 阶段2: 基础 CSV + 数据库 + VNDB → 可编辑 CSV（scripts/galgame_import.csv）
 *
 * 逐行组装（列与来源）:
 *   游戏名         xlsx（权威列表/匹配键）
 *   中文名         数据库 game_titles.title_cn（回退 title_cn 匹配；库里无则用 xlsx 兜底）
 *   别名           数据库 game_aliases（、连接；库里无则用 xlsx 兜底）
 *   发行年份/平均分                仅数据库（未匹配留空）
 *   品牌(Developer)/限制级         仅 VNDB（品牌=developer 角色、限制级=has_ero 判定 R18/全年龄；
 *                                  VNDB 无数据时回退数据库值）
 *   脚本/原画/音乐/声优           仅 VNDB（复用 importVndbStaff 的 matchVn/ROLE_TO_COL/声优逻辑）
 *   难度           按 xlsx 评分人数热度: 前100 → beginner+easy+normal, 前300 → easy+normal, 其余 → normal
 *   评分人数/tag/rank  xlsx 直通
 *
 * CLI: --base / --csv / --vndb / --db（默认沿用项目硬编码路径）
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs, parseCsv, csvEscape, splitList } from './csvUtil';
import {
  loadStaffAliasByAid,
  loadVnStaffByVn,
  loadVoiceData,
  loadVnTitleIndex,
  loadVnExtraData,
  matchVn,
  resolveStaffForVn,
} from './vndbData';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_BASE = path.join(REPO_ROOT, 'scripts', 'galgame_base.csv');
const DEFAULT_CSV = path.join(REPO_ROOT, 'scripts', 'galgame_import.csv');
const DEFAULT_VNDB = path.join(REPO_ROOT, 'VNDB', 'db');

const CSV_COLUMNS = [
  '游戏名',
  'vndb_id',
  '中文名',
  '别名',
  '发行年份',
  '品牌',
  '限制级',
  '脚本',
  '原画',
  '音乐',
  '声优',
  '难度',
  '平均分',
  '评分人数',
  'tag',
  'rank',
  '系列作',
  '时长分钟',
];

const BEGINNER_TOP = 100;
const EASY_TOP = 300;

interface BaseRow {
  gameName: string;
  titleCn: string;
  aliases: string[];
  scorers: number;
  tag: string;
  rank: string;
}

interface DbGame {
  id: number;
  title: string;
  title_cn: string;
  release_year: number;
  company: string;
  is_r18: number | boolean;
  bgm_score: number;
  vndb_id: string | null;
}

function readBaseCsv(filePath: string): BaseRow[] {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`基础 CSV 无数据行: ${filePath}`);
  const header = rows[0];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`基础 CSV 缺少列: ${name}；实际表头: ${header.join(',')}`);
    return i;
  };
  const iName = col('游戏名');
  const iCn = col('中文名');
  const iAlias = col('别名');
  const iScorers = col('评分人数');
  const iTag = col('tag');
  const iRank = col('rank');

  const out: BaseRow[] = [];
  for (const r of rows.slice(1)) {
    const gameName = (r[iName] ?? '').trim();
    if (!gameName) continue;
    const scorersRaw = (r[iScorers] ?? '').trim();
    const scorers = scorersRaw ? Number(scorersRaw) || 0 : 0;
    out.push({
      gameName,
      titleCn: (r[iCn] ?? '').trim(),
      aliases: splitList(r[iAlias] ?? ''),
      scorers,
      tag: (r[iTag] ?? '').trim(),
      rank: (r[iRank] ?? '').trim(),
    });
  }
  return out;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const basePath = args.base ?? DEFAULT_BASE;
  const csvPath = args.csv ?? DEFAULT_CSV;
  const vndbDir = args.vndb ?? DEFAULT_VNDB;
  if (args.db) process.env.DB_URL = args.db;

  const { db } = await import('./knex');
  const baseRows = readBaseCsv(basePath);
  console.log(`[build-csv] 基础 CSV: ${baseRows.length} 行 (${basePath})`);

  // 游戏名是权威匹配键且 DB title 唯一：同名保留评分人数更高的一行（照搬 gen_seed_json.py 去重口径）
  const byName = new Map<string, BaseRow>();
  let deduped = 0;
  for (const row of baseRows) {
    const prev = byName.get(row.gameName);
    if (!prev || row.scorers > prev.scorers) {
      if (prev) deduped += 1;
      byName.set(row.gameName, row);
    } else {
      deduped += 1;
    }
  }
  const uniqueRows = [...byName.values()];
  if (deduped > 0) {
    console.log(`[build-csv] 同名去重: 跳过 ${deduped} 行（保留评分人数更高者） -> ${uniqueRows.length} 行`);
  }

  // ── 数据库基础信息 ──
  const games = (await db('game_titles').select(
    'id',
    'title',
    'title_cn',
    'release_year',
    'company',
    'is_r18',
    'bgm_score',
    'vndb_id',
  )) as DbGame[];
  const aliasRows = (await db('game_aliases').select('game_id', 'alias')) as Array<{
    game_id: number;
    alias: string;
  }>;
  const aliasesByGame = new Map<number, string[]>();
  for (const r of aliasRows) {
    const gid = Number(r.game_id);
    if (!aliasesByGame.has(gid)) aliasesByGame.set(gid, []);
    aliasesByGame.get(gid)!.push(String(r.alias));
  }
  const byTitle = new Map<string, DbGame>();
  const byTitleCn = new Map<string, DbGame>();
  for (const g of games) {
    const title = String(g.title);
    const titleCn = String(g.title_cn);
    if (!byTitle.has(title)) byTitle.set(title, g);
    if (titleCn && !byTitleCn.has(titleCn)) byTitleCn.set(titleCn, g);
  }
  console.log(`[build-csv] 数据库: ${games.length} 部作品, ${aliasRows.length} 条别名`);

  // ── VNDB ──
  if (!fs.existsSync(path.join(vndbDir, 'vn_titles'))) {
    throw new Error(`VNDB 转储不存在: ${vndbDir}`);
  }
  const aliasByAid = loadStaffAliasByAid(vndbDir);
  const vnStaffByVn = loadVnStaffByVn(vndbDir);
  const voiceData = loadVoiceData(vndbDir);
  const { exact, normIndex } = loadVnTitleIndex(vndbDir);
  const { eroByVn, developerByVn, lengthByVn } = loadVnExtraData(vndbDir);
  const seriesVids = new Set<string>();
  const relationsFile = path.join(vndbDir, 'vn_relations');
  if (fs.existsSync(relationsFile)) {
    for (const line of fs.readFileSync(relationsFile, 'utf8').split('\n')) {
      const cols = line.trimEnd().split('\t');
      if (cols.length >= 3 && (cols[2] === 'ser' || cols[2] === 'seq' || cols[2] === 'preq')) {
        seriesVids.add(cols[0]);
      }
    }
  }
  console.log(`[build-csv] VNDB 系列关系: ${seriesVids.size} 部作品标记为系列作`);
  console.log(
    `[build-csv] VNDB: staff_alias ${aliasByAid.size}, 含目标角色 vn ${vnStaffByVn.size}, ` +
      `主要角色 vn ${voiceData.charCidsByVn.size}, 标题精确 ${exact.size}, ` +
      `has_ero vn ${eroByVn.size}, developer vn ${developerByVn.size}`,
  );

  // ── 难度热度（全局排序，规则照搬 gen_seed_json.py）──
  const difficultyByGame = new Map<string, string[]>();
  [...uniqueRows]
    .sort((a, b) => b.scorers - a.scorers)
    .forEach((row, i) => {
      if (i < BEGINNER_TOP) difficultyByGame.set(row.gameName, ['beginner', 'easy', 'normal']);
      else if (i < EASY_TOP) difficultyByGame.set(row.gameName, ['easy', 'normal']);
      else difficultyByGame.set(row.gameName, ['normal']);
    });

  // ── 逐行组装 ──
  const lines: string[][] = [];
  let dbMatched = 0;
  let vndbMatched = 0;
  let vndbStaffEmpty = 0;
  let brandFromVndb = 0;
  let ratingFromVndb = 0;
  for (const row of uniqueRows) {
    const dbRow = byTitle.get(row.gameName) ?? byTitleCn.get(row.gameName);
    if (dbRow) dbMatched += 1;

    const titleCn = dbRow ? String(dbRow.title_cn) : row.titleCn;
    const aliases = [
      ...new Set(
        dbRow
          ? aliasesByGame.get(dbRow.id) ?? (row.aliases.length ? row.aliases : [])
          : row.aliases,
      ),
    ];
    const aliasText = aliases.join('、');
    const year = dbRow ? String(dbRow.release_year) : '';
    const company = dbRow ? String(dbRow.company) : '';
    const rating = dbRow ? (dbRow.is_r18 ? 'R18' : '全年龄') : '';
    const score = dbRow ? String(dbRow.bgm_score) : '';

    // VNDB staff：优先用 DB 里的 vndb_id（权威），缺失时才按标题匹配
    const vid =
      dbRow && dbRow.vndb_id
        ? dbRow.vndb_id
        : matchVn(row.gameName, row.titleCn, row.aliases, exact, normIndex);
    const vndbId = vid ?? '';
    let outCompany = company;
    let outRating = rating;
    let scenario = '';
    let artist = '';
    let music = '';
    let voice = '';
    let lengthMinutes = 0;
    if (vid) {
      vndbMatched += 1;
      const developers = developerByVn.get(vid);
      if (developers && developers.length > 0) {
        outCompany = developers.join('、');
        brandFromVndb += 1;
      }
      const hasEro = eroByVn.get(vid);
      if (hasEro !== undefined) {
        outRating = hasEro ? 'R18' : '全年龄';
        ratingFromVndb += 1;
      }
      const fields = resolveStaffForVn(vid, vnStaffByVn, voiceData, aliasByAid);
      scenario = fields.scenario_writer.join('、');
      artist = fields.artist.join('、');
      music = fields.music_composer.join('、');
      voice = fields.voice_actor.join('、');
      lengthMinutes = lengthByVn.get(vid) ?? 0;
      if (!scenario && !artist && !music && !voice) vndbStaffEmpty += 1;
    }

    const difficulty = difficultyByGame.get(row.gameName) ?? ['normal'];
    lines.push([
      row.gameName,
      vndbId,
      titleCn,
      aliasText,
      year,
      outCompany,
      outRating,
      scenario,
      artist,
      music,
      voice,
      difficulty.join('、'),
      score,
      String(row.scorers),
      row.tag,
      row.rank,
      vid && seriesVids.has(vid) ? '是' : '否',
      lengthMinutes ? String(lengthMinutes) : '',
    ]);
  }

  const csvText =
    CSV_COLUMNS.map(csvEscape).join(',') +
    '\n' +
    lines.map((l) => l.map(csvEscape).join(',')).join('\n') +
    '\n';
  fs.writeFileSync(csvPath, '\uFEFF' + csvText, 'utf8');

  // ── 统计 ──
  const colIdx = (name: string) => CSV_COLUMNS.indexOf(name);
  const diffCount = (key: string) =>
    lines.filter((l) => splitList(l[colIdx('难度')]).includes(key)).length;
  console.log(`\n[build-csv] 完成: ${lines.length} 行 -> ${path.resolve(csvPath)}`);
  console.log(`  DB 匹配:     ${dbMatched} / ${lines.length}  (未匹配 ${lines.length - dbMatched})`);
  console.log(`  VNDB 匹配:   ${vndbMatched} / ${lines.length}  (未匹配 ${lines.length - vndbMatched})`);
  console.log(`  其中 VNDB 匹配但四列 staff 均空: ${vndbStaffEmpty}`);
  const staffFilled = (name: string) => lines.filter((l) => l[colIdx(name)]).length;
  console.log(`  staff 非空: 脚本 ${staffFilled('脚本')}, 原画 ${staffFilled('原画')}, 音乐 ${staffFilled('音乐')}, 声优 ${staffFilled('声优')}`);
  console.log(`  品牌来自 VNDB: ${brandFromVndb}（回退 DB ${lines.length - brandFromVndb}）`);
  console.log(`  限制级来自 VNDB: ${ratingFromVndb}（回退 DB ${lines.length - ratingFromVndb}）`);
  console.log(`  难度分布:   beginner ${diffCount('beginner')}, easy ${diffCount('easy')}, normal ${diffCount('normal')}`);
  console.log(`  DB 未匹配样例:`);
  for (const row of uniqueRows) {
    if (!byTitle.has(row.gameName) && !byTitleCn.has(row.gameName)) console.log(`    - ${row.gameName}`);
  }
  console.log(`  VNDB 未匹配样例:`);
  let shown = 0;
  for (const row of uniqueRows) {
    if (matchVn(row.gameName, row.titleCn, row.aliases, exact, normIndex) === null) {
      console.log(`    - ${row.gameName}`);
      shown += 1;
      if (shown >= 20) break;
    }
  }

  await db.destroy();
}

run().catch((err) => {
  console.error('[build-csv] 失败:', err);
  process.exit(1);
});
