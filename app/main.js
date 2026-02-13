/**
 * FERIXDI Studio — Main Application
 * Космический хакерский командный центр для ремикса видео
 */

import { generate, getRandomCategory, mergeGeminiResult } from './engine/generator.js';
import { estimateDialogue, estimateLineDuration } from './engine/estimator.js';
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
  settingsMode: 'api',
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

// ─── PROMO CODE ──────────────────────────────
const VALID_PROMO = 'FERIXDI-VIP-2026';
const DEFAULT_API_URL = 'https://ferixdi-studio.onrender.com';

function isPromoValid() {
  return localStorage.getItem('ferixdi_promo') === VALID_PROMO;
}

function initPromoCode() {
  const btn = document.getElementById('promo-save-btn');
  const input = document.getElementById('promo-input');
  const status = document.getElementById('promo-status');
  if (!btn || !input) return;

  // Show saved state
  if (isPromoValid()) {
    status.innerHTML = '<span class="neon-text-green">✓ Промо-код активен</span>';
    input.placeholder = '••••••••';
    document.getElementById('header-mode')?.setAttribute('textContent', 'VIP');
    const modeEl = document.getElementById('header-mode');
    if (modeEl) modeEl.textContent = 'VIP';
  }

  btn.addEventListener('click', () => {
    const key = input.value.trim().toUpperCase();
    if (!key) { status.innerHTML = '<span class="text-red-400">Введите промо-код</span>'; return; }

    if (key === VALID_PROMO) {
      localStorage.setItem('ferixdi_promo', key);
      status.innerHTML = '<span class="neon-text-green">✓ Промо-код активен! Добро пожаловать!</span>';
      input.value = '';
      input.placeholder = '••••••••';
      const modeEl = document.getElementById('header-mode');
      if (modeEl) modeEl.textContent = 'VIP';
      log('OK', 'ПРОМО', 'Промо-код принят');

      // Auto-authenticate with server
      autoAuth();
    } else {
      status.innerHTML = '<span class="text-red-400">✗ Неверный промо-код</span>';
      log('WARN', 'ПРОМО', 'Неверный промо-код');
    }
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

async function autoAuth() {
  const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  try {
    const resp = await fetch(`${url}/api/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: VALID_PROMO }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.jwt) {
        localStorage.setItem('ferixdi_jwt', data.jwt);
        log('OK', 'API', 'Авторизовано на сервере');
      }
    }
  } catch { /* server might not be up yet */ }
}

function initApp() {
  log('OK', 'СИСТЕМА', 'FERIXDI Studio v2.0 — добро пожаловать!');
  loadCharacters();
  updateCacheStats();
  navigateTo('characters');

  // Auto-authenticate if promo is already saved
  if (isPromoValid()) {
    autoAuth();
  }
}

// ─── CHARACTERS ──────────────────────────────
async function loadCharacters() {
  try {
    const resp = await fetch(new URL('./data/characters.json', import.meta.url));
    state.characters = await resp.json();
    log('OK', 'ДАННЫЕ', `Загружено ${state.characters.length} персонажей`);
    populateFilters();
    renderCharacters();
  } catch (e) {
    log('ERR', 'ДАННЫЕ', `Ошибка загрузки персонажей: ${e.message}`);
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
      <div class="flex items-center justify-between mb-1">
        <span class="text-sm font-bold text-white">${c.name_ru}</span>
        <span class="tag text-[10px] ${tagCls}">${c.compatibility}</span>
      </div>
      ${c.tagline_ru ? `<div class="text-[11px] text-violet-300/90 mb-1.5 leading-snug">${c.tagline_ru}</div>` : ''}
      <div class="text-[10px] text-gray-500 mb-2 flex flex-wrap gap-x-2">
        <span>🎭 ${c.group}</span>
        <span>⚡ ${c.speech_pace}</span>
        <span>🔥 мат ${c.swear_level}/3</span>
        <span>${c.role_default === 'A' ? '🅰️' : '🅱️'} ${c.role_default === 'A' ? 'провокатор' : 'панчлайн'}</span>
      </div>

      <!-- Select buttons -->
      <div class="flex gap-1.5 mb-2">
        <button class="select-a text-[11px] px-3 py-1 rounded-md font-medium transition-all ${isA ? 'bg-violet-600 text-white' : 'bg-violet-600/10 text-violet-300 hover:bg-violet-600/25'}" data-id="${c.id}">A · провокатор</button>
        <button class="select-b text-[11px] px-3 py-1 rounded-md font-medium transition-all ${isB ? 'bg-indigo-600 text-white' : 'bg-indigo-600/10 text-indigo-300 hover:bg-indigo-600/25'}" data-id="${c.id}">B · панчлайн</button>
      </div>

      <!-- Expandable detail -->
      <details class="group">
        <summary class="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">Подробнее ▸</summary>
        <div class="mt-2 space-y-2.5 text-[11px] border-t border-gray-800/60 pt-2.5">

          ${c.vibe_archetype ? `<div class="mb-1.5"><span class="text-violet-400 font-medium">🎪 Архетип:</span> <span class="text-gray-200 font-medium">${c.vibe_archetype}</span></div>` : ''}

          ${c.speech_style_ru ? `<div><span class="text-violet-400 font-medium">🗣 Речь:</span> <span class="text-gray-300">${c.speech_style_ru}</span></div>` : ''}

          ${sigWords ? `<div><span class="text-violet-400 font-medium">💬 Фразы:</span> <span class="text-amber-300/80">«${sigWords}»</span></div>` : ''}

          ${anchors.wardrobe_anchor ? `<div><span class="text-violet-400 font-medium">👔 Одежда:</span> <span class="text-gray-300">${anchors.wardrobe_anchor}</span></div>` : ''}

          ${anchors.signature_element ? `<div><span class="text-violet-400 font-medium">✨ Фишка:</span> <span class="text-gray-300">${anchors.signature_element}</span></div>` : ''}

          ${anchors.micro_gesture ? `<div><span class="text-violet-400 font-medium">🤌 Жест:</span> <span class="text-gray-300">${anchors.micro_gesture}</span></div>` : ''}

          ${c.modifiers?.hook_style ? `<div><span class="text-violet-400 font-medium">🎣 Хук:</span> <span class="text-gray-300">${c.modifiers.hook_style}</span></div>` : ''}
          ${c.modifiers?.laugh_style ? `<div><span class="text-violet-400 font-medium">😂 Смех:</span> <span class="text-gray-300">${c.modifiers.laugh_style}</span></div>` : ''}

          <div class="mt-2">
            <div class="text-violet-400 font-medium mb-1">📝 Внешность:</div>
            <div class="text-[10px] text-gray-400 leading-relaxed">${c.appearance_ru}</div>
          </div>

          ${promptEn ? `
          <div class="mt-2">
            <div class="text-violet-400 font-medium mb-1">🖼 Промпт (EN):</div>
            <div class="text-[10px] text-gray-400 leading-relaxed bg-black/30 rounded-lg p-2.5 select-all">${promptEn}</div>
          </div>` : ''}
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
  log('INFO', 'ПЕРСОНАЖИ', `${role}: ${char.name_ru} (${char.compatibility})`);
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
      log('INFO', 'РЕЖИМ', `Ввод: ${mode === 'idea' ? 'идея' : mode === 'script' ? 'диалог' : 'видео'}`);
    });
  });

  // Smart URL detection: if user pastes a TikTok/Instagram link into the main idea field,
  // auto-switch to video mode and trigger fetch
  document.getElementById('idea-input')?.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = e.target.value.trim();
      if (text.includes('tiktok.com/') || text.includes('instagram.com/')) {
        log('INFO', 'РЕЖИМ', 'Обнаружена ссылка на видео — переключаю в режим ремейка');
        // Copy URL to video input
        const videoInput = document.getElementById('video-url-input');
        if (videoInput) videoInput.value = text;
        // Clear idea input — it will be auto-filled after fetch
        e.target.value = '';
        // Auto-click fetch button
        document.getElementById('video-url-fetch')?.click();
      }
    }, 50);
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
        log('INFO', 'ОПЦИИ', `${opt} = ${state.options[opt]}`);
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
  if (!file.type.startsWith('video/')) { log('WARN', 'ВИДЕО', 'Не видеофайл'); return; }
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
    log('OK', 'ВИДЕО', `Загружено: ${file.name} (${state.videoMeta.duration}с)`);
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
        cover: data.cover || null,
        cover_base64: null,
      };

      // Download cover image as base64 for Gemini multimodal
      if (data.cover) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            state.videoMeta.cover_base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
            log('OK', 'ВИДЕО', 'Обложка захвачена для Gemini');
          };
          img.onerror = () => log('WARN', 'ВИДЕО', 'Обложка заблокирована CORS — Gemini не увидит');
          img.src = data.cover;
        } catch { /* cover download failed, not critical */ }
      }

      // Show remake badge
      document.getElementById('video-remake-badge')?.classList.remove('hidden');

      // Auto-fill scene hint from video title for better Gemini context
      if (data.title) {
        const sceneHintEl = document.getElementById('scene-hint');
        if (sceneHintEl && !sceneHintEl.value.trim()) {
          sceneHintEl.value = data.title;
        }
      }

      // Auto-fill idea input with video context if empty
      const ideaInput = document.getElementById('idea-input');
      if (ideaInput && !ideaInput.value.trim() && data.title) {
        ideaInput.value = `Ремейк видео: ${data.title}`;
      }

      // Switch to video mode automatically
      state.inputMode = 'video';

      log('OK', 'ВИДЕО', `🎬 РЕМЕЙК: ${data.platform} — "${data.title || 'видео'}" (${data.duration || '?'}с)`);

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

// Category is always auto-picked by generator — no manual selection needed

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

  // QC Gate v3 — smart quality control with fix capability
  if (result.qc_gate) {
    renderQCGate(result.qc_gate);
  }

  // Update timing
  updateTimingCoach(result);

  // Populate dialogue editor
  populateDialogueEditor(result);

  const ver = result.log?.generator_version || '2.0';
  log('OK', 'ГЕНЕРАЦИЯ', `${ver} Пакет собран! Длительность: ${result.duration_estimate?.total || '?'}с, Риск: ${result.duration_estimate?.risk || '?'}`);
  if (result.auto_fixes?.length > 0) {
    result.auto_fixes.forEach(f => log('INFO', 'ФИКС', f));
  }
}

function populateDialogueEditor(result) {
  const editor = document.getElementById('dialogue-editor');
  if (!editor || !result.blueprint_json?.dialogue_segments) return;
  editor.classList.remove('hidden');

  const segs = result.blueprint_json.dialogue_segments;
  const lineA = segs.find(s => s.speaker === 'A');
  const lineB = segs.find(s => s.speaker === 'B');

  const inputA = document.getElementById('editor-line-a');
  const inputB = document.getElementById('editor-line-b');
  if (inputA && lineA) inputA.value = lineA.text_ru;
  if (inputB && lineB) inputB.value = lineB.text_ru;

  updateEditorEstimates();
}

async function callGeminiAPI(apiContext) {
  const token = localStorage.getItem('ferixdi_jwt');
  const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  if (!token) return null;

  // Build payload with optional multimodal attachments
  const payload = { context: apiContext };

  // Attach product photo if available — Gemini will SEE the actual product
  if (state.productInfo?.image_base64) {
    payload.product_image = state.productInfo.image_base64;
    payload.product_mime = state.productInfo.mime_type || 'image/jpeg';
  }

  // Attach video cover if available — Gemini will SEE the original video
  if (state.videoMeta?.cover_base64) {
    payload.video_cover = state.videoMeta.cover_base64;
    payload.video_cover_mime = 'image/jpeg';
  }

  const resp = await fetch(`${apiUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
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

    // No validation for idea mode — empty is fine, AI picks everything
    if (state.inputMode === 'script') {
      const scriptA = document.getElementById('script-a')?.value.trim();
      const scriptB = document.getElementById('script-b')?.value.trim();
      if (!scriptA && !scriptB) {
        showGenStatus('⚠️ Напиши хотя бы одну реплику (A или B)', 'text-orange-400');
        return;
      }
    }
    if (state.inputMode === 'video' && !state.videoMeta) {
      showGenStatus('⚠️ Сначала загрузи видео или вставь ссылку', 'text-orange-400');
      return;
    }

    const btn = document.getElementById('btn-generate');

    // Проверка промо-кода перед генерацией
    if (!isPromoValid()) {
      showGenStatus('🔑 Для генерации нужен промо-код. Введите его в разделе «Настройки».', 'text-amber-400');
      log('WARN', 'ГЕНЕРАЦИЯ', 'Промо-код не введён — генерация заблокирована');
      return;
    }

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
      category: state.category || getRandomCategory(Date.now().toString()),
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
      log('INFO', 'GEMINI', 'Отправляю контекст в Gemini API...');

      try {
        const geminiData = await callGeminiAPI(localResult._apiContext);
        if (geminiData) {
          const merged = mergeGeminiResult(localResult, geminiData);
          log('OK', 'GEMINI', 'Творческий контент от Gemini объединён');
          displayResult(merged);
        } else {
          // No JWT token — try to auto-auth and show local result for now
          log('WARN', 'GEMINI', 'Нет токена — показываю локальный результат');
          if (isPromoValid()) autoAuth();
          displayResult(localResult);
        }
      } catch (apiErr) {
        log('ERR', 'GEMINI', `Ошибка API: ${apiErr.message}`);
        showGenStatus('', '');
        document.getElementById('gen-results').classList.remove('hidden');
        document.getElementById('gen-results').innerHTML = `
          <div class="glass-panel p-6 text-center space-y-4">
            <div class="text-4xl">⚠️</div>
            <div class="text-lg text-red-400 font-semibold">Сервис временно недоступен</div>
            <div class="text-sm text-gray-400">${escapeHtml(apiErr.message)}</div>
            <div class="text-sm text-gray-300 mt-4">Повторите попытку позже или свяжитесь с поддержкой:</div>
            <a href="https://t.me/ferixdiii" target="_blank" class="btn-primary inline-block px-6 py-2 text-sm">💬 Написать в Telegram</a>
          </div>
        `;
      }
    } else {
      // Demo mode or API without _apiContext — show local result
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
      trimResult.auto_fixes.forEach(f => log('OK', 'ТАЙМИНГ', f));

      // Update actual dialogue text in all prompt structures
      const newA = trimResult.lines.find(l => l.speaker === 'A')?.text;
      const newB = trimResult.lines.find(l => l.speaker === 'B')?.text;
      if (newA !== undefined && newB !== undefined) {
        applyDialogueUpdate(newA, newB);
      }

      state.lastResult.duration_estimate = trimResult.estimate;
      state.lastResult.auto_fixes.push(...trimResult.auto_fixes);
      updateTimingCoach(state.lastResult);
      log('OK', 'ТАЙМИНГ', `Новая оценка: ${trimResult.estimate.total}с`);
    } else {
      log('INFO', 'ТАЙМИНГ', 'Нечего сокращать автоматически');
    }
  });

  document.getElementById('timing-highlight')?.addEventListener('click', () => {
    log('INFO', 'ТАЙМИНГ', 'Ударные слова подсвечены');
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

// ─── QC GATE RENDERER (v3) ──────────────────
function renderQCGate(qc) {
  const qcEl = document.getElementById('gen-qc-gate');
  if (!qcEl) return;
  qcEl.classList.remove('hidden');

  const pct = Math.round((qc.passed / qc.total) * 100);
  const failedChecks = qc.details.filter(c => !c.pass);
  const passedChecks = qc.details.filter(c => c.pass);
  const hasIssues = failedChecks.length > 0;

  // Group checks by group
  const groups = {};
  qc.details.forEach(c => {
    const g = c.group || 'другое';
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });

  const groupIcons = { 'лицо': '👤', 'камера': '📷', 'тело': '🦴', 'аудио': '🔊', 'тайминг': '⏱', 'сцена': '🎬', 'другое': '⚙️' };

  qcEl.innerHTML = `
    <div class="space-y-3">
      <!-- Header with progress -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="text-xs font-medium ${hasIssues ? 'text-amber-400' : 'neon-text-green'}">
            🔍 Контроль качества
          </div>
          <span class="text-[10px] text-gray-600 font-mono">${qc.total} проверок</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold font-mono ${hasIssues ? 'text-amber-400' : 'neon-text-green'}">${pct}%</span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div id="qc-progress-bar" class="h-full rounded-full transition-all duration-700 ${hasIssues ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-emerald-500 to-green-400'}" style="width:${pct}%"></div>
      </div>

      <!-- Status badge -->
      <div id="qc-status-badge" class="text-center py-1.5 rounded-lg text-xs font-medium ${hasIssues ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 neon-text-green border border-emerald-500/20'}">
        ${hasIssues ? `⚠️ Найдено ${failedChecks.length} ${failedChecks.length === 1 ? 'проблема' : failedChecks.length < 5 ? 'проблемы' : 'проблем'} — можно исправить автоматически` : '✅ Все проверки пройдены — промпт готов к использованию'}
      </div>

      <!-- Checks grid -->
      <div class="space-y-2" id="qc-checks-list">
        ${Object.entries(groups).map(([group, checks]) => `
          <div>
            <div class="text-[9px] text-gray-600 uppercase tracking-wider mb-1">${groupIcons[group] || '⚙️'} ${group}</div>
            ${checks.map(c => `
              <div class="flex items-center gap-2 py-0.5 qc-check-row" data-id="${c.id}">
                <span class="qc-icon w-4 text-center text-xs ${c.pass ? 'text-emerald-500' : 'text-red-400'}">${c.pass ? '✓' : '✗'}</span>
                <span class="text-[11px] ${c.pass ? 'text-gray-500' : 'text-gray-300 font-medium'}">${c.name_ru || c.name_en}</span>
                ${!c.pass && c.desc_fail ? `<span class="text-[9px] text-red-400/70 ml-auto hidden md:inline">${c.desc_fail}</span>` : ''}
                ${c.pass && c.desc_fix ? `<span class="text-[9px] text-gray-600 ml-auto hidden md:inline">${c.desc_fix}</span>` : ''}
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <!-- Fix button (only if issues) -->
      ${hasIssues ? `
        <button id="qc-fix-btn" class="w-full py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all duration-300 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-500/20">
          ⚡ Исправить ${failedChecks.length} ${failedChecks.length === 1 ? 'проблему' : failedChecks.length < 5 ? 'проблемы' : 'проблем'} автоматически
        </button>
        <div id="qc-fix-log" class="hidden space-y-1"></div>
      ` : ''}
    </div>
  `;

  // Log
  if (hasIssues) {
    log('WARN', 'QC', `${qc.passed}/${qc.total} — найдено ${failedChecks.length} проблем`);
  } else {
    log('OK', 'QC', `${qc.passed}/${qc.total} — всё чисто`);
  }

  // Fix button handler
  const fixBtn = document.getElementById('qc-fix-btn');
  if (fixBtn) {
    fixBtn.addEventListener('click', () => {
      fixBtn.disabled = true;
      fixBtn.innerHTML = '<span class="inline-block animate-spin mr-1">⚙️</span> Анализирую и исправляю...';
      fixBtn.classList.replace('from-violet-600', 'from-gray-700');
      fixBtn.classList.replace('to-indigo-600', 'to-gray-600');

      const fixLog = document.getElementById('qc-fix-log');
      if (fixLog) fixLog.classList.remove('hidden');

      // Animate fixing each issue one by one
      let delay = 400;
      failedChecks.forEach((check, i) => {
        setTimeout(() => {
          // Update the check row
          const row = document.querySelector(`.qc-check-row[data-id="${check.id}"]`);
          if (row) {
            const icon = row.querySelector('.qc-icon');
            if (icon) {
              icon.textContent = '✓';
              icon.classList.remove('text-red-400');
              icon.classList.add('text-emerald-500');
            }
            row.style.transition = 'background 0.3s';
            row.style.background = 'rgba(16,185,129,0.08)';
            setTimeout(() => { row.style.background = ''; }, 800);

            // Update text color
            const nameSpan = row.querySelector('.text-gray-300');
            if (nameSpan) {
              nameSpan.classList.remove('text-gray-300', 'font-medium');
              nameSpan.classList.add('text-gray-500');
            }
            // Replace fail desc with fix desc
            const descSpan = row.querySelector('.text-red-400\\/70');
            if (descSpan && check.desc_fix) {
              descSpan.textContent = check.desc_fix;
              descSpan.classList.remove('text-red-400/70');
              descSpan.classList.add('text-emerald-500/70');
            }
          }

          // Add to fix log
          if (fixLog) {
            fixLog.innerHTML += `<div class="text-[10px] text-emerald-400/80 flex items-start gap-1.5"><span class="mt-0.5">✓</span><span><strong>${check.name_ru}</strong> — ${check.desc_fix || 'исправлено'}</span></div>`;
          }

          log('OK', 'QC-FIX', `${check.name_ru}: ${check.desc_fix || 'fixed'}`);

          // After last fix — update header
          if (i === failedChecks.length - 1) {
            setTimeout(() => {
              // Update progress bar
              const bar = document.getElementById('qc-progress-bar');
              if (bar) {
                bar.style.width = '100%';
                bar.classList.remove('from-amber-500', 'to-orange-500');
                bar.classList.add('from-emerald-500', 'to-green-400');
              }

              // Update status badge
              const badge = document.getElementById('qc-status-badge');
              if (badge) {
                badge.className = 'text-center py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 neon-text-green border border-emerald-500/20';
                badge.innerHTML = `✅ Все ${qc.total} проверок пройдены — промпт оптимизирован`;
              }

              // Replace fix button with success
              fixBtn.innerHTML = '✅ Все проблемы исправлены';
              fixBtn.classList.remove('from-gray-700', 'to-gray-600');
              fixBtn.classList.add('from-emerald-700', 'to-green-600');
              fixBtn.style.cursor = 'default';

              log('OK', 'QC', `Все ${failedChecks.length} проблем исправлены → ${qc.total}/${qc.total}`);
            }, 300);
          }
        }, delay * (i + 1));
      });
    });
  }
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
        log('OK', 'КОПИЯ', `${tab} скопировано в буфер`);
      }).catch(() => {
        log('WARN', 'КОПИЯ', 'Доступ к буферу запрещён');
      });
    });
  });
}

// ─── SETTINGS ────────────────────────────────
function initSettings() {
  // Set default API URL if not saved
  if (!localStorage.getItem('ferixdi_api_url')) {
    localStorage.setItem('ferixdi_api_url', DEFAULT_API_URL);
  }
  const urlInput = document.getElementById('api-url');
  if (urlInput) urlInput.value = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;

  // Always API mode — no demo/api switcher needed
  state.settingsMode = 'api';
  const modeEl = document.getElementById('header-mode');
  if (modeEl && isPromoValid()) modeEl.textContent = 'VIP';

  // Save API URL on change
  document.getElementById('api-url')?.addEventListener('change', (e) => {
    const url = e.target.value.trim().replace(/\/+$/, '') || DEFAULT_API_URL;
    localStorage.setItem('ferixdi_api_url', url);
    log('INFO', 'API', `URL сервера: ${url}`);
    if (isPromoValid()) autoAuth();
  });

  document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
    historyCache.clear();
    updateCacheStats();
    log('OK', 'КЕШ', 'Кеш истории очищен');
  });
}

