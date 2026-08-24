import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus, Search } from 'lucide-react';
import DataTable, { Column } from '../DataTable';
import GameEditForm, { GameForm, emptyGame } from './PlayerEditForm';
import { api, errMsg } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';
import { clearGameListCache } from '../../api/playerList';
import { toast } from '../Toast';
import { useTranslation } from 'react-i18next';
import { difficultyLabel } from '../../utils/difficulty';
import { STAT_ELIGIBLE_DIFFICULTIES } from '../../config/difficulties';

interface AdminGame extends GameForm {
  id: number;
}

interface GamePage {
  games: AdminGame[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 管理后台 - 作品管理(列表/新增/编辑/删除/JSON 导入导出) */
export default function AdminPlayers() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [games, setGames] = useState<AdminGame[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<GameForm | null>(null);
  const [importText, setImportText] = useState('');
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await api.get<GamePage>('/admin/games', {
        params: { page, pageSize, search: search || undefined },
      });
      if (currentRequest !== requestId.current) return;
      setGames(res.data.games.map((g) => ({
        ...g,
        difficulties: g.difficulties ?? [],
        release_year: Number(g.release_year),
        bgm_score: Number(g.bgm_score),
        is_r18: Boolean(g.is_r18),
        is_active: Boolean(g.is_active),
        is_enabled: Boolean(g.is_enabled),
      })));
      setTotal(res.data.total);
      if (res.data.page !== page) setPage(res.data.page);
    } catch (err) {
      if (currentRequest === requestId.current) toast.error(errMsg(err));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void load();
  }, [load]);


  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const save = async (form: GameForm) => {
    try {
      const { id, ...body } = form;
      if (id) {
        await api.put(`/admin/games/${id}`, body);
      } else {
        await api.post('/admin/games', body);
      }
      clearGameListCache();
      setEditing(null);
      toast.success(id ? t('admin.saved') : t('admin.added'));
      if (!id && page !== 1) setPage(1);
      else await load();
    } catch (err) {
      throw new Error(errMsg(err));
    }
  };

