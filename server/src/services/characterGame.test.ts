import knex, { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema';
import {
  compareCharacterClues,
  listCharacters,
  pickCharacterTarget,
} from './characterGame';
import { CharacterClue } from './characterClues';

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

function makeClue(id: string, surname: string | null, givenName: string | null): CharacterClue {
  return {
    id,
    nameCn: null,
    surname,
    givenName,
    image: null,
    sex: null,
    birthday: null,
    height: null,
    age: null,
    names: [],
    traits: [],
    voiceActors: [],
    games: [],
    bgmScore: null,
    difficulties: [],
  };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.destroy()));
});

async function seedCharacter(instance: Knex, id: string, name: string, bgmScore: number) {
  await instance('game_titles').insert({
    id: id === 'c1' ? 1 : 2,
    title: `Game ${id}`,
    title_cn: `作品 ${id}`,
    release_year: 2020,
    company: 'Studio',
    is_r18: false,
    scenario_writer: '',
    music_composer: '',
    artist: '',
    voice_actor: '',
    bgm_score: bgmScore,
    is_active: true,
    is_enabled: true,
    is_series: false,
    length_minutes: 300,
  });
  await instance('game_difficulties').insert({ game_id: id === 'c1' ? 1 : 2, difficulty_key: 'normal' });
  await instance('characters').insert({
    id,
    image: `ch${id}`,
    sex: 'f',
    birthday: 120,
    height: 158,
    age: 17,
  });
  await instance('character_names').insert({
    character_id: id,
    lang: 'ja',
    name,
    latin: null,
  });
  await instance('character_traits').insert({
    character_id: id,
    trait_id: `t${id}`,
    trait_name: `Tag ${id}`,
    group_id: 'i1',
    group_name: 'Hair',
  });
  await instance('game_characters').insert({
    game_id: id === 'c1' ? 1 : 2,
    character_id: id,
    role: 'primary',
    spoil: 0,
    vndb_vid: id === 'c1' ? 'v1' : 'v2',
  });
  await instance('character_game_appearances').insert({
    character_id: id,
    vndb_vid: id === 'c1' ? 'v1' : 'v2',
    role: 'primary',
    spoil: 0,
    game_id: id === 'c1' ? 1 : 2,
    title: `Game ${id}`,
    title_cn: `作品 ${id}`,
    release_date: id === 'c1' ? '2000-01-01' : '2001-01-01',
    bgm_score: bgmScore,
  });
}

describe('character game', () => {
  it('marks the name yellow when surname or given name matches', () => {
    const target = makeClue('c1', '远坂', '凛');
    expect(compareCharacterClues('c9', makeClue('c9', '远坂', '樱'), target).nameLevel).toBe('close');
    expect(compareCharacterClues('c9', makeClue('c9', '言峰', '凛'), target).nameLevel).toBe('close');
    expect(compareCharacterClues('c9', makeClue('c9', '言峰', '绮礼'), target).nameLevel).toBe('wrong');
    expect(compareCharacterClues('c1', target, target).nameLevel).toBe('correct');
  });

  it('marks each guessed work as matched or unmatched', () => {
    const target = makeClue('c270', '中津', '静流');
    target.games = [{
      gameId: 1,
      title: 'Rewrite',
      titleCn: 'Rewrite',
      company: 'Key',
      releaseDate: '2011-06-24',
      bgmScore: 8.6,
      difficulties: ['normal'],
    }];
    const guess = makeClue('c241', '神户', '小鸟');
    guess.games = [
      {
        gameId: 1,
        title: 'Rewrite',
        titleCn: 'Rewrite',
        company: 'Key',
        releaseDate: '2011-06-24',
        bgmScore: 8.6,
        difficulties: ['normal'],
      },
      {
        gameId: 2,
        title: 'Other',
        titleCn: 'Other',
        company: 'Key',
        releaseDate: '2012-01-01',
        bgmScore: 7.0,
        difficulties: ['normal'],
      },
    ];

    const feedback = compareCharacterClues('c241', guess, target);
    expect(feedback.works.parts).toEqual([
      { name: 'Rewrite', matched: true },
      { name: 'Other', matched: false },
    ]);
    expect(feedback.works.level).toBe('close');
  });

  it('lists characters with a display name', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    await seedCharacter(instance, 'c1', '茜崎空', 8.6);

    const list = await listCharacters(instance);
    expect(list).toContainEqual({
      id: 'c1',
      name: '茜崎空',
      names: expect.arrayContaining(['茜崎空']),
      firstGame: {
        title: 'Game c1',
        titleCn: '作品 c1',
        releaseDate: '2000-01-01',
      },
    });
  });

  it('picks a target from the difficulty pool', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    await seedCharacter(instance, 'c1', '茜崎空', 8.6);
    await seedCharacter(instance, 'c2', '古河渚', 7.9);

    const selected = await pickCharacterTarget(instance, 'normal');
    expect(['c1', 'c2']).toContain(selected.targetId);
    expect(selected.maxGuesses).toBe(8);
  });
});
