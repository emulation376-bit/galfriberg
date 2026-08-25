import { Knex } from 'knex';
import { db } from '../db/knex';

let tagFreq = new Map<string, number>();

/** 从 game_titles.tags 统计每个 tag 在作品库中的出现次数（每作品至多计 1 次），供猜测反馈截断时优先展示高频 tag */
export async function loadTagFrequency(instance: Knex = db): Promise<void> {
  try {
    const rows = await instance('game_titles').select('tags');
    const freq = new Map<string, number>();
    for (const row of rows) {
      const seen = new Set<string>();
      const raw = String(row.tags ?? '');
      for (const part of raw.split('、')) {
        const name = part.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }
    }
    tagFreq = freq;
    console.log(`[tags] 已加载 ${freq.size} 个出现次数统计`);
  } catch (err) {
    tagFreq = new Map();
    console.warn(
      '[tags] 加载 tag 出现次数失败，回退为空统计:',
      err instanceof Error ? err.message : err
    );
  }
}

/** tag 在作品库中的出现次数（未命中返回 0） */
export function tagFrequency(name: string): number {
  return tagFreq.get(name) ?? 0;
}
