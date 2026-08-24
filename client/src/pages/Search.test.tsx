import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAtRoute } from '../test/render';
import Search from './Search';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => ({
  api: { get: apiGet },
  errMsg: () => 'request failed',
}));

const randomGame = {
  id: 3,
  title: 'CLANNAD',
  titleCn: '团子大家族',
  releaseYear: 2004,
  company: 'Key',
  isR18: false,
  scenarioWriter: '麻枝准',
  musicComposer: '折戸伸治',
  artist: '樋上いたる',
  voiceActor: '',
  bgmScore: 9.1,
};

describe('Search random roll', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url === '/players/list') return Promise.resolve({ data: { version: '1', games: [] } });
      if (url === '/players/random') return Promise.resolve({ data: randomGame });
      return Promise.resolve({ data: [] });
    });
  });

  it('rolls a random game from the dock button and shows its info card', async () => {
    const user = userEvent.setup();
    renderAtRoute(<Search />);

    await user.click(screen.getByRole('button', { name: '随机' }));

    expect(await screen.findByText('CLANNAD')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/players/random', { params: undefined });
  });

  it('rolls a new game from the button below the card, excluding the current one', async () => {
    const user = userEvent.setup();
    renderAtRoute(<Search />);

    await user.click(screen.getByRole('button', { name: '随机' }));
    await screen.findByText('CLANNAD');

    await user.click(screen.getByRole('button', { name: 'Roll 新游戏' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/players/random', { params: { exclude: 3 } });
    });
  });
});
