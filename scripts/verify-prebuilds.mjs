#!/usr/bin/env node
// 全プラットフォーム同梱 VSIX を作る前に prebuilds が揃っているか確認する。
// node-pty は lib/utils.js の loadNativeModule() で
// `prebuilds/<process.platform>-<process.arch>/` を探すため、この命名を守る必要がある。

import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = 'node_modules/node-pty/prebuilds';

// spawn-helper は binding.gyp 上 macOS 限定ターゲット。
// Windows は conpty / winpty の両実装を持つため 5 ファイル必要。
const REQUIRED = {
  'darwin-arm64': ['pty.node', 'spawn-helper'],
  'darwin-x64': ['pty.node', 'spawn-helper'],
  'linux-arm64': ['pty.node'],
  'linux-x64': ['pty.node'],
  'win32-arm64': ['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe'],
  'win32-x64': ['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe'],
};

const missing = [];
const notExecutable = [];
for (const [target, files] of Object.entries(REQUIRED)) {
  for (const file of files) {
    const full = path.join(ROOT, target, file);
    if (!existsSync(full)) {
      missing.push(full);
      continue;
    }
    // spawn-helper は fork 時に exec されるため実行ビットが必須。
    // GitHub Actions の artifact 経由だと落ちるので毎回確認する。
    if (file === 'spawn-helper' && (statSync(full).mode & 0o111) === 0) {
      notExecutable.push(full);
    }
  }
}

// loadNativeModule は build/Release を prebuilds より先に探す。
// VSIX に同梱されるとビルドしたマシンのバイナリだけが動くので必ず除外する。
const ignoreRule = 'node_modules/node-pty/build/**';
const ignored = readFileSync('.vscodeignore', 'utf8').includes(ignoreRule);

if (missing.length > 0) {
  console.error('prebuilds が不足しています:\n  ' + missing.join('\n  '));
}
if (notExecutable.length > 0) {
  console.error('実行ビットがありません (chmod +x):\n  ' + notExecutable.join('\n  '));
}
if (!ignored) {
  console.error(`.vscodeignore に "${ignoreRule}" がありません。`);
}
if (missing.length > 0 || notExecutable.length > 0 || !ignored) {
  process.exit(1);
}

console.log(`prebuilds OK: ${Object.keys(REQUIRED).join(', ')}`);
