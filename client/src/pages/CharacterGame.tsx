import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CircleAlert, Home, Lightbulb, RotateCcw, Target, User, X } from 'lucide-react';
import Page from '../components/Page';
import CharacterAnswerOverlay from '../components/CharacterAnswerOverlay';
import CharacterGuessBoard from '../components/CharacterGuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import { api, errMsg } from '../api/client';
import { toast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import {
  CharacterClue,
  CharacterGuessFeedback,
  CharacterListEntry,
} from '../types';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_DIFFICULTIES } from '../config/difficulties';

function exitGame(gameId: string): Promise<unknown> {
  return api.post(`/characters/game/${gameId}/exit`);
}

export default function CharacterGame() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { mode = 'normal' } = useParams();
  const location = useLocation();
  const [characters, setCharacters] = useState<CharacterListEntry[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [maxGuesses, setMaxGuesses] = useState(8);
  const [guesses, setGuesses] = useState<CharacterGuessFeedback[]>([]);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [answer, setAnswer] = useState<CharacterClue | null>(null);
  const [settlementRecorded, setSettlementRecorded] = useState<boolean | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const gameIdRef = useRef<string | null>(null);
  const poolKeyRef = useRef<string | undefined>(
    (location.state as { pool?: string } | null)?.pool
  );
  const boardEndRef = useRef<HTMLDivElement>(null);
  const isValidMode = AVAILABLE_DIFFICULTIES.some((d) => d.key === mode);
  const isCustom = mode === 'custom';
  const customPoolMissing = isCustom && !poolKeyRef.current;
  const busy = starting || submitting || revealing || leaving;

  useEffect(() => {
    if (!isValidMode || customPoolMissing) {
      navigate('/character', { replace: true });
    }
  }, [isValidMode, customPoolMissing, navigate]);

  useEffect(() => {
    api.get<CharacterListEntry[]>('/characters/list')
      .then((res) => setCharacters(res.data))
      .catch((error) => toast.error(errMsg(error)));
  }, []);

  const setCurrentGameId = (id: string | null) => {
    gameIdRef.current = id;
    setGameId(id);
  };

  const start = useCallback(async (replace = true) => {
    setStartError(null);
    setStarting(true);
    setAnswer(null);
    setSettlementRecorded(null);
    setShowOverlay(false);
    setStatus('playing');
    try {
      const previous = gameIdRef.current;
      if (replace && previous) {
        setCurrentGameId(null);
        setGuesses([]);
        await exitGame(previous);
      }
      const res = await api.post<{
        gameId: string;
        maxGuesses: number;
        guesses?: CharacterGuessFeedback[];
      }>('/characters/game/start', {
        mode,
        ...(isCustom ? { pool: poolKeyRef.current } : {}),
      });
      setCurrentGameId(String(res.data.gameId));
      setGuesses(res.data.guesses ?? []);
      setMaxGuesses(res.data.maxGuesses);
    } catch (err) {
      setStartError(errMsg(err));
    } finally {
      setStarting(false);
    }
  }, [isCustom, mode]);

  useEffect(() => {
    if (!isValidMode || customPoolMissing) return;
    void start(false);
  }, [isValidMode, customPoolMissing, start]);

  useEffect(() => {
    if (!inputFocused || !window.matchMedia('(max-width: 640px)').matches) return;
    let frame = 0;
    const keepLatestVisible = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        boardEndRef.current?.scrollIntoView({ block: 'end' });
      });
    };
    keepLatestVisible();
    window.visualViewport?.addEventListener('resize', keepLatestVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', keepLatestVisible);
    };
  }, [guesses.length, inputFocused]);

  const characterOptions = useMemo(
    () => characters.map((character) => ({
      id: character.id,
      title: character.name,
      aliases: character.names,
      subtitle: character.firstGame ? (character.firstGame.titleCn || character.firstGame.title) : undefined,
    })),
    [characters]
  );

  const searchCharacterOptions = useCallback((
    list: Array<{ id: string | number; title: string; aliases?: string[] }>,
    query: string
  ) => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return list
      .filter((character) =>
        [character.title, ...(character.aliases ?? [])].some((name) =>
          name.toLocaleLowerCase().includes(normalized)
        )
      )
      .slice(0, 50);
  }, []);

  const nameById = useMemo(
    () => new Map(characters.map((character) => [character.id, character.name])),
    [characters]
  );

  if (!isValidMode || customPoolMissing) return null;

  const leaveTo = async (
    dest: string,
    copy?: { title: string; message: string; confirmLabel: string }
  ) => {
    if (busy) return;
    const isGameActive = Boolean(gameIdRef.current) && status === 'playing';
    if (isGameActive && !await confirm({
      title: copy?.title ?? t('game.leaveTitle'),
      message: copy?.message ?? t('game.leaveMessage'),
      confirmLabel: copy?.confirmLabel ?? t('game.leaveConfirm'),
      tone: 'danger',
    })) return;
    const id = gameIdRef.current;
    setLeaving(true);
    setCurrentGameId(null);
    try {
      if (id && isGameActive) await exitGame(id);
    } catch (err) {
      toast.error(errMsg(err));
    }
    navigate(dest);
  };

  const leave = () => leaveTo('/');
  const goBack = () => leaveTo('/character', {
    title: t('game.backToLobbyTitle'),
    message: t('game.backToLobbyMessage'),
    confirmLabel: t('game.backToLobbyConfirm'),
  });

  const restart = async () => {
    if (busy) return;
    const isGameActive = Boolean(gameIdRef.current) && status === 'playing';
    if (isGameActive && !await confirm({
      title: t('game.restartTitle'),
      message: t('game.restartMessage'),
      confirmLabel: t('game.restart'),
      tone: 'danger',
    })) return;
    await start(true);
  };

  const guess = async (characterId: string) => {
    if (!gameId || status !== 'playing' || busy) return false;
    setSubmitting(true);
    try {
      const res = await api.post<{
        feedback: CharacterGuessFeedback;
        status: 'playing' | 'won' | 'lost';
        maxGuesses: number;
        answer?: CharacterClue;
        recorded?: boolean;
      }>(`/characters/game/${gameId}/guess`, { characterId });
      setGuesses((current) => [...current, res.data.feedback]);
      setStatus(res.data.status);
      if (res.data.answer) {
        setSettlementRecorded(res.data.recorded !== false);
        setAnswer(res.data.answer);
        setShowOverlay(true);
      }
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const reveal = async () => {
    if (!gameId || status !== 'playing' || busy) return;
    if (!await confirm({
      title: t('character.revealTitle'),
      message: t('character.revealMessage'),
      confirmLabel: t('character.reveal'),
      tone: 'danger',
    })) return;
    setRevealing(true);
    try {
      const res = await api.post<{
        status: 'lost';
        answer: CharacterClue;
        recorded?: boolean;
      }>(`/characters/game/${gameId}/reveal`);
      setStatus('lost');
      setSettlementRecorded(res.data.recorded !== false);
      setAnswer(res.data.answer);
      setShowOverlay(true);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRevealing(false);
    }
  };

  const finished = status !== 'playing';
  const busyStatus = starting
    ? t('character.starting')
    : revealing
      ? t('multi.processing')
      : leaving
        ? t('multi.leaving')
        : null;

  return (
    <Page
      className={`game-page character-game-page${inputFocused ? ' keyboard-active' : ''}`}
      title={t('character.pageTitle')}
      icon={<User size={17} />}
      actions={
        <>
          <button
            className="btn btn-ghost btn-sm"
            aria-label={t('game.restart')}
            onClick={() => void restart()}
            disabled={busy || !gameId}
          >
            <RotateCcw size={15} />
            <span className="btn-text">{starting ? t('character.starting') : t('game.restart')}</span>
          </button>
          <button
            className="btn btn-ghost btn-sm"
            aria-label={t('common.home')}
            onClick={() => void leave()}
            disabled={busy}
          >
            <Home size={15} />
            <span className="btn-text">{leaving ? t('multi.leaving') : t('common.home')}</span>
          </button>
          <button
            className="btn btn-warning btn-sm"
            aria-label={t('character.reveal')}
            onClick={() => void reveal()}
            disabled={finished || busy}
          >
            <Lightbulb size={15} />
            <span className="btn-text">{revealing ? t('multi.processing') : t('character.reveal')}</span>
          </button>
        </>
      }
      showHome={false}
      onBack={() => void goBack()}
      statusBar={
        <>
          <Target size={14} />
          <span
            className="guess-progress"
            role="img"
            aria-label={t('character.guesses', { current: guesses.length, max: maxGuesses })}
            title={t('character.guesses', { current: guesses.length, max: maxGuesses })}
          >
            {Array.from({ length: maxGuesses }, (_, i) => (
              <i key={i} className={i < guesses.length ? 'used' : ''} />
            ))}
          </span>
          <span style={{ color: 'var(--border)' }}>|</span>
          {busyStatus
            ?? (finished
              ? status === 'won'
                ? t('character.correct')
                : t('character.ended')
              : t('game.hint'))}
        </>
      }
      dock={
        finished ? (
          <div className="input-bar" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => void restart()} disabled={busy}>
              <RotateCcw size={15} />
              {starting ? t('character.starting') : t('character.again')}
            </button>
            <button className="btn btn-danger" onClick={() => void leave()} disabled={busy}>
              <X size={15} />
              {leaving ? t('multi.leaving') : t('character.back')}
            </button>
          </div>
        ) : (
          <>
            <div className="guess-progress-dock" aria-hidden="true">
              <span className="guess-progress">
                {Array.from({ length: maxGuesses }, (_, i) => (
                  <i key={i} className={i < guesses.length ? 'used' : ''} />
                ))}
              </span>
            </div>
            <GuessInputBar
              onPick={(item) => guess(String(item.id))}
              onFocusChange={setInputFocused}
              disabled={busy || !gameId}
              placeholder={t('character.guessPlaceholder')}
              buttonText={t('character.submit')}
              options={characterOptions}
              searchOptions={searchCharacterOptions}
            />
          </>
        )
      }
    >
      {guesses.length ? (
        <div className="single-game-board">
          <CharacterGuessBoard guesses={guesses} names={nameById} />
          <div ref={boardEndRef} className="guess-board-end" aria-hidden="true" />
        </div>
      ) : startError ? (
        <div className="game-empty">
          <Target size={32} strokeWidth={1.5} />
          <p className="game-empty-title">{t('game.startFailedTitle')}</p>
          <p>{startError}</p>
          <div className="game-empty-actions">
            <button className="btn" onClick={() => void start(false)} disabled={busy}>
              {starting ? t('character.starting') : t('game.startRetry')}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/character')} disabled={busy}>
              {t('game.backToLobby')}
            </button>
          </div>
        </div>
      ) : busy ? (
        <div className="game-empty">
          <div className="spinner" />
          <p>{busyStatus}</p>
        </div>
      ) : (
        <div className="game-empty">
          <Target size={28} strokeWidth={1.5} />
          <p>{t('character.empty')}</p>
          <div className="guess-legend" aria-label={t('rules.feedbackLabel')}>
            <span><i className="legend-correct" />{t('rules.greenTitle')}</span>
            <span><i className="legend-close" />{t('rules.yellowTitle')}</span>
            <span><i className="legend-wrong" />{t('rules.grayTitle')}</span>
            <span><i className="legend-arrow">↕</i>{t('rules.arrowTitle')}</span>
          </div>
        </div>
      )}

      {showOverlay && answer && (
        <CharacterAnswerOverlay
          title={status === 'won' ? t('character.correct') : t('character.correctAnswer')}
          answer={answer}
          tone={status === 'won' ? 'win' : 'lose'}
          onClose={busy ? undefined : () => setShowOverlay(false)}
          extra={
            <>
              <p className="muted">
                {status === 'won'
                  ? t('character.usedGuesses', { count: guesses.length })
                  : t('character.missed')}
              </p>
              {settlementRecorded === false && (
                <div className="single-settlement-not-recorded" role="status">
                  <CircleAlert size={17} aria-hidden="true" />
                  <span>{t('game.settlementNotRecorded')}</span>
                </div>
              )}
            </>
          }
          actions={
            <>
              <button className="btn" onClick={() => void restart()} disabled={busy}>
                <RotateCcw size={15} />
                {starting ? t('character.starting') : t('character.again')}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowOverlay(false)} disabled={busy}>
                {t('game.viewGame')}
              </button>
            </>
          }
        />
      )}
    </Page>
  );
}
