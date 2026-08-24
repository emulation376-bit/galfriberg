import { Knex } from 'knex';
import { db } from './knex';
import { DIFFICULTY_LEVELS } from '../difficulties';
import { userNameFromUsername } from '../services/identityDisplay';

/**
 * 数据库建表迁移 —— Galgame 猜测版
 * 全量建表；对既有 users/announcements 表补充兼容列，并为历史用户回填 display_id。
 */
export async function ensureSchema(instance: Knex = db): Promise<void> {
  // ── 用户表 ──
  if (!(await instance.schema.hasTable('users'))) {
    await instance.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username', 32).notNullable().unique();
      t.string('display_id', 8).nullable();
      t.string('password_hash', 128).notNullable();
      t.string('role', 16).notNullable().defaultTo('user');
      t.integer('token_version').notNullable().defaultTo(0);
      t.boolean('leaderboard_hidden').notNullable().defaultTo(false);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  if (!(await instance.schema.hasColumn('users', 'token_version'))) {
    await instance.schema.alterTable('users', (t) => t.integer('token_version').notNullable().defaultTo(0));
  }
  if (!(await instance.schema.hasColumn('users', 'display_id'))) {
    await instance.schema.alterTable('users', (t) => t.string('display_id', 8).nullable());
  }
  // 回填历史用户的 display_id，保证 admin 搜索与榜单显示一致（新用户由 auth 注册时写入）
  const usersMissingDisplayId = await instance('users').whereNull('display_id').select('id', 'username');
  if (usersMissingDisplayId.length) {
    await Promise.all(usersMissingDisplayId.map((user) =>
      instance('users').where({ id: user.id }).update({ display_id: userNameFromUsername(user.username) })
    ));
  }
  if (!(await instance.schema.hasColumn('users', 'leaderboard_hidden'))) {
    await instance.schema.alterTable('users', (t) => {
      t.boolean('leaderboard_hidden').notNullable().defaultTo(false);
    });
  }

  // ── API Token 表 ──
  if (!(await instance.schema.hasTable('api_tokens'))) {
    await instance.schema.createTable('api_tokens', (t) => {
      t.increments('id').primary();
      t.string('name', 64).notNullable();
      t.string('token_hash', 64).notNullable().unique();
      t.string('prefix', 16).notNullable();
      t.integer('created_by_user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      t.timestamp('expires_at').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  // ── 应用迁移记录表 ──
  if (!(await instance.schema.hasTable('app_migrations'))) {
    await instance.schema.createTable('app_migrations', (t) => {
      t.string('name', 128).primary();
      t.timestamp('applied_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  // ── Galgame 作品表（代替原 players 表）──
  if (!(await instance.schema.hasTable('game_titles'))) {
    await instance.schema.createTable('game_titles', (t) => {
      t.increments('id').primary();
      t.string('title', 128).notNullable().unique();         // 游戏名称（原名）
      t.string('title_cn', 128).notNullable().defaultTo(''); // 中文名
      t.integer('release_year').notNullable().defaultTo(0);  // 发行年份
      t.string('company', 128).notNullable().defaultTo('');  // 会社（品牌）
      t.boolean('is_r18').notNullable().defaultTo(false);    // 限制级（R18/全年龄）
      t.string('scenario_writer', 1024).notNullable().defaultTo(''); // 剧本（多人以、分隔）
      t.string('music_composer', 1024).notNullable().defaultTo('');  // 配乐（多人以、分隔）
      t.string('artist', 1024).notNullable().defaultTo('');          // 原画（多人以、分隔）
      t.string('voice_actor', 1024).notNullable().defaultTo('');     // 声优（多人以、分隔）
      t.decimal('bgm_score', 3, 1).notNullable().defaultTo(0);     // BGM均分
      t.integer('vote_count').notNullable().defaultTo(0);          // 评分人数（VNDB votecount）
      t.boolean('is_easy').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('is_enabled').notNullable().defaultTo(true);
      t.boolean('is_series').notNullable().defaultTo(false);   // 是否存在系列作（VNDB ser/seq/preq）
      t.integer('length_minutes').notNullable().defaultTo(0);   // 时长（分钟，0=未知）
      t.string('vndb_id', 16).nullable();
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  // 存量库补充声优列（老表无此列，ensureSchema 幂等补列）
  if (!(await instance.schema.hasColumn('game_titles', 'voice_actor'))) {
    await instance.schema.alterTable('game_titles', (t) =>
      t.string('voice_actor', 1024).notNullable().defaultTo('')
    );
  }
  if (!(await instance.schema.hasColumn('game_titles', 'vndb_id'))) {
    await instance.schema.alterTable('game_titles', (t) => t.string('vndb_id', 16).nullable());
  }
  if (!(await instance.schema.hasColumn('game_titles', 'tags'))) {
    await instance.schema.alterTable('game_titles', (t) =>
      t.string('tags', 2048).notNullable().defaultTo('')
    );
  }
  if (!(await instance.schema.hasColumn('game_titles', 'is_series'))) {
    await instance.schema.alterTable('game_titles', (t) =>
      t.boolean('is_series').notNullable().defaultTo(false)
    );
  }
  if (!(await instance.schema.hasColumn('game_titles', 'length_minutes'))) {
    await instance.schema.alterTable('game_titles', (t) =>
      t.integer('length_minutes').notNullable().defaultTo(0)
    );
  }
  if (!(await instance.schema.hasColumn('game_titles', 'vote_count'))) {
    await instance.schema.alterTable('game_titles', (t) =>
      t.integer('vote_count').notNullable().defaultTo(0)
    );
  }

  // PostgreSQL 全文搜索索引
  if (instance.client.config.client === 'pg') {
    await instance.raw('create extension if not exists pg_trgm');
    await instance.raw(
      'create index if not exists "game_titles_title_trgm_idx" on "game_titles" using gin ("title" gin_trgm_ops)'
    );
    await instance.raw(
      'create index if not exists "game_titles_title_cn_trgm_idx" on "game_titles" using gin ("title_cn" gin_trgm_ops)'
    );
  }

  // ── Galgame 别名表（用于搜索匹配）──
  if (!(await instance.schema.hasTable('game_aliases'))) {
    await instance.schema.createTable('game_aliases', (t) => {
      t.increments('id').primary();
      t.integer('game_id').notNullable().references('id').inTable('game_titles').onDelete('CASCADE');
      t.string('alias', 255).notNullable();
      t.string('type', 64).notNullable().defaultTo('');
      t.index(['game_id']);
      t.index(['alias']);
    });
  }

  // ── VNDB staff 别名参考表（staff 主名/别名解析，用于展示与比对）──
  if (!(await instance.schema.hasTable('staff_aliases'))) {
    await instance.schema.createTable('staff_aliases', (t) => {
      t.integer('aid').primary();               // VNDB 别名 id（唯一）
      t.string('staff_id', 16).notNullable();    // VNDB staff 条目 id（如 s39）
      t.string('name', 255).notNullable();       // 原名（日/中）
      t.string('latin', 255).nullable();         // 罗马字（可空）
      t.string('main_name', 255).notNullable();  // 该条目主名（显示用）
      t.index(['staff_id']);
    });
  }

  // ── VNDB 角色表（猜角色功能的数据底座）──
  if (!(await instance.schema.hasTable('characters'))) {
    await instance.schema.createTable('characters', (t) => {
      t.string('id', 24).primary();       // VNDB 角色 id（如 c123）
      t.string('name_cn', 255).nullable(); // Bangumi 简体中文名
      t.string('surname', 255).nullable(); // 姓
      t.string('given_name', 255).nullable(); // 名
      t.string('image', 32).nullable();   // VNDB 立绘 id（如 ch123）
      t.string('ymgal_image', 255).nullable(); // YmGal 立绘相对路径
      t.string('sex', 8).nullable();      // m / f / b / n
      t.integer('birthday').nullable();   // MMDD，如 920 = 9月20日；0 不落库
      t.integer('height').nullable();     // cm；0 不落库
      t.integer('age').nullable();        // 年龄；0 不落库
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  if (!(await instance.schema.hasColumn('characters', 'name_cn'))) {
    await instance.schema.alterTable('characters', (t) => t.string('name_cn', 255).nullable());
  }
  if (!(await instance.schema.hasColumn('characters', 'surname'))) {
    await instance.schema.alterTable('characters', (t) => t.string('surname', 255).nullable());
  }
  if (!(await instance.schema.hasColumn('characters', 'given_name'))) {
    await instance.schema.alterTable('characters', (t) => t.string('given_name', 255).nullable());
  }
  if (!(await instance.schema.hasColumn('characters', 'ymgal_image'))) {
    await instance.schema.alterTable('characters', (t) => t.string('ymgal_image', 255).nullable());
  }

  if (!(await instance.schema.hasTable('character_names'))) {
    await instance.schema.createTable('character_names', (t) => {
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('lang', 16).notNullable();   // ja / en / zh-Hans / ...
      t.string('name', 255).notNullable();
      t.string('latin', 255).nullable();
      t.primary(['character_id', 'lang']);
    });
  }

  if (!(await instance.schema.hasTable('character_aliases'))) {
    await instance.schema.createTable('character_aliases', (t) => {
      t.increments('id').primary();
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('name', 1024).notNullable();
      t.string('latin', 1024).nullable();
      t.integer('spoil').notNullable().defaultTo(0);
      t.index(['character_id']);
      t.unique(['character_id', 'spoil', 'name']);
    });
  }

  if (!(await instance.schema.hasTable('game_characters'))) {
    await instance.schema.createTable('game_characters', (t) => {
      t.integer('game_id').notNullable()
        .references('id').inTable('game_titles').onDelete('CASCADE');
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('role', 16).notNullable();   // main / primary
      t.integer('spoil').notNullable().defaultTo(0);
      t.string('vndb_vid', 16).nullable();  // 来源 VNDB 作品 id，便于审计
      t.primary(['game_id', 'character_id']);
      t.index(['character_id']);
    });
  }

  if (!(await instance.schema.hasTable('character_traits'))) {
    await instance.schema.createTable('character_traits', (t) => {
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('trait_id', 24).notNullable(); // VNDB trait id（如 i59）
      t.string('trait_name', 255).notNullable();
      t.string('group_id', 24).notNullable(); // Clothes / Role / Hair / Body / Eyes 对应 id
      t.string('group_name', 64).notNullable();
      t.primary(['character_id', 'trait_id']);
      t.index(['trait_id']);
      t.index(['group_id']);
    });
  }

  if (!(await instance.schema.hasTable('character_voice_actors'))) {
    await instance.schema.createTable('character_voice_actors', (t) => {
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('staff_id', 16).notNullable();
      t.string('name', 255).notNullable();
      t.primary(['character_id', 'staff_id']);
      t.index(['staff_id']);
    });
  }

  if (!(await instance.schema.hasTable('character_game_appearances'))) {
    await instance.schema.createTable('character_game_appearances', (t) => {
      t.string('character_id', 24).notNullable()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('vndb_vid', 16).notNullable();
      t.string('role', 16).notNullable();
      t.integer('spoil').notNullable().defaultTo(0);
      t.integer('game_id').nullable().references('id').inTable('game_titles').onDelete('SET NULL');
      t.string('title', 255).notNullable().defaultTo('');
      t.string('title_cn', 255).notNullable().defaultTo('');
      t.string('release_date', 10).nullable(); // YYYY-MM-DD
      t.decimal('bgm_score', 3, 1).notNullable().defaultTo(0);
      t.primary(['character_id', 'vndb_vid']);
      t.index(['vndb_vid']);
    });
  }

  if (!(await instance.schema.hasTable('character_mzh_fields'))) {
    await instance.schema.createTable('character_mzh_fields', (t) => {
      t.string('character_id', 24).primary()
        .references('id').inTable('characters').onDelete('CASCADE');
      t.string('mzh_title', 255).nullable();     // 命中的萌百页面标题
      t.string('name', 255).nullable();          // 姓名
      t.string('gender', 64).nullable();         // 性别
      t.string('age', 64).nullable();            // 年龄
      t.string('height', 64).nullable();         // 身高
      t.string('hair_color', 255).nullable();    // 发色
      t.string('eye_color', 255).nullable();     // 瞳色
      t.string('voice_actor', 512).nullable();   // 声优
      t.string('series', 512).nullable();        // 所属作品
      t.string('moe_points', 1024).nullable();   // 萌点
    });
  }

  // ── 猜角色单人游戏记录表（独立战绩维度）──
  if (!(await instance.schema.hasTable('character_games'))) {
    await instance.schema.createTable('character_games', (t) => {
      t.increments('id').primary();
      t.string('session_id', 64).nullable();
      t.integer('user_id').nullable().references('id').inTable('users');
      t.string('guest_key', 64).nullable().index();
      t.string('target_character_id', 24).notNullable()
        .references('id').inTable('characters');
      t.string('mode', 16).notNullable().defaultTo('normal');
      t.text('guesses').notNullable().defaultTo('[]');
      t.string('first_guess_character_id', 24).nullable();
      t.string('status', 16).notNullable().defaultTo('playing');
      t.integer('guess_count').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
      t.timestamp('finished_at').nullable();
    });
  }
  if (!(await instance.schema.hasColumn('character_games', 'session_id'))) {
    await instance.schema.alterTable('character_games', (t) =>
      t.string('session_id', 64).nullable()
    );
  }
  const hasCharacterGamesSessionIndex = await instance.raw(
    "select 1 from sqlite_master where type='index' and tbl_name='character_games' and name='character_games_session_id_unique'"
  ).then((r) => (Array.isArray(r) ? r.length > 0 : false)).catch(() => false);
  if (!hasCharacterGamesSessionIndex) {
    await instance.raw(
      'create unique index if not exists character_games_session_id_unique on character_games(session_id)'
    );
  }

  // ── 难度等级表 ──
  if (!(await instance.schema.hasTable('difficulty_levels'))) {
    await instance.schema.createTable('difficulty_levels', (t) => {
      t.string('key', 32).primary();
      t.integer('sort_order').notNullable().defaultTo(0);
      t.boolean('is_enabled').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  await instance('difficulty_levels')
    .insert(DIFFICULTY_LEVELS.map((difficulty) => ({
      key: difficulty.key,
      sort_order: difficulty.sortOrder,
      is_enabled: difficulty.isEnabled,
    })))
    .onConflict('key')
    .merge(['sort_order', 'is_enabled']);

  // ── 作品-难度 关联表（代替原 player_difficulties）──
  if (!(await instance.schema.hasTable('game_difficulties'))) {
    await instance.schema.createTable('game_difficulties', (t) => {
      t.integer('game_id').notNullable().references('id').inTable('game_titles').onDelete('CASCADE');
      t.string('difficulty_key', 32).notNullable().references('key').inTable('difficulty_levels').onDelete('CASCADE');
      t.primary(['game_id', 'difficulty_key']);
      t.index(['difficulty_key', 'game_id']);
    });
  }

  // ── 单人游戏记录表 ──
  if (!(await instance.schema.hasTable('games'))) {
    await instance.schema.createTable('games', (t) => {
      t.increments('id').primary();
      t.string('session_id', 64).nullable();
      t.integer('user_id').nullable().references('id').inTable('users');
      t.string('guest_key', 64).nullable().index();
      t.integer('target_game_id').notNullable().references('id').inTable('game_titles');
      t.string('mode', 16).notNullable().defaultTo('normal');
      t.text('guesses').notNullable().defaultTo('[]');
      t.integer('first_guess_game_id').nullable();
      t.string('status', 16).notNullable().defaultTo('playing');
      t.integer('guess_count').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
      t.timestamp('finished_at').nullable();
    });
  }
  if (!(await instance.schema.hasColumn('games', 'session_id'))) {
    await instance.schema.alterTable('games', (t) => t.string('session_id', 64).nullable());
  }
  // session_id 唯一索引，支持 onConflict('session_id').ignore() 幂等写入
  const hasGamesSessionIndex = await instance.raw(
    "select 1 from sqlite_master where type='index' and tbl_name='games' and name='games_session_id_unique'"
  ).then((r) => (Array.isArray(r) ? r.length > 0 : false)).catch(() => false);
  if (!hasGamesSessionIndex) {
    await instance.raw('create unique index if not exists games_session_id_unique on games(session_id)');
  }

  // ── 多人对战记录表 ──
  if (!(await instance.schema.hasTable('match_records'))) {
    await instance.schema.createTable('match_records', (t) => {
      t.increments('id').primary();
      t.string('room_id', 64).notNullable();
      t.string('db_type', 16).notNullable().defaultTo('normal');
      t.integer('bo_type').notNullable().defaultTo(3);
      t.integer('winner_id').nullable().references('id').inTable('users');
      t.string('winner_key', 80).nullable();
      t.string('finish_reason', 32).nullable();
      t.string('forfeited_key', 80).nullable();
      t.text('players').notNullable().defaultTo('[]');
      t.text('replay').notNullable().defaultTo('[]');
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
      t.unique(['room_id']);
    });
  }

  // ── 多人对战玩家表 ──
  if (!(await instance.schema.hasTable('match_players'))) {
    await instance.schema.createTable('match_players', (t) => {
      t.increments('id').primary();
      t.integer('match_id').notNullable().references('id').inTable('match_records').onDelete('CASCADE');
      t.integer('user_id').nullable().references('id').inTable('users');
      t.string('player_key', 80).notNullable();
      t.string('player_name', 32).notNullable().defaultTo('');
      t.integer('score').notNullable().defaultTo(0);
      t.boolean('is_winner').notNullable().defaultTo(false);
      t.integer('winning_guess_sum').notNullable().defaultTo(0);
      t.integer('winning_rounds').notNullable().defaultTo(0);
      t.unique(['match_id', 'player_key']);
      t.index(['user_id', 'is_winner'], 'match_players_user_winner_idx');
    });
  }

  // ── 公告表 ──
  if (!(await instance.schema.hasTable('announcements'))) {
    await instance.schema.createTable('announcements', (t) => {
      t.increments('id').primary();
      t.string('title', 128).notNullable();
      t.text('content').notNullable();
      t.boolean('is_popup').notNullable().defaultTo(false);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  if (!(await instance.schema.hasColumn('announcements', 'is_popup'))) {
    await instance.schema.alterTable('announcements', (t) => {
      t.boolean('is_popup').notNullable().defaultTo(false);
    });
  }
}
