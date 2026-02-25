/**
 * FERIXDI Studio — Main Application
 * Космический хакерский командный центр для ремикса видео
 */

import { generate, getRandomCategory, mergeGeminiResult } from './engine/generator.js';
import { estimateDialogue, estimateLineDuration } from './engine/estimator.js';
import { autoTrim } from './engine/auto_trim.js';
import { historyCache } from './engine/history_cache.js';
import { sfx } from './engine/sounds.js';

// ─── STATE ───────────────────────────────────
const state = {
  characters: [],
  locations: [],
  selectedA: null,
  selectedB: null,
  selectedLocation: null, // location id or null (auto)
  generationMode: null, // New: selected generation mode
  inputMode: 'idea',
  category: null,
  videoMeta: null,
  productInfo: null, // { image_base64, mime_type, description_en }
  referenceStyle: null, // { description_en } — visual style from reference photo
  options: { enforce8s: true, preserveRhythm: true, strictLipSync: true, allowAutoTrim: false },
  lastResult: null,
  settingsMode: 'api',
  threadMemory: [],
  // Performance optimization flags
  _isLoading: false,
  _lastActivity: Date.now(),
  _cachedResults: new Map(),
};

// ─── LOG ─────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function log(level, module, msg) {
  const el = document.getElementById('log-output');
  if (!el) return;
  const ts = new Date().toLocaleTimeString('ru-RU');
  const cls = { INFO: 'log-info', WARN: 'log-warn', ERR: 'log-err', OK: 'log-ok' }[level] || 'log-info';
  el.innerHTML += `<div class="${cls}">[${ts}] ${escapeHtml(module)}: ${escapeHtml(msg)}</div>`;
  el.scrollTop = el.scrollHeight;
  // Limit log size to prevent memory leak
  while (el.children.length > 200) el.removeChild(el.firstChild);
}

// ─── PROMO CODE (hash-only, no plaintext) ────────
const _PH = 'bc6f301ecc9d72e7f2958ba89cb1524cc560984ca0131c5bf43a476c1d98d184';
const DEFAULT_API_URL = 'https://ferixdi-studio.onrender.com';

async function _hashCode(code) {
  const data = new TextEncoder().encode(code.trim().toUpperCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isPromoValid() {
  return localStorage.getItem('ferixdi_ph') === _PH;
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

  btn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { status.innerHTML = '<span class="text-red-400">Введите промо-код</span>'; return; }

    btn.disabled = true;
    btn.textContent = '…';
    const hash = await _hashCode(key);

    if (hash === _PH) {
      localStorage.setItem('ferixdi_ph', hash);
      localStorage.removeItem('ferixdi_promo');
      status.innerHTML = '<span class="neon-text-green">✓ Промо-код активен! Добро пожаловать!</span>';
      input.value = '';
      input.placeholder = '••••••••';
      const modeEl = document.getElementById('header-mode');
      if (modeEl) modeEl.textContent = 'VIP';
      log('OK', 'ПРОМО', 'Промо-код принят');
      updateWelcomeBanner();
      autoAuth(hash);
      updateReadiness();
      renderEducation();
    } else {
      status.innerHTML = '<span class="text-red-400">✗ Неверный промо-код</span>';
      log('WARN', 'ПРОМО', 'Неверный промо-код');
    }
    btn.disabled = false;
    btn.textContent = 'Активировать';
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

async function autoAuth(hash) {
  const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  const h = hash || localStorage.getItem('ferixdi_ph');
  if (!h) return;
  try {
    const resp = await fetch(`${url}/api/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: h }),
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

function updateWelcomeBanner() {
  const banner = document.getElementById('welcome-banner');
  if (!banner) return;
  banner.classList.remove('hidden');

  const title = banner.querySelector('h3');
  const desc = banner.querySelector('p');
  const columns = banner.querySelector('.grid');
  const ctaBtn = document.getElementById('welcome-go-settings');
  const ctaHint = document.getElementById('welcome-cta-hint');

  if (isPromoValid()) {
    if (title) title.textContent = '\u{1F680} FERIXDI Studio — VIP \u{2728}';
    if (desc) desc.textContent = 'AI-\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0432\u0438\u0440\u0443\u0441\u043D\u044B\u0445 Reels \u0430\u043A\u0442\u0438\u0432\u0435\u043D. \u0412\u044B\u0431\u0435\u0440\u0438 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0435\u0439, \u043E\u043F\u0438\u0448\u0438 \u0438\u0434\u0435\u044E \u0438 \u043D\u0430\u0436\u043C\u0438 \u00AB\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u00BB. \u0411\u0435\u0437\u043B\u0438\u043C\u0438\u0442\u043D\u044B\u0435 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B.';
    if (columns) columns.classList.add('hidden');
    if (ctaBtn) { ctaBtn.textContent = '\u{1F3AC} \u041D\u0430\u0447\u0430\u0442\u044C \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E'; ctaBtn.onclick = () => navigateTo('generate'); }
    if (ctaHint) ctaHint.textContent = '\u0412\u0441\u0435 \u0444\u0443\u043D\u043A\u0446\u0438\u0438 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u2014 \u0433\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0439 \u0431\u0435\u0437 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439!';
  }
  const charCountEl = document.getElementById('welcome-char-count');
  if (charCountEl) charCountEl.textContent = state.characters.length;
}

function initWelcomeBanner() {
  updateWelcomeBanner();
  const btn = document.getElementById('welcome-go-settings');
  if (btn && !isPromoValid()) {
    btn.addEventListener('click', () => navigateTo('settings'));
  }
}

function initApp() {
  log('OK', 'СИСТЕМА', 'FERIXDI Studio v2.0 — добро пожаловать!');

  // Performance optimization: start loading immediately
  const startTime = performance.now();
  
  // Migrate old plaintext promo → hash-based (one-time)
  const oldPromo = localStorage.getItem('ferixdi_promo');
  if (oldPromo && !localStorage.getItem('ferixdi_ph')) {
    _hashCode(oldPromo).then(h => {
      if (h === _PH) { localStorage.setItem('ferixdi_ph', h); }
      localStorage.removeItem('ferixdi_promo');
    });
  }

  // Initialize mobile menu
  initMobileMenu();
  
  // Load data in parallel
  const loadPromises = [
    loadCharacters(),
    updateCacheStats(),
    initWelcomeBanner()
  ];
  
  Promise.all(loadPromises).then(() => {
    const loadTime = performance.now() - startTime;
    log('OK', 'ПРОИЗВОДИТЕЛЬНОСТЬ', `Initial load completed in ${loadTime.toFixed(2)}ms`);
  });
  
  navigateTo('generation-mode'); // Start with generation mode selection

  // Auto-authenticate if promo is already saved
  if (isPromoValid()) {
    autoAuth();
  }
}

function initMobileMenu() {
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  if (window.innerWidth <= 768 && mobileToggle) {
    mobileToggle.classList.remove('hidden');
  }
  
  // Show/hide based on screen size
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      mobileToggle?.classList.remove('hidden');
    } else {
      mobileToggle?.classList.add('hidden');
    }
  });
}

// ─── LOCATIONS ───────────────────────────────
async function loadLocations() {
  try {
    const resp = await fetch(new URL('./data/locations.json', import.meta.url));
    state.locations = await resp.json();
    log('OK', 'ДАННЫЕ', `Загружено ${state.locations.length} локаций`);
    // Merge custom locations from server (permanent) before rendering
    await loadServerCustomLocations();
    populateLocationFilters();
    renderLocations();
  } catch (e) {
    log('ERR', 'ДАННЫЕ', `Ошибка загрузки локаций: ${e.message}`);
  }
}

async function loadServerCustomLocations() {
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiBase}/api/custom/locations`);
    if (!resp.ok) { log('WARN', 'GH-ЛОКАЦИИ', `Сервер ответил ${resp.status}`); return; }
    const serverLocs = await resp.json();
    if (!Array.isArray(serverLocs)) return;
    if (!serverLocs.length) { log('INFO', 'GH-ЛОКАЦИИ', '0 пользовательских локаций на сервере'); return; }
    const existingIds = new Set(state.locations.map(l => l.id));
    let added = 0;
    const names = [];
    serverLocs.forEach(l => {
      if (!existingIds.has(l.id)) {
        if (!l.numeric_id) l.numeric_id = getNextLocNumericId();
        state.locations.push(l); existingIds.add(l.id); added++; names.push(l.name_ru || l.id);
      }
    });
    log('OK', 'GH-ЛОКАЦИИ', `✅ ${serverLocs.length} на сервере, ${added} новых добавлено${names.length ? ': ' + names.join(', ') : ''}`);
  } catch (e) {
    log('WARN', 'GH-ЛОКАЦИИ', 'Сервер недоступен — используем локальный кэш');
  }
}

function populateLocationFilters() {
  const groups = [...new Set(state.locations.map(l => l.group))].sort();
  const sel = document.getElementById('loc-group-filter');
  if (!sel) return;
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

function renderLocations(filterGroup = '') {
  const grid = document.getElementById('loc-grid');
  if (!grid) return;
  let locs = [...state.locations];
  if (filterGroup) locs = locs.filter(l => l.group === filterGroup);

  const autoSel = !state.selectedLocation;
  grid.innerHTML = `
    <div class="loc-card ${autoSel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="">
      <div class="text-sm">🎲</div>
      <div class="text-[11px] font-medium text-violet-300">Авто</div>
      <div class="text-[10px] text-gray-500 mb-2">AI подберёт</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${autoSel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="">${autoSel ? '✓ Выбрано' : '📍 Выбрать'}</button>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '🌟' : l.mood === 'sterile tension' ? '🩵' : l.mood === 'organic chaos' ? '🌿' : l.mood === 'dramatic intimacy' ? '🕯️' : '🎨';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.numeric_id ? `<span class="text-[9px] text-gray-500 font-mono mr-1">#${l.numeric_id}</span>` : ''}${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug mb-2">${l.tagline_ru}</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${sel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="${l.id}">${sel ? '✓ Выбрано' : '📍 Выбрать'}</button>
      <button class="copy-loc-prompt text-[9px] px-2 py-1 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full mt-1.5 flex items-center justify-center gap-1" data-id="${l.id}" title="Скопировать детализированный промпт для Veo">
        <span>📋</span> Промпт
      </button>
    </div>`;
  }).join('');

  updateLocationInfo();
}

function updateLocationInfo() {
  const info = document.getElementById('loc-selected-info');
  if (!info) return;
  if (!state.selectedLocation) {
    info.classList.add('hidden');
    return;
  }
  const loc = state.locations.find(l => l.id === state.selectedLocation);
  if (!loc) { info.classList.add('hidden'); return; }
  info.classList.remove('hidden');
  const tags = (loc.tags || []).map(t => `<span class="tag text-[10px]">${t}</span>`).join(' ');
  info.innerHTML = `<div class="flex items-center gap-2 flex-wrap"><span class="text-violet-400 font-medium">📍 ${loc.name_ru}</span>${tags}<button onclick="deselectLocation()" class="text-[10px] text-red-400/60 hover:text-red-400 transition-colors ml-1" title="Сбросить локацию">✕ сбросить</button></div><div class="text-[10px] text-gray-500 mt-1">${loc.tagline_ru}</div>`;
}

function deselectLocation() {
  state.selectedLocation = null;
  sfx.clickSoft();
  renderLocations(document.getElementById('loc-group-filter')?.value || '');
  renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
  log('INFO', 'ЛОКАЦИЯ', 'Сброшена → Авто-выбор');
  updateProgress();
}
window.deselectLocation = deselectLocation;
window.navigateTo = navigateTo;

function initLocationPicker() {
  document.getElementById('loc-grid')?.addEventListener('click', (e) => {
    // Handle copy button clicks
    const copyBtn = e.target.closest('.copy-loc-prompt');
    if (copyBtn) {
      e.stopPropagation();
      copyLocationPrompt(copyBtn.dataset.id);
      return;
    }
    
    const card = e.target.closest('.loc-card');
    if (!card) return;
    const id = card.dataset.locId;
    state.selectedLocation = id || null;
    renderLocations(document.getElementById('loc-group-filter')?.value || '');
    renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
    log('INFO', 'ЛОКАЦИЯ', state.selectedLocation ? `Выбрана: ${state.locations.find(l => l.id === state.selectedLocation)?.name_ru}` : 'Авто-выбор');
    updateProgress();
  });
  document.getElementById('loc-group-filter')?.addEventListener('change', (e) => {
    renderLocations(e.target.value);
  });
  document.getElementById('loc-random-btn')?.addEventListener('click', () => {
    const filtered = document.getElementById('loc-group-filter')?.value;
    let pool = filtered ? state.locations.filter(l => l.group === filtered) : state.locations;
    if (pool.length === 0) pool = state.locations;
    const rand = pool[Math.floor(Math.random() * pool.length)];
    state.selectedLocation = rand.id;
    renderLocations(filtered || '');
    renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
    log('INFO', 'ЛОКАЦИЯ', `🎲 Случайная: ${rand.name_ru}`);
    updateProgress();
  });
  
  // Update progress when inputs change
  ['idea-input', 'idea-input-custom', 'idea-input-suggested', 'script-a', 'script-b', 'scene-hint-main'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      setTimeout(updateProgress, 100); // Debounce
    });
  });
}

// ─── AUTO-TRANSLATE EN→RU for character card fields ──
const EN_RU_DICT = {
  // hook_style
  'thrusts phone screen at camera': 'тычет экраном телефона в камеру',
  'slams palm flat on table': 'хлопает ладонью по столу',
  'slow deliberate head turn toward camera': 'медленный поворот головы к камере',
  'adjusts glasses and peers over them': 'поправляет очки и смотрит поверх',
  'points finger directly at camera': 'тычет пальцем прямо в камеру',
  'leans forward conspiratorially': 'наклоняется вперёд заговорщически',
  'crosses arms and raises one eyebrow': 'скрещивает руки и поднимает бровь',
  'waves dismissively': 'отмахивается пренебрежительно',
  'grabs other person by sleeve': 'хватает другого за рукав',
  'raises both hands in disbelief': 'поднимает обе руки в недоумении',
  'slaps own knee': 'хлопает себя по колену',
  'wags finger at camera': 'грозит пальцем в камеру',
  'dramatic gasp with hand on chest': 'драматический вздох с рукой на груди',
  'leans back and squints': 'откидывается назад и щурится',
  'rubs hands together': 'потирает руки',
  'snaps fingers': 'щёлкает пальцами',
  'taps temple knowingly': 'стучит по виску со знанием дела',
  'pulls out phone dramatically': 'достаёт телефон с драмой',
  'shakes head slowly': 'медленно качает головой',
  'claps once loudly': 'один громкий хлопок',
  // laugh_style
  'wheezing cackle that turns into cough': 'хрипящий хохот переходящий в кашель',
  'grudging one-sided smirk': 'неохотная ухмылка одним уголком рта',
  'explosive belly laugh shaking whole body': 'взрывной хохот от живота, трясётся всё тело',
  'silent shoulder shake with closed eyes': 'беззвучная тряска плечами с закрытыми глазами',
  'quiet chuckle': 'тихий смешок',
  'loud burst': 'громкий взрыв смеха',
  'snort laugh': 'фыркающий смех',
  'giggle behind hand': 'хихиканье за ладонью',
  'dry sarcastic huff': 'сухой саркастический выдох',
  'belly laugh': 'хохот от живота',
  'wheezing laugh': 'хрипящий смех',
  'cackle': 'кудахтающий хохот',
  // signature_element
  'turquoise clip-on earrings': 'бирюзовые серьги-клипсы',
  'reading glasses dangling on beaded cord': 'очки для чтения на бисерной цепочке',
  'bright hand-knitted shawl draped over shoulders': 'яркая вязаная шаль на плечах',
  'vintage gold-rimmed spectacles on chain': 'старинные очки в золотой оправе на цепочке',
  'gold dental crown': 'золотая коронка',
  'amber pendant': 'янтарный кулон',
  'flat cap': 'кепка-восьмиклинка',
  'bold earrings': 'крупные серьги',
  'pearl stud earrings': 'жемчужные серьги-гвоздики',
  // micro_gesture
  'dramatic hand wave with spread fingers': 'драматичный взмах рукой с растопыренными пальцами',
  'arms crossed with slow disapproving nod': 'руки скрещены, медленный неодобрительный кивок',
  'finger jabbing the air like conductor\'s baton': 'тычет пальцем в воздух как дирижёрской палочкой',
  'slow head shake': 'медленное покачивание головой',
  'dramatic hand wave': 'драматичный взмах рукой',
  'grins deliberately to flash gold teeth as punctuation': 'нарочно скалится, показывая золотые зубы',
};

function translateEnRu(text) {
  if (!text) return '';
  const lower = text.toLowerCase().trim();
  // Exact match
  for (const [en, ru] of Object.entries(EN_RU_DICT)) {
    if (lower === en.toLowerCase()) return ru;
  }
  // Partial match
  for (const [en, ru] of Object.entries(EN_RU_DICT)) {
    if (lower.includes(en.toLowerCase())) return ru;
  }
  return text;
}

// ─── NUMERIC ID HELPERS ─────────────────────
function getNextCharNumericId() {
  const maxId = state.characters.reduce((mx, c) => Math.max(mx, c.numeric_id || 0), 0);
  return maxId + 1;
}
function getNextLocNumericId() {
  const maxId = state.locations.reduce((mx, l) => Math.max(mx, l.numeric_id || 0), 0);
  return maxId + 1;
}

// ─── CHARACTERS ──────────────────────────────
async function loadCharacters() {
  // Check cache first
  const cacheKey = 'characters_v1';
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = localStorage.getItem(`${cacheKey}_time`);
  const now = Date.now();
  
  // Use cache if less than 1 hour old
  if (cached && cacheTime && (now - parseInt(cacheTime)) < 3600000) {
    try {
      state.characters = JSON.parse(cached);
      log('OK', 'ДАННЫЕ', `Загружено ${state.characters.length} персонажей из кэша`);
      populateFilters();
      renderCharacters();
      // Background refresh
      setTimeout(() => refreshCharacters(), 2000);
      return;
    } catch (e) {
      console.warn('Cache parse error, fetching fresh data');
    }
  }
  
  // Fetch fresh data
  await refreshCharacters();
}

async function refreshCharacters() {
  try {
    const resp = await fetch(new URL('./data/characters.json', import.meta.url));
    state.characters = await resp.json();
    
    // Update cache
    const cacheKey = 'characters_v1';
    localStorage.setItem(cacheKey, JSON.stringify(state.characters));
    localStorage.setItem(`${cacheKey}_time`, Date.now().toString());
    
    log('OK', 'ДАННЫЕ', `Загружено ${state.characters.length} персонажей`);
    populateFilters();

    // Merge custom characters: server API (permanent) + localStorage (offline fallback)
    await loadServerCustomCharacters();
    loadCustomCharacters();

    renderCharacters();
    populateSeriesSelects();
  } catch (e) {
    log('ERR', 'ДАННЫЕ', `Ошибка загрузки персонажей: ${e.message}`);
  }
}

async function loadServerCustomCharacters() {
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiBase}/api/custom/characters`);
    if (!resp.ok) { log('WARN', 'GH-ПЕРСОНАЖИ', `Сервер ответил ${resp.status}`); return; }
    const serverChars = await resp.json();
    if (!Array.isArray(serverChars)) return;
    if (!serverChars.length) { log('INFO', 'GH-ПЕРСОНАЖИ', '0 пользовательских персонажей на сервере'); return; }
    const existingIds = new Set(state.characters.map(c => c.id));
    let added = 0;
    const names = [];
    serverChars.forEach(c => {
      if (!existingIds.has(c.id)) {
        if (!c.numeric_id) c.numeric_id = getNextCharNumericId();
        state.characters.push(c); existingIds.add(c.id); added++; names.push(c.name_ru || c.id);
      }
    });
    log('OK', 'GH-ПЕРСОНАЖИ', `✅ ${serverChars.length} на сервере, ${added} новых добавлено${names.length ? ': ' + names.join(', ') : ''}`);
  } catch (e) {
    log('WARN', 'GH-ПЕРСОНАЖИ', 'Сервер недоступен — используем локальный кэш');
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

  // Update dynamic character count (total including custom)
  const countEl = document.getElementById('welcome-char-count');
  if (countEl) countEl.textContent = `${state.characters.length}`;

  if (filter.search) {
    const q = filter.search.toLowerCase();
    const qNum = parseInt(q, 10);
    chars = chars.filter(c => c.name_ru.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || c.tags.some(t => t.includes(q)) || (qNum && c.numeric_id === qNum) || (c.numeric_id && String(c.numeric_id).includes(q)));
  }
  if (filter.group) chars = chars.filter(c => c.group === filter.group);
  if (filter.compat) chars = chars.filter(c => c.compatibility === filter.compat);

  grid.innerHTML = chars.map(c => {
    const isA = state.selectedA?.id === c.id;
    const isB = state.selectedB?.id === c.id;
    const selCls = isA ? 'selected ring-2 ring-violet-500' : isB ? 'selected ring-2 ring-indigo-500' : '';
    const tagCls = c.compatibility === 'meme' ? 'tag-green' : c.compatibility === 'conflict' ? 'tag-pink' : c.compatibility === 'chaotic' ? 'tag-orange' : c.compatibility === 'calm' ? '' : 'tag-purple';
    const compatRu = { meme: 'мем', conflict: 'конфликт', chaotic: 'хаос', calm: 'спокойный', balanced: 'баланс' };
    const paceRu = { fast: 'быстрая', normal: 'средняя', slow: 'медленная' };

    // Detail sections
    const anchors = c.identity_anchors || {};

    return `
    <div class="char-card ${selCls}" data-id="${c.id}">
      <div class="flex items-center justify-between mb-1">
        <span class="text-sm font-bold text-white">${c.numeric_id ? `<span class="text-[10px] text-gray-500 font-mono mr-1">#${c.numeric_id}</span>` : ''}${c.name_ru}</span>
        <span class="tag text-[10px] ${tagCls}">${compatRu[c.compatibility] || c.compatibility}</span>
      </div>
      ${c.tagline_ru ? `<div class="text-[11px] text-violet-300/90 mb-1.5 leading-snug">${c.tagline_ru}</div>` : ''}
      <div class="text-[10px] text-gray-500 mb-2 flex flex-wrap gap-x-2">
        <span>🎭 ${c.group}</span>
        <span>⚡ ${paceRu[c.speech_pace] || c.speech_pace}</span>
        <span>🔥 мат ${c.swear_level}/3</span>
        <span>${c.role_default === 'A' ? '🅰️' : '🅱️'} ${c.role_default === 'A' ? 'провокатор' : 'панчлайн'}</span>
      </div>

      <!-- Select buttons — large & clear -->
      <div class="flex gap-2 mb-2">
        <button class="select-a flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isA ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-id="${c.id}">${isA ? '✓ Выбран A' : '🅰️ Выбрать A'}</button>
        <button class="select-b flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isB ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20' : 'bg-indigo-600/10 text-indigo-300 border-indigo-500/20 hover:bg-indigo-600/25 hover:border-indigo-500/40'}" data-id="${c.id}">${isB ? '✓ Выбран B' : '🅱️ Выбрать B'}</button>
      </div>

      <!-- Copy Prompt Button -->
      <button class="copy-char-prompt text-[10px] px-2 py-1.5 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full flex items-center justify-center gap-1" data-id="${c.id}" title="Скопировать детализированный промпт для Veo">
        <span>📋</span> Копировать промпт
      </button>

      <!-- Expandable detail -->
      <details class="group">
        <summary class="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">Подробнее ▸</summary>
        <div class="mt-2 space-y-2.5 text-[11px] border-t border-gray-800/60 pt-2.5">

          ${c.vibe_archetype ? `<div class="mb-1.5"><span class="text-violet-400 font-medium">🎪 Архетип:</span> <span class="text-gray-200 font-medium">${c.vibe_archetype}</span></div>` : ''}

          ${c.speech_style_ru ? `<div><span class="text-violet-400 font-medium">🗣 Речь:</span> <span class="text-gray-300">${c.speech_style_ru}</span></div>` : ''}

          ${anchors.signature_element ? `<div><span class="text-violet-400 font-medium">✨ Фишка:</span> <span class="text-gray-300">${translateEnRu(anchors.signature_element)}</span></div>` : ''}

          ${anchors.micro_gesture ? `<div><span class="text-violet-400 font-medium">🤌 Жест:</span> <span class="text-gray-300">${translateEnRu(anchors.micro_gesture)}</span></div>` : ''}

          ${c.modifiers?.hook_style ? `<div><span class="text-violet-400 font-medium">🎣 Хук:</span> <span class="text-gray-300">${translateEnRu(c.modifiers.hook_style)}</span></div>` : ''}
          ${c.modifiers?.laugh_style ? `<div><span class="text-violet-400 font-medium">😂 Смех:</span> <span class="text-gray-300">${translateEnRu(c.modifiers.laugh_style)}</span></div>` : ''}

          <div class="mt-2">
            <div class="text-violet-400 font-medium mb-1">📝 Внешность:</div>
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
  grid.querySelectorAll('.copy-char-prompt').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyCharacterPrompt(btn.dataset.id); });
  });
}

function selectChar(role, id) {
  const char = state.characters.find(c => c.id === id);
  if (!char) return;

  // Toggle: if same character already in this role → deselect
  if (role === 'A' && state.selectedA?.id === id) {
    state.selectedA = null;
    sfx.clickSoft();
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'ПЕРСОНАЖИ', `A: сброшен`);
    updateReadiness();
    return;
  }
  if (role === 'B' && state.selectedB?.id === id) {
    state.selectedB = null;
    sfx.clickSoft();
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'ПЕРСОНАЖИ', `B: сброшен`);
    updateReadiness();
    return;
  }

  sfx.select();
  if (role === 'A') { state.selectedA = char; } else { state.selectedB = char; }
  updateCharDisplay();
  renderCharacters(getCurrentFilters());
  log('INFO', 'ПЕРСОНАЖИ', `${role}: ${char.name_ru} (${char.compatibility})`);
  updateReadiness();
}

function deselectChar(role) {
  if (role === 'A') state.selectedA = null;
  else state.selectedB = null;
  sfx.clickSoft();
  updateCharDisplay();
  renderCharacters(getCurrentFilters());
  log('INFO', 'ПЕРСОНАЖИ', `${role}: сброшен`);
  updateReadiness();
}
window.deselectChar = deselectChar;

// ─── AUTO-SELECT CHARACTERS FOR CATEGORY ───────────────
// Умный автоподбор персонажей под категорию/тренд
function autoSelectCharactersForCategory(categoryRu, topicRu = '') {
  if (!state.characters || state.characters.length === 0) return false;

  // Category → character group preferences
  const categoryHints = {
    'Бытовой абсурд': ['бабки', 'деды', 'соседи'],
    'AI и технологии': ['бабки', 'деды', 'студенты', 'блогеры'],
    'Цены и инфляция': ['бабки', 'деды', 'пенсионеры', 'продавцы'],
    'Отношения': ['мамы', 'папы', 'тёщи', 'свекрови'],
    'Разрыв поколений': ['бабки', 'деды', 'дочери', 'сыновья', 'студенты'],
    'ЖКХ и коммуналка': ['бабки', 'деды', 'соседи', 'пенсионеры'],
    'Здоровье и поликлиника': ['бабки', 'деды', 'врачи', 'пенсионеры'],
    'Соцсети и тренды': ['бабки', 'блогеры', 'дочери', 'студенты'],
    'Дача и огород': ['бабки', 'деды', 'соседи'],
    'Транспорт и пробки': ['бабки', 'деды', 'таксисты', 'соседи'],
  };

  const preferredGroups = categoryHints[categoryRu] || ['бабки', 'деды'];
  
  // Filter characters by preferred groups
  const candidates = state.characters.filter(c => preferredGroups.includes(c.group));
  if (candidates.length < 2) {
    // Fallback: use all characters
    return autoSelectRandomPair();
  }

  // Find best pair: different compatibility types for contrast
  // Priority: chaotic+calm > conflict+calm > chaotic+balanced > any mix
  const chaotic = candidates.filter(c => c.compatibility === 'chaotic');
  const calm = candidates.filter(c => c.compatibility === 'calm');
  const conflict = candidates.filter(c => c.compatibility === 'conflict');
  const balanced = candidates.filter(c => c.compatibility === 'balanced' || c.compatibility === 'meme');

  let charA, charB;

  // Try explosive pair: chaotic + calm
  if (chaotic.length > 0 && calm.length > 0) {
    charA = chaotic[Math.floor(Math.random() * chaotic.length)];
    charB = calm.find(c => c.id !== charA.id) || calm[0];
  }
  // Try conflict + calm
  else if (conflict.length > 0 && calm.length > 0) {
    charA = conflict[Math.floor(Math.random() * conflict.length)];
    charB = calm.find(c => c.id !== charA.id) || calm[0];
  }
  // Try chaotic + balanced
  else if (chaotic.length > 0 && balanced.length > 0) {
    charA = chaotic[Math.floor(Math.random() * chaotic.length)];
    charB = balanced.find(c => c.id !== charA.id) || balanced[0];
  }
  // Random from candidates
  else {
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    charA = shuffled[0];
    charB = shuffled[1] || shuffled[0];
  }

  if (!charA || !charB || charA.id === charB.id) return false;

  // Prefer role_default if set
  if (charA.role_default === 'B' && charB.role_default === 'A') {
    [charA, charB] = [charB, charA];
  }

  state.selectedA = charA;
  state.selectedB = charB;
  updateCharDisplay();
  
  log('OK', 'АВТОПОДБОР', `Выбрано: ${charA.name_ru} × ${charB.name_ru} для категории "${categoryRu}"`);
  return true;
}

function updateCharDisplay() {
  // A slot
  const charAName = document.getElementById('char-a-name');
  if (charAName) {
    if (state.selectedA) {
      charAName.innerHTML = `<span class="text-white">${escapeHtml(state.selectedA.name_ru)} • ${escapeHtml(state.selectedA.group)}</span> <button onclick="deselectChar('A')" class="ml-2 text-[10px] text-red-400/60 hover:text-red-400 transition-colors" title="Сбросить A">✕</button>`;
    } else {
      charAName.innerHTML = '<span class="text-gray-400">Нажми на персонажа ↓</span>';
    }
  }
  // B slot
  const charBName = document.getElementById('char-b-name');
  if (charBName) {
    if (state.selectedB) {
      charBName.innerHTML = `<span class="text-white">${escapeHtml(state.selectedB.name_ru)} • ${escapeHtml(state.selectedB.group)}</span> <button onclick="deselectChar('B')" class="ml-2 text-[10px] text-red-400/60 hover:text-red-400 transition-colors" title="Сбросить B">✕</button>`;
    } else {
      charBName.innerHTML = '<span class="text-gray-400">Нажми на второго или пропусти ↓</span>';
    }
  }

  document.getElementById('sidebar-char-a').innerHTML = `<span class="w-1 h-1 rounded-full bg-cyan-400/50 inline-block"></span>A: ${state.selectedA?.name_ru || '—'}`;
  document.getElementById('sidebar-char-b').innerHTML = `<span class="w-1 h-1 rounded-full bg-purple-400/50 inline-block"></span>B: ${state.selectedB?.name_ru || '—'}`;
  document.getElementById('gen-char-a').textContent = state.selectedA?.name_ru || '—';
  document.getElementById('gen-char-b').textContent = state.selectedB?.name_ru || '—';

  // Compatibility badge
  const badge = document.getElementById('char-compat-badge');
  if (state.selectedA && state.selectedB) {
    const combos = [state.selectedA.compatibility, state.selectedB.compatibility];
    let label = 'сбалансированная пара';
    if (combos.includes('chaotic') && combos.includes('calm')) label = '🔥 взрывная пара!';
    else if (combos.every(c => c === 'meme')) label = '😂 мем-пара';
    else if (combos.every(c => c === 'conflict')) label = '⚡ конфликт!';
    else if (combos.includes('chaotic')) label = '🌪 хаос!';
    if (badge) { badge.classList.remove('hidden'); badge.querySelector('.tag').textContent = label; }
  } else {
    if (badge) badge.classList.add('hidden');
  }

  // Show/hide "Далее" button — show when at least A is selected
  const goBtn = document.getElementById('btn-go-generate');
  if (goBtn) {
    if (state.selectedA) {
      goBtn.classList.remove('hidden');
      goBtn.textContent = state.selectedB ? 'Далее → Локация и сборка промпта' : 'Далее → Соло-ролик (без B)';
    } else {
      goBtn.classList.add('hidden');
    }
  }

  // Run smart match analysis
  updateSmartMatch();
  
  // Update progress tracker
  updateProgress();
}

// ─── SMART MATCH ANALYSIS ──────────────────────
function updateSmartMatch() {
  const panel = document.getElementById('smart-match-panel');
  if (!panel) return;

  // Need at least one character selected
  if (!state.selectedA && !state.selectedB) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const topic = document.getElementById('idea-input')?.value?.trim() || '';
  const loc = state.locations?.find(l => l.id === state.selectedLocation);
  const charA = state.selectedA;
  const charB = state.selectedB;

  // ── Calculate scores ──
  let scores = [];
  let tips = [];
  let details = [];

  // 1. Pair chemistry (if both selected)
  if (charA && charB) {
    const chemScore = calcPairChemistry(charA, charB);
    scores.push(chemScore.score);
    details.push({ label: '🎭 Химия пары', value: chemScore.score, text: chemScore.text });
    if (chemScore.tip) tips.push(chemScore.tip);
  }

  // 2. Topic relevance (if topic entered)
  if (topic && (charA || charB)) {
    const topicScore = calcTopicRelevance(topic, charA, charB);
    scores.push(topicScore.score);
    details.push({ label: '🎯 Тема + персонажи', value: topicScore.score, text: topicScore.text });
    if (topicScore.tip) tips.push(topicScore.tip);
  }

  // 3. Location match (if location selected)
  if (loc && (charA || charB)) {
    const locScore = calcLocationMatch(loc, charA, charB);
    scores.push(locScore.score);
    details.push({ label: '📍 Локация + персонажи', value: locScore.score, text: locScore.text });
    if (locScore.tip) tips.push(locScore.tip);
  }

  // 4. Role balance
  if (charA && charB) {
    const roleScore = calcRoleBalance(charA, charB);
    scores.push(roleScore.score);
    details.push({ label: '⚖️ Баланс ролей', value: roleScore.score, text: roleScore.text });
    if (roleScore.tip) tips.push(roleScore.tip);
  }

  // Overall score
  const overall = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  // ── Render ──
  const fill = document.getElementById('match-progress-fill');
  const badge = document.getElementById('match-score-badge');
  const detailsEl = document.getElementById('match-details');
  const tipsEl = document.getElementById('match-tips');
  const tipsListEl = document.getElementById('match-tips-list');

  // Progress bar + badge
  fill.style.width = `${overall}%`;
  if (overall >= 80) {
    fill.className = 'h-full rounded-full transition-all duration-500 bg-emerald-500';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400';
    badge.textContent = `${overall}% отлично`;
  } else if (overall >= 55) {
    fill.className = 'h-full rounded-full transition-all duration-500 bg-amber-500';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400';
    badge.textContent = `${overall}% нормально`;
  } else {
    fill.className = 'h-full rounded-full transition-all duration-500 bg-red-400';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/20 text-red-400';
    badge.textContent = `${overall}% слабо`;
  }

  // Details
  detailsEl.innerHTML = details.map(d => {
    const color = d.value >= 80 ? 'text-emerald-400' : d.value >= 55 ? 'text-amber-400' : 'text-red-400';
    const bar = Math.round(d.value / 10);
    const full = '█'.repeat(bar);
    const empty = '░'.repeat(10 - bar);
    return `<div class="flex items-center justify-between gap-2">
      <span class="text-gray-400">${d.label}</span>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] ${color}">${full}${empty}</span>
        <span class="${color} font-bold w-8 text-right">${d.value}%</span>
      </div>
    </div>
    <div class="text-[10px] text-gray-500 -mt-1 ml-4">${d.text}</div>`;
  }).join('');

  // Tips
  if (tips.length > 0) {
    tipsEl.classList.remove('hidden');
    tipsListEl.innerHTML = tips.map(t => `<div class="flex items-start gap-1.5"><span class="text-amber-400 flex-shrink-0">→</span><span>${t}</span></div>`).join('');
  } else {
    tipsEl.classList.add('hidden');
  }
}

function calcPairChemistry(a, b) {
  let score = 50; // base
  let text = '';
  let tip = '';

  // Great combos
  const c = [a.compatibility, b.compatibility].sort().join('+');
  const greatCombos = { 'calm+chaotic': 30, 'chaotic+meme': 20, 'conflict+meme': 20, 'calm+conflict': 25, 'balanced+chaotic': 15, 'balanced+meme': 15 };
  const okCombos = { 'balanced+balanced': 10, 'balanced+calm': 5, 'balanced+conflict': 10, 'calm+meme': 10 };
  const weakCombos = { 'calm+calm': -10, 'conflict+conflict': 5 };

  if (greatCombos[c] !== undefined) { score += greatCombos[c]; text = 'Контраст стилей создаёт энергию'; }
  else if (okCombos[c] !== undefined) { score += okCombos[c]; text = 'Нормальное сочетание, работает'; }
  else if (weakCombos[c] !== undefined) { score += weakCombos[c]; text = 'Одинаковые стили — мало конфликта'; tip = 'Попробуй пару с контрастными стилями (хаос+спокойный, мем+конфликт)'; }
  else { score += 10; text = 'Стандартное сочетание'; }

  // Speech pace contrast bonus
  if (a.speech_pace !== b.speech_pace) { score += 10; text += ', темп речи контрастный'; }
  else if (a.speech_pace === 'slow' && b.speech_pace === 'slow') { score -= 5; }

  // Different groups = more interesting
  if (a.group !== b.group) { score += 10; }
  else { tip = tip || 'Персонажи из разных групп обычно создают более интересные конфликты'; }

  return { score: Math.min(100, Math.max(10, score)), text, tip };
}

