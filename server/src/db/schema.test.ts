import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from './schema';
import { DIFFICULTY_LEVELS } from '../difficulties';
import { userNameFromUsername } from '../services/identityDisplay';

const instances: ReturnType<typeof knex>[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.destroy()));
});

function createInstance() {
  const instance = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  instances.push(instance);
  return instance;
}

describe('galgame schema', () => {
  it('creates all tables and difficulty seed rows, and is idempotent', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    await ensureSchema(instance);

    for (const table of [
      'users', 'api_tokens', 'app_migrations', 'game_titles', 'difficulty_levels',
      'game_difficulties', 'games', 'match_records', 'match_players', 'announcements',
      'characters', 'character_names', 'character_aliases', 'game_characters', 'character_traits', 'character_voice_actors', 'character_game_appearances',
      'character_mzh_fields', 'character_games',
    ]) {
      expect(await instance.schema.hasTable(table), table).toBe(true);
    }

    const difficultyRows = await instance('difficulty_levels').select('key', 'sort_order', 'is_enabled');
    expect(difficultyRows).toHaveLength(DIFFICULTY_LEVELS.length);
    expect(difficultyRows).toEqual(
      DIFFICULTY_LEVELS.map((difficulty) => ({
        key: difficulty.key,
        sort_order: difficulty.sortOrder,
        is_enabled: difficulty.isEnabled ? 1 : 0,
      }))
    );
  });
  it('creates a game title and its difficulty memberships', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    const [row] = await instance('game_titles')
      .insert({
        title: 'CLANNAD',
        title_cn: 'CLANNAD',
        release_year: 2004,
        company: 'Key',
        is_r18: false,
        scenario_writer: '麻枝准、涼元悠一',
        music_composer: '折戸伸治',
        artist: '樋上いたる',
        bgm_score: 8.6,
      })
      .returning('id');
    const id = Number(typeof row === 'object' ? row.id : row);

    await instance('game_difficulties').insert([
      { game_id: id, difficulty_key: 'beginner' },
      { game_id: id, difficulty_key: 'normal' },
    ]);

    expect(
      await instance('game_difficulties').where({ game_id: id }).pluck('difficulty_key')
    ).toEqual(expect.arrayContaining(['beginner', 'normal']));
    const game = await instance('game_titles').where({ id }).first();
    expect(game.scenario_writer).toBe('麻枝准、涼元悠一');
    expect(Number(game.bgm_score)).toBeCloseTo(8.6);
  });

  it('adds token_version/display_id/leaderboard_hidden to an existing users table', async () => {
    const instance = createInstance();
    await instance.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username', 32).notNullable().unique();
      table.string('password_hash', 128).notNullable();
      table.string('role', 16).notNullable().defaultTo('user');
      table.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
    await instance('users').insert({ username: 'legacy-user', password_hash: 'test', role: 'user' });

    await ensureSchema(instance);

    expect(await instance.schema.hasColumn('users', 'token_version')).toBe(true);
    expect(await instance.schema.hasColumn('users', 'display_id')).toBe(true);
    expect(await instance.schema.hasColumn('users', 'leaderboard_hidden')).toBe(true);
    const user = await instance('users').where({ username: 'legacy-user' }).first();
    expect(user.token_version).toBe(0);
    expect(user.leaderboard_hidden).toBe(0);
    expect(user.display_id).toBe(userNameFromUsername('legacy-user'));
  });
  it('adds the popup flag to an existing announcements table', async () => {
    const instance = createInstance();
    await instance.schema.createTable('announcements', (table) => {
      table.increments('id').primary();
      table.string('title', 128).notNullable();
      table.text('content').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
    await instance('announcements').insert({ title: 'legacy', content: 'content' });

    await ensureSchema(instance);

    expect(await instance.schema.hasColumn('announcements', 'is_popup')).toBe(true);
    expect((await instance('announcements').where({ title: 'legacy' }).first()).is_popup).toBe(0);
  });

  it('adds the voice_actor column to an existing game_titles table', async () => {
    const instance = createInstance();
    await instance.schema.createTable('game_titles', (table) => {
      table.increments('id').primary();
      table.string('title', 128).notNullable().unique();
      table.string('title_cn', 128).notNullable().defaultTo('');
      table.integer('release_year').notNullable().defaultTo(0);
      table.string('company', 128).notNullable().defaultTo('');
      table.boolean('is_r18').notNullable().defaultTo(false);
      table.string('scenario_writer', 255).notNullable().defaultTo('');
      table.string('music_composer', 255).notNullable().defaultTo('');
      table.string('artist', 255).notNullable().defaultTo('');
      table.decimal('bgm_score', 3, 1).notNullable().defaultTo(0);
      table.boolean('is_easy').notNullable().defaultTo(false);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
    await instance('game_titles').insert({ title: 'legacy', release_year: 2002 });

    await ensureSchema(instance);

    expect(await instance.schema.hasColumn('game_titles', 'voice_actor')).toBe(true);
    expect(
      (await instance('game_titles').where({ title: 'legacy' }).first()).voice_actor
    ).toBe('');
  });

  it('creates single-player games referencing game titles', async () => {
    const instance = createInstance();
    await ensureSchema(instance);
    const [gameRow] = await instance('game_titles')
      .insert({ title: 'Ever17 -the out of infinity-', release_year: 2002 })
      .returning('id');
    const gameId = Number(typeof gameRow === 'object' ? gameRow.id : gameRow);

    await instance('games')
      .insert({
        session_id: 'legacy-first-guess',
        guest_key: 'legacy-guest',
        target_game_id: gameId,
        mode: 'normal',
        guesses: JSON.stringify([{ gameId }]),
        first_guess_game_id: null,
        status: 'won',
        guess_count: 1,
        finished_at: instance.fn.now(),
      })
      .returning('id');
    const game = await instance('games').where({ session_id: 'legacy-first-guess' }).first();
    expect(game.target_game_id).toBe(gameId);
    expect(game.first_guess_game_id).toBe(null);
    expect(game.status).toBe('won');
  });
});
