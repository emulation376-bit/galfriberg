import { GuessFeedback } from '../types';
import { createSessionStore, SessionBase } from './singleSessionStore';

export type SingleGameMode = string;

export interface SingleGameState extends SessionBase {
  targetGameId: number;
  maxGuesses: number;
  guesses: GuessFeedback[];
}

// Active single-player games expire after thirty minutes without a write/guess.
// This is also the retention window used by the online single-game counter.
export const SINGLE_GAME_TTL_SECONDS = 1800;

const store = createSessionStore<SingleGameState>({
  gamePrefix: 'single:game',
  activePrefix: 'single:active',
  presenceKey: 'presence:single',
  ttlSeconds: SINGLE_GAME_TTL_SECONDS,
});

export async function createOrResumeSingleGame(input: {
  identityKey: string;
  userId: number | null;
  guestKey: string | null;
  mode: SingleGameMode;
  targetGameId: number;
  maxGuesses: number;
}): Promise<SingleGameState> {
  return store.createOrResume({
    identityKey: input.identityKey,
    userId: input.userId,
    guestKey: input.guestKey,
    mode: input.mode,
    make: () => ({ targetGameId: input.targetGameId, maxGuesses: input.maxGuesses, guesses: [] }),
  });
}

export async function loadSingleGame(
  id: string,
  identityKey: string,
  touch = false
): Promise<SingleGameState | null> {
  return store.load(id, identityKey, touch);
}

export async function saveSingleGame(game: SingleGameState): Promise<void> {
  await store.save(game);
}

export async function deleteSingleGame(game: SingleGameState): Promise<void> {
  await store.delete(game);
}
