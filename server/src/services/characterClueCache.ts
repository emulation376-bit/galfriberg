import { Knex } from 'knex';
import { db } from '../db/knex';
import { redis, redisKey, redisPublisher, redisSubscriber } from '../redis';
import {
  CharacterClue,
  CharacterGameClue,
  CharacterNameClue,
  CharacterTraitClue,
  CharacterVoiceActorClue,
  loadCharacterClue,
} from './characterClues';

const INVALIDATE_CHANNEL = redisKey('characters:invalidate');
const VERSION_KEY = redisKey('characters:revision:v1');
const REFRESH_DEBOUNCE_MS = 100;

let cluesById = new Map<string, CharacterClue>();
let refreshPromise: Promise<void> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshGeneration = 0;
let pendingVersion: string | null = null;

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** 一次性加载全部角色 clue，避免逐角色 N+1 查询。 */
export async function buildCharacterClueMap(
  instance: Knex = db
): Promise<Map<string, CharacterClue>> {
  const [characterRows, nameRows, traitRows, voiceActorRows, appearanceRows] = await Promise.all([
    instance('characters').select(
      'id',
      'name_cn',
      'surname',
      'given_name',
      'image',
      'ymgal_image',
      'sex',
      'birthday',
      'height',
      'age'
    ),
    instance('character_names').select('character_id', 'lang', 'name', 'latin'),
    instance('character_traits').select(
      'character_id',
      'trait_id',
      'trait_name',
      'group_id',
      'group_name'
    ),
    instance('character_voice_actors').select('character_id', 'staff_id', 'name'),
    instance('character_game_appearances as cga')
      .leftJoin('game_titles as gt', 'gt.id', 'cga.game_id')
      .select(
        'cga.character_id',
        'cga.game_id',
        'cga.title',
        'cga.title_cn',
        'cga.release_date',
        'cga.bgm_score',
        'gt.company as company'
      ),
  ]);

  const namesByCharacter = new Map<string, CharacterNameClue[]>();
  for (const row of nameRows) {
    const characterId = String(row.character_id);
    if (!namesByCharacter.has(characterId)) namesByCharacter.set(characterId, []);
    namesByCharacter.get(characterId)!.push({
      lang: String(row.lang),
      name: String(row.name),
      latin: row.latin ? String(row.latin) : null,
    });
  }
  for (const names of namesByCharacter.values()) {
    names.sort((a, b) => a.lang.localeCompare(b.lang, 'en'));
  }

  const traitsByCharacter = new Map<string, CharacterTraitClue[]>();
  for (const row of traitRows) {
    const characterId = String(row.character_id);
    if (!traitsByCharacter.has(characterId)) traitsByCharacter.set(characterId, []);
    traitsByCharacter.get(characterId)!.push({
      traitId: String(row.trait_id),
      traitName: String(row.trait_name),
      groupId: String(row.group_id),
      groupName: String(row.group_name),
    });
  }
  for (const traits of traitsByCharacter.values()) {
    traits.sort((a, b) =>
      a.groupName.localeCompare(b.groupName, 'zh-CN')
      || a.traitName.localeCompare(b.traitName, 'zh-CN')
    );
  }

  const voiceActorsByCharacter = new Map<string, CharacterVoiceActorClue[]>();
  for (const row of voiceActorRows) {
    const characterId = String(row.character_id);
    if (!voiceActorsByCharacter.has(characterId)) voiceActorsByCharacter.set(characterId, []);
    voiceActorsByCharacter.get(characterId)!.push({
      staffId: String(row.staff_id),
      name: String(row.name),
    });
  }
  for (const actors of voiceActorsByCharacter.values()) {
    actors.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  const gamesByCharacter = new Map<string, CharacterGameClue[]>();
  for (const row of appearanceRows) {
    const characterId = String(row.character_id);
    if (!gamesByCharacter.has(characterId)) gamesByCharacter.set(characterId, []);
    gamesByCharacter.get(characterId)!.push({
      gameId: row.game_id != null ? Number(row.game_id) : null,
      title: String(row.title ?? ''),
      titleCn: String(row.title_cn ?? ''),
      company: row.company ? String(row.company) : '',
      releaseDate: row.release_date ? String(row.release_date) : null,
      bgmScore: Number(row.bgm_score) || 0,
      difficulties: [],
    });
  }
  for (const games of gamesByCharacter.values()) {
    games.sort(
      (a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')
        || a.title.localeCompare(b.title, 'zh-CN')
    );
  }

  const clues = new Map<string, CharacterClue>();
  for (const character of characterRows) {
    const characterId = String(character.id);
    const games = gamesByCharacter.get(characterId) ?? [];
    const primary = games[0] ?? null;
    clues.set(characterId, {
      id: characterId,
      nameCn: character.name_cn ? String(character.name_cn) : null,
      surname: character.surname ? String(character.surname) : null,
      givenName: character.given_name ? String(character.given_name) : null,
      image: character.image ? String(character.image) : null,
      ymgal_image: character.ymgal_image ? String(character.ymgal_image) : null,
      sex: character.sex ? String(character.sex) : null,
      birthday: numberOrNull(character.birthday),
      height: numberOrNull(character.height),
      age: numberOrNull(character.age),
      names: namesByCharacter.get(characterId) ?? [],
      traits: traitsByCharacter.get(characterId) ?? [],
      voiceActors: voiceActorsByCharacter.get(characterId) ?? [],
      games,
      bgmScore: primary?.bgmScore ?? null,
      difficulties: primary?.difficulties ?? [],
    });
  }
  return clues;
}

function scheduleRefresh(): void {
  refreshGeneration += 1;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshCharacterClueCache().catch((err) =>
      console.error('[characters] refresh failed', err)
    );
  }, REFRESH_DEBOUNCE_MS);
  refreshTimer.unref?.();
}

export async function refreshCharacterClueCache(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let appliedGeneration = -1;
    while (appliedGeneration !== refreshGeneration) {
      const requestedGeneration = refreshGeneration;
      cluesById = await buildCharacterClueMap();
      pendingVersion = null;
      appliedGeneration = requestedGeneration;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function initCharacterClueCache(): Promise<void> {
  const client = redis();
  if (client) {
    await client.set(VERSION_KEY, '1', { NX: true });
    const subscriber = redisSubscriber();
    if (subscriber) await subscriber.subscribe(INVALIDATE_CHANNEL, scheduleRefresh);
  }
  await refreshCharacterClueCache();
}

export function getCharacterClue(id: string): CharacterClue | undefined {
  return cluesById.get(id);
}

/** 优先命中预载缓存；缓存未初始化时回退单角色查询。 */
export async function loadCharacterClueCached(
  characterId: string
): Promise<CharacterClue | null> {
  return getCharacterClue(characterId) ?? loadCharacterClue(characterId);
}

/** 角色数据导入后调用：仅在有 Redis 连接时做跨实例失效，独立导入进程可安全忽略。 */
export async function invalidateCharacterClueCache(): Promise<void> {
  const client = redis();
  if (!client) return;
  let nextVersion = String(Date.now());
  try {
    nextVersion = String(await client.incr(VERSION_KEY));
  } catch (err) {
    console.warn(
      '[characters] cache revision update failed',
      err instanceof Error ? err.message : err
    );
  }
  pendingVersion = nextVersion;
  refreshGeneration += 1;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  await refreshCharacterClueCache();
  try {
    await redisPublisher()?.publish(INVALIDATE_CHANNEL, nextVersion);
  } catch (err) {
    console.warn(
      '[characters] cache invalidation notification failed',
      err instanceof Error ? err.message : err
    );
  }
}
