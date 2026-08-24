import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateQuery } from '../middleware/common';
import { getPublicGameList, pickRandomGame, searchCachedGames } from '../services/playerCache';
import { rateLimit } from '../middleware/rateLimit';
import { displayName, GameTitle } from '../types';
import { displayStaff } from '../services/staffResolver';

const router = Router();
const gameSearchQuery = z.object({
  search: z.string().trim().max(100).default(''),
  suggest: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
});
const randomGameQuery = z.object({
  exclude: z.coerce.number().int().positive().optional(),
});

function toPublicGame(game: GameTitle) {
  return {
    id: game.id,
    title: displayName(game),
    titleCn: game.title_cn,
    releaseYear: game.release_year,
    company: game.company,
    isR18: Boolean(game.is_r18),
    scenarioWriter: displayStaff(game.scenario_writer),
    musicComposer: displayStaff(game.music_composer),
    artist: displayStaff(game.artist),
    voiceActor: displayStaff(game.voice_actor),
    bgmScore: game.bgm_score,
    vndbId: game.vndb_id ?? null,
    isSeries: Boolean(game.is_series),
    lengthMinutes: Number(game.length_minutes) || 0,
    tags: game.tags ?? [],
  };
}

router.get(
  '/list',
  asyncHandler(async (req, res) => {
    const list = await getPublicGameList();
    const etag = `"games-${list.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('X-Game-List-Version', list.version);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json(list);
  })
);

/**
 * 随机抽取一部启用中的作品
 * - ?exclude=123 排除指定作品(避免连续 roll 到同一部)
 */
router.get(
  '/random',
  rateLimit({
    name: 'game-random',
    limit: 60,
    windowSeconds: 60,
    failClosed: true,
  }),
  validateQuery(randomGameQuery),
  asyncHandler(async (req, res) => {
    const { exclude } = req.query as unknown as z.infer<typeof randomGameQuery>;
    const game = pickRandomGame(exclude);
    if (!game) return res.status(404).json({ code: 'EMPTY_GAME_POOL' });
    res.json(toPublicGame(game));
  })
);

/**
 * 查作品 / 自动补全。
 * - ?search=xxx 模糊搜索作品名/中文名/会社
 * - ?suggest=1 仅返回 id+title(猜测输入补全用,不泄露属性)
 */
router.get(
  '/',
  rateLimit({
    name: 'game-search',
    limit: 60,
    windowSeconds: 60,
    failClosed: true,
  }),
  validateQuery(gameSearchQuery),
  asyncHandler(async (req, res) => {
    const { search, suggest } = req.query as unknown as z.infer<typeof gameSearchQuery>;

    const games = searchCachedGames(search, suggest ? 10 : 100);

    if (suggest) {
      return res.json(games.map((g) => ({ id: g.id, title: displayName(g), titleCn: g.title_cn, aliases: g.aliases ?? [] })));
    }
    res.json(games.map(toPublicGame));
  })
);

export default router;
