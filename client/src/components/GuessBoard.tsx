import { ArrowUp, ArrowDown } from 'lucide-react';
import { memo } from 'react';
import {
  AttributeFeedback,
  HiddenAttributeFeedback,
  MultiplayerGuessFeedback,
} from '../types';
import { useTranslation } from 'react-i18next';

function Cell({
  attr,
  label,
  bool,
  format,
  truthyText,
  falsyText,
}: {
  attr: AttributeFeedback | HiddenAttributeFeedback;
  label: string;
  bool?: boolean;
  format?: (value: string) => string;
  truthyText?: string;
  falsyText?: string;
}) {
  const { t } = useTranslation();
  if (!('value' in attr)) {
    return (
      <td className={`${attr.level} masked-cell`} data-label={label}>
        {attr.hint && attr.level !== 'correct' && (
          <span className="dir">
            {attr.hint === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          </span>
        )}
      </td>
    );
  }
  // staff 类属性携带逐人匹配信息：每人一个圆角小标签，仅命中的标绿，不再整格标黄
  if (Array.isArray(attr.parts)) {
    return (
      <td className="staff-cell" data-label={label}>
        {attr.parts.length ? (
          <>
            {attr.parts.map((part, index) => (
              <span key={index} className={`staff-chip${part.matched ? ' matched' : ''}`}>
                {part.name}
              </span>
            ))}
            {typeof attr.omitted === 'number' && attr.omitted > 0 && (
              <span className="staff-chip staff-omitted" title={`${attr.omitted}`}>……</span>
            )}
          </>
        ) : (
          <span className="staff-empty">-</span>
        )}
      </td>
    );
  }
  const text =
    typeof attr.value === 'boolean' || bool
      ? attr.value
        ? truthyText ?? t('guess.r18')
        : falsyText ?? t('guess.allAges')
      : format
        ? format(String(attr.value))
        : String(attr.value);
  return (
    <td className={attr.level} data-label={label}>
      {text}
      {attr.hint && attr.level !== 'correct' && (
        <span className="dir">
          {attr.hint === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
        </span>
      )}
    </td>
  );
}

/** 猜测反馈表:每行一次猜测的逐属性对比 */
function GuessBoard({ guesses }: { guesses: MultiplayerGuessFeedback[] }) {
  const { t } = useTranslation();
  const columns = [
    t('guess.columns.title'),
    t('guess.columns.releaseYear'),
    t('guess.columns.company'),
    t('guess.columns.isR18'),
    t('guess.columns.isSeries'),
    t('guess.columns.length'),
    t('guess.columns.bgmScore'),
    t('guess.columns.tags'),
    t('guess.columns.scenarioWriter'),
    t('guess.columns.artist'),
    t('guess.columns.voiceActor'),
  ];
  return (
    <div className="game-table-wrap">
      <table className="game-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guesses.map((g, i) => (
            <tr
              key={'hidden' in g ? `hidden-${i}` : `${g.gameId}-${i}`}
              className={`${i === guesses.length - 1 ? 'row-latest' : ''} ${g.correct ? 'row-correct' : ''}`}
            >
              <td
                className={`name ${g.correct ? 'correct' : ''} ${'hidden' in g ? 'masked-cell' : ''}`}
                data-label={columns[0]}
              >
                {'hidden' in g ? null : g.title}
              </td>
              <Cell attr={g.attributes.releaseYear} label={columns[1]} />
              <Cell attr={g.attributes.company} label={columns[2]} />
              <Cell attr={g.attributes.isR18} label={columns[3]} bool />
              <Cell attr={g.attributes.isSeries} label={columns[4]} bool truthyText={t('guess.seriesYes')} falsyText={t('guess.seriesNo')} />
              <Cell attr={g.attributes.length} label={columns[5]} format={(v) => t(`guess.length.${v}`)} />
              <Cell attr={g.attributes.bgmScore} label={columns[6]} />
              <Cell attr={g.attributes.tags} label={columns[7]} />
              <Cell attr={g.attributes.scenarioWriter} label={columns[8]} />
              <Cell attr={g.attributes.artist} label={columns[9]} />
              <Cell attr={g.attributes.voiceActor} label={columns[10]} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(GuessBoard);
