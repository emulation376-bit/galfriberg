/**
 * 从 Bangumi character.jsonlines 检索当前角色的简体中文名，写入 characters.name_cn。
 *
 * 匹配口径：角色名 / 别名（含日文、中文、英文、罗马字）与 BGM 的 name / 简体中文名 / 别名
 * 做 NFKC + 去空白标点归一化精确匹配；多个命中优先取带简体中文名的条目。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { db } from './knex';
import { ensureSchema } from './schema';
import { invalidateCharacterClueCache } from '../services/characterClueCache';

const BGM_PATH =
  process.env.BGM_CHARACTER_PATH
  ?? 'C:\\Users\\emulation\\Desktop\\bgm_archive\\character.jsonlines';

interface BgmCharacterEntry {
  id: string;
  name: string;
  nameCn: string | null;
}

function norm(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\-‐–—―~～〜·・:：;；,，。.．!！?？'"“”\[\]（）()【】「」『』<>《》&＆＊*/\\+＋=＝_｜|]+/g, '');
}

function parseNameCn(infobox: string): string | null {
  const match = infobox.match(/\|\s*简体中文名\s*=\s*([^|\r\n]+)/);
  const value = match?.[1]?.trim();
  return value || null;
}

function parseAliases(infobox: string): string[] {
  const block = infobox.match(/别名\s*=\s*\{(.*?)\}/s);
  if (!block) return [];
  const aliases: string[] = [];
  for (const match of block[1].matchAll(/\[([^\[\]]*)\]/g)) {
    const content = match[1];
    const separator = content.indexOf('|');
    const value = (separator >= 0 ? content.slice(separator + 1) : content).trim();
    if (value) aliases.push(value);
  }
  return aliases;
}

async function loadBgmIndex(): Promise<Map<string, BgmCharacterEntry[]>> {
  const index = new Map<string, BgmCharacterEntry[]>();
  const input = fs.createReadStream(BGM_PATH, 'utf8');
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = String(entry.name ?? '').trim();
    const nameCn = parseNameCn(String(entry.infobox ?? ''));
    const candidates = [name, ...(nameCn ? [nameCn] : []), ...parseAliases(String(entry.infobox ?? ''))];
    const seen = new Set<string>();
    const record: BgmCharacterEntry = {
      id: String(entry.id ?? ''),
      name,
      nameCn,
    };
    for (const candidate of candidates) {
      const key = norm(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(record);
    }
  }
  return index;
}

async function main(): Promise<void> {
  await ensureSchema();
  if (!fs.existsSync(BGM_PATH)) {
    throw new Error(`BGM_CHARACTER_FILE_NOT_FOUND: ${BGM_PATH}`);
  }

  const [index, nameRows, aliasRows, characterRows] = await Promise.all([
    loadBgmIndex(),
    db('character_names').select('character_id', 'name'),
    db('character_aliases').select('character_id', 'name'),
    db('characters').select('id'),
  ]);

  const namesByCharacter = new Map<string, string[]>();
  for (const row of nameRows) {
    const characterId = String(row.character_id);
    if (!namesByCharacter.has(characterId)) namesByCharacter.set(characterId, []);
    namesByCharacter.get(characterId)!.push(String(row.name));
  }
  for (const row of aliasRows) {
    const characterId = String(row.character_id);
    if (!namesByCharacter.has(characterId)) namesByCharacter.set(characterId, []);
    namesByCharacter.get(characterId)!.push(String(row.name));
  }

  const nameCnById = new Map<string, string>();
  const unmatched: string[] = [];
  for (const character of characterRows) {
    const characterId = String(character.id);
    let best: BgmCharacterEntry | null = null;
    for (const name of namesByCharacter.get(characterId) ?? []) {
      const entries = index.get(norm(name));
      if (!entries?.length) continue;
      if (!best) best = entries[0];
      const withChinese = entries.find((entry) => entry.nameCn);
      if (withChinese) {
        best = withChinese;
        break;
      }
    }
    if (best) nameCnById.set(characterId, best.nameCn ?? best.name);
    else unmatched.push(characterId);
  }

  const entries = [...nameCnById];
  await db.transaction(async (trx) => {
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500).map(([id, name]) => ({ id, name_cn: name }));
      await trx('characters').insert(chunk).onConflict('id').merge(['name_cn']);
    }
  });

  console.log(`[bgm-names] 角色: ${characterRows.length}`);
  console.log(`[bgm-names] 命中简体中文名: ${nameCnById.size}，未命中: ${unmatched.length}`);
  if (unmatched.length) {
    console.log(`[bgm-names] 未命中角色: ${unmatched.join(', ')}`);
  }
  await invalidateCharacterClueCache();
  await db.destroy();
}

main().catch((error) => {
  console.error('[bgm-names] 导入失败:', error);
  process.exit(1);
});
