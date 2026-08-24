import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CharacterGame from './CharacterGame';
import { renderAtRoute } from '../test/render';
import { api } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const ANSWER = {
  id: 'c1',
  nameCn: '茜崎空',
  surname: '茜崎',
  givenName: '空',
  image: null,
  sex: 'f',
  birthday: 920,
  height: 160,
  age: 17,
  names: [{ lang: 'ja', name: '茜崎空', latin: null }],
  traits: [{ traitId: 'i6', traitName: 'Brown', groupId: 'i1', groupName: 'Hair' }],
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

describe('CharacterGame UX', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('starts a game, submits a guess, and reveals the winning answer', async () => {
    get.mockResolvedValueOnce({
      data: [{ id: 'c1', name: '茜崎空', names: ['茜崎空', 'Sora Akanezaki'], firstGame: null }],
    } as never);
    post.mockResolvedValueOnce({
      data: {
        gameId: 'g1',
        maxGuesses: 8,
        guesses: [],
      },
    } as never);

    renderAtRoute(
      <CharacterGame />,
      {
        route: '/character/normal',
        path: '/character/:mode',
        extraRoutes: <Route path="/" element={<div data-testid="home" />} />,
      }
    );

    const user = userEvent.setup();
    expect(await screen.findByText('在下方输入角色名称开始')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('输入角色名称...');
    await user.type(input, 'Sora Akanezaki');
    post.mockResolvedValueOnce({
      data: {
        feedback: {
          guessId: 'c1',
          gameTitles: ['时空轮回'],
          releaseRange: {
            earliest: { value: 2002, level: 'correct' },
            latest: { value: 2002, level: 'correct' },
          },
          works: { level: 'correct', sameCompany: false },
          correct: true,
          nameLevel: 'correct',
          attributes: {
            sex: { value: 'f', level: 'correct' },
            birthday: { value: 920, level: 'correct' },
            height: { value: 160, level: 'correct' },
            age: { value: 17, level: 'correct' },
            bgmScore: { value: 8.6, level: 'correct' },
            difficulty: { value: 'normal', level: 'correct', parts: [{ name: 'normal', matched: true }] },
            clothes: { value: '', level: 'wrong', parts: [] },
            role: { value: '', level: 'wrong', parts: [] },
            hair: {
              value: 'Brown、Black、Blue、Green、Red、Pink',
              level: 'close',
              parts: [
                { name: 'Brown', matched: true },
                { name: 'Black', matched: false },
                { name: 'Blue', matched: false },
                { name: 'Green', matched: false },
                { name: 'Red', matched: false },
                { name: 'Pink', matched: false },
              ],
            },
            body: { value: '', level: 'wrong', parts: [] },
            eyes: { value: '', level: 'wrong', parts: [] },
            voiceActor: {
              value: '雪野五月',
              level: 'correct',
              parts: [{ name: '雪野五月', matched: true }],
            },
          },
        },
        status: 'won',
        maxGuesses: 8,
        answer: ANSWER,
      },
    } as never);
    await user.click(screen.getByRole('button', { name: '提交猜测' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('茜崎空');
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getAllByText('猜对了！').length).toBeGreaterThan(0);
  });
});
