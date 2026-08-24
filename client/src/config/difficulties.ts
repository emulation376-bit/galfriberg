export interface DifficultyOption {
  key: string;
  sortOrder: number;
  enabled: boolean;
  recommended?: boolean;
}

export const DIFFICULTIES: DifficultyOption[] = [
  { key: 'beginner', sortOrder: 5, enabled: true, recommended: true },
  { key: 'easy', sortOrder: 10, enabled: true },
  { key: 'normal', sortOrder: 20, enabled: true },
  { key: 'custom', sortOrder: 30, enabled: true },
];

export const AVAILABLE_DIFFICULTIES = DIFFICULTIES
  .filter((difficulty) => difficulty.enabled)
  .sort((a, b) => a.sortOrder - b.sortOrder);

/** 计入排行榜 / 统计的难度（自定义筛选不计入个人战绩与排行榜） */
export const STAT_ELIGIBLE_DIFFICULTIES = AVAILABLE_DIFFICULTIES
  .filter((difficulty) => difficulty.key !== 'custom');