function calcTopicRelevance(topic, charA, charB) {
  const t = topic.toLowerCase();
  let score = 60; // base — most topics work with most chars
  let text = '';
  let tip = '';

  // Topic keywords → character group affinity
  const groupAffinities = {
    'бабки': ['рецепт', 'дач', 'огород', 'варен', 'внук', 'пенси', 'поликлиник', 'здоровь', 'цен', 'магазин', 'подъезд', 'сплетн', 'сосед', 'церк'],
    'деды': ['рыбалк', 'гараж', 'мастерск', 'инструмент', 'ремонт', 'совет', 'армия', 'война', 'спорт', 'футбол', 'политик', 'философ'],
    'мамы': ['школ', 'ребён', 'дет', 'родител', 'учител', 'оцен', 'готов', 'кухн', 'уборк', 'порядок', 'инстаграм', 'блог', 'фитнес'],
    'папы': ['машин', 'гараж', 'ремонт', 'работ', 'началь', 'зарплат', 'отпуск', 'рыбалк', 'шашлык', 'футбол', 'пив', 'дач'],
    'дочери': ['тикток', 'инстаграм', 'мод', 'одежд', 'универ', 'учёб', 'парн', 'свидан', 'кофе', 'вега', 'экологи', 'справедлив'],
    'сыновья': ['игр', 'комп', 'телефон', 'спорт', 'качалк', 'музык', 'рэп', 'скейт', 'доставк', 'курьер'],
    'соседи': ['подъезд', 'шум', 'ремонт', 'парков', 'мусор', 'собак', 'музык', 'жкх', 'сосед'],
    'профессионалы': ['работ', 'врач', 'учител', 'охран', 'офис', 'начальн', 'клиент', 'пациент'],
    'блогеры': ['контент', 'лайк', 'подписчик', 'сториз', 'тикток', 'инстаграм', 'камер', 'блог'],
    'повара': ['еда', 'готов', 'рецепт', 'кухн', 'борщ', 'пирож', 'ресторан', 'вкус'],
    'чиновники': ['документ', 'справк', 'очеред', 'бюрократ', 'закон', 'штраф', 'паспорт', 'мфц'],
    'тёщи': ['зят', 'невестк', 'свадьб', 'семь', 'праздник', 'родител'],
    'продавцы': ['рынок', 'цен', 'торг', 'товар', 'покупат', 'скидк', 'магазин'],
    'спортсмены': ['спорт', 'трениров', 'зал', 'бег', 'качалк', 'фитнес', 'диет', 'протеин'],
    'айтишники': ['код', 'программ', 'комп', 'баг', 'сайт', 'приложен', 'AI', 'робот'],
  };

  const chars = [charA, charB].filter(Boolean);
  let matched = 0;
  let total = 0;

  chars.forEach(ch => {
    total++;
    const group = ch.group;
    const keywords = groupAffinities[group] || [];
    const hasMatch = keywords.some(kw => t.includes(kw));

    // Also check character-specific keywords
    const charKeywords = (ch.signature_words_ru || []).concat(ch.tags || []);
    const charMatch = charKeywords.some(kw => t.includes(kw.toLowerCase()));

    if (hasMatch || charMatch) matched++;
  });

  if (total === 0) return { score: 60, text: 'Не выбраны персонажи', tip: '' };

  if (matched === total) {
    score = 85 + Math.floor(Math.random() * 10);
    text = 'Персонажи идеально подходят к теме';
  } else if (matched > 0) {
    score = 65 + Math.floor(Math.random() * 10);
    text = 'Один из персонажей хорошо подходит к теме';
    const weak = chars.find(ch => {
      const kw = groupAffinities[ch.group] || [];
      return !kw.some(k => t.includes(k));
    });
    if (weak) tip = `${weak.name_ru} (${weak.group}) не очень связан с темой «${topic.slice(0, 30)}...» — но AI может обыграть контраст`;
  } else {
    score = 35 + Math.floor(Math.random() * 15);
    text = 'Персонажи не типичны для этой темы';
    const groups = Object.entries(groupAffinities).filter(([_, kws]) => kws.some(kw => t.includes(kw))).map(([g]) => g);
    if (groups.length > 0) {
      tip = `Для темы «${topic.slice(0, 25)}...» лучше подойдут: ${groups.slice(0, 3).join(', ')}`;
    } else {
      tip = 'Тема универсальная — любые персонажи подойдут, но контраст стилей важнее';
      score = 60;
      text = 'Универсальная тема — подойдут любые персонажи';
    }
  }

  return { score: Math.min(100, Math.max(10, score)), text, tip };
}

function calcLocationMatch(loc, charA, charB) {
  let score = 60;
  let text = '';
  let tip = '';

  const chars = [charA, charB].filter(Boolean);
  if (chars.length === 0) return { score: 60, text: 'Не выбраны персонажи', tip: '' };

  // Location group → character group affinity map
  const locCharAffinity = {
    'деревня': ['бабки', 'деды', 'повара'],
    'город': ['мамы', 'папы', 'соседи', 'профессионалы', 'блогеры', 'чиновники', 'айтишники'],
    'пляж': ['мамы', 'папы', 'дочери', 'сыновья'],
    'спорт': ['сыновья', 'дочери', 'спортсмены', 'папы'],
    'кафе': ['мамы', 'дочери', 'блогеры', 'папы'],
    'офис': ['профессионалы', 'айтишники', 'мамы', 'папы'],
    'учреждения': ['бабки', 'деды', 'чиновники', 'мамы'],
    'красота': ['мамы', 'дочери', 'блогеры', 'бабки'],
    'отдых': ['папы', 'деды', 'сыновья', 'мамы'],
    'развлечения': ['дочери', 'сыновья', 'мамы', 'папы'],
    'промышленность': ['деды', 'папы', 'профессионалы'],
  };

  const affinity = locCharAffinity[loc.group] || [];
  let matched = 0;
  chars.forEach(ch => { if (affinity.includes(ch.group)) matched++; });

  if (matched === chars.length) {
    score = 80 + Math.floor(Math.random() * 15);
    text = `${loc.name_ru} — естественная среда для этих персонажей`;
  } else if (matched > 0) {
    score = 60 + Math.floor(Math.random() * 15);
    text = `Один персонаж органичен в ${loc.name_ru}, другой создаст контраст`;
  } else {
    score = 35 + Math.floor(Math.random() * 15);
    text = `Персонажи нетипичны для ${loc.name_ru}`;
    tip = `${loc.name_ru} больше подходит для: ${affinity.slice(0, 3).join(', ')} — но контраст «персонаж не на своём месте» тоже смешно!`;
  }

  // World aesthetic bonus
  chars.forEach(ch => {
    if (ch.world_aesthetic && loc.tags?.some(t => ch.world_aesthetic.toLowerCase().includes(t))) {
      score += 10;
    }
  });

  return { score: Math.min(100, Math.max(10, score)), text, tip };
}

function calcRoleBalance(a, b) {
  let score = 70;
  let text = '';
  let tip = '';

  // Check if one is A-type and other is B-type
  if (a.role_default === 'A' && b.role_default === 'B') {
    score = 90;
    text = 'A-провокатор + B-панчлайн — идеальный баланс';
  } else if (a.role_default === 'B' && b.role_default === 'A') {
    score = 75;
    text = 'Роли перевёрнуты — AI подстроит, но лучше поменять местами (⇄)';
    tip = 'Нажми ⇄ чтобы поменять местами — A должен провоцировать, B отвечать';
  } else if (a.role_default === 'A' && b.role_default === 'A') {
    score = 55;
    text = 'Оба провокаторы — будет хаос, но не всегда структурно';
    tip = 'Два провокатора могут перебивать друг друга — попробуй одного заменить на B-типа';
  } else {
    score = 50;
    text = 'Оба панчлайнеры — кто будет провоцировать?';
    tip = 'Нужен хотя бы один провокатор (A) — посмотри персонажей с 🅰️';
  }

  return { score, text, tip };
}

function getCurrentFilters() {
  return {
    search: document.getElementById('char-search')?.value || '',
    group: document.getElementById('char-group-filter')?.value || '',
    compat: document.getElementById('char-compat-filter')?.value || '',
  };
}

function autoSelectRandomPair() {
  const chars = state.characters;
  if (!chars || chars.length < 2) return false;
  const idxA = Math.floor(Math.random() * chars.length);
  let idxB = Math.floor(Math.random() * (chars.length - 1));
  if (idxB >= idxA) idxB++;
  state.selectedA = chars[idxA];
  state.selectedB = chars[idxB];
  updateCharDisplay();
  log('INFO', 'АВТОПОДБОР', `Случайная пара: ${chars[idxA].name_ru} × ${chars[idxB].name_ru}`);
  return true;
}

// ─── RANDOM PAIR ─────────────────────────────
function initRandomPair() {
  document.getElementById('btn-random-pair')?.addEventListener('click', () => {
    const chars = state.characters;
    if (!chars || chars.length < 2) return;
    // Pick two different random characters
    const idxA = Math.floor(Math.random() * chars.length);
    let idxB = Math.floor(Math.random() * (chars.length - 1));
    if (idxB >= idxA) idxB++;
    selectChar('A', chars[idxA].id);
    selectChar('B', chars[idxB].id);
    log('INFO', 'ПЕРСОНАЖИ', `🎲 Случайная пара: ${chars[idxA].name_ru} × ${chars[idxB].name_ru}`);
  });
}

// ─── NAVIGATION ──────────────────────────────
function navigateTo(section) {
  sfx.nav();
  // Gentle reminder if user skips mode selection (don't block)
  if ((section === 'content' || section === 'characters') && !state.generationMode) {
    showNotification('💡 Совет: сначала выберите режим генерации на шаге 1', 'warning');
  }

  // When navigating to content section, show the right mode panel
  if (section === 'content' && state.generationMode) {
    updateModeSpecificUI(state.generationMode);
  }
  
  // Update navigation UI
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('.section-panel').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.remove('hidden');
  
  // Scroll workspace to top
  document.getElementById('workspace')?.scrollTo(0, 0);
  
  // Update progress indicators
  updateProgressIndicators(section);

  // Update readiness checklist when entering generate section
  if (section === 'generate') {
    updateReadiness();
    // Update char summary for solo mode
    _updateGenCharSummary();
  }

  // Refresh smart match when navigating to characters
  if (section === 'characters') updateSmartMatch();
  
  // Log navigation for debugging
  log('INFO', 'НАВИГАЦИЯ', `Переход к разделу: ${section}`);
}

function updateProgressIndicators(currentSection) {
  const sections = ['ideas', 'generation-mode', 'content', 'characters', 'locations', 'generate'];
  const currentIndex = sections.indexOf(currentSection);
  
  sections.forEach((section, index) => {
    const indicator = document.querySelector(`#section-${section} .rounded-full`);
    if (indicator) {
      if (index < currentIndex) {
        // Completed sections
        indicator.className = 'flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white text-sm font-bold';
        indicator.textContent = '✓';
      } else if (index === currentIndex) {
        // Current section
        const colors = {
          'ideas': 'bg-amber-600',
          'generation-mode': 'bg-violet-600',
          'content': 'bg-cyan-600',
          'characters': 'bg-cyan-600',
          'locations': 'bg-violet-600',
          'generate': 'bg-gradient-to-r from-emerald-600 to-cyan-600'
        };
        indicator.className = `flex items-center justify-center w-8 h-8 rounded-full ${colors[section] || 'bg-gray-600'} text-white text-sm font-bold`;
        indicator.textContent = (index + 1).toString();
      } else {
        // Future sections
        indicator.className = 'flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 text-gray-400 text-sm font-bold';
        indicator.textContent = (index + 1).toString();
      }
    }
  });
}

function _updateGenCharSummary() {
  const a = state.selectedA;
  const b = state.selectedB;
  const genA = document.getElementById('gen-char-a');
  const genB = document.getElementById('gen-char-b');
  const sep = document.getElementById('gen-char-separator');
  const bWrap = document.getElementById('gen-char-b-wrap');
  if (genA) genA.textContent = a ? a.name_ru : '—';
  if (b) {
    if (genB) genB.textContent = b.name_ru;
    if (sep) sep.classList.remove('hidden');
    if (bWrap) bWrap.classList.remove('hidden');
  } else {
    if (sep) sep.classList.add('hidden');
    if (bWrap) bWrap.classList.add('hidden');
  }
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.section);
      // Close mobile menu after navigation
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar')?.classList.remove('mobile-open');
      }
    });
  });
  
  // Mobile menu toggle
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && 
          !sidebar.contains(e.target) && 
          !mobileToggle.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('mobile-open');
    }
  });

  // "Далее" button on characters → go to generate (step 4: location + generate)
  document.getElementById('btn-go-generate')?.addEventListener('click', () => {
    if (!state.selectedA) {
      showNotification('⚠️ Сначала выберите хотя бы одного персонажа (A)', 'warning');
      return;
    }
    navigateTo('generate');
  });

  // "Далее" button on content → go to characters
  document.getElementById('btn-content-to-characters')?.addEventListener('click', () => {
    navigateTo('characters');
  });

  // "← Сменить персонажей" on generate → go back to characters
  document.getElementById('gen-back-chars')?.addEventListener('click', () => {
    navigateTo('characters');
  });

  // Add location continue button
  document.getElementById('btn-go-generate-from-locations')?.addEventListener('click', () => {
    if (!state.generationMode) {
      showNotification('⚠️ Сначала выберите режим генерации', 'warning');
      navigateTo('generation-mode');
      return;
    }
    if (!state.selectedA) {
      showNotification('⚠️ Сначала выберите хотя бы одного персонажа', 'warning');
      navigateTo('characters');
      return;
    }
    navigateTo('generate');
  });
}

// ─── GENERATION MODE SELECTION ─────────────────────
function initGenerationMode() {
  // Mode card selection
  document.querySelectorAll('.generation-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      selectGenerationMode(mode);
    });
  });

  // Continue button — go to content input (step 2)
  document.getElementById('btn-continue-to-content')?.addEventListener('click', () => {
    if (state.generationMode) {
      navigateTo('content');
    } else {
      showNotification('⚠️ Сначала выберите режим генерации из списка выше', 'warning');
    }
  });

  // Change mode button
  document.getElementById('change-mode-btn')?.addEventListener('click', () => {
    navigateTo('generation-mode');
  });
}

function selectGenerationMode(mode) {
  sfx.select();
  state.generationMode = mode;
  state.inputMode = mode; // Keep compatibility with existing logic
  
  // Update UI
  document.querySelectorAll('.generation-mode-card').forEach(card => {
    card.classList.remove('ring-2', 'ring-cyan-500', 'ring-purple-500', 'ring-amber-500', 'ring-emerald-500', 'ring-rose-500');
  });
  
  const selectedCard = document.querySelector(`.generation-mode-card[data-mode="${mode}"]`);
  if (selectedCard) {
    const colors = {
      idea: 'ring-cyan-500',
      suggested: 'ring-emerald-500',
      script: 'ring-purple-500', 
      video: 'ring-amber-500',
      meme: 'ring-rose-500'
    };
    selectedCard.classList.add('ring-2', colors[mode] || 'ring-cyan-500');
  }

  // Update selected mode display
  const display = document.getElementById('selected-mode-display');
  const nameEl = document.getElementById('selected-mode-name');
  const continueBtn = document.getElementById('btn-continue-to-content');
  
  if (display && nameEl && continueBtn) {
    display.classList.remove('hidden');
    const modeNames = {
      idea: '💡 Своя идея',
      suggested: '📚 Готовые идеи',
      script: '📝 Свой диалог',
      video: '🎥 По видео',
      meme: '🎭 Мем-ремейк'
    };
    nameEl.textContent = modeNames[mode] || mode;
    continueBtn.disabled = false;
    continueBtn.innerHTML = `<span>Далее → Описать контент</span><span>→</span>`;

    // Show mode-specific hint
    const hintEl = document.getElementById('selected-mode-hint');
    if (hintEl) {
      const hints = {
        idea: '💡 На следующем шаге опишите свою идею, затем выберете персонажей.',
        suggested: '📚 На следующем шаге выберите тему из трендов или оставьте пустым — AI подберёт.',
        script: '📝 На следующем шаге напишите реплики для персонажей. Реплика B опциональна для соло-ролика.',
        video: '🎥 На следующем шаге загрузите видео-файл (MP4/MOV) для ремейка.',
        meme: '🎭 Загрузите мем/видео и опишите что на нём. Получите промпт Frame 0 + анимацию для Kling 2.6.',
      };
      const hint = hints[mode] || '';
      if (hint) {
        hintEl.innerHTML = hint;
        hintEl.classList.remove('hidden');
      } else {
        hintEl.classList.add('hidden');
      }
    }
  }

  // Update mode-specific UI
  updateModeSpecificUI(mode);
  
  // Update progress tracker
  updateProgress();
  updateReadiness();
}

function updateModeSpecificUI(mode) {
  // Hide all mode-specific elements in Advanced section
  document.getElementById('mode-idea')?.classList.add('hidden');
  document.getElementById('mode-script')?.classList.add('hidden');
  document.getElementById('mode-video')?.classList.add('hidden');

  // Toggle remix panels on the main Generate page
  document.getElementById('remix-idea')?.classList.add('hidden');
  document.getElementById('remix-suggested')?.classList.add('hidden');
  document.getElementById('remix-script')?.classList.add('hidden');
  document.getElementById('remix-video')?.classList.add('hidden');
  document.getElementById('remix-meme')?.classList.add('hidden');

  // Show relevant mode elements
  if (mode === 'idea') {
    document.getElementById('mode-idea')?.classList.remove('hidden');
    document.getElementById('remix-idea')?.classList.remove('hidden');
    // Ensure idea-input is visible (may have been hidden by previous suggested mode)
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.style.display = '';
    initIdeaSubModes();
  } else if (mode === 'suggested') {
    document.getElementById('mode-idea')?.classList.remove('hidden');
    document.getElementById('remix-suggested')?.classList.remove('hidden');
    loadTrendingIdeasMain();
  } else if (mode === 'script') {
    document.getElementById('mode-script')?.classList.remove('hidden');
    document.getElementById('remix-script')?.classList.remove('hidden');
  } else if (mode === 'video') {
    document.getElementById('mode-video')?.classList.remove('hidden');
    document.getElementById('remix-video')?.classList.remove('hidden');
    initVideoDropzoneMain();
  } else if (mode === 'meme') {
    document.getElementById('remix-meme')?.classList.remove('hidden');
    initMemeDropzone();
  }

  log('INFO', 'РЕЖИМ', `Выбран режим: ${mode}`);
}

// ─── IDEA SUB-MODES ─────────────────────
function initIdeaSubModes() {
  // Sub-mode tab switching
  document.querySelectorAll('.mode-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subMode = btn.dataset.subMode;
      selectIdeaSubMode(subMode);
    });
  });
}

function selectIdeaSubMode(subMode) {
  // Update tab appearance
  document.querySelectorAll('.mode-sub-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.mode-sub-btn[data-sub-mode="${subMode}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Show/hide sub-mode content
  document.getElementById('sub-mode-custom')?.classList.toggle('hidden', subMode !== 'custom');
  document.getElementById('sub-mode-trending')?.classList.toggle('hidden', subMode !== 'trending');
  
  // Update main idea input visibility
  const mainInput = document.getElementById('idea-input');
  const customInput = document.getElementById('idea-input-custom');
  
  if (subMode === 'custom') {
    // Copy custom input to main input
    if (customInput && mainInput) {
      mainInput.value = customInput.value;
    }
    mainInput.style.display = 'block';
  } else if (subMode === 'trending') {
    // Hide main input, show trending ideas
    mainInput.style.display = 'none';
    loadTrendingIdeas();
  }
  
  // Update state
  state.ideaSubMode = subMode;
  log('INFO', 'ПОДРЕЖИМ ИДЕИ', `Выбран подрежим: ${subMode}`);
}

async function loadTrendingIdeas() {
  const grid = document.getElementById('trending-ideas-grid');
  if (!grid) return;
  
  // Show loading state
  grid.innerHTML = '<div class="text-xs text-gray-500 text-center">🔍 Загружаем популярные темы...</div>';
  
  try {
    const response = await fetch('/api/trending');
    const data = await response.json();
    
    if (data.trends && data.trends.length > 0) {
      grid.innerHTML = data.trends.map((trend, i) => `
        <div class="glass-panel p-3 border-l-2 border-emerald-500/40 cursor-pointer hover:bg-emerald-500/5 transition-all trending-idea-card" data-trend="${trend.topic}">
          <div class="text-xs text-emerald-400 font-medium mb-1">${trend.category}</div>
          <div class="text-sm text-gray-200 leading-relaxed">${trend.topic}</div>
          <div class="text-[10px] text-gray-500 mt-1">${trend.viral_score}% вирусности</div>
        </div>
      `).join('');
      
      // Add click handlers
      document.querySelectorAll('.trending-idea-card').forEach(card => {
        card.addEventListener('click', () => {
          const topic = card.dataset.trend;
          selectTrendingIdea(topic);
        });
      });
    } else {
      grid.innerHTML = '<div class="text-xs text-gray-500 text-center">📝 Идеи временно недоступны</div>';
    }
  } catch (error) {
    grid.innerHTML = '<div class="text-xs text-red-400 text-center">❌ Ошибка загрузки идей</div>';
    console.error('Error loading trending ideas:', error);
  }
}

// Load trending ideas into the main Generate page (for suggested mode)
async function loadTrendingIdeasMain() {
  const grid = document.getElementById('trending-ideas-main');
  if (!grid) return;

  grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">🔍 Загружаем популярные темы...</div>';

  try {
    const response = await fetch('/api/trending');
    const data = await response.json();

    if (data.trends && data.trends.length > 0) {
      grid.innerHTML = data.trends.map(trend => `
        <div class="glass-panel p-2.5 border-l-2 border-emerald-500/40 cursor-pointer hover:bg-emerald-500/5 transition-all trending-idea-main-card" data-trend="${trend.topic}">
          <div class="text-[10px] text-emerald-400 font-medium">${trend.category}</div>
          <div class="text-xs text-gray-200 leading-relaxed mt-0.5">${trend.topic}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.trending-idea-main-card').forEach(card => {
        card.addEventListener('click', () => selectTrendingIdeaMain(card.dataset.trend));
      });
    } else {
      grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">📝 Идеи временно недоступны — напишите свою тему ниже</div>';
    }
  } catch (error) {
    grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">📝 Идеи загрузятся позже — пока напишите свою тему ниже</div>';
    console.error('Error loading trending ideas (main):', error);
  }
}

function selectTrendingIdeaMain(topic) {
  // Fill the suggested mode textarea
  const suggestedInput = document.getElementById('idea-input-suggested');
  if (suggestedInput) suggestedInput.value = topic;
  // Also fill idea-input for payload compatibility
  const mainInput = document.getElementById('idea-input');
  if (mainInput) mainInput.value = topic;

  // Highlight selected card
  document.querySelectorAll('.trending-idea-main-card').forEach(c => c.classList.remove('ring-1', 'ring-emerald-500'));
  const card = document.querySelector(`.trending-idea-main-card[data-trend="${CSS.escape(topic)}"]`);
  if (card) card.classList.add('ring-1', 'ring-emerald-500');

  updateReadiness();
  log('INFO', 'ТРЕНД', `Выбрана тема: ${topic}`);
}

function selectTrendingIdea(topic) {
  const mainInput = document.getElementById('idea-input');
  if (mainInput) {
    mainInput.value = topic;
    mainInput.style.display = 'block';
  }
  
  // Switch back to custom sub-mode
  selectIdeaSubMode('custom');
  
  // Show confirmation
  const grid = document.getElementById('trending-ideas-grid');
  if (grid) {
    const notification = document.createElement('div');
    notification.className = 'text-xs text-emerald-400 bg-emerald-500/8 border border-emerald-500/15 rounded-lg p-2 mt-2';
    notification.textContent = `✅ Выбрана тема: ${topic}`;
    grid.parentNode.insertBefore(notification, grid.nextSibling);
    
    setTimeout(() => notification.remove(), 3000);
  }
  
  log('INFO', 'ТЕНДА', `Выбрана трендовая тема: ${topic}`);
}

// ─── CHARACTER CONTEXT RECOMMENDATIONS ─────────────────────
function getCharacterRecommendations(topicText) {
  if (!topicText) return [];
  
  const topicLower = topicText.toLowerCase();
  const recommendations = [];
  
  // ЖКХ и коммуналка
  if (topicLower.includes('жкх') || topicLower.includes('коммуналка') || topicLower.includes('отопление') || 
      topicLower.includes('счёт') || topicLower.includes('счет') || topicLower.includes('тариф')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Бывший бухгалтер — идеально для тем про счета и тарифы' },
      { id: 'babka_valya', reason: 'Бывшая доярка — жизненный опыт с коммуналкой' },
      { id: 'ded_boris', reason: 'Добрый гигант — спокойные объяснения по ЖКХ' },
      { id: 'ded_stepan', reason: 'Кузнец — практичный подход к бытовым проблемам' }
    );
  }
  
  // Цены и инфляция
  else if (topicLower.includes('цена') || topicLower.includes('дорого') || topicLower.includes('инфляция') || 
             topicLower.includes('магазин')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Бухгалтер — эксперт по ценам и расходам' },
      { id: 'mama_regina', reason: 'CEO домашнего хаоса — контроль бюджета' },
      { id: 'ded_matvey', reason: 'Щёголь — элегантно рассуждает о деньгах' },
      { id: 'papa_slava', reason: 'Ретроград — помнит цены из прошлого' }
    );
  }
  
  // Разрыв поколений
  else if (topicLower.includes('бабк') || topicLower.includes('дед') || topicLower.includes('внук') || 
             topicLower.includes('поколен') || topicLower.includes('зумер') || topicLower.includes('бумер')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Классическая бабка — конфликт поколений' },
      { id: 'ded_fyodor', reason: 'Молчаливый дед — контраст с внуками' },
      { id: 'doch_yana', reason: 'Неон-панк — типичный зумер' },
      { id: 'papa_artyom', reason: 'Хипстер с бородой — современный папа' }
    );
  }
  
  // Здоровье и поликлиника
  else if (topicLower.includes('больниц') || topicLower.includes('врач') || topicLower.includes('медицин') || 
             topicLower.includes('здоровье')) {
    recommendations.push(
      { id: 'mama_lyuba', reason: 'Травница — народная медицина' },
      { id: 'mama_alyona', reason: 'Ледяная блондинка — строгий подход к здоровью' },
      { id: 'papa_oleg', reason: 'Профессор — научный подход к медицине' },
      { id: 'ded_zakhar', reason: 'Морской волк — байки про здоровье' }
    );
  }
  
  // Дача и огород
  else if (topicLower.includes('дач') || topicLower.includes('огород') || topicLower.includes('помидор') || 
             topicLower.includes('урожай')) {
    recommendations.push(
      { id: 'babka_valya', reason: 'Бывшая доярка — эксперт по огороду' },
      { id: 'ded_stepan', reason: 'Кузнец — практичность в даче' },
      { id: 'mama_lyuba', reason: 'Травница — знаток растений' },
      { id: 'papa_kostya', reason: 'Силач — физическая работа на даче' }
    );
  }
  
  // AI и технологии
  else if (topicLower.includes('нейросет') || topicLower.includes('ai') || topicLower.includes('технолог') || 
             topicLower.includes('робот')) {
    recommendations.push(
      { id: 'papa_oleg', reason: 'Профессор — эксперт по технологиям' },
      { id: 'papa_artyom', reason: 'Хипстер — современный техно-блогер' },
      { id: 'doch_yana', reason: 'Неон-панк — гик-культура' },
      { id: 'mama_regina', reason: 'CEO — управляет технологиями' }
    );
  }
  
  return recommendations.slice(0, 4); // Максимум 4 рекомендации
}

function showCharacterRecommendations() {
  const topicText = document.getElementById('idea-input')?.value || '';
  const recommendations = getCharacterRecommendations(topicText);
  
  if (recommendations.length === 0) return;
  
  const chars = state.characters;
  const recommendedChars = recommendations.map(rec => {
    const char = chars.find(c => c.id === rec.id);
    return char ? { ...char, reason: rec.reason } : null;
  }).filter(Boolean);
  
  if (recommendedChars.length === 0) return;
  
  // Создаем панель рекомендаций
  const panel = document.createElement('div');
  panel.className = 'glass-panel p-4 space-y-3 border-l-2 border-amber-500/40';
  panel.innerHTML = `
    <div class="text-sm font-semibold text-amber-400 flex items-center gap-2">
      <span>💡</span> Подходящие персонажи под вашу тему
    </div>
    <div class="space-y-2">
      ${recommendedChars.map(char => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-black/30 hover:bg-black/40 transition-colors cursor-pointer" onclick="selectCharacter('${char.id}')">
          <div class="flex items-center gap-3">
            <div class="text-sm text-gray-200">${char.name_ru}</div>
            <div class="text-[10px] text-gray-500">${char.group}</div>
          </div>
          <div class="text-[10px] text-amber-300 max-w-[200px] text-right">${char.reason}</div>
        </div>
      `).join('')}
    </div>
    <div class="text-[10px] text-gray-500">Кликните для выбора персонажа</div>
  `;
  
  // Вставляем после поля ввода
  const ideaInput = document.getElementById('section-remix');
  if (ideaInput && !ideaInput.querySelector('.character-recommendations')) {
    panel.className += ' character-recommendations';
    ideaInput.parentNode.insertBefore(panel, ideaInput.nextSibling);
  }
}

function selectCharacter(charId) {
  const char = state.characters.find(c => c.id === charId);
  if (!char) return;
  
  // Определяем роль A или B в зависимости от того, кто уже выбран
  if (!state.selectedA) {
    selectChar('A', charId);
  } else if (!state.selectedB) {
    selectChar('B', charId);
  } else {
    // Если оба выбраны, заменяем первого
    selectChar('A', charId);
  }
  
  // Убираем панель рекомендаций
  const panel = document.querySelector('.character-recommendations');
  if (panel) panel.remove();
  
  // Переходим к генерации если оба персонажа выбраны
  if (state.selectedA && state.selectedB) {
    navigateTo('generate');
  }
}

// Make functions globally available for HTML onclick handlers
window.selectCharacter = selectCharacter;
window.showCharacterRecommendations = showCharacterRecommendations;

// ─── INPUT MODES ─────────────────────────────
function initModeSwitcher() {
  document.querySelectorAll('#section-advanced .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#section-advanced .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      // Sync BOTH state vars so payload and readiness use the same mode
      state.inputMode = mode;
      state.generationMode = mode;
      document.getElementById('mode-idea').classList.toggle('hidden', mode !== 'idea');
      document.getElementById('mode-script').classList.toggle('hidden', mode !== 'script');
      document.getElementById('mode-video').classList.toggle('hidden', mode !== 'video');
      // Also sync main page remix panels
      document.getElementById('remix-idea')?.classList.toggle('hidden', mode !== 'idea');
      document.getElementById('remix-suggested')?.classList.add('hidden');
      document.getElementById('remix-script')?.classList.toggle('hidden', mode !== 'script');
      document.getElementById('remix-video')?.classList.toggle('hidden', mode !== 'video');
      if (mode === 'video') initVideoDropzoneMain();
      // Update readiness checklist to reflect new mode
      updateReadiness();
      log('INFO', 'РЕЖИМ', `Ввод: ${mode === 'idea' ? 'идея' : mode === 'script' ? 'диалог' : 'видео'}`);
    });
  });

  // Smart URL detection: if user pastes an Instagram link into the main idea field,
  // notify user to use video mode instead (no auto-fetch since video URL input is removed)
  document.getElementById('idea-input')?.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = e.target.value.trim();
      if (text.includes('instagram.com/')) {
        log('INFO', 'РЕЖИМ', 'Обнаружена ссылка на видео — переключи в режим «🎥 По видео» и загрузи файл');
        // Switch to video mode UI (both advanced and main page)
        document.querySelectorAll('#section-advanced .mode-btn').forEach(b => b.classList.remove('active'));
        const videoBtn = document.querySelector('#section-advanced .mode-btn[data-mode="video"]');
        if (videoBtn) videoBtn.classList.add('active');
        state.inputMode = 'video';
        state.generationMode = 'video';
        document.getElementById('mode-idea')?.classList.add('hidden');
        document.getElementById('mode-script')?.classList.add('hidden');
        document.getElementById('mode-video')?.classList.remove('hidden');
        document.getElementById('remix-idea')?.classList.add('hidden');
        document.getElementById('remix-suggested')?.classList.add('hidden');
        document.getElementById('remix-script')?.classList.add('hidden');
        document.getElementById('remix-video')?.classList.remove('hidden');
        initVideoDropzoneMain();
        // Keep URL in scene-hint-main for context
        const sceneHint = document.getElementById('scene-hint-main') || document.getElementById('scene-hint');
        if (sceneHint && !sceneHint.value) sceneHint.value = `Ремейк видео: ${text}`;
        e.target.value = '';
      }
    }, 100);
  });

  // Real-time readiness update on content input
  ['idea-input', 'idea-input-suggested', 'script-a', 'script-b', 'scene-hint-main'].forEach(inputId => {
    document.getElementById(inputId)?.addEventListener('input', () => updateReadiness());
  });

  // Character recommendations on input change
  let recommendationTimeout;
  document.getElementById('idea-input')?.addEventListener('input', (e) => {
    clearTimeout(recommendationTimeout);
    recommendationTimeout = setTimeout(() => {
      // Remove old recommendations
      const oldPanel = document.querySelector('.character-recommendations');
      if (oldPanel) oldPanel.remove();
      
      // Show new recommendations if text is meaningful
      if (e.target.value.trim().length > 5) {
        showCharacterRecommendations();
      }
    }, 500); // Debounce 500ms
  });
}

// ─── TOGGLES ─────────────────────────────────
function initToggles() {
  document.querySelectorAll('.toggle-track').forEach(track => {
    track.addEventListener('click', () => {
      sfx.toggle();
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
  if (file.size > 50 * 1024 * 1024) { log('WARN', 'ВИДЕО', 'Файл больше 50 MB'); return; }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  // Read the actual video file as base64 for Gemini multimodal input
  const reader = new FileReader();
  reader.onload = () => {
    const videoBase64 = reader.result.split(',')[1]; // strip data:video/mp4;base64, prefix
    state._videoFileBase64 = videoBase64;
    state._videoFileMime = file.type; // video/mp4 or video/quicktime
    log('OK', 'ВИДЕО', `📦 Видео закодировано (${(file.size / 1024 / 1024).toFixed(1)} MB) — готово к анализу`);
  };
  reader.readAsDataURL(file);

  video.onloadeddata = () => {
    const duration = Math.round(video.duration * 100) / 100;
    state.videoMeta = {
      duration,
      size: file.size,
      name: file.name,
      platform: 'upload',
      cover_base64: null,
    };

    // Show meta (both advanced and main page)
    const metaHtml = `
      <div class="flex items-center gap-2">
        <span class="text-emerald-400">✓</span>
        <span>📁 ${escapeHtml(file.name)}</span>
      </div>
      <div>⏱ ${duration}s · ${(file.size / 1024 / 1024).toFixed(1)} MB</div>
    `;
    ['video-meta', 'video-meta-main'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('hidden'); el.innerHTML = metaHtml; }
    });

    // Capture frame at 1s (or 25% of duration) as cover fallback
    const seekTime = Math.min(1, duration * 0.25);
    video.currentTime = seekTime;
  };

  video.onseeked = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      state.videoMeta.cover_base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      state.videoMeta.width = video.videoWidth;
      state.videoMeta.height = video.videoHeight;
      log('OK', 'ВИДЕО', 'Кадр захвачен (fallback)');
    } catch (e) {
      log('WARN', 'ВИДЕО', `Не удалось захватить кадр: ${e.message}`);
    }
    URL.revokeObjectURL(url);

    // Show remake badge and auto-match button (both advanced and main page)
    document.getElementById('video-remake-badge')?.classList.remove('hidden');
    document.getElementById('video-remake-badge-main')?.classList.remove('hidden');
    document.getElementById('auto-match-cast-btn')?.classList.remove('hidden');

    // Auto-switch to video mode
    state.inputMode = 'video';

    log('OK', 'ВИДЕО', `🎬 Загружено: ${file.name} (${state.videoMeta.duration}с) — готово к анализу`);
    updateReadiness();
  };

  video.onerror = () => {
    URL.revokeObjectURL(url);
    log('ERR', 'ВИДЕО', 'Не удалось прочитать видеофайл');
  };

  video.src = url;
}