  const setEnabled = async (g: AdminGame, isEnabled: boolean) => {
    if (!isEnabled && !await confirm({
      title: t('admin.disableTitle', { title: g.title }),
      message: t('admin.disableMessage'),
      confirmLabel: t('admin.disableConfirm'),
      tone: 'warning',
    })) return;
    try {
      await api.put(`/admin/games/${g.id}`, { is_enabled: isEnabled });
      clearGameListCache();
      toast.success(isEnabled ? t('admin.enabledSuccess', { title: g.title }) : t('admin.disabledSuccess', { title: g.title }));
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async (g: AdminGame) => {
    if (!await confirm({
      title: t('admin.deleteTitle', { title: g.title }),
      message: t('admin.deleteMessage'),
      confirmLabel: t('admin.deleteConfirm'),
      tone: 'danger',
    })) return;
    try {
      await api.delete(`/admin/games/${g.id}`);
      clearGameListCache();
      toast.success(t('admin.deleted', { title: g.title }));
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const doImport = async () => {
    try {
      const parsed = JSON.parse(importText);
      const list = Array.isArray(parsed) ? parsed : parsed.games;
      const res = await api.post('/admin/games/import', { games: list });
      clearGameListCache();
      toast.success(t('admin.importDone', { created: res.data.created, updated: res.data.updated }));
      setImportText('');
      if (page !== 1) setPage(1);
      else await load();
    } catch (err) {
      toast.error(err instanceof SyntaxError ? t('admin.jsonError') : errMsg(err));
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await api.get<GameForm[]>('/admin/games/export');
      const blob = new Blob([`${JSON.stringify(res.data, null, 2)}\n`], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'games.json';
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        URL.revokeObjectURL(url);
      }
      toast.success(t('admin.exportDone', { count: res.data.length }));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AdminGame>[] = [
    { key: 'title', title: t('admin.gameTitle') },
    { key: 'title_cn', title: t('admin.gameTitleCn') },
    { key: 'release_year', title: t('admin.releaseYear') },
    { key: 'company', title: t('admin.company') },
    { key: 'is_r18', title: t('admin.isR18'), render: (g) => (g.is_r18 ? t('guess.r18') : t('guess.allAges')) },
    { key: 'scenario_writer', title: t('admin.scenarioWriter') },
    { key: 'music_composer', title: t('admin.musicComposer') },
    { key: 'artist', title: t('admin.artist') },
    { key: 'voice_actor', title: t('admin.voiceActor') },
    { key: 'bgm_score', title: t('admin.bgmScore'), render: (g) => g.bgm_score.toFixed(2) },
    { key: 'difficulties', title: t('admin.difficulties'), render: (g) => g.difficulties.map((key) => difficultyLabel(t, key)).join(', ') },
    { key: 'is_enabled', title: t('admin.pool'), render: (g) => (g.is_enabled ? t('admin.available') : t('admin.disabled')) },
    {
      key: 'actions',
      title: t('admin.actions'),
      render: (g) => (
        <span className="admin-player-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(g)}>{t('admin.edit')}</button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void setEnabled(g, !g.is_enabled)}
          >
            {g.is_enabled ? t('admin.disable') : t('admin.enable')}
          </button>
          <button
            type="button"
            className="btn btn-red"
            onClick={() => void remove(g)}
            disabled={g.is_enabled}
            title={g.is_enabled ? t('admin.disableFirst') : t('admin.delete')}
          >
            {t('admin.delete')}
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="card admin-players-card">
        <div className="admin-players-header">
          <div className="admin-players-title">
            <h3>{t('admin.gamesManagementTitle')}</h3>
            <p className="muted">{t('admin.totalGames', { count: total })}</p>
          </div>
          <div className="admin-player-header-actions">
            <button
              type="button"
              className="btn btn-ghost admin-player-export"
              onClick={() => void doExport()}
              disabled={exporting}
            >
              <Download size={16} />
              {exporting ? t('admin.exporting') : t('admin.exportAction')}
            </button>
            <button
              type="button"
              className="btn btn-green admin-player-add"
              onClick={() => setEditing({ ...emptyGame })}
            >
              <Plus size={16} />
              {t('admin.addGame')}
            </button>
          </div>
        </div>
        <div className="admin-list-toolbar">
          <label className="admin-search">
            <Search size={16} />
            <input
              className="input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('admin.searchGames')}
            />
          </label>
          <label className="admin-page-size">
            <span>{t('admin.pageSize')}</span>
            <select
              className="input"
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        <div className="admin-players-table">
          <DataTable
            columns={columns}
            rows={games}
            rowKey={(g) => g.id}
            empty={loading ? t('common.loading') : search ? t('admin.noMatchGames') : t('admin.noGames')}
          />
        </div>
        <div className="admin-pagination">
          <span className="muted">
            {total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} / ${total}` : t('admin.zeroItems')}
          </span>
          <div className="admin-pagination-actions">
            <button
              className="btn btn-ghost"
              aria-label={t('common.previousPage')}
              title={t('common.previousPage')}
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={17} />
            </button>
            <span>{t('admin.pageOf', { page, total: Math.max(1, Math.ceil(total / pageSize)) })}</span>
            <button
              className="btn btn-ghost"
              aria-label={t('common.nextPage')}
              title={t('common.nextPage')}
              disabled={loading || page >= Math.max(1, Math.ceil(total / pageSize))}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="card admin-import-card">
        <h3>{t('admin.importTitle')}</h3>
        <p className="muted">
          {t('admin.importDescription')}
        </p>
        <textarea
          className="input"
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={t('admin.importPlaceholder')}
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void doImport()} disabled={!importText.trim()}>
          {t('admin.importAction')}
        </button>
      </div>
      {editing && (
        <GameEditForm
          key={editing.id ?? 'new'}
          initial={editing}
          difficultyKeys={STAT_ELIGIBLE_DIFFICULTIES.map((item) => item.key)}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
