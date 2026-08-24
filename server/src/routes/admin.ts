import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { db } from '../db/knex';
import {
  guestNameFromKey,
  requireAuth,
  requireAdmin,
  userNameFromUsername,
} from '../middleware/auth';
import {
  validateBody,
  validateParams,
  validateQuery,
  asyncHandler,
  HttpError,
} from '../middleware/common';
import { invalidateCached } from '../services/queryCache';
import { allLeaderboardCacheKeys } from '../services/leaderboardCache';
import { rateLimit, requestIdentity } from '../middleware/rateLimit';
import { publishResourceVersion } from '../services/resourceVersion';
import { getPlayerPerformance } from '../services/playerPerformance';
import { compareGuess, MAX_GUESSES } from '../services/gameService';
import { displayStaff } from '../services/staffResolver';
import { getGame } from '../services/playerCache';
import { compareCharacterClues, getCharacterSearchList } from '../services/characterGame';
import { loadCharacterClueCached } from '../services/characterClueCache';
import type { GuessFeedback, GameTitle } from '../types';
import { displayName } from '../types';
import {
  createGame,
  deleteGame,
  importGames,
  gameImportSchema,
  gameSchema,
  gameUpdateSchema,
  updateGame,
} from '../services/playerMutations';
import { createApiToken, listApiTokens, revokeApiToken } from '../services/apiTokens';