// ─── AUTO-MATCH CAST by video context ────────
async function autoMatchCast() {
  const btn = document.getElementById('auto-match-cast-btn');
  const resultEl = document.getElementById('auto-match-result');
  if (!state.videoMeta?.cover_base64 && !state._videoFileBase64) {
    log('WARN', 'ПОДБОР', 'Сначала загрузи видео');
    return;
  }
  if (!state.characters?.length) {
    log('WARN', 'ПОДБОР', 'Каталог персонажей пуст');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ AI анализирует видео...'; }
  if (resultEl) resultEl.classList.add('hidden');

  const token = localStorage.getItem('ferixdi_jwt');
  const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  if (!token) { log('WARN', 'ПОДБОР', 'Нет авторизации'); if (btn) { btn.disabled = false; btn.textContent = '🎯 Подобрать персонажей и локацию автоматически'; } return; }

  // Build compact catalogs
  const characters = state.characters.map(c => ({
    id: c.id,
    name_ru: c.name_ru,
    character_en: c.prompt_tokens?.character_en || '',
    group: c.group || '',
    short_desc: `${c.biology_override?.age || ''}yo ${c.appearance_ru || ''}`
  }));
  const locations = (state.locations || []).map(l => ({
    id: l.id,
    name_ru: l.name_ru,
    scene_en: l.scene_en || ''
  }));

  const payload = {
    video_title: state.videoMeta?.name || '',
    scene_hint: document.getElementById('scene-hint-main')?.value?.trim() || document.getElementById('scene-hint')?.value?.trim() || '',
    characters,
    locations,
  };
  // Attach cover image for visual analysis
  if (state.videoMeta?.cover_base64) {
    payload.video_cover = state.videoMeta.cover_base64;
    payload.video_cover_mime = 'image/jpeg';
  }

  try {
    const resp = await fetch(`${apiBase}/api/match-cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const result = await resp.json();

    // Apply character A
    const reasons = [];
    if (result.character_a_id) {
      const charA = state.characters.find(c => c.id === result.character_a_id);
      if (charA) {
        state.selectedA = charA;
        reasons.push(`<strong>A:</strong> ${charA.name_ru} — ${result.character_a_reason || ''}`);
        log('OK', 'ПОДБОР', `A: ${charA.name_ru}`);
      }
    }
    // Apply character B
    if (result.character_b_id) {
      const charB = state.characters.find(c => c.id === result.character_b_id);
      if (charB) {
        state.selectedB = charB;
        reasons.push(`<strong>B:</strong> ${charB.name_ru} — ${result.character_b_reason || ''}`);
        log('OK', 'ПОДБОР', `B: ${charB.name_ru}`);
      }
    }
    // Apply location
    if (result.location_id) {
      const loc = state.locations.find(l => l.id === result.location_id);
      if (loc) {
        state.selectedLocation = loc.id;
        reasons.push(`<strong>Локация:</strong> ${loc.name_ru} — ${result.location_reason || ''}`);
        log('OK', 'ПОДБОР', `Локация: ${loc.name_ru}`);
        renderLocations(document.getElementById('loc-group-filter')?.value || '');
        renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
      }
    }

    // Update UI
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    updateReadiness();

    if (resultEl && reasons.length) {
      resultEl.innerHTML = '🎯 <strong>AI подобрал:</strong><br>' + reasons.join('<br>');
      resultEl.classList.remove('hidden');
    }
    log('OK', 'ПОДБОР', `Готово — ${reasons.length} элементов подобрано`);
  } catch (e) {
    log('ERR', 'ПОДБОР', `Ошибка: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎯 Подобрать персонажей и локацию автоматически'; }
  }
}
window.autoMatchCast = autoMatchCast;

// ─── VIDEO DROPZONE (main generate page) ────
function initVideoDropzoneMain() {
  const dropzone = document.getElementById('video-dropzone-main');
  const fileInput = document.getElementById('video-file-main');
  if (!dropzone || !fileInput || dropzone._initialized) return;
  dropzone._initialized = true;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#00d4ff'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleVideoFile(fileInput.files[0]); });
}

// ─── MEME DROPZONE ──────────────────────────
function initMemeDropzone() {
  const dropzone = document.getElementById('meme-dropzone');
  const fileInput = document.getElementById('meme-file-input');
  if (!dropzone || !fileInput || dropzone._initialized) return;
  dropzone._initialized = true;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#f43f5e'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handleMemeFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleMemeFile(fileInput.files[0]); });

  // Update readiness on context input
  document.getElementById('meme-context')?.addEventListener('input', () => setTimeout(updateReadiness, 100));
}

function handleMemeFile(file) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) { log('WARN', 'МЕМ', 'Поддерживаются только изображения и видео'); return; }
  if (file.size > 50 * 1024 * 1024) { log('WARN', 'МЕМ', 'Файл больше 50 MB'); return; }

  state._memeFileName = file.name;
  state._memeFileMime = file.type;

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    if (isImage) {
      state._memeImageBase64 = base64;
      state._memeFileBase64 = null;
      // Show preview
      const preview = document.getElementById('meme-preview');
      const img = document.getElementById('meme-preview-img');
      if (preview && img) { img.src = reader.result; preview.classList.remove('hidden'); }
    } else {
      state._memeFileBase64 = base64;
      state._memeImageBase64 = null;
      document.getElementById('meme-preview')?.classList.add('hidden');
      // Extract cover frame from video
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video');
      vid.preload = 'auto'; vid.muted = true;
      vid.onloadeddata = () => { vid.currentTime = Math.min(1, vid.duration * 0.25); };
      vid.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          c.width = Math.min(vid.videoWidth, 640);
          c.height = Math.round(c.width * (vid.videoHeight / vid.videoWidth));
          c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
          state._memeImageBase64 = c.toDataURL('image/jpeg', 0.8).split(',')[1];
          const preview = document.getElementById('meme-preview');
          const img = document.getElementById('meme-preview-img');
          if (preview && img) { img.src = c.toDataURL('image/jpeg', 0.8); preview.classList.remove('hidden'); }
        } catch (e) { log('WARN', 'МЕМ', 'Не удалось захватить кадр'); }
        URL.revokeObjectURL(url);
      };
      vid.src = url;
    }

    const metaEl = document.getElementById('meme-meta');
    if (metaEl) {
      metaEl.classList.remove('hidden');
      metaEl.innerHTML = `<span class="text-emerald-400">✓</span> ${isImage ? '🖼️' : '🎥'} ${escapeHtml(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    }

    log('OK', 'МЕМ', `Загружен: ${file.name} (${isImage ? 'изображение' : 'видео'})`);
    updateReadiness();
  };
  reader.readAsDataURL(file);
}

// ─── VIDEO URL FETCH (removed — now using external download services) ───
function initVideoUrlFetch() {
  // No-op: Instagram downloads handled via external links
  // (tikvideo.app / saveclip.app) — user downloads MP4, then uploads here
}

function showGenStatus(text, cls) {
  let el = document.getElementById('gen-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gen-status';
    const btn = document.getElementById('btn-generate');
    if (btn) btn.parentNode.insertBefore(el, btn.nextSibling);
  }
  el.className = `text-sm text-center py-2 ${cls}`;
  el.textContent = text;
}

// ─── READINESS CHECKLIST (live update) ───────
function updateReadiness() {
  const btn = document.getElementById('btn-generate');
  if (!btn) return;

  const checks = {
    mode: !!state.generationMode,
    chars: !!state.selectedA,
    content: _hasContent(),
    promo: isPromoValid(),
  };

  const allReady = checks.mode && checks.chars && checks.content && checks.promo;

  // Update button state
  if (allReady) {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
    btn.innerHTML = '<span class="flex items-center justify-center gap-2">🚀 Собрать промпт<span class="text-xs opacity-60">Ctrl+Enter</span></span>';
  } else {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    const missing = [];
    if (!checks.mode) missing.push('режим');
    if (!checks.chars) missing.push('персонажи');
    if (!checks.content) missing.push('контент');
    if (!checks.promo) missing.push('промо-код');
    btn.innerHTML = `<span class="flex items-center justify-center gap-2">🔒 Не хватает: ${missing.join(', ')}</span>`;
  }

  // Update checklist panel
  const panel = document.getElementById('gen-readiness');
  if (!panel) return;

  // Border color
  panel.classList.remove('border-gray-700/50', 'border-emerald-500/40', 'border-amber-500/40');
  panel.classList.add(allReady ? 'border-emerald-500/40' : (checks.mode && checks.chars ? 'border-amber-500/40' : 'border-gray-700/50'));

  _updateCheckItem('readiness-mode', checks.mode,
    state.generationMode ? _modeLabel(state.generationMode) : 'Режим генерации',
    checks.mode ? '' : '← выберите на шаге 1',
    checks.mode ? null : () => navigateTo('generation-mode'));

  const charsLabel = checks.chars
    ? (state.selectedB ? `${state.selectedA.name_ru} × ${state.selectedB.name_ru}` : `${state.selectedA.name_ru} (соло)`)
    : 'Персонаж A (минимум 1)';
  _updateCheckItem('readiness-chars', checks.chars,
    charsLabel,
    checks.chars ? '' : '← выберите на шаге 3',
    checks.chars ? null : () => navigateTo('characters'));

  // Location is always "ready" (auto if not selected), but show which one
  const locSelected = !!state.selectedLocation;
  const locName = locSelected ? (state.locations.find(l => l.id === state.selectedLocation)?.name_ru || 'Выбрана') : 'Авто (AI подберёт)';
  _updateCheckItem('readiness-location', true,
    locSelected ? `📍 ${locName}` : 'Локация',
    locSelected ? '' : 'Авто (AI подберёт)',
    null);

  const contentLabel = _contentLabel();
  _updateCheckItem('readiness-content', checks.content,
    checks.content ? contentLabel : 'Идея / диалог / видео',
    checks.content ? '' : '← введите контент',
    null);

  _updateCheckItem('readiness-promo', checks.promo,
    checks.promo ? 'VIP активен' : 'Промо-код',
    checks.promo ? '' : '← введите в «Настройки»',
    checks.promo ? null : () => navigateTo('settings'));
}

function _hasContent() {
  if (state.generationMode === 'idea') {
    return !!(document.getElementById('idea-input')?.value?.trim());
  }
  if (state.generationMode === 'suggested') {
    // Suggested mode always has content — AI picks trending ideas; user input is optional bonus
    return true;
  }
  if (state.generationMode === 'script') {
    const a = document.getElementById('script-a')?.value?.trim();
    const b = document.getElementById('script-b')?.value?.trim();
    return !!(a || b);
  }
  if (state.generationMode === 'video') {
    return !!state.videoMeta;
  }
  if (state.generationMode === 'meme') {
    return !!(document.getElementById('meme-context')?.value?.trim()) && !!(state._memeFileBase64 || state._memeImageBase64);
  }
  return false;
}

function _contentLabel() {
  if (state.generationMode === 'idea') {
    const v = document.getElementById('idea-input')?.value?.trim() || '';
    return v ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : '';
  }
  if (state.generationMode === 'suggested') {
    const v = document.getElementById('idea-input-suggested')?.value?.trim() || document.getElementById('idea-input')?.value?.trim() || '';
    return v ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : 'AI подберёт тему';
  }
  if (state.generationMode === 'script') return 'Диалог готов';
  if (state.generationMode === 'video') return state.videoMeta ? `Видео: ${state.videoMeta.name}` : '';
  if (state.generationMode === 'meme') return state._memeFileName ? `Мем: ${state._memeFileName}` : '';
  return '';
}

function _modeLabel(m) {
  return { idea: '💡 Своя идея', suggested: '📚 Готовые идеи', script: '📝 Свой диалог', video: '🎥 По видео', meme: '🎭 Мем-ремейк' }[m] || m;
}

function _updateCheckItem(elId, ok, label, hint, onClick) {
  const row = document.getElementById(elId);
  if (!row) return;

  const icon = row.querySelector('.readiness-icon');
  const labelEl = row.children[1];
  const hintEl = row.querySelector('.readiness-hint');

  if (icon) {
    icon.textContent = ok ? '✓' : '✗';
    icon.className = `readiness-icon ${ok ? 'text-emerald-400' : 'text-red-400'}`;
  }
  if (labelEl) {
    labelEl.textContent = label;
    labelEl.className = ok ? 'text-emerald-300' : 'text-gray-400';
  }
  if (hintEl) {
    hintEl.textContent = hint;
    hintEl.className = `readiness-hint text-[10px] ml-auto ${ok ? 'text-emerald-500/60' : 'text-red-400/70 cursor-pointer hover:text-red-300 underline decoration-dotted'}`;
    if (!ok && onClick) {
      hintEl.onclick = onClick;
      hintEl.style.cursor = 'pointer';
    } else {
      hintEl.onclick = null;
      hintEl.style.cursor = '';
    }
  }
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
  // Проверка промо-кода перед анализом товара
  if (!isPromoValid()) {
    showProductStatus('🔑 Для анализа товара нужен промо-код. Введите его в разделе «Настройки».', 'text-amber-400');
    log('WARN', 'ТОВАР', 'Промо-код не введён — анализ товара заблокирован');
    return;
  }

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

    showProductStatus('⏳ AI анализирует товар...', 'text-gray-400');

    try {
      const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
      const token = localStorage.getItem('ferixdi_jwt');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${apiBase}/api/product/describe`, {
        method: 'POST',
        headers,
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
      document.getElementById('product-tokens').textContent = data.tokens ? `${data.tokens} токенов` : '';
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

// ─── POST-GENERATION: Enhance prompt with reference/product photo ────
let _postPhotoMode = null; // 'reference' | 'product'

function initPostGenPhoto() {
  const dropzone = document.getElementById('post-photo-dropzone');
  const fileInput = document.getElementById('post-photo-file');
  if (!dropzone || !fileInput) return;

  // Mode buttons
  document.getElementById('post-photo-mode-ref')?.addEventListener('click', () => {
    _postPhotoMode = 'reference';
    document.getElementById('post-photo-mode-ref').classList.add('ring-2', 'ring-violet-500');
    document.getElementById('post-photo-mode-prod').classList.remove('ring-2', 'ring-emerald-500');
    document.getElementById('post-photo-icon').textContent = '🎨';
    document.getElementById('post-photo-label').textContent = 'Загрузи фото-референс (стиль, настроение, эстетика)';
    dropzone.classList.remove('hidden');
    document.getElementById('post-photo-lang-toggle')?.classList.remove('hidden');
    log('INFO', 'POST-PHOTO', 'Режим: референс стиля');
  });

  document.getElementById('post-photo-mode-prod')?.addEventListener('click', () => {
    _postPhotoMode = 'product';
    document.getElementById('post-photo-mode-prod').classList.add('ring-2', 'ring-emerald-500');
    document.getElementById('post-photo-mode-ref').classList.remove('ring-2', 'ring-violet-500');
    document.getElementById('post-photo-icon').textContent = '📦';
    document.getElementById('post-photo-label').textContent = 'Загрузи фото товара (появится в кадре)';
    dropzone.classList.remove('hidden');
    document.getElementById('post-photo-lang-toggle')?.classList.remove('hidden');
    log('INFO', 'POST-PHOTO', 'Режим: фото товара');
  });

  // Dropzone events
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'rgba(139,92,246,0.5)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handlePostGenPhoto(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handlePostGenPhoto(fileInput.files[0]); });

  // Apply button
  document.getElementById('post-photo-apply')?.addEventListener('click', () => applyPostGenPhoto());

  // Clear button
  document.getElementById('post-photo-clear')?.addEventListener('click', () => clearPostGenPhoto());
}

async function handlePostGenPhoto(file) {
  if (!_postPhotoMode) {
    showPostPhotoStatus('Сначала выбери тип: референс или товар', 'text-amber-400');
    return;
  }
  if (!isPromoValid()) {
    showPostPhotoStatus('Для анализа фото нужен промо-код', 'text-amber-400');
    return;
  }
  if (!file.type.startsWith('image/')) {
    showPostPhotoStatus('Нужно фото (JPG, PNG, WebP)', 'text-red-400');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showPostPhotoStatus('Файл слишком большой (макс. 10 МБ)', 'text-red-400');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;

    // Show preview
    const previewImg = document.getElementById('post-photo-preview-img');
    if (previewImg) previewImg.src = dataUrl;
    document.getElementById('post-photo-preview')?.classList.remove('hidden');

    const base64 = dataUrl.split(',')[1];
    const mimeType = file.type;

    showPostPhotoStatus('AI анализирует фото...', 'text-violet-400 animate-pulse');

    try {
      const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
      const token = localStorage.getItem('ferixdi_jwt');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch(`${apiBase}/api/product/describe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image_base64: base64,
          mime_type: mimeType,
          mode: _postPhotoMode,
          language: document.getElementById('post-photo-lang-ru')?.checked ? 'ru' : 'en',
        }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        showPostPhotoStatus(`${data.error || 'Ошибка'}`, 'text-red-400');
        return;
      }

      // Store for apply
      state._postGenPhoto = {
        mode: _postPhotoMode,
        description_en: data.description_en,
        image_base64: base64,
        mime_type: mimeType,
      };

      // Show result
      const resultTitle = document.getElementById('post-photo-result-title');
      const langLabel = data.language === 'ru' ? 'RU' : 'EN';
      if (resultTitle) {
        resultTitle.textContent = _postPhotoMode === 'reference'
          ? `🎨 ОПИСАНИЕ РЕФЕРЕНСА (${langLabel})`
          : `📦 ОПИСАНИЕ ТОВАРА (${langLabel})`;
        resultTitle.className = `text-[10px] font-semibold uppercase tracking-wider mb-1 ${_postPhotoMode === 'reference' ? 'text-violet-400' : 'text-emerald-400'}`;
      }
      document.getElementById('post-photo-description').textContent = data.description_en;
      document.getElementById('post-photo-result')?.classList.remove('hidden');
      showPostPhotoStatus('', 'hidden');

      log('OK', 'POST-PHOTO', `AI описал фото (${_postPhotoMode}): ${data.description_en.slice(0, 80)}...`);

    } catch (err) {
      showPostPhotoStatus(`Сетевая ошибка: ${err.message}`, 'text-red-400');
    }
  };
  reader.readAsDataURL(file);
}

function applyPostGenPhoto() {
  const info = state._postGenPhoto;
  if (!info?.description_en || !state.lastResult) {
    showPostPhotoStatus('Нет данных для применения', 'text-amber-400');
    return;
  }

  const desc = info.description_en;
  const r = state.lastResult;

  if (info.mode === 'product') {
    // Product mode — inject product description into all prompts
    const productLine = `\n\n[PRODUCT IN FRAME]: One of the characters is holding/showing this product: ${desc}. The product must be clearly visible throughout the entire video, matching the original photo exactly — colors, shape, brand, packaging.`;

    // Veo prompt
    const veoEl = document.getElementById('veo-prompt-text');
    if (veoEl) veoEl.textContent = (veoEl.textContent || '') + productLine;

    // Photo prompt
    if (r.photo_prompt_en_json) {
      r.photo_prompt_en_json.product_in_frame = desc;
      const photoEl = document.querySelector('#tab-photo pre');
      if (photoEl) photoEl.textContent = JSON.stringify(r.photo_prompt_en_json, null, 2);
    }

    // Video prompt
    if (r.video_prompt_en_json) {
      r.video_prompt_en_json.product_in_frame = desc;
      const videoEl = document.querySelector('#tab-video pre');
      if (videoEl) videoEl.textContent = JSON.stringify(r.video_prompt_en_json, null, 2);
    }

    // RU package
    const ruEl = document.querySelector('#tab-ru pre');
    if (ruEl) {
      ruEl.textContent = (ruEl.textContent || '') + `\n\n📦 ТОВАР В КАДРЕ (добавлено по фото):\n${desc}\n⚠️ Товар строго как на загруженном фото — цвета, форма, бренд!`;
    }

    // Also save to state for future regenerations
    state.productInfo = {
      image_base64: info.image_base64,
      mime_type: info.mime_type,
      description_en: desc,
    };

    // Show product badge in Veo tab
    const veoProdBadge = document.getElementById('veo-product-badge');
    if (veoProdBadge) {
      veoProdBadge.classList.remove('hidden');
      const prodImg = `<img src="data:${info.mime_type};base64,${info.image_base64}" class="w-10 h-10 rounded object-cover border border-emerald-500/30 flex-shrink-0" alt="товар">`;
      const prodDesc = desc.length > 120 ? desc.slice(0, 120) + '...' : desc;
      veoProdBadge.innerHTML = `
        <div class="flex items-start gap-2">
          ${prodImg}
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-emerald-400">📦 Товар добавлен в промпт ✓</div>
            <div class="text-[9px] text-gray-400 leading-tight mt-0.5">${escapeHtml(prodDesc)}</div>
            <div class="text-[9px] text-emerald-500/60 mt-0.5">Строго как на загруженном фото</div>
          </div>
        </div>`;
    }

    showPostPhotoStatus('Товар добавлен во все промпты!', 'text-emerald-400');
    log('OK', 'POST-PHOTO', 'Товар применён к промптам');

  } else {
    // Reference mode — inject style/mood description
    const refLine = `\n\n[VISUAL REFERENCE — match this aesthetic]: ${desc}. Replicate the lighting, color palette, mood, and composition style from this reference image as closely as possible while keeping the characters and dialogue intact.`;

    // Veo prompt
    const veoEl = document.getElementById('veo-prompt-text');
    if (veoEl) veoEl.textContent = (veoEl.textContent || '') + refLine;

    // Photo prompt
    if (r.photo_prompt_en_json) {
      r.photo_prompt_en_json.visual_reference = desc;
      const photoEl = document.querySelector('#tab-photo pre');
      if (photoEl) photoEl.textContent = JSON.stringify(r.photo_prompt_en_json, null, 2);
    }

    // Video prompt
    if (r.video_prompt_en_json) {
      r.video_prompt_en_json.visual_reference = desc;
      const videoEl = document.querySelector('#tab-video pre');
      if (videoEl) videoEl.textContent = JSON.stringify(r.video_prompt_en_json, null, 2);
    }

    // RU package
    const ruEl = document.querySelector('#tab-ru pre');
    if (ruEl) {
      ruEl.textContent = (ruEl.textContent || '') + `\n\n🎨 ВИЗУАЛЬНЫЙ РЕФЕРЕНС (добавлено по фото):\n${desc}\n💡 Повтори освещение, цветовую палитру и настроение с загруженного фото`;
    }

    // Save reference style to state for future regenerations
    state.referenceStyle = { description_en: desc };

    showPostPhotoStatus('Референс добавлен во все промпты!', 'text-violet-400');
    log('OK', 'POST-PHOTO', 'Референс применён к промптам и сохранён в state');
  }

  // Flash apply button for feedback
  const applyBtn = document.getElementById('post-photo-apply');
  if (applyBtn) {
    applyBtn.textContent = '✓ Применено!';
    applyBtn.disabled = true;
    setTimeout(() => { applyBtn.textContent = '✨ Применить к промпту'; applyBtn.disabled = false; }, 2000);
  }
}

function clearPostGenPhoto() {
  // If clearing reference mode, also clear the saved reference style
  if (_postPhotoMode === 'reference') state.referenceStyle = null;
  state._postGenPhoto = null;
  _postPhotoMode = null;
  document.getElementById('post-photo-preview')?.classList.add('hidden');
  document.getElementById('post-photo-result')?.classList.add('hidden');
  document.getElementById('post-photo-dropzone')?.classList.add('hidden');
  document.getElementById('post-photo-status')?.classList.add('hidden');
  document.getElementById('post-photo-mode-ref')?.classList.remove('ring-2', 'ring-violet-500');
  document.getElementById('post-photo-mode-prod')?.classList.remove('ring-2', 'ring-emerald-500');
  document.getElementById('post-photo-lang-toggle')?.classList.add('hidden');
  const langCb = document.getElementById('post-photo-lang-ru');
  if (langCb) langCb.checked = false;
  const fileInput = document.getElementById('post-photo-file');
  if (fileInput) fileInput.value = '';
  log('INFO', 'POST-PHOTO', 'Фото убрано');
}

function showPostPhotoStatus(text, cls) {
  const el = document.getElementById('post-photo-status');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = `text-xs text-center ${cls}`;
  el.textContent = text;
}

// ─── PRE-FLIGHT: Professional parameter breakdown ────
function renderPreflight(localResult) {
  const el = document.getElementById('gen-preflight');
  if (!el) return;

  const ctx = localResult._apiContext;
  if (!ctx) { el.classList.add('hidden'); return; }

  const charA = ctx.charA;
  const charB = ctx.charB;
  const cat = ctx.category;
  const lm = ctx.lightingMood;
  const cin = ctx.cinematography || {};

  // Timing estimate
  const est = localResult.duration_estimate || {};
  const riskColor = est.risk === 'high' ? 'text-red-400' : est.risk === 'medium' ? 'text-amber-400' : 'text-emerald-400';
  const riskIcon = est.risk === 'high' ? '🔴' : est.risk === 'medium' ? '🟡' : '🟢';

  // Translate risk
  const riskRu = { high: 'высокий', medium: 'средний', low: 'низкий' };

  // Build pillar summaries (short) — user-friendly terms
  const pillars = [
    { icon: '💡', name: 'Освещение', val: `${lm.mood} · ${lm.sources || '1 источник'}`, detail: lm.style?.slice(0, 60) + '...' },
    { icon: '📷', name: 'Камера', val: 'Селфи-режим', detail: `Объектив: ${cin.optics?.focal_length || '24-28мм'} · Диафрагма: ${cin.optics?.aperture || 'f/1.9-2.2'}` },
    { icon: '📱', name: 'Съёмка', val: 'Ручная съёмка', detail: 'Естественное микро-дрожание телефона' },
    { icon: '🫁', name: 'Анимация', val: 'Жесты и дыхание', detail: 'Моргание 3-5с · Дыхание 3-4с · Независимые движения' },
    { icon: '👄', name: 'Лицо', val: 'Чёткие губы', detail: `Поворот ≤25° · Автофокус на лицо` },
    { icon: '👁', name: 'Взгляд', val: '4 фазы взгляда', detail: `Хук: прямо в камеру · Естественные движения глаз` },
    { icon: '🖼', name: 'Композиция', val: `макс. ${cin.frame_cleanliness?.detail_budget || '7'} деталей`, detail: `60-70% персонажи · Формат 9:16` },
    { icon: '🧶', name: 'Детализация', val: 'Реалистичные текстуры', detail: 'Поры, морщины, текстура кожи, ткани' },
    { icon: '🎨', name: 'Цвет', val: 'Естественные тона', detail: `Без оранжевого и серого · 5 зон кожи` },
    { icon: '🔊', name: 'Звук', val: 'Запись с телефона', detail: `Микрофон 35-60см · Фон -20/-30дБ` },
    { icon: '🎣', name: 'Начало', val: 'Яркий хук', detail: `Энергия: ≥80% · Взгляд в камеру` },
    { icon: '🎬', name: 'Монтаж', val: 'Динамика', detail: `80→90→60→95→100→70% · Авто-усиление` },
  ];

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="glass-panel p-5 space-y-4 border-l-2 border-cyan-400/40">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-600/20 border border-cyan-500/30">
            <span class="text-xs">⚙️</span>
          </div>
          <div>
            <div class="text-xs font-semibold text-cyan-400 tracking-wide">ПАРАМЕТРЫ СБОРКИ</div>
            <div class="text-[10px] text-gray-500">FERIXDI AI собирает промпт по вашим настройкам</div>
          </div>
        </div>
        <div class="text-[10px] text-gray-600 font-mono">v2.0</div>
      </div>

      <!-- Scene overview -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Персонажи</div>
          <div class="text-[11px] text-cyan-300">${ctx.soloMode ? (charA.name_ru || 'A') + ' (соло)' : (charA.name_ru || 'A') + ' <span class="text-gray-600">×</span> ' + (charB.name_ru || 'B')}</div>
          <div class="text-[10px] text-gray-500 mt-0.5">${ctx.soloMode ? (charA.vibe_archetype || '—') : (charA.vibe_archetype || '—') + ' × ' + (charB.vibe_archetype || '—')}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Категория</div>
          <div class="text-[11px] text-gray-200">${cat.ru || '—'}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Локация</div>
          <div class="text-[11px] text-gray-200">${(ctx.location || '—').split(',')[0]}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Тайминг</div>
          <div class="text-[11px] ${riskColor}">${riskIcon} ${est.total || '8.0'}с · риск: ${riskRu[est.risk] || est.risk || '—'}</div>
        </div>
      </div>

      <!-- Wardrobe -->
      <div class="bg-black/30 rounded-lg p-2.5">
        <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Гардероб</div>
        <div class="flex gap-3">
          <div class="flex-1"><span class="text-[10px] text-cyan-400/70">A:</span> <span class="text-[10px] text-gray-300">${ctx.wardrobeA?.slice(0, 60) || '—'}${ctx.wardrobeA?.length > 60 ? '...' : ''}</span></div>
          <div class="flex-1"><span class="text-[10px] text-purple-400/70">B:</span> <span class="text-[10px] text-gray-300">${ctx.wardrobeB?.slice(0, 60) || '—'}${ctx.wardrobeB?.length > 60 ? '...' : ''}</span></div>
        </div>
      </div>

      <!-- 12 Pillars compact -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider">12 параметров качества · Реалистичность смартфона</div>
          <button id="preflight-toggle-pillars" class="text-[10px] text-cyan-400/60 hover:text-cyan-400 transition-colors cursor-pointer">развернуть ▸</button>
        </div>
        <div class="grid grid-cols-3 md:grid-cols-4 gap-1.5" id="preflight-pillars-compact">
          ${pillars.map((p, i) => `
            <div class="bg-black/20 rounded px-2 py-1.5 group cursor-default" title="${p.detail}">
              <div class="text-[10px] text-gray-400 flex items-center gap-1"><span>${p.icon}</span><span class="text-[9px] text-gray-500">${i + 1}</span></div>
              <div class="text-[10px] text-gray-300 leading-tight mt-0.5 truncate">${p.name}</div>
            </div>
          `).join('')}
        </div>
        <div class="hidden space-y-1 mt-2" id="preflight-pillars-full">
          ${pillars.map((p, i) => `
            <div class="flex items-start gap-2 py-1 border-b border-gray-800/30 last:border-0">
              <span class="text-xs mt-0.5 w-5 text-center">${p.icon}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] text-gray-500 font-mono w-4">${i + 1}.</span>
                  <span class="text-[11px] text-gray-200 font-medium">${p.name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">${p.val}</div>
                <div class="text-[9px] text-gray-500 leading-relaxed">${p.detail}</div>
              </div>
              <span class="text-emerald-500 text-[10px] mt-1">✓</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Engagement preview -->
      <div class="bg-black/30 rounded-lg p-2.5">
        <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Вовлечение · Instagram</div>
        <div class="flex gap-3 text-[10px]">
          <div><span class="text-gray-500">Хук:</span> <span class="text-gray-300">${ctx.hookAction?.action_ru?.slice(0, 30) || '—'}</span></div>
          <div><span class="text-gray-500">Реквизит:</span> <span class="text-gray-300">${ctx.propAnchor?.slice(0, 25) || '—'}</span></div>
        </div>
        <div class="text-[10px] text-gray-500 mt-1">Хештеги: ${localResult.log?.engagement?.hashtag_count || '~18'} шт · Заголовок + закреп + первый коммент</div>
      </div>

      <!-- Status -->
      <div id="preflight-status" class="text-center py-2 rounded-lg text-xs font-medium bg-cyan-500/8 text-cyan-400 border border-cyan-500/15">
        <span class="inline-block animate-pulse mr-1">◉</span> FERIXDI AI генерирует контент...
      </div>
    </div>
  `;

  // Toggle pillars expand/collapse
  document.getElementById('preflight-toggle-pillars')?.addEventListener('click', function() {
    const compact = document.getElementById('preflight-pillars-compact');
    const full = document.getElementById('preflight-pillars-full');
    if (!compact || !full) return;
    const isExpanded = !full.classList.contains('hidden');
    full.classList.toggle('hidden', isExpanded);
    compact.classList.toggle('hidden', !isExpanded);
    this.textContent = isExpanded ? 'развернуть ▸' : 'свернуть ▾';
  });

  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePreflightStatus(text, color) {
  const el = document.getElementById('preflight-status');
  if (!el) return;
  el.className = `text-center py-2 rounded-lg text-xs font-medium ${color}`;
  el.innerHTML = text;
}

// ─── GENERATE ────────────────────────────────
function displayResult(result) {
  state.lastResult = result;

  if (result.error) {
    showGenStatus(`❌ ${result.error}`, 'text-red-400');
    log('ERR', 'GEN', result.error);
    return;
  }

  // ── MEME MODE: custom display ──
  if (result.meme_result) {
    const m = result.meme_result;
    document.getElementById('gen-results').classList.remove('hidden');
    showGenStatus('', 'hidden');
    // Use veo tab for frame0, photo tab for animation, ru tab for full package
    document.getElementById('veo-prompt-text').textContent = m.frame0_prompt_en || '(Промпт не сгенерирован)';
    document.querySelector('#tab-photo pre').textContent = m.animation_prompt_en || '(Промпт анимации не сгенерирован)';
    document.querySelector('#tab-video pre').textContent = JSON.stringify(m, null, 2);
    document.querySelector('#tab-ru pre').textContent = result.ru_package;
    document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(result.blueprint_json, null, 2);
    // Rename tabs for meme mode and activate veo (Frame 0) tab
    const tabBtns = document.querySelectorAll('#gen-results .mode-btn');
    tabBtns.forEach(b => {
      if (b.dataset.tab === 'veo') { b.textContent = '📸 Frame 0'; b.classList.add('active'); }
      else if (b.dataset.tab === 'photo') { b.textContent = '🎬 Анимация'; b.classList.remove('active'); }
      else if (b.dataset.tab === 'video') { b.textContent = '📦 JSON'; b.classList.remove('active'); }
      else if (b.dataset.tab === 'ru') { b.textContent = '🎭 Полный пакет'; b.classList.remove('active'); }
      else if (b.dataset.tab === 'insta') { b.style.display = 'none'; b.classList.remove('active'); }
      else b.classList.remove('active');
    });
    // Show veo tab, hide all others
    ['veo', 'photo', 'video', 'insta', 'ru', 'blueprint'].forEach(t => {
      document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== 'veo');
    });
    // Hide panels not applicable for meme mode
    document.getElementById('translate-panel')?.classList.add('hidden');
    document.getElementById('ab-testing-panel')?.classList.add('hidden');
    document.getElementById('gen-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    log('OK', 'MEME', 'Мем-ремейк готов: Frame 0 + анимация + вирусная упаковка');
    showNotification('🎭 Мем-ремейк готов! Скопируй Frame 0 → Imagen, потом анимацию → Kling 2.6', 'success');
    return;
  }

  // Restore default tab names and visibility (may have been renamed/hidden by meme mode)
  const _tabDefaults = { veo: '🎬 Промпт для Veo', photo: '📸 Фото (кадр 0)', video: '📋 Видео JSON', insta: '📱 Инста', ru: '🇷🇺 Пост', blueprint: '⚙️ План' };
  document.querySelectorAll('#gen-results .mode-btn').forEach(b => {
    if (b.dataset.tab && _tabDefaults[b.dataset.tab]) {
      b.textContent = _tabDefaults[b.dataset.tab];
      b.style.display = ''; // Restore insta tab hidden by meme mode
    }
  });

  // Show results
  document.getElementById('gen-results').classList.remove('hidden');
  document.getElementById('veo-prompt-text').textContent = result.veo_prompt || '(Промпт не сгенерирован)';
  document.querySelector('#tab-photo pre').textContent = JSON.stringify(result.photo_prompt_en_json, null, 2);
  document.querySelector('#tab-video pre').textContent = JSON.stringify(result.video_prompt_en_json, null, 2);
  document.querySelector('#tab-ru pre').textContent = result.ru_package;
  document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(result.blueprint_json, null, 2);
  showGenStatus('', 'hidden');

  // Product badge in Veo tab
  const veoProdBadge = document.getElementById('veo-product-badge');
  if (veoProdBadge) {
    const pi = result._apiContext?.product_info || state.productInfo;
    if (pi?.description_en) {
      veoProdBadge.classList.remove('hidden');
      const prodImg = pi.image_base64 ? `<img src="data:${pi.mime_type || 'image/jpeg'};base64,${pi.image_base64}" class="w-10 h-10 rounded object-cover border border-emerald-500/30 flex-shrink-0" alt="товар">` : '';
      const prodDesc = pi.description_en.length > 120 ? pi.description_en.slice(0, 120) + '...' : pi.description_en;
      veoProdBadge.innerHTML = `
        <div class="flex items-start gap-2">
          ${prodImg}
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-emerald-400">📦 Товар в промпте ✓</div>
            <div class="text-[9px] text-gray-400 leading-tight mt-0.5">${escapeHtml(prodDesc)}</div>
            <div class="text-[9px] text-emerald-500/60 mt-0.5">Строго как на исходном фото — цвета, форма, бренд</div>
          </div>
        </div>`;
    } else {
      veoProdBadge.classList.add('hidden');
    }
  }

  // Populate context & dialogue block
  populateContextBlock(result);

  // Populate Insta package tab
  populateInstaTab(result);

  // Show post-generation photo enhancement panel
  document.getElementById('post-gen-photo')?.classList.remove('hidden');

  // ── Reminder: upload product/reference photos for better results ──
  const hasProduct = !!(state.productInfo?.description_en);
  const hasRef = !!(state.referenceStyle?.description_en);
  if (!hasProduct && !hasRef) {
    // No photos loaded — show prominent reminder
    showNotification('💡 Загрузи фото товара 📦 или референс фона 🎨 ниже — AI встроит их в промпт!', 'info');
  } else if (hasProduct && !hasRef) {
    showNotification('📦 Товар в промпте ✓ | 💡 Можешь добавить ещё референс фона 🎨', 'success');
  } else if (!hasProduct && hasRef) {
    showNotification('🎨 Референс в промпте ✓ | 💡 Можешь добавить ещё фото товара 📦', 'success');
  } else {
    showNotification('📦 Товар ✓ 🎨 Референс ✓ — промпты обогащены по максимуму!', 'success');
  }

  // Reference badge in Veo tab
  const veoRefBadge = document.getElementById('veo-ref-badge');
  if (veoRefBadge) {
    if (hasRef) {
      const refDesc = state.referenceStyle.description_en;
      const refShort = refDesc.length > 120 ? refDesc.slice(0, 120) + '...' : refDesc;
      veoRefBadge.classList.remove('hidden');
      veoRefBadge.innerHTML = `
        <div class="flex items-start gap-2">
          <div class="text-2xl flex-shrink-0">🎨</div>
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-violet-400">🎨 Референс стиля в промпте ✓</div>
            <div class="text-[9px] text-gray-400 leading-tight mt-0.5">${escapeHtml(refShort)}</div>
          </div>
        </div>`;
    } else {
      veoRefBadge.classList.add('hidden');
    }
  }

  document.getElementById('gen-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Warnings with categorization
  if (result.warnings?.length > 0) {
    document.getElementById('gen-warnings').classList.remove('hidden');
    
    // Categorize warnings by type
    const infoWarnings = result.warnings.filter(w => w.includes('Для генерации') || w.includes('введите') || w.includes('проверьте'));
    const actionWarnings = result.warnings.filter(w => w.includes('слишком длинная') || w.includes('обрезана'));
    const systemWarnings = result.warnings.filter(w => w.includes('выбран') || w.includes('не указан'));
    const otherWarnings = result.warnings.filter(w => !infoWarnings.includes(w) && !actionWarnings.includes(w) && !systemWarnings.includes(w));
    
    let warningsHtml = '';
    
    if (infoWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-cyan-400 mb-1">ℹ️ Информация:</div>';
      warningsHtml += infoWarnings.map(w => `<div class="text-xs text-cyan-300">ℹ️ ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (actionWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-amber-400 mb-1">⚠️ Предупреждения:</div>';
      warningsHtml += actionWarnings.map(w => `<div class="text-xs text-amber-300">⚠️ ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (systemWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-orange-400 mb-1">🔧 Система:</div>';
      warningsHtml += systemWarnings.map(w => `<div class="text-xs text-orange-300">🔧 ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (otherWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-gray-400 mb-1">📝 Другое:</div>';
      warningsHtml += otherWarnings.map(w => `<div class="text-xs text-gray-300">📝 ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    document.getElementById('gen-warnings-list').innerHTML = warningsHtml;
  } else {
    document.getElementById('gen-warnings')?.classList.add('hidden');
  }

  // QC Gate v3 — smart quality control with fix capability
  if (result.qc_gate) {
    renderQCGate(result.qc_gate);
  }

  // Populate dialogue editor
  populateDialogueEditor(result);

  // Storyboard preview
  populateStoryboard(result);

  // Show A/B testing button only when API context exists (no point for local-only results)
  if (result._apiContext) {
    document.getElementById('ab-testing-panel')?.classList.remove('hidden');
  }

  // Reset English mode on new generation
  result._isEnglish = false;
  const ruTabBtn = document.querySelector('#gen-results .mode-btn[data-tab="ru"]');
  if (ruTabBtn) ruTabBtn.textContent = '🇷🇺 Пост';

  // Show English adaptation button
  const translatePanel = document.getElementById('translate-panel');
  if (translatePanel) {
    translatePanel.classList.remove('hidden');
    const btn = document.getElementById('btn-translate-en');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🇬🇧 Адаптация на English';
    }
  }

  // Save series episode if generating from series
  if (state._currentSeries) {
    try {
      const series = getSeries();
      const s = series[state._currentSeries.idx];
      if (s) {
        if (!s.episodes) s.episodes = [];
        s.episodes.push({ date: Date.now(), dialogueA: result._apiContext?.dialogueA, dialogueB: result._apiContext?.dialogueB });
        saveSeries(series);
        log('OK', 'SERIES', `Эпизод #${s.episodes.length} сохранён в серию "${s.name}"`);
      }
      state._currentSeries = null;
    } catch (e) { log('ERR', 'SERIES', e.message); }
  }

  const ver = result.log?.generator_version || '2.0';
  log('OK', 'ГЕНЕРАЦИЯ', `${ver} Пакет собран! Длительность: ${result.duration_estimate?.total || '?'}с, Риск: ${result.duration_estimate?.risk || '?'}`);
  if (result.auto_fixes?.length > 0) {
    result.auto_fixes.forEach(f => log('INFO', 'ФИКС', f));
  }
}

function populateContextBlock(result) {
  const metaEl = document.getElementById('gen-context-meta');
  const dA = document.getElementById('gen-dialogue-a');
  const dB = document.getElementById('gen-dialogue-b');
  const kw = document.getElementById('gen-killer-word');
  if (!metaEl) return;

  // Extract dialogue from blueprint or _apiContext
  const segs = result.blueprint_json?.dialogue_segments || [];
  const lineA = segs.find(s => s.speaker === 'A');
  const lineB = segs.find(s => s.speaker === 'B');
  const lineA2 = segs.find(s => s.speaker === 'A2');
  const ctx = result._apiContext || {};
  const isSolo = ctx.soloMode || (ctx.charA && ctx.charB && ctx.charA.id === ctx.charB.id);
  const dialogueA = lineA?.text_ru || ctx.dialogueA || '—';
  const dialogueB = lineB?.text_ru || ctx.dialogueB || '—';
  const dialogueA2 = lineA2?.text_ru || '';
  const killerWord = result.blueprint_json?.killer_word || ctx.killerWord || '';
  const cat = result.log?.category || ctx.category || {};
  const est = result.duration_estimate || {};
  const engage = result.log?.engagement || {};

  // Update labels for solo vs duo mode
  const labelA = dA?.closest('.bg-black\\/30')?.querySelector('.text-cyan-400');
  const bBlock = dB?.closest('.bg-black\\/30');
  if (isSolo) {
    if (labelA) labelA.textContent = '🎤 Монолог:';
    if (bBlock) bBlock.classList.add('hidden');
  } else {
    if (labelA) labelA.textContent = '🅰️ Реплика A (провокация):';
    if (bBlock) bBlock.classList.remove('hidden');
  }

  if (dA) dA.textContent = `«${dialogueA}»`;
  if (dB && !isSolo) dB.textContent = `«${dialogueB}»${dialogueA2 ? ` → A: «${dialogueA2}»` : ''}`;
  if (kw && killerWord) kw.textContent = `💥 Killer word: «${killerWord}»`;

  // Meta grid
  metaEl.innerHTML = `
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Категория:</span> <span class="text-gray-200">${cat.ru || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Тайминг:</span> <span class="text-gray-200">${est.total || '8.0'}с · ${est.risk || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Хук:</span> <span class="text-gray-200">${ctx.hookAction?.action_ru?.slice(0, 35) || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Заголовок:</span> <span class="text-gray-200">${engage.viral_title?.slice(0, 45) || '—'}${engage.viral_title?.length > 45 ? '...' : ''}</span></div>
  `;
}

function populateInstaTab(result) {
  const el = document.getElementById('tab-insta');
  if (!el) return;

  const engage = result.log?.engagement || {};
  const ctx = result._apiContext || {};
  const charA = ctx.charA || state.selectedA || {};
  const charB = ctx.charB || state.selectedB || {};
  const isEN = !!result._isEnglish;

  const viralTitle = engage.viral_title || '—';
  const shareBait = engage.share_bait || '—';
  const pinComment = engage.pin_comment || '—';
  const firstComment = engage.first_comment || '—';
  const hashtags = engage.hashtags || [];
  const seriesTag = engage.series_tag || '';
  const instaPack = result.log?.instagram_pack || {};
  const instaCaption = instaPack.caption || '';
  const instaHookTexts = instaPack.hook_texts || [];
  const instaEngagementTip = instaPack.engagement_tip || '';
  const copyLabel = isEN ? 'Copy' : 'Копировать';
  const copiedLabel = isEN ? '✓ Copied' : '✓ Скопировано';

  // Build copy-friendly hashtag string
  const hashtagStr = hashtags.join(' ');

  el.innerHTML = `
    <!-- Viral Title -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-2">🔥 ${isEN ? 'Viral Title' : 'Вирусный заголовок'}</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(viralTitle)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Paste as Reels caption — hooks viewers in the feed' : 'Вставь как заголовок Reels — цепляет в ленте'}</div>
    </div>

    <!-- Share Bait (video description for forwarding) -->
    <div class="glass-panel p-4 relative border-l-2 border-orange-400/40">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-orange-400 font-semibold uppercase tracking-wider mb-2">📝 ${isEN ? 'Video Description · share bait' : 'Описание видео · для пересылки'}</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(shareBait)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Send to a friend with this line — bait for shares' : 'Скинь другу с этой фразой — байт на пересылку в контексте видео'}</div>
    </div>

    <!-- Instagram Caption (full post text) -->
    ${instaCaption ? `<div class="glass-panel p-4 relative border-l-2 border-pink-400/40">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-pink-400 font-semibold uppercase tracking-wider mb-2">📝 ${isEN ? 'Full Caption (description)' : 'Полный текст описания (caption)'}</div>
      <div class="copy-target text-sm text-gray-100 leading-relaxed">${escapeHtml(instaCaption)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Paste as Reels description — includes CTA' : 'Вставь в описание Reels — уже с CTA и эмодзи'}</div>
    </div>` : ''}

    <!-- Hook Texts (for video overlay) -->
    ${instaHookTexts.length > 0 ? `<div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').innerText.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-rose-400 font-semibold uppercase tracking-wider mb-2">🎬 ${isEN ? 'Hook Texts (on-screen)' : 'Тексты-хуки (на экран в начало)'}</div>
      <div class="copy-target space-y-1.5">
        ${instaHookTexts.map((h, i) => `<div class="text-sm text-gray-200 bg-black/30 rounded px-3 py-1.5">«${escapeHtml(h)}»</div>`).join('')}
      </div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Place one of these as text overlay in the first 0.5s' : 'Наложи одну из этих фраз текстом в первые 0.5 сек видео'}</div>
    </div>` : ''}

    <!-- Hashtags -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider mb-2"># ${isEN ? `Hashtags · ${hashtags.length}` : `Хештеги · ${hashtags.length} шт`}</div>
      <div class="copy-target text-xs text-gray-300 leading-relaxed bg-black/30 rounded-lg p-3 select-all">${escapeHtml(hashtagStr)}</div>
      ${seriesTag ? `<div class="text-[9px] text-violet-400 mt-2">${isEN ? 'Series' : 'Серия'}: ${escapeHtml(seriesTag)}</div>` : ''}
      <div class="text-[9px] text-gray-600 mt-1">${isEN ? 'Paste in the first comment or in description' : 'Вставь в первый комментарий или в описание'}</div>
    </div>

    <!-- Pin Comment (bait for shares) -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-2">📌 ${isEN ? 'Pinned Comment' : 'Закреплённый комментарий'}</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(pinComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Pin this — triggers shares and saves' : 'Закрепи — провоцирует пересылки и сохранения'}</div>
    </div>

    <!-- First Comment -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">💬 ${isEN ? 'First Comment' : 'Первый комментарий'}</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(firstComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Post right after publishing — sparks discussion' : 'Напиши сразу после публикации — запускает обсуждение'}</div>
    </div>

    <!-- Engagement Tip -->
    ${instaEngagementTip ? `<div class="glass-panel p-4 relative border-l-2 border-teal-400/40">
      <div class="text-[10px] text-teal-400 font-semibold uppercase tracking-wider mb-2">💡 ${isEN ? 'Engagement Tip' : 'Лайфхак для охватов'}</div>
      <div class="text-sm text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(instaEngagementTip)}</div>
    </div>` : ''}

    <!-- Share bait tip -->
    <div class="bg-gradient-to-r from-violet-500/8 to-cyan-500/8 rounded-lg p-4 border border-violet-500/15">
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">🚀 ${isEN ? 'Instagram Publishing Order' : 'Порядок публикации в Instagram'}</div>
      <div class="text-xs text-gray-300 leading-relaxed space-y-1.5">
        ${isEN ? `
        <div>1. <span class="text-amber-300 font-medium">Title</span> → paste as Reels caption. Title only, no hashtags!</div>
        <div>2. <span class="text-gray-200 font-medium">Publish</span> your Reel</div>
        <div>3. <span class="text-cyan-300 font-medium">Hashtags</span> → post as FIRST comment (IG doesn't throttle reach)</div>
        <div>4. <span class="text-emerald-300 font-medium">Pin</span> → write a second comment and pin it (triggers "send to a friend")</div>
        <div>5. <span class="text-violet-300 font-medium">First comment</span> → post third comment 1-2 min later (sparks discussion)</div>
        ` : `
        <div>1. <span class="text-amber-300 font-medium">Заголовок</span> → вставь в описание Reels (caption). Только заголовок, без хештегов!</div>
        <div>2. <span class="text-gray-200 font-medium">Опубликуй</span> Reels</div>
        <div>3. <span class="text-cyan-300 font-medium">Хештеги</span> → напиши ПЕРВЫЙ комментарий с хештегами (IG не режет охват)</div>
        <div>4. <span class="text-emerald-300 font-medium">Закреп</span> → напиши второй коммент и закрепи его (провоцирует «отправь подруге»)</div>
        <div>5. <span class="text-violet-300 font-medium">Первый коммент</span> → напиши третий коммент через 1-2 мин (запускает обсуждение)</div>
        `}
      </div>
      <div class="text-[9px] text-gray-500 mt-3">${isEN ? 'Series' : 'Серия'}: ${charA.id === charB.id ? (charA.name_ru || 'A') + ' (соло)' : (charA.name_ru || 'A') + ' × ' + (charB.name_ru || 'B')} — ${isEN ? 'use one series tag for all videos' : 'используй один серийный тег на все видео'}</div>
    </div>
  `;
}

function populateDialogueEditor(result) {
  const editor = document.getElementById('dialogue-editor');
  if (!editor || !result.blueprint_json?.dialogue_segments) return;
  editor.classList.remove('hidden');

  const segs = result.blueprint_json.dialogue_segments;
  const lineA = segs.find(s => s.speaker === 'A');
  const lineB = segs.find(s => s.speaker === 'B');
  const ctx = result._apiContext || {};
  const isSolo = ctx.soloMode || (ctx.charA && ctx.charB && ctx.charA.id === ctx.charB.id);

  const inputA = document.getElementById('editor-line-a');
  const inputB = document.getElementById('editor-line-b');
  if (inputA && lineA) inputA.value = lineA.text_ru;
  if (inputB && lineB) inputB.value = lineB.text_ru;

  // Hide B editor row in solo mode
  const bRow = inputB?.closest('.space-y-2, .flex, div')?.parentElement;
  const labelA = inputA?.previousElementSibling || inputA?.closest('div')?.querySelector('label');
  if (isSolo) {
    if (bRow && inputB) inputB.closest('.bg-black\\/30, div[class*=editor]')?.classList.add('hidden');
    if (labelA) labelA.textContent = '🎤 Монолог';
  } else {
    if (bRow && inputB) inputB.closest('.bg-black\\/30, div[class*=editor]')?.classList.remove('hidden');
    if (labelA) labelA.textContent = '🅰️ Реплика A';
  }

  updateEditorEstimates();
}

async function callAIEngine(apiContext) {
  const token = localStorage.getItem('ferixdi_jwt');
  const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  if (!token) return null;

  // Build payload with optional multimodal attachments
  const payload = { 
    context: apiContext,
    generation_mode: state.generationMode || state.inputMode,
    selected_location_id: state.selectedLocation,
    thread_memory: getThreadMemory()
  };

  // Attach product photo if available — AI engine will SEE the actual product
  if (state.productInfo?.image_base64) {
    payload.product_image = state.productInfo.image_base64;
    payload.product_mime = state.productInfo.mime_type || 'image/jpeg';
  }

  // Attach actual video file if available — AI engine will WATCH the original video
  if (state._videoFileBase64) {
    payload.video_file = state._videoFileBase64;
    payload.video_file_mime = state._videoFileMime || 'video/mp4';
  }
  // Attach video cover as fallback if video file too large or unavailable
  if (state.videoMeta?.cover_base64) {
    payload.video_cover = state.videoMeta.cover_base64;
    payload.video_cover_mime = 'image/jpeg';
  }

  // Attach meme image/video for meme-remake mode
  if (state.generationMode === 'meme') {
    if (state._memeFileBase64) {
      payload.meme_file = state._memeFileBase64;
      payload.meme_file_mime = state._memeFileMime || 'video/mp4';
    }
    if (state._memeImageBase64) {
      payload.meme_image = state._memeImageBase64;
      payload.meme_image_mime = 'image/jpeg';
    }
    payload.meme_context = document.getElementById('meme-context')?.value?.trim() || '';
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
  return data.ai;
}

// ─── GENERATION HISTORY (localStorage) ──────
const GEN_HISTORY_KEY = 'ferixdi_gen_history';
const GEN_HISTORY_MAX = 10;

function saveGenerationHistory(result) {
  try {
    const history = JSON.parse(localStorage.getItem(GEN_HISTORY_KEY) || '[]');
    const entry = {
      ts: Date.now(),
      charA: state.selectedA?.name_ru || '?',
      charB: state.selectedB?.name_ru || '?',
      category: result.log?.category?.ru || '',
      dialogueA: result.blueprint_json?.dialogue_segments?.find(s => s.speaker === 'A')?.text_ru || '',
      dialogueB: result.blueprint_json?.dialogue_segments?.find(s => s.speaker === 'B')?.text_ru || '',
      killerWord: result.blueprint_json?.killer_word || '',
    };
    history.push(entry);
    if (history.length > GEN_HISTORY_MAX) history.splice(0, history.length - GEN_HISTORY_MAX);
    localStorage.setItem(GEN_HISTORY_KEY, JSON.stringify(history));
  } catch { /* ignore */ }
}

function getThreadMemory() {
  try {
    const history = JSON.parse(localStorage.getItem(GEN_HISTORY_KEY) || '[]');
    if (history.length === 0) return null;
    return history.slice(-3).map(h => ({
      category: h.category,
      dialogueA: h.dialogueA,
      dialogueB: h.dialogueB,
    }));
  } catch { return null; }
}

function initGenerate() {
  document.getElementById('btn-generate')?.addEventListener('click', async () => {
    // Validate complete workflow
    if (!state.generationMode) {
      showGenStatus('⚠️ Сначала выберите режим генерации на шаге 1', 'text-orange-400');
      navigateTo('generation-mode');
      return;
    }
    
    if (!state.selectedA) {
      showGenStatus('⚠️ Сначала выберите хотя бы одного персонажа на шаге 3', 'text-orange-400');
      navigateTo('characters');
      return;
    }

    // Enhanced validation for all modes
    if (state.generationMode === 'script') {
      const scriptA = document.getElementById('script-a')?.value.trim();
      const scriptB = document.getElementById('script-b')?.value.trim();
      if (!scriptA && !scriptB) {
        showGenStatus('⚠️ Напиши хотя бы одну реплику (A или B)', 'text-orange-400');
        return;
      }
      
      // Additional validation for script mode (per-speaker limits)
      // Solo monologue (only A filled) allows up to 30 words; duo keeps 15/18
      const isSoloScript = scriptA && !scriptB;
      const maxWordsA = isSoloScript ? 30 : 15;
      const maxWordsB = 18;
      if (scriptA && scriptA.split(/\s+/).length > maxWordsA) {
        showGenStatus(`⚠️ Реплика A слишком длинная (${scriptA.split(/\s+/).length} слов). Максимум: ${maxWordsA} слов`, 'text-orange-400');
        return;
      }
      if (scriptB && scriptB.split(/\s+/).length > maxWordsB) {
        showGenStatus(`⚠️ Реплика B слишком длинная (${scriptB.split(/\s+/).length} слов). Максимум: ${maxWordsB} слов`, 'text-orange-400');
        return;
      }
    }
    
    // Validation for idea and suggested modes — topic is optional for suggested
    if (state.generationMode === 'idea') {
      const topicVal = document.getElementById('idea-input')?.value.trim();
      if (!topicVal) {
        showGenStatus('⚠️ Напишите идею для генерации', 'text-orange-400');
        return;
      }
    }
    
    if (state.generationMode === 'video' && !state.videoMeta) {
      showGenStatus('⚠️ Загрузите видео-файл выше ↑ в секции «🎥 Видео-референс»', 'text-orange-400');
      document.getElementById('remix-video')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    
    if (state.generationMode === 'meme') {
      if (!state._memeImageBase64 && !state._memeFileBase64) {
        showGenStatus('⚠️ Загрузите мем или видео-референс', 'text-orange-400');
        document.getElementById('remix-meme')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!(document.getElementById('meme-context')?.value?.trim())) {
        showGenStatus('⚠️ Опишите что происходит на мем/видео', 'text-orange-400');
        return;
      }
    }
    
    // Validate location selection (optional but recommended)
    if (!state.selectedLocation) {
      // Location is optional, but we should inform user
      console.log('INFO: No location selected, will use auto-selection');
    }
    
    // Scene hint validation for video mode
    if (state.generationMode === 'video') {
      const sceneHint = (document.getElementById('scene-hint-main')?.value || document.getElementById('scene-hint')?.value || '').trim();
      if (sceneHint && sceneHint.length > 200) {
        showGenStatus('⚠️ Описание видео слишком длинное (максимум 200 символов). Сократите текст.', 'text-orange-400');
        return;
      }
    }

    const btn = document.getElementById('btn-generate');

    // Проверка промо-кода перед генерацией
    if (!isPromoValid()) {
      showGenStatus('🔑 Для генерации нужен промо-код. Введите его в разделе «Настройки».', 'text-amber-400');
      log('WARN', 'ГЕНЕРАЦИЯ', 'Промо-код не введён — генерация заблокирована');
      return;
    }

    sfx.generate();
    btn.disabled = true;
    btn.textContent = '⏳ Анализирую контекст...';
    showGenStatus('🔍 Анализирую тему и подбираю параметры...', 'text-cyan-400');

    // Reset previous results, error overlay, and preflight status
    document.getElementById('gen-error-overlay')?.remove();
    document.getElementById('gen-results')?.classList.add('hidden');
    const pfEl = document.getElementById('gen-preflight');
    if (pfEl) { pfEl.classList.add('hidden'); pfEl.innerHTML = ''; }

    // Read topic text based on current mode — prevent stale idea-input leaking into script/video
    let topicText = '';
    if (state.generationMode === 'idea') {
      topicText = document.getElementById('idea-input')?.value || '';
    } else if (state.generationMode === 'suggested') {
      topicText = document.getElementById('idea-input-suggested')?.value || document.getElementById('idea-input')?.value || '';
    }
    // script and video modes: topicText stays empty — their content comes from script_ru / video_meta
    const input = {
      input_mode: state.generationMode || state.inputMode,
      character1_id: state.selectedA.id,
      character2_id: state.selectedB ? state.selectedB.id : null,
      context_ru: topicText,
      script_ru: state.generationMode === 'script' ? {
        A: document.getElementById('script-a')?.value || '',
        B: document.getElementById('script-b')?.value || ''
      } : null,
      scene_hint_ru: document.getElementById('scene-hint-main')?.value || document.getElementById('scene-hint')?.value || null,
      // Let generator.js handle category auto-detection (no manual override)
      thread_memory: getThreadMemory(),
      video_meta: state.videoMeta,
      product_info: state.productInfo,
      reference_style: state.referenceStyle,
      options: state.options,
      seed: Date.now().toString(),
      characters: state.characters,
      locations: state.locations,
      selected_location_id: state.selectedLocation,
      // Meme mode data
      meme_context: state.generationMode === 'meme' ? (document.getElementById('meme-context')?.value?.trim() || '') : null,
    };

    // Step 1: Local generation (instant, structural template)
    let localResult;
    try {
      localResult = generate(input);
    } catch (e) {
      showGenStatus(`❌ Ошибка генерации: ${e.message}`, 'text-red-400');
      log('ERR', 'GEN', e.message);
      btn.disabled = false;
      btn.textContent = '🚀 Собрать промпт';
      return;
    }

    if (localResult.error) {
      displayResult(localResult);
      btn.disabled = false;
      btn.textContent = '🚀 Собрать промпт';
      return;
    }

    // Step 1.5: Show pre-flight parameter breakdown
    btn.textContent = '⏳ Подготавливаю промпты...';
    showGenStatus('📋 Структура готова, создаю промпты для AI...', 'text-cyan-400');
    renderPreflight(localResult);

    // Step 2: If API mode — send context to AI engine for creative refinement
    const isApiMode = state.settingsMode === 'api' && (localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL);

    if (isApiMode && localResult._apiContext) {
      btn.textContent = '⚡ AI собирает промпт...';
      showGenStatus('🧠 FERIXDI AI собирает промпт и сюжет... (15-30с)', 'text-violet-400');
      log('INFO', 'AI', 'Собираю промпт и диалог...');

      try {
        const aiData = await callAIEngine(localResult._apiContext);
        if (aiData) {
          const merged = mergeGeminiResult(localResult, aiData);
          log('OK', 'AI', 'Промпт и сюжет готовы');
          updatePreflightStatus('✅ Готово · Промпт собран — скопируй и вставь в Google Flow', 'bg-emerald-500/8 text-emerald-400 border border-emerald-500/15');
          saveGenerationHistory(merged);
          displayResult(merged);
        } else {
          // No JWT token — try to auto-auth and show local result for now
          log('WARN', 'AI', 'Нет токена — показываю локальный результат');
          updatePreflightStatus('⚠️ Нет токена — показан локальный шаблон', 'bg-amber-500/8 text-amber-400 border border-amber-500/15');
          if (isPromoValid()) autoAuth();
          displayResult(localResult);
        }
      } catch (apiErr) {
        log('ERR', 'AI', `Ошибка API: ${apiErr.message}`);
        updatePreflightStatus(`❌ Ошибка генерации: ${apiErr.message?.slice(0, 60) || 'неизвестная'}`, 'bg-red-500/8 text-red-400 border border-red-500/15');
        showGenStatus('', '');
        document.getElementById('gen-results').classList.remove('hidden');

        // Enhanced error handling with specific error types and actionable buttons
        let errorTitle = 'Сервис временно недоступен';
        let errorDesc = escapeHtml(apiErr.message);
        let errorAction = 'Попробуйте снова через несколько минут';
        let errorIcon = '⚠️';
        let errorButtons = '';

        if (apiErr.message?.includes('429') || apiErr.message?.includes('rate limit')) {
          errorTitle = 'Слишком много запросов';
          errorDesc = 'Превышен лимит запросов. Подождите немного перед следующей генерацией.';
          errorAction = 'Лимит сбросится через 1 минуту';
          errorIcon = '⏱️';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors text-sm">
              🔄 Попробовать снова
            </button>
          `;
        } else if (apiErr.message?.includes('401') || apiErr.message?.includes('unauthorized')) {
          errorTitle = 'Ошибка авторизации';
          errorDesc = 'Промо-код истёк или недействителен. Проверьте настройки.';
          errorAction = 'Введите новый промо-код в разделе «Настройки»';
          errorIcon = '🔑';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();navigateTo('settings')" class="px-4 py-2 bg-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/30 transition-colors text-sm">
              🔑 Перейти к настройкам
            </button>
          `;
        } else if (apiErr.message?.includes('502') || apiErr.message?.includes('503') || apiErr.message?.includes('504')) {
          errorTitle = 'Сервер перезагружается';
          errorDesc = 'AI-движок обновляется или перезапускается. Это занимает 30–60 секунд.';
          errorAction = 'Нажмите «Собрать промпт» повторно через минуту';
          errorIcon = '🔄';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
              🚀 Собрать промпт снова
            </button>
          `;
        } else if (apiErr.message?.includes('timeout') || apiErr.message?.includes('network') || apiErr.message?.includes('Failed to fetch')) {
          errorTitle = 'Проблемы с соединением';
          errorDesc = 'Не удалось подключиться к AI. Проверьте интернет-соединение.';
          errorAction = 'Попробуйте снова или проверьте подключение';
          errorIcon = '🌐';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
              🔄 Попробовать снова
            </button>
          `;
        } else if (apiErr.message?.includes('quota') || apiErr.message?.includes('exceeded')) {
          errorTitle = 'Лимит генераций исчерпан';
          errorDesc = 'Достигнут лимит генераций. Попробуйте позже или напишите в поддержку.';
          errorAction = 'Подождите немного или свяжитесь с @ferixdiii в Telegram';
          errorIcon = '📊';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm">
              🔄 Попробовать снова
            </button>
            <button onclick="window.open('https://t.me/ferixdiii', '_blank')" class="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors text-sm">
              💬 Поддержка
            </button>
          `;
        } else {
          errorTitle = 'Ошибка сборки промпта';
          errorDesc = escapeHtml(apiErr.message || 'Непредвиденная ошибка');
          errorAction = 'Попробуйте снова через несколько секунд';
          errorIcon = '⚠️';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors text-sm">
              🔄 Попробовать снова
            </button>
            <button onclick="window.open('https://t.me/ferixdiii', '_blank')" class="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors text-sm">
              💬 Поддержка
            </button>
          `;
        }

        // Show error as overlay INSIDE gen-results without destroying existing DOM
        document.getElementById('gen-error-overlay')?.remove();
        const errDiv = document.createElement('div');
        errDiv.id = 'gen-error-overlay';
        errDiv.innerHTML = `
          <div class="glass-panel p-6 text-center space-y-4">
            <div class="text-4xl">${errorIcon}</div>
            <div class="text-lg text-red-400 font-semibold">${errorTitle}</div>
            <div class="text-sm text-gray-400 max-w-md mx-auto">${errorDesc}</div>
            <div class="text-xs text-gray-500 mt-2">${errorAction}</div>
            ${errorButtons ? `<div class="flex gap-3 justify-center flex-wrap mt-4">${errorButtons}</div>` : ''}
          </div>
        `;
        const genResults = document.getElementById('gen-results');
        genResults.prepend(errDiv);
      }
    } else {
      // Demo mode or API without _apiContext — show local result with better UX
      const hasPromo = isPromoValid();
      updatePreflightStatus(hasPromo ? '📋 Локальная генерация · AI-движок недоступен' : '📋 Демо-режим · Введите промо-код для полной генерации', 'bg-gray-500/8 text-gray-400 border border-gray-500/15');
      
      // Add helpful info about local vs AI generation
      if (!hasPromo) {
        localResult.warnings = localResult.warnings || [];
        localResult.warnings.push('Для генерации уникального контента с FERIXDI AI введите промо-код в разделе "Настройки"');
      } else {
        localResult.warnings = localResult.warnings || [];
        localResult.warnings.push('AI-движок временно недоступен — показан локальный шаблон');
      }
      
      displayResult(localResult);
    }

    btn.disabled = false;
    btn.textContent = '🚀 Собрать промпт';
  });

  // Result tabs
  document.querySelectorAll('#gen-results .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#gen-results .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      ['veo', 'photo', 'video', 'insta', 'ru', 'blueprint'].forEach(t => {
        document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== tab);
      });
    });
  });

  // Regenerate with feedback
  document.getElementById('btn-regenerate')?.addEventListener('click', () => {
    const feedback = document.getElementById('regen-feedback')?.value.trim();
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) {
      // Append feedback to the idea input so generator picks it up
      const prev = ideaInput.value.trim();
      const feedbackLine = feedback ? `[ДОРАБОТКА: ${feedback}]` : '';
      ideaInput.value = prev ? `${prev}\n${feedbackLine}` : feedbackLine;
    }
    // Clear feedback field
    if (document.getElementById('regen-feedback')) document.getElementById('regen-feedback').value = '';
    // Trigger generation
    document.getElementById('btn-generate')?.click();
  });
}

// ─── ENGLISH ADAPTATION ─────────────────────
function initTranslate() {
  document.getElementById('btn-translate-en')?.addEventListener('click', async () => {
    log('INFO', 'TRANSLATE', 'Кнопка нажата — начинаем адаптацию...');
    const result = state.lastResult;
    if (!result) {
      log('ERR', 'TRANSLATE', 'state.lastResult пустой — нет данных для перевода');
      showNotification('❌ Нет результата для перевода — сначала сгенерируйте контент', 'error');
      return;
    }

    const btn = document.getElementById('btn-translate-en');
    btn.disabled = true;
    btn.innerHTML = '⏳ Переводим на English...';

    // Extract current dialogue from blueprint or context
    const segs = result.blueprint_json?.dialogue_segments || [];
    const lineA = segs.find(s => s.speaker === 'A');
    const lineB = segs.find(s => s.speaker === 'B');
    const lineA2 = segs.find(s => s.speaker === 'A2');
    const ctx = result._apiContext || {};
    const dialogueA = lineA?.text_ru || ctx.dialogueA || '';
    const dialogueB = lineB?.text_ru || ctx.dialogueB || '';
    const dialogueA2 = lineA2?.text_ru || '';
    const killerWord = result.blueprint_json?.killer_word || ctx.killerWord || '';

    log('INFO', 'TRANSLATE', `A="${dialogueA?.slice(0, 30)}..." B="${dialogueB?.slice(0, 30)}..." kw="${killerWord}"`);

    // Extract insta pack
    const engage = result.log?.engagement || {};

    const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    let token = localStorage.getItem('ferixdi_jwt');
    if (!token) {
      log('ERR', 'TRANSLATE', 'JWT токен отсутствует — переавторизуемся...');
      // Auto-retry auth before giving up
      await autoAuth();
      token = localStorage.getItem('ferixdi_jwt');
      if (!token) {
        btn.innerHTML = '❌ Нет токена — введите промо-код в Настройках';
        setTimeout(() => { btn.innerHTML = '🇬🇧 Адаптация на English'; btn.disabled = false; }, 2500);
        return;
      }
      log('OK', 'TRANSLATE', 'JWT получен после переавторизации');
    }

    try {
      log('INFO', 'TRANSLATE', `Отправляем запрос на ${apiUrl}/api/translate...`);
      const resp = await fetch(`${apiUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          dialogue_A_ru: dialogueA,
          dialogue_B_ru: dialogueB,
          dialogue_A2_ru: dialogueA2 || undefined,
          killer_word: killerWord,
          viral_title: engage.viral_title || '',
          share_bait: engage.share_bait || '',
          pin_comment: engage.pin_comment || '',
          first_comment: engage.first_comment || '',
          hashtags: engage.hashtags || [],
          series_tag: engage.series_tag || '',
          veo_prompt: result.veo_prompt || '',
          ru_package: result.ru_package || '',
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `API error ${resp.status}`);
      }

      const en = await resp.json();

      // Update dialogue display
      const dA = document.getElementById('gen-dialogue-a');
      const dB = document.getElementById('gen-dialogue-b');
      const kw = document.getElementById('gen-killer-word');
      if (dA && en.dialogue_A_en) dA.textContent = `«${en.dialogue_A_en}»`;
      if (dB && en.dialogue_B_en) dB.textContent = `«${en.dialogue_B_en}»`;
      if (kw && en.killer_word_en) kw.textContent = `💥 Killer word: «${en.killer_word_en}»`;

      // Update Veo prompt (both DOM and state)
      // REMAKE mode: veo_prompt is already remake_veo_prompt_en (fully English, ultra-detailed)
      // — do NOT overwrite with re-translated version that Gemini may paraphrase/shorten
      if (en.veo_prompt_en && !result.is_remake) {
        result.veo_prompt = en.veo_prompt_en;
        document.getElementById('veo-prompt-text').textContent = en.veo_prompt_en;
      }

      // Update video prompt JSON dialogue
      if (result.video_prompt_en_json?.dialogue) {
        if (en.dialogue_A_en) result.video_prompt_en_json.dialogue.final_A_ru = en.dialogue_A_en;
        if (en.dialogue_B_en) result.video_prompt_en_json.dialogue.final_B_ru = en.dialogue_B_en;
        if (en.killer_word_en) result.video_prompt_en_json.dialogue.killer_word = en.killer_word_en;
        document.querySelector('#tab-video pre').textContent = JSON.stringify(result.video_prompt_en_json, null, 2);
      }

      // Update blueprint dialogue segments
      if (result.blueprint_json?.dialogue_segments) {
        const segA = result.blueprint_json.dialogue_segments.find(s => s.speaker === 'A');
        const segB = result.blueprint_json.dialogue_segments.find(s => s.speaker === 'B');
        const segA2 = result.blueprint_json.dialogue_segments.find(s => s.speaker === 'A2');
        if (segA && en.dialogue_A_en) segA.text_ru = en.dialogue_A_en;
        if (segB && en.dialogue_B_en) segB.text_ru = en.dialogue_B_en;
        if (segA2 && en.dialogue_A2_en) segA2.text_ru = en.dialogue_A2_en;
        if (en.killer_word_en) result.blueprint_json.killer_word = en.killer_word_en;
        document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(result.blueprint_json, null, 2);
      }

      // Update insta tab with English content
      result.log = result.log || {};
      result.log.engagement = result.log.engagement || {};
      if (en.viral_title_en) result.log.engagement.viral_title = en.viral_title_en;
      if (en.share_bait_en) result.log.engagement.share_bait = en.share_bait_en;
      if (en.pin_comment_en) result.log.engagement.pin_comment = en.pin_comment_en;
      if (en.first_comment_en) result.log.engagement.first_comment = en.first_comment_en;
      if (en.hashtags_en) result.log.engagement.hashtags = en.hashtags_en;
      if (en.series_tag_en) result.log.engagement.series_tag = en.series_tag_en;
      // Mark English mode and re-render insta tab with English labels
      result._isEnglish = true;
      populateInstaTab(result);

      // Update ru_package tab (now English)
      if (en.ru_package_en) {
        result.ru_package = en.ru_package_en;
        document.querySelector('#tab-ru pre').textContent = en.ru_package_en;
      }

      // Update dialogue editor inputs
      const edA = document.getElementById('editor-line-a');
      const edB = document.getElementById('editor-line-b');
      if (edA && en.dialogue_A_en) edA.value = en.dialogue_A_en;
      if (edB && en.dialogue_B_en) edB.value = en.dialogue_B_en;

      // Switch tab label from 🇷🇺 to 🇬🇧
      const ruTabBtn = document.querySelector('#gen-results .mode-btn[data-tab="ru"]');
      if (ruTabBtn) ruTabBtn.textContent = '🇬🇧 Post';

      // Sync _apiContext with English values so downstream readers stay consistent
      const trCtx = result._apiContext || {};
      if (en.dialogue_A_en) trCtx.dialogueA = en.dialogue_A_en;
      if (en.dialogue_B_en) trCtx.dialogueB = en.dialogue_B_en;
      if (en.killer_word_en) trCtx.killerWord = en.killer_word_en;

      btn.innerHTML = '✅ English готово!';
      log('OK', 'TRANSLATE', `Адаптация на English: A="${en.dialogue_A_en?.slice(0, 40)}..." B="${en.dialogue_B_en?.slice(0, 40)}..."`);
      showNotification('🇬🇧 Весь контент адаптирован на английский — диалог, инста-пакет, хештеги, описание!', 'success');

      setTimeout(() => { btn.innerHTML = '🇬🇧 Адаптация на English'; btn.disabled = false; }, 3000);

    } catch (e) {
      log('ERR', 'TRANSLATE', e.message);
      btn.innerHTML = `❌ ${e.message?.slice(0, 40) || 'Ошибка'}`;
      setTimeout(() => { btn.innerHTML = '🇬🇧 Адаптация на English'; btn.disabled = false; }, 3000);
    }
  });
}

// Timing section removed — timing info shown inline in dialogue editor

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
        sfx.copy();
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

  // Sound toggle
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle) {
    soundToggle.checked = sfx.isEnabled();
    soundToggle.addEventListener('change', () => {
      sfx.setEnabled(soundToggle.checked);
      localStorage.setItem('ferixdi_sounds', soundToggle.checked ? 'on' : 'off');
      if (soundToggle.checked) sfx.success();
      log('INFO', 'ЗВУК', soundToggle.checked ? 'Звуки включены' : 'Звуки выключены');
    });
  }
}

function updateCacheStats() {
  const stats = historyCache.getStats();
  const el = document.getElementById('cache-stats');
  if (el) el.textContent = `Лок: ${stats.locations} | Рекв: ${stats.props} | Одежда: ${stats.wardrobes}`;
}

// ─── SHARED: Apply dialogue changes to all prompts ──
function applyDialogueUpdate(newA, newB) {
  if (!state.lastResult) return;
  const ctx = state.lastResult._apiContext || {};
  const isSolo = ctx.soloMode || (!state.selectedB || state.selectedA?.id === state.selectedB?.id);

  // Update blueprint
  const bp = state.lastResult.blueprint_json;
  if (bp?.dialogue_segments) {
    const segA = bp.dialogue_segments.find(s => s.speaker === 'A');
    if (segA) segA.text_ru = newA;
    if (!isSolo) {
      const segB = bp.dialogue_segments.find(s => s.speaker === 'B');
      if (segB) segB.text_ru = newB;
    }
  }
  if (bp?.scenes) {
    const sceneA = bp.scenes.find(s => s.segment === 'act_A' || s.segment === 'monologue');
    if (sceneA) sceneA.dialogue_ru = newA;
    if (!isSolo) {
      const sceneB = bp.scenes.find(s => s.segment === 'act_B');
      if (sceneB) sceneB.dialogue_ru = newB;
    }
  }

  // Update video prompt
  const vp = state.lastResult.video_prompt_en_json;
  if (vp?.dialogue) {
    vp.dialogue.final_A_ru = newA;
    if (isSolo) {
      vp.dialogue.final_B_ru = null;
      const lastWord = newA.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || 'панч';
      vp.dialogue.killer_word = lastWord;
    } else {
      vp.dialogue.final_B_ru = newB;
      const lastWord = newB.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || 'панч';
      vp.dialogue.killer_word = lastWord;
    }
  }

  // Rebuild ru_package — replace dialogue lines in the text
  if (state.lastResult.ru_package) {
    let pkg = state.lastResult.ru_package;
    if (isSolo) {
      // Solo: replace monologue line «old text» → «new text» (after 🎤 section)
      pkg = pkg.replace(/(🎤[^\n]*\n\s*«)[^»]*(»)/, `$1${newA}$2`);
    } else {
      pkg = pkg.replace(/(🅰️[^\n]*\n\s*«)[^»]*(»)/, `$1${newA}$2`);
      pkg = pkg.replace(/(🅱️[^\n]*\n\s*«)[^»]*(»)/, `$1${newB}$2`);
    }
    // Also update killer_word line in ru_package
    const newKw = vp?.dialogue?.killer_word || '';
    if (newKw) {
      pkg = pkg.replace(/(KILLER WORD \u00ab)[^\u00bb]*(\u00bb)/, `$1${newKw}$2`);
    }
    state.lastResult.ru_package = pkg;
    const ruPre = document.querySelector('#tab-ru pre');
    if (ruPre) ruPre.textContent = pkg;
  }

  // Re-estimate timing
  const lines = isSolo
    ? [{ speaker: 'A', text: newA, pace: state.selectedA?.speech_pace || 'normal' }]
    : [
        { speaker: 'A', text: newA, pace: state.selectedA?.speech_pace || 'normal' },
        { speaker: 'B', text: newB, pace: state.selectedB?.speech_pace || 'normal' },
      ];
  state.lastResult.duration_estimate = estimateDialogue(lines);

  // Re-render tabs
  document.querySelector('#tab-video pre').textContent = JSON.stringify(state.lastResult.video_prompt_en_json, null, 2);
  document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(state.lastResult.blueprint_json, null, 2);

  // Re-render Veo prompt if dialogue changed (replace old dialogue lines)
  if (state.lastResult.veo_prompt) {
    let veo = state.lastResult.veo_prompt;
    if (isSolo) {
      // Solo: replace "Character speaks in Russian to the camera: ..." line
      veo = veo.replace(/(Character speaks in Russian to the camera: ")[^"]*(")/, `$1${newA.replace(/\s*\|\s*/g, '... ')}$2`);
    } else {
      veo = veo.replace(/(A speaks in Russian to the camera: ")[^"]*(")/, `$1${newA.replace(/\s*\|\s*/g, '... ')}$2`);
      veo = veo.replace(/(B responds in Russian: ")[^"]*(")/, `$1${newB.replace(/\s*\|\s*/g, '... ')}$2`);
    }
    // Also update killer_word references in Veo prompt
    const newKwVeo = vp?.dialogue?.killer_word || '';
    if (newKwVeo) {
      veo = veo.replace(/(The word ")[^"]*(?=" is the punchline)/, `$1${newKwVeo}`);
    }
    state.lastResult.veo_prompt = veo;
    const veoEl = document.getElementById('veo-prompt-text');
    if (veoEl) veoEl.textContent = veo;
  }

  // Sync dialogue editor fields
  const edA = document.getElementById('editor-line-a');
  const edB = document.getElementById('editor-line-b');
  if (edA) edA.value = newA;
  if (edB && !isSolo) edB.value = newB;
  updateEditorEstimates();

  // Sync context block display (gen-dialogue-a/b/killer-word) — keep UI in sync with prompt
  const killerWord = vp?.dialogue?.killer_word || bp?.killer_word || '';
  if (bp) bp.killer_word = killerWord;
  const dAEl = document.getElementById('gen-dialogue-a');
  const dBEl = document.getElementById('gen-dialogue-b');
  const kwEl = document.getElementById('gen-killer-word');
  if (dAEl) dAEl.textContent = `«${newA}»`;
  if (dBEl && !isSolo) dBEl.textContent = `«${newB}»`;
  if (kwEl && killerWord) kwEl.textContent = `💥 Killer word: «${killerWord}»`;

  // Sync _apiContext fallback values so downstream readers get correct dialogue
  if (ctx.dialogueA !== undefined) ctx.dialogueA = newA;
  if (ctx.dialogueB !== undefined) ctx.dialogueB = newB;
  if (ctx.killerWord !== undefined) ctx.killerWord = killerWord;
}

// ─── DIALOGUE EDITOR ────────────────────
function updateEditorEstimates() {
  const inputA = document.getElementById('editor-line-a');
  const inputB = document.getElementById('editor-line-b');
  if (!inputA) return;

  const ctx = state.lastResult?._apiContext || {};
  const isSolo = ctx.soloMode || (!state.selectedB || state.selectedA?.id === state.selectedB?.id);

  const paceA = state.selectedA?.speech_pace || 'normal';
  const estA = estimateLineDuration(inputA.value, paceA);
  const wordsA = inputA.value.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;

  if (isSolo) {
    // Solo mode: monologue uses 6.4s window (0.6–7.0)
    const overA = estA.duration > 7.6; // 6.4s window + 1.2s tolerance
    const risk = overA ? 'high' : estA.duration > 5.5 ? 'medium' : 'low';

    document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 30 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}с / 7.6с · ${wordsA} слов${overA ? ' — НЕ ВЛЕЗЕТ!' : wordsA > 30 ? ' — много' : ''}</span>`;
    const estBEl = document.getElementById('editor-est-b');
    if (estBEl) estBEl.innerHTML = '<span class="text-gray-600">— соло —</span>';

    const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
    const riskLabel = risk === 'high' ? '🚨 ПРЕВЫШЕНИЕ' : risk === 'medium' ? '⚠️ БЛИЗКО' : '✓ ОК';
    document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Монолог: ${estA.duration.toFixed(2)}с / 6.4с ${riskLabel}</span>`;

    const badge = document.getElementById('editor-timing-badge');
    if (badge) {
      badge.textContent = `${estA.duration.toFixed(1)}с`;
      badge.className = `tag text-[10px] ${risk === 'high' ? 'tag-pink' : risk === 'medium' ? 'tag-orange' : 'tag-green'}`;
    }
  } else {
    // Duo mode
    if (!inputB) return;
    const paceB = state.selectedB?.speech_pace || 'normal';
    const estB = estimateLineDuration(inputB.value, paceB);
    const total = estA.duration + estB.duration;
    const wordsB = inputB.value.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;

    const overA = estA.duration > 4.7; // 3.5s window + 1.2s tolerance (speech flex)
    const overB = estB.duration > 5.2; // 4.0s window + 1.2s tolerance
    const risk = total > 8.5 || overA || overB ? 'high' : total > 7.0 ? 'medium' : 'low';

    document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 15 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}с / 4.7с · ${wordsA} слов${overA ? ' — НЕ ВЛЕЗЕТ!' : wordsA > 15 ? ' — много' : ''}</span>`;
    document.getElementById('editor-est-b').innerHTML = `<span class="${overB ? 'text-red-400' : wordsB > 18 ? 'text-orange-400' : 'text-gray-500'}">${estB.duration}с / 5.2с · ${wordsB} слов${overB ? ' — НЕ ВЛЕЗЕТ!' : wordsB > 18 ? ' — много' : ''}</span>`;

    const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
    const riskLabel = risk === 'high' ? '🚨 ПРЕВЫШЕНИЕ' : risk === 'medium' ? '⚠️ БЛИЗКО' : '✓ ОК';
    document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Речь: ${total.toFixed(2)}с / 7.5с ${riskLabel}</span>`;

    const badge = document.getElementById('editor-timing-badge');
    if (badge) {
      badge.textContent = `${total.toFixed(1)}с`;
      badge.className = `tag text-[10px] ${risk === 'high' ? 'tag-pink' : risk === 'medium' ? 'tag-orange' : 'tag-green'}`;
    }
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
    if (!inputA) return;

    const ctx = state.lastResult?._apiContext || {};
    const isSolo = ctx.soloMode || (!state.selectedB || state.selectedA?.id === state.selectedB?.id);

    const lines = isSolo
      ? [{ speaker: 'A', text: inputA.value, pace: state.selectedA?.speech_pace || 'normal' }]
      : [
          { speaker: 'A', text: inputA.value, pace: state.selectedA?.speech_pace || 'normal' },
          { speaker: 'B', text: inputB?.value || '', pace: state.selectedB?.speech_pace || 'normal' },
        ];

    const result = autoTrim(lines);
    if (result.trimmed) {
      const newA = result.lines.find(l => l.speaker === 'A');
      const newB = result.lines.find(l => l.speaker === 'B');
      if (newA) inputA.value = newA.text;
      if (newB && inputB && !isSolo) inputB.value = newB.text;
      updateEditorEstimates();

      const fixesEl = document.getElementById('editor-fixes');
      if (fixesEl) {
        fixesEl.classList.remove('hidden');
        fixesEl.innerHTML = result.auto_fixes.map(f => `<div>✓ ${escapeHtml(f)}</div>`).join('');
      }
      log('OK', 'РЕДАКТОР', `Авто-сокращение: ${result.auto_fixes.length} исправлений`);
    } else {
      const fixesEl = document.getElementById('editor-fixes');
      if (fixesEl) { fixesEl.classList.add('hidden'); fixesEl.innerHTML = ''; }
      showNotification('✅ Диалог уже оптимален — сокращать нечего', 'success');
      log('INFO', 'РЕДАКТОР', 'Нечего сокращать — всё в норме');
    }
  });

  // Apply changes button — uses shared applyDialogueUpdate
  document.getElementById('editor-apply')?.addEventListener('click', () => {
    if (!state.lastResult) return;
    const inputA = document.getElementById('editor-line-a');
    const inputB = document.getElementById('editor-line-b');
    if (!inputA) return;

    const ctx = state.lastResult._apiContext || {};
    const isSoloApply = ctx.soloMode || (!state.selectedB || state.selectedA?.id === state.selectedB?.id);
    applyDialogueUpdate(inputA.value.trim(), isSoloApply ? '' : (inputB?.value?.trim() || ''));

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

// ─── MATRIX RAIN ─────────────────────────
function initMatrixRain() {
  const canvas = document.getElementById('matrix-rain');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]=/\\';
  const fontSize = 12;
  const columns = Math.floor(canvas.width / fontSize);
  const drops = Array(columns).fill(1);

  function draw() {
    ctx.fillStyle = 'rgba(6,8,15,0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,229,255,0.35)';
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.985) {
        drops[i] = 0;
      }
      drops[i]++;
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── TRENDS (Ideas section) — Enhanced v2 ─────────────
let _trendsData = [];       // cached trend items
let _trendsFilter = 'all';  // active category filter
let _trendsSearch = '';      // search query
let _trendsSaved = JSON.parse(localStorage.getItem('ferixdi_saved_trends') || '[]');

function _escForAttr(str) {
  return escapeHtml(String(str || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\r/g, '');
}

function _viralClass(v) {
  if (v >= 9) return 'vb-max';
  if (v >= 7) return 'vb-high';
  if (v >= 5) return 'vb-mid';
  return 'vb-low';
}

function _reachEstimate(v) {
  if (v >= 9) return { text: '500K–1M+', color: 'bg-red-500/15 text-red-400' };
  if (v >= 8) return { text: '200K–500K', color: 'bg-orange-500/15 text-orange-400' };
  if (v >= 7) return { text: '100K–200K', color: 'bg-amber-500/15 text-amber-400' };
  if (v >= 6) return { text: '50K–100K', color: 'bg-yellow-500/15 text-yellow-400' };
  return { text: '10K–50K', color: 'bg-gray-500/15 text-gray-500' };
}

function _highlightKiller(text, killer) {
  if (!killer || !text) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const kw = escapeHtml(killer);
  // Case-insensitive replace of the killer word in the text
  const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<span class="killer-glow">$1</span>');
}

function _isTrendSaved(topic) {
  return _trendsSaved.includes(topic);
}

function _toggleTrendSave(topic) {
  const idx = _trendsSaved.indexOf(topic);
  if (idx >= 0) _trendsSaved.splice(idx, 1);
  else _trendsSaved.push(topic);
  localStorage.setItem('ferixdi_saved_trends', JSON.stringify(_trendsSaved));
}

async function fetchTrends() {
  if (!isPromoValid()) {
    const st = document.getElementById('trends-status');
    if (st) { st.classList.remove('hidden'); st.innerHTML = '<span class="text-red-400">⚠️ Для доступа к трендам нужен промо-код. Перейди в «Настройки» → введи код.</span>'; }
    return;
  }

  const btn = document.getElementById('btn-fetch-trends');
  const st = document.getElementById('trends-status');
  const res = document.getElementById('trends-results');
  const toolbar = document.getElementById('trends-toolbar');
  if (!btn || !st || !res) return;

  const nicheSelector = document.getElementById('niche-selector');
  const selectedNiche = nicheSelector ? nicheSelector.value : 'universal';
  const nicheNames = {
    universal: 'универсальные', business: 'бизнес', health: 'здоровье и фитнес',
    tech: 'tech и AI', beauty: 'красота', finance: 'финансы', education: 'образование',
    relationships: 'отношения', travel: 'путешествия', food: 'еда',
    parenting: 'родительство', realestate: 'недвижимость'
  };
  const nicheName = nicheNames[selectedNiche] || 'универсальные';

  btn.disabled = true;
  btn.innerHTML = '<span class="animate-pulse">⏳</span> FERIXDI AI ищет тренды...';
  st.classList.remove('hidden');
  st.innerHTML = `<span class="text-gray-400 animate-pulse">FERIXDI AI ищет <span class="text-cyan-400">${nicheName}</span> идеи...</span>`;
  res.classList.add('hidden');
  if (toolbar) toolbar.classList.add('hidden');

  try {
    const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const jwt = localStorage.getItem('ferixdi_jwt');
    const niche = nicheSelector ? nicheSelector.value : 'universal';

    const resp = await fetch(`${url}/api/trends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ niche }),
    });

    // Safe JSON parse — server may return empty body or non-JSON on error
    let data;
    try {
      const text = await resp.text();
      data = text ? JSON.parse(text) : {};
    } catch (parseErr) {
      st.innerHTML = `<span class="text-red-400">❌ Сервер вернул некорректный ответ (${resp.status}). Попробуй ещё раз.</span>`;
      log('ERR', 'ТРЕНДЫ', `JSON parse error: ${parseErr.message}, status: ${resp.status}`);
      btn.disabled = false;
      btn.innerHTML = '<span>🔍</span> Попробовать ещё раз';
      return;
    }

    if (!resp.ok) {
      st.innerHTML = `<span class="text-red-400">❌ ${escapeHtml(data.error || `Ошибка сервера (${resp.status})`)}</span>`;
      btn.disabled = false;
      btn.innerHTML = '<span>🔍</span> Попробовать ещё раз';
      return;
    }

    // Cache data
    _trendsData = data.trends || [];
    _trendsFilter = 'all';
    _trendsSearch = '';
    const searchInput = document.getElementById('trends-search');
    if (searchInput) searchInput.value = '';

    // Status badge
    const groundedBadge = data.grounded
      ? '<span class="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded ml-2">🌐 Онлайн</span>'
      : '<span class="text-[9px] bg-gray-500/15 text-gray-500 px-1.5 py-0.5 rounded ml-2">📚 AI-анализ</span>';
    const nicheBadge = niche !== 'universal'
      ? `<span class="text-[9px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded ml-2">🎯 ${nicheName}</span>`
      : '';
    st.innerHTML = `<span class="text-emerald-400">✓ ${_trendsData.length} идей · ${escapeHtml(data.weekday || '')}, ${escapeHtml(data.date)}</span>${groundedBadge}${nicheBadge}`;

    // Show toolbar + results
    if (toolbar) toolbar.classList.remove('hidden');
    res.classList.remove('hidden');

    // Render stats
    _renderTrendStats();
    // Reset filter tabs
    document.querySelectorAll('.trend-filter-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === 'all'));
    // Render
    _renderTrends();
    log('OK', 'ТРЕНДЫ', `Загружено ${_trendsData.length} идей${data.grounded ? ' (онлайн)' : ''}`);
  } catch (e) {
    st.innerHTML = `<span class="text-red-400">❌ Ошибка сети: ${escapeHtml(e.message)}</span>`;
    log('ERR', 'ТРЕНДЫ', e.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<span>🔄</span> Обновить тренды';
}

function _renderTrendStats() {
  const el = document.getElementById('trends-stats');
  if (!el || !_trendsData.length) return;
  const cats = { hot: 0, pain: 0, format: 0 };
  let avgViral = 0;
  _trendsData.forEach(t => { cats[t.category] = (cats[t.category] || 0) + 1; avgViral += t.virality; });
  avgViral = (avgViral / _trendsData.length).toFixed(1);
  const maxViral = Math.max(..._trendsData.map(t => t.virality));
  el.innerHTML = `
    <div class="trend-stat"><span>📊</span> <span class="trend-stat-value">${_trendsData.length}</span> идей</div>
    <div class="trend-stat"><span>⚡</span> Ø <span class="trend-stat-value">${avgViral}</span>/10</div>
    <div class="trend-stat"><span>🏆</span> Max <span class="trend-stat-value">${maxViral}</span>/10</div>
    <div class="trend-stat"><span>🔥</span> <span class="trend-stat-value">${cats.hot || 0}</span></div>
    <div class="trend-stat"><span>💢</span> <span class="trend-stat-value">${cats.pain || 0}</span></div>
    <div class="trend-stat"><span>🎬</span> <span class="trend-stat-value">${cats.format || 0}</span></div>
    <div class="trend-stat"><span>⭐</span> <span class="trend-stat-value">${_trendsSaved.length}</span> сохр</div>
  `;
}

function _renderTrends() {
  const res = document.getElementById('trends-results');
  if (!res) return;

  const catMeta = {
    hot:    { icon: '🔥', label: 'Горячее сегодня',  border: 'border-red-500/30',    bg: 'bg-red-500/5',    badge: 'bg-red-500/20 text-red-400',    glow: 'hover:border-red-500/50' },
    pain:   { icon: '💢', label: 'Вечная боль',       border: 'border-amber-500/30',  bg: 'bg-amber-500/5',  badge: 'bg-amber-500/20 text-amber-400',glow: 'hover:border-amber-500/50' },
    format: { icon: '🎬', label: 'Вирусный формат',   border: 'border-violet-500/30', bg: 'bg-violet-500/5', badge: 'bg-violet-500/20 text-violet-400', glow: 'hover:border-violet-500/50' },
  };

  // Filter
  let items = [..._trendsData];
  if (_trendsFilter !== 'all') items = items.filter(t => t.category === _trendsFilter);
  if (_trendsSearch) {
    const q = _trendsSearch.toLowerCase();
    items = items.filter(t =>
      (t.topic || '').toLowerCase().includes(q) ||
      (t.comedy_angle || '').toLowerCase().includes(q) ||
      (t.dialogue_A || '').toLowerCase().includes(q) ||
      (t.dialogue_B || '').toLowerCase().includes(q) ||
      (t.theme_tag || '').toLowerCase().includes(q)
    );
  }

  if (!items.length) {
    res.innerHTML = '<div class="text-center text-xs text-gray-500 py-8">Ничего не найдено по этим фильтрам</div>';
    return;
  }

  let lastCat = '';
  let html = '';
  let globalIdx = 0;

  items.forEach((t, i) => {
    const cm = catMeta[t.category] || catMeta.pain;
    const origIdx = _trendsData.indexOf(t);
    const delay = i * 60; // staggered animation

    // Category header
    if (t.category !== lastCat) {
      lastCat = t.category;
      const catCount = items.filter(x => x.category === t.category).length;
      html += `<div class="flex items-center gap-2 ${i === 0 ? 'mt-0' : 'mt-5'} mb-2" style="animation-delay:${delay}ms">
        <span class="text-base">${cm.icon}</span>
        <span class="text-xs font-bold text-gray-200 uppercase tracking-wider">${cm.label}</span>
        <span class="text-[9px] text-gray-600 font-mono">(${catCount})</span>
        <div class="flex-1 h-px bg-gradient-to-r from-gray-700 to-transparent"></div>
      </div>`;
    }

    globalIdx++;
    const isTop3 = origIdx < 3;
    const saved = _isTrendSaved(t.topic);
    const reach = _reachEstimate(t.virality);
    const vbClass = _viralClass(t.virality);

    // Highlight killer word in dialogue
    const dialogA = _highlightKiller(t.dialogue_A, t.killer_word);
    const dialogB = _highlightKiller(t.dialogue_B, t.killer_word);

    html += `
    <div class="trend-card rounded-xl p-4 space-y-3 border ${cm.border} ${cm.bg} ${cm.glow}" style="animation-delay:${delay}ms" data-idx="${origIdx}" data-cat="${t.category}">
      <!-- Header: number + title + virality + bookmark -->
      <div class="flex items-start gap-3">
        <span class="flex items-center justify-center w-7 h-7 rounded-lg text-[11px] font-bold flex-shrink-0 ${cm.badge} ${isTop3 ? 'trend-badge-top' : ''}">${globalIdx}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-white leading-snug">${escapeHtml(t.topic)}</div>
          <div class="flex items-center gap-2 mt-1.5 flex-wrap">
            ${t.viral_format ? `<span class="text-[9px] text-violet-400/80 bg-violet-500/10 px-1.5 py-0.5 rounded">📐 ${escapeHtml(t.viral_format)}</span>` : ''}
            ${t.theme_tag ? `<span class="text-[9px] px-2 py-0.5 rounded-full bg-gray-800/80 text-gray-500 border border-gray-700/50">#${escapeHtml(t.theme_tag)}</span>` : ''}
            <span class="reach-badge ${reach.color}">👁 ${reach.text}</span>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          <span class="trend-bookmark ${saved ? 'saved' : ''}" data-topic="${_escForAttr(t.topic)}" title="Сохранить идею">⭐</span>
          <div class="text-[11px] font-bold font-mono ${t.virality >= 9 ? 'text-red-400' : t.virality >= 7 ? 'text-amber-400' : 'text-gray-500'}">${t.virality}/10</div>
        </div>
      </div>

      <!-- Virality gradient bar -->
      <div class="virality-bar">
        <div class="virality-bar-fill ${vbClass}" style="width:${t.virality * 10}%"></div>
      </div>

      <!-- Context: WHY trending -->
      ${(t.trend_context || t.why_trending) ? `
      <div class="text-[11px] text-gray-300 bg-black/30 rounded-lg px-3 py-2 border-l-2 border-cyan-500/30">
        <span class="text-cyan-400/80 font-semibold">📊 Почему сейчас:</span> ${escapeHtml(t.trend_context || t.why_trending)}
      </div>` : ''}

      <!-- Comedy angle -->
      ${t.comedy_angle ? `<div class="text-[11px] text-gray-400 leading-relaxed"><span class="text-amber-400">🎯</span> ${escapeHtml(t.comedy_angle)}</div>` : ''}

      <!-- Dialogue block with per-line copy -->
      <div class="trend-dialogue bg-black/40 rounded-xl p-3.5 space-y-2 border border-white/[0.03]">
        <div class="flex items-center justify-between mb-0.5">
          <div class="text-[10px] text-gray-500 font-semibold">💬 Готовый диалог:</div>
          ${t.killer_word ? `<div class="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20">💥 killer: <span class="font-bold">${escapeHtml(t.killer_word)}</span></div>` : ''}
        </div>
        <div class="flex items-start gap-2 group">
          <div class="flex-1 text-[11px]"><span class="text-cyan-400 font-bold">A:</span> <span class="text-gray-200">«${dialogA}»</span></div>
          <button class="trend-copy-line" data-line="${_escForAttr(t.dialogue_A)}" title="Скопировать реплику A">📋</button>
        </div>
        <div class="flex items-start gap-2 group">
          <div class="flex-1 text-[11px]"><span class="text-violet-400 font-bold">B:</span> <span class="text-gray-200">«${dialogB}»</span></div>
          <button class="trend-copy-line" data-line="${_escForAttr(t.dialogue_B)}" title="Скопировать реплику B">📋</button>
        </div>
      </div>

      ${t.share_hook ? `<div class="text-[10px] text-gray-500/80 italic leading-relaxed">📤 ${escapeHtml(t.share_hook)}</div>` : ''}

      <!-- Action buttons -->
      <div class="flex gap-2 flex-wrap pt-0.5">
        <button class="text-[11px] px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-300 hover:from-emerald-500/25 hover:to-cyan-500/25 transition-all font-bold border border-emerald-500/25 quick-generate-trend" data-trend-index="${origIdx}" data-category="${_escForAttr(t.category)}" data-topic="${_escForAttr(t.topic)}" data-dialogue-a="${_escForAttr(t.dialogue_A)}" data-dialogue-b="${_escForAttr(t.dialogue_B)}">🚀 Быстрая генерация <span class="text-[9px] opacity-60">авто-подбор</span></button>
        <button class="text-[10px] px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors font-semibold border border-cyan-500/15 trend-use-idea" data-idea="${_escForAttr(t.topic + ': ' + (t.comedy_angle || ''))}">💡 Как идею</button>
        <button class="text-[10px] px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors font-semibold border border-violet-500/15 trend-use-script" data-a="${_escForAttr(t.dialogue_A)}" data-b="${_escForAttr(t.dialogue_B)}">✏ Вставить диалог</button>
      </div>
    </div>`;
  });

  res.innerHTML = html;
}

function useTrendAsIdea(topic) {
  const mainInput = document.getElementById('idea-input');
  if (mainInput) mainInput.value = topic;
  const customInput = document.getElementById('idea-input-custom');
  if (customInput) customInput.value = topic;
  selectGenerationMode('idea');
  navigateTo('characters');
  showNotification(`💡 Идея выбрана! Теперь выбери персонажей`, 'info');
  log('OK', 'ТРЕНД→ИДЕЯ', topic.slice(0, 60));
}

function useTrendAsScript(dialogueA, dialogueB) {
  const a = document.getElementById('script-a');
  const b = document.getElementById('script-b');
  if (a) a.value = dialogueA;
  if (b) b.value = dialogueB;
  selectGenerationMode('script');
  navigateTo('characters');
  showNotification(`✏️ Диалог вставлен! Теперь выбери персонажей`, 'info');
  log('OK', 'ТРЕНД→СКРИПТ', `A: ${dialogueA.slice(0, 30)}…`);
}

// ─── QUICK GENERATE FROM TREND ─────────────────
async function quickGenerateFromTrend(category, topic, dialogueA, dialogueB) {
  const success = autoSelectCharactersForCategory(category, topic);
  if (!success) {
    showNotification('❌ Не удалось автоматически подобрать персонажей. Выбери вручную.', 'error');
    useTrendAsScript(dialogueA, dialogueB);
    return;
  }
  state.generationMode = 'script';
  const a = document.getElementById('script-a');
  const b = document.getElementById('script-b');
  if (a) a.value = dialogueA;
  if (b) b.value = dialogueB;
  showNotification(`✅ Подобрано: ${state.selectedA.name_ru} × ${state.selectedB.name_ru}`, 'success');
  log('OK', 'БЫСТРАЯ ГЕНЕРАЦИЯ', `${state.selectedA.name_ru} × ${state.selectedB.name_ru} для "${topic.slice(0, 40)}"`);
  navigateTo('generate');
  document.getElementById('workspace')?.scrollTo({ top: 0, behavior: 'smooth' });
  const notice = document.getElementById('auto-selection-notice');
  if (notice) {
    notice.classList.remove('hidden');
    notice.innerHTML = `
      <div class="glass-panel p-4 border-l-2 border-emerald-500/40 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-emerald-400">🤖 Автоматически подобрано</div>
          <button onclick="navigateTo('characters')" class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">🔧 Изменить выбор</button>
        </div>
        <div class="text-xs text-gray-300">
          <div class="mb-1">👥 <span class="text-violet-300 font-medium">${state.selectedA.name_ru}</span> × <span class="text-indigo-300 font-medium">${state.selectedB.name_ru}</span></div>
          <div class="text-[11px] text-gray-500">AI выбрал эту пару как наиболее подходящую для категории "${category}" — ${state.selectedA.compatibility} + ${state.selectedB.compatibility} = контрастная динамика</div>
        </div>
      </div>
    `;
  }
}

function initTrends() {
  document.getElementById('btn-fetch-trends')?.addEventListener('click', fetchTrends);

  const resEl = document.getElementById('trends-results');
  if (!resEl) return;

  // ─ Event delegation for ALL trend buttons ─
  resEl.addEventListener('click', async (e) => {
    // Quick generate
    const qgBtn = e.target.closest('.quick-generate-trend');
    if (qgBtn) {
      const { category, topic, dialogueA, dialogueB } = qgBtn.dataset;
      qgBtn.disabled = true;
      qgBtn.innerHTML = '<span class="animate-pulse">⏳</span> Подбор персонажей...';
      await quickGenerateFromTrend(category || '', topic || '', dialogueA || '', dialogueB || '');
      qgBtn.disabled = false;
      qgBtn.innerHTML = '✓ Готово!';
      setTimeout(() => { qgBtn.innerHTML = '🚀 Быстрая генерация <span class="text-[9px] opacity-60">авто-подбор</span>'; }, 2000);
      return;
    }

    // Use as idea
    const ideaBtn = e.target.closest('.trend-use-idea');
    if (ideaBtn) {
      useTrendAsIdea(ideaBtn.dataset.idea || '');
      ideaBtn.textContent = '✓ Выбрано!';
      return;
    }

    // Use as script
    const scriptBtn = e.target.closest('.trend-use-script');
    if (scriptBtn) {
      useTrendAsScript(scriptBtn.dataset.a || '', scriptBtn.dataset.b || '');
      scriptBtn.textContent = '✓ Выбрано!';
      return;
    }

    // Copy individual line
    const copyBtn = e.target.closest('.trend-copy-line');
    if (copyBtn) {
      const line = copyBtn.dataset.line || '';
      navigator.clipboard.writeText(line).then(() => {
        sfx.copy();
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
      });
      return;
    }

    // Bookmark
    const bmk = e.target.closest('.trend-bookmark');
    if (bmk) {
      const topic = bmk.dataset.topic || '';
      _toggleTrendSave(topic);
      bmk.classList.toggle('saved');
      sfx.toggle();
      _renderTrendStats();
      return;
    }
  });

  // ─ Category filter tabs ─
  document.querySelectorAll('.trend-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      sfx.clickSoft();
      _trendsFilter = tab.dataset.cat || 'all';
      document.querySelectorAll('.trend-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _renderTrends();
    });
  });

  // ─ Search ─
  let searchTimer = null;
  document.getElementById('trends-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _trendsSearch = e.target.value.trim();
      _renderTrends();
    }, 200);
  });
}

// ─── LOCATIONS BROWSE (standalone section) ───
function renderLocationsBrowse(filterGroup = '') {
  const grid = document.getElementById('loc-browse-grid');
  if (!grid) return;
  let locs = [...state.locations];
  if (filterGroup) locs = locs.filter(l => l.group === filterGroup);

  const autoSelB = !state.selectedLocation;
  grid.innerHTML = `
    <div class="loc-card ${autoSelB ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="">
      <div class="text-sm">🎲</div>
      <div class="text-[11px] font-medium text-violet-300">Авто</div>
      <div class="text-[10px] text-gray-500 mb-2">AI подберёт</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${autoSelB ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="">${autoSelB ? '✓ Выбрано' : '📍 Выбрать'}</button>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '🌟' : l.mood === 'sterile tension' ? '🩵' : l.mood === 'organic chaos' ? '🌿' : l.mood === 'dramatic intimacy' ? '🕯️' : '🎨';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.numeric_id ? `<span class="text-[9px] text-gray-500 font-mono mr-1">#${l.numeric_id}</span>` : ''}${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug">${l.tagline_ru}</div>
      ${l.tags ? `<div class="flex gap-1 flex-wrap mt-1">${l.tags.slice(0, 3).map(t => `<span class="text-[8px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">${t}</span>`).join('')}</div>` : ''}
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border mt-2 ${sel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="${l.id}">${sel ? '✓ Выбрано' : '📍 Выбрать'}</button>
      <button class="copy-loc-prompt text-[9px] px-2 py-1 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full mt-1.5 flex items-center justify-center gap-1" data-id="${l.id}" title="Скопировать детализированный промпт для Veo">
        <span>📋</span> Промпт
      </button>
    </div>`;
  }).join('');

  updateLocationBrowseInfo();
}

function updateLocationBrowseInfo() {
  const info = document.getElementById('loc-browse-selected-info');
  if (!info) return;
  if (!state.selectedLocation) { info.classList.add('hidden'); return; }
  const loc = state.locations.find(l => l.id === state.selectedLocation);
  if (!loc) { info.classList.add('hidden'); return; }
  info.classList.remove('hidden');
  const tags = (loc.tags || []).map(t => `<span class="tag text-[10px]">${t}</span>`).join(' ');
  info.innerHTML = `<div class="flex items-center gap-2 flex-wrap"><span class="text-violet-400 font-medium text-sm">📍 ${loc.name_ru}</span>${tags}</div><div class="text-xs text-gray-400 mt-1">${loc.tagline_ru}</div>${loc.audio_hints ? `<div class="text-[10px] text-gray-500 mt-1">🔊 ${loc.audio_hints}</div>` : ''}`;
}

function initLocationsBrowse() {
  // Populate filter
  const sel = document.getElementById('loc-browse-group-filter');
  if (sel) {
    const groups = [...new Set(state.locations.map(l => l.group))].sort();
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g; opt.textContent = g;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', (e) => renderLocationsBrowse(e.target.value));
  }

  // Grid click
  document.getElementById('loc-browse-grid')?.addEventListener('click', (e) => {
    // Handle copy button clicks
    const copyBtn = e.target.closest('.copy-loc-prompt');
    if (copyBtn) {
      e.stopPropagation();
      copyLocationPrompt(copyBtn.dataset.id);
      return;
    }
    
    const card = e.target.closest('.loc-card');
    if (!card) return;
    const id = card.dataset.locId;
    state.selectedLocation = id || null;
    renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
    renderLocations(document.getElementById('loc-group-filter')?.value || '');
    log('INFO', 'ЛОКАЦИЯ', state.selectedLocation ? `Выбрана: ${state.locations.find(l => l.id === state.selectedLocation)?.name_ru}` : 'Авто-выбор');
  });

  // Random
  document.getElementById('loc-browse-random-btn')?.addEventListener('click', () => {
    const filtered = document.getElementById('loc-browse-group-filter')?.value;
    let pool = filtered ? state.locations.filter(l => l.group === filtered) : state.locations;
    if (pool.length === 0) pool = state.locations;
    const rand = pool[Math.floor(Math.random() * pool.length)];
    state.selectedLocation = rand.id;
    renderLocationsBrowse(filtered || '');
    renderLocations(document.getElementById('loc-group-filter')?.value || '');
    log('INFO', 'ЛОКАЦИЯ', `🎲 Случайная: ${rand.name_ru}`);
  });
}

// ─── KEYBOARD SHORTCUTS ───────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Enter to generate
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    const btn = document.getElementById('btn-generate');
    if (btn && !btn.disabled) {
      btn.click();
    } else if (btn && btn.disabled) {
      showNotification('🔒 Заполните все обязательные поля перед генерацией (см. чеклист)', 'warning');
      navigateTo('generate');
    }
  }
  
  // Escape to close mobile menu
  if (e.key === 'Escape') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open');
    }
  }
  
  // Ctrl/Cmd + S to save current state
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentState();
  }
  
  // Ctrl/Cmd + Shift + R to reset to default (Shift added to avoid hijacking browser refresh)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    if (confirm('Сбросить все настройки и начать заново?')) {
      resetToDefaults();
    }
  }
  
  // Number keys 1-5 for navigation (only when NOT typing in input/textarea)
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && activeTag !== 'input' && activeTag !== 'textarea') {
    const sections = ['ideas', 'generation-mode', 'content', 'characters', 'locations', 'generate'];
    const keyNum = parseInt(e.key);
    if (keyNum >= 1 && keyNum <= 6) {
      const section = sections[keyNum - 1];
      if (section && document.getElementById(`section-${section}`)) {
        e.preventDefault();
        navigateTo(section);
      }
    }
  }
});

// ─── AI CONSULTATION (FREE, no promo required) ────
function initConsultation() {
  const input = document.getElementById('consult-input');
  const btn = document.getElementById('btn-consult-ask');
  const statusEl = document.getElementById('consult-status');
  const responseArea = document.getElementById('consult-response-area');
  const responseEl = document.getElementById('consult-response');
  const counterEl = document.getElementById('consult-counter');
  const copyBtn = document.getElementById('consult-copy-btn');
  const historyEl = document.getElementById('consult-history');
  if (!input || !btn) return;

  let _typeTimer = null; // track typing animation so we can cancel

  // Character counter
  input.addEventListener('input', () => {
    if (counterEl) counterEl.textContent = `${input.value.length} / 2000`;
  });

  // Copy button
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = responseEl?.textContent || '';
      if (text) {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = '✓ Скопировано';
        setTimeout(() => { copyBtn.textContent = '📋 Копировать'; }, 1500);
      }
    });
  }

  // Ask button
  btn.addEventListener('click', async () => {
    const question = input.value.trim();
    if (!question || question.length < 3) {
      if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = '<span class="text-orange-400">⚠️ Напишите вопрос (минимум 3 символа)</span>'; }
      return;
    }

    // Cancel any running typing animation
    if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }

    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">💬</span> Пишет...';
    if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = '<span class="text-emerald-400 animate-pulse">🧠 Думаю...</span>'; }
    if (responseArea) responseArea.classList.add('hidden');

    // Build context from current app state
    const context = {};
    if (state.selectedA) context.characterA = state.selectedA.name_ru || state.selectedA.id;
    if (state.selectedB) context.characterB = state.selectedB.name_ru || state.selectedB.id;
    if (state.selectedLocation) {
      const loc = state.locations?.find(l => l.id === state.selectedLocation);
      if (loc) context.location = loc.name_ru || loc.scene_en;
    }
    if (state.generationMode) context.mode = { idea: 'Своя идея', suggested: 'Готовые идеи', script: 'Свой диалог', video: 'Копия видео', meme: 'Мем-ремейк' }[state.generationMode] || state.generationMode;
    if (state.category) context.category = state.category;
    if (state.lastResult?.dialogue_A) context.lastDialogueA = state.lastResult.dialogue_A.slice(0, 200);
    if (state.lastResult?.dialogue_B) context.lastDialogueB = state.lastResult.dialogue_B.slice(0, 200);
    context.hasPromo = isPromoValid();

    try {
      const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
      const resp = await fetch(`${apiUrl}/api/consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || `Ошибка ${resp.status}`);
      }

      // Show response with fast typing effect
      if (responseArea) responseArea.classList.remove('hidden');
      if (responseEl) {
        responseEl.textContent = '';
        const fullText = data.answer;
        let i = 0;
        const chunkSize = 3; // type 3 chars at a time for speed
        _typeTimer = setInterval(() => {
          if (i < fullText.length) {
            responseEl.textContent += fullText.slice(i, i + chunkSize);
            i += chunkSize;
          } else {
            clearInterval(_typeTimer);
            _typeTimer = null;
            // Format markdown-like response into HTML
            let html = responseEl.textContent
              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/\*\*(.+?)\*\*/g, '<strong class="text-amber-300">$1</strong>')
              .replace(/^[•●▪] (.+)$/gm, '<li class="ml-3">$1</li>')
              .replace(/^- (.+)$/gm, '<li class="ml-3">$1</li>')
              .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-3"><strong class="text-amber-400/70">$1.</strong> $2</li>')
              .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="space-y-1 my-1.5">$1</ul>')
              .replace(/^(={3,}|─{3,})$/gm, '<hr class="border-gray-700/50 my-2"/>')
              .replace(/^(❓|✅|🚫|📝|═══)(.*)$/gm, '<div class="font-semibold mt-2">$1$2</div>')
              .replace(/@ferixdiii/g, '<a href="https://t.me/ferixdiii" target="_blank" class="text-cyan-400 hover:text-cyan-300 underline transition-colors">@ferixdiii</a>')
              .replace(/@ferixdi\.ai/g, '<a href="https://www.instagram.com/ferixdi.ai/" target="_blank" class="text-cyan-400 hover:text-cyan-300 underline transition-colors">@ferixdi.ai</a>')
              .replace(/\n/g, '<br/>');
            responseEl.innerHTML = html;
          }
        }, 6);
      }
      if (statusEl) statusEl.classList.add('hidden');

      // Move previous response to history
      if (historyEl) {
        const histItem = document.createElement('div');
        histItem.className = 'rounded-lg p-3 space-y-1.5 border border-gray-800/30 bg-black/20 opacity-50';
        histItem.innerHTML = `
          <div class="text-[10px] text-gray-500 font-medium">💬 ${escapeHtml(question)}</div>
          <div class="text-[11px] text-gray-500 leading-relaxed line-clamp-3">${escapeHtml(data.answer).slice(0, 300)}${data.answer.length > 300 ? '...' : ''}</div>
        `;
        historyEl.prepend(histItem);
        while (historyEl.children.length > 3) historyEl.removeChild(historyEl.lastChild);
      }

      // Clear input after successful response
      input.value = '';
      if (counterEl) counterEl.textContent = '0 / 2000';

      log('OK', 'ПОМОЩНИК', `Ответ получен`);

    } catch (e) {
      if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = `<span class="text-red-400">❌ ${escapeHtml(e.message)}</span>`; }
      log('ERR', 'ПОМОЩНИК', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>💬</span> Спросить';
    }
  });

  // Enter to send (Ctrl+Enter or Cmd+Enter)
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });
}

// Save current state to localStorage
function saveCurrentState() {
  const stateToSave = {
    selectedA: state.selectedA,
    selectedB: state.selectedB,
    selectedLocation: state.selectedLocation,
    generationMode: state.generationMode,
    inputMode: state.inputMode,
    options: state.options,
    timestamp: Date.now()
  };
  localStorage.setItem('ferixdi_saved_state', JSON.stringify(stateToSave));
  showNotification('💾 Состояние сохранено', 'success');
}

// Reset to defaults
function resetToDefaults() {
  state.selectedA = null;
  state.selectedB = null;
  state.selectedLocation = null;
  state.generationMode = null;
  state.inputMode = 'idea';
  state.options = { enforce8s: true, preserveRhythm: true, strictLipSync: true, allowAutoTrim: false };
  localStorage.removeItem('ferixdi_saved_state');
  navigateTo('generation-mode');
  showNotification('🔄 Сброс выполнен', 'info');
}

// Load saved state on startup
function loadSavedState() {
  try {
    const saved = localStorage.getItem('ferixdi_saved_state');
    if (saved) {
      const stateData = JSON.parse(saved);
      const age = Date.now() - stateData.timestamp;
      
      // Only restore if less than 24 hours old
      if (age < 24 * 60 * 60 * 1000) {
        Object.assign(state, stateData);
        log('OK', 'СОСТОЯНИЕ', 'Загружено сохранённое состояние');
      }
    }
  } catch (e) {
    console.warn('Failed to load saved state:', e);
  }
}

// Show notification toast
function showNotification(message, type = 'info') {
  if (type === 'error' || type === 'warning') sfx.error();
  else if (type === 'success') sfx.success();
  else sfx.notify();
  const colors = {
    success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    info: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  };
  
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 px-4 py-3 rounded-lg border ${colors[type]} backdrop-blur-sm z-50 transition-all transform translate-x-full`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.classList.remove('translate-x-full');
  }, 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.add('translate-x-full');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ─── PROGRESS TRACKER ─────────────────────
function updateProgress() {
  // Step 1: Mode
  const modeStep = document.getElementById('progress-mode');
  const modeCheck = modeStep?.querySelector('.progress-check');
  const modeValue = modeStep?.querySelector('.progress-value');
  const modeBorder = modeStep?.querySelector('.w-4');
  
  if (state.generationMode) {
    const modeNames = { idea: '💡 Своя идея', suggested: '📚 Готовые идеи', script: '📝 Свой диалог', video: '🎥 По видео' };
    if (modeValue) modeValue.textContent = modeNames[state.generationMode] || state.generationMode;
    if (modeCheck) { modeCheck.classList.remove('hidden', 'bg-gray-700'); modeCheck.classList.add('bg-emerald-500'); }
    if (modeBorder) { modeBorder.classList.remove('border-gray-700'); modeBorder.classList.add('border-emerald-500'); }
  }
  
  // Step 2: Content (idea/script/video)
  const contentStep = document.getElementById('progress-content');
  const contentCheck = contentStep?.querySelector('.progress-check');
  const contentValue = contentStep?.querySelector('.progress-value');
  const contentBorder = contentStep?.querySelector('.w-4');
  
  let hasContent = false;
  let contentText = 'не указан';
  
  if (state.generationMode === 'idea') {
    const ideaInput = document.getElementById('idea-input')?.value || document.getElementById('idea-input-custom')?.value;
    if (ideaInput && ideaInput.trim()) {
      hasContent = true;
      contentText = ideaInput.slice(0, 25) + (ideaInput.length > 25 ? '...' : '');
    }
  } else if (state.generationMode === 'suggested') {
    // Suggested mode always has content — AI picks trending ideas; user text is optional
    hasContent = true;
    const suggestedInput = document.getElementById('idea-input-suggested')?.value || document.getElementById('idea-input')?.value || '';
    contentText = suggestedInput.trim() ? suggestedInput.slice(0, 25) + (suggestedInput.length > 25 ? '...' : '') : '✓ AI подберёт тему';
  } else if (state.generationMode === 'script') {
    const scriptA = document.getElementById('script-a')?.value?.trim();
    const scriptB = document.getElementById('script-b')?.value?.trim();
    if (scriptA || scriptB) {
      hasContent = true;
      contentText = scriptB ? '✓ Диалог готов' : '✓ Монолог (соло)';
    }
  } else if (state.generationMode === 'video') {
    if (state.videoMeta) {
      hasContent = true;
      contentText = '✓ Видео загружено';
    }
  }
  
  if (contentValue) contentValue.textContent = contentText;
  if (hasContent) {
    if (contentCheck) { contentCheck.classList.remove('hidden', 'bg-gray-700'); contentCheck.classList.add('bg-emerald-500'); }
    if (contentBorder) { contentBorder.classList.remove('border-gray-700'); contentBorder.classList.add('border-emerald-500'); }
  }
  
  // Step 3: Characters (already updated by selectCharacter function)
  const charStep = document.getElementById('progress-characters');
  const charCheck = charStep?.querySelector('.progress-check');
  const charBorder = charStep?.querySelector('.w-4');
  
  if (state.selectedA) {
    if (charCheck) { charCheck.classList.remove('hidden', 'bg-gray-700'); charCheck.classList.add('bg-emerald-500'); }
    if (charBorder) { charBorder.classList.remove('border-gray-700'); charBorder.classList.add('border-emerald-500'); }
  }
  
  // Step 4: Location
  const locStep = document.getElementById('progress-location');
  const locCheck = locStep?.querySelector('.progress-check');
  const locValue = locStep?.querySelector('.progress-value');
  const locBorder = locStep?.querySelector('.w-4');
  
  if (state.selectedLocation) {
    const loc = state.locations.find(l => l.id === state.selectedLocation);
    if (locValue) locValue.textContent = loc ? loc.name_ru.slice(0, 25) : 'Выбрана';
    if (locCheck) { locCheck.classList.remove('hidden', 'bg-gray-700'); locCheck.classList.add('bg-emerald-500'); }
    if (locBorder) { locBorder.classList.remove('border-gray-700'); locBorder.classList.add('border-emerald-500'); }
  } else {
    if (locValue) locValue.textContent = 'Авто (AI подберёт)';
  }
  
  // Show reset/new buttons if anything is selected
  const hasAnySelection = state.generationMode || state.selectedA || state.selectedB || state.selectedLocation;
  const resetBtn = document.getElementById('btn-reset-all');
  const newBtn = document.getElementById('btn-start-new');
  
  if (hasAnySelection) {
    if (resetBtn) resetBtn.classList.remove('hidden');
    if (newBtn) newBtn.classList.remove('hidden');
  } else {
    if (resetBtn) resetBtn.classList.add('hidden');
    if (newBtn) newBtn.classList.add('hidden');
  }
}

function resetAll() {
  if (!confirm('Очистить все выборы и начать заново?')) return;
  
  // Clear state
  state.generationMode = null;
  state.inputMode = 'idea';
  state.selectedA = null;
  state.selectedB = null;
  state.selectedLocation = null;
  state.videoMeta = null;
  state.productInfo = null;
  state.lastResult = null;
  state.category = null;
  
  // Clear UI inputs
  const inputs = ['idea-input', 'idea-input-custom', 'script-a', 'script-b', 'scene-hint', 'product-description'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  // Clear video
  const videoMeta = document.getElementById('video-meta');
  if (videoMeta) { videoMeta.classList.add('hidden'); videoMeta.textContent = ''; }
  
  // Reset progress UI
  document.querySelectorAll('.progress-check').forEach(el => {
    el.classList.add('hidden', 'bg-gray-700');
    el.classList.remove('bg-emerald-500');
  });
  document.querySelectorAll('#progress-mode .w-4, #progress-content .w-4, #progress-characters .w-4, #progress-location .w-4').forEach(el => {
    el.classList.add('border-gray-700');
    el.classList.remove('border-emerald-500');
  });
  document.querySelectorAll('.progress-value').forEach(el => {
    if (el.closest('#progress-mode')) el.textContent = 'не выбран';
    else if (el.closest('#progress-content')) el.textContent = 'не указан';
    else if (el.closest('#progress-location')) el.textContent = 'не выбрана';
  });
  
  // Reset character cards
  document.querySelectorAll('.char-card').forEach(card => {
    card.classList.remove('selected-a', 'selected-b', 'ring-2', 'ring-cyan-400', 'ring-purple-400');
  });
  
  // Reset generation mode cards
  document.querySelectorAll('.generation-mode-card').forEach(card => {
    card.classList.remove('ring-2', 'ring-cyan-500', 'ring-purple-500', 'ring-amber-500', 'ring-emerald-500');
  });
  
  // Hide selected mode display
  const display = document.getElementById('selected-mode-display');
  if (display) display.classList.add('hidden');
  
  // Navigate to generation mode selection
  navigateTo('generation-mode');
  
  updateProgress();
  updateReadiness();
  showNotification('✨ Всё очищено! Начни с выбора режима генерации', 'info');
  log('INFO', 'СБРОС', 'Все выборы очищены');
}

function startNewIdea() {
  resetAll();
}

function initProgressTracker() {
  const resetBtn = document.getElementById('btn-reset-all');
  const newBtn = document.getElementById('btn-start-new');
  
  if (resetBtn) {
    resetBtn.addEventListener('click', resetAll);
  }
  
  if (newBtn) {
    newBtn.addEventListener('click', startNewIdea);
  }
  
  // Update progress initially
  updateProgress();
}

// ─── COPY CHARACTER PROMPT ───────────────────
function generateCharacterPrompt(charId) {
  const char = state.characters.find(c => c.id === charId);
  if (!char) return '';
  
  const anchors = char.identity_anchors || {};
  const modifiers = char.modifiers || {};
  const tokens = char.prompt_tokens || {};
  
  // Build detailed character prompt for Veo
  const prompt = `CHARACTER PROMPT FOR VEO 3.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 БАЗОВАЯ ИНФОРМАЦИЯ
Имя: ${char.name_ru} (${char.name_en || char.id})
Группа: ${char.group}
Архетип: ${char.vibe_archetype || 'не указан'}
Роль по умолчанию: ${char.role_default === 'A' ? '🅰️ Провокатор' : '🅱️ Панчлайнер'}
Совместимость: ${char.compatibility}

🎭 ВИЗУАЛЬНОЕ ОПИСАНИЕ
${tokens.character_en || char.appearance_ru || 'не указано'}

✨ КЛЮЧЕВЫЕ ЭЛЕМЕНТЫ ИДЕНТИФИКАЦИИ
Силуэт лица: ${anchors.face_silhouette || 'не указан'}
Фирменный элемент: ${anchors.signature_element || 'не указан'}
Микро-жест: ${anchors.micro_gesture || 'не указан'}
Гардероб-якорь: ${anchors.wardrobe_anchor || 'не указан'}

🗣 РЕЧЬ И ПОВЕДЕНИЕ
Стиль речи: ${char.speech_style_ru || 'не указан'}
Темп речи: ${char.speech_pace || 'normal'} (${char.speech_pace === 'fast' ? '~3.5 слов/сек' : char.speech_pace === 'slow' ? '~2.0 слов/сек' : '~2.5-3.0 слов/сек'})
Уровень мата: ${char.swear_level || 0}/3
Поведение: ${char.behavior_ru || 'не указано'}
Фирменные слова: ${(char.signature_words_ru || []).join(', ') || 'не указаны'}

🎬 МОДИФИКАТОРЫ ДЛЯ ВИДЕО
Хук-стиль: ${modifiers.hook_style || 'не указан'}
Стиль смеха: ${modifiers.laugh_style || 'не указан'}

🎨 ЭСТЕТИКА МИРА
${char.world_aesthetic || 'универсальная'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 PROMPT ДЛЯ VEO (Английский):
${tokens.character_en || 'Character description not available'}

Format: 9:16 vertical, 1080p, hyperrealistic smartphone capture, natural skin pores and imperfections, cinematic lighting, shallow depth of field.`;
  
  return prompt;
}

function copyCharacterPrompt(charId) {
  const prompt = generateCharacterPrompt(charId);
  if (!prompt) {
    showNotification('❌ Ошибка генерации промпта', 'error');
    return;
  }
  
  copyToClipboardWithFeedback(prompt, 'ПЕРСОНАЖ', charId);
}

// ─── COPY LOCATION PROMPT ───────────────────
function generateLocationPrompt(locId) {
  const loc = state.locations.find(l => l.id === locId);
  if (!loc) return '';
  
  const prompt = `LOCATION PROMPT FOR VEO 3.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 БАЗОВАЯ ИНФОРМАЦИЯ
Название: ${loc.name_ru} (${loc.name_en || loc.id})
Группа: ${loc.group}
Теги: ${(loc.tags || []).join(', ')}
Описание: ${loc.tagline_ru || 'не указано'}

🎬 ДЕТАЛЬНОЕ ОПИСАНИЕ СЦЕНЫ (English)
${loc.scene_en || 'Scene description not available'}

💡 ОСВЕЩЕНИЕ
${loc.lighting || 'не указано'}

🎨 НАСТРОЕНИЕ
${loc.mood || 'не указано'}

🔊 ЗВУКОВЫЕ ПОДСКАЗКИ
${loc.audio_hints || 'не указаны'}

📷 РЕКОМЕНДУЕМЫЕ КАТЕГОРИИ
${(loc.category_hints || []).join(', ') || 'универсальная'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 PROMPT ДЛЯ VEO (Английский):
${loc.scene_en || 'Location description not available'}

Lighting: ${loc.lighting || 'natural'}
Mood: ${loc.mood || 'neutral'}
Audio ambience: ${loc.audio_hints || 'quiet'}
Format: 9:16 vertical, 1080p, cinematic framing, shallow depth of field, natural color grading.`;
  
  return prompt;
}

function copyLocationPrompt(locId) {
  const prompt = generateLocationPrompt(locId);
  if (!prompt) {
    showNotification('❌ Ошибка генерации промпта', 'error');
    return;
  }
  
  copyToClipboardWithFeedback(prompt, 'ЛОКАЦИЯ', locId);
}

// ─── COPY TO CLIPBOARD WITH FEEDBACK ───────
function copyToClipboardWithFeedback(text, type, id) {
  navigator.clipboard.writeText(text)
    .then(() => {
      sfx.copy();
      const char = type === 'ПЕРСОНАЖ' ? state.characters.find(c => c.id === id) : null;
      const loc = type === 'ЛОКАЦИЯ' ? state.locations.find(l => l.id === id) : null;
      const name = char?.name_ru || loc?.name_ru || id;
      
      showNotification(`✓ Промпт скопирован: ${name}`, 'success');
      log('OK', 'КОПИЯ', `${type} "${name}" скопирован в буфер (${text.length} символов)`);
      
      // Visual feedback on button
      const btn = document.querySelector(`[data-id="${id}"] .copy-char-prompt, [data-id="${id}"].copy-char-prompt, [data-id="${id}"] .copy-loc-prompt, [data-id="${id}"].copy-loc-prompt`);
      if (btn) {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>✓</span> Скопировано!';
        btn.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
        btn.classList.remove('bg-gold/10', 'border-gold/30');
        
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.classList.remove('bg-emerald-500/20', 'border-emerald-500/50');
          btn.classList.add('bg-gold/10', 'border-gold/30');
        }, 2000);
      }
    })
    .catch(err => {
      showNotification('❌ Не удалось скопировать в буфер обмена', 'error');
      log('ERR', 'КОПИЯ', `Ошибка копирования: ${err.message}`);
    });
}

// ─── JOKES LIBRARY ────────────────────────
let _jokes = [];
let _jokeTheme = 'all';
let _jokeSortMode = 'viral';

async function loadJokes() {
  try {
    const resp = await fetch('./data/jokes.json');
    _jokes = await resp.json();
    log('OK', 'JOKES', `Загружено ${_jokes.length} шуток`);
    renderJokes();
  } catch (e) {
    log('ERR', 'JOKES', `Ошибка загрузки: ${e.message}`);
  }
}

function renderJokes() {
  const grid = document.getElementById('jokes-grid');
  if (!grid) return;

  let filtered = _jokeTheme === 'all' ? [..._jokes] : _jokes.filter(j => j.theme === _jokeTheme);

  const search = (document.getElementById('joke-search')?.value || '').toLowerCase().trim();
  if (search) filtered = filtered.filter(j => j.text.toLowerCase().includes(search) || j.tags.some(t => t.includes(search)));

  if (_jokeSortMode === 'viral') filtered.sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0));
  else filtered.sort(() => Math.random() - 0.5);

  document.getElementById('joke-count-badge').textContent = `${filtered.length} из ${_jokes.length}`;

  grid.innerHTML = filtered.slice(0, 50).map(j => {
    const viralClass = j.viral_score >= 90 ? 'text-pink-400' : j.viral_score >= 85 ? 'text-amber-400' : 'text-gray-400';
    const tags = j.tags.slice(0, 3).map(t => `<span class="text-[9px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">${t}</span>`).join('');
    return `
      <div class="glass-panel p-4 space-y-2 hover:border-pink-500/30 transition-colors border border-transparent cursor-pointer joke-card" data-joke-id="${j.id}">
        <div class="flex items-start justify-between gap-2">
          <div class="text-xs font-medium text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(j.text)}</div>
          <span class="${viralClass} text-[10px] font-bold flex-shrink-0">${j.viral_score}🔥</span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">${tags}</div>
        <div class="flex gap-2 pt-1">
          <button class="joke-use-btn text-[10px] px-3 py-1.5 rounded bg-pink-500/15 text-pink-400 border border-pink-500/30 hover:bg-pink-500/25 transition-colors font-medium" data-joke-id="${j.id}">🚀 Генерация в 1 клик</button>
          <button class="joke-script-btn text-[10px] px-3 py-1.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors" data-joke-id="${j.id}">📝 Как свой диалог</button>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.joke-use-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    quickGenerateFromJoke(btn.dataset.jokeId);
  }));
  grid.querySelectorAll('.joke-script-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    useJokeAsScript(btn.dataset.jokeId);
  }));
}

