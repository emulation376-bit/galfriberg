import { db } from '../db/knex';
import { redis, redisKey, redisPublisher, redisSubscriber } from '../redis';
import { GameTitle, displayName } from '../types';
import { DIFFICULTY_LEVELS } from '../difficulties';
import { createHash, randomBytes } from 'crypto';

const INVALIDATE_CHANNEL = redisKey('games:invalidate');
const VERSION_KEY = redisKey('games:revision:v1');
const REFRESH_DEBOUNCE_MS = 100;
/** 自定义池存活时间: 30 分钟内 /start 可用，过期自动清理 */
const CUSTOM_POOL_TTL_MS = 30 * 60 * 1000;

type PublicGame = {
  id: number;
  title: string;
  titleCn: string;
  originalTitle: string;
  aliases: string[];
};
type SearchableGame = { game: GameTitle; search: string };
let gamesById = new Map<number, GameTitle>();
let allGames: GameTitle[] = [];
let gamesByDifficulty = new Map<string, GameTitle[]>();
let searchableGames: SearchableGame[] = [];
let publicList: { version: string; games: PublicGame[] } = { version: '1', games: [] };
let refreshPromise: Promise<void> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshGeneration = 0;
let pendingVersion: string | null = null;

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export async function refreshGameCache(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let appliedGeneration = -1;
    while (appliedGeneration !== refreshGeneration) {
      const requestedGeneration = refreshGeneration;
      const [rows, memberships, storedVersion, aliasRows] = await Promise.all([
        db<GameTitle>('game_titles').orderBy('title'),
        db('game_difficulties').select('game_id', 'difficulty_key'),
        redis()?.get(VERSION_KEY) ?? Promise.resolve(null),
        db('game_aliases').select('game_id', 'alias').orderBy('game_id'),
      ]);
      const aliasMap = new Map<number, string[]>();
      for (const row of aliasRows) {
        const gid = Number(row.game_id);
        if (!aliasMap.has(gid)) aliasMap.set(gid, []);
        aliasMap.get(gid)!.push(String(row.alias));
      }
      const hydratedById = new Map(rows.map((game) => {
        const gid = Number(game.id);
        const rawTags = String((game as { tags?: unknown }).tags ?? '');
        return [gid, {
          ...game,
          aliases: aliasMap.get(gid) ?? [],
          difficulties: [] as string[],
          tags: rawTags.split('、').filter(Boolean),
        }];
      }));
      gamesByDifficulty = new Map(
        DIFFICULTY_LEVELS
          .filter((difficulty) => difficulty.isEnabled)
          .map((difficulty) => [difficulty.key, [] as GameTitle[]])
      );
      for (const membership of memberships) {
        const game = hydratedById.get(Number(membership.game_id));
        if (!game) continue;
        const difficultyKey = String(membership.difficulty_key);
        game.difficulties.push(difficultyKey);
        if (Boolean(game.is_enabled)) gamesByDifficulty.get(difficultyKey)?.push(game);
      }
      // 用已填充 aliases 的 hydrated 记录，而非原始 rows，
      // 否则别名在 搜索/自动补全/公开列表 中全部丢失。
      allGames = rows
        .filter((game) => Boolean(game.is_enabled))
        .map((game) => hydratedById.get(Number(game.id))!);
      gamesById = new Map(allGames.map((game) => [game.id, game]));
      searchableGames = allGames.map((game) => ({
        game,
        search: normalizeSearch(
          `${game.title}\0${game.title_cn}\0${game.company}\0${(game.aliases ?? []).join('\0')}`
        ),
      }));
      publicList = {
        version: pendingVersion || storedVersion || String(Date.now()),
        games: allGames.map((game) => ({
          id: game.id,
          title: displayName(game),
          titleCn: game.title_cn,
          originalTitle: game.title,
          aliases: game.aliases ?? [],
        })),
      };
      pendingVersion = null;
      appliedGeneration = requestedGeneration;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function scheduleGameCacheRefresh(): void {
  refreshGeneration += 1;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshGameCache().catch((err) => console.error('[games] refresh failed', err));
  }, REFRESH_DEBOUNCE_MS);
  refreshTimer.unref?.();
}

export async function initGameCache(): Promise<void> {
  const client = redis();
  if (client) {
    await client.set(VERSION_KEY, '1', { NX: true });
    const subscriber = redisSubscriber();
    if (subscriber) await subscriber.subscribe(INVALIDATE_CHANNEL, scheduleGameCacheRefresh);
  }
  await refreshGameCache();
}

