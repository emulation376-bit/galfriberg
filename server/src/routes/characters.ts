import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validateBody, validateParams } from '../middleware/common';
import { optionalAuth } from '../middleware/auth';
import { rateLimit, requestIdentity } from '../middleware/rateLimit';
import { db } from '../db/knex';
import { loadCharacterClueCached } from '../services/characterClueCache';
import {
  compareCharacterClues,
  createCustomCharacterPool,
  getCharacterSearchList,
  pickCharacterTarget,
} from '../services/characterGame';
import {
  CharacterSingleGameState,
  createOrResumeCharacterGame,
  deleteCharacterGame,
  loadCharacterGame,
  saveCharacterGame,
} from '../services/characterSingleGameStore';
import { shouldPersistCharacterSettlement } from '../services/singleSettlementLimit';
import { withKeyLock } from '../services/keyLock';
import { invalidateCached } from '../services/queryCache';
import { leaderboardCacheKey } from '../services/leaderboardCache';
import {
  globalCharacterStatsCacheKeysForDifficulty,
  personalCharacterStatsCacheKeysForDifficulty,
} from '../services/statsCache';

const router = Router();
router.use(optionalAuth);

const characterParams = z.object({
  id: z.string().trim().min(1).max(64),
});

const guessParams = z.object({
  id: z.string().trim().min(1).max(64),
});

const guessBody = z.object({
  characterId: z.string().trim().min(1).max(64),
});

const startBody = z.object({
  mode: z.enum(['beginner', 'easy', 'normal', 'custom']).default('normal'),
  pool: z.string().optional(),
});

const filterBody = z.object({
  minVotes: z.number().int().min(0).max(100000).optional(),
  minScore: z.number().min(0).max(10).optional(),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
  maxGuesses: z.number().int().min(1).max(20).optional(),
});

function identity(req: { user?: { id: number }; guestKey?: string }) {
  if (req.user) {
    return { identityKey: `u:${req.user.id}`, userId: req.user.id, guestKey: null };
  }
  if (req.guestKey) {
    return { identityKey: `g:${req.guestKey}`, userId: null, guestKey: req.guestKey };
  }
  return null;
}

async function answerView(targetCharacterId: string) {
  const clue = await loadCharacterClueCached(targetCharacterId);
  if (!clue) throw new HttpError(500, 'INTERNAL_ERROR');
  return clue;
}

async function loadOwnedGame(
  id: string,
  identityKey: string
): Promise<CharacterSingleGameState> {
  const game = await loadCharacterGame(id, identityKey);
  if (!game) throw new HttpError(404, 'CHARACTER_GAME_NOT_FOUND');
  return game;
}

async function settleCharacterGame(
  game: CharacterSingleGameState,
  status: 'won' | 'lost'
): Promise<boolean> {
  const isCustom = game.mode === 'custom';
  const shouldPersist =
    !isCustom && await shouldPersistCharacterSettlement(game.identityKey, game.id);
  if (shouldPersist) {
    await db('character_games')
      .insert({
        session_id: game.id,
        user_id: game.userId,
        guest_key: game.guestKey,
        target_character_id: game.targetCharacterId,
        mode: game.mode,
        guesses: JSON.stringify(game.guesses.map((guess) => guess.guessId)),
        first_guess_character_id: game.guesses[0]?.guessId ?? null,
        status,
        guess_count: game.guesses.length,
        created_at: new Date(game.createdAt),
        finished_at: db.fn.now(),
      })
      .onConflict('session_id')
      .ignore();
  }
  await deleteCharacterGame(game);
  if (!shouldPersist) return false;
  const identityKey = game.userId != null ? `u:${game.userId}` : `g:${game.guestKey}`;
  await invalidateCached(
    leaderboardCacheKey('character', game.mode),
    ...globalCharacterStatsCacheKeysForDifficulty(game.mode),
    ...personalCharacterStatsCacheKeysForDifficulty(identityKey, game.mode)
  );
  return true;
}

function gameError(err: unknown): never {
  if (err instanceof Error && err.message === 'ALREADY_GUESSED') {
    throw new HttpError(400, 'ALREADY_GUESSED');
  }
  if (err instanceof Error && err.message.startsWith('CHARACTER_GAME_')) {
    throw new HttpError(err.message === 'CHARACTER_GAME_NOT_FOUND' ? 404 : 400, err.message);
  }
  if (err instanceof Error && err.message === 'CHARACTER_NOT_FOUND') {
    throw new HttpError(404, 'CHARACTER_NOT_FOUND');
  }
  if (err instanceof Error && err.message === 'CHARACTER_POOL_EMPTY') {
    throw new HttpError(500, 'EMPTY_GAME_POOL');
  }
  throw err;
}

