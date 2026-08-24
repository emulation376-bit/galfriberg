import { describe, expect, it } from 'vitest';
import {
  createOrResumeSingleGame,
  deleteSingleGame,
  loadSingleGame,
  saveSingleGame,
} from './singleGameStore';
import { initRedis, isRedisAvailable, redis, redisKey } from '../redis';


async function tryInitRedis(): Promise<boolean> {
  try {
    await initRedis();
  } catch {
    return false;
  }
  return isRedisAvailable();
}
describe('singleGameStore', () => {
  it('falls back to an in-memory store when Redis is unavailable', async () => {
    if (await tryInitRedis()) return;
    const identityKey = `g:mem-${Date.now()}`;
    const created = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetGameId: 1,
      maxGuesses: 8,
    });
    expect(created.id).toBeTruthy();

    const restored = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetGameId: 3,
      maxGuesses: 8,
    });
    expect(restored.id).toBe(created.id);
    expect(restored.targetGameId).toBe(1);

    await deleteSingleGame(restored);
    expect(await loadSingleGame(restored.id, identityKey)).toBeNull();
  });

  it('restores the same active game and guesses until it is explicitly deleted', async () => {
    if (!(await tryInitRedis())) return;
    const identityKey = `g:single-resume-${Date.now()}`;
    const created = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetGameId: 1,
      maxGuesses: 8,
    });
    created.guesses.push({ gameId: 2, title: 'test' } as any);
    await saveSingleGame(created);
    expect(await redis()!.zScore(redisKey('presence:single'), created.id)).not.toBeNull();

    const restored = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetGameId: 3,
      maxGuesses: 8,
    });
    expect(restored.id).toBe(created.id);
    expect(restored.targetGameId).toBe(1);
    expect(restored.guesses).toEqual(created.guesses);

    await deleteSingleGame(restored);
    expect(await loadSingleGame(restored.id, identityKey)).toBeNull();
    expect(await redis()!.zScore(redisKey('presence:single'), restored.id)).toBeNull();
  });

  it('removes legacy games once last activity is older than thirty minutes', async () => {
    if (!(await tryInitRedis())) return;
    const identityKey = `g:single-stale-${Date.now()}`;
    const created = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'normal',
      targetGameId: 1,
      maxGuesses: 8,
    });
    created.lastActiveAt = Date.now() - 1_801_000;
    await redis()!.set(
      redisKey(`single:game:${created.id}`),
      JSON.stringify(created),
      { EX: 1800 }
    );

    expect(await loadSingleGame(created.id, identityKey)).toBeNull();
    expect(await redis()!.get(redisKey(`single:active:${identityKey}:normal`))).toBeNull();
    expect(await redis()!.zScore(redisKey('presence:single'), created.id)).toBeNull();
  });
});
