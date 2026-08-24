import knex, { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema';
import { buildCharacterClueMap } from './characterClueCache';

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

describe('characterClueCache', () => {
  it('preloads the same nested clue shape as the per-character loader', async () => {
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
    await instance('characters').insert({
      id: 'c1',
      name_cn: '茜崎空',
      surname: '茜崎',
      given_name: '空',
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
    await instance('character_voice_actors').insert({
      character_id: 'c1',
      staff_id: 's1',
      name: '雪野五月',
    });
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

    const clues = await buildCharacterClueMap(instance);
    const clue = clues.get('c1');
    expect(clue).toMatchObject({
      id: 'c1',
      nameCn: '茜崎空',
      surname: '茜崎',
      givenName: '空',
      sex: 'f',
      birthday: 920,
      height: 160,
      age: 17,
      bgmScore: 8.6,
    });
    expect(clue?.names.map((name) => name.lang)).toEqual(['en', 'ja']);
    expect(clue?.traits).toHaveLength(2);
    expect(clue?.voiceActors).toEqual([{ staffId: 's1', name: '雪野五月' }]);
    expect(clue?.games[0]).toMatchObject({
      gameId: 1,
      title: 'Ever17 -the out of infinity-',
      titleCn: '时空轮回',
      company: 'KID',
      releaseDate: '2002-04-25',
      bgmScore: 8.6,
    });
    expect(clues.has('c999')).toBe(false);
  });
});
