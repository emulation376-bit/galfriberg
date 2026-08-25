/**
 * VNDB 转储共享读取逻辑（只读，纯函数）。
 *
 * 逻辑来源（原样提取）：
 *  - importVndbStaff.ts 的 unescape/pickName/norm/ROLE_TO_COL/matchVn/声优过滤
 *  - importStaffAliases.ts 的 staff+staff_alias → staff_aliases 行构造
 * 供 buildImportCsv.ts / importAll.ts 复用。
 */

import * as fs from 'fs';
import * as path from 'path';

/** PostgreSQL COPY 格式字段反转义：\N → null，其余反斜杠转义还原 */
export function unescape(field: string): string | null {
  if (field === '\\N') return null;
  let out = '';
  for (let i = 0; i < field.length; i++) {
    if (field[i] === '\\' && i + 1 < field.length) {
      const n = field[++i];
      if (n === 't') out += '\t';
      else if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n === 'v') out += '\v';
      else if (n === '\\') out += '\\';
      else out += n;
    } else {
      out += field[i];
    }
  }
  return out;
}

const CJK = /[\u3040-ヿ一-鿿\uff00-\uffef]/;

/** 显示名优先原名（含日/中字符），否则罗马字 */
export function pickName(name: string | null, latin: string | null): string {
  if (name && CJK.test(name)) return name;
  return latin || name || '';
}

/** VNDB role → 本地列。严格对应：songs/director/staff/翻译/qa/editor 等不入列 */
export const ROLE_TO_COL: Record<string, 'scenario_writer' | 'music_composer' | 'artist'> = {
  scenario: 'scenario_writer',
  music: 'music_composer',
  art: 'artist',
  chardesign: 'artist',
};

export const STAFF_COLUMNS = ['scenario_writer', 'music_composer', 'artist'] as const;

/** 归一化：全角→半角、统一引号/破折号/波浪线并去空白 */
export function norm(s: string): string {
  return s
    .toLocaleLowerCase()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[‘’“”「」"'"«»]/g, '"')
    .replace(/[‐‑‒–—―−ー]/g, '-')
    .replace(/[〜～∼ヽ]/g, '~')
    .replace(/\s+/g, '');
}

export interface StaffAlias {
  staff_id: string;
  name: string;
  latin: string | null;
}

export interface VnStaffRow {
  aid: number;
  role: string;
}

export interface VoiceRow {
  cid: string;
  aid: number;
  /** 是否主机移植版(console)声优；原版优先，仅当角色无原版声优时才回退使用 */
  console: boolean;
}

export interface VoiceData {
  /** cid(vid) → 主要/次要角色 cid（main/primary 且非剧透） */
  charCidsByVn: Map<string, Set<string>>;
  /** vid → 声优行（去重后） */
  voiceByVn: Map<string, VoiceRow[]>;
}

export interface VnTitleIndex {
  exact: Map<string, string>;
  normIndex: Map<string, Set<string>>;
}

export interface VnExtraData {
  /** vid -> 是否含性内容（该 VN 任意 release has_ero=t 即为 true；全部未知则无条目） */
  eroByVn: Map<string, boolean>;
  /** vid -> 开发者名单（只取最早 complete release 的开发方；名称优先 latin/英文，原名兜底） */
  developerByVn: Map<string, string[]>;
  /** vid -> 游玩时长（分钟，c_length；0/未知则无条目） */
  lengthByVn: Map<string, number>;
}

export interface StaffFields {
  scenario_writer: string[];
  music_composer: string[];
  artist: string[];
  voice_actor: string[];
}

