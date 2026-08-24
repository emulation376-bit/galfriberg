export interface User {
  id: number;
  username: string;
  display_id: string | null;
  password_hash: string;
  role: 'user' | 'admin';
  token_version: number;
  created_at: string;
}

/** Galgame / 视觉小说作品 */
export interface GameTitle {
  id: number;
  title: string;               // 名称（原名）
  title_cn: string;            // 中文名
  release_year: number;        // 发行年份
  company: string;             // 会社（品牌）
  is_r18: boolean | number;    // 限制级
  scenario_writer: string;     // 剧本（多人用、分隔）
  music_composer: string;      // 配乐（多人用、分隔）
  artist: string;              // 原画（多人用、分隔）
  voice_actor: string;         // 声优（多人用、分隔）
  bgm_score: number;           // BGM评分
  vote_count: number;          // 评分人数（VNDB votecount）
  is_series: boolean | number; // 是否存在系列作（VNDB ser/seq/preq）
  length_minutes: number;      // 时长（分钟，0=未知）
  vndb_id?: string | null;     // VNDB id（如 v19587）
  tags?: string[];             // tag 列表（多值）
  /** Deprecated compatibility field; difficulty membership lives in game_difficulties. */
  is_easy?: boolean | number;
  difficulties?: string[];
  aliases?: string[];          // 别名列表（用于搜索匹配，不入库时为空数组）
  is_active: boolean | number;
  is_enabled: boolean | number;
  created_at: string;
}

/** 返回最适合展示的名字：优先中文名，缺失则回退到原名 */
export function displayName(game: { title: string; title_cn: string }): string {
  return game.title_cn || game.title;
}

export type FeedbackLevel = 'correct' | 'close' | 'wrong';

export interface AttributeFeedback {
  value: string | number | boolean;
  level: FeedbackLevel;
  /** 数值型属性的方向提示: higher = 目标比猜测大 */
  hint?: 'higher' | 'lower';
  parts?: Array<{ name: string; matched: boolean }>;
  /** staff 类属性截断后省略的人数（>0 时前端渲染「+N」省略 cell） */
  omitted?: number;
}

export interface GuessFeedback {
  gameId: number;              // 原 playerId
  title: string;               // 原 nickname
  correct: boolean;
  attributes: {
    releaseYear: AttributeFeedback;     // 发行年份
    company: AttributeFeedback;         // 会社
    isR18: AttributeFeedback;           // 限制级
    scenarioWriter: AttributeFeedback;  // 剧本
    musicComposer: AttributeFeedback;   // 配乐
    artist: AttributeFeedback;          // 原画
    voiceActor: AttributeFeedback;      // 声优
    tags: AttributeFeedback;            // tag
    isSeries: AttributeFeedback;        // series flag
    bgmScore: AttributeFeedback;        // BGM评分
    length: AttributeFeedback;          // 时长
  };
}

export interface GameRow {
  id: number;
  session_id: string | null;
  user_id: number | null;
  guest_key: string | null;
  target_game_id: number;      // 原 target_player_id
  mode: string;
  guesses: string;
  status: 'playing' | 'won' | 'lost';
  guess_count: number;
  created_at: string;
  finished_at: string | null;
}
