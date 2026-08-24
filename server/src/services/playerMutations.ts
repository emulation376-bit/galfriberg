import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../db/knex';
import { isKnownDifficultyKey } from '../difficulties';
import { HttpError } from '../middleware/common';
import { invalidateGameCache } from './playerCache';

const difficultyKeySchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
const difficultyListSchema = z.array(difficultyKeySchema)
  .min(1)
  .max(20)
  .refine((keys) => new Set(keys).size === keys.length);

export const gameSchema = z.object({
  title: z.string().trim().min(1).max(128),
  title_cn: z.string().trim().max(128).default(''),
  release_year: z.number().int().min(0).max(2100).default(0),
  company: z.string().trim().max(128).default(''),
  is_r18: z.boolean().default(false),
  scenario_writer: z.string().trim().max(1024).default(''),
  music_composer: z.string().trim().max(1024).default(''),
  artist: z.string().trim().max(1024).default(''),
  voice_actor: z.string().trim().max(1024).default(''),
  bgm_score: z.number().min(0).max(10).default(0),
  is_active: z.boolean().default(true),
  is_enabled: z.boolean().default(true),
  difficulties: difficultyListSchema.optional(),
});

export const importedGameSchema = gameSchema.extend({
  is_enabled: z.boolean().optional(),
  is_easy: z.boolean().optional(),
});

export const gameUpdateSchema = gameSchema.partial()
  .refine((values) => Object.keys(values).length > 0);

export const gameImportSchema = z.object({
  games: z.array(importedGameSchema)
    .min(1)
    .max(1000)
    .refine((games) => new Set(games.map((game) => game.title)).size === games.length),
});

export type GameInput = z.infer<typeof gameSchema>;
export type GameUpdateInput = z.infer<typeof gameUpdateSchema>;
export type ImportedGameInput = z.infer<typeof importedGameSchema>;

function assertDifficultyKeys(keys: string[]): void {
  const unique = [...new Set(keys)];
  if (unique.some((key) => !isKnownDifficultyKey(key))) {
    throw new HttpError(400, 'INVALID_DIFFICULTY');
  }
}

async function replaceGameDifficulties(
  executor: Knex | Knex.Transaction,
  gameId: number,
  keys: string[]
): Promise<void> {
  const unique = [...new Set(keys)];
  await executor('game_difficulties').where({ game_id: gameId }).del();
  if (unique.length) {
    await executor('game_difficulties').insert(
      unique.map((key) => ({ game_id: gameId, difficulty_key: key }))
    );
  }
}

export async function createGame(input: GameInput): Promise<number> {
  const exists = await db('game_titles').where({ title: input.title }).first('id');
  if (exists) throw new HttpError(409, 'TITLE_TAKEN');
  const difficulties = input.difficulties ?? ['normal'];
  assertDifficultyKeys(difficulties);
  const { difficulties: _difficulties, ...values } = input;
  const id = await db.transaction(async (trx) => {
    const [createdId] = await trx('game_titles')
      .insert(values)
      .returning('id')
      .then((rows) => rows.map((row: unknown) => (
        typeof row === 'object' && row !== null && 'id' in row ? row.id : row
      )));
    const gameId = Number(createdId);
    await replaceGameDifficulties(trx, gameId, difficulties);
    return gameId;
  });
  await invalidateGameCache();
  return id;
}

export async function updateGame(id: number, input: GameUpdateInput): Promise<void> {
  const { difficulties, ...values } = input;
  if (difficulties) assertDifficultyKeys(difficulties);
  await db.transaction(async (trx) => {
    const exists = await trx('game_titles').where({ id }).first('id');
    if (!exists) throw new HttpError(404, 'GAME_NOT_FOUND');
    if (Object.keys(values).length) await trx('game_titles').where({ id }).update(values);
    if (difficulties) await replaceGameDifficulties(trx, id, difficulties);
  });
  await invalidateGameCache();
}

export async function deleteGame(id: number): Promise<void> {
  const game = await db('game_titles').where({ id }).first('id', 'is_enabled');
  if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
  if (Boolean(game.is_enabled)) throw new HttpError(409, 'GAME_MUST_BE_DISABLED');
  const used = await db('games').where({ target_game_id: id }).first('id');
  if (used) throw new HttpError(409, 'GAME_HAS_HISTORY');
  const count = await db('game_titles').where({ id }).del();
  if (!count) throw new HttpError(404, 'GAME_NOT_FOUND');
  await invalidateGameCache();
}

export async function importGames(
  games: ImportedGameInput[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (trx) => {
    const titles = games.map((game) => game.title);
    const existing = await trx('game_titles')
      .whereIn('title', titles)
      .select('id', 'title', 'is_enabled');
    const existingNames = new Set(existing.map((game) => String(game.title)));
    const existingEnabled = new Map(
      existing.map((game) => [String(game.title), Boolean(game.is_enabled)])
    );
    updated = games.filter((game) => existingNames.has(game.title)).length;
    created = games.length - updated;
    const desiredDifficulties = new Map<string, string[] | null>();
    const importedGames = games.map((game) => {
      const { difficulties, is_easy, ...values } = game;
      const desired = difficulties
        ?? (is_easy !== undefined
          ? [
            'normal',
            ...(is_easy ? ['easy'] : []),
            ...(is_easy ? ['beginner'] : []),
          ]
          : null)
        ?? (existingNames.has(game.title) ? null : ['normal']);
      desiredDifficulties.set(game.title, desired);
      return {
        ...values,
        is_enabled: game.is_enabled ?? existingEnabled.get(game.title) ?? true,
      };
    });
    assertDifficultyKeys([...new Set(
      [...desiredDifficulties.values()].flatMap((keys) => keys ?? [])
    )]);
    const chunkSize = 200;
    for (let index = 0; index < importedGames.length; index += chunkSize) {
      await trx('game_titles')
        .insert(importedGames.slice(index, index + chunkSize))
        .onConflict('title')
        .merge();
    }
    const savedGames = await trx('game_titles')
      .whereIn('title', titles)
      .select('id', 'title');
    const replacementIds: number[] = [];
    const replacementMemberships: Array<{ game_id: number; difficulty_key: string }> = [];
    for (const game of savedGames) {
      const difficulties = desiredDifficulties.get(String(game.title));
      if (!difficulties) continue;
      const gameId = Number(game.id);
      replacementIds.push(gameId);
      replacementMemberships.push(
        ...[...new Set(difficulties)].map((difficultyKey) => ({
          game_id: gameId,
          difficulty_key: difficultyKey,
        }))
      );
    }
    if (replacementIds.length) {
      await trx('game_difficulties').whereIn('game_id', replacementIds).del();
      for (let index = 0; index < replacementMemberships.length; index += 500) {
        await trx('game_difficulties').insert(replacementMemberships.slice(index, index + 500));
      }
    }
  });
  await invalidateGameCache();
  return { created, updated };
}
