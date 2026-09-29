import {describe, expect, it} from 'vitest';
import {agentColor, agentIconMarkup} from './agent-icons';

describe('agentIconMarkup', () => {
  it('gives each known agent its own mark', () => {
    const claude = agentIconMarkup('claude');
    const codex = agentIconMarkup('codex');

    expect(claude).toContain('<path');
    expect(claude).not.toBe(codex);
  });

  it('keeps the brand colour where it has one, else follows the pane', () => {
    expect(agentIconMarkup('claude')).toContain('fill:#D97757');
    expect(agentIconMarkup('codex')).toContain('fill:#0BA47F');
    expect(agentIconMarkup('copilot')).toContain('fill:currentColor');
    expect(agentColor('codex')).toBe('#0BA47F');
  });

  it('falls back to the sparkle for an unknown agent', () => {
    expect(agentIconMarkup('aider')).toBe(agentIconMarkup('goose'));
    expect(agentIconMarkup('aider')).toContain('<path');
  });
});
