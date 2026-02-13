/**
 * FERIXDI Studio — Main Application
 * Космический хакерский командный центр для ремикса видео
 */

import { generate, getRandomCategory } from './engine/generator.js';
import { estimateDialogue } from './engine/estimator.js';
import { autoTrim } from './engine/auto_trim.js';
import { historyCache } from './engine/history_cache.js';

// ─── STATE ───────────────────────────────────
const state = {
  characters: [],
  selectedA: null,
  selectedB: null,
  inputMode: 'idea',
  category: null,
  threadMessages: [],
  threadMemory: '',
  videoMeta: null,
  options: { enforce8s: true, preserveRhythm: true, strictLipSync: true, allowAutoTrim: false },
  lastResult: null,
  settingsMode: 'demo',
};

// ─── LOG ─────────────────────────────────────
function log(level, module, msg) {
  const el = document.getElementById('log-output');
  if (!el) return;
  const ts = new Date().toLocaleTimeString('ru-RU');
  const cls = { INFO: 'log-info', WARN: 'log-warn', ERR: 'log-err', OK: 'log-ok' }[level] || 'log-info';
  el.innerHTML += `<div class="${cls}">[${ts}] ${module}: ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

// ─── ACCESS GATE ─────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function initAccessGate() {
  // Check localStorage
  const saved = localStorage.getItem('ferixdi_access');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.accessGranted) { unlockApp(); return; }
    } catch {}
  }

  const btn = document.getElementById('access-key-btn');
  const input = document.getElementById('access-key-input');
  const status = document.getElementById('access-status');

  btn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { status.innerHTML = '<span class="text-red-400">Введите ключ</span>'; return; }
    status.innerHTML = '<span class="text-gray-500">Проверяю...</span>';

    try {
      const hash = await sha256(key);
      const resp = await fetch(new URL('./data/access_keys.json', import.meta.url));
      const data = await resp.json();
      const match = data.keys.find(k => k.hash === hash);
      if (match) {
        localStorage.setItem('ferixdi_access', JSON.stringify({ accessGranted: true, ts: Date.now(), keyHash: hash }));
        status.innerHTML = '<span class="neon-text-green">✓ Ключ принят. Добро пожаловать.</span>';
        setTimeout(unlockApp, 600);
        log('OK', 'AUTH', `Access granted (${match.label})`);
      } else {
        status.innerHTML = '<span class="text-red-400">✗ Неверный ключ. Проверьте и попробуйте снова.</span>';
        log('WARN', 'AUTH', 'Invalid key attempt');
      }
    } catch (e) {
      status.innerHTML = '<span class="text-red-400">Ошибка проверки</span>';
      log('ERR', 'AUTH', e.message);
    }
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

function unlockApp() {
  document.getElementById('access-gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  log('OK', 'SYSTEM', 'FERIXDI Studio initialized');
  loadCharacters();
  updateCacheStats();
}

// ─── CHARACTERS ──────────────────────────────
async function loadCharacters() {
  try {
    const resp = await fetch(new URL('./data/characters.json', import.meta.url));
    state.characters = await resp.json();
    log('OK', 'DATA', `Loaded ${state.characters.length} characters`);
    populateFilters();
    renderCharacters();
  } catch (e) {
    log('ERR', 'DATA', `Failed to load characters: ${e.message}`);
  }
}

function populateFilters() {
  const groups = [...new Set(state.characters.map(c => c.group))].sort();
  const sel = document.getElementById('char-group-filter');
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

function renderCharacters(filter = {}) {
  const grid = document.getElementById('char-grid');
  let chars = [...state.characters];

  if (filter.search) {
    const q = filter.search.toLowerCase();
    chars = chars.filter(c => c.name_ru.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || c.tags.some(t => t.includes(q)));
  }
  if (filter.group) chars = chars.filter(c => c.group === filter.group);
  if (filter.compat) chars = chars.filter(c => c.compatibility === filter.compat);

  grid.innerHTML = chars.map(c => `
    <div class="char-card ${state.selectedA?.id === c.id ? 'selected border-neon-blue' : ''} ${state.selectedB?.id === c.id ? 'selected border-purple-500' : ''}"
         data-id="${c.id}">
      <div class="flex items-center justify-between mb-1">
        <span class="text-sm font-medium">${c.name_ru}</span>
        <span class="tag text-[10px] ${c.compatibility === 'meme' ? 'tag-green' : c.compatibility === 'conflict' ? 'tag-pink' : c.compatibility === 'chaotic' ? 'tag-orange' : c.compatibility === 'calm' ? '' : 'tag-purple'}">${c.compatibility}</span>
      </div>
      <div class="text-[10px] text-gray-500 mb-1">${c.group} · ${c.speech_pace} · мат ${c.swear_level}/3</div>
      <div class="text-[10px] text-gray-600 line-clamp-2">${c.appearance_ru}</div>
      <div class="flex gap-1 mt-2">
        <button class="btn-neon text-[10px] px-2 py-0.5 select-a" data-id="${c.id}">A</button>
        <button class="btn-neon text-[10px] px-2 py-0.5 select-b" data-id="${c.id}">B</button>
      </div>
    </div>
  `).join('');

  // Event delegation
  grid.querySelectorAll('.select-a').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectChar('A', btn.dataset.id); });
  });
  grid.querySelectorAll('.select-b').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectChar('B', btn.dataset.id); });
  });
}

function selectChar(role, id) {
  const char = state.characters.find(c => c.id === id);
  if (!char) return;
  if (role === 'A') { state.selectedA = char; } else { state.selectedB = char; }
  updateCharDisplay();
  renderCharacters(getCurrentFilters());
  log('INFO', 'CHAR', `${role}: ${char.name_ru} (${char.compatibility})`);
}

function updateCharDisplay() {
  document.getElementById('char-a-name').textContent = state.selectedA ? `${state.selectedA.name_ru} (${state.selectedA.speech_pace}, мат ${state.selectedA.swear_level}/3)` : 'Не выбран';
  document.getElementById('char-b-name').textContent = state.selectedB ? `${state.selectedB.name_ru} (${state.selectedB.speech_pace}, мат ${state.selectedB.swear_level}/3)` : 'Не выбран';
  document.getElementById('sidebar-char-a').textContent = `A: ${state.selectedA?.name_ru || '—'}`;
  document.getElementById('sidebar-char-b').textContent = `B: ${state.selectedB?.name_ru || '—'}`;
  document.getElementById('gen-char-a').textContent = state.selectedA?.name_ru || '—';
  document.getElementById('gen-char-b').textContent = state.selectedB?.name_ru || '—';

  // Compatibility badge
  if (state.selectedA && state.selectedB) {
    const badge = document.getElementById('char-compat-badge');
    const combos = [state.selectedA.compatibility, state.selectedB.compatibility];
    let label = 'сбалансированная пара';
    if (combos.includes('chaotic') && combos.includes('calm')) label = '🔥 взрывная пара!';
    else if (combos.every(c => c === 'meme')) label = '😂 мем-пара';
    else if (combos.every(c => c === 'conflict')) label = '⚡ конфликт!';
    else if (combos.includes('chaotic')) label = '🌪 хаос!';
    badge.classList.remove('hidden');
    badge.querySelector('.tag').textContent = label;
  }
}

function getCurrentFilters() {
  return {
    search: document.getElementById('char-search')?.value || '',
    group: document.getElementById('char-group-filter')?.value || '',
    compat: document.getElementById('char-compat-filter')?.value || '',
  };
}

// ─── NAVIGATION ──────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const section = item.dataset.section;
      document.querySelectorAll('.section-panel').forEach(s => s.classList.add('hidden'));
      const target = document.getElementById(`section-${section}`);
      if (target) target.classList.remove('hidden');
      log('INFO', 'NAV', `→ ${section}`);
    });
  });
}

// ─── INPUT MODES ─────────────────────────────
function initModeSwitcher() {
  document.querySelectorAll('#section-remix .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#section-remix .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      state.inputMode = mode;
      document.getElementById('mode-idea').classList.toggle('hidden', mode !== 'idea');
      document.getElementById('mode-script').classList.toggle('hidden', mode !== 'script');
      document.getElementById('mode-video').classList.toggle('hidden', mode !== 'video');
      document.getElementById('gen-mode').textContent = mode;
      log('INFO', 'MODE', `Input mode: ${mode}`);
    });
  });
}

// ─── TOGGLES ─────────────────────────────────
function initToggles() {
  document.querySelectorAll('.toggle-track').forEach(track => {
    track.addEventListener('click', () => {
      track.classList.toggle('active');
      const opt = track.dataset.opt;
      if (opt && opt in state.options) {
        state.options[opt] = track.classList.contains('active');
        log('INFO', 'OPT', `${opt} = ${state.options[opt]}`);
      }
    });
  });
}

// ─── VIDEO UPLOAD ────────────────────────────
function initVideoUpload() {
  const dropzone = document.getElementById('video-dropzone');
  const fileInput = document.getElementById('video-file');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#00d4ff'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleVideoFile(fileInput.files[0]); });
}

function handleVideoFile(file) {
  if (!file.type.startsWith('video/')) { log('WARN', 'VIDEO', 'Not a video file'); return; }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    state.videoMeta = { duration: Math.round(video.duration * 100) / 100, size: file.size, name: file.name };
    const meta = document.getElementById('video-meta');
    meta.classList.remove('hidden');
    meta.innerHTML = `
      <div>📁 ${file.name}</div>
      <div>⏱ ${state.videoMeta.duration}s · ${(file.size / 1024 / 1024).toFixed(1)} MB</div>
    `;
    URL.revokeObjectURL(url);
    log('OK', 'VIDEO', `Loaded: ${file.name} (${state.videoMeta.duration}s)`);
  };
  video.src = url;
}

// ─── RANDOM HUMOR ────────────────────────────
function initHumor() {
  document.getElementById('humor-random')?.addEventListener('click', () => {
    const cat = getRandomCategory(Date.now().toString());
    state.category = cat;
    document.getElementById('humor-result').classList.remove('hidden');
    document.getElementById('humor-cat-ru').textContent = cat.ru;
    document.getElementById('humor-cat-en').textContent = cat.en;
    document.getElementById('gen-cat').textContent = cat.ru;
    log('OK', 'HUMOR', `Category: ${cat.ru} / ${cat.en}`);
  });
}

// ─── THREAD MEMORY ───────────────────────────
function initThread() {
  document.getElementById('thread-import')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        const data = JSON.parse(text);
        state.threadMessages = Array.isArray(data) ? data : data.messages || [];
        renderThreadMessages();
        log('OK', 'THREAD', `Imported ${state.threadMessages.length} messages`);
      } catch (e) { log('ERR', 'THREAD', `Import failed: ${e.message}`); }
    };
    input.click();
  });

  document.getElementById('thread-paste')?.addEventListener('click', () => {
    const text = prompt('Вставьте текст ветки (каждая строка = сообщение):');
    if (text) {
      state.threadMessages = text.split('\n').filter(l => l.trim()).map((l, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant', content: l.trim(), ts: Date.now() + i
      }));
      renderThreadMessages();
      log('OK', 'THREAD', `Pasted ${state.threadMessages.length} messages`);
    }
  });

  document.getElementById('thread-export')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.threadMessages, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'thread_export.json'; a.click();
    log('OK', 'THREAD', 'Exported');
  });

  document.getElementById('thread-clear')?.addEventListener('click', () => {
    state.threadMessages = []; state.threadMemory = '';
    renderThreadMessages();
    document.getElementById('thread-memory-output').classList.add('hidden');
    log('INFO', 'THREAD', 'Cleared');
  });

  document.getElementById('thread-compile')?.addEventListener('click', () => {
    const n = parseInt(document.getElementById('thread-last-n')?.value || '10');
    const msgs = state.threadMessages.slice(-n);
    if (msgs.length === 0) { log('WARN', 'THREAD', 'No messages to compile'); return; }
    const memory = msgs.map(m => `[${m.role}] ${m.content}`).join('\n');
    state.threadMemory = `STYLE_MEMORY (${msgs.length} msgs):\n${memory}`;
    document.getElementById('thread-memory-output').classList.remove('hidden');
    document.getElementById('thread-memory-text').textContent = state.threadMemory;
    log('OK', 'THREAD', `Compiled memory from ${msgs.length} messages`);
  });
}

function renderThreadMessages() {
  const el = document.getElementById('thread-messages');
  if (state.threadMessages.length === 0) {
    el.innerHTML = '<div class="text-xs text-gray-600 font-mono">Пусто. Импортируйте ветку или вставьте текст.</div>';
    return;
  }
  el.innerHTML = state.threadMessages.map(m => `
    <div class="flex gap-2 text-xs">
      <span class="font-mono ${m.role === 'user' ? 'neon-text' : 'neon-text-purple'} flex-shrink-0">${m.role === 'user' ? 'USR' : 'BOT'}</span>
      <span class="text-gray-400">${m.content}</span>
    </div>
  `).join('');
}

// ─── GENERATE ────────────────────────────────
function initGenerate() {
  document.getElementById('btn-generate')?.addEventListener('click', () => {
    if (!state.selectedA || !state.selectedB) {
      log('WARN', 'GEN', 'Выберите двух персонажей!');
      return;
    }

    log('INFO', 'GEN', 'Generating package...');

    const input = {
      input_mode: state.inputMode,
      character1_id: state.selectedA.id,
      character2_id: state.selectedB.id,
      context_ru: document.getElementById('idea-input')?.value || '',
      script_ru: state.inputMode === 'script' ? {
        A: document.getElementById('script-a')?.value || '',
        B: document.getElementById('script-b')?.value || ''
      } : null,
      scene_hint_ru: document.getElementById('scene-hint')?.value || null,
      category: state.category,
      thread_memory: state.threadMemory || null,
      video_meta: state.videoMeta,
      options: state.options,
      seed: Date.now().toString(),
      characters: state.characters,
    };

    const result = generate(input);
    state.lastResult = result;

    if (result.error) {
      log('ERR', 'GEN', result.error);
      return;
    }

    // Show results
    document.getElementById('gen-results').classList.remove('hidden');
    document.querySelector('#tab-photo pre').textContent = JSON.stringify(result.photo_prompt_en_json, null, 2);
    document.querySelector('#tab-video pre').textContent = JSON.stringify(result.video_prompt_en_json, null, 2);
    document.querySelector('#tab-ru pre').textContent = result.ru_package;
    document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(result.blueprint_json, null, 2);
    document.querySelector('#tab-log pre').textContent = JSON.stringify(result.log, null, 2);

    // Warnings
    if (result.warnings.length > 0) {
      document.getElementById('gen-warnings').classList.remove('hidden');
      document.getElementById('gen-warnings-list').innerHTML = result.warnings.map(w => `<div class="text-xs">⚠️ ${w}</div>`).join('');
    } else {
      document.getElementById('gen-warnings').classList.add('hidden');
    }

    // Update timing
    updateTimingCoach(result);

    log('OK', 'GEN', `Package generated! Duration: ${result.duration_estimate.total}s, Risk: ${result.duration_estimate.risk}`);
    if (result.auto_fixes.length > 0) {
      result.auto_fixes.forEach(f => log('INFO', 'FIX', f));
    }
  });

  // Result tabs
  document.querySelectorAll('#gen-results .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#gen-results .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      ['photo', 'video', 'ru', 'blueprint', 'log'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
      });
    });
  });
}

// ─── TIMING COACH ────────────────────────────
function updateTimingCoach(result) {
  if (!result || !result.duration_estimate) return;
  const est = result.duration_estimate;
  const el = document.getElementById('timing-estimate');

  const riskColor = { low: 'neon-text-green', medium: 'text-yellow-400', high: 'neon-text-pink' }[est.risk];
  const riskLabel = { low: '✓ ОК', medium: '⚠️ БЛИЗКО', high: '🚨 ПРЕВЫШЕНИЕ' }[est.risk];

  el.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-mono text-gray-500">ОЦЕНКА ДЛИТЕЛЬНОСТИ</span>
      <span class="text-sm font-bold font-mono ${riskColor}">${est.total}s / 8.0s ${riskLabel}</span>
    </div>
    ${est.perLine.map(l => `
      <div class="flex items-center gap-2 text-xs">
        <span class="font-mono ${l.speaker === 'A' ? 'neon-text' : 'neon-text-purple'} w-4">${l.speaker}</span>
        <div class="flex-1 bg-glass rounded h-4 overflow-hidden">
          <div class="h-full ${l.duration > 4 ? 'bg-red-500/30' : l.speaker === 'A' ? 'bg-blue-500/20' : 'bg-purple-500/20'} rounded" style="width:${Math.min(100, (l.duration / 8) * 100)}%"></div>
        </div>
        <span class="font-mono text-gray-500 w-12 text-right">${l.duration}s</span>
        <span class="text-gray-600 w-8">${l.wordCount}w</span>
      </div>
    `).join('')}
    ${est.notes.map(n => `<div class="text-xs text-yellow-400/80 mt-1">📝 ${n}</div>`).join('')}
  `;

  // Update bar colors
  if (est.risk === 'high') {
    document.querySelector('.timing-b')?.classList.add('timing-over');
  } else {
    document.querySelector('.timing-b')?.classList.remove('timing-over');
  }

  // Trimming suggestions
  if (est.trimming_suggestions.length > 0) {
    const sugEl = document.getElementById('timing-suggestions');
    sugEl.classList.remove('hidden');
    document.getElementById('timing-suggestions-list').innerHTML = est.trimming_suggestions.map(s =>
      `<div class="text-xs text-gray-400 glass-panel p-2">💡 ${s}</div>`
    ).join('');
    document.getElementById('timing-auto-trim').disabled = false;
  }
}

