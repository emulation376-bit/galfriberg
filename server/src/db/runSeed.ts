import { db } from './knex';
import { ensureSchema } from './schema';
import { seedCharactersIfEmpty } from './init';
import { invalidateCached } from '../services/queryCache';
import gamesData from './seeds/games.json';
import announcementsData from './seeds/announcements.json';

interface SeedAnnouncement {
  title: string;
  content: string;
  is_popup?: boolean;
}

interface SeedGame {
  title: string;
  title_cn?: string;
  vndb_id?: string;
  release_year?: number;
  company?: string;
  is_r18?: boolean;
  scenario_writer?: string;
  music_composer?: string;
  artist?: string;
  voice_actor?: string;
  bgm_score?: number;
  difficulties?: string[];
  is_active?: boolean;
  is_enabled?: boolean;
  is_series?: boolean;
  length_minutes?: number;
  tags?: string[];
  aliases?: string[];
}

// 手动执行:补充种子数据中数据库尚不存在的作品与公告(按标题去重)
async function run() {
  await ensureSchema();
  const existingAnnouncements = new Set(
    (await db('announcements').select('title')).map((row) => String(row.title))
  );
  const announcementRows = (announcementsData as SeedAnnouncement[])
    .filter((item) => !existingAnnouncements.has(item.title))
    .map((item) => ({ title: item.title, content: item.content, is_popup: item.is_popup ?? false }));
  if (announcementRows.length) {
    await db('announcements').insert(announcementRows);
  }
  await invalidateCached('announcements');
  console.log(`[seed] 公告 ${announcementRows.length} 条`);

  const existing = new Set(
    (await db('game_titles').select('title')).map((r) => String(r.title))
  );
  const games = (gamesData as SeedGame[]).filter((g) => !existing.has(g.title));
  const rows = games.map((g) => ({
    title: g.title,
    title_cn: g.title_cn ?? '',
    ...(g.vndb_id ? { vndb_id: g.vndb_id } : {}),
    release_year: g.release_year ?? 0,
    company: g.company ?? '',
    is_r18: g.is_r18 ?? false,
    scenario_writer: g.scenario_writer ?? '',
    music_composer: g.music_composer ?? '',
    artist: g.artist ?? '',
    voice_actor: g.voice_actor ?? '',
    bgm_score: g.bgm_score ?? 0,
    is_active: g.is_active ?? true,
    is_enabled: g.is_enabled ?? true,
    is_series: g.is_series ?? false,
    length_minutes: g.length_minutes ?? 0,
    tags: (g.tags ?? []).join('、'),
  }));
  if (rows.length) {
    await db.batchInsert('game_titles', rows, 50);
    const saved = await db('game_titles')
      .whereIn('title', rows.map((g) => g.title))
      .select('id', 'title');
    const idByTitle = new Map(saved.map((r) => [String(r.title), Number(r.id)]));
    const aliasRows = games.flatMap((g) => {
      const gameId = idByTitle.get(g.title);
      if (!gameId) return [];
      return (g.aliases ?? []).map((alias) => ({ game_id: gameId, alias, type: '' }));
    });
    for (let index = 0; index < aliasRows.length; index += 500) {
      await db('game_aliases').insert(aliasRows.slice(index, index + 500));
    }
    const memberships = games.flatMap((g) => {
      const gameId = idByTitle.get(g.title);
      if (!gameId) return [];
      return [...new Set(g.difficulties ?? ['normal'])].map((key) => ({
        game_id: gameId,
        difficulty_key: key,
      }));
    });
    for (let index = 0; index < memberships.length; index += 500) {
      await db('game_difficulties').insert(memberships.slice(index, index + 500))
        .onConflict(['game_id', 'difficulty_key']).ignore();
    }
  }
  console.log(`[seed] 新增 ${rows.length} 部作品`);
  await seedCharactersIfEmpty();
  await db.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
