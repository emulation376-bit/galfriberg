export type LengthKey = 'unknown' | 'veryshort' | 'short' | 'medium' | 'long' | 'verylong';

/** 分钟 -> VNDB 时长分类（5 类）。0/缺失 -> unknown */
export function lengthKey(minutes: number | undefined | null): LengthKey {
  const m = Number(minutes) || 0;
  if (m <= 0) return 'unknown';
  if (m < 120) return 'veryshort'; // <2h
  if (m < 600) return 'short'; // 2-10h
  if (m < 1800) return 'medium'; // 10-30h
  if (m < 3000) return 'long'; // 30-50h
  return 'verylong'; // >50h
}
