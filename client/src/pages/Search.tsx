import { useState } from 'react';
import { Search as SearchIcon, CircleDot, Dices, RefreshCw } from 'lucide-react';
import Page from '../components/Page';
import GuessInputBar from '../components/GuessInputBar';
import { GameInfoTable } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { GameInfo } from '../types';
import { toast } from '../components/Toast';
import { useTranslation } from 'react-i18next';

/** 查作品:底部输入 + 自动补全,选中后在上方展示作品卡片;也可随机抽取一部作品 */
export default function Search() {
  const { t } = useTranslation();
  const [game, setGame] = useState<GameInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);

  const lookup = async (title: string) => {
    setLoading(true);
    try {
      const res = await api.get<GameInfo[]>('/players', {
        params: { search: title },
      });
      const exact =
        res.data.find((g) => g.title.toLowerCase() === title.toLowerCase()) ??
        res.data[0] ??
        null;
      setGame(exact);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const roll = async (excludeId?: number) => {
    setRolling(true);
    try {
      const res = await api.get<GameInfo>('/players/random', {
        params: excludeId ? { exclude: excludeId } : undefined,
      });
      setGame(res.data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRolling(false);
    }
  };

  const busy = loading || rolling;

  return (
    <Page
      title={t('search.title')}
      icon={<SearchIcon size={17} />}
      dock={
        <div className="search-dock">
          <GuessInputBar
            onPick={(p) => void lookup(p.title)}
            placeholder={t('search.placeholder')}
            buttonText={t('search.button')}
          />
          <button
            className="btn btn-ghost search-random-btn"
            type="button"
            onClick={() => void roll()}
            disabled={rolling}
            data-umami-event="search-random"
          >
            <Dices size={15} />
            {rolling ? t('search.rolling') : t('search.random')}
          </button>
        </div>
      }
    >
      <div className="player-search-content">
        {busy && !game ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-light)' }}>
            <Dices size={32} strokeWidth={1.5} />
            <p>{t('search.rolling')}</p>
          </div>
        ) : game ? (
          <>
            <div className="card">
              <h3>
                <CircleDot size={15} color={'#16a34a'} />
                {game.title}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {t('guess.columns.company')}: {game.company}
                </span>
              </h3>
              <GameInfoTable
                answer={{
                  title: game.title,
                  titleCn: game.titleCn,
                  releaseYear: game.releaseYear,
                  company: game.company,
                  isR18: game.isR18,
                  scenarioWriter: game.scenarioWriter,
                  musicComposer: game.musicComposer,
                  artist: game.artist,
                  voiceActor: game.voiceActor,
                  tags: game.tags,
                  isSeries: game.isSeries,
                  lengthMinutes: game.lengthMinutes,
                  bgmScore: game.bgmScore,
                }}
              />
            </div>
            <div className="btns" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button
                className="btn"
                type="button"
                onClick={() => void roll(game.id)}
                disabled={rolling}
                data-umami-event="search-random-roll"
              >
                <RefreshCw size={15} />
                {rolling ? t('search.rolling') : t('search.roll')}
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-light)' }}>
            <SearchIcon size={32} strokeWidth={1.5} />
            <p>{t('search.empty')}</p>
            <p style={{ fontSize: '0.8rem' }}>{t('search.fuzzy')}</p>
          </div>
        )}
      </div>
    </Page>
  );
}
