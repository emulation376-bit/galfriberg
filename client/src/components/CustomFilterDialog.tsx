import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, X, RotateCcw, Play } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { api, errMsg } from '../api/client';
import { toast } from './Toast';
import { useTranslation } from 'react-i18next';
import {
  CustomFilterCriteria,
  EMPTY_CUSTOM_FILTER,
  getStoredCustomFilter,
  setStoredCustomFilter,
} from '../store/customFilter';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FilterResult {
  poolKey: string;
  count: number;
}

const FILTER_DEBOUNCE_MS = 400;

function toNumber(value: string): number | undefined {
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

export default function CustomFilterDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<CustomFilterCriteria>(getStoredCustomFilter);
  const [count, setCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const applyFilter = async (next: CustomFilterCriteria, save = true) => {
    setChecking(true);
    try {
      const res = await api.post<FilterResult>('/game/filter', {
        minVotes: toNumber(next.minVotes),
        minScore: toNumber(next.minScore),
        yearFrom: toNumber(next.yearFrom),
        yearTo: toNumber(next.yearTo),
        maxGuesses: toNumber(next.maxGuesses),
      });
      setCount(res.data.count);
      if (save) setStoredCustomFilter(next);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const initial = getStoredCustomFilter();
    setCriteria(initial);
    void applyFilter(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (field: keyof CustomFilterCriteria, value: string) => {
    const next = { ...criteria, [field]: value };
    setCriteria(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void applyFilter(next, true);
    }, FILTER_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const clear = () => {
    setCriteria(EMPTY_CUSTOM_FILTER);
    void applyFilter(EMPTY_CUSTOM_FILTER, true);
  };

  const start = async () => {
    setBusy(true);
    try {
      const res = await api.post<FilterResult>('/game/filter', {
        minVotes: toNumber(criteria.minVotes),
        minScore: toNumber(criteria.minScore),
        yearFrom: toNumber(criteria.yearFrom),
        yearTo: toNumber(criteria.yearTo),
        maxGuesses: toNumber(criteria.maxGuesses),
      });
      if (res.data.count === 0) {
        toast.error(t('customFilter.empty'));
        return;
      }
      setStoredCustomFilter(criteria);
      onClose();
      navigate('/single/custom', { state: { pool: res.data.poolKey } });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const hasCriteria = Object.values(criteria).some((v) => v.trim() !== '');
  const emptyResult = count != null && count === 0;

  const field = (
    label: string,
    key: keyof CustomFilterCriteria,
    placeholder: string,
    hint: string,
    min = 0
  ) => (
    <label className="custom-filter-field">
      <span className="custom-filter-label">{label}</span>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={min}
        value={criteria[key]}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value)}
      />
      <small className="muted">{hint}</small>
    </label>
  );

  return (
    <ModalPortal>
      <div className="confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="confirm-dialog custom-filter-dialog" role="dialog" aria-modal="true" aria-label={t('customFilter.title')}>
          <div className="confirm-heading">
            <h2>
              <Filter size={17} /> {t('customFilter.title')}
            </h2>
            <button className="confirm-close" type="button" aria-label={t('common.close')} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <p className="muted custom-filter-subtitle">{t('customFilter.subtitle')}</p>

          <div className="custom-filter-grid">
            {field(t('customFilter.minVotes'), 'minVotes', '500', t('customFilter.minVotesHint'))}
            {field(t('customFilter.minScore'), 'minScore', '7.0', t('customFilter.minScoreHint'))}
            {field(t('customFilter.yearFrom'), 'yearFrom', '2008', t('customFilter.yearHint'))}
            {field(t('customFilter.yearTo'), 'yearTo', '2015', t('customFilter.yearHint'))}
            {field(t('customFilter.maxGuesses'), 'maxGuesses', '8', t('customFilter.maxGuessesHint'), 1)}
          </div>

          <div className={`custom-filter-count${emptyResult ? ' error' : ''}`}>
            {checking
              ? <span className="muted">…</span>
              : emptyResult
                ? t('customFilter.empty')
                : count != null
                  ? t('customFilter.count', { count })
                  : null}
          </div>

          <div className="confirm-actions custom-filter-actions">
            <button className="btn btn-ghost" type="button" onClick={clear} disabled={!hasCriteria}>
              <RotateCcw size={15} /> {t('customFilter.clear')}
            </button>
            <button className="btn" type="button" onClick={() => void start()} disabled={busy || emptyResult}>
              <Play size={15} /> {t('customFilter.start')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
