import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';
import { invalidateCharacterClueCache } from '../services/characterClueCache';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const YMGAL_GAME_FILE = path.join(REPO_ROOT, 'exported_data', 'game.jsonl');
const YMGAL_CHARACTER_FILE = path.join(REPO_ROOT, 'exported_data', 'character.jsonl');
const YMGAL_RELATION_FILE = path.join(REPO_ROOT, 'exported_data', 'game_character_relation.jsonl');

function normalizeTitle(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function readJsonLines(filePath: string): Array<Record<string, any>> {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const rows: Array<Record<string, any>> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

function addNameKey(map: Map<string, Array<{ id: string; kind: number }>>, key: string, id: string, kind: number): void {
  const normalized = normalizeTitle(key);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized)!.push({ id, kind });
}

async function main(): Promise<void> {
  await ensureSchema();

  const [games, gameCharacters, characterNames, characterAliases, charactersWithCn] = await Promise.all([
    db('game_titles').select('id', 'title', 'title_cn'),
    db('game_characters').select('game_id', 'character_id'),
    db('character_names').select('character_id', 'name'),
    db('character_aliases').select('character_id', 'name'),
    db('characters').select('id', 'name_cn', 'ymgal_image'),
  ]);

  const localNamesByCharacter = new Map<string, string[]>();
  for (const row of charactersWithCn) {
    if (row.name_cn) {
      const id = String(row.id);
      if (!localNamesByCharacter.has(id)) localNamesByCharacter.set(id, []);
      localNamesByCharacter.get(id)!.push(String(row.name_cn));
    }
  }
  for (const row of characterNames) {
    const id = String(row.character_id);
    if (!localNamesByCharacter.has(id)) localNamesByCharacter.set(id, []);
    localNamesByCharacter.get(id)!.push(String(row.name));
  }
  for (const row of characterAliases) {
    const id = String(row.character_id);
    if (!localNamesByCharacter.has(id)) localNamesByCharacter.set(id, []);
    localNamesByCharacter.get(id)!.push(String(row.name));
  }
  for (const names of localNamesByCharacter.values()) {
    const seen = new Set<string>();
    names.splice(0, names.length, ...names.filter((name) => {
      const normalized = normalizeTitle(name);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }));
  }

  const ymgalGames = readJsonLines(YMGAL_GAME_FILE);
  const ymgalCharacters = readJsonLines(YMGAL_CHARACTER_FILE);
  const relations = readJsonLines(YMGAL_RELATION_FILE);

  const gidsByName = new Map<string, Array<{ id: string; kind: number }>>();
  for (const game of ymgalGames) {
    const gid = String(game.gid);
    addNameKey(gidsByName, game.name ?? '', gid, 1);
    addNameKey(gidsByName, game.chinese_name ?? '', gid, 1);
    for (const extension of game.extension_name ?? []) {
      addNameKey(gidsByName, extension.name ?? '', gid, 1);
    }
  }

  const gidsByLocalGame = new Map<number, Set<string>>();
  for (const game of games) {
    const gids = new Set<string>();
    const keys = [game.title, game.title_cn];
    for (const key of keys) {
      const normalized = normalizeTitle(String(key ?? ''));
      for (const item of gidsByName.get(normalized) ?? []) gids.add(item.id);
    }
    gidsByLocalGame.set(Number(game.id), gids);
  }

  const characterById = new Map<string, Record<string, any>>();
  for (const character of ymgalCharacters) {
    characterById.set(String(character.cid), character);
  }

  const cidsByName = new Map<string, Array<{ id: string; kind: number }>>();
  for (const character of ymgalCharacters) {
    const cid = String(character.cid);
    addNameKey(cidsByName, character.name ?? '', cid, 3);
    addNameKey(cidsByName, character.chinese_name ?? '', cid, 4);
    for (const extension of character.extension_name ?? []) {
      addNameKey(cidsByName, extension.name ?? '', cid, 1);
    }
  }

  const gidsByCid = new Map<string, Set<string>>();
  for (const relation of relations) {
    const gid = String(relation.gid);
    const cid = String(relation.cid);
    if (!gidsByCid.has(cid)) gidsByCid.set(cid, new Set());
    gidsByCid.get(cid)!.add(gid);
  }

  const bestByCharacter = new Map<string, { image: string; score: number }>();
  for (const row of gameCharacters) {
    const gameId = Number(row.game_id);
    const characterId = String(row.character_id);
    const gameGids = gidsByLocalGame.get(gameId);
    if (!gameGids || !gameGids.size) continue;
    const localNames = localNamesByCharacter.get(characterId) ?? [];
    const localCandidates = localNames.map((name) => normalizeTitle(name)).filter(Boolean);
    let best: { image: string; score: number } | null = null;
    for (const localName of localCandidates) {
      for (const item of cidsByName.get(localName) ?? []) {
        const ymCharacterGids = gidsByCid.get(item.id);
        if (!ymCharacterGids || ![...ymCharacterGids].some((gid) => gameGids.has(gid))) continue;
        const ymCharacter = characterById.get(item.id);
        if (!ymCharacter?.main_img) continue;
        const score = item.kind
          + (ymCharacter.chinese_name ? 2 : 0)
          + (String(ymCharacter.main_img).endsWith('.webp') ? 1 : 0);
        if (!best || score > best.score) {
          best = { image: String(ymCharacter.main_img), score };
        }
      }
    }
    if (best && (!bestByCharacter.has(characterId) || best.score > bestByCharacter.get(characterId)!.score)) {
      bestByCharacter.set(characterId, best);
    }
  }

  const updates: Array<{ id: string; ymgal_image: string | null }> = [];
  for (const row of charactersWithCn) {
    const id = String(row.id);
    const best = bestByCharacter.get(id);
    const next = best?.image ?? null;
    if (next !== (row.ymgal_image ? String(row.ymgal_image) : null)) {
      updates.push({ id, ymgal_image: next });
    }
  }
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    await db.transaction(async (trx) => {
      for (const update of batch) {
        await trx('characters').where({ id: update.id }).update({ ymgal_image: update.ymgal_image });
      }
    });
  }

  console.log(`\n[ymgal-character-images] 完成:`);
  console.log(`  角色 ${charactersWithCn.length}，匹配到 YmGal 立绘 ${bestByCharacter.size}`);
  console.log(`  更新 ${updates.length} 条`);
  await invalidateCharacterClueCache();
  await db.destroy();
}

main().catch((err) => {
  console.error('[ymgal-character-images] 导入失败:', err);
  process.exit(1);
});
