import { describe, expect, it } from 'vitest';
import {
  characterImageUrl,
  resolveCharacterImage,
  vndbCharacterImageUrl,
  ymgalCharacterImageUrl,
} from './characterImageService';

describe('character image service', () => {
  it('builds a VNDB portrait URL from a ch image id', () => {
    expect(vndbCharacterImageUrl('ch175652')).toBe('https://t.vndb.org/ch/52/175652.jpg');
    expect(vndbCharacterImageUrl('ch17')).toBe('https://t.vndb.org/ch/17/17.jpg');
  });

  it('builds a YmGal portrait URL from a relative path', () => {
    expect(ymgalCharacterImageUrl('archive/main/41/41a41246a91e4fa5a3a8e6957760a9b3.jpg')).toBe(
      'https://cdn.ymgal.games/archive/main/41/41a41246a91e4fa5a3a8e6957760a9b3.jpg'
    );
    expect(ymgalCharacterImageUrl('../outside.jpg')).toBeNull();
  });

  it('prefers YmGal and falls back to VNDB', () => {
    const candidates = resolveCharacterImage({
      image: 'ch175652',
      ymgal_image: 'archive/main/41/41a41246a91e4fa5a3a8e6957760a9b3.jpg',
    });
    expect(candidates.map((candidate) => candidate.source)).toEqual(['ymgal', 'vndb']);
    expect(characterImageUrl({ id: 'c1', image: 'ch175652' })).toBe('/img/character/c1');
    expect(characterImageUrl({ id: 'c2' })).toBeNull();
  });
});
