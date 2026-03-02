/**
 * FERIXDI Studio — Duration Estimator v2
 * Оценка длительности RU реплик для 8s grid v2
 * Per-speaker window limits: A=2.8s, B=3.5s (with 0.5s tolerance)
 */

const PACE_WPS = { slow: 2.0, normal: 2.5, fast: 3.0 };
const LONG_WORD_THRESHOLD = 8;
const LONG_WORD_PENALTY = 0.08;
const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще', 'просто', 'даже', 'тоже', 'ещё', 'уже'];
const FILLER_PENALTY = 0.06;
const SHORT_PUNCH_BONUS = -0.1;
const PAUSE_MARKER_DURATION = 0.2;
// v2 speaker window limits — MUST match generator.js GRID_V2
// A: 0.7-3.5 = 2.8s, B: 3.5-7.0 = 3.5s
const SPEAKER_WINDOW = { A: 2.8, B: 3.5 };
const WINDOW_TOLERANCE = 0.5; // small flex for natural speech variation
const TOTAL_SPEECH_BUDGET = SPEAKER_WINDOW.A + SPEAKER_WINDOW.B; // 6.3s total

export function estimateLineDuration(text, pace = 'normal') {
  if (!text || !text.trim()) return { duration: 0, wordCount: 0, details: [] };

  const baseWps = PACE_WPS[pace] || PACE_WPS.normal;
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  let baseDuration = wordCount / baseWps;

  const details = [];
  let penalty = 0;

  // Штраф за длинные слова
  const longWords = words.filter(w => w.replace(/[^а-яёa-z]/gi, '').length > LONG_WORD_THRESHOLD);
  if (longWords.length > 0) {
    const p = longWords.length * LONG_WORD_PENALTY;
    penalty += p;
    details.push(`+${p.toFixed(2)}s за ${longWords.length} длинных слов`);
  }

  // Штраф за вводные слова
  const fillers = words.filter(w => FILLER_WORDS.includes(w.toLowerCase().replace(/[^а-яё]/g, '')));
  if (fillers.length > 0) {
    const p = fillers.length * FILLER_PENALTY;
    penalty += p;
    details.push(`+${p.toFixed(2)}s за ${fillers.length} вводных слов`);
  }

  // Паузы (маркер |)
  const pauses = (text.match(/\|/g) || []).length;
  if (pauses > 0) {
    const p = pauses * PAUSE_MARKER_DURATION;
    penalty += p;
    details.push(`+${p.toFixed(2)}s за ${pauses} пауз`);
  }

  // Бонус за короткие ударные фразы (< 4 слова, заканчивается на !)
  if (wordCount <= 3 && text.trim().endsWith('!')) {
    penalty += SHORT_PUNCH_BONUS;
    details.push(`${SHORT_PUNCH_BONUS}s бонус за ударную фразу`);
  }

  const duration = Math.max(0.2, baseDuration + penalty);
  return { duration: Math.round(duration * 100) / 100, wordCount, details };
}

export function estimateDialogue(lines, options = {}) {
  const { enforce8s = true } = options;
  const TARGET = 8.0;
  const perLine = [];
  let total = 0;

  // Solo mode detection: single line with speaker A
  const isSolo = lines.length === 1 && lines[0]?.speaker === 'A';
  // Solo monologue window: 0.7-7.0s = 6.3s
  const SOLO_WINDOW_A = 6.3;
  const SOLO_SPEECH_BUDGET = 6.3;

  for (const line of lines) {
    const est = estimateLineDuration(line.text, line.pace || 'normal');
    const speaker = line.speaker || '?';
    const window = (isSolo && speaker === 'A') ? SOLO_WINDOW_A : (SPEAKER_WINDOW[speaker] || 3.0);
    const overWindow = est.duration > window + WINDOW_TOLERANCE;
    const entry = {
      speaker,
      text: line.text,
      duration: est.duration,
      wordCount: est.wordCount,
      details: est.details,
      window,
      overWindow,
    };
    perLine.push(entry);
    total += est.duration;
  }

  total = Math.round(total * 100) / 100;

  // v2 risk: check total speech budget AND per-speaker windows with tolerance
  const speechBudget = isSolo ? SOLO_SPEECH_BUDGET : TOTAL_SPEECH_BUDGET;
  let risk = 'low';
  const anyOverWindow = perLine.some(l => l.overWindow);
  if (total > speechBudget || anyOverWindow) risk = 'high';
  else if (total > speechBudget - 0.5) risk = 'medium';

  const notes = [];
  const trimmingSuggestions = [];

  // Per-speaker window warnings
  for (const entry of perLine) {
    if (entry.overWindow) {
      notes.push(`${entry.speaker}: ${entry.duration}s > окно ${entry.window}s (+${WINDOW_TOLERANCE}s запас) — НЕ ВЛЕЗЕТ`);
    } else if (entry.duration > entry.window) {
      notes.push(`${entry.speaker}: ${entry.duration}s > окно ${entry.window}s — на грани, но влезет (запас ${WINDOW_TOLERANCE}s)`);
    }
  }

  if (risk === 'high') {
    if (total > TARGET) notes.push(`Превышение на ${(total - TARGET).toFixed(2)}s — нужно сокращать`);
    for (const entry of perLine) {
      const words = (entry.text || '').split(/\s+/);
      const fillers = words.filter(w => FILLER_WORDS.includes(w.toLowerCase().replace(/[^а-яё]/g, '')));
      if (fillers.length > 0) {
        trimmingSuggestions.push(`Убрать вводные «${fillers.join(', ')}» у ${entry.speaker} (−${(fillers.length * FILLER_PENALTY).toFixed(2)}s)`);
      }
      const longW = words.filter(w => w.replace(/[^а-яёa-z]/gi, '').length > LONG_WORD_THRESHOLD);
      if (longW.length > 0) {
        trimmingSuggestions.push(`Заменить длинные слова «${longW.join(', ')}» у ${entry.speaker} на короткие`);
      }
      if (entry.speaker === 'A' && words.length > 10) {
        trimmingSuggestions.push(`Сократить A до 4-10 слов (сейчас ${words.length})`);
      }
      if (entry.speaker === 'B' && words.length > 12) {
        trimmingSuggestions.push(`Сократить B до 4-12 слов (сейчас ${words.length})`);
      }
    }
    if (trimmingSuggestions.length === 0) {
      trimmingSuggestions.push('Убрать паузы (|) или слить короткие фразы');
      trimmingSuggestions.push('Оставить только панчлайн');
    }
  } else if (risk === 'medium') {
    notes.push(`Близко к лимиту (${total}s / ${TARGET}s) — будь внимателен`);
    trimmingSuggestions.push('Убрать 1-2 вводных слова для запаса');
  }

  return { total, perLine, risk, notes, trimming_suggestions: trimmingSuggestions };
}

export function getSegmentTimings(total) {
  const t = Math.min(total, 8.0);
  return {
    hook: { start: 0.0, end: 0.7 },
    speakerA: { start: 0.7, end: 3.5 },
    speakerB: { start: 3.5, end: 7.0 },
    release: { start: 7.0, end: t },
    killerWord: 6.8,
  };
}
