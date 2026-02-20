/**
 * FERIXDI Studio — Duration Estimator v2
 * Оценка длительности RU реплик для 8s grid v2
 * Per-speaker window limits: A=3.5s, B=4.0s (with 1.2s tolerance)
 */

const PACE_WPS = { slow: 2.8, normal: 3.5, fast: 4.2 };
const LONG_WORD_THRESHOLD = 8;
const LONG_WORD_PENALTY = 0.08;
const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще', 'просто', 'даже', 'тоже', 'ещё', 'уже'];
const FILLER_PENALTY = 0.06;
const SHORT_PUNCH_BONUS = -0.1;
const PAUSE_MARKER_DURATION = 0.2;
// v2 speaker window limits (seconds of speech available)
const SPEAKER_WINDOW = { A: 3.5, B: 4.0 };
const WINDOW_TOLERANCE = 1.2; // windows flex — if A finishes early, B gets extra time. Real speech fits more than estimates.
const TOTAL_SPEECH_BUDGET = SPEAKER_WINDOW.A + SPEAKER_WINDOW.B; // 7.5s total

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
  // Solo monologue window: 0.6-7.3s = 6.7s
  const SOLO_WINDOW_A = 6.7;
  const SOLO_SPEECH_BUDGET = 6.7;

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
      if (entry.speaker === 'A' && words.length > 16) {
        trimmingSuggestions.push(`Сократить A до 8-15 слов (сейчас ${words.length})`);
      }
      if (entry.speaker === 'B' && words.length > 19) {
        trimmingSuggestions.push(`Сократить B до 8-18 слов (сейчас ${words.length})`);
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
    hook: { start: 0.0, end: 0.6 },
    speakerA: { start: 0.6, end: 3.8 },
    speakerB: { start: 3.8, end: 7.3 },
    release: { start: 7.3, end: t },
    killerWord: 7.1,
  };
}
