import { Knex } from 'knex';
import { db } from '../db/knex';

export interface CharacterNameClue {
  lang: string;
  name: string;
  latin: string | null;
}

export interface CharacterTraitClue {
  traitId: string;
  traitName: string;
  groupId: string;
  groupName: string;
}

export interface CharacterVoiceActorClue {
  staffId: string;
  name: string;
}

export interface CharacterGameClue {
  gameId: number | null;
  title: string;
  titleCn: string;
  company: string;
  releaseDate: string | null;
  bgmScore: number;
  difficulties: string[];
}

export interface CharacterClue {
  id: string;
  nameCn: string | null;
  surname: string | null;
  givenName: string | null;
  image: string | null;
  ymgal_image?: string | null;
  sex: string | null;
  birthday: number | null;
  height: number | null;
  age: number | null;
  names: CharacterNameClue[];
  traits: CharacterTraitClue[];
  voiceActors: CharacterVoiceActorClue[];
  games: CharacterGameClue[];
  /** 当前以第一个关联作品作为主展示来源，后续前端如需切换可改用 games。 */
  bgmScore: number | null;
  difficulties: string[];
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export async function loadCharacterClue(
  characterId: string,
  instance: Knex = db
): Promise<CharacterClue | null> {
  const character = await instance('characters').where({ id: characterId }).first();
  if (!character) return null;

  const [nameRows, traitRows, voiceActorRows, appearanceRows] = await Promise.all([
    instance('character_names')
      .where({ character_id: characterId })
      .orderBy('lang') as Promise<Array<{ lang: string; name: string; latin: string | null }>>,
    instance('character_traits')
      .where({ character_id: characterId })
      .orderBy(['group_name', 'trait_name']) as Promise<
      Array<{ trait_id: string; trait_name: string; group_id: string; group_name: string }>
    >,
    instance('character_voice_actors')
      .where({ character_id: characterId })
      .orderBy('name') as Promise<Array<{ staff_id: string; name: string }>>,
    instance('character_game_appearances as cga')
      .leftJoin('game_titles as gt', 'gt.id', 'cga.game_id')
      .where({ 'cga.character_id': characterId })
      .select(
        'cga.game_id',
        'cga.title',
        'cga.title_cn',
        'cga.release_date',
        'cga.bgm_score',
        'gt.company as company'
      )
      .orderBy('cga.release_date') as Promise<
      Array<{
        game_id: number | null;
        title: string;
        title_cn: string;
        company: string | null;
        release_date: string | null;
        bgm_score: number;
      }>
    >,
  ]);

  const games = appearanceRows
    .map((game) => {
      return {
        gameId: game.game_id != null ? Number(game.game_id) : null,
        title: String(game.title ?? ''),
        titleCn: String(game.title_cn ?? ''),
        company: game.company ? String(game.company) : '',
        releaseDate: game.release_date ? String(game.release_date) : null,
        bgmScore: Number(game.bgm_score) || 0,
        difficulties: [] as string[],
      };
    })
    .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '') || a.title.localeCompare(b.title, 'zh-CN'));

  const primary = games[0] ?? null;

  return {
    id: String(character.id),
    nameCn: character.name_cn ? String(character.name_cn) : null,
    surname: character.surname ? String(character.surname) : null,
    givenName: character.given_name ? String(character.given_name) : null,
    image: character.image ? String(character.image) : null,
    ymgal_image: character.ymgal_image ? String(character.ymgal_image) : null,
    sex: character.sex ? String(character.sex) : null,
    birthday: numberOrNull(character.birthday),
    height: numberOrNull(character.height),
    age: numberOrNull(character.age),
    names: nameRows.map((row) => ({
      lang: row.lang,
      name: row.name,
      latin: row.latin ? String(row.latin) : null,
    })),
    traits: traitRows.map((row) => ({
      traitId: row.trait_id,
      traitName: row.trait_name,
      groupId: row.group_id,
      groupName: row.group_name,
    })),
    voiceActors: voiceActorRows.map((row) => ({
      staffId: row.staff_id,
      name: row.name,
    })),
    games,
    bgmScore: primary?.bgmScore ?? null,
    difficulties: primary?.difficulties ?? [],
  };
}
