#!/usr/bin/env node
// ローカル / CI の `npm run package` 用。
// .vscodeignore が build/Release を除外するため、今の OS/arch の成果物を
// prebuilds/<platform>-<arch>/ へコピーする。全プラットフォーム分が既にある
// （Export VSIX ワークフロー）場合は何もしない。

import {chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dest = path.join('node_modules/node-pty/prebuilds', `${process.platform}-${process.arch}`);
if (existsSync(path.join(dest, 'pty.node'))) {
  process.exit(0);
}

const src = 'node_modules/node-pty/build/Release';
if (!existsSync(src)) {
  console.error('node-pty の build/Release がありません。先に npm install してください。');
  process.exit(1);
}

const extra = new Set(['spawn-helper', 'winpty.dll', 'winpty-agent.exe']);
mkdirSync(dest, {recursive: true});
for (const file of readdirSync(src)) {
  if (!file.endsWith('.node') && !extra.has(file)) {
    continue;
  }
  const to = path.join(dest, file);
  copyFileSync(path.join(src, file), to);
  if (file === 'spawn-helper') {
    chmodSync(to, 0o755);
  }
}

console.log(`staged host prebuild: ${dest}`);
