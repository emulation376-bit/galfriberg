import { evalCommandScript, isRedisAvailable, redisKey } from '../redis';

const WINDOW_SECONDS = 60;
const PERSIST_LIMIT = 4;

// In-memory fallback when Redis is unavailable (single-instance dev mode).
const memorySettlementLimits = new Map<string, { games: Map<string, boolean>; count: number; expiresAt: number }>();

function memoryShouldPersist(
  memoryKey: string,
  identityKey: string,
  gameId: string
): boolean {
  const now = Date.now();
  let entry = memorySettlementLimits.get(`${memoryKey}:${identityKey}`);
  if (!entry || entry.expiresAt < now) {
    entry = { games: new Map(), count: 0, expiresAt: now + WINDOW_SECONDS * 1000 };
    memorySettlementLimits.set(`${memoryKey}:${identityKey}`, entry);
  }
  if (entry.games.has(gameId)) return entry.games.get(gameId)!;
  entry.count += 1;
  const allowed = entry.count <= PERSIST_LIMIT;
  entry.games.set(gameId, allowed);
  return allowed;
}

/** Returns whether this completed single-player game should be persisted. */
export async function shouldPersistSettlement(
  identityKey: string,
  gameId: string,
  namespace = 'single'
): Promise<boolean> {
  // Memory fallback for dev without Redis
  if (!isRedisAvailable()) {
    return memoryShouldPersist(namespace, identityKey, gameId);
  }

  const result = await evalCommandScript(
    'single-settlement-soft-limit-v1',
    `local field = 'game:' .. ARGV[1]
     local existing = redis.call('HGET', KEYS[1], field)
     if existing then return tonumber(existing) end
     local count = tonumber(redis.call('HGET', KEYS[1], 'count') or 0) + 1
     local allowed = count <= tonumber(ARGV[2]) and 1 or 0
     redis.call('HSET', KEYS[1], 'count', tostring(count), field, tostring(allowed))
     if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
       redis.call('EXPIRE', KEYS[1], ARGV[3])
     end
     return allowed`,
    [redisKey(`${namespace}:settlement-limit:${identityKey}`)],
    [gameId, String(PERSIST_LIMIT), String(WINDOW_SECONDS)]
  );
  return Number(result) === 1;
}

export function shouldPersistSingleSettlement(
  identityKey: string,
  gameId: string
): Promise<boolean> {
  return shouldPersistSettlement(identityKey, gameId, 'single');
}

export function shouldPersistCharacterSettlement(
  identityKey: string,
  gameId: string
): Promise<boolean> {
  return shouldPersistSettlement(identityKey, gameId, 'character');
}