function quickGenerateFromJoke(jokeId) {
  const joke = _jokes.find(j => j.id === jokeId);
  if (!joke) return;

  if (!isPromoValid()) {
    showNotification('🔑 Для генерации нужен промо-код', 'error');
    navigateTo('settings');
    return;
  }

  // Auto-pick characters from joke's best_groups
  const groups = joke.best_groups || [];
  let charA = null, charB = null;
  if (groups.length >= 2 && state.characters?.length) {
    const poolA = state.characters.filter(c => c.group === groups[0]);
    const poolB = state.characters.filter(c => c.group === groups[1]);
    if (poolA.length) charA = poolA[Math.floor(Math.random() * poolA.length)];
    if (poolB.length) charB = poolB[Math.floor(Math.random() * poolB.length)];
    if (charA && charB && charA.id === charB.id) {
      charB = poolB.find(c => c.id !== charA.id) || poolB[0];
    }
  }
  if (!charA || !charB) {
    autoSelectRandomPair();
  } else {
    selectChar('A', charA.id);
    selectChar('B', charB.id);
  }

  // Auto-pick location
  if (joke.best_location && state.locations?.length) {
    const loc = state.locations.find(l => l.id === joke.best_location);
    if (loc) {
      state.selectedLocation = loc.id;
      updateLocationInfo?.();
    }
  }

  // Set mode to idea with joke text
  state.generationMode = 'idea';
  state.inputMode = 'idea';
  selectGenerationMode?.('idea');

  const ideaInput = document.getElementById('idea-input');
  if (ideaInput) ideaInput.value = joke.text;
  const ideaInputSuggested = document.getElementById('idea-input-suggested');
  if (ideaInputSuggested) ideaInputSuggested.value = joke.text;

  navigateTo('generate');
  updateReadiness?.();
  showNotification(`😂 Шутка выбрана! Персонажи и локация подобраны`, 'success');
  log('OK', 'JOKES', `Быстрая генерация: ${joke.id}`);
}

