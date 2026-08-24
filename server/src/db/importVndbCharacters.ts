/**
 * 从 VNDB dump 按现有 game_titles.vndb_id 导入角色及结构化属性。
 *
 * 只导入 main / primary 角色；chars_vns、chars_names、chars_alias、
 * image、sex、birthday、height、age 以及非性相关 trait 按整表重建方式入库，
 * 便于重复执行对齐 dump。trait 只保留 Clothes / Role / Hair / Body / Eyes 五类。
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';
import { unescape } from './vndbData';
import { invalidateCharacterClueCache } from '../services/characterClueCache';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VNDB_DIR = path.join(REPO_ROOT, 'VNDB', 'db');
const NULL = '\\N';
const ROLE_MERGE_FILE = path.join(REPO_ROOT, 'scripts', 'role_tag_merges.json');
const ROLE_TAG_MERGES = JSON.parse(fs.readFileSync(ROLE_MERGE_FILE, 'utf8')) as Record<string, string>;
const CLOTHES_KEEP_FILE = path.join(REPO_ROOT, 'scripts', 'clothes_keep_ids.json');
const CLOTHES_KEEP_IDS = new Set(
  Object.keys(JSON.parse(fs.readFileSync(CLOTHES_KEEP_FILE, 'utf8')) as Record<string, string>)
);

const VALID_ROLES = new Set(['main', 'primary']);
const ROLE_PRIORITY: Record<string, number> = { appears: 0, side: 0, primary: 1, main: 2 };
/** 视觉/语义重复的 tag：合并到保留项 */
const TRAIT_MERGE_MAP: Record<string, string> = {
  i1463: 'i998', // String Ribbon Tie -> Ribbon Tie
  i1060: 'i1061', // Ribbon Hair Accessory -> Ribbon Hair Tie
  i723: 'i3155', // Big Breast Sizes -> Big Breasts
  i3118: 'i502', // Tenth Grader -> High School Student
  i3119: 'i502', // Eleventh Grader -> High School Student
  i3120: 'i502', // Twelfth Grader -> High School Student
  i443: 'i442', // Classmate -> Schoolmate
  i1042: 'i310', // Ex-boyfriend -> Boyfriend
  i1561: 'i373', // Novelist -> Writer
  i613: 'i358', // Mentor -> Teacher
  i950: 'i160', // Blouse -> Shirt
  i162: 'i160', // T-shirt -> Shirt
  i541: 'i160', // Tank Top -> Shirt
  i138: 'i137', // Mini-dress -> Dress
  i1237: 'i141', // Furisode -> Kimono
  i954: 'i141', // Yukata -> Kimono
  i1568: 'i158', // Choker -> Necklace
  i920: 'i158', // Pendant Necklace -> Necklace
  i708: 'i146', // Monocle -> Glasses
  i1672: 'i456', // Zouri -> Sandals
  i831: 'i531', // Telepath -> Psychic
};
/** 个别角色低频 tag 强制保留（角色 -> tag id） */
const KEEP_TRAITS_BY_CHARACTER: Record<string, string[]> = {
  c94604: ['i1237', 'i1672'], // 雅·朝日奈：振袖、草履
};
/** 个别角色排除 tag（角色 -> tag id） */
const REMOVE_TRAITS_BY_CHARACTER: Record<string, string[]> = {
  c94604: ['i552'], // 雅·朝日奈：删除 Bikini
};
/** 全局删除的 tag */
const REMOVED_TRAIT_IDS = new Set([
  'i552', // Bikini
  'i922', // Hosome
  'i1414', // Jitome
  'i1171', // Round
  'i1566', // Sanpaku Eyes
  'i917', // Tareme
  'i918', // Tsurime
  'i158', // Necklace
  'i765', // Cuffs
]);
/** 眼睛颜色 tag：不受 5% 低频删除限制 */
const EYE_COLOR_TRAIT_IDS = new Set([
  'i108', // Amber
  'i109', // Black
  'i110', // Blue
  'i53', // Brown
  'i921', // Cyan
  'i906', // Garnet
  'i112', // Green
  'i111', // Grey
  'i113', // Hazel
  'i116', // Hidden
  'i727', // Pink
  'i115', // Red
  'i927', // Teal
  'i114', // Violet
]);

