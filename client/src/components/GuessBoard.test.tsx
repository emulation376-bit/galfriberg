import { describe, expect, it } from 'vitest';
import GuessBoard from './GuessBoard';
import type { MultiplayerGuessFeedback } from '../types';
import { renderWithProviders } from '../test/render';

const feedback: MultiplayerGuessFeedback = {
  gameId: 1,
  title: 'Guess',
  correct: false,
  attributes: {
    releaseYear: { value: 2000, level: 'wrong' },
    company: { value: 'Key', level: 'close' },
    isR18: { value: false, level: 'wrong' },
    scenarioWriter: {
      value: '麻枝准、桶狭間ありさ',
      level: 'close',
      parts: [
        { name: '麻枝准', matched: true },
        { name: '桶狭間ありさ', matched: false },
      ],
    },
    musicComposer: { value: '', level: 'wrong', parts: [] },
    artist: { value: 'Artist', level: 'correct', parts: [{ name: 'Artist', matched: true }] },
    voiceActor: { value: '', level: 'wrong', parts: [] },
    tags: { value: '悬疑', level: 'close', parts: [{ name: '悬疑', matched: true }, { name: '科幻', matched: false }] },
    bgmScore: { value: 8.5, level: 'close', hint: 'higher' },
    isSeries: { value: false, level: 'wrong' },
    length: { value: 'medium', level: 'close', hint: 'higher' },
  },
};

describe('GuessBoard staff chips', () => {
  it('renders each staff member as its own rounded chip, green only when matched', () => {
    renderWithProviders(<GuessBoard guesses={[feedback]} />);
    const chips = document.querySelectorAll('.staff-chip');
    expect(chips.length).toBe(5);
    expect(chips[0]).toHaveTextContent('悬疑');
    expect(chips[0]).toHaveClass('matched');
    expect(chips[1]).toHaveTextContent('科幻');
    expect(chips[1]).not.toHaveClass('matched');
    expect(chips[2]).toHaveTextContent('麻枝准');
    expect(chips[2]).toHaveClass('matched');
    expect(chips[3]).toHaveTextContent('桶狭間ありさ');
    expect(chips[3]).not.toHaveClass('matched');
    expect(chips[4]).toHaveTextContent('Artist');
    expect(chips[4]).toHaveClass('matched');
  });

  it('keeps the staff cell neutral instead of whole-cell yellow, and shows a dash when empty', () => {
    renderWithProviders(<GuessBoard guesses={[feedback]} />);
    const staffCells = document.querySelectorAll('td.staff-cell');
    // 4 个含 parts 的列均为 staff-cell，不带整格 correct/close/wrong 配色
    expect(staffCells.length).toBe(4);
    staffCells.forEach((cell) => {
      expect(cell.className).not.toMatch(/\b(correct|close|wrong)\b/);
    });
    // 空 staff 显示占位符（声优列为空）
    expect(staffCells[3]).toHaveTextContent('-');
  });

  it('still applies level coloring to non-staff cells', () => {
    renderWithProviders(<GuessBoard guesses={[feedback]} />);
    // company(close)/bgmScore(close) 与 releaseYear(wrong) 等非 staff 列保留整格配色
    expect(document.querySelector('td.close')).toBeTruthy();
    expect(document.querySelector('td.wrong')).toBeTruthy();
  });
});
