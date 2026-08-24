// 把分发包内置的、已编译好的 better_sqlite3.node 复制到位。
//
// 背景: better-sqlite3 在 pnpm install 时会跑 prebuild-install 下载预编译包,
// 失败则回退到 node-gyp 源码编译(需要 Visual Studio + Windows SDK)。
// 国内网络下预编译下载常被墙、又常常缺 VS,导致安装失败。
// 因此本仓库在 vendor/ 内置了 Node 24 / win32 / x64 的预编译二进制,
// 并让 pnpm 跳过该构建脚本(见根 package.json 的 pnpm.ignoredBuiltDependencies),
// 装完依赖后由本脚本把二进制复制到正确位置,从而做到开箱即用。
//
// 注意: vendor 里的二进制是 Node 24 (ABI 137) / win32 / x64 专用。
// 若目标机器使用其它 Node 版本或平台,请去掉 ignoredBuiltDependencies 让其正常编译。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendored = path.join(root, 'vendor', 'better_sqlite3.node');

if (!fs.existsSync(vendored)) {
  console.log('[install-better-sqlite3] 未找到 vendor/better_sqlite3.node,跳过');
  process.exit(0);
}

// 递归收集 node_modules/.pnpm 下名为 better-sqlite3@* 的目录(它们内部的 node_modules 才是包根)
function findPkgDirs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('better-sqlite3@')) {
      out.push(path.join(full, 'node_modules', 'better-sqlite3'));
    } else if (entry.name.startsWith('.')) {
      out.push(...findPkgDirs(full));
    }
  }
  return out;
}

const candidates = [
  ...findPkgDirs(path.join(root, 'node_modules', '.pnpm')),
  ...findPkgDirs(path.join(root, 'server', 'node_modules', '.pnpm')),
  ...findPkgDirs(path.join(root, 'client', 'node_modules', '.pnpm')),
];

let copied = 0;
for (const pkgDir of candidates) {
  const releaseDir = path.join(pkgDir, 'build', 'Release');
  const target = path.join(releaseDir, 'better_sqlite3.node');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.copyFileSync(vendored, target);
    copied += 1;
    console.log(`[install-better-sqlite3] 已复制预编译二进制 → ${target}`);
  } else {
    console.log(`[install-better-sqlite3] 已存在,跳过 → ${target}`);
  }
}

if (copied === 0 && candidates.length === 0) {
  console.warn('[install-better-sqlite3] 未找到 better-sqlite3 包目录,二进制未放置');
}