const router = Router();
router.use(requireAuth, requireAdmin);
const adminReadLimit = rateLimit({
  name: 'admin-read',
  limit: 60,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const adminWriteLimit = rateLimit({
  name: 'admin-write',
  limit: 30,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const adminImportLimit = rateLimit({
  name: 'admin-import',
  limit: 10,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const adminResourceBroadcastLimit = rateLimit({
  name: 'admin-resource-broadcast',
  limit: 5,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const gameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  search: z.string().trim().max(100).default(''),
});
const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  search: z.string().trim().max(64).default(''),
});
const userGameListQuerySchema = z.object({
  type: z.enum(['single', 'multi', 'character']).default('single'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(30).default(10),
});
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const userLeaderboardVisibilitySchema = z.object({ hidden: z.boolean() });
const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});
const userGameReplayParamsSchema = z.object({
  userId: z.coerce.number().int().positive(),
  gameId: z.coerce.number().int().positive(),
});
const userMatchReplayParamsSchema = z.object({
  userId: z.coerce.number().int().positive(),
  matchId: z.coerce.number().int().positive(),
});

function matchPlayerDisplayId(row: { key?: unknown; name?: unknown; username?: unknown }): string {
  const key = typeof row.key === 'string' ? row.key : '';
  const name = typeof row.name === 'string' ? row.name : '';
  if (/^(访客|用户)#[0-9A-Z]{5}$/.test(name)) return name;
  if (key.startsWith('g:')) return guestNameFromKey(key.slice(2));
  if (key.startsWith('u:')) {
    const username = typeof row.username === 'string' && row.username ? row.username : name;
    return username ? userNameFromUsername(username) : '用户#未知';
  }
  return name || '未知对手';
}

function replayAnswer(target: GameTitle) {
  return {
    id: target.id,
    title: displayName(target),
    titleCn: target.title_cn,
    releaseYear: target.release_year,
    company: target.company,
    isR18: Boolean(target.is_r18),
    scenarioWriter: displayStaff(target.scenario_writer),
    musicComposer: displayStaff(target.music_composer),
    artist: displayStaff(target.artist),
    voiceActor: displayStaff(target.voice_actor),
    bgmScore: target.bgm_score,
    vndbId: target.vndb_id ?? null,
  };
}

function safeGuessIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_GUESSES)
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function replayGuesses(target: GameTitle, ids: number[]): GuessFeedback[] {
  return ids.flatMap((id) => {
    const guess = getGame(id);
    return guess ? [compareGuess(guess, target)] : [];
  });
}

router.get(
  '/users',
  adminReadLimit,
  validateQuery(userListQuerySchema),
  asyncHandler(async (req, res) => {
    const parsed = req.query as unknown as z.infer<typeof userListQuerySchema>;
    const { pageSize, search } = parsed;
    const query = db('users');
    if (search) {
      query.where((builder) => {
        builder.whereILike('username', `%${search}%`)
          .orWhereILike('display_id', `%${search}%`);
      });
    }
    const countRow = await query.clone().count({ count: 'id' }).first();
    const total = Number(countRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(parsed.page, totalPages);
    const users = await query.clone()
      .select('id', 'username', 'display_id', 'role', 'leaderboard_hidden', 'created_at')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({
      users: users.map((user) => ({
        id: Number(user.id),
        username: user.username,
        displayId: user.display_id || userNameFromUsername(user.username),
        role: user.role,
        leaderboardHidden: Boolean(user.leaderboard_hidden),
        createdAt: user.created_at,
      })),
      total,
      page,
      pageSize,
      totalPages,
    });
  })
);

router.get(
  '/users/:id/stats',
  adminReadLimit,
  validateParams(idParamsSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const user = await db('users')
      .where({ id })
      .first('id', 'username', 'display_id', 'role', 'leaderboard_hidden', 'created_at');
    if (!user) throw new HttpError(404, 'USER_NOT_FOUND');
    res.json({
      user: {
        id: Number(user.id),
        username: user.username,
        displayId: user.display_id || userNameFromUsername(user.username),
        role: user.role,
        leaderboardHidden: Boolean(user.leaderboard_hidden),
        createdAt: user.created_at,
      },
      stats: await getPlayerPerformance({
        key: `u:${user.id}`,
        userId: Number(user.id),
        name: user.username,
      }),
    });
  })
);

router.get(
  '/users/:id/games',
  adminReadLimit,
  validateParams(idParamsSchema),
  validateQuery(userGameListQuerySchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const parsed = req.query as unknown as z.infer<typeof userGameListQuerySchema>;
    if (!(await db('users').where({ id }).first('id'))) throw new HttpError(404, 'USER_NOT_FOUND');
    const { type, page, pageSize } = parsed;
    const offset = (page - 1) * pageSize;

    if (type === 'single') {
      const rows = await db('games as g')
        .join('game_titles as t', 't.id', 'g.target_game_id')
        .where('g.user_id', id)
        .whereNot('g.status', 'playing')
        .orderBy('g.finished_at', 'desc')
        .orderBy('g.id', 'desc')
        .offset(offset)
        .limit(pageSize + 1)
        .select(
          'g.id',
          'g.mode',
          'g.status',
          'g.guess_count as guessCount',
          'g.finished_at as finishedAt',
          't.title as answer'
        );
      return res.json({
        type,
        page,
        pageSize,
        hasNext: rows.length > pageSize,
        items: rows.slice(0, pageSize).map((row) => ({ type: 'single', ...row })),
      });
    }

    if (type === 'character') {
      const [rows, characters] = await Promise.all([
        db('character_games as g')
          .where('g.user_id', id)
          .whereNot('g.status', 'playing')
          .orderBy('g.finished_at', 'desc')
          .orderBy('g.id', 'desc')
          .offset(offset)
          .limit(pageSize + 1)
          .select(
            'g.id',
            'g.mode',
            'g.status',
            'g.guess_count as guessCount',
            'g.finished_at as finishedAt',
            'g.target_character_id as targetCharacterId'
          ),
        getCharacterSearchList(),
      ]);
      const nameById = new Map(characters.map((character) => [character.id, character.name]));
      return res.json({
        type,
        page,
        pageSize,
        hasNext: rows.length > pageSize,
        items: rows.slice(0, pageSize).map((row) => ({
          type: 'character',
          id: Number(row.id),
          mode: row.mode,
          status: row.status,
          guessCount: Number(row.guessCount),
          finishedAt: row.finishedAt,
          targetCharacterId: String(row.targetCharacterId),
          answer: nameById.get(String(row.targetCharacterId)) ?? String(row.targetCharacterId),
        })),
      });
    }

    const identityKey = `u:${id}`;
    const rows = await db('match_players as me')
      .join('match_records as m', 'm.id', 'me.match_id')
      .where('me.user_id', id)
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .offset(offset)
      .limit(pageSize + 1)
      .select(
        'm.id',
        'm.db_type as mode',
        'm.bo_type as boType',
        'm.created_at as finishedAt',
        'me.score as meScore',
        'me.is_winner as meWinner'
      );
    const visibleRows = rows.slice(0, pageSize);
    const matchIds = visibleRows.map((row) => Number(row.id));
    const opponents = matchIds.length
      ? await db('match_players as opponent')
        .leftJoin('users as opponent_user', 'opponent_user.id', 'opponent.user_id')
        .whereIn('opponent.match_id', matchIds)
        .whereNot('opponent.player_key', identityKey)
        .select(
          'opponent.match_id as matchId',
          'opponent.player_key as key',
          'opponent.player_name as name',
          'opponent.score',
          'opponent.is_winner as isWinner',
          'opponent_user.username'
        )
      : [];
    const opponentByMatch = new Map(opponents.map((row) => [Number(row.matchId), row]));
    res.json({
      type,
      page,
      pageSize,
      hasNext: rows.length > pageSize,
      items: visibleRows.map((row) => {
        const opponent = opponentByMatch.get(Number(row.id));
        return {
          type: 'multi',
          id: Number(row.id),
          mode: row.mode,
          boType: Number(row.boType),
          finishedAt: row.finishedAt,
          result: Boolean(row.meWinner) ? 'won' : Boolean(opponent?.isWinner) ? 'lost' : 'draw',
          me: { score: Number(row.meScore) },
          opponent: opponent
            ? { displayId: matchPlayerDisplayId(opponent), score: Number(opponent.score) }
            : null,
        };
      }),
    });
  })
);

router.get(
  '/users/:userId/games/:gameId/replay',
  adminReadLimit,
  validateParams(userGameReplayParamsSchema),
  asyncHandler(async (req, res) => {
    const { userId, gameId } = req.params as unknown as z.infer<typeof userGameReplayParamsSchema>;
    const game = await db('games')
      .where({ id: gameId, user_id: userId })
      .whereNot('status', 'playing')
      .first();
    if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
    const target = getGame(Number(game.target_game_id));
    if (!target) throw new HttpError(404, 'GAME_NOT_FOUND');

    let storedGuesses: unknown[] = [];
    try {
      const parsed = JSON.parse(String(game.guesses));
      if (Array.isArray(parsed)) storedGuesses = parsed;
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const guesses = storedGuesses.flatMap((stored) => {
      if (typeof stored === 'number') {
        const guess = getGame(stored);
        return guess ? [compareGuess(guess, target)] : [];
      }
      if (!stored || typeof stored !== 'object' || !('gameId' in stored)) return [];
      const feedback = stored as GuessFeedback;
      const guess = getGame(feedback.gameId);
      return guess ? [compareGuess(guess, target)] : [];
    });
    res.json({
      id: Number(game.id),
      mode: game.mode,
      status: game.status,
      guessCount: Number(game.guess_count),
      createdAt: game.created_at,
      finishedAt: game.finished_at,
      answer: replayAnswer(target),
      guesses,
    });
  })
);

router.get(
  '/users/:userId/character-games/:gameId/replay',
  adminReadLimit,
  validateParams(userGameReplayParamsSchema),
  asyncHandler(async (req, res) => {
    const { userId, gameId } = req.params as unknown as z.infer<typeof userGameReplayParamsSchema>;
    const game = await db('character_games')
      .where({ id: gameId, user_id: userId })
      .whereNot('status', 'playing')
      .first();
    if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
    const target = await loadCharacterClueCached(String(game.target_character_id));
    if (!target) throw new HttpError(404, 'GAME_NOT_FOUND');

    let storedGuesses: unknown[] = [];
    try {
      const parsed = JSON.parse(String(game.guesses));
      if (Array.isArray(parsed)) storedGuesses = parsed;
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const guessIds = storedGuesses
      .map((stored) => String(
        typeof stored === 'string'
          ? stored
          : typeof stored === 'object' && stored && 'guessId' in stored
            ? (stored as { guessId: unknown }).guessId
            : stored
      ))
      .filter((id) => id && id !== 'null' && id !== 'undefined');
    const uniqueIds = [...new Set(guessIds)];
    const clues = await Promise.all(uniqueIds.map((characterId) => loadCharacterClueCached(characterId)));
    const clueById = new Map(
      clues.filter((clue): clue is NonNullable<typeof clue> => Boolean(clue))
        .map((clue) => [clue.id, clue])
    );
    const characters = await getCharacterSearchList();
    const nameById = new Map(characters.map((character) => [character.id, character.name]));
    const guesses = guessIds.flatMap((characterId) => {
      const clue = clueById.get(characterId);
      return clue ? [compareCharacterClues(characterId, clue, target)] : [];
    });
    const names = Object.fromEntries(
      uniqueIds.map((characterId) => [characterId, nameById.get(characterId) ?? characterId])
    );

    res.json({
      id: Number(game.id),
      mode: game.mode,
      status: game.status,
      guessCount: Number(game.guess_count),
      createdAt: game.created_at,
      finishedAt: game.finished_at,
      answer: target,
      guesses,
      names,
    });
  })
);

router.get(
  '/users/:userId/matches/:matchId/replay',
  adminReadLimit,
  validateParams(userMatchReplayParamsSchema),
  asyncHandler(async (req, res) => {
    const { userId, matchId } = req.params as unknown as z.infer<typeof userMatchReplayParamsSchema>;
    const match = await db('match_records as m')
      .join('match_players as me', 'me.match_id', 'm.id')
      .where('m.id', matchId)
      .where('me.user_id', userId)
      .first(
        'm.id',
        'm.db_type as mode',
        'm.bo_type as boType',
        'm.replay',
        'm.created_at as finishedAt',
        'me.id as mePlayerId',
        'me.player_key as meKey',
        'me.score as meScore',
        'me.is_winner as meWinner'
      );
    if (!match) throw new HttpError(404, 'GAME_NOT_FOUND');
    const opponent = await db('match_players as opponent')
      .leftJoin('users as opponent_user', 'opponent_user.id', 'opponent.user_id')
      .where('opponent.match_id', matchId)
      .whereNot('opponent.id', match.mePlayerId)
      .first(
        'opponent.player_key as key',
        'opponent.player_name as name',
        'opponent.score',
        'opponent.is_winner as isWinner',
        'opponent_user.username'
      );
    if (!opponent) throw new HttpError(404, 'GAME_NOT_FOUND');

    let storedRounds: unknown[] = [];
    try {
      const parsed = JSON.parse(String(match.replay));
      if (Array.isArray(parsed)) storedRounds = parsed.slice(0, 30);
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const rounds = storedRounds.flatMap((stored) => {
      if (!stored || typeof stored !== 'object') return [];
      const round = stored as Record<string, unknown>;
      const target = getGame(Number(round.targetGameId));
      if (!target) return [];
      const guessesByPlayer = round.guessesByPlayer;
      if (!guessesByPlayer || typeof guessesByPlayer !== 'object') return [];
      const guesses = guessesByPlayer as Record<string, unknown>;
      const winnerKey = typeof round.winnerKey === 'string' ? round.winnerKey : null;
      return [{
        round: Number(round.round),
        reason: typeof round.reason === 'string' ? round.reason : '',
        winner: winnerKey === match.meKey ? 'me' : winnerKey === opponent.key ? 'opponent' : null,
        answer: replayAnswer(target),
        me: { guesses: replayGuesses(target, safeGuessIds(guesses[match.meKey])) },
        opponent: { guesses: replayGuesses(target, safeGuessIds(guesses[opponent.key])) },
      }];
    });
    res.json({
      id: Number(match.id),
      mode: match.mode,
      boType: Number(match.boType),
      finishedAt: match.finishedAt,
      result: Boolean(match.meWinner) ? 'won' : Boolean(opponent.isWinner) ? 'lost' : 'draw',
      me: { score: Number(match.meScore) },
      opponent: {
        displayId: matchPlayerDisplayId(opponent),
        score: Number(opponent.score),
      },
      rounds,
    });
  })
);

router.get(
  '/games',
  adminReadLimit,
  validateQuery(gameListQuerySchema),
  asyncHandler(async (req, res) => {
    const parsed = req.query as unknown as z.infer<typeof gameListQuerySchema>;
    const { pageSize, search } = parsed;
    const query = db('game_titles');
    if (search) {
      query.where((builder) => {
        builder.whereILike('title', `%${search}%`)
          .orWhereILike('title_cn', `%${search}%`)
          .orWhereILike('company', `%${search}%`)
          .orWhereILike('scenario_writer', `%${search}%`)
          .orWhereILike('voice_actor', `%${search}%`);
      });
    }
    const countRow = await query.clone().count({ count: 'id' }).first();
    const total = Number(countRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(parsed.page, totalPages);
    const games = await query.clone()
      .orderBy('title')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const gameIds = games.map((game) => Number(game.id));
    const memberships = gameIds.length
      ? await db('game_difficulties')
        .whereIn('game_id', gameIds)
        .orderBy('difficulty_key')
        .select('game_id', 'difficulty_key')
      : [];
    const difficultiesByGame = new Map<number, string[]>();
    for (const membership of memberships) {
      const list = difficultiesByGame.get(Number(membership.game_id)) ?? [];
      list.push(String(membership.difficulty_key));
      difficultiesByGame.set(Number(membership.game_id), list);
    }
    res.json({
      games: games.map((game) => ({
        ...game,
        difficulties: difficultiesByGame.get(Number(game.id)) ?? [],
      })),
      total,
      page,
      pageSize,
      totalPages,
    });
  })
);

router.get(
  '/games/export',
  adminReadLimit,
  asyncHandler(async (_req, res) => {
    const [games, memberships] = await Promise.all([
      db('game_titles')
        .select(
          'id',
          'title',
          'title_cn',
          'release_year',
          'company',
          'is_r18',
          'scenario_writer',
          'music_composer',
          'artist',
          'voice_actor',
          'bgm_score',
          'is_active',
          'is_enabled'
        )
        .orderBy('title'),
      db('game_difficulties')
        .orderBy('difficulty_key')
        .select('game_id', 'difficulty_key'),
    ]);
    const difficultiesByGame = new Map<number, string[]>();
    for (const membership of memberships) {
      const gameId = Number(membership.game_id);
      const difficulties = difficultiesByGame.get(gameId) ?? [];
      difficulties.push(String(membership.difficulty_key));
      difficultiesByGame.set(gameId, difficulties);
    }
    const exportedGames = games.map((game) => ({
      title: String(game.title),
      title_cn: String(game.title_cn),
      release_year: Number(game.release_year),
      company: String(game.company),
      is_r18: Boolean(game.is_r18),
      scenario_writer: String(game.scenario_writer),
      music_composer: String(game.music_composer),
      artist: String(game.artist),
      voice_actor: String(game.voice_actor),
      bgm_score: Number(game.bgm_score),
      difficulties: difficultiesByGame.get(Number(game.id)) ?? [],
      is_active: Boolean(game.is_active),
      is_enabled: Boolean(game.is_enabled),
    }));
    res.attachment('games.json').json(exportedGames);
  })
);

router.post(
  '/games',
  adminWriteLimit,
  validateBody(gameSchema),
  asyncHandler(async (req, res) => {
    res.json({ id: await createGame(req.body) });
  })
);

router.put(
  '/games/:id',
  adminWriteLimit,
  validateParams(idParamsSchema),
  validateBody(gameUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    await updateGame(id, req.body);
    res.json({ ok: true });
  })
);

router.delete(
  '/games/:id',
  adminWriteLimit,
  validateParams(idParamsSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    await deleteGame(id);
    res.json({ ok: true });
  })
);

/** JSON 批量导入,按标题 upsert */
router.post(
  '/games/import',
  adminImportLimit,
  validateBody(gameImportSchema),
  asyncHandler(async (req, res) => {
    res.json(await importGames(req.body.games));
  })
);

router.patch(
  '/users/:id/leaderboard-visibility',
  adminWriteLimit,
  validateParams(idParamsSchema),
  validateBody(userLeaderboardVisibilitySchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const { hidden } = req.body as z.infer<typeof userLeaderboardVisibilitySchema>;
    const updated = await db('users').where({ id }).update({ leaderboard_hidden: hidden });
    if (!updated) throw new HttpError(404, 'USER_NOT_FOUND');
    await invalidateCached(
      ...allLeaderboardCacheKeys()
    );
    res.json({ id, leaderboardHidden: hidden });
  })
);

router.get(
  '/api-tokens',
  adminReadLimit,
  asyncHandler(async (req, res) => {
    res.json({ tokens: await listApiTokens(req.user!.id) });
  })
);

router.post(
  '/api-tokens',
  adminWriteLimit,
  validateBody(apiTokenCreateSchema),
  asyncHandler(async (req, res) => {
    const token = await createApiToken(
      req.user!.id,
      req.body.name,
      req.body.expiresInDays
    );
    res.status(201).json(token);
  })
);

router.delete(
  '/api-tokens/:id',
  adminWriteLimit,
  validateParams(idParamsSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    await revokeApiToken(req.user!.id, id);
    res.json({ ok: true });
  })
);

const announcementSchema = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(10000),
  is_popup: z.boolean().default(false),
});

router.post(
  '/announcements',
  adminWriteLimit,
  validateBody(announcementSchema),
  asyncHandler(async (req, res) => {
    const [id] = await db('announcements')
      .insert(req.body)
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));
    await invalidateCached('announcements');
    res.json({ id });
  })
);

router.delete(
  '/announcements/:id',
  adminWriteLimit,
  validateParams(idParamsSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const count = await db('announcements').where({ id }).del();
    if (!count) throw new HttpError(404, 'NOT_FOUND');
    await invalidateCached('announcements');
    res.json({ ok: true });
  })
);

router.post(
  '/resource-version/broadcast',
  adminResourceBroadcastLimit,
  validateBody(z.object({
    version: z.string().trim().regex(/^\d{13}$/),
  })),
  asyncHandler(async (req, res) => {
    const io = req.app.get('io') as Server | undefined;
    if (!io) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    const notice = await publishResourceVersion(req.body.version);
    io.emit('resource:version', notice);
    res.json(notice);
  })
);

export default router;
