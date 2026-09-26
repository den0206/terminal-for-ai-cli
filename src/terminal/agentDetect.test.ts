import {describe, expect, it} from 'vitest';
import {detectAgent, findAgentInTree} from './agentDetect';

describe('detectAgent', () => {
  it('matches a known agent regardless of path or case', () => {
    expect(detectAgent('claude')).toBe('claude');
    expect(detectAgent('/opt/homebrew/bin/codex')).toBe('codex');
    expect(detectAgent('C:\\bin\\Claude.exe')).toBe('claude');
  });

  it('reads only the leading token of a rewritten process name', () => {
    // macOS の p_comm は 16 文字で切られ、名前を書き換えるツールもいる
    expect(detectAgent('zsh (kiro-cli-te')).toBeUndefined();
    expect(detectAgent('claude --resume')).toBe('claude');
  });

  it('ignores shells, plain runtimes and empty input', () => {
    expect(detectAgent('zsh')).toBeUndefined();
    expect(detectAgent('node')).toBeUndefined();
    expect(detectAgent('')).toBeUndefined();
    expect(detectAgent(undefined)).toBeUndefined();
  });
});

describe('findAgentInTree', () => {
  // Kiro のシェル統合を挟んだ実際の形: PTY の zsh → ラッパー → 中のシェル → claude
  const table = [
    '  100     1 /bin/zsh',
    '  200   100 zsh (kiro-cli-term)',
    '  300   200 /bin/zsh',
    '  400   300 /opt/homebrew/bin/claude',
    '  500     1 /bin/zsh',
  ].join('\n');

  it('finds an agent nested under a shell integration wrapper', () => {
    expect(findAgentInTree(table, 100)).toBe('claude');
  });

  it('does not reach into another session', () => {
    expect(findAgentInTree(table, 500)).toBeUndefined();
  });

  it('survives a cycle in the table', () => {
    expect(findAgentInTree('  10    20 /bin/zsh\n  20    10 /bin/zsh', 10)).toBe(
      undefined
    );
  });
});
