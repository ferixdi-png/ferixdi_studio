/**
 * FERIXDI Studio — Main Application
 * Космический хакерский командный центр для ремикса видео
 */

import { generate, getRandomCategory, mergeGeminiResult } from './engine/generator.js';
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
  videoMeta: null,
  productInfo: null, // { image_base64, mime_type, description_en }
  options: { enforce8s: true, preserveRhythm: true, strictLipSync: true, allowAutoTrim: false },
  lastResult: null,
  settingsMode: 'demo',
};

// ─── LOG ─────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function log(level, module, msg) {
  const el = document.getElementById('log-output');
  if (!el) return;
  // Show log panel on first message
  const panel = document.getElementById('log-panel');
  if (panel?.classList.contains('hidden')) panel.classList.remove('hidden');
  const ts = new Date().toLocaleTimeString('ru-RU');
  const cls = { INFO: 'log-info', WARN: 'log-warn', ERR: 'log-err', OK: 'log-ok' }[level] || 'log-info';
  el.innerHTML += `<div class="${cls}">[${ts}] ${escapeHtml(module)}: ${escapeHtml(msg)}</div>`;
  el.scrollTop = el.scrollHeight;
  // Limit log size to prevent memory leak
  while (el.children.length > 200) el.removeChild(el.firstChild);
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
      if (data.accessGranted) {
        unlockApp(data.label || 'user');
        return;
      }
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
        localStorage.setItem('ferixdi_access', JSON.stringify({ accessGranted: true, ts: Date.now(), keyHash: hash, label: match.label }));
        status.innerHTML = `<span class="neon-text-green">✓ Доступ открыт. Привет, ${match.label}!</span>`;
        setTimeout(() => unlockApp(match.label), 600);
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

