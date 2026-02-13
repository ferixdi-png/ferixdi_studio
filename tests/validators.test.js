import { describe, it, expect } from 'vitest';
import { scanBannedWords, validateTimingGrid, validateTwoSpeakers, validateNoOverlays, validateDeviceInvisible, validateWordCount, validateIdentityAnchors } from '../app/engine/validators.js';

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

describe('validateTimingGrid v2', () => {
  it('passes valid v2 grid', () => {
    const bp = {
      scenes: [
        { id: 1, segment: 'hook', start: 0, end: 0.8, speaker: 'A', dialogue_ru: '' },
        { id: 2, segment: 'act_A', start: 0.8, end: 3.6, speaker: 'A', dialogue_ru: 'test' },
        { id: 3, segment: 'act_B', start: 3.6, end: 7.1, speaker: 'B', dialogue_ru: 'test' },
        { id: 4, segment: 'release', start: 7.1, end: 8.0, speaker: 'both', dialogue_ru: '' },
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

  it('detects exceeding 8s with tolerance', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 9.0, speaker: 'A' },
      ]
    };
    const r = validateTimingGrid(bp);
    expect(r.warnings.some(w => w.includes('exceeds'))).toBe(true);
  });

  it('warns if release has dialogue', () => {
    const bp = {
      scenes: [
        { id: 1, segment: 'hook', start: 0, end: 0.8, speaker: 'A', dialogue_ru: '' },
        { id: 2, segment: 'act_A', start: 0.8, end: 3.6, speaker: 'A', dialogue_ru: 'ok' },
        { id: 3, segment: 'act_B', start: 3.6, end: 7.1, speaker: 'B', dialogue_ru: 'ok' },
        { id: 4, segment: 'release', start: 7.1, end: 8.0, speaker: 'both', dialogue_ru: 'words here' },
      ]
    };
    const r = validateTimingGrid(bp);
    expect(r.warnings.some(w => w.includes('ZERO words'))).toBe(true);
  });
});

describe('validateTwoSpeakers v2', () => {
  it('passes with two speakers + both', () => {
    const bp = {
      scenes: [
        { id: 1, start: 0, end: 0.8, speaker: 'A' },
        { id: 2, start: 0.8, end: 3.6, speaker: 'A' },
        { id: 3, start: 3.6, end: 7.1, speaker: 'B' },
        { id: 4, start: 7.1, end: 8.0, speaker: 'both' },
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

describe('validateWordCount v2', () => {
  it('passes valid word counts', () => {
    const bp = {
      dialogue_segments: [
        { speaker: 'A', text_ru: 'Раз два три четыре пять шесть семь' },
        { speaker: 'B', text_ru: 'Один два три четыре пять шесть семь восемь' },
      ]
    };
    expect(validateWordCount(bp).valid).toBe(true);
  });

  it('warns on too many words for A', () => {
    const bp = {
      dialogue_segments: [
        { speaker: 'A', text_ru: 'Раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать' },
      ]
    };
    const r = validateWordCount(bp);
    expect(r.warnings.some(w => w.includes('не влезет'))).toBe(true);
  });

  it('warns on too few words', () => {
    const bp = {
      dialogue_segments: [
        { speaker: 'A', text_ru: 'Раз два три' },
      ]
    };
    const r = validateWordCount(bp);
    expect(r.warnings.some(w => w.includes('коротко'))).toBe(true);
  });
});

describe('validateIdentityAnchors v2', () => {
  it('passes with complete anchors', () => {
    const bp = {
      identity_anchors: {
        A: { face_silhouette: 'round face', signature_element: 'earrings' },
        B: { face_silhouette: 'angular jaw', signature_element: 'cap' },
      }
    };
    expect(validateIdentityAnchors(bp).valid).toBe(true);
  });

  it('warns on missing silhouette', () => {
    const bp = {
      identity_anchors: {
        A: { signature_element: 'earrings' },
        B: { face_silhouette: 'angular jaw', signature_element: 'cap' },
      }
    };
    const r = validateIdentityAnchors(bp);
    expect(r.warnings.some(w => w.includes('face_silhouette'))).toBe(true);
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
