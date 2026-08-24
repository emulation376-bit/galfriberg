import type { CharacterGuessFeedback } from './characterGame';
import { createSessionStore, SessionBase } from './singleSessionStore';

export interface CharacterSingleGameState extends SessionBase {
  targetCharacterId: string;
  maxGuesses: number;
  guesses: CharacterGuessFeedback[];
}

export const CHARACTER_GAME_TTL_SECONDS = 30 * 60;

const store = createSessionStore<CharacterSingleGameState>({
  gamePrefix: 'char-single:game',
  activePrefix: 'char-single:active',
  presenceKey: 'presence:single',
  ttlSeconds: CHARACTER_GAME_TTL_SECONDS,
});

export async function createOrResumeCharacterGame(input: {
  identityKey: string;
  userId: number | null;
  guestKey: string | null;
  mode: string;
  targetCharacterId: string;
  maxGuesses: number;
}): Promise<CharacterSingleGameState> {
  return store.createOrResume({
    identityKey: input.identityKey,
    userId: input.userId,
    guestKey: input.guestKey,
    mode: input.mode,
    make: () => ({
      targetCharacterId: input.targetCharacterId,
      maxGuesses: input.maxGuesses,
      guesses: [],
    }),
  });
}

export async function loadCharacterGame(
  id: string,
  identityKey: string,
  touch = false
): Promise<CharacterSingleGameState | null> {
  return store.load(id, identityKey, touch);
}

export async function saveCharacterGame(
  game: CharacterSingleGameState
): Promise<void> {
  await store.save(game);
}

export async function deleteCharacterGame(
  game: CharacterSingleGameState
): Promise<void> {
  await store.delete(game);
}
