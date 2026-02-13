import { describe, it, expect } from 'vitest';
import { estimateLineDuration, estimateDialogue, getSegmentTimings } from '../app/engine/estimator.js';

describe('estimateLineDuration', () => {
  it('returns 0 for empty text', () => {
    expect(estimateLineDuration('').duration).toBe(0);
    expect(estimateLineDuration(null).duration).toBe(0);
  });

  it('estimates short phrase', () => {
    const r = estimateLineDuration('Привет мир', 'normal');
    expect(r.duration).toBeGreaterThan(0);
    expect(r.wordCount).toBe(2);
  });

  it('fast pace = shorter duration', () => {
    const slow = estimateLineDuration('Три слова тут', 'slow');
    const fast = estimateLineDuration('Три слова тут', 'fast');
    expect(fast.duration).toBeLessThan(slow.duration);
  });

  it('penalizes long words', () => {
    const short = estimateLineDuration('да нет ок', 'normal');
    const long = estimateLineDuration('категорически безусловно исключительно', 'normal');
    expect(long.duration).toBeGreaterThan(short.duration);
  });

  it('penalizes filler words', () => {
    const clean = estimateLineDuration('Иди сюда быстро', 'normal');
    const filler = estimateLineDuration('Ну вот типа иди сюда быстро', 'normal');
    // filler version has more words AND filler penalty
    expect(filler.duration).toBeGreaterThan(clean.duration);
  });

  it('gives bonus for short punch phrases', () => {
    const r = estimateLineDuration('Это база!', 'normal');
    expect(r.details.some(d => d.includes('бонус'))).toBe(true);
  });

  it('counts pause markers', () => {
    const r = estimateLineDuration('Привет | мир | тут', 'normal');
    expect(r.details.some(d => d.includes('пауз'))).toBe(true);
  });
});

describe('estimateDialogue', () => {
  it('estimates two lines', () => {
    const lines = [
      { speaker: 'A', text: 'Короткая фраза', pace: 'fast' },
      { speaker: 'B', text: 'Ответ тоже короткий', pace: 'normal' },
    ];
    const r = estimateDialogue(lines);
    expect(r.total).toBeGreaterThan(0);
    expect(r.perLine).toHaveLength(2);
    expect(['low', 'medium', 'high']).toContain(r.risk);
  });

  it('detects high risk for long dialogue', () => {
    const lines = [
      { speaker: 'A', text: 'Это очень длинная реплика которая содержит множество слов и никак не влезет в четыре секунды', pace: 'slow' },
      { speaker: 'B', text: 'И ответ тоже невероятно длинный с кучей вводных слов ну вот типа значит короче', pace: 'slow' },
    ];
    const r = estimateDialogue(lines);
    expect(r.risk).toBe('high');
    expect(r.trimming_suggestions.length).toBeGreaterThan(0);
  });

  it('detects low risk for short dialogue', () => {
    const lines = [
      { speaker: 'A', text: 'Привет!', pace: 'fast' },
      { speaker: 'B', text: 'Ок.', pace: 'fast' },
    ];
    const r = estimateDialogue(lines);
    expect(r.risk).toBe('low');
  });
});

describe('getSegmentTimings', () => {
  it('returns proper 8s grid', () => {
    const t = getSegmentTimings(8.0);
    expect(t.hook.start).toBe(0);
    expect(t.killerWord).toBe(6.85);
    expect(t.laugh.end).toBeLessThanOrEqual(8.0);
  });
});
