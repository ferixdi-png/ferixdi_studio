/**
 * FERIXDI Studio — Duration Estimator
 * Оценка длительности RU реплик для 8s grid
 */

const PACE_WPS = { slow: 2.0, normal: 2.5, fast: 3.0 };
const LONG_WORD_THRESHOLD = 8;
const LONG_WORD_PENALTY = 0.15;
const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще'];
const FILLER_PENALTY = 0.12;
const SHORT_PUNCH_BONUS = -0.1;
const PAUSE_MARKER_DURATION = 0.3;

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
    const entry = {
      speaker: line.speaker || '?',
      text: line.text,
      duration: est.duration,
      wordCount: est.wordCount,
      details: est.details,
    };
    perLine.push(entry);
    total += est.duration;
  }

  total = Math.round(total * 100) / 100;
  let risk = 'low';
  if (total > TARGET) risk = 'high';
  else if (total > TARGET - 1.0) risk = 'medium';

  const notes = [];
  const trimmingSuggestions = [];

  if (risk === 'high') {
    notes.push(`Превышение на ${(total - TARGET).toFixed(2)}s — нужно сокращать`);
    // Генерируем предложения по сокращению
    for (const entry of perLine) {
      const words = entry.text.split(/\s+/);
      const fillers = words.filter(w => FILLER_WORDS.includes(w.toLowerCase().replace(/[^а-яё]/g, '')));
      if (fillers.length > 0) {
        trimmingSuggestions.push(`Убрать вводные «${fillers.join(', ')}» у ${entry.speaker} (−${(fillers.length * FILLER_PENALTY).toFixed(2)}s)`);
      }
      const longW = words.filter(w => w.replace(/[^а-яёa-z]/gi, '').length > LONG_WORD_THRESHOLD);
      if (longW.length > 0) {
        trimmingSuggestions.push(`Заменить длинные слова «${longW.join(', ')}» у ${entry.speaker} на короткие`);
      }
      if (words.length > 8) {
        trimmingSuggestions.push(`Сократить реплику ${entry.speaker} (${words.length} слов → ~${Math.ceil(words.length * 0.7)})`);
      }
    }
    if (trimmingSuggestions.length === 0) {
      trimmingSuggestions.push('Слить короткие фразы в одну');
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