function useJokeAsScript(jokeId) {
  const joke = _jokes.find(j => j.id === jokeId);
  if (!joke) return;

  state.generationMode = 'script';
  state.inputMode = 'script';
  selectGenerationMode?.('script');

  const scriptA = document.getElementById('script-a');
  const scriptB = document.getElementById('script-b');
  if (scriptA) scriptA.value = joke.line_a;
  if (scriptB) scriptB.value = joke.line_b;

  navigateTo('generate');
  updateReadiness?.();
  showNotification('📝 Реплики вставлены в режим "Свой диалог"', 'success');
}

function initJokesLibrary() {
  loadJokes();

  document.querySelectorAll('.joke-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.joke-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _jokeTheme = btn.dataset.theme;
      renderJokes();
    });
  });

  document.getElementById('joke-search')?.addEventListener('input', () => renderJokes());

  document.getElementById('joke-sort-viral')?.addEventListener('click', () => {
    _jokeSortMode = 'viral';
    document.getElementById('joke-sort-viral').classList.add('bg-pink-500/15', 'text-pink-400', 'border-pink-500/30');
    document.getElementById('joke-sort-viral').classList.remove('bg-gray-700/50', 'text-gray-400', 'border-gray-700');
    document.getElementById('joke-sort-random').classList.remove('bg-pink-500/15', 'text-pink-400', 'border-pink-500/30');
    document.getElementById('joke-sort-random').classList.add('bg-gray-700/50', 'text-gray-400', 'border-gray-700');
    renderJokes();
  });
  document.getElementById('joke-sort-random')?.addEventListener('click', () => {
    _jokeSortMode = 'random';
    document.getElementById('joke-sort-random').classList.add('bg-violet-500/15', 'text-violet-400', 'border-violet-500/30');
    document.getElementById('joke-sort-random').classList.remove('bg-gray-700/50', 'text-gray-400', 'border-gray-700');
    document.getElementById('joke-sort-viral').classList.remove('bg-pink-500/15', 'text-pink-400', 'border-pink-500/30');
    document.getElementById('joke-sort-viral').classList.add('bg-gray-700/50', 'text-gray-400', 'border-gray-700');
    renderJokes();
  });
}