function unlockApp(label) {
  document.getElementById('access-gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  // Show user label in header
  const modeEl = document.getElementById('header-mode');
  if (modeEl && label) modeEl.textContent = label.toUpperCase();
  log('OK', 'SYSTEM', `FERIXDI Studio v2.0 — welcome, ${label || 'user'}`);
  loadCharacters();
  updateCacheStats();
  navigateTo('characters');
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

  grid.innerHTML = chars.map(c => {
    const isA = state.selectedA?.id === c.id;
    const isB = state.selectedB?.id === c.id;
    const selCls = isA ? 'selected ring-2 ring-violet-500' : isB ? 'selected ring-2 ring-indigo-500' : '';
    const tagCls = c.compatibility === 'meme' ? 'tag-green' : c.compatibility === 'conflict' ? 'tag-pink' : c.compatibility === 'chaotic' ? 'tag-orange' : c.compatibility === 'calm' ? '' : 'tag-purple';

    // Detail sections
    const anchors = c.identity_anchors || {};
    const sigWords = (c.signature_words_ru || []).join(', ');
    const promptEn = c.prompt_tokens?.character_en || '';

    return `
    <div class="char-card ${selCls}" data-id="${c.id}">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-sm font-semibold text-white">${c.name_ru}</span>
        <span class="tag text-[10px] ${tagCls}">${c.compatibility}</span>
      </div>
      <div class="text-[11px] text-gray-400 mb-2">${c.group} · ${c.speech_pace} · мат ${c.swear_level}/3</div>

      <!-- Select buttons -->
      <div class="flex gap-1.5 mb-2">
        <button class="select-a text-[11px] px-3 py-1 rounded-md font-medium transition-all ${isA ? 'bg-violet-600 text-white' : 'bg-violet-600/10 text-violet-300 hover:bg-violet-600/25'}" data-id="${c.id}">A · провокатор</button>
        <button class="select-b text-[11px] px-3 py-1 rounded-md font-medium transition-all ${isB ? 'bg-indigo-600 text-white' : 'bg-indigo-600/10 text-indigo-300 hover:bg-indigo-600/25'}" data-id="${c.id}">B · панчлайн</button>
      </div>

      <!-- Expandable detail -->
      <details class="group">
        <summary class="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">Подробнее ▸</summary>
        <div class="mt-2 space-y-2.5 text-[11px] border-t border-gray-800/60 pt-2.5">

          ${c.vibe_archetype ? `<div><span class="text-violet-400 font-medium">Архетип:</span> <span class="text-gray-300">${c.vibe_archetype}</span></div>` : ''}

          ${anchors.face_silhouette ? `<div><span class="text-violet-400 font-medium">Лицо:</span> <span class="text-gray-300">${anchors.face_silhouette}</span></div>` : ''}

          ${anchors.signature_element ? `<div><span class="text-violet-400 font-medium">Фишка:</span> <span class="text-gray-300">${anchors.signature_element}</span></div>` : ''}

          ${anchors.micro_gesture ? `<div><span class="text-violet-400 font-medium">Жест:</span> <span class="text-gray-300">${anchors.micro_gesture}</span></div>` : ''}

          ${anchors.wardrobe_anchor ? `<div><span class="text-violet-400 font-medium">Одежда:</span> <span class="text-gray-300">${anchors.wardrobe_anchor}</span></div>` : ''}

          ${sigWords ? `<div><span class="text-violet-400 font-medium">Словечки:</span> <span class="text-gray-300">«${sigWords}»</span></div>` : ''}

          ${c.modifiers?.hook_style ? `<div><span class="text-violet-400 font-medium">Хук:</span> <span class="text-gray-300">${c.modifiers.hook_style}</span></div>` : ''}
          ${c.modifiers?.laugh_style ? `<div><span class="text-violet-400 font-medium">Смех:</span> <span class="text-gray-300">${c.modifiers.laugh_style}</span></div>` : ''}

          ${promptEn ? `
          <div class="mt-2">
            <div class="text-violet-400 font-medium mb-1">Промпт для генерации (EN):</div>
            <div class="text-[10px] text-gray-400 leading-relaxed bg-black/30 rounded-lg p-2.5 select-all">${promptEn}</div>
          </div>` : ''}

          <div class="mt-1">
            <div class="text-violet-400 font-medium mb-1">Внешность (RU):</div>
            <div class="text-[10px] text-gray-400 leading-relaxed">${c.appearance_ru}</div>
          </div>
        </div>
      </details>
    </div>`;
  }).join('');

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
  document.getElementById('char-a-name').textContent = state.selectedA ? `${state.selectedA.name_ru} • ${state.selectedA.group}` : 'Нажми на персонажа ↓';
  document.getElementById('char-b-name').textContent = state.selectedB ? `${state.selectedB.name_ru} • ${state.selectedB.group}` : 'Нажми на второго ↓';
  document.getElementById('sidebar-char-a').innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-violet-500/60 inline-block"></span>A: ${state.selectedA?.name_ru || '—'}`;
  document.getElementById('sidebar-char-b').innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-indigo-500/60 inline-block"></span>B: ${state.selectedB?.name_ru || '—'}`;
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

  // Show/hide "Далее" button
  const goBtn = document.getElementById('btn-go-generate');
  if (goBtn) {
    if (state.selectedA && state.selectedB) {
      goBtn.classList.remove('hidden');
    } else {
      goBtn.classList.add('hidden');
    }
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
function navigateTo(section) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('.section-panel').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.remove('hidden');
  // Scroll workspace to top
  document.getElementById('workspace')?.scrollTo(0, 0);
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.section);
    });
  });

  // "Далее" button on step 1 → go to step 2
  document.getElementById('btn-go-generate')?.addEventListener('click', () => {
    navigateTo('generate');
  });

  // "← Сменить персонажей" on step 2 → go back to step 1
  document.getElementById('gen-back-chars')?.addEventListener('click', () => {
    navigateTo('characters');
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

// ─── VIDEO URL FETCH (TikTok / Instagram) ───
function initVideoUrlFetch() {
  const btn = document.getElementById('video-url-fetch');
  const input = document.getElementById('video-url-input');
  if (!btn || !input) return;

  btn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) { showVideoStatus('Вставьте ссылку на видео', 'text-red-400'); return; }
    if (!url.includes('tiktok.com') && !url.includes('instagram.com')) {
      showVideoStatus('Поддерживаются только TikTok и Instagram ссылки', 'text-red-400');
      return;
    }

    showVideoStatus('⏳ Загружаю...', 'text-gray-400');
    btn.disabled = true;
    log('INFO', 'VIDEO', `Fetching: ${url}`);

    try {
      // Determine API base (same origin on Render, localhost in dev)
      const apiBase = window.location.origin;
      const resp = await fetch(`${apiBase}/api/video/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        showVideoStatus(`❌ ${data.error || 'Ошибка'}`, 'text-red-400');
        log('ERR', 'VIDEO', data.error || 'Fetch failed');
        return;
      }

      // Show result
      const resultEl = document.getElementById('video-url-result');
      resultEl.classList.remove('hidden');

      // Cover
      const coverEl = document.getElementById('video-url-cover');
      if (data.cover) { coverEl.src = data.cover; coverEl.classList.remove('hidden'); }
      else { coverEl.classList.add('hidden'); }

      // Meta
      document.getElementById('video-url-title').textContent = data.title || 'Без названия';
      document.getElementById('video-url-author').textContent = `@${data.author || 'unknown'} · ${data.platform}`;
      const metaParts = [];
      if (data.duration) metaParts.push(`${data.duration}s`);
      if (data.width && data.height) metaParts.push(`${data.width}×${data.height}`);
      if (data.music) metaParts.push(`🎵 ${data.music}`);
      document.getElementById('video-url-meta').textContent = metaParts.join(' · ') || '';

      // Download link
      const dlLink = document.getElementById('video-url-download');
      if (data.video_url) {
        dlLink.href = data.video_url;
        dlLink.classList.remove('hidden');
        showVideoStatus('✅ Видео найдено!', 'neon-text-green');
      } else {
        dlLink.classList.add('hidden');
        showVideoStatus(data.note || '⚠️ Прямая ссылка недоступна', 'text-yellow-400');
      }

      // Save to state for generation
      state.videoMeta = {
        platform: data.platform,
        url: url,
        title: data.title,
        author: data.author,
        duration: data.duration,
        width: data.width,
        height: data.height,
      };

      log('OK', 'VIDEO', `${data.platform}: ${data.title || 'video'} (${data.duration || '?'}s)`);

    } catch (e) {
      showVideoStatus(`❌ Сетевая ошибка: ${e.message}`, 'text-red-400');
      log('ERR', 'VIDEO', e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Enter key
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

function showVideoStatus(text, cls) {
  const el = document.getElementById('video-url-status');
  if (!el) return;
  el.classList.remove('hidden');
  el.className = `text-xs ${cls}`;
  el.textContent = text;
}

function showGenStatus(text, cls) {
  let el = document.getElementById('gen-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gen-status';
    const btn = document.getElementById('btn-generate');
    if (btn) btn.parentNode.insertBefore(el, btn);
  }
  el.className = `text-sm text-center py-2 ${cls}`;
  el.textContent = text;
}

// ─── PRODUCT PHOTO UPLOAD ───────────────────
function initProductUpload() {
  const dropzone = document.getElementById('product-dropzone');
  const fileInput = document.getElementById('product-file');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'rgba(139,92,246,0.5)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handleProductFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleProductFile(fileInput.files[0]); });

  // Clear button
  document.getElementById('product-clear')?.addEventListener('click', () => {
    state.productInfo = null;
    document.getElementById('product-result').classList.add('hidden');
    document.getElementById('product-preview').classList.add('hidden');
    document.getElementById('product-status').classList.add('hidden');
    document.getElementById('product-preview-zone').innerHTML = `
      <div class="text-2xl mb-1">📦</div>
      <div class="text-xs text-gray-500">Перетащи фото или нажми</div>
      <div class="text-[10px] text-gray-600 mt-1">JPG, PNG, WebP</div>
    `;
    fileInput.value = '';
  });
}

async function handleProductFile(file) {
  if (!file.type.startsWith('image/')) {
    showProductStatus('Нужно фото (JPG, PNG, WebP)', 'text-red-400');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showProductStatus('Файл слишком большой (макс. 10 МБ)', 'text-red-400');
    return;
  }

  // Show preview
  const previewEl = document.getElementById('product-preview');
  const imgEl = document.getElementById('product-preview-img');
  const reader = new FileReader();

  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    imgEl.src = dataUrl;
    previewEl.classList.remove('hidden');

    // Shrink dropzone text
    document.getElementById('product-preview-zone').innerHTML = `
      <div class="text-xs text-emerald-400">✓ ${file.name}</div>
      <div class="text-[10px] text-gray-500 mt-1">${(file.size / 1024).toFixed(0)} КБ</div>
    `;

    // Extract base64 (remove data:image/...;base64, prefix)
    const base64 = dataUrl.split(',')[1];
    const mimeType = file.type;

    showProductStatus('⏳ Gemini анализирует товар...', 'text-gray-400');

    try {
      const apiBase = window.location.origin;
      const resp = await fetch(`${apiBase}/api/product/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, mime_type: mimeType }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        showProductStatus(`❌ ${data.error || 'Ошибка'}`, 'text-red-400');
        return;
      }

      // Save to state
      state.productInfo = {
        image_base64: base64,
        mime_type: mimeType,
        description_en: data.description_en,
      };

      // Show description
      document.getElementById('product-result').classList.remove('hidden');
      document.getElementById('product-description').textContent = data.description_en;
      document.getElementById('product-tokens').textContent = data.tokens ? `${data.tokens} токенов · ${data.model}` : '';
      showProductStatus('', 'hidden');

    } catch (e) {
      showProductStatus(`❌ Сетевая ошибка: ${e.message}`, 'text-red-400');
    }
  };

  reader.readAsDataURL(file);
}

