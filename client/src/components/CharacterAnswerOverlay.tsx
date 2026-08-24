import { ReactNode, useEffect } from 'react';
import ModalPortal from './ModalPortal';
import { ExternalLink } from 'lucide-react';
import { CharacterClue } from '../types';
import { useTranslation } from 'react-i18next';
import { characterTraitLabel } from '../utils/characterTraits';

const GROUP_ORDER = ['Clothes', 'Role', 'Hair', 'Eyes'];

interface Props {
  answer: CharacterClue;
  title: string;
  extra?: ReactNode;
  actions: ReactNode;
  onClose?: () => void;
  tone?: 'win' | 'lose';
}

function displayName(answer: CharacterClue): string {
  if (answer.nameCn) return answer.nameCn;
  const priority = ['zh-Hans', 'zh-Hant', 'ja', 'en'];
  for (const lang of priority) {
    const name = answer.names.find((row) => row.lang === lang);
    if (name?.name) return name.name;
  }
  return answer.names[0]?.name ?? answer.id;
}

function sexLabel(sex: string | null): string {
  if (!sex) return '-';
  if (sex === 'f') return '女';
  if (sex === 'm') return '男';
  if (sex === 'b') return '双';
  if (sex === 'n') return '无';
  return sex;
}

function releaseYears(answer: CharacterClue): { earliest: string; latest: string } {
  const dates = answer.games
    .map((game) => game.releaseDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    earliest: dates[0] ? dates[0].slice(0, 4) : '-',
    latest: dates[dates.length - 1] ? dates[dates.length - 1].slice(0, 4) : '-',
  };
}

export function CharacterInfoTable({ answer }: { answer: CharacterClue }) {
  const { t } = useTranslation();
  const grouped = new Map<string, typeof answer.traits>();
  for (const trait of answer.traits) {
    if (!grouped.has(trait.groupName)) grouped.set(trait.groupName, []);
    grouped.get(trait.groupName)!.push(trait);
  }
  const years = releaseYears(answer);

  const detailRows = [
    {
      label: t('character.sex'),
      content: <i className="character-tag">{sexLabel(answer.sex)}</i>,
    },
    {
      label: t('character.height'),
      content: <i className="character-tag">{answer.height ? `${answer.height} cm` : '-'}</i>,
    },
    {
      label: t('character.releaseRange'),
      content: <i className="character-tag">{years.earliest} / {years.latest}</i>,
    },
    {
      label: t('character.voiceActor'),
      content: answer.voiceActors.length
        ? answer.voiceActors.map((actor) => (
          <i key={actor.staffId} className="character-tag character-tag-muted">{actor.name}</i>
        ))
        : <i className="character-tag">-</i>,
    },
    {
      label: t('character.games'),
      content: answer.games.length
        ? answer.games.map((game) => (
          <i key={game.gameId ?? game.title} className="character-tag character-tag-muted">{game.titleCn || game.title}</i>
        ))
        : <i className="character-tag">-</i>,
    },
  ];

  return (
    <>
      <p className="answer-name">{displayName(answer)}</p>
      <div className="character-answer-details">
        {detailRows.map((row) => (
          <div className="character-clue-row" key={row.label}>
            <span className="character-clue-label">{row.label}</span>
            <span className="character-tag-list">{row.content}</span>
          </div>
        ))}
        {GROUP_ORDER.map((group) => {
          const traits = grouped.get(group) ?? [];
          return (
            <div className="character-clue-row" key={group}>
              <span className="character-clue-label">{t(`character.group.${group}`, { defaultValue: group })}</span>
              <span className="character-tag-list">
                {traits.length ? traits.map((trait) => (
                  <i className="character-tag" key={trait.traitId}>{characterTraitLabel(trait.traitName, trait.groupName)}</i>
                )) : <i className="character-tag">-</i>}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function CharacterAnswerOverlay({
  answer,
  title,
  extra,
  actions,
  onClose,
  tone,
}: Props) {
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
          className={`overlay-card character-answer-card${tone ? ` overlay-card-${tone}` : ''}`}
          role="dialog"
          aria-modal="true"
        >
          <h2>{title}</h2>
          {extra}
          <CharacterInfoTable answer={answer} />
          <div className="btns">
            {actions}
            <a className="btn btn-ghost" href={`https://vndb.org/${answer.id}`} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> VNDB
            </a>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