// ─── SERIES / RUBRICS ────────────────────
function getSeries() {
  try { return JSON.parse(localStorage.getItem('ferixdi_series') || '[]'); } catch { return []; }
}
function saveSeries(series) {
  localStorage.setItem('ferixdi_series', JSON.stringify(series));
}

function renderSeriesList() {
  const list = document.getElementById('series-list');
  const empty = document.getElementById('series-empty');
  const series = getSeries();

  if (!list) return;
  if (series.length === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  list.innerHTML = series.map((s, i) => {
    const charA = state.characters?.find(c => c.id === s.charA_id);
    const charB = state.characters?.find(c => c.id === s.charB_id);
    const epCount = s.episodes?.length || 0;
    return `
      <div class="glass-panel p-4 space-y-2 border-l-2 border-amber-500/30">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-amber-400">${escapeHtml(s.name)}</div>
          <div class="flex gap-2">
            <button class="series-gen-btn text-[10px] px-3 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors" data-idx="${i}">▶ Новый эпизод</button>
            <button class="series-del-btn text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors" data-idx="${i}">✕</button>
          </div>
        </div>
        <div class="flex gap-3 text-[11px]">
          <span class="text-cyan-400">A: ${charA?.name_ru || s.charA_id}</span>
          <span class="text-gray-600">×</span>
          <span class="text-violet-400">B: ${charB?.name_ru || s.charB_id}</span>
        </div>
        ${s.style ? `<div class="text-[10px] text-gray-500">Стиль: ${escapeHtml(s.style)}</div>` : ''}
        <div class="text-[10px] text-gray-600">${epCount} ${epCount === 1 ? 'эпизод' : (epCount >= 2 && epCount <= 4) ? 'эпизода' : 'эпизодов'}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.series-gen-btn').forEach(btn => btn.addEventListener('click', () => generateFromSeries(parseInt(btn.dataset.idx))));
  list.querySelectorAll('.series-del-btn').forEach(btn => btn.addEventListener('click', () => deleteSeries(parseInt(btn.dataset.idx))));
}

function createSeries() {
  if (!isPromoValid()) { showNotification('🔑 Нужен промо-код', 'error'); return; }

  const name = document.getElementById('series-name-input')?.value.trim();
  const charA = document.getElementById('series-char-a')?.value;
  const charB = document.getElementById('series-char-b')?.value;
  const style = document.getElementById('series-style-input')?.value.trim();

  if (!name) { showNotification('Введите название серии', 'error'); return; }
  if (!charA || !charB) { showNotification('Выберите обоих персонажей', 'error'); return; }
  if (charA === charB) { showNotification('Персонажи должны быть разные', 'error'); return; }

  const series = getSeries();
  series.push({ name, charA_id: charA, charB_id: charB, style, episodes: [], created: Date.now() });
  saveSeries(series);

  document.getElementById('series-name-input').value = '';
  document.getElementById('series-style-input').value = '';
  renderSeriesList();
  showNotification(`📺 Серия "${name}" создана!`, 'success');
  log('OK', 'SERIES', `Создана серия: ${name}`);
}

function deleteSeries(idx) {
  const series = getSeries();
  if (!confirm(`Удалить серию "${series[idx]?.name}"?`)) return;
  series.splice(idx, 1);
  saveSeries(series);
  renderSeriesList();
  showNotification('Серия удалена', 'info');
}

function generateFromSeries(idx) {
  const series = getSeries();
  const s = series[idx];
  if (!s) return;

  if (!isPromoValid()) { showNotification('🔑 Нужен промо-код', 'error'); return; }

  selectChar('A', s.charA_id);
  selectChar('B', s.charB_id);
  state.generationMode = 'idea';
  state.inputMode = 'idea';
  selectGenerationMode?.('idea');

  const hint = s.style ? `Тема серии: ${s.style}. Это эпизод #${(s.episodes?.length || 0) + 1}.` : '';
  const ideaInput = document.getElementById('idea-input');
  if (ideaInput && hint) ideaInput.value = hint;

  // Save episode reference for thread memory
  state._currentSeries = { idx, name: s.name };

  navigateTo('generate');
  updateReadiness?.();
  showNotification(`📺 Серия "${s.name}" — создаём новый эпизод`, 'success');
}

function populateSeriesSelects() {
  const selA = document.getElementById('series-char-a');
  const selB = document.getElementById('series-char-b');
  if (!selA || !selB || !state.characters?.length) return;

  const opts = state.characters.map(c => `<option value="${c.id}">${c.name_ru} (${c.group})</option>`).join('');
  selA.innerHTML = `<option value="">— Выбрать —</option>${opts}`;
  selB.innerHTML = `<option value="">— Выбрать —</option>${opts}`;
}

function initSeries() {
  document.getElementById('btn-create-series')?.addEventListener('click', createSeries);
  renderSeriesList();
}

// ─── VIRAL SURPRISE PRESETS v2 ───────────────
// 80+ curated viral formulas — hook, killer word, share trigger, weighted pair matching, anti-repeat

const VIRAL_SURPRISE_PRESETS = [
  // ═══ AI И ТЕХНОЛОГИИ ═══
  { topic: 'ChatGPT написал за внука сочинение — бабка решила что внук гений', hook: 'A хватает тетрадку и трясёт перед камерой', killer: 'робот', share: 'скинь тому кто даёт детям ChatGPT', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','meme'] }, loc: ['kitchen','living_room'], cat: 'AI и технологии' },
  { topic: 'Дед скачал нейросеть — генерирует себе невесту из молодости', hook: 'A поворачивает телефон к камере с безумной улыбкой', killer: 'молодость', share: 'покажи дедушке', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme','chaotic'] }, loc: ['living_room','kitchen'], cat: 'AI и технологии' },
  { topic: 'Бабка узнала что Алиса это не соседка а робот в телефоне', hook: 'A отбрасывает телефон с ужасом', killer: 'колонка', share: 'скинь бабушке пусть проверит', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI и технологии' },
  { topic: 'Мама нашла приложение для старения лица — увидела себя через 20 лет', hook: 'A роняет телефон на стол с открытым ртом', killer: 'удалить', share: 'скинь маме пусть попробует', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI и технологии' },
  { topic: 'Дед попросил Siri позвонить жене — та набрала бывшую', hook: 'A замирает с телефоном у уха', killer: 'бывшая', share: 'покажи тому кто разговаривает с телефоном', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme'] }, loc: ['kitchen','car'], cat: 'AI и технологии' },
  { topic: 'Нейросеть нарисовала портрет бабки по описанию — получился кот', hook: 'A тычет пальцем в экран возмущённо', killer: 'мяу', share: 'скинь подруге у которой кот похож на хозяйку', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['living_room'], cat: 'AI и технологии' },
  { topic: 'Бабка диктует нейросети рецепт борща — та предлагает заказать доставку', hook: 'A хлопает по столу и показывает палец', killer: 'доставка', share: 'скинь тому кто не умеет готовить', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','conflict'] }, loc: ['kitchen'], cat: 'AI и технологии' },
  { topic: 'Дед установил голосовой помощник — теперь спорит с ним каждый вечер', hook: 'A наклоняется к колонке и грозит пальцем', killer: 'выключить', share: 'покажи тому кто разговаривает с Алисой', pair: { groupA: ['dedy'], groupB: ['babki','parni'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'AI и технологии' },
  { topic: 'Внучка показала бабке дипфейк видео с ней — бабка звонит в полицию', hook: 'A хватается за сердце и пятится', killer: 'полиция', share: 'скинь бабушке', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic'] }, loc: ['living_room','kitchen'], cat: 'AI и технологии' },
  { topic: 'Мама попросила ChatGPT написать СМС мужу — вышло слишком романтично', hook: 'A читает с телефона и краснеет', killer: 'романтика', share: 'скинь подруге пусть попробует', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['meme','conflict'] }, loc: ['kitchen','living_room'], cat: 'AI и технологии' },
  { topic: 'Бабка позвонила на горячую линию банка — подружилась с роботом', hook: 'A прижимает телефон к уху и улыбается', killer: 'подруга', share: 'скинь тому кто висит на горячей линии', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI и технологии' },
  { topic: 'Дед купил робот-пылесос — следит за ним как за внуком', hook: 'A сидит на полу и наблюдает за пылесосом', killer: 'внук', share: 'покажи тому у кого робот-пылесос', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme'] }, loc: ['living_room'], cat: 'AI и технологии' },

  // ═══ ЦЕНЫ И ИНФЛЯЦИЯ ═══
  { topic: 'Сыр за 800₽ — бабка торгуется с кассиром как на базаре', hook: 'A швыряет чек на стол и тычет пальцем', killer: 'рассрочка', share: 'скинь тому кто помнит сыр за 50₽', pair: { groupA: ['babki'], groupB: ['prodavtsy','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['shop','market'], cat: 'Цены и инфляция' },
  { topic: 'Дед увидел чек из Пятёрочки — думает это квитанция за ипотеку', hook: 'A разворачивает чек и он падает до пола', killer: 'ипотека', share: 'скинь мужу после магазина', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['kitchen','shop'], cat: 'Цены и инфляция' },
  { topic: 'Мама купила авокадо за 300₽ — свекровь считает это предательством', hook: 'A поднимает авокадо как улику', killer: 'авокадо', share: 'скинь свекрови или тёще', pair: { groupA: ['mamy'], groupB: ['babki'], compatA: ['conflict'] }, loc: ['kitchen'], cat: 'Цены и инфляция' },
  { topic: 'Бабка сравнивает цены 1990 и 2026 — каждый раз охает громче', hook: 'A загибает пальцы и охает театрально', killer: 'копейки', share: 'скинь маме пусть посчитает', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['kitchen','shop'], cat: 'Цены и инфляция' },
  { topic: 'Парень заказал кофе за 600₽ — дед рассказал сколько стоила машина', hook: 'A подавился кофе уставившись в чек', killer: 'машина', share: 'покажи тому кто покупает кофе каждый день', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['conflict','meme'] }, loc: ['cafe'], cat: 'Цены и инфляция' },
  { topic: 'Бабка увидела огурцы зимой — решила что это цена за золото', hook: 'A хватает ценник и подносит к глазам трижды', killer: 'золото', share: 'скинь тому кто покупает огурцы зимой', pair: { groupA: ['babki'], groupB: ['prodavtsy'], compatA: ['chaotic'] }, loc: ['shop','market'], cat: 'Цены и инфляция' },
  { topic: 'Дед увидел цену на бензин — решил пересесть на велосипед', hook: 'A бросает ключи от машины на стол', killer: 'велосипед', share: 'скинь автомобилисту', pair: { groupA: ['dedy'], groupB: ['parni','babki'], compatA: ['meme'] }, loc: ['car','kitchen'], cat: 'Цены и инфляция' },
  { topic: 'Курьер принёс еду для кота за 2000₽ — бабка в шоке от приоритетов', hook: 'A смотрит в пакет и поднимает брови', killer: 'кот', share: 'скинь владельцу кота', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['kitchen','stairwell'], cat: 'Цены и инфляция' },

  // ═══ РАЗРЫВ ПОКОЛЕНИЙ ═══
  { topic: 'Внучка показала макияж — бабка вызвала скорую', hook: 'A хватает внучку за лицо и рассматривает', killer: 'скорая', share: 'скинь подруге с макияжем', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['bathroom','living_room'], cat: 'Разрыв поколений' },
  { topic: 'Дед увидел рваные джинсы за 15000₽ — предложил зашить бесплатно', hook: 'A хватает джинсы и ищет дырку', killer: 'зашить', share: 'покажи тому кто носит рваные джинсы', pair: { groupA: ['dedy'], groupB: ['parni','devushki'], compatA: ['meme'] }, loc: ['living_room','shop'], cat: 'Разрыв поколений' },
  { topic: 'Бабка не понимает как внук зарабатывает в телефоне больше чем она на заводе', hook: 'A тычет в телефон потом в свои руки', killer: 'телефон', share: 'скинь фрилансеру', pair: { groupA: ['babki'], groupB: ['parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Разрыв поколений' },
  { topic: 'Дед учит внука чинить кран — тот гуглит видео на YouTube', hook: 'A выхватывает телефон и машет ключом', killer: 'YouTube', share: 'скинь тому кто чинит всё по YouTube', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['conflict','meme'] }, loc: ['bathroom','kitchen'], cat: 'Разрыв поколений' },
  { topic: 'Бабка увидела доставку — лекция о лени поколения', hook: 'A перехватывает пакет доставки', killer: 'лень', share: 'скинь тому кто заказывает доставку каждый день', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic'] }, loc: ['kitchen'], cat: 'Разрыв поколений' },
  { topic: 'Внук показал деду NFT — дед предложил повесить на стену в рамке', hook: 'A крутит телефон пытаясь разглядеть', killer: 'рамка', share: 'покажи тому кто покупает NFT', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['meme'] }, loc: ['living_room'], cat: 'Разрыв поколений' },
  { topic: 'Мама узнала что дочка встречается через интернет', hook: 'A хватается за голову обеими руками', killer: 'интернет', share: 'скинь тому кто познакомился в приложении', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['conflict'] }, loc: ['kitchen','living_room'], cat: 'Разрыв поколений' },
  { topic: 'Бабка увидела стрим внучки — решила что та работает в цирке', hook: 'A показывает на экран с ужасом', killer: 'цирк', share: 'скинь стримеру', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['living_room'], cat: 'Разрыв поколений' },
  { topic: 'Дед объясняет что развлечение раньше — выйти на улицу', hook: 'A разводит руки и показывает на дверь', killer: 'улица', share: 'покажи ребёнку который не выходит из дома', pair: { groupA: ['dedy'], groupB: ['devushki'], compatA: ['meme'] }, loc: ['living_room','yard'], cat: 'Разрыв поколений' },
  { topic: 'Дед впервые увидел смузи — решил что это недомешанный компот', hook: 'A крутит стакан и смотрит на просвет', killer: 'компот', share: 'покажи тому кто пьёт смузи', pair: { groupA: ['dedy'], groupB: ['devushki','parni'], compatA: ['meme'] }, loc: ['kitchen','cafe'], cat: 'Разрыв поколений' },
  { topic: 'Бабка увидела авокадо-тост внучки — спросила где мясо', hook: 'A заглядывает в тарелку и разводит руками', killer: 'мясо', share: 'скинь вегану', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['kitchen','cafe'], cat: 'Разрыв поколений' },
  { topic: 'Дед нашёл пиджак 1975 года — говорит что он снова в моде', hook: 'A надевает пиджак и поправляет лацканы', killer: 'мода', share: 'скинь моднику', pair: { groupA: ['dedy'], groupB: ['parni','devushki'], compatA: ['meme'] }, loc: ['living_room','bedroom'], cat: 'Разрыв поколений' },
  { topic: 'Айтишник объясняет бабке свою работу — она до сих пор не поняла', hook: 'A рисует схемы в воздухе руками', killer: 'кнопки', share: 'покажи родителям которые не понимают чем ты занимаешься', pair: { groupA: ['parni'], groupB: ['babki','mamy'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Разрыв поколений' },

  // ═══ БЫТОВОЙ АБСУРД ═══
  { topic: 'Расследование — кто последний брал пульт', hook: 'A потрясает пультом как уликой', killer: 'кот', share: 'скинь тому кто вечно теряет пульт', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','conflict'] }, loc: ['living_room','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Бабка нашла чужой носок в стиралке — расследование', hook: 'A держит носок двумя пальцами', killer: 'сосед', share: 'скинь тому у кого пропадают носки', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic','meme'] }, loc: ['bathroom','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Дед сломал кран починяя — обвиняет кран', hook: 'A швыряет ключ на пол', killer: 'сам', share: 'покажи тому кто чинит сам', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['bathroom','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Кот разбил вазу — каждый обвиняет другого', hook: 'A показывает на осколки потом на B', killer: 'твой', share: 'скинь тому у кого кот хулиган', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['conflict'] }, loc: ['living_room','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Муж купил не тот хлеб — жена как будто измена', hook: 'A хлопает батоном по столу', killer: 'измена', share: 'скинь мужу который покупает не тот хлеб', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','conflict'] }, loc: ['kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Бабка пересолила суп — обвиняет соль что стала солонее', hook: 'A пробует и выплёвывает', killer: 'солонее', share: 'скинь тому кто пересаливает', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['meme','chaotic'] }, loc: ['kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Спор кто лучше готовит — оба сгорело пока спорили', hook: 'A нюхает воздух и замирает', killer: 'сгорело', share: 'скинь тому кто считает себя поваром', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','meme','conflict'] }, loc: ['kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Кто храпит — оба отрицают при записи на телефоне', hook: 'A включает запись и поворачивает экран', killer: 'запись', share: 'скинь тому кто храпит и отрицает', pair: { groupA: ['dedy','babki'], groupB: ['babki','dedy'], compatA: ['meme','conflict'] }, loc: ['bedroom','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Бабка 3 часа искала очки — они на голове', hook: 'A переворачивает подушки с паникой', killer: 'голова', share: 'скинь тому кто теряет очки', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Дед нажал не ту кнопку на стиралке — она стирает 4 часа', hook: 'A жмёт все кнопки подряд', killer: 'кнопка', share: 'покажи тому кто боится техники', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['bathroom','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Бабка попробовала суши — решила рыба сырая из экономии', hook: 'A тыкает палочками и нюхает', killer: 'сырая', share: 'скинь тому кто не ел суши', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['cafe','kitchen'], cat: 'Бытовой абсурд' },
  { topic: 'Начальник созвал совещание по поводу совещания', hook: 'A раскладывает документы с серьёзным лицом', killer: 'совещание', share: 'скинь коллеге из офиса', pair: { groupA: ['chinovniki','biznes'], groupB: ['parni','devushki'], compatA: ['conflict'] }, loc: ['office'], cat: 'Бытовой абсурд' },
  { topic: 'Учитель поставил двойку — родитель пришёл разбираться и получил тройку', hook: 'A тычет в дневник и стучит по столу', killer: 'тройка', share: 'скинь учителю или родителю школьника', pair: { groupA: ['mamy'], groupB: ['uchitelya'], compatA: ['conflict','chaotic'] }, loc: ['school','office'], cat: 'Бытовой абсурд' },

  // ═══ ЗДОРОВЬЕ ═══
  { topic: 'Бабка учит врача — подорожник решает всё', hook: 'A достаёт пучок травы из сумки', killer: 'подорожник', share: 'скинь бабушке которая лечит чаем', pair: { groupA: ['babki'], groupB: ['doktory','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['clinic','kitchen'], cat: 'Здоровье и поликлиника' },
  { topic: 'Дед загуглил симптомы — решил что осталось 3 дня', hook: 'A показывает телефон как приговор', killer: 'интернет', share: 'скинь тому кто гуглит симптомы', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme'] }, loc: ['living_room','clinic'], cat: 'Здоровье и поликлиника' },
  { topic: 'Мама нашла витамины сына — думает наркотики', hook: 'A держит банку как улику', killer: 'витамины', share: 'скинь маме которая проверяет сумки', pair: { groupA: ['mamy'], groupB: ['parni'], compatA: ['chaotic','conflict'] }, loc: ['kitchen','living_room'], cat: 'Здоровье и поликлиника' },
  { topic: 'Дед отказывается к врачу — в 45 не ходил и жив', hook: 'A скрещивает руки и качает головой', killer: 'жив', share: 'скинь тому кто боится врачей', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['conflict','meme'] }, loc: ['kitchen','living_room'], cat: 'Здоровье и поликлиника' },
  { topic: 'Бабка лечит внука горчичниками малиной и заговорами одновременно', hook: 'A расставляет банки как на алтаре', killer: 'заговор', share: 'скинь тому кого лечили бабушкиными методами', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','meme'] }, loc: ['kitchen','living_room'], cat: 'Здоровье и поликлиника' },

  // ═══ ЖКХ ═══
  { topic: 'Квитанция за отопление в мае — бабка воюет', hook: 'A разворачивает квитанцию с трясущимися руками', killer: 'май', share: 'скинь соседу по подъезду', pair: { groupA: ['babki'], groupB: ['sosedi','chinovniki'], compatA: ['chaotic','conflict'] }, loc: ['stairwell','kitchen'], cat: 'ЖКХ и коммуналка' },
  { topic: 'Сосед затопил — оба обвиняют трубы', hook: 'A показывает на потолок с которого капает', killer: 'трубы', share: 'скинь соседу сверху', pair: { groupA: ['dedy','babki'], groupB: ['sosedi'], compatA: ['conflict','chaotic'] }, loc: ['stairwell','bathroom'], cat: 'ЖКХ и коммуналка' },
  { topic: 'Бабка считает воду — налили на олимпийский бассейн', hook: 'A тычет калькулятором в камеру', killer: 'бассейн', share: 'скинь тому кто не следит за счётчиками', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['chaotic','meme'] }, loc: ['kitchen','bathroom'], cat: 'ЖКХ и коммуналка' },
  { topic: 'Дед третий день не запомнит код домофона', hook: 'A бьёт по домофону ладонью', killer: 'ключ', share: 'скинь тому кто забывает пароли', pair: { groupA: ['dedy'], groupB: ['sosedi','parni'], compatA: ['meme'] }, loc: ['stairwell','yard'], cat: 'ЖКХ и коммуналка' },
  { topic: 'Бабка собрала подписи подъезда против кошки соседки', hook: 'A разворачивает список длиной в метр', killer: 'кошка', share: 'скинь соседу с питомцем', pair: { groupA: ['babki'], groupB: ['sosedi'], compatA: ['conflict','chaotic'] }, loc: ['stairwell'], cat: 'ЖКХ и коммуналка' },

  // ═══ ДАЧА ═══
  { topic: 'Бабка хвастается урожаем — соседка говорит её помидоры крупнее', hook: 'A поднимает помидор размером с кулак', killer: 'крупнее', share: 'скинь дачнику', pair: { groupA: ['babki'], groupB: ['sosedi','babki'], compatA: ['conflict','meme'] }, loc: ['dacha','yard'], cat: 'Дача и огород' },
  { topic: 'Дед построил теплицу из старых окон — считает себя архитектором', hook: 'A разводит руки показывая масштаб', killer: 'архитектор', share: 'покажи тому кто строит из подручных', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme','chaotic'] }, loc: ['dacha','yard'], cat: 'Дача и огород' },
  { topic: 'Украли кабачки — бабка допрашивает соседей', hook: 'A показывает пустую грядку и сжимает кулаки', killer: 'кабачки', share: 'скинь дачнику у которого воруют', pair: { groupA: ['babki'], groupB: ['sosedi','dedy'], compatA: ['chaotic','conflict'] }, loc: ['dacha','yard'], cat: 'Дача и огород' },
  { topic: 'Внучка на дачу в белом — бабка выдала тяпку', hook: 'A оглядывает B сверху вниз', killer: 'тяпка', share: 'скинь тому кто ездит на дачу в городском', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','meme'] }, loc: ['dacha'], cat: 'Дача и огород' },
  { topic: 'Бабка выращивает рассаду — заняла все подоконники', hook: 'A показывает на все окна заставленные горшками', killer: 'подоконник', share: 'скинь тому у кого рассада повсюду', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic'] }, loc: ['kitchen','living_room'], cat: 'Дача и огород' },
  { topic: 'Бабка поставила камеру на дачу — смотрит огурцы 24/7 как сериал', hook: 'A сидит с телефоном и комментирует рост', killer: 'серия', share: 'скинь дачнику', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['meme','chaotic'] }, loc: ['dacha','kitchen'], cat: 'Дача и огород' },

  // ═══ СОЦСЕТИ ═══
  { topic: 'Бабка случайно записала рилс — миллион просмотров', hook: 'A смотрит в телефон и хватается за щёки', killer: 'миллион', share: 'скинь тому кто мечтает о просмотрах', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Соцсети и тренды' },
  { topic: 'Дед завёл тикток — обзоры на борщ', hook: 'A ставит борщ перед камерой серьёзно', killer: 'подписчики', share: 'покажи дедушке', pair: { groupA: ['dedy'], groupB: ['babki','parni'], compatA: ['meme','chaotic'] }, loc: ['kitchen'], cat: 'Соцсети и тренды' },
  { topic: 'Мама не узнала дочку в инсте из-за фильтров', hook: 'A подносит телефон к лицу B и сравнивает', killer: 'фильтр', share: 'скинь подруге с фильтрами', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['living_room','kitchen'], cat: 'Соцсети и тренды' },
  { topic: 'Бабка думает что выиграла айфон подписавшись на рассылку', hook: 'A радостно трясёт телефоном', killer: 'спам', share: 'скинь бабушке которая верит в розыгрыши', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Соцсети и тренды' },
  { topic: 'Парень объясняет бабке донат — она думает пончик', hook: 'A разводит руками пытаясь объяснить', killer: 'пончик', share: 'скинь геймеру', pair: { groupA: ['parni'], groupB: ['babki'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Соцсети и тренды' },
  { topic: 'Подписка на кинотеатр стоит денег — бабка предложила видеомагнитофон', hook: 'A достаёт VHS кассету из шкафа', killer: 'кассета', share: 'покажи тому кто помнит видеокассеты', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['living_room'], cat: 'Соцсети и тренды' },
  { topic: 'Бабка заказала на WB — пришло 15 посылок вместо одной', hook: 'A стоит перед горой пакетов', killer: 'корзина', share: 'скинь тому кто не может остановиться на WB', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['living_room','stairwell'], cat: 'Соцсети и тренды' },
  { topic: 'Дед увидел пункт выдачи — думает это новая почта', hook: 'A стоит в очереди и озирается', killer: 'почта', share: 'покажи тому кто ходит в ПВЗ каждый день', pair: { groupA: ['dedy'], groupB: ['prodavtsy','devushki'], compatA: ['meme'] }, loc: ['shop'], cat: 'Соцсети и тренды' },
  { topic: 'Мама оставила отзыв — написала роман на 3 страницы', hook: 'A показывает бесконечный текст на телефоне', killer: 'роман', share: 'скинь тому кто пишет длинные отзывы', pair: { groupA: ['mamy'], groupB: ['devushki','parni'], compatA: ['meme','conflict'] }, loc: ['kitchen','living_room'], cat: 'Соцсети и тренды' },

  // ═══ ОТНОШЕНИЯ ═══
  { topic: 'Жена нашла лайк мужа на фото коллеги — допрос', hook: 'A поворачивает телефон экраном к B', killer: 'лайк', share: 'скинь мужу для профилактики', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','bedroom'], cat: 'Отношения' },
  { topic: 'Бабка учит выбирать мужа — по рукам', hook: 'A хватает руку B и рассматривает', killer: 'руки', share: 'скинь подруге ищущей мужа', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Отношения' },
  { topic: 'Мама допрашивает парня дочки как на собеседовании', hook: 'A садится напротив и складывает руки как HR', killer: 'зарплата', share: 'скинь парню который знакомится с мамой', pair: { groupA: ['mamy'], groupB: ['parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Отношения' },
  { topic: 'Свекровь приехала — первым делом открыла холодильник', hook: 'A распахивает холодильник с пристрастием', killer: 'холодильник', share: 'скинь невестке или свекрови', pair: { groupA: ['babki'], groupB: ['mamy','devushki'], compatA: ['conflict'] }, loc: ['kitchen'], cat: 'Отношения' },
  { topic: 'Парень подарил пылесос на 8 марта — не понимает проблему', hook: 'A показывает пылесос с довольной улыбкой', killer: 'пылесос', share: 'скинь мужу перед 8 марта', pair: { groupA: ['parni'], groupB: ['devushki','mamy'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'Отношения' },
  { topic: 'Дед даёт совет по отношениям — бабка корректирует из-за угла', hook: 'A обнимает B и начинает поучать', killer: 'слушай', share: 'покажи дедушке', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['meme'] }, loc: ['kitchen','yard'], cat: 'Отношения' },
  { topic: 'Мама помогает молодожёнам — через час они мечтают чтоб ушла', hook: 'A двигает мебель без спроса', killer: 'помощь', share: 'скинь молодожёнам', pair: { groupA: ['mamy'], groupB: ['devushki','parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Отношения' },
  { topic: 'Бабка нашла профиль деда на сайте знакомств — а им 50 лет', hook: 'A тычет в телефон со слезами от смеха', killer: 'профиль', share: 'скинь женатой паре', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['conflict','meme'] }, loc: ['kitchen','living_room'], cat: 'Отношения' },

  // ═══ ТРАНСПОРТ ═══
  { topic: 'Бабка учит водителя маршрутки ехать правильно', hook: 'A наклоняется и показывает направление', killer: 'знаю', share: 'скинь тому кто учит водителя', pair: { groupA: ['babki'], groupB: ['taksisty','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['car','bus_stop'], cat: 'Транспорт и пробки' },
  { topic: 'Дед vs навигатор — кто лучше знает дорогу', hook: 'A выключает навигатор решительно', killer: 'карта', share: 'покажи тому кто не доверяет навигатору', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['car'], cat: 'Транспорт и пробки' },
  { topic: 'Бабка требует остановить маршрутку между остановками', hook: 'A встаёт и стучит по стеклу', killer: 'здесь', share: 'скинь тому кто ездит на маршрутке', pair: { groupA: ['babki'], groupB: ['taksisty','sosedi'], compatA: ['chaotic'] }, loc: ['car'], cat: 'Транспорт и пробки' },
  { topic: 'Дед припарковался — никто не может выехать', hook: 'A разводит руками и пожимает плечами', killer: 'место', share: 'скинь тому кто криво паркуется', pair: { groupA: ['dedy'], groupB: ['parni','mamy'], compatA: ['meme'] }, loc: ['yard','car'], cat: 'Транспорт и пробки' },
];

// Track recent presets to avoid repetition
let _lastSurpriseIndices = [];

// ─── SMART PAIR MATCHING v2 (weighted scoring) ─
function pickSmartPairForPreset(preset, chars) {
  if (!chars?.length || chars.length < 2) return null;
  const p = preset.pair;

  const scoreA = (c) => {
    let s = 0;
    const grp = (c.group || '').toLowerCase();
    if (p.groupA?.length) { if (p.groupA.some(g => grp.includes(g))) s += 10; else s -= 5; }
    if (p.compatA?.length) { if (p.compatA.includes(c.compatibility)) s += 5; }
    if (c.compatibility === 'chaotic' || c.compatibility === 'meme') s += 2;
    if (c.modifiers?.hook_style && c.modifiers.hook_style !== 'natural attention grab') s += 3;
    return s;
  };

  const scoredA = chars.map(c => ({ c, s: scoreA(c) })).sort((a, b) => b.s - a.s);
  const topA = scoredA.filter(x => x.s >= scoredA[0].s - 3).map(x => x.c);
  const charA = topA[Math.floor(Math.random() * topA.length)];

  const scoreB = (c) => {
    if (c.id === charA.id) return -999;
    let s = 0;
    const grp = (c.group || '').toLowerCase();
    if (p.groupB?.length) { if (p.groupB.some(g => grp.includes(g))) s += 10; else s -= 3; }
    if (c.group !== charA.group) s += 6;
    const contrast = { chaotic: 'calm', calm: 'chaotic', conflict: 'meme', meme: 'conflict', balanced: 'chaotic' };
    if (c.compatibility === contrast[charA.compatibility]) s += 8;
    if (c.speech_pace !== charA.speech_pace) s += 3;
    if (c.vibe_archetype !== charA.vibe_archetype) s += 2;
    return s;
  };

  const scoredB = chars.map(c => ({ c, s: scoreB(c) })).filter(x => x.s > -999).sort((a, b) => b.s - a.s);
  const topB = scoredB.filter(x => x.s >= scoredB[0].s - 4).map(x => x.c);
  const charB = topB[Math.floor(Math.random() * topB.length)];

  return charA && charB ? { A: charA, B: charB } : null;
}

// ─── SMART LOCATION MATCHING ─────────────────
function pickSmartLocationForPreset(preset, locations) {
  if (!locations?.length) return null;
  const hints = preset.loc || [];
  if (!hints.length) return locations[Math.floor(Math.random() * locations.length)];

  let matches = locations.filter(l => {
    const lid = (l.id || '').toLowerCase();
    const lname = (l.name_ru || '').toLowerCase();
    const lscene = (l.scene_en || '').toLowerCase();
    return hints.some(h => lid.includes(h) || lname.includes(h) || lscene.includes(h));
  });
  if (matches.length) return matches[Math.floor(Math.random() * matches.length)];

  const isOutdoorPreset = hints.some(h => ['dacha','yard','park','street','bus_stop','market'].includes(h));
  const filtered = locations.filter(l => {
    const scene = (l.scene_en || '').toLowerCase();
    return isOutdoorPreset ? scene.includes('outdoor') || scene.includes('yard') || scene.includes('garden') : !scene.includes('outdoor');
  });
  return (filtered.length ? filtered : locations)[Math.floor(Math.random() * (filtered.length || locations.length))];
}

// Twist suffixes — make every topic unique even if same preset is picked
const _SURPRISE_TWISTS = [
  'и всё это на камеру', 'а B молча наблюдает', 'и ситуация выходит из-под контроля',
  'но B знает правду', 'а B уже давно это знал(а)', 'и оба уверены что правы',
  'а камера всё записывает', 'но B готовит ответный удар', 'и A даже не подозревает чем это кончится',
  'и B еле сдерживает смех', 'а A входит в раж', 'но B невозмутимо ждёт момент',
  'и оба забывают о камере', 'а зрители уже в истерике', 'и A заходит слишком далеко',
  'но B приберёг(ла) козырь', 'а A упирается до конца', 'и B роняет killer word как бомбу',
  'а ситуация становится абсурднее с каждой секундой', 'и всё переворачивается одним словом',
];

// ─── SURPRISE BUTTON v3 (full-cycle anti-repeat + unique topics) ─
function initSurprise() {
  document.getElementById('btn-surprise')?.addEventListener('click', () => {
    if (!isPromoValid()) { showNotification('🔑 Нужен промо-код для генерации', 'error'); navigateTo('settings'); return; }

    const chars = state.characters;
    if (!chars || chars.length < 2) { showNotification('⚠️ Персонажи не загружены', 'error'); return; }

    // ── FULL-CYCLE ANTI-REPEAT: use ALL presets before ANY can repeat ──
    if (_lastSurpriseIndices.length >= VIRAL_SURPRISE_PRESETS.length) {
      _lastSurpriseIndices.length = 0; // Reset — all presets used, start new cycle
      log('INFO', 'SURPRISE', 'Все пресеты использованы — новый цикл');
    }
    let idx;
    let attempts = 0;
    do {
      idx = Math.floor(Math.random() * VIRAL_SURPRISE_PRESETS.length);
      attempts++;
    } while (_lastSurpriseIndices.includes(idx) && attempts < 200);
    _lastSurpriseIndices.push(idx);

    const preset = VIRAL_SURPRISE_PRESETS[idx];

    // ── SMART PAIR with anti-repeat for recent combos ──
    let pair = null;
    let pairAttempts = 0;
    const recentPairKeys = (window._lastSurprisePairs || []).slice(-15);
    do {
      pair = pickSmartPairForPreset(preset, chars);
      pairAttempts++;
      if (pair && recentPairKeys.includes(`${pair.A.id}+${pair.B.id}`)) {
        pair = null; // try again — same combo was used recently
      }
    } while (!pair && pairAttempts < 10);
    // Fallback if pair matching exhausted
    if (!pair) pair = pickSmartPairForPreset(preset, chars);
    if (pair) {
      selectChar('A', pair.A.id);
      selectChar('B', pair.B.id);
      if (!window._lastSurprisePairs) window._lastSurprisePairs = [];
      window._lastSurprisePairs.push(`${pair.A.id}+${pair.B.id}`);
      if (window._lastSurprisePairs.length > 30) window._lastSurprisePairs.shift();
    } else {
      autoSelectRandomPair();
    }

    if (state.locations?.length) {
      const loc = pickSmartLocationForPreset(preset, state.locations);
      if (loc) {
        state.selectedLocation = loc.id;
        updateLocationInfo?.();
      }
    }

    state.generationMode = 'suggested';
    state.inputMode = 'suggested';
    selectGenerationMode?.('suggested');

    // ── BUILD UNIQUE TOPIC — never the same string twice ──
    const nameA = pair?.A?.name_ru || state.selectedA?.name_ru || '?';
    const nameB = pair?.B?.name_ru || state.selectedB?.name_ru || '?';
    const twist = _SURPRISE_TWISTS[Math.floor(Math.random() * _SURPRISE_TWISTS.length)].replace('A', nameA).replace('B', nameB);
    const uid = Date.now().toString(36).slice(-4); // unique 4-char stamp
    
    let fullTopic = `${nameA} vs ${nameB}: ${preset.topic} — ${twist}`;
    if (preset.hook) fullTopic += ` [ХУК: ${preset.hook.replace(/\bA\b/g, nameA).replace(/\bB\b/g, nameB)}]`;
    if (preset.killer) fullTopic += ` [KILLER WORD: "${preset.killer}"]`;
    fullTopic += ` [uid:${uid}]`;

    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = fullTopic;
    const ideaInputSuggested = document.getElementById('idea-input-suggested');
    if (ideaInputSuggested) ideaInputSuggested.value = fullTopic;

    navigateTo('generate');
    updateReadiness?.();

    const shareHint = preset.share ? ` | 📤 ${preset.share}` : '';
    showNotification(`🎯 ${nameA} × ${nameB}: "${preset.topic.slice(0, 50)}..."${shareHint}`, 'success');
    log('OK', 'VIRAL_SURPRISE', `#${idx}/${VIRAL_SURPRISE_PRESETS.length} [${_lastSurpriseIndices.length}/${VIRAL_SURPRISE_PRESETS.length} used] uid:${uid} | "${preset.topic}" | ${nameA} × ${nameB} | Кат: ${preset.cat}`);
  });
}

// ─── STORYBOARD PREVIEW ──────────────────
function populateStoryboard(result) {
  const panel = document.getElementById('storyboard-preview');
  if (!panel) return;

  const segs = result.blueprint_json?.dialogue_segments || [];
  const lineA = segs.find(s => s.speaker === 'A');
  const lineB = segs.find(s => s.speaker === 'B');
  const ctx = result._apiContext || {};
  const dialogueA = lineA?.text_ru || ctx.dialogueA || result.dialogue_A_ru || '—';
  const dialogueB = lineB?.text_ru || ctx.dialogueB || result.dialogue_B_ru || '—';
  const killerWord = result.blueprint_json?.killer_word || ctx.killerWord || result.killer_word || '💥';

  document.getElementById('sb-line-a').textContent = dialogueA;
  document.getElementById('sb-line-b').textContent = dialogueB;
  document.getElementById('sb-killer').textContent = killerWord;

  panel.classList.remove('hidden');
}

// ─── A/B TESTING ─────────────────────────
function initABTesting() {
  document.getElementById('btn-generate-ab')?.addEventListener('click', generateABVariants);
}

async function generateABVariants() {
  if (!isPromoValid() || !state.lastResult?._apiContext) {
    showNotification('Сначала выполните основную генерацию', 'error');
    return;
  }

  const btn = document.getElementById('btn-generate-ab');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ AI генерирует 3 варианта...'; }

  const panel = document.getElementById('ab-testing-panel');
  const container = document.getElementById('ab-variants');
  if (!container) return;
  panel?.classList.remove('hidden');

  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const token = localStorage.getItem('ferixdi_jwt');
    if (!token) { showNotification('🔑 Нет токена авторизации', 'error'); return; }
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const ctx = state.lastResult._apiContext;
    // ab_variants=2 tells server to ask Gemini for 2 extra variants in a SINGLE request
    const payload = { context: ctx, ab_variants: 2 };

    // Attach product/video if available (same as callAIEngine)
    if (state.productInfo?.image_base64) {
      payload.product_image = state.productInfo.image_base64;
      payload.product_mime = state.productInfo.mime_type || 'image/jpeg';
    }

    const resp = await fetch(`${apiBase}/api/generate`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Ошибка A/B генерации', 'error');
      return;
    }

    // Server returns { ai: { ...mainResult, ab_variants: [{...}, {...}] }, model, tokens }
    const ai = data.ai || {};

    // Extract current main result dialogue
    const segs = state.lastResult.blueprint_json?.dialogue_segments || [];
    const mainA = segs.find(s => s.speaker === 'A')?.text_ru || state.lastResult._apiContext?.dialogueA || '—';
    const mainB = segs.find(s => s.speaker === 'B')?.text_ru || state.lastResult._apiContext?.dialogueB || '—';
    const mainKiller = state.lastResult.blueprint_json?.killer_word || state.lastResult._apiContext?.killerWord || '';

    // Build variants array: current main + new main from AI + ab_variants from AI
    const variants = [
      { label: 'Текущий', a: mainA, b: mainB, killer: mainKiller, active: true },
    ];

    // The new main dialogue from AI (variant B)
    if (ai.dialogue_A_ru) {
      variants.push({ label: 'Вариант B', a: ai.dialogue_A_ru, b: ai.dialogue_B_ru || '—', killer: ai.killer_word || '' });
    }

    // Extra variants from ab_variants array (variant C, D...)
    const abSolo = ctx.soloMode || (!ctx.charB || ctx.charA?.id === ctx.charB?.id);
    const labels = ['Вариант C', 'Вариант D', 'Вариант E'];
    if (Array.isArray(ai.ab_variants)) {
      ai.ab_variants.forEach((v, i) => {
        if (v?.dialogue_A_ru && (abSolo || v?.dialogue_B_ru)) {
          variants.push({ label: labels[i] || `Вариант ${i + 3}`, a: v.dialogue_A_ru, b: abSolo ? '—' : (v.dialogue_B_ru || '—'), killer: v.killer_word || '' });
        }
      });
    }

    container.innerHTML = variants.map((v, i) => `
      <div class="p-3 rounded-lg border ${v.active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-gray-700 hover:border-amber-500/30'} cursor-pointer transition-colors ab-variant-card" data-idx="${i}">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-bold ${v.active ? 'text-emerald-400' : 'text-amber-400'}">${v.label} ${v.active ? '✓' : ''}</span>
          ${v.killer ? `<span class="text-[9px] text-pink-400">💥 ${escapeHtml(v.killer)}</span>` : ''}
        </div>
        <div class="text-[11px] text-cyan-300 mb-0.5">${abSolo ? '🎤' : 'A:'} ${escapeHtml(v.a)}</div>
        ${!abSolo ? `<div class="text-[11px] text-violet-300">B: ${escapeHtml(v.b)}</div>` : ''}
        ${!v.active ? `<button class="ab-select-btn mt-1.5 text-[9px] px-2 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors" data-idx="${i}">✓ Выбрать этот</button>` : ''}
      </div>
    `).join('');

    // Handle variant selection
    container.querySelectorAll('.ab-select-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(b.dataset.idx);
        const v = variants[idx];
        if (!v) return;
        // Update main result dialogues
        if (state.lastResult.blueprint_json?.dialogue_segments) {
          const segA = state.lastResult.blueprint_json.dialogue_segments.find(s => s.speaker === 'A');
          const segB = state.lastResult.blueprint_json.dialogue_segments.find(s => s.speaker === 'B');
          if (segA) segA.text_ru = v.a;
          if (segB) segB.text_ru = v.b;
          state.lastResult.blueprint_json.killer_word = v.killer;
        }
        document.getElementById('gen-dialogue-a').textContent = v.a;
        document.getElementById('gen-dialogue-b').textContent = v.b;
        document.getElementById('gen-killer-word').textContent = v.killer ? `💥 killer word: ${v.killer}` : '';
        populateStoryboard(state.lastResult);
        // Update active state in UI
        container.querySelectorAll('.ab-variant-card').forEach(card => {
          card.classList.remove('border-emerald-500/40', 'bg-emerald-500/5');
          card.classList.add('border-gray-700');
        });
        const activeCard = container.querySelector(`.ab-variant-card[data-idx="${idx}"]`);
        if (activeCard) {
          activeCard.classList.remove('border-gray-700');
          activeCard.classList.add('border-emerald-500/40', 'bg-emerald-500/5');
        }
        showNotification(`✓ Выбран ${v.label}`, 'success');
      });
    });

    log('OK', 'A/B', `Сгенерировано ${variants.length} вариантов за 1 запрос`);
  } catch (err) {
    showNotification(`Ошибка: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Ещё 3 варианта'; }
  }
}

// ─── CUSTOM CHARACTER CONSTRUCTOR ────────
function initCharConstructor() {
  document.getElementById('btn-toggle-char-constructor')?.addEventListener('click', () => {
    const panel = document.getElementById('char-constructor');
    if (panel) panel.classList.toggle('hidden');
  });

  const dropzone = document.getElementById('cc-photo-dropzone');
  const fileInput = document.getElementById('cc-photo-file');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.getElementById('cc-photo-preview');
          if (img) { img.src = e.target.result; img.classList.remove('hidden'); }
        };
        reader.readAsDataURL(fileInput.files[0]);
      }
    });
  }

  document.getElementById('btn-create-character')?.addEventListener('click', createCustomCharacter);
}

async function createCustomCharacter() {
  if (!isPromoValid()) { showCCStatus('🔑 Нужен промо-код', 'text-amber-400'); return; }

  const nameRu = document.getElementById('cc-name-ru')?.value.trim();
  const group = document.getElementById('cc-group')?.value;
  const appearance = document.getElementById('cc-appearance')?.value.trim();
  const speech = document.getElementById('cc-speech')?.value.trim();
  const compat = document.getElementById('cc-compat')?.value || 'balanced';
  const role = document.getElementById('cc-role')?.value || 'A';

  if (!nameRu) { showCCStatus('Введите имя персонажа', 'text-red-400'); return; }
  if (!appearance) { showCCStatus('Опишите внешность', 'text-red-400'); return; }

  showCCStatus('Проверяю доступ и создаю персонажа...', 'text-cyan-400 animate-pulse');

  const id = 'custom_' + nameRu.toLowerCase().replace(/[^а-яa-z0-9]/gi, '_').replace(/_+/g, '_') + '_' + Date.now().toString(36);
  const character_en = `${appearance.replace(/\.$/, '')}. ${speech ? speech.replace(/\.$/, '') + '.' : ''} Expressive facial reactions, natural micro-gestures, cinematic realism.`;

  // Auto-extract identity anchors from appearance description
  const _isMale = /дед|пап|сын|мужч|man|male|boy/i.test(appearance + ' ' + group);
  const appearanceLower = appearance.toLowerCase();
  const extractTokens = (keywords) => {
    const found = [];
    keywords.forEach(kw => { if (appearanceLower.includes(kw.toLowerCase())) found.push(kw); });
    return found.length ? found : ['custom appearance'];
  };

  const autoAnchors = {
    face_silhouette: appearance.split('.')[0]?.trim() || 'custom face',
    signature_element: appearance.split('.').find(s => /[А-ЯA-Z]{2,}/.test(s))?.trim() || 'distinctive feature',
    micro_gesture: 'natural expressive gestures',
    wardrobe_anchor: appearance.split('.').find(s => /одежд|платье|костюм|рубаш|куртк|свитер|пальто|шляп|очки|серьг|кольц|брасл|цеп|шарф|apron|coat|dress|shirt|jacket/i.test(s))?.trim() || 'casual clothing',
    accessory_anchors: extractTokens(['очки', 'часы', 'кольц', 'серьг', 'брасл', 'цеп', 'кулон', 'брошь', 'трость', 'glasses', 'watch', 'ring', 'earring', 'bracelet', 'chain', 'pendant', 'brooch', 'cane']),
    footwear_anchor: appearance.split('.').find(s => /туфл|ботинк|сапог|тапоч|кроссовк|shoes|boots|slippers|sneakers/i.test(s))?.trim() || 'worn comfortable footwear',
    headwear_anchor: appearance.split('.').find(s => /шляп|кепк|берет|платок|шапк|капюш|hat|cap|beret|headscarf|beanie/i.test(s))?.trim() || 'none',
    color_palette: extractTokens(['красн', 'синий', 'зелён', 'чёрн', 'бел', 'серый', 'коричн', 'золот', 'серебр', 'бордо', 'бежев', 'red', 'blue', 'green', 'black', 'white', 'grey', 'brown', 'gold', 'silver']),
    jewelry_anchors: appearance.split('.').find(s => /кольц|серьг|цеп|брасл|кулон|часы|ring|earring|chain|bracelet|pendant|watch/i.test(s))?.trim() || 'none visible',
    glasses_anchor: /очк|линз|glass|spectacle|bifocal/i.test(appearance) ? appearance.split('.').find(s => /очк|линз|glass|spectacle/i.test(s))?.trim() || 'glasses' : 'none',
    nail_style_anchor: _isMale ? 'short trimmed nails' : 'neat manicured nails',
    fabric_texture_anchor: /шёлк|silk/i.test(appearance) ? 'smooth silk' : /шерст|wool|knit/i.test(appearance) ? 'coarse wool' : /хлоп|cotton/i.test(appearance) ? 'soft cotton' : 'natural fabric',
    pattern_anchor: /цветоч|floral/i.test(appearance) ? 'floral print' : /полос|stripe/i.test(appearance) ? 'striped' : /клет|plaid|check/i.test(appearance) ? 'plaid checkered' : 'solid color',
    sleeve_style_anchor: /коротк.*рукав|short.?sleeve/i.test(appearance) ? 'short sleeves' : 'long sleeves',
  };

  const isMale = _isMale;
  const autoBiology = {
    age: (appearance.match(/(\d{1,3})\s*(лет|год|years?|yo\b)/i) || [])[1] || 'adult',
    height_build: appearance.split('.').find(s => /рост|высок|низк|худ|полн|строй|крупн|tall|short|slim|large|massive/i.test(s))?.trim() || 'average build',
    skin_tokens: extractTokens(['морщины', 'кожа', 'загар', 'бледн', 'веснушки', 'wrinkles', 'skin', 'freckles', 'tan', 'pale']),
    skin_color_tokens: extractTokens(['смугл', 'бледн', 'загорел', 'фарфор', 'olive', 'pale', 'tanned', 'porcelain', 'dark skin', 'fair']),
    wrinkle_map_tokens: extractTokens(['морщин', 'складк', 'гусин', 'wrinkle', 'crow', 'furrow', 'crease', 'lines']),
    eye_tokens: extractTokens(['глаза', 'взгляд', 'eyes', 'gaze']),
    hair_tokens: extractTokens(['волосы', 'причёска', 'стрижка', 'борода', 'усы', 'лысин', 'hair', 'beard', 'mustache', 'bald']),
    facial_hair_tokens: isMale ? extractTokens(['борода', 'усы', 'щетин', 'бакенбард', 'beard', 'mustache', 'stubble', 'goatee']) : ['none'],
    nose_tokens: extractTokens(['нос', 'nose']),
    mouth_tokens: extractTokens(['губы', 'рот', 'зубы', 'улыбк', 'lips', 'mouth', 'teeth', 'smile']),
    ear_tokens: extractTokens(['уш', 'серьг', 'ear', 'earring', 'lobe']),
    neck_tokens: extractTokens(['шея', 'кадык', 'neck', 'throat', 'adam']),
    body_shape_tokens: extractTokens(['плеч', 'груд', 'живот', 'торс', 'бёдр', 'shoulder', 'chest', 'belly', 'torso', 'hip']),
    hands_tokens: extractTokens(['руки', 'пальцы', 'кольц', 'браслет', 'hands', 'fingers', 'ring', 'bracelet']),
    scar_mark_tokens: extractTokens(['шрам', 'родинк', 'тату', 'ожог', 'пирсинг', 'scar', 'birthmark', 'tattoo', 'mole', 'piercing']),
    posture_tokens: extractTokens(['осанк', 'поза', 'сутул', 'прям', 'posture', 'stance']),
    gait_tokens: extractTokens(['походк', 'шагает', 'хромает', 'ковыляет', 'walk', 'shuffle', 'limp', 'stride']),
    facial_expression_default: compat === 'chaotic' ? 'alert suspicious squint' : compat === 'conflict' ? 'stern disapproving frown' : compat === 'calm' ? 'calm knowing half-smile' : compat === 'meme' ? 'perpetually amused smirk' : 'neutral resting expression',
    voice_texture_tokens: isMale ? [speech?.includes('бас') ? 'deep bass voice' : 'age-weathered male voice'] : [speech?.includes('тонк') ? 'thin high-pitched voice' : 'age-weathered female voice'],
    jaw_tokens: extractTokens(['челюст', 'jaw', 'jawline']),
    cheekbone_tokens: extractTokens(['скул', 'cheekbone']),
    forehead_tokens: extractTokens(['лоб', 'forehead']),
    eyebrow_tokens: extractTokens(['бров', 'eyebrow', 'brow']),
    lip_texture_tokens: extractTokens(['губ', 'lip']),
    chin_tokens: extractTokens(['подбород', 'chin']),
    nasolabial_tokens: ['age-appropriate nasolabial folds'],
    undereye_tokens: ['natural under-eye area'],
    shoulder_tokens: extractTokens(['плеч', 'shoulder']),
    teeth_tokens: extractTokens(['зуб', 'teeth', 'tooth']),
    eyelash_tokens: isMale ? ['sparse natural lashes'] : ['medium natural lashes'],
  };

  const autoModifiers = {
    hook_style: 'natural attention grab',
    laugh_style: 'natural laugh',
    anger_expression: compat === 'chaotic' ? 'explosive — arms flailing, voice rising' : compat === 'conflict' ? 'cold fury — jaw clenched, eyes drilling' : 'tight lips, narrowed eyes',
    thinking_expression: compat === 'chaotic' ? 'rapid eye darting, finger tapping' : compat === 'calm' ? 'serene pause, eyes unfocused' : 'slight squint, looks up',
    surprise_expression: compat === 'chaotic' ? 'explosive gasp, hands fly up' : compat === 'calm' ? 'slight eyebrow raise' : 'eyes widen, mouth opens slightly',
    eye_contact_style: compat === 'chaotic' ? 'darting between camera and opponent' : compat === 'conflict' ? 'locked unblinking stare' : 'steady natural alternation',
    sad_expression: compat === 'chaotic' ? 'chin drops, eyes go distant and watery' : compat === 'calm' ? 'face goes still and blank, jaw tightens' : 'lower lip trembles slightly, eyes glisten',
    contempt_expression: compat === 'chaotic' ? 'upper lip curls asymmetrically' : compat === 'conflict' ? 'chin lifts slightly, eyes narrow to slits' : 'one corner of mouth rises, nostril flares',
    disgust_expression: compat === 'chaotic' ? 'whole face contracts toward center' : compat === 'calm' ? 'nose wrinkles sharply, upper lip retracts' : 'head pulls back, chin tucks in',
    joy_expression: compat === 'chaotic' ? 'head throws back with open-mouth laugh' : compat === 'calm' ? 'eyes nearly shut from genuine smile, cheeks bunch up' : 'whole face crinkles, crow feet deepen, mouth wide open',
    blink_pattern: compat === 'chaotic' ? 'rapid nervous blinking when agitated 2-3 per second' : compat === 'calm' ? 'slow deliberate blinks every 4-6 seconds' : 'normal blink pattern every 3-4 seconds',
    fidget_style: compat === 'chaotic' ? 'taps fingers on nearest surface' : compat === 'conflict' ? 'shifts weight foot to foot' : 'minimal fidgeting',
  };

  const newChar = {
    id,
    numeric_id: getNextCharNumericId(),
    name_ru: nameRu,
    name_en: nameRu,
    group: group === 'custom' ? 'пользовательские' : group,
    compatibility: compat,
    role_default: role,
    vibe_archetype: 'custom',
    appearance_ru: appearance,
    speech_style_ru: speech || 'Обычная разговорная речь',
    behavior_ru: speech || '',
    speech_pace: 'normal',
    swear_level: 0,
    signature_words_ru: [],
    world_aesthetic: 'custom',
    prompt_tokens: { character_en },
    identity_anchors: autoAnchors,
    biology_override: autoBiology,
    modifiers: autoModifiers,
    _custom: true,
  };

  // Server-side promo validation — prevents DevTools bypass
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const token = localStorage.getItem('ferixdi_jwt');
    if (token) {
      const resp = await fetch(`${apiBase}/api/custom/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type: 'character', data: newChar }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showCCStatus(err.error || '🔑 Ошибка валидации промо-кода на сервере', 'text-red-400');
        log('ERR', 'CHAR-CREATE', `Сервер отклонил: ${err.error || resp.status}`);
        return;
      }
    }
  } catch (e) {
    // Server unavailable — allow local creation as fallback
    log('WARN', 'CHAR-CREATE', `Сервер недоступен, создаём локально: ${e.message}`);
  }

  // Add to characters array
  state.characters.push(newChar);

  // Save custom chars to localStorage
  const customChars = JSON.parse(localStorage.getItem('ferixdi_custom_chars') || '[]');
  customChars.push(newChar);
  localStorage.setItem('ferixdi_custom_chars', JSON.stringify(customChars));

  // Re-render
  renderCharacters();
  populateSeriesSelects();

  // Clear form
  document.getElementById('cc-name-ru').value = '';
  document.getElementById('cc-appearance').value = '';
  document.getElementById('cc-speech').value = '';
  document.getElementById('cc-photo-preview')?.classList.add('hidden');

  showCCStatus(`✓ Персонаж #${newChar.numeric_id} "${nameRu}" создан!`, 'text-emerald-400');
  showNotification(`✨ Персонаж #${newChar.numeric_id} "${nameRu}" добавлен в каталог`, 'success');
  log('OK', 'CHAR-CREATE', `Создан: #${newChar.numeric_id} ${nameRu} (${id})`);
}

function showCCStatus(text, cls) {
  const el = document.getElementById('cc-status');
  if (!el) return;
  el.classList.remove('hidden');
  el.className = `text-xs text-center ${cls}`;
  el.textContent = text;
}

let _customCharsLoaded = false;
function loadCustomCharacters() {
  try {
    const customChars = JSON.parse(localStorage.getItem('ferixdi_custom_chars') || '[]');
    if (customChars.length && state.characters) {
      const existingIds = new Set(state.characters.map(c => c.id));
      let added = 0;
      customChars.forEach(c => { if (!existingIds.has(c.id)) { if (!c.numeric_id) c.numeric_id = getNextCharNumericId(); state.characters.push(c); added++; } });
      if (added > 0) log('OK', 'CHAR-CUSTOM', `Загружено ${added} пользовательских персонажей`);
    }
    _customCharsLoaded = true;
  } catch (e) { log('ERR', 'CHAR-CUSTOM', e.message); }
}

// ─── CUSTOM LOCATION CONSTRUCTOR ─────────
function initLocConstructor() {
  document.getElementById('btn-toggle-loc-constructor')?.addEventListener('click', () => {
    const panel = document.getElementById('loc-constructor');
    if (panel) panel.classList.toggle('hidden');
  });

  document.getElementById('btn-create-location')?.addEventListener('click', createCustomLocation);
}

async function createCustomLocation() {
  if (!isPromoValid()) { showLCStatus('🔑 Нужен промо-код', 'text-amber-400'); return; }

  const nameRu = document.getElementById('lc-name-ru')?.value.trim();
  const group = document.getElementById('lc-group')?.value;
  const scene = document.getElementById('lc-scene')?.value.trim();
  const lighting = document.getElementById('lc-lighting')?.value.trim();
  const mood = document.getElementById('lc-mood')?.value.trim();

  if (!nameRu) { showLCStatus('Введите название', 'text-red-400'); return; }
  if (!scene) { showLCStatus('Опишите сцену', 'text-red-400'); return; }

  showLCStatus('Проверяю доступ...', 'text-cyan-400 animate-pulse');

  const id = 'custom_' + nameRu.toLowerCase().replace(/[^а-яa-z0-9]/gi, '_').replace(/_+/g, '_') + '_' + Date.now().toString(36);

  const newLoc = {
    id,
    numeric_id: getNextLocNumericId(),
    name_ru: nameRu,
    tagline_ru: scene.slice(0, 80),
    group: group === 'custom' ? 'пользовательские' : group,
    tags: [group, 'custom'],
    scene_en: scene,
    audio_hints: '',
    lighting: lighting || 'natural ambient light',
    mood: mood || 'neutral',
    category_hints: [],
    _custom: true,
  };

  // Server-side promo validation — prevents DevTools bypass
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const token = localStorage.getItem('ferixdi_jwt');
    if (token) {
      const resp = await fetch(`${apiBase}/api/custom/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type: 'location', data: newLoc }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showLCStatus(err.error || '🔑 Ошибка валидации промо-кода на сервере', 'text-red-400');
        log('ERR', 'LOC-CREATE', `Сервер отклонил: ${err.error || resp.status}`);
        return;
      }
    }
  } catch (e) {
    log('WARN', 'LOC-CREATE', `Сервер недоступен, создаём локально: ${e.message}`);
  }

  state.locations.push(newLoc);

  // Save to localStorage
  const customLocs = JSON.parse(localStorage.getItem('ferixdi_custom_locs') || '[]');
  customLocs.push(newLoc);
  localStorage.setItem('ferixdi_custom_locs', JSON.stringify(customLocs));

  // Re-render
  renderLocations?.();
  renderLocationsBrowse?.();

  // Clear
  document.getElementById('lc-name-ru').value = '';
  document.getElementById('lc-scene').value = '';
  document.getElementById('lc-lighting').value = '';
  document.getElementById('lc-mood').value = '';

  showLCStatus(`✓ Локация #${newLoc.numeric_id} "${nameRu}" создана!`, 'text-emerald-400');
  showNotification(`📍 Локация #${newLoc.numeric_id} "${nameRu}" добавлена`, 'success');
  log('OK', 'LOC-CREATE', `Создана: #${newLoc.numeric_id} ${nameRu} (${id})`);
}

function showLCStatus(text, cls) {
  const el = document.getElementById('lc-status');
  if (!el) return;
  el.classList.remove('hidden');
  el.className = `text-xs text-center ${cls}`;
  el.textContent = text;
}

function loadCustomLocations() {
  try {
    const customLocs = JSON.parse(localStorage.getItem('ferixdi_custom_locs') || '[]');
    if (customLocs.length && state.locations) {
      const existingIds = new Set(state.locations.map(l => l.id));
      let added = 0;
      customLocs.forEach(l => { if (!existingIds.has(l.id)) { if (!l.numeric_id) l.numeric_id = getNextLocNumericId(); state.locations.push(l); added++; } });
      if (added > 0) log('OK', 'LOC-CUSTOM', `Загружено ${added} пользовательских локаций`);
    }
  } catch (e) { log('ERR', 'LOC-CUSTOM', e.message); }
}

// ─── EDUCATION / COURSE ──────────────────
let _courseData = null;

async function loadCourse() {
  try {
    const res = await fetch('./data/course.json');
    if (!res.ok) throw new Error('course.json not found');
    _courseData = await res.json();
    renderEducation();
  } catch (e) {
    log('ERR', 'COURSE', e.message);
  }
}

function renderEducation() {
  if (!_courseData) return;
  const d = _courseData;

  const titleEl = document.getElementById('edu-title');
  const subtitleEl = document.getElementById('edu-subtitle');
  const pricingEl = document.getElementById('edu-pricing');
  const proofLink = document.getElementById('edu-proof-link');
  const proofLabel = document.getElementById('edu-proof-label');
  const benefitsEl = document.getElementById('edu-benefits');
  const defsEl = document.getElementById('edu-definitions');
  const lessonsGrid = document.getElementById('edu-lessons-grid');
  const lessonCount = document.getElementById('edu-lesson-count');
  const accessBadge = document.getElementById('edu-access-badge');

  if (titleEl) titleEl.textContent = d.title;
  if (subtitleEl) subtitleEl.textContent = d.subtitle;
  if (pricingEl) pricingEl.textContent = d.pricing_note;
  if (proofLink && d.proof_link) {
    proofLink.href = d.proof_link.url;
    if (proofLabel) proofLabel.textContent = d.proof_link.label;
  }

  // Core principle
  const corePrincipleWrap = document.getElementById('edu-core-principle-wrap');
  const corePrincipleEl = document.getElementById('edu-core-principle');
  if (corePrincipleWrap && corePrincipleEl && d.core_principle) {
    corePrincipleEl.textContent = d.core_principle;
    corePrincipleWrap.classList.remove('hidden');
  }

  // Timeline
  const timelineWrap = document.getElementById('edu-timeline-wrap');
  const timelineEl = document.getElementById('edu-timeline');
  if (timelineWrap && timelineEl && d.timeline && d.timeline.length) {
    timelineEl.innerHTML = d.timeline.map(t =>
      `<div class="bg-sky-500/5 rounded-lg p-3 border border-sky-500/10"><div class="text-[11px] text-sky-300 font-semibold mb-1">${t.week}</div><div class="text-[11px] text-gray-400 leading-relaxed">${t.description}</div></div>`
    ).join('');
    timelineWrap.classList.remove('hidden');
  }

  // Mindset rules
  const mindsetWrap = document.getElementById('edu-mindset-wrap');
  const mindsetEl = document.getElementById('edu-mindset');
  if (mindsetWrap && mindsetEl && d.mindset_rules && d.mindset_rules.length) {
    mindsetEl.innerHTML = d.mindset_rules.map((r, i) =>
      `<div class="flex items-start gap-2 text-[11px] text-gray-300 leading-relaxed"><span class="text-orange-400 font-bold flex-shrink-0">${i + 1}.</span><span>${r}</span></div>`
    ).join('');
    mindsetWrap.classList.remove('hidden');
  }

  // Study plan (7 days)
  const studyPlanWrap = document.getElementById('edu-study-plan-wrap');
  const studyPlanEl = document.getElementById('edu-study-plan');
  if (studyPlanWrap && studyPlanEl && d.study_plan && d.study_plan.length) {
    studyPlanEl.innerHTML = d.study_plan.map(s =>
      `<div class="bg-indigo-500/5 rounded-lg p-3 border border-indigo-500/10"><div class="flex items-center justify-between mb-1"><span class="text-[11px] text-indigo-300 font-semibold">${s.day}</span><span class="text-[9px] text-gray-500">${s.time}</span></div><div class="text-[10px] text-gray-500 mb-0.5">${s.lessons}</div><div class="text-[11px] text-gray-400 leading-relaxed">${s.focus}</div></div>`
    ).join('');
    studyPlanWrap.classList.remove('hidden');
  }

  // Publishing Guide (time by GEO, frequency, algorithm, missed days)
  const pubGuideWrap = document.getElementById('edu-pub-guide-wrap');
  if (pubGuideWrap && d.publishing_guide) {
    const pg = d.publishing_guide;
    const subtitleEl = document.getElementById('edu-pub-guide-subtitle');
    if (subtitleEl) subtitleEl.textContent = pg.subtitle || '';

    const scheduleEl = document.getElementById('edu-pub-schedule');
    if (scheduleEl && pg.schedule_by_geo) {
      scheduleEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">🌍 Лучшее время по регионам:</div>' +
        pg.schedule_by_geo.map(g =>
          `<div class="bg-amber-500/5 rounded-lg p-3 border border-amber-500/10"><div class="flex items-center justify-between mb-1"><span class="text-[11px] text-amber-200 font-semibold">${g.geo}</span><span class="text-[10px] text-amber-400 font-bold">Пик: ${g.peak}</span></div><div class="text-[10px] text-gray-400">Окна: ${g.best_times.join(' · ')}</div><div class="text-[10px] text-gray-500 mt-1">${g.why}</div></div>`
        ).join('');
    }

    const freqEl = document.getElementById('edu-pub-frequency');
    if (freqEl && pg.frequency_rules) {
      freqEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">📊 Частота публикаций:</div>' +
        pg.frequency_rules.map(f => {
          const color = f.level.includes('Оптимум') ? 'emerald' : f.level.includes('Агрессивный') ? 'red' : 'gray';
          return `<div class="bg-${color}-500/5 rounded-lg p-3 border border-${color}-500/10"><div class="flex items-center justify-between mb-1"><span class="text-[11px] text-${color}-300 font-semibold">${f.level}</span><span class="text-[10px] text-${color}-400 font-bold">${f.posts_per_week} / нед</span></div><div class="text-[10px] text-gray-400">${f.posts_per_day}</div><div class="text-[10px] text-gray-500 mt-1">${f.note}</div></div>`;
        }).join('');
    }

    const algoEl = document.getElementById('edu-pub-algorithm');
    if (algoEl && pg.algorithm_rules) {
      algoEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">🤖 Как работает алгоритм:</div>' +
        pg.algorithm_rules.map(r =>
          `<div class="flex items-start gap-2 text-[10px] text-gray-400 leading-relaxed"><span class="text-amber-400 mt-0.5 flex-shrink-0">→</span><span>${r}</span></div>`
        ).join('');
    }

    const missedEl = document.getElementById('edu-pub-missed');
    if (missedEl && pg.missed_day_protocol) {
      missedEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">⚠️ Пропустил день — что делать:</div>' +
        pg.missed_day_protocol.map(m => {
          const severity = m.scenario.includes('2+') ? 'red' : m.scenario.includes('неделю') ? 'orange' : m.scenario.includes('2–3') ? 'yellow' : 'emerald';
          return `<div class="bg-${severity}-500/5 rounded-lg p-3 border border-${severity}-500/10"><div class="text-[11px] text-${severity}-300 font-semibold mb-1">${m.scenario}</div><div class="text-[10px] text-gray-400 mb-1"><span class="text-${severity}-400/70">Влияние:</span> ${m.impact}</div><div class="text-[10px] text-gray-300"><span class="font-medium">Действие:</span> ${m.action}</div></div>`;
        }).join('');
    }

    pubGuideWrap.classList.remove('hidden');
  }

  // Profile Guide (Instagram profile for conversion)
  const profileGuideWrap = document.getElementById('edu-profile-guide-wrap');
  if (profileGuideWrap && d.profile_guide) {
    const pg = d.profile_guide;
    const subtEl = document.getElementById('edu-profile-guide-subtitle');
    if (subtEl) subtEl.textContent = pg.subtitle || '';

    const elementsEl = document.getElementById('edu-profile-elements');
    if (elementsEl && pg.elements) {
      elementsEl.innerHTML = pg.elements.map(e =>
        `<div class="bg-purple-500/5 rounded-lg p-3 border border-purple-500/10 space-y-2">
          <div class="text-[11px] text-purple-200 font-semibold flex items-center gap-1.5"><span>${e.icon}</span> ${e.element}</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg p-2 bg-red-500/5 border border-red-500/10"><div class="text-[9px] text-red-400 font-semibold mb-1">✗ Плохо</div><div class="text-[10px] text-gray-500 leading-relaxed">${e.bad}</div></div>
            <div class="rounded-lg p-2 bg-emerald-500/5 border border-emerald-500/10"><div class="text-[9px] text-emerald-400 font-semibold mb-1">✓ Хорошо</div><div class="text-[10px] text-gray-400 leading-relaxed">${e.good}</div></div>
          </div>
          <div class="text-[10px] text-gray-500 leading-relaxed"><span class="text-purple-400/70 font-medium">Почему:</span> ${e.why}</div>
          <div class="text-[10px] text-purple-300/80 leading-relaxed bg-purple-500/5 rounded p-2"><span class="font-medium">💡 Совет:</span> ${e.tip}</div>
        </div>`
      ).join('');
    }

    const checklistEl = document.getElementById('edu-profile-checklist');
    if (checklistEl && pg.checklist) {
      checklistEl.innerHTML = '<div class="text-[10px] text-purple-400 font-semibold mb-1">✅ Чеклист оформления профиля:</div>' +
        pg.checklist.map(item =>
          `<div class="flex items-start gap-2 text-[10px] text-gray-400 leading-relaxed"><span class="text-purple-400 mt-0.5 flex-shrink-0">☐</span><span>${item}</span></div>`
        ).join('');
    }

    profileGuideWrap.classList.remove('hidden');
  }

  // Character Guide (step-by-step + niche examples)
  const charGuideWrap = document.getElementById('edu-char-guide-wrap');
  const charGuideSteps = document.getElementById('edu-char-guide-steps');
  const charGuideNiches = document.getElementById('edu-char-guide-niches');
  if (charGuideWrap && charGuideSteps && d.character_guide) {
    const cg = d.character_guide;
    charGuideSteps.innerHTML = (cg.steps || []).map(s =>
      `<div class="bg-pink-500/5 rounded-lg p-3 border border-pink-500/10"><div class="flex items-start gap-2"><span class="flex items-center justify-center w-6 h-6 rounded-full bg-pink-500/20 text-pink-300 text-[11px] font-bold flex-shrink-0">${s.num}</span><div><div class="text-[11px] text-pink-200 font-semibold mb-1">${s.title}</div><div class="text-[10px] text-gray-400 leading-relaxed">${s.text}</div></div></div></div>`
    ).join('');
    if (charGuideNiches && cg.niche_examples && cg.niche_examples.length) {
      charGuideNiches.innerHTML = '<div class="text-[10px] text-pink-400 font-semibold mb-1.5">Примеры по нишам:</div>' +
        cg.niche_examples.map(n =>
          `<div class="bg-pink-500/5 rounded-lg p-2.5 border border-pink-500/10"><div class="text-[11px] text-pink-200 font-medium">${n.niche}</div><div class="text-[10px] text-gray-400 mt-0.5"><span class="text-pink-300/80">Формула:</span> ${n.formula}</div><div class="text-[10px] text-gray-500 mt-0.5">${n.why}</div></div>`
        ).join('');
    }
    charGuideWrap.classList.remove('hidden');
  }

  // Stop-list (searchable, collapsed by default)
  const stopListWrap = document.getElementById('edu-stop-list-wrap');
  const stopListEl = document.getElementById('edu-stop-list');
  if (stopListWrap && stopListEl && d.stop_list && d.stop_list.length) {
    let stopExpanded = false;
    const STOP_PREVIEW = 10;
    const renderStopList = (filter) => {
      const f = (filter || '').toLowerCase();
      const all = d.stop_list.filter(s => !f || s.mistake.toLowerCase().includes(f) || s.why_kills.toLowerCase().includes(f) || s.fix.toLowerCase().includes(f));
      const show = (f || stopExpanded) ? all : all.slice(0, STOP_PREVIEW);
      stopListEl.innerHTML = show.map(s =>
        `<div class="bg-red-500/5 rounded-lg p-3 border border-red-500/10"><div class="text-[11px] text-red-300 font-semibold mb-1">${d.stop_list.indexOf(s) + 1}. ${s.mistake}</div><div class="text-[10px] text-gray-500 mb-1"><span class="text-red-400/70">Убивает:</span> ${s.why_kills}</div><div class="text-[10px] text-emerald-400/80"><span class="font-medium">Решение:</span> ${s.fix}</div></div>`
      ).join('') || '<div class="text-[10px] text-gray-600 text-center py-2">Ничего не найдено</div>';
      const toggleEl = document.getElementById('edu-stop-list-toggle');
      if (toggleEl) {
        if (!f && all.length > STOP_PREVIEW && !stopExpanded) {
          toggleEl.classList.remove('hidden');
          toggleEl.innerHTML = `<button class="text-[10px] text-red-400/70 hover:text-red-400 transition-colors">Показать все ${all.length} ошибок ↓</button>`;
          toggleEl.querySelector('button').addEventListener('click', () => { stopExpanded = true; renderStopList(document.getElementById('edu-stop-search')?.value); });
        } else {
          toggleEl.classList.add('hidden');
        }
      }
    };
    renderStopList('');
    const stopSearch = document.getElementById('edu-stop-search');
    if (stopSearch) stopSearch.addEventListener('input', () => { stopExpanded = false; renderStopList(stopSearch.value); });
    stopListWrap.classList.remove('hidden');
  }

  // FAQ (searchable, collapsible)
  const faqWrap = document.getElementById('edu-faq-wrap');
  const faqEl = document.getElementById('edu-faq');
  const faqCount = document.getElementById('edu-faq-count');
  if (faqWrap && faqEl && d.faq && d.faq.length) {
    if (faqCount) faqCount.textContent = d.faq.length;
    const renderFaq = (filter) => {
      const f = (filter || '').toLowerCase();
      const items = d.faq.filter(item => !f || item.q.toLowerCase().includes(f) || item.a.toLowerCase().includes(f));
      faqEl.innerHTML = items.map((item, i) =>
        `<details class="bg-blue-500/5 rounded-lg border border-blue-500/10 group"><summary class="flex items-start gap-2 p-3 cursor-pointer select-none"><span class="text-blue-400 mt-0.5 flex-shrink-0 text-[10px]">▸</span><span class="text-[11px] text-blue-200 font-medium leading-snug group-open:text-blue-300">${item.q}</span></summary><div class="px-3 pb-3 pt-0 pl-7 text-[11px] text-gray-400 leading-relaxed">${item.a}</div></details>`
      ).join('') || '<div class="text-[10px] text-gray-600 text-center py-2">Ничего не найдено</div>';
    };
    renderFaq('');
    const faqSearch = document.getElementById('edu-faq-search');
    if (faqSearch) faqSearch.addEventListener('input', () => renderFaq(faqSearch.value));
    faqWrap.classList.remove('hidden');
  }

  // Checklists (tabbed with localStorage progress)
  const checkWrap = document.getElementById('edu-checklists-wrap');
  const checkTabs = document.getElementById('edu-checklist-tabs');
  const checkContent = document.getElementById('edu-checklist-content');
  if (checkWrap && checkTabs && checkContent && d.checklists) {
    const checkLabels = {
      character_selection: '🎭 Подбор персонажей',
      before_generation: '🎯 До генерации',
      before_publish: '📤 До публикации',
      after_publish: '📊 После публикации',
      if_low_views: '📉 Мало просмотров',
      if_series_took_off: '🚀 Серия полетела'
    };
    const checkKeys = Object.keys(d.checklists);
    let activeCheck = checkKeys[0];
    const savedChecks = JSON.parse(localStorage.getItem('ferixdi_checklists') || '{}');

    const renderCheckTabs = () => {
      checkTabs.innerHTML = checkKeys.map(k => {
        const total = (d.checklists[k] || []).length;
        const done = Object.values(savedChecks[k] || {}).filter(Boolean).length;
        const progress = total > 0 ? ` ${done}/${total}` : '';
        const allDone = done === total && total > 0;
        return `<button class="text-[10px] px-2.5 py-1 rounded-lg border transition-all ${k === activeCheck ? 'bg-teal-500/20 text-teal-300 border-teal-500/40 font-semibold' : allDone ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-black/20 text-gray-500 border-gray-700/30 hover:text-gray-400'}" data-ck="${k}">${checkLabels[k] || k}<span class="ml-1 opacity-60">${progress}</span></button>`;
      }).join('');
      checkTabs.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => { activeCheck = btn.dataset.ck; renderCheckTabs(); });
      });
      const items = d.checklists[activeCheck] || [];
      const ckState = savedChecks[activeCheck] || {};
      checkContent.innerHTML = items.map((item, i) => {
        const checked = ckState[i] ? 'checked' : '';
        return `<label class="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-teal-500/5 transition-colors ${ckState[i] ? 'opacity-60' : ''}"><input type="checkbox" ${checked} data-ck="${activeCheck}" data-ci="${i}" class="mt-0.5 accent-teal-500 flex-shrink-0"><span class="text-[11px] text-gray-300 leading-relaxed ${ckState[i] ? 'line-through text-gray-500' : ''}">${item}</span></label>`;
      }).join('');
      checkContent.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          const ck = cb.dataset.ck, ci = cb.dataset.ci;
          if (!savedChecks[ck]) savedChecks[ck] = {};
          savedChecks[ck][ci] = cb.checked;
          localStorage.setItem('ferixdi_checklists', JSON.stringify(savedChecks));
          renderCheckTabs();
          updateEduProgress();
        });
      });
    };
    renderCheckTabs();
    checkWrap.classList.remove('hidden');
  }

  if (benefitsEl && d.benefits) {
    benefitsEl.innerHTML = d.benefits.map(b =>
      `<div class="flex items-start gap-2 text-[11px] text-gray-300 leading-relaxed"><span class="text-emerald-400 mt-0.5 flex-shrink-0">→</span><span>${b}</span></div>`
    ).join('');
  }

  if (defsEl && d.definitions) {
    defsEl.innerHTML = d.definitions.map(df =>
      `<div class="text-[11px]"><span class="text-violet-300 font-semibold">${df.term}:</span> <span class="text-gray-400">${df.value}</span></div>`
    ).join('');
  }

  const hasAccess = isPromoValid();
  if (accessBadge) {
    if (hasAccess) {
      accessBadge.className = 'text-[10px] px-2 py-1 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      accessBadge.textContent = '✓ Доступ открыт';
    } else {
      accessBadge.className = 'text-[10px] px-2 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30';
      accessBadge.textContent = '🔒 Нужен промо-код';
    }
  }

  if (lessonCount) lessonCount.textContent = `${d.lessons.length} уроков`;

  const readLessons = JSON.parse(localStorage.getItem('ferixdi_lessons_read') || '[]');

  if (lessonsGrid && d.lessons) {
    lessonsGrid.innerHTML = d.lessons.map(lesson => {
      const isRead = readLessons.includes(lesson.id);
      const lockIcon = hasAccess ? (isRead ? '✅' : '📖') : '🔒';
      const cardBorder = hasAccess ? (isRead ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-amber-500/30 hover:border-amber-500/50') : 'border-gray-700/50 hover:border-amber-500/30';
      const cardBg = hasAccess ? (isRead ? 'bg-emerald-500/3 hover:bg-emerald-500/8' : 'hover:bg-amber-500/5') : 'hover:bg-gray-800/30';
      const numStyle = isRead ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/25';
      return `<div class="edu-lesson-card glass-panel p-4 border-l-2 ${cardBorder} cursor-pointer transition-all ${cardBg}" data-lesson-id="${lesson.id}">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full ${numStyle} text-sm font-bold border">${lesson.num}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs">${lockIcon}</span>
              <span class="text-[10px] text-gray-500">⏱ ${lesson.duration}</span>
              ${isRead ? '<span class="text-[9px] text-emerald-500/70 font-medium">прочитано</span>' : ''}
            </div>
            <div class="text-sm font-medium ${isRead ? 'text-gray-400' : 'text-gray-200'} leading-snug">${lesson.title}</div>
            <div class="mt-2 space-y-1">
              ${lesson.bullets.map(b => `<div class="text-[10px] text-gray-500 flex items-start gap-1.5"><span class="text-amber-500/60 mt-px">•</span><span>${b}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    lessonsGrid.querySelectorAll('.edu-lesson-card').forEach(card => {
      card.addEventListener('click', () => {
        const lessonId = card.dataset.lessonId;
        openLesson(lessonId);
      });
    });
  }

  // Show buy CTA or welcome based on promo status
  const buyCta = document.getElementById('edu-buy-cta');
  const welcomeEl = document.getElementById('edu-welcome');
  if (buyCta) buyCta.classList.toggle('hidden', hasAccess);
  if (welcomeEl) welcomeEl.classList.toggle('hidden', !hasAccess);
}

function _markLessonRead(lessonId) {
  const read = JSON.parse(localStorage.getItem('ferixdi_lessons_read') || '[]');
  if (!read.includes(lessonId)) {
    read.push(lessonId);
    localStorage.setItem('ferixdi_lessons_read', JSON.stringify(read));
  }
  updateEduProgress();
}

function updateEduProgress() {
  if (!_courseData) return;
  const readLessons = JSON.parse(localStorage.getItem('ferixdi_lessons_read') || '[]');
  const savedChecks = JSON.parse(localStorage.getItem('ferixdi_checklists') || '{}');
  const totalChecks = Object.values(_courseData.checklists || {}).reduce((a, v) => a + v.length, 0);
  const doneChecks = Object.values(savedChecks).reduce((a, v) => a + Object.values(v).filter(Boolean).length, 0);
  const lessonsRead = readLessons.length;
  const totalLessons = _courseData.lessons.length;
  const pct = Math.round(((lessonsRead / totalLessons) * 70 + (doneChecks / Math.max(totalChecks, 1)) * 30));

  const dashboard = document.getElementById('edu-progress-dashboard');
  if (dashboard && isPromoValid()) dashboard.classList.remove('hidden');
  const bar = document.getElementById('edu-progress-bar');
  if (bar) bar.style.width = pct + '%';
  const pctEl = document.getElementById('edu-progress-pct');
  if (pctEl) pctEl.textContent = pct + '%';
  const statL = document.getElementById('edu-stat-lessons');
  if (statL) statL.textContent = `${lessonsRead}/${totalLessons}`;
  const statC = document.getElementById('edu-stat-checklists');
  if (statC) statC.textContent = `${doneChecks}/${totalChecks}`;
  const statF = document.getElementById('edu-stat-faq');
  if (statF) statF.textContent = String(_courseData.faq?.length || 0);
}

function openLesson(lessonId) {
  if (!_courseData) return;
  const lessons = _courseData.lessons;
  const idx = lessons.findIndex(l => l.id === lessonId);
  if (idx < 0) return;
  const lesson = lessons[idx];

  if (!isPromoValid()) {
    showNotification('🔒 Доступ к урокам откроется после активации промо-кода', 'warning');
    setTimeout(() => {
      navigateTo('settings');
      setTimeout(() => {
        const promoInput = document.getElementById('promo-input');
        if (promoInput) {
          promoInput.focus();
          promoInput.closest('.glass-panel')?.classList.add('ring-2', 'ring-amber-500/50');
          setTimeout(() => promoInput.closest('.glass-panel')?.classList.remove('ring-2', 'ring-amber-500/50'), 3000);
        }
      }, 400);
    }, 800);
    return;
  }

  // Mark as read
  _markLessonRead(lessonId);

  const overlay = document.getElementById('lesson-modal-overlay');
  if (!overlay) return;

  document.getElementById('lesson-modal-num').textContent = lesson.num;
  document.getElementById('lesson-modal-duration').textContent = `⏱ ${lesson.duration}`;
  document.getElementById('lesson-modal-title').textContent = lesson.title;

  const contentEl = document.getElementById('lesson-modal-content');
  if (contentEl) {
    contentEl.innerHTML = lesson.content.map(p =>
      `<p class="text-[13px] text-gray-300 leading-relaxed">${p}</p>`
    ).join('');
  }

  const metricsWrap = document.getElementById('lesson-modal-metrics-wrap');
  const metricsEl = document.getElementById('lesson-modal-metrics');
  if (lesson.metrics && lesson.metrics.length > 0) {
    metricsWrap?.classList.remove('hidden');
    if (metricsEl) {
      metricsEl.innerHTML = lesson.metrics.map(m =>
        `<div class="flex items-start gap-2 text-[11px] text-gray-300"><span class="text-cyan-400 mt-0.5 flex-shrink-0">📈</span><span>${m}</span></div>`
      ).join('');
    }
  } else {
    metricsWrap?.classList.add('hidden');
  }

  const deliverablesEl = document.getElementById('lesson-modal-deliverables');
  if (deliverablesEl && lesson.deliverables) {
    deliverablesEl.innerHTML = lesson.deliverables.map(d =>
      `<div class="flex items-start gap-2 text-[11px] text-gray-300"><span class="text-emerald-400 mt-0.5 flex-shrink-0">☑</span><span>${d}</span></div>`
    ).join('');
  }

  // Prev/Next buttons
  const prevBtn = document.getElementById('lesson-modal-prev');
  const nextBtn = document.getElementById('lesson-modal-next');
  if (prevBtn) {
    prevBtn.disabled = idx === 0;
    prevBtn.onclick = idx > 0 ? () => openLesson(lessons[idx - 1].id) : null;
  }
  if (nextBtn) {
    nextBtn.disabled = idx === lessons.length - 1;
    nextBtn.onclick = idx < lessons.length - 1 ? () => openLesson(lessons[idx + 1].id) : null;
  }

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // Scroll modal to top when switching lessons
  overlay.querySelector('.overflow-y-auto')?.scrollTo(0, 0);
  sfx.clickSoft();
}

function closeLessonModal() {
  const overlay = document.getElementById('lesson-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
  // Re-render only lessons grid (not full renderCourse which resets search fields)
  if (_courseData) {
    const grid = document.getElementById('edu-lessons-grid');
    if (grid) {
      const readLessons = JSON.parse(localStorage.getItem('ferixdi_lessons_read') || '[]');
      const hasAccess = isPromoValid();
      grid.innerHTML = _courseData.lessons.map(lesson => {
        const isRead = readLessons.includes(lesson.id);
        const lockIcon = hasAccess ? (isRead ? '\u2705' : '\ud83d\udcd6') : '\ud83d\udd12';
        const cardBorder = hasAccess ? (isRead ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-amber-500/30 hover:border-amber-500/50') : 'border-gray-700/50 hover:border-amber-500/30';
        const cardBg = hasAccess ? (isRead ? 'bg-emerald-500/3 hover:bg-emerald-500/8' : 'hover:bg-amber-500/5') : 'hover:bg-gray-800/30';
        const numStyle = isRead ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/25';
        return `<div class="edu-lesson-card glass-panel p-4 border-l-2 ${cardBorder} cursor-pointer transition-all ${cardBg}" data-lesson-id="${lesson.id}"><div class="flex items-start gap-3"><div class="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full ${numStyle} text-sm font-bold border">${lesson.num}</div><div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1"><span class="text-xs">${lockIcon}</span><span class="text-[10px] text-gray-500">\u23f1 ${lesson.duration}</span>${isRead ? '<span class="text-[9px] text-emerald-500/70 font-medium">\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043e</span>' : ''}</div><div class="text-sm font-medium ${isRead ? 'text-gray-400' : 'text-gray-200'} leading-snug">${lesson.title}</div><div class="mt-2 space-y-1">${lesson.bullets.map(b => `<div class="text-[10px] text-gray-500 flex items-start gap-1.5"><span class="text-amber-500/60 mt-px">\u2022</span><span>${b}</span></div>`).join('')}</div></div></div></div>`;
      }).join('');
      grid.querySelectorAll('.edu-lesson-card').forEach(card => {
        card.addEventListener('click', () => openLesson(card.dataset.lessonId));
      });
    }
    updateEduProgress();
  }
}

function initEducation() {
  loadCourse();

  document.getElementById('lesson-modal-close')?.addEventListener('click', closeLessonModal);

  document.getElementById('lesson-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'lesson-modal-overlay') closeLessonModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLessonModal();
    // Arrow keys for lesson navigation in modal
    const overlay = document.getElementById('lesson-modal-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') document.getElementById('lesson-modal-prev')?.click();
      if (e.key === 'ArrowRight') document.getElementById('lesson-modal-next')?.click();
    }
  });

  // Quick-nav scroll buttons
  document.querySelectorAll('.edu-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.scroll;
      const el = document.getElementById(targetId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Update progress on init
  setTimeout(() => updateEduProgress(), 500);
}

// ─── INIT ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const _init = [
    ['loadSavedState',loadSavedState],['initApp',initApp],['initPromoCode',initPromoCode],
    ['initNavigation',initNavigation],['initProgressTracker',initProgressTracker],
    ['initGenerationMode',initGenerationMode],['initModeSwitcher',initModeSwitcher],
    ['initToggles',initToggles],['initVideoUpload',initVideoUpload],
    ['initVideoUrlFetch',initVideoUrlFetch],['initProductUpload',initProductUpload],
    ['initPostGenPhoto',initPostGenPhoto],['initGenerate',initGenerate],
    ['initDialogueEditor',initDialogueEditor],['initSettings',initSettings],
    ['initCharFilters',initCharFilters],['initRandomPair',initRandomPair],
    ['initCopyButtons',initCopyButtons],['initHeaderSettings',initHeaderSettings],
    ['initLogPanel',initLogPanel],['initLocationPicker',initLocationPicker],
    ['initTrends',initTrends],['initConsultation',initConsultation],
    ['initJokesLibrary',initJokesLibrary],['initSeries',initSeries],
    ['initSurprise',initSurprise],['initABTesting',initABTesting],
    ['initTranslate',initTranslate],['initCharConstructor',initCharConstructor],
    ['initLocConstructor',initLocConstructor],['initEducation',initEducation],
    ['initMatrixRain',initMatrixRain],
  ];
  for (const [n,f] of _init) { try { f(); } catch(e) { console.error(`[FERIXDI] ${n}:`,e); } }
  loadLocations().then(() => {
    try { loadCustomLocations(); renderLocations(); renderLocationsBrowse(); initLocationsBrowse(); }
    catch(e) { console.error('[FERIXDI] locations:', e); }
  });
  // Initial readiness check after all components loaded
  setTimeout(() => {
    updateReadiness();
    loadCustomCharacters();
    renderCharacters();
    populateSeriesSelects();
    renderSeriesList();
    // Handle hash deep-links (e.g. #education from landing)
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const sectionMap = { education: 'education', academy: 'education', consult: 'consult', settings: 'settings' };
      const target = sectionMap[hash];
      if (target && typeof navigateTo === 'function') navigateTo(target);
    }
  }, 300);

  // ─── GLOBAL SOUND: catch ALL buttons/interactive elements ───
  // Plays soft click for any button/link that doesn't already have a specific sound
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .btn-neon, .btn-primary, .mode-btn, .nav-item, .char-card, .loc-card, .generation-mode-card, select, .mode-sub-btn, a[href]');
    if (!el) return;
    // Skip elements that already trigger specific sounds (nav, select, toggle, generate)
    if (el.closest('.nav-item')) return; // nav() already called in navigateTo
    if (el.closest('.char-card') && (el.classList.contains('select-a') || el.classList.contains('select-b'))) return;
    if (el.closest('.toggle-track')) return;
    if (el.id === 'btn-generate') return;
    if (el.closest('.generation-mode-card')) return;
    // Play soft click for everything else
    sfx.clickSoft();
  }, true); // capture phase so it fires before specific handlers

  // Sound toggle from localStorage
  const soundPref = localStorage.getItem('ferixdi_sounds');
  if (soundPref === 'off') sfx.setEnabled(false);
});