/** staff_alias: aid → {staff_id, name, latin} */
export function loadStaffAliasByAid(dbDir: string): Map<number, StaffAlias> {
  const aliasByAid = new Map<number, StaffAlias>();
  for (const line of fs.readFileSync(path.join(dbDir, 'staff_alias'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const aid = Number(c[1]);
    aliasByAid.set(aid, {
      staff_id: c[0],
      name: unescape(c[2]) ?? '',
      latin: c[3] !== undefined ? unescape(c[3]) : null,
    });
  }
  return aliasByAid;
}

/** vn_staff: vid → [{aid, role}]（只保留目标角色） */
export function loadVnStaffByVn(dbDir: string): Map<string, VnStaffRow[]> {
  const vnStaffByVn = new Map<string, VnStaffRow[]>();
  for (const line of fs.readFileSync(path.join(dbDir, 'vn_staff'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const role = c[2];
    if (!ROLE_TO_COL[role]) continue;
    if (!vnStaffByVn.has(vid)) vnStaffByVn.set(vid, []);
    vnStaffByVn.get(vid)!.push({ aid: Number(c[1]), role });
  }
  return vnStaffByVn;
}

/** 声优数据：主要角色（main/primary、spoil='0'）× vn_seiyuu（去重） */
export function loadVoiceData(dbDir: string): VoiceData {
  const charCidsByVn = new Map<string, Set<string>>();
  for (const line of fs.readFileSync(path.join(dbDir, 'chars_vns'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const role = c[3];
    const spoil = c[4];
    if (role !== 'main' && role !== 'primary') continue;
    if (spoil !== '0') continue;
    const vid = c[1];
    if (!charCidsByVn.has(vid)) charCidsByVn.set(vid, new Set());
    charCidsByVn.get(vid)!.add(c[0]);
  }
  const voiceByVn = new Map<string, VoiceRow[]>();
  const seenVoiceInput = new Set<string>();
  for (const line of fs.readFileSync(path.join(dbDir, 'vn_seiyuu'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const cid = c[1];
    const aid = Number(c[2]);
    // vn_seiyuu 第4列为备注，'console' 表示仅主机移植版声优；原版优先。
    const note = (c[3] ?? '').trim().toLowerCase();
    const isConsole = note === 'console';
    // 去重键必须含 vid：同一角色+声优会在多个 vn 出现（系列作/多版本共用角色），
    // 若只按 cid:aid 去重会把后续 vn 的声优行吞掉，导致那些作品声优列为空。
    const key = `${vid}:${cid}:${aid}`;
    if (seenVoiceInput.has(key)) continue;
    seenVoiceInput.add(key);
    if (!voiceByVn.has(vid)) voiceByVn.set(vid, []);
    voiceByVn.get(vid)!.push({ cid, aid, console: isConsole });
  }
  return { charCidsByVn, voiceByVn };
}

/** VNDB 标题索引：精确 + 归一化 + 前缀 */
export function loadVnTitleIndex(dbDir: string): VnTitleIndex {
  const exact = new Map<string, string>();
  const normIndex = new Map<string, Set<string>>();
  const addKey = (key: string, vid: string) => {
    const lk = key.toLocaleLowerCase();
    if (!exact.has(lk)) exact.set(lk, vid);
    const nk = norm(key);
    if (nk) {
      if (!normIndex.has(nk)) normIndex.set(nk, new Set());
      normIndex.get(nk)!.add(vid);
    }
  };
  for (const line of fs.readFileSync(path.join(dbDir, 'vn_titles'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const title = unescape(c[3]);
    const latin = unescape(c[4]);
    if (title) addKey(title, vid);
    if (latin) addKey(latin, vid);
  }
  for (const line of fs.readFileSync(path.join(dbDir, 'vn'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const aliases = unescape(c[11]);
    if (!aliases) continue;
    for (const a of aliases.split('\n')) {
      const t = a.trim();
      if (t) addKey(t, vid);
    }
  }
  return { exact, normIndex };
}

/**
 * 读取 VNDB 的 releases / releases_vn / releases_producers / producers，
 * 得到每个 VN 的：
 *  - has_ero（含性内容 → R18 判定，按用户口径优先于 minage）
 *  - developer（品牌/开发方）
 */
export function loadVnExtraData(dbDir: string): VnExtraData {
  // releases: id=0, released=3, has_ero=17
  const eroByRelease = new Map<string, boolean>();
  const releasedByRelease = new Map<string, number>();
  for (const line of fs.readFileSync(path.join(dbDir, 'releases'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const ero = c[17];
    if (ero === 't' || ero === 'f') eroByRelease.set(c[0], ero === 't');
    const rel = c[3];
    releasedByRelease.set(
      c[0],
      rel !== '\\N' && rel ? Number(rel) : Number.MAX_SAFE_INTEGER,
    );
  }

  // producers: id=0, name=3, latin=4
  const producerName = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(dbDir, 'producers'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    // 品牌优先英文名（latin），无 latin 时回退原名
    producerName.set(c[0], unescape(c[4]) || unescape(c[3]) || '');
  }

  // releases_producers: id=0, pid=1, developer=2, publisher=3
  const developerByRelease = new Map<string, string[]>();
  for (const line of fs.readFileSync(path.join(dbDir, 'releases_producers'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[2] !== 't') continue;
    const name = producerName.get(c[1]);
    if (!name) continue;
    if (!developerByRelease.has(c[0])) developerByRelease.set(c[0], []);
    const arr = developerByRelease.get(c[0])!;
    if (!arr.includes(name)) arr.push(name);
  }

  // releases_vn: id=0, vid=1, rtype=2
  const perVn = new Map<
    string,
    { eroAnyT: boolean; eroAnyF: boolean; complete: Array<{ rid: string; released: number }> }
  >();
  for (const line of fs.readFileSync(path.join(dbDir, 'releases_vn'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[1];
    const entry = perVn.get(vid) ?? { eroAnyT: false, eroAnyF: false, complete: [] };
    const ero = eroByRelease.get(c[0]);
    if (ero === true) entry.eroAnyT = true;
    else if (ero === false) entry.eroAnyF = true;
    if (c[2] === 'complete') {
      entry.complete.push({ rid: c[0], released: releasedByRelease.get(c[0]) ?? Number.MAX_SAFE_INTEGER });
    }
    perVn.set(vid, entry);
  }

  const eroByVn = new Map<string, boolean>();
  const developerByVn = new Map<string, string[]>();
  for (const [vid, entry] of perVn) {
    if (entry.eroAnyT) eroByVn.set(vid, true);
    else if (entry.eroAnyF) eroByVn.set(vid, false);
    const names: string[] = [];
    for (const r of entry.complete.sort((a, b) => a.released - b.released)) {
      const devs = developerByRelease.get(r.rid) ?? [];
      if (devs.length > 0) {
        names.push(...devs);
        break;
      }
    }
    if (names.length) developerByVn.set(vid, names);
  }

  // vn: id=0, ..., c_length=7（分钟；\\N 表示未知）
  const lengthByVn = new Map<string, number>();
  for (const line of fs.readFileSync(path.join(dbDir, 'vn'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const raw = c[7];
    if (raw && raw !== '\\N') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) lengthByVn.set(c[0], n);
    }
  }
  return { eroByVn, developerByVn, lengthByVn };
}

/** 匹配作品 → vnId；返回 null 表示未匹配 */
export function matchVn(
  title: string,
  titleCn: string,
  aliases: string[],
  exact: Map<string, string>,
  normIndex: Map<string, Set<string>>,
): string | null {
  const cands = [title, titleCn, ...aliases].map((s) => String(s).toLocaleLowerCase()).filter(Boolean);
  for (const k of cands) {
    const vid = exact.get(k);
    if (vid) return vid;
  }
  for (const s of [title, titleCn, ...aliases]) {
    const nk = norm(String(s));
    if (!nk) continue;
    const vids = normIndex.get(nk);
    if (vids && vids.size === 1) return [...vids][0];
  }
  const gNorm = norm(title);
  if (gNorm.length >= 2) {
    const hits = new Set<string>();
    for (const [nk, vids] of normIndex) {
      if (vids.size !== 1) continue;
      if (nk.length > gNorm.length && nk.startsWith(gNorm)) {
        for (const v of vids) hits.add(v);
      }
    }
    if (hits.size === 1) return [...hits][0];
  }
  return null;
}

/** 按 vnId 解析四个 staff 字段（按 staff 身份去重，声优限主要角色且非剧透） */
export function resolveStaffForVn(
  vid: string,
  vnStaffByVn: Map<string, VnStaffRow[]>,
  voiceData: VoiceData,
  aliasByAid: Map<number, StaffAlias>,
): StaffFields {
  const names: Record<'scenario_writer' | 'music_composer' | 'artist', string[]> = {
    scenario_writer: [],
    music_composer: [],
    artist: [],
  };
  const seen: Record<string, Set<string>> = {
    scenario_writer: new Set(),
    music_composer: new Set(),
    artist: new Set(),
  };
  for (const s of vnStaffByVn.get(vid) ?? []) {
    const col = ROLE_TO_COL[s.role];
    const alias = aliasByAid.get(s.aid);
    if (!alias || !alias.name) continue;
    const key = alias.staff_id;
    if (seen[col].has(key)) continue;
    seen[col].add(key);
    names[col].push(pickName(alias.name, alias.latin));
  }
  const voices: string[] = [];
  const seenVoice = new Set<string>();
  // 按角色分组，优先取原版(non-console)声优；若某角色仅有主机版声优则回退使用。
  const byCid = new Map<string, VoiceRow[]>();
  for (const row of voiceData.voiceByVn.get(vid) ?? []) {
    if (!voiceData.charCidsByVn.get(vid)?.has(row.cid)) continue;
    if (!byCid.has(row.cid)) byCid.set(row.cid, []);
    byCid.get(row.cid)!.push(row);
  }
  for (const rows of byCid.values()) {
    const pick = rows.find((r) => !r.console) ?? rows[0];
    const alias = aliasByAid.get(pick.aid);
    if (!alias || !alias.name) continue;
    const key = alias.staff_id;
    if (seenVoice.has(key)) continue;
    seenVoice.add(key);
    voices.push(pickName(alias.name, alias.latin));
  }
  return { ...names, voice_actor: voices };
}

export interface StaffAliasRow {
  aid: number;
  staff_id: string;
  name: string;
  latin: string | null;
  main_name: string;
}

/** staff + staff_alias → staff_aliases 行（主名用 staff.main 解析，CJK 优先） */
export function buildStaffAliasRows(dbDir: string): { rows: StaffAliasRow[]; skipped: number } {
  const staffFile = path.join(dbDir, 'staff');
  const aliasFile = path.join(dbDir, 'staff_alias');
  if (!fs.existsSync(staffFile) || !fs.existsSync(aliasFile)) {
    throw new Error(`未找到 ${dbDir} 下的 staff / staff_alias 文件`);
  }

  const staffMain = new Map<string, number>();
  for (const line of fs.readFileSync(staffFile, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[0] && c[3] && c[3] !== '\\N') staffMain.set(c[0], Number(c[3]));
  }

  interface AliasRow {
    staffId: string;
    aid: number;
    name: string | null;
    latin: string | null;
  }
  const aliasRows: AliasRow[] = [];
  const byAid = new Map<number, { name: string | null; latin: string | null }>();
  for (const line of fs.readFileSync(aliasFile, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const row: AliasRow = {
      staffId: c[0],
      aid: Number(c[1]),
      name: unescape(c[2]),
      latin: c[3] !== undefined ? unescape(c[3]) : null,
    };
    aliasRows.push(row);
    byAid.set(row.aid, { name: row.name, latin: row.latin });
  }

  const rows: StaffAliasRow[] = [];
  let skipped = 0;
  for (const row of aliasRows) {
    if (!row.name) {
      skipped += 1;
      continue;
    }
    const mainAid = staffMain.get(row.staffId);
    const mainRow = mainAid !== undefined ? byAid.get(mainAid) : undefined;
    rows.push({
      aid: row.aid,
      staff_id: row.staffId,
      name: row.name,
      latin: row.latin,
      main_name: mainRow ? pickName(mainRow.name, mainRow.latin) : '',
    });
  }
  return { rows, skipped };
}
