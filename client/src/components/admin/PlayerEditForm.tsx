import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import ModalPortal from '../ModalPortal';
import { toast } from '../Toast';
import { useTranslation } from 'react-i18next';
import DifficultyMultiSelect from './DifficultyMultiSelect';

export interface GameForm {
  id?: number;
  title: string;
  title_cn: string;
  release_year: number;
  company: string;
  is_r18: boolean;
  scenario_writer: string;
  music_composer: string;
  artist: string;
  voice_actor: string;
  bgm_score: number;
  difficulties: string[];
  is_active: boolean;
  is_enabled: boolean;
}

export const emptyGame: GameForm = {
  title: '',
  title_cn: '',
  release_year: 2010,
  company: '',
  is_r18: false,
  scenario_writer: '',
  music_composer: '',
  artist: '',
  voice_actor: '',
  bgm_score: 0,
  difficulties: ['normal'],
  is_active: true,
  is_enabled: true,
};

interface Props {
  initial: GameForm;
  difficultyKeys: string[];
  onSubmit: (form: GameForm) => Promise<void>;
  onCancel: () => void;
}

export default function GameEditForm({ initial, difficultyKeys, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<GameForm>(initial);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<GameForm>) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstInputRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('admin.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div
        className="admin-player-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) onCancel();
        }}
      >
        <div className="admin-player-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="admin-player-dialog-heading">
            <div>
              <h2 id={titleId}>{form.id ? t('admin.editGame', { title: form.title }) : t('admin.addGame')}</h2>
              <p>{t('admin.formDescription')}</p>
            </div>
            <button className="confirm-close" type="button" aria-label={t('common.close')} onClick={onCancel} disabled={saving}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={submit}>
          <div className="admin-player-form-grid">
            <label className="admin-player-field">
              <span>{t('admin.formTitle')}</span>
              <input ref={firstInputRef} className="input" value={form.title} onChange={(event) => set({ title: event.target.value })} required />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formTitleCn')}</span>
              <input className="input" value={form.title_cn} onChange={(event) => set({ title_cn: event.target.value })} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formReleaseYear')}</span>
              <input className="input" type="number" min="1980" max="2100" value={form.release_year} onChange={(event) => set({ release_year: Number(event.target.value) })} required />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formCompany')}</span>
              <input className="input" value={form.company} onChange={(event) => set({ company: event.target.value })} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formScenarioWriter')}</span>
              <input className="input" value={form.scenario_writer} onChange={(event) => set({ scenario_writer: event.target.value })} placeholder={t('admin.multiValuePlaceholder')} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formMusicComposer')}</span>
              <input className="input" value={form.music_composer} onChange={(event) => set({ music_composer: event.target.value })} placeholder={t('admin.multiValuePlaceholder')} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formArtist')}</span>
              <input className="input" value={form.artist} onChange={(event) => set({ artist: event.target.value })} placeholder={t('admin.multiValuePlaceholder')} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formVoiceActor')}</span>
              <input className="input" value={form.voice_actor} onChange={(event) => set({ voice_actor: event.target.value })} placeholder={t('admin.multiValuePlaceholder')} />
            </label>
            <label className="admin-player-field">
              <span>{t('admin.formBgmScore')}</span>
              <input className="input" type="number" min="0" max="10" step="0.1" value={form.bgm_score} onChange={(event) => set({ bgm_score: Number(event.target.value) })} />
            </label>
          </div>

          <div className="admin-player-flags">
            <div className="admin-player-difficulty-field">
              <span className="admin-player-flag-label">{t('admin.difficulties')}</span>
              <DifficultyMultiSelect
                options={difficultyKeys}
                value={form.difficulties}
                onChange={(difficulties) => set({ difficulties })}
              />
            </div>
            <label><input type="checkbox" checked={form.is_r18} onChange={(event) => set({ is_r18: event.target.checked })} />{t('admin.r18Flag')}</label>
            <label><input type="checkbox" checked={form.is_active} onChange={(event) => set({ is_active: event.target.checked })} />{t('admin.activeGame')}</label>
            <label><input type="checkbox" checked={form.is_enabled} onChange={(event) => set({ is_enabled: event.target.checked })} />{t('admin.enabledGame')}</label>
          </div>

          <div className="admin-player-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>{t('common.cancel')}</button>
            <button className="btn btn-green" disabled={saving || form.difficulties.length === 0}>{saving ? t('admin.saving') : form.id ? t('admin.saveChanges') : t('admin.addGame')}</button>
          </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