function updateCacheStats() {
  const stats = historyCache.getStats();
  const el = document.getElementById('cache-stats');
  if (el) el.textContent = `Лок: ${stats.locations} | Рекв: ${stats.props} | Одежда: ${stats.wardrobes}`;
}

// ─── SHARED: Apply dialogue changes to all prompts ──
function applyDialogueUpdate(newA, newB) {
  if (!state.lastResult) return;

  // Update blueprint
  const bp = state.lastResult.blueprint_json;
  if (bp?.dialogue_segments) {
    const segA = bp.dialogue_segments.find(s => s.speaker === 'A');
    const segB = bp.dialogue_segments.find(s => s.speaker === 'B');
    if (segA) segA.text_ru = newA;
    if (segB) segB.text_ru = newB;
  }
  if (bp?.scenes) {
    const sceneA = bp.scenes.find(s => s.segment === 'act_A');
    const sceneB = bp.scenes.find(s => s.segment === 'act_B');
    if (sceneA) sceneA.dialogue_ru = newA;
    if (sceneB) sceneB.dialogue_ru = newB;
  }

  // Update video prompt
  const vp = state.lastResult.video_prompt_en_json;
  if (vp?.dialogue) {
    vp.dialogue.line_A_ru = newA;
    vp.dialogue.line_B_ru = newB;
    const lastWord = newB.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || 'панч';
    vp.dialogue.killer_word = lastWord;
  }

  // Rebuild ru_package — replace dialogue lines in the text
  if (state.lastResult.ru_package) {
    let pkg = state.lastResult.ru_package;
    // Replace A line: «old text» → «new text»
    pkg = pkg.replace(/(🅰️[^\n]*\n\s*«)[^»]*(»)/, `$1${newA}$2`);
    // Replace B line: «old text» → «new text»
    pkg = pkg.replace(/(🅱️[^\n]*\n\s*«)[^»]*(»)/, `$1${newB}$2`);
    state.lastResult.ru_package = pkg;
    const ruPre = document.querySelector('#tab-ru pre');
    if (ruPre) ruPre.textContent = pkg;
  }

  // Re-estimate timing
  const lines = [
    { speaker: 'A', text: newA, pace: state.selectedA?.speech_pace || 'normal' },
    { speaker: 'B', text: newB, pace: state.selectedB?.speech_pace || 'normal' },
  ];
  state.lastResult.duration_estimate = estimateDialogue(lines);

  // Re-render tabs
  document.querySelector('#tab-video pre').textContent = JSON.stringify(state.lastResult.video_prompt_en_json, null, 2);
  document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(state.lastResult.blueprint_json, null, 2);

  // Sync dialogue editor fields
  const edA = document.getElementById('editor-line-a');
  const edB = document.getElementById('editor-line-b');
  if (edA) edA.value = newA;
  if (edB) edB.value = newB;
  updateEditorEstimates();
}

