import { Knex } from 'knex';
import { db } from '../db/knex';

let traitFreq = new Map<string, number>();

/** 从 character_traits 统计每个 trait 在角色库中的出现次数，供猜测反馈截断时优先展示高频特征 */
export async function loadTraitFrequency(instance: Knex = db): Promise<void> {
  try {
    const rows = await instance('character_traits').select('trait_id');
    const freq = new Map<string, number>();
    for (const row of rows) {
      const id = String(row.trait_id);
      if (!id) continue;
      freq.set(id, (freq.get(id) ?? 0) + 1);
    }
    traitFreq = freq;
    console.log(`[traits] 已加载 ${freq.size} 个出现次数统计`);
  } catch (err) {
    traitFreq = new Map();
    console.warn(
      '[traits] 加载 trait 出现次数失败，回退为空统计:',
      err instanceof Error ? err.message : err
    );
  }
}

/** trait（按 trait_id）在角色库中的出现次数（未命中返回 0） */
export function traitFrequency(traitId: string): number {
  return traitFreq.get(traitId) ?? 0;
}
