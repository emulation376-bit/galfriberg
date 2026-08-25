import { Knex } from 'knex';
import { db } from './knex';
import { ensureSchema } from './schema';
import { invalidateCached } from '../services/queryCache';
import gamesData from './seeds/games.json';
import charactersData from './seeds/characters.json';
import announcementsData from './seeds/announcements.json';

interface SeedGame {
  title: string;
  title_cn?: string;
  vndb_id?: string;
  release_year?: number;
  company?: string;
  is_r18?: boolean;
  scenario_writer?: string;
  music_composer?: string;
  artist?: string;
  voice_actor?: string;
  bgm_score?: number;
  difficulties?: string[];
  is_active?: boolean;
  is_enabled?: boolean;
  is_series?: boolean;
  length_minutes?: number;
  tags?: string[];
  aliases?: string[];
}

interface SeedCharacterData {
  characters: Array<{
    id: string;
    name_cn: string | null;
    surname: string | null;
    given_name: string | null;
    image: string | null;
    ymgal_image: string | null;
    sex: string | null;
    birthday: number | null;
    height: number | null;
    age: number | null;
  }>;
  names: Array<{ character_id: string; lang: string; name: string; latin: string | null }>;
  aliases: Array<{ character_id: string; name: string; latin: string | null; spoil: number }>;
  traits: Array<{
    character_id: string;
    trait_id: string;
    trait_name: string;
    group_id: string;
    group_name: string;
  }>;
  voice_actors: Array<{ character_id: string; staff_id: string; name: string }>;
  appearances: Array<{
    character_id: string;
    vndb_vid: string;
    role: string;
    spoil: number;
    title: string;
    title_cn: string;
    release_date: string | null;
    bgm_score: number;
  }>;
  game_characters: Array<{
    character_id: string;
    vndb_vid: string;
    role: string;
    spoil: number;
  }>;
}

export async function seedGamesIfEmpty(): Promise<void> {
  const row = await db('game_titles').count<{ c: number }[]>({ c: '*' });
  const count = Number(row[0].c);
  if (count > 0) return;
  const games = gamesData as SeedGame[];
  const rows = games.map((g) => ({
    title: g.title,
    title_cn: g.title_cn ?? '',
    ...(g.vndb_id ? { vndb_id: g.vndb_id } : {}),
    release_year: g.release_year ?? 0,
    company: g.company ?? '',
    is_r18: g.is_r18 ?? false,
    scenario_writer: g.scenario_writer ?? '',
    music_composer: g.music_composer ?? '',
    artist: g.artist ?? '',
    voice_actor: g.voice_actor ?? '',
    bgm_score: g.bgm_score ?? 0,
    is_active: g.is_active ?? true,
    is_enabled: g.is_enabled ?? true,
    is_series: g.is_series ?? false,
    length_minutes: g.length_minutes ?? 0,
    tags: (g.tags ?? []).join('、'),
  }));
  await db.batchInsert('game_titles', rows, 50);

  // 难度关联
  const saved = await db('game_titles').select('id', 'title');
  const idByTitle = new Map(saved.map((r) => [String(r.title), Number(r.id)]));
  // 别名关联
  const aliasRows = games.flatMap((g) => {
    const gameId = idByTitle.get(g.title);
    if (!gameId) return [];
    return (g.aliases ?? []).map((alias) => ({ game_id: gameId, alias, type: '' }));
  });
  for (let index = 0; index < aliasRows.length; index += 500) {
    await db('game_aliases').insert(aliasRows.slice(index, index + 500));
  }
  const memberships = games.flatMap((g) => {
    const gameId = idByTitle.get(g.title);
    if (!gameId) return [];
    return [...new Set(g.difficulties ?? ['normal'])].map((key) => ({
      game_id: gameId,
      difficulty_key: key,
    }));
  });
  for (let index = 0; index < memberships.length; index += 500) {
    await db('game_difficulties')
      .insert(memberships.slice(index, index + 500))
      .onConflict(['game_id', 'difficulty_key'])
      .ignore();
  }
  console.log(`[seed] 已导入 ${rows.length} 部作品`);
}

export async function seedCharactersIfEmpty(instance: Knex = db): Promise<void> {
  const row = await instance('characters').count<{ c: number }[]>({ c: '*' });
  if (Number(row[0].c) > 0) return;

  const data = charactersData as SeedCharacterData;
  await instance.transaction(async (trx) => {
    await trx.batchInsert('characters', data.characters, 100);
    await trx.batchInsert('character_names', data.names, 200);
    await trx.batchInsert('character_aliases', data.aliases, 200);
    await trx.batchInsert('character_traits', data.traits, 300);
    await trx.batchInsert('character_voice_actors', data.voice_actors, 200);

    const gameRows = await trx('game_titles')
      .select('id', 'vndb_id')
      .whereNotNull('vndb_id');
    const gameIdByVndb = new Map(
      gameRows.map((game) => [String(game.vndb_id), Number(game.id)])
    );

    const appearanceRows = data.appearances.map((appearance) => ({
      ...appearance,
      game_id: gameIdByVndb.get(appearance.vndb_vid) ?? null,
    }));
    await trx.batchInsert('character_game_appearances', appearanceRows, 300);

    const gameCharacterRows = data.game_characters.flatMap((relation) => {
      const gameId = gameIdByVndb.get(relation.vndb_vid);
      return gameId
        ? [{
          game_id: gameId,
          character_id: relation.character_id,
          role: relation.role,
          spoil: relation.spoil,
          vndb_vid: relation.vndb_vid,
        }]
        : [];
    });
    await trx.batchInsert('game_characters', gameCharacterRows, 300);
  });

  console.log(
    `[seed] 已导入角色 ${data.characters.length} 个，` +
    `特征 ${data.traits.length} 条，登场作品 ${data.appearances.length} 条`
  );
}

/** 公告种子：仅在公告表为空时导入（migrate 也会执行，避免生产库公告缺失） */
export async function seedAnnouncementsIfEmpty(): Promise<void> {
  const count = await db('announcements').count({ count: 'id' }).first();
  if (Number(count?.count ?? 0) > 0) return;
  const rows = (announcementsData as Array<{
    title: string;
    content: string;
    is_popup?: boolean;
  }>).map((item) => ({
    title: item.title,
    content: item.content,
    is_popup: item.is_popup ?? false,
  }));
  if (rows.length) {
    await db('announcements').insert(rows);
  }
  await invalidateCached('announcements');
  console.log(`[seed] 公告 ${rows.length} 条`);
}

export async function initDb(): Promise<void> {
  await ensureSchema();
  await seedGamesIfEmpty();
  await seedCharactersIfEmpty();
  await seedAnnouncementsIfEmpty();
}
