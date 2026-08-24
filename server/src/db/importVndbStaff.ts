// @deprecated 已被 buildImportCsv.ts / importAll.ts 组成的新数据链路取代，保留供独立使用。
import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';

const CJK = /[぀-ヿ一-鿿＀-￯]/;

/** VNDB role → 本地列。严格对应：songs/director/staff/翻译/qa/editor 等不入列 */
const ROLE_TO_COL: Record<string, 'scenario_writer' | 'music_composer' | 'artist'> = {
  scenario: 'scenario_writer',
  music: 'music_composer',
  art: 'artist',
  chardesign: 'artist',
};
const COLUMNS = ['scenario_writer', 'music_composer', 'artist'] as const;

/** PostgreSQL COPY 格式字段反转义 */
function unescape(field: string): string | null {
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

/** 显示名优先原名（含日/中字符），否则罗马字 */
function pickName(name: string | null, latin: string | null): string {
  if (name && CJK.test(name)) return name;
  return latin || name || '';
}

/** 归一化：全角→半角、统一引号/破折号/波浪线并去空白 */
function norm(s: string): string {
  return s
    .toLocaleLowerCase()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[‘’“”「」"'«»]/g, '"')
    .replace(/[‐‑‒–—―−ー]/g, '-')
    .replace(/[〜～∼ヽ]/g, '~')
    .replace(/\s+/g, '');
}

async function main(): Promise<void> {
  await ensureSchema();
  const dbDir = path.resolve(__dirname, '..', '..', '..', 'VNDB', 'db');

  // 1. staff_alias: aid -> {staff_id, name, latin}
  const aliasByAid = new Map<number, { staff_id: string; name: string; latin: string | null }>();
  for (const line of fs.readFileSync(path.join(dbDir, 'staff_alias'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const aid = Number(c[1]);
    aliasByAid.set(aid, { staff_id: c[0], name: unescape(c[2]) ?? '', latin: c[3] !== undefined ? unescape(c[3]) : null });
  }
  console.log(`[vndb-staff] staff_alias: ${aliasByAid.size}`);

  // 2. vn_staff 按作品分组: vnId -> [{aid, role}]
  const vnStaffByVn = new Map<string, Array<{ aid: number; role: string }>>();
  for (const line of fs.readFileSync(path.join(dbDir, 'vn_staff'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const role = c[2];
    if (!ROLE_TO_COL[role]) continue; // 只保留目标角色
    if (!vnStaffByVn.has(vid)) vnStaffByVn.set(vid, []);
    vnStaffByVn.get(vid)!.push({ aid: Number(c[1]), role });
  }
  console.log(`[vndb-staff] 含目标角色的 vn: ${vnStaffByVn.size}`);

  // 2b. 主要角色（main/primary，且非剧透）声优：
  //     vn_seiyuu(id=vn, cid=角色, aid=声优别名) × chars_vns(cid, vid, role, spoil)
  const charCidsByVn = new Map<string, Set<string>>();
  for (const line of fs.readFileSync(path.join(dbDir, 'chars_vns'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const role = c[3];
    const spoil = c[4];
    if (role !== 'main' && role !== 'primary') continue;
    if (spoil !== '0') continue; // 排除剧透角色（bad-end 等），避免答案泄露
    const vid = c[1];
    if (!charCidsByVn.has(vid)) charCidsByVn.set(vid, new Set());
    charCidsByVn.get(vid)!.add(c[0]);
  }
  const voiceByVn = new Map<string, Array<{ cid: string; aid: number }>>();
  const seenVoiceInput = new Set<string>();
  for (const line of fs.readFileSync(path.join(dbDir, 'vn_seiyuu'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const vid = c[0];
    const cid = c[1];
    const aid = Number(c[2]);
    const key = `${cid}:${aid}`; // 同一角色多版本 note 会重复,输入先去重
    if (seenVoiceInput.has(key)) continue;
    seenVoiceInput.add(key);
    if (!voiceByVn.has(vid)) voiceByVn.set(vid, []);
    voiceByVn.get(vid)!.push({ cid, aid });
  }
  console.log(`[vndb-staff] 主要角色 vn: ${charCidsByVn.size}, 有声优 vn: ${voiceByVn.size}`);

  // 3. VNDB 标题索引（精确 + 归一化 + 前缀）
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
  console.log(`[vndb-staff] 标题索引: 精确 ${exact.size}, 归一化 ${normIndex.size}`);

  /** 匹配作品 → vnId；返回 null 表示未匹配 */
  function matchVn(title: string, titleCn: string, aliases: string[]): string | null {
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

  // 4. 读取本地作品
  const games = await db('game_titles').select('id', 'title', 'title_cn');
  const aliasRows = await db('game_aliases').select('game_id', 'alias');
  const aliasByGame = new Map<number, string[]>();
  for (const r of aliasRows) {
    const gid = Number(r.game_id);
    if (!aliasByGame.has(gid)) aliasByGame.set(gid, []);
    aliasByGame.get(gid)!.push(String(r.alias));
  }

  // 5. 逐部匹配并回写 staff
  let updated = 0;
  let noVndbStaff = 0;
  const unmatched: Array<{ id: number; title: string }> = [];
  for (const g of games) {
    const gid = Number(g.id);
    const vid = matchVn(String(g.title), String(g.title_cn), aliasByGame.get(gid) ?? []);
    if (!vid) {
      unmatched.push({ id: gid, title: String(g.title) });
      continue;
    }
    const rows = vnStaffByVn.get(vid) ?? [];
    const names: Record<string, string[]> = { scenario_writer: [], music_composer: [], artist: [] };
    const seen: Record<string, Set<string>> = { scenario_writer: new Set(), music_composer: new Set(), artist: new Set() };
    for (const s of rows) {
      const col = ROLE_TO_COL[s.role];
      const alias = aliasByAid.get(s.aid);
      if (!alias || !alias.name) continue;
      const key = alias.staff_id; // 按 staff 身份去重
      if (seen[col].has(key)) continue;
      seen[col].add(key);
      names[col].push(pickName(alias.name, alias.latin));
    }
    if (!names.scenario_writer.length && !names.music_composer.length && !names.artist.length) noVndbStaff += 1;
    const update: Record<string, string> = {};
    for (const col of COLUMNS) update[col] = names[col].join('、');
    // 声优:仅收主要角色的配音,按 staff 身份去重,空则留空串(与 staff 字段行为一致)
    const voices: string[] = [];
    const seenVoice = new Set<string>();
    for (const { cid, aid } of voiceByVn.get(vid) ?? []) {
      if (!charCidsByVn.get(vid)?.has(cid)) continue;
      const alias = aliasByAid.get(aid);
      if (!alias || !alias.name) continue;
      const key = alias.staff_id;
      if (seenVoice.has(key)) continue;
      seenVoice.add(key);
      voices.push(pickName(alias.name, alias.latin));
    }
    update['voice_actor'] = voices.join('、');
    await db('game_titles').where({ id: gid }).update(update);
    updated += 1;
  }

  console.log(`\n[vndb-staff] 完成: 回写 ${updated}/${games.length} 部`);
  console.log(`[vndb-staff] 其中 VNDB 无目标角色 staff: ${noVndbStaff} 部`);
  console.log(`[vndb-staff] 未匹配 ${unmatched.length} 部:`);
  for (const u of unmatched) console.log(`  #${u.id} ${u.title}`);
  fs.writeFileSync(path.join(__dirname, '..', '..', '..', 'vndb_staff_unmatched.json'), JSON.stringify(unmatched, null, 2));

  await db.destroy();
}

main().catch((err) => {
  console.error('[vndb-staff] 导入失败:', err);
  process.exit(1);
});
