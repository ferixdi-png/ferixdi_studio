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
  locations: [],
  selectedA: null,
  selectedB: null,
  selectedLocation: null, // location id or null (auto)
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
      updateWelcomeBanner();

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
  loadCharacters();
  updateCacheStats();
  navigateTo('characters');
  initWelcomeBanner();

  // Auto-authenticate if promo is already saved
  if (isPromoValid()) {
    autoAuth();
  }
}

// ─── LOCATIONS ───────────────────────────────
async function loadLocations() {
  try {
    const resp = await fetch(new URL('./data/locations.json', import.meta.url));
    state.locations = await resp.json();
    log('OK', 'ДАННЫЕ', `Загружено ${state.locations.length} локаций`);
    populateLocationFilters();
    renderLocations();
  } catch (e) {
    log('ERR', 'ДАННЫЕ', `Ошибка загрузки локаций: ${e.message}`);
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

  grid.innerHTML = `
    <div class="loc-card ${!state.selectedLocation ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="">
      <div class="text-sm">🎲</div>
      <div class="text-[11px] font-medium text-violet-300">Авто</div>
      <div class="text-[10px] text-gray-500">AI подберёт</div>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '🌟' : l.mood === 'sterile tension' ? '🩵' : l.mood === 'organic chaos' ? '🌿' : l.mood === 'dramatic intimacy' ? '🕯️' : '🎨';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug">${l.tagline_ru}</div>
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
  info.innerHTML = `<div class="flex items-center gap-2 flex-wrap"><span class="text-violet-400 font-medium">📍 ${loc.name_ru}</span>${tags}</div><div class="text-[10px] text-gray-500 mt-1">${loc.tagline_ru}</div>`;
}

function initLocationPicker() {
  document.getElementById('loc-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.loc-card');
    if (!card) return;
    const id = card.dataset.locId;
    state.selectedLocation = id || null;
    renderLocations(document.getElementById('loc-group-filter')?.value || '');
    renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
    log('INFO', 'ЛОКАЦИЯ', state.selectedLocation ? `Выбрана: ${state.locations.find(l => l.id === state.selectedLocation)?.name_ru}` : 'Авто-выбор');
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
    const compatRu = { meme: 'мем', conflict: 'конфликт', chaotic: 'хаос', calm: 'спокойный', balanced: 'баланс' };
    const paceRu = { fast: 'быстрая', normal: 'средняя', slow: 'медленная' };

    // Detail sections
    const anchors = c.identity_anchors || {};

    return `
    <div class="char-card ${selCls}" data-id="${c.id}">
      <div class="flex items-center justify-between mb-1">
        <span class="text-sm font-bold text-white">${c.name_ru}</span>
        <span class="tag text-[10px] ${tagCls}">${compatRu[c.compatibility] || c.compatibility}</span>
      </div>
      ${c.tagline_ru ? `<div class="text-[11px] text-violet-300/90 mb-1.5 leading-snug">${c.tagline_ru}</div>` : ''}
      <div class="text-[10px] text-gray-500 mb-2 flex flex-wrap gap-x-2">
        <span>🎭 ${c.group}</span>
        <span>⚡ ${paceRu[c.speech_pace] || c.speech_pace}</span>
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
  // notify user to use video mode instead (no auto-fetch since video URL input is removed)
  document.getElementById('idea-input')?.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = e.target.value.trim();
      if (text.includes('tiktok.com/') || text.includes('instagram.com/')) {
        log('INFO', 'РЕЖИМ', 'Обнаружена ссылка на видео — переключи в режим «🎥 По видео» и загрузи файл');
        // Switch to video mode UI
        document.querySelectorAll('#section-remix .mode-btn').forEach(b => b.classList.remove('active'));
        const videoBtn = document.querySelector('#section-remix .mode-btn[data-mode="video"]');
        if (videoBtn) videoBtn.classList.add('active');
        state.inputMode = 'video';
        document.getElementById('mode-idea')?.classList.add('hidden');
        document.getElementById('mode-script')?.classList.add('hidden');
        document.getElementById('mode-video')?.classList.remove('hidden');
        // Keep URL in scene-hint for context
        const sceneHint = document.getElementById('scene-hint');
        if (sceneHint && !sceneHint.value) sceneHint.value = `Ремейк видео: ${text}`;
        e.target.value = '';
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

    // Show meta
    const meta = document.getElementById('video-meta');
    if (meta) {
      meta.classList.remove('hidden');
      meta.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-emerald-400">✓</span>
          <span>📁 ${escapeHtml(file.name)}</span>
        </div>
        <div>⏱ ${duration}s · ${(file.size / 1024 / 1024).toFixed(1)} MB</div>
      `;
    }

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

    // Show remake badge
    document.getElementById('video-remake-badge')?.classList.remove('hidden');

    // Auto-switch to video mode
    state.inputMode = 'video';

    log('OK', 'ВИДЕО', `🎬 Загружено: ${file.name} (${state.videoMeta.duration}с) — готово к анализу`);
  };

  video.onerror = () => {
    URL.revokeObjectURL(url);
    log('ERR', 'ВИДЕО', 'Не удалось прочитать видеофайл');
  };

  video.src = url;
}

// ─── VIDEO URL FETCH (removed — now using external download services) ───
function initVideoUrlFetch() {
  // No-op: TikTok/Instagram downloads handled via external links
  // (tikvideo.app / saveclip.app) — user downloads MP4, then uploads here
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

  // Build pillar summaries (short) — all in Russian
  const pillars = [
    { icon: '💡', name: 'Свет', val: `${lm.mood} · ${lm.sources || '1 источник'}`, detail: lm.style?.slice(0, 60) + '...' },
    { icon: '📷', name: 'Оптика', val: cin.optics?.focal_length || '24-28мм', detail: `${cin.optics?.aperture || 'f/1.9-2.2'} · сенсор телефона` },
    { icon: '📱', name: 'Камера', val: 'Ручное селфи', detail: 'микро-дрожание 0.8-2пкс' },
    { icon: '🫁', name: 'Микродвижения', val: `Моргание 3-5с · Дыхание 3-4с`, detail: 'Л/П независимые' },
    { icon: '👄', name: 'Стабильность лица', val: 'Рот 100% виден', detail: `Поворот ≤25° · Автофокус на лицо` },
    { icon: '👁', name: 'Взгляд', val: '4 сегмента по таймингу', detail: `Хук: прямо в камеру · Саккады: 0.5-1°` },
    { icon: '🖼', name: 'Чистота кадра', val: `макс. ${cin.frame_cleanliness?.detail_budget || '7'} элементов`, detail: `60-70% персонажи · 9:16` },
    { icon: '🧶', name: 'Текстуры', val: 'шерсть > джинса > кожа', detail: 'поры, морщины, текстура кожи' },
    { icon: '🎨', name: 'Цвет/кожа', val: 'БЕЗ оранжевого, БЕЗ серого', detail: `ББ: зафиксирован · 5 зон кожи` },
    { icon: '�', name: 'Звук', val: 'Микрофон телефона 35-60см', detail: `Фон помещения -20/-30дБ · звуки рта` },
    { icon: '🎣', name: 'Хук', val: 'ЭКСТРЕМАЛЬНАЯ эмоция кадр 0', detail: `Энергия: ≥80% пик · взгляд в камеру` },
    { icon: '🎬', name: 'Монтаж', val: 'Холодный старт с середины', detail: `80→90→60→95→100→70% · Луп: авто` },
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
            <div class="text-xs font-semibold text-cyan-400 tracking-wide">КОНТРАКТ ПРОИЗВОДСТВА</div>
            <div class="text-[10px] text-gray-500">Параметры системы перед генерацией</div>
          </div>
        </div>
        <div class="text-[10px] text-gray-600 font-mono">v2.0</div>
      </div>

      <!-- Scene overview -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Персонажи</div>
          <div class="text-[11px] text-cyan-300">${charA.name_ru || 'A'} <span class="text-gray-600">×</span> ${charB.name_ru || 'B'}</div>
          <div class="text-[10px] text-gray-500 mt-0.5">${charA.vibe_archetype || '—'} × ${charB.vibe_archetype || '—'}</div>
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
          <div class="text-[9px] text-gray-500 uppercase tracking-wider">12 пилларов производства · Смартфон-реализм</div>
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

  // Populate dialogue editor
  populateDialogueEditor(result);

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
  const dialogueA = lineA?.text_ru || ctx.dialogueA || '—';
  const dialogueB = lineB?.text_ru || ctx.dialogueB || '—';
  const dialogueA2 = lineA2?.text_ru || '';
  const killerWord = result.blueprint_json?.killer_word || ctx.killerWord || '';
  const cat = result.log?.category || ctx.category || {};
  const est = result.duration_estimate || {};
  const engage = result.log?.engagement || {};

  if (dA) dA.textContent = `«${dialogueA}»`;
  if (dB) dB.textContent = `«${dialogueB}»${dialogueA2 ? ` → A: «${dialogueA2}»` : ''}`;
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

  const viralTitle = engage.viral_title || '—';
  const shareBait = engage.share_bait || '—';
  const pinComment = engage.pin_comment || '—';
  const firstComment = engage.first_comment || '—';
  const hashtags = engage.hashtags || [];
  const seriesTag = engage.series_tag || '';

  // Build copy-friendly hashtag string
  const hashtagStr = hashtags.join(' ');

  el.innerHTML = `
    <!-- Viral Title -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='✓ Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      <div class="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-2">🔥 Вирусный заголовок</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(viralTitle)}</div>
      <div class="text-[9px] text-gray-600 mt-2">Вставь как заголовок Reels — цепляет в ленте</div>
    </div>

    <!-- Share Bait (video description for forwarding) -->
    <div class="glass-panel p-4 relative border-l-2 border-orange-400/40">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='✓ Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      <div class="text-[10px] text-orange-400 font-semibold uppercase tracking-wider mb-2">📝 Описание видео · для пересылки</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(shareBait)}</div>
      <div class="text-[9px] text-gray-600 mt-2">Скинь другу с этой фразой — байт на пересылку в контексте видео</div>
    </div>

    <!-- Hashtags -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='✓ Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      <div class="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider mb-2"># Хештеги · ${hashtags.length} шт</div>
      <div class="copy-target text-xs text-gray-300 leading-relaxed bg-black/30 rounded-lg p-3 select-all">${escapeHtml(hashtagStr)}</div>
      ${seriesTag ? `<div class="text-[9px] text-violet-400 mt-2">Серия: ${escapeHtml(seriesTag)}</div>` : ''}
      <div class="text-[9px] text-gray-600 mt-1">Вставь в первый комментарий или в описание</div>
    </div>

    <!-- Pin Comment (bait for shares) -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='✓ Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      <div class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-2">📌 Закреплённый комментарий</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(pinComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">Закрепи — провоцирует пересылки и сохранения</div>
    </div>

    <!-- First Comment -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='✓ Скопировано';setTimeout(()=>this.textContent='Копировать',1500)">Копировать</button>
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">💬 Первый комментарий</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(firstComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">Напиши сразу после публикации — запускает обсуждение</div>
    </div>

    <!-- Share bait tip -->
    <div class="bg-gradient-to-r from-violet-500/8 to-cyan-500/8 rounded-lg p-4 border border-violet-500/15">
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">🚀 Порядок публикации в Instagram</div>
      <div class="text-xs text-gray-300 leading-relaxed space-y-1.5">
        <div>1. <span class="text-amber-300 font-medium">Заголовок</span> → вставь в описание Reels (caption). Только заголовок, без хештегов!</div>
        <div>2. <span class="text-gray-200 font-medium">Опубликуй</span> Reels</div>
        <div>3. <span class="text-cyan-300 font-medium">Хештеги</span> → напиши ПЕРВЫЙ комментарий с хештегами (IG не режет охват)</div>
        <div>4. <span class="text-emerald-300 font-medium">Закреп</span> → напиши второй коммент и закрепи его (провоцирует «отправь подруге»)</div>
        <div>5. <span class="text-violet-300 font-medium">Первый коммент</span> → напиши третий коммент через 1-2 мин (запускает обсуждение)</div>
      </div>
      <div class="text-[9px] text-gray-500 mt-3">Серия: ${charA.name_ru || 'A'} × ${charB.name_ru || 'B'} — используй один серийный тег на все видео этой пары</div>
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

  // Attach actual video file if available — Gemini will WATCH the original video
  if (state._videoFileBase64) {
    payload.video_file = state._videoFileBase64;
    payload.video_file_mime = state._videoFileMime || 'video/mp4';
  }
  // Attach video cover as fallback if video file too large or unavailable
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
      showGenStatus('⚠️ Сначала загрузи видео-файл в режиме «🎥 По видео»', 'text-orange-400');
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
    btn.textContent = '⏳ Строю промпт...';
    showGenStatus('⚙️ Строю Production Contract...', 'text-cyan-400');

    // Reset previous results and preflight status
    document.getElementById('gen-results')?.classList.add('hidden');
    const pfEl = document.getElementById('gen-preflight');
    if (pfEl) { pfEl.classList.add('hidden'); pfEl.innerHTML = ''; }

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
      thread_memory: getThreadMemory(),
      video_meta: state.videoMeta,
      product_info: state.productInfo,
      options: state.options,
      seed: Date.now().toString(),
      characters: state.characters,
      locations: state.locations,
      selected_location_id: state.selectedLocation,
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

    // Step 1.5: Show pre-flight parameter breakdown
    btn.textContent = '⏳ Подготовка...';
    showGenStatus('📊 Параметры готовы, отправляю в AI...', 'text-cyan-400');
    renderPreflight(localResult);

    // Step 2: If API mode — send context to Gemini for creative refinement
    const isApiMode = state.settingsMode === 'api' && localStorage.getItem('ferixdi_api_url');

    if (isApiMode && localResult._apiContext) {
      btn.textContent = '⏳ AI генерирует...';
      showGenStatus('🧠 FERIXDI AI генерирует контент... (15-30с)', 'text-violet-400');
      log('INFO', 'AI', 'Генерирую уникальный контент...');

      try {
        const geminiData = await callGeminiAPI(localResult._apiContext);
        if (geminiData) {
          const merged = mergeGeminiResult(localResult, geminiData);
          log('OK', 'AI', 'Творческий контент сгенерирован');
          updatePreflightStatus('✅ Готово · FERIXDI AI сгенерировал уникальный контент', 'bg-emerald-500/8 text-emerald-400 border border-emerald-500/15');
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
      updatePreflightStatus('📋 Демо-режим · Для полной генерации введи промо-код в настройках', 'bg-gray-500/8 text-gray-400 border border-gray-500/15');
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
    vp.dialogue.final_A_ru = newA;
    vp.dialogue.final_B_ru = newB;
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

  // Re-render Veo prompt if dialogue changed (replace old dialogue lines)
  if (state.lastResult.veo_prompt) {
    let veo = state.lastResult.veo_prompt;
    // Replace A speaks line
    veo = veo.replace(/(A speaks in Russian to the camera: ")[^"]*(")/, `$1${newA.replace(/\s*\|\s*/g, '... ')}$2`);
    // Replace B responds line
    veo = veo.replace(/(B responds in Russian: ")[^"]*(")/, `$1${newB.replace(/\s*\|\s*/g, '... ')}$2`);
    state.lastResult.veo_prompt = veo;
    const veoEl = document.getElementById('veo-prompt-text');
    if (veoEl) veoEl.textContent = veo;
  }

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

  const overA = estA.duration > 3.2;
  const overB = estB.duration > 3.5;
  const risk = total > 6.7 || overA || overB ? 'high' : total > 5.8 ? 'medium' : 'low';

  document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 10 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}с / 3.2с · ${wordsA} слов${overA ? ' — НЕ ВЛЕЗЕТ!' : wordsA > 10 ? ' — много' : ''}</span>`;
  document.getElementById('editor-est-b').innerHTML = `<span class="${overB ? 'text-red-400' : wordsB > 12 ? 'text-orange-400' : 'text-gray-500'}">${estB.duration}с / 3.5с · ${wordsB} слов${overB ? ' — НЕ ВЛЕЗЕТ!' : wordsB > 12 ? ' — много' : ''}</span>`;

  const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
  const riskLabel = risk === 'high' ? '🚨 ПРЕВЫШЕНИЕ' : risk === 'medium' ? '⚠️ БЛИЗКО' : '✓ ОК';
  document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Речь: ${total.toFixed(2)}с / 6.7с ${riskLabel}</span>`;

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

// ─── TRENDS (Ideas section) ─────────────
function _escForAttr(str) {
  return escapeHtml(String(str || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\r/g, '');
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
  if (!btn || !st || !res) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="animate-pulse">⏳</span> AI ищет тренды через Google...';
  st.classList.remove('hidden');
  st.innerHTML = '<span class="text-gray-400 animate-pulse">Gemini ищет что обсуждают в России прямо сейчас + анализирует новости...</span>';
  res.classList.add('hidden');

  try {
    const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const jwt = localStorage.getItem('ferixdi_jwt');
    const resp = await fetch(`${url}/api/trends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    });
    const data = await resp.json();

    if (!resp.ok) {
      st.innerHTML = `<span class="text-red-400">❌ ${escapeHtml(data.error || 'Ошибка')}</span>`;
      btn.disabled = false;
      btn.innerHTML = '<span>🔍</span> Попробовать ещё раз';
      return;
    }

    const groundedBadge = data.grounded
      ? '<span class="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded ml-2">🌐 Google Search</span>'
      : '<span class="text-[9px] bg-gray-500/15 text-gray-500 px-1.5 py-0.5 rounded ml-2">📚 AI-анализ</span>';

    st.innerHTML = `<span class="text-emerald-400">✓ ${data.trends.length} идей · ${escapeHtml(data.weekday || '')}, ${escapeHtml(data.date)}</span>${groundedBadge}`;
    res.classList.remove('hidden');

    const catMeta = {
      hot:    { icon: '🔥', label: 'Горячее сегодня', color: 'red',    border: 'border-red-500/30',    bg: 'bg-red-500/8',    badge: 'bg-red-500/20 text-red-400' },
      pain:   { icon: '💢', label: 'Вечная боль',     color: 'amber',  border: 'border-amber-500/30',  bg: 'bg-amber-500/8',  badge: 'bg-amber-500/20 text-amber-400' },
      format: { icon: '🎬', label: 'Вирусный формат', color: 'violet', border: 'border-violet-500/30', bg: 'bg-violet-500/8', badge: 'bg-violet-500/20 text-violet-400' },
    };

    // Group by category
    let lastCat = '';
    let html = '';
    data.trends.forEach((t, i) => {
      const cm = catMeta[t.category] || catMeta.pain;
      // Category header
      if (t.category !== lastCat) {
        lastCat = t.category;
        html += `<div class="flex items-center gap-2 mt-${i === 0 ? '0' : '4'} mb-2">
          <span class="text-sm">${cm.icon}</span>
          <span class="text-xs font-bold text-gray-300 uppercase tracking-wider">${cm.label}</span>
          <div class="flex-1 h-px bg-gray-800"></div>
        </div>`;
      }

      const viralBars = '█'.repeat(Math.min(t.virality, 10));
      const viralEmpty = '░'.repeat(Math.max(0, 10 - t.virality));
      const viralColor = t.virality >= 8 ? 'text-red-400' : t.virality >= 6 ? 'text-amber-400' : 'text-gray-500';

      html += `
      <div class="rounded-lg p-4 space-y-2.5 border ${cm.border} hover:border-opacity-60 transition-colors ${cm.bg}">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2 min-w-0">
            <span class="flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 ${cm.badge}">${i + 1}</span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-white leading-tight">${escapeHtml(t.topic)}</div>
              ${t.viral_format ? `<span class="text-[9px] text-violet-400/80 mt-0.5 inline-block">📐 ${escapeHtml(t.viral_format)}</span>` : ''}
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="text-[9px] font-mono ${viralColor}">${viralBars}${viralEmpty}</div>
            <div class="text-[9px] text-gray-500">${t.virality}/10</div>
          </div>
        </div>

        <div class="text-[11px] text-gray-400">${escapeHtml(t.why_trending)}</div>

        <!-- Ready dialogue -->
        <div class="bg-black/40 rounded-lg p-3 space-y-1.5">
          <div class="text-[10px] text-gray-500 font-medium mb-1">💬 Готовый диалог:</div>
          <div class="text-[11px]"><span class="text-cyan-400 font-medium">A:</span> <span class="text-gray-200">«${escapeHtml(t.dialogue_A)}»</span></div>
          <div class="text-[11px]"><span class="text-violet-400 font-medium">B:</span> <span class="text-gray-200">«${escapeHtml(t.dialogue_B)}»</span></div>
          ${t.killer_word ? `<div class="text-[10px] text-red-400/70 mt-1">💥 killer: «${escapeHtml(t.killer_word)}»</div>` : ''}
        </div>

        ${t.share_hook ? `<div class="text-[10px] text-gray-500 italic">� ${escapeHtml(t.share_hook)}</div>` : ''}

        <!-- Action buttons -->
        <div class="flex gap-2 flex-wrap pt-1">
          <button class="text-[10px] px-3 py-1.5 rounded-md bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors font-medium" onclick="document.getElementById('idea-input').value='${_escForAttr(t.topic + ': ' + (t.comedy_angle || ''))}';document.querySelector('.nav-item[data-section=generate]')?.click();this.textContent='✓ Вставлено!'">💡 Как идею</button>
          <button class="text-[10px] px-3 py-1.5 rounded-md bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors font-medium" onclick="var a=document.getElementById('script-a'),b=document.getElementById('script-b');if(a)a.value='${_escForAttr(t.dialogue_A)}';if(b)b.value='${_escForAttr(t.dialogue_B)}';document.querySelectorAll('#section-remix .mode-btn').forEach(b=>b.classList.remove('active'));var mb=document.querySelector('#section-remix .mode-btn[data-mode=script]');if(mb)mb.classList.add('active');document.getElementById('mode-idea')?.classList.add('hidden');document.getElementById('mode-script')?.classList.remove('hidden');document.getElementById('mode-video')?.classList.add('hidden');document.querySelector('.nav-item[data-section=generate]')?.click();this.textContent='✓ Вставлено!'">� Вставить диалог</button>
        </div>
      </div>`;
    });

    res.innerHTML = html;
    log('OK', 'ТРЕНДЫ', `Загружено ${data.trends.length} идей${data.grounded ? ' (Google Search)' : ''}`);
  } catch (e) {
    st.innerHTML = `<span class="text-red-400">❌ Ошибка сети: ${escapeHtml(e.message)}</span>`;
    log('ERR', 'ТРЕНДЫ', e.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<span>🔄</span> Обновить тренды';
}

function initTrends() {
  document.getElementById('btn-fetch-trends')?.addEventListener('click', fetchTrends);
}

// ─── LOCATIONS BROWSE (standalone section) ───
function renderLocationsBrowse(filterGroup = '') {
  const grid = document.getElementById('loc-browse-grid');
  if (!grid) return;
  let locs = [...state.locations];
  if (filterGroup) locs = locs.filter(l => l.group === filterGroup);

  grid.innerHTML = `
    <div class="loc-card ${!state.selectedLocation ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="">
      <div class="text-sm">🎲</div>
      <div class="text-[11px] font-medium text-violet-300">Авто</div>
      <div class="text-[10px] text-gray-500">AI подберёт</div>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '🌟' : l.mood === 'sterile tension' ? '🩵' : l.mood === 'organic chaos' ? '🌿' : l.mood === 'dramatic intimacy' ? '🕯️' : '🎨';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug">${l.tagline_ru}</div>
      ${l.tags ? `<div class="flex gap-1 flex-wrap mt-1">${l.tags.slice(0, 3).map(t => `<span class="text-[8px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">${t}</span>`).join('')}</div>` : ''}
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
  initSettings();
  initCharFilters();
  initRandomPair();
  initCopyButtons();
  initHeaderSettings();
  initLogPanel();
  initLocationPicker();
  initTrends();
  loadLocations().then(() => {
    renderLocationsBrowse();
    initLocationsBrowse();
  });
  initMatrixRain();
});
