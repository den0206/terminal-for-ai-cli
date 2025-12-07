#!/usr/bin/env node

import {spawn} from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      args[normalizedKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[normalizedKey] = next;
      i++;
    } else {
      args[normalizedKey] = true;
    }
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));
const electronVersion = cliArgs.electron || process.env.VSCODE_ELECTRON_VERSION;

if (!electronVersion) {
  console.error(
    'Electron のバージョンが不明です。`npm run rebuild:pty -- --electron <x.y.z>` のように指定するか、環境変数 VSCODE_ELECTRON_VERSION を設定してください。'
  );
  process.exit(1);
}

const runtime = cliArgs.runtime || 'electron';
const disturl =
  cliArgs.disturl || 'https://electronjs.org/headers';
const arch = cliArgs.arch;

const npmArgs = ['rebuild', 'node-pty'];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCmd, npmArgs, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    npm_config_runtime: runtime,
    npm_config_target: electronVersion,
    npm_config_disturl: disturl,
    npm_config_build_from_source: 'true',
    ...(arch ? {npm_config_arch: arch} : {}),
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
