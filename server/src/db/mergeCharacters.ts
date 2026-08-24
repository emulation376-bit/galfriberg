import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';
import { invalidateCharacterClueCache } from '../services/characterClueCache';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_MERGES = path.join(REPO_ROOT, 'scripts', 'character_merges.json');

type MergeMap = Record<string, string[]>;

function loadMerges(file: string): MergeMap {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as MergeMap;
  const out: MergeMap = {};
  for (const [canonical, sources] of Object.entries(raw)) {
    out[canonical] = [...new Set(sources.map((id) => String(id)))].filter((id) => id !== canonical);
  }
  return out;
}

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

/** 把 source 的关系行迁到 canonical；canonical 已有同键行时保留 canonical。 */
async function mergeRows(
  trx: any,
  table: string,
  source: string,
  canonical: string,
  pkKeys: string[]
): Promise<number> {
  const rows = await trx(table).where({ character_id: source });
  let moved = 0;
  for (const row of rows) {
    const key = pick(row, pkKeys);
    const existing = await trx(table).where({ character_id: canonical, ...key }).first();
    if (existing) {
      await trx(table).where({ character_id: source, ...key }).del();
    } else {
      await trx(table).where({ character_id: source, ...key }).update({ character_id: canonical });
      moved += 1;
    }
  }
  return moved;
}

async function mergeGroup(trx: any, canonical: string, sources: string[]): Promise<void> {
  const canonicalRow = await trx('characters').where({ id: canonical }).first();
  if (!canonicalRow) throw new Error(`MISSING_CANONICAL: ${canonical}`);
  for (const source of sources) {
    const sourceRow = await trx('characters').where({ id: source }).first();
    if (!sourceRow) throw new Error(`MISSING_SOURCE: ${source}`);

    await mergeRows(trx, 'character_names', source, canonical, ['lang']);
    await mergeRows(trx, 'character_aliases', source, canonical, ['spoil', 'name']);
    await mergeRows(trx, 'character_traits', source, canonical, ['trait_id']);
    await mergeRows(trx, 'character_voice_actors', source, canonical, ['staff_id']);
    await mergeRows(trx, 'game_characters', source, canonical, ['game_id']);
    await mergeRows(trx, 'character_game_appearances', source, canonical, ['vndb_vid']);

    const canonicalMzh = await trx('character_mzh_fields').where({ character_id: canonical }).first();
    const sourceMzh = await trx('character_mzh_fields').where({ character_id: source }).first();
    if (sourceMzh) {
      if (canonicalMzh) {
        await trx('character_mzh_fields').where({ character_id: source }).del();
      } else {
        await trx('character_mzh_fields').where({ character_id: source }).update({ character_id: canonical });
      }
    }

    await trx('character_games').where({ target_character_id: source }).update({ target_character_id: canonical });
    await trx('character_games').where({ first_guess_character_id: source }).update({ first_guess_character_id: canonical });

    const fields: string[] = [
      'name_cn', 'image', 'sex', 'surname', 'given_name', 'birthday', 'height', 'age',
    ];
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      if (canonicalRow[field] == null && sourceRow[field] != null) updates[field] = sourceRow[field];
    }
    if (Object.keys(updates).length) {
      await trx('characters').where({ id: canonical }).update(updates);
    }
    await trx('characters').where({ id: source }).del();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mergesPath = args.includes('--merges')
    ? args[args.indexOf('--merges') + 1]
    : DEFAULT_MERGES;
  const merges = loadMerges(mergesPath);
  const groups = Object.entries(merges);
  if (!groups.length) throw new Error('EMPTY_MERGE_MAP');

  await ensureSchema();
  await db.transaction(async (trx) => {
    for (const [canonical, sources] of groups) {
      await mergeGroup(trx, canonical, sources);
    }
  });
  await invalidateCharacterClueCache();
  console.log(`[merge-characters] 完成: ${groups.length} 组，合并源角色 ${groups.reduce((sum, [, s]) => sum + s.length, 0)} 个 -> ${groups.length} 个保留角色`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[merge-characters] 合并失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