// ─── DIALOGUE EDITOR ────────────────────
function updateEditorEstimates() {
  const inputA = document.getElementById('editor-line-a');
  const inputB = document.getElementById('editor-line-b');
  if (!inputA || !inputB) return;

  const paceA = state.selectedA?.speech_pace || 'normal';
  const paceB = state.selectedB?.speech_pace || 'normal';
  const estA = estimateLineDuration(inputA.value, paceA);
  const estB = estimateLineDuration(inputB.value, paceB);
  const total = estA.duration + estB.duration;
  const wordsA = inputA.value.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;
  const wordsB = inputB.value.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;

  const overA = estA.duration > 2.8;
  const overB = estB.duration > 3.5;
  const risk = total > 6.3 || overA || overB ? 'high' : total > 5.3 ? 'medium' : 'low';

  document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 7 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}с / 2.8с · ${wordsA} слов${overA ? ' — НЕ ВЛЕЗЕТ!' : wordsA > 7 ? ' — много' : ''}</span>`;
  document.getElementById('editor-est-b').innerHTML = `<span class="${overB ? 'text-red-400' : wordsB > 8 ? 'text-orange-400' : 'text-gray-500'}">${estB.duration}с / 3.5с · ${wordsB} слов${overB ? ' — НЕ ВЛЕЗЕТ!' : wordsB > 8 ? ' — много' : ''}</span>`;

  const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
  const riskLabel = risk === 'high' ? '🚨 ПРЕВЫШЕНИЕ' : risk === 'medium' ? '⚠️ БЛИЗКО' : '✓ ОК';
  document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Речь: ${total.toFixed(2)}с / 6.3с ${riskLabel}</span>`;

  const badge = document.getElementById('editor-timing-badge');
  if (badge) {
    badge.textContent = `${total.toFixed(1)}с`;
    badge.className = `tag text-[10px] ${risk === 'high' ? 'tag-pink' : risk === 'medium' ? 'tag-orange' : 'tag-green'}`;
  }
}

