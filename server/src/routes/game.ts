import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { validateBody, validateParams, asyncHandler, HttpError } from '../middleware/common';
import { GuessFeedback, GameTitle, displayName } from '../types';
import { compareGuess, MAX_GUESSES } from '../services/gameService';
import { displayStaff } from '../services/staffResolver';
import { getEnabledGame, getGame, isDifficultyAvailable, pickCachedTarget, createCustomPool, pickFromCustomPool } from '../services/playerCache';
import { rateLimit, requestIdentity } from '../middleware/rateLimit';
import { withKeyLock } from '../services/keyLock';
import { invalidateCached } from '../services/queryCache';
import {
  SingleGameMode,
  SingleGameState,
  createOrResumeSingleGame,
  deleteSingleGame,
  loadSingleGame,
  saveSingleGame,
} from '../services/singleGameStore';
import { shouldPersistSingleSettlement } from '../services/singleSettlementLimit';
import { leaderboardCacheKey } from '../services/leaderboardCache';
import {
  globalStatsCacheKeysForDifficulty,
  personalStatsCacheKeysForDifficulty,
} from '../services/statsCache';

const router = Router();
router.use(optionalAuth);
const gameIdParams = z.object({ id: z.string().uuid() });

function identity(req: { user?: { id: number }; guestKey?: string }) {
  if (req.user) {
    return { identityKey: `u:${req.user.id}`, userId: req.user.id, guestKey: null };
  }
  if (req.guestKey) {
    return { identityKey: `g:${req.guestKey}`, userId: null, guestKey: req.guestKey };
  }
  return null;
}

function answerView(target: GameTitle) {
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
    isSeries: Boolean(target.is_series),
    lengthMinutes: Number(target.length_minutes) || 0,
    tags: target.tags ?? [],
  };
}

function publicGuesses(game: SingleGameState): GuessFeedback[] {
  const target = getGame(game.targetGameId);
  return game.guesses.map((feedback) => {
    const guess = getGame(feedback.gameId);
    return guess && target ? compareGuess(guess, target) : feedback;
  });
}

async function loadOwnedGame(id: string, identityKey: string): Promise<SingleGameState> {
  const game = await loadSingleGame(id, identityKey);
  if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
  if (game.maxGuesses == null) game.maxGuesses = MAX_GUESSES;
  game.guesses = publicGuesses(game);
  return game;
}

async function settleGame(game: SingleGameState, status: 'won' | 'lost'): Promise<boolean> {
  // 自定义模式是过滤玩法，不计入难度排行榜与个人战绩
  const isCustom = game.mode === 'custom';
  const shouldPersist = !isCustom && await shouldPersistSingleSettlement(game.identityKey, game.id);
  if (shouldPersist) {
    await db('games')
      .insert({
        session_id: game.id,
        user_id: game.userId,
        guest_key: game.guestKey,
        target_game_id: game.targetGameId,
        mode: game.mode,
        guesses: JSON.stringify(game.guesses.map((guess) => guess.gameId)),
        first_guess_game_id: game.guesses[0]?.gameId ?? null,
        status,
        guess_count: game.guesses.length,
        created_at: new Date(game.createdAt),
        finished_at: db.fn.now(),
      })
      .onConflict('session_id')
      .ignore();
  }
  await deleteSingleGame(game);
  if (!shouldPersist) return false;
  const identityKey = game.userId != null ? `u:${game.userId}` : `g:${game.guestKey}`;
  await invalidateCached(
    leaderboardCacheKey('single', game.mode),
    ...personalStatsCacheKeysForDifficulty(identityKey, game.mode),
    ...globalStatsCacheKeysForDifficulty(game.mode),
    `room-player-performance:${identityKey}`
  );
  return true;
}

