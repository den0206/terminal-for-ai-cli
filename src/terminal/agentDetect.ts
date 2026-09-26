/**
 * PTY の中で AI Agent CLI が動いているかを、プロセス名から見分ける。
 *
 * 前面プロセス（node-pty の `process`）だけでは足りない。Kiro / Amazon Q / Fig の
 * シェル統合は、本物のシェルを自前の PTY の中で動かすラッパー（`zsh (kiro-cli-te`
 * のように名乗る）を挟むので、こちらから見える前面プロセスは永久にそのラッパーに
 * なる。そのため PTY の子孫プロセス全体を見る。
 *
 * ponytail: 名前の照合だけ。`node` としか名乗らない Node 製 CLI は拾えない。
 * 取りこぼすようなら `ps` の出力に `args=` を足して argv を見る。
 */
const AGENT_PROCESS_NAMES = new Set([
  'claude',
  'codex',
  'gemini',
  'copilot',
  'aider',
  'cursor-agent',
  'opencode',
  'goose',
  'crush',
  'amp',
  'qwen',
]);

/** 一致した Agent 名（`claude` など）。Agent でなければ undefined。 */
export function detectAgent(command: string | undefined): string | undefined {
  const name = command
    ?.trim()
    .toLowerCase()
    // 先頭トークン（"claude --resume" や "zsh (kiro-cli-te" の頭）
    .split(/[\s(]/)[0]
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/, '');
  return name && AGENT_PROCESS_NAMES.has(name) ? name : undefined;
}

/**
 * `ps -axo pid=,ppid=,comm=` の出力から、`rootPid` の子孫にいる Agent を探す。
 * ラッパー越しでも見えるように、深さの制限は付けない。
 */
export function findAgentInTree(
  processTable: string,
  rootPid: number
): string | undefined {
  const children = new Map<number, {pid: number; comm: string}[]>();
  for (const line of processTable.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const parent = Number(match[2]);
    const siblings = children.get(parent) ?? [];
    siblings.push({pid: Number(match[1]), comm: match[3]});
    children.set(parent, siblings);
  }

  const queue = [rootPid];
  // pid は再利用されるので、壊れた表で無限ループしないように訪問済みを持つ
  const visited = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (visited.has(pid)) {
      continue;
    }
    visited.add(pid);
    for (const child of children.get(pid) ?? []) {
      const agent = detectAgent(child.comm);
      if (agent) {
        return agent;
      }
      queue.push(child.pid);
    }
  }
  return undefined;
}