function initTimingCoach() {
  document.getElementById('timing-auto-trim')?.addEventListener('click', () => {
    if (!state.lastResult) return;
    const bp = state.lastResult.blueprint_json;
    if (!bp) return;

    const lines = bp.dialogue_segments.map(s => ({
      speaker: s.speaker,
      text: s.text_ru,
      pace: s.speaker === 'A' ? state.selectedA?.speech_pace : state.selectedB?.speech_pace
    }));

    const trimResult = autoTrim(lines);
    if (trimResult.trimmed) {
      trimResult.auto_fixes.forEach(f => log('OK', 'TRIM', f));
      log('OK', 'TRIM', `New estimate: ${trimResult.estimate.total}s (was ${state.lastResult.duration_estimate.total}s)`);
      state.lastResult.duration_estimate = trimResult.estimate;
      state.lastResult.auto_fixes.push(...trimResult.auto_fixes);
      updateTimingCoach(state.lastResult);
    } else {
      log('INFO', 'TRIM', 'Нечего сокращать автоматически');
    }
  });

  document.getElementById('timing-highlight')?.addEventListener('click', () => {
    log('INFO', 'TIMING', 'Ударные слова подсвечены в RU Package');
    // Highlight killer word in ru_package display
    if (state.lastResult) {
      const pre = document.querySelector('#tab-ru pre');
      if (pre) {
        let text = pre.textContent;
        const kw = state.lastResult.blueprint_json?.timing_grid?.killer_word_at;
        if (kw) {
          text = text.replace(/KILLER WORD «([^»]+)»/, 'KILLER WORD «<mark style="background:rgba(255,0,110,0.3);color:#ff006e">$1</mark>»');
          pre.innerHTML = text;
        }
      }
    }
  });
}

