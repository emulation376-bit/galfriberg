import { db } from '../db/knex';

interface ResolvedStaff {
  staffId: string;    // VNDB staff 条目 id（如 s39）；未命中时回退为名字本身
  mainName: string;   // 该条目主名（显示用）
}

let aliasMap = new Map<string, ResolvedStaff>();
let staffFreq = new Map<string, number>();
/** staffId -> 使用名 -> 出现游戏数（每游戏至多计 1 次），用于挑选展示主名 */
let staffNameFreq = new Map<string, Map<string, number>>();
let loaded = false;

/** 从 staff_aliases 表加载「名字 → staff 条目」解析表（服务器启动时调用一次） */
export async function loadStaffAliases(): Promise<void> {
  try {
    const rows = await db('staff_aliases').select('staff_id', 'name', 'latin', 'main_name');
    const next = new Map<string, ResolvedStaff>();
    for (const row of rows) {
      const resolved: ResolvedStaff = {
        staffId: String(row.staff_id),
        mainName: String(row.main_name),
      };
      next.set(String(row.name).toLocaleLowerCase(), resolved);
      if (row.latin) next.set(String(row.latin).toLocaleLowerCase(), resolved);
    }
    aliasMap = next;
    console.log(`[staff] 已加载 ${aliasMap.size} 个名字解析项`);
  } catch (err) {
    // 表缺失/为空时保持空映射，所有名字回退为自身，与旧行为一致
    aliasMap = new Map();
    console.warn(
      '[staff] 加载 staff 别名映射失败，回退为纯名字比对:',
      err instanceof Error ? err.message : err
    );
  } finally {
    loaded = true;
  }
}

/** 加载「staff 在全部游戏中的出现次数」（每个游戏至多计 1 次），供猜测反馈截断时优先展示高频 staff */
export async function loadStaffFrequency(): Promise<void> {
  try {
    const columns = ['scenario_writer', 'music_composer', 'artist', 'voice_actor'];
    const rows = await db('game_titles').select(columns);
    const freq = new Map<string, number>();
    const nameFreq = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const gameSeen = new Set<string>();
      const gameNames = new Map<string, Set<string>>(); // staffId -> 本游戏内出现过的使用名
      for (const col of columns) {
        const raw = row[col];
        if (!raw) continue;
        for (const part of String(raw).split('、')) {
          const name = part.trim();
          if (!name) continue;
          const { staffId } = resolveStaffName(name);
          if (gameSeen.has(staffId)) continue;
          gameSeen.add(staffId);
          if (!gameNames.has(staffId)) gameNames.set(staffId, new Set());
          gameNames.get(staffId)!.add(name);
        }
      }
      for (const id of gameSeen) freq.set(id, (freq.get(id) ?? 0) + 1);
      for (const [id, names] of gameNames) {
        const byName = nameFreq.get(id) ?? new Map<string, number>();
        for (const n of names) byName.set(n, (byName.get(n) ?? 0) + 1);
        nameFreq.set(id, byName);
      }
    }
    staffFreq = freq;
    staffNameFreq = nameFreq;
    console.log(`[staff] 已加载 ${freq.size} 个出现次数统计`);
  } catch (err) {
    staffFreq = new Map();
    staffNameFreq = new Map();
    console.warn(
      '[staff] 加载 staff 出现次数失败，回退为空统计:',
      err instanceof Error ? err.message : err
    );
  }
}

/** staff 在全部游戏中的出现次数（未命中/id 缺失返回 0） */
export function staffFrequency(staffId: string): number {
  return staffFreq.get(staffId) ?? 0;
}

/** staff 出现次数最多的使用名（并列时取 VNDB 主名；仍并列取字典序最小）；无统计时回退 VNDB 主名 */
export function staffTopName(staffId: string, fallbackMainName: string): string {
  const byName = staffNameFreq.get(staffId);
  if (!byName || byName.size === 0) return fallbackMainName;
  let bestName = fallbackMainName;
  let bestCount = -1;
  for (const [name, count] of byName) {
    if (
      count > bestCount ||
      (count === bestCount &&
        (name === fallbackMainName || (bestName !== fallbackMainName && name < bestName)))
    ) {
      bestName = name;
      bestCount = count;
    }
  }
  return bestName;
}

export function staffMapLoaded(): boolean {
  return loaded;
}

/** 将单个名字解析为 staff 身份（主名与别名视为同一人） */
export function resolveStaffName(raw: string): ResolvedStaff {
  const name = raw.trim();
  if (!name) return { staffId: name, mainName: name };
  return aliasMap.get(name.toLocaleLowerCase()) ?? { staffId: name, mainName: name };
}

/** 名字串（、分隔）→ staff 身份集合（用于比对） */
export function identityStaff(value: string): Set<string> {
  const ids = new Set<string>();
  for (const part of value.split('、')) {
    const name = part.trim();
    if (name) ids.add(resolveStaffName(name).staffId);
  }
  return ids;
}

/** 名字串（、分隔）→ 显示串：使用名与「displayNameKey（默认 = 库中出现最多的使用名）」不同时用「使用名 (显示主名)」标识 */
export function displayStaff(value: string): string {
  return value
    .split('、')
    .map((part) => {
      const name = part.trim();
      if (!name) return part;
      const { staffId, mainName } = resolveStaffName(name);
      const topName = staffTopName(staffId, mainName);
      return topName && topName !== name ? `${name} (${topName})` : name;
    })
    .join('、');
}
