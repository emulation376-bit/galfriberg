import { describe, expect, it } from 'vitest';

import { lengthKey } from './length';

describe('lengthKey', () => {
  it('maps VNDB length buckets (5 categories)', () => {
    expect(lengthKey(0)).toBe('unknown');
    expect(lengthKey(undefined)).toBe('unknown');
    expect(lengthKey(119)).toBe('veryshort');
    expect(lengthKey(120)).toBe('short');
    expect(lengthKey(599)).toBe('short');
    expect(lengthKey(600)).toBe('medium');
    expect(lengthKey(1799)).toBe('medium');
    expect(lengthKey(1800)).toBe('long');
    expect(lengthKey(2999)).toBe('long');
    expect(lengthKey(3000)).toBe('verylong');
    expect(lengthKey(9999)).toBe('verylong');
  });
});
