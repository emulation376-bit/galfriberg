import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  clearGameListCache,
  getGameList,
  searchGameList,
  subscribeGameList,
} from './playerList';

vi.mock('./client', () => ({
  api: { get: vi.fn() },
}));

const get = vi.mocked(api.get);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('gameList cache', () => {
  beforeEach(() => {
    clearGameListCache();
    localStorage.clear();
    get.mockReset();
  });

  it('returns stored games immediately and revalidates once in the background', async () => {
    const cached = [{ id: 1, title: 'cached' }];
    const updated = [{ id: 2, title: 'updated' }];
    localStorage.setItem('game-list-v2', JSON.stringify({ version: '1', games: cached }));
    const request = deferred<any>();
    get.mockReturnValue(request.promise);
    const listener = vi.fn();
    const unsubscribe = subscribeGameList(listener);

    await expect(getGameList()).resolves.toEqual(cached);
    await expect(getGameList()).resolves.toEqual(cached);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/players/list', expect.objectContaining({
      headers: { 'If-None-Match': '"games-1"' },
    }));
    expect(listener).not.toHaveBeenCalled();

    request.resolve({ status: 200, data: { version: '2', games: updated } });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(updated));
    await expect(getGameList()).resolves.toEqual(updated);

    unsubscribe();
  });

  it('ranks exact and prefix matches ahead of substring matches', () => {
    const games = [
      { id: 1, title: 'CLANNAD' },
      { id: 2, title: 'Clover Day\'s' },
      { id: 3, title: 'AIR' },
      { id: 4, title: 'Fair Child' },
      { id: 5, title: 'Rewrite' },
      { id: 6, title: '交错†频道', originalTitle: 'CROSS†CHANNEL' },
    ];

    expect(searchGameList(games, 'clannad').map((game) => game.title))
      .toEqual(['CLANNAD']);
    expect(searchGameList(games, 'cl').map((game) => game.title))
      .toEqual(['CLANNAD', 'Clover Day\'s']);
    expect(searchGameList(games, 'air').map((game) => game.title))
      .toEqual(['AIR', 'Fair Child']);
    expect(searchGameList(games, 'cross').map((game) => game.title))
      .toEqual(['交错†频道']);
    expect(searchGameList(games, 'zzz')).toEqual([]);
  });
});