export function getGame(id: number): GameTitle | undefined {
  return gamesById.get(id);
}

export function getEnabledGame(id: number): GameTitle | undefined {
  const game = gamesById.get(id);
  return game && Boolean(game.is_enabled) ? game : undefined;
}

export function pickRandomGame(excludeId?: number): GameTitle | null {
  const pool = excludeId === undefined ? allGames : allGames.filter((game) => game.id !== excludeId);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** 自定义模式筛选条件 */
export interface CustomFilter {
  minVotes?: number;
  minScore?: number;
  yearFrom?: number;
  yearTo?: number;
  maxGuesses?: number;
}

interface CustomPool {
  ids: number[];
  maxGuesses: number;
  expiresAt: number;
}

const customPools = new Map<string, CustomPool>();

/** 按条件从启用作品里筛出池子，返回不透明的 poolKey（30 分钟有效）。 */
export function createCustomPool(filter: CustomFilter): { poolKey: string; count: number } {
  const maxGuesses = filter.maxGuesses ?? 8;
  const ids = allGames
    .filter((game) => (filter.minVotes == null || Number(game.vote_count) >= filter.minVotes))
    .filter((game) => (filter.minScore == null || Number(game.bgm_score) >= filter.minScore))
    .filter((game) => (filter.yearFrom == null || Number(game.release_year) >= filter.yearFrom))
    .filter((game) => (filter.yearTo == null || Number(game.release_year) <= filter.yearTo))
    .map((game) => game.id);
  const fingerprint = [
    filter.minVotes ?? '',
    filter.minScore ?? '',
    filter.yearFrom ?? '',
    filter.yearTo ?? '',
    maxGuesses,
  ].join('|');
  const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  const poolKey = `p_${randomBytes(8).toString('hex')}_${digest}`;
  customPools.set(poolKey, { ids, maxGuesses, expiresAt: Date.now() + CUSTOM_POOL_TTL_MS });
  return { poolKey, count: ids.length };
}

/** 从自定义池里随机抽一题；池子不存在或过期返回 null。 */
export function pickFromCustomPool(poolKey: string): { game: GameTitle; maxGuesses: number } | null {
  const pool = customPools.get(poolKey);
  if (!pool || Date.now() > pool.expiresAt) {
    customPools.delete(poolKey);
    return null;
  }
  if (!pool.ids.length) return null;
  const id = pool.ids[Math.floor(Math.random() * pool.ids.length)];
  const game = gamesById.get(id);
  return game ? { game, maxGuesses: pool.maxGuesses } : null;
}

export function pickCachedTarget(mode: string): GameTitle | null {
  const pool = gamesByDifficulty.get(mode) ?? [];
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function isDifficultyAvailable(key: string): boolean {
  const difficulty = DIFFICULTY_LEVELS.find((item) => item.key === key);
  return Boolean(difficulty?.isEnabled && (gamesByDifficulty.get(key)?.length ?? 0) > 0);
}

export function searchCachedGames(search: string, limit: number): GameTitle[] {
  const normalized = normalizeSearch(search);
  if (!normalized) return allGames.slice(0, limit);
  const result: GameTitle[] = [];
  for (const entry of searchableGames) {
    if (!entry.search.includes(normalized)) continue;
    result.push(entry.game);
    if (result.length >= limit) break;
  }
  return result;
}

export async function getPublicGameList(): Promise<typeof publicList> {
  const storedVersion = await redis()?.get(VERSION_KEY);
  if (storedVersion && storedVersion !== publicList.version) {
    pendingVersion = storedVersion;
    refreshGeneration += 1;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    await refreshGameCache();
  }
  return publicList;
}

export async function invalidateGameCache(): Promise<void> {
  const client = redis();
  let nextVersion = String(Date.now());
  if (client) {
    try {
      nextVersion = String(await client.incr(VERSION_KEY));
    } catch (err) {
      console.warn('[games] cache revision update failed', err instanceof Error
        ? err.message
        : err);
    }
  }
  pendingVersion = nextVersion;
  refreshGeneration += 1;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  await refreshGameCache();
  if (client) {
    try {
      await redisPublisher()?.publish(INVALIDATE_CHANNEL, nextVersion);
    } catch (err) {
      console.warn('[games] cache invalidation notification failed', err instanceof Error
        ? err.message
        : err);
    }
  }
}