function showProductStatus(text, cls) {
  const el = document.getElementById('product-status');
  if (!el) return;
  el.classList.remove('hidden');
  el.className = `text-xs ${cls}`;
  el.textContent = text;
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

// ─── GENERATE ────────────────────────────────
function displayResult(result) {
  state.lastResult = result;

  if (result.error) {
    showGenStatus(`❌ ${result.error}`, 'text-red-400');
    log('ERR', 'GEN', result.error);
    return;
  }

  // Show results
  document.getElementById('gen-results').classList.remove('hidden');
  document.querySelector('#tab-photo pre').textContent = JSON.stringify(result.photo_prompt_en_json, null, 2);
  document.querySelector('#tab-video pre').textContent = JSON.stringify(result.video_prompt_en_json, null, 2);
  document.querySelector('#tab-ru pre').textContent = result.ru_package;
  document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(result.blueprint_json, null, 2);
  showGenStatus('', 'hidden');
  document.getElementById('gen-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Warnings
  if (result.warnings?.length > 0) {
    document.getElementById('gen-warnings').classList.remove('hidden');
    document.getElementById('gen-warnings-list').innerHTML = result.warnings.map(w => `<div class="text-xs">⚠️ ${escapeHtml(w)}</div>`).join('');
  } else {
    document.getElementById('gen-warnings')?.classList.add('hidden');
  }

  // QC Gate v2
  if (result.qc_gate) {
    const qc = result.qc_gate;
    const qcEl = document.getElementById('gen-qc-gate');
    if (qcEl) {
      qcEl.classList.remove('hidden');
      qcEl.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs text-gray-500">Контроль качества</span>
          <span class="text-sm font-bold ${qc.ok ? 'neon-text-green' : 'neon-text-pink'}">${qc.passed}/${qc.total} ${qc.ok ? '✓ ОК' : '✗ ПРОБЛЕМЫ'}</span>
        </div>
        ${qc.details.map(c => `
          <div class="flex items-center gap-2 text-xs">
            <span class="${c.pass ? 'text-green-500' : c.hard ? 'text-red-500 font-bold' : 'text-yellow-500'}">${c.pass ? '✓' : '✗'}</span>
            <span class="text-gray-400">${c.name}${c.hard && !c.pass ? ' [HARD FAIL]' : ''}</span>
          </div>
        `).join('')}
      `;
    }
    if (qc.ok) {
      log('OK', 'QC', `PASS ${qc.passed}/${qc.total}`);
    } else {
      log('WARN', 'QC', `FAIL ${qc.passed}/${qc.total}${qc.hard_fails.length ? ', HARD: ' + qc.hard_fails.join(', ') : ''}`);
    }
  }

  // Update timing
  updateTimingCoach(result);

  const ver = result.log?.generator_version || '2.0';
  log('OK', 'GEN', `${ver} Package generated! Duration: ${result.duration_estimate?.total || '?'}s, Risk: ${result.duration_estimate?.risk || '?'}`);
  if (result.auto_fixes?.length > 0) {
    result.auto_fixes.forEach(f => log('INFO', 'FIX', f));
  }
}

async function callGeminiAPI(apiContext) {
  const token = localStorage.getItem('ferixdi_jwt');
  const apiUrl = localStorage.getItem('ferixdi_api_url') || '';
  if (!apiUrl || !token) return null;

  const resp = await fetch(`${apiUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ context: apiContext }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `API error ${resp.status}`);
  }

  const data = await resp.json();
  return data.gemini;
}

function initGenerate() {
  document.getElementById('btn-generate')?.addEventListener('click', async () => {
    if (!state.selectedA || !state.selectedB) {
      showGenStatus('⚠️ Сначала выбери двух персонажей на шаге 1', 'text-orange-400');
      return;
    }

    // Check that there's at least some input for the selected mode
    if (state.inputMode === 'idea' && !document.getElementById('idea-input')?.value.trim()) {
      showGenStatus('⚠️ Опиши идею в текстовом поле выше', 'text-orange-400');
      return;
    }
    if (state.inputMode === 'script') {
      const scriptA = document.getElementById('script-a')?.value.trim();
      const scriptB = document.getElementById('script-b')?.value.trim();
      if (!scriptA && !scriptB) {
        showGenStatus('⚠️ Напиши хотя бы одну реплику (A или B)', 'text-orange-400');
        return;
      }
    }

    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = '⏳ Генерирую...';

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
      thread_memory: null,
      video_meta: state.videoMeta,
      product_info: state.productInfo,
      options: state.options,
      seed: Date.now().toString(),
      characters: state.characters,
    };

    // Step 1: Local generation (instant, structural template)
    let localResult;
    try {
      localResult = generate(input);
    } catch (e) {
      showGenStatus(`❌ Ошибка генерации: ${e.message}`, 'text-red-400');
      log('ERR', 'GEN', e.message);
      btn.disabled = false;
      btn.textContent = '🚀 Сгенерировать';
      return;
    }

    if (localResult.error) {
      displayResult(localResult);
      btn.disabled = false;
      btn.textContent = '🚀 Сгенерировать';
      return;
    }

    // Step 2: If API mode — send context to Gemini for creative refinement
    const isApiMode = state.settingsMode === 'api' && localStorage.getItem('ferixdi_api_url');

    if (isApiMode && localResult._apiContext) {
      showGenStatus('🤖 Gemini дорабатывает контент...', 'text-violet-400');
      log('INFO', 'GEMINI', 'Sending context to Gemini API...');

      try {
        const geminiData = await callGeminiAPI(localResult._apiContext);
        if (geminiData) {
          const merged = mergeGeminiResult(localResult, geminiData);
          log('OK', 'GEMINI', 'Creative content merged from Gemini');
          displayResult(merged);
        } else {
          log('WARN', 'GEMINI', 'API not configured, using local generation');
          displayResult(localResult);
        }
      } catch (apiErr) {
        log('WARN', 'GEMINI', `API failed: ${apiErr.message}. Fallback to local.`);
        showGenStatus('⚠️ Gemini недоступен — используется локальная генерация', 'text-yellow-400');
        await new Promise(r => setTimeout(r, 1500));
        displayResult(localResult);
      }
    } else {
      // Demo mode: use local generation directly
      displayResult(localResult);
    }

    btn.disabled = false;
    btn.textContent = '🚀 Сгенерировать';
  });

  // Result tabs
  document.querySelectorAll('#gen-results .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#gen-results .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      ['photo', 'video', 'ru', 'blueprint'].forEach(t => {
        document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== tab);
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
      <span class="text-xs text-gray-500">Оценка длительности</span>
      <span class="text-sm font-bold ${riskColor}">${est.total}с / 8.0с ${riskLabel}</span>
    </div>
    ${est.perLine.map(l => `
      <div class="flex items-center gap-2 text-xs">
        <span class="font-medium ${l.speaker === 'A' ? 'neon-text' : 'neon-text-purple'} w-4">${l.speaker}</span>
        <div class="flex-1 bg-glass rounded h-4 overflow-hidden relative">
          <div class="h-full ${l.overWindow ? 'bg-red-500/40' : l.speaker === 'A' ? 'bg-blue-500/20' : 'bg-purple-500/20'} rounded" style="width:${Math.min(100, (l.duration / (l.window || 3)) * 100)}%"></div>
          ${l.window ? `<div class="absolute top-0 h-full border-r border-dashed border-yellow-500/50" style="left:100%"></div>` : ''}
        </div>
        <span class="${l.overWindow ? 'text-red-400' : 'text-gray-500'} w-16 text-right">${l.duration}с/${l.window || '?'}с</span>
        <span class="text-gray-600 w-8">${l.wordCount}w</span>
      </div>
    `).join('')}
    ${est.notes.map(n => `<div class="text-xs ${n.includes('НЕ ВЛЕЗЕТ') ? 'text-red-400' : 'text-yellow-400/80'} mt-1">📝 ${n}</div>`).join('')}
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
          // Escape HTML entities before setting innerHTML to prevent XSS
          text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          text = text.replace(/KILLER WORD «([^»]+)»/, 'KILLER WORD «<mark style="background:rgba(255,0,110,0.3);color:#ff006e">$1</mark>»');
          pre.innerHTML = text;
        }
      }
    }
  });
}

