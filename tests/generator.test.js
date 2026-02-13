import { describe, it, expect } from 'vitest';
import { generate, getRandomCategory } from '../app/engine/generator.js';

// Minimal character stubs for testing
const CHARS = [
  {
    id: 'test_a', name_ru: 'Тест A', group: 'тест', tags: ['тест'],
    appearance_ru: 'Тестовый персонаж A для smoke test',
    speech_style_ru: 'быстрая', behavior_ru: 'активный',
    speech_pace: 'fast', swear_level: 1, role_default: 'A',
    signature_words_ru: ['тест'], compatibility: 'chaotic',
    prompt_tokens: { character_en: 'Test character A for smoke testing, expressive face, detailed features' },
    modifiers: { hook_style: 'points finger', laugh_style: 'loud burst' },
  },
  {
    id: 'test_b', name_ru: 'Тест B', group: 'тест', tags: ['тест'],
    appearance_ru: 'Тестовый персонаж B для smoke test',
    speech_style_ru: 'медленная', behavior_ru: 'спокойный',
    speech_pace: 'slow', swear_level: 0, role_default: 'B',
    signature_words_ru: ['база'], compatibility: 'calm',
    prompt_tokens: { character_en: 'Test character B for smoke testing, calm demeanor, detailed features' },
    modifiers: { hook_style: 'raises eyebrow', laugh_style: 'quiet chuckle' },
  },
];

describe('getRandomCategory', () => {
  it('returns category with ru and en', () => {
    const cat = getRandomCategory('test-seed');
    expect(cat).toHaveProperty('ru');
    expect(cat).toHaveProperty('en');
    expect(cat.ru.length).toBeGreaterThan(0);
  });

  it('is deterministic with same seed', () => {
    const a = getRandomCategory('same-seed');
    const b = getRandomCategory('same-seed');
    expect(a.ru).toBe(b.ru);
  });
});

describe('generate', () => {
  it('produces full output package in idea mode', () => {
    const result = generate({
      input_mode: 'idea',
      character1_id: 'test_a',
      character2_id: 'test_b',
      context_ru: 'Тест генерации',
      seed: 'smoke-test-seed',
      characters: CHARS,
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('photo_prompt_en_json');
    expect(result).toHaveProperty('video_prompt_en_json');
    expect(result).toHaveProperty('ru_package');
    expect(result).toHaveProperty('blueprint_json');
    expect(result).toHaveProperty('log');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('auto_fixes');
    expect(result).toHaveProperty('duration_estimate');
  });

  it('photo prompt has required v2 structure', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'test_a', character2_id: 'test_b',
      seed: 'photo-test', characters: CHARS,
    });
    const p = result.photo_prompt_en_json;
    expect(p).toHaveProperty('scene');
    expect(p).toHaveProperty('characters');
    expect(p.characters).toHaveLength(2);
    expect(p.characters[0]).toHaveProperty('face_anchor');
    expect(p.characters[0]).toHaveProperty('signature');
    expect(p).toHaveProperty('environment');
    expect(p.environment).toHaveProperty('prop_anchor');
    expect(p).toHaveProperty('camera');
    expect(p).toHaveProperty('negative');
    expect(p.negative).toContain('no plastic skin');
  });

  it('video prompt has required v2 structure', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'test_a', character2_id: 'test_b',
      seed: 'video-test', characters: CHARS,
    });
    const v = result.video_prompt_en_json;
    expect(v).toHaveProperty('cast');
    expect(v.cast).toHaveProperty('speaker_A');
    expect(v.cast).toHaveProperty('speaker_B');
    expect(v.cast).toHaveProperty('relationship');
    expect(v.cast.speaker_A).toHaveProperty('face_silhouette');
    expect(v.cast.speaker_A).toHaveProperty('vibe');
    expect(v).toHaveProperty('identity_anchors');
    expect(v.identity_anchors).toHaveProperty('serial');
    expect(v).toHaveProperty('vibe');
    expect(v).toHaveProperty('camera');
    expect(v.camera).toHaveProperty('artifacts');
    expect(v.camera).toHaveProperty('realism_anchors');
    expect(v).toHaveProperty('world');
    expect(v.world).toHaveProperty('prop_anchor');
    expect(v).toHaveProperty('timing');
    expect(v.timing.total_seconds).toBeLessThanOrEqual(8.0);
    expect(v.timing.tolerance_s).toBe(0.2);
    expect(v).toHaveProperty('audio');
    expect(v.audio.overlap_policy).toContain('FORBIDDEN');
    expect(v.audio).toHaveProperty('laugh');
    expect(v).toHaveProperty('safety');
    expect(v.safety.device_invisible).toBe(true);
    expect(v.safety.no_text_in_frame).toBe(true);
  });

  it('blueprint has v2 timing grid and identity anchors', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'test_a', character2_id: 'test_b',
      seed: 'bp-test', characters: CHARS,
    });
    const bp = result.blueprint_json;
    expect(bp.version).toBe('2.0');
    expect(bp).toHaveProperty('scenes');
    expect(bp.scenes.length).toBe(4);
    expect(bp.scenes[0].segment).toBe('hook');
    expect(bp.scenes[0].end).toBe(0.8);
    expect(bp.scenes[1].segment).toBe('act_A');
    expect(bp.scenes[2].segment).toBe('act_B');
    expect(bp.scenes[3].segment).toBe('release');
    expect(bp.scenes[3].dialogue_ru).toBe('');
    expect(bp).toHaveProperty('timing_grid');
    expect(bp.timing_grid.killer_word_at).toBe(6.85);
    expect(bp.timing_grid).toHaveProperty('release');
    expect(bp.timing_grid).toHaveProperty('gap_between_speakers');
    expect(bp).toHaveProperty('identity_anchors');
  });

  it('includes QC Gate in output', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'test_a', character2_id: 'test_b',
      seed: 'qc-test', characters: CHARS,
    });
    expect(result).toHaveProperty('qc_gate');
    expect(result.qc_gate).toHaveProperty('passed');
    expect(result.qc_gate).toHaveProperty('total');
    expect(result.qc_gate.total).toBe(10);
    expect(result.qc_gate).toHaveProperty('ok');
    expect(result.qc_gate).toHaveProperty('details');
    expect(result.qc_gate.details).toHaveLength(10);
  });

  it('works in script mode', () => {
    const result = generate({
      input_mode: 'script', character1_id: 'test_a', character2_id: 'test_b',
      script_ru: { A: 'Тестовая реплика!', B: 'Ответ на тест.' },
      seed: 'script-test', characters: CHARS,
    });
    expect(result).not.toHaveProperty('error');
    expect(result.log.input_mode).toBe('script');
  });

  it('works in video mode', () => {
    const result = generate({
      input_mode: 'video', character1_id: 'test_a', character2_id: 'test_b',
      video_meta: { duration: 15.5, size: 5000000, name: 'test.mp4' },
      seed: 'video-test', characters: CHARS,
    });
    expect(result).not.toHaveProperty('error');
    expect(result.log.input_mode).toBe('video');
  });

  it('returns error if characters not found', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'nonexistent', character2_id: 'also_missing',
      seed: 'err-test', characters: [],
    });
    expect(result).toHaveProperty('error');
  });

  it('duration estimate has risk field', () => {
    const result = generate({
      input_mode: 'idea', character1_id: 'test_a', character2_id: 'test_b',
      seed: 'dur-test', characters: CHARS,
    });
    expect(['low', 'medium', 'high']).toContain(result.duration_estimate.risk);
  });
});