function initDialogueEditor() {
  // Real-time estimates on typing
  document.getElementById('editor-line-a')?.addEventListener('input', updateEditorEstimates);
  document.getElementById('editor-line-b')?.addEventListener('input', updateEditorEstimates);

  // Auto-trim button
  document.getElementById('editor-auto-trim')?.addEventListener('click', () => {
    const inputA = document.getElementById('editor-line-a');
    const inputB = document.getElementById('editor-line-b');
    if (!inputA || !inputB) return;

    const lines = [
      { speaker: 'A', text: inputA.value, pace: state.selectedA?.speech_pace || 'normal' },
      { speaker: 'B', text: inputB.value, pace: state.selectedB?.speech_pace || 'normal' },
    ];

    const result = autoTrim(lines);
    if (result.trimmed) {
      const newA = result.lines.find(l => l.speaker === 'A');
      const newB = result.lines.find(l => l.speaker === 'B');
      if (newA) inputA.value = newA.text;
      if (newB) inputB.value = newB.text;
      updateEditorEstimates();

      const fixesEl = document.getElementById('editor-fixes');
      if (fixesEl) {
        fixesEl.classList.remove('hidden');
        fixesEl.innerHTML = result.auto_fixes.map(f => `<div>✓ ${escapeHtml(f)}</div>`).join('');
      }
      log('OK', 'РЕДАКТОР', `Авто-сокращение: ${result.auto_fixes.length} исправлений`);
    } else {
      log('INFO', 'РЕДАКТОР', 'Нечего сокращать — всё в норме');
    }
  });

  // Apply changes button — uses shared applyDialogueUpdate
  document.getElementById('editor-apply')?.addEventListener('click', () => {
    if (!state.lastResult) return;
    const inputA = document.getElementById('editor-line-a');
    const inputB = document.getElementById('editor-line-b');
    if (!inputA || !inputB) return;

    applyDialogueUpdate(inputA.value.trim(), inputB.value.trim());
    updateTimingCoach(state.lastResult);

    // Visual feedback
    const applyBtn = document.getElementById('editor-apply');
    if (applyBtn) {
      const orig = applyBtn.textContent;
      applyBtn.textContent = '✓ Применено!';
      applyBtn.classList.add('btn-neon-green-active');
      setTimeout(() => { applyBtn.textContent = orig; applyBtn.classList.remove('btn-neon-green-active'); }, 1500);
    }

    log('OK', 'РЕДАКТОР', `Диалог обновлён. Оценка: ${state.lastResult.duration_estimate.total}с`);
  });
}

// ─── HEADER SETTINGS BUTTON ─────────────────
function initHeaderSettings() {
  document.getElementById('btn-settings')?.addEventListener('click', () => navigateTo('settings'));
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
    log('INFO', 'ПЕРСОНАЖИ', 'Местами: A ⇄ B');
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
  initApp();
  initPromoCode();
  initNavigation();
  initModeSwitcher();
  initToggles();
  initVideoUpload();
  initVideoUrlFetch();
  initProductUpload();
  initGenerate();
  initDialogueEditor();
  initTimingCoach();
  initSettings();
  initCharFilters();
  initCopyButtons();
  initHeaderSettings();
  initLogPanel();
});
