import { describe, it, expect } from 'vitest';
import { scanBannedWords, validateTimingGrid, validateTwoSpeakers, validateNoOverlays, validateDeviceInvisible } from '../app/engine/validators.js';

describe('scanBannedWords', () => {
  it('replaces banned words', () => {
    const r = scanBannedWords('She looks sexy and horny');
    expect(r.text).toContain('magnetic');
    expect(r.text).toContain('restless');
    expect(r.warnings).toHaveLength(2);
    expect(r.fixes).toHaveLength(2);
  });

  it('returns clean text unchanged', () => {
    const r = scanBannedWords('Beautiful sunny day');
    expect(r.warnings).toHaveLength(0);
    expect(r.text).toBe('Beautiful sunny day');
  });
});

describe('validateTimingGrid', () => {
  it('passes valid grid', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 0.7, speaker: 'A' },
        { id: 2, start: 0.7, end: 3.5, speaker: 'A' },
        { id: 3, start: 3.5, end: 7.0, speaker: 'B' },
        { id: 4, start: 7.0, end: 8.0, speaker: 'B' },
      ]
    };
    const r = validateTimingGrid(bp);
    expect(r.valid).toBe(true);
  });

  it('detects overlap', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 4.0, speaker: 'A' },
        { id: 2, start: 3.0, end: 7.0, speaker: 'B' },
      ]
    };
    const r = validateTimingGrid(bp);
    expect(r.warnings.some(w => w.includes('Overlap'))).toBe(true);
  });

  it('detects exceeding 8s', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 9.0, speaker: 'A' },
      ]
    };
    const r = validateTimingGrid(bp);
    expect(r.warnings.some(w => w.includes('exceeds'))).toBe(true);
  });
});

describe('validateTwoSpeakers', () => {
  it('passes with two speakers', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 3.5, speaker: 'A' },
        { id: 2, start: 3.5, end: 7, speaker: 'B' },
      ]
    };
    expect(validateTwoSpeakers(bp).valid).toBe(true);
  });

  it('fails with one speaker', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 3.5, speaker: 'A' },
        { id: 2, start: 3.5, end: 7, speaker: 'A' },
      ]
    };
    expect(validateTwoSpeakers(bp).valid).toBe(false);
  });
});

describe('validateNoOverlays', () => {
  it('detects overlay references', () => {
    const r = validateNoOverlays('Add text overlay with subtitle');
    expect(r.valid).toBe(false);
  });

  it('passes clean prompt', () => {
    const r = validateNoOverlays('Two people talking in kitchen');
    expect(r.valid).toBe(true);
  });
});

describe('validateDeviceInvisible', () => {
  it('detects device references', () => {
    const r = validateDeviceInvisible('Person holding phone in hand');
    expect(r.valid).toBe(false);
  });

  it('passes clean prompt', () => {
    const r = validateDeviceInvisible('Two elderly people in kitchen');
    expect(r.valid).toBe(true);
  });
});
