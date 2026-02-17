/**
 * FERIXDI Studio — Auto Trim v2
 * Автоматическое сокращение реплик под 8s grid
 * 
 * Pipeline (каждый шаг проверяет — если risk уже не high, стоп):
 *   0. Убрать лишние паузы (|) — экономит 0.3s каждая
 *   1. Убрать вводные слова (ну, вот, это, типа...)
 *   2. Заменить длинные слова на короткие синонимы
 *   3. Обрезать лишние слова у того спикера, который вылезает за окно
 */

import { estimateDialogue, estimateLineDuration } from './estimator.js';

const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще', 'просто', 'даже', 'тоже', 'ещё', 'уже'];
const FILLER_REGEX = new RegExp(`(?<=^|\\s)(${FILLER_WORDS.join('|')})(?=\\s|$|[,\\.!?])`, 'gi');

// Speaker windows (must match estimator.js)
const SPEAKER_WINDOW = { A: 3.5, B: 4.0 };
const WINDOW_TOLERANCE = 1.2; // must match estimator.js
const WORD_LIMITS = { A: 15, B: 18 };

// ─── STEP 0: Remove excess pause markers ────
function removePauses(text) {
  const pauses = (text.match(/\|/g) || []).length;
  if (pauses <= 1) return { text, changed: false, fix: null };
  // Keep max 1 pause marker, remove the rest
  let kept = 0;
  const result = text.replace(/\s*\|\s*/g, (match) => {
    kept++;
    return kept === 1 ? ' | ' : ' ';
  }).replace(/\s{2,}/g, ' ').trim();
  return { text: result, changed: true, fix: `Убраны лишние паузы (было ${pauses}, оставлена 1)` };
}

// Remove ALL pause markers
function removeAllPauses(text) {
  if (!text.includes('|')) return { text, changed: false, fix: null };
  const result = text.replace(/\s*\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { text: result, changed: true, fix: 'Убраны все паузы для экономии времени' };
}

// ─── STEP 1: Remove filler words ────────────
function removeFillers(text) {
  const original = text;
  let result = text.replace(FILLER_REGEX, '').replace(/\s{2,}/g, ' ').replace(/^\s*[,|]\s*/, '').trim();
  if (result === original.trim()) return { text, changed: false, fix: null };
  return { text: result, changed: true, fix: 'Убраны вводные слова' };
}

// ─── STEP 2: Shorten long words ─────────────
function shortenLongWords(text) {
  const words = text.split(/\s+/);
  const SHORT_MAP = {
    'абсолютно': 'точно', 'безусловно': 'да', 'естественно': 'ясно',
    'действительно': 'реально', 'обязательно': 'точно', 'практически': 'почти',
    'приблизительно': 'примерно', 'одновременно': 'разом', 'исключительно': 'только',
    'непосредственно': 'прямо', 'соответственно': 'значит', 'категорически': 'нет',
    'замечательно': 'класс', 'великолепно': 'круто', 'потрясающе': 'огонь',
    'удовольствием': 'рад', 'определённо': 'точно', 'разумеется': 'ясно',
    'первоначально': 'сначала', 'впоследствии': 'потом', 'самостоятельно': 'сам',
  };
  let changed = false;
  const result = words.map(w => {
    const lower = w.toLowerCase().replace(/[^а-яё]/g, '');
    if (SHORT_MAP[lower]) { changed = true; return SHORT_MAP[lower]; }
    return w;
  });
  return { text: result.join(' '), changed, fix: changed ? 'Заменены длинные слова на короткие' : null };
}

// ─── STEP 3: Truncate words to fit window ───
function truncateToFit(text, speaker, pace) {
  const speakerWindow = SPEAKER_WINDOW[speaker] || 3.0;
  const windowWithTolerance = speakerWindow + WINDOW_TOLERANCE; // 4.2 for A, 4.5 for B
  const maxWords = WORD_LIMITS[speaker] || 8;
  const words = text.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length <= maxWords) return { text, changed: false, fix: null };
  
  // Keep first 2 words (hook) and last N words (punchline), trim middle
  const keep = maxWords;
  const trimmed = [...words.slice(0, 2), ...words.slice(-(keep - 2))];
  const result = trimmed.join(' ');
  
  // Verify it fits (use window WITH tolerance — not strict window)
  const est = estimateLineDuration(result, pace);
  if (est.duration <= windowWithTolerance) {
    return { text: result, changed: true, fix: `Обрезано с ${words.length} до ${trimmed.length} слов` };
  }
  
  // Still too long — aggressive trim: keep first + last N words
  const aggressive = [...words.slice(0, 1), ...words.slice(-(maxWords - 2))];
  return { text: aggressive.join(' '), changed: true, fix: `Агрессивная обрезка: ${words.length} → ${aggressive.length} слов` };
}

// ─── MAIN AUTO TRIM ─────────────────────────
export function autoTrim(lines, options = {}) {
  const { maxIterations = 5 } = options;
  const fixes = [];
  let currentLines = lines.map(l => ({ ...l }));

  for (let iter = 0; iter < maxIterations; iter++) {
    const est = estimateDialogue(currentLines);
    if (est.risk !== 'high') break;

    let anyChange = false;

    // Step 0: Remove excess pauses (keep max 1 per line)
    currentLines = currentLines.map(l => {
      const r = removePauses(l.text);
      if (r.changed) { anyChange = true; if (r.fix) fixes.push(`${l.speaker}: ${r.fix}`); }
      return { ...l, text: r.text };
    });
    if (anyChange) continue;

    // Step 0b: Remove ALL pauses if still over
    currentLines = currentLines.map(l => {
      const r = removeAllPauses(l.text);
      if (r.changed) { anyChange = true; if (r.fix) fixes.push(`${l.speaker}: ${r.fix}`); }
      return { ...l, text: r.text };
    });
    if (anyChange) continue;

    // Step 1: Remove fillers
    currentLines = currentLines.map(l => {
      const r = removeFillers(l.text);
      if (r.changed) { anyChange = true; if (r.fix) fixes.push(`${l.speaker}: ${r.fix}`); }
      return { ...l, text: r.text };
    });
    if (anyChange) continue;

    // Step 2: Shorten long words
    currentLines = currentLines.map(l => {
      const r = shortenLongWords(l.text);
      if (r.changed) { anyChange = true; if (r.fix) fixes.push(`${l.speaker}: ${r.fix}`); }
      return { ...l, text: r.text };
    });
    if (anyChange) continue;

    // Step 3: Truncate words for speakers that are over window
    for (const entry of est.perLine) {
      if (entry.overWindow) {
        const idx = currentLines.findIndex(l => l.speaker === entry.speaker);
        if (idx >= 0) {
          const r = truncateToFit(currentLines[idx].text, entry.speaker, currentLines[idx].pace);
          if (r.changed) { anyChange = true; currentLines[idx] = { ...currentLines[idx], text: r.text }; fixes.push(`${entry.speaker}: ${r.fix}`); }
        }
      }
    }
    if (anyChange) continue;

    break; // Nothing more to trim safely
  }

  const finalEstimate = estimateDialogue(currentLines);
  return {
    lines: currentLines,
    auto_fixes: fixes,
    estimate: finalEstimate,
    trimmed: fixes.length > 0,
  };
}