interface CharacterRow {
  id: string;
  name_cn: string | null;
  image: string | null;
  sex: string | null;
  birthday: number | null;
  height: number | null;
  age: number | null;
}

interface CharacterNameRow {
  character_id: string;
  lang: string;
  name: string;
  latin: string | null;
}

interface CharacterAliasRow {
  character_id: string;
  name: string;
  latin: string | null;
  spoil: number;
}

interface CharacterVoiceActorRow {
  character_id: string;
  staff_id: string;
  name: string;
}

interface CharacterGameAppearanceRow {
  character_id: string;
  vndb_vid: string;
  role: string;
  spoil: number;
  game_id: number | null;
  title: string;
  title_cn: string;
  release_date: string | null;
  bgm_score: number;
}

interface GameCharacterRow {
  game_id: number;
  character_id: string;
  role: string;
  spoil: number;
  vndb_vid: string;
}

interface CharacterTraitRow {
  character_id: string;
  trait_id: string;
  trait_name: string;
  group_id: string;
  group_name: string;
}

const TARGET_TRAIT_GROUPS = new Set(['i1', 'i35', 'i36', 'i37', 'i40']);

function textOrNull(raw: string): string | null {
  const value = unescape(raw);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function positiveIntOrNull(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const KANA_ONLY = /[\u3040-\u30ff\u31f0-\u31ff]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function pickName(name: string | null, latin: string | null): string {
  if (name && CJK.test(name)) return name;
  return latin || name || '';
}

function isPureKanaName(name: string): boolean {
  return KANA_ONLY.test(name) && !HAN.test(name);
}

function formatReleaseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === NULL || value === '0' || value.length !== 8) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function readLines(fileName: string): string[] {
  return fs.readFileSync(path.join(VNDB_DIR, fileName), 'utf8').split('\n');
}

async function main(): Promise<void> {
  await ensureSchema();

  // 1. 本地作品 -> VNDB vid
  const games = await db('game_titles')
    .select('id', 'vndb_id', 'title', 'title_cn', 'bgm_score', 'release_year')
    .whereNotNull('vndb_id');
  const gameIdByVndb = new Map<string, number>();
  const localGameByVndb = new Map<string, {
    game_id: number;
    title: string;
    title_cn: string;
    bgm_score: number;
    release_year: number;
  }>();
  for (const game of games) {
    const vndbId = String(game.vndb_id).trim();
    if (!vndbId || gameIdByVndb.has(vndbId)) continue;
    gameIdByVndb.set(vndbId, Number(game.id));
    localGameByVndb.set(vndbId, {
      game_id: Number(game.id),
      title: String(game.title ?? ''),
      title_cn: String(game.title_cn ?? ''),
      bgm_score: Number(game.bgm_score) || 0,
      release_year: Number(game.release_year) || 0,
    });
  }
  console.log(`[vndb-characters] 本地作品: ${games.length}，含 vndb_id 可关联: ${gameIdByVndb.size}`);

  const titleByVid = new Map<string, { title: string; score: number }>();
  for (const line of readLines('vn_titles')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 4) continue;
    const vid = c[0];
    const lang = c[1];
    const official = c[2];
    const title = unescape(c[3]);
    if (!title) continue;
    const score = (lang === 'ja' ? 2 : lang === 'en' ? 1 : 0) + (official === 't' ? 1 : 0);
    const current = titleByVid.get(vid);
    if (!current || score > current.score) {
      titleByVid.set(vid, { title, score });
    }
  }

  const vidByRelease = new Map<string, string>();
  for (const line of readLines('releases_vn')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length >= 2) vidByRelease.set(c[0], c[1]);
  }
  const releaseDateByVid = new Map<string, string>();
  for (const line of readLines('releases')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 3) continue;
    const rid = c[0];
    const vid = vidByRelease.get(rid);
    const date = formatReleaseDate(c[3]);
    if (!vid || !date) continue;
    const current = releaseDateByVid.get(vid);
    if (!current || date < current) releaseDateByVid.set(vid, date);
  }

  // 2. chars_vns：只保留 main/primary；同一（游戏, 角色）取更高角色级别与最低剧透等级
  const relationByKey = new Map<string, GameCharacterRow>();
  const characterIds = new Set<string>();
  for (const line of readLines('chars_vns')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 5) continue;
    const cid = c[0];
    const vid = c[1];
    const role = c[3];
    const spoil = Number(c[4]);
    if (!VALID_ROLES.has(role) || !gameIdByVndb.has(vid) || !Number.isInteger(spoil)) continue;

    const gameId = gameIdByVndb.get(vid)!;
    characterIds.add(cid);
    const key = `${gameId}:${cid}`;
    const current = relationByKey.get(key);
    const nextRole = !current || (ROLE_PRIORITY[role] ?? 0) > (ROLE_PRIORITY[current.role] ?? 0)
      ? role
      : current.role;
    const nextSpoil = current ? Math.min(current.spoil, spoil) : spoil;
    relationByKey.set(key, {
      game_id: gameId,
      character_id: cid,
      role: nextRole,
      spoil: nextSpoil,
      vndb_vid: vid,
    });
  }
  // 3. chars：选取 id / image / sex / birthday / height / age
  const characters = new Map<string, CharacterRow>();
  for (const line of readLines('chars')) {
    if (!line) continue;
    const c = line.split('\t');
    const cid = c[0];
    if (!characterIds.has(cid)) continue;
    characters.set(cid, {
      id: cid,
      name_cn: null,
      image: textOrNull(c[1]),
      sex: textOrNull(c[4]),
      birthday: positiveIntOrNull(c[13]),
      height: positiveIntOrNull(c[14]),
      age: positiveIntOrNull(c[16]),
    });
  }
  const existingNameCn = new Map<string, string>();
  for (const row of await db('characters').select('id', 'name_cn').whereNotNull('name_cn')) {
    existingNameCn.set(String(row.id), String(row.name_cn));
  }
  let removedPureKana = 0;
  for (const cid of [...characters.keys()]) {
    const name = existingNameCn.get(cid) ?? '';
    if (!name || isPureKanaName(name)) {
      characters.delete(cid);
      removedPureKana += 1;
    }
  }
  if (removedPureKana > 0) {
    console.log(`[vndb-characters] 剔除无 BGM 名称/纯假名角色: ${removedPureKana}`);
  }
  const relations = [...relationByKey.values()].filter((relation) =>
    characters.has(relation.character_id)
  );
  console.log(
    `[vndb-characters] main/primary 关系: ${relations.length}，涉及角色 ${characters.size}`
  );

  // 4. traits：只保留五个展示大类、非性相关、非剧透、非谎报的 tag
  const traitsById = new Map<string, { name: string | null; gid: string | null; sexual: boolean }>();
  for (const line of readLines('traits')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 8) continue;
    traitsById.set(c[0], {
      name: unescape(c[7]),
      gid: c[1] === NULL ? null : c[1],
      sexual: c[4] === 't',
    });
  }

  const characterTraits: CharacterTraitRow[] = [];
  const seenTraits = new Set<string>();
  const roleMergedTraitKeys = new Set<string>();
  for (const line of readLines('chars_traits')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 4 || !characters.has(c[0])) continue;
    const cid = c[0];
    const originalTid = c[1];
    let tid = originalTid;
    const spoil = Number(c[2]);
    const lie = c[3] === 't';
    if (TRAIT_MERGE_MAP[tid] || ROLE_TAG_MERGES[tid]) {
      tid = TRAIT_MERGE_MAP[tid] ?? ROLE_TAG_MERGES[tid];
    }
    const trait = traitsById.get(tid);
    if (!trait || !trait.gid || !TARGET_TRAIT_GROUPS.has(trait.gid)) continue;
    if (trait.gid === 'i35' && !EYE_COLOR_TRAIT_IDS.has(tid)) continue;
    if (trait.sexual || lie || !Number.isInteger(spoil) || spoil !== 0) continue;
    if (REMOVED_TRAIT_IDS.has(tid)) continue;
    if (REMOVE_TRAITS_BY_CHARACTER[cid]?.includes(tid)) continue;
    if (ROLE_TAG_MERGES[originalTid]) {
      roleMergedTraitKeys.add(`${cid}:${tid}`);
    }

    const key = `${cid}:${tid}`;
    if (seenTraits.has(key)) continue;
    seenTraits.add(key);
    characterTraits.push({
      character_id: cid,
      trait_id: tid,
      trait_name: trait.name ?? tid,
      group_id: trait.gid,
      group_name: traitsById.get(trait.gid)?.name ?? trait.gid,
    });
  }
  console.log(`[vndb-characters] traits 命中: ${characterTraits.length} 条`);

  // 4.1 低频 tag 精简：出现率 < 5% 的 tag 默认剔除，但若该 tag 是某角色某大类的
  //     唯一防空 tag，则保留，避免删除后出现新的大类空组。
  const totalCharacters = characters.size;
  const traitCharacterCounts = new Map<string, number>();
  for (const trait of characterTraits) {
    traitCharacterCounts.set(trait.trait_id, (traitCharacterCounts.get(trait.trait_id) ?? 0) + 1);
  }
  const highFrequencyTraits = new Set<string>();
  for (const [traitId, count] of traitCharacterCounts) {
    if (count / totalCharacters >= 0.05) highFrequencyTraits.add(traitId);
  }
  for (const traitId of EYE_COLOR_TRAIT_IDS) {
    highFrequencyTraits.add(traitId);
  }
  for (const traitId of CLOTHES_KEEP_IDS) {
    highFrequencyTraits.add(traitId);
  }
  const highGroupKeys = new Set<string>();
  for (const trait of characterTraits) {
    if (highFrequencyTraits.has(trait.trait_id)) {
      highGroupKeys.add(`${trait.character_id}:${trait.group_id}`);
    }
  }
  const requiredLowTraitKeys = new Set<string>();
  for (const trait of characterTraits) {
    if (
      !highFrequencyTraits.has(trait.trait_id)
      && !highGroupKeys.has(`${trait.character_id}:${trait.group_id}`)
    ) {
      requiredLowTraitKeys.add(`${trait.character_id}:${trait.trait_id}`);
    }
  }
  for (const [characterId, traitIds] of Object.entries(KEEP_TRAITS_BY_CHARACTER)) {
    for (const traitId of traitIds) {
      requiredLowTraitKeys.add(`${characterId}:${traitId}`);
    }
  }
  for (const key of roleMergedTraitKeys) {
    requiredLowTraitKeys.add(key);
  }
  const keptTraits = characterTraits.filter(
    (trait) =>
      highFrequencyTraits.has(trait.trait_id)
      || requiredLowTraitKeys.has(`${trait.character_id}:${trait.trait_id}`)
  );
  console.log(
    `[vndb-characters] traits 精简: 高频 ${highFrequencyTraits.size}，保留防空低频 ${requiredLowTraitKeys.size}，保留 ${keptTraits.length}/${characterTraits.length} 条`
  );
  characterTraits.length = 0;
  characterTraits.push(...keptTraits);

  // 4.2 声优：staff 主名优先，别名回退
  const staffMainAid = new Map<string, number>();
  for (const line of readLines('staff')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[0] && c[3] && c[3] !== NULL) staffMainAid.set(c[0], Number(c[3]));
  }
  const aliasByAid = new Map<number, { staffId: string; name: string | null; latin: string | null }>();
  for (const line of readLines('staff_alias')) {
    if (!line) continue;
    const c = line.split('\t');
    const aid = Number(c[1]);
    if (!c[0] || !Number.isInteger(aid)) continue;
    aliasByAid.set(aid, {
      staffId: c[0],
      name: unescape(c[2]),
      latin: c[3] !== undefined ? unescape(c[3]) : null,
    });
  }
  const voiceActorByCharacter = new Map<string, Map<string, string>>();
  for (const line of readLines('vn_seiyuu')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 3 || !characters.has(c[1])) continue;
    const cid = c[1];
    const aid = Number(c[2]);
    const alias = aliasByAid.get(aid);
    if (!alias) continue;
    const mainAid = staffMainAid.get(alias.staffId);
    const mainAlias = mainAid != null ? aliasByAid.get(mainAid) : undefined;
    const displayName = pickName(
      mainAlias?.name ?? alias.name,
      mainAlias?.latin ?? alias.latin
    );
    if (!displayName) continue;
    if (!voiceActorByCharacter.has(cid)) voiceActorByCharacter.set(cid, new Map());
    voiceActorByCharacter.get(cid)!.set(alias.staffId, displayName);
  }
  const voiceActors: CharacterVoiceActorRow[] = [];
  for (const [cid, actors] of voiceActorByCharacter) {
    for (const [staffId, name] of actors) {
      voiceActors.push({ character_id: cid, staff_id: staffId, name });
    }
  }
  voiceActors.sort((a, b) =>
    a.character_id.localeCompare(b.character_id, 'en')
    || a.name.localeCompare(b.name, 'zh-CN')
  );
  console.log(`[vndb-characters] 声优记录: ${voiceActors.length} 条，覆盖角色 ${voiceActorByCharacter.size}`);

  // 4.3 全部参演作品：包含 main/primary/side/appears，并按作品发行日期排序
  const appearancesByKey = new Map<string, CharacterGameAppearanceRow>();
  for (const line of readLines('chars_vns')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 5 || !characters.has(c[0])) continue;
    const cid = c[0];
    const vid = c[1];
    const role = c[3];
    const spoil = Number(c[4]);
    const key = `${cid}:${vid}`;
    const current = appearancesByKey.get(key);
    const nextPriority = ROLE_PRIORITY[role] ?? 0;
    const currentPriority = current ? ROLE_PRIORITY[current.role] ?? 0 : -1;
    if (current && (nextPriority < currentPriority || (nextPriority === currentPriority && spoil >= current.spoil))) {
      continue;
    }
    const local = localGameByVndb.get(vid);
    const title = local?.title || titleByVid.get(vid)?.title || vid;
    appearancesByKey.set(key, {
      character_id: cid,
      vndb_vid: vid,
      role,
      spoil: Number.isInteger(spoil) ? spoil : 0,
      game_id: local?.game_id ?? null,
      title,
      title_cn: local?.title_cn ?? '',
      release_date: releaseDateByVid.get(vid) ?? null,
      bgm_score: local?.bgm_score ?? 0,
    });
  }
  const appearances = [...appearancesByKey.values()].sort((a, b) => {
    const dateA = releaseDateByVid.get(a.vndb_vid) ?? '';
    const dateB = releaseDateByVid.get(b.vndb_vid) ?? '';
    return dateA.localeCompare(dateB) || a.title.localeCompare(b.title, 'zh-CN');
  });
  console.log(`[vndb-characters] 参演作品: ${appearances.length} 条，覆盖角色 ${new Set(appearances.map((a) => a.character_id)).size}`);

  // 5. chars_names / chars_alias
  const names: CharacterNameRow[] = [];
  for (const line of readLines('chars_names')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 4 || !characters.has(c[0])) continue;
    const name = unescape(c[2]);
    if (!name) continue;
    names.push({
      character_id: c[0],
      lang: c[1],
      name,
      latin: c[3] !== undefined ? unescape(c[3]) : null,
    });
  }

  const aliases: CharacterAliasRow[] = [];
  for (const line of readLines('chars_alias')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 4 || !characters.has(c[0])) continue;
    const name = unescape(c[2]);
    if (!name) continue;
    const spoil = Number(c[1]);
    if (!Number.isInteger(spoil)) continue;
    aliases.push({
      character_id: c[0],
      name,
      latin: c[3] !== undefined ? unescape(c[3]) : null,
      spoil,
    });
  }
  console.log(`[vndb-characters] names ${names.length} 条，aliases ${aliases.length} 条`);

  // 6. 整表重建（子表先删，再写字符主表）
  await db.transaction(async (trx) => {
    await trx('character_traits').delete();
    await trx('character_voice_actors').delete();
    await trx('character_game_appearances').delete();
    await trx('character_aliases').delete();
    await trx('character_names').delete();
    await trx('game_characters').delete();
    await trx('characters').delete();

    const characterRows = [...characters.values()].map((character) => ({
      ...character,
      name_cn: existingNameCn.get(character.id) ?? null,
    }));
    for (let i = 0; i < characterRows.length; i += 500) {
      await trx('characters').insert(characterRows.slice(i, i + 500));
    }
    for (let i = 0; i < names.length; i += 500) {
      await trx('character_names').insert(names.slice(i, i + 500));
    }
    for (let i = 0; i < aliases.length; i += 500) {
      await trx('character_aliases').insert(aliases.slice(i, i + 500));
    }
    for (let i = 0; i < relations.length; i += 500) {
      await trx('game_characters').insert(relations.slice(i, i + 500));
    }
    for (let i = 0; i < characterTraits.length; i += 500) {
      await trx('character_traits').insert(characterTraits.slice(i, i + 500));
    }
    for (let i = 0; i < voiceActors.length; i += 500) {
      await trx('character_voice_actors').insert(voiceActors.slice(i, i + 500));
    }
    for (let i = 0; i < appearances.length; i += 500) {
      await trx('character_game_appearances').insert(appearances.slice(i, i + 500));
    }
  });

  const coveredGames = new Set(relations.map((r) => r.game_id)).size;
  const mainCount = relations.filter((r) => r.role === 'main').length;
  const primaryCount = relations.filter((r) => r.role === 'primary').length;
  const withImage = [...characters.values()].filter((c) => c.image).length;
  const withBirthday = [...characters.values()].filter((c) => c.birthday != null).length;
  const withHeight = [...characters.values()].filter((c) => c.height != null).length;
  const withAge = [...characters.values()].filter((c) => c.age != null).length;
  const withSex = [...characters.values()].filter((c) => c.sex).length;
  const traitGroups = new Set(characterTraits.map((t) => t.group_id)).size;

  console.log(`\n[vndb-characters] 完成:`);
  console.log(`  角色 ${characters.size}，覆盖作品 ${coveredGames} / ${gameIdByVndb.size}`);
  console.log(`  关系: main ${mainCount}，primary ${primaryCount}`);
  console.log(`  属性: image ${withImage}，sex ${withSex}，birthday ${withBirthday}，height ${withHeight}，age ${withAge}`);
  console.log(`  traits: ${characterTraits.length} 条，覆盖组 ${traitGroups}/5`);
  console.log(`  声优: ${voiceActors.length} 条，覆盖角色 ${voiceActorByCharacter.size}`);
  console.log(`  参演作品: ${appearances.length} 条，覆盖角色 ${new Set(appearances.map((a) => a.character_id)).size}`);

  await invalidateCharacterClueCache();
  await db.destroy();
}

main().catch((err) => {
  console.error('[vndb-characters] 导入失败:', err);
  process.exit(1);
});
