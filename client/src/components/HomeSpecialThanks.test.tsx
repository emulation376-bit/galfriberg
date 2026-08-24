import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { SPECIAL_THANKS } from '../config/specialThanks';
import { renderWithProviders } from '../test/render';
import HomeSpecialThanks from './HomeSpecialThanks';

describe('HomeSpecialThanks', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
  });

  it('renders the special thanks configured in client code', async () => {
    const user = userEvent.setup();

    renderWithProviders(<HomeSpecialThanks />);

    await user.click(screen.getByRole('button', { name: '特别感谢' }));
    expect(screen.getByRole('heading', { name: '特别感谢' })).toBeInTheDocument();

    expect(screen.getByText('怂皇的一天')).toBeInTheDocument();
    expect(screen.getByText('开源了csgofriberg的代码')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '怂皇的一天' })).toHaveAttribute('src', SPECIAL_THANKS[0].image);
    expect(screen.getByRole('link', { name: /怂皇的一天/ })).toHaveAttribute('href', 'https://github.com/shnlfriberg/csgofriberg');

    expect(screen.getByText('The Visual Novel Database')).toBeInTheDocument();
    expect(screen.getAllByText('提供了本项目使用的数据库')).toHaveLength(3);
    expect(screen.queryByRole('img', { name: 'The Visual Novel Database' })).not.toBeInTheDocument();
    expect(screen.getByText('T')).toHaveClass('thanks-dialog-avatar-fallback');
    expect(screen.getByRole('link', { name: /The Visual Novel Database/ })).toHaveAttribute('href', 'https://vndb.org/');

    expect(screen.getByText('月幕galgame')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '月幕galgame' })).toHaveAttribute('src', SPECIAL_THANKS[2].image);
    expect(screen.getByRole('link', { name: /月幕galgame/ })).toHaveAttribute('href', 'https://www.ymgal.games/');

    expect(screen.getByText('Bangumi')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bangumi' })).toHaveAttribute('src', SPECIAL_THANKS[3].image);
    expect(screen.getByRole('link', { name: /Bangumi/ })).toHaveAttribute('href', 'https://bangumi.tv/');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
