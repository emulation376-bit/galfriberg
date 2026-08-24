/**
 * 数据链路 · 阶段3: 可编辑 CSV + VNDB → 幂等 upsert 入库（pnpm data:import）
 *
 * 1. ensureSchema()
 * 2. 写库前自动备份数据库文件为 <db>.sqlite3.bak
 * 3. 按「游戏名」幂等 upsert game_titles（新增/更新全部 CSV 字段），
 *    并整体替换该游戏的 game_difficulties（难度列）与 game_aliases（别名列）；
 *    只处理 CSV 内的游戏，不删除 CSV 之外的数据。
 * 4. 读 VNDB staff + staff_alias → 重建 staff_aliases 表（照搬 importStaffAliases 逻辑）。
 *
 * CLI: --csv / --vndb / --db（默认沿用项目硬编码路径）
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs, parseCsv, splitList } from './csvUtil';
import { buildStaffAliasRows } from './vndbData';
import { isKnownDifficultyKey } from '../difficulties';
import { invalidateCharacterClueCache } from '../services/characterClueCache';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
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
  '系列作',
  '时长分钟',
];

interface CsvRow {
  title: string;
  vndbId: string;
  titleCn: string;
  aliases: string[];
  year: number;
  company: string;
  isR18: boolean;
  scenario: string;
  artist: string;
  music: string;
  voice: string;
  difficulties: string[];
  tags: string[];
  isSeries: boolean;
  lengthMinutes: number;
  score: number;
  voteCount: number;
}

function readCsv(filePath: string): CsvRow[] {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`CSV 无数据行: ${filePath}`);
  const header = rows[0];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV 缺少列: ${name}；实际表头: ${header.join(',')}`);
    return i;
  };
  const idx = Object.fromEntries(CSV_COLUMNS.map((name) => [name, col(name)])) as Record<string, number>;

  const out: CsvRow[] = [];
  for (const r of rows.slice(1)) {
    const title = (r[idx['游戏名']] ?? '').trim();
    if (!title) continue;
    const year = Number((r[idx['发行年份']] ?? '').trim()) || 0;
    const score = Number((r[idx['平均分']] ?? '').trim()) || 0;
    const voteCount = Number((r[idx['评分人数']] ?? '').trim()) || 0;
    const difficulties = [
      ...new Set(
        splitList(r[idx['难度']] ?? '').filter((k) => {
          const known = isKnownDifficultyKey(k);
          if (!known) console.warn(`[import-all] “${title}” 难度含未知项 ${k}，已忽略`);
          return known;
        }),
      ),
    ];
    const tags = header
      .filter((name) => /^tag\d+$/.test(name))
      .map((name) => (r[header.indexOf(name)] ?? '').trim())
      .filter(Boolean);
    out.push({
      title,
      vndbId: (r[idx['vndb_id']] ?? '').trim(),
      titleCn: (r[idx['中文名']] ?? '').trim(),
      aliases: [...new Set(splitList(r[idx['别名']] ?? ''))],
      year,
      company: (r[idx['品牌']] ?? '').trim(),
      isR18: (r[idx['限制级']] ?? '').trim() === 'R18',
      scenario: (r[idx['脚本']] ?? '').trim(),
      artist: (r[idx['原画']] ?? '').trim(),
      music: (r[idx['音乐']] ?? '').trim(),
      voice: (r[idx['声优']] ?? '').trim(),
      difficulties,
      tags,
      isSeries: (r[idx['系列作']] ?? '').trim() === '是',
      lengthMinutes: Number((r[idx['时长分钟']] ?? '').trim()) || 0,
      score,
      voteCount,
    });
  }
  return out;
}

function backupDb(dbUrl: string, dbClient: string): string | null {
  if (dbClient !== 'sqlite') {
    console.log('[import-all] DB_CLIENT=pg，跳过文件备份');
    return null;
  }
  const file = path.isAbsolute(dbUrl) ? dbUrl : path.resolve(__dirname, '../..', dbUrl);
  if (!fs.existsSync(file)) {
    console.warn(`[import-all] 未找到数据库文件 ${file}，跳过备份`);
    return null;
  }
  const bak = `${file}.bak`;
  fs.copyFileSync(file, bak);
  return bak;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = args.csv ?? DEFAULT_CSV;
  const vndbDir = args.vndb ?? DEFAULT_VNDB;
  if (args.db) process.env.DB_URL = args.db;

  const { db } = await import('./knex');
  const { ensureSchema } = await import('./schema');
  const { config } = await import('../config');

  await ensureSchema();
  const rows = readCsv(csvPath);
  if (!rows.length) throw new Error(`CSV 无有效数据行: ${csvPath}`);
  console.log(`[import-all] 读取 CSV: ${rows.length} 行 (${csvPath})`);

  // ── 写库前备份 ──
  const bak = backupDb(config.dbUrl, config.dbClient);
  if (bak) console.log(`[import-all] 已备份 -> ${bak}`);

  // ── 当前库状态 ──
  const currentTitles = (await db('game_titles').select(
    'id',
    'title',
    'vndb_id',
    'title_cn',
    'release_year',
    'company',
    'is_r18',
    'scenario_writer',
    'music_composer',
    'artist',
    'voice_actor',
    'bgm_score',
    'tags',
    'is_series',
    'length_minutes',
    'vote_count',
  )) as Array<{
    id: number;
    title: string;
    vndb_id: string | null;
    title_cn: string;
    release_year: number;
    company: string;
    is_r18: number | boolean;
    scenario_writer: string;
    music_composer: string;
    artist: string;
    voice_actor: string;
    bgm_score: number;
    tags: string;
    is_series: number | boolean;
    length_minutes: number;
    vote_count: number;
  }>;
  const idByTitle = new Map<string, number>();
  const currentByTitle = new Map<string, (typeof currentTitles)[number]>();
  for (const g of currentTitles) {
    const title = String(g.title);
    idByTitle.set(title, Number(g.id));
    currentByTitle.set(title, g);
  }

  const diffRows = (await db('game_difficulties').select('game_id', 'difficulty_key')) as Array<{
    game_id: number;
    difficulty_key: string;
  }>;
  const diffByGame = new Map<number, Set<string>>();
  for (const r of diffRows) {
    const gid = Number(r.game_id);
    if (!diffByGame.has(gid)) diffByGame.set(gid, new Set());
    diffByGame.get(gid)!.add(String(r.difficulty_key));
  }

  const aliasRows = (await db('game_aliases').select('game_id', 'alias')) as Array<{
    game_id: number;
    alias: string;
  }>;
  const aliasByGame = new Map<number, Set<string>>();
  for (const r of aliasRows) {
    const gid = Number(r.game_id);
    if (!aliasByGame.has(gid)) aliasByGame.set(gid, new Set());
    aliasByGame.get(gid)!.add(String(r.alias));
  }

  // ── 差异计算 ──
  interface WritePlan {
    gameId: number;
    payload: Record<string, unknown>;
    difficulties: string[];
    aliases: string[];
    diffChanged: boolean;
    aliasChanged: boolean;
    isNew: boolean;
  }
  const plan: WritePlan[] = [];
  let inserted = 0;
  let updated = 0;
  let diffReplaced = 0;
  let aliasReplaced = 0;

  for (const row of rows) {
    const payload: Record<string, unknown> = {
      title: row.title,
      ...(row.vndbId ? { vndb_id: row.vndbId } : {}),
      title_cn: row.titleCn,
      release_year: row.year,
      company: row.company,
      is_r18: row.isR18,
      scenario_writer: row.scenario,
      music_composer: row.music,
      artist: row.artist,
      voice_actor: row.voice,
      bgm_score: row.score,
      vote_count: row.voteCount,
      tags: row.tags.join('、'),
      is_series: row.isSeries,
      length_minutes: row.lengthMinutes,
    };

    const current = currentByTitle.get(row.title);
    if (!current) {
      inserted += 1;
      plan.push({
        gameId: 0,
        payload: { ...payload, is_active: true, is_enabled: true, is_easy: false },
        difficulties: row.difficulties,
        aliases: row.aliases,
        diffChanged: true,
        aliasChanged: true,
        isNew: true,
      });
      continue;
    }

    const changed =
      String(current.vndb_id ?? '') !== row.vndbId ||
      current.title_cn !== row.titleCn ||
      Number(current.release_year) !== row.year ||
      String(current.company) !== row.company ||
      Boolean(current.is_r18) !== row.isR18 ||
      String(current.scenario_writer) !== row.scenario ||
      String(current.music_composer) !== row.music ||
      String(current.artist) !== row.artist ||
      String(current.voice_actor) !== row.voice ||
      String(current.tags ?? '') !== row.tags.join('、') ||
      Boolean(current.is_series) !== row.isSeries ||
      Number(current.length_minutes ?? 0) !== row.lengthMinutes ||
      Number(current.vote_count ?? 0) !== row.voteCount ||
      Number(current.bgm_score) !== row.score;
    if (changed) updated += 1;

    const gameId = Number(current.id);
    const diffSet = diffByGame.get(gameId);
    const diffChanged =
      (diffSet === undefined && row.difficulties.length > 0) ||
      (diffSet !== undefined &&
        (row.difficulties.length !== diffSet.size ||
          row.difficulties.some((k) => !diffSet.has(k))));
    if (diffChanged) diffReplaced += 1;

    const aliasSet = aliasByGame.get(gameId);
    const aliasChanged =
      (aliasSet === undefined && row.aliases.length > 0) ||
      (aliasSet !== undefined &&
        (row.aliases.length !== aliasSet.size ||
          row.aliases.some((a) => !aliasSet.has(a))));
    if (aliasChanged) aliasReplaced += 1;

    if (changed || diffChanged || aliasChanged) {
      plan.push({
        gameId,
        payload: changed ? payload : {},
        difficulties: diffChanged ? row.difficulties : [],
        aliases: aliasChanged ? row.aliases : [],
        diffChanged,
        aliasChanged,
        isNew: false,
      });
    }
  }

  console.log(`\n[import-all] 计划: 新增 ${inserted}, 更新 ${updated}, 难度替换 ${diffReplaced}, 别名替换 ${aliasReplaced}`);

  // ── 写库（单事务）──
  await db.transaction(async (trx) => {
    for (const item of plan) {
      let gameId = item.gameId;
      if (item.isNew) {
        const ids = await trx('game_titles').insert(item.payload);
        gameId = Number(ids[0]);
      } else if (Object.keys(item.payload).length > 0) {
        await trx('game_titles').where({ id: item.gameId }).update(item.payload);
      }
      if (item.isNew || item.diffChanged) {
        await trx('game_difficulties').where({ game_id: gameId }).delete();
        if (item.difficulties.length > 0) {
          await trx('game_difficulties').insert(
            item.difficulties.map((key) => ({ game_id: gameId, difficulty_key: key })),
          );
        }
      }
      if (item.isNew || item.aliasChanged) {
        await trx('game_aliases').where({ game_id: gameId }).delete();
        if (item.aliases.length > 0) {
          await trx('game_aliases').insert(
            item.aliases.map((alias) => ({ game_id: gameId, alias, type: '' })),
          );
        }
      }
    }
  });

  // ── 重建 staff_aliases（照搬 importStaffAliases 逻辑）──
  const { rows: staffRows, skipped } = buildStaffAliasRows(vndbDir);
  await db.transaction(async (trx) => {
    await trx('staff_aliases').delete();
    for (let i = 0; i < staffRows.length; i += 500) {
      await trx('staff_aliases').insert(staffRows.slice(i, i + 500));
    }
  });
  const staffCount = Number(
    (await db('staff_aliases').count<{ c: number }[]>({ c: '*' }))[0].c,
  );
  await invalidateCharacterClueCache();

  // ── 统计 ──
  const totalGames = Number((await db('game_titles').count<{ c: number }[]>({ c: '*' }))[0].c);
  const vndbCovered = rows.filter((r) => r.scenario || r.artist || r.music || r.voice).length;
  console.log(`\n[import-all] 完成:`);
  console.log(`  game_titles 新增 ${inserted} / 更新 ${updated}（总 ${totalGames} 部）`);
  console.log(`  难度替换 ${diffReplaced}，别名替换 ${aliasReplaced}`);
  console.log(`  staff_aliases: ${staffCount} 条（跳过 ${skipped} 条无名字名）`);
  console.log(`  CSV 内 VNDB staff 覆盖 ${vndbCovered} / ${rows.length}（四列均空 ${rows.length - vndbCovered}）`);

  await db.destroy();
}

run().catch((err) => {
  console.error('[import-all] 失败:', err);
  process.exit(1);
});
