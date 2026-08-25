import { memo, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff } from 'lucide-react';
import { AttributeFeedback, CharacterGuessFeedback } from '../types';
import { characterTraitLabel } from '../utils/characterTraits';
import { useTranslation } from 'react-i18next';

const GROUP_ORDER = [
  { key: 'clothes', group: 'Clothes' },
  { key: 'role', group: 'Role' },
  { key: 'hair', group: 'Hair' },
  { key: 'eyes', group: 'Eyes' },
] as const;
const MAX_TAGS_PER_CELL = 4;
/** 规则1：总数 <=5 全显示；>5 时从 4 开始截断，最多显示 5 个 cell（4 个值 + +N）。alwaysShown 用于发色等恒显示项 */
function visibleCountFor(total: number, alwaysShown = 0): number {
  return Math.max(total <= 5 ? total : MAX_TAGS_PER_CELL, alwaysShown);
}
const HAIR_COLOR_TRAITS = new Set([
  'Black', 'Blond', 'Blue', 'Brown', 'Green', 'Grey', 'Pink', 'Red', 'Violet', 'White',
]);

function FeedbackArrow({ hint }: { hint?: 'higher' | 'lower' }) {
  if (!hint) return null;
  return (
    <span className="dir">
      {hint === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
    </span>
  );
}

function CharacterCover({ src, label }: { src?: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span className="character-cover-empty">
        <ImageOff size={15} />
      </span>
    );
  }
  return (
    <img
      className="character-cover"
      src={src}
      alt={label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function sexLabel(value: number | string | boolean): string {
  const sex = String(value);
  if (sex === 'f') return '女';
  if (sex === 'm') return '男';
  if (sex === 'b') return '双';
  if (sex === 'n') return '无';
  return sex || '-';
}

function Cell({
  attr,
  chip,
  format,
  group,
  greenOnly,
  staffCell,
}: {
  attr: AttributeFeedback;
  chip?: (name: string) => string;
  format?: (value: number | string | boolean) => string;
  group?: string;
  greenOnly?: boolean;
  staffCell?: boolean;
}) {
  const { t } = useTranslation();
  const cellClass = greenOnly
    ? attr.level === 'correct' ? 'correct' : ''
    : attr.level;
  if (Array.isArray(attr.parts)) {
    const colorParts = group === 'Hair'
      ? attr.parts.filter((part) => HAIR_COLOR_TRAITS.has(part.name))
      : [];
    const otherParts = group === 'Hair'
      ? attr.parts.filter((part) => !HAIR_COLOR_TRAITS.has(part.name))
      : attr.parts;
    const orderedParts = group === 'Hair' ? [...colorParts, ...otherParts] : attr.parts;
    const visibleParts = orderedParts.slice(0, visibleCountFor(attr.parts.length, colorParts.length));
    const omittedCount = attr.parts.length - visibleParts.length;
    return (
      <td className={staffCell ? 'staff-cell' : `character-cell ${cellClass}`}>
        {attr.parts.length ? (
          <>
            {visibleParts.map((part, index) => (
              <span
                key={`${part.name}-${index}`}
                className={`staff-chip${part.matched ? ' matched' : ''}`}
              >
                {chip ? chip(part.name) : characterTraitLabel(part.name, group)}
              </span>
            ))}
            {omittedCount > 0 && (
              <span className="staff-chip staff-omitted" title={`+${omittedCount}`}>
                +{omittedCount}
              </span>
            )}
          </>
        ) : (
          <span className="staff-empty">-</span>
        )}
      </td>
    );
  }
  return (
    <td className={`character-cell ${cellClass}`}>
      {format ? format(attr.value) : String(attr.value)}
      <FeedbackArrow hint={attr.hint} />
    </td>
  );
}

interface Props {
  guesses: CharacterGuessFeedback[];
  names?: Map<string, string>;
}

/** 猜角色反馈表：一行一次猜测，逐属性给出对比反馈。 */
function CharacterGuessBoard({ guesses, names }: Props) {
  const { t } = useTranslation();
  return (
    <div className="game-table-wrap">
      <table className="game-table character-table">
        <thead>
          <tr>
            <th>{t('character.portrait')}</th>
            <th>{t('guess.columns.title')}</th>
            <th>{t('character.game')}</th>
            <th>
              <span className="release-header-line">{t('character.earliestAppearance')}</span>
              <span className="release-header-line">{t('character.latestAppearance')}</span>
            </th>
            <th>{t('character.sex')}</th>
            <th>{t('character.height')}</th>
            {GROUP_ORDER.map(({ group }) => (
              <th key={group}>{t(`character.group.${group}`, { defaultValue: group })}</th>
            ))}
            <th>{t('character.voiceActor')}</th>
          </tr>
        </thead>
        <tbody>
          {guesses.map((feedback, index) => (
            <tr
              key={`${feedback.guessId}-${index}`}
              className={`${index === guesses.length - 1 ? 'row-latest' : ''} ${feedback.correct ? 'row-correct' : ''}`}
            >
              <td className="character-cover-cell" data-label={t('character.portrait')}>
                <CharacterCover
                  src={feedback.image}
                  label={names?.get(feedback.guessId) ?? feedback.guessId}
                />
              </td>
              <td className={`name ${feedback.correct ? 'correct' : feedback.nameLevel === 'close' ? 'close' : ''}`}>
                {names?.get(feedback.guessId) ?? feedback.guessId}
              </td>
              <td className="character-cell character-game-cell">
                {(() => {
                  const parts = feedback.works.parts ?? feedback.gameTitles.map((title) => ({ name: title, matched: false }));
                  const visible = parts.slice(0, visibleCountFor(parts.length));
                  const omitted = feedback.works.omitted ?? Math.max(0, parts.length - visible.length);
                  return visible.length ? (
                    <>
                      {visible.map((part, index) => (
                        <span key={`${part.name}-${index}`} className={`staff-chip${part.matched ? ' matched' : ''}`}>
                          {part.name}
                        </span>
                      ))}
                      {omitted > 0 && (
                        <span className="staff-chip staff-omitted" title={`+${omitted}`}>+{omitted}</span>
                      )}
                    </>
                  ) : '-';
                })()}
              </td>
              <td className="character-cell release-range-cell">
                <span className={`release-year ${feedback.releaseRange.earliest.level}`}>
                  {String(feedback.releaseRange.earliest.value)}
                  <FeedbackArrow hint={feedback.releaseRange.earliest.hint} />
                </span>
                <span className={`release-year ${feedback.releaseRange.latest.level}`}>
                  {String(feedback.releaseRange.latest.value)}
                  <FeedbackArrow hint={feedback.releaseRange.latest.hint} />
                </span>
              </td>
              <td className={`character-cell ${feedback.attributes.sex.level}`}>
                {sexLabel(feedback.attributes.sex.value)}
              </td>
              <td className={`character-cell ${feedback.attributes.height.level}`}>
                {String(feedback.attributes.height.value)}
                <FeedbackArrow hint={feedback.attributes.height.hint} />
              </td>
              {GROUP_ORDER.map(({ key, group }) => (
                <Cell key={key} attr={feedback.attributes[key]} group={group} greenOnly />
              ))}
              <Cell
                attr={feedback.attributes.voiceActor}
                chip={(name) => name}
                staffCell
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(CharacterGuessBoard);
