import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import CharacterGuessBoard from './CharacterGuessBoard';
import type { CharacterGuessFeedback } from '../types';
import { renderWithProviders } from '../test/render';

const feedback: CharacterGuessFeedback = {
  guessId: 'c1',
  image: '/img/character/c1',
  gameTitles: ['时空轮回'],
  releaseRange: {
    earliest: { value: 2002, level: 'correct' },
    latest: { value: 2002, level: 'correct' },
  },
  works: {
    level: 'correct',
    sameCompany: false,
    parts: [
      { name: '时空轮回', matched: true },
      { name: 'Ever17', matched: false },
    ],
  },
  correct: false,
  nameLevel: 'wrong',
  attributes: {
    sex: { value: 'f', level: 'correct' },
    birthday: { value: 920, level: 'wrong' },
    height: { value: 160, level: 'wrong' },
    age: { value: 17, level: 'wrong' },
    bgmScore: { value: 8.6, level: 'wrong' },
    difficulty: { value: 'normal', level: 'wrong', parts: [] },
    clothes: { value: '', level: 'wrong', parts: [] },
    role: { value: '', level: 'wrong', parts: [] },
    hair: {
      value: 'Straight、Long、Black',
      level: 'wrong',
      parts: [
        { name: 'Straight', matched: false },
        { name: 'Long', matched: false },
        { name: 'Spiky Bangs', matched: false },
        { name: 'Waist Length+', matched: false },
        { name: 'Blunt Bangs', matched: false },
        { name: 'Black', matched: true },
      ],
    },
    body: { value: '', level: 'wrong', parts: [] },
    eyes: { value: '', level: 'wrong', parts: [] },
    voiceActor: { value: '', level: 'wrong', parts: [] },
  },
};

describe('CharacterGuessBoard portrait column', () => {
  it('truncates trait cells at 4 values + +N when total exceeds 5, and shows all 5 when total is exactly 5', () => {
    const sixParts = Array.from({ length: 6 }, (_, i) => ({
      name: 'ClothesTrait' + i,
      matched: i === 0,
    }));
    const fbSix = {
      ...feedback,
      attributes: { ...feedback.attributes, clothes: { value: '', level: 'wrong' as const, parts: sixParts } },
    };
    const { unmount } = renderWithProviders(
      <CharacterGuessBoard guesses={[fbSix]} names={new Map([['c1', '茜崎空']])} />
    );
    const clothesCell = document.querySelectorAll('td')[6];
    const chips = clothesCell?.querySelectorAll('.staff-chip') ?? [];
    expect(chips.length).toBe(5); // 4 个值 + 1 个 +N
    expect(chips[4]?.textContent).toBe('+2');
    unmount();

    const fiveParts = Array.from({ length: 5 }, (_, i) => ({
      name: 'ClothesTrait' + i,
      matched: i === 0,
    }));
    const fbFive = {
      ...feedback,
      attributes: { ...feedback.attributes, clothes: { value: '', level: 'wrong' as const, parts: fiveParts } },
    };
    renderWithProviders(
      <CharacterGuessBoard guesses={[fbFive]} names={new Map([['c1', '茜崎空']])} />
    );
    const clothesCell5 = document.querySelectorAll('td')[6];
    const chips5 = clothesCell5?.querySelectorAll('.staff-chip') ?? [];
    expect(chips5.length).toBe(5);
    expect(Array.from(chips5).some((chip) => chip.textContent === '+N' || chip.textContent?.startsWith('+'))).toBe(false);
  });

  it('renders the character portrait as the leftmost column', () => {
    renderWithProviders(<CharacterGuessBoard guesses={[feedback]} names={new Map([['c1', '茜崎空']])} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('立绘');
    expect(screen.getByRole('img', { name: '茜崎空' })).toHaveAttribute('src', '/img/character/c1');
    const worksCell = document.querySelector('td.character-game-cell');
    expect(worksCell).not.toHaveClass('correct');
    expect(worksCell?.querySelector('.staff-chip.matched')).toHaveTextContent('时空轮回');
    expect(worksCell?.querySelectorAll('.staff-chip')).toHaveLength(2);
    expect(document.querySelector('td:nth-child(9)')).toHaveTextContent('黑色');
  });
});
