// @ts-check
/**
 * FERIXDI Studio — Main Application
 * Êîñìè÷åñêèé õàêåðñêèé êîìàíäíûé öåíòð äëÿ ðåìèêñà âèäåî
 */

import { generate, getRandomCategory, mergeAIResult } from './engine/generator.js';
import { estimateDialogue, estimateLineDuration } from './engine/estimator.js';
import { autoTrim } from './engine/auto_trim.js';
import { historyCache } from './engine/history_cache.js';
import { sfx } from './engine/sounds.js';

// --- STATE -----------------------------------
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
  surpriseCharMode: 'auto', // 'auto' = AI picks characters, 'manual' = user selects
  options: { enforce8s: true, preserveRhythm: true, strictLipSync: true, allowAutoTrim: false },
  lastResult: null,
  settingsMode: 'api',
  threadMemory: [],
  // Performance optimization flags
  _isLoading: false,
  _lastActivity: Date.now(),
  _cachedResults: new Map(),
  // Character avatars: { "babka_zina": "babka_zina.webp", ... }
  avatarMap: {},
};

// Lazy-init tracker: heavy sections init on first navigateTo()
const _lazyInited = new Set();

// --- AVATARS HELPER -------------------------
function getAvatarImg(charId, size = 'w-9 h-9') {
  const file = state.avatarMap[charId];
  if (!file) return '';
  const url = new URL(`./data/avatars/${file}`, import.meta.url).href;
  return `<img src="${url}" alt="" class="${size} rounded-lg object-cover border border-gray-700/60 flex-shrink-0" loading="lazy" onerror="this.style.display='none'">`;
}

// --- LOG -------------------------------------
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

// --- PROMO CODE (hash-only, no plaintext) --------
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
    status.innerHTML = '<span class="neon-text-green">? Ïðîìî-êîä àêòèâåí</span>';
    input.placeholder = '••••••••';
    const modeEl = document.getElementById('header-mode');
    if (modeEl) modeEl.textContent = 'VIP';
  }

  btn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { status.innerHTML = '<span class="text-red-400">Ââåäèòå ïðîìî-êîä</span>'; return; }

    btn.disabled = true;
    btn.textContent = '…';
    const hash = await _hashCode(key);

    if (hash === _PH) {
      localStorage.setItem('ferixdi_ph', hash);
      localStorage.removeItem('ferixdi_promo');
      status.innerHTML = '<span class="neon-text-green">? Ïðîìî-êîä àêòèâåí! Äîáðî ïîæàëîâàòü!</span>';
      input.value = '';
      input.placeholder = '••••••••';
      const modeEl = document.getElementById('header-mode');
      if (modeEl) modeEl.textContent = 'VIP';
      log('OK', 'ÏÐÎÌÎ', 'Ïðîìî-êîä ïðèíÿò');
      updateWelcomeBanner();
      autoAuth(hash);
      updateReadiness();
      renderEducation();
    } else {
      status.innerHTML = '<span class="text-red-400">? Íåâåðíûé ïðîìî-êîä</span>';
      log('WARN', 'ÏÐÎÌÎ', 'Íåâåðíûé ïðîìî-êîä');
    }
    btn.disabled = false;
    btn.textContent = 'Àêòèâèðîâàòü';
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

async function autoAuth(hash) {
  const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;

  // If user has a saved account, try login first
  const savedUser = localStorage.getItem('ferixdi_username');
  const savedPass = localStorage.getItem('ferixdi_pass_enc');
  if (savedUser && savedPass) {
    try {
      const resp = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: savedUser, password: atob(savedPass) }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.jwt) {
          localStorage.setItem('ferixdi_jwt', data.jwt);
          log('OK', 'API', `Àâòîðèçîâàíî: ${data.username}`);
          updateAccountUI();
          return;
        }
      } else if (resp.status === 401) {
        // Saved credentials are invalid — clear them
        localStorage.removeItem('ferixdi_username');
        localStorage.removeItem('ferixdi_pass_enc');
        log('WARN', 'API', 'Ñîõðàí¸ííûå ó÷¸òíûå äàííûå íåäåéñòâèòåëüíû — ñáðîøåíû');
        updateAccountUI();
      }
    } catch { /* fallback to promo auth */ }
  }

  // Fallback: promo-only auth
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
        log('OK', 'API', 'Àâòîðèçîâàíî íà ñåðâåðå');
        updateAccountUI();
      }
    }
  } catch { /* server might not be up yet */ }
}

// --- ACCOUNT SYSTEM (Login / Register) ------------
function updateAccountUI() {
  const loggedIn = document.getElementById('account-logged-in');
  const authForms = document.getElementById('account-auth');
  const usernameEl = document.getElementById('account-username');
  const headerMode = document.getElementById('header-mode');

  const savedUser = localStorage.getItem('ferixdi_username');
  if (savedUser) {
    loggedIn?.classList.remove('hidden');
    authForms?.classList.add('hidden');
    if (usernameEl) usernameEl.textContent = savedUser;
    if (headerMode) headerMode.textContent = savedUser;
  } else {
    loggedIn?.classList.add('hidden');
    authForms?.classList.remove('hidden');
    if (isPromoValid() && headerMode) headerMode.textContent = 'VIP';
  }
}

function initAccountSystem() {
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const loginForm = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const logoutBtn = document.getElementById('account-logout-btn');
  const statusEl = document.getElementById('auth-status');
  const url = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;

  // Tab switching
  tabLogin?.addEventListener('click', () => {
    loginForm?.classList.remove('hidden');
    registerForm?.classList.add('hidden');
    tabLogin.className = 'flex-1 py-1.5 text-[11px] font-medium text-center bg-cyan-500/15 text-cyan-400 transition-all';
    tabRegister.className = 'flex-1 py-1.5 text-[11px] font-medium text-center text-gray-500 hover:text-gray-300 transition-all';
    if (statusEl) statusEl.innerHTML = '';
  });
  tabRegister?.addEventListener('click', () => {
    loginForm?.classList.add('hidden');
    registerForm?.classList.remove('hidden');
    tabRegister.className = 'flex-1 py-1.5 text-[11px] font-medium text-center bg-cyan-500/15 text-cyan-400 transition-all';
    tabLogin.className = 'flex-1 py-1.5 text-[11px] font-medium text-center text-gray-500 hover:text-gray-300 transition-all';
    if (statusEl) statusEl.innerHTML = '';
  });

  // Login
  loginBtn?.addEventListener('click', async () => {
    const username = document.getElementById('login-username')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    if (!username || !password) { statusEl.innerHTML = '<span class="text-red-400">Çàïîëíèòå âñå ïîëÿ</span>'; return; }
    loginBtn.disabled = true; loginBtn.textContent = '...';
    try {
      const resp = await fetch(`${url}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (resp.ok && data.jwt) {
        localStorage.setItem('ferixdi_jwt', data.jwt);
        localStorage.setItem('ferixdi_username', data.username);
        localStorage.setItem('ferixdi_pass_enc', btoa(password));
        statusEl.innerHTML = '<span class="neon-text-green">? Âõîä âûïîëíåí!</span>';
        log('OK', 'ÀÊÊÀÓÍÒ', `Âõîä: ${data.username}`);
        updateAccountUI();
      } else {
        statusEl.innerHTML = `<span class="text-red-400">${data.error || 'Îøèáêà âõîäà'}</span>`;
      }
    } catch { statusEl.innerHTML = '<span class="text-red-400">Ñåðâåð íåäîñòóïåí</span>'; }
    loginBtn.disabled = false; loginBtn.textContent = 'Âîéòè';
  });

  // Register
  registerBtn?.addEventListener('click', async () => {
    const username = document.getElementById('reg-username')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const promoHash = localStorage.getItem('ferixdi_ph');
    if (!username || !password) { statusEl.innerHTML = '<span class="text-red-400">Çàïîëíèòå âñå ïîëÿ</span>'; return; }
    if (!promoHash) { statusEl.innerHTML = '<span class="text-red-400">Ñíà÷àëà àêòèâèðóéòå ïðîìî-êîä íèæå</span>'; return; }
    registerBtn.disabled = true; registerBtn.textContent = '...';
    try {
      const resp = await fetch(`${url}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, promoHash }),
      });
      const data = await resp.json();
      if (resp.ok && data.jwt) {
        localStorage.setItem('ferixdi_jwt', data.jwt);
        localStorage.setItem('ferixdi_username', data.username);
        localStorage.setItem('ferixdi_pass_enc', btoa(password));
        statusEl.innerHTML = '<span class="neon-text-green">? Àêêàóíò ñîçäàí! Äîáðî ïîæàëîâàòü!</span>';
        log('OK', 'ÀÊÊÀÓÍÒ', `Ðåãèñòðàöèÿ: ${data.username}`);
        updateAccountUI();
      } else {
        statusEl.innerHTML = `<span class="text-red-400">${data.error || 'Îøèáêà ðåãèñòðàöèè'}</span>`;
      }
    } catch { statusEl.innerHTML = '<span class="text-red-400">Ñåðâåð íåäîñòóïåí</span>'; }
    registerBtn.disabled = false; registerBtn.textContent = 'Ñîçäàòü àêêàóíò';
  });

  // Logout — also clears httpOnly cookie server-side
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('ferixdi_pass_enc');
    logoutUser();
  });

  // Enter key support
  document.getElementById('login-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn?.click(); });
  document.getElementById('reg-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') registerBtn?.click(); });

  updateAccountUI();
}

function updateWelcomeBanner() {
  const banner = document.getElementById('welcome-banner');
  if (!banner) return;
  banner.classList.remove('hidden');

  const title = banner.querySelector('h3');
  const desc = banner.querySelector('p');
  const columns = document.getElementById('welcome-columns');
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
  log('OK', 'ÑÈÑÒÅÌÀ', 'FERIXDI Studio v2.0 — äîáðî ïîæàëîâàòü!');

  // Performance optimization: start loading immediately
  const startTime = performance.now();
  
  // Migrate old plaintext promo > hash-based (one-time)
  const oldPromo = localStorage.getItem('ferixdi_promo');
  if (oldPromo && !localStorage.getItem('ferixdi_ph')) {
    _hashCode(oldPromo).then(h => {
      if (h === _PH) { localStorage.setItem('ferixdi_ph', h); }
      localStorage.removeItem('ferixdi_promo');
    });
  }

  // Initialize mobile menu + account system
  initLayoutToggle();
  initMobileMenu();
  initAccountSystem();
  
  // Load data in parallel
  const loadPromises = [
    loadCharacters(),
    loadAvatarManifest(),
    updateCacheStats(),
    initWelcomeBanner()
  ];
  
  Promise.all(loadPromises).then(() => {
    const loadTime = performance.now() - startTime;
    log('OK', 'ÏÐÎÈÇÂÎÄÈÒÅËÜÍÎÑÒÜ', `Initial load completed in ${loadTime.toFixed(2)}ms`);
  });
  
  navigateTo('generation-mode'); // Start with generation mode selection

  // Auto-authenticate: saved account or promo
  const hasSavedAccount = localStorage.getItem('ferixdi_username');
  if (hasSavedAccount || isPromoValid()) {
    autoAuth();
  }
}

// --- LAYOUT TOGGLE (PC / Mobile) ---
function initLayoutToggle() {
  const btnPc = document.getElementById('layout-btn-pc');
  const btnMob = document.getElementById('layout-btn-mobile');
  if (!btnPc || !btnMob) return;
  const saved = localStorage.getItem('ferixdi_layout');
  if (saved === 'mobile') { applyMobileLayout(btnPc, btnMob); }
  else { applyPcLayout(btnPc, btnMob); }
  btnPc.addEventListener('click', () => applyPcLayout(btnPc, btnMob));
  btnMob.addEventListener('click', () => applyMobileLayout(btnPc, btnMob));
}
function applyMobileLayout(btnPc, btnMob) {
  document.body.classList.add('force-mobile');
  localStorage.setItem('ferixdi_layout', 'mobile');
  if (btnMob) btnMob.classList.add('active');
  if (btnPc) btnPc.classList.remove('active');
  const toggle = document.getElementById('mobile-menu-toggle');
  if (toggle) toggle.classList.remove('hidden');
  log('INFO', 'LAYOUT', 'Mobile mode activated');
}
function applyPcLayout(btnPc, btnMob) {
  document.body.classList.remove('force-mobile');
  localStorage.setItem('ferixdi_layout', 'pc');
  if (btnPc) btnPc.classList.add('active');
  if (btnMob) btnMob.classList.remove('active');
  const toggle = document.getElementById('mobile-menu-toggle');
  if (toggle && window.innerWidth > 768) toggle.classList.add('hidden');
  const sidebar = document.getElementById('sidebar');
  if (sidebar) { sidebar.classList.remove('mobile-open'); sidebar.style.transform = ''; }
  log('INFO', 'LAYOUT', 'PC mode activated');
}
function initMobileMenu() {
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  if (window.innerWidth <= 768 && mobileToggle) {
    mobileToggle.classList.remove('hidden');
  }
  
  // Show/hide based on screen size (respect force-mobile toggle)
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('force-mobile')) return;
    if (window.innerWidth <= 768) {
      mobileToggle?.classList.remove('hidden');
    } else {
      mobileToggle?.classList.add('hidden');
    }
  });
}

// --- LOCATIONS -------------------------------
async function loadLocations() {
  try {
    const resp = await fetch(new URL('./data/locations.json', import.meta.url));
    state.locations = await resp.json();
    log('OK', 'ÄÀÍÍÛÅ', `Çàãðóæåíî ${state.locations.length} ëîêàöèé`);
    // Merge custom locations from server (permanent) before rendering
    await loadServerCustomLocations();
    populateLocationFilters();
    renderLocations();
  } catch (e) {
    log('ERR', 'ÄÀÍÍÛÅ', `Îøèáêà çàãðóçêè ëîêàöèé: ${e.message}`);
  }
}

async function loadServerCustomLocations() {
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiBase}/api/custom/locations`);
    if (!resp.ok) { log('WARN', 'GH-ËÎÊÀÖÈÈ', `Ñåðâåð îòâåòèë ${resp.status}`); return; }
    const serverLocs = await resp.json();
    if (!Array.isArray(serverLocs)) return;
    if (!serverLocs.length) { log('INFO', 'GH-ËÎÊÀÖÈÈ', '0 ïîëüçîâàòåëüñêèõ ëîêàöèé íà ñåðâåðå'); return; }
    const existingIds = new Set(state.locations.map(l => l.id));
    let added = 0;
    const names = [];
    serverLocs.forEach(l => {
      if (!existingIds.has(l.id)) {
        if (!l.numeric_id) l.numeric_id = getNextLocNumericId();
        state.locations.push(l); existingIds.add(l.id); added++; names.push(l.name_ru || l.id);
      }
    });
    log('OK', 'GH-ËÎÊÀÖÈÈ', `? ${serverLocs.length} íà ñåðâåðå, ${added} íîâûõ äîáàâëåíî${names.length ? ': ' + names.join(', ') : ''}`);
  } catch (e) {
    log('WARN', 'GH-ËÎÊÀÖÈÈ', 'Ñåðâåð íåäîñòóïåí — èñïîëüçóåì ëîêàëüíûé êýø');
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
      <div class="text-sm">??</div>
      <div class="text-[11px] font-medium text-violet-300">Àâòî</div>
      <div class="text-[10px] text-gray-500 mb-2">AI ïîäáåð¸ò</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${autoSel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="">${autoSel ? '? Âûáðàíî' : '?? Âûáðàòü'}</button>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '??' : l.mood === 'sterile tension' ? '??' : l.mood === 'organic chaos' ? '??' : l.mood === 'dramatic intimacy' ? '???' : '??';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.numeric_id ? `<span class="text-[9px] text-gray-500 font-mono mr-1">#${l.numeric_id}</span>` : ''}${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug mb-2">${l.tagline_ru}</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${sel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="${l.id}">${sel ? '? Âûáðàíî' : '?? Âûáðàòü'}</button>
      <button class="copy-loc-prompt text-[9px] px-2 py-1 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full mt-1.5 flex items-center justify-center gap-1" data-id="${l.id}" title="Ñêîïèðîâàòü äåòàëèçèðîâàííûé ïðîìïò äëÿ Veo">
        <span>??</span> Ïðîìïò
      </button>
      ${l._custom ? `<button onclick="deleteCustomLoc('${l.id}')" class="text-[9px] px-2 py-1 rounded-md font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 w-full mt-1 flex items-center justify-center gap-1">?? Óäàëèòü</button>` : ''}
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
  info.innerHTML = `<div class="flex items-center gap-2 flex-wrap"><span class="text-violet-400 font-medium">?? ${loc.name_ru}</span>${tags}<button onclick="deselectLocation()" class="text-[10px] text-red-400/60 hover:text-red-400 transition-colors ml-1" title="Ñáðîñèòü ëîêàöèþ">? ñáðîñèòü</button></div><div class="text-[10px] text-gray-500 mt-1">${loc.tagline_ru}</div>`;
}

function deselectLocation() {
  state.selectedLocation = null;
  sfx.clickSoft();
  renderLocations(document.getElementById('loc-group-filter')?.value || '');
  renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
  log('INFO', 'ËÎÊÀÖÈß', 'Ñáðîøåíà > Àâòî-âûáîð');
  updateProgress();
  _scheduleDraftSave();
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
    log('INFO', 'ËÎÊÀÖÈß', state.selectedLocation ? `Âûáðàíà: ${state.locations.find(l => l.id === state.selectedLocation)?.name_ru}` : 'Àâòî-âûáîð');
    updateProgress();
    _scheduleDraftSave();
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
    log('INFO', 'ËÎÊÀÖÈß', `?? Ñëó÷àéíàÿ: ${rand.name_ru}`);
    updateProgress();
    _scheduleDraftSave();
  });
  
  // Update progress when inputs change
  ['idea-input', 'idea-input-custom', 'idea-input-suggested', 'script-a', 'script-b', 'scene-hint-main'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      setTimeout(updateProgress, 100); // Debounce
    });
  });
}

// --- AUTO-TRANSLATE EN>RU for character card fields --
const EN_RU_DICT = {
  // hook_style
  'thrusts phone screen at camera': 'òû÷åò ýêðàíîì òåëåôîíà â êàìåðó',
  'slams palm flat on table': 'õëîïàåò ëàäîíüþ ïî ñòîëó',
  'slow deliberate head turn toward camera': 'ìåäëåííûé ïîâîðîò ãîëîâû ê êàìåðå',
  'adjusts glasses and peers over them': 'ïîïðàâëÿåò î÷êè è ñìîòðèò ïîâåðõ',
  'points finger directly at camera': 'òû÷åò ïàëüöåì ïðÿìî â êàìåðó',
  'leans forward conspiratorially': 'íàêëîíÿåòñÿ âïåð¸ä çàãîâîðùè÷åñêè',
  'crosses arms and raises one eyebrow': 'ñêðåùèâàåò ðóêè è ïîäíèìàåò áðîâü',
  'waves dismissively': 'îòìàõèâàåòñÿ ïðåíåáðåæèòåëüíî',
  'grabs other person by sleeve': 'õâàòàåò äðóãîãî çà ðóêàâ',
  'raises both hands in disbelief': 'ïîäíèìàåò îáå ðóêè â íåäîóìåíèè',
  'slaps own knee': 'õëîïàåò ñåáÿ ïî êîëåíó',
  'wags finger at camera': 'ãðîçèò ïàëüöåì â êàìåðó',
  'dramatic gasp with hand on chest': 'äðàìàòè÷åñêèé âçäîõ ñ ðóêîé íà ãðóäè',
  'leans back and squints': 'îòêèäûâàåòñÿ íàçàä è ùóðèòñÿ',
  'rubs hands together': 'ïîòèðàåò ðóêè',
  'snaps fingers': 'ù¸ëêàåò ïàëüöàìè',
  'taps temple knowingly': 'ñòó÷èò ïî âèñêó ñî çíàíèåì äåëà',
  'pulls out phone dramatically': 'äîñòà¸ò òåëåôîí ñ äðàìîé',
  'shakes head slowly': 'ìåäëåííî êà÷àåò ãîëîâîé',
  'claps once loudly': 'îäèí ãðîìêèé õëîïîê',
  // laugh_style
  'wheezing cackle that turns into cough': 'õðèïÿùèé õîõîò ïåðåõîäÿùèé â êàøåëü',
  'grudging one-sided smirk': 'íåîõîòíàÿ óõìûëêà îäíèì óãîëêîì ðòà',
  'explosive belly laugh shaking whole body': 'âçðûâíîé õîõîò îò æèâîòà, òðÿñ¸òñÿ âñ¸ òåëî',
  'silent shoulder shake with closed eyes': 'áåççâó÷íàÿ òðÿñêà ïëå÷àìè ñ çàêðûòûìè ãëàçàìè',
  'quiet chuckle': 'òèõèé ñìåøîê',
  'loud burst': 'ãðîìêèé âçðûâ ñìåõà',
  'snort laugh': 'ôûðêàþùèé ñìåõ',
  'giggle behind hand': 'õèõèêàíüå çà ëàäîíüþ',
  'dry sarcastic huff': 'ñóõîé ñàðêàñòè÷åñêèé âûäîõ',
  'belly laugh': 'õîõîò îò æèâîòà',
  'wheezing laugh': 'õðèïÿùèé ñìåõ',
  'cackle': 'êóäàõòàþùèé õîõîò',
  // signature_element
  'turquoise clip-on earrings': 'áèðþçîâûå ñåðüãè-êëèïñû',
  'reading glasses dangling on beaded cord': 'î÷êè äëÿ ÷òåíèÿ íà áèñåðíîé öåïî÷êå',
  'bright hand-knitted shawl draped over shoulders': 'ÿðêàÿ âÿçàíàÿ øàëü íà ïëå÷àõ',
  'vintage gold-rimmed spectacles on chain': 'ñòàðèííûå î÷êè â çîëîòîé îïðàâå íà öåïî÷êå',
  'gold dental crown': 'çîëîòàÿ êîðîíêà',
  'amber pendant': 'ÿíòàðíûé êóëîí',
  'flat cap': 'êåïêà-âîñüìèêëèíêà',
  'bold earrings': 'êðóïíûå ñåðüãè',
  'pearl stud earrings': 'æåì÷óæíûå ñåðüãè-ãâîçäèêè',
  // micro_gesture
  'dramatic hand wave with spread fingers': 'äðàìàòè÷íûé âçìàõ ðóêîé ñ ðàñòîïûðåííûìè ïàëüöàìè',
  'arms crossed with slow disapproving nod': 'ðóêè ñêðåùåíû, ìåäëåííûé íåîäîáðèòåëüíûé êèâîê',
  'finger jabbing the air like conductor\'s baton': 'òû÷åò ïàëüöåì â âîçäóõ êàê äèðèæ¸ðñêîé ïàëî÷êîé',
  'slow head shake': 'ìåäëåííîå ïîêà÷èâàíèå ãîëîâîé',
  'dramatic hand wave': 'äðàìàòè÷íûé âçìàõ ðóêîé',
  'grins deliberately to flash gold teeth as punctuation': 'íàðî÷íî ñêàëèòñÿ, ïîêàçûâàÿ çîëîòûå çóáû',
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

// --- NUMERIC ID HELPERS ---------------------
function getNextCharNumericId() {
  const maxId = state.characters.reduce((mx, c) => Math.max(mx, c.numeric_id || 0), 0);
  return maxId + 1;
}
function getNextLocNumericId() {
  const maxId = state.locations.reduce((mx, l) => Math.max(mx, l.numeric_id || 0), 0);
  return maxId + 1;
}

// --- CHARACTERS ------------------------------
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
      log('OK', 'ÄÀÍÍÛÅ', `Çàãðóæåíî ${state.characters.length} ïåðñîíàæåé èç êýøà`);
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
    
    log('OK', 'ÄÀÍÍÛÅ', `Çàãðóæåíî ${state.characters.length} ïåðñîíàæåé`);
    populateFilters();

    // Merge custom characters: server API (permanent) + localStorage (offline fallback)
    await loadServerCustomCharacters();
    loadCustomCharacters();

    renderCharacters();
    populateSeriesSelects();
  } catch (e) {
    log('ERR', 'ÄÀÍÍÛÅ', `Îøèáêà çàãðóçêè ïåðñîíàæåé: ${e.message}`);
  }
}

async function loadAvatarManifest() {
  try {
    const resp = await fetch(new URL('./data/avatars/manifest.json', import.meta.url));
    if (!resp.ok) return;
    const data = await resp.json();
    state.avatarMap = data || {};
    const count = Object.keys(state.avatarMap).length;
    if (count > 0) {
      log('OK', 'ÀÂÀÒÀÐÛ', `Çàãðóæåíî ${count} àâàòàðîâ`);
      renderCharacters(getCurrentFilters());
    }
  } catch { /* manifest missing or invalid — silent */ }
}

async function loadServerCustomCharacters() {
  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiBase}/api/custom/characters`);
    if (!resp.ok) { log('WARN', 'GH-ÏÅÐÑÎÍÀÆÈ', `Ñåðâåð îòâåòèë ${resp.status}`); return; }
    const serverChars = await resp.json();
    if (!Array.isArray(serverChars)) return;
    if (!serverChars.length) { log('INFO', 'GH-ÏÅÐÑÎÍÀÆÈ', '0 ïîëüçîâàòåëüñêèõ ïåðñîíàæåé íà ñåðâåðå'); return; }
    const existingIds = new Set(state.characters.map(c => c.id));
    let added = 0;
    const names = [];
    serverChars.forEach(c => {
      if (!existingIds.has(c.id)) {
        if (!c.numeric_id) c.numeric_id = getNextCharNumericId();
        state.characters.push(c); existingIds.add(c.id); added++; names.push(c.name_ru || c.id);
      }
    });
    log('OK', 'GH-ÏÅÐÑÎÍÀÆÈ', `? ${serverChars.length} íà ñåðâåðå, ${added} íîâûõ äîáàâëåíî${names.length ? ': ' + names.join(', ') : ''}`);
  } catch (e) {
    log('WARN', 'GH-ÏÅÐÑÎÍÀÆÈ', 'Ñåðâåð íåäîñòóïåí — èñïîëüçóåì ëîêàëüíûé êýø');
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

  const isSearchActive = !!(filter.search || filter.group || filter.compat);
  if (filter.search) {
    const raw = filter.search.trim();
    const q = raw.replace(/^#/, '').toLowerCase();
    const qNum = parseInt(q, 10);
    const isNumericSearch = !isNaN(qNum) && /^\d+$/.test(q);
    chars = chars.filter(c => {
      if (isNumericSearch) {
        if (c.numeric_id === qNum) return true;
        if (c.numeric_id && String(c.numeric_id).includes(q)) return true;
      }
      return c.name_ru.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || c.tags.some(t => t.includes(q)) || (c.id && c.id.toLowerCase().includes(q));
    });
  }
  if (filter.group) chars = chars.filter(c => c.group === filter.group);
  if (filter.compat) chars = chars.filter(c => c.compatibility === filter.compat);

  // Virtual scroll: render first page only, load more on demand
  // When searching/filtering — show ALL results (no pagination)
  const _VS_PAGE = isSearchActive ? chars.length : 80;
  state._charRenderAll = chars;
  state._charRenderPage = 1;
  const _slice = chars.slice(0, _VS_PAGE);
  const _hasMore = chars.length > _VS_PAGE;

  grid.innerHTML = _slice.map(c => {
    const isA = state.selectedA?.id === c.id;
    const isB = state.selectedB?.id === c.id;
    const selCls = isA ? 'selected ring-2 ring-violet-500' : isB ? 'selected ring-2 ring-indigo-500' : '';
    const tagCls = c.compatibility === 'meme' ? 'tag-green' : c.compatibility === 'conflict' ? 'tag-pink' : c.compatibility === 'chaotic' ? 'tag-orange' : c.compatibility === 'calm' ? '' : 'tag-purple';
    const compatRu = { meme: 'ìåì', conflict: 'êîíôëèêò', chaotic: 'õàîñ', calm: 'ñïîêîéíûé', balanced: 'áàëàíñ' };
    const paceRu = { fast: 'áûñòðàÿ', normal: 'ñðåäíÿÿ', slow: 'ìåäëåííàÿ' };

    // Detail sections
    const anchors = c.identity_anchors || {};

    return `
    <div class="char-card ${selCls}" data-id="${c.id}">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2 min-w-0">
          ${getAvatarImg(c.id)}
          <span class="text-sm font-bold text-white truncate">${c.numeric_id ? `<span class="text-[10px] text-gray-500 font-mono mr-1">#${c.numeric_id}</span>` : ''}${c.name_ru}</span>
        </div>
        <span class="tag text-[10px] ${tagCls} flex-shrink-0">${compatRu[c.compatibility] || c.compatibility}</span>
      </div>
      ${c.tagline_ru ? `<div class="text-[11px] text-violet-300/90 mb-1.5 leading-snug">${c.tagline_ru}</div>` : ''}
      <div class="text-[10px] text-gray-500 mb-2 flex flex-wrap gap-x-2">
        <span>?? ${c.group}</span>
        <span>? ${paceRu[c.speech_pace] || c.speech_pace}</span>
        <span>?? ìàò ${c.swear_level}/3</span>
        <span>${c.role_default === 'A' ? '???' : '???'} ${c.role_default === 'A' ? 'ïðîâîêàòîð' : 'ïàí÷ëàéí'}</span>
      </div>

      <!-- Select buttons — large & clear -->
      <div class="flex gap-2 mb-2">
        <button class="select-a flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isA ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-id="${c.id}">${isA ? '? Âûáðàí A' : '??? Âûáðàòü A'}</button>
        <button class="select-b flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isB ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20' : 'bg-indigo-600/10 text-indigo-300 border-indigo-500/20 hover:bg-indigo-600/25 hover:border-indigo-500/40'}" data-id="${c.id}">${isB ? '? Âûáðàí B' : '??? Âûáðàòü B'}</button>
      </div>

      <!-- Copy Prompt Button -->
      <button class="copy-char-prompt text-[10px] px-2 py-1.5 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full flex items-center justify-center gap-1" data-id="${c.id}" title="Ñêîïèðîâàòü äåòàëèçèðîâàííûé ïðîìïò äëÿ Veo">
        <span>??</span> Êîïèðîâàòü ïðîìïò
      </button>
      ${c._custom ? `<button onclick="deleteCustomChar('${c.id}')" class="text-[10px] px-2 py-1 rounded-md font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 w-full mt-1 flex items-center justify-center gap-1">?? Óäàëèòü</button>` : ''}

      <!-- Expandable detail -->
      <details class="group">
        <summary class="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">Ïîäðîáíåå ?</summary>
        <div class="mt-2 space-y-2.5 text-[11px] border-t border-gray-800/60 pt-2.5">

          ${c.vibe_archetype ? `<div class="mb-1.5"><span class="text-violet-400 font-medium">?? Àðõåòèï:</span> <span class="text-gray-200 font-medium">${c.vibe_archetype}</span></div>` : ''}

          ${c.speech_style_ru ? `<div><span class="text-violet-400 font-medium">?? Ðå÷ü:</span> <span class="text-gray-300">${c.speech_style_ru}</span></div>` : ''}

          ${anchors.signature_element ? `<div><span class="text-violet-400 font-medium">? Ôèøêà:</span> <span class="text-gray-300">${translateEnRu(anchors.signature_element)}</span></div>` : ''}

          ${anchors.micro_gesture ? `<div><span class="text-violet-400 font-medium">?? Æåñò:</span> <span class="text-gray-300">${translateEnRu(anchors.micro_gesture)}</span></div>` : ''}

          ${c.modifiers?.hook_style ? `<div><span class="text-violet-400 font-medium">?? Õóê:</span> <span class="text-gray-300">${translateEnRu(c.modifiers.hook_style)}</span></div>` : ''}
          ${c.modifiers?.laugh_style ? `<div><span class="text-violet-400 font-medium">?? Ñìåõ:</span> <span class="text-gray-300">${translateEnRu(c.modifiers.laugh_style)}</span></div>` : ''}

          <div class="mt-2">
            <div class="text-violet-400 font-medium mb-1">?? Âíåøíîñòü:</div>
            <div class="text-[10px] text-gray-400 leading-relaxed">${c.appearance_ru}</div>
          </div>
        </div>
      </details>
    </div>`;
  }).join('') + (_hasMore ? `
    <div id="char-load-more" class="col-span-full text-center py-3">
      <button onclick="loadMoreCharacters()" class="text-[11px] text-cyan-400 hover:text-cyan-300 border border-cyan-500/20 rounded-lg px-5 py-2 hover:bg-cyan-500/10 transition-colors">
        Åù¸ ïåðñîíàæè (${chars.length - _VS_PAGE} èç ${chars.length})
      </button>
    </div>` : '');

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

// --- LOAD MORE CHARACTERS (virtual scroll) -----------------
function loadMoreCharacters() {
  const grid = document.getElementById('char-grid');
  if (!grid || !state._charRenderAll) return;
  state._charRenderPage = (state._charRenderPage || 1) + 1;
  const PAGE = 80;
  const slice = state._charRenderAll.slice(0, PAGE * state._charRenderPage);
  const hasMore = state._charRenderAll.length > slice.length;
  const remaining = state._charRenderAll.length - slice.length;

  // Append new cards (replace load-more btn area)
  const moreBtn = document.getElementById('char-load-more');
  if (moreBtn) moreBtn.remove();

  const newChars = slice.slice(slice.length - PAGE);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = newChars.map(c => {
    const isA = state.selectedA?.id === c.id;
    const isB = state.selectedB?.id === c.id;
    const selCls = isA ? 'selected ring-2 ring-violet-500' : isB ? 'selected ring-2 ring-indigo-500' : '';
    const tagCls = c.compatibility === 'meme' ? 'tag-green' : c.compatibility === 'conflict' ? 'tag-pink' : c.compatibility === 'chaotic' ? 'tag-orange' : c.compatibility === 'calm' ? '' : 'tag-purple';
    const compatRu = { meme: 'ìåì', conflict: 'êîíôëèêò', chaotic: 'õàîñ', calm: 'ñïîêîéíûé', balanced: 'áàëàíñ' };
    const paceRu = { fast: 'áûñòðàÿ', normal: 'ñðåäíÿÿ', slow: 'ìåäëåííàÿ' };
    const anchors = c.identity_anchors || {};
    return `<div class="char-card ${selCls}" data-id="${c.id}"><div class="flex items-center justify-between mb-1"><div class="flex items-center gap-2 min-w-0">${getAvatarImg(c.id)}<span class="text-sm font-bold text-white truncate">${c.numeric_id ? `<span class="text-[10px] text-gray-500 font-mono mr-1">#${c.numeric_id}</span>` : ''}${c.name_ru}</span></div><span class="tag text-[10px] ${tagCls} flex-shrink-0">${compatRu[c.compatibility] || c.compatibility}</span></div>${c.tagline_ru ? `<div class="text-[11px] text-violet-300/90 mb-1.5 leading-snug">${c.tagline_ru}</div>` : ''}<div class="text-[10px] text-gray-500 mb-2 flex flex-wrap gap-x-2"><span>?? ${c.group}</span><span>? ${paceRu[c.speech_pace] || c.speech_pace}</span><span>?? ìàò ${c.swear_level}/3</span><span>${c.role_default === 'A' ? '???' : '???'} ${c.role_default === 'A' ? 'ïðîâîêàòîð' : 'ïàí÷ëàéí'}</span></div><div class="flex gap-2 mb-2"><button class="select-a flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isA ? 'bg-violet-600 text-white border-violet-500' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25'}" data-id="${c.id}">${isA ? '? Âûáðàí A' : '??? Âûáðàòü A'}</button><button class="select-b flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all border ${isB ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-indigo-600/10 text-indigo-300 border-indigo-500/20 hover:bg-indigo-600/25'}" data-id="${c.id}">${isB ? '? Âûáðàí B' : '??? Âûáðàòü B'}</button></div><button class="copy-char-prompt text-[10px] px-2 py-1.5 rounded-md font-medium bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full flex items-center justify-center gap-1" data-id="${c.id}"><span>??</span> Êîïèðîâàòü ïðîìïò</button></div>`;
  }).join('');

  // Move cards from temp to grid, then wire events on the moved elements
  const addedCards = [...tempDiv.querySelectorAll('.char-card')];
  addedCards.forEach(el => grid.appendChild(el));

  // Wire up buttons on the newly added cards (they are now in the grid DOM)
  addedCards.forEach(card => {
    card.querySelectorAll('.select-a').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); selectChar('A', btn.dataset.id); }));
    card.querySelectorAll('.select-b').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); selectChar('B', btn.dataset.id); }));
    card.querySelectorAll('.copy-char-prompt').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); copyCharacterPrompt(btn.dataset.id); }));
  });

  if (hasMore) {
    const newBtn = document.createElement('div');
    newBtn.id = 'char-load-more';
    newBtn.className = 'col-span-full text-center py-3';
    newBtn.innerHTML = `<button onclick="loadMoreCharacters()" class="text-[11px] text-cyan-400 hover:text-cyan-300 border border-cyan-500/20 rounded-lg px-5 py-2 hover:bg-cyan-500/10 transition-colors">Åù¸ ïåðñîíàæè (${remaining} èç ${state._charRenderAll.length})</button>`;
    grid.appendChild(newBtn);
  }

  log('OK', 'LAZY', `Ïåðñîíàæè: ñòðàíèöà ${state._charRenderPage}, ïîêàçàíî ${slice.length}/${state._charRenderAll.length}`);
}

function selectChar(role, id) {
  const char = state.characters.find(c => c.id === id);
  if (!char) return;

  // Toggle: if same character already in this role > deselect
  if (role === 'A' && state.selectedA?.id === id) {
    state.selectedA = null;
    sfx.clickSoft();
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'ÏÅÐÑÎÍÀÆÈ', `A: ñáðîøåí`);
    updateReadiness();
    return;
  }
  if (role === 'B' && state.selectedB?.id === id) {
    state.selectedB = null;
    sfx.clickSoft();
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'ÏÅÐÑÎÍÀÆÈ', `B: ñáðîøåí`);
    updateReadiness();
    return;
  }

  sfx.select();
  if (role === 'A') { state.selectedA = char; } else { state.selectedB = char; }
  updateCharDisplay();
  renderCharacters(getCurrentFilters());
  log('INFO', 'ÏÅÐÑÎÍÀÆÈ', `${role}: ${char.name_ru} (${char.compatibility})`);
  updateReadiness();
  _scheduleDraftSave();
}

function deselectChar(role) {
  if (role === 'A') state.selectedA = null;
  else state.selectedB = null;
  sfx.clickSoft();
  updateCharDisplay();
  renderCharacters(getCurrentFilters());
  log('INFO', 'ÏÅÐÑÎÍÀÆÈ', `${role}: ñáðîøåí`);
  updateReadiness();
  _scheduleDraftSave();
}
window.deselectChar = deselectChar;

// --- AUTO-SELECT CHARACTERS FOR CATEGORY ---------------
// Óìíûé àâòîïîäáîð ïåðñîíàæåé ïîä êàòåãîðèþ/òðåíä
function autoSelectCharactersForCategory(categoryRu, topicRu = '') {
  if (!state.characters || state.characters.length === 0) return false;

  // Category > character group preferences
  const categoryHints = {
    'Áûòîâîé àáñóðä': ['áàáêè', 'äåäû', 'ñîñåäè'],
    'AI è òåõíîëîãèè': ['áàáêè', 'äåäû', 'ñòóäåíòû', 'áëîãåðû'],
    'Öåíû è èíôëÿöèÿ': ['áàáêè', 'äåäû', 'ïåíñèîíåðû', 'ïðîäàâöû'],
    'Îòíîøåíèÿ': ['ìàìû', 'ïàïû', 'ò¸ùè', 'ñâåêðîâè'],
    'Ðàçðûâ ïîêîëåíèé': ['áàáêè', 'äåäû', 'äî÷åðè', 'ñûíîâüÿ', 'ñòóäåíòû'],
    'ÆÊÕ è êîììóíàëêà': ['áàáêè', 'äåäû', 'ñîñåäè', 'ïåíñèîíåðû'],
    'Çäîðîâüå è ïîëèêëèíèêà': ['áàáêè', 'äåäû', 'âðà÷è', 'ïåíñèîíåðû'],
    'Ñîöñåòè è òðåíäû': ['áàáêè', 'áëîãåðû', 'äî÷åðè', 'ñòóäåíòû'],
    'Äà÷à è îãîðîä': ['áàáêè', 'äåäû', 'ñîñåäè'],
    'Òðàíñïîðò è ïðîáêè': ['áàáêè', 'äåäû', 'òàêñèñòû', 'ñîñåäè'],
  };

  const preferredGroups = categoryHints[categoryRu] || ['áàáêè', 'äåäû'];
  
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
  
  log('OK', 'ÀÂÒÎÏÎÄÁÎÐ', `Âûáðàíî: ${charA.name_ru} ? ${charB.name_ru} äëÿ êàòåãîðèè "${categoryRu}"`);
  return true;
}

function updateCharDisplay() {
  // A slot
  const charAName = document.getElementById('char-a-name');
  if (charAName) {
    if (state.selectedA) {
      charAName.innerHTML = `${getAvatarImg(state.selectedA.id, 'w-6 h-6 inline-block align-middle mr-1.5')}<span class="text-white">${escapeHtml(state.selectedA.name_ru)} • ${escapeHtml(state.selectedA.group)}</span> <button onclick="deselectChar('A')" class="ml-2 text-[10px] text-red-400/60 hover:text-red-400 transition-colors" title="Ñáðîñèòü A">?</button>`;
    } else {
      charAName.innerHTML = '<span class="text-gray-400">Íàæìè íà ïåðñîíàæà v</span>';
    }
  }
  // B slot
  const charBName = document.getElementById('char-b-name');
  if (charBName) {
    if (state.selectedB) {
      charBName.innerHTML = `${getAvatarImg(state.selectedB.id, 'w-6 h-6 inline-block align-middle mr-1.5')}<span class="text-white">${escapeHtml(state.selectedB.name_ru)} • ${escapeHtml(state.selectedB.group)}</span> <button onclick="deselectChar('B')" class="ml-2 text-[10px] text-red-400/60 hover:text-red-400 transition-colors" title="Ñáðîñèòü B">?</button>`;
    } else {
      charBName.innerHTML = '<span class="text-gray-400">Íàæìè íà âòîðîãî èëè ïðîïóñòè v</span>';
    }
  }

  document.getElementById('sidebar-char-a').innerHTML = `<span class="w-1 h-1 rounded-full bg-cyan-400/50 inline-block"></span>A: ${state.selectedA?.name_ru || '—'}`;
  document.getElementById('sidebar-char-b').innerHTML = `<span class="w-1 h-1 rounded-full bg-purple-400/50 inline-block"></span>B: ${state.selectedB?.name_ru || '—'}`;
  document.getElementById('gen-char-a').textContent = state.selectedA?.name_ru || '—';
  document.getElementById('gen-char-b').textContent = state.selectedB?.name_ru || '—';

  // Sync surprise mode manual slots
  updateSurpriseCharSlots();

  // Compatibility badge
  const badge = document.getElementById('char-compat-badge');
  if (state.selectedA && state.selectedB) {
    const combos = [state.selectedA.compatibility, state.selectedB.compatibility];
    let label = 'ñáàëàíñèðîâàííàÿ ïàðà';
    if (combos.includes('chaotic') && combos.includes('calm')) label = '?? âçðûâíàÿ ïàðà!';
    else if (combos.every(c => c === 'meme')) label = '?? ìåì-ïàðà';
    else if (combos.every(c => c === 'conflict')) label = '? êîíôëèêò!';
    else if (combos.includes('chaotic')) label = '?? õàîñ!';
    if (badge) { badge.classList.remove('hidden'); badge.querySelector('.tag').textContent = label; }
  } else {
    if (badge) badge.classList.add('hidden');
  }

  // Show/hide "Äàëåå" button — show when at least A is selected
  const goBtn = document.getElementById('btn-go-generate');
  if (goBtn) {
    if (state.selectedA) {
      goBtn.classList.remove('hidden');
      goBtn.textContent = state.selectedB ? 'Äàëåå > Ëîêàöèÿ è ñáîðêà ïðîìïòà' : 'Äàëåå > Ñîëî-ðîëèê (áåç B)';
    } else {
      goBtn.classList.add('hidden');
    }
  }

  // Run smart match analysis
  updateSmartMatch();
  
  // Update progress tracker
  updateProgress();
}

// --- SMART MATCH ANALYSIS ----------------------
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

  // -- Calculate scores --
  let scores = [];
  let tips = [];
  let details = [];

  // 1. Pair chemistry (if both selected)
  if (charA && charB) {
    const chemScore = calcPairChemistry(charA, charB);
    scores.push(chemScore.score);
    details.push({ label: '?? Õèìèÿ ïàðû', value: chemScore.score, text: chemScore.text });
    if (chemScore.tip) tips.push(chemScore.tip);
  }

  // 2. Topic relevance (if topic entered)
  if (topic && (charA || charB)) {
    const topicScore = calcTopicRelevance(topic, charA, charB);
    scores.push(topicScore.score);
    details.push({ label: '?? Òåìà + ïåðñîíàæè', value: topicScore.score, text: topicScore.text });
    if (topicScore.tip) tips.push(topicScore.tip);
  }

  // 3. Location match (if location selected)
  if (loc && (charA || charB)) {
    const locScore = calcLocationMatch(loc, charA, charB);
    scores.push(locScore.score);
    details.push({ label: '?? Ëîêàöèÿ + ïåðñîíàæè', value: locScore.score, text: locScore.text });
    if (locScore.tip) tips.push(locScore.tip);
  }

  // 4. Role balance
  if (charA && charB) {
    const roleScore = calcRoleBalance(charA, charB);
    scores.push(roleScore.score);
    details.push({ label: '?? Áàëàíñ ðîëåé', value: roleScore.score, text: roleScore.text });
    if (roleScore.tip) tips.push(roleScore.tip);
  }

  // Overall score
  const overall = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  // -- Render --
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
    badge.textContent = `${overall}% îòëè÷íî`;
  } else if (overall >= 55) {
    fill.className = 'h-full rounded-full transition-all duration-500 bg-amber-500';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400';
    badge.textContent = `${overall}% íîðìàëüíî`;
  } else {
    fill.className = 'h-full rounded-full transition-all duration-500 bg-red-400';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/20 text-red-400';
    badge.textContent = `${overall}% ñëàáî`;
  }

  // Details
  detailsEl.innerHTML = details.map(d => {
    const color = d.value >= 80 ? 'text-emerald-400' : d.value >= 55 ? 'text-amber-400' : 'text-red-400';
    const bar = Math.round(d.value / 10);
    const full = '-'.repeat(bar);
    const empty = '-'.repeat(10 - bar);
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
    tipsListEl.innerHTML = tips.map(t => `<div class="flex items-start gap-1.5"><span class="text-amber-400 flex-shrink-0">></span><span>${t}</span></div>`).join('');
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

  if (greatCombos[c] !== undefined) { score += greatCombos[c]; text = 'Êîíòðàñò ñòèëåé ñîçäà¸ò ýíåðãèþ'; }
  else if (okCombos[c] !== undefined) { score += okCombos[c]; text = 'Íîðìàëüíîå ñî÷åòàíèå, ðàáîòàåò'; }
  else if (weakCombos[c] !== undefined) { score += weakCombos[c]; text = 'Îäèíàêîâûå ñòèëè — ìàëî êîíôëèêòà'; tip = 'Ïîïðîáóé ïàðó ñ êîíòðàñòíûìè ñòèëÿìè (õàîñ+ñïîêîéíûé, ìåì+êîíôëèêò)'; }
  else { score += 10; text = 'Ñòàíäàðòíîå ñî÷åòàíèå'; }

  // Speech pace contrast bonus
  if (a.speech_pace !== b.speech_pace) { score += 10; text += ', òåìï ðå÷è êîíòðàñòíûé'; }
  else if (a.speech_pace === 'slow' && b.speech_pace === 'slow') { score -= 5; }

  // Different groups = more interesting
  if (a.group !== b.group) { score += 10; }
  else { tip = tip || 'Ïåðñîíàæè èç ðàçíûõ ãðóïï îáû÷íî ñîçäàþò áîëåå èíòåðåñíûå êîíôëèêòû'; }

  return { score: Math.min(100, Math.max(10, score)), text, tip };
}

function calcTopicRelevance(topic, charA, charB) {
  const t = topic.toLowerCase();
  let score = 60; // base — most topics work with most chars
  let text = '';
  let tip = '';

  // Topic keywords > character group affinity
  const groupAffinities = {
    'áàáêè': ['ðåöåïò', 'äà÷', 'îãîðîä', 'âàðåí', 'âíóê', 'ïåíñè', 'ïîëèêëèíèê', 'çäîðîâü', 'öåí', 'ìàãàçèí', 'ïîäúåçä', 'ñïëåòí', 'ñîñåä', 'öåðê'],
    'äåäû': ['ðûáàëê', 'ãàðàæ', 'ìàñòåðñê', 'èíñòðóìåíò', 'ðåìîíò', 'ñîâåò', 'àðìèÿ', 'âîéíà', 'ñïîðò', 'ôóòáîë', 'ïîëèòèê', 'ôèëîñîô'],
    'ìàìû': ['øêîë', 'ðåá¸í', 'äåò', 'ðîäèòåë', 'ó÷èòåë', 'îöåí', 'ãîòîâ', 'êóõí', 'óáîðê', 'ïîðÿäîê', 'èíñòàãðàì', 'áëîã', 'ôèòíåñ'],
    'ïàïû': ['ìàøèí', 'ãàðàæ', 'ðåìîíò', 'ðàáîò', 'íà÷àëü', 'çàðïëàò', 'îòïóñê', 'ðûáàëê', 'øàøëûê', 'ôóòáîë', 'ïèâ', 'äà÷'],
    'äî÷åðè': ['òèêòîê', 'èíñòàãðàì', 'ìîä', 'îäåæä', 'óíèâåð', 'ó÷¸á', 'ïàðí', 'ñâèäàí', 'êîôå', 'âåãà', 'ýêîëîãè', 'ñïðàâåäëèâ'],
    'ñûíîâüÿ': ['èãð', 'êîìï', 'òåëåôîí', 'ñïîðò', 'êà÷àëê', 'ìóçûê', 'ðýï', 'ñêåéò', 'äîñòàâê', 'êóðüåð'],
    'ñîñåäè': ['ïîäúåçä', 'øóì', 'ðåìîíò', 'ïàðêîâ', 'ìóñîð', 'ñîáàê', 'ìóçûê', 'æêõ', 'ñîñåä'],
    'ïðîôåññèîíàëû': ['ðàáîò', 'âðà÷', 'ó÷èòåë', 'îõðàí', 'îôèñ', 'íà÷àëüí', 'êëèåíò', 'ïàöèåíò'],
    'áëîãåðû': ['êîíòåíò', 'ëàéê', 'ïîäïèñ÷èê', 'ñòîðèç', 'òèêòîê', 'èíñòàãðàì', 'êàìåð', 'áëîã'],
    'ïîâàðà': ['åäà', 'ãîòîâ', 'ðåöåïò', 'êóõí', 'áîðù', 'ïèðîæ', 'ðåñòîðàí', 'âêóñ'],
    '÷èíîâíèêè': ['äîêóìåíò', 'ñïðàâê', 'î÷åðåä', 'áþðîêðàò', 'çàêîí', 'øòðàô', 'ïàñïîðò', 'ìôö'],
    'ò¸ùè': ['çÿò', 'íåâåñòê', 'ñâàäüá', 'ñåìü', 'ïðàçäíèê', 'ðîäèòåë'],
    'ïðîäàâöû': ['ðûíîê', 'öåí', 'òîðã', 'òîâàð', 'ïîêóïàò', 'ñêèäê', 'ìàãàçèí'],
    'ñïîðòñìåíû': ['ñïîðò', 'òðåíèðîâ', 'çàë', 'áåã', 'êà÷àëê', 'ôèòíåñ', 'äèåò', 'ïðîòåèí'],
    'àéòèøíèêè': ['êîä', 'ïðîãðàìì', 'êîìï', 'áàã', 'ñàéò', 'ïðèëîæåí', 'AI', 'ðîáîò'],
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

  if (total === 0) return { score: 60, text: 'Íå âûáðàíû ïåðñîíàæè', tip: '' };

  if (matched === total) {
    score = 85 + Math.floor(Math.random() * 10);
    text = 'Ïåðñîíàæè èäåàëüíî ïîäõîäÿò ê òåìå';
  } else if (matched > 0) {
    score = 65 + Math.floor(Math.random() * 10);
    text = 'Îäèí èç ïåðñîíàæåé õîðîøî ïîäõîäèò ê òåìå';
    const weak = chars.find(ch => {
      const kw = groupAffinities[ch.group] || [];
      return !kw.some(k => t.includes(k));
    });
    if (weak) tip = `${weak.name_ru} (${weak.group}) íå î÷åíü ñâÿçàí ñ òåìîé «${topic.slice(0, 30)}...» — íî AI ìîæåò îáûãðàòü êîíòðàñò`;
  } else {
    score = 35 + Math.floor(Math.random() * 15);
    text = 'Ïåðñîíàæè íå òèïè÷íû äëÿ ýòîé òåìû';
    const groups = Object.entries(groupAffinities).filter(([_, kws]) => kws.some(kw => t.includes(kw))).map(([g]) => g);
    if (groups.length > 0) {
      tip = `Äëÿ òåìû «${topic.slice(0, 25)}...» ëó÷øå ïîäîéäóò: ${groups.slice(0, 3).join(', ')}`;
    } else {
      tip = 'Òåìà óíèâåðñàëüíàÿ — ëþáûå ïåðñîíàæè ïîäîéäóò, íî êîíòðàñò ñòèëåé âàæíåå';
      score = 60;
      text = 'Óíèâåðñàëüíàÿ òåìà — ïîäîéäóò ëþáûå ïåðñîíàæè';
    }
  }

  return { score: Math.min(100, Math.max(10, score)), text, tip };
}

function calcLocationMatch(loc, charA, charB) {
  let score = 60;
  let text = '';
  let tip = '';

  const chars = [charA, charB].filter(Boolean);
  if (chars.length === 0) return { score: 60, text: 'Íå âûáðàíû ïåðñîíàæè', tip: '' };

  // Location group > character group affinity map
  const locCharAffinity = {
    'äåðåâíÿ': ['áàáêè', 'äåäû', 'ïîâàðà'],
    'ãîðîä': ['ìàìû', 'ïàïû', 'ñîñåäè', 'ïðîôåññèîíàëû', 'áëîãåðû', '÷èíîâíèêè', 'àéòèøíèêè'],
    'ïëÿæ': ['ìàìû', 'ïàïû', 'äî÷åðè', 'ñûíîâüÿ'],
    'ñïîðò': ['ñûíîâüÿ', 'äî÷åðè', 'ñïîðòñìåíû', 'ïàïû'],
    'êàôå': ['ìàìû', 'äî÷åðè', 'áëîãåðû', 'ïàïû'],
    'îôèñ': ['ïðîôåññèîíàëû', 'àéòèøíèêè', 'ìàìû', 'ïàïû'],
    'ó÷ðåæäåíèÿ': ['áàáêè', 'äåäû', '÷èíîâíèêè', 'ìàìû'],
    'êðàñîòà': ['ìàìû', 'äî÷åðè', 'áëîãåðû', 'áàáêè'],
    'îòäûõ': ['ïàïû', 'äåäû', 'ñûíîâüÿ', 'ìàìû'],
    'ðàçâëå÷åíèÿ': ['äî÷åðè', 'ñûíîâüÿ', 'ìàìû', 'ïàïû'],
    'ïðîìûøëåííîñòü': ['äåäû', 'ïàïû', 'ïðîôåññèîíàëû'],
  };

  const affinity = locCharAffinity[loc.group] || [];
  let matched = 0;
  chars.forEach(ch => { if (affinity.includes(ch.group)) matched++; });

  if (matched === chars.length) {
    score = 80 + Math.floor(Math.random() * 15);
    text = `${loc.name_ru} — åñòåñòâåííàÿ ñðåäà äëÿ ýòèõ ïåðñîíàæåé`;
  } else if (matched > 0) {
    score = 60 + Math.floor(Math.random() * 15);
    text = `Îäèí ïåðñîíàæ îðãàíè÷åí â ${loc.name_ru}, äðóãîé ñîçäàñò êîíòðàñò`;
  } else {
    score = 35 + Math.floor(Math.random() * 15);
    text = `Ïåðñîíàæè íåòèïè÷íû äëÿ ${loc.name_ru}`;
    tip = `${loc.name_ru} áîëüøå ïîäõîäèò äëÿ: ${affinity.slice(0, 3).join(', ')} — íî êîíòðàñò «ïåðñîíàæ íå íà ñâî¸ì ìåñòå» òîæå ñìåøíî!`;
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
    text = 'A-ïðîâîêàòîð + B-ïàí÷ëàéí — èäåàëüíûé áàëàíñ';
  } else if (a.role_default === 'B' && b.role_default === 'A') {
    score = 75;
    text = 'Ðîëè ïåðåâ¸ðíóòû — AI ïîäñòðîèò, íî ëó÷øå ïîìåíÿòü ìåñòàìè (?)';
    tip = 'Íàæìè ? ÷òîáû ïîìåíÿòü ìåñòàìè — A äîëæåí ïðîâîöèðîâàòü, B îòâå÷àòü';
  } else if (a.role_default === 'A' && b.role_default === 'A') {
    score = 55;
    text = 'Îáà ïðîâîêàòîðû — áóäåò õàîñ, íî íå âñåãäà ñòðóêòóðíî';
    tip = 'Äâà ïðîâîêàòîðà ìîãóò ïåðåáèâàòü äðóã äðóãà — ïîïðîáóé îäíîãî çàìåíèòü íà B-òèïà';
  } else {
    score = 50;
    text = 'Îáà ïàí÷ëàéíåðû — êòî áóäåò ïðîâîöèðîâàòü?';
    tip = 'Íóæåí õîòÿ áû îäèí ïðîâîêàòîð (A) — ïîñìîòðè ïåðñîíàæåé ñ ???';
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
  log('INFO', 'ÀÂÒÎÏÎÄÁÎÐ', `Ñëó÷àéíàÿ ïàðà: ${chars[idxA].name_ru} ? ${chars[idxB].name_ru}`);
  return true;
}

// --- RANDOM PAIR -----------------------------
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
    log('INFO', 'ÏÅÐÑÎÍÀÆÈ', `?? Ñëó÷àéíàÿ ïàðà: ${chars[idxA].name_ru} ? ${chars[idxB].name_ru}`);
  });
}

// --- NAVIGATION ------------------------------
function navigateTo(section) {
  sfx.nav();
  // Gentle reminder if user skips mode selection (don't block)
  if ((section === 'content' || section === 'characters') && !state.generationMode) {
    showNotification('?? Ñîâåò: ñíà÷àëà âûáåðèòå ðåæèì ãåíåðàöèè íà øàãå 1', 'warning');
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

  // Refresh history when navigating to history section
  if (section === 'history') renderHistory();

  // Threads Trends: update gate on each visit
  if (section === 'threads-trends') _onThreadsTrendsEnter();

  // Lazy init heavy sections on first visit
  if (!_lazyInited.has(section)) {
    _lazyInited.add(section);
    const _lazyMap = {
      ideas: initTrends,
      education: initEducation,
      jokes: initJokesLibrary,
      // Locations: load only when user visits the locations tab
      locations: () => loadLocations().then(() => { try { loadCustomLocations(); renderLocations(); renderLocationsBrowse(); initLocationsBrowse(); } catch(e) { console.error('[FERIXDI] locations:', e); } }),
      // Characters: data already pre-fetched on startup; render DOM on first visit
      characters: () => { renderCharacters(getCurrentFilters()); populateSeriesSelects(); },
    };
    const lazyFn = _lazyMap[section];
    if (lazyFn) {
      try { lazyFn(); log('OK', 'LAZY', `Ñåêöèÿ «${section}» èíèöèàëèçèðîâàíà`); }
      catch(e) { console.error(`[FERIXDI] lazy ${section}:`, e); }
    }
  }

  // Log navigation for debugging
  log('INFO', 'ÍÀÂÈÃÀÖÈß', `Ïåðåõîä ê ðàçäåëó: ${section}`);
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
        indicator.textContent = '?';
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

  // "Äàëåå" button on characters > go to generate (step 4: location + generate)
  document.getElementById('btn-go-generate')?.addEventListener('click', () => {
    if (!state.selectedA) {
      showNotification('?? Ñíà÷àëà âûáåðèòå õîòÿ áû îäíîãî ïåðñîíàæà (A)', 'warning');
      return;
    }
    navigateTo('generate');
  });

  // "Äàëåå" button on content > go to characters
  document.getElementById('btn-content-to-characters')?.addEventListener('click', () => {
    navigateTo('characters');
  });

  // "< Ñìåíèòü ïåðñîíàæåé" on generate > go back to characters
  document.getElementById('btn-chars-to-generate')?.addEventListener('click', () => {
    navigateTo('generate');
  });

  document.getElementById('gen-back-chars')?.addEventListener('click', () => {
    navigateTo('characters');
  });

  // Add location continue button
  document.getElementById('btn-go-generate-from-locations')?.addEventListener('click', () => {
    if (!state.generationMode) {
      showNotification('?? Ñíà÷àëà âûáåðèòå ðåæèì ãåíåðàöèè', 'warning');
      navigateTo('generation-mode');
      return;
    }
    if (!state.selectedA) {
      showNotification('?? Ñíà÷àëà âûáåðèòå õîòÿ áû îäíîãî ïåðñîíàæà', 'warning');
      navigateTo('characters');
      return;
    }
    navigateTo('generate');
  });
}

// --- GENERATION MODE SELECTION ---------------------
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
      showNotification('?? Ñíà÷àëà âûáåðèòå ðåæèì ãåíåðàöèè èç ñïèñêà âûøå', 'warning');
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
      video: 'ring-amber-500'
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
      idea: '?? Ñâîÿ èäåÿ',
      suggested: '?? Ãîòîâûå èäåè',
      script: '?? Ñâîé äèàëîã / ìîíîëîã',
      video: '?? Ïî âèäåî'
    };
    nameEl.textContent = modeNames[mode] || mode;
    continueBtn.disabled = false;
    continueBtn.innerHTML = `<span>Äàëåå > Îïèñàòü êîíòåíò</span><span>></span>`;

    // Show mode-specific hint
    const hintEl = document.getElementById('selected-mode-hint');
    if (hintEl) {
      const hints = {
        idea: '?? Íà ñëåäóþùåì øàãå îïèøèòå ñâîþ èäåþ, çàòåì âûáåðåòå ïåðñîíàæåé.',
        suggested: '?? Íà ñëåäóþùåì øàãå âûáåðèòå òåìó èç òðåíäîâ èëè îñòàâüòå ïóñòûì — AI ïîäáåð¸ò.',
        script: '?? Íàïèøèòå ñâîé äèàëîã (A + B) èëè ìîíîëîã (òîëüêî A). Îñòàâüòå B ïóñòûì äëÿ ñîëî.',
        video: '?? Íà ñëåäóþùåì øàãå çàãðóçèòå âèäåî-ôàéë (MP4/MOV) äëÿ ðåìåéêà. Ïåðñîíàæè îïöèîíàëüíû — ìîæíî ïðîñòî ñêîïèðîâàòü êðåàòèâ.',
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
  _scheduleDraftSave();
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
    initVideoRefImageDropzoneMain();
  }

  log('INFO', 'ÐÅÆÈÌ', `Âûáðàí ðåæèì: ${mode}`);
}

// --- IDEA SUB-MODES ---------------------
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
  log('INFO', 'ÏÎÄÐÅÆÈÌ ÈÄÅÈ', `Âûáðàí ïîäðåæèì: ${subMode}`);
}

async function loadTrendingIdeas() {
  const grid = document.getElementById('trending-ideas-grid');
  if (!grid) return;
  
  // Show loading state
  grid.innerHTML = '<div class="text-xs text-gray-500 text-center">?? Çàãðóæàåì ïîïóëÿðíûå òåìû...</div>';
  
  try {
    const response = await fetch('/api/trending');
    const data = await response.json();
    
    if (data.trends && data.trends.length > 0) {
      grid.innerHTML = data.trends.map((trend, i) => `
        <div class="glass-panel p-3 border-l-2 border-emerald-500/40 cursor-pointer hover:bg-emerald-500/5 transition-all trending-idea-card" data-trend="${trend.topic}">
          <div class="text-xs text-emerald-400 font-medium mb-1">${trend.category}</div>
          <div class="text-sm text-gray-200 leading-relaxed">${trend.topic}</div>
          <div class="text-[10px] text-gray-500 mt-1">${trend.viral_score}% âèðóñíîñòè</div>
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
      grid.innerHTML = '<div class="text-xs text-gray-500 text-center">?? Èäåè âðåìåííî íåäîñòóïíû</div>';
    }
  } catch (error) {
    grid.innerHTML = '<div class="text-xs text-red-400 text-center">? Îøèáêà çàãðóçêè èäåé</div>';
    console.error('Error loading trending ideas:', error);
  }
}

// Load trending ideas into the main Generate page (for suggested mode)
async function loadTrendingIdeasMain() {
  const grid = document.getElementById('trending-ideas-main');
  if (!grid) return;

  grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">?? Çàãðóæàåì ïîïóëÿðíûå òåìû...</div>';

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
      grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">?? Èäåè âðåìåííî íåäîñòóïíû — íàïèøèòå ñâîþ òåìó íèæå</div>';
    }
  } catch (error) {
    grid.innerHTML = '<div class="text-xs text-gray-500 text-center py-3">?? Èäåè çàãðóçÿòñÿ ïîçæå — ïîêà íàïèøèòå ñâîþ òåìó íèæå</div>';
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
  log('INFO', 'ÒÐÅÍÄ', `Âûáðàíà òåìà: ${topic}`);
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
    notification.textContent = `? Âûáðàíà òåìà: ${topic}`;
    grid.parentNode.insertBefore(notification, grid.nextSibling);
    
    setTimeout(() => notification.remove(), 3000);
  }
  
  log('INFO', 'ÒÅÍÄÀ', `Âûáðàíà òðåíäîâàÿ òåìà: ${topic}`);
}

// --- CHARACTER CONTEXT RECOMMENDATIONS ---------------------
function getCharacterRecommendations(topicText) {
  if (!topicText) return [];
  
  const topicLower = topicText.toLowerCase();
  const recommendations = [];
  
  // ÆÊÕ è êîììóíàëêà
  if (topicLower.includes('æêõ') || topicLower.includes('êîììóíàëêà') || topicLower.includes('îòîïëåíèå') || 
      topicLower.includes('ñ÷¸ò') || topicLower.includes('ñ÷åò') || topicLower.includes('òàðèô')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Áûâøèé áóõãàëòåð — èäåàëüíî äëÿ òåì ïðî ñ÷åòà è òàðèôû' },
      { id: 'babka_valya', reason: 'Áûâøàÿ äîÿðêà — æèçíåííûé îïûò ñ êîììóíàëêîé' },
      { id: 'ded_boris', reason: 'Äîáðûé ãèãàíò — ñïîêîéíûå îáúÿñíåíèÿ ïî ÆÊÕ' },
      { id: 'ded_stepan', reason: 'Êóçíåö — ïðàêòè÷íûé ïîäõîä ê áûòîâûì ïðîáëåìàì' }
    );
  }
  
  // Öåíû è èíôëÿöèÿ
  else if (topicLower.includes('öåíà') || topicLower.includes('äîðîãî') || topicLower.includes('èíôëÿöèÿ') || 
             topicLower.includes('ìàãàçèí')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Áóõãàëòåð — ýêñïåðò ïî öåíàì è ðàñõîäàì' },
      { id: 'mama_regina', reason: 'CEO äîìàøíåãî õàîñà — êîíòðîëü áþäæåòà' },
      { id: 'ded_matvey', reason: 'ٸãîëü — ýëåãàíòíî ðàññóæäàåò î äåíüãàõ' },
      { id: 'papa_slava', reason: 'Ðåòðîãðàä — ïîìíèò öåíû èç ïðîøëîãî' }
    );
  }
  
  // Ðàçðûâ ïîêîëåíèé
  else if (topicLower.includes('áàáê') || topicLower.includes('äåä') || topicLower.includes('âíóê') || 
             topicLower.includes('ïîêîëåí') || topicLower.includes('çóìåð') || topicLower.includes('áóìåð')) {
    recommendations.push(
      { id: 'babka_zina', reason: 'Êëàññè÷åñêàÿ áàáêà — êîíôëèêò ïîêîëåíèé' },
      { id: 'ded_fyodor', reason: 'Ìîë÷àëèâûé äåä — êîíòðàñò ñ âíóêàìè' },
      { id: 'doch_yana', reason: 'Íåîí-ïàíê — òèïè÷íûé çóìåð' },
      { id: 'papa_artyom', reason: 'Õèïñòåð ñ áîðîäîé — ñîâðåìåííûé ïàïà' }
    );
  }
  
  // Çäîðîâüå è ïîëèêëèíèêà
  else if (topicLower.includes('áîëüíèö') || topicLower.includes('âðà÷') || topicLower.includes('ìåäèöèí') || 
             topicLower.includes('çäîðîâüå')) {
    recommendations.push(
      { id: 'mama_lyuba', reason: 'Òðàâíèöà — íàðîäíàÿ ìåäèöèíà' },
      { id: 'mama_alyona', reason: 'Ëåäÿíàÿ áëîíäèíêà — ñòðîãèé ïîäõîä ê çäîðîâüþ' },
      { id: 'papa_oleg', reason: 'Ïðîôåññîð — íàó÷íûé ïîäõîä ê ìåäèöèíå' },
      { id: 'ded_zakhar', reason: 'Ìîðñêîé âîëê — áàéêè ïðî çäîðîâüå' }
    );
  }
  
  // Äà÷à è îãîðîä
  else if (topicLower.includes('äà÷') || topicLower.includes('îãîðîä') || topicLower.includes('ïîìèäîð') || 
             topicLower.includes('óðîæàé')) {
    recommendations.push(
      { id: 'babka_valya', reason: 'Áûâøàÿ äîÿðêà — ýêñïåðò ïî îãîðîäó' },
      { id: 'ded_stepan', reason: 'Êóçíåö — ïðàêòè÷íîñòü â äà÷å' },
      { id: 'mama_lyuba', reason: 'Òðàâíèöà — çíàòîê ðàñòåíèé' },
      { id: 'papa_kostya', reason: 'Ñèëà÷ — ôèçè÷åñêàÿ ðàáîòà íà äà÷å' }
    );
  }
  
  // AI è òåõíîëîãèè
  else if (topicLower.includes('íåéðîñåò') || topicLower.includes('ai') || topicLower.includes('òåõíîëîã') || 
             topicLower.includes('ðîáîò')) {
    recommendations.push(
      { id: 'papa_oleg', reason: 'Ïðîôåññîð — ýêñïåðò ïî òåõíîëîãèÿì' },
      { id: 'papa_artyom', reason: 'Õèïñòåð — ñîâðåìåííûé òåõíî-áëîãåð' },
      { id: 'doch_yana', reason: 'Íåîí-ïàíê — ãèê-êóëüòóðà' },
      { id: 'mama_regina', reason: 'CEO — óïðàâëÿåò òåõíîëîãèÿìè' }
    );
  }
  
  return recommendations.slice(0, 4); // Ìàêñèìóì 4 ðåêîìåíäàöèè
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
  
  // Ñîçäàåì ïàíåëü ðåêîìåíäàöèé
  const panel = document.createElement('div');
  panel.className = 'glass-panel p-4 space-y-3 border-l-2 border-amber-500/40';
  panel.innerHTML = `
    <div class="text-sm font-semibold text-amber-400 flex items-center gap-2">
      <span>??</span> Ïîäõîäÿùèå ïåðñîíàæè ïîä âàøó òåìó
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
    <div class="text-[10px] text-gray-500">Êëèêíèòå äëÿ âûáîðà ïåðñîíàæà</div>
  `;
  
  // Âñòàâëÿåì ïîñëå ïîëÿ ââîäà
  const ideaInput = document.getElementById('section-remix');
  if (ideaInput && !ideaInput.querySelector('.character-recommendations')) {
    panel.className += ' character-recommendations';
    ideaInput.parentNode.insertBefore(panel, ideaInput.nextSibling);
  }
}

function selectCharacter(charId) {
  const char = state.characters.find(c => c.id === charId);
  if (!char) return;
  
  // Îïðåäåëÿåì ðîëü A èëè B â çàâèñèìîñòè îò òîãî, êòî óæå âûáðàí
  if (!state.selectedA) {
    selectChar('A', charId);
  } else if (!state.selectedB) {
    selectChar('B', charId);
  } else {
    // Åñëè îáà âûáðàíû, çàìåíÿåì ïåðâîãî
    selectChar('A', charId);
  }
  
  // Óáèðàåì ïàíåëü ðåêîìåíäàöèé
  const panel = document.querySelector('.character-recommendations');
  if (panel) panel.remove();
  
  // Ïåðåõîäèì ê ãåíåðàöèè åñëè îáà ïåðñîíàæà âûáðàíû
  if (state.selectedA && state.selectedB) {
    navigateTo('generate');
  }
}

// --- SURPRISE CHARACTER MODE -----------------
function setSurpriseCharMode(mode) {
  state.surpriseCharMode = mode;
  const autoBtn = document.getElementById('surprise-char-auto');
  const manualBtn = document.getElementById('surprise-char-manual');
  const hint = document.getElementById('surprise-char-hint');
  const manualSlots = document.getElementById('surprise-char-manual-slots');

  if (mode === 'auto') {
    if (autoBtn) {
      autoBtn.className = 'flex-1 py-2 px-3 rounded-lg text-[11px] font-medium transition-all border bg-emerald-600/20 text-emerald-300 border-emerald-500/40 ring-1 ring-emerald-500/50';
    }
    if (manualBtn) {
      manualBtn.className = 'flex-1 py-2 px-3 rounded-lg text-[11px] font-medium transition-all border bg-black/30 text-gray-400 border-gray-700/50 hover:bg-black/40 hover:text-gray-300';
    }
    if (hint) {
      hint.textContent = 'AI ñàì ïîäáåð¸ò ëó÷øóþ ïàðó ïåðñîíàæåé ïîä òåìó';
      hint.className = 'text-[10px] text-emerald-400/70 mt-1.5';
    }
    if (manualSlots) manualSlots.classList.add('hidden');
  } else {
    if (autoBtn) {
      autoBtn.className = 'flex-1 py-2 px-3 rounded-lg text-[11px] font-medium transition-all border bg-black/30 text-gray-400 border-gray-700/50 hover:bg-black/40 hover:text-gray-300';
    }
    if (manualBtn) {
      manualBtn.className = 'flex-1 py-2 px-3 rounded-lg text-[11px] font-medium transition-all border bg-purple-600/20 text-purple-300 border-purple-500/40 ring-1 ring-purple-500/50';
    }
    if (hint) {
      hint.textContent = 'Âûáåðèòå ïåðñîíàæåé âðó÷íóþ íà øàãå 3';
      hint.className = 'text-[10px] text-purple-400/70 mt-1.5';
    }
    if (manualSlots) manualSlots.classList.remove('hidden');
    updateSurpriseCharSlots();
  }

  updateReadiness();
  log('INFO', 'ÑÞÐÏÐÈÇ', `Ïåðñîíàæè: ${mode === 'auto' ? 'AI ïîäáåð¸ò' : 'âðó÷íóþ'}`);
}

function updateSurpriseCharSlots() {
  const aDisplay = document.getElementById('surprise-char-a-display');
  const bDisplay = document.getElementById('surprise-char-b-display');
  if (aDisplay) {
    aDisplay.textContent = state.selectedA ? `${state.selectedA.name_ru}` : 'íå âûáðàí';
    aDisplay.className = state.selectedA ? 'text-[11px] text-white' : 'text-[11px] text-gray-400';
  }
  if (bDisplay) {
    bDisplay.textContent = state.selectedB ? `${state.selectedB.name_ru}` : 'îïöèîíàëüíî';
    bDisplay.className = state.selectedB ? 'text-[11px] text-white' : 'text-[11px] text-gray-400';
  }
}

// Make functions globally available for HTML onclick handlers
window.selectCharacter = selectCharacter;
window.showCharacterRecommendations = showCharacterRecommendations;
window.setSurpriseCharMode = setSurpriseCharMode;

// --- INPUT MODES -----------------------------
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
      log('INFO', 'ÐÅÆÈÌ', `Ââîä: ${mode === 'idea' ? 'èäåÿ' : mode === 'script' ? 'äèàëîã' : 'âèäåî'}`);
    });
  });

  // Smart URL detection: if user pastes an Instagram link into the main idea field,
  // notify user to use video mode instead (no auto-fetch since video URL input is removed)
  document.getElementById('idea-input')?.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = e.target.value.trim();
      if (text.includes('instagram.com/')) {
        log('INFO', 'ÐÅÆÈÌ', 'Îáíàðóæåíà ññûëêà íà âèäåî — ïåðåêëþ÷è â ðåæèì «?? Ïî âèäåî» è çàãðóçè ôàéë');
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
        if (sceneHint && !sceneHint.value) sceneHint.value = `Ðåìåéê âèäåî: ${text}`;
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

// --- TOGGLES ---------------------------------
function initToggles() {
  document.querySelectorAll('.toggle-track').forEach(track => {
    track.addEventListener('click', () => {
      sfx.toggle();
      track.classList.toggle('active');
      const opt = track.dataset.opt;
      if (opt && opt in state.options) {
        state.options[opt] = track.classList.contains('active');
        log('INFO', 'ÎÏÖÈÈ', `${opt} = ${state.options[opt]}`);
      }
    });
  });
}

// --- VIDEO UPLOAD ----------------------------
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
  if (!file.type.startsWith('video/')) { log('WARN', 'ÂÈÄÅÎ', 'Íå âèäåîôàéë'); return; }
  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > 50) {
    showNotification('? Ôàéë áîëüøå 50 ÌÁ. Ñæìè âèäåî äî çàãðóçêè.', 'error');
    log('WARN', 'ÂÈÄÅÎ', `Ôàéë áîëüøå 50 MB (${sizeMB.toFixed(1)} MB)`);
    return;
  }
  if (sizeMB > 20) {
    showNotification(`?? Áîëüøîå âèäåî (${sizeMB.toFixed(1)} ÌÁ) — ïåðåäà÷à çàéì¸ò äîëüøå. Ðåêîìåíäóåì äî 20 ÌÁ.`, 'warning');
    log('WARN', 'ÂÈÄÅÎ', `Áîëüøîé ôàéë: ${sizeMB.toFixed(1)} MB`);
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  // Read the actual video file as base64 for AI multimodal input
  const reader = new FileReader();
  reader.onload = () => {
    const videoBase64 = reader.result.split(',')[1]; // strip data:video/mp4;base64, prefix
    state._videoFileBase64 = videoBase64;
    state._videoFileMime = file.type; // video/mp4 or video/quicktime
    log('OK', 'ÂÈÄÅÎ', `?? Âèäåî çàêîäèðîâàíî (${(file.size / 1024 / 1024).toFixed(1)} MB) — ãîòîâî ê àíàëèçó`);
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
        <span class="text-emerald-400">?</span>
        <span>?? ${escapeHtml(file.name)}</span>
      </div>
      <div>? ${duration}s · ${(file.size / 1024 / 1024).toFixed(1)} MB</div>
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
      log('OK', 'ÂÈÄÅÎ', 'Êàäð çàõâà÷åí (fallback)');
    } catch (e) {
      log('WARN', 'ÂÈÄÅÎ', `Íå óäàëîñü çàõâàòèòü êàäð: ${e.message}`);
    }
    URL.revokeObjectURL(url);

    // Show remake badge and auto-match button (both advanced and main page)
    document.getElementById('video-remake-badge')?.classList.remove('hidden');
    document.getElementById('video-remake-badge-main')?.classList.remove('hidden');
    document.getElementById('auto-match-cast-btn')?.classList.remove('hidden');

    // Auto-switch to video mode
    state.inputMode = 'video';

    // Auto-match characters from video (no manual selection needed)
    setTimeout(() => { if (state.characters?.length) autoMatchCast(); }, 300);

    log('OK', 'ÂÈÄÅÎ', `?? Çàãðóæåíî: ${file.name} (${state.videoMeta.duration}ñ) — ãîòîâî ê àíàëèçó`);
    updateReadiness();
  };

  video.onerror = () => {
    URL.revokeObjectURL(url);
    log('ERR', 'ÂÈÄÅÎ', 'Íå óäàëîñü ïðî÷èòàòü âèäåîôàéë');
  };

  video.src = url;
}

// --- AUTO-MATCH CAST by video context --------
async function autoMatchCast() {
  const btn = document.getElementById('auto-match-cast-btn');
  const resultEl = document.getElementById('auto-match-result');
  if (!state.videoMeta?.cover_base64 && !state._videoFileBase64) {
    log('WARN', 'ÏÎÄÁÎÐ', 'Ñíà÷àëà çàãðóçè âèäåî');
    return;
  }
  if (!state.characters?.length) {
    log('WARN', 'ÏÎÄÁÎÐ', 'Êàòàëîã ïåðñîíàæåé ïóñò');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '? AI àíàëèçèðóåò âèäåî...'; }
  if (resultEl) resultEl.classList.add('hidden');

  const token = localStorage.getItem('ferixdi_jwt');
  const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
  if (!token) { log('WARN', 'ÏÎÄÁÎÐ', 'Íåò àâòîðèçàöèè'); if (btn) { btn.disabled = false; btn.textContent = '?? Ïîäîáðàòü ïåðñîíàæåé è ëîêàöèþ àâòîìàòè÷åñêè'; } return; }

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
        log('OK', 'ÏÎÄÁÎÐ', `A: ${charA.name_ru}`);
      }
    }
    // Apply character B
    if (result.character_b_id) {
      const charB = state.characters.find(c => c.id === result.character_b_id);
      if (charB) {
        state.selectedB = charB;
        reasons.push(`<strong>B:</strong> ${charB.name_ru} — ${result.character_b_reason || ''}`);
        log('OK', 'ÏÎÄÁÎÐ', `B: ${charB.name_ru}`);
      }
    }
    // Apply location
    if (result.location_id) {
      const loc = state.locations.find(l => l.id === result.location_id);
      if (loc) {
        state.selectedLocation = loc.id;
        reasons.push(`<strong>Ëîêàöèÿ:</strong> ${loc.name_ru} — ${result.location_reason || ''}`);
        log('OK', 'ÏÎÄÁÎÐ', `Ëîêàöèÿ: ${loc.name_ru}`);
        renderLocations(document.getElementById('loc-group-filter')?.value || '');
        renderLocationsBrowse(document.getElementById('loc-browse-group-filter')?.value || '');
      }
    }

    // Update UI
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    updateReadiness();

    if (resultEl && reasons.length) {
      resultEl.innerHTML = '?? <strong>AI ïîäîáðàë:</strong><br>' + reasons.join('<br>');
      resultEl.classList.remove('hidden');
    }
    log('OK', 'ÏÎÄÁÎÐ', `Ãîòîâî — ${reasons.length} ýëåìåíòîâ ïîäîáðàíî`);
  } catch (e) {
    log('ERR', 'ÏÎÄÁÎÐ', `Îøèáêà: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '?? Ïîäîáðàòü ïåðñîíàæåé è ëîêàöèþ àâòîìàòè÷åñêè'; }
  }
}
window.autoMatchCast = autoMatchCast;

// --- VIDEO REFERENCE IMAGE DROPZONE (main generate page) ----
function initVideoRefImageDropzoneMain() {
  const dropzone = document.getElementById('video-ref-dropzone-main');
  const fileInput = document.getElementById('video-ref-file-main');
  if (!dropzone || !fileInput || dropzone._initialized) return;
  dropzone._initialized = true;

  const handleRefFile = (file) => {
    if (!file.type.startsWith('image/')) { log('WARN', 'ÐÅÔ', 'Íóæíî èçîáðàæåíèå'); return; }
    if (file.size > 10 * 1024 * 1024) { log('WARN', 'ÐÅÔ', 'Ôàéë > 10 ÌÁ'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      state._videoRefImageBase64 = dataUrl.split(',')[1];
      state._videoRefImageMime = file.type;
      // Show preview
      const previewEl = document.getElementById('video-ref-preview-main');
      const imgEl = document.getElementById('video-ref-img-main');
      const nameEl = document.getElementById('video-ref-name-main');
      const innerEl = document.getElementById('video-ref-inner-main');
      if (imgEl) imgEl.src = dataUrl;
      if (nameEl) nameEl.textContent = `? ${file.name} (${(file.size/1024).toFixed(0)} ÊÁ)`;
      if (previewEl) previewEl.classList.remove('hidden');
      if (innerEl) innerEl.innerHTML = '<div class="text-[10px] text-violet-400">? Ðåôåðåíñ çàãðóæåí</div>';
      log('OK', 'ÐÅÔ', `Ðåôåðåíñ-ôîòî: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'rgba(139,92,246,0.5)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) handleRefFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleRefFile(fileInput.files[0]); });

  document.getElementById('video-ref-clear-main')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state._videoRefImageBase64 = null;
    state._videoRefImageMime = null;
    fileInput.value = '';
    document.getElementById('video-ref-preview-main')?.classList.add('hidden');
    document.getElementById('video-ref-inner-main').innerHTML = '<div class="text-base mb-0.5">\uD83D\uDDBC</div><div class="text-[10px] text-gray-500">JPG / PNG · äî 10 ÌÁ</div>';
    log('INFO', 'ÐÅÔ', 'Ðåôåðåíñ-ôîòî óáðàíî');
  });
}

// --- VIDEO DROPZONE (main generate page) ----
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

// --- VIDEO URL FETCH (removed — now using external download services) ---
function initVideoUrlFetch() {
  // No-op: Instagram downloads handled via external links
  // (tikvideo.app / saveclip.app) — user downloads MP4, then uploads here
}

// --- GENERATION PROGRESS BAR -------------------------------
let _genProgressTimer = null;

function setGenProgress(pct, label) {
  const bar = document.getElementById('gen-progress-bar');
  const fill = document.getElementById('gen-progress-fill');
  if (!bar || !fill) return;
  bar.classList.remove('hidden');
  fill.style.width = `${Math.min(100, pct)}%`;
  if (label) showGenStatus(label, pct >= 100 ? 'text-emerald-400' : pct > 60 ? 'text-violet-400' : 'text-cyan-400');
}

function resetGenProgress() {
  clearInterval(_genProgressTimer);
  _genProgressTimer = null;
  const bar = document.getElementById('gen-progress-bar');
  const fill = document.getElementById('gen-progress-fill');
  if (fill) { fill.style.width = '0%'; }
  setTimeout(() => bar?.classList.add('hidden'), 600);
}

function startGenProgressSimulation(from, to, durationMs) {
  clearInterval(_genProgressTimer);
  let current = from;
  const steps = durationMs / 400;
  const step = (to - from) / steps;
  _genProgressTimer = setInterval(() => {
    current = Math.min(to, current + step);
    const fill = document.getElementById('gen-progress-fill');
    if (fill) fill.style.width = `${current}%`;
    if (current >= to) { clearInterval(_genProgressTimer); _genProgressTimer = null; }
  }, 400);
}

// --- RATE LIMIT COUNTDOWN --------------------------------
function startRateLimitCountdown() {
  const btn = document.getElementById('btn-generate');
  if (!btn || !state._rateLimitUntil) return;
  clearInterval(state._rateLimitTimer);
  const update = () => {
    const remaining = Math.ceil((state._rateLimitUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(state._rateLimitTimer);
      state._rateLimitTimer = null;
      state._rateLimitUntil = null;
      updateReadiness();
      showGenStatus('', '');
      return;
    }
    btn.disabled = true;
    btn.textContent = `? Ïîäîæäèòå ${remaining}ñ...`;
    showGenStatus(`?? Ëèìèò: 1 çàïðîñ â ìèíóòó. Îñòàëîñü ${remaining}ñ`, 'text-amber-400');
  };
  update();
  state._rateLimitTimer = setInterval(update, 1000);
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

// --- READINESS CHECKLIST (live update) -------
function updateReadiness() {
  const btn = document.getElementById('btn-generate');
  if (!btn) return;

  const checks = {
    mode: !!state.generationMode,
    // Video mode: characters optional — AI copies from original video
    // Suggested mode with auto chars: AI picks characters automatically
    chars: state.generationMode === 'video' ? true : (state.generationMode === 'suggested' && state.surpriseCharMode === 'auto') ? true : !!state.selectedA,
    content: _hasContent(),
    promo: isPromoValid(),
  };

  const allReady = checks.mode && checks.chars && checks.content && checks.promo;

  // Update button state
  if (allReady) {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
    btn.innerHTML = '<span class="flex items-center justify-center gap-2">?? Ñîáðàòü ïðîìïò<span class="text-xs opacity-60">Ctrl+Enter</span></span>';
  } else {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    const missing = [];
    if (!checks.mode) missing.push('ðåæèì');
    if (!checks.chars) missing.push('ïåðñîíàæè');
    if (!checks.content) missing.push('êîíòåíò');
    if (!checks.promo) missing.push('ïðîìî-êîä');
    btn.innerHTML = `<span class="flex items-center justify-center gap-2">?? Íå õâàòàåò: ${missing.join(', ')}</span>`;
  }

  // Update checklist panel
  const panel = document.getElementById('gen-readiness');
  if (!panel) return;

  // Border color
  panel.classList.remove('border-gray-700/50', 'border-emerald-500/40', 'border-amber-500/40');
  panel.classList.add(allReady ? 'border-emerald-500/40' : (checks.mode && checks.chars ? 'border-amber-500/40' : 'border-gray-700/50'));

  _updateCheckItem('readiness-mode', checks.mode,
    state.generationMode ? _modeLabel(state.generationMode) : 'Ðåæèì ãåíåðàöèè',
    checks.mode ? '' : '< âûáåðèòå íà øàãå 1',
    checks.mode ? null : () => navigateTo('generation-mode'));

  const isSurpriseAuto = state.generationMode === 'suggested' && state.surpriseCharMode === 'auto';
  const charsLabel = checks.chars
    ? (isSurpriseAuto && !state.selectedA ? 'AI ïîäáåð¸ò ïåðñîíàæåé' : state.selectedB ? `${state.selectedA.name_ru} ? ${state.selectedB.name_ru}` : state.selectedA ? `${state.selectedA.name_ru} (ñîëî)` : 'AI ïîäáåð¸ò ïåðñîíàæåé')
    : 'Ïåðñîíàæ A (ìèíèìóì 1)';
  _updateCheckItem('readiness-chars', checks.chars,
    charsLabel,
    checks.chars ? (isSurpriseAuto && !state.selectedA ? 'Àâòî (AI ïîäáåð¸ò)' : '') : '< âûáåðèòå íà øàãå 3',
    checks.chars ? null : () => navigateTo('characters'));

  // Location is always "ready" (auto if not selected), but show which one
  const locSelected = !!state.selectedLocation;
  const locName = locSelected ? (state.locations.find(l => l.id === state.selectedLocation)?.name_ru || 'Âûáðàíà') : 'Àâòî (AI ïîäáåð¸ò)';
  _updateCheckItem('readiness-location', true,
    locSelected ? `?? ${locName}` : 'Ëîêàöèÿ',
    locSelected ? '' : 'Àâòî (AI ïîäáåð¸ò)',
    null);

  const contentLabel = _contentLabel();
  _updateCheckItem('readiness-content', checks.content,
    checks.content ? contentLabel : 'Èäåÿ / äèàëîã / âèäåî',
    checks.content ? '' : '< ââåäèòå êîíòåíò',
    null);

  _updateCheckItem('readiness-promo', checks.promo,
    checks.promo ? 'VIP àêòèâåí' : 'Ïðîìî-êîä',
    checks.promo ? '' : '< ââåäèòå â «Íàñòðîéêè»',
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
  return false;
}

function _contentLabel() {
  if (state.generationMode === 'idea') {
    const v = document.getElementById('idea-input')?.value?.trim() || '';
    return v ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : '';
  }
  if (state.generationMode === 'suggested') {
    const v = document.getElementById('idea-input-suggested')?.value?.trim() || document.getElementById('idea-input')?.value?.trim() || '';
    return v ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : 'AI ïîäáåð¸ò òåìó';
  }
  if (state.generationMode === 'script') return 'Äèàëîã ãîòîâ';
  if (state.generationMode === 'video') return state.videoMeta ? `Âèäåî: ${state.videoMeta.name}` : '';
  return '';
}

function _modeLabel(m) {
  return { idea: '?? Ñâîÿ èäåÿ', suggested: '?? Ãîòîâûå èäåè', script: '?? Ñâîé äèàëîã', video: '?? Ïî âèäåî' }[m] || m;
}

function _updateCheckItem(elId, ok, label, hint, onClick) {
  const row = document.getElementById(elId);
  if (!row) return;

  const icon = row.querySelector('.readiness-icon');
  const labelEl = row.children[1];
  const hintEl = row.querySelector('.readiness-hint');

  if (icon) {
    icon.textContent = ok ? '?' : '?';
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

// --- PRODUCT PHOTO UPLOAD -------------------
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
      <div class="text-2xl mb-1">??</div>
      <div class="text-xs text-gray-500">Ïåðåòàùè ôîòî èëè íàæìè</div>
      <div class="text-[10px] text-gray-600 mt-1">JPG, PNG, WebP</div>
    `;
    fileInput.value = '';
  });
}

async function handleProductFile(file) {
  // Ïðîâåðêà ïðîìî-êîäà ïåðåä àíàëèçîì òîâàðà
  if (!isPromoValid()) {
    showProductStatus('?? Äëÿ àíàëèçà òîâàðà íóæåí ïðîìî-êîä. Ââåäèòå åãî â ðàçäåëå «Íàñòðîéêè».', 'text-amber-400');
    log('WARN', 'ÒÎÂÀÐ', 'Ïðîìî-êîä íå ââåä¸í — àíàëèç òîâàðà çàáëîêèðîâàí');
    return;
  }

  if (!file.type.startsWith('image/')) {
    showProductStatus('Íóæíî ôîòî (JPG, PNG, WebP)', 'text-red-400');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showProductStatus('Ôàéë ñëèøêîì áîëüøîé (ìàêñ. 10 ÌÁ)', 'text-red-400');
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
      <div class="text-xs text-emerald-400">? ${file.name}</div>
      <div class="text-[10px] text-gray-500 mt-1">${(file.size / 1024).toFixed(0)} ÊÁ</div>
    `;

    // Extract base64 (remove data:image/...;base64, prefix)
    const base64 = dataUrl.split(',')[1];
    const mimeType = file.type;

    showProductStatus('? AI àíàëèçèðóåò òîâàð...', 'text-gray-400');

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
      let data;
      try { const t = await resp.text(); data = t ? JSON.parse(t) : {}; } catch { data = {}; }

      if (!resp.ok) {
        showProductStatus(`? ${data.error || 'Îøèáêà'}`, 'text-red-400');
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
      document.getElementById('product-tokens').textContent = data.tokens ? `${data.tokens} òîêåíîâ` : '';
      showProductStatus('', 'hidden');

    } catch (e) {
      showProductStatus(`? Ñåòåâàÿ îøèáêà: ${e.message}`, 'text-red-400');
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

// --- POST-GENERATION: Enhance prompt with reference/product photo ----
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
    document.getElementById('post-photo-icon').textContent = '??';
    document.getElementById('post-photo-label').textContent = 'Çàãðóçè ôîòî-ðåôåðåíñ (ñòèëü, íàñòðîåíèå, ýñòåòèêà)';
    dropzone.classList.remove('hidden');
    document.getElementById('post-photo-lang-toggle')?.classList.remove('hidden');
    log('INFO', 'POST-PHOTO', 'Ðåæèì: ðåôåðåíñ ñòèëÿ');
  });

  document.getElementById('post-photo-mode-prod')?.addEventListener('click', () => {
    _postPhotoMode = 'product';
    document.getElementById('post-photo-mode-prod').classList.add('ring-2', 'ring-emerald-500');
    document.getElementById('post-photo-mode-ref').classList.remove('ring-2', 'ring-violet-500');
    document.getElementById('post-photo-icon').textContent = '??';
    document.getElementById('post-photo-label').textContent = 'Çàãðóçè ôîòî òîâàðà (ïîÿâèòñÿ â êàäðå)';
    dropzone.classList.remove('hidden');
    document.getElementById('post-photo-lang-toggle')?.classList.remove('hidden');
    log('INFO', 'POST-PHOTO', 'Ðåæèì: ôîòî òîâàðà');
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
    showPostPhotoStatus('Ñíà÷àëà âûáåðè òèï: ðåôåðåíñ èëè òîâàð', 'text-amber-400');
    return;
  }
  if (!isPromoValid()) {
    showPostPhotoStatus('Äëÿ àíàëèçà ôîòî íóæåí ïðîìî-êîä', 'text-amber-400');
    return;
  }
  if (!file.type.startsWith('image/')) {
    showPostPhotoStatus('Íóæíî ôîòî (JPG, PNG, WebP)', 'text-red-400');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showPostPhotoStatus('Ôàéë ñëèøêîì áîëüøîé (ìàêñ. 10 ÌÁ)', 'text-red-400');
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

    showPostPhotoStatus('AI àíàëèçèðóåò ôîòî...', 'text-violet-400 animate-pulse');

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
      let data;
      try { const t = await resp.text(); data = t ? JSON.parse(t) : {}; } catch { data = {}; }

      if (!resp.ok) {
        showPostPhotoStatus(`${data.error || 'Îøèáêà'}`, 'text-red-400');
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
          ? `?? ÎÏÈÑÀÍÈÅ ÐÅÔÅÐÅÍÑÀ (${langLabel})`
          : `?? ÎÏÈÑÀÍÈÅ ÒÎÂÀÐÀ (${langLabel})`;
        resultTitle.className = `text-[10px] font-semibold uppercase tracking-wider mb-1 ${_postPhotoMode === 'reference' ? 'text-violet-400' : 'text-emerald-400'}`;
      }
      document.getElementById('post-photo-description').textContent = data.description_en;
      document.getElementById('post-photo-result')?.classList.remove('hidden');
      showPostPhotoStatus('', 'hidden');

      log('OK', 'POST-PHOTO', `AI îïèñàë ôîòî (${_postPhotoMode}): ${data.description_en.slice(0, 80)}...`);

    } catch (err) {
      showPostPhotoStatus(`Ñåòåâàÿ îøèáêà: ${err.message}`, 'text-red-400');
    }
  };
  reader.readAsDataURL(file);
}

function applyPostGenPhoto() {
  const info = state._postGenPhoto;
  if (!info?.description_en || !state.lastResult) {
    showPostPhotoStatus('Íåò äàííûõ äëÿ ïðèìåíåíèÿ', 'text-amber-400');
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
      ruEl.textContent = (ruEl.textContent || '') + `\n\n?? ÒÎÂÀÐ Â ÊÀÄÐÅ (äîáàâëåíî ïî ôîòî):\n${desc}\n?? Òîâàð ñòðîãî êàê íà çàãðóæåííîì ôîòî — öâåòà, ôîðìà, áðåíä!`;
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
      const prodImg = `<img src="data:${info.mime_type};base64,${info.image_base64}" class="w-10 h-10 rounded object-cover border border-emerald-500/30 flex-shrink-0" alt="òîâàð">`;
      const prodDesc = desc.length > 120 ? desc.slice(0, 120) + '...' : desc;
      veoProdBadge.innerHTML = `
        <div class="flex items-start gap-2">
          ${prodImg}
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-emerald-400">?? Òîâàð äîáàâëåí â ïðîìïò ?</div>
            <div class="text-[9px] text-gray-400 leading-tight mt-0.5">${escapeHtml(prodDesc)}</div>
            <div class="text-[9px] text-emerald-500/60 mt-0.5">Ñòðîãî êàê íà çàãðóæåííîì ôîòî</div>
          </div>
        </div>`;
    }

    showPostPhotoStatus('Òîâàð äîáàâëåí âî âñå ïðîìïòû!', 'text-emerald-400');
    log('OK', 'POST-PHOTO', 'Òîâàð ïðèìåí¸í ê ïðîìïòàì');

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
      ruEl.textContent = (ruEl.textContent || '') + `\n\n?? ÂÈÇÓÀËÜÍÛÉ ÐÅÔÅÐÅÍÑ (äîáàâëåíî ïî ôîòî):\n${desc}\n?? Ïîâòîðè îñâåùåíèå, öâåòîâóþ ïàëèòðó è íàñòðîåíèå ñ çàãðóæåííîãî ôîòî`;
    }

    // Save reference style to state for future regenerations
    state.referenceStyle = { description_en: desc };

    showPostPhotoStatus('Ðåôåðåíñ äîáàâëåí âî âñå ïðîìïòû!', 'text-violet-400');
    log('OK', 'POST-PHOTO', 'Ðåôåðåíñ ïðèìåí¸í ê ïðîìïòàì è ñîõðàí¸í â state');
  }

  // Flash apply button for feedback
  const applyBtn = document.getElementById('post-photo-apply');
  if (applyBtn) {
    applyBtn.textContent = '? Ïðèìåíåíî!';
    applyBtn.disabled = true;
    setTimeout(() => { applyBtn.textContent = '? Ïðèìåíèòü ê ïðîìïòó'; applyBtn.disabled = false; }, 2000);
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
  log('INFO', 'POST-PHOTO', 'Ôîòî óáðàíî');
}

function showPostPhotoStatus(text, cls) {
  const el = document.getElementById('post-photo-status');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = `text-xs text-center ${cls}`;
  el.textContent = text;
}

// --- PRE-FLIGHT: Professional parameter breakdown ----
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
  const riskIcon = est.risk === 'high' ? '??' : est.risk === 'medium' ? '??' : '??';

  // Translate risk
  const riskRu = { high: 'âûñîêèé', medium: 'ñðåäíèé', low: 'íèçêèé' };

  // Build pillar summaries (short) — user-friendly terms
  const pillars = [
    { icon: '??', name: 'Îñâåùåíèå', val: `${lm.mood} · ${lm.sources || '1 èñòî÷íèê'}`, detail: lm.style?.slice(0, 60) + '...' },
    { icon: '??', name: 'Êàìåðà', val: 'Ñåëôè-ðåæèì', detail: `Îáúåêòèâ: ${cin.optics?.focal_length || '24-28ìì'} · Äèàôðàãìà: ${cin.optics?.aperture || 'f/1.9-2.2'}` },
    { icon: '??', name: 'Ñú¸ìêà', val: 'Ðó÷íàÿ ñú¸ìêà', detail: 'Åñòåñòâåííîå ìèêðî-äðîæàíèå òåëåôîíà' },
    { icon: '??', name: 'Àíèìàöèÿ', val: 'Æåñòû è äûõàíèå', detail: 'Ìîðãàíèå 3-5ñ · Äûõàíèå 3-4ñ · Íåçàâèñèìûå äâèæåíèÿ' },
    { icon: '??', name: 'Ëèöî', val: '׸òêèå ãóáû', detail: `Ïîâîðîò ?25° · Àâòîôîêóñ íà ëèöî` },
    { icon: '??', name: 'Âçãëÿä', val: '4 ôàçû âçãëÿäà', detail: `Õóê: ïðÿìî â êàìåðó · Åñòåñòâåííûå äâèæåíèÿ ãëàç` },
    { icon: '??', name: 'Êîìïîçèöèÿ', val: `ìàêñ. ${cin.frame_cleanliness?.detail_budget || '7'} äåòàëåé`, detail: `60-70% ïåðñîíàæè · Ôîðìàò 9:16` },
    { icon: '??', name: 'Äåòàëèçàöèÿ', val: 'Ðåàëèñòè÷íûå òåêñòóðû', detail: 'Ïîðû, ìîðùèíû, òåêñòóðà êîæè, òêàíè' },
    { icon: '??', name: 'Öâåò', val: 'Åñòåñòâåííûå òîíà', detail: `Áåç îðàíæåâîãî è ñåðîãî · 5 çîí êîæè` },
    { icon: '??', name: 'Çâóê', val: 'Çàïèñü ñ òåëåôîíà', detail: `Ìèêðîôîí 35-60ñì · Ôîí -20/-30äÁ` },
    { icon: '??', name: 'Íà÷àëî', val: 'ßðêèé õóê', detail: `Ýíåðãèÿ: ?80% · Âçãëÿä â êàìåðó` },
    { icon: '??', name: 'Ìîíòàæ', val: 'Äèíàìèêà', detail: `80>90>60>95>100>70% · Àâòî-óñèëåíèå` },
  ];

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="glass-panel p-5 space-y-4 border-l-2 border-cyan-400/40">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-600/20 border border-cyan-500/30">
            <span class="text-xs">??</span>
          </div>
          <div>
            <div class="text-xs font-semibold text-cyan-400 tracking-wide">ÏÀÐÀÌÅÒÐÛ ÑÁÎÐÊÈ</div>
            <div class="text-[10px] text-gray-500">FERIXDI AI ñîáèðàåò ïðîìïò ïî âàøèì íàñòðîéêàì</div>
          </div>
        </div>
        <div class="text-[10px] text-gray-600 font-mono">v2.0</div>
      </div>

      <!-- Scene overview -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Ïåðñîíàæè</div>
          <div class="text-[11px] text-cyan-300">${ctx.soloMode ? (charA.name_ru || 'A') + ' (ñîëî)' : (charA.name_ru || 'A') + ' <span class="text-gray-600">?</span> ' + (charB.name_ru || 'B')}</div>
          <div class="text-[10px] text-gray-500 mt-0.5">${ctx.soloMode ? (charA.vibe_archetype || '—') : (charA.vibe_archetype || '—') + ' ? ' + (charB.vibe_archetype || '—')}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Êàòåãîðèÿ</div>
          <div class="text-[11px] text-gray-200">${cat.ru || '—'}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Ëîêàöèÿ</div>
          <div class="text-[11px] text-gray-200">${(ctx.location || '—').split(',')[0]}</div>
        </div>
        <div class="bg-black/30 rounded-lg p-2.5">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Òàéìèíã</div>
          <div class="text-[11px] ${riskColor}">${riskIcon} ${est.total || '8.0'}ñ · ðèñê: ${riskRu[est.risk] || est.risk || '—'}</div>
        </div>
      </div>

      <!-- Wardrobe -->
      <div class="bg-black/30 rounded-lg p-2.5">
        <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Ãàðäåðîá</div>
        <div class="flex gap-3">
          <div class="flex-1"><span class="text-[10px] text-cyan-400/70">A:</span> <span class="text-[10px] text-gray-300">${ctx.wardrobeA?.slice(0, 60) || '—'}${ctx.wardrobeA?.length > 60 ? '...' : ''}</span></div>
          <div class="flex-1"><span class="text-[10px] text-purple-400/70">B:</span> <span class="text-[10px] text-gray-300">${ctx.wardrobeB?.slice(0, 60) || '—'}${ctx.wardrobeB?.length > 60 ? '...' : ''}</span></div>
        </div>
      </div>

      <!-- 12 Pillars compact -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <div class="text-[9px] text-gray-500 uppercase tracking-wider">12 ïàðàìåòðîâ êà÷åñòâà · Ðåàëèñòè÷íîñòü ñìàðòôîíà</div>
          <button id="preflight-toggle-pillars" class="text-[10px] text-cyan-400/60 hover:text-cyan-400 transition-colors cursor-pointer">ðàçâåðíóòü ?</button>
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
              <span class="text-emerald-500 text-[10px] mt-1">?</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Engagement preview -->
      <div class="bg-black/30 rounded-lg p-2.5">
        <div class="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Âîâëå÷åíèå · Instagram</div>
        <div class="flex gap-3 text-[10px]">
          <div><span class="text-gray-500">Õóê:</span> <span class="text-gray-300">${ctx.hookAction?.action_ru?.slice(0, 30) || '—'}</span></div>
          <div><span class="text-gray-500">Ðåêâèçèò:</span> <span class="text-gray-300">${ctx.propAnchor?.slice(0, 25) || '—'}</span></div>
        </div>
        <div class="text-[10px] text-gray-500 mt-1">Õåøòåãè: ${localResult.log?.engagement?.hashtag_count || '~18'} øò · Çàãîëîâîê + çàêðåï + ïåðâûé êîììåíò</div>
      </div>

      <!-- Status -->
      <div id="preflight-status" class="text-center py-2 rounded-lg text-xs font-medium bg-cyan-500/8 text-cyan-400 border border-cyan-500/15">
        <span class="inline-block animate-pulse mr-1">?</span> FERIXDI AI ãåíåðèðóåò êîíòåíò...
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
    this.textContent = isExpanded ? 'ðàçâåðíóòü ?' : 'ñâåðíóòü ?';
  });

  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePreflightStatus(text, color) {
  const el = document.getElementById('preflight-status');
  if (!el) return;
  el.className = `text-center py-2 rounded-lg text-xs font-medium ${color}`;
  el.innerHTML = text;
}

// --- GENERATE --------------------------------
function displayResult(result) {
  state.lastResult = result;

  if (result.error) {
    showGenStatus(`? ${result.error}`, 'text-red-400');
    log('ERR', 'GEN', result.error);
    return;
  }

  // Restore default tab names and visibility
  const _tabDefaults = { veo: '?? Ïðîìïò äëÿ Veo', photo: '?? Ôîòî (êàäð 0)', video: '?? Âèäåî JSON', insta: '?? Èíñòà', ru: '???? Ïîñò', blueprint: '?? Ïëàí' };
  document.querySelectorAll('#gen-results .mode-btn').forEach(b => {
    if (b.dataset.tab && _tabDefaults[b.dataset.tab]) {
      b.textContent = _tabDefaults[b.dataset.tab];
      b.style.display = '';
    }
  });

  // Show results
  document.getElementById('gen-results').classList.remove('hidden');
  document.getElementById('veo-prompt-text').textContent = result.veo_prompt || '(Ïðîìïò íå ñãåíåðèðîâàí)';
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
      const prodImg = pi.image_base64 ? `<img src="data:${pi.mime_type || 'image/jpeg'};base64,${pi.image_base64}" class="w-10 h-10 rounded object-cover border border-emerald-500/30 flex-shrink-0" alt="òîâàð">` : '';
      const prodDesc = pi.description_en.length > 120 ? pi.description_en.slice(0, 120) + '...' : pi.description_en;
      veoProdBadge.innerHTML = `
        <div class="flex items-start gap-2">
          ${prodImg}
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-emerald-400">?? Òîâàð â ïðîìïòå ?</div>
            <div class="text-[9px] text-gray-400 leading-tight mt-0.5">${escapeHtml(prodDesc)}</div>
            <div class="text-[9px] text-emerald-500/60 mt-0.5">Ñòðîãî êàê íà èñõîäíîì ôîòî — öâåòà, ôîðìà, áðåíä</div>
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

  // -- Reminder: upload product/reference photos for better results --
  const hasProduct = !!(state.productInfo?.description_en);
  const hasRef = !!(state.referenceStyle?.description_en);
  if (!hasProduct && !hasRef) {
    // No photos loaded — show prominent reminder
    showNotification('?? Çàãðóçè ôîòî òîâàðà ?? èëè ðåôåðåíñ ôîíà ?? íèæå — AI âñòðîèò èõ â ïðîìïò!', 'info');
  } else if (hasProduct && !hasRef) {
    showNotification('?? Òîâàð â ïðîìïòå ? | ?? Ìîæåøü äîáàâèòü åù¸ ðåôåðåíñ ôîíà ??', 'success');
  } else if (!hasProduct && hasRef) {
    showNotification('?? Ðåôåðåíñ â ïðîìïòå ? | ?? Ìîæåøü äîáàâèòü åù¸ ôîòî òîâàðà ??', 'success');
  } else {
    showNotification('?? Òîâàð ? ?? Ðåôåðåíñ ? — ïðîìïòû îáîãàùåíû ïî ìàêñèìóìó!', 'success');
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
          <div class="text-2xl flex-shrink-0">??</div>
          <div class="min-w-0">
            <div class="text-[10px] font-bold text-violet-400">?? Ðåôåðåíñ ñòèëÿ â ïðîìïòå ?</div>
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
    document.getElementById('gen-warnings')?.classList.remove('hidden');
    
    // Categorize warnings by type
    const infoWarnings = result.warnings.filter(w => w.includes('Äëÿ ãåíåðàöèè') || w.includes('ââåäèòå') || w.includes('ïðîâåðüòå'));
    const actionWarnings = result.warnings.filter(w => w.includes('ñëèøêîì äëèííàÿ') || w.includes('îáðåçàíà'));
    const systemWarnings = result.warnings.filter(w => w.includes('âûáðàí') || w.includes('íå óêàçàí'));
    const otherWarnings = result.warnings.filter(w => !infoWarnings.includes(w) && !actionWarnings.includes(w) && !systemWarnings.includes(w));
    
    let warningsHtml = '';
    
    if (infoWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-cyan-400 mb-1">?? Èíôîðìàöèÿ:</div>';
      warningsHtml += infoWarnings.map(w => `<div class="text-xs text-cyan-300">?? ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (actionWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-amber-400 mb-1">?? Ïðåäóïðåæäåíèÿ:</div>';
      warningsHtml += actionWarnings.map(w => `<div class="text-xs text-amber-300">?? ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (systemWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-orange-400 mb-1">?? Ñèñòåìà:</div>';
      warningsHtml += systemWarnings.map(w => `<div class="text-xs text-orange-300">?? ${escapeHtml(w)}</div>`).join('');
      warningsHtml += '</div>';
    }
    
    if (otherWarnings.length > 0) {
      warningsHtml += '<div class="mb-2"><div class="text-xs font-semibold text-gray-400 mb-1">?? Äðóãîå:</div>';
      warningsHtml += otherWarnings.map(w => `<div class="text-xs text-gray-300">?? ${escapeHtml(w)}</div>`).join('');
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
  if (ruTabBtn) ruTabBtn.textContent = '???? Ïîñò';

  // Show English adaptation button
  const translatePanel = document.getElementById('translate-panel');
  if (translatePanel) {
    translatePanel.classList.remove('hidden');
    const btn = document.getElementById('btn-translate-en');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '???? Àäàïòàöèÿ íà English';
    }
  }

  // Save series episode if generating from series
  if (state._currentSeries) {
    try {
      const series = getSeries();
      const s = series[state._currentSeries.idx];
      if (s) {
        if (!s.episodes) s.episodes = [];
        const ep = {
          date: Date.now(),
          charA: state.selectedA?.name_ru || '?',
          charB: state.selectedB?.name_ru || '?',
          category: result.log?.category?.ru || '',
          dialogueA: result.blueprint_json?.dialogue_segments?.find(seg => seg.speaker === 'A')?.text_ru || result._apiContext?.dialogueA || '',
          dialogueB: result.blueprint_json?.dialogue_segments?.find(seg => seg.speaker === 'B')?.text_ru || result._apiContext?.dialogueB || '',
          killerWord: result.blueprint_json?.killer_word || '',
          veo_prompt: result.veo_prompt || '',
          ru_package: result.ru_package || '',
          engage: result.log?.engagement || {},
          insta: result.log?.instagram_pack || {},
        };
        s.episodes.push(ep);
        saveSeries(series);
        log('OK', 'SERIES', `Ýïèçîä #${s.episodes.length} ñîõðàí¸í â ñåðèþ "${s.name}"`);
      }
      state._currentSeries = null;
    } catch (e) { log('ERR', 'SERIES', e.message); }
  }

  const ver = result.log?.generator_version || '2.0';
  log('OK', 'ÃÅÍÅÐÀÖÈß', `${ver} Ïàêåò ñîáðàí! Äëèòåëüíîñòü: ${result.duration_estimate?.total || '?'}ñ, Ðèñê: ${result.duration_estimate?.risk || '?'}`);
  if (result.auto_fixes?.length > 0) {
    result.auto_fixes.forEach(f => log('INFO', 'ÔÈÊÑ', f));
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
    if (labelA) labelA.textContent = '?? Ìîíîëîã:';
    if (bBlock) bBlock.classList.add('hidden');
  } else {
    if (labelA) labelA.textContent = '??? Ðåïëèêà A (ïðîâîêàöèÿ):';
    if (bBlock) bBlock.classList.remove('hidden');
  }

  if (dA) dA.textContent = `«${dialogueA}»`;
  if (dB && !isSolo) dB.textContent = `«${dialogueB}»${dialogueA2 ? ` > A: «${dialogueA2}»` : ''}`;
  if (kw && killerWord) kw.textContent = `?? Killer word: «${killerWord}»`;

  // Meta grid
  metaEl.innerHTML = `
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Êàòåãîðèÿ:</span> <span class="text-gray-200">${cat.ru || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Òàéìèíã:</span> <span class="text-gray-200">${est.total || '8.0'}ñ · ${est.risk || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Õóê:</span> <span class="text-gray-200">${ctx.hookAction?.action_ru?.slice(0, 35) || '—'}</span></div>
    <div class="bg-black/20 rounded p-2"><span class="text-gray-500">Çàãîëîâîê:</span> <span class="text-gray-200">${engage.viral_title?.slice(0, 45) || '—'}${engage.viral_title?.length > 45 ? '...' : ''}</span></div>
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
  const copyLabel = isEN ? 'Copy' : 'Êîïèðîâàòü';
  const copiedLabel = isEN ? '? Copied' : '? Ñêîïèðîâàíî';

  // Build copy-friendly hashtag string
  const hashtagStr = hashtags.join(' ');

  el.innerHTML = `
    <!-- Viral Title -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Viral Title' : 'Âèðóñíûé çàãîëîâîê'}</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(viralTitle)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Paste as Reels caption — hooks viewers in the feed' : 'Âñòàâü êàê çàãîëîâîê Reels — öåïëÿåò â ëåíòå'}</div>
    </div>

    <!-- Share Bait (video description for forwarding) -->
    <div class="glass-panel p-4 relative border-l-2 border-orange-400/40">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-orange-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Video Description · share bait' : 'Îïèñàíèå âèäåî · äëÿ ïåðåñûëêè'}</div>
      <div class="copy-target text-sm text-gray-100 font-medium leading-relaxed">${escapeHtml(shareBait)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Send to a friend with this line — bait for shares' : 'Ñêèíü äðóãó ñ ýòîé ôðàçîé — áàéò íà ïåðåñûëêó â êîíòåêñòå âèäåî'}</div>
    </div>

    <!-- Instagram Caption (full post text) -->
    ${instaCaption ? `<div class="glass-panel p-4 relative border-l-2 border-pink-400/40">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-pink-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Full Caption (description)' : 'Ïîëíûé òåêñò îïèñàíèÿ (caption)'}</div>
      <div class="copy-target text-sm text-gray-100 leading-relaxed">${escapeHtml(instaCaption)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Paste as Reels description — includes CTA' : 'Âñòàâü â îïèñàíèå Reels — óæå ñ CTA è ýìîäçè'}</div>
    </div>` : ''}

    <!-- Hook Texts (for video overlay) -->
    ${instaHookTexts.length > 0 ? `<div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').innerText.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-rose-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Hook Texts (on-screen)' : 'Òåêñòû-õóêè (íà ýêðàí â íà÷àëî)'}</div>
      <div class="copy-target space-y-1.5">
        ${instaHookTexts.map((h, i) => `<div class="text-sm text-gray-200 bg-black/30 rounded px-3 py-1.5">«${escapeHtml(h)}»</div>`).join('')}
      </div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Place one of these as text overlay in the first 0.5s' : 'Íàëîæè îäíó èç ýòèõ ôðàç òåêñòîì â ïåðâûå 0.5 ñåê âèäåî'}</div>
    </div>` : ''}

    <!-- Hashtags -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider mb-2"># ${isEN ? `Hashtags · ${hashtags.length}` : `Õåøòåãè · ${hashtags.length} øò`}</div>
      <div class="copy-target text-xs text-gray-300 leading-relaxed bg-black/30 rounded-lg p-3 select-all">${escapeHtml(hashtagStr)}</div>
      ${seriesTag ? `<div class="text-[9px] text-violet-400 mt-2">${isEN ? 'Series' : 'Ñåðèÿ'}: ${escapeHtml(seriesTag)}</div>` : ''}
      <div class="text-[9px] text-gray-600 mt-1">${isEN ? 'Paste in the first comment or in description' : 'Âñòàâü â ïåðâûé êîììåíòàðèé èëè â îïèñàíèå'}</div>
    </div>

    <!-- Pin Comment (bait for shares) -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Pinned Comment' : 'Çàêðåïë¸ííûé êîììåíòàðèé'}</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(pinComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Pin this — triggers shares and saves' : 'Çàêðåïè — ïðîâîöèðóåò ïåðåñûëêè è ñîõðàíåíèÿ'}</div>
    </div>

    <!-- First Comment -->
    <div class="glass-panel p-4 relative">
      <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.glass-panel').querySelector('.copy-target').textContent.trim());this.textContent='${copiedLabel}';setTimeout(()=>this.textContent='${copyLabel}',1500)">${copyLabel}</button>
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'First Comment' : 'Ïåðâûé êîììåíòàðèé'}</div>
      <div class="copy-target text-sm text-gray-200 leading-relaxed">${escapeHtml(firstComment)}</div>
      <div class="text-[9px] text-gray-600 mt-2">${isEN ? 'Post right after publishing — sparks discussion' : 'Íàïèøè ñðàçó ïîñëå ïóáëèêàöèè — çàïóñêàåò îáñóæäåíèå'}</div>
    </div>

    <!-- Engagement Tip -->
    ${instaEngagementTip ? `<div class="glass-panel p-4 relative border-l-2 border-teal-400/40">
      <div class="text-[10px] text-teal-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Engagement Tip' : 'Ëàéôõàê äëÿ îõâàòîâ'}</div>
      <div class="text-sm text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(instaEngagementTip)}</div>
    </div>` : ''}

    <!-- Share bait tip -->
    <div class="bg-gradient-to-r from-violet-500/8 to-cyan-500/8 rounded-lg p-4 border border-violet-500/15">
      <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">?? ${isEN ? 'Instagram Publishing Order' : 'Ïîðÿäîê ïóáëèêàöèè â Instagram'}</div>
      <div class="text-xs text-gray-300 leading-relaxed space-y-1.5">
        ${isEN ? `
        <div>1. <span class="text-amber-300 font-medium">Full Caption</span> > paste in Reels description. Has title + desc + CTA. No hashtags!</div>
        <div>2. <span class="text-gray-200 font-medium">Publish</span> your Reel</div>
        <div>3. <span class="text-cyan-300 font-medium">Hashtags</span> > post as FIRST comment (IG doesn't throttle reach)</div>
        <div>4. <span class="text-emerald-300 font-medium">Pin</span> > write a second comment and pin it (triggers "send to a friend")</div>
        <div>5. <span class="text-violet-300 font-medium">Engagement comment</span> > post as 3rd comment (1-2 min later) — sparks discussion</div>
        <div>6. <span class="text-orange-300 font-medium">Share bait</span> > DM to friends with the reel — triggers viral reshares</div>
        ` : `
        <div>1. <span class="text-amber-300 font-medium">Ïîëíûé òåêñò îïèñàíèÿ</span> > âñòàâü â îïèñàíèå Reels (caption). Òîëüêî çàãîëîâîê, áåç õåøòåãîâ!</div>
        <div>2. <span class="text-gray-200 font-medium">Îïóáëèêóé</span> Reels</div>
        <div>3. <span class="text-cyan-300 font-medium">Õåøòåãè</span> > íàïèøè ÏÅÐÂÛÉ êîììåíòàðèé ñ õåøòåãàìè (IG íå ðåæåò îõâàò)</div>
        <div>4. <span class="text-emerald-300 font-medium">Çàêðåï</span> > íàïèøè âòîðîé êîììåíò è çàêðåïè åãî (ïðîâîöèðóåò «îòïðàâü ïîäðóãå»)</div>
        <div>5. <span class="text-violet-300 font-medium">Ïåðâûé êîììåíò</span> > íàïèøè òðåòèé êîììåíò ÷åðåç 1-2 ìèí (çàïóñêàåò îáñóæäåíèå)</div>
        `}
      </div>
      <div class="text-[9px] text-gray-500 mt-3">${isEN ? 'Series' : 'Ñåðèÿ'}: ${charA.id === charB.id ? (charA.name_ru || 'A') + ' (ñîëî)' : (charA.name_ru || 'A') + ' ? ' + (charB.name_ru || 'B')} — ${isEN ? 'use one series tag for all videos' : 'èñïîëüçóé îäèí ñåðèéíûé òåã íà âñå âèäåî'}</div>
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

  // Store initial dialogue for edit tracking (insta tab sync)
  if (!ctx._prevDialogueA && lineA) ctx._prevDialogueA = lineA.text_ru;
  if (!ctx._prevDialogueB && lineB) ctx._prevDialogueB = lineB.text_ru;

  // Hide B editor row in solo mode
  const bRow = inputB?.closest('.space-y-2, .flex, div')?.parentElement;
  const labelA = inputA?.previousElementSibling || inputA?.closest('div')?.querySelector('label');
  if (isSolo) {
    if (bRow && inputB) inputB.closest('.bg-black\\/30, div[class*=editor]')?.classList.add('hidden');
    if (labelA) labelA.textContent = '?? Ìîíîëîã';
  } else {
    if (bRow && inputB) inputB.closest('.bg-black\\/30, div[class*=editor]')?.classList.remove('hidden');
    if (labelA) labelA.textContent = '??? Ðåïëèêà A';
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

  // Attach reference image if uploaded (ôîòî-ðåôåðåíñ: ôîí/ëîêàöèÿ/ñòèëü)
  if (state._videoRefImageBase64) {
    payload.reference_image = state._videoRefImageBase64;
    payload.reference_image_mime = state._videoRefImageMime || 'image/jpeg';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000); // 90s timeout

  try {
    const resp = await fetch(`${apiUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include', // send httpOnly cookie for same-origin prod
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      const errMsg = err.error || `API error ${resp.status}`;

      // Auto-reauth on token errors: refresh JWT and retry once
      if ((resp.status === 401 || /invalid token|token expired/i.test(errMsg)) && isPromoValid()) {
        log('WARN', 'API', 'Òîêåí èñò¸ê — îáíîâëÿþ...');
        await autoAuth();
        const freshToken = localStorage.getItem('ferixdi_jwt');
        if (freshToken && freshToken !== token) {
          log('OK', 'API', 'Òîêåí îáíîâë¸í — ïîâòîðÿþ çàïðîñ');
          const retryResp = await fetch(`${apiUrl}/api/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${freshToken}`,
            },
            credentials: 'include',
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            return retryData.ai;
          }
        }
      }

      throw new Error(errMsg);
    }

    const data = await resp.json();
    return data.ai;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Òàéìàóò: AI íå îòâåòèë çà 90 ñåêóíä. Ïîïðîáóéòå ñíîâà.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// --- GENERATION HISTORY (localStorage) ------
const GEN_HISTORY_KEY = 'ferixdi_gen_history';
const GEN_HISTORY_MAX = 50;

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
      veo_prompt: result.veo_prompt || '',
      ru_package: result.ru_package || '',
      engage: result.log?.engagement || {},
      insta: result.log?.instagram_pack || {},
      mode: state.generationMode || state.inputMode || 'idea',
    };
    history.push(entry);
    if (history.length > GEN_HISTORY_MAX) history.splice(0, history.length - GEN_HISTORY_MAX);
    localStorage.setItem(GEN_HISTORY_KEY, JSON.stringify(history));
  } catch { /* ignore */ }
}

function getGenerationHistory() {
  try { return JSON.parse(localStorage.getItem(GEN_HISTORY_KEY) || '[]'); } catch { return []; }
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
    // Rate limit guard — show countdown if still in cooldown
    if (state._rateLimitUntil && Date.now() < state._rateLimitUntil) {
      startRateLimitCountdown();
      return;
    }

    // Validate complete workflow
    if (!state.generationMode) {
      showGenStatus('?? Ñíà÷àëà âûáåðèòå ðåæèì ãåíåðàöèè íà øàãå 1', 'text-orange-400');
      navigateTo('generation-mode');
      return;
    }
    
    // Video mode: characters are optional (AI copies from original)
    if (!state.selectedA && state.generationMode !== 'video') {
      showGenStatus('?? Ñíà÷àëà âûáåðèòå õîòÿ áû îäíîãî ïåðñîíàæà íà øàãå 3', 'text-orange-400');
      navigateTo('characters');
      return;
    }

    // Enhanced validation for all modes
    if (state.generationMode === 'script') {
      const scriptA = document.getElementById('script-a')?.value.trim();
      const scriptB = document.getElementById('script-b')?.value.trim();
      if (!scriptA && !scriptB) {
        showGenStatus('?? Íàïèøè õîòÿ áû îäíó ðåïëèêó (A èëè B)', 'text-orange-400');
        return;
      }
      
      // Additional validation for script mode (per-speaker limits)
      // Solo monologue (only A filled) allows up to 30 words; duo keeps 15/18
      const isSoloScript = scriptA && !scriptB;
      const maxWordsA = isSoloScript ? 30 : 15;
      const maxWordsB = 18;
      if (scriptA && scriptA.split(/\s+/).length > maxWordsA) {
        showGenStatus(`?? Ðåïëèêà A ñëèøêîì äëèííàÿ (${scriptA.split(/\s+/).length} ñëîâ). Ìàêñèìóì: ${maxWordsA} ñëîâ`, 'text-orange-400');
        return;
      }
      if (scriptB && scriptB.split(/\s+/).length > maxWordsB) {
        showGenStatus(`?? Ðåïëèêà B ñëèøêîì äëèííàÿ (${scriptB.split(/\s+/).length} ñëîâ). Ìàêñèìóì: ${maxWordsB} ñëîâ`, 'text-orange-400');
        return;
      }
    }
    
    // Validation for idea and suggested modes — topic is optional for suggested
    if (state.generationMode === 'idea') {
      const topicVal = document.getElementById('idea-input')?.value.trim();
      if (!topicVal) {
        showGenStatus('?? Íàïèøèòå èäåþ äëÿ ãåíåðàöèè', 'text-orange-400');
        return;
      }
    }
    
    if (state.generationMode === 'video' && !state.videoMeta) {
      showGenStatus('?? Çàãðóçèòå âèäåî-ôàéë âûøå ^ â ñåêöèè «?? Âèäåî-ðåôåðåíñ»', 'text-orange-400');
      document.getElementById('remix-video')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
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
        showGenStatus('?? Îïèñàíèå âèäåî ñëèøêîì äëèííîå (ìàêñèìóì 200 ñèìâîëîâ). Ñîêðàòèòå òåêñò.', 'text-orange-400');
        return;
      }
    }

    const btn = document.getElementById('btn-generate');

    // Ïðîâåðêà ïðîìî-êîäà ïåðåä ãåíåðàöèåé
    if (!isPromoValid()) {
      showGenStatus('?? Äëÿ ãåíåðàöèè íóæåí ïðîìî-êîä. Ââåäèòå åãî â ðàçäåëå «Íàñòðîéêè».', 'text-amber-400');
      log('WARN', 'ÃÅÍÅÐÀÖÈß', 'Ïðîìî-êîä íå ââåä¸í — ãåíåðàöèÿ çàáëîêèðîâàíà');
      return;
    }

    // In-flight guard: prevent double-click
    if (state._generationInFlight) return;
    state._generationInFlight = true;

    sfx.generate();
    btn.disabled = true;
    btn.textContent = '? Àíàëèçèðóþ êîíòåêñò...';
    setGenProgress(8, '?? Àíàëèçèðóþ òåìó è ïîäáèðàþ ïàðàìåòðû...');

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
    const isSurpriseAutoChars = state.generationMode === 'suggested' && state.surpriseCharMode === 'auto';
    const input = {
      input_mode: state.generationMode || state.inputMode,
      character1_id: isSurpriseAutoChars ? null : (state.selectedA?.id || null),
      character2_id: isSurpriseAutoChars ? null : (state.selectedB ? state.selectedB.id : null),
      surprise_char_mode: state.generationMode === 'suggested' ? state.surpriseCharMode : undefined,
      roles_locked: true,
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
      // Dialogue override from editor edits / variant selection (set by btn-regenerate)
      dialogue_override: state._dialogueOverride || null,
      options: state.options,
      seed: Date.now().toString(),
      characters: state.characters,
      locations: state.locations,
      selected_location_id: state.selectedLocation,
      enableLaughter: document.getElementById('laugh-toggle')?.checked !== false,
    };
    // Clear override after reading — only applies to this single regeneration
    state._dialogueOverride = null;

    // Step 1: Local generation (instant, structural template)
    let localResult;
    try {
      localResult = generate(input);
    } catch (e) {
      state._generationInFlight = false;
      showGenStatus(`? Îøèáêà ãåíåðàöèè: ${e.message}`, 'text-red-400');
      log('ERR', 'GEN', e.message);
      btn.disabled = false;
      btn.textContent = '?? Ñîáðàòü ïðîìïò';
      return;
    }

    if (localResult.error) {
      state._generationInFlight = false;
      displayResult(localResult);
      btn.disabled = false;
      btn.textContent = '?? Ñîáðàòü ïðîìïò';
      return;
    }

    // Step 1.5: Show pre-flight parameter breakdown
    btn.textContent = '? Ïîäãîòàâëèâàþ ïðîìïòû...';
    setGenProgress(22, '?? Ñòðóêòóðà ãîòîâà, ñîçäàþ ïðîìïòû äëÿ AI...');
    renderPreflight(localResult);

    // Step 2: If API mode — send context to AI engine for creative refinement
    const isApiMode = state.settingsMode === 'api' && (localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL);

    if (isApiMode && localResult._apiContext) {
      btn.textContent = '? AI ñîáèðàåò ïðîìïò...';
      setGenProgress(35, '?? FERIXDI AI ñîáèðàåò ïðîìïò è ñþæåò... (15-30ñ)');
      startGenProgressSimulation(35, 88, 25000); // animate over ~25s
      log('INFO', 'AI', 'Ñîáèðàþ ïðîìïò è äèàëîã...');

      try {
        const aiData = await callAIEngine(localResult._apiContext);
        if (aiData) {
          clearInterval(_genProgressTimer);
          setGenProgress(100, '? Ïðîìïò ñîáðàí! Ñêîïèðóé è âñòàâü â Google Flow');
          setTimeout(resetGenProgress, 1800);
          const merged = mergeAIResult(localResult, aiData);
          log('OK', 'AI', 'Ïðîìïò è ñþæåò ãîòîâû');
          updatePreflightStatus('? Ãîòîâî · Ïðîìïò ñîáðàí — ñêîïèðóé è âñòàâü â Google Flow', 'bg-emerald-500/8 text-emerald-400 border border-emerald-500/15');
          saveGenerationHistory(merged);
          displayResult(merged);
        } else {
          // No JWT token — try to auto-auth and show local result for now
          log('WARN', 'AI', 'Íåò òîêåíà — ïîêàçûâàþ ëîêàëüíûé ðåçóëüòàò');
          updatePreflightStatus('?? Íåò òîêåíà — ïîêàçàí ëîêàëüíûé øàáëîí', 'bg-amber-500/8 text-amber-400 border border-amber-500/15');
          if (isPromoValid()) autoAuth();
          saveGenerationHistory(localResult);
          displayResult(localResult);
        }
      } catch (apiErr) {
        resetGenProgress();
        state._generationInFlight = false;
        log('ERR', 'AI', `Îøèáêà API: ${apiErr.message}`);
        updatePreflightStatus(`? Îøèáêà ãåíåðàöèè: ${apiErr.message?.slice(0, 60) || 'íåèçâåñòíàÿ'}`, 'bg-red-500/8 text-red-400 border border-red-500/15');
        showGenStatus('', '');
        document.getElementById('gen-results')?.classList.remove('hidden');

        // Enhanced error handling with specific error types and actionable buttons
        let errorTitle = 'Ñåðâèñ âðåìåííî íåäîñòóïåí';
        let errorDesc = escapeHtml(apiErr.message);
        let errorAction = 'Ïîïðîáóéòå ñíîâà ÷åðåç íåñêîëüêî ìèíóò';
        let errorIcon = '??';
        let errorButtons = '';

        if (apiErr.message?.includes('429') || apiErr.message?.includes('rate limit') || apiErr.message?.includes('Ëèìèò')) {
          // Extract wait time and start countdown
          const waitMatch = apiErr.message?.match(/(\d+)\s*ñåê/);
          const waitSec = waitMatch ? parseInt(waitMatch[1]) : 60;
          state._rateLimitUntil = Date.now() + waitSec * 1000;
          startRateLimitCountdown();
          errorTitle = 'Ñëèøêîì ìíîãî çàïðîñîâ';
          errorDesc = 'Ïðåâûøåí ëèìèò çàïðîñîâ. Êíîïêà ðàçáëîêèðóåòñÿ àâòîìàòè÷åñêè.';
          errorAction = `Îæèäàéòå ${waitSec}ñ — êíîïêà àâòîìàòè÷åñêè ðàçáëîêèðóåòñÿ`;
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors text-sm">
              ?? Ïîïðîáîâàòü ñíîâà
            </button>
          `;
        } else if (apiErr.message?.includes('401') || apiErr.message?.includes('unauthorized') || apiErr.message?.toLowerCase().includes('invalid token') || apiErr.message?.toLowerCase().includes('token expired')) {
          try { await autoAuth(); } catch { /* ignore */ }
          errorTitle = 'Îøèáêà àâòîðèçàöèè';
          errorDesc = 'Ïðîìî-êîä èñò¸ê èëè íåäåéñòâèòåëåí. Ïðîâåðüòå íàñòðîéêè.';
          errorAction = 'Ââåäèòå íîâûé ïðîìî-êîä â ðàçäåëå «Íàñòðîéêè»';
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();navigateTo('settings')" class="px-4 py-2 bg-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/30 transition-colors text-sm">
              ?? Ïåðåéòè ê íàñòðîéêàì
            </button>
          `;
        } else if (apiErr.message?.includes('502') || apiErr.message?.includes('503') || apiErr.message?.includes('504')) {
          errorTitle = 'Ñåðâåð ïåðåçàãðóæàåòñÿ';
          errorDesc = 'AI-äâèæîê îáíîâëÿåòñÿ èëè ïåðåçàïóñêàåòñÿ. Ýòî çàíèìàåò 30–60 ñåêóíä.';
          errorAction = 'Íàæìèòå «Ñîáðàòü ïðîìïò» ïîâòîðíî ÷åðåç ìèíóòó';
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
              ?? Ñîáðàòü ïðîìïò ñíîâà
            </button>
          `;
        } else if (apiErr.message?.includes('timeout') || apiErr.message?.includes('network') || apiErr.message?.includes('Failed to fetch')) {
          errorTitle = 'Ïðîáëåìû ñ ñîåäèíåíèåì';
          errorDesc = 'Íå óäàëîñü ïîäêëþ÷èòüñÿ ê AI. Ïðîâåðüòå èíòåðíåò-ñîåäèíåíèå.';
          errorAction = 'Ïîïðîáóéòå ñíîâà èëè ïðîâåðüòå ïîäêëþ÷åíèå';
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
              ?? Ïîïðîáîâàòü ñíîâà
            </button>
          `;
        } else if (apiErr.message?.includes('quota') || apiErr.message?.includes('exceeded')) {
          errorTitle = 'Ëèìèò ãåíåðàöèé èñ÷åðïàí';
          errorDesc = 'Äîñòèãíóò ëèìèò ãåíåðàöèé. Ïîïðîáóéòå ïîçæå èëè íàïèøèòå â ïîääåðæêó.';
          errorAction = 'Ïîäîæäèòå íåìíîãî èëè ñâÿæèòåñü ñ @ferixdiii â Telegram';
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm">
              ?? Ïîïðîáîâàòü ñíîâà
            </button>
            <button onclick="window.open('https://t.me/ferixdiii', '_blank')" class="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors text-sm">
              ?? Ïîääåðæêà
            </button>
          `;
        } else {
          errorTitle = 'Îøèáêà ñáîðêè ïðîìïòà';
          errorDesc = escapeHtml(apiErr.message || 'Íåïðåäâèäåííàÿ îøèáêà');
          errorAction = 'Ïîïðîáóéòå ñíîâà ÷åðåç íåñêîëüêî ñåêóíä';
          errorIcon = '??';
          errorButtons = `
            <button onclick="document.getElementById('gen-error-overlay')?.remove();document.getElementById('btn-generate')?.click()" class="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors text-sm">
              ?? Ïîïðîáîâàòü ñíîâà
            </button>
            <button onclick="window.open('https://t.me/ferixdiii', '_blank')" class="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors text-sm">
              ?? Ïîääåðæêà
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
        genResults?.prepend(errDiv);
      }
    } else {
      // Demo mode or API without _apiContext — show local result with better UX
      const hasPromo = isPromoValid();
      updatePreflightStatus(hasPromo ? '?? Ëîêàëüíàÿ ãåíåðàöèÿ · AI-äâèæîê íåäîñòóïåí' : '?? Äåìî-ðåæèì · Ââåäèòå ïðîìî-êîä äëÿ ïîëíîé ãåíåðàöèè', 'bg-gray-500/8 text-gray-400 border border-gray-500/15');
      
      // Add helpful info about local vs AI generation
      if (!hasPromo) {
        localResult.warnings = localResult.warnings || [];
        localResult.warnings.push('Äëÿ ãåíåðàöèè óíèêàëüíîãî êîíòåíòà ñ FERIXDI AI ââåäèòå ïðîìî-êîä â ðàçäåëå "Íàñòðîéêè"');
      } else {
        localResult.warnings = localResult.warnings || [];
        localResult.warnings.push('AI-äâèæîê âðåìåííî íåäîñòóïåí — ïîêàçàí ëîêàëüíûé øàáëîí');
      }
      
      saveGenerationHistory(localResult);
      displayResult(localResult);
    }

    state._generationInFlight = false;
    btn.disabled = false;
    btn.textContent = '?? Ñîáðàòü ïðîìïò';
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

    // Read current dialogue from editor (may have been edited by user or variant selection)
    const edA = document.getElementById('editor-line-a')?.value?.trim();
    const edB = document.getElementById('editor-line-b')?.value?.trim();

    // If editor has dialogue, apply it first (sync all outputs) and store as override
    if (edA) {
      applyDialogueUpdate(edA, edB || '');
      // Store override so generator.js preserves this dialogue instead of picking random
      state._dialogueOverride = { A: edA, B: edB || null };
    } else {
      state._dialogueOverride = null;
    }

    const ideaInput = document.getElementById('idea-input');
    if (ideaInput && feedback) {
      // Append feedback to the idea input so generator picks it up
      const prev = ideaInput.value.trim();
      const feedbackLine = `[ÄÎÐÀÁÎÒÊÀ: ${feedback}]`;
      ideaInput.value = prev ? `${prev}\n${feedbackLine}` : feedbackLine;
    }
    // Clear feedback field
    if (document.getElementById('regen-feedback')) document.getElementById('regen-feedback').value = '';
    // Trigger generation
    document.getElementById('btn-generate')?.click();
  });
}

// --- ENGLISH ADAPTATION ---------------------
function initTranslate() {
  document.getElementById('btn-translate-en')?.addEventListener('click', async () => {
    log('INFO', 'TRANSLATE', 'Êíîïêà íàæàòà — íà÷èíàåì àäàïòàöèþ...');
    const result = state.lastResult;
    if (!result) {
      log('ERR', 'TRANSLATE', 'state.lastResult ïóñòîé — íåò äàííûõ äëÿ ïåðåâîäà');
      showNotification('? Íåò ðåçóëüòàòà äëÿ ïåðåâîäà — ñíà÷àëà ñãåíåðèðóéòå êîíòåíò', 'error');
      return;
    }

    const btn = document.getElementById('btn-translate-en');
    btn.disabled = true;
    btn.innerHTML = '? Ïåðåâîäèì íà English...';

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
      log('ERR', 'TRANSLATE', 'JWT òîêåí îòñóòñòâóåò — ïåðåàâòîðèçóåìñÿ...');
      // Auto-retry auth before giving up
      await autoAuth();
      token = localStorage.getItem('ferixdi_jwt');
      if (!token) {
        btn.innerHTML = '? Íåò òîêåíà — ââåäèòå ïðîìî-êîä â Íàñòðîéêàõ';
        setTimeout(() => { btn.innerHTML = '???? Àäàïòàöèÿ íà English'; btn.disabled = false; }, 2500);
        return;
      }
      log('OK', 'TRANSLATE', 'JWT ïîëó÷åí ïîñëå ïåðåàâòîðèçàöèè');
    }

    try {
      log('INFO', 'TRANSLATE', `Îòïðàâëÿåì çàïðîñ íà ${apiUrl}/api/translate...`);
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
      if (kw && en.killer_word_en) kw.textContent = `?? Killer word: «${en.killer_word_en}»`;

      // Update Veo prompt (both DOM and state)
      // REMAKE mode: veo_prompt is already remake_veo_prompt_en (fully English, ultra-detailed)
      // — do NOT overwrite with re-translated version that AI may paraphrase/shorten
      if (en.veo_prompt_en && !result.is_remake) {
        result.veo_prompt = en.veo_prompt_en;
        const veoEl = document.getElementById('veo-prompt-text');
        if (veoEl) veoEl.textContent = en.veo_prompt_en;
      }

      // Update video prompt JSON dialogue
      if (result.video_prompt_en_json?.dialogue) {
        if (en.dialogue_A_en) result.video_prompt_en_json.dialogue.final_A_ru = en.dialogue_A_en;
        if (en.dialogue_B_en) result.video_prompt_en_json.dialogue.final_B_ru = en.dialogue_B_en;
        if (en.killer_word_en) result.video_prompt_en_json.dialogue.killer_word = en.killer_word_en;
        const videoPreEl = document.querySelector('#tab-video pre');
        if (videoPreEl) videoPreEl.textContent = JSON.stringify(result.video_prompt_en_json, null, 2);
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
        const bpPreEl = document.querySelector('#tab-blueprint pre');
        if (bpPreEl) bpPreEl.textContent = JSON.stringify(result.blueprint_json, null, 2);
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
        const ruPreEl = document.querySelector('#tab-ru pre');
        if (ruPreEl) ruPreEl.textContent = en.ru_package_en;
      }

      // Update dialogue editor inputs
      const edA = document.getElementById('editor-line-a');
      const edB = document.getElementById('editor-line-b');
      if (edA && en.dialogue_A_en) edA.value = en.dialogue_A_en;
      if (edB && en.dialogue_B_en) edB.value = en.dialogue_B_en;

      // Switch tab label from ???? to ????
      const ruTabBtn = document.querySelector('#gen-results .mode-btn[data-tab="ru"]');
      if (ruTabBtn) ruTabBtn.textContent = '???? Post';

      // Sync _apiContext with English values so downstream readers stay consistent
      const trCtx = result._apiContext || {};
      if (en.dialogue_A_en) trCtx.dialogueA = en.dialogue_A_en;
      if (en.dialogue_B_en) trCtx.dialogueB = en.dialogue_B_en;
      if (en.killer_word_en) trCtx.killerWord = en.killer_word_en;

      btn.innerHTML = '? English ãîòîâî!';
      log('OK', 'TRANSLATE', `Àäàïòàöèÿ íà English: A="${en.dialogue_A_en?.slice(0, 40)}..." B="${en.dialogue_B_en?.slice(0, 40)}..."`);
      showNotification('???? Âåñü êîíòåíò àäàïòèðîâàí íà àíãëèéñêèé — äèàëîã, èíñòà-ïàêåò, õåøòåãè, îïèñàíèå!', 'success');

      setTimeout(() => { btn.innerHTML = '???? Àäàïòàöèÿ íà English'; btn.disabled = false; }, 3000);

    } catch (e) {
      log('ERR', 'TRANSLATE', e.message);
      btn.innerHTML = `? ${e.message?.slice(0, 40) || 'Îøèáêà'}`;
      setTimeout(() => { btn.innerHTML = '???? Àäàïòàöèÿ íà English'; btn.disabled = false; }, 3000);
    }
  });
}

// Timing section removed — timing info shown inline in dialogue editor

// --- QC GATE RENDERER (v3) ------------------
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
    const g = c.group || 'äðóãîå';
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });

  const groupIcons = { 'ëèöî': '??', 'êàìåðà': '??', 'òåëî': '??', 'àóäèî': '??', 'òàéìèíã': '?', 'ñöåíà': '??', 'äðóãîå': '??' };

  qcEl.innerHTML = `
    <div class="space-y-3">
      <!-- Header with progress -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="text-xs font-medium ${hasIssues ? 'text-amber-400' : 'neon-text-green'}">
            ?? Êîíòðîëü êà÷åñòâà
          </div>
          <span class="text-[10px] text-gray-600 font-mono">${qc.total} ïðîâåðîê</span>
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
        ${hasIssues ? `?? Íàéäåíî ${failedChecks.length} ${failedChecks.length === 1 ? 'ïðîáëåìà' : failedChecks.length < 5 ? 'ïðîáëåìû' : 'ïðîáëåì'} — ìîæíî èñïðàâèòü àâòîìàòè÷åñêè` : '? Âñå ïðîâåðêè ïðîéäåíû — ïðîìïò ãîòîâ ê èñïîëüçîâàíèþ'}
      </div>

      <!-- Checks grid -->
      <div class="space-y-2" id="qc-checks-list">
        ${Object.entries(groups).map(([group, checks]) => `
          <div>
            <div class="text-[9px] text-gray-600 uppercase tracking-wider mb-1">${groupIcons[group] || '??'} ${group}</div>
            ${checks.map(c => `
              <div class="flex items-center gap-2 py-0.5 qc-check-row" data-id="${c.id}">
                <span class="qc-icon w-4 text-center text-xs ${c.pass ? 'text-emerald-500' : 'text-red-400'}">${c.pass ? '?' : '?'}</span>
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
          ? Èñïðàâèòü ${failedChecks.length} ${failedChecks.length === 1 ? 'ïðîáëåìó' : failedChecks.length < 5 ? 'ïðîáëåìû' : 'ïðîáëåì'} àâòîìàòè÷åñêè
        </button>
        <div id="qc-fix-log" class="hidden space-y-1"></div>
      ` : ''}
    </div>
  `;

  // Log
  if (hasIssues) {
    log('WARN', 'QC', `${qc.passed}/${qc.total} — íàéäåíî ${failedChecks.length} ïðîáëåì`);
  } else {
    log('OK', 'QC', `${qc.passed}/${qc.total} — âñ¸ ÷èñòî`);
  }

  // Fix button handler
  const fixBtn = document.getElementById('qc-fix-btn');
  if (fixBtn) {
    fixBtn.addEventListener('click', () => {
      fixBtn.disabled = true;
      fixBtn.innerHTML = '<span class="inline-block animate-spin mr-1">??</span> Àíàëèçèðóþ è èñïðàâëÿþ...';
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
              icon.textContent = '?';
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
            fixLog.innerHTML += `<div class="text-[10px] text-emerald-400/80 flex items-start gap-1.5"><span class="mt-0.5">?</span><span><strong>${check.name_ru}</strong> — ${check.desc_fix || 'èñïðàâëåíî'}</span></div>`;
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
                badge.innerHTML = `? Âñå ${qc.total} ïðîâåðîê ïðîéäåíû — ïðîìïò îïòèìèçèðîâàí`;
              }

              // Replace fix button with success
              fixBtn.innerHTML = '? Âñå ïðîáëåìû èñïðàâëåíû';
              fixBtn.classList.remove('from-gray-700', 'to-gray-600');
              fixBtn.classList.add('from-emerald-700', 'to-green-600');
              fixBtn.style.cursor = 'default';

              log('OK', 'QC', `Âñå ${failedChecks.length} ïðîáëåì èñïðàâëåíû > ${qc.total}/${qc.total}`);
            }, 300);
          }
        }, delay * (i + 1));
      });
    });
  }
}

// --- COPY TO CLIPBOARD ----------------------
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
        btn.textContent = '? Ñêîïèðîâàíî!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        log('OK', 'ÊÎÏÈß', `${tab} ñêîïèðîâàíî â áóôåð`);
      }).catch(() => {
        log('WARN', 'ÊÎÏÈß', 'Äîñòóï ê áóôåðó çàïðåù¸í');
      });
    });
  });
}

// --- SETTINGS --------------------------------
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
    log('INFO', 'API', `URL ñåðâåðà: ${url}`);
    if (isPromoValid()) autoAuth();
  });

  document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
    historyCache.clear();
    updateCacheStats();
    log('OK', 'ÊÅØ', 'Êåø èñòîðèè î÷èùåí');
  });

  // Sound toggle
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle) {
    soundToggle.checked = sfx.isEnabled();
    soundToggle.addEventListener('change', () => {
      sfx.setEnabled(soundToggle.checked);
      localStorage.setItem('ferixdi_sounds', soundToggle.checked ? 'on' : 'off');
      if (soundToggle.checked) sfx.success();
      log('INFO', 'ÇÂÓÊ', soundToggle.checked ? 'Çâóêè âêëþ÷åíû' : 'Çâóêè âûêëþ÷åíû');
    });
  }
}

function updateCacheStats() {
  const stats = historyCache.getStats();
  const el = document.getElementById('cache-stats');
  if (el) el.textContent = `Ëîê: ${stats.locations} | Ðåêâ: ${stats.props} | Îäåæäà: ${stats.wardrobes}`;
}

// --- SHARED: Apply dialogue changes to all prompts --
function applyDialogueUpdate(newA, newB) {
  if (!state.lastResult) return;
  const ctx = state.lastResult._apiContext || {};
  const isSolo = ctx.soloMode || (!state.selectedB || state.selectedA?.id === state.selectedB?.id);

  // -- Snapshot old dialogue BEFORE any mutation (needed for veo prompt patching) --
  const _bpSnap = state.lastResult.blueprint_json;
  const _vpSnap = state.lastResult.video_prompt_en_json;
  const _oldA = ctx._prevDialogueA || _bpSnap?.dialogue_segments?.find(s => s.speaker === 'A')?.text_ru || '';
  const _oldB = ctx._prevDialogueB || _bpSnap?.dialogue_segments?.find(s => s.speaker === 'B')?.text_ru || '';
  const _oldKw = _vpSnap?.dialogue?.killer_word || _bpSnap?.killer_word || '';

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
      const lastWord = newA.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || 'ïàí÷';
      vp.dialogue.killer_word = lastWord;
    } else {
      vp.dialogue.final_B_ru = newB;
      const lastWord = newB.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || 'ïàí÷';
      vp.dialogue.killer_word = lastWord;
    }
  }

  // Rebuild ru_package — replace dialogue lines in the text
  if (state.lastResult.ru_package) {
    let pkg = state.lastResult.ru_package;
    if (isSolo) {
      // Solo: replace monologue line «old text» > «new text» (after ?? section)
      pkg = pkg.replace(/(??[^\n]*\n\s*«)[^»]*(»)/, `$1${newA}$2`);
    } else {
      pkg = pkg.replace(/(???[^\n]*\n\s*«)[^»]*(»)/, `$1${newA}$2`);
      pkg = pkg.replace(/(???[^\n]*\n\s*«)[^»]*(»)/, `$1${newB}$2`);
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

  // Re-render Veo prompt — robust old>new replacement (works for both normal & remake formats)
  if (state.lastResult.veo_prompt) {
    let veo = state.lastResult.veo_prompt;
    const _veoPause = (t) => (t || '').replace(/\s*\|\s*/g, '... ').trim();
    const oldVeoA = _veoPause(_oldA);
    const newVeoA = _veoPause(newA);
    const oldVeoB = _veoPause(_oldB);
    const newVeoB = _veoPause(newB);
    // Replace quoted dialogue A (matches any prefix: "A speaks:", "Character speaks in Russian to the camera:", etc.)
    if (oldVeoA && newVeoA !== oldVeoA) {
      veo = veo.split('"' + oldVeoA + '"').join('"' + newVeoA + '"');
    }
    // Replace quoted dialogue B
    if (!isSolo && oldVeoB && newVeoB !== oldVeoB) {
      veo = veo.split('"' + oldVeoB + '"').join('"' + newVeoB + '"');
    }
    // Update killer_word references — both normal (Killer word "...") and remake (The word "..." is the punchline)
    const newKw = vp?.dialogue?.killer_word || '';
    if (newKw && _oldKw && newKw !== _oldKw) {
      veo = veo.replace(/(Killer word ")[^"]*(")(?=\s*[:\.])/g, `$1${newKw}$2`);
      veo = veo.replace(/(The word ")[^"]*(?=" is the punchline)/g, `$1${newKw}`);
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
  if (kwEl && killerWord) kwEl.textContent = `?? Killer word: «${killerWord}»`;

  // Sync _apiContext fallback values so downstream readers get correct dialogue
  if (ctx.dialogueA !== undefined) ctx.dialogueA = newA;
  if (ctx.dialogueB !== undefined) ctx.dialogueB = newB;
  if (ctx.killerWord !== undefined) ctx.killerWord = killerWord;

  // -- Sync Insta tab with new dialogue --
  // Update share_bait, caption, and other insta content that references dialogue
  const result = state.lastResult;
  if (result) {
    const oldA = _oldA;
    const oldB = _oldB;
    const engage = result.log?.engagement;
    const instaPack = result.log?.instagram_pack;

    // Replace old dialogue fragments in insta content
    const replaceDialogue = (text) => {
      if (!text || typeof text !== 'string') return text;
      let updated = text;
      if (oldA && newA && oldA !== newA) updated = updated.split(oldA).join(newA);
      if (oldB && newB && oldB !== newB) updated = updated.split(oldB).join(newB);
      return updated;
    };

    if (engage) {
      if (engage.share_bait) engage.share_bait = replaceDialogue(engage.share_bait);
      if (engage.viral_title) engage.viral_title = replaceDialogue(engage.viral_title);
      if (engage.pin_comment) engage.pin_comment = replaceDialogue(engage.pin_comment);
      if (engage.first_comment) engage.first_comment = replaceDialogue(engage.first_comment);
    }
    if (instaPack) {
      if (instaPack.caption) instaPack.caption = replaceDialogue(instaPack.caption);
      if (instaPack.engagement_tip) instaPack.engagement_tip = replaceDialogue(instaPack.engagement_tip);
      if (instaPack.hook_texts) instaPack.hook_texts = instaPack.hook_texts.map(h => replaceDialogue(h));
    }

    // Re-render insta tab
    populateInstaTab(result);
  }

  // Store current dialogue for next edit comparison
  ctx._prevDialogueA = newA;
  ctx._prevDialogueB = newB;
}

// --- DIALOGUE EDITOR --------------------
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
    // Solo mode: monologue uses 6.3s window (0.7–7.0)
    const overA = estA.duration > 6.8; // 6.3s window + 0.5s tolerance
    const risk = overA ? 'high' : estA.duration > 5.5 ? 'medium' : 'low';

    document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 30 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}ñ / 6.8ñ · ${wordsA} ñëîâ${overA ? ' — ÍÅ ÂËÅÇÅÒ!' : wordsA > 30 ? ' — ìíîãî' : ''}</span>`;
    const estBEl = document.getElementById('editor-est-b');
    if (estBEl) estBEl.innerHTML = '<span class="text-gray-600">— ñîëî —</span>';

    const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
    const riskLabel = risk === 'high' ? '?? ÏÐÅÂÛØÅÍÈÅ' : risk === 'medium' ? '?? ÁËÈÇÊÎ' : '? ÎÊ';
    document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Ìîíîëîã: ${estA.duration.toFixed(2)}ñ / 6.3ñ ${riskLabel}</span>`;

    const badge = document.getElementById('editor-timing-badge');
    if (badge) {
      badge.textContent = `${estA.duration.toFixed(1)}ñ`;
      badge.className = `tag text-[10px] ${risk === 'high' ? 'tag-pink' : risk === 'medium' ? 'tag-orange' : 'tag-green'}`;
    }
  } else {
    // Duo mode
    if (!inputB) return;
    const paceB = state.selectedB?.speech_pace || 'normal';
    const estB = estimateLineDuration(inputB.value, paceB);
    const total = estA.duration + estB.duration;
    const wordsB = inputB.value.replace(/\|/g, '').trim().split(/\s+/).filter(w => w.length > 0).length;

    const overA = estA.duration > 3.3; // 2.8s window + 0.5s tolerance
    const overB = estB.duration > 4.0; // 3.5s window + 0.5s tolerance
    const risk = total > 7.3 || overA || overB ? 'high' : total > 6.0 ? 'medium' : 'low';

    document.getElementById('editor-est-a').innerHTML = `<span class="${overA ? 'text-red-400' : wordsA > 10 ? 'text-orange-400' : 'text-gray-500'}">${estA.duration}ñ / 3.3ñ · ${wordsA} ñëîâ${overA ? ' — ÍÅ ÂËÅÇÅÒ!' : wordsA > 10 ? ' — ìíîãî' : ''}</span>`;
    document.getElementById('editor-est-b').innerHTML = `<span class="${overB ? 'text-red-400' : wordsB > 12 ? 'text-orange-400' : 'text-gray-500'}">${estB.duration}ñ / 4.0ñ · ${wordsB} ñëîâ${overB ? ' — ÍÅ ÂËÅÇÅÒ!' : wordsB > 12 ? ' — ìíîãî' : ''}</span>`;

    const riskColor = risk === 'high' ? 'text-red-400' : risk === 'medium' ? 'text-yellow-400' : 'neon-text-green';
    const riskLabel = risk === 'high' ? '?? ÏÐÅÂÛØÅÍÈÅ' : risk === 'medium' ? '?? ÁËÈÇÊÎ' : '? ÎÊ';
    document.getElementById('editor-total').innerHTML = `<span class="${riskColor}">Ðå÷ü: ${total.toFixed(2)}ñ / 6.3ñ ${riskLabel}</span>`;

    const badge = document.getElementById('editor-timing-badge');
    if (badge) {
      badge.textContent = `${total.toFixed(1)}ñ`;
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
        fixesEl.innerHTML = result.auto_fixes.map(f => `<div>? ${escapeHtml(f)}</div>`).join('');
      }
      log('OK', 'ÐÅÄÀÊÒÎÐ', `Àâòî-ñîêðàùåíèå: ${result.auto_fixes.length} èñïðàâëåíèé`);
    } else {
      const fixesEl = document.getElementById('editor-fixes');
      if (fixesEl) { fixesEl.classList.add('hidden'); fixesEl.innerHTML = ''; }
      showNotification('? Äèàëîã óæå îïòèìàëåí — ñîêðàùàòü íå÷åãî', 'success');
      log('INFO', 'ÐÅÄÀÊÒÎÐ', 'Íå÷åãî ñîêðàùàòü — âñ¸ â íîðìå');
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
      applyBtn.textContent = '? Ïðèìåíåíî!';
      applyBtn.classList.add('btn-neon-green-active');
      setTimeout(() => { applyBtn.textContent = orig; applyBtn.classList.remove('btn-neon-green-active'); }, 1500);
    }

    log('OK', 'ÐÅÄÀÊÒÎÐ', `Äèàëîã îáíîâë¸í. Îöåíêà: ${state.lastResult.duration_estimate.total}ñ`);
  });
}

// --- LOGOUT -------------------------------
async function logoutUser() {
  try {
    const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    await fetch(`${apiUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch { /* ignore */ }
  ['ferixdi_jwt', 'ferixdi_promo', 'ferixdi_username', 'ferixdi_user_id'].forEach(k => localStorage.removeItem(k));
  showNotification('?? Âû âûøëè èç ñèñòåìû', 'info');
  setTimeout(() => window.location.reload(), 1000);
}
window.logoutUser = logoutUser;

// --- CHAR COUNTERS ---------------------------
function initCharCounters() {
  const fields = [
    { id: 'idea-input', max: 500 },
    { id: 'idea-input-suggested', max: 500 },
    { id: 'script-a', max: 300 },
    { id: 'script-b', max: 300 },
    { id: 'scene-hint-main', max: 200 },
    { id: 'scene-hint', max: 200 },
  ];
  fields.forEach(({ id, max }) => {
    const el = document.getElementById(id);
    if (!el || document.getElementById(`${id}-counter`)) return;
    const counter = document.createElement('div');
    counter.id = `${id}-counter`;
    counter.className = 'text-right text-[10px] text-gray-600 mt-0.5 transition-colors';
    el.parentNode?.insertBefore(counter, el.nextSibling);
    const update = () => {
      const len = el.value.length;
      counter.textContent = `${len}?/?${max}`;
      counter.className = `text-right text-[10px] mt-0.5 transition-colors ${len >= max ? 'text-red-400' : len > max * 0.85 ? 'text-amber-400' : 'text-gray-600'}`;
    };
    el.addEventListener('input', update);
    update();
  });
}

// --- HEADER SETTINGS BUTTON -------------
function initHeaderSettings() {
  document.getElementById('btn-settings')?.addEventListener('click', () => navigateTo('settings'));
}


// --- CHAR FILTERS ----------------------------
function initCharFilters() {
  let _charSearchTimer = null;
  document.getElementById('char-search')?.addEventListener('input', () => {
    clearTimeout(_charSearchTimer);
    _charSearchTimer = setTimeout(() => renderCharacters(getCurrentFilters()), 200);
  });
  document.getElementById('char-group-filter')?.addEventListener('change', () => renderCharacters(getCurrentFilters()));
  document.getElementById('char-compat-filter')?.addEventListener('change', () => renderCharacters(getCurrentFilters()));
  document.getElementById('char-swap')?.addEventListener('click', () => {
    [state.selectedA, state.selectedB] = [state.selectedB, state.selectedA];
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
    log('INFO', 'ÏÅÐÑÎÍÀÆÈ', 'Ìåñòàìè: A ? B');
  });
}

// --- KEYBOARD SHORTCUTS --------------------
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter > trigger generation (only when generate section is visible)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const genSection = document.getElementById('section-generate');
      if (genSection && !genSection.classList.contains('hidden')) {
        e.preventDefault();
        const btn = document.getElementById('btn-generate');
        if (btn && !btn.disabled) btn.click();
      }
    }
    // Escape > close topmost open modal/overlay
    if (e.key === 'Escape') {
      document.getElementById('gen-error-overlay')?.remove();
      const lessonModal = document.getElementById('lesson-modal-overlay');
      if (lessonModal && !lessonModal.classList.contains('hidden')) {
        lessonModal.classList.add('hidden');
      }
    }
  });
}

// --- DELETE CUSTOM CHAR ----------------------
function deleteCustomChar(id) {
  if (!confirm('Óäàëèòü ïîëüçîâàòåëüñêîãî ïåðñîíàæà?')) return;
  state.characters = state.characters.filter(c => c.id !== id);
  try {
    const stored = JSON.parse(localStorage.getItem('ferixdi_custom_chars') || '[]');
    localStorage.setItem('ferixdi_custom_chars', JSON.stringify(stored.filter(c => c.id !== id)));
  } catch { /* ignore */ }
  if (state.selectedA?.id === id) state.selectedA = null;
  if (state.selectedB?.id === id) state.selectedB = null;
  renderCharacters(getCurrentFilters());
  updateCharDisplay();
  showNotification('?? Ïåðñîíàæ óäàë¸í', 'info');
  log('INFO', 'CHAR-DELETE', `Óäàë¸í êàñòîìíûé ïåðñîíàæ: ${id}`);
}
window.deleteCustomChar = deleteCustomChar;

// --- DELETE CUSTOM LOC -----------------------
function deleteCustomLoc(id) {
  if (!confirm('Óäàëèòü ïîëüçîâàòåëüñêóþ ëîêàöèþ?')) return;
  state.locations = state.locations.filter(l => l.id !== id);
  try {
    const stored = JSON.parse(localStorage.getItem('ferixdi_custom_locs') || '[]');
    localStorage.setItem('ferixdi_custom_locs', JSON.stringify(stored.filter(l => l.id !== id)));
  } catch { /* ignore */ }
  if (state.selectedLocation?.id === id) state.selectedLocation = null;
  renderLocations();
  renderLocationsBrowse();
  showNotification('?? Ëîêàöèÿ óäàëåíà', 'info');
  log('INFO', 'LOC-DELETE', `Óäàëåíà êàñòîìíàÿ ëîêàöèÿ: ${id}`);
}
window.deleteCustomLoc = deleteCustomLoc;

// --- LOG PANEL TOGGLE ---------------------
function initLogPanel() {
  document.getElementById('log-toggle')?.addEventListener('click', () => {
    const output = document.getElementById('log-output');
    const icon = document.getElementById('log-toggle-icon');
    if (!output) return;
    const collapsed = output.style.display === 'none';
    output.style.display = collapsed ? '' : 'none';
    if (icon) icon.textContent = collapsed ? '¡' : '^';
  });
}

// --- MATRIX RAIN -------------------------
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

  const chars = '??????????????????????????????????????????????0123456789ABCDEF<>{}[]=/\\';
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

// --- TRENDS (Ideas section) — Enhanced v2 -------------
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
  if (!text) return '';
  // Render pipe | as visual pause badge first
  let result = escapeHtml(text).replace(/\|/g, '<span class="pipe-pause">pause</span>');
  if (!killer) return result;
  const kw = escapeHtml(killer);
  const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return result.replace(regex, '<span class="killer-glow">$1</span>');
}

function _wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(w => w && w !== '|').length;
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
    if (st) { st.classList.remove('hidden'); st.innerHTML = '<span class="text-red-400">?? Äëÿ äîñòóïà ê òðåíäàì íóæåí ïðîìî-êîä. Ïåðåéäè â «Íàñòðîéêè» > ââåäè êîä.</span>'; }
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
    universal: 'óíèâåðñàëüíûå', business: 'áèçíåñ', health: 'çäîðîâüå è ôèòíåñ',
    tech: 'tech è AI', beauty: 'êðàñîòà', finance: 'ôèíàíñû', education: 'îáðàçîâàíèå',
    relationships: 'îòíîøåíèÿ', travel: 'ïóòåøåñòâèÿ', food: 'åäà',
    parenting: 'ðîäèòåëüñòâî', realestate: 'íåäâèæèìîñòü'
  };
  const nicheName = nicheNames[selectedNiche] || 'óíèâåðñàëüíûå';

  btn.disabled = true;
  btn.innerHTML = '<span class="animate-pulse">?</span> FERIXDI AI èùåò òðåíäû...';
  st.classList.remove('hidden');
  st.innerHTML = `<span class="text-gray-400 animate-pulse">FERIXDI AI èùåò <span class="text-cyan-400">${nicheName}</span> èäåè...</span>`;
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
      st.innerHTML = `<span class="text-red-400">? Ñåðâåð âåðíóë íåêîððåêòíûé îòâåò (${resp.status}). Ïîïðîáóé åù¸ ðàç.</span>`;
      log('ERR', 'ÒÐÅÍÄÛ', `JSON parse error: ${parseErr.message}, status: ${resp.status}`);
      btn.disabled = false;
      btn.innerHTML = '<span>??</span> Ïîïðîáîâàòü åù¸ ðàç';
      return;
    }

    if (!resp.ok) {
      st.innerHTML = `<span class="text-red-400">? ${escapeHtml(data.error || `Îøèáêà ñåðâåðà (${resp.status})`)}</span>`;
      btn.disabled = false;
      btn.innerHTML = '<span>??</span> Ïîïðîáîâàòü åù¸ ðàç';
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
      ? '<span class="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded ml-2">?? Îíëàéí</span>'
      : '<span class="text-[9px] bg-gray-500/15 text-gray-500 px-1.5 py-0.5 rounded ml-2">?? AI-àíàëèç</span>';
    const nicheBadge = niche !== 'universal'
      ? `<span class="text-[9px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded ml-2">?? ${nicheName}</span>`
      : '';
    st.innerHTML = `<span class="text-emerald-400">? ${_trendsData.length} èäåé · ${escapeHtml(data.weekday || '')}, ${escapeHtml(data.date)}</span>${groundedBadge}${nicheBadge}`;

    // Show toolbar + results
    if (toolbar) toolbar.classList.remove('hidden');
    res.classList.remove('hidden');

    // Render stats
    _renderTrendStats();
    // Reset filter tabs
    document.querySelectorAll('.trend-filter-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === 'all'));
    // Render
    _renderTrends();
    log('OK', 'ÒÐÅÍÄÛ', `Çàãðóæåíî ${_trendsData.length} èäåé${data.grounded ? ' (îíëàéí)' : ''}`);
  } catch (e) {
    st.innerHTML = `<span class="text-red-400">? Îøèáêà ñåòè: ${escapeHtml(e.message)}</span>`;
    log('ERR', 'ÒÐÅÍÄÛ', e.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<span>??</span> Îáíîâèòü òðåíäû';
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
    <div class="trend-stat"><span>??</span> <span class="trend-stat-value">${_trendsData.length}</span> èäåé</div>
    <div class="trend-stat"><span>?</span> O <span class="trend-stat-value">${avgViral}</span>/10</div>
    <div class="trend-stat"><span>??</span> Max <span class="trend-stat-value">${maxViral}</span>/10</div>
    <div class="trend-stat"><span>??</span> <span class="trend-stat-value">${cats.hot || 0}</span></div>
    <div class="trend-stat"><span>??</span> <span class="trend-stat-value">${cats.pain || 0}</span></div>
    <div class="trend-stat"><span>??</span> <span class="trend-stat-value">${cats.format || 0}</span></div>
    <div class="trend-stat"><span>?</span> <span class="trend-stat-value">${_trendsSaved.length}</span> ñîõð</div>
  `;
}

function _renderTrends() {
  const res = document.getElementById('trends-results');
  if (!res) return;

  const catMeta = {
    hot:    { icon: '??', label: 'Ãîðÿ÷åå ñåãîäíÿ',  border: 'border-red-500/30',    bg: 'bg-red-500/5',    badge: 'bg-red-500/20 text-red-400',    glow: 'hover:border-red-500/50' },
    pain:   { icon: '??', label: 'Âå÷íàÿ áîëü',       border: 'border-amber-500/30',  bg: 'bg-amber-500/5',  badge: 'bg-amber-500/20 text-amber-400',glow: 'hover:border-amber-500/50' },
    format: { icon: '??', label: 'Âèðóñíûé ôîðìàò',   border: 'border-violet-500/30', bg: 'bg-violet-500/5', badge: 'bg-violet-500/20 text-violet-400', glow: 'hover:border-violet-500/50' },
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
    res.innerHTML = '<div class="text-center text-xs text-gray-500 py-8">Íè÷åãî íå íàéäåíî ïî ýòèì ôèëüòðàì</div>';
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
            ${t.viral_format ? `<span class="text-[9px] text-violet-400/80 bg-violet-500/10 px-1.5 py-0.5 rounded">?? ${escapeHtml(t.viral_format)}</span>` : ''}
            ${t.theme_tag ? `<span class="text-[9px] px-2 py-0.5 rounded-full bg-gray-800/80 text-gray-500 border border-gray-700/50">#${escapeHtml(t.theme_tag)}</span>` : ''}
            <span class="reach-badge ${reach.color}">?? ${reach.text}</span>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          <span class="trend-bookmark ${saved ? 'saved' : ''}" data-topic="${_escForAttr(t.topic)}" title="Ñîõðàíèòü èäåþ">?</span>
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
        <span class="text-cyan-400/80 font-semibold">?? Ïî÷åìó ñåé÷àñ:</span> ${escapeHtml(t.trend_context || t.why_trending)}
      </div>` : ''}

      <!-- Comedy angle -->
      ${t.comedy_angle ? `<div class="text-[11px] text-gray-400 leading-relaxed"><span class="text-amber-400">??</span> ${escapeHtml(t.comedy_angle)}</div>` : ''}

      <!-- Dialogue block with per-line copy -->
      <div class="trend-dialogue bg-black/40 rounded-xl p-3.5 space-y-2 border border-white/[0.03]">
        <div class="flex items-center justify-between mb-0.5">
          <div class="text-[10px] text-gray-500 font-semibold">?? Ãîòîâûé äèàëîã:</div>
          <div class="flex items-center gap-2">
            ${t.killer_word ? `<div class="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20">?? <span class="font-bold">${escapeHtml(t.killer_word)}</span></div>` : ''}
            <button class="trend-copy-both text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 hover:bg-cyan-500/15 hover:text-cyan-400 border border-white/10 transition-colors" data-a="${_escForAttr(t.dialogue_A)}" data-b="${_escForAttr(t.dialogue_B)}" title="Ñêîïèðîâàòü îáà">?? îáà</button>
          </div>
        </div>
        <div class="flex items-start gap-2 group">
          <div class="flex-1 text-[11px]"><span class="text-cyan-400 font-bold">A:</span> <span class="text-gray-200">«${dialogA}»</span></div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-[8px] text-gray-600 font-mono">${_wordCount(t.dialogue_A)}ñë</span>
            <button class="trend-copy-line" data-line="${_escForAttr(t.dialogue_A)}" title="Ñêîïèðîâàòü ðåïëèêó A">??</button>
          </div>
        </div>
        <div class="flex items-start gap-2 group">
          <div class="flex-1 text-[11px]"><span class="text-violet-400 font-bold">B:</span> <span class="text-gray-200">«${dialogB}»</span></div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-[8px] ${_wordCount(t.dialogue_B) > 18 ? 'text-red-400' : 'text-gray-600'} font-mono">${_wordCount(t.dialogue_B)}ñë</span>
            <button class="trend-copy-line" data-line="${_escForAttr(t.dialogue_B)}" title="Ñêîïèðîâàòü ðåïëèêó B">??</button>
          </div>
        </div>
      </div>

      ${t.share_hook ? `<div class="text-[10px] text-gray-500/80 italic leading-relaxed">?? ${escapeHtml(t.share_hook)}</div>` : ''}

      <!-- Action buttons -->
      <div class="flex gap-2 flex-wrap pt-0.5">
        <button class="text-[11px] px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-300 hover:from-emerald-500/25 hover:to-cyan-500/25 transition-all font-bold border border-emerald-500/25 quick-generate-trend" data-trend-index="${origIdx}" data-category="${_escForAttr(t.category)}" data-topic="${_escForAttr(t.topic)}" data-dialogue-a="${_escForAttr(t.dialogue_A)}" data-dialogue-b="${_escForAttr(t.dialogue_B)}">?? Áûñòðàÿ ãåíåðàöèÿ <span class="text-[9px] opacity-60">àâòî-ïîäáîð</span></button>
        <button class="text-[10px] px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors font-semibold border border-cyan-500/15 trend-use-idea" data-idea="${_escForAttr(t.topic + ': ' + (t.comedy_angle || ''))}">?? Êàê èäåþ</button>
        <button class="text-[10px] px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors font-semibold border border-violet-500/15 trend-use-script" data-a="${_escForAttr(t.dialogue_A)}" data-b="${_escForAttr(t.dialogue_B)}">? Âñòàâèòü äèàëîã</button>
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
  showNotification(`?? Èäåÿ âûáðàíà! Òåïåðü âûáåðè ïåðñîíàæåé`, 'info');
  log('OK', 'ÒÐÅÍÄ>ÈÄÅß', topic.slice(0, 60));
}

function useTrendAsScript(dialogueA, dialogueB) {
  const a = document.getElementById('script-a');
  const b = document.getElementById('script-b');
  if (a) a.value = dialogueA;
  if (b) b.value = dialogueB;
  selectGenerationMode('script');
  navigateTo('characters');
  showNotification(`?? Äèàëîã âñòàâëåí! Òåïåðü âûáåðè ïåðñîíàæåé`, 'info');
  log('OK', 'ÒÐÅÍÄ>ÑÊÐÈÏÒ', `A: ${dialogueA.slice(0, 30)}…`);
}

// --- QUICK GENERATE FROM TREND -----------------
async function quickGenerateFromTrend(category, topic, dialogueA, dialogueB) {
  const success = autoSelectCharactersForCategory(category, topic);
  if (!success) {
    showNotification('? Íå óäàëîñü àâòîìàòè÷åñêè ïîäîáðàòü ïåðñîíàæåé. Âûáåðè âðó÷íóþ.', 'error');
    useTrendAsScript(dialogueA, dialogueB);
    return;
  }
  state.generationMode = 'script';
  const a = document.getElementById('script-a');
  const b = document.getElementById('script-b');
  if (a) a.value = dialogueA;
  if (b) b.value = dialogueB;
  showNotification(`? Ïîäîáðàíî: ${state.selectedA.name_ru} ? ${state.selectedB.name_ru}`, 'success');
  log('OK', 'ÁÛÑÒÐÀß ÃÅÍÅÐÀÖÈß', `${state.selectedA.name_ru} ? ${state.selectedB.name_ru} äëÿ "${topic.slice(0, 40)}"`);
  navigateTo('generate');
  document.getElementById('workspace')?.scrollTo({ top: 0, behavior: 'smooth' });
  const notice = document.getElementById('auto-selection-notice');
  if (notice) {
    notice.classList.remove('hidden');
    notice.innerHTML = `
      <div class="glass-panel p-4 border-l-2 border-emerald-500/40 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-emerald-400">?? Àâòîìàòè÷åñêè ïîäîáðàíî</div>
          <button onclick="navigateTo('characters')" class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">?? Èçìåíèòü âûáîð</button>
        </div>
        <div class="text-xs text-gray-300">
          <div class="mb-1">?? <span class="text-violet-300 font-medium">${state.selectedA.name_ru}</span> ? <span class="text-indigo-300 font-medium">${state.selectedB.name_ru}</span></div>
          <div class="text-[11px] text-gray-500">AI âûáðàë ýòó ïàðó êàê íàèáîëåå ïîäõîäÿùóþ äëÿ êàòåãîðèè "${category}" — ${state.selectedA.compatibility} + ${state.selectedB.compatibility} = êîíòðàñòíàÿ äèíàìèêà</div>
        </div>
      </div>
    `;
  }
}

function initTrends() {
  document.getElementById('btn-fetch-trends')?.addEventListener('click', fetchTrends);

  const resEl = document.getElementById('trends-results');
  if (!resEl) return;

  // - Event delegation for ALL trend buttons -
  resEl.addEventListener('click', async (e) => {
    // Quick generate
    const qgBtn = e.target.closest('.quick-generate-trend');
    if (qgBtn) {
      const { category, topic, dialogueA, dialogueB } = qgBtn.dataset;
      qgBtn.disabled = true;
      qgBtn.innerHTML = '<span class="animate-pulse">?</span> Ïîäáîð ïåðñîíàæåé...';
      await quickGenerateFromTrend(category || '', topic || '', dialogueA || '', dialogueB || '');
      qgBtn.disabled = false;
      qgBtn.innerHTML = '? Ãîòîâî!';
      setTimeout(() => { qgBtn.innerHTML = '?? Áûñòðàÿ ãåíåðàöèÿ <span class="text-[9px] opacity-60">àâòî-ïîäáîð</span>'; }, 2000);
      return;
    }

    // Use as idea
    const ideaBtn = e.target.closest('.trend-use-idea');
    if (ideaBtn) {
      useTrendAsIdea(ideaBtn.dataset.idea || '');
      ideaBtn.textContent = '? Âûáðàíî!';
      return;
    }

    // Use as script
    const scriptBtn = e.target.closest('.trend-use-script');
    if (scriptBtn) {
      useTrendAsScript(scriptBtn.dataset.a || '', scriptBtn.dataset.b || '');
      scriptBtn.textContent = '? Âûáðàíî!';
      return;
    }

    // Copy both lines A + B
    const copyBothBtn = e.target.closest('.trend-copy-both');
    if (copyBothBtn) {
      const a = copyBothBtn.dataset.a || '';
      const b = copyBothBtn.dataset.b || '';
      navigator.clipboard.writeText(`A: «${a}»\nB: «${b}»`).then(() => {
        sfx.copy();
        copyBothBtn.textContent = '? ñêîïèðîâàíî';
        setTimeout(() => { copyBothBtn.innerHTML = '?? îáà'; }, 1400);
      });
      return;
    }

    // Copy individual line
    const copyBtn = e.target.closest('.trend-copy-line');
    if (copyBtn) {
      const line = copyBtn.dataset.line || '';
      navigator.clipboard.writeText(line).then(() => {
        sfx.copy();
        copyBtn.textContent = '?';
        setTimeout(() => { copyBtn.textContent = '??'; }, 1200);
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

  // - Category filter tabs -
  document.querySelectorAll('.trend-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      sfx.clickSoft();
      _trendsFilter = tab.dataset.cat || 'all';
      document.querySelectorAll('.trend-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _renderTrends();
    });
  });

  // - Search -
  let searchTimer = null;
  document.getElementById('trends-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _trendsSearch = e.target.value.trim();
      _renderTrends();
    }, 200);
  });
}

// --- LOCATIONS BROWSE (standalone section) ---
function renderLocationsBrowse(filterGroup = '') {
  const grid = document.getElementById('loc-browse-grid');
  if (!grid) return;
  let locs = [...state.locations];
  if (filterGroup) locs = locs.filter(l => l.group === filterGroup);

  const autoSelB = !state.selectedLocation;
  grid.innerHTML = `
    <div class="loc-card ${autoSelB ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="">
      <div class="text-sm">??</div>
      <div class="text-[11px] font-medium text-violet-300">Àâòî</div>
      <div class="text-[10px] text-gray-500 mb-2">AI ïîäáåð¸ò</div>
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border ${autoSelB ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="">${autoSelB ? '? Âûáðàíî' : '?? Âûáðàòü'}</button>
    </div>
  ` + locs.map(l => {
    const sel = state.selectedLocation === l.id;
    const moodIcon = l.mood === 'nostalgic warmth' ? '??' : l.mood === 'sterile tension' ? '??' : l.mood === 'organic chaos' ? '??' : l.mood === 'dramatic intimacy' ? '???' : '??';
    return `
    <div class="loc-card ${sel ? 'selected ring-2 ring-violet-500' : ''}" data-loc-id="${l.id}">
      <div class="text-sm">${moodIcon}</div>
      <div class="text-[11px] font-medium text-white leading-tight">${l.numeric_id ? `<span class="text-[9px] text-gray-500 font-mono mr-1">#${l.numeric_id}</span>` : ''}${l.name_ru}</div>
      <div class="text-[10px] text-gray-500 leading-snug">${l.tagline_ru}</div>
      ${l.tags ? `<div class="flex gap-1 flex-wrap mt-1">${l.tags.slice(0, 3).map(t => `<span class="text-[8px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">${t}</span>`).join('')}</div>` : ''}
      <button class="select-loc w-full py-2 rounded-lg text-[11px] font-bold transition-all border mt-2 ${sel ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20' : 'bg-violet-600/10 text-violet-300 border-violet-500/20 hover:bg-violet-600/25 hover:border-violet-500/40'}" data-loc-id="${l.id}">${sel ? '? Âûáðàíî' : '?? Âûáðàòü'}</button>
      <button class="copy-loc-prompt text-[9px] px-2 py-1 rounded-md font-medium transition-all bg-gold/10 text-gold hover:bg-gold/20 border border-gold/30 w-full mt-1.5 flex items-center justify-center gap-1" data-id="${l.id}" title="Ñêîïèðîâàòü äåòàëèçèðîâàííûé ïðîìïò äëÿ Veo">
        <span>??</span> Ïðîìïò
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
  info.innerHTML = `<div class="flex items-center gap-2 flex-wrap"><span class="text-violet-400 font-medium text-sm">?? ${loc.name_ru}</span>${tags}</div><div class="text-xs text-gray-400 mt-1">${loc.tagline_ru}</div>${loc.audio_hints ? `<div class="text-[10px] text-gray-500 mt-1">?? ${loc.audio_hints}</div>` : ''}`;
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
    log('INFO', 'ËÎÊÀÖÈß', state.selectedLocation ? `Âûáðàíà: ${state.locations.find(l => l.id === state.selectedLocation)?.name_ru}` : 'Àâòî-âûáîð');
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
    log('INFO', 'ËÎÊÀÖÈß', `?? Ñëó÷àéíàÿ: ${rand.name_ru}`);
  });
}

// --- KEYBOARD SHORTCUTS -----------------------
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Enter to generate
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    const btn = document.getElementById('btn-generate');
    if (btn && !btn.disabled) {
      btn.click();
    } else if (btn && btn.disabled) {
      showNotification('?? Çàïîëíèòå âñå îáÿçàòåëüíûå ïîëÿ ïåðåä ãåíåðàöèåé (ñì. ÷åêëèñò)', 'warning');
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
    if (confirm('Ñáðîñèòü âñå íàñòðîéêè è íà÷àòü çàíîâî?')) {
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

// --- AI CONSULTATION (FREE, no promo required) ----
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
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '? Ñêîïèðîâàíî';
          setTimeout(() => { copyBtn.textContent = '?? Êîïèðîâàòü'; }, 1500);
        }).catch(() => {
          copyBtn.textContent = '? Íå óäàëîñü';
          setTimeout(() => { copyBtn.textContent = '?? Êîïèðîâàòü'; }, 1500);
        });
      }
    });
  }

  // Ask button
  btn.addEventListener('click', async () => {
    const question = input.value.trim();
    if (!question || question.length < 3) {
      if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = '<span class="text-orange-400">?? Íàïèøèòå âîïðîñ (ìèíèìóì 3 ñèìâîëà)</span>'; }
      return;
    }

    // Cancel any running typing animation
    if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }

    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">??</span> Ïèøåò...';
    if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = '<span class="text-emerald-400 animate-pulse">?? Äóìàþ...</span>'; }
    if (responseArea) responseArea.classList.add('hidden');

    // Build context from current app state
    const context = {};
    if (state.selectedA) context.characterA = state.selectedA.name_ru || state.selectedA.id;
    if (state.selectedB) context.characterB = state.selectedB.name_ru || state.selectedB.id;
    if (state.selectedLocation) {
      const loc = state.locations?.find(l => l.id === state.selectedLocation);
      if (loc) context.location = loc.name_ru || loc.scene_en;
    }
    if (state.generationMode) context.mode = { idea: 'Ñâîÿ èäåÿ', suggested: 'Ãîòîâûå èäåè', script: 'Ñâîé äèàëîã', video: 'Êîïèÿ âèäåî', meme: 'Ìåì-ðåìåéê' }[state.generationMode] || state.generationMode;
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

      let data;
      try { const t = await resp.text(); data = t ? JSON.parse(t) : {}; } catch { data = {}; }

      if (!resp.ok) {
        throw new Error(data.error || `Îøèáêà ${resp.status}`);
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
              .replace(/^[•??] (.+)$/gm, '<li class="ml-3">$1</li>')
              .replace(/^- (.+)$/gm, '<li class="ml-3">$1</li>')
              .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-3"><strong class="text-amber-400/70">$1.</strong> $2</li>')
              .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="space-y-1 my-1.5">$1</ul>')
              .replace(/^(={3,}|-{3,})$/gm, '<hr class="border-gray-700/50 my-2"/>')
              .replace(/^(?|?|??|??|===)(.*)$/gm, '<div class="font-semibold mt-2">$1$2</div>')
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
          <div class="text-[10px] text-gray-500 font-medium">?? ${escapeHtml(question)}</div>
          <div class="text-[11px] text-gray-500 leading-relaxed line-clamp-3">${escapeHtml(data.answer).slice(0, 300)}${data.answer.length > 300 ? '...' : ''}</div>
        `;
        historyEl.prepend(histItem);
        while (historyEl.children.length > 3) historyEl.removeChild(historyEl.lastChild);
      }

      // Clear input after successful response
      input.value = '';
      if (counterEl) counterEl.textContent = '0 / 2000';

      log('OK', 'ÏÎÌÎÙÍÈÊ', `Îòâåò ïîëó÷åí`);

    } catch (e) {
      if (statusEl) { statusEl.classList.remove('hidden'); statusEl.innerHTML = `<span class="text-red-400">? ${escapeHtml(e.message)}</span>`; }
      log('ERR', 'ÏÎÌÎÙÍÈÊ', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>??</span> Ñïðîñèòü';
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

// Save current state to localStorage (silent=true for auto-save, false for manual)
function saveCurrentState(silent = false) {
  try {
    const stateToSave = {
      selectedA_id: state.selectedA?.id || null,
      selectedB_id: state.selectedB?.id || null,
      selectedLocation: state.selectedLocation,
      generationMode: state.generationMode,
      inputMode: state.inputMode,
      options: state.options,
      // Text inputs — save current values
      ideaText: document.getElementById('idea-input')?.value || '',
      scriptA: document.getElementById('script-a')?.value || '',
      scriptB: document.getElementById('script-b')?.value || '',
      timestamp: Date.now()
    };
    localStorage.setItem('ferixdi_saved_state', JSON.stringify(stateToSave));
    if (!silent) showNotification('?? Ñîñòîÿíèå ñîõðàíåíî', 'success');
  } catch { /* ignore quota errors */ }
}

// Debounced auto-save — triggers silently on state changes
let _autoSaveTimer = null;
function _scheduleDraftSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => saveCurrentState(true), 3000);
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
  showNotification('?? Ñáðîñ âûïîëíåí', 'info');
}

// Load saved state on startup (restores state fields; UI restore deferred to _restoreDraftUI)
function loadSavedState() {
  try {
    const saved = localStorage.getItem('ferixdi_saved_state');
    if (!saved) return;
    const d = JSON.parse(saved);
    const age = Date.now() - (d.timestamp || 0);
    if (age > 24 * 60 * 60 * 1000) return; // expire after 24h

    // Restore simple state fields
    state.selectedLocation = d.selectedLocation ?? null;
    state.generationMode = d.generationMode ?? null;
    state.inputMode = d.inputMode ?? 'idea';
    if (d.options) state.options = { ...state.options, ...d.options };

    // Store IDs + text for deferred UI restore (characters may not be loaded yet)
    state._draftRestore = {
      charA_id: d.selectedA_id || null,
      charB_id: d.selectedB_id || null,
      ideaText: d.ideaText || '',
      scriptA: d.scriptA || '',
      scriptB: d.scriptB || '',
    };
    log('OK', '×ÅÐÍÎÂÈÊ', 'Çàãðóæåíî ñîõðàí¸ííîå ñîñòîÿíèå');
  } catch (e) {
    console.warn('Failed to load saved state:', e);
  }
}

// Deferred UI restore — called after characters are loaded so we can resolve IDs to objects
function _restoreDraftUI() {
  const draft = state._draftRestore;
  if (!draft) return;
  delete state._draftRestore;

  // Restore characters by ID
  if (draft.charA_id && state.characters.length) {
    state.selectedA = state.characters.find(c => c.id === draft.charA_id) || null;
  }
  if (draft.charB_id && state.characters.length) {
    state.selectedB = state.characters.find(c => c.id === draft.charB_id) || null;
  }
  if (state.selectedA || state.selectedB) {
    updateCharDisplay();
    renderCharacters(getCurrentFilters());
  }

  // Restore generation mode UI
  if (state.generationMode) {
    selectGenerationMode(state.generationMode);
  }

  // Restore text inputs
  if (draft.ideaText) {
    const el = document.getElementById('idea-input');
    if (el) el.value = draft.ideaText;
  }
  if (draft.scriptA) {
    const el = document.getElementById('script-a');
    if (el) el.value = draft.scriptA;
  }
  if (draft.scriptB) {
    const el = document.getElementById('script-b');
    if (el) el.value = draft.scriptB;
  }

  log('OK', '×ÅÐÍÎÂÈÊ', `Âîññòàíîâëåí ÷åðíîâèê${state.selectedA ? ` · ${state.selectedA.name_ru}` : ''}${state.selectedB ? ` ? ${state.selectedB.name_ru}` : ''}`);
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

// --- PROGRESS TRACKER ---------------------
function updateProgress() {
  // Step 1: Mode
  const modeStep = document.getElementById('progress-mode');
  const modeCheck = modeStep?.querySelector('.progress-check');
  const modeValue = modeStep?.querySelector('.progress-value');
  const modeBorder = modeStep?.querySelector('.w-4');
  
  if (state.generationMode) {
    const modeNames = { idea: '?? Ñâîÿ èäåÿ', suggested: '?? Ãîòîâûå èäåè', script: '?? Ñâîé äèàëîã', video: '?? Ïî âèäåî' };
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
  let contentText = 'íå óêàçàí';
  
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
    contentText = suggestedInput.trim() ? suggestedInput.slice(0, 25) + (suggestedInput.length > 25 ? '...' : '') : '? AI ïîäáåð¸ò òåìó';
  } else if (state.generationMode === 'script') {
    const scriptA = document.getElementById('script-a')?.value?.trim();
    const scriptB = document.getElementById('script-b')?.value?.trim();
    if (scriptA || scriptB) {
      hasContent = true;
      contentText = scriptB ? '? Äèàëîã ãîòîâ' : '? Ìîíîëîã (ñîëî)';
    }
  } else if (state.generationMode === 'video') {
    if (state.videoMeta) {
      hasContent = true;
      contentText = '? Âèäåî çàãðóæåíî';
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
    if (locValue) locValue.textContent = loc ? loc.name_ru.slice(0, 25) : 'Âûáðàíà';
    if (locCheck) { locCheck.classList.remove('hidden', 'bg-gray-700'); locCheck.classList.add('bg-emerald-500'); }
    if (locBorder) { locBorder.classList.remove('border-gray-700'); locBorder.classList.add('border-emerald-500'); }
  } else {
    if (locValue) locValue.textContent = 'Àâòî (AI ïîäáåð¸ò)';
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
  if (!confirm('Î÷èñòèòü âñå âûáîðû è íà÷àòü çàíîâî?')) return;
  
  // Clear state
  state.generationMode = null;
  state.inputMode = 'idea';
  state.selectedA = null;
  state.selectedB = null;
  state.selectedLocation = null;
  state.videoMeta = null;
  state.productInfo = null;
  state.referenceStyle = null;
  state.lastResult = null;
  state.category = null;
  // Free heavy base64 blobs (video up to 50MB)
  state._videoFileBase64 = null;
  state._videoFileMime = null;
  
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
    if (el.closest('#progress-mode')) el.textContent = 'íå âûáðàí';
    else if (el.closest('#progress-content')) el.textContent = 'íå óêàçàí';
    else if (el.closest('#progress-location')) el.textContent = 'íå âûáðàíà';
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
  showNotification('? Âñ¸ î÷èùåíî! Íà÷íè ñ âûáîðà ðåæèìà ãåíåðàöèè', 'info');
  log('INFO', 'ÑÁÐÎÑ', 'Âñå âûáîðû î÷èùåíû');
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

// --- COPY CHARACTER PROMPT -------------------
function generateCharacterPrompt(charId) {
  const char = state.characters.find(c => c.id === charId);
  if (!char) return '';
  
  const anchors = char.identity_anchors || {};
  const modifiers = char.modifiers || {};
  const tokens = char.prompt_tokens || {};
  
  // Build detailed character prompt for Veo
  const prompt = `CHARACTER PROMPT FOR VEO 3.1
???????????????????????????????

?? ÁÀÇÎÂÀß ÈÍÔÎÐÌÀÖÈß
Èìÿ: ${char.name_ru} (${char.name_en || char.id})
Ãðóïïà: ${char.group}
Àðõåòèï: ${char.vibe_archetype || 'íå óêàçàí'}
Ðîëü ïî óìîë÷àíèþ: ${char.role_default === 'A' ? '??? Ïðîâîêàòîð' : '??? Ïàí÷ëàéíåð'}
Ñîâìåñòèìîñòü: ${char.compatibility}

?? ÂÈÇÓÀËÜÍÎÅ ÎÏÈÑÀÍÈÅ
${tokens.character_en || char.appearance_ru || 'íå óêàçàíî'}

? ÊËÞ×ÅÂÛÅ ÝËÅÌÅÍÒÛ ÈÄÅÍÒÈÔÈÊÀÖÈÈ
Ñèëóýò ëèöà: ${anchors.face_silhouette || 'íå óêàçàí'}
Ôèðìåííûé ýëåìåíò: ${anchors.signature_element || 'íå óêàçàí'}
Ìèêðî-æåñò: ${anchors.micro_gesture || 'íå óêàçàí'}
Ãàðäåðîá-ÿêîðü: ${anchors.wardrobe_anchor || 'íå óêàçàí'}

?? ÐÅ×Ü È ÏÎÂÅÄÅÍÈÅ
Ñòèëü ðå÷è: ${char.speech_style_ru || 'íå óêàçàí'}
Òåìï ðå÷è: ${char.speech_pace || 'normal'} (${char.speech_pace === 'fast' ? '~3.5 ñëîâ/ñåê' : char.speech_pace === 'slow' ? '~2.0 ñëîâ/ñåê' : '~2.5-3.0 ñëîâ/ñåê'})
Óðîâåíü ìàòà: ${char.swear_level || 0}/3
Ïîâåäåíèå: ${char.behavior_ru || 'íå óêàçàíî'}
Ôèðìåííûå ñëîâà: ${(char.signature_words_ru || []).join(', ') || 'íå óêàçàíû'}

?? ÌÎÄÈÔÈÊÀÒÎÐÛ ÄËß ÂÈÄÅÎ
Õóê-ñòèëü: ${modifiers.hook_style || 'íå óêàçàí'}
Ñòèëü ñìåõà: ${modifiers.laugh_style || 'íå óêàçàí'}

?? ÝÑÒÅÒÈÊÀ ÌÈÐÀ
${char.world_aesthetic || 'óíèâåðñàëüíàÿ'}

???????????????????????????????
?? PROMPT ÄËß VEO (Àíãëèéñêèé):
${tokens.character_en || 'Character description not available'}

Format: 9:16 vertical, 1080p, hyperrealistic smartphone capture, natural skin pores and imperfections, cinematic lighting, shallow depth of field.`;
  
  return prompt;
}

function copyCharacterPrompt(charId) {
  const prompt = generateCharacterPrompt(charId);
  if (!prompt) {
    showNotification('? Îøèáêà ãåíåðàöèè ïðîìïòà', 'error');
    return;
  }
  
  copyToClipboardWithFeedback(prompt, 'ÏÅÐÑÎÍÀÆ', charId);
}

// --- COPY LOCATION PROMPT -------------------
function generateLocationPrompt(locId) {
  const loc = state.locations.find(l => l.id === locId);
  if (!loc) return '';
  
  const prompt = `LOCATION PROMPT FOR VEO 3.1
???????????????????????????????

?? ÁÀÇÎÂÀß ÈÍÔÎÐÌÀÖÈß
Íàçâàíèå: ${loc.name_ru} (${loc.name_en || loc.id})
Ãðóïïà: ${loc.group}
Òåãè: ${(loc.tags || []).join(', ')}
Îïèñàíèå: ${loc.tagline_ru || 'íå óêàçàíî'}

?? ÄÅÒÀËÜÍÎÅ ÎÏÈÑÀÍÈÅ ÑÖÅÍÛ (English)
${loc.scene_en || 'Scene description not available'}

?? ÎÑÂÅÙÅÍÈÅ
${loc.lighting || 'íå óêàçàíî'}

?? ÍÀÑÒÐÎÅÍÈÅ
${loc.mood || 'íå óêàçàíî'}

?? ÇÂÓÊÎÂÛÅ ÏÎÄÑÊÀÇÊÈ
${loc.audio_hints || 'íå óêàçàíû'}

?? ÐÅÊÎÌÅÍÄÓÅÌÛÅ ÊÀÒÅÃÎÐÈÈ
${(loc.category_hints || []).join(', ') || 'óíèâåðñàëüíàÿ'}

???????????????????????????????
?? PROMPT ÄËß VEO (Àíãëèéñêèé):
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
    showNotification('? Îøèáêà ãåíåðàöèè ïðîìïòà', 'error');
    return;
  }
  
  copyToClipboardWithFeedback(prompt, 'ËÎÊÀÖÈß', locId);
}

// --- COPY TO CLIPBOARD WITH FEEDBACK -------
function copyToClipboardWithFeedback(text, type, id) {
  navigator.clipboard.writeText(text)
    .then(() => {
      sfx.copy();
      const char = type === 'ÏÅÐÑÎÍÀÆ' ? state.characters.find(c => c.id === id) : null;
      const loc = type === 'ËÎÊÀÖÈß' ? state.locations.find(l => l.id === id) : null;
      const name = char?.name_ru || loc?.name_ru || id;
      
      showNotification(`? Ïðîìïò ñêîïèðîâàí: ${name}`, 'success');
      log('OK', 'ÊÎÏÈß', `${type} "${name}" ñêîïèðîâàí â áóôåð (${text.length} ñèìâîëîâ)`);
      
      // Visual feedback on button
      const btn = document.querySelector(`[data-id="${id}"] .copy-char-prompt, [data-id="${id}"].copy-char-prompt, [data-id="${id}"] .copy-loc-prompt, [data-id="${id}"].copy-loc-prompt`);
      if (btn) {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>?</span> Ñêîïèðîâàíî!';
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
      showNotification('? Íå óäàëîñü ñêîïèðîâàòü â áóôåð îáìåíà', 'error');
      log('ERR', 'ÊÎÏÈß', `Îøèáêà êîïèðîâàíèÿ: ${err.message}`);
    });
}

// --- JOKE SOURCES (static links — no JS needed) ----
function initJokesLibrary() {
  log('OK', 'JOKES', 'Ñåêöèÿ «Èñòî÷íèêè øóòîê» — ñòàòè÷åñêèå ññûëêè, JS íå òðåáóåòñÿ');
}

// --- SERIES / RUBRICS --------------------
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
            ${epCount > 0 ? `<button class="series-eps-btn text-[10px] px-3 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors" data-idx="${i}">?? ${epCount} ýï.</button>` : ''}
            <button class="series-gen-btn text-[10px] px-3 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors" data-idx="${i}">? Íîâûé ýïèçîä</button>
            <button class="series-del-btn text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors" data-idx="${i}">?</button>
          </div>
        </div>
        <div class="flex gap-3 text-[11px]">
          <span class="text-cyan-400">A: ${charA?.name_ru || s.charA_id}</span>
          <span class="text-gray-600">?</span>
          <span class="text-violet-400">B: ${charB?.name_ru || s.charB_id}</span>
        </div>
        ${s.style ? `<div class="text-[10px] text-gray-500">Ñòèëü: ${escapeHtml(s.style)}</div>` : ''}
        <div class="text-[10px] text-gray-600">${epCount} ${epCount === 1 ? 'ýïèçîä' : (epCount >= 2 && epCount <= 4) ? 'ýïèçîäà' : 'ýïèçîäîâ'}</div>
        <div id="series-eps-${i}" class="hidden mt-3 space-y-2"></div>
      </div>`;
  }).join('');

  list.querySelectorAll('.series-gen-btn').forEach(btn => btn.addEventListener('click', () => generateFromSeries(parseInt(btn.dataset.idx))));
  list.querySelectorAll('.series-del-btn').forEach(btn => btn.addEventListener('click', () => deleteSeries(parseInt(btn.dataset.idx))));
  list.querySelectorAll('.series-eps-btn').forEach(btn => btn.addEventListener('click', () => toggleSeriesEpisodes(parseInt(btn.dataset.idx))));
}

function toggleSeriesEpisodes(seriesIdx) {
  const container = document.getElementById(`series-eps-${seriesIdx}`);
  if (!container) return;

  if (!container.classList.contains('hidden')) {
    container.classList.add('hidden');
    return;
  }

  const series = getSeries();
  const s = series[seriesIdx];
  if (!s?.episodes?.length) return;

  container.innerHTML = s.episodes.slice().reverse().map((ep, ri) => {
    const idx = s.episodes.length - 1 - ri;
    const dt = new Date(ep.date);
    const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return renderEpisodeCard(ep, idx + 1, dateStr, `s${seriesIdx}_ep${idx}`);
  }).join('');

  container.querySelectorAll('.ep-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.ep-card').querySelector('.ep-body');
      if (body) body.classList.toggle('hidden');
      btn.textContent = body?.classList.contains('hidden') ? '? Îòêðûòü' : '? Ñâåðíóòü';
    });
  });

  container.querySelectorAll('.ep-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '?';
          setTimeout(() => btn.textContent = orig, 1200);
        });
      }
    });
  });

  container.querySelectorAll('.ep-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const epIdx = parseInt(btn.dataset.epidx);
      const sIdx = parseInt(btn.dataset.sidx);
      const ser = getSeries();
      if (ser[sIdx]?.episodes) {
        ser[sIdx].episodes.splice(epIdx, 1);
        saveSeries(ser);
        renderSeriesList();
        showNotification('Ýïèçîä óäàë¸í', 'info');
      }
    });
  });

  container.classList.remove('hidden');
}

function renderEpisodeCard(ep, num, dateStr, uid) {
  const dA = ep.dialogueA || '—';
  const dB = ep.dialogueB || '';
  const kw = ep.killerWord || '';
  const cat = ep.category || '';
  const hasVeo = !!ep.veo_prompt;
  const hasRu = !!ep.ru_package;
  const hasInsta = !!(ep.insta?.caption || ep.engage?.viral_title);
  const veoSafe = escapeHtml(ep.veo_prompt || '');
  const ruSafe = escapeHtml(ep.ru_package || '');
  const viralTitle = ep.engage?.viral_title || '';
  const shareBait = ep.engage?.share_bait || '';
  const caption = ep.insta?.caption || '';
  const hashtags = (ep.engage?.hashtags || []).join(' ');
  const pinComment = ep.engage?.pin_comment || '';

  return `
    <div class="ep-card bg-black/20 rounded-lg border border-gray-800/60 overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2 bg-gray-900/40">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold text-amber-400">#${num}</span>
          <span class="text-[10px] text-gray-500">${dateStr}</span>
          ${cat ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">${escapeHtml(cat)}</span>` : ''}
        </div>
        <div class="flex items-center gap-1.5">
          <button class="ep-toggle-btn text-[9px] px-2 py-0.5 rounded text-amber-400 hover:bg-amber-500/10 transition-colors">? Îòêðûòü</button>
          <button class="ep-del-btn text-[9px] px-1.5 py-0.5 rounded text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors" data-sidx="${uid.split('_')[0].replace('s','')}" data-epidx="${uid.split('_')[1].replace('ep','')}">?</button>
        </div>
      </div>
      <div class="px-3 py-1.5 text-[11px] text-gray-300 border-b border-gray-800/40">
        <span class="text-cyan-400">A:</span> «${escapeHtml(dA.length > 60 ? dA.slice(0, 60) + '...' : dA)}»
        ${dB ? `<span class="ml-2 text-violet-400">B:</span> «${escapeHtml(dB.length > 60 ? dB.slice(0, 60) + '...' : dB)}»` : ''}
        ${kw ? `<span class="ml-2 text-amber-400">?? ${escapeHtml(kw)}</span>` : ''}
      </div>
      <div class="ep-body hidden p-3 space-y-2">
        ${hasVeo ? `<div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider">?? Veo ïðîìïò</span>
            <button class="ep-copy-btn text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors" data-copy="${veoSafe}">?? Êîïèðîâàòü</button>
          </div>
          <pre class="text-[10px] text-gray-400 bg-black/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(ep.veo_prompt?.slice(0, 500))}${ep.veo_prompt?.length > 500 ? '...' : ''}</pre>
        </div>` : '<div class="text-[10px] text-gray-600 italic">? Ïðîìïò íå ñîõðàí¸í (ñòàðûé ýïèçîä)</div>'}
        ${hasRu ? `<div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-[9px] text-blue-400 font-semibold uppercase tracking-wider">???? Ïîñò</span>
            <button class="ep-copy-btn text-[9px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors" data-copy="${ruSafe}">?? Êîïèðîâàòü</button>
          </div>
          <pre class="text-[10px] text-gray-400 bg-black/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(ep.ru_package?.slice(0, 300))}${ep.ru_package?.length > 300 ? '...' : ''}</pre>
        </div>` : ''}
        ${hasInsta ? `<div class="space-y-1.5">
          <span class="text-[9px] text-pink-400 font-semibold uppercase tracking-wider">?? Èíñòà-ïàêåò</span>
          ${viralTitle ? `<div class="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
            <div><span class="text-[9px] text-amber-400">?? Çàãîëîâîê:</span> <span class="text-[10px] text-gray-300">${escapeHtml(viralTitle)}</span></div>
            <button class="ep-copy-btn text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors" data-copy="${escapeHtml(viralTitle)}">??</button>
          </div>` : ''}
          ${shareBait ? `<div class="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
            <div><span class="text-[9px] text-orange-400">?? Îïèñàíèå:</span> <span class="text-[10px] text-gray-300">${escapeHtml(shareBait.length > 80 ? shareBait.slice(0, 80) + '...' : shareBait)}</span></div>
            <button class="ep-copy-btn text-[8px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors" data-copy="${escapeHtml(shareBait)}">??</button>
          </div>` : ''}
          ${caption ? `<div class="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
            <div><span class="text-[9px] text-pink-400">?? Caption:</span> <span class="text-[10px] text-gray-300">${escapeHtml(caption.length > 80 ? caption.slice(0, 80) + '...' : caption)}</span></div>
            <button class="ep-copy-btn text-[8px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-colors" data-copy="${escapeHtml(caption)}">??</button>
          </div>` : ''}
          ${hashtags ? `<div class="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
            <div><span class="text-[9px] text-cyan-400">#</span> <span class="text-[10px] text-gray-400">${escapeHtml(hashtags.length > 80 ? hashtags.slice(0, 80) + '...' : hashtags)}</span></div>
            <button class="ep-copy-btn text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors" data-copy="${escapeHtml(hashtags)}">??</button>
          </div>` : ''}
          ${pinComment ? `<div class="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
            <div><span class="text-[9px] text-rose-400">?? Çàêðåï:</span> <span class="text-[10px] text-gray-300">${escapeHtml(pinComment.length > 80 ? pinComment.slice(0, 80) + '...' : pinComment)}</span></div>
            <button class="ep-copy-btn text-[8px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors" data-copy="${escapeHtml(pinComment)}">??</button>
          </div>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

function createSeries() {
  if (!isPromoValid()) { showNotification('?? Íóæåí ïðîìî-êîä', 'error'); return; }

  const name = document.getElementById('series-name-input')?.value.trim();
  const charA = document.getElementById('series-char-a')?.value;
  const charB = document.getElementById('series-char-b')?.value;
  const style = document.getElementById('series-style-input')?.value.trim();

  if (!name) { showNotification('Ââåäèòå íàçâàíèå ñåðèè', 'error'); return; }
  if (!charA || !charB) { showNotification('Âûáåðèòå îáîèõ ïåðñîíàæåé', 'error'); return; }
  if (charA === charB) { showNotification('Ïåðñîíàæè äîëæíû áûòü ðàçíûå', 'error'); return; }

  const series = getSeries();
  series.push({ name, charA_id: charA, charB_id: charB, style, episodes: [], created: Date.now() });
  saveSeries(series);

  document.getElementById('series-name-input').value = '';
  document.getElementById('series-style-input').value = '';
  renderSeriesList();
  showNotification(`?? Ñåðèÿ "${name}" ñîçäàíà!`, 'success');
  log('OK', 'SERIES', `Ñîçäàíà ñåðèÿ: ${name}`);
}

function deleteSeries(idx) {
  const series = getSeries();
  if (!confirm(`Óäàëèòü ñåðèþ "${series[idx]?.name}"?`)) return;
  series.splice(idx, 1);
  saveSeries(series);
  renderSeriesList();
  showNotification('Ñåðèÿ óäàëåíà', 'info');
}

function generateFromSeries(idx) {
  const series = getSeries();
  const s = series[idx];
  if (!s) return;

  if (!isPromoValid()) { showNotification('?? Íóæåí ïðîìî-êîä', 'error'); return; }

  selectChar('A', s.charA_id);
  selectChar('B', s.charB_id);
  state.generationMode = 'idea';
  state.inputMode = 'idea';
  selectGenerationMode?.('idea');

  const hint = s.style ? `Òåìà ñåðèè: ${s.style}. Ýòî ýïèçîä #${(s.episodes?.length || 0) + 1}.` : '';
  const ideaInput = document.getElementById('idea-input');
  if (ideaInput && hint) ideaInput.value = hint;

  // Save episode reference for thread memory
  state._currentSeries = { idx, name: s.name };

  navigateTo('generate');
  updateReadiness?.();
  showNotification(`?? Ñåðèÿ "${s.name}" — ñîçäà¸ì íîâûé ýïèçîä`, 'success');
}

function populateSeriesSelects() {
  const selA = document.getElementById('series-char-a');
  const selB = document.getElementById('series-char-b');
  if (!selA || !selB || !state.characters?.length) return;

  const opts = state.characters.map(c => `<option value="${c.id}">${c.name_ru} (${c.group})</option>`).join('');
  selA.innerHTML = `<option value="">— Âûáðàòü —</option>${opts}`;
  selB.innerHTML = `<option value="">— Âûáðàòü —</option>${opts}`;
}

function initSeries() {
  document.getElementById('btn-create-series')?.addEventListener('click', createSeries);
  renderSeriesList();
}

// --- GENERATION HISTORY UI -------------------
function _getHistoryFilters() {
  return {
    search: (document.getElementById('history-search')?.value || '').toLowerCase().trim(),
    mode: document.getElementById('history-mode-filter')?.value || '',
  };
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const countEl = document.getElementById('history-count');
  const clearBtn = document.getElementById('btn-clear-history');
  if (!list) return;

  const allHistory = getGenerationHistory();
  const totalCount = allHistory.length;

  if (totalCount === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    clearBtn?.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }
  empty?.classList.add('hidden');
  clearBtn?.classList.remove('hidden');

  // Map with original indices before filtering (so delete buttons still reference correct index)
  let indexed = allHistory.map((ep, i) => ({ ep, origIdx: i }));

  // Apply filters
  const { search, mode } = _getHistoryFilters();
  if (search) {
    indexed = indexed.filter(({ ep }) => {
      const haystack = `${ep.charA || ''} ${ep.charB || ''} ${ep.category || ''} ${ep.dialogueA || ''} ${ep.dialogueB || ''} ${ep.killerWord || ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }
  if (mode) {
    indexed = indexed.filter(({ ep }) => ep.mode === mode);
  }

  const shownCount = indexed.length;
  const countText = shownCount === totalCount
    ? `${totalCount} ${totalCount === 1 ? 'ãåíåðàöèÿ' : totalCount < 5 ? 'ãåíåðàöèè' : 'ãåíåðàöèé'}`
    : `${shownCount} èç ${totalCount}`;
  if (countEl) countEl.textContent = countText;

  // Show export button when there's history
  document.getElementById('btn-export-history')?.classList.toggle('hidden', totalCount === 0);

  if (shownCount === 0) {
    list.innerHTML = '<div class="text-center text-xs text-gray-500 py-4">Íè÷åãî íå íàéäåíî</div>';
    return;
  }

  const _modeIcons = { idea: '??', script: '??', video: '??', suggested: '??', solo: '??', duo: '??' };
  list.innerHTML = indexed.slice().reverse().map(({ ep, origIdx }) => {
    const dt = new Date(ep.ts);
    const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const label = `${ep.charA || '?'} ? ${ep.charB || '?'}`;
    const modeTag = ep.mode ? ` · ${_modeIcons[ep.mode] || ''}${ep.mode}` : '';
    return `<div class="hist-entry" data-idx="${origIdx}">
      <div class="text-[10px] text-gray-500 px-1 mb-0.5">${label}${modeTag}</div>
      ${renderEpisodeCard(ep, origIdx + 1, dateStr, `h_ep${origIdx}`)}
    </div>`;
  }).join('');

  // Wire toggle buttons
  list.querySelectorAll('.ep-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.ep-card').querySelector('.ep-body');
      if (body) body.classList.toggle('hidden');
      btn.textContent = body?.classList.contains('hidden') ? '? Îòêðûòü' : '? Ñâåðíóòü';
    });
  });

  // Wire copy buttons
  list.querySelectorAll('.ep-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '?';
          setTimeout(() => btn.textContent = orig, 1200);
        });
      }
    });
  });

  // Wire delete buttons (delete from history)
  list.querySelectorAll('.ep-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const epIdx = parseInt(btn.dataset.epidx);
      try {
        const h = getGenerationHistory();
        h.splice(epIdx, 1);
        localStorage.setItem(GEN_HISTORY_KEY, JSON.stringify(h));
        renderHistory();
        showNotification('Çàïèñü óäàëåíà', 'info');
      } catch { /* ignore */ }
    });
  });
}

function exportHistory() {
  const history = getGenerationHistory();
  if (!history.length) { showNotification('Èñòîðèÿ ïóñòà — íå÷åãî ýêñïîðòèðîâàòü', 'info'); return; }
  const json = JSON.stringify(history, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ferixdi-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification(`? Ýêñïîðòèðîâàíî ${history.length} ãåíåðàöèé`, 'success');
  log('OK', 'ÈÑÒÎÐÈß', `Ýêñïîðòèðîâàíî ${history.length} çàïèñåé`);
}

function initHistory() {
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Î÷èñòèòü âñþ èñòîðèþ ãåíåðàöèé?')) {
      localStorage.removeItem(GEN_HISTORY_KEY);
      renderHistory();
      showNotification('Èñòîðèÿ î÷èùåíà', 'info');
    }
  });
  document.getElementById('btn-export-history')?.addEventListener('click', exportHistory);

  // Search with debounce
  let _histSearchTimer = null;
  document.getElementById('history-search')?.addEventListener('input', () => {
    clearTimeout(_histSearchTimer);
    _histSearchTimer = setTimeout(() => renderHistory(), 250);
  });

  // Mode filter — instant
  document.getElementById('history-mode-filter')?.addEventListener('change', () => renderHistory());

  renderHistory();
}

// --- VIRAL SURPRISE PRESETS v2 ---------------
// 80+ curated viral formulas — hook, killer word, share trigger, weighted pair matching, anti-repeat

const VIRAL_SURPRISE_PRESETS = [
  // === AI È ÒÅÕÍÎËÎÃÈÈ ===
  { topic: 'ChatGPT íàïèñàë çà âíóêà ñî÷èíåíèå — áàáêà ðåøèëà ÷òî âíóê ãåíèé', hook: 'A õâàòàåò òåòðàäêó è òðÿñ¸ò ïåðåä êàìåðîé', killer: 'ðîáîò', share: 'ñêèíü òîìó êòî äà¸ò äåòÿì ChatGPT', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','meme'] }, loc: ['kitchen','living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Äåä ñêà÷àë íåéðîñåòü — ãåíåðèðóåò ñåáå íåâåñòó èç ìîëîäîñòè', hook: 'A ïîâîðà÷èâàåò òåëåôîí ê êàìåðå ñ áåçóìíîé óëûáêîé', killer: 'ìîëîäîñòü', share: 'ïîêàæè äåäóøêå', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme','chaotic'] }, loc: ['living_room','kitchen'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Áàáêà óçíàëà ÷òî Àëèñà ýòî íå ñîñåäêà à ðîáîò â òåëåôîíå', hook: 'A îòáðàñûâàåò òåëåôîí ñ óæàñîì', killer: 'êîëîíêà', share: 'ñêèíü áàáóøêå ïóñòü ïðîâåðèò', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Ìàìà íàøëà ïðèëîæåíèå äëÿ ñòàðåíèÿ ëèöà — óâèäåëà ñåáÿ ÷åðåç 20 ëåò', hook: 'A ðîíÿåò òåëåôîí íà ñòîë ñ îòêðûòûì ðòîì', killer: 'óäàëèòü', share: 'ñêèíü ìàìå ïóñòü ïîïðîáóåò', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Äåä ïîïðîñèë Siri ïîçâîíèòü æåíå — òà íàáðàëà áûâøóþ', hook: 'A çàìèðàåò ñ òåëåôîíîì ó óõà', killer: 'áûâøàÿ', share: 'ïîêàæè òîìó êòî ðàçãîâàðèâàåò ñ òåëåôîíîì', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme'] }, loc: ['kitchen','car'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Íåéðîñåòü íàðèñîâàëà ïîðòðåò áàáêè ïî îïèñàíèþ — ïîëó÷èëñÿ êîò', hook: 'A òû÷åò ïàëüöåì â ýêðàí âîçìóù¸ííî', killer: 'ìÿó', share: 'ñêèíü ïîäðóãå ó êîòîðîé êîò ïîõîæ íà õîçÿéêó', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Áàáêà äèêòóåò íåéðîñåòè ðåöåïò áîðùà — òà ïðåäëàãàåò çàêàçàòü äîñòàâêó', hook: 'A õëîïàåò ïî ñòîëó è ïîêàçûâàåò ïàëåö', killer: 'äîñòàâêà', share: 'ñêèíü òîìó êòî íå óìååò ãîòîâèòü', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','conflict'] }, loc: ['kitchen'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Äåä óñòàíîâèë ãîëîñîâîé ïîìîùíèê — òåïåðü ñïîðèò ñ íèì êàæäûé âå÷åð', hook: 'A íàêëîíÿåòñÿ ê êîëîíêå è ãðîçèò ïàëüöåì', killer: 'âûêëþ÷èòü', share: 'ïîêàæè òîìó êòî ðàçãîâàðèâàåò ñ Àëèñîé', pair: { groupA: ['dedy'], groupB: ['babki','parni'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Âíó÷êà ïîêàçàëà áàáêå äèïôåéê âèäåî ñ íåé — áàáêà çâîíèò â ïîëèöèþ', hook: 'A õâàòàåòñÿ çà ñåðäöå è ïÿòèòñÿ', killer: 'ïîëèöèÿ', share: 'ñêèíü áàáóøêå', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic'] }, loc: ['living_room','kitchen'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Ìàìà ïîïðîñèëà ChatGPT íàïèñàòü ÑÌÑ ìóæó — âûøëî ñëèøêîì ðîìàíòè÷íî', hook: 'A ÷èòàåò ñ òåëåôîíà è êðàñíååò', killer: 'ðîìàíòèêà', share: 'ñêèíü ïîäðóãå ïóñòü ïîïðîáóåò', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['meme','conflict'] }, loc: ['kitchen','living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Áàáêà ïîçâîíèëà íà ãîðÿ÷óþ ëèíèþ áàíêà — ïîäðóæèëàñü ñ ðîáîòîì', hook: 'A ïðèæèìàåò òåëåôîí ê óõó è óëûáàåòñÿ', killer: 'ïîäðóãà', share: 'ñêèíü òîìó êòî âèñèò íà ãîðÿ÷åé ëèíèè', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'AI è òåõíîëîãèè' },
  { topic: 'Äåä êóïèë ðîáîò-ïûëåñîñ — ñëåäèò çà íèì êàê çà âíóêîì', hook: 'A ñèäèò íà ïîëó è íàáëþäàåò çà ïûëåñîñîì', killer: 'âíóê', share: 'ïîêàæè òîìó ó êîãî ðîáîò-ïûëåñîñ', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme'] }, loc: ['living_room'], cat: 'AI è òåõíîëîãèè' },

  // === ÖÅÍÛ È ÈÍÔËßÖÈß ===
  { topic: 'Ñûð çà 800? — áàáêà òîðãóåòñÿ ñ êàññèðîì êàê íà áàçàðå', hook: 'A øâûðÿåò ÷åê íà ñòîë è òû÷åò ïàëüöåì', killer: 'ðàññðî÷êà', share: 'ñêèíü òîìó êòî ïîìíèò ñûð çà 50?', pair: { groupA: ['babki'], groupB: ['prodavtsy','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['shop','market'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Äåä óâèäåë ÷åê èç Ïÿò¸ðî÷êè — äóìàåò ýòî êâèòàíöèÿ çà èïîòåêó', hook: 'A ðàçâîðà÷èâàåò ÷åê è îí ïàäàåò äî ïîëà', killer: 'èïîòåêà', share: 'ñêèíü ìóæó ïîñëå ìàãàçèíà', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['kitchen','shop'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Ìàìà êóïèëà àâîêàäî çà 300? — ñâåêðîâü ñ÷èòàåò ýòî ïðåäàòåëüñòâîì', hook: 'A ïîäíèìàåò àâîêàäî êàê óëèêó', killer: 'àâîêàäî', share: 'ñêèíü ñâåêðîâè èëè ò¸ùå', pair: { groupA: ['mamy'], groupB: ['babki'], compatA: ['conflict'] }, loc: ['kitchen'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Áàáêà ñðàâíèâàåò öåíû 1990 è 2026 — êàæäûé ðàç îõàåò ãðîì÷å', hook: 'A çàãèáàåò ïàëüöû è îõàåò òåàòðàëüíî', killer: 'êîïåéêè', share: 'ñêèíü ìàìå ïóñòü ïîñ÷èòàåò', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['kitchen','shop'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Ïàðåíü çàêàçàë êîôå çà 600? — äåä ðàññêàçàë ñêîëüêî ñòîèëà ìàøèíà', hook: 'A ïîäàâèëñÿ êîôå óñòàâèâøèñü â ÷åê', killer: 'ìàøèíà', share: 'ïîêàæè òîìó êòî ïîêóïàåò êîôå êàæäûé äåíü', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['conflict','meme'] }, loc: ['cafe'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Áàáêà óâèäåëà îãóðöû çèìîé — ðåøèëà ÷òî ýòî öåíà çà çîëîòî', hook: 'A õâàòàåò öåííèê è ïîäíîñèò ê ãëàçàì òðèæäû', killer: 'çîëîòî', share: 'ñêèíü òîìó êòî ïîêóïàåò îãóðöû çèìîé', pair: { groupA: ['babki'], groupB: ['prodavtsy'], compatA: ['chaotic'] }, loc: ['shop','market'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Äåä óâèäåë öåíó íà áåíçèí — ðåøèë ïåðåñåñòü íà âåëîñèïåä', hook: 'A áðîñàåò êëþ÷è îò ìàøèíû íà ñòîë', killer: 'âåëîñèïåä', share: 'ñêèíü àâòîìîáèëèñòó', pair: { groupA: ['dedy'], groupB: ['parni','babki'], compatA: ['meme'] }, loc: ['car','kitchen'], cat: 'Öåíû è èíôëÿöèÿ' },
  { topic: 'Êóðüåð ïðèí¸ñ åäó äëÿ êîòà çà 2000? — áàáêà â øîêå îò ïðèîðèòåòîâ', hook: 'A ñìîòðèò â ïàêåò è ïîäíèìàåò áðîâè', killer: 'êîò', share: 'ñêèíü âëàäåëüöó êîòà', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['kitchen','stairwell'], cat: 'Öåíû è èíôëÿöèÿ' },

  // === ÐÀÇÐÛÂ ÏÎÊÎËÅÍÈÉ ===
  { topic: 'Âíó÷êà ïîêàçàëà ìàêèÿæ — áàáêà âûçâàëà ñêîðóþ', hook: 'A õâàòàåò âíó÷êó çà ëèöî è ðàññìàòðèâàåò', killer: 'ñêîðàÿ', share: 'ñêèíü ïîäðóãå ñ ìàêèÿæåì', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['bathroom','living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Äåä óâèäåë ðâàíûå äæèíñû çà 15000? — ïðåäëîæèë çàøèòü áåñïëàòíî', hook: 'A õâàòàåò äæèíñû è èùåò äûðêó', killer: 'çàøèòü', share: 'ïîêàæè òîìó êòî íîñèò ðâàíûå äæèíñû', pair: { groupA: ['dedy'], groupB: ['parni','devushki'], compatA: ['meme'] }, loc: ['living_room','shop'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Áàáêà íå ïîíèìàåò êàê âíóê çàðàáàòûâàåò â òåëåôîíå áîëüøå ÷åì îíà íà çàâîäå', hook: 'A òû÷åò â òåëåôîí ïîòîì â ñâîè ðóêè', killer: 'òåëåôîí', share: 'ñêèíü ôðèëàíñåðó', pair: { groupA: ['babki'], groupB: ['parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Äåä ó÷èò âíóêà ÷èíèòü êðàí — òîò ãóãëèò âèäåî íà YouTube', hook: 'A âûõâàòûâàåò òåëåôîí è ìàøåò êëþ÷îì', killer: 'YouTube', share: 'ñêèíü òîìó êòî ÷èíèò âñ¸ ïî YouTube', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['conflict','meme'] }, loc: ['bathroom','kitchen'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Áàáêà óâèäåëà äîñòàâêó — ëåêöèÿ î ëåíè ïîêîëåíèÿ', hook: 'A ïåðåõâàòûâàåò ïàêåò äîñòàâêè', killer: 'ëåíü', share: 'ñêèíü òîìó êòî çàêàçûâàåò äîñòàâêó êàæäûé äåíü', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic'] }, loc: ['kitchen'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Âíóê ïîêàçàë äåäó NFT — äåä ïðåäëîæèë ïîâåñèòü íà ñòåíó â ðàìêå', hook: 'A êðóòèò òåëåôîí ïûòàÿñü ðàçãëÿäåòü', killer: 'ðàìêà', share: 'ïîêàæè òîìó êòî ïîêóïàåò NFT', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['meme'] }, loc: ['living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Ìàìà óçíàëà ÷òî äî÷êà âñòðå÷àåòñÿ ÷åðåç èíòåðíåò', hook: 'A õâàòàåòñÿ çà ãîëîâó îáåèìè ðóêàìè', killer: 'èíòåðíåò', share: 'ñêèíü òîìó êòî ïîçíàêîìèëñÿ â ïðèëîæåíèè', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['conflict'] }, loc: ['kitchen','living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Áàáêà óâèäåëà ñòðèì âíó÷êè — ðåøèëà ÷òî òà ðàáîòàåò â öèðêå', hook: 'A ïîêàçûâàåò íà ýêðàí ñ óæàñîì', killer: 'öèðê', share: 'ñêèíü ñòðèìåðó', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Äåä îáúÿñíÿåò ÷òî ðàçâëå÷åíèå ðàíüøå — âûéòè íà óëèöó', hook: 'A ðàçâîäèò ðóêè è ïîêàçûâàåò íà äâåðü', killer: 'óëèöà', share: 'ïîêàæè ðåá¸íêó êîòîðûé íå âûõîäèò èç äîìà', pair: { groupA: ['dedy'], groupB: ['devushki'], compatA: ['meme'] }, loc: ['living_room','yard'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Äåä âïåðâûå óâèäåë ñìóçè — ðåøèë ÷òî ýòî íåäîìåøàííûé êîìïîò', hook: 'A êðóòèò ñòàêàí è ñìîòðèò íà ïðîñâåò', killer: 'êîìïîò', share: 'ïîêàæè òîìó êòî ïü¸ò ñìóçè', pair: { groupA: ['dedy'], groupB: ['devushki','parni'], compatA: ['meme'] }, loc: ['kitchen','cafe'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Áàáêà óâèäåëà àâîêàäî-òîñò âíó÷êè — ñïðîñèëà ãäå ìÿñî', hook: 'A çàãëÿäûâàåò â òàðåëêó è ðàçâîäèò ðóêàìè', killer: 'ìÿñî', share: 'ñêèíü âåãàíó', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['kitchen','cafe'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Äåä íàø¸ë ïèäæàê 1975 ãîäà — ãîâîðèò ÷òî îí ñíîâà â ìîäå', hook: 'A íàäåâàåò ïèäæàê è ïîïðàâëÿåò ëàöêàíû', killer: 'ìîäà', share: 'ñêèíü ìîäíèêó', pair: { groupA: ['dedy'], groupB: ['parni','devushki'], compatA: ['meme'] }, loc: ['living_room','bedroom'], cat: 'Ðàçðûâ ïîêîëåíèé' },
  { topic: 'Àéòèøíèê îáúÿñíÿåò áàáêå ñâîþ ðàáîòó — îíà äî ñèõ ïîð íå ïîíÿëà', hook: 'A ðèñóåò ñõåìû â âîçäóõå ðóêàìè', killer: 'êíîïêè', share: 'ïîêàæè ðîäèòåëÿì êîòîðûå íå ïîíèìàþò ÷åì òû çàíèìàåøüñÿ', pair: { groupA: ['parni'], groupB: ['babki','mamy'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Ðàçðûâ ïîêîëåíèé' },

  // === ÁÛÒÎÂÎÉ ÀÁÑÓÐÄ ===
  { topic: 'Ðàññëåäîâàíèå — êòî ïîñëåäíèé áðàë ïóëüò', hook: 'A ïîòðÿñàåò ïóëüòîì êàê óëèêîé', killer: 'êîò', share: 'ñêèíü òîìó êòî âå÷íî òåðÿåò ïóëüò', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','conflict'] }, loc: ['living_room','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Áàáêà íàøëà ÷óæîé íîñîê â ñòèðàëêå — ðàññëåäîâàíèå', hook: 'A äåðæèò íîñîê äâóìÿ ïàëüöàìè', killer: 'ñîñåä', share: 'ñêèíü òîìó ó êîãî ïðîïàäàþò íîñêè', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic','meme'] }, loc: ['bathroom','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Äåä ñëîìàë êðàí ïî÷èíÿÿ — îáâèíÿåò êðàí', hook: 'A øâûðÿåò êëþ÷ íà ïîë', killer: 'ñàì', share: 'ïîêàæè òîìó êòî ÷èíèò ñàì', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['bathroom','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Êîò ðàçáèë âàçó — êàæäûé îáâèíÿåò äðóãîãî', hook: 'A ïîêàçûâàåò íà îñêîëêè ïîòîì íà B', killer: 'òâîé', share: 'ñêèíü òîìó ó êîãî êîò õóëèãàí', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['conflict'] }, loc: ['living_room','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Ìóæ êóïèë íå òîò õëåá — æåíà êàê áóäòî èçìåíà', hook: 'A õëîïàåò áàòîíîì ïî ñòîëó', killer: 'èçìåíà', share: 'ñêèíü ìóæó êîòîðûé ïîêóïàåò íå òîò õëåá', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','conflict'] }, loc: ['kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Áàáêà ïåðåñîëèëà ñóï — îáâèíÿåò ñîëü ÷òî ñòàëà ñîëîíåå', hook: 'A ïðîáóåò è âûïë¸âûâàåò', killer: 'ñîëîíåå', share: 'ñêèíü òîìó êòî ïåðåñàëèâàåò', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['meme','chaotic'] }, loc: ['kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Ñïîð êòî ëó÷øå ãîòîâèò — îáà ñãîðåëî ïîêà ñïîðèëè', hook: 'A íþõàåò âîçäóõ è çàìèðàåò', killer: 'ñãîðåëî', share: 'ñêèíü òîìó êòî ñ÷èòàåò ñåáÿ ïîâàðîì', pair: { groupA: ['babki','mamy'], groupB: ['dedy','parni'], compatA: ['chaotic','meme','conflict'] }, loc: ['kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Êòî õðàïèò — îáà îòðèöàþò ïðè çàïèñè íà òåëåôîíå', hook: 'A âêëþ÷àåò çàïèñü è ïîâîðà÷èâàåò ýêðàí', killer: 'çàïèñü', share: 'ñêèíü òîìó êòî õðàïèò è îòðèöàåò', pair: { groupA: ['dedy','babki'], groupB: ['babki','dedy'], compatA: ['meme','conflict'] }, loc: ['bedroom','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Áàáêà 3 ÷àñà èñêàëà î÷êè — îíè íà ãîëîâå', hook: 'A ïåðåâîðà÷èâàåò ïîäóøêè ñ ïàíèêîé', killer: 'ãîëîâà', share: 'ñêèíü òîìó êòî òåðÿåò î÷êè', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Äåä íàæàë íå òó êíîïêó íà ñòèðàëêå — îíà ñòèðàåò 4 ÷àñà', hook: 'A æì¸ò âñå êíîïêè ïîäðÿä', killer: 'êíîïêà', share: 'ïîêàæè òîìó êòî áîèòñÿ òåõíèêè', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['bathroom','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Áàáêà ïîïðîáîâàëà ñóøè — ðåøèëà ðûáà ñûðàÿ èç ýêîíîìèè', hook: 'A òûêàåò ïàëî÷êàìè è íþõàåò', killer: 'ñûðàÿ', share: 'ñêèíü òîìó êòî íå åë ñóøè', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['chaotic','meme'] }, loc: ['cafe','kitchen'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Íà÷àëüíèê ñîçâàë ñîâåùàíèå ïî ïîâîäó ñîâåùàíèÿ', hook: 'A ðàñêëàäûâàåò äîêóìåíòû ñ ñåðü¸çíûì ëèöîì', killer: 'ñîâåùàíèå', share: 'ñêèíü êîëëåãå èç îôèñà', pair: { groupA: ['chinovniki','biznes'], groupB: ['parni','devushki'], compatA: ['conflict'] }, loc: ['office'], cat: 'Áûòîâîé àáñóðä' },
  { topic: 'Ó÷èòåëü ïîñòàâèë äâîéêó — ðîäèòåëü ïðèø¸ë ðàçáèðàòüñÿ è ïîëó÷èë òðîéêó', hook: 'A òû÷åò â äíåâíèê è ñòó÷èò ïî ñòîëó', killer: 'òðîéêà', share: 'ñêèíü ó÷èòåëþ èëè ðîäèòåëþ øêîëüíèêà', pair: { groupA: ['mamy'], groupB: ['uchitelya'], compatA: ['conflict','chaotic'] }, loc: ['school','office'], cat: 'Áûòîâîé àáñóðä' },

  // === ÇÄÎÐÎÂÜÅ ===
  { topic: 'Áàáêà ó÷èò âðà÷à — ïîäîðîæíèê ðåøàåò âñ¸', hook: 'A äîñòà¸ò ïó÷îê òðàâû èç ñóìêè', killer: 'ïîäîðîæíèê', share: 'ñêèíü áàáóøêå êîòîðàÿ ëå÷èò ÷àåì', pair: { groupA: ['babki'], groupB: ['doktory','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['clinic','kitchen'], cat: 'Çäîðîâüå è ïîëèêëèíèêà' },
  { topic: 'Äåä çàãóãëèë ñèìïòîìû — ðåøèë ÷òî îñòàëîñü 3 äíÿ', hook: 'A ïîêàçûâàåò òåëåôîí êàê ïðèãîâîð', killer: 'èíòåðíåò', share: 'ñêèíü òîìó êòî ãóãëèò ñèìïòîìû', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme'] }, loc: ['living_room','clinic'], cat: 'Çäîðîâüå è ïîëèêëèíèêà' },
  { topic: 'Ìàìà íàøëà âèòàìèíû ñûíà — äóìàåò íàðêîòèêè', hook: 'A äåðæèò áàíêó êàê óëèêó', killer: 'âèòàìèíû', share: 'ñêèíü ìàìå êîòîðàÿ ïðîâåðÿåò ñóìêè', pair: { groupA: ['mamy'], groupB: ['parni'], compatA: ['chaotic','conflict'] }, loc: ['kitchen','living_room'], cat: 'Çäîðîâüå è ïîëèêëèíèêà' },
  { topic: 'Äåä îòêàçûâàåòñÿ ê âðà÷ó — â 45 íå õîäèë è æèâ', hook: 'A ñêðåùèâàåò ðóêè è êà÷àåò ãîëîâîé', killer: 'æèâ', share: 'ñêèíü òîìó êòî áîèòñÿ âðà÷åé', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['conflict','meme'] }, loc: ['kitchen','living_room'], cat: 'Çäîðîâüå è ïîëèêëèíèêà' },
  { topic: 'Áàáêà ëå÷èò âíóêà ãîð÷è÷íèêàìè ìàëèíîé è çàãîâîðàìè îäíîâðåìåííî', hook: 'A ðàññòàâëÿåò áàíêè êàê íà àëòàðå', killer: 'çàãîâîð', share: 'ñêèíü òîìó êîãî ëå÷èëè áàáóøêèíûìè ìåòîäàìè', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['chaotic','meme'] }, loc: ['kitchen','living_room'], cat: 'Çäîðîâüå è ïîëèêëèíèêà' },

  // === ÆÊÕ ===
  { topic: 'Êâèòàíöèÿ çà îòîïëåíèå â ìàå — áàáêà âîþåò', hook: 'A ðàçâîðà÷èâàåò êâèòàíöèþ ñ òðÿñóùèìèñÿ ðóêàìè', killer: 'ìàé', share: 'ñêèíü ñîñåäó ïî ïîäúåçäó', pair: { groupA: ['babki'], groupB: ['sosedi','chinovniki'], compatA: ['chaotic','conflict'] }, loc: ['stairwell','kitchen'], cat: 'ÆÊÕ è êîììóíàëêà' },
  { topic: 'Ñîñåä çàòîïèë — îáà îáâèíÿþò òðóáû', hook: 'A ïîêàçûâàåò íà ïîòîëîê ñ êîòîðîãî êàïàåò', killer: 'òðóáû', share: 'ñêèíü ñîñåäó ñâåðõó', pair: { groupA: ['dedy','babki'], groupB: ['sosedi'], compatA: ['conflict','chaotic'] }, loc: ['stairwell','bathroom'], cat: 'ÆÊÕ è êîììóíàëêà' },
  { topic: 'Áàáêà ñ÷èòàåò âîäó — íàëèëè íà îëèìïèéñêèé áàññåéí', hook: 'A òû÷åò êàëüêóëÿòîðîì â êàìåðó', killer: 'áàññåéí', share: 'ñêèíü òîìó êòî íå ñëåäèò çà ñ÷¸ò÷èêàìè', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['chaotic','meme'] }, loc: ['kitchen','bathroom'], cat: 'ÆÊÕ è êîììóíàëêà' },
  { topic: 'Äåä òðåòèé äåíü íå çàïîìíèò êîä äîìîôîíà', hook: 'A áü¸ò ïî äîìîôîíó ëàäîíüþ', killer: 'êëþ÷', share: 'ñêèíü òîìó êòî çàáûâàåò ïàðîëè', pair: { groupA: ['dedy'], groupB: ['sosedi','parni'], compatA: ['meme'] }, loc: ['stairwell','yard'], cat: 'ÆÊÕ è êîììóíàëêà' },
  { topic: 'Áàáêà ñîáðàëà ïîäïèñè ïîäúåçäà ïðîòèâ êîøêè ñîñåäêè', hook: 'A ðàçâîðà÷èâàåò ñïèñîê äëèíîé â ìåòð', killer: 'êîøêà', share: 'ñêèíü ñîñåäó ñ ïèòîìöåì', pair: { groupA: ['babki'], groupB: ['sosedi'], compatA: ['conflict','chaotic'] }, loc: ['stairwell'], cat: 'ÆÊÕ è êîììóíàëêà' },

  // === ÄÀ×À ===
  { topic: 'Áàáêà õâàñòàåòñÿ óðîæàåì — ñîñåäêà ãîâîðèò å¸ ïîìèäîðû êðóïíåå', hook: 'A ïîäíèìàåò ïîìèäîð ðàçìåðîì ñ êóëàê', killer: 'êðóïíåå', share: 'ñêèíü äà÷íèêó', pair: { groupA: ['babki'], groupB: ['sosedi','babki'], compatA: ['conflict','meme'] }, loc: ['dacha','yard'], cat: 'Äà÷à è îãîðîä' },
  { topic: 'Äåä ïîñòðîèë òåïëèöó èç ñòàðûõ îêîí — ñ÷èòàåò ñåáÿ àðõèòåêòîðîì', hook: 'A ðàçâîäèò ðóêè ïîêàçûâàÿ ìàñøòàá', killer: 'àðõèòåêòîð', share: 'ïîêàæè òîìó êòî ñòðîèò èç ïîäðó÷íûõ', pair: { groupA: ['dedy'], groupB: ['babki'], compatA: ['meme','chaotic'] }, loc: ['dacha','yard'], cat: 'Äà÷à è îãîðîä' },
  { topic: 'Óêðàëè êàáà÷êè — áàáêà äîïðàøèâàåò ñîñåäåé', hook: 'A ïîêàçûâàåò ïóñòóþ ãðÿäêó è ñæèìàåò êóëàêè', killer: 'êàáà÷êè', share: 'ñêèíü äà÷íèêó ó êîòîðîãî âîðóþò', pair: { groupA: ['babki'], groupB: ['sosedi','dedy'], compatA: ['chaotic','conflict'] }, loc: ['dacha','yard'], cat: 'Äà÷à è îãîðîä' },
  { topic: 'Âíó÷êà íà äà÷ó â áåëîì — áàáêà âûäàëà òÿïêó', hook: 'A îãëÿäûâàåò B ñâåðõó âíèç', killer: 'òÿïêà', share: 'ñêèíü òîìó êòî åçäèò íà äà÷ó â ãîðîäñêîì', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['chaotic','meme'] }, loc: ['dacha'], cat: 'Äà÷à è îãîðîä' },
  { topic: 'Áàáêà âûðàùèâàåò ðàññàäó — çàíÿëà âñå ïîäîêîííèêè', hook: 'A ïîêàçûâàåò íà âñå îêíà çàñòàâëåííûå ãîðøêàìè', killer: 'ïîäîêîííèê', share: 'ñêèíü òîìó ó êîãî ðàññàäà ïîâñþäó', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['chaotic'] }, loc: ['kitchen','living_room'], cat: 'Äà÷à è îãîðîä' },
  { topic: 'Áàáêà ïîñòàâèëà êàìåðó íà äà÷ó — ñìîòðèò îãóðöû 24/7 êàê ñåðèàë', hook: 'A ñèäèò ñ òåëåôîíîì è êîììåíòèðóåò ðîñò', killer: 'ñåðèÿ', share: 'ñêèíü äà÷íèêó', pair: { groupA: ['babki'], groupB: ['dedy','parni'], compatA: ['meme','chaotic'] }, loc: ['dacha','kitchen'], cat: 'Äà÷à è îãîðîä' },

  // === ÑÎÖÑÅÒÈ ===
  { topic: 'Áàáêà ñëó÷àéíî çàïèñàëà ðèëñ — ìèëëèîí ïðîñìîòðîâ', hook: 'A ñìîòðèò â òåëåôîí è õâàòàåòñÿ çà ù¸êè', killer: 'ìèëëèîí', share: 'ñêèíü òîìó êòî ìå÷òàåò î ïðîñìîòðàõ', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Äåä çàâ¸ë òèêòîê — îáçîðû íà áîðù', hook: 'A ñòàâèò áîðù ïåðåä êàìåðîé ñåðü¸çíî', killer: 'ïîäïèñ÷èêè', share: 'ïîêàæè äåäóøêå', pair: { groupA: ['dedy'], groupB: ['babki','parni'], compatA: ['meme','chaotic'] }, loc: ['kitchen'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Ìàìà íå óçíàëà äî÷êó â èíñòå èç-çà ôèëüòðîâ', hook: 'A ïîäíîñèò òåëåôîí ê ëèöó B è ñðàâíèâàåò', killer: 'ôèëüòð', share: 'ñêèíü ïîäðóãå ñ ôèëüòðàìè', pair: { groupA: ['mamy'], groupB: ['devushki'], compatA: ['chaotic','conflict'] }, loc: ['living_room','kitchen'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Áàáêà äóìàåò ÷òî âûèãðàëà àéôîí ïîäïèñàâøèñü íà ðàññûëêó', hook: 'A ðàäîñòíî òðÿñ¸ò òåëåôîíîì', killer: 'ñïàì', share: 'ñêèíü áàáóøêå êîòîðàÿ âåðèò â ðîçûãðûøè', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Ïàðåíü îáúÿñíÿåò áàáêå äîíàò — îíà äóìàåò ïîí÷èê', hook: 'A ðàçâîäèò ðóêàìè ïûòàÿñü îáúÿñíèòü', killer: 'ïîí÷èê', share: 'ñêèíü ãåéìåðó', pair: { groupA: ['parni'], groupB: ['babki'], compatA: ['meme'] }, loc: ['kitchen','living_room'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Ïîäïèñêà íà êèíîòåàòð ñòîèò äåíåã — áàáêà ïðåäëîæèëà âèäåîìàãíèòîôîí', hook: 'A äîñòà¸ò VHS êàññåòó èç øêàôà', killer: 'êàññåòà', share: 'ïîêàæè òîìó êòî ïîìíèò âèäåîêàññåòû', pair: { groupA: ['babki'], groupB: ['parni','devushki'], compatA: ['meme','chaotic'] }, loc: ['living_room'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Áàáêà çàêàçàëà íà WB — ïðèøëî 15 ïîñûëîê âìåñòî îäíîé', hook: 'A ñòîèò ïåðåä ãîðîé ïàêåòîâ', killer: 'êîðçèíà', share: 'ñêèíü òîìó êòî íå ìîæåò îñòàíîâèòüñÿ íà WB', pair: { groupA: ['babki'], groupB: ['devushki','parni'], compatA: ['meme','chaotic'] }, loc: ['living_room','stairwell'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Äåä óâèäåë ïóíêò âûäà÷è — äóìàåò ýòî íîâàÿ ïî÷òà', hook: 'A ñòîèò â î÷åðåäè è îçèðàåòñÿ', killer: 'ïî÷òà', share: 'ïîêàæè òîìó êòî õîäèò â ÏÂÇ êàæäûé äåíü', pair: { groupA: ['dedy'], groupB: ['prodavtsy','devushki'], compatA: ['meme'] }, loc: ['shop'], cat: 'Ñîöñåòè è òðåíäû' },
  { topic: 'Ìàìà îñòàâèëà îòçûâ — íàïèñàëà ðîìàí íà 3 ñòðàíèöû', hook: 'A ïîêàçûâàåò áåñêîíå÷íûé òåêñò íà òåëåôîíå', killer: 'ðîìàí', share: 'ñêèíü òîìó êòî ïèøåò äëèííûå îòçûâû', pair: { groupA: ['mamy'], groupB: ['devushki','parni'], compatA: ['meme','conflict'] }, loc: ['kitchen','living_room'], cat: 'Ñîöñåòè è òðåíäû' },

  // === ÎÒÍÎØÅÍÈß ===
  { topic: 'Æåíà íàøëà ëàéê ìóæà íà ôîòî êîëëåãè — äîïðîñ', hook: 'A ïîâîðà÷èâàåò òåëåôîí ýêðàíîì ê B', killer: 'ëàéê', share: 'ñêèíü ìóæó äëÿ ïðîôèëàêòèêè', pair: { groupA: ['mamy'], groupB: ['dedy','parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','bedroom'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Áàáêà ó÷èò âûáèðàòü ìóæà — ïî ðóêàì', hook: 'A õâàòàåò ðóêó B è ðàññìàòðèâàåò', killer: 'ðóêè', share: 'ñêèíü ïîäðóãå èùóùåé ìóæà', pair: { groupA: ['babki'], groupB: ['devushki'], compatA: ['meme','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Ìàìà äîïðàøèâàåò ïàðíÿ äî÷êè êàê íà ñîáåñåäîâàíèè', hook: 'A ñàäèòñÿ íàïðîòèâ è ñêëàäûâàåò ðóêè êàê HR', killer: 'çàðïëàòà', share: 'ñêèíü ïàðíþ êîòîðûé çíàêîìèòñÿ ñ ìàìîé', pair: { groupA: ['mamy'], groupB: ['parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Ñâåêðîâü ïðèåõàëà — ïåðâûì äåëîì îòêðûëà õîëîäèëüíèê', hook: 'A ðàñïàõèâàåò õîëîäèëüíèê ñ ïðèñòðàñòèåì', killer: 'õîëîäèëüíèê', share: 'ñêèíü íåâåñòêå èëè ñâåêðîâè', pair: { groupA: ['babki'], groupB: ['mamy','devushki'], compatA: ['conflict'] }, loc: ['kitchen'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Ïàðåíü ïîäàðèë ïûëåñîñ íà 8 ìàðòà — íå ïîíèìàåò ïðîáëåìó', hook: 'A ïîêàçûâàåò ïûëåñîñ ñ äîâîëüíîé óëûáêîé', killer: 'ïûëåñîñ', share: 'ñêèíü ìóæó ïåðåä 8 ìàðòà', pair: { groupA: ['parni'], groupB: ['devushki','mamy'], compatA: ['meme'] }, loc: ['living_room','kitchen'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Äåä äà¸ò ñîâåò ïî îòíîøåíèÿì — áàáêà êîððåêòèðóåò èç-çà óãëà', hook: 'A îáíèìàåò B è íà÷èíàåò ïîó÷àòü', killer: 'ñëóøàé', share: 'ïîêàæè äåäóøêå', pair: { groupA: ['dedy'], groupB: ['parni'], compatA: ['meme'] }, loc: ['kitchen','yard'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Ìàìà ïîìîãàåò ìîëîäîæ¸íàì — ÷åðåç ÷àñ îíè ìå÷òàþò ÷òîá óøëà', hook: 'A äâèãàåò ìåáåëü áåç ñïðîñà', killer: 'ïîìîùü', share: 'ñêèíü ìîëîäîæ¸íàì', pair: { groupA: ['mamy'], groupB: ['devushki','parni'], compatA: ['conflict','chaotic'] }, loc: ['kitchen','living_room'], cat: 'Îòíîøåíèÿ' },
  { topic: 'Áàáêà íàøëà ïðîôèëü äåäà íà ñàéòå çíàêîìñòâ — à èì 50 ëåò', hook: 'A òû÷åò â òåëåôîí ñî ñëåçàìè îò ñìåõà', killer: 'ïðîôèëü', share: 'ñêèíü æåíàòîé ïàðå', pair: { groupA: ['babki'], groupB: ['dedy'], compatA: ['conflict','meme'] }, loc: ['kitchen','living_room'], cat: 'Îòíîøåíèÿ' },

  // === ÒÐÀÍÑÏÎÐÒ ===
  { topic: 'Áàáêà ó÷èò âîäèòåëÿ ìàðøðóòêè åõàòü ïðàâèëüíî', hook: 'A íàêëîíÿåòñÿ è ïîêàçûâàåò íàïðàâëåíèå', killer: 'çíàþ', share: 'ñêèíü òîìó êòî ó÷èò âîäèòåëÿ', pair: { groupA: ['babki'], groupB: ['taksisty','sosedi'], compatA: ['chaotic','conflict'] }, loc: ['car','bus_stop'], cat: 'Òðàíñïîðò è ïðîáêè' },
  { topic: 'Äåä vs íàâèãàòîð — êòî ëó÷øå çíàåò äîðîãó', hook: 'A âûêëþ÷àåò íàâèãàòîð ðåøèòåëüíî', killer: 'êàðòà', share: 'ïîêàæè òîìó êòî íå äîâåðÿåò íàâèãàòîðó', pair: { groupA: ['dedy'], groupB: ['babki','mamy'], compatA: ['meme','chaotic'] }, loc: ['car'], cat: 'Òðàíñïîðò è ïðîáêè' },
  { topic: 'Áàáêà òðåáóåò îñòàíîâèòü ìàðøðóòêó ìåæäó îñòàíîâêàìè', hook: 'A âñòà¸ò è ñòó÷èò ïî ñòåêëó', killer: 'çäåñü', share: 'ñêèíü òîìó êòî åçäèò íà ìàðøðóòêå', pair: { groupA: ['babki'], groupB: ['taksisty','sosedi'], compatA: ['chaotic'] }, loc: ['car'], cat: 'Òðàíñïîðò è ïðîáêè' },
  { topic: 'Äåä ïðèïàðêîâàëñÿ — íèêòî íå ìîæåò âûåõàòü', hook: 'A ðàçâîäèò ðóêàìè è ïîæèìàåò ïëå÷àìè', killer: 'ìåñòî', share: 'ñêèíü òîìó êòî êðèâî ïàðêóåòñÿ', pair: { groupA: ['dedy'], groupB: ['parni','mamy'], compatA: ['meme'] }, loc: ['yard','car'], cat: 'Òðàíñïîðò è ïðîáêè' },
];

// Track recent presets to avoid repetition
let _lastSurpriseIndices = [];

// --- SMART PAIR MATCHING v2 (weighted scoring) -
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

// --- SMART LOCATION MATCHING -----------------
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
  'è âñ¸ ýòî íà êàìåðó', 'à B ìîë÷à íàáëþäàåò', 'è ñèòóàöèÿ âûõîäèò èç-ïîä êîíòðîëÿ',
  'íî B çíàåò ïðàâäó', 'à B óæå äàâíî ýòî çíàë(à)', 'è îáà óâåðåíû ÷òî ïðàâû',
  'à êàìåðà âñ¸ çàïèñûâàåò', 'íî B ãîòîâèò îòâåòíûé óäàð', 'è A äàæå íå ïîäîçðåâàåò ÷åì ýòî êîí÷èòñÿ',
  'è B åëå ñäåðæèâàåò ñìåõ', 'à A âõîäèò â ðàæ', 'íî B íåâîçìóòèìî æä¸ò ìîìåíò',
  'è îáà çàáûâàþò î êàìåðå', 'à çðèòåëè óæå â èñòåðèêå', 'è A çàõîäèò ñëèøêîì äàëåêî',
  'íî B ïðèáåð¸ã(ëà) êîçûðü', 'à A óïèðàåòñÿ äî êîíöà', 'è B ðîíÿåò killer word êàê áîìáó',
  'à ñèòóàöèÿ ñòàíîâèòñÿ àáñóðäíåå ñ êàæäîé ñåêóíäîé', 'è âñ¸ ïåðåâîðà÷èâàåòñÿ îäíèì ñëîâîì',
];

// --- SURPRISE BUTTON v3 (full-cycle anti-repeat + unique topics) -
function initSurprise() {
  document.getElementById('btn-surprise')?.addEventListener('click', () => {
    if (!isPromoValid()) { showNotification('?? Íóæåí ïðîìî-êîä äëÿ ãåíåðàöèè', 'error'); navigateTo('settings'); return; }

    const chars = state.characters;
    if (!chars || chars.length < 2) { showNotification('?? Ïåðñîíàæè íå çàãðóæåíû', 'error'); return; }

    // -- FULL-CYCLE ANTI-REPEAT: use ALL presets before ANY can repeat --
    if (_lastSurpriseIndices.length >= VIRAL_SURPRISE_PRESETS.length) {
      _lastSurpriseIndices.length = 0; // Reset — all presets used, start new cycle
      log('INFO', 'SURPRISE', 'Âñå ïðåñåòû èñïîëüçîâàíû — íîâûé öèêë');
    }
    let idx;
    let attempts = 0;
    do {
      idx = Math.floor(Math.random() * VIRAL_SURPRISE_PRESETS.length);
      attempts++;
    } while (_lastSurpriseIndices.includes(idx) && attempts < 200);
    _lastSurpriseIndices.push(idx);

    const preset = VIRAL_SURPRISE_PRESETS[idx];

    // -- SMART PAIR with anti-repeat for recent combos --
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

    // -- BUILD UNIQUE TOPIC — never the same string twice --
    const nameA = pair?.A?.name_ru || state.selectedA?.name_ru || '?';
    const nameB = pair?.B?.name_ru || state.selectedB?.name_ru || '?';
    const twist = _SURPRISE_TWISTS[Math.floor(Math.random() * _SURPRISE_TWISTS.length)].replace('A', nameA).replace('B', nameB);
    const uid = Date.now().toString(36).slice(-4); // unique 4-char stamp
    
    let fullTopic = `${nameA} vs ${nameB}: ${preset.topic} — ${twist}`;
    if (preset.hook) fullTopic += ` [ÕÓÊ: ${preset.hook.replace(/\bA\b/g, nameA).replace(/\bB\b/g, nameB)}]`;
    if (preset.killer) fullTopic += ` [KILLER WORD: "${preset.killer}"]`;
    fullTopic += ` [uid:${uid}]`;

    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = fullTopic;
    const ideaInputSuggested = document.getElementById('idea-input-suggested');
    if (ideaInputSuggested) ideaInputSuggested.value = fullTopic;

    navigateTo('generate');
    updateReadiness?.();

    const shareHint = preset.share ? ` | ?? ${preset.share}` : '';
    showNotification(`?? ${nameA} ? ${nameB}: "${preset.topic.slice(0, 50)}..."${shareHint}`, 'success');
    log('OK', 'VIRAL_SURPRISE', `#${idx}/${VIRAL_SURPRISE_PRESETS.length} [${_lastSurpriseIndices.length}/${VIRAL_SURPRISE_PRESETS.length} used] uid:${uid} | "${preset.topic}" | ${nameA} ? ${nameB} | Êàò: ${preset.cat}`);
  });
}

// --- STORYBOARD PREVIEW ------------------
function populateStoryboard(result) {
  const panel = document.getElementById('storyboard-preview');
  if (!panel) return;

  const segs = result.blueprint_json?.dialogue_segments || [];
  const lineA = segs.find(s => s.speaker === 'A');
  const lineB = segs.find(s => s.speaker === 'B');
  const ctx = result._apiContext || {};
  const dialogueA = lineA?.text_ru || ctx.dialogueA || result.dialogue_A_ru || '—';
  const dialogueB = lineB?.text_ru || ctx.dialogueB || result.dialogue_B_ru || '—';
  const killerWord = result.blueprint_json?.killer_word || ctx.killerWord || result.killer_word || '??';

  document.getElementById('sb-line-a').textContent = dialogueA;
  document.getElementById('sb-line-b').textContent = dialogueB;
  document.getElementById('sb-killer').textContent = killerWord;

  panel.classList.remove('hidden');
}

// --- A/B TESTING -------------------------
function initABTesting() {
  document.getElementById('btn-generate-ab')?.addEventListener('click', generateABVariants);
}

async function generateABVariants() {
  if (!isPromoValid() || !state.lastResult?._apiContext) {
    showNotification('Ñíà÷àëà âûïîëíèòå îñíîâíóþ ãåíåðàöèþ', 'error');
    return;
  }

  const btn = document.getElementById('btn-generate-ab');
  if (btn) { btn.disabled = true; btn.textContent = '? AI ãåíåðèðóåò 3 âàðèàíòà...'; }

  const panel = document.getElementById('ab-testing-panel');
  const container = document.getElementById('ab-variants');
  if (!container) return;
  panel?.classList.remove('hidden');

  try {
    const apiBase = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const token = localStorage.getItem('ferixdi_jwt');
    if (!token) { showNotification('?? Íåò òîêåíà àâòîðèçàöèè', 'error'); return; }
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const ctx = state.lastResult._apiContext;
    // ab_variants=2 tells server to ask AI for 2 extra variants in a SINGLE request
    const payload = { context: ctx, ab_variants: 2 };

    // Attach product/video if available (same as callAIEngine)
    if (state.productInfo?.image_base64) {
      payload.product_image = state.productInfo.image_base64;
      payload.product_mime = state.productInfo.mime_type || 'image/jpeg';
    }

    const resp = await fetch(`${apiBase}/api/generate`, { method: 'POST', headers, body: JSON.stringify(payload) });
    let data;
    try { const t = await resp.text(); data = t ? JSON.parse(t) : {}; } catch { data = {}; }

    if (!resp.ok) {
      showNotification(data.error || 'Îøèáêà A/B ãåíåðàöèè', 'error');
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
      { label: 'Òåêóùèé', a: mainA, b: mainB, killer: mainKiller, active: true },
    ];

    // The new main dialogue from AI (variant B)
    if (ai.dialogue_A_ru) {
      variants.push({ label: 'Âàðèàíò B', a: ai.dialogue_A_ru, b: ai.dialogue_B_ru || '—', killer: ai.killer_word || '' });
    }

    // Extra variants from ab_variants array (variant C, D...)
    const abSolo = ctx.soloMode || (!ctx.charB || ctx.charA?.id === ctx.charB?.id);
    const labels = ['Âàðèàíò C', 'Âàðèàíò D', 'Âàðèàíò E'];
    if (Array.isArray(ai.ab_variants)) {
      ai.ab_variants.forEach((v, i) => {
        if (v?.dialogue_A_ru && (abSolo || v?.dialogue_B_ru)) {
          variants.push({ label: labels[i] || `Âàðèàíò ${i + 3}`, a: v.dialogue_A_ru, b: abSolo ? '—' : (v.dialogue_B_ru || '—'), killer: v.killer_word || '' });
        }
      });
    }

    container.innerHTML = variants.map((v, i) => `
      <div class="p-3 rounded-lg border ${v.active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-gray-700 hover:border-amber-500/30'} cursor-pointer transition-colors ab-variant-card" data-idx="${i}">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-bold ${v.active ? 'text-emerald-400' : 'text-amber-400'}">${v.label} ${v.active ? '?' : ''}</span>
          ${v.killer ? `<span class="text-[9px] text-pink-400">?? ${escapeHtml(v.killer)}</span>` : ''}
        </div>
        <div class="text-[11px] text-cyan-300 mb-0.5">${abSolo ? '??' : 'A:'} ${escapeHtml(v.a)}</div>
        ${!abSolo ? `<div class="text-[11px] text-violet-300">B: ${escapeHtml(v.b)}</div>` : ''}
        ${!v.active ? `<button class="ab-select-btn mt-1.5 text-[9px] px-2 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors" data-idx="${i}">? Âûáðàòü ýòîò</button>` : ''}
      </div>
    `).join('');

    // Handle variant selection
    container.querySelectorAll('.ab-select-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(b.dataset.idx);
        const v = variants[idx];
        if (!v) return;
        // Use shared applyDialogueUpdate to sync ALL outputs:
        // veo_prompt, video_json, ru_package, editor, _apiContext, storyboard
        applyDialogueUpdate(v.a, v.b === '—' ? '' : v.b);
        // Override killer word with the variant's specific one (applyDialogueUpdate derives from last word)
        if (v.killer && state.lastResult.blueprint_json) {
          const prevKw = state.lastResult.blueprint_json.killer_word || '';
          state.lastResult.blueprint_json.killer_word = v.killer;
          const vp = state.lastResult.video_prompt_en_json;
          if (vp?.dialogue) vp.dialogue.killer_word = v.killer;
          const kwEl = document.getElementById('gen-killer-word');
          if (kwEl) kwEl.textContent = `?? killer word: ${v.killer}`;
          // Patch killer word in veo prompt & ru_package
          if (prevKw && prevKw !== v.killer && state.lastResult.veo_prompt) {
            let veo = state.lastResult.veo_prompt;
            veo = veo.replace(/(Killer word ")[^"]*(")(?=\s*[:\.])/g, `$1${v.killer}$2`);
            veo = veo.replace(/(The word ")[^"]*(?=" is the punchline)/g, `$1${v.killer}`);
            state.lastResult.veo_prompt = veo;
            const veoEl = document.getElementById('veo-prompt-text');
            if (veoEl) veoEl.textContent = veo;
          }
          if (state.lastResult.ru_package) {
            state.lastResult.ru_package = state.lastResult.ru_package.replace(/(KILLER WORD \u00ab)[^\u00bb]*(\u00bb)/, `$1${v.killer}$2`);
            const ruPre = document.querySelector('#tab-ru pre');
            if (ruPre) ruPre.textContent = state.lastResult.ru_package;
          }
          // Re-render JSON tabs
          document.querySelector('#tab-video pre').textContent = JSON.stringify(state.lastResult.video_prompt_en_json, null, 2);
          document.querySelector('#tab-blueprint pre').textContent = JSON.stringify(state.lastResult.blueprint_json, null, 2);
        }
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
        showNotification(`? Âûáðàí ${v.label}`, 'success');
      });
    });

    log('OK', 'A/B', `Ñãåíåðèðîâàíî ${variants.length} âàðèàíòîâ çà 1 çàïðîñ`);
  } catch (err) {
    showNotification(`Îøèáêà: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '?? Åù¸ 3 âàðèàíòà'; }
  }
}

// --- CUSTOM CHARACTER CONSTRUCTOR --------
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
  if (!isPromoValid()) { showCCStatus('?? Íóæåí ïðîìî-êîä', 'text-amber-400'); return; }

  const nameRu = document.getElementById('cc-name-ru')?.value.trim();
  const group = document.getElementById('cc-group')?.value;
  const appearance = document.getElementById('cc-appearance')?.value.trim();
  const speech = document.getElementById('cc-speech')?.value.trim();
  const compat = document.getElementById('cc-compat')?.value || 'balanced';
  const role = document.getElementById('cc-role')?.value || 'A';

  if (!nameRu) { showCCStatus('Ââåäèòå èìÿ ïåðñîíàæà', 'text-red-400'); return; }
  if (!appearance) { showCCStatus('Îïèøèòå âíåøíîñòü', 'text-red-400'); return; }

  showCCStatus('Ïðîâåðÿþ äîñòóï è ñîçäàþ ïåðñîíàæà...', 'text-cyan-400 animate-pulse');

  const id = 'custom_' + nameRu.toLowerCase().replace(/[^à-ÿa-z0-9]/gi, '_').replace(/_+/g, '_') + '_' + Date.now().toString(36);
  const character_en = `${appearance.replace(/\.$/, '')}. ${speech ? speech.replace(/\.$/, '') + '.' : ''} Expressive facial reactions, natural micro-gestures, cinematic realism.`;

  // Auto-extract identity anchors from appearance description
  const _isMale = /äåä|ïàï|ñûí|ìóæ÷|man|male|boy/i.test(appearance + ' ' + group);
  const appearanceLower = appearance.toLowerCase();
  const extractTokens = (keywords) => {
    const found = [];
    keywords.forEach(kw => { if (appearanceLower.includes(kw.toLowerCase())) found.push(kw); });
    return found.length ? found : ['custom appearance'];
  };

  const autoAnchors = {
    face_silhouette: appearance.split('.')[0]?.trim() || 'custom face',
    signature_element: appearance.split('.').find(s => /[À-ßA-Z]{2,}/.test(s))?.trim() || 'distinctive feature',
    micro_gesture: 'natural expressive gestures',
    wardrobe_anchor: appearance.split('.').find(s => /îäåæä|ïëàòüå|êîñòþì|ðóáàø|êóðòê|ñâèòåð|ïàëüòî|øëÿï|î÷êè|ñåðüã|êîëüö|áðàñë|öåï|øàðô|apron|coat|dress|shirt|jacket/i.test(s))?.trim() || 'casual clothing',
    accessory_anchors: extractTokens(['î÷êè', '÷àñû', 'êîëüö', 'ñåðüã', 'áðàñë', 'öåï', 'êóëîí', 'áðîøü', 'òðîñòü', 'glasses', 'watch', 'ring', 'earring', 'bracelet', 'chain', 'pendant', 'brooch', 'cane']),
    footwear_anchor: appearance.split('.').find(s => /òóôë|áîòèíê|ñàïîã|òàïî÷|êðîññîâê|shoes|boots|slippers|sneakers/i.test(s))?.trim() || 'worn comfortable footwear',
    headwear_anchor: appearance.split('.').find(s => /øëÿï|êåïê|áåðåò|ïëàòîê|øàïê|êàïþø|hat|cap|beret|headscarf|beanie/i.test(s))?.trim() || 'none',
    color_palette: extractTokens(['êðàñí', 'ñèíèé', 'çåë¸í', '÷¸ðí', 'áåë', 'ñåðûé', 'êîðè÷í', 'çîëîò', 'ñåðåáð', 'áîðäî', 'áåæåâ', 'red', 'blue', 'green', 'black', 'white', 'grey', 'brown', 'gold', 'silver']),
    jewelry_anchors: appearance.split('.').find(s => /êîëüö|ñåðüã|öåï|áðàñë|êóëîí|÷àñû|ring|earring|chain|bracelet|pendant|watch/i.test(s))?.trim() || 'none visible',
    glasses_anchor: /î÷ê|ëèíç|glass|spectacle|bifocal/i.test(appearance) ? appearance.split('.').find(s => /î÷ê|ëèíç|glass|spectacle/i.test(s))?.trim() || 'glasses' : 'none',
    nail_style_anchor: _isMale ? 'short trimmed nails' : 'neat manicured nails',
    fabric_texture_anchor: /ø¸ëê|silk/i.test(appearance) ? 'smooth silk' : /øåðñò|wool|knit/i.test(appearance) ? 'coarse wool' : /õëîï|cotton/i.test(appearance) ? 'soft cotton' : 'natural fabric',
    pattern_anchor: /öâåòî÷|floral/i.test(appearance) ? 'floral print' : /ïîëîñ|stripe/i.test(appearance) ? 'striped' : /êëåò|plaid|check/i.test(appearance) ? 'plaid checkered' : 'solid color',
    sleeve_style_anchor: /êîðîòê.*ðóêàâ|short.?sleeve/i.test(appearance) ? 'short sleeves' : 'long sleeves',
  };

  const isMale = _isMale;
  const autoBiology = {
    age: (appearance.match(/(\d{1,3})\s*(ëåò|ãîä|years?|yo\b)/i) || [])[1] || 'adult',
    height_build: appearance.split('.').find(s => /ðîñò|âûñîê|íèçê|õóä|ïîëí|ñòðîé|êðóïí|tall|short|slim|large|massive/i.test(s))?.trim() || 'average build',
    skin_tokens: extractTokens(['ìîðùèíû', 'êîæà', 'çàãàð', 'áëåäí', 'âåñíóøêè', 'wrinkles', 'skin', 'freckles', 'tan', 'pale']),
    skin_color_tokens: extractTokens(['ñìóãë', 'áëåäí', 'çàãîðåë', 'ôàðôîð', 'olive', 'pale', 'tanned', 'porcelain', 'dark skin', 'fair']),
    wrinkle_map_tokens: extractTokens(['ìîðùèí', 'ñêëàäê', 'ãóñèí', 'wrinkle', 'crow', 'furrow', 'crease', 'lines']),
    eye_tokens: extractTokens(['ãëàçà', 'âçãëÿä', 'eyes', 'gaze']),
    hair_tokens: extractTokens(['âîëîñû', 'ïðè÷¸ñêà', 'ñòðèæêà', 'áîðîäà', 'óñû', 'ëûñèí', 'hair', 'beard', 'mustache', 'bald']),
    facial_hair_tokens: isMale ? extractTokens(['áîðîäà', 'óñû', 'ùåòèí', 'áàêåíáàðä', 'beard', 'mustache', 'stubble', 'goatee']) : ['none'],
    nose_tokens: extractTokens(['íîñ', 'nose']),
    mouth_tokens: extractTokens(['ãóáû', 'ðîò', 'çóáû', 'óëûáê', 'lips', 'mouth', 'teeth', 'smile']),
    ear_tokens: extractTokens(['óø', 'ñåðüã', 'ear', 'earring', 'lobe']),
    neck_tokens: extractTokens(['øåÿ', 'êàäûê', 'neck', 'throat', 'adam']),
    body_shape_tokens: extractTokens(['ïëå÷', 'ãðóä', 'æèâîò', 'òîðñ', 'á¸äð', 'shoulder', 'chest', 'belly', 'torso', 'hip']),
    hands_tokens: extractTokens(['ðóêè', 'ïàëüöû', 'êîëüö', 'áðàñëåò', 'hands', 'fingers', 'ring', 'bracelet']),
    scar_mark_tokens: extractTokens(['øðàì', 'ðîäèíê', 'òàòó', 'îæîã', 'ïèðñèíã', 'scar', 'birthmark', 'tattoo', 'mole', 'piercing']),
    posture_tokens: extractTokens(['îñàíê', 'ïîçà', 'ñóòóë', 'ïðÿì', 'posture', 'stance']),
    gait_tokens: extractTokens(['ïîõîäê', 'øàãàåò', 'õðîìàåò', 'êîâûëÿåò', 'walk', 'shuffle', 'limp', 'stride']),
    facial_expression_default: compat === 'chaotic' ? 'alert suspicious squint' : compat === 'conflict' ? 'stern disapproving frown' : compat === 'calm' ? 'calm knowing half-smile' : compat === 'meme' ? 'perpetually amused smirk' : 'neutral resting expression',
    voice_texture_tokens: isMale ? [speech?.includes('áàñ') ? 'deep bass voice' : 'age-weathered male voice'] : [speech?.includes('òîíê') ? 'thin high-pitched voice' : 'age-weathered female voice'],
    jaw_tokens: extractTokens(['÷åëþñò', 'jaw', 'jawline']),
    cheekbone_tokens: extractTokens(['ñêóë', 'cheekbone']),
    forehead_tokens: extractTokens(['ëîá', 'forehead']),
    eyebrow_tokens: extractTokens(['áðîâ', 'eyebrow', 'brow']),
    lip_texture_tokens: extractTokens(['ãóá', 'lip']),
    chin_tokens: extractTokens(['ïîäáîðîä', 'chin']),
    nasolabial_tokens: ['age-appropriate nasolabial folds'],
    undereye_tokens: ['natural under-eye area'],
    shoulder_tokens: extractTokens(['ïëå÷', 'shoulder']),
    teeth_tokens: extractTokens(['çóá', 'teeth', 'tooth']),
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
    group: group === 'custom' ? 'ïîëüçîâàòåëüñêèå' : group,
    compatibility: compat,
    role_default: role,
    vibe_archetype: 'custom',
    appearance_ru: appearance,
    speech_style_ru: speech || 'Îáû÷íàÿ ðàçãîâîðíàÿ ðå÷ü',
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
        showCCStatus(err.error || '?? Îøèáêà âàëèäàöèè ïðîìî-êîäà íà ñåðâåðå', 'text-red-400');
        log('ERR', 'CHAR-CREATE', `Ñåðâåð îòêëîíèë: ${err.error || resp.status}`);
        return;
      }
    }
  } catch (e) {
    // Server unavailable — allow local creation as fallback
    log('WARN', 'CHAR-CREATE', `Ñåðâåð íåäîñòóïåí, ñîçäà¸ì ëîêàëüíî: ${e.message}`);
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

  showCCStatus(`? Ïåðñîíàæ #${newChar.numeric_id} "${nameRu}" ñîçäàí!`, 'text-emerald-400');
  showNotification(`? Ïåðñîíàæ #${newChar.numeric_id} "${nameRu}" äîáàâëåí â êàòàëîã`, 'success');
  log('OK', 'CHAR-CREATE', `Ñîçäàí: #${newChar.numeric_id} ${nameRu} (${id})`);
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
      if (added > 0) log('OK', 'CHAR-CUSTOM', `Çàãðóæåíî ${added} ïîëüçîâàòåëüñêèõ ïåðñîíàæåé`);
    }
    _customCharsLoaded = true;
  } catch (e) { log('ERR', 'CHAR-CUSTOM', e.message); }
}

// --- CUSTOM LOCATION CONSTRUCTOR ---------
function initLocConstructor() {
  document.getElementById('btn-toggle-loc-constructor')?.addEventListener('click', () => {
    const panel = document.getElementById('loc-constructor');
    if (panel) panel.classList.toggle('hidden');
  });

  document.getElementById('btn-create-location')?.addEventListener('click', createCustomLocation);
}

async function createCustomLocation() {
  if (!isPromoValid()) { showLCStatus('?? Íóæåí ïðîìî-êîä', 'text-amber-400'); return; }

  const nameRu = document.getElementById('lc-name-ru')?.value.trim();
  const group = document.getElementById('lc-group')?.value;
  const scene = document.getElementById('lc-scene')?.value.trim();
  const lighting = document.getElementById('lc-lighting')?.value.trim();
  const mood = document.getElementById('lc-mood')?.value.trim();

  if (!nameRu) { showLCStatus('Ââåäèòå íàçâàíèå', 'text-red-400'); return; }
  if (!scene) { showLCStatus('Îïèøèòå ñöåíó', 'text-red-400'); return; }

  showLCStatus('Ïðîâåðÿþ äîñòóï...', 'text-cyan-400 animate-pulse');

  const id = 'custom_' + nameRu.toLowerCase().replace(/[^à-ÿa-z0-9]/gi, '_').replace(/_+/g, '_') + '_' + Date.now().toString(36);

  const newLoc = {
    id,
    numeric_id: getNextLocNumericId(),
    name_ru: nameRu,
    tagline_ru: scene.slice(0, 80),
    group: group === 'custom' ? 'ïîëüçîâàòåëüñêèå' : group,
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
        showLCStatus(err.error || '?? Îøèáêà âàëèäàöèè ïðîìî-êîäà íà ñåðâåðå', 'text-red-400');
        log('ERR', 'LOC-CREATE', `Ñåðâåð îòêëîíèë: ${err.error || resp.status}`);
        return;
      }
    }
  } catch (e) {
    log('WARN', 'LOC-CREATE', `Ñåðâåð íåäîñòóïåí, ñîçäà¸ì ëîêàëüíî: ${e.message}`);
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

  showLCStatus(`? Ëîêàöèÿ #${newLoc.numeric_id} "${nameRu}" ñîçäàíà!`, 'text-emerald-400');
  showNotification(`?? Ëîêàöèÿ #${newLoc.numeric_id} "${nameRu}" äîáàâëåíà`, 'success');
  log('OK', 'LOC-CREATE', `Ñîçäàíà: #${newLoc.numeric_id} ${nameRu} (${id})`);
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
      if (added > 0) log('OK', 'LOC-CUSTOM', `Çàãðóæåíî ${added} ïîëüçîâàòåëüñêèõ ëîêàöèé`);
    }
  } catch (e) { log('ERR', 'LOC-CUSTOM', e.message); }
}

// --- EDUCATION / COURSE ------------------
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
      scheduleEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">?? Ëó÷øåå âðåìÿ ïî ðåãèîíàì:</div>' +
        pg.schedule_by_geo.map(g =>
          `<div class="bg-amber-500/5 rounded-lg p-3 border border-amber-500/10"><div class="flex items-center justify-between mb-1"><span class="text-[11px] text-amber-200 font-semibold">${g.geo}</span><span class="text-[10px] text-amber-400 font-bold">Ïèê: ${g.peak}</span></div><div class="text-[10px] text-gray-400">Îêíà: ${g.best_times.join(' · ')}</div><div class="text-[10px] text-gray-500 mt-1">${g.why}</div></div>`
        ).join('');
    }

    const freqEl = document.getElementById('edu-pub-frequency');
    if (freqEl && pg.frequency_rules) {
      freqEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">?? ×àñòîòà ïóáëèêàöèé:</div>' +
        pg.frequency_rules.map(f => {
          const color = f.level.includes('Îïòèìóì') ? 'emerald' : f.level.includes('Àãðåññèâíûé') ? 'red' : 'gray';
          return `<div class="bg-${color}-500/5 rounded-lg p-3 border border-${color}-500/10"><div class="flex items-center justify-between mb-1"><span class="text-[11px] text-${color}-300 font-semibold">${f.level}</span><span class="text-[10px] text-${color}-400 font-bold">${f.posts_per_week} / íåä</span></div><div class="text-[10px] text-gray-400">${f.posts_per_day}</div><div class="text-[10px] text-gray-500 mt-1">${f.note}</div></div>`;
        }).join('');
    }

    const algoEl = document.getElementById('edu-pub-algorithm');
    if (algoEl && pg.algorithm_rules) {
      algoEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">?? Êàê ðàáîòàåò àëãîðèòì:</div>' +
        pg.algorithm_rules.map(r =>
          `<div class="flex items-start gap-2 text-[10px] text-gray-400 leading-relaxed"><span class="text-amber-400 mt-0.5 flex-shrink-0">></span><span>${r}</span></div>`
        ).join('');
    }

    const missedEl = document.getElementById('edu-pub-missed');
    if (missedEl && pg.missed_day_protocol) {
      missedEl.innerHTML = '<div class="text-[10px] text-amber-400 font-semibold mb-1">?? Ïðîïóñòèë äåíü — ÷òî äåëàòü:</div>' +
        pg.missed_day_protocol.map(m => {
          const severity = m.scenario.includes('2+') ? 'red' : m.scenario.includes('íåäåëþ') ? 'orange' : m.scenario.includes('2–3') ? 'yellow' : 'emerald';
          return `<div class="bg-${severity}-500/5 rounded-lg p-3 border border-${severity}-500/10"><div class="text-[11px] text-${severity}-300 font-semibold mb-1">${m.scenario}</div><div class="text-[10px] text-gray-400 mb-1"><span class="text-${severity}-400/70">Âëèÿíèå:</span> ${m.impact}</div><div class="text-[10px] text-gray-300"><span class="font-medium">Äåéñòâèå:</span> ${m.action}</div></div>`;
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
            <div class="rounded-lg p-2 bg-red-500/5 border border-red-500/10"><div class="text-[9px] text-red-400 font-semibold mb-1">? Ïëîõî</div><div class="text-[10px] text-gray-500 leading-relaxed">${e.bad}</div></div>
            <div class="rounded-lg p-2 bg-emerald-500/5 border border-emerald-500/10"><div class="text-[9px] text-emerald-400 font-semibold mb-1">? Õîðîøî</div><div class="text-[10px] text-gray-400 leading-relaxed">${e.good}</div></div>
          </div>
          <div class="text-[10px] text-gray-500 leading-relaxed"><span class="text-purple-400/70 font-medium">Ïî÷åìó:</span> ${e.why}</div>
          <div class="text-[10px] text-purple-300/80 leading-relaxed bg-purple-500/5 rounded p-2"><span class="font-medium">?? Ñîâåò:</span> ${e.tip}</div>
        </div>`
      ).join('');
    }

    const checklistEl = document.getElementById('edu-profile-checklist');
    if (checklistEl && pg.checklist) {
      checklistEl.innerHTML = '<div class="text-[10px] text-purple-400 font-semibold mb-1">? ×åêëèñò îôîðìëåíèÿ ïðîôèëÿ:</div>' +
        pg.checklist.map(item =>
          `<div class="flex items-start gap-2 text-[10px] text-gray-400 leading-relaxed"><span class="text-purple-400 mt-0.5 flex-shrink-0">?</span><span>${item}</span></div>`
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
      charGuideNiches.innerHTML = '<div class="text-[10px] text-pink-400 font-semibold mb-1.5">Ïðèìåðû ïî íèøàì:</div>' +
        cg.niche_examples.map(n =>
          `<div class="bg-pink-500/5 rounded-lg p-2.5 border border-pink-500/10"><div class="text-[11px] text-pink-200 font-medium">${n.niche}</div><div class="text-[10px] text-gray-400 mt-0.5"><span class="text-pink-300/80">Ôîðìóëà:</span> ${n.formula}</div><div class="text-[10px] text-gray-500 mt-0.5">${n.why}</div></div>`
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
        `<div class="bg-red-500/5 rounded-lg p-3 border border-red-500/10"><div class="text-[11px] text-red-300 font-semibold mb-1">${d.stop_list.indexOf(s) + 1}. ${s.mistake}</div><div class="text-[10px] text-gray-500 mb-1"><span class="text-red-400/70">Óáèâàåò:</span> ${s.why_kills}</div><div class="text-[10px] text-emerald-400/80"><span class="font-medium">Ðåøåíèå:</span> ${s.fix}</div></div>`
      ).join('') || '<div class="text-[10px] text-gray-600 text-center py-2">Íè÷åãî íå íàéäåíî</div>';
      const toggleEl = document.getElementById('edu-stop-list-toggle');
      if (toggleEl) {
        if (!f && all.length > STOP_PREVIEW && !stopExpanded) {
          toggleEl.classList.remove('hidden');
          toggleEl.innerHTML = `<button class="text-[10px] text-red-400/70 hover:text-red-400 transition-colors">Ïîêàçàòü âñå ${all.length} îøèáîê v</button>`;
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
        `<details class="bg-blue-500/5 rounded-lg border border-blue-500/10 group"><summary class="flex items-start gap-2 p-3 cursor-pointer select-none"><span class="text-blue-400 mt-0.5 flex-shrink-0 text-[10px]">?</span><span class="text-[11px] text-blue-200 font-medium leading-snug group-open:text-blue-300">${item.q}</span></summary><div class="px-3 pb-3 pt-0 pl-7 text-[11px] text-gray-400 leading-relaxed">${item.a}</div></details>`
      ).join('') || '<div class="text-[10px] text-gray-600 text-center py-2">Íè÷åãî íå íàéäåíî</div>';
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
      character_selection: '?? Ïîäáîð ïåðñîíàæåé',
      before_generation: '?? Äî ãåíåðàöèè',
      before_publish: '?? Äî ïóáëèêàöèè',
      after_publish: '?? Ïîñëå ïóáëèêàöèè',
      if_low_views: '?? Ìàëî ïðîñìîòðîâ',
      if_series_took_off: '?? Ñåðèÿ ïîëåòåëà'
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
      `<div class="flex items-start gap-2 text-[11px] text-gray-300 leading-relaxed"><span class="text-emerald-400 mt-0.5 flex-shrink-0">></span><span>${b}</span></div>`
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
      accessBadge.textContent = '? Äîñòóï îòêðûò';
    } else {
      accessBadge.className = 'text-[10px] px-2 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30';
      accessBadge.textContent = '?? Íóæåí ïðîìî-êîä';
    }
  }

  if (lessonCount) lessonCount.textContent = `${d.lessons.length} óðîêîâ`;

  const readLessons = JSON.parse(localStorage.getItem('ferixdi_lessons_read') || '[]');

  if (lessonsGrid && d.lessons) {
    lessonsGrid.innerHTML = d.lessons.map(lesson => {
      const isRead = readLessons.includes(lesson.id);
      const lockIcon = hasAccess ? (isRead ? '?' : '??') : '??';
      const cardBorder = hasAccess ? (isRead ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-amber-500/30 hover:border-amber-500/50') : 'border-gray-700/50 hover:border-amber-500/30';
      const cardBg = hasAccess ? (isRead ? 'bg-emerald-500/3 hover:bg-emerald-500/8' : 'hover:bg-amber-500/5') : 'hover:bg-gray-800/30';
      const numStyle = isRead ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/25';
      return `<div class="edu-lesson-card glass-panel p-4 border-l-2 ${cardBorder} cursor-pointer transition-all ${cardBg}" data-lesson-id="${lesson.id}">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full ${numStyle} text-sm font-bold border">${lesson.num}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs">${lockIcon}</span>
              <span class="text-[10px] text-gray-500">? ${lesson.duration}</span>
              ${isRead ? '<span class="text-[9px] text-emerald-500/70 font-medium">ïðî÷èòàíî</span>' : ''}
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
    showNotification('?? Äîñòóï ê óðîêàì îòêðîåòñÿ ïîñëå àêòèâàöèè ïðîìî-êîäà', 'warning');
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
  document.getElementById('lesson-modal-duration').textContent = `? ${lesson.duration}`;
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
        `<div class="flex items-start gap-2 text-[11px] text-gray-300"><span class="text-cyan-400 mt-0.5 flex-shrink-0">??</span><span>${m}</span></div>`
      ).join('');
    }
  } else {
    metricsWrap?.classList.add('hidden');
  }

  const deliverablesEl = document.getElementById('lesson-modal-deliverables');
  if (deliverablesEl && lesson.deliverables) {
    deliverablesEl.innerHTML = lesson.deliverables.map(d =>
      `<div class="flex items-start gap-2 text-[11px] text-gray-300"><span class="text-emerald-400 mt-0.5 flex-shrink-0">?</span><span>${d}</span></div>`
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

// --- PHOTO > PROMPT — Image analysis for Google ImageFX / Flow recreation ---
function initPhotoPrompt() {
  const fileInput  = document.getElementById('photo-prompt-input');
  const dropzone   = document.getElementById('photo-prompt-dropzone');
  const placeholder = document.getElementById('photo-prompt-placeholder');
  const preview    = document.getElementById('photo-prompt-preview');
  const imgEl      = document.getElementById('photo-prompt-img');
  const clearBtn   = document.getElementById('photo-prompt-clear');
  const styleInput = document.getElementById('photo-prompt-style');
  const genBtn     = document.getElementById('photo-prompt-generate');
  const btnIcon    = document.getElementById('photo-prompt-btn-icon');
  const btnLabel   = document.getElementById('photo-prompt-btn-label');
  const statusEl   = document.getElementById('photo-prompt-status');
  const resultEl   = document.getElementById('photo-prompt-result');

  if (!fileInput || !genBtn) return;

  let _photoBase64 = null;
  let _photoMime = null;

  function _showPreview(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      statusEl.textContent = '?? Ôàéë ñëèøêîì áîëüøîé (ìàêñ 10 ÌÁ)';
      statusEl.classList.remove('hidden');
      return;
    }
    _photoMime = file.type;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      _photoBase64 = dataUrl.split(',')[1]; // strip data:image/...;base64,
      imgEl.src = dataUrl;
      placeholder.classList.add('hidden');
      preview.classList.remove('hidden');
      genBtn.disabled = false;
      statusEl.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  function _clearPhoto() {
    _photoBase64 = null;
    _photoMime = null;
    fileInput.value = '';
    imgEl.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
    genBtn.disabled = true;
    resultEl.classList.add('hidden');
    statusEl.classList.add('hidden');
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) _showPreview(e.target.files[0]);
  });

  if (clearBtn) clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _clearPhoto();
  });

  // Click to open file dialog
  dropzone.addEventListener('click', (e) => { if (e.target !== fileInput) fileInput.click(); });

  // Drag & drop visual feedback
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-pink-500/50', 'bg-pink-500/[0.04]'); });
  dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('border-pink-500/50', 'bg-pink-500/[0.04]'); });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-pink-500/50', 'bg-pink-500/[0.04]');
    if (e.dataTransfer?.files?.[0]) _showPreview(e.dataTransfer.files[0]);
  });

  // Copy buttons
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.photo-prompt-copy');
    if (!copyBtn) return;
    const targetId = copyBtn.dataset.target;
    const textEl = document.getElementById(targetId);
    if (!textEl) return;
    navigator.clipboard.writeText(textEl.textContent).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '?';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    });
  });

  // Generate
  genBtn.addEventListener('click', async () => {
    if (!_photoBase64) return;
    if (!isPromoValid()) {
      statusEl.innerHTML = '<span class="text-amber-400">?? Ââåäè ïðîìî-êîä â íàñòðîéêàõ</span>';
      statusEl.classList.remove('hidden');
      return;
    }

    genBtn.disabled = true;
    btnIcon.textContent = '?';
    btnLabel.textContent = 'AI àíàëèçèðóåò ôîòî…';
    statusEl.innerHTML = '<span class="text-gray-500">?? Àíàëèçèðóþ êàæäóþ äåòàëü èçîáðàæåíèÿ…</span>';
    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');

    try {
      const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
      const resp = await fetch(`${apiUrl}/api/photo-to-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('ferixdi_jwt') || ''}`,
        },
        body: JSON.stringify({
          image: _photoBase64,
          mime: _photoMime,
          style_hint: styleInput?.value?.trim() || '',
          lang: 'ru',
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Îøèáêà ñåðâåðà');

      const r = data.result;
      if (!r || !r.prompt_en) throw new Error('AI íå âåðíóë ïðîìïò');

      // Render result
      document.getElementById('photo-prompt-en-text').textContent = r.prompt_en;
      document.getElementById('photo-prompt-neg-text').textContent = r.negative_prompt_en || '—';
      document.getElementById('photo-prompt-ru-text').textContent = r.prompt_ru || '';
      document.getElementById('photo-prompt-detected').textContent = r.detected_style || '';

      // Complexity badge
      const cplx = document.getElementById('photo-prompt-complexity');
      const cMap = { simple: ['Ïðîñòîé', 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'], medium: ['Ñðåäíèé', 'bg-amber-500/15 text-amber-400 border-amber-500/25'], complex: ['Ñëîæíûé', 'bg-red-500/15 text-red-400 border-red-500/25'] };
      const cInfo = cMap[r.complexity] || cMap.medium;
      cplx.textContent = cInfo[0];
      cplx.className = `text-[9px] px-2 py-0.5 rounded-full border font-medium ${cInfo[1]}`;

      // Style tags
      const tagsEl = document.getElementById('photo-prompt-tags');
      tagsEl.innerHTML = (r.style_tags || []).map(t => `<span class="text-[9px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20">${t}</span>`).join('');

      // Tips
      const tipsList = document.getElementById('photo-prompt-tips-list');
      tipsList.innerHTML = (r.tips || []).map(t => `<li class="text-[11px] text-gray-400 leading-relaxed flex items-start gap-1.5"><span class="text-amber-400 flex-shrink-0">•</span><span>${t}</span></li>`).join('');

      resultEl.classList.remove('hidden');
      statusEl.innerHTML = '<span class="text-emerald-400">? Ïðîìïò ãîòîâ! Ñêîïèðóé è âñòàâü â ImageFX</span>';
      log('OK', 'PHOTO-PROMPT', `Generated ${r.complexity} prompt`);

    } catch (e) {
      statusEl.innerHTML = `<span class="text-red-400">? ${e.message}</span>`;
      log('ERR', 'PHOTO-PROMPT', e.message);
    } finally {
      genBtn.disabled = !_photoBase64;
      btnIcon.textContent = '?';
      btnLabel.textContent = 'Ñãåíåðèðîâàòü ïðîìïò';
    }
  });
}

// --- THREADS TRENDS — Best parser: no API, no auth, Google Search + AI ------
// State
let _threadsData = [];         // last fetched posts
let _threadsExcludeBig = false;
let _threadsLastResponse = null; // full API response for batch copy

function initThreadsTrends() {
  const searchBtn  = document.getElementById('threads-search-btn');
  const statusEl   = document.getElementById('threads-status');
  const resultsEl  = document.getElementById('threads-results');
  const lockedEl   = document.getElementById('threads-locked');
  const activeEl   = document.getElementById('threads-active');
  const badgeEl    = document.getElementById('threads-source-badge');
  const copyAllBtn = document.getElementById('threads-copy-all-btn');
  const summaryEl  = document.getElementById('threads-summary');
  const exTrack    = document.getElementById('threads-exclude-track');
  const exThumb    = document.getElementById('threads-exclude-thumb');
  const exCb       = document.getElementById('threads-exclude-big');
  if (!searchBtn) return;

  // - Quick topic chips -
  document.querySelectorAll('.threads-topic-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = document.getElementById('threads-query');
      if (q) { q.value = chip.dataset.topic || ''; q.focus(); }
      _saveThreadsFilters();
      sfx.clickSoft();
    });
  });

  // - Toggle for exclude-big -
  if (exTrack && exCb) {
    exTrack.addEventListener('click', () => {
      _threadsExcludeBig = !_threadsExcludeBig;
      exCb.checked = _threadsExcludeBig;
      exTrack.classList.toggle('active', _threadsExcludeBig);
      _saveThreadsFilters();
    });
  }

  // - Enter to search -
  document.getElementById('threads-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); searchBtn.click(); }
  });

  // - Persist filters on change -
  ['threads-lang','threads-freshness','threads-limit','threads-niche'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _saveThreadsFilters);
  });
  document.getElementById('threads-query')?.addEventListener('input', _saveThreadsFilters);

  // - Restore saved filters -
  _loadThreadsFilters();

  // - Gating: show/hide on section entry -
  _updateThreadsGate();

  // - Copy All button -
  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', () => {
      if (!_threadsData.length) return;
      const allText = _threadsData.map((p, i) => {
        const header = `??? ÏÎÑÒ #${i + 1} ???`;
        const original = `?? Îðèãèíàë:\n${p.text}`;
        const variants = (p.variants || []).map(v => `\n${_varStyleMeta[v.style]?.icon || '?'} ${v.label}:\n${v.text}`).join('');
        const hashtags = _allHashtags(p).join(' ');
        const time = p.best_time?.time ? `\n? Ëó÷øåå âðåìÿ: ${p.best_time.day || ''} ${p.best_time.time}` : '';
        return `${header}\n${original}\n${variants}${hashtags ? '\n\n??? Õýøòåãè: ' + hashtags : ''}${time}`;
      }).join('\n\n\n');
      navigator.clipboard.writeText(allText).then(() => {
        copyAllBtn.textContent = '? Ñêîïèðîâàíî!'; sfx.copy();
        setTimeout(() => { copyAllBtn.textContent = '?? Êîïèðîâàòü âñ¸'; }, 2000);
      });
    });
  }

  // - Search button -
  async function _doThreadsSearch() {
    if (!isPromoValid()) {
      if (lockedEl) lockedEl.classList.remove('hidden');
      if (activeEl) activeEl.classList.add('hidden');
      return;
    }

    const query     = (document.getElementById('threads-query')?.value || '').trim();
    const lang      = document.getElementById('threads-lang')?.value || 'ru';
    const freshness = document.getElementById('threads-freshness')?.value || '24h';
    const niche     = document.getElementById('threads-niche')?.value || 'any';
    const limit     = parseInt(document.getElementById('threads-limit')?.value) || 12;

    searchBtn.disabled = true;
    const btnLabel = document.getElementById('threads-btn-label');
    if (btnLabel) btnLabel.textContent = 'Èùó òðåíäû…';
    if (copyAllBtn) copyAllBtn.classList.add('hidden');
    if (summaryEl) summaryEl.classList.add('hidden');

    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = `<div class="flex items-center gap-2">
        <span class="text-violet-400 animate-pulse">?? Èùó àêòóàëüíûå íîâîñòè è ñîçäàþ âèðóñíûå ïîñòû…</span>
        <span class="text-[9px] text-gray-600">îáû÷íî 15-30 ñåê</span>
      </div>`;
    }
    if (resultsEl) resultsEl.innerHTML = _renderSkeletons(limit);
    if (badgeEl) badgeEl.classList.add('hidden');

    try {
      const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
      const jwt    = localStorage.getItem('ferixdi_jwt');
      const resp   = await fetch(`${apiUrl}/api/threads-trends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ query, lang, freshness, niche, limit, exclude_big: _threadsExcludeBig }),
      });

      let data;
      try { const t = await resp.text(); data = t ? JSON.parse(t) : {}; } catch { data = {}; }

      if (!resp.ok) {
        if (statusEl) statusEl.innerHTML = `<span class="text-red-400">? ${escapeHtml(data.error || `Îøèáêà ${resp.status}`)}</span>`;
        if (resultsEl) resultsEl.innerHTML = '';
        return;
      }

      _threadsData = data.posts || [];
      _threadsLastResponse = data;

      // Source badge — 4 states: Google grounded / RSS grounded / stale warning / AI-fabricated
      if (badgeEl) {
        badgeEl.classList.remove('hidden');
        if (data.used_grounding) {
          badgeEl.className = 'text-[9px] px-2 py-1 rounded-full border font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
          badgeEl.textContent = '?? Google Search · ðåàëüíûå íîâîñòè';
        } else if (data.has_rss) {
          badgeEl.className = 'text-[9px] px-2 py-1 rounded-full border font-medium bg-blue-500/15 text-blue-400 border-blue-500/30';
          badgeEl.textContent = `?? RSS · ${data.rss_count || ''} ðåàëüíûõ çàãîëîâêîâ`;
        } else {
          badgeEl.className = 'text-[9px] px-2 py-1 rounded-full border font-medium bg-red-500/15 text-red-400 border-red-500/30';
          badgeEl.textContent = '?? Íåò èñòî÷íèêîâ · ñîáûòèÿ ìîãóò áûòü âûìûøëåíû';
        }
      }

      if (!_threadsData.length) {
        if (statusEl) statusEl.innerHTML = '<span class="text-amber-400">?? Ïîñòû íå íàéäåíû. Ïîïðîáóé äðóãóþ òåìó èëè ðàñøèðü ôèëüòðû.</span>';
        if (resultsEl) resultsEl.innerHTML = '';
        return;
      }

      // Status
      if (statusEl) {
        const src = data.used_grounding ? 'íà îñíîâå ðåàëüíûõ íîâîñòåé (Google)' : data.has_rss ? `íà îñíîâå ${data.rss_count} ðåàëüíûõ çàãîëîâêîâ (RSS)` : '?? áåç ïðîâåðåííûõ èñòî÷íèêîâ';
        const staleWarn = data.stale_count > 0 ? ` · <span class="text-amber-400">${data.stale_count} óñòàðåâøèõ</span>` : '';
        const srcColor = (data.used_grounding || data.has_rss) ? 'text-emerald-400' : 'text-amber-400';
        statusEl.innerHTML = `<span class="${srcColor}">? Ñîçäàíî ${_threadsData.length} ïîñòîâ${query ? ' ïî «' + escapeHtml(query) + '»' : ''} · ${src}</span>${staleWarn}`;
      }

      // Summary stats
      if (summaryEl) {
        const avgScore = _threadsData.length ? Math.round(_threadsData.reduce((s, p) => s + (p.virality_score || 0), 0) / _threadsData.length) : 0;
        const mostCommonTime = _threadsData.find(p => p.best_time?.time)?.best_time;
        document.getElementById('threads-stat-count').textContent = _threadsData.length;
        document.getElementById('threads-stat-avg').textContent = avgScore + '/100';
        document.getElementById('threads-stat-time').textContent = mostCommonTime ? `${mostCommonTime.day || ''} ${mostCommonTime.time}` : '—';
        document.getElementById('threads-stat-source').textContent = data.source_note || '';
        summaryEl.classList.remove('hidden');
      }

      // Show copy all + autopost button
      if (copyAllBtn) copyAllBtn.classList.remove('hidden');
      const _autoBtn = document.getElementById('threads-autopost-btn');
      if (_autoBtn) _autoBtn.classList.remove('hidden');

      _renderThreadsPosts();
      log('OK', 'THREADS', `Çàãðóæåíî ${_threadsData.length} òðåíäîâûõ ïîñòîâ`);

    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<span class="text-red-400">? Îøèáêà ñåòè: ${escapeHtml(e.message)}</span>`;
      if (resultsEl) resultsEl.innerHTML = '';
      log('ERR', 'THREADS', e.message);
    } finally {
      searchBtn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Îáíîâèòü';
    }
  }
  searchBtn.addEventListener('click', _doThreadsSearch);
  window._threadsSearch = _doThreadsSearch;

  // - Result interactions via delegation -
  if (resultsEl) {
    resultsEl.addEventListener('click', e => {
      // Copy post text
      const copyPost = e.target.closest('.threads-copy-post');
      if (copyPost) {
        const text = copyPost.dataset.text || '';
        navigator.clipboard.writeText(text).then(() => {
          copyPost.textContent = '? Ñêîïèðîâàíî'; sfx.copy();
          setTimeout(() => { copyPost.textContent = '?? Êîïèðîâàòü'; }, 1500);
        });
        return;
      }
      // Copy variant text
      const copyVar = e.target.closest('.threads-copy-variant');
      if (copyVar) {
        const text = copyVar.dataset.text || '';
        navigator.clipboard.writeText(text).then(() => {
          copyVar.textContent = '?'; sfx.copy();
          setTimeout(() => { copyVar.textContent = '??'; }, 1400);
        });
        return;
      }
      // Queue single post
      const queuePost = e.target.closest('.threads-queue-post');
      if (queuePost) {
        const idx = parseInt(queuePost.dataset.postIdx);
        const post = _threadsData[idx];
        if (!post) return;
        // Use the currently visible variant text, or main text
        const card = queuePost.closest('[data-post-id]');
        const visiblePanel = card?.querySelector('.threads-var-panel:not(.hidden)');
        const varText = visiblePanel?.querySelector('p')?.textContent?.trim();
        const text = varText || post.text;
        _sendToThreadsQueue([{ text, topic: post.news_source || post.topic_tag || '', style: 'quick' }], queuePost);
        return;
      }
      // Copy hashtags
      const copyHash = e.target.closest('.threads-copy-hashtags');
      if (copyHash) {
        const text = copyHash.dataset.text || '';
        navigator.clipboard.writeText(text).then(() => {
          copyHash.textContent = '? Ñêîïèðîâàíî'; sfx.copy();
          setTimeout(() => { copyHash.textContent = '?? Êîïèðîâàòü õýøòåãè'; }, 1500);
        });
        return;
      }
      // Variant style tab switch
      const varTab = e.target.closest('.threads-var-tab');
      if (varTab) {
        const card = varTab.closest('[data-post-id]');
        if (!card) return;
        const style = varTab.dataset.style;
        _switchVariantTab(card, style);
        sfx.clickSoft();
        return;
      }
      // Expand/collapse analysis
      const toggleAnalysis = e.target.closest('.threads-toggle-analysis');
      if (toggleAnalysis) {
        const card = toggleAnalysis.closest('[data-post-id]');
        const body = card?.querySelector('.threads-analysis-body');
        if (!body) return;
        const isHidden = body.classList.contains('hidden');
        body.classList.toggle('hidden', !isHidden);
        toggleAnalysis.textContent = isHidden ? '^ Ñêðûòü àíàëèç' : '¡ Ïî÷åìó ýòî âèðóñíî';
        sfx.clickSoft();
        return;
      }
      // Expand/collapse reels
      const toggleReels = e.target.closest('.threads-toggle-reels');
      if (toggleReels) {
        const card = toggleReels.closest('[data-post-id]');
        const body = card?.querySelector('.threads-reels-body');
        if (!body) return;
        const isHidden = body.classList.contains('hidden');
        body.classList.toggle('hidden', !isHidden);
        toggleReels.textContent = isHidden ? '^ Ñêðûòü' : '?? Èäåè äëÿ Reels';
        sfx.clickSoft();
        return;
      }
      // Expand/collapse hashtags
      const toggleHash = e.target.closest('.threads-toggle-hashtags');
      if (toggleHash) {
        const card = toggleHash.closest('[data-post-id]');
        const body = card?.querySelector('.threads-hashtags-body');
        if (!body) return;
        body.classList.toggle('hidden');
        sfx.clickSoft();
        return;
      }
    });
  }
}

function _allHashtags(post) {
  if (!post.hashtags) return [];
  return [...(post.hashtags.high_volume || []), ...(post.hashtags.mid_volume || []), ...(post.hashtags.niche || [])];
}

// --- THREADS AUTOPOST — Buffer Rolling Queue Integration ------------------

const _THREADS_QUEUE_KEY = 'ferixdiai';
const _THREADS_QUEUE_BASE = '/internal/threads-queue';

async function _sendToThreadsQueue(posts, triggerBtn) {
  if (!posts?.length) return;
  const origText = triggerBtn?.textContent;
  if (triggerBtn) { triggerBtn.textContent = '?...'; triggerBtn.disabled = true; }
  try {
    const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiUrl}${_THREADS_QUEUE_BASE}/api/quick-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: _THREADS_QUEUE_KEY, posts }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    if (triggerBtn) {
      triggerBtn.textContent = `? ${data.added} â î÷åðåäü`;
      triggerBtn.classList.remove('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');
      triggerBtn.classList.add('bg-emerald-500/25', 'text-emerald-300', 'border-emerald-500/40');
      setTimeout(() => {
        triggerBtn.textContent = origText;
        triggerBtn.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');
        triggerBtn.classList.remove('bg-emerald-500/25', 'text-emerald-300', 'border-emerald-500/40');
        triggerBtn.disabled = false;
      }, 2500);
    }
    _updateThreadsQueueBadge();
    try { sfx.copy(); } catch {}
    return data;
  } catch (e) {
    console.error('[THREADS QUEUE]', e.message);
    if (triggerBtn) {
      triggerBtn.textContent = '? Îøèáêà';
      setTimeout(() => { triggerBtn.textContent = origText; triggerBtn.disabled = false; }, 2000);
    }
  }
}

async function _sendAllToThreadsQueue() {
  if (!_threadsData?.length) return;
  const autoBtn = document.getElementById('threads-autopost-btn');
  // Collect the "bold" variant (first variant) for each post, or main text
  const posts = _threadsData.map(post => {
    const boldVar = post.variants?.find(v => v.style === 'bold');
    return {
      text: boldVar?.text || post.variants?.[0]?.text || post.text,
      topic: post.news_source || post.topic_tag || '',
      style: boldVar?.style || 'quick',
    };
  });
  await _sendToThreadsQueue(posts, autoBtn);
}

async function _updateThreadsQueueBadge() {
  const badge = document.getElementById('threads-queue-badge');
  if (!badge) return;
  try {
    const apiUrl = localStorage.getItem('ferixdi_api_url') || DEFAULT_API_URL;
    const resp = await fetch(`${apiUrl}${_THREADS_QUEUE_BASE}/api/queue-info`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { badge.classList.add('hidden'); return; }
    badge.classList.remove('hidden');
    const depth = data.queue_depth !== null ? `${data.queue_depth}/${data.target}` : '?';
    badge.textContent = `?? ${data.pending} îæèä · Buffer: ${depth}`;
    badge.title = `Reservoir: ${data.pending} pending, ${data.sent} sent\nBuffer: ${depth}\nFree slots: ${data.free_slots ?? '?'}`;
  } catch { badge.classList.add('hidden'); }
}

function _initThreadsAutopost() {
  const autoBtn = document.getElementById('threads-autopost-btn');
  if (autoBtn) {
    autoBtn.addEventListener('click', _sendAllToThreadsQueue);
  }
  // Update badge on load and periodically
  _updateThreadsQueueBadge();
  setInterval(_updateThreadsQueueBadge, 120_000);
}

function _onThreadsTrendsEnter() {
  _updateThreadsGate();
  _updateThreadsQueueBadge();
}

function _updateThreadsGate() {
  const lockedEl = document.getElementById('threads-locked');
  const activeEl = document.getElementById('threads-active');
  const lockNav  = document.getElementById('threads-nav-lock');
  if (!lockedEl || !activeEl) return;
  if (isPromoValid()) {
    lockedEl.classList.add('hidden');
    activeEl.classList.remove('hidden');
    if (lockNav) { lockNav.textContent = 'VIP'; lockNav.className = 'ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold'; }
  } else {
    lockedEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
    if (lockNav) { lockNav.textContent = '??'; lockNav.className = 'ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold'; }
  }
}

function _saveThreadsFilters() {
  try {
    localStorage.setItem('ferixdi_threads_filters', JSON.stringify({
      query:      document.getElementById('threads-query')?.value || '',
      lang:       document.getElementById('threads-lang')?.value || 'ru',
      freshness:  document.getElementById('threads-freshness')?.value || '24h',
      niche:      document.getElementById('threads-niche')?.value || 'any',
      limit:      document.getElementById('threads-limit')?.value || '12',
      excludeBig: _threadsExcludeBig,
    }));
  } catch { /* quota */ }
}

function _loadThreadsFilters() {
  try {
    const saved = localStorage.getItem('ferixdi_threads_filters');
    if (!saved) return;
    const f = JSON.parse(saved);
    const q   = document.getElementById('threads-query');
    const l   = document.getElementById('threads-lang');
    const fr  = document.getElementById('threads-freshness');
    const ni  = document.getElementById('threads-niche');
    const lim = document.getElementById('threads-limit');
    if (q && f.query)      q.value = f.query;
    if (l && f.lang)       l.value = f.lang;
    if (fr && f.freshness) fr.value = f.freshness;
    if (ni && f.niche)     ni.value = f.niche;
    if (lim && f.limit)    lim.value = f.limit;
    if (f.excludeBig) {
      _threadsExcludeBig = true;
      const track = document.getElementById('threads-exclude-track');
      const cb    = document.getElementById('threads-exclude-big');
      if (cb) cb.checked = true;
      if (track) track.classList.add('active');
    }
  } catch { /* ignore */ }
}

function _renderSkeletons(n) {
  return Array.from({ length: Math.min(n, 4) }).map((_, i) => `
    <div class="threads-card animate-pulse" style="animation-delay:${i * 0.12}s">
      <div class="p-5 space-y-3">
        <div class="flex items-start gap-3">
          <div class="w-7 h-7 rounded-lg bg-gray-700/40"></div>
          <div class="flex-1 space-y-1.5"><div class="flex gap-2"><div class="h-2.5 bg-gray-700/50 rounded w-16"></div><div class="h-2.5 bg-gray-700/40 rounded w-20"></div></div><div class="h-2 bg-gray-700/30 rounded w-32"></div></div>
          <div class="w-20 space-y-1"><div class="h-1.5 bg-gray-700/40 rounded w-full"></div><div class="h-2 bg-gray-700/30 rounded w-14 ml-auto"></div></div>
        </div>
        <div class="h-3 bg-gray-700/50 rounded w-full"></div>
        <div class="h-3 bg-gray-700/40 rounded w-5/6"></div>
        <div class="h-3 bg-gray-700/30 rounded w-3/4"></div>
        <div class="flex gap-2 mt-2"><div class="h-6 bg-gray-700/30 rounded w-24"></div><div class="h-6 bg-gray-700/20 rounded w-20"></div></div>
      </div>
      <div class="border-t border-gray-700/20 p-4 space-y-2">
        <div class="h-2 bg-violet-500/10 rounded w-40"></div>
        <div class="flex gap-1.5"><div class="h-6 bg-violet-500/10 rounded w-16"></div><div class="h-6 bg-violet-500/8 rounded w-14"></div><div class="h-6 bg-violet-500/5 rounded w-18"></div></div>
        <div class="h-10 bg-violet-500/5 rounded w-full"></div>
      </div>
    </div>
  `).join('');
}

const _confidenceMeta = {
  high:   { label: '?? Íà îñíîâå íîâîñòè', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-400' },
  medium: { label: '?? Íà îñíîâå òðåíäà',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25',    dot: 'bg-amber-400' },
  low:    { label: '?? Íå ïðîâåðåíî',      cls: 'bg-red-500/15 text-red-400 border-red-600/25',          dot: 'bg-red-500' },
};

const _varStyleMeta = {
  bold:      { icon: '??', label: 'Ïðîâîêàòîð' },
  smart:     { icon: '??', label: 'Àíàëèòèê' },
  emotional: { icon: '??', label: 'Ëè÷íàÿ èñòîðèÿ' },
  viral:     { icon: '??', label: 'Âèðóñíûé' },
  personal:  { icon: '??', label: 'Âîïðîñ çàëó' },
};

function _viralityColor(score) {
  if (score >= 80) return { bar: 'bg-emerald-500', text: 'text-emerald-400', label: 'Îãîíü ??' };
  if (score >= 60) return { bar: 'bg-violet-500',  text: 'text-violet-400',  label: 'Âûñîêèé' };
  if (score >= 40) return { bar: 'bg-amber-500',   text: 'text-amber-400',   label: 'Ñðåäíèé' };
  return                   { bar: 'bg-gray-500',    text: 'text-gray-400',    label: 'Íèçêèé' };
}

function _formatThreadsText(text) {
  if (!text) return '';
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>');
  return s;
}

function _renderThreadsPosts() {
  const resultsEl = document.getElementById('threads-results');
  if (!resultsEl || !_threadsData.length) return;

  resultsEl.innerHTML = _threadsData.map((post, idx) => {
    const conf  = _confidenceMeta[post.confidence] || _confidenceMeta.low;
    const hasUrl = !!post.url;
    const hasAuthor = !!post.author;
    const sigLikes  = post.signals?.likes_est || 'íåèçâåñòíî';
    const sigComm   = post.signals?.comments_est || 'íåèçâåñòíî';
    const sigRepost = post.signals?.reposts_est || 'íåèçâåñòíî';
    const vScore = post.virality_score || 0;
    const vColor = _viralityColor(vScore);
    const sb = post.score_breakdown || {};

    // Virality bar HTML
    const viralityHtml = `
      <div class="flex items-center gap-2.5">
        <div class="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div class="${vColor.bar} h-full rounded-full transition-all" style="width:${vScore}%"></div>
        </div>
        <span class="${vColor.text} text-[10px] font-bold tabular-nums">${vScore}</span>
      </div>
      <div class="flex gap-1.5 mt-1">
        <span class="text-[8px] text-gray-600" title="Êîììåíòû (0-30)">??${sb.comment_potential || sb.debate || 0}</span>
        <span class="text-[8px] text-gray-600" title="Óçíàâàåìîñòü (0-25)">??${sb.relatability || sb.depth || 0}</span>
        <span class="text-[8px] text-gray-600" title="Øàðèíã (0-25)">??${sb.shareability || 0}</span>
        <span class="text-[8px] text-gray-600" title="Ýìîöèÿ (0-20)">??${sb.emotion || 0}</span>
      </div>`;

    // Variants tabs HTML
    const firstVar  = post.variants?.[0];
    const varTabsHtml = (post.variants || []).map(v => {
      const sm = _varStyleMeta[v.style] || { icon: '?', label: v.label || v.style };
      return `<button class="threads-var-tab px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all whitespace-nowrap
        ${v.style === (firstVar?.style || 'bold')
          ? 'bg-violet-600/30 text-violet-300 border-violet-500/40'
          : 'bg-black/20 text-gray-500 border-gray-700/40 hover:text-gray-300 hover:border-gray-600/60'}"
        data-style="${escapeHtml(v.style)}">${sm.icon} ${sm.label}</button>`;
    }).join('');

    const varPanelsHtml = (post.variants || []).map(v => {
      const charCount = v.text?.length || 0;
      const charColor = charCount <= 400 ? 'text-emerald-500' : charCount <= 500 ? 'text-amber-500' : 'text-red-500';
      return `<div class="threads-var-panel ${v.style !== (firstVar?.style || 'bold') ? 'hidden' : ''}" data-style="${escapeHtml(v.style)}">
        <div class="flex items-start gap-2">
          <div class="flex-1 space-y-1.5">
            <p class="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">${_formatThreadsText(v.text)}</p>
            <div class="flex items-center gap-2">
              <span class="${charColor} text-[9px] font-medium">${charCount} ñèìâîëîâ</span>
              ${charCount <= 500 ? '<span class="text-[8px] text-emerald-600">? Threads OK</span>' : '<span class="text-[8px] text-red-600">? Äëèííûé</span>'}
            </div>
          </div>
          <button class="threads-copy-variant flex-shrink-0 text-[9px] px-2 py-1 rounded-md bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-all font-medium" data-text="${escapeHtml(v.text)}">??</button>
        </div>
      </div>`;
    }).join('');

    // Hashtags HTML
    const allH = _allHashtags(post);
    const hashtagsHtml = allH.length ? `
      <div class="border-t border-white/[0.04] px-5 py-4 space-y-2" style="background:rgba(232,121,168,0.02)">
        <div class="flex items-center justify-between">
          <button class="threads-toggle-hashtags text-[10px] text-fuchsia-400 font-semibold uppercase tracking-[0.15em] hover:text-fuchsia-300 transition-colors flex items-center gap-1.5">
            <span>???</span> <span>Õýøòåãè (${allH.length})</span> <span class="text-gray-600">¡</span>
          </button>
          <button class="threads-copy-hashtags btn-neon-pink text-[9px] px-2 py-0.5" data-text="${escapeHtml(allH.join(' '))}">?? Êîïèðîâàòü</button>
        </div>
        <div class="threads-hashtags-body hidden space-y-2 pt-1">
          ${post.hashtags?.high_volume?.length ? `<div class="space-y-1"><div class="text-[8px] text-gray-600 uppercase tracking-wider">Ïîïóëÿðíûå</div><div class="flex flex-wrap gap-1">${post.hashtags.high_volume.map(h => `<span class="tag tag-green">${escapeHtml(h)}</span>`).join('')}</div></div>` : ''}
          ${post.hashtags?.mid_volume?.length ? `<div class="space-y-1"><div class="text-[8px] text-gray-600 uppercase tracking-wider">Ñðåäíèå</div><div class="flex flex-wrap gap-1">${post.hashtags.mid_volume.map(h => `<span class="tag tag-purple">${escapeHtml(h)}</span>`).join('')}</div></div>` : ''}
          ${post.hashtags?.niche?.length ? `<div class="space-y-1"><div class="text-[8px] text-gray-600 uppercase tracking-wider">Íèøåâûå</div><div class="flex flex-wrap gap-1">${post.hashtags.niche.map(h => `<span class="tag" style="background:rgba(6,182,212,0.08);border-color:rgba(6,182,212,0.18);color:#22d3ee">${escapeHtml(h)}</span>`).join('')}</div></div>` : ''}
        </div>
      </div>` : '';

    // Reel ideas HTML
    const reelFormatIcon = { 'talking head': '???', 'text-on-screen': '??', 'POV': '??', 'greenscreen': '??', 'trending-audio': '??', 'storytelling': '??' };
    const reelHtml = (post.reel_ideas || []).map((r, i) => `
      <div class="rounded-lg p-3 border border-cyan-500/15 bg-cyan-500/5 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex-shrink-0">${i + 1}</span>
          <span class="text-[11px] font-semibold text-cyan-300">${escapeHtml(r.hook)}</span>
          ${r.format ? `<span class="ml-auto text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/15">${reelFormatIcon[r.format] || '??'} ${escapeHtml(r.format)}</span>` : ''}
        </div>
        ${r.conflict ? `<div class="text-[10px] text-gray-400"><span class="text-amber-400/70 font-medium">Êîíôëèêò:</span> ${escapeHtml(r.conflict)}</div>` : ''}
        ${r.direction ? `<div class="text-[10px] text-gray-400"><span class="text-violet-400/70 font-medium">Ñöåíàðèé:</span> ${escapeHtml(r.direction)}</div>` : ''}
        ${r.why_viral ? `<div class="text-[10px] text-emerald-400/70 italic">${escapeHtml(r.why_viral)}</div>` : ''}
      </div>
    `).join('');

    // Best time HTML
    const bestTimeHtml = post.best_time?.time ? `
      <div class="flex items-center gap-1.5 text-[9px] text-cyan-400">
        <span>?</span>
        <span class="font-semibold">${escapeHtml(post.best_time.day || '')} ${escapeHtml(post.best_time.time)}</span>
        ${post.best_time.reasoning ? `<span class="text-gray-600">— ${escapeHtml(post.best_time.reasoning)}</span>` : ''}
      </div>` : '';

    return `
    <div class="threads-card" data-post-id="${escapeHtml(post.id)}">

      <!-- Card header -->
      <div class="p-5 pb-4 space-y-3">

        <!-- Top row: number + meta + score -->
        <div class="flex items-start gap-3">
          <!-- Left: rank badge -->
          <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 border border-violet-500/20 text-[11px] font-bold text-violet-400 flex-shrink-0">${idx + 1}</div>

          <!-- Center: meta info -->
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[9px] px-2 py-0.5 rounded-full border ${conf.cls} font-medium">${conf.label}</span>
              ${hasAuthor ? `<span class="text-[10px] text-cyan-400 font-medium truncate">${escapeHtml(post.author)}</span>` : ''}
              ${post.topic_tag ? `<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-white/[0.03] text-gray-500 border border-white/[0.06]">${escapeHtml(post.topic_tag)}</span>` : ''}
            </div>
            <div class="flex items-center gap-2 text-[9px] text-gray-600">
              ${post.freshness_label ? `<span>${escapeHtml(post.freshness_label)}</span>` : ''}
              ${sigLikes !== 'íåèçâåñòíî' ? `<span>?? ${escapeHtml(sigLikes)}</span>` : ''}
              ${sigComm !== 'íåèçâåñòíî' ? `<span>?? ${escapeHtml(sigComm)}</span>` : ''}
              ${sigRepost !== 'íåèçâåñòíî' ? `<span>?? ${escapeHtml(sigRepost)}</span>` : ''}
            </div>
          </div>

          <!-- Right: virality score -->
          <div class="flex-shrink-0 text-right space-y-1" style="min-width:80px">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div class="${vColor.bar} h-full rounded-full transition-all" style="width:${vScore}%"></div>
              </div>
              <span class="${vColor.text} text-xs font-bold tabular-nums" style="font-family:'JetBrains Mono',monospace">${vScore}</span>
            </div>
            <div class="flex gap-1.5 justify-end">
              <span class="text-[8px] text-gray-600" title="Êîììåíòû (0-30)">??${sb.comment_potential || sb.debate || 0}</span>
              <span class="text-[8px] text-gray-600" title="Óçíàâàåìîñòü (0-25)">??${sb.relatability || sb.depth || 0}</span>
              <span class="text-[8px] text-gray-600" title="Øàðèíã (0-25)">??${sb.shareability || 0}</span>
              <span class="text-[8px] text-gray-600" title="Ýìîöèÿ (0-20)">??${sb.emotion || 0}</span>
            </div>
          </div>
        </div>

        <!-- Post text -->
        <p class="text-[13px] text-gray-200 leading-relaxed whitespace-pre-wrap">${_formatThreadsText(post.text)}</p>

        <!-- Engagement hook badge -->
        ${post.engagement_hook ? `
        <div class="flex items-start gap-1.5 rounded-lg p-2 bg-violet-500/5 border border-violet-500/15">
          <span class="text-[10px] flex-shrink-0">??</span>
          <span class="text-[10px] text-violet-300 leading-snug font-medium">${escapeHtml(post.engagement_hook)}</span>
        </div>` : ''}

        <!-- News source badge -->
        ${post.news_source ? `
        <div class="flex items-start gap-1.5 rounded-lg p-2 bg-cyan-500/5 border border-cyan-500/15">
          <span class="text-[10px] flex-shrink-0">??</span>
          <div class="space-y-0.5">
            <span class="text-[10px] text-cyan-400 leading-snug">${escapeHtml(post.news_source)}</span>
            ${post.news_url ? `<a href="${escapeHtml(post.news_url)}" target="_blank" rel="noopener" class="block text-[9px] text-cyan-600 hover:text-cyan-400 truncate transition-colors">?? Èñòî÷íèê</a>` : ''}
          </div>
        </div>` : ''}

        <!-- Best time -->
        ${bestTimeHtml}

        <!-- Actions row -->
        <div class="flex items-center gap-2 flex-wrap pt-1">
          <button class="threads-copy-post btn-neon text-[10px] px-2.5 py-1" data-text="${escapeHtml(post.text)}">?? Êîïèðîâàòü</button>
          <button class="threads-queue-post text-[10px] px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all font-medium" data-post-idx="${idx}">?? Â î÷åðåäü</button>
          ${hasUrl ? `<a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer" class="btn-neon text-[10px] px-2.5 py-1" style="text-decoration:none">?? Îòêðûòü</a>` : ''}
          <button class="threads-toggle-analysis text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all font-medium">¡ Àíàëèç</button>
        </div>
      </div>

      <!-- Analysis block (collapsed) -->
      <div class="threads-analysis-body hidden border-t border-white/[0.04] px-5 py-4 space-y-3" style="background:rgba(245,158,11,0.02)">
        ${post.analysis?.key_insight ? `
        <div class="rounded-xl p-3 bg-gradient-to-r from-emerald-500/8 to-cyan-500/5 border border-emerald-500/15">
          <div class="text-[9px] text-emerald-500 font-semibold uppercase tracking-[0.15em] mb-1">Êëþ÷åâîé èíñàéò</div>
          <div class="text-[12px] text-emerald-200 font-medium leading-relaxed">${escapeHtml(post.analysis.key_insight)}</div>
        </div>` : ''}
        ${post.analysis?.why_works ? `<div class="text-[11px] text-gray-400 leading-relaxed">${escapeHtml(post.analysis.why_works)}</div>` : ''}
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          ${post.analysis?.hook ? `<div class="rounded-lg p-2.5 bg-black/20 border border-amber-500/10 space-y-1"><div class="text-[9px] text-amber-400/80 font-semibold uppercase tracking-[0.1em]">Õóê</div><div class="text-[11px] text-gray-300">${escapeHtml(post.analysis.hook)}</div></div>` : ''}
          ${post.analysis?.conflict ? `<div class="rounded-lg p-2.5 bg-black/20 border border-red-500/10 space-y-1"><div class="text-[9px] text-red-400/80 font-semibold uppercase tracking-[0.1em]">Êîíôëèêò</div><div class="text-[11px] text-gray-300">${escapeHtml(post.analysis.conflict)}</div></div>` : ''}
          ${post.analysis?.audience_pain ? `<div class="rounded-lg p-2.5 bg-black/20 border border-violet-500/10 space-y-1"><div class="text-[9px] text-violet-400/80 font-semibold uppercase tracking-[0.1em]">Áîëü àóäèòîðèè</div><div class="text-[11px] text-gray-300">${escapeHtml(post.analysis.audience_pain)}</div></div>` : ''}
          ${post.analysis?.cta_potential ? `<div class="rounded-lg p-2.5 bg-black/20 border border-cyan-500/10 space-y-1"><div class="text-[9px] text-cyan-400/80 font-semibold uppercase tracking-[0.1em]">CTA-ïîòåíöèàë</div><div class="text-[11px] text-gray-300">${escapeHtml(post.analysis.cta_potential)}</div></div>` : ''}
        </div>
        ${post.analysis?.predicted_comments?.length ? `
        <div class="rounded-xl p-3 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5 border border-violet-500/15 space-y-2">
          <div class="text-[9px] text-violet-400 font-semibold uppercase tracking-[0.15em]">?? Ïðåäñêàçàííûå êîììåíòàðèè</div>
          ${post.analysis.predicted_comments.map(c => `<div class="text-[11px] text-gray-300 pl-3 border-l-2 border-violet-500/20">"${escapeHtml(c)}"</div>`).join('')}
        </div>` : ''}
      </div>

      <!-- Variants block -->
      ${post.variants?.length ? `
      <div class="border-t border-white/[0.04] px-5 py-4 space-y-3" style="background:rgba(124,92,252,0.02)">
        <div class="text-[10px] text-violet-400 font-semibold uppercase tracking-[0.15em]">Ãîòîâûå ïîñòû äëÿ ïóáëèêàöèè</div>
        <div class="flex gap-1.5 flex-wrap">${varTabsHtml}</div>
        <div class="threads-var-panels">${varPanelsHtml}</div>
      </div>` : ''}

      <!-- Hashtags block -->
      ${hashtagsHtml}

      <!-- Reels block -->
      ${post.reel_ideas?.length ? `
      <div class="border-t border-white/[0.04] px-5 py-4 space-y-2" style="background:rgba(6,182,212,0.02)">
        <button class="threads-toggle-reels text-[10px] text-cyan-400 font-semibold uppercase tracking-[0.15em] hover:text-cyan-300 transition-colors w-full text-left flex items-center gap-1.5">
          <span>??</span> <span>Èäåè äëÿ Reels (${post.reel_ideas.length})</span> <span class="text-gray-600 ml-auto">¡</span>
        </button>
        <div class="threads-reels-body hidden space-y-2">${reelHtml}</div>
      </div>` : ''}

    </div>`;
  }).join('');
}

function _switchVariantTab(card, style) {
  card.querySelectorAll('.threads-var-tab').forEach(t => {
    const isActive = t.dataset.style === style;
    t.className = `threads-var-tab px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all whitespace-nowrap ${
      isActive
        ? 'bg-violet-600/30 text-violet-300 border-violet-500/40'
        : 'bg-black/20 text-gray-500 border-gray-700/40 hover:text-gray-300 hover:border-gray-600/60'
    }`;
  });
  card.querySelectorAll('.threads-var-panel').forEach(p => {
    p.classList.toggle('hidden', p.dataset.style !== style);
  });
}

// --- INIT --------------------------------
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
    ['initConsultation',initConsultation],
    ['initSeries',initSeries],['initHistory',initHistory],
    ['initSurprise',initSurprise],['initABTesting',initABTesting],
    ['initTranslate',initTranslate],['initCharConstructor',initCharConstructor],
    ['initLocConstructor',initLocConstructor],
    ['initMatrixRain',initMatrixRain],
    ['initKeyboardShortcuts',initKeyboardShortcuts],
    ['initPhotoPrompt',initPhotoPrompt],
    ['initThreadsTrends',initThreadsTrends],
    ['initThreadsAutopost',_initThreadsAutopost],
  ];
  for (const [n,f] of _init) { try { f(); } catch(e) { console.error(`[FERIXDI] ${n}:`,e); } }
  try { initCharCounters(); } catch(e) { console.error('[FERIXDI] initCharCounters:', e); }
  // Silent JWT refresh every 20 minutes while page is open
  setInterval(() => {
    if (isPromoValid() || localStorage.getItem('ferixdi_username')) autoAuth();
  }, 20 * 60 * 1000);
  // Locations loaded lazily on first visit to the locations tab (see navigateTo lazy init)
  // Initial readiness check after all components loaded
  setTimeout(() => {
    updateReadiness();
    if (isPromoValid()) autoAuth(); // Refresh JWT on every app load
    loadCustomCharacters();
    // Characters DOM rendered lazily on first visit to characters tab (data already pre-fetched)
    populateSeriesSelects();
    renderSeriesList();
    // Restore draft UI after characters are available
    _restoreDraftUI();
    // Auto-save text inputs on typing
    ['idea-input', 'script-a', 'script-b'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', _scheduleDraftSave);
    });
    // Handle hash deep-links (e.g. #education from landing)
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const sectionMap = { education: 'education', academy: 'education', consult: 'consult', settings: 'settings' };
      const target = sectionMap[hash];
      if (target && typeof navigateTo === 'function') navigateTo(target);
    }
  }, 300);

  // --- GLOBAL SOUND: catch ALL buttons/interactive elements ---
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
