const fs = require('fs');
const path = require('path');

const root = process.cwd();
const Database = require(path.join(root, 'server', 'node_modules', 'better-sqlite3'));
const db = new Database(path.join(root, 'server', 'data', 'csgofriberg.sqlite3'), { readonly: true });
const titles = db.prepare('select title, title_cn from game_titles').all();

const byName = new Map();
const byCn = new Map();
const lines = fs.readFileSync(path.join(root, 'exported_data', 'game.jsonl'), 'utf8').split('\n');
for (const line of lines) {
  if (!line) continue;
  let game;
  try {
    game = JSON.parse(line);
  } catch {
    continue;
  }
  const links = (game.website || []).map((w) => w.link).filter((u) => /bgm\.tv\/subject\/\d+/i.test(u));
  if (!links.length) continue;
  const rawName = String(game.name || '').trim();
  const rawCn = String(game.chinese_name || '').trim();
  const url = links[0].replace(/[#;]+$/, '');
  if (rawName && !byName.has(rawName)) byName.set(rawName, url);
  if (rawCn && !byCn.has(rawCn)) byCn.set(rawCn, url);
}

let direct = 0;
let anyName = 0;
for (const row of titles) {
  const by = byName.get(String(row.title));
  const cn = byCn.get(String(row.title_cn || ''));
  if (by || cn) direct += 1;
  if (by) anyName += 1;
}
console.log('db titles:', titles.length);
console.log('bgm direct by exact title:', anyName);
console.log('bgm direct by title or chinese:', direct);
console.log('game.jsonl with bgm subject link:', byName.size);
