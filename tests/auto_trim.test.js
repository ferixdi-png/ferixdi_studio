import { describe, it, expect } from 'vitest';
import { autoTrim } from '../app/engine/auto_trim.js';

describe('autoTrim', () => {
  it('removes filler words', () => {
    const lines = [
      { speaker: 'A', text: 'Ну вот типа это просто смешно значит', pace: 'normal' },
      { speaker: 'B', text: 'Короче ладно вообще да', pace: 'normal' },
    ];
    const r = autoTrim(lines);
    expect(r.trimmed).toBe(true);
    expect(r.auto_fixes.length).toBeGreaterThan(0);
    // Check fillers removed
    expect(r.lines[0].text).not.toContain('типа');
  });

  it('does not trim already short lines', () => {
    const lines = [
      { speaker: 'A', text: 'Привет!', pace: 'fast' },
      { speaker: 'B', text: 'Ок.', pace: 'fast' },
    ];
    const r = autoTrim(lines);
    expect(r.trimmed).toBe(false);
  });

  it('returns estimate after trimming', () => {
    const lines = [
      { speaker: 'A', text: 'Ну вот это абсолютно безусловно великолепно', pace: 'slow' },
      { speaker: 'B', text: 'Естественно действительно замечательно', pace: 'slow' },
    ];
    const r = autoTrim(lines);
    expect(r.estimate).toBeDefined();
    expect(r.estimate.total).toBeGreaterThan(0);
  });
});
