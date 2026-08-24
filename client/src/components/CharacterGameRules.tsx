import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Target,
  X,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import { useTranslation } from 'react-i18next';

export default function CharacterGameRules() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeRules = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRules();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeRules, open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="btn game-rules-trigger"
        type="button"
        onClick={() => setOpen(true)}
        data-umami-event="character-rules-open"
      >
        <BookOpen size={14} aria-hidden="true" />
        {t('characterRules.trigger')}
      </button>

      {open && (
        <ModalPortal>
          <div
            className="game-rules-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeRules();
            }}
          >
            <div
              className="game-rules-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header className="game-rules-dialog-heading">
                <span className="game-rules-heading-icon" aria-hidden="true">
                  <BookOpen size={24} />
                </span>
                <div className="game-rules-heading-copy">
                  <span className="game-rules-kicker">HOW TO PLAY</span>
                  <h2 id={titleId}>{t('characterRules.title')}</h2>
                  <p>{t('characterRules.description')}</p>
                </div>
                <strong className="guess-limit"><span>{t('characterRules.max')}</span> {t('characterRules.guesses')}</strong>
                <button
                  ref={closeRef}
                  className="confirm-close"
                  type="button"
                  aria-label={t('characterRules.close')}
                  onClick={closeRules}
                  data-umami-event="character-rules-close"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="game-rules-dialog-body">
                <div className="rule-quick-guide" aria-label={t('characterRules.feedbackLabel')}>
                  <div className="rule-feedback rule-feedback-correct">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>{t('characterRules.greenTitle')}</strong><span>{t('characterRules.greenText')}</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-close">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>{t('characterRules.yellowTitle')}</strong><span>{t('characterRules.yellowText')}</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-wrong">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>{t('characterRules.grayTitle')}</strong><span>{t('characterRules.grayText')}</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-arrow">
                    <span className="rule-arrow-pair" aria-hidden="true"><ArrowUp size={16} /><ArrowDown size={16} /></span>
                    <div><strong>{t('characterRules.arrowTitle')}</strong><span>{t('characterRules.arrowText')}</span></div>
                  </div>
                </div>

                <div className="rule-sections">
                  <article className="rule-panel rule-panel-main">
                    <div className="rule-panel-title">
                      <span aria-hidden="true"><Target size={20} /></span>
                      <div><small>01</small><h3>{t('characterRules.guessTitle')}</h3></div>
                    </div>
                    <p>{t('characterRules.guessIntro')}</p>
                    <div className="rule-field-grid">
                      <div>
                        <strong>{t('characterRules.exactTitle')}</strong>
                        <span>{t('characterRules.exactText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.worksTitle')}</strong>
                        <span>{t('characterRules.worksText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.releaseTitle')}</strong>
                        <span>{t('characterRules.releaseText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.numberTitle')}</strong>
                        <span>{t('characterRules.numberText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.sexTitle')}</strong>
                        <span>{t('characterRules.sexText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.voiceTitle')}</strong>
                        <span>{t('characterRules.voiceText')}</span>
                      </div>
                      <div>
                        <strong>{t('characterRules.traitTitle')}</strong>
                        <span>{t('characterRules.traitText')}</span>
                      </div>
                    </div>
                    <div className="rule-result-notes">
                      <p><span className="rule-result-icon rule-result-win"><Target size={15} /></span><strong>{t('characterRules.winLabel')}</strong>{t('characterRules.winText')}</p>
                      <p><span className="rule-result-icon rule-result-loss">8</span><strong>{t('characterRules.lossLabel')}</strong>{t('characterRules.lossText')}</p>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
