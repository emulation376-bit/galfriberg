import { createHash, randomBytes } from 'crypto';
import { Knex } from 'knex';
import { db } from '../db/knex';
import {
  CharacterClue,
  CharacterVoiceActorClue,
  CharacterTraitClue,
} from './characterClues';
import { AttributeFeedback } from '../types';
import { staffFrequency } from './staffResolver';
import { traitFrequency } from './traitResolver';
import { characterImageUrl } from './characterImageService';
import { cached } from './queryCache';

export const CHARACTER_MAX_GUESSES = 8;

export interface CharacterGuessFeedback {
  guessId: string;
  image?: string | null;
  gameTitles: string[];
  releaseRange: {
    earliest: AttributeFeedback;
    latest: AttributeFeedback;
  };
  works: {
    level: 'correct' | 'close' | 'wrong';
    sameCompany: boolean;
    parts?: Array<{ name: string; matched: boolean }>;
    omitted?: number;
  };
  correct: boolean;
  nameLevel: 'correct' | 'close' | 'wrong';
  attributes: {
    sex: AttributeFeedback;
    birthday: AttributeFeedback;
    height: AttributeFeedback;
    age: AttributeFeedback;
    bgmScore: AttributeFeedback;
    difficulty: AttributeFeedback;
    clothes: AttributeFeedback;
    role: AttributeFeedback;
    hair: AttributeFeedback;
    body: AttributeFeedback;
    eyes: AttributeFeedback;
    voiceActor: AttributeFeedback;
  };
}

interface CharacterListEntry {
  id: string;
  name: string;
  names: string[];
  firstGame: {
    title: string;
    titleCn: string;
    releaseDate: string | null;
  } | null;
}

const NAME_PRIORITY = ['zh-Hans', 'zh-Hant', 'ja', 'en'];
const CUSTOM_POOL_TTL_MS = 30 * 60 * 1000;

const customPools = new Map<string, {
  characterIds: string[];
  maxGuesses: number;
  expiresAt: number;
}>();

function compareBgm(guess: number | null, target: number | null) {
  if (guess === target) return { value: guess ?? '-', level: 'correct' as const };
  if (guess == null || target == null) return { value: guess ?? '-', level: 'wrong' as const };
  const level = Math.abs(guess - target) <= 0.3 + 1e-9 ? 'close' : 'wrong';
  return {
    value: guess,
    level: level as 'close' | 'wrong',
    hint: target > guess ? ('higher' as const) : ('lower' as const),
  };
}

function compareNumber(guess: number | null, target: number | null, closeRange: number) {
  if (guess === target) return { value: guess ?? '-', level: 'correct' as const };
  if (guess == null || target == null) return { value: guess ?? '-', level: 'wrong' as const };
  const level = Math.abs(guess - target) <= closeRange + 1e-9 ? 'close' : 'wrong';
  return {
    value: guess,
    level: level as 'close' | 'wrong',
    hint: target > guess ? ('higher' as const) : ('lower' as const),
  };
}

function compareReleaseYear(guess: string | null, target: string | null): AttributeFeedback {
  const guessYear = guess ? Number(guess.slice(0, 4)) : null;
  const targetYear = target ? Number(target.slice(0, 4)) : null;
  if (guessYear === targetYear) return { value: guessYear ?? '-', level: 'correct' };
  if (guessYear == null || targetYear == null) return { value: guessYear ?? '-', level: 'wrong' };
  const level = Math.abs(guessYear - targetYear) <= 3 + 1e-9 ? 'close' : 'wrong';
  return {
    value: guessYear,
    level: level as 'close' | 'wrong',
    hint: targetYear > guessYear ? ('higher' as const) : ('lower' as const),
  };
}

function compareSet(guess: string[], target: string[]) {
  const guessSet = new Set(guess);
  const targetSet = new Set(target);
  const parts = [...guessSet].map((name) => ({ name, matched: targetSet.has(name) }));
  const level =
    guessSet.size === targetSet.size && [...guessSet].every((key) => targetSet.has(key))
      ? ('correct' as const)
      : [...guessSet].some((key) => targetSet.has(key))
        ? ('close' as const)
        : ('wrong' as const);
  return { value: guess.join('、'), level, parts };
}

