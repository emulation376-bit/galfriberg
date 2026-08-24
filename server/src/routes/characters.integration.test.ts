import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import characterRoutes from './characters';
import statsRoutes from './stats';
import { config } from '../config';
import { initDb } from '../db/init';
import { db } from '../db/knex';
import { initRedis, isRedisAvailable } from '../redis';
import { initGameCache } from '../services/playerCache';
import { errorHandler } from '../middleware/common';

let server: http.Server;
let baseUrl: string;
let hasCharacters = false;

function guestCookie(key: string): string {
  const token = jwt.sign({ key, typ: 'guest' }, config.jwtSecret, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
  return `csgofriberg_guest=${token}`;
}

async function post(path: string, cookie: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

async function get(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
  return { response, data: await response.json() };
}

describe('character single-player alignment', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    await initGameCache();
    hasCharacters = Number((await db('characters').count({ count: 'id' }).first())?.count ?? 0) > 0;
    const app = express();
    app.use(express.json());
    app.use('/api/characters', characterRoutes);
    app.use('/api/stats', statsRoutes);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('starts, guesses, settles, and exposes the character dimension', async () => {
    if (!hasCharacters) return;
    const guestKey = `character-alignment-${Date.now()}`;
    const cookie = guestCookie(guestKey);
    let gameId = '';
    const guess = await db('characters').select('id').first();
    if (!guess) return;

    try {
      const started = await post('/api/characters/game/start', cookie, { mode: 'normal' });
      expect(started.response.status).toBe(200);
      expect(started.data.gameId).toEqual(expect.any(String));
      gameId = started.data.gameId;

      const guessed = await post(
        `/api/characters/game/${gameId}/guess`,
        cookie,
        { characterId: String(guess.id) }
      );
      expect(guessed.response.status).toBe(200);
      expect(guessed.data.feedback.correct).toEqual(expect.any(Boolean));

      let finalStatus = guessed.data.status as 'playing' | 'won';
      if (finalStatus === 'playing') {
        const revealed = await post(`/api/characters/game/${gameId}/reveal`, cookie);
        expect(revealed.response.status).toBe(200);
        expect(revealed.data).toMatchObject({
          status: 'lost',
          recorded: true,
          answer: { id: expect.any(String) },
        });
        finalStatus = 'lost';
      } else {
        expect(guessed.data.recorded).toBe(true);
      }

      const saved = await db('character_games')
        .where({ session_id: gameId, guest_key: guestKey })
        .first();
      expect(saved).toBeDefined();
      expect(saved.status).toBe(finalStatus);

      const stats = await get('/api/stats/character?difficulties=normal', cookie);
      expect(stats.response.status).toBe(200);
      expect(stats.data.personal.totalGames).toBe(1);
      expect(stats.data.personal.wins).toBe(finalStatus === 'won' ? 1 : 0);

      const replayList = await get('/api/stats/character/replays?page=1&pageSize=5', cookie);
      expect(replayList.response.status).toBe(200);
      expect(replayList.data.items[0]).toMatchObject({
        type: 'character',
        id: Number(saved.id),
        status: finalStatus,
      });

      const replay = await get(
        `/api/stats/character/games/${saved.id}/replay`,
        cookie
      );
      expect(replay.response.status).toBe(200);
      expect(replay.data.answer.id).toBe(String(saved.target_character_id));
      expect(replay.data.names).toEqual(expect.any(Object));
    } finally {
      if (gameId) {
        await db('character_games').where({ session_id: gameId }).del();
        await db('character_games').where({ guest_key: guestKey }).del();
      }
    }
  });
});
