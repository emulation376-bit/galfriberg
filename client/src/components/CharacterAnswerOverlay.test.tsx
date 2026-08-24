import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import CharacterAnswerOverlay from './CharacterAnswerOverlay';
import type { CharacterClue } from '../types';
import { renderWithProviders } from '../test/render';

const answer: CharacterClue = {
  id: 'c1',
  nameCn: '茜崎空',
  surname: '茜崎',
  givenName: '空',
  image: null,
  ymgal_image: null,
  sex: 'f',
  birthday: 920,
  height: 160,
  age: 17,
  names: [{ lang: 'ja', name: '茜崎空', latin: null }],
  traits: [
    { traitId: 't1', traitName: 'Long Hair', groupId: 'i1', groupName: 'Hair' },
    { traitId: 't2', traitName: 'Blue Eyes', groupId: 'i1', groupName: 'Eyes' },
  ],
  voiceActors: [{ staffId: 's1', name: '雪野五月' }],
  games: [{
    gameId: 1,
    title: 'Ever17',
    titleCn: '时空轮回',
    company: 'KID',
    releaseDate: '2002-04-25',
    bgmScore: 8.6,
    difficulties: ['normal'],
  }],
  bgmScore: 8.6,
  difficulties: ['normal'],
};

describe('CharacterAnswerOverlay', () => {
  it('renders all answer details in the same row style as trait groups', () => {
    renderWithProviders(
      <CharacterAnswerOverlay title="正确答案" answer={answer} actions={<button>关闭</button>} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('最早/最近登场时间');
    expect(dialog).toHaveTextContent('登场作品');
    expect(dialog).toHaveTextContent('声优');
    expect(dialog).toHaveTextContent('发型');
    expect(dialog).toHaveTextContent('眼睛');
    expect(document.querySelectorAll('.character-answer-details .character-clue-row').length).toBe(9);
  });
});
