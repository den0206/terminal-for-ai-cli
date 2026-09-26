import {describe, expect, it} from 'vitest';
import {agentIconMarkup} from './agent-icons';

describe('agentIconMarkup', () => {
  it('gives each known agent its own mark', () => {
    const claude = agentIconMarkup('claude');
    const codex = agentIconMarkup('codex');

    expect(claude).toContain('<path');
    expect(claude).not.toBe(codex);
  });

  it('keeps the brand colour where it has one, else follows the pane', () => {
    expect(agentIconMarkup('claude')).toContain('fill:#D97757');
    // 公式色が黒のマーク: OpenAI はターミナルの文字色、他はアクセント色
    expect(agentIconMarkup('codex')).toContain('fill:var(--terminal-fg)');
    expect(agentIconMarkup('copilot')).toContain('fill:currentColor');
  });

  it('falls back to the sparkle for an unknown agent', () => {
    expect(agentIconMarkup('aider')).toBe(agentIconMarkup('goose'));
    expect(agentIconMarkup('aider')).toContain('<path');
  });
});