// ─── COPY TO CLIPBOARD ──────────────────────
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      const pre = document.querySelector(`#tab-${tab} pre`);
      if (!pre) return;
      const text = pre.textContent || pre.innerText;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Скопировано!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        log('OK', 'COPY', `${tab} prompt copied to clipboard`);
      }).catch(() => {
        log('WARN', 'COPY', 'Clipboard access denied');
      });
    });
  });
}

// ─── SETTINGS ────────────────────────────────
function initSettings() {
  // Restore saved API URL
  const savedApiUrl = localStorage.getItem('ferixdi_api_url');
  if (savedApiUrl) {
    const urlInput = document.getElementById('api-url');
    if (urlInput) urlInput.value = savedApiUrl;
  }

  document.querySelectorAll('#section-settings .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#section-settings .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settingsMode = btn.dataset.setting;
      document.getElementById('api-settings')?.classList.toggle('hidden', btn.dataset.setting !== 'api');
      document.getElementById('header-mode').textContent = btn.dataset.setting === 'api' ? 'API' : 'DEMO';
      log('INFO', 'SETTINGS', `Mode: ${btn.dataset.setting}`);
    });
  });

  // Save API URL on change and auto-authenticate
  document.getElementById('api-url')?.addEventListener('change', async (e) => {
    const url = e.target.value.trim().replace(/\/+$/, '');
    if (!url) {
      localStorage.removeItem('ferixdi_api_url');
      localStorage.removeItem('ferixdi_jwt');
      return;
    }
    localStorage.setItem('ferixdi_api_url', url);
    log('INFO', 'API', `Backend URL saved: ${url}`);

    // Auto-authenticate against server using the saved access key
    const savedAccess = localStorage.getItem('ferixdi_access');
    if (savedAccess) {
      try {
        const { keyHash } = JSON.parse(savedAccess);
        if (keyHash) {
          log('INFO', 'API', 'Authenticating with server...');
          const resp = await fetch(`${url}/api/auth/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: keyHash }),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.jwt) {
              localStorage.setItem('ferixdi_jwt', data.jwt);
              log('OK', 'API', `Authenticated! Token received for: ${data.label}`);
            }
          } else {
            log('WARN', 'API', 'Server auth failed — check URL and key');
          }
        }
      } catch (err) {
        log('WARN', 'API', `Cannot reach server: ${err.message}`);
      }
    }
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

// ─── HEADER SETTINGS BUTTON ─────────────────
function initHeaderSettings() {
  document.getElementById('btn-settings')?.addEventListener('click', () => navigateTo('settings'));
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

// ─── LOG PANEL TOGGLE ─────────────────────
function initLogPanel() {
  document.getElementById('log-toggle')?.addEventListener('click', () => {
    const output = document.getElementById('log-output');
    const icon = document.getElementById('log-toggle-icon');
    if (!output) return;
    const collapsed = output.style.display === 'none';
    output.style.display = collapsed ? '' : 'none';
    if (icon) icon.textContent = collapsed ? '▼' : '▲';
  });
}

// ─── INIT ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAccessGate();
  initNavigation();
  initModeSwitcher();
  initToggles();
  initVideoUpload();
  initVideoUrlFetch();
  initProductUpload();
  initHumor();
  initGenerate();
  initTimingCoach();
  initSettings();
  initLogout();
  initCharFilters();
  initCopyButtons();
  initHeaderSettings();
  initLogPanel();
});