// ─── SETTINGS ────────────────────────────────
function initSettings() {
  document.querySelectorAll('#section-settings .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#section-settings .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settingsMode = btn.dataset.setting;
      document.getElementById('api-settings').classList.toggle('hidden', btn.dataset.setting !== 'api');
      document.getElementById('header-mode').textContent = btn.dataset.setting === 'demo' ? 'DEMO' : 'API';
      log('INFO', 'SETTINGS', `Mode: ${btn.dataset.setting}`);
    });
  });

  document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
    historyCache.clear();
    updateCacheStats();
    log('OK', 'CACHE', 'History cache cleared');
  });
}

function updateCacheStats() {
  const stats = historyCache.getStats();
  const el = document.getElementById('cache-stats');
  if (el) el.textContent = `Лок: ${stats.locations} | Рекв: ${stats.props} | Одежда: ${stats.wardrobes}`;
}

// ─── LOGOUT ──────────────────────────────────
function initLogout() {
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('ferixdi_access');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('access-gate').classList.remove('hidden');
    document.getElementById('access-key-input').value = '';
    document.getElementById('access-status').innerHTML = '';
    log('INFO', 'AUTH', 'Logged out');
  });
}

// ─── CHAR FILTERS ────────────────────────────
function initCharFilters() {
  document.getElementById('char-search')?.addEventListener('input', () => renderCharacters(getCurrentFilters()));
  document.getElementById('char-group-filter')?.addEventListener('change', () => renderCharacters(getCurrentFilters()));
  document.getElementById('char-compat-filter')?.addEventListener('change', () => renderCharacters(getCurrentFilters()));
  document.getElementById('char-swap')?.addEventListener('click', () => {
    [state.selectedA, state.selectedB] = [state.selectedB, state.selectedA];
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'CHAR', 'Swapped A ⇄ B');
  });
}

// ─── LOG CONSOLE ─────────────────────────────
function initLogConsole() {
  document.getElementById('log-clear')?.addEventListener('click', () => {
    document.getElementById('log-output').innerHTML = '';
  });
}

// ─── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAccessGate();
  initNavigation();
  initModeSwitcher();
  initToggles();
  initVideoUpload();
  initHumor();
  initThread();
  initGenerate();
  initTimingCoach();
  initSettings();
  initLogout();
  initCharFilters();
  initLogConsole();
});
