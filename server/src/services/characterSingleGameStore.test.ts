import { describe, expect, it } from 'vitest';
import {
  createOrResumeCharacterGame,
  deleteCharacterGame,
  loadCharacterGame,
} from './characterSingleGameStore';
import { initRedis, isRedisAvailable, redis, redisKey } from '../redis';

async function tryInitRedis(): Promise<boolean> {
  try {
    await initRedis();
  } catch {
    return false;
  }
  return isRedisAvailable();
}

describe('characterSingleGameStore', () => {
  it('falls back to an in-memory store and resumes the same active game', async () => {
    if (await tryInitRedis()) return;
    const identityKey = `g:char-mem-${Date.now()}`;
    const created = await createOrResumeCharacterGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'normal',
      targetCharacterId: 'c1',
      maxGuesses: 8,
    });
    expect(created.id).toBeTruthy();

    const restored = await createOrResumeCharacterGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'normal',
      targetCharacterId: 'c9',
      maxGuesses: 8,
    });
    expect(restored.id).toBe(created.id);
    expect(restored.targetCharacterId).toBe('c1');

    await deleteCharacterGame(restored);
    expect(await loadCharacterGame(restored.id, identityKey)).toBeNull();
  });

  it('stores the game in Redis and cleans up the presence entry when available', async () => {
    if (!(await tryInitRedis())) return;
    const identityKey = `g:char-redis-${Date.now()}`;
    const created = await createOrResumeCharacterGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetCharacterId: 'c2',
      maxGuesses: 8,
    });
    expect(await redis()!.zScore(redisKey('presence:single'), created.id)).not.toBeNull();

    await deleteCharacterGame(created);
    expect(await loadCharacterGame(created.id, identityKey)).toBeNull();
    expect(await redis()!.zScore(redisKey('presence:single'), created.id)).toBeNull();
  });
});
