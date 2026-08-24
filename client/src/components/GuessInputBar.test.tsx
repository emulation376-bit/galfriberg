import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GuessInputBar from './GuessInputBar';
import { renderWithProviders } from '../test/render';
import { getGameList } from '../api/playerList';

const games = [
  { id: 1, title: 's1mple' },
  { id: 2, title: 'ZywOo' },
];
let gameListListener: ((list: typeof games) => void) | null = null;

vi.mock('../api/playerList', () => ({
  getGameList: vi.fn(async () => games),
  subscribeGameList: vi.fn((listener: (list: typeof games) => void) => {
    gameListListener = listener;
    return () => {
      if (gameListListener === listener) gameListListener = null;
    };
  }),
  searchGameList: (list: typeof games, query: string) =>
    list.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase())),
}));

describe('GuessInputBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gameListListener = null;
  });

  it('shows submitting on the button only, never a secondary status line', async () => {
    const user = userEvent.setup();
    let resolvePick: ((value: void) => void) | undefined;
    const onPick = vi.fn(() => new Promise<void>((resolve) => {
      resolvePick = resolve;
    }));

    renderWithProviders(<GuessInputBar onPick={onPick} />);

    await user.type(screen.getByPlaceholderText('输入作品名称...'), 's1');
    await screen.findByText('s1mple');
    await user.click(screen.getByRole('button', { name: '提交猜测' }));

    expect(await screen.findByRole('button', { name: '提交中...' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('正在提交...')).not.toBeInTheDocument();

    resolvePick?.();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交猜测' })).toBeInTheDocument();
    });
  });

  it('keeps input text when onPick rejects the guess (network/busy guard)', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn(async () => false);
    renderWithProviders(<GuessInputBar onPick={onPick} />);

    const input = screen.getByPlaceholderText('输入作品名称...');
    await user.type(input, 's1');
    await screen.findByText('s1mple');
    await user.click(screen.getByRole('button', { name: '提交猜测' }));

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(input).toHaveValue('s1');
  });

  it('disables input while parent marks the dock busy (desktop and mobile)', () => {
    renderWithProviders(<GuessInputBar onPick={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText('输入作品名称...')).toBeDisabled();
    expect(screen.getByRole('button', { name: '提交猜测' })).toBeDisabled();
  });

  it('renders external status only when explicitly provided (e.g. multi cooldown)', () => {
    renderWithProviders(<GuessInputBar onPick={vi.fn()} statusText="冷却 2s" />);
    expect(screen.getByRole('status')).toHaveTextContent('冷却 2s');
  });

  it('keeps the current query open while a background game-list update arrives', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuessInputBar onPick={vi.fn()} />);

    const input = screen.getByPlaceholderText('输入作品名称...');
    await user.type(input, 's1');
    await screen.findByText('s1mple');

    act(() => {
      gameListListener?.([
        ...games,
        { id: 3, title: 's1ren' },
      ]);
    });

    expect(input).toHaveValue('s1');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('s1mple')).toBeInTheDocument();
    expect(screen.getByText('s1ren')).toBeInTheDocument();
  });

  it('filters the in-memory list in the same input event without debounce', () => {
    renderWithProviders(<GuessInputBar onPick={vi.fn()} />);
    act(() => gameListListener?.(games));

    const input = screen.getByPlaceholderText('输入作品名称...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 's1' } });

    expect(input).toHaveValue('s1');
    expect(screen.getByText('s1mple')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not revalidate the game list on every input change', async () => {
    renderWithProviders(<GuessInputBar onPick={vi.fn()} />);
    await waitFor(() => expect(getGameList).toHaveBeenCalled());
    const input = screen.getByPlaceholderText('输入作品名称...');
    fireEvent.focus(input);
    const callsAfterFocus = vi.mocked(getGameList).mock.calls.length;

    fireEvent.change(input, { target: { value: 's' } });
    fireEvent.change(input, { target: { value: 's1' } });

    expect(getGameList).toHaveBeenCalledTimes(callsAfterFocus);
  });

  it('cycles completion with Tab and reverses with Shift+Tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuessInputBar onPick={vi.fn()} />);

    const input = screen.getByPlaceholderText('输入作品名称...');
    await user.type(input, 's1');
    act(() => {
      gameListListener?.([
        { id: 1, title: 's1mple' },
        { id: 3, title: 's1ren' },
      ]);
    });

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('s1mple');
    expect(input).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('s1ren');

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(input).toHaveValue('s1mple');
  });
});
