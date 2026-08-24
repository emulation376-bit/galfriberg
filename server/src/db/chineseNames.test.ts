import { describe, expect, it } from 'vitest';
import { normalizeSearchName, toSimplified } from './chineseNames';

describe('chineseNames', () => {
  it('converts traditional and Japanese kanji names to simplified Chinese', () => {
    expect(toSimplified('信田結愛')).toBe('信田结爱');
    expect(toSimplified('海野宮子')).toBe('海野宫子');
    expect(toSimplified('古賀凪青')).toBe('古贺凪青');
  });

  it('normalizes names to simplified, lowercased, and without spaces', () => {
    expect(normalizeSearchName('信田 結愛')).toBe('信田结爱');
    expect(normalizeSearchName('Fairy of Music')).toBe('fairyofmusic');
  });
});
