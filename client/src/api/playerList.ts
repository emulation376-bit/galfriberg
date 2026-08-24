import { api } from './client';

export interface GameSuggestion {
  id: number;
  title: string;
  titleCn?: string;
  originalTitle?: string;
  aliases?: string[];
}

interface CachedGameList {
  version: string;
  games: GameSuggestion[];
}

const STORAGE_KEY = 'game-list-v2';
const REVALIDATE_INTERVAL_MS = 30_000;

let memory: CachedGameList | null = null;
let loading: Promise<GameSuggestion[]> | null = null;
let validatedAt: number | null = null;
let cacheGeneration = 0;
const listeners = new Set<(games: GameSuggestion[]) => void>();

function removeStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable; the in-memory cache still works.
  }
}

function writeStored(value: CachedGameList): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Keep serving the in-memory snapshot when persistence is unavailable.
  }
}

function publish(games: GameSuggestion[]): void {
  for (const listener of listeners) {
    try {
      listener(games);
    } catch {
      // One mounted consumer must not break cache refresh for the others.
    }
  }
}

function readStored(): CachedGameList | null {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as CachedGameList | null;
    if (parsed?.games?.length) memory = parsed;
  } catch {
    removeStored();
  }
  return memory;
}

async function refresh(cached: CachedGameList | null, generation: number): Promise<GameSuggestion[]> {
  const response = await api.get('/players/list', {
    headers: cached ? { 'If-None-Match': `"games-${cached.version}"` } : undefined,
    validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
  });
  if (generation !== cacheGeneration) return memory?.games ?? cached?.games ?? [];
  if (response.status === 304 && cached) {
    memory = cached;
    validatedAt = performance.now();
    return cached.games;
  }
  const next: CachedGameList = {
    version: String(response.data.version),
    games: response.data.games,
  };
  memory = next;
  validatedAt = performance.now();
  writeStored(next);
  if (!cached || cached.version !== next.version) publish(next.games);
  return next.games;
}

function startRefresh(cached: CachedGameList | null): Promise<GameSuggestion[]> {
  if (loading) return loading;
  const task = refresh(cached, cacheGeneration);
  loading = task;
  void task.then(
    () => { if (loading === task) loading = null; },
    () => { if (loading === task) loading = null; }
  );
  return task;
}

function revalidateInBackground(cached: CachedGameList): void {
  if (validatedAt !== null && performance.now() - validatedAt <= REVALIDATE_INTERVAL_MS) return;
  void startRefresh(cached).catch(() => undefined);
}

export async function getGameList(): Promise<GameSuggestion[]> {
  const cached = readStored();
  if (cached) {
    revalidateInBackground(cached);
    return cached.games;
  }
  return startRefresh(null);
}

export function subscribeGameList(listener: (games: GameSuggestion[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearGameListCache(): void {
  cacheGeneration += 1;
  memory = null;
  loading = null;
  validatedAt = null;
  removeStored();
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function matchScore(title: string, query: string): number {
  const name = normalizeSearch(title);
  if (name === query) return 0;
  if (name.startsWith(query)) return 2;
  if (name.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

function bestMatchScore<T extends { title: string; titleCn?: string; originalTitle?: string; aliases?: string[] }>(
  game: T,
  query: string
): number {
  // 优先在 标题 / 中文名 / 别名 中匹配，取最优分数
  const candidates = [game.title];
  if (game.originalTitle) candidates.push(game.originalTitle);
  if (game.titleCn) candidates.push(game.titleCn);
  if (game.aliases) candidates.push(...game.aliases);
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score = matchScore(candidate, query);
    if (score < best) best = score;
  }
  return best;
}

export function searchGameList<T extends { title: string; titleCn?: string; originalTitle?: string; aliases?: string[] }>(
  games: T[],
  query: string
): T[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  return games
    .map((game) => ({ game, score: bestMatchScore(game, normalized) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.game.title.localeCompare(b.game.title))
    .map((entry) => entry.game)
    .slice(0, 10);
}
