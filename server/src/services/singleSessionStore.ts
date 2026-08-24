import { randomUUID } from 'crypto';
import { evalCommandScript, isRedisAvailable, redis, redisKey } from '../redis';

export interface SessionBase {
  id: string;
  identityKey: string;
  userId: number | null;
  guestKey: string | null;
  mode: string;
  guesses: unknown[];
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionStoreOptions {
  gamePrefix: string;
  activePrefix: string;
  presenceKey: string;
  ttlSeconds: number;
}

export interface CreateSessionInput<S extends SessionBase> {
  identityKey: string;
  userId: number | null;
  guestKey: string | null;
  mode: string;
  make: () => Omit<
    S,
    'id' | 'identityKey' | 'userId' | 'guestKey' | 'mode' | 'createdAt' | 'lastActiveAt'
  >;
}

export function createSessionStore<S extends SessionBase>(options: SessionStoreOptions) {
  const memoryStore = new Map<string, S>();
  const memoryActiveByUser = new Map<string, string>();

  const gameKey = (id: string) => redisKey(`${options.gamePrefix}:${id}`);
  const activeKey = (identityKey: string, mode: string) =>
    redisKey(`${options.activePrefix}:${identityKey}:${mode}`);

  function memoryFallbackEnabled(): boolean {
    return !isRedisAvailable();
  }

  function memoryGetGame(id: string): S | null {
    const game = memoryStore.get(id);
    if (!game) return null;
    if (game.lastActiveAt + options.ttlSeconds * 1000 <= Date.now()) {
      memoryStore.delete(id);
      return null;
    }
    return game;
  }

  async function createOrResume(input: CreateSessionInput<S>): Promise<S> {
    if (memoryFallbackEnabled()) {
      const memKey = activeKey(input.identityKey, input.mode);
      const existingId = memoryActiveByUser.get(memKey);
      if (existingId) {
        const existing = memoryGetGame(existingId);
        if (existing) return existing;
        memoryActiveByUser.delete(memKey);
      }
      const now = Date.now();
      const game = {
        ...input.make(),
        identityKey: input.identityKey,
        userId: input.userId,
        guestKey: input.guestKey,
        mode: input.mode,
        id: randomUUID(),
        createdAt: now,
        lastActiveAt: now,
      } as S;
      memoryStore.set(game.id, game);
      memoryActiveByUser.set(memKey, game.id);
      return game;
    }

    const client = redis();
    if (!client) throw new Error('REDIS_UNAVAILABLE');
    const active = activeKey(input.identityKey, input.mode);
    const existingId = await client.get(active);
    if (existingId) {
      const existing = await load(existingId, input.identityKey);
      if (existing) return existing;
      await client.del(active);
    }

    const now = Date.now();
    const game = {
      ...input.make(),
      identityKey: input.identityKey,
      userId: input.userId,
      guestKey: input.guestKey,
      mode: input.mode,
      id: randomUUID(),
      createdAt: now,
      lastActiveAt: now,
    } as S;
    await save(game);
    return game;
  }

  async function load(id: string, identityKey: string, touch = false): Promise<S | null> {
    if (memoryFallbackEnabled()) {
      const game = memoryGetGame(id);
      if (!game || game.identityKey !== identityKey) return null;
      if (touch) game.lastActiveAt = Date.now();
      return game;
    }

    const client = redis();
    if (!client) throw new Error('REDIS_UNAVAILABLE');
    const raw = await client.get(gameKey(id));
    if (!raw) return null;
    const game = JSON.parse(raw) as S;
    if (game.identityKey !== identityKey) return null;
    if (game.lastActiveAt + options.ttlSeconds * 1000 <= Date.now()) {
      await deleteGame(game);
      return null;
    }
    if (touch) {
      game.lastActiveAt = Date.now();
      await save(game);
    }
    return game;
  }

  async function save(game: S): Promise<void> {
    if (memoryFallbackEnabled()) {
      game.lastActiveAt = Date.now();
      memoryStore.set(game.id, game);
      memoryActiveByUser.set(activeKey(game.identityKey, game.mode), game.id);
      return;
    }

    const client = redis();
    if (!client) throw new Error('REDIS_UNAVAILABLE');
    game.lastActiveAt = Date.now();
    const expiresAt = game.lastActiveAt + options.ttlSeconds * 1000;
    await client.multi()
      .set(gameKey(game.id), JSON.stringify(game), { EX: options.ttlSeconds })
      .set(activeKey(game.identityKey, game.mode), game.id, { EX: options.ttlSeconds })
      .zAdd(redisKey(options.presenceKey), { score: expiresAt, value: game.id })
      .exec();
  }

  async function deleteGame(game: S): Promise<void> {
    if (memoryFallbackEnabled()) {
      memoryActiveByUser.delete(activeKey(game.identityKey, game.mode));
      memoryStore.delete(game.id);
      return;
    }

    const client = redis();
    if (!client) throw new Error('REDIS_UNAVAILABLE');
    await evalCommandScript(
      'single-game-delete-v1',
      `redis.call('ZREM', KEYS[3], ARGV[1])
       if redis.call('get', KEYS[1]) == ARGV[1] then
         return redis.call('del', KEYS[1], KEYS[2])
       end
       return redis.call('del', KEYS[2])`,
      [activeKey(game.identityKey, game.mode), gameKey(game.id), redisKey(options.presenceKey)],
      [game.id]
    );
  }

  return { createOrResume, load, save, delete: deleteGame };
}
