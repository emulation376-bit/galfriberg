/**
 * 按角色名抓取萌百字段。
 *
 * 萌百 API 会拒掉 search/parse/revisions，但 opensearch 和普通页面 HTML 可用，
 * 因此这里用 opensearch 定位标题，再抓渲染后的 HTML infobox。
 * 只落库 姓名/性别/年龄/身高/发色/瞳色/声优/所属作品/萌点，不保存快照和时间戳。
 *
 * 用法：pnpm --filter server fetch-mzh-characters [--limit 50]
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';
import { parseMzhFieldsFromHtml, type MzhCharacterFields } from './mzhFields';
import { normalizeSearchName } from './chineseNames';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const MZH_API_URL = 'https://mzh.moegirl.org.cn/api.php';
const MZH_HTML_URL = 'https://mzh.moegirl.org.cn/index.php';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 csgofriberg';

const NAME_PRIORITY: Record<string, number> = {
  'zh-Hans': 4,
  'zh-Hant': 3,
  ja: 2,
  en: 1,
  ru: 0,
};

interface CandidateName {
  name: string;
  priority: number;
}

function parseLimit(): number | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--limit');
  if (index < 0 || !argv[index + 1]) return undefined;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--limit 必须是正整数');
  }
  return value;
}

function normalizeTitle(value: string): string {
  return normalizeSearchName(value)
    .replace(/[（）]/g, (ch) => (ch === '（' ? '(' : ')'))
    ;
}

async function openSearchTitles(name: string): Promise<string[]> {
  const body = new URLSearchParams({
    action: 'opensearch',
    search: name,
    limit: '5',
    format: 'json',
  });
  const response = await fetch(MZH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': USER_AGENT,
    },
    body,
  });
  if (!response.ok) throw new Error(`opensearch HTTP ${response.status}`);
  const data = (await response.json()) as [string, string[], string[], string[]];
  return data[1] ?? [];
}

async function fetchPageHtml(title: string): Promise<string> {
  const url = new URL(MZH_HTML_URL);
  url.searchParams.set('title', title);
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
    },
  });
  if (!response.ok) throw new Error(`页面 HTTP ${response.status}`);
  return await response.text();
}

function pickTitle(
  titles: string[],
  candidates: string[],
  gameTitles: string[]
): string | null {
  const normalizedCandidates = candidates.map(normalizeTitle);
  const normalizedGames = gameTitles.map(normalizeTitle);

  let best: string | null = null;
  let bestScore = 0;
  for (const rawTitle of titles) {
    const title = normalizeTitle(rawTitle);
    let score = 0;
    if (normalizedCandidates.includes(title)) score += 100;
    else if (
      normalizedCandidates.some((candidate) => title.includes(candidate) || candidate.includes(title)) &&
      normalizedGames.some((game) => title.includes(game))
    ) {
      score += 70;
    }
    if (score > bestScore) {
      best = rawTitle;
      bestScore = score;
    }
  }

  if (!best) return null;
  const accepted = bestScore >= 70;
  return accepted ? best : null;
}

async function loadCandidates(): Promise<Map<string, CandidateName[]>> {
  const names = await db('character_names').select('character_id', 'lang', 'name');
  const aliases = await db('character_aliases').select('character_id', 'name');
  const byCharacter = new Map<string, CandidateName[]>();

  const push = (characterId: string, name: string, priority: number): void => {
    const clean = String(name).trim();
    if (!clean) return;
    const list = byCharacter.get(characterId) ?? [];
    if (!list.some((entry) => entry.name === clean)) list.push({ name: clean, priority });
    byCharacter.set(characterId, list);
  };

  for (const row of names) {
    push(
      String(row.character_id),
      String(row.name),
      NAME_PRIORITY[String(row.lang)] ?? 0
    );
  }
  for (const row of aliases) {
    push(String(row.character_id), String(row.name), -1);
  }
  for (const list of byCharacter.values()) {
    list.sort((a, b) => b.priority - a.priority);
  }
  return byCharacter;
}

async function loadGameTitlesByCharacter(): Promise<Map<string, string[]>> {
  const relations = await db('game_characters').select('character_id', 'game_id');
  const games = await db('game_titles').select('id', 'title', 'title_cn');
  const titleByGameId = new Map<number, string[]>();
  for (const game of games) {
    const titles: string[] = [];
    for (const title of [game.title, game.title_cn]) {
      const clean = String(title ?? '').trim();
      if (clean) titles.push(clean);
    }
    titleByGameId.set(Number(game.id), titles);
  }

  const byCharacter = new Map<string, string[]>();
  for (const relation of relations) {
    const characterId = String(relation.character_id);
    const titles = titleByGameId.get(Number(relation.game_id)) ?? [];
    const current = byCharacter.get(characterId) ?? [];
    for (const title of titles) {
      if (!current.includes(title)) current.push(title);
    }
    byCharacter.set(characterId, current);
  }
  return byCharacter;
}

async function fetchCharacter(
  characterId: string,
  candidates: CandidateName[],
  gameTitles: string[]
): Promise<'matched' | 'no-fields' | 'unmatched'> {
  const candidateNames = candidates.map((candidate) => candidate.name);

  for (const candidate of candidates.slice(0, 5)) {
    let titles: string[];
    let html: string;
    let pickedTitle: string | null = null;
    try {
      titles = await openSearchTitles(candidate.name);
      const picked = pickTitle(titles, candidateNames, gameTitles);
      if (!picked) continue;
      pickedTitle = picked;
      html = await fetchPageHtml(picked);
    } catch (err) {
      console.error(`[mzh-fetch] ${candidate.name}:`, err instanceof Error ? err.message : err);
      continue;
    }

    const fields = parseMzhFieldsFromHtml(html);
    if (Object.keys(fields).length === 0) {
      console.warn(`[mzh-fetch] 无字段: ${candidate.name} -> ${pickedTitle}`);
      return 'no-fields';
    }
    if (!fields.name) fields.name = candidate.name;
    if (!fields.series && gameTitles.length > 0) fields.series = gameTitles[0];

    await db('character_mzh_fields')
      .insert({
        character_id: characterId,
        mzh_title: pickedTitle,
        ...(fields satisfies MzhCharacterFields),
      })
      .onConflict('character_id')
      .merge();
    return 'matched';
  }
  return 'unmatched';
}

async function main(): Promise<void> {
  const limit = parseLimit();
  await ensureSchema();

  let characterQuery = db('characters').select('id').orderBy('id');
  if (limit) characterQuery = characterQuery.limit(limit);
  const characterRows = await characterQuery;
  const candidates = await loadCandidates();
  const gameTitlesByCharacter = await loadGameTitlesByCharacter();

  console.log(`[mzh-fetch] 待抓角色: ${characterRows.length}`);

  let matched = 0;
  let noFields = 0;
  let unmatched = 0;
  const unmatchedList: Array<{ character_id: string; names: string[] }> = [];

  for (let i = 0; i < characterRows.length; i += 1) {
    const characterId = String(characterRows[i].id);
    const characterCandidates = candidates.get(characterId) ?? [];
    const gameTitles = gameTitlesByCharacter.get(characterId) ?? [];
    const status = await fetchCharacter(characterId, characterCandidates, gameTitles);

    if (status === 'matched') matched += 1;
    else if (status === 'no-fields') noFields += 1;
    else {
      unmatched += 1;
      unmatchedList.push({
        character_id: characterId,
        names: characterCandidates.map((candidate) => candidate.name),
      });
    }

    if ((i + 1) % 50 === 0 || i + 1 === characterRows.length) {
      console.log(`[mzh-fetch] 进度 ${i + 1}/${characterRows.length}: matched=${matched}, noFields=${noFields}, unmatched=${unmatched}`);
    }
    await sleep(300);
  }

  console.log(`\n[mzh-fetch] 完成: matched=${matched}, noFields=${noFields}, unmatched=${unmatched}`);
  if (unmatchedList.length > 0) {
    fs.writeFileSync(
      path.join(__dirname, '..', '..', '..', 'mzh_characters_unmatched.json'),
      JSON.stringify(unmatchedList, null, 2)
    );
    console.log(`[mzh-fetch] 未匹配列表 -> mzh_characters_unmatched.json`);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error('[mzh-fetch] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
