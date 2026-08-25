/**
 * 删除缺失至少一个目标 trait 大类的角色。
 *
 * 目标大类来自当前 character_traits 的 5 个保留组：
 * Hair(i1) / Eyes(i35) / Body(i36) / Clothes(i37) / Role(i40)。
 * 删除前会自动备份 SQLite，删除操作放在事务中。
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';
import { config } from '../config';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGET_GROUPS = ['i1', 'i35', 'i36', 'i37', 'i40'];

function backupSqlite(): string | null {
  if (config.dbClient !== 'sqlite') return null;
  const file = path.isAbsolute(config.dbUrl)
    ? config.dbUrl
    : path.resolve(__dirname, '../..', config.dbUrl);
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = path.join(
    REPO_ROOT,
    '.devlogs',
    `csgofriberg.sqlite3.bak_prune_missing_traits_${stamp}`
  );
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(file, bak);
  return bak;
}

async function findMissingCharacterIds(): Promise<string[]> {
  const conditions = TARGET_GROUPS.map(
    () =>
      'not exists (select 1 from character_traits t where t.character_id = c.id and t.group_id = ?)'
  ).join(' or ');
  const rows = await db.raw(`select id from characters c where ${conditions}`, TARGET_GROUPS);
  return (rows as Array<{ id: string }>).map((row) => String(row.id));
}

async function main(): Promise<void> {
  await ensureSchema();
  const ids = await findMissingCharacterIds();
  console.log(`[prune-missing-traits] 待删除角色: ${ids.length}`);
  if (ids.length === 0) {
    console.log('[prune-missing-traits] 没有需要删除的角色');
    await db.destroy();
    return;
  }

  const targetRefs = await db('character_games')
    .whereIn('target_character_id', ids)
    .count<{ c: number }[]>({ c: '*' });
  const targetCount = Number(targetRefs[0]?.c ?? 0);
  if (targetCount > 0) {
    throw new Error(`存在 ${targetCount} 条 character_games.target_character_id 引用，中止删除`);
  }

  const bak = backupSqlite();
  if (bak) console.log(`[prune-missing-traits] 备份 -> ${bak}`);

  const before = Number(
    (await db('characters').count<{ c: number }[]>({ c: '*' }))[0].c
  );

  await db.transaction(async (trx) => {
    await trx('character_games')
      .whereIn('first_guess_character_id', ids)
      .update({ first_guess_character_id: null });
    await trx('character_aliases').whereIn('character_id', ids).delete();
    await trx('character_names').whereIn('character_id', ids).delete();
    await trx('character_traits').whereIn('character_id', ids).delete();
    await trx('character_voice_actors').whereIn('character_id', ids).delete();
    await trx('character_game_appearances').whereIn('character_id', ids).delete();
    await trx('character_mzh_fields').whereIn('character_id', ids).delete();
    await trx('game_characters').whereIn('character_id', ids).delete();
    await trx('characters').whereIn('id', ids).delete();
  });

  const after = Number(
    (await db('characters').count<{ c: number }[]>({ c: '*' }))[0].c
  );
  console.log(`[prune-missing-traits] 完成: 角色 ${before} -> ${after}，删除 ${before - after}`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[prune-missing-traits] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