function compareTraits(guess: CharacterTraitClue[], target: CharacterTraitClue[]) {
  const groups = ['Clothes', 'Role', 'Hair', 'Body', 'Eyes'] as const;
  const groupKey = {
    Clothes: 'clothes',
    Role: 'role',
    Hair: 'hair',
    Body: 'body',
    Eyes: 'eyes',
  } as const;
  const byGroup = (list: CharacterTraitClue[], group: string) =>
    list.filter((trait) => trait.groupName === group);

  const traits = {} as Pick<
    CharacterGuessFeedback['attributes'],
    'clothes' | 'role' | 'hair' | 'body' | 'eyes'
  >;
  for (const group of groups) {
    const guessTraits = byGroup(guess, group);
    const targetNames = new Set(byGroup(target, group).map((trait) => trait.traitName));
    // 展示优先级：命中必显示；其余按出现频率降序；再按原始顺序兜底。
    // 全部下发，由前端按阈值截断（前端保证发色恒显示）。
    const ranked = guessTraits
      .map((trait, index) => ({
        name: trait.traitName,
        matched: targetNames.has(trait.traitName),
        freq: traitFrequency(trait.traitId),
        index,
      }))
      .sort((a, b) => {
        if (a.matched !== b.matched) return a.matched ? -1 : 1;
        if (b.freq !== a.freq) return b.freq - a.freq;
        return a.index - b.index;
      });
    const parts = ranked.map(({ name, matched }) => ({ name, matched }));
    const value = guessTraits.map((trait) => trait.traitName).join('、');
    const guessSet = new Set(guessTraits.map((trait) => trait.traitName));
    const level =
      guessSet.size === targetNames.size && [...guessSet].every((name) => targetNames.has(name))
        ? ('correct' as const)
        : [...guessSet].some((name) => targetNames.has(name))
          ? ('close' as const)
          : ('wrong' as const);
    traits[groupKey[group]] = { value, level, parts };
  }
  return traits;
}

function compareVoiceActors(
  guess: CharacterVoiceActorClue[],
  target: CharacterVoiceActorClue[]
): AttributeFeedback {
  const targetStaff = new Set(target.map((actor) => actor.staffId));
  const ranked = guess
    .map((actor, index) => ({
      name: actor.name,
      matched: targetStaff.has(actor.staffId),
      freq: staffFrequency(actor.staffId),
      index,
    }))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      if (b.freq !== a.freq) return b.freq - a.freq;
      return a.index - b.index;
    });
  const visible = ranked.slice(0, 4);
  const omitted = ranked.length - visible.length;
  const parts = visible.map(({ name, matched }) => ({ name, matched }));
  const guessStaff = new Set(guess.map((actor) => actor.staffId));
  const level =
    guessStaff.size === targetStaff.size && [...guessStaff].every((id) => targetStaff.has(id))
      ? ('correct' as const)
      : [...guessStaff].some((id) => targetStaff.has(id))
        ? ('close' as const)
        : ('wrong' as const);
  return {
    value: guess.map((actor) => actor.name).join('、'),
    level,
    parts,
    ...(omitted > 0 ? { omitted } : {}),
  };
}

