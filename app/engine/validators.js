/**
 * FERIXDI Studio — Validators
 * Проверка промптов и структуры по Golden Standard
 */

const BANNED_WORDS = ['sexy', 'horny', 'erotic', 'nude', 'naked', 'porn', 'nsfw'];
const REPLACEMENTS = {
  sexy: 'magnetic', horny: 'restless', erotic: 'sensual tension',
  nude: 'bare-skinned', naked: 'unclothed', porn: 'explicit content', nsfw: 'mature content'
};

const BANNED_OVERLAY_WORDS = ['text overlay', 'subtitle', 'caption text', 'watermark', 'logo'];
const DEVICE_WORDS = ['phone in hand', 'holding phone', 'camera visible', 'selfie stick', 'recording device'];

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

  if (lastEnd > 8.05) {
    warnings.push(`Total duration ${lastEnd}s exceeds 8s grid`);
  }

  // Killer word check near 6.85s
  const killerScene = scenes.find(s => s.start <= 6.85 && s.end >= 6.85);
  if (!killerScene) {
    warnings.push('No scene covers killer word position (~6.85s)');
  }

  return { valid: warnings.length === 0, warnings, fixes };
}

export function validateTwoSpeakers(blueprint) {
  const warnings = [];
  if (!blueprint || !blueprint.scenes) return { valid: false, warnings };

  const speakers = new Set(blueprint.scenes.map(s => s.speaker).filter(Boolean));
  if (speakers.size < 2) {
    warnings.push(`Only ${speakers.size} speaker(s) found, need exactly 2`);
  }

  // Check mouth-closed rule: no overlapping speakers
  const sorted = [...blueprint.scenes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].speaker && sorted[i - 1].speaker &&
        sorted[i].speaker !== sorted[i - 1].speaker &&
        sorted[i].start < sorted[i - 1].end - 0.01) {
      warnings.push(`Speaker overlap: ${sorted[i - 1].speaker} and ${sorted[i].speaker} at ${sorted[i].start}s`);
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
