/**
 * FERIXDI Studio — Validators v2
 * Проверка промптов и структуры по Golden Standard 2026 v2
 */

const BANNED_WORDS = ['sexy', 'horny', 'erotic', 'nude', 'naked', 'porn', 'nsfw'];
const REPLACEMENTS = {
  sexy: 'magnetic', horny: 'restless', erotic: 'sensual tension',
  nude: 'bare-skinned', naked: 'unclothed', porn: 'explicit content', nsfw: 'mature content'
};

const BANNED_OVERLAY_WORDS = ['text overlay', 'subtitle', 'caption text', 'watermark', 'logo'];
const DEVICE_WORDS = ['phone in hand', 'holding phone', 'camera visible', 'selfie stick', 'recording device'];

// v2 grid boundaries
const GRID_V2 = {
  hook:    { start: 0.0, end: 0.6 },
  act_A:   { start: 0.6, end: 3.8 },
  act_B:   { start: 3.8, end: 7.3 },
  release: { start: 7.3, end: 8.0 },
};

// v2 word count limits (tightened to fit timing windows)
const WORD_LIMITS = { A: { min: 4, max: 10 }, B: { min: 4, max: 12 } };

export function scanBannedWords(text) {
  const warnings = [];
  const fixes = [];
  let result = text;

  for (const word of BANNED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(result)) {
      const replacement = REPLACEMENTS[word] || '[REMOVED]';
      warnings.push(`Banned word "${word}" found`);
      fixes.push(`Replaced "${word}" → "${replacement}"`);
      result = result.replace(regex, replacement);
    }
  }
  return { text: result, warnings, fixes };
}

export function validateTimingGrid(blueprint) {
  const warnings = [];
  const fixes = [];

  if (!blueprint || !blueprint.scenes) {
    warnings.push('Blueprint missing scenes array');
    return { valid: false, warnings, fixes };
  }

  const scenes = blueprint.scenes;
  let lastEnd = 0;

  for (const scene of scenes) {
    if (scene.start < lastEnd - 0.01) {
      warnings.push(`Overlap: scene ${scene.id} starts at ${scene.start}s but prev ends at ${lastEnd}s`);
    }
    lastEnd = scene.end;
  }

  if (lastEnd > 8.25) {
    warnings.push(`Total duration ${lastEnd}s exceeds 8s grid (tolerance ±0.2s)`);
  }

  // v2: Hook must end by 0.85s (0.8 + tolerance)
  const hookScene = scenes.find(s => s.segment === 'hook' || s.id === 1);
  if (hookScene && hookScene.end > 0.65) {
    warnings.push(`Hook ends at ${hookScene.end}s, must be ≤0.6s`);
  }

  // v2: Release must have zero dialogue
  const releaseScene = scenes.find(s => s.segment === 'release');
  if (releaseScene && releaseScene.dialogue_ru && releaseScene.dialogue_ru.trim()) {
    warnings.push('Release segment must have ZERO words (shared laugh only)');
  }

  // Killer word check near 7.1s
  const killerScene = scenes.find(s => s.start <= 7.1 && s.end >= 7.1);
  if (!killerScene) {
    warnings.push('No scene covers killer word position (~7.1s)');
  }

  return { valid: warnings.length === 0, warnings, fixes };
}

