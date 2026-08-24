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
