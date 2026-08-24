import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/knex';
import { initDb } from '../db/init';
import { errorHandler } from '../middleware/common';
import { signToken, userNameFromUsername } from '../middleware/auth';
import { initRedis } from '../redis';
import { getGame, initGameCache } from '../services/playerCache';
import adminRoutes from './admin';
import externalPlayerRoutes, { externalGameAuth } from './externalPlayers';

let server: http.Server;
let baseUrl: string;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return { response, data: await response.json() };
}

describe('external game API tokens', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    await initGameCache();
    const app = express();
    app.use('/api/external', externalGameAuth);
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use('/api/external', externalPlayerRoutes);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('creates, uses, and revokes a hashed token for game mutations', async () => {
    const stamp = Date.now();
    const username = `external-api-admin-${stamp}`;
    const titleA = `external-a-${stamp}`;
    const titleB = `external-b-${stamp}`;
    const [admin] = await db('users')
      .insert({
        username,
        display_id: userNameFromUsername(username),
        password_hash: 'test',
        role: 'admin',
        token_version: 0,
      })
      .returning(['id', 'token_version']);
    const cookie = `csgofriberg_session=${signToken(admin)}`;

    try {
      const createdToken = await request('/api/admin/api-tokens', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ name: 'sync job', expiresInDays: 30 }),
      });
      expect(createdToken.response.status).toBe(201);
      expect(createdToken.data.token).toMatch(/^csgf_[A-Za-z0-9_-]{43}$/);
      expect(createdToken.data.prefix).toMatch(/^csgf_.+\.\.\.$/);

      const storedToken = await db('api_tokens').where({ id: createdToken.data.id }).first();
      expect(storedToken.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(storedToken)).not.toContain(createdToken.data.token);

      const missingToken = await request('/api/external/games', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(missingToken.response.status).toBe(401);
      expect(missingToken.data.code).toBe('API_TOKEN_REQUIRED');

      const authorization = { Authorization: `Bearer ${createdToken.data.token}` };
      const createdGame = await request('/api/external/games', {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({
          title: titleA,
          title_cn: '',
          release_year: 2005,
          company: 'API Studio',
          is_r18: true,
          scenario_writer: '剧本A',
          music_composer: '配乐A',
          artist: '原画A',
          bgm_score: 8.2,
          difficulties: ['normal'],
          is_active: true,
          is_enabled: true,
        }),
      });
      expect(createdGame.response.status).toBe(201);
      const gameId = Number(createdGame.data.id);
      expect(getGame(gameId)?.title).toBe(titleA);

      const updatedGame = await request(`/api/external/games/${gameId}`, {
        method: 'PUT',
        headers: authorization,
        body: JSON.stringify({ company: 'Updated API Studio', difficulties: ['normal', 'easy'] }),
      });
      expect(updatedGame.response.status).toBe(200);
      expect(getGame(gameId)?.company).toBe('Updated API Studio');
      expect(await db('game_difficulties')
        .where({ game_id: gameId })
        .orderBy('difficulty_key')
        .pluck('difficulty_key')).toEqual(['easy', 'normal']);

      const imported = await request('/api/external/games/import', {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({
          games: [
            {
              title: titleA,
              company: 'Bulk Updated',
              is_active: true,
              is_enabled: true,
            },
            {
              title: titleB,
              title_cn: '外部导入B',
              release_year: 2007,
              company: 'API Studio',
              is_r18: false,
              bgm_score: 7.0,
              difficulties: ['normal'],
              is_active: true,
              is_enabled: true,
            },
          ],
        }),
      });
      expect(imported.response.status).toBe(200);
      expect(imported.data).toEqual({ created: 1, updated: 1 });
      expect(getGame(gameId)?.company).toBe('Bulk Updated');

      const revoked = await request(`/api/admin/api-tokens/${createdToken.data.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(revoked.response.status).toBe(200);

      const afterRevoke = await request(`/api/external/games/${gameId}`, {
        method: 'PUT',
        headers: authorization,
        body: JSON.stringify({ company: 'Hacked' }),
      });
      expect(afterRevoke.response.status).toBe(401);
      expect(afterRevoke.data.code).toBe('API_TOKEN_INVALID');
    } finally {
      const gameIds = await db('game_titles').whereIn('title', [titleA, titleB]).pluck('id');
      if (gameIds.length) {
        await db('game_difficulties').whereIn('game_id', gameIds).del();
        await db('game_titles').whereIn('id', gameIds).del();
      }
      await db('api_tokens').where({ created_by_user_id: admin.id }).del();
      await db('users').where({ id: admin.id }).del();
    }
  });
});