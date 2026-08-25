/**
 * 随机抽样统计当前角色库中“有萌百条目”的比例。
 *
 * 判定规则与 fetchMzhCharacters.ts 一致：
 * 候选名先转简体、去空格，再用 opensearch 返回的标题做精确匹配。
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { normalizeSearchName } from './chineseNames';

const MZH_API_URL = 'https://mzh.moegirl.org.cn/api.php';
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

interface SampleItem {
  character_id: string;
  matched: boolean;
  mzh_title: string | null;
  names: string[];
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
    push(String(row.character_id), String(row.name), NAME_PRIORITY[String(row.lang)] ?? 0);
  }
  for (const row of aliases) {
    push(String(row.character_id), String(row.name), -1);
  }
  for (const list of byCharacter.values()) {
    list.sort((a, b) => b.priority - a.priority);
  }
  return byCharacter;
}

function parseSampleSize(): number {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--sample');
  if (index < 0 || !argv[index + 1]) return 100;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error('--sample 必须是正整数');
  return value;
}

async function main(): Promise<void> {
  const sampleSize = parseSampleSize();
  const rows = await db('characters')
    .select('id')
    .orderByRaw('RANDOM()')
    .limit(sampleSize);
  const candidates = await loadCandidates();

  console.log(`[mzh-coverage] 随机抽样 ${rows.length} 名角色`);

  const items: SampleItem[] = [];
  let index = 0;
  const workerCount = 4;

  const worker = async (): Promise<void> => {
    while (index < rows.length) {
      const current = index;
      index += 1;
      const characterId = String(rows[current].id);
      const list = candidates.get(characterId) ?? [];
      const names = list.slice(0, 5).map((candidate) => candidate.name);
      const normalizedCandidates = names.map(normalizeSearchName);

      let matchedTitle: string | null = null;
      for (const candidate of list.slice(0, 3)) {
        try {
          const titles = await openSearchTitles(candidate.name);
          const hit = titles.find((title) =>
            normalizedCandidates.includes(normalizeSearchName(title))
          );
          if (hit) {
            matchedTitle = hit;
            break;
          }
        } catch (err) {
          console.error(
            `[mzh-coverage] ${characterId} ${candidate.name}:`,
            err instanceof Error ? err.message : err
          );
        }
      }

      items.push({
        character_id: characterId,
        matched: matchedTitle !== null,
        mzh_title: matchedTitle,
        names,
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));

  const matched = items.filter((item) => item.matched).length;
  const percentage = ((matched / rows.length) * 100).toFixed(1);
  console.log(`[mzh-coverage] 有萌百条目: ${matched} / ${rows.length}（${percentage}%）`);

  const outputPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.devlogs',
    'mzh_coverage_sample.json'
  );
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2));
  console.log(`[mzh-coverage] 明细 -> ${outputPath}`);

  await db.destroy();
}

main().catch((err) => {
  console.error('[mzh-coverage] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