router.post(
  '/filter',
  rateLimit({
    name: 'game-filter',
    limit: 30,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateBody(z.object({
    minVotes: z.number().int().min(0).max(100000).optional(),
    minScore: z.number().min(0).max(10).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    maxGuesses: z.number().int().min(1).max(20).optional(),
  })),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const filter = {
      minVotes: req.body.minVotes,
      minScore: req.body.minScore,
      yearFrom: req.body.yearFrom,
      yearTo: req.body.yearTo,
      maxGuesses: req.body.maxGuesses,
    };
    const { poolKey, count } = createCustomPool(filter);
    res.json({ poolKey, count });
  })
);

router.post(
  '/start',
  rateLimit({
    name: 'game-start',
    limit: 10,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateBody(z.object({
    mode: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).default('beginner'),
    pool: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/).optional(),
  })),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const mode = req.body.mode as SingleGameMode;
    const poolKey = req.body.pool;
    let target: GameTitle | null = null;
    let maxGuesses = MAX_GUESSES;
    if (mode === 'custom') {
      if (!poolKey) throw new HttpError(400, 'CUSTOM_POOL_REQUIRED');
      const picked = pickFromCustomPool(poolKey);
      if (!picked) throw new HttpError(400, 'CUSTOM_POOL_EXPIRED');
      target = picked.game;
      maxGuesses = picked.maxGuesses;
    } else {
      if (!isDifficultyAvailable(mode)) throw new HttpError(400, 'DIFFICULTY_UNAVAILABLE');
      target = pickCachedTarget(mode);
    }
    if (!target) throw new HttpError(500, 'EMPTY_GAME_POOL');
    const response = await withKeyLock(`single-start:${owner.identityKey}:${mode}`, async () => {
      const game = await createOrResumeSingleGame({
        ...owner,
        mode,
        targetGameId: target.id,
        maxGuesses,
      });
      return {
        gameId: game.id,
        mode: game.mode,
        maxGuesses: game.maxGuesses,
        guesses: publicGuesses(game),
      };
    });
    res.json(response);
  })
);

router.post(
  '/:id/guess',
  rateLimit({
    name: 'game-guess',
    limit: 30,
    windowSeconds: 10,
    key: requestIdentity,
    failClosed: true,
  }),
  validateParams(gameIdParams),
  validateBody(z.object({ gameId: z.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = req.params.id;
    const response = await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadOwnedGame(gameId, owner.identityKey);
      const guess = getEnabledGame(req.body.gameId);
      if (!guess) throw new HttpError(404, 'TITLE_NOT_FOUND');
      const target = getGame(game.targetGameId);
      if (!target) throw new HttpError(500, 'INTERNAL_ERROR');
      if (game.guesses.some((item) => item.gameId === guess.id)) {
        throw new HttpError(400, 'ALREADY_GUESSED');
      }

      const feedback = compareGuess(guess, target);
      game.guesses.push(feedback);
      const finished = feedback.correct || game.guesses.length >= game.maxGuesses;
      const status = feedback.correct ? 'won' : finished ? 'lost' : 'playing';
      const recorded = finished
        ? await settleGame(game, feedback.correct ? 'won' : 'lost')
        : undefined;
      if (!finished) await saveSingleGame(game);

      return {
        feedback,
        status,
        guessCount: game.guesses.length,
        maxGuesses: game.maxGuesses,
        answer: finished ? answerView(target) : undefined,
        recorded,
      };
    });
    res.json(response);
  })
);

router.post(
  '/:id/giveup',
  rateLimit({
    name: 'game-giveup',
    limit: 15,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateParams(gameIdParams),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = req.params.id;
    const response = await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadOwnedGame(gameId, owner.identityKey);
      const target = getGame(game.targetGameId);
      if (!target) throw new HttpError(500, 'INTERNAL_ERROR');
      const recorded = await settleGame(game, 'lost');
      return { status: 'lost', answer: answerView(target), recorded };
    });
    res.json(response);
  })
);

router.post(
  '/:id/exit',
  validateParams(gameIdParams),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = req.params.id;
    await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadSingleGame(gameId, owner.identityKey);
      if (game) await deleteSingleGame(game);
    });
    res.json({ ok: true });
  })
);

export default router;
