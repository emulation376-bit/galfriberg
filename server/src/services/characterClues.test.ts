import knex, { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema';
import { loadCharacterClue } from './characterClues';

const instances: Knex[] = [];

function createInstance(): Knex {
  const instance = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  instances.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.destroy()));
});

describe('loadCharacterClue', () => {
  it('assembles base info, multi-tag traits, and unified game bgm/difficulty', async () => {
    const instance = createInstance();
    await ensureSchema(instance);

    await instance('game_titles').insert({
      id: 1,
      title: 'Ever17 -the out of infinity-',
      title_cn: '时空轮回',
      release_year: 2002,
      company: 'KID',
      is_r18: false,
      scenario_writer: '',
      music_composer: '',
      artist: '',
      voice_actor: '',
      bgm_score: 8.6,
      is_active: true,
      is_enabled: true,
      is_series: false,
      length_minutes: 1200,
    });
    await instance('game_difficulties').insert([
      { game_id: 1, difficulty_key: 'normal' },
      { game_id: 1, difficulty_key: 'easy' },
    ]);
    await instance('characters').insert({
      id: 'c1',
      image: 'ch1',
      sex: 'f',
      birthday: 920,
      height: 160,
      age: 17,
    });
    await instance('character_names').insert([
      { character_id: 'c1', lang: 'ja', name: '茜崎空', latin: null },
      { character_id: 'c1', lang: 'en', name: 'Sora Akanezaki', latin: null },
    ]);
    await instance('character_traits').insert([
      { character_id: 'c1', trait_id: 'i6', trait_name: 'Brown', group_id: 'i1', group_name: 'Hair' },
      { character_id: 'c1', trait_id: 'i110', trait_name: 'Blue', group_id: 'i35', group_name: 'Eyes' },
    ]);
    await instance('game_characters').insert({
      game_id: 1,
      character_id: 'c1',
      role: 'primary',
      spoil: 0,
      vndb_vid: 'v38',
    });
    await instance('character_game_appearances').insert({
      character_id: 'c1',
      vndb_vid: 'v38',
      role: 'primary',
      spoil: 0,
      game_id: 1,
      title: 'Ever17 -the out of infinity-',
      title_cn: '时空轮回',
      release_date: '2002-04-25',
      bgm_score: 8.6,
    });

    const clue = await loadCharacterClue('c1', instance);
    expect(clue).not.toBeNull();
    expect(clue?.image).toBe('ch1');
    expect(clue?.sex).toBe('f');
    expect(clue?.birthday).toBe(920);
    expect(clue?.height).toBe(160);
    expect(clue?.age).toBe(17);
    expect(clue?.names.map((name) => name.lang)).toEqual(['en', 'ja']);
    expect(clue?.traits).toHaveLength(2);
    expect(clue?.bgmScore).toBe(8.6);
    expect(clue?.difficulties).toEqual([]);
    expect(clue?.games[0]).toMatchObject({
      gameId: 1,
      title: 'Ever17 -the out of infinity-',
      titleCn: '时空轮回',
      releaseDate: '2002-04-25',
      bgmScore: 8.6,
      difficulties: [],
    });
  });

  it('returns null for missing characters', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    await expect(loadCharacterClue('c999', instance)).resolves.toBeNull();
  });
});
