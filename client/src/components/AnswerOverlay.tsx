import { ReactNode, useEffect } from 'react';
import { Calendar, Clock, ExternalLink, Headphones, Layers, Mic, Pen, Palette, Star, ShieldAlert, Tag } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { useTranslation } from 'react-i18next';
import { lengthKey } from '../length';

export interface AnswerInfo {
  title: string;
  titleCn?: string;
  releaseYear?: number;
  company: string;
  isR18?: boolean;
  scenarioWriter?: string;
  musicComposer?: string;
  artist?: string;
  voiceActor?: string;
  tags?: string[];
  isSeries?: boolean;
  lengthMinutes?: number;
  bgmScore?: number;
  vndbId?: string | null;
}

/** Galgame 信息表(答案卡片/查询结果共用) */
export function GameInfoTable({ answer }: { answer: AnswerInfo }) {
  const { t } = useTranslation();
  const rows: [ReactNode, string, ReactNode][] = [
    [<Calendar size={14} key="i" />, t('guess.columns.releaseYear'), answer.releaseYear ?? '-'],
    [
      <ShieldAlert size={14} key="i" />,
      t('guess.columns.isR18'),
      answer.isR18 === undefined ? '-' : answer.isR18 ? t('guess.r18') : t('guess.allAges'),
    ],
    [<Pen size={14} key="i" />, t('guess.columns.scenarioWriter'), answer.scenarioWriter || '-'],
    [<Headphones size={14} key="i" />, t('guess.columns.musicComposer'), answer.musicComposer || '-'],
    [<Palette size={14} key="i" />, t('guess.columns.artist'), answer.artist || '-'],
    [<Mic size={14} key="i" />, t('guess.columns.voiceActor'), answer.voiceActor || '-'],
    [<Tag size={14} key="i" />, t('guess.columns.tags'), (answer.tags ?? []).join('、') || '-'],
    [
      <Layers size={14} key="i" />,
      t('guess.columns.isSeries'),
      answer.isSeries === undefined ? '-' : answer.isSeries ? t('guess.seriesYes') : t('guess.seriesNo'),
    ],
    [
      <Clock size={14} key="i" />,
      t('guess.columns.length'),
      answer.lengthMinutes ? t(`guess.length.${lengthKey(answer.lengthMinutes)}`) : '-',
    ],
    [<Star size={14} key="i" />, t('guess.columns.bgmScore'), answer.bgmScore ?? '-'],
  ];
  return (
    <table className="player-info-table">
      <tbody>
        {rows.map(([icon, label, value]) => (
          <tr key={label}>
            <td className="label">
              {icon}
              {label}
            </td>
            <td className="value">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  title: string;
  answer: AnswerInfo | null;
  extra?: ReactNode;
  actions: ReactNode;
  onClose?: () => void;
  /** 胜负配色:win 绿色调头部,lose 中性 */
  tone?: 'win' | 'lose';
}

/** 结算/答案遮罩卡片 */
export default function AnswerOverlay({ title, answer, extra, actions, onClose, tone }: Props) {
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <ModalPortal>
      <div
        className="overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <div
          className={`overlay-card${tone ? ` overlay-card-${tone}` : ''}`}
          role="dialog"
          aria-modal="true"
        >
          <h2>{title}</h2>
          {extra}
          {answer && (
            <>
              <p className="answer-name">{answer.title}</p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {[answer.titleCn && answer.titleCn !== answer.title ? answer.titleCn : '', answer.company].filter(Boolean).join(' · ')}
              </p>
              <GameInfoTable answer={answer} />
            </>
          )}
          <div className="btns">
            {actions}
            {answer?.vndbId && (
              <a className="btn btn-ghost" href={`https://vndb.org/${answer.vndbId}`} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> VNDB
              </a>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
