/**
 * FERIXDI Studio — Duration Estimator v2
 * Оценка длительности RU реплик для 8s grid v2
 * Per-speaker window limits: A=2.8s, B=3.5s
 */

const PACE_WPS = { slow: 2.3, normal: 3.0, fast: 3.5 };
const LONG_WORD_THRESHOLD = 8;
const LONG_WORD_PENALTY = 0.15;
const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще', 'просто', 'даже', 'тоже', 'ещё', 'уже'];
const FILLER_PENALTY = 0.12;
const SHORT_PUNCH_BONUS = -0.1;
const PAUSE_MARKER_DURATION = 0.3;
// v2 speaker window limits (seconds of speech available)
const SPEAKER_WINDOW = { A: 3.2, B: 3.5 };

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

  for (const line of lines) {
    const est = estimateLineDuration(line.text, line.pace || 'normal');
    const speaker = line.speaker || '?';
    const window = SPEAKER_WINDOW[speaker] || 3.0;
    const overWindow = est.duration > window;
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

  // v2 risk: check both total AND per-speaker windows
  let risk = 'low';
  const anyOverWindow = perLine.some(l => l.overWindow);
  if (total > TARGET || anyOverWindow) risk = 'high';
  else if (total > TARGET - 1.0) risk = 'medium';

  const notes = [];
  const trimmingSuggestions = [];

  // Per-speaker window warnings
  for (const entry of perLine) {
    if (entry.overWindow) {
      notes.push(`${entry.speaker}: ${entry.duration}s > окно ${entry.window}s — НЕ ВЛЕЗЕТ`);
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
      if (entry.speaker === 'A' && words.length > 9) {
        trimmingSuggestions.push(`Сократить A до 6-9 слов (сейчас ${words.length})`);
      }
      if (entry.speaker === 'B' && words.length > 11) {
        trimmingSuggestions.push(`Сократить B до 6-11 слов (сейчас ${words.length})`);
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
    hook: { start: 0, end: 0.8 },
    speakerA: { start: 0.8, end: 3.6 },
    speakerB: { start: 3.6, end: 7.1 },
    release: { start: 7.1, end: t },
    killerWord: 6.85,
  };
}
