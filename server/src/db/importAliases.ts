// @deprecated 已被 buildImportCsv.ts / importAll.ts 组成的新数据链路取代（别名走 CSV 列），保留供独立使用。
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { db } from './knex';
import { ensureSchema } from './schema';

interface GameJsonEntry {
  gid: number;
  name: string;
  chinese_name: string;
  extension_name: Array<{ desc: string; name: string; type: string }>;
}

/** 从 exported_data/game.jsonl 导入别名到 game_aliases 表中 */
async function importAliases(): Promise<void> {
  await ensureSchema();

  const filePath = path.resolve(__dirname, '..', '..', '..', 'exported_data', 'game.jsonl');
  if (!fs.existsSync(filePath)) {
    console.log('[aliases] 未找到 exported_data/game.jsonl，跳过别名导入');
    await db.destroy();
    return;
  }

  // 加载所有游戏: title -> id 映射
  const allGames = await db('game_titles').select('id', 'title', 'title_cn');
  const idByTitle = new Map<string, number>();
  const idByTitleCn = new Map<string, number>();
  for (const game of allGames) {
    idByTitle.set(String(game.title), Number(game.id));
    if (game.title_cn) idByTitleCn.set(String(game.title_cn), Number(game.id));
  }

  // 清空旧别名并重新导入
  await db('game_aliases').delete();
  console.log('[aliases] 已清空旧的别名数据');

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  const batch: Array<{ game_id: number; alias: string; type: string }> = [];
  let imported = 0;
  let matched = 0;
  let unmatched = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: GameJsonEntry;
    try {
      entry = JSON.parse(trimmed) as GameJsonEntry;
    } catch {
      continue;
    }

    // 尝试按原名匹配，再按中文名匹配
    let gameId = idByTitle.get(entry.name);
    if (!gameId && entry.chinese_name) {
      gameId = idByTitleCn.get(entry.chinese_name);
    }

    if (!gameId) {
      unmatched += 1;
      continue;
    }

    matched += 1;

    // 插入扩展名称（别名）
    if (entry.extension_name && entry.extension_name.length > 0) {
      for (const ext of entry.extension_name) {
        if (ext.name && ext.name !== entry.name && ext.name !== entry.chinese_name) {
          batch.push({ game_id: gameId, alias: ext.name, type: ext.type || '' });
        }
      }
    }

    // 批量写入
    if (batch.length >= 200) {
      await db.batchInsert('game_aliases', batch, 200);
      imported += batch.length;
      batch.length = 0;
      console.log(`[aliases] 已导入 ${imported} 条别名...`);
    }
  }

  // 写入剩余批次
  if (batch.length > 0) {
    await db.batchInsert('game_aliases', batch, 200);
    imported += batch.length;
  }

  console.log(`[aliases] 完成: 匹配 ${matched} 部作品, 导入 ${imported} 条别名, 未匹配 ${unmatched} 条`);
  await db.destroy();
}

importAliases().catch((err) => {
  console.error('[aliases] 导入失败:', err);
  process.exit(1);
});
