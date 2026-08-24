// @deprecated 已被 importAll.ts 取代（staff_aliases 由数据链路阶段3重建），保留供独立使用。
import * as fs from 'fs';
import * as path from 'path';
import { db } from './knex';
import { ensureSchema } from './schema';

/** PostgreSQL COPY 格式字段反转义: \N → null, 其余反斜杠转义还原 */
function unescape(field: string): string | null {
  if (field === '\\N') return null;
  let out = '';
  for (let i = 0; i < field.length; i++) {
    if (field[i] === '\\' && i + 1 < field.length) {
      const n = field[++i];
      if (n === 't') out += '\t';
      else if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n === 'v') out += '\v';
      else if (n === '\\') out += '\\';
      else out += n;
    } else {
      out += field[i];
    }
  }
  return out;
}

const CJK = /[぀-ヿ一-鿿＀-￯]/;

/** 显示名优先原名（含日/中字符），否则回退罗马字 */
function pickName(name: string | null, latin: string | null): string {
  if (name && CJK.test(name)) return name;
  return latin || name || '';
}

interface StaffAliasRow {
  staffId: string;
  aid: number;
  name: string | null;
  latin: string | null;
}

/** 从 VNDB 数据库 dump 导入 staff 别名表（主名由 staff.main 解析而来） */
async function importStaffAliases(): Promise<void> {
  await ensureSchema();

  const dbDir = path.resolve(__dirname, '..', '..', '..', 'VNDB', 'db');
  const staffFile = path.join(dbDir, 'staff');
  const aliasFile = path.join(dbDir, 'staff_alias');
  if (!fs.existsSync(staffFile) || !fs.existsSync(aliasFile)) {
    console.log('[staff-aliases] 未找到 VNDB/db 下的 staff / staff_alias 文件，跳过导入');
    await db.destroy();
    return;
  }

  // staff 表: id | gender | lang | main | ...，取 main（主别名 aid）
  const staffMain = new Map<string, number>();
  for (const line of fs.readFileSync(staffFile, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[0] && c[3] && c[3] !== '\\N') staffMain.set(c[0], Number(c[3]));
  }
  console.log(`[staff-aliases] staff 条目: ${staffMain.size}`);

  // staff_alias 表: id | aid | name | latin
  const aliasRows: StaffAliasRow[] = [];
  const byAid = new Map<number, StaffAliasRow>();
  for (const line of fs.readFileSync(aliasFile, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const row: StaffAliasRow = {
      staffId: c[0],
      aid: Number(c[1]),
      name: unescape(c[2]),
      latin: c[3] !== undefined ? unescape(c[3]) : null,
    };
    aliasRows.push(row);
    byAid.set(row.aid, row);
  }
  console.log(`[staff-aliases] 别名行: ${aliasRows.length}`);

  await db('staff_aliases').delete();
  console.log('[staff-aliases] 已清空旧数据');

  const batch: Array<{ aid: number; staff_id: string; name: string; latin: string | null; main_name: string }> = [];
  let skipped = 0;
  for (const row of aliasRows) {
    if (!row.name) {
      skipped += 1;
      continue;
    }
    const mainAid = staffMain.get(row.staffId);
    const mainRow = mainAid !== undefined ? byAid.get(mainAid) : undefined;
    batch.push({
      aid: row.aid,
      staff_id: row.staffId,
      name: row.name,
      latin: row.latin,
      main_name: mainRow ? pickName(mainRow.name, mainRow.latin) : '',
    });
    if (batch.length >= 500) {
      await db.batchInsert('staff_aliases', batch, 500);
      batch.length = 0;
    }
  }
  if (batch.length > 0) await db.batchInsert('staff_aliases', batch, 500);

  const count = await db('staff_aliases').count('* as n').first() as { n: number };
  console.log(`[staff-aliases] 完成: 共 ${count.n} 条别名（跳过 ${skipped} 条无名）`);
  await db.destroy();
}

importStaffAliases().catch((err) => {
  console.error('[staff-aliases] 导入失败:', err);
  process.exit(1);
});
