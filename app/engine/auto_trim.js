/**
 * FERIXDI Studio — Auto Trim
 * Автоматическое сокращение реплик под 8s grid
 */

import { estimateDialogue } from './estimator.js';

const FILLER_WORDS = ['ну', 'вот', 'это', 'типа', 'короче', 'значит', 'так', 'ладно', 'кстати', 'вообще', 'просто', 'даже', 'тоже', 'ещё', 'уже'];
const FILLER_REGEX = new RegExp(`\\b(${FILLER_WORDS.join('|')})\\b`, 'gi');

function removeFillers(text) {
  const original = text;
  let result = text.replace(FILLER_REGEX, '').replace(/\s{2,}/g, ' ').trim();
  if (result === original) return { text, changed: false, fix: null };
  return { text: result, changed: true, fix: `Убраны вводные слова` };
}

function shortenLongWords(text) {
  const words = text.split(/\s+/);
  const SHORT_MAP = {
    'абсолютно': 'точно', 'безусловно': 'да', 'естественно': 'ясно',
    'действительно': 'реально', 'обязательно': 'точно', 'практически': 'почти',
    'приблизительно': 'примерно', 'одновременно': 'разом', 'исключительно': 'только',
    'непосредственно': 'прямо', 'соответственно': 'значит', 'категорически': 'нет',
    'замечательно': 'класс', 'великолепно': 'круто', 'потрясающе': 'огонь',
  };
  let changed = false;
  const result = words.map(w => {
    const lower = w.toLowerCase().replace(/[^а-яё]/g, '');
    if (SHORT_MAP[lower]) { changed = true; return SHORT_MAP[lower]; }
    return w;
  });
  return { text: result.join(' '), changed, fix: changed ? 'Заменены длинные слова на короткие' : null };
}

function mergePhrases(lines) {
  if (lines.length <= 2) return { lines, changed: false, fix: null };
  const merged = [];
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length &&
        lines[i].speaker === lines[i + 1].speaker &&
        lines[i].text.split(/\s+/).length <= 3 &&
        lines[i + 1].text.split(/\s+/).length <= 3) {
      merged.push({ ...lines[i], text: lines[i].text + ' ' + lines[i + 1].text });
      changed = true;
      i += 2;
    } else {
      merged.push(lines[i]);
      i++;
    }
  }
  return { lines: merged, changed, fix: changed ? 'Слиты короткие фразы одного спикера' : null };
}

export function autoTrim(lines, options = {}) {
  const { maxIterations = 3 } = options;
  const TARGET = 8.0;
  const fixes = [];
  let currentLines = lines.map(l => ({ ...l }));

  for (let iter = 0; iter < maxIterations; iter++) {
    const est = estimateDialogue(currentLines);
    if (est.risk !== 'high') break;

    // Step 1: Remove fillers
    let anyChange = false;
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

    // Step 3: Merge short phrases
    const m = mergePhrases(currentLines);
    if (m.changed) { currentLines = m.lines; if (m.fix) fixes.push(m.fix); continue; }

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