export function validateTwoSpeakers(blueprint) {
  const warnings = [];
  if (!blueprint || !blueprint.scenes) return { valid: false, warnings };

  const speakers = new Set(blueprint.scenes.map(s => s.speaker).filter(s => s && s !== 'both'));
  if (speakers.size < 2) {
    warnings.push(`Only ${speakers.size} speaker(s) found, need exactly 2`);
  }

  // Check mouth-closed rule: no overlapping speakers
  const sorted = [...blueprint.scenes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].speaker && sorted[i - 1].speaker &&
        sorted[i].speaker !== 'both' && sorted[i - 1].speaker !== 'both' &&
        sorted[i].speaker !== sorted[i - 1].speaker &&
        sorted[i].start < sorted[i - 1].end - 0.01) {
      warnings.push(`Speaker overlap: ${sorted[i - 1].speaker} and ${sorted[i].speaker} at ${sorted[i].start}s`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

export function validateWordCount(blueprint) {
  const warnings = [];
  if (!blueprint || !blueprint.dialogue_segments) return { valid: true, warnings };

  for (const seg of blueprint.dialogue_segments) {
    if (!seg.text_ru) continue;
    const words = seg.text_ru.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0);
    const limit = WORD_LIMITS[seg.speaker];
    if (!limit) continue;
    if (words.length < limit.min) {
      warnings.push(`${seg.speaker}: ${words.length} слов (мин. ${limit.min}) — слишком коротко`);
    }
    if (words.length > limit.max + 2) {
      warnings.push(`${seg.speaker}: ${words.length} слов (макс. ${limit.max}) — не влезет в окно, нужно резать`);
    }
  }
  return { valid: warnings.length === 0, warnings };
}

export function validateNoOverlays(prompt) {
  const warnings = [];
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

  for (const word of BANNED_OVERLAY_WORDS) {
    if (text.toLowerCase().includes(word)) {
      warnings.push(`Overlay reference found: "${word}"`);
    }
  }
  return { valid: warnings.length === 0, warnings };
}

export function validateDeviceInvisible(prompt) {
  const warnings = [];
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

  for (const word of DEVICE_WORDS) {
    if (text.toLowerCase().includes(word)) {
      warnings.push(`Device visible reference: "${word}"`);
    }
  }
  return { valid: warnings.length === 0, warnings };
}

export function validateLocationRepeat(location, historyCache) {
  const warnings = [];
  if (historyCache && historyCache.hasLocation(location)) {
    warnings.push(`Location "${location}" was used recently. Consider a unique location.`);
  }
  return { valid: warnings.length === 0, warnings };
}

export function validateIdentityAnchors(blueprint) {
  const warnings = [];
  if (!blueprint || !blueprint.identity_anchors) return { valid: true, warnings };
  const anchors = blueprint.identity_anchors;
  for (const role of ['A', 'B']) {
    const a = anchors[role];
    if (!a || !a.face_silhouette) {
      warnings.push(`${role}: missing face_silhouette anchor — Veo may redraw face`);
    }
    if (!a || !a.signature_element) {
      warnings.push(`${role}: missing signature_element anchor`);
    }
  }
  return { valid: warnings.length === 0, warnings };
}

export function runAllValidations(output, historyCache = null) {
  const allWarnings = [];
  const allFixes = [];

  // Banned words in video prompt
  if (output.video_prompt_en_json) {
    const vText = JSON.stringify(output.video_prompt_en_json);
    const bw = scanBannedWords(vText);
    allWarnings.push(...bw.warnings);
    allFixes.push(...bw.fixes);
  }

  // Banned words in photo prompt
  if (output.photo_prompt_en_json) {
    const pText = JSON.stringify(output.photo_prompt_en_json);
    const bw = scanBannedWords(pText);
    allWarnings.push(...bw.warnings);
    allFixes.push(...bw.fixes);
  }

  // Timing grid
  if (output.blueprint_json) {
    const tg = validateTimingGrid(output.blueprint_json);
    allWarnings.push(...tg.warnings);

    const ts = validateTwoSpeakers(output.blueprint_json);
    allWarnings.push(...ts.warnings);

    // v2: word count check
    const wc = validateWordCount(output.blueprint_json);
    allWarnings.push(...wc.warnings);

    // v2: identity anchors check
    const ia = validateIdentityAnchors(output.blueprint_json);
    allWarnings.push(...ia.warnings);
  }

  // Overlays
  if (output.video_prompt_en_json) {
    const ov = validateNoOverlays(output.video_prompt_en_json);
    allWarnings.push(...ov.warnings);

    const dv = validateDeviceInvisible(output.video_prompt_en_json);
    allWarnings.push(...dv.warnings);
  }

  // Location repeat
  if (output.video_prompt_en_json?.world?.location && historyCache) {
    const lr = validateLocationRepeat(output.video_prompt_en_json.world.location, historyCache);
    allWarnings.push(...lr.warnings);
  }

  return { warnings: allWarnings, auto_fixes: allFixes };
}
