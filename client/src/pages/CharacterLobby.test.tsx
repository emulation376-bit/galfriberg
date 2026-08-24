import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CharacterLobby from './CharacterLobby';
import { renderAtRoute } from '../test/render';

describe('CharacterLobby rules', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the character rules dialog from the lobby button', async () => {
    const user = userEvent.setup();
    renderAtRoute(<CharacterLobby />, { route: '/character', path: '/character' });

    const rulesButton = screen.getByRole('button', { name: '角色规则' });
    expect(rulesButton).toBeInTheDocument();

    await user.click(rulesButton);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('猜角色规则');
    expect(dialog).toHaveTextContent('猜测与反馈');
    expect(dialog).toHaveTextContent('登场作品');
  });
});