router.get(
  '/list',
  asyncHandler(async (_req, res) => {
    res.json(await getCharacterSearchList());
  })
);

router.post(
  '/game/start',
  rateLimit({
    name: 'character-start',
    limit: 10,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateBody(startBody),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const mode = req.body.mode as 'beginner' | 'easy' | 'normal' | 'custom';
    const poolKey = req.body.pool;
    let selection;
    if (mode === 'custom' && !poolKey) {
      throw new HttpError(400, 'CUSTOM_POOL_REQUIRED');
    }
    try {
      selection = mode === 'custom'
        ? await pickCharacterTarget(db, mode, undefined, poolKey)
        : await pickCharacterTarget(db, mode);
    } catch (err) {
      if (err instanceof Error && err.message === 'CHARACTER_POOL_EMPTY') {
        throw new HttpError(500, 'EMPTY_GAME_POOL');
      }
      if (err instanceof Error && err.message === 'CUSTOM_POOL_NOT_FOUND') {
        throw new HttpError(400, 'CUSTOM_POOL_EXPIRED');
      }
      throw err;
    }
    const response = await withKeyLock(`character-start:${owner.identityKey}:${mode}`, async () => {
      const game = await createOrResumeCharacterGame({
        ...owner,
        mode,
        targetCharacterId: selection.targetId,
        maxGuesses: selection.maxGuesses,
      });
      return {
        gameId: game.id,
        mode: game.mode,
        maxGuesses: game.maxGuesses,
        guesses: game.guesses,
      };
    });
    res.json(response);
  })
);

router.post(
  '/filter',
  rateLimit({
    name: 'character-filter',
    limit: 30,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateBody(filterBody),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    res.json(await createCustomCharacterPool(req.body));
  })
);

router.post(
  '/game/:id/guess',
  rateLimit({
    name: 'character-guess',
    limit: 30,
    windowSeconds: 10,
    key: requestIdentity,
    failClosed: true,
  }),
  validateParams(guessParams),
  validateBody(guessBody),
  asyncHandler(async (req, res) => {
    try {
      const owner = identity(req);
      if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
      const gameId = req.params.id;
      const response = await withKeyLock(`character-game:${gameId}`, async () => {
        const game = await loadOwnedGame(gameId, owner.identityKey);
        if (game.guesses.some((item) => item.guessId === req.body.characterId)) {
          throw new HttpError(400, 'CHARACTER_ALREADY_GUESSED');
        }
        const guess = await loadCharacterClueCached(req.body.characterId);
        const target = await loadCharacterClueCached(game.targetCharacterId);
        if (!guess || !target) throw new HttpError(404, 'CHARACTER_NOT_FOUND');

        const feedback = compareCharacterClues(req.body.characterId, guess, target);
        game.guesses.push(feedback);
        const finished = feedback.correct || game.guesses.length >= game.maxGuesses;
        const status: 'won' | 'lost' | 'playing' = feedback.correct
          ? 'won'
          : finished
            ? 'lost'
            : 'playing';
        const recorded = finished
          ? await settleCharacterGame(game, status as 'won' | 'lost')
          : undefined;
        if (!finished) await saveCharacterGame(game);

        return {
          feedback,
          status,
          maxGuesses: game.maxGuesses,
          answer: finished ? await answerView(game.targetCharacterId) : undefined,
          recorded,
        };
      });
      res.json(response);
    } catch (err) {
      gameError(err);
    }
  })
);

router.post(
  '/game/:id/reveal',
  rateLimit({
    name: 'character-reveal',
    limit: 15,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  validateParams(guessParams),
  asyncHandler(async (req, res) => {
    try {
      const owner = identity(req);
      if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
      const gameId = req.params.id;
      const response = await withKeyLock(`character-game:${gameId}`, async () => {
        const game = await loadOwnedGame(gameId, owner.identityKey);
        const recorded = await settleCharacterGame(game, 'lost');
        return { status: 'lost', answer: await answerView(game.targetCharacterId), recorded };
      });
      res.json(response);
    } catch (err) {
      gameError(err);
    }
  })
);

router.post(
  '/game/:id/exit',
  validateParams(guessParams),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = req.params.id;
    await withKeyLock(`character-game:${gameId}`, async () => {
      const game = await loadCharacterGame(gameId, owner.identityKey);
      if (game) await deleteCharacterGame(game);
    });
    res.json({ ok: true });
  })
);

router.get(
  '/:id',
  validateParams(characterParams),
  asyncHandler(async (req, res) => {
    const clue = await loadCharacterClueCached(req.params.id);
    if (!clue) throw new HttpError(404, 'CHARACTER_NOT_FOUND');
    res.json(clue);
  })
);

export default router;
