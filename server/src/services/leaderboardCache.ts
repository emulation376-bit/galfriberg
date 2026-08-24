import { DIFFICULTY_LEVELS } from '../difficulties';

export type LeaderboardMode = 'single' | 'multi' | 'character';

export function leaderboardCacheKey(mode: LeaderboardMode, difficulty: string): string {
  return `leaderboard:${mode}:${difficulty}`;
}

export function allLeaderboardCacheKeys(): string[] {
  return DIFFICULTY_LEVELS.flatMap((difficulty) => [
    leaderboardCacheKey('single', difficulty.key),
    leaderboardCacheKey('multi', difficulty.key),
    leaderboardCacheKey('character', difficulty.key),
  ]);
}