export function compareCharacterClues(
  guessId: string,
  guess: CharacterClue,
  target: CharacterClue
): CharacterGuessFeedback {
  const surnameMatch = Boolean(
    guess.surname && target.surname && guess.surname === target.surname
  );
  const givenNameMatch = Boolean(
    guess.givenName && target.givenName && guess.givenName === target.givenName
  );
  const releaseDates = guess.games
    .map((game) => game.releaseDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const targetReleaseDates = target.games
    .map((game) => game.releaseDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const guessWorks = guess.games.map((game) => game.gameId ?? game.title);
  const targetWorks = new Set(target.games.map((game) => game.gameId ?? game.title));
  const worksExact =
    guessWorks.length === targetWorks.size && guessWorks.every((key) => targetWorks.has(key));
  const sameCompany = guess.games.some((game) =>
    game.company && target.games.some((targetGame) => targetGame.company === game.company)
  );
  const rawParts = guess.games.map((game) => ({
    name: game.titleCn || game.title,
    matched: targetWorks.has(game.gameId ?? game.title),
  }));
  const visibleParts = rawParts.slice(0, 5);
  const omitted = rawParts.length - visibleParts.length;
  return {
    guessId,
    image: characterImageUrl(guess),
    gameTitles: guess.games.map((game) => game.titleCn || game.title),
    releaseRange: {
      earliest: compareReleaseYear(
        releaseDates[0] ?? null,
        targetReleaseDates[0] ?? null
      ),
      latest: compareReleaseYear(
        releaseDates[releaseDates.length - 1] ?? null,
        targetReleaseDates[targetReleaseDates.length - 1] ?? null
      ),
    },
    works: {
      level: worksExact ? 'correct' : sameCompany ? 'close' : 'wrong',
      sameCompany,
      parts: visibleParts,
      ...(omitted > 0 ? { omitted } : {}),
    },
    correct: guessId === target.id,
    nameLevel: guessId === target.id
      ? 'correct'
      : surnameMatch || givenNameMatch
        ? 'close'
        : 'wrong',
    attributes: {
      sex: {
        value: guess.sex ?? '-',
        level: guess.sex === target.sex ? 'correct' : 'wrong',
      },
      birthday: {
        value: guess.birthday ?? '-',
        level: guess.birthday === target.birthday ? 'correct' : 'wrong',
      },
      height: compareNumber(guess.height, target.height, 5),
      age: compareNumber(guess.age, target.age, 2),
      bgmScore: compareBgm(guess.bgmScore, target.bgmScore),
      difficulty: compareSet(guess.difficulties, target.difficulties),
      ...compareTraits(guess.traits, target.traits),
      voiceActor: compareVoiceActors(guess.voiceActors, target.voiceActors),
    },
  };
}

export async function listCharacters(instance: Knex = db): Promise<CharacterListEntry[]> {
  const [characters, names, aliasRows, appearanceRows] = await Promise.all([
    instance('characters').select('id', 'name_cn').orderBy('id'),
    instance('character_names').select('character_id', 'lang', 'name').orderBy('lang'),
    instance('character_aliases').select('character_id', 'name'),
    instance('character_game_appearances')
      .whereIn('role', ['main', 'primary'])
      .select('character_id', 'title', 'title_cn', 'release_date'),
  ]);

  const namesByCharacter = new Map<string, Map<string, string>>();
  for (const row of names) {
    const characterId = String(row.character_id);
    if (!namesByCharacter.has(characterId)) namesByCharacter.set(characterId, new Map());
    namesByCharacter.get(characterId)!.set(String(row.lang), String(row.name));
  }
  const searchNamesByCharacter = new Map<string, Set<string>>();
  for (const row of names) {
    const characterId = String(row.character_id);
    if (!searchNamesByCharacter.has(characterId)) searchNamesByCharacter.set(characterId, new Set());
    searchNamesByCharacter.get(characterId)!.add(String(row.name));
  }
  for (const row of aliasRows) {
    const characterId = String(row.character_id);
    if (!searchNamesByCharacter.has(characterId)) searchNamesByCharacter.set(characterId, new Set());
    searchNamesByCharacter.get(characterId)!.add(String(row.name));
  }

  const firstGameByCharacter = new Map<string, { title: string; titleCn: string; releaseDate: string | null }>();
  for (const row of appearanceRows) {
    const characterId = String(row.character_id);
    const entry = {
      title: String(row.title ?? ''),
      titleCn: String(row.title_cn ?? ''),
      releaseDate: row.release_date ? String(row.release_date) : null,
    };
    const current = firstGameByCharacter.get(characterId);
    if (!current || (entry.releaseDate ?? '9999') < (current.releaseDate ?? '9999')) {
      firstGameByCharacter.set(characterId, entry);
    }
  }

  return characters.map((character) => {
    const nameMap = namesByCharacter.get(String(character.id));
    const name =
      (character.name_cn ? String(character.name_cn) : null)
      ?? NAME_PRIORITY.map((lang) => nameMap?.get(lang)).find(Boolean)
      ?? nameMap?.values().next().value
      ?? String(character.id);
    const searchNames = [...new Set([
      ...(character.name_cn ? [String(character.name_cn)] : []),
      ...(searchNamesByCharacter.get(String(character.id)) ?? []),
    ])];
    return {
      id: String(character.id),
      name,
      names: searchNames,
      firstGame: firstGameByCharacter.get(String(character.id)) ?? null,
    };
  });
}

/** 运行时角色搜索列表缓存：角色数据只在导入时变化，60 秒 TTL 足够。 */
export function getCharacterSearchList(): Promise<CharacterListEntry[]> {
  return cached('characters:list:v2', 60, () => listCharacters());
}

export interface CharacterCustomFilter {
  minVotes?: number;
  minScore?: number;
  yearFrom?: number;
  yearTo?: number;
  maxGuesses?: number;
}

export async function createCustomCharacterPool(
  filter: CharacterCustomFilter,
  instance: Knex = db
): Promise<{ poolKey: string; count: number }> {
  let query = instance('game_titles').where('is_enabled', true).select('id');
  if (filter.minVotes != null) query = query.where('vote_count', '>=', filter.minVotes);
  if (filter.minScore != null) query = query.where('bgm_score', '>=', filter.minScore);
  if (filter.yearFrom != null) query = query.where('release_year', '>=', filter.yearFrom);
  if (filter.yearTo != null) query = query.where('release_year', '<=', filter.yearTo);
  const games = await query;
  const gameIds = games.map((game) => Number(game.id));
  const rows = gameIds.length
    ? await instance('game_characters').whereIn('game_id', gameIds).distinct('character_id')
    : [];
  const characterIds = rows.map((row) => String(row.character_id));
  const fingerprint = [
    filter.minVotes ?? '',
    filter.minScore ?? '',
    filter.yearFrom ?? '',
    filter.yearTo ?? '',
  ].join('|');
  const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  const poolKey = `cp_${randomBytes(8).toString('hex')}_${digest}`;
  customPools.set(poolKey, {
    characterIds,
    maxGuesses: filter.maxGuesses ?? CHARACTER_MAX_GUESSES,
    expiresAt: Date.now() + CUSTOM_POOL_TTL_MS,
  });
  return { poolKey, count: characterIds.length };
}

export async function pickCharacterTarget(
  instance: Knex = db,
  mode: 'beginner' | 'easy' | 'normal' | 'custom' = 'normal',
  targetId?: string,
  poolKey?: string
): Promise<{ targetId: string; maxGuesses: number }> {
  let pool: string[] = [];
  let maxGuesses = CHARACTER_MAX_GUESSES;
  if (mode === 'custom') {
    const poolEntry = customPools.get(poolKey ?? '');
    if (!poolEntry || Date.now() > poolEntry.expiresAt) {
      customPools.delete(poolKey ?? '');
      throw new Error('CUSTOM_POOL_NOT_FOUND');
    }
    pool = poolEntry.characterIds;
    maxGuesses = poolEntry.maxGuesses;
  } else if (mode === 'normal') {
    const rows = await instance('characters').select('id');
    pool = rows.map((row) => String(row.id));
  } else {
    const rows = await instance('game_characters')
      .join('game_difficulties', 'game_difficulties.game_id', 'game_characters.game_id')
      .where('difficulty_key', mode)
      .distinct('character_id');
    pool = rows.map((row) => String(row.character_id));
  }
  const target = targetId
      ? await instance('characters').where({ id: targetId }).first()
    : pool.length
      ? await instance('characters').whereIn('id', pool).orderByRaw('random()').first()
      : null;
  if (!target) throw new Error('CHARACTER_POOL_EMPTY');
  return { targetId: String(target.id), maxGuesses };
}
