import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initRedis, isRedisAvailable, redis, redisKey } from '../redis';
import { db } from '../db/knex';
import { ensureSchema } from '../db/schema';
import {
  createCustomPool,
  getGame,
  getPublicGameList,
  invalidateGameCache,
  isDifficultyAvailable,
  pickCachedTarget,
  pickFromCustomPool,
  refreshGameCache,
  searchCachedGames,
} from './playerCache';

const GAME_REVISION_KEY = 'games:revision:v1';

beforeAll(async () => {
  await ensureSchema();
  try {
    await initRedis();
  } catch {
    // Redis 不可用时跳过依赖 Redis 的用例
  }
});

afterAll(async () => {
  await db('game_titles').whereLike('title', 'cache-test-%').del();
});

describe('game cache invalidation', () => {
  it('does not touch the legacy SHA version key and bumps the revision key', async () => {
    if (!isRedisAvailable()) return;
    const client = redis()!;
    await client.set(redisKey('games:version'), '0123456789abcdef');
    await client.del(redisKey(GAME_REVISION_KEY));
    await expect(invalidateGameCache()).resolves.toBeUndefined();
    expect(await client.get(redisKey('games:version'))).toBe('0123456789abcdef');
    expect(await client.get(redisKey(GAME_REVISION_KEY))).toBe('1');
  });

  it('removes a disabled game before invalidation returns and changes the list version', async () => {
    const title = `cache-test-${Date.now()}`;
    const [row] = await db('game_titles').insert({
      title,
      title_cn: '',
      release_year: 2005,
      company: '测试会社',
      is_r18: false,
      bgm_score: 8.0,
      is_easy: false,
      is_active: true,
      is_enabled: true,
    }).returning('id');
    const id = Number(typeof row === 'object' ? row.id : row);

    await refreshGameCache();
    const before = await getPublicGameList();
    expect(before.games).toContainEqual({ id, title, titleCn: '', originalTitle: title, aliases: [] });

    await db('game_titles').where({ id }).update({ is_enabled: false });
    await invalidateGameCache();

    const after = await getPublicGameList();
    expect(after.version).not.toBe(before.version);
    expect(after.games).not.toContainEqual({ id, title, titleCn: '', originalTitle: title, aliases: [] });
  });

  it('refreshes a stale instance before serving the public list', async () => {
    if (!isRedisAvailable()) return;
    const title = `cache-test-cross-instance-${Date.now()}`;
    const [row] = await db('game_titles').insert({
      title,
      title_cn: '',
      release_year: 2006,
      company: '测试会社',
      is_r18: false,
      bgm_score: 7.5,
      is_easy: false,
      is_active: true,
      is_enabled: true,
    }).returning('id');
    const id = Number(typeof row === 'object' ? row.id : row);

    await refreshGameCache();
    expect((await getPublicGameList()).games).toContainEqual({ id, title, titleCn: '', originalTitle: title, aliases: [] });

    await db('game_titles').where({ id }).update({ is_enabled: false });
    await redis()!.incr(redisKey(GAME_REVISION_KEY));

    expect((await getPublicGameList()).games).not.toContainEqual({ id, title, titleCn: '', originalTitle: title, aliases: [] });
  });

  it('serves targets from the beginner difficulty pool and exposes game lookups', async () => {
    const title = `cache-test-beginner-${Date.now()}`;
    const [row] = await db('game_titles').insert({
      title,
      title_cn: '',
      release_year: 2004,
      company: '测试会社',
      is_r18: false,
      bgm_score: 8.8,
      is_easy: true,
      is_active: true,
      is_enabled: true,
    }).returning('id');
    const id = Number(typeof row === 'object' ? row.id : row);
    await db('game_difficulties').insert({ game_id: id, difficulty_key: 'beginner' });

    await refreshGameCache();

    expect(isDifficultyAvailable('beginner')).toBe(true);
    const picked = pickCachedTarget('beginner');
    expect(picked?.difficulties).toContain('beginner');
    expect(getGame(id)?.title).toBe(title);
    expect(searchCachedGames(title.slice(0, 10), 5).map((game) => game.id)).toContain(id);
  });

  it('keeps the custom guess limit on the generated pool', async () => {
    const title = `cache-test-custom-${Date.now()}`;
    const [row] = await db('game_titles').insert({
      title,
      title_cn: '',
      release_year: 2099,
      company: '测试会社',
      is_r18: false,
      bgm_score: 8.0,
      is_easy: false,
      is_active: true,
      is_enabled: true,
    }).returning('id');
    const id = Number(typeof row === 'object' ? row.id : row);
    await refreshGameCache();

    const { poolKey, count } = createCustomPool({ yearFrom: 2099, yearTo: 2099, maxGuesses: 5 });
    expect(count).toBeGreaterThan(0);
    const picked = pickFromCustomPool(poolKey);
    expect(picked?.game.id).toBe(id);
    expect(picked?.maxGuesses).toBe(5);
  });
});
