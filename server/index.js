/**
 * FERIXDI Studio — Backend Server (API Mode)
 * Express + JWT, для деплоя на Render
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── GitHub Persistence for Custom Characters/Locations ─────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ferixdi-png/ferixdi_studio';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const CUSTOM_CHARS_PATH = 'app/data/custom_characters.json';
const CUSTOM_LOCS_PATH = 'app/data/custom_locations.json';
const USERS_PATH = 'app/data/users.json';

// In-memory cache (loaded from GitHub on startup)
let _customCharacters = [];
let _customLocations = [];
let _users = [];
let _ghCacheSha = { chars: null, locs: null, users: null };

async function ghApiRequest(path, method = 'GET', body = null) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ferixdi-studio-server',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

async function loadCustomFromGitHub(type) {
  const filePath = type === 'character' ? CUSTOM_CHARS_PATH : type === 'location' ? CUSTOM_LOCS_PATH : USERS_PATH;
  try {
    const resp = await ghApiRequest(filePath);
    if (!resp.ok) {
      if (resp.status === 404) {
        console.log(`[GH] ${filePath} not found — starting empty`);
        return [];
      }
      console.warn(`[GH] Failed to load ${filePath}: ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    if (type === 'character') _ghCacheSha.chars = data.sha;
    else if (type === 'location') _ghCacheSha.locs = data.sha;
    else if (type === 'users') _ghCacheSha.users = data.sha;
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`[GH] Error loading ${filePath}:`, e.message);
    return [];
  }
}

const _ghSaveLock = { character: null, location: null, users: null };
async function saveCustomToGitHub(type) {
  // Serialize saves per type to prevent SHA race conditions (409 conflict)
  if (_ghSaveLock[type]) await _ghSaveLock[type].catch(() => {});
  let resolve;
  _ghSaveLock[type] = new Promise(r => { resolve = r; });

  if (!GITHUB_TOKEN) {
    console.warn('[GH] No GITHUB_TOKEN — skipping persist');
    resolve(); _ghSaveLock[type] = null;
    return false;
  }
  const filePath = type === 'character' ? CUSTOM_CHARS_PATH : type === 'location' ? CUSTOM_LOCS_PATH : USERS_PATH;
  const items = type === 'character' ? _customCharacters : type === 'location' ? _customLocations : _users;
  const sha = type === 'character' ? _ghCacheSha.chars : type === 'location' ? _ghCacheSha.locs : _ghCacheSha.users;
  const content = Buffer.from(JSON.stringify(items, null, 2) + '\n').toString('base64');
  const body = {
    message: `[auto] Update custom ${type}s (${items.length} items)`,
    content,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'ferixdi-studio-server',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error(`[GH] Save failed ${filePath}: ${resp.status}`, err.message || '');
      resolve(); _ghSaveLock[type] = null;
      return false;
    }
    const result = await resp.json();
    if (type === 'character') _ghCacheSha.chars = result.content?.sha;
    else if (type === 'location') _ghCacheSha.locs = result.content?.sha;
    else if (type === 'users') _ghCacheSha.users = result.content?.sha;
    console.log(`[GH] Saved ${filePath} (${items.length} items)`);
    resolve(); _ghSaveLock[type] = null;
    return true;
  } catch (e) {
    console.error(`[GH] Save error ${filePath}:`, e.message);
    resolve(); _ghSaveLock[type] = null;
    return false;
  }
}

async function initCustomData() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  🗄️  GitHub Persistence — Loading...      ║');
  console.log('╚══════════════════════════════════════════╝');
  const [chars, locs, users] = await Promise.all([
    loadCustomFromGitHub('character'),
    loadCustomFromGitHub('location'),
    loadCustomFromGitHub('users'),
  ]);
  _customCharacters = chars;
  _customLocations = locs;
  _users = users;
  console.log(`✅ [GH] Custom characters: ${_customCharacters.length}`);
  console.log(`✅ [GH] Custom locations:  ${_customLocations.length}`);
  console.log(`✅ [GH] Users:             ${_users.length}`);
  if (_customCharacters.length > 0) {
    console.log(`   📋 Characters: ${_customCharacters.map(c => c.name_ru || c.id).join(', ')}`);
  }
  if (_customLocations.length > 0) {
    console.log(`   📋 Locations:  ${_customLocations.map(l => l.name_ru || l.id).join(', ')}`);
  }
  console.log(`🗄️  GitHub SHA cache — chars: ${_ghCacheSha.chars ? 'OK' : 'none'}, locs: ${_ghCacheSha.locs ? 'OK' : 'none'}`);
  console.log('─────────────────────────────────────────────\n');
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Externalized prompt fragments ──────────
const _dialogueRulesPrompt = (() => {
  try { return readFileSync(join(__dirname, 'prompts/dialogue-rules.md'), 'utf-8'); }
  catch { console.warn('[PROMPTS] dialogue-rules.md not found — using empty fallback'); return ''; }
})();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set! Using random secret — tokens will invalidate on restart. Set JWT_SECRET env var in production.');

// ─── Multi API Key Rotation ─────────────────
function getGeminiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 1; i <= 5; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return keys.length > 0 ? keys : [];
}
let _keyIndex = 0;
function nextGeminiKey() {
  const keys = getGeminiKeys();
  if (keys.length === 0) return null;
  const key = keys[_keyIndex % keys.length];
  _keyIndex++;
  return key;
}

// ─── IP extraction (Render proxy) ────────────
function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// ─── Rate Limiting (in-memory, per-bucket) ───
const _rateBuckets = new Map();
function checkRateLimit(bucketKey, windowMs, maxCount) {
  const now = Date.now();
  let entry = _rateBuckets.get(bucketKey);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    _rateBuckets.set(bucketKey, entry);
  }
  entry.count++;
  return entry.count <= maxCount;
}
// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateBuckets) {
    if (now - v.windowStart > 900_000) _rateBuckets.delete(k);
  }
}, 300_000);

// Rate limit constants per endpoint
const RL_AUTH    = { window: 900_000, max: 5 };   // 5 per 15min (anti-brute-force)
const RL_GEN     = { window: 60_000,  max: 6 };   // 6 per min
const RL_TRENDS  = { window: 60_000,  max: 4 };   // 4 per min
const RL_PRODUCT = { window: 60_000,  max: 8 };   // 8 per min
const RL_CONSULT = { window: 600_000, max: 5 };   // 5 per 10min per IP (free, no auth)
const RL_GEMINI  = { window: 60_000, max: 1 };    // 1 Gemini request per user per 1min

// ─── GEMINI RESPONSE CACHE (in-memory, TTL 5 min) ──────────────────────────────────
const _geminiCache = new Map();
const GEMINI_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getGeminiCacheKey(context) {
  const keyObj = {
    mode: context.input_mode,
    a: context.charA?.id,
    b: context.charB?.id,
    topic: context.topic_ru,
    script: context.script_ru ? JSON.stringify(context.script_ru) : null,
    hint: context.scene_hint,
    loc: context.location,
    solo: context.soloMode,
  };
  return crypto.createHash('sha256').update(JSON.stringify(keyObj)).digest('hex').slice(0, 20);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _geminiCache) {
    if (now - v.ts > GEMINI_CACHE_TTL) _geminiCache.delete(k);
  }
}, 60_000);

// ─── GZIP COMPRESSION (built-in zlib, no extra dep) ───────────────────────
function compressionMiddleware(req, res, next) {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip')) return next();
  const _origJson = res.json.bind(res);
  res.json = (obj) => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    if (buf.length < 1024) { // Skip compression for small payloads
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(buf);
    }
    zlib.gzip(buf, { level: 6 }, (err, compressed) => {
      if (err) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(buf);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', compressed.length);
      res.end(compressed);
    });
  };
  next();
}

// ─── Enhanced Security Headers ────────────────────────
app.use(compressionMiddleware);
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  
  next();
});

// ─── CORS (restrict to known origins) ────────
const ALLOWED_ORIGINS = [
  'https://ferixdi-studio.onrender.com',
  'http://localhost:3001',
  'http://localhost:5500',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Also allow *.onrender.com subdomains
    if (origin.endsWith('.onrender.com')) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// ─── Serve Frontend (app/) ──────────────────
const appDir = join(__dirname, '..', 'app');
// Block access to sensitive data files
app.use('/data/users.json', (req, res) => res.status(403).json({ error: 'Forbidden' }));
app.use('/data/access_keys.json', (req, res) => res.status(403).json({ error: 'Forbidden' }));
app.use(express.static(appDir));

// ─── Cookie helper ─────────────────────────────────────────
function _parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map(c => { const [k, ...v] = c.trim().split('='); return [k, v.join('=')]; })
  );
}
function _setAuthCookie(res, token, req) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  const secure = isHttps ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ferixdi_jwt=${token}; HttpOnly; SameSite=Strict; Max-Age=2592000; Path=/${secure}`);
}

// ─── Auth Middleware ──────────────────────────
function authMiddleware(req, res, next) {
  // Accept both Authorization header (API clients) and httpOnly cookie (browser)
  let token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    const cookies = _parseCookies(req);
    token = cookies['ferixdi_jwt'];
  }
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── POST /api/auth/validate ─────────────────
app.post('/api/auth/validate', async (req, res) => {
  const ip = getClientIP(req);

  // Anti-brute-force: 5 attempts per 15 min per IP
  if (!checkRateLimit(`auth:${ip}`, RL_AUTH.window, RL_AUTH.max)) {
    console.warn(`Auth rate limit hit: ${ip}`);
    return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
  }

  const { key } = req.body;
  if (!key || typeof key !== 'string' || key.length > 128) {
    return res.status(400).json({ error: 'Key required' });
  }

  // Only accept pre-hashed keys (SHA-256 hex) — no plaintext accepted
  const isHex64 = /^[a-f0-9]{64}$/.test(key);
  const hash = isHex64 ? key : crypto.createHash('sha256').update(key).digest('hex');
  try {
    const keysPath = join(__dirname, '..', 'app', 'data', 'access_keys.json');
    const keys = JSON.parse(readFileSync(keysPath, 'utf-8'));
    const match = keys.keys.find(k => k.hash === hash);
    if (!match) {
      // Delay response to slow down brute-force
      await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
      return res.status(403).json({ error: 'Invalid key' });
    }

    // Check if this promo user has a registered account — if so, include userId
    const existingUser = _users.find(u => u.promoHash === hash);
    const userId = existingUser ? existingUser.id : `promo_${hash.slice(0, 12)}`;
    const token = jwt.sign({ label: match.label, hash, userId }, JWT_SECRET, { expiresIn: '24h' });
    _setAuthCookie(res, token, req);
    res.json({ jwt: token, label: match.label, userId, hasAccount: !!existingUser });
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// ─── POST /api/auth/register — Create personal account ──────
app.post('/api/auth/register', async (req, res) => {
  const ip = getClientIP(req);
  if (!checkRateLimit(`reg:${ip}`, 900_000, 5)) {
    return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
  }

  const { username, password, promoHash } = req.body;
  if (!username || !password || !promoHash) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  if (typeof username !== 'string' || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'Логин: 3-30 символов' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Логин: только латиница, цифры и _' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
    return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
  }

  // Validate promo code
  try {
    const keysPath = join(__dirname, '..', 'app', 'data', 'access_keys.json');
    const keys = JSON.parse(readFileSync(keysPath, 'utf-8'));
    const match = keys.keys.find(k => k.hash === promoHash);
    if (!match) {
      return res.status(403).json({ error: 'Неверный промо-код. Сначала активируйте промо-код.' });
    }
  } catch {
    return res.status(500).json({ error: 'Ошибка проверки промо-кода' });
  }

  // Check username uniqueness
  const usernameLower = username.toLowerCase();
  if (_users.find(u => u.username.toLowerCase() === usernameLower)) {
    return res.status(409).json({ error: 'Этот логин уже занят' });
  }

  // Hash password
  const salt = crypto.randomBytes(16).toString('hex');
  const passHash = crypto.createHash('sha256').update(salt + password).digest('hex');
  const userId = crypto.randomUUID();

  const newUser = {
    id: userId,
    username,
    passHash,
    salt,
    promoHash,
    createdAt: new Date().toISOString(),
  };
  _users.push(newUser);
  saveCustomToGitHub('users').catch(e => console.error('[Users] Save error:', e.message));

  const token = jwt.sign({ userId, username, hash: promoHash, label: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  _setAuthCookie(res, token, req);
  console.log(`[Auth] New user registered: ${username} (${userId})`);
  res.json({ jwt: token, userId, username });
});

// ─── POST /api/auth/login — Login with username/password ──────
app.post('/api/auth/login', async (req, res) => {
  const ip = getClientIP(req);
  if (!checkRateLimit(`login:${ip}`, 900_000, 10)) {
    return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  const user = _users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const passHash = crypto.createHash('sha256').update(user.salt + password).digest('hex');
  if (passHash !== user.passHash) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = jwt.sign({ userId: user.id, username: user.username, hash: user.promoHash, label: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  _setAuthCookie(res, token, req);
  console.log(`[Auth] User logged in: ${user.username}`);
  res.json({ jwt: token, userId: user.id, username: user.username });
});

// ─── POST /api/auth/logout — clear httpOnly cookie ────────────────
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'ferixdi_jwt=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/');
  res.json({ ok: true });
});

// ─── GET /api/custom/characters — Serve custom characters from memory ────
app.get('/api/custom/characters', (req, res) => {
  res.json(_customCharacters);
});

// ─── GET /api/custom/locations — Serve custom locations from memory ────
app.get('/api/custom/locations', (req, res) => {
  res.json(_customLocations);
});

// ─── POST /api/custom/create — Validate promo + persist to GitHub ────
// Requires JWT auth — prevents DevTools bypass of client-side isPromoValid()
app.post('/api/custom/create', authMiddleware, async (req, res) => {
  const { type, data: itemData } = req.body;
  if (!type || !itemData) {
    return res.status(400).json({ error: 'type and data required' });
  }
  if (!['character', 'location'].includes(type)) {
    return res.status(400).json({ error: 'type must be character or location' });
  }
  // Validate required fields
  if (type === 'character') {
    if (!itemData.name_ru || !itemData.appearance_ru) {
      return res.status(400).json({ error: 'name_ru and appearance_ru required for character' });
    }
    // Validate identity completeness
    const warnings = [];
    const ia = itemData.identity_anchors || {};
    const bo = itemData.biology_override || {};
    if (!ia.face_silhouette || ia.face_silhouette === 'custom') warnings.push('identity_anchors.face_silhouette');
    if (!ia.signature_element || ia.signature_element === 'custom') warnings.push('identity_anchors.signature_element');
    if (!ia.wardrobe_anchor) warnings.push('identity_anchors.wardrobe_anchor');
    if (!bo.age) warnings.push('biology_override.age');
    if (!bo.height_build) warnings.push('biology_override.height_build');
    if (!bo.facial_expression_default) warnings.push('biology_override.facial_expression_default');
    const bioArrays = ['skin_tokens','skin_color_tokens','wrinkle_map_tokens','eye_tokens','hair_tokens','facial_hair_tokens','nose_tokens','mouth_tokens','ear_tokens','neck_tokens','body_shape_tokens','hands_tokens','scar_mark_tokens','posture_tokens','gait_tokens','voice_texture_tokens','jaw_tokens','cheekbone_tokens','forehead_tokens','eyebrow_tokens','lip_texture_tokens','chin_tokens','nasolabial_tokens','undereye_tokens','shoulder_tokens','teeth_tokens','eyelash_tokens'];
    bioArrays.forEach(f => { if (!Array.isArray(bo[f]) || !bo[f].length || (bo[f].length === 1 && bo[f][0] === 'custom appearance')) warnings.push(`biology_override.${f}`); });
    if (!ia.accessory_anchors || !ia.accessory_anchors.length) warnings.push('identity_anchors.accessory_anchors');
    if (!ia.footwear_anchor) warnings.push('identity_anchors.footwear_anchor');
    if (!ia.color_palette || !ia.color_palette.length) warnings.push('identity_anchors.color_palette');
    ['jewelry_anchors','glasses_anchor','nail_style_anchor','fabric_texture_anchor','pattern_anchor','sleeve_style_anchor'].forEach(f => { if (!ia[f]) warnings.push(`identity_anchors.${f}`); });
    const mod = itemData.modifiers || {};
    ['anger_expression','thinking_expression','surprise_expression','eye_contact_style','sad_expression','contempt_expression','disgust_expression','joy_expression','blink_pattern','fidget_style'].forEach(f => { if (!mod[f]) warnings.push(`modifiers.${f}`); });
    if (!itemData.prompt_tokens?.character_en) warnings.push('prompt_tokens.character_en');
    if (warnings.length > 0) {
      console.warn(`[CHAR-VALIDATE] ${itemData.name_ru}: ${warnings.length} weak fields: ${warnings.join(', ')}`);
    }
  } else {
    if (!itemData.name_ru || !itemData.scene_en) {
      return res.status(400).json({ error: 'name_ru and scene_en required for location' });
    }
  }

  // Assign server-side id if missing
  const id = itemData.id || `srv_${Date.now().toString(36)}`;
  itemData.id = id;
  itemData._custom = true;
  itemData._createdAt = new Date().toISOString();

  // Assign numeric_id if missing (server-side guarantee)
  if (!itemData.numeric_id) {
    if (type === 'character') {
      const maxId = _customCharacters.reduce((mx, c) => Math.max(mx, c.numeric_id || 0), 200);
      itemData.numeric_id = maxId + 1;
    } else {
      const maxId = _customLocations.reduce((mx, l) => Math.max(mx, l.numeric_id || 0), 144);
      itemData.numeric_id = maxId + 1;
    }
  }

  // Add to in-memory cache (dedup)
  if (type === 'character') {
    if (!_customCharacters.find(c => c.id === id)) {
      _customCharacters.push(itemData);
    }
  } else {
    if (!_customLocations.find(l => l.id === id)) {
      _customLocations.push(itemData);
    }
  }

  // Persist to GitHub (async, don't block response)
  saveCustomToGitHub(type).catch(e => console.error(`[GH] Background save failed:`, e.message));

  res.json({ ok: true, type, id });
});

// ─── POST /api/fun/category ──────────────────
app.post('/api/fun/category', authMiddleware, (req, res) => {
  const categories = [
    { ru: 'Бытовой абсурд', en: 'Domestic absurdity' },
    { ru: 'AI и технологии', en: 'AI and technology' },
    { ru: 'Цены и инфляция', en: 'Prices and inflation' },
    { ru: 'Отношения', en: 'Relationships' },
    { ru: 'Разрыв поколений', en: 'Generation gap' },
    { ru: 'ЖКХ и коммуналка', en: 'Housing utilities drama' },
    { ru: 'Здоровье и поликлиника', en: 'Health and polyclinic' },
    { ru: 'Соцсети и тренды', en: 'Social media trends' },
    { ru: 'Дача и огород', en: 'Dacha and gardening' },
    { ru: 'Транспорт и пробки', en: 'Transport and traffic' },
  ];
  const cat = categories[Math.floor(Math.random() * categories.length)];
  res.json(cat);
});

// ─── Safe Join (handles string/array/undefined) ──────
function safeJoin(val, sep = ', ') {
  if (Array.isArray(val)) return val.join(sep);
  if (typeof val === 'string' && val.length > 0) return val;
  return '';
}

// ─── AI Production Contract Builder ──────
function buildAIPrompt(ctx) {
  const { charA, charB, category, topic_ru, scene_hint, input_mode, video_meta,
    product_info, location, wardrobeA, wardrobeB, propAnchor, lightingMood,
    hookAction, releaseAction, aesthetic, script_ru, cinematography,
    remake_mode, remake_instruction, thread_memory, soloMode, enableLaughter } = ctx;

  // ── THREAD MEMORY BLOCK (anti-repeat) ──
  let threadBlock = '';
  if (Array.isArray(thread_memory) && thread_memory.length > 0) {
    const items = thread_memory.map((h, i) => `  ${i + 1}. Категория: "${h.category}" | A: "${h.dialogueA}" | B: "${h.dialogueB}"`).join('\n');
    threadBlock = `\n══════════ ПРЕДЫДУЩИЕ ГЕНЕРАЦИИ (НЕ ПОВТОРЯЙ!) ══════════\nПользователь уже генерировал следующие диалоги. ПРИДУМАЙ НОВЫЙ, НЕПОХОЖИЙ диалог с другой темой, другими словами, другим углом юмора:\n${items}\n`;
  }

  // ── MODE-SPECIFIC TASK BLOCK ──
  let taskBlock = '';

  if (input_mode === 'video' && (video_meta || scene_hint || remake_mode)) {
    taskBlock = `
══════════ ЗАДАНИЕ: КОПИЯ/РЕМЕЙК ВИДЕО (1:1 ГОЛОС + ВИЗУАЛ) ══════════
Пользователь хочет ПЕРЕСОЗДАТЬ видео — результат должен быть ТОЧНОЙ КОПИЕЙ оригинала, но ЕЩЁ ХАРИЗМАТИЧНЕЕ и РЕАЛИСТИЧНЕЕ.
${!ctx.charA?.id || ctx.charA?.id === 'none' ? `
⚠️ РЕЖИМ ПРЯМОЙ КОПИИ (без персонажей): Пользователь НЕ выбрал персонажа — просто скопируй креатив как есть. Опиши людей из оригинала максимально точно (внешность, одежду, возраст, стиль). НЕ заменяй на AI-персонажей.` : ''}
${video_meta ? `
ОРИГИНАЛ ВИДЕО:
• Платформа: ${video_meta.platform || '?'}
• Название: "${video_meta.title || '—'}"
• Автор: ${video_meta.author || '—'}
• Длительность: ${video_meta.duration || '?'}s
• Размер: ${video_meta.width || '?'}×${video_meta.height || '?'}` : ''}
${scene_hint ? `• Описание от пользователя: "${scene_hint}"` : ''}

${ctx.hasVideoFile ? '' : ctx.hasVideoCover ? 'К этому сообщению ПРИКРЕПЛЁН КАДР ИЗ ОРИГИНАЛЬНОГО ВИДЕО. Внимательно проанализируй его: настроение, позы, фон, цветовую палитру, ракурс, выражения лиц, одежду, предметы в кадре.' : ''}
${remake_instruction ? `\n${remake_instruction}` : ''}

${ctx.hasVideoFile ? `⚠️ К ЭТОМУ СООБЩЕНИЮ ПРИКРЕПЛЕНО ОРИГИНАЛЬНОЕ ВИДЕО. ТЫ ДОЛЖЕН ЕГО ПОСМОТРЕТЬ И ПРОСЛУШАТЬ ПОЛНОСТЬЮ.

═══ ГЛАВНОЕ ПРАВИЛО: ГОЛОС И РЕЧЬ — ОДИН В ОДИН ═══
ПРОСЛУШАЙ ВИДЕО ВНИМАТЕЛЬНО. Каждое слово, каждая интонация, каждая пауза — КОПИРУЙ ДОСЛОВНО.
Результат должен быть ТОЧНЫМ РЕМЕЙКОМ, но ещё ХАРИЗМАТИЧНЕЕ, РЕАЛИСТИЧНЕЕ и ЗАРЯЖЕННЕЕ оригинала.

═══ ШАГ 1: ОПРЕДЕЛИ ТИП ВИДЕО ═══
ПОСМОТРИ ВИДЕО ПОЛНОСТЬЮ и определи:
ТИП A (ДИАЛОГ/СКИТ): люди разговаривают, спорят, шутят — есть РЕЧЬ
ТИП B (ВИЗУАЛЬНОЕ/ДЕЙСТВИЕ): спорт, танец, трюк, действие, визуальный контент — мало или НЕТ речи

═══ ЕСЛИ ТИП A (ДИАЛОГ/СКИТ) — КОПИРУЙ РЕЧЬ 1:1 ═══
1. РАСШИФРУЙ КАЖДОЕ СЛОВО ИЗ ВИДЕО — ДОСЛОВНО, без пропусков
2. dialogue_A_ru = ТОЧНАЯ КОПИЯ речи первого человека — СЛОВО В СЛОВО как в видео
3. dialogue_B_ru = ТОЧНАЯ КОПИЯ речи второго человека — СЛОВО В СЛОВО как в видео
4. killer_word = последнее ударное слово из речи B
5. ЗАПРЕЩЕНО менять слова, переписывать, «улучшать» — бери РОВНО то что звучит в видео!
6. Темп, паузы, эмоции, интонация — КОПИРУЙ из оригинала
7. Если речь на русском — копируй на русском. Если на другом языке — транслитерируй + переведи

═══ ЕСЛИ ТИП B (ВИЗУАЛЬНОЕ/ДЕЙСТВИЕ) — КОПИРУЙ ВИЗУАЛ ═══
1. Фокус на ВИЗУАЛЬНОМ СОДЕРЖАНИИ: сцена, действия, движения, ракурс
2. dialogue_A_ru = короткий комментарий/реакция персонажа на происходящее (6-15 слов, в стиле речи персонажа)
3. dialogue_B_ru = null если один персонаж, или реакция второго
4. killer_word = последнее слово реплики
5. photo_scene_en и remake_veo_prompt_en — ГЛАВНЫЙ приоритет, они должны ТОЧНО копировать визуал оригинала

═══ ДЛЯ ОБОИХ ТИПОВ — ОБЯЗАТЕЛЬНЫЙ ВИЗУАЛЬНЫЙ АНАЛИЗ ═══
ТЫ ОБЯЗАН проанализировать ВИЗУАЛЬНОЕ содержание видео и ВОСПРОИЗВЕСТИ его:
1. СЦЕНА: где происходит действие? (помещение, улица, площадка, зал, природа)
2. КОМПОЗИЦИЯ: как расположены люди/объекты в кадре? (крупный план, средний, общий)
3. КАМЕРА: какой ракурс? (selfie, от третьего лица, сверху, сбоку, широкий угол)
4. ДЕЙСТВИЯ: что делают люди? (говорят, бегут, танцуют, подают мяч, готовят)
5. ДВИЖЕНИЯ: ключевые движения тела? (взмах руки, поворот, прыжок, наклон)
6. НАСТРОЕНИЕ: какая энергия? (динамичная, спокойная, агрессивная, весёлая)
7. ОСВЕЩЕНИЕ: какой свет? (естественный, искусственный, яркий, мягкий)
8. ЭНЕРГИЯ И АТМОСФЕРА: какое общее настроение, темп, заряд оригинала? (агрессивно/весело/абсурдно/драматично)

⚠️ photo_scene_en ОБЯЗАН описывать ТУ ЖЕ сцену, композицию и действие что в оригинале — только с НАШИМИ персонажами в ИХ фирменной одежде.
⚠️ remake_veo_prompt_en ОБЯЗАН описывать ТО ЖЕ действие/движение что в оригинале — только с НАШИМИ персонажами.
⚠️ НЕ НАВЯЗЫВАЙ формат «два персонажа спорят в selfie» если в оригинале ДРУГОЙ формат!
⚠️ Если в оригинале камера снимает со стороны (не selfie) — описывай ТАК ЖЕ.
⚠️ Если в оригинале один человек делает действие (спорт/танец) — описывай ТО ЖЕ действие с нашим персонажем.
⚠️ ОДЕЖДА: персонажи ВСЕГДА в своей фирменной одежде из Identity Lock — ЗАПРЕЩЕНО копировать одежду людей из оригинала.
⚠️ ВИРУСНЫЙ ПОТЕНЦИАЛ: определи что именно сделало оригинал вирусным (неожиданный поворот / абсурдная ситуация / узнаваемая жиза / идеальный тайминг) и УСИЛЬ это через наших персонажей на 20%.` : `ШАГ 1: ОПРЕДЕЛИ ТИП — диалог/скит (есть речь) или визуальное/действие (нет речи).

ЕСЛИ ДИАЛОГ/СКИТ:
1. ВОССТАНОВИ диалог по названию, обложке и контексту максимально точно
2. dialogue_A_ru = ДОСЛОВНАЯ копия речи первого (можно изменить 1-2 слова макс)
3. dialogue_B_ru = ДОСЛОВНАЯ копия речи второго
4. killer_word = последнее ударное слово из речи B
5. НЕ ПРИДУМЫВАЙ новый диалог!

ЕСЛИ ВИЗУАЛЬНОЕ/ДЕЙСТВИЕ:
1. Проанализируй обложку: сцена, действия, композиция, ракурс
2. dialogue_A_ru = комментарий/реакция персонажа (6-15 слов)
3. photo_scene_en и remake_veo_prompt_en = ТОЧНАЯ копия визуала оригинала

ДЛЯ ОБОИХ ТИПОВ: проанализируй обложку визуально (сцена, композиция, ракурс, действия, движения, свет) и воспроизведи в photo_scene_en и remake_veo_prompt_en с нашими персонажами.`}

КАТЕГОРИЮ ЮМОРА определи САМ по содержанию оригинала — придумай короткую (2-4 слова) категорию которая точно описывает суть.

⚡ ВИРУСНЫЙ АНАЛИЗ ОРИГИНАЛА (обязательно перед генерацией):
Перед тем как генерировать промпты — ответь себе на вопросы (не выводи в JSON, используй для улучшения контента):
• Что именно сделало оригинал вирусным? (узнаваемая бытовая ситуация / идеальный тайминг / абсурдный поворот / конфликт поколений / цена/деньги тема)
• Какой момент зрители будут пересматривать? (killer word / неожиданный жест / выражение лица в конце)
• Как НАШИ персонажи усилят это? (их специфический стиль речи / внешность / характер добавляет новый слой комедии)
• Что нужно ТОЧНО сохранить из оригинала чтобы не потерять вирусность?
Используй ответы для максимально заряженного remake.`;

  } else if (input_mode === 'script' && script_ru) {
    const isScriptSolo = soloMode || (!script_ru.B || !script_ru.B.trim());
    taskBlock = isScriptSolo ? `
══════════ ЗАДАНИЕ: СВОЙ МОНОЛОГ ПОЛЬЗОВАТЕЛЯ (СОЛО) ══════════
Пользователь написал СВОЙ монолог для одного персонажа. ТЫ ОБЯЗАН ИСПОЛЬЗОВАТЬ ИМЕННО ЕГО СЛОВА.

МОНОЛОГ ПОЛЬЗОВАТЕЛЯ (ИСПОЛЬЗОВАТЬ КАК ЕСТЬ):
• Реплика A (монолог): "${script_ru.A || '—'}"

ПРАВИЛА:
1. В dialogue_A_ru верни ТОЧНЫЙ текст пользователя — слово в слово
2. dialogue_B_ru = null (это СОЛО-МОНОЛОГ, нет второго персонажа)
3. dialogue_A2_ru = null
4. НЕ переписывай, НЕ улучшай, НЕ заменяй слова — это АВТОРСКИЙ текст
5. Если монолог >30 слов — можешь НЕМНОГО сократить, сохранив смысл и ключевые слова
6. Killer word = последнее ударное слово монолога
7. Всё остальное (фото-промпт, видео-промпт, хештеги, заголовок) генерируй по теме ЭТОГО монолога
8. Категорию юмора определи по содержанию монолога` : `
══════════ ЗАДАНИЕ: СВОЙ ДИАЛОГ ПОЛЬЗОВАТЕЛЯ ══════════
Пользователь написал СВОЙ диалог. ТЫ ОБЯЗАН ИСПОЛЬЗОВАТЬ ИМЕННО ЕГО СЛОВА.

ДИАЛОГ ПОЛЬЗОВАТЕЛЯ (ИСПОЛЬЗОВАТЬ КАК ЕСТЬ):
• Реплика A: "${script_ru.A || '—'}"
• Реплика B: "${script_ru.B || '—'}"

ПРАВИЛА:
1. В dialogue_A_ru и dialogue_B_ru верни ТОЧНЫЙ текст пользователя — слово в слово
2. НЕ переписывай, НЕ улучшай, НЕ заменяй слова — это АВТОРСКИЙ текст пользователя
3. Если реплика A >15 слов или B >18 слов — можешь НЕМНОГО сократить, сохранив смысл и ключевые слова
4. Killer word = последнее ударное слово реплики B
5. Всё остальное (фото-промпт, видео-промпт, хештеги, заголовок) генерируй по теме ЭТОГО диалога
6. Категорию юмора определи по содержанию диалога пользователя`;

  } else {
    taskBlock = `
══════════ ЗАДАНИЕ: ОТ ИДЕИ К КОНТЕНТУ ══════════
${topic_ru ? `
ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${topic_ru}"

ЧТО ДЕЛАТЬ — СНАЧАЛА ОПРЕДЕЛИ ТИП ИДЕИ:

ТИП 1 — ГОТОВАЯ ШУТКА/ДИАЛОГ (если в идее уже есть реплики, диалог, готовый анекдот, цитаты с тире или кавычками):
1. Пользователь дал тебе ГОТОВУЮ ШУТКУ — это золото. НЕ ПЕРЕПИСЫВАЙ её!
2. СОХРАНИ структуру и панчлайн шутки ДОСЛОВНО — это главная ценность
3. Раздели шутку на реплику A (провокация/завязка) и реплику B (панчлайн/развязка)
4. Адаптируй ТОЛЬКО стиль обращений под выбранных персонажей (имена, манеру речи)
5. Если в шутке упоминаются другие имена — замени на имена выбранных персонажей
6. НЕ МЕНЯЙ ключевые слова, не меняй панчлайн, не меняй логику шутки
7. Killer word = ударное слово из ОРИГИНАЛЬНОЙ шутки пользователя

ТИП 2 — ТЕМА/ИДЕЯ (если пользователь описал тему, ситуацию, концепт без готовых реплик):
1. Возьми идею как ЯДРО — весь контент крутится вокруг неё
2. Найди конфликтную точку: о чём бы ЭТИ ДВА персонажа спорили?
3. ПРИДУМАЙ ДИАЛОГ САМ — реплики A и B генерируешь с нуля, исходя из персонажей и темы
4. Персонаж A обвиняет/жалуется/возмущается по теме — в СВОЕЙ манере речи
5. Персонаж B находит неожиданный угол и переворачивает тему — в СВОЁМ стиле
6. Killer word РЕЗКО переключает контекст — вот почему видео пересматривают
7. Не уходи от темы — если про цены, спор про цены
8. Диалог должен быть СМЕШНЫМ и звучать как реальный разговор этих людей
9. КАТЕГОРИЮ ЮМОРА определи САМ — придумай короткую (2-4 слова) категорию которая точно описывает суть шутки` : `
${input_mode === 'suggested' ? `РЕЖИМ «ГОТОВЫЕ ИДЕИ» — ВЫБЕРИ МАКСИМАЛЬНО ОСТРУЮ АКТУАЛЬНУЮ ТЕМУ:
Пользователь хочет трендовую тему. Выбери самую актуальную и болезненную тему для русской аудитории прямо сейчас.
ТОПОВЫЕ ТЕМЫ 2026 (выбери одну или похожую):
• ЦЕНЫ: молоко/яйца/мясо/хлеб снова подорожали, скидка 50% которая не скидка, самовывоз дешевле доставки
• ЖКХ: квитанция выросла на 40%, батарея холодная уже ноябрь, управляющая компания молчит месяцами
• ЗДОРОВЬЕ: запись к врачу через 2 месяца, «сдайте 15 анализов», врач гуглит прямо при тебе
• ПОКОЛЕНИЯ: внуки с нейросетями, TikTok вместо уборки, «зачем звонить — есть мессенджер»
• МАРКЕТПЛЕЙСЫ: Ozon/Wildberries прислал не то, возврат неделю ждать, «5 звёзд» у дерьмового товара
• ТРАНСПОРТ: самокатчики на тротуаре, такси дороже ресторана, пробки 3 часа
• НЕЙРОСЕТИ: ChatGPT не умеет варить борщ, нейросеть рисует 6 пальцев, AI советует мухоморы
• БЮРОКРАТИЯ: Госуслуги упали, МФЦ «не тот документ», справка нужна для получения справки
ПРАВИЛО: возьми ОДНУ конкретную острую ситуацию. Реакция зрителя: «точно про меня!» — и немедленно переслать видео другу.
ЗАПРЕЩЕНО: политика, абстракции, темы старше года, узкоспециальное.` : `СВОБОДНАЯ ГЕНЕРАЦИЯ:
Пользователь не указал тему. ПРИДУМАЙ САМ свежую, неожиданную комедийную ситуацию.
Что-то о чём реально спорят русские люди. Бытовое, узнаваемое, с абсурдным поворотом.`}
ТЫ генерируешь диалог с нуля — реплики должны идеально подходить под характеры персонажей и быть СМЕШНЫМИ.
КАТЕГОРИЮ ЮМОРА определи САМ — придумай короткую (2-4 слова) категорию которая точно описывает суть шутки.`}`;
  }

  // ── PRODUCT BLOCK (if product photo attached) ──
  let productBlock = '';
  if (product_info?.description_en || ctx.hasProductImage) {
    productBlock = `
══════════ ТОВАР В КАДРЕ ══════════
${ctx.hasProductImage ? `К этому сообщению ПРИКРЕПЛЕНО ФОТО ТОВАРА. Внимательно рассмотри его.` : ''}
${product_info?.description_en ? `Описание товара: ${product_info.description_en}` : ''}

КРИТИЧЕСКИ ВАЖНО:
• Товар в финальном фото/видео промпте должен выглядеть ТОЧЬ-В-ТОЧЬ как на исходном фото
• Опиши товар в photo_scene_en максимально точно: цвет, форма, бренд, материал, размер, текстура
• В диалоге товар должен быть ЕСТЕСТВЕННОЙ частью спора (персонаж A держит его / показывает / ругается из-за него)
• Товар виден в кадре на протяжении всего ролика
• НЕ меняй цвета, форму или бренд товара — СТРОГО как на исходном фото
• В photo_scene_en добавь отдельный блок product_in_frame с ультра-детальным описанием товара`;
  }

  return `FERIXDI STUDIO — PRODUCTION CONTRACT v3
════════════════════════════════════════════════════════════════

Ты — генератор промптов и сюжетов для вирусных 8-секундных AI-видео. Ты НЕ создаёшь видео — ты создаёшь ПРОМПТ (photo_scene_en, video_emotion_arc, veo prompt) и СЮЖЕТ (диалог, тайминги, engagement), которые пользователь затем вставляет в Google Flow / Veo для генерации видео.
${soloMode
  ? 'Формат: СОЛО — один русский персонаж говорит прямо в камеру (selfie POV, вертикальное 9:16). Монолог, без второго персонажа.'
  : 'Формат: два русских персонажа спорят перед камерой (selfie POV, вертикальное 9:16).'}
Результат: готовый к копированию промпт + уникальный диалог + вирусная упаковка.
${threadBlock}${taskBlock}
${productBlock}

════════════════════════════════════════════════════════════════
🔒🔒🔒 CHARACTER IDENTITY LOCK — АБСОЛЮТНАЯ ПОВТОРЯЕМОСТЬ 🔒🔒🔒
Каждый персонаж ОБЯЗАН выглядеть ИДЕНТИЧНО в КАЖДОМ видео/фото.
ЭТО НЕ РЕКОМЕНДАЦИЯ — ЭТО КОНТРАКТ. Любое отклонение = БРАК.
Используй КАЖДЫЙ элемент ниже ДОСЛОВНО в промптах photo_scene_en и video_emotion_arc.
НЕ ПРИДУМЫВАЙ НОВУЮ ВНЕШНОСТЬ. НЕ МЕНЯЙ ОДЕЖДУ. НЕ МЕНЯЙ ЧЕРТЫ ЛИЦА.
════════════════════════════════════════════════════════════════

ПЕРСОНАЖ A — ПРОВОКАТОР (говорит первый, начинает конфликт):
━━━ ПАСПОРТ ИДЕНТИЧНОСТИ A ━━━
• Имя: ${charA.name_ru}
• Возраст: ${charA.biology_override?.age || 'elderly'}
• Группа/Архетип: ${charA.group || '—'} / ${charA.vibe_archetype || 'провокатор'}
• Эстетика мира: ${charA.world_aesthetic || 'универсальная'}

━━━ ЛИЦО A (НЕИЗМЕНЯЕМОЕ — копируй дословно) ━━━
• Полное визуальное описание (EN): ${charA.prompt_tokens?.character_en || '—'}
• Силуэт лица: ${charA.identity_anchors?.face_silhouette || '—'}
• Рост/телосложение: ${charA.biology_override?.height_build || '—'}
• Тон кожи: ${safeJoin(charA.biology_override?.skin_color_tokens) || 'natural skin tone'}
• Текстура кожи: ${safeJoin(charA.biology_override?.skin_tokens) || 'age-appropriate skin'}
• Карта морщин: ${safeJoin(charA.biology_override?.wrinkle_map_tokens) || 'age-appropriate'}
• Глаза: ${safeJoin(charA.biology_override?.eye_tokens) || '—'}
• Волосы: ${safeJoin(charA.biology_override?.hair_tokens) || '—'}
• Растительность на лице: ${safeJoin(charA.biology_override?.facial_hair_tokens) || 'none'}
• Нос: ${safeJoin(charA.biology_override?.nose_tokens) || '—'}
• Рот/зубы: ${safeJoin(charA.biology_override?.mouth_tokens) || '—'}
• Уши: ${safeJoin(charA.biology_override?.ear_tokens) || 'natural ears'}
• Шея: ${safeJoin(charA.biology_override?.neck_tokens) || 'age-appropriate neck'}
• Форма тела: ${safeJoin(charA.biology_override?.body_shape_tokens) || '—'}
• Руки: ${safeJoin(charA.biology_override?.hands_tokens) || '—'}
• Шрамы/родинки/тату: ${safeJoin(charA.biology_override?.scar_mark_tokens) || 'none visible'}
• Осанка/поза: ${safeJoin(charA.biology_override?.posture_tokens) || '—'}
• Походка/движения: ${safeJoin(charA.biology_override?.gait_tokens) || 'natural movement'}
• Лицо в покое: ${charA.biology_override?.facial_expression_default || 'neutral'}
• Тембр голоса: ${safeJoin(charA.biology_override?.voice_texture_tokens) || 'natural voice'}
• Челюсть: ${safeJoin(charA.biology_override?.jaw_tokens) || 'age-appropriate jaw'}
• Скулы: ${safeJoin(charA.biology_override?.cheekbone_tokens) || 'natural cheekbones'}
• Лоб: ${safeJoin(charA.biology_override?.forehead_tokens) || 'age-appropriate forehead'}
• Брови: ${safeJoin(charA.biology_override?.eyebrow_tokens) || 'natural eyebrows'}
• Текстура губ: ${safeJoin(charA.biology_override?.lip_texture_tokens) || 'age-appropriate lips'}
• Подбородок: ${safeJoin(charA.biology_override?.chin_tokens) || 'natural chin'}
• Носогубные складки: ${safeJoin(charA.biology_override?.nasolabial_tokens) || 'age-appropriate'}
• Под глазами: ${safeJoin(charA.biology_override?.undereye_tokens) || 'natural under-eye'}
• Плечи: ${safeJoin(charA.biology_override?.shoulder_tokens) || 'natural shoulders'}
• Зубы: ${safeJoin(charA.biology_override?.teeth_tokens) || 'age-appropriate teeth'}
• Ресницы: ${safeJoin(charA.biology_override?.eyelash_tokens) || 'natural lashes'}

━━━ ГАРДЕРОБ A (НЕИЗМЕНЯЕМЫЙ — один и тот же в каждом видео) ━━━
• Якорный гардероб: ${charA.identity_anchors?.wardrobe_anchor || wardrobeA}
• Фирменный элемент: ${charA.identity_anchors?.signature_element || '—'}
• Аксессуары: ${safeJoin(charA.identity_anchors?.accessory_anchors) || '—'}
• Обувь: ${charA.identity_anchors?.footwear_anchor || '—'}
• Головной убор: ${charA.identity_anchors?.headwear_anchor || 'none'}
• Цветовая палитра: ${safeJoin(charA.identity_anchors?.color_palette) || '—'}
• Украшения: ${charA.identity_anchors?.jewelry_anchors || 'none'}
• Очки: ${charA.identity_anchors?.glasses_anchor || 'none'}
• Ногти: ${charA.identity_anchors?.nail_style_anchor || 'natural'}
• Текстура ткани: ${charA.identity_anchors?.fabric_texture_anchor || 'natural fabric'}
• Узор одежды: ${charA.identity_anchors?.pattern_anchor || 'solid color'}
• Рукава: ${charA.identity_anchors?.sleeve_style_anchor || 'long sleeves'}
${charA.identity_anchors?.negative_hint_tokens?.length ? `• ⚠️ ЗАПРЕЩЕНО для A — никогда не добавляй: ${safeJoin(charA.identity_anchors.negative_hint_tokens)}` : ''}

━━━ ПОВЕДЕНИЕ A (визуальные маркеры) ━━━
• Внешность (RU): ${charA.appearance_ru || 'elderly Russian character'}
• Характер (RU): ${charA.behavior_ru || '—'}
• Слоган: ${charA.tagline_ru || '—'}
• Микрожест (повторяемый): ${charA.identity_anchors?.micro_gesture || '—'}
• Поведение при молчании: ${charA.modifiers?.listening_behavior || 'arms crossed, judgmental stare, occasional eye roll'}
• Подача юмора: ${charA.modifiers?.humor_delivery || 'explosive — шутит громко и в лоб'}
• Отношение к камере: ${charA.modifiers?.camera_relationship || 'breaks 4th wall — обращается прямо к зрителю'}
• Стиль хука (кадр 0): ${charA.modifiers?.hook_style || 'attention grab'}
• Стиль смеха: ${charA.modifiers?.laugh_style || 'natural'}
• Выражение злости: ${charA.modifiers?.anger_expression || 'natural anger'}
• Выражение задумчивости: ${charA.modifiers?.thinking_expression || 'natural thinking'}
• Выражение удивления: ${charA.modifiers?.surprise_expression || 'natural surprise'}
• Контакт глазами: ${charA.modifiers?.eye_contact_style || 'direct'}
• Грусть: ${charA.modifiers?.sad_expression || 'natural sadness'}
• Презрение: ${charA.modifiers?.contempt_expression || 'subtle contempt'}
• Отвращение: ${charA.modifiers?.disgust_expression || 'natural disgust'}
• Радость: ${charA.modifiers?.joy_expression || 'genuine joy'}
• Паттерн моргания: ${charA.modifiers?.blink_pattern || 'normal blink rate'}
• Нервная привычка: ${charA.modifiers?.fidget_style || 'minimal fidgeting'}

━━━ РЕЧЬ A (НЕИЗМЕНЯЕМАЯ — каждая реплика ОБЯЗАНА звучать как ЭТОТ персонаж) ━━━
• Стиль речи: ${charA.speech_style_ru || 'expressive'}
• Темп: ${charA.speech_pace || 'normal'} | Мат: ${charA.swear_level || 0}/3
• Фирменные слова: ${safeJoin(charA.signature_words_ru, ' / ') || '—'}
• Уровень лексики: ${charA.speech_identity?.vocabulary_level || 'простой бытовой'}
• Структура предложений: ${charA.speech_identity?.sentence_structure || 'короткие рубленые фразы'}
• Слова-паразиты: ${safeJoin(charA.speech_identity?.filler_words) || 'нет'}
• Реакционные звуки: ${safeJoin(charA.speech_identity?.reaction_sounds) || 'естественные'}
• Акцентирование: ${charA.speech_identity?.emphasis_pattern || 'повтор ключевого слова'}
• Стиль вопросов: ${charA.speech_identity?.question_style || 'риторические обвинительные'}
• Стиль перебивания: ${charA.speech_identity?.interruption_style || 'врывается не дослушав'}
• Диалектные маркеры: ${charA.speech_identity?.dialect_markers || 'нет выраженного диалекта'}
• Эмоциональная эскалация: ${charA.speech_identity?.emotional_escalation || 'быстрая — от 0 до 100 за секунду'}

ПЕРСОНАЖ B — ПАНЧЛАЙН (отвечает разрушительным ответом):
━━━ ПАСПОРТ ИДЕНТИЧНОСТИ B ━━━
• Имя: ${charB.name_ru}
• Возраст: ${charB.biology_override?.age || 'elderly'}
• Группа/Архетип: ${charB.group || '—'} / ${charB.vibe_archetype || 'база'}
• Эстетика мира: ${charB.world_aesthetic || 'универсальная'}

━━━ ЛИЦО B (НЕИЗМЕНЯЕМОЕ — копируй дословно) ━━━
• Полное визуальное описание (EN): ${charB.prompt_tokens?.character_en || '—'}
• Силуэт лица: ${charB.identity_anchors?.face_silhouette || '—'}
• Рост/телосложение: ${charB.biology_override?.height_build || '—'}
• Тон кожи: ${safeJoin(charB.biology_override?.skin_color_tokens) || 'natural skin tone'}
• Текстура кожи: ${safeJoin(charB.biology_override?.skin_tokens) || 'age-appropriate skin'}
• Карта морщин: ${safeJoin(charB.biology_override?.wrinkle_map_tokens) || 'age-appropriate'}
• Глаза: ${safeJoin(charB.biology_override?.eye_tokens) || '—'}
• Волосы: ${safeJoin(charB.biology_override?.hair_tokens) || '—'}
• Растительность на лице: ${safeJoin(charB.biology_override?.facial_hair_tokens) || 'none'}
• Нос: ${safeJoin(charB.biology_override?.nose_tokens) || '—'}
• Рот/зубы: ${safeJoin(charB.biology_override?.mouth_tokens) || '—'}
• Уши: ${safeJoin(charB.biology_override?.ear_tokens) || 'natural ears'}
• Шея: ${safeJoin(charB.biology_override?.neck_tokens) || 'age-appropriate neck'}
• Форма тела: ${safeJoin(charB.biology_override?.body_shape_tokens) || '—'}
• Руки: ${safeJoin(charB.biology_override?.hands_tokens) || '—'}
• Шрамы/родинки/тату: ${safeJoin(charB.biology_override?.scar_mark_tokens) || 'none visible'}
• Осанка/поза: ${safeJoin(charB.biology_override?.posture_tokens) || '—'}
• Походка/движения: ${safeJoin(charB.biology_override?.gait_tokens) || 'natural movement'}
• Лицо в покое: ${charB.biology_override?.facial_expression_default || 'neutral'}
• Тембр голоса: ${safeJoin(charB.biology_override?.voice_texture_tokens) || 'natural voice'}
• Челюсть: ${safeJoin(charB.biology_override?.jaw_tokens) || 'age-appropriate jaw'}
• Скулы: ${safeJoin(charB.biology_override?.cheekbone_tokens) || 'natural cheekbones'}
• Лоб: ${safeJoin(charB.biology_override?.forehead_tokens) || 'age-appropriate forehead'}
• Брови: ${safeJoin(charB.biology_override?.eyebrow_tokens) || 'natural eyebrows'}
• Текстура губ: ${safeJoin(charB.biology_override?.lip_texture_tokens) || 'age-appropriate lips'}
• Подбородок: ${safeJoin(charB.biology_override?.chin_tokens) || 'natural chin'}
• Носогубные складки: ${safeJoin(charB.biology_override?.nasolabial_tokens) || 'age-appropriate'}
• Под глазами: ${safeJoin(charB.biology_override?.undereye_tokens) || 'natural under-eye'}
• Плечи: ${safeJoin(charB.biology_override?.shoulder_tokens) || 'natural shoulders'}
• Зубы: ${safeJoin(charB.biology_override?.teeth_tokens) || 'age-appropriate teeth'}
• Ресницы: ${safeJoin(charB.biology_override?.eyelash_tokens) || 'natural lashes'}

━━━ ГАРДЕРОБ B (НЕИЗМЕНЯЕМЫЙ — один и тот же в каждом видео) ━━━
• Якорный гардероб: ${charB.identity_anchors?.wardrobe_anchor || wardrobeB}
• Фирменный элемент: ${charB.identity_anchors?.signature_element || '—'}
• Аксессуары: ${safeJoin(charB.identity_anchors?.accessory_anchors) || '—'}
• Обувь: ${charB.identity_anchors?.footwear_anchor || '—'}
• Головной убор: ${charB.identity_anchors?.headwear_anchor || 'none'}
• Цветовая палитра: ${safeJoin(charB.identity_anchors?.color_palette) || '—'}
• Украшения: ${charB.identity_anchors?.jewelry_anchors || 'none'}
• Очки: ${charB.identity_anchors?.glasses_anchor || 'none'}
• Ногти: ${charB.identity_anchors?.nail_style_anchor || 'natural'}
• Текстура ткани: ${charB.identity_anchors?.fabric_texture_anchor || 'natural fabric'}
• Узор одежды: ${charB.identity_anchors?.pattern_anchor || 'solid color'}
• Рукава: ${charB.identity_anchors?.sleeve_style_anchor || 'long sleeves'}
${charB.identity_anchors?.negative_hint_tokens?.length ? `• ⚠️ ЗАПРЕЩЕНО для B — никогда не добавляй: ${safeJoin(charB.identity_anchors.negative_hint_tokens)}` : ''}

━━━ ПОВЕДЕНИЕ B (визуальные маркеры) ━━━
• Внешность (RU): ${charB.appearance_ru || 'elderly Russian character'}
• Характер (RU): ${charB.behavior_ru || '—'}
• Слоган: ${charB.tagline_ru || '—'}
• Микрожест (повторяемый): ${charB.identity_anchors?.micro_gesture || '—'}
• Поведение при молчании: ${charB.modifiers?.listening_behavior || 'stone-faced silence, arms crossed, slow disapproving nod'}
• Подача юмора: ${charB.modifiers?.humor_delivery || 'deadpan — бьёт одной фразой без эмоций'}
• Отношение к камере: ${charB.modifiers?.camera_relationship || 'occasional glance — изредка бросает взгляд в камеру'}
• Стиль хука (кадр 0): ${charB.modifiers?.hook_style || 'quiet entrance'}
• Стиль смеха: ${charB.modifiers?.laugh_style || 'quiet chuckle'}
• Выражение злости: ${charB.modifiers?.anger_expression || 'natural anger'}
• Выражение задумчивости: ${charB.modifiers?.thinking_expression || 'natural thinking'}
• Выражение удивления: ${charB.modifiers?.surprise_expression || 'natural surprise'}
• Контакт глазами: ${charB.modifiers?.eye_contact_style || 'direct'}
• Грусть: ${charB.modifiers?.sad_expression || 'natural sadness'}
• Презрение: ${charB.modifiers?.contempt_expression || 'subtle contempt'}
• Отвращение: ${charB.modifiers?.disgust_expression || 'natural disgust'}
• Радость: ${charB.modifiers?.joy_expression || 'genuine joy'}
• Паттерн моргания: ${charB.modifiers?.blink_pattern || 'normal blink rate'}
• Нервная привычка: ${charB.modifiers?.fidget_style || 'minimal fidgeting'}

━━━ РЕЧЬ B (НЕИЗМЕНЯЕМАЯ — каждая реплика ОБЯЗАНА звучать как ЭТОТ персонаж) ━━━
• Стиль речи: ${charB.speech_style_ru || 'measured'}
• Темп: ${charB.speech_pace || 'normal'} | Мат: ${charB.swear_level || 0}/3
• Фирменные слова: ${safeJoin(charB.signature_words_ru, ' / ') || '—'}
• Уровень лексики: ${charB.speech_identity?.vocabulary_level || 'простой бытовой'}
• Структура предложений: ${charB.speech_identity?.sentence_structure || 'короткие весомые фразы с паузой перед ударным словом'}
• Слова-паразиты: ${safeJoin(charB.speech_identity?.filler_words) || 'нет'}
• Реакционные звуки: ${safeJoin(charB.speech_identity?.reaction_sounds) || 'естественные'}
• Акцентирование: ${charB.speech_identity?.emphasis_pattern || 'пауза перед ключевым словом'}
• Стиль вопросов: ${charB.speech_identity?.question_style || 'утвердительные с подтекстом'}
• Стиль перебивания: ${charB.speech_identity?.interruption_style || 'ждёт конца, потом бьёт одной фразой'}
• Диалектные маркеры: ${charB.speech_identity?.dialect_markers || 'нет выраженного диалекта'}
• Эмоциональная эскалация: ${charB.speech_identity?.emotional_escalation || 'медленная — копит и выдаёт одним ударом'}

════════════════════════════════════════════════════════════════
🔒 ПРАВИЛА IDENTITY LOCK (нарушение = БРАК):
1. В photo_scene_en И remake_veo_prompt_en ОБЯЗАТЕЛЬНО включи ДОСЛОВНО character_en описание КАЖДОГО персонажа — НЕ пересказывай, НЕ сокращай, копируй как есть
2. В photo_scene_en И remake_veo_prompt_en ОБЯЗАТЕЛЬНО включи wardrobe_anchor КАЖДОГО персонажа — ТОЧНАЯ одежда, ТОЧНЫЕ цвета, ТОЧНЫЕ материалы. ЗАПРЕЩЕНО менять одежду персонажа на одежду из оригинального видео — персонаж всегда в СВОЕЙ фирменной одежде
3. В photo_scene_en И remake_veo_prompt_en ОБЯЗАТЕЛЬНО включи signature_element КАЖДОГО персонажа — ЭТО то что зритель узнаёт персонажа
4. В video_emotion_arc.hook_en ОБЯЗАТЕЛЬНО используй hook_style персонажа A ДОСЛОВНО — это ЕГО фирменный способ захватить внимание. Также используй micro_gesture в act_A и act_B
5. ЗАПРЕЩЕНО менять: цвет волос, цвет глаз, форму носа, одежду, аксессуары, татуировки, шрамы, пирсинг
6. ЗАПРЕЩЕНО: добавлять аксессуары которых нет в описании, убирать аксессуары которые есть, менять стиль одежды
7. Если у персонажа есть уникальная черта (золотой зуб, повязка на глазу, татуировка, трость) — она ОБЯЗАНА быть в КАЖДОМ кадре
8. ВСЕ ТОКЕНЫ ИЗ СЕКЦИИ «ЛИЦО» — КОПИРУЙ ДОСЛОВНО в photo_scene_en И в remake_veo_prompt_en (блок персонажей). Это ПОЛНЫЙ ПАСПОРТ ЛИЦА: skin_tokens, skin_color_tokens, eye_tokens, hair_tokens, nose_tokens, mouth_tokens, jaw_tokens, cheekbone_tokens, forehead_tokens, eyebrow_tokens, lip_texture_tokens, chin_tokens, nasolabial_tokens, undereye_tokens, teeth_tokens, eyelash_tokens, ear_tokens, neck_tokens, shoulder_tokens, wrinkle_map_tokens. ПРОПУСТИЛ ХОТЬ ОДИН — лицо в следующем ролике будет ДРУГИМ = БРАК. Копируй КАЖДЫЙ токен КАК ЕСТЬ, не перефразируй, не обобщай
9. Face_silhouette — ГЕОМЕТРИЧЕСКИЙ КАРКАС лица: форма овала, скулы, подбородок, пропорции. Копируй ДОСЛОВНО — на него ложатся все остальные черты. БЕЗ него AI каждый раз создаёт ДРУГУЮ форму лица
10. FACE COMPOSITE BLOCK: В photo_scene_en И remake_veo_prompt_en для КАЖДОГО персонажа ОБЯЗАН быть ЕДИНЫЙ блок описания лица. Собери его из ВСЕХ biology tokens в порядке: face_silhouette → skin_color → eye → eyebrow → nose → mouth+lips+teeth → jaw+chin → cheekbone → forehead → nasolabial → undereye → hair → ear. Этот блок ИДЕНТИЧЕН в каждом ролике — это ЛИЦО персонажа
11. Wardrobe НИКОГДА не меняется между эпизодами — это УНИФОРМА персонажа. В REMAKE режиме ЗАПРЕЩЕНО одевать персонажа в одежду людей из оригинального видео — персонаж приходит в СВОЮ одежду в любую сцену
12. ХУК (кадр 0): photo_scene_en и hook_en ОБЯЗАНЫ показывать hook_style персонажа A ДОСЛОВНО. Это НЕ рекомендация — это КОНТРАКТ. Если hook_style = 'finger jab at camera' — в кадре 0 ОБЯЗАН быть палец в камеру

🗣 РЕЧЕВОЙ IDENTITY LOCK (нарушение = БРАК):
13. КАЖДАЯ реплика dialogue_A_ru ОБЯЗАНА соответствовать speech_identity A: его лексика, структура предложений, слова-паразиты, диалектные маркеры, стиль вопросов. Если A тараторит — предложения короткие рубленые. Если A тянет слова — длинные с паузами.
14. КАЖДАЯ реплика dialogue_B_ru ОБЯЗАНА соответствовать speech_identity B: его лексика, ритм, эмоциональная эскалация. Если B ждёт и бьёт одной фразой — так и должно быть. Если B перебивает — реплика должна звучать как перебивание.
15. signature_words_ru — фирменные фразы персонажа. В КАЖДОЙ генерации хотя бы ОДНО signature_word ОДНОГО из персонажей ДОЛЖНО появиться в диалоге (не обязательно оба, но хотя бы одно). Это то, по чему зритель УЗНАЁТ персонажа на слух.
16. ЗАПРЕЩЕНО: писать одинаковым стилем за разных персонажей. A и B ОБЯЗАНЫ звучать КОНТРАСТНО — разный ритм, разная лексика, разная энергия. Если оба звучат одинаково — БРАК.
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
СЦЕНА:
• Категория юмора: ТЫ ОПРЕДЕЛЯЕШЬ САМ. Придумай короткую (2-4 слова) категорию которая ТОЧНО описывает суть ролика. Примеры: «Кухонные войны», «Технофобия», «Дачный абсурд», «Свекровь атакует», «Пенсионер vs прогресс». НЕ используй стандартные — придумай СВОЮ, уникальную для этого контента.
• Локация: ${location}
• Освещение: ${lightingMood.style} | Настроение: ${lightingMood.mood}
• Источники: ${lightingMood.sources || '1 dominant + 1 fill'} | Направление: ${lightingMood.direction || 'environmental'}
• Тени: ${lightingMood.shadow_softness || 'soft present'} | Пересвет: ${lightingMood.overexposure_budget || '+0.5 EV on skin'}
• Цветовая температура: ${lightingMood.color_temp || 'locked to source'}
• Реквизит в кадре: ${propAnchor}
• Эстетика мира: ${aesthetic}
${scene_hint ? `
⚠️⚠️⚠️ ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ — АБСОЛЮТНЫЙ ПРИОРИТЕТ ⚠️⚠️⚠️
Пользователь написал: "${scene_hint}"
ЭТА ИНСТРУКЦИЯ ИМЕЕТ ВЫСШИЙ ПРИОРИТЕТ НАД ВСЕМИ ДЕФОЛТАМИ НИЖЕ.
Если пользователь указал:
• «без смеха» / «серьёзно» / «не смеяться» → в release_en НЕ ДОЛЖНО БЫТЬ смеха, хохота, улыбок. Финал = указанная пользователем реакция (шок / немая сцена / уход / злость и т.д.)
• поведение для конкретного персонажа (напр. «A серьёзный», «B злой», «A плачет») → ОБЯЗАТЕЛЬНО следуй этому поведению для ЭТОГО персонажа во ВСЕХ сегментах (hook, act, release)
• конкретные действия (напр. «A бьёт по столу», «B уходит») → включи эти действия в video_emotion_arc
• настроение (напр. «драматично», «грустно», «агрессивно») → ВСЁ видео в этом настроении, НЕ переключайся на юмор
ЗАПРЕЩЕНО игнорировать инструкцию пользователя. Если написано «без смеха» — значит БЕЗ СМЕХА в release_en, video_emotion_arc, video_atmosphere_en.
` : ''}
${cinematography ? `
════════════════════════════════════════════════════════════════
CINEMATOGRAPHY CONTRACT — 12 PRODUCTION PILLARS (обязательно учитывай при создании промптов):
Главный принцип: всё должно выглядеть как РЕАЛЬНОЕ селфи-видео со смартфона, не кино, не студия, не DSLR.

1. СВЕТ: ${cinematography.lighting?.source_count || 'One dominant + one fill'}.
   Направление: ${cinematography.lighting?.source_direction || 'Environmental key + wall bounce fill'}.
   Тени: ${cinematography.lighting?.shadow_quality || 'Soft present shadows under nose/cheekbones'}.
   Пересвет: ${cinematography.lighting?.skin_highlights || 'Allow +0.5 EV on skin highlights — phone sensor clipping'}.
   Температура: ${cinematography.lighting?.color_temperature || 'Lock to dominant source'}.
   Смартфон: ${cinematography.lighting?.smartphone_behavior || 'Auto-exposure targets faces, background may clip'}.
   ЗАПРЕТ: ${cinematography.lighting?.forbidden || 'No ring light, no flat frontal, no studio rim light'}.

2. ОПТИКА (фронтальная камера телефона):
   Фокусное: ${cinematography.optics?.focal_length || '24-28mm equiv (phone front camera)'}.
   Диафрагма: ${cinematography.optics?.aperture || 'f/1.9-2.2 + computational portrait bokeh'}.
   Глубина резкости: ${cinematography.optics?.depth_of_field || 'Both faces sharp, bg via computational blur'}.
   Дистанция: ${cinematography.optics?.distance_to_subject || '35-60cm selfie distance'}.
   Сенсор: ${cinematography.optics?.sensor_signature || 'Noise in shadows ISO 400-1600, JPEG artifacts, limited DR'}.
   Дефекты линзы: ${cinematography.optics?.lens_flaws || 'Slight purple fringing on backlit edges, minor CA in corners'}.
   Серийный стиль: ${cinematography.optics?.series_lock || 'Same phone-camera look every episode'}.

3. КАМЕРА (телефон в руке):
   База: ${cinematography.camera_movement?.base_motion || 'Micro-jitter 0.8-2px at 2-5Hz, hand tremor + breathing'}.
   Дыхание держащего: ${cinematography.camera_movement?.breathing_oscillation || '0.3-0.5px vertical at 0.25Hz'}.
   Hook: ${cinematography.camera_movement?.hook_motion || 'push-in + grip adjust'}.
   Act A: ${cinematography.camera_movement?.act_A_motion || 'drift toward speaker'}.
   Act B: ${cinematography.camera_movement?.act_B_motion || 'reframe toward B, brief AF hunt'}.
   Release: ${cinematography.camera_movement?.release_motion || 'laughter shake 3-6px, phone tilt 5-8°'}.
   OIS/EIS: ${cinematography.camera_movement?.stabilization_artifacts || 'Jello wobble on fast moves, rolling shutter lean'}.
   ЗАПРЕТ: ${cinematography.camera_movement?.forbidden || 'No dolly, no crane, no gimbal, no tripod'}.

4. МИКРОДВИЖЕНИЯ (ключ к живости):
   Моргание: ${cinematography.micro_movements?.blink_rate || 'Every 3-5s baseline, 2-3s during speech'}.
   Дыхание: ${cinematography.micro_movements?.breathing || 'Chest rise 3-4s, inhale between phrases'}.
   Голова: ${cinematography.micro_movements?.head_micro_turns || '1-3° tilts 2-4s, speaker animated 5-10°'}.
   Мимика: ${cinematography.micro_movements?.facial_micro_expressions || 'Eyebrow raise, nostril flare, jaw clench — every 1-2s, involuntary, asymmetric'}.
   Тело: ${cinematography.micro_movements?.weight_shifts || 'Weight shift 4-6s, shoulder adjust, clothing responds'}.
   Руки: ${cinematography.micro_movements?.hand_micro_movements || 'Hands never frozen: gesturing/fidgeting, min 1 movement per 3-5s'}.
   Асимметрия: ${cinematography.micro_movements?.asymmetry_rule || 'Left/right move independently, symmetry = fake'}.
   ЗАПРЕТ: ${cinematography.micro_movements?.forbidden || 'No mannequin freeze >1.5s, no puppet twitching'}.

5. СТАБИЛЬНОСТЬ ЛИЦА/ГУБ:
   Рот: ${cinematography.face_stability?.mouth_visibility || 'Visible 100%, never obstructed'}.
   Поворот яв: ${cinematography.face_stability?.head_rotation_limit || 'Max 25°, 15° during speech'}.
   Наклон: ${cinematography.face_stability?.head_tilt_limit || 'Max 10° roll, 15° pitch, combined <30°'}.
   Волосы: ${cinematography.face_stability?.hair_and_accessories || 'Nothing covering lips at any point'}.
   Челюсть: ${cinematography.face_stability?.jaw_tracking || 'Every syllable = jaw movement, consonants = lip closure'}.
   Молчание: ${cinematography.face_stability?.non_speaking_mouth || 'Sealed lips, jaw immobile, no phantom movements'}.
   AF: ${cinematography.face_stability?.front_camera_face_lock || 'Phone face-tracking AF keeps face sharpest, 50-100ms lag'}.
   ЗАПРЕТ: ${cinematography.face_stability?.forbidden || 'No hand over mouth >0.3s, no hair covering lips, no head turn >25°, no phantom mouth movements when not speaking'}.

6. ГЛАЗА И ВЗГЛЯД (по таймингу):
   Hook 0-0.7с: ${cinematography.gaze?.hook_gaze || 'A → direct camera eye contact, stop-scroll stare'}.
   Act A 0.7-3.5с: ${cinematography.gaze?.act_A_gaze || 'A 70% camera 30% B; B MOUTH CLOSED, side-eye tracking A'}.
   Act B 3.5-7.0с: ${cinematography.gaze?.act_B_gaze || 'B 80% camera, KW≈6.8s; A MOUTH CLOSED, eyes widen, dart between B and camera'}.
   Release 7.0-8.0с: ${cinematography.gaze?.release_gaze || 'Both look at each other, raspy laugh, rewatch-bait 0.3s'}.
   Зрачки: ${cinematography.gaze?.pupil_detail || '3-5mm ALWAYS VISIBLE, round black pupil centered in iris, catch-light from source, wet sclera, detailed iris texture, BOTH pupils same size'}.
   Микросаккады: ${cinematography.gaze?.micro_saccades || 'Subtle 0.3-0.5° shifts every 1-2s — natural micro-movements, NOT jittery or darting'}.
   Фронталка: ${cinematography.gaze?.smartphone_eye_contact || 'Camera 2-5cm above screen; mix 60% lens contact + 40% screen look'}.
   ЗАПРЕТ: ${cinematography.gaze?.forbidden || 'No dead stare >2s, no cross-eyed, NO bulging eyes, NO all-white eyes without pupils, NO missing iris, NO missing pupils, NO rolled-back eyes, NO eyes popping out of sockets, NO asymmetric pupil sizes, NO vacant zombie stare, NO unnaturally wide-open eyes, pupils and iris MUST be visible at ALL times'}.

7. ЧИСТОТА КАДРА:
   Передний план: ${cinematography.frame_cleanliness?.foreground || '60-70% characters'}.
   Средний: ${cinematography.frame_cleanliness?.midground || '1 prop in computational bokeh'}.
   Фон: ${cinematography.frame_cleanliness?.background || '2-3 shapes in deep blur'}.
   Композиция: ${cinematography.frame_cleanliness?.headroom || '5-10% headroom, selfie framing'}. ${cinematography.frame_cleanliness?.aspect_ratio || '9:16 vertical'}.
   Бюджет: ${cinematography.frame_cleanliness?.detail_budget || '7 elements max'}.
   ЗАПРЕТ: ${cinematography.frame_cleanliness?.forbidden || 'ABSOLUTELY NO text overlays, NO subtitles, NO captions, NO letters/numbers on screen, NO REC badge, NO timestamp, NO timecode, NO frames, NO borders, NO watermarks, NO logos, NO UI elements, NO phones visible, NO graphic overlays of any kind. The image/video must be CLEAN — only the scene with characters, ZERO visual overlays'}.

8. ТЕКСТУРЫ (анти-AI сигнал):
   Приоритет: ${cinematography.textures?.texture_priority || 'Wool > denim > leather > corduroy > linen > cotton'}.
   Складки: ${cinematography.textures?.wrinkle_rule || 'Creases at elbows/shoulders/waist mandatory'}.
   Кожа: ${cinematography.textures?.skin_as_texture || 'Pores, fine lines, oiliness on T-zone, age marks'}.
   Волосы: ${cinematography.textures?.hair_texture || 'Individual strands at temples, flyaways in backlight'}.
   Поверхности: ${cinematography.textures?.surface_detail || 'Wood grain, paint chips, fabric weave in focus'}.
   ЗАПРЕТ: ${cinematography.textures?.forbidden || 'No plastic skin, no uniform color blocks, no smooth surfaces'}.

9. ЦВЕТ И КОЖА:
   WB: ${cinematography.color_skin?.white_balance || 'Lock to source temp, phone may lean +200K warm'}.
   Кожа A: ${cinematography.color_skin?.skin_tone_A || 'natural with zone variation'}.
   Кожа B: ${cinematography.color_skin?.skin_tone_B || 'natural with zone variation'}.
   Зоны лица: ${cinematography.color_skin?.skin_zones || '5+ color zones: forehead lighter, cheeks pinker, nose reddest, under-eye darker, chin neutral'}.
   Смертные грехи: ${cinematography.color_skin?.deadly_sins || 'NO orange tan, NO grey face, NO uniform tone'}.
   Грейд: ${cinematography.color_skin?.color_grade || 'Smartphone color: slightly warm, lifted shadows, 90-95% saturation'}.
   Консистентность: ${cinematography.color_skin?.consistency || 'Identical skin tone all 8 seconds'}.
   ЗАПРЕТ: ${cinematography.color_skin?.forbidden || 'NO orange spray-tan, NO grey/blue lifeless face, NO uniform plastic skin tone, NO beauty filter, NO skin smoothing, NO Instagram filter look'}.

10. ЗВУК (якорь реальности, микрофон телефона):
   Фон: ${cinematography.sound_anchor?.room_tone || 'Mandatory room tone -20/-30dB'}.
   Голос: ${cinematography.sound_anchor?.voice_volume || '-6/-3dB peak, natural dynamics ±6dB'}.
   Проксимити: ${cinematography.sound_anchor?.voice_proximity || 'Phone mic 35-60cm, room coloring, plosive pops, sibilant harshness'}.
   Реверб: ${cinematography.sound_anchor?.voice_room_match || 'RT60 matches space: kitchen 0.3-0.5s, outdoor <0.1s, stairwell 1.0-1.5s'}.
   Дыхание: ${cinematography.sound_anchor?.breathing_sounds || 'Inhale before each turn, nose exhale from listener'}.
   Фоли: ${cinematography.sound_anchor?.cloth_and_foley || 'Fabric rustle on every movement, chair creak, prop sounds'}.
   Смех: ${cinematography.sound_anchor?.laugh_audio || '20-30% louder, phone mic distortion on peaks'}.
   Рот: ${cinematography.sound_anchor?.mouth_sounds || 'Saliva clicks on т/к/п/д, lip smack, tongue contact on л/н'}.
   ЗАПРЕТ: ${cinematography.sound_anchor?.forbidden || 'No silence, no studio voice, no uniform volume'}.

11. ХУК (кадр 0 — визуальный, НЕ текстовый):
   Эмоция: ${cinematography.visual_hook?.face_emotion || 'EXTREME emotion from FRAME 0'}.
   Взгляд: ${cinematography.visual_hook?.gaze_hook || 'Direct eye contact with camera from frame 1'}.
   Композиция: ${cinematography.visual_hook?.composition_hook || 'Both faces visible, no fade-in, scene already happening'}.
   Энергия: ${cinematography.visual_hook?.energy_level || 'Frame 1 energy ≥ 80% of peak'}.
   ЗАПРЕТ: ${cinematography.visual_hook?.forbidden || 'No text hook, no text on screen, no subtitles, no title cards, no slow buildup, no fade-in, no black frame, no text overlay of any kind'}.

12. МОНТАЖНАЯ ЛОГИКА (один дубль, внутренний ритм):
   Старт: ${cinematography.edit_logic?.start || 'Cold open mid-scene, argument already happening'}.
   Энергия: ${cinematography.edit_logic?.energy_curve || 'hook 80% → A 85-90% → dip 60% → B 90-95% → killer 100% → release 70%'}.
   Пауза: ${cinematography.edit_logic?.pre_punch_pause || '0.15-0.25s loaded silence before B'}.
   Killer: ${cinematography.edit_logic?.killer_delivery || 'Camera push, A freezes/widens eyes'}.
   Финал: ${cinematography.edit_logic?.end_on_reaction || 'End on REACTION, not punchline'}.
   Rewatch: ${cinematography.edit_logic?.rewatch_bait || 'Micro-expression in last 0.3-0.5s for rewatch discovery'}.
   Луп: ${cinematography.edit_logic?.loop_seam || 'Final frame energy compatible with frame 1 for auto-loop'}.
   ЗАПРЕТ: ${cinematography.edit_logic?.forbidden || 'No fade out, no setup, no dead air, no text overlays, no subtitles, no frames/borders, no REC badge, no timestamp on screen'}.
` : ''}
${soloMode ? `ТАЙМИНГ СОЛО (строго 8 секунд ±0.2s):
[0.00–0.70] ХУК — ${hookAction?.action_ru || 'визуальный хук'} (звук: ${hookAction?.audio || 'ambient'}). Без слов. Мгновенный стоп-скролл.
[0.70–7.00] МОНОЛОГ — ${charA.name_ru} говорит прямо в камеру. 15-30 слов, темп: ${charA.speech_pace || 'normal'}. Окно: 6.3с. Один персонаж, одна камера, прямой взгляд. KILLER WORD ≈ 6.8s.
[7.00–8.00] RELEASE — реакция/пауза/усмешка. НОЛЬ слов. Хриплый смех + rewatch-bait 0.3с.` : `👑 ЗОЛОТОЙ СТАНДАРТ 2026:
• ПЛАН: Medium Shot (средний план по пояс). НЕ «говорящие головы» в упор. Руки заняты реквизитом, устройство НЕВИДИМО.
• ВАЙБ: «Липкий» пафос, интенсивный взгляд в линзу, гипер-реализм (поры, родинки, морщины, пот).
• РЕАЛИЗМ: RAW-эстетика телефона (шум в тенях, пересветы, естественная тряска). Идеальный слоговой липсинк.
• ЗВУК: Минимум 2 микро-звука (скрип, щелчок, шелест) + клики слюны + вдохи.

ТАЙМИНГ (строго 8 секунд ±0.2s):
[0.00–0.70] ХУК — ${hookAction?.action_ru || 'визуальный хук'} (звук: ${hookAction?.audio || 'ambient'}). Без слов. Мгновенный «стоп-скролл»: удар предметом по линзе, резкий вдох или микро-экшен.
[0.70–3.50] AKT A — ${charA.name_ru} произносит провокацию. 8-15 слов (${charA.speech_pace === 'slow' ? 'макс 10 слов при медленном темпе' : charA.speech_pace === 'fast' ? 'до 15 слов при быстром темпе' : '10-13 слов оптимально'}), темп: ${charA.speech_pace}. Окно: 2.8с. B молчит: РОТ СТРОГО ЗАКРЫТ, только микро-мимика (side-eye, ноздри, бровь).
[3.50–7.00] AKT B — ${charB.name_ru} отвечает панчлайном. 8-18 слов (${charB.speech_pace === 'slow' ? 'макс 12 слов при медленном темпе' : charB.speech_pace === 'fast' ? 'до 18 слов при быстром темпе' : '12-15 слов оптимально'}), темп: ${charB.speech_pace}. Окно: 3.5с. KILLER WORD ≈ 6.8s. A — РОТ СТРОГО ЗАКРЫТ, замирает в пафосной позе.
[7.00–8.00] RELEASE — ${releaseAction?.action_ru || 'реакция'}. НОЛЬ слов. Общий заразительный «хриплый» смех. Тряска камеры. Rewatch-bait: микро-выражение в последние 0.3с.`}

════════════════════════════════════════════════════════════════
${remake_mode ? `⚠️⚠️⚠️ РЕЖИМ РЕМЕЙКА — ДИАЛОГ БЕРЁШЬ ИЗ ОРИГИНАЛА:
ТЫ ОБЯЗАН СОХРАНИТЬ ДИАЛОГ ИЗ ОРИГИНАЛЬНОГО ВИДЕО ПРАКТИЧЕСКИ ДОСЛОВНО.
ЗАПРЕЩЕНО придумывать новый диалог с нуля! Это РЕМЕЙК, не новый контент.

ПРАВИЛА РЕМЕЙКА ДИАЛОГА:
1. РАСШИФРУЙ каждое слово из оригинала — дословно, без пересказа
2. СОХРАНИ 85-95% слов из оригинала — основа неприкосновенна
3. ЧТО МОЖНО менять: имена/обращения, 1-3 слова для подгонки под стиль речи персонажа, добавить фирменное слово-паразит
4. ЧТО НЕЛЬЗЯ менять: ключевые фразы, панчлайны, killer word, смысл, структуру, порядок слов
5. Темп, паузы, эмоциональная кривая — КОПИРУЙ из оригинала
6. Если оригинальная фраза уже идеальна — НЕ ТРОГАЙ, верни как есть
7. Категорию юмора определи по СОДЕРЖАНИЮ оригинала, не придумывай новую
8. СТРУКТУРУ ДИАЛОГА КОПИРУЙ КАК ЕСТЬ: если в оригинале «вопрос → ответ → добивка» — так и делай. НЕ переделывай в стандартный формат. Количество реплик, порядок и кто говорит последним — КОПИРУЙ
9. ХАРИЗМА-АПГРЕЙД: один раз можешь усилить интонацию — добавить фирменный звук-реакцию персонажа (из reaction_sounds) или фирменное слово (из signature_words_ru) ЕСЛИ это не ломает оригинальный смысл. Например: оригинал «Ты чё?!» → если у персонажа есть signature_word «Господи» → «Господи, ты чё?!» — усилило, не сломало.

ПРИМЕР ПРАВИЛЬНОЙ АДАПТАЦИИ:
Оригинал: "Ты чё творишь?! Это же мой суп!"
Адаптация с харизмой: "Ну ты чё творишь-то?! Это ж мой суп!" (добавили «ну» + «то» под стиль речи)
НЕПРАВИЛЬНО: "Опять ты за своё! Суп мне испортила!" (полностью переписано — БРАК!)` : (input_mode === 'script' && script_ru) ? `⚠️⚠️⚠️ РЕЖИМ СВОЕГО ДИАЛОГА — ТЕКСТ ПОЛЬЗОВАТЕЛЯ НЕПРИКОСНОВЕНЕН:
ТЫ ОБЯЗАН ВЕРНУТЬ ДИАЛОГ ПОЛЬЗОВАТЕЛЯ СЛОВО В СЛОВО. ЗАПРЕЩЕНО МЕНЯТЬ, УЛУЧШАТЬ, ПЕРЕПИСЫВАТЬ.

АБСОЛЮТНЫЕ ПРАВИЛА:
1. dialogue_A_ru = ТОЧНАЯ КОПИЯ текста пользователя из раздела "ДИАЛОГ ПОЛЬЗОВАТЕЛЯ" выше
2. dialogue_B_ru = ТОЧНАЯ КОПИЯ текста пользователя из раздела "ДИАЛОГ ПОЛЬЗОВАТЕЛЯ" выше
3. ЗАПРЕЩЕНО: менять слова, переставлять слова, "улучшать" юмор, добавлять свои фразы
4. ЗАПРЕЩЕНО: придумывать НОВЫЙ диалог — пользователь УЖЕ написал свой
5. Единственное что ТЫ придумываешь: фото-промпт, видео-промпт, хештеги, заголовок, engagement — всё ПО ТЕМЕ диалога пользователя
6. Killer word = последнее ударное слово из ТЕКСТА ПОЛЬЗОВАТЕЛЯ
7. Если текст пользователя длиннее лимита — можешь НЕМНОГО сократить, сохранив ВСЕ ключевые слова и смысл

ТЕСТ: если dialogue_A_ru или dialogue_B_ru отличаются от того что написал пользователь больше чем на 1-2 слова — это БРАК.` : `⚠️⚠️⚠️ ГЛАВНОЕ ПРАВИЛО — ДИАЛОГ ПРИДУМЫВАЕШЬ ТОЛЬКО ТЫ:
ТЫ ОБЯЗАН ПРИДУМАТЬ ДИАЛОГ САМ С НУЛЯ. Не копируй примеры. Не используй шаблоны.
Твоя задача — написать ОРИГИНАЛЬНЫЕ, СМЕШНЫЕ реплики которые идеально подходят:
1. Под КОНКРЕТНЫХ персонажей (их характер, стиль речи, возраст, вайб)
2. Под КОНКРЕТНУЮ категорию юмора и тему
3. Под КОНКРЕТНУЮ идею пользователя (если указана)
Диалог должен быть НАСТОЛЬКО смешным, чтобы зритель пересмотрел видео 3 раза.
Если в данных есть примеры реплик — это ТОЛЬКО формат. НИКОГДА не копируй их.
Каждая генерация = уникальный свежий диалог. Повторы = провал.`}

${_dialogueRulesPrompt}

${remake_mode ? `ПРАВИЛА ФОТО-ПРОМПТА (photo_scene_en) — РЕЖИМ РЕМЕЙКА!
🚨🚨🚨 КРИТИЧНО: photo_scene_en = СТАРТОВЫЙ КАДР (frame 0) видео-ремейка. Пользователь генерирует ФОТО, затем ВИДЕО из этого фото.
• СКОПИРУЙ: место действия, композицию кадра, ракурс камеры, позы, действия, освещение ТОЧНО из оригинала
• ЗАМЕНИ: людей из оригинала на НАШИХ персонажей с ПОЛНЫМ identity lock (character_en + wardrobe_anchor + signature_element)
• Если в оригинале камера снимает со стороны (не selfie) — описывай камеру СО СТОРОНЫ, НЕ пиши "selfie POV"
• Если в оригинале спортивная площадка/зал/улица/трамвай — описывай ТУ ЖЕ локацию с теми же материалами и освещением
• Если в оригинале человек делает действие (подаёт мяч, танцует, бежит) — наш персонаж делает ТО ЖЕ действие
• ОДЕЖДА: персонажи в СВОЕЙ фирменной одежде (wardrobe_anchor) — ЗАПРЕЩЕНО копировать одежду из оригинала
• ЭНЕРГИЯ: передай то же настроение и эмоциональный заряд что в оригинале — через мимику наших персонажей
• ХАРИЗМА: используй signature_element и micro_gesture персонажа A в кадре 0 для максимальной узнаваемости
• Пиши на АНГЛИЙСКОМ, начинай с описания ТОЙ ЖЕ сцены что в оригинале` : `ПРАВИЛА ФОТО-ПРОМПТА (photo_scene_en) — ЭТО КАДР 0 ВИДЕО!
🚨🚨🚨 КРИТИЧНО: ФОТО = СТАРТОВЫЙ КАДР ВИДЕО. Пользователь сначала генерирует ФОТО по photo_scene_en, а потом генерирует ВИДЕО ИЗ ЭТОГО ФОТО (image-to-video). Поэтому photo_scene_en ОБЯЗАН описывать ТОЧНО ТОТ ЖЕ МОМЕНТ что и video_emotion_arc.hook_en (0.0-0.7с) — те же позы, те же выражения лиц, тот же ракурс камеры, та же энергия. Если фото и хук видео не совпадают — видео получится некогерентным!
• Пиши на АНГЛИЙСКОМ, начинай: "Smartphone medium shot photo capturing the EXACT HOOK MOMENT (frame 0, 0.0-0.7s) — the first frame from which the video will begin. Waist-up framing, device INVISIBLE."`}
• 200-280 слов, единый плотный абзац. МЕНЬШЕ 200 СЛОВ = БРАК — добавь: детали кожи персонажей, освещение на лицах, положение рук, выражение глаз, складки ткани, пропс.
• Камера: фронталка смартфона (24-28mm, f/1.9-2.2, маленький сенсор). НЕ DSLR, НЕ кинокамера!
• Формат: 9:16, 1080×1920, medium shot (по пояс)${remake_mode ? '' : ', устройство НЕВИДИМО, руки заняты реквизитом'}
• РЕКВИЗИТ В РУКЕ: тематический реквизит/пропс ОБЯЗАН быть ЧЁТКО В РУКЕ персонажа A — не на заднем плане, не на столе, а именно держит в руке. Реквизит создаёт нарратив и визуальный якорь (например: бабушка держит букет тюльпанов, а на фоне горящий Гелик).
• КИНЕМАТОГРАФИЧНЫЙ ФОН: опиши локацию максимально конкретно и визуально богато — не «kitchen» а «worn Soviet kitchen with humming Saratov fridge, yellowed peeling wallpaper, bare bulb overhead casting harsh shadows». Фон создаёт визуальный мир и контекст истории. Драматические детали окружения (дым, аварийные огни, хаос, разруха) усиливают зрелищность.
• КАЧЕСТВО: raw photo quality, maximum photographic detail — неотличимо от iPhone 15 Pro RAW photo.
• СИНХРОНИЗАЦИЯ С ВИДЕО: позы персонажей, выражения лиц, положение рук — ДОЛЖНЫ совпадать с описанием hook_en (0.0-0.7с). A уже начинает хук-действие (тот же жест что в hook_en), B уже реагирует глазами. Это НЕ случайный момент — это ТОЧНЫЙ стартовый кадр
• Сенсорные артефакты (pillar 2): шум в тенях ISO 400-1600, лёгкие JPEG-артефакты, пурпурный фринджинг, виньетирование в углах
• Боке (pillar 2): вычислительное размытие фона (smooth gaussian), НЕ кинематографическое (нет шестигранных бликов)
• Свет (pillar 1): ОДИН средовой источник + отражённый филл. Направление, тени под носом/скулами, пересвет допустим (+0.5-1.5 EV). НЕ ring light!
• Микро-выражения: ширина рта, асимметричные брови, натяжение мышц, носогубные складки
• Текстуры (pillar 8): поры, морщины, отдельные волоски, влага на губах, сосуды в склерах, складки одежды, переплетение ткани
• Кожа (pillar 9): 5 цветовых зон на лице (лоб светлее, щёки розовее, нос краснее, под глазами темнее). НЕ оранжевый загар, НЕ серое лицо! Кожа НЕ должна выглядеть пластиковой, восковой или резиновой. Фото должно быть неотличимо от реального селфи на iPhone
• Глаза (pillar 6): A в камеру, B следит за A. Блик от источника в зрачках, мокрая склера, текстура радужки
• Руки: СТРОГО 5 пальцев, анатомические пропорции, ногти, текстура кожи рук по возрасту
• ВАЖНО: В конце photo_scene_en ОБЯЗАТЕЛЬНО добавь negative prompt: "Negative: no text, no subtitles, no captions, no watermark, no logo, no frames, no borders, no REC, no timestamp, no UI elements, no overlays, no cartoon, no anime, no plastic skin, no 6th finger"
• АБСОЛЮТНЫЙ ЗАПРЕТ — В КАДРЕ НЕ ДОЛЖНО БЫТЬ: никакого текста, никаких надписей, никаких субтитров, никаких captions, никаких букв, никаких цифр поверх изображения, никаких рамок, никаких borders, никаких frames, никаких REC-значков, никаких таймкодов, никаких timestamps, никаких watermarks, никаких логотипов, никаких UI-элементов, никаких overlay-элементов. Изображение должно быть ЧИСТЫМ — только сцена с персонажами, без ЛЮБЫХ графических наложений
• Негатив: no text overlay, no subtitles, no captions, no letters, no numbers on image, no frames, no borders, no REC badge, no timestamp, no timecode, no watermark, no logo, no UI elements, no cartoon, no anime, no plastic skin, no 6th finger, no airbrushed look, no orange tan, no grey face, no ring light, no cinema bokeh, no DSLR look, no beauty mode, no skin smoothing, no graphic overlays, no title cards, no speech bubbles, no name tags, no bulging eyes, no all-white eyes, no missing pupils, no missing iris, no rolled-back eyes, no vacant stare, no asymmetric pupils, no eyes without visible iris and pupil
${product_info?.description_en || ctx.hasProductImage ? `• ТОВАР: опиши товар ультра-детально в сцене, точь-в-точь как на прикреплённом фото` : ''}

ПРАВИЛА ВИДЕО (video_emotion_arc) — ВСЕ 12 ПИЛЛАРОВ АКТИВНЫ:
• Пиши на АНГЛИЙСКОМ, побитово с таймкодами
• АБСОЛЮТНЫЙ ЗАПРЕТ: никакого текста на видео, никаких субтитров, никаких надписей, никаких REC-значков, никаких таймкодов в кадре, никаких рамок, никаких borders, никаких UI-элементов. Видео = чистая сцена с персонажами, БЕЗ ЛЮБЫХ графических наложений
• Каждый сегмент описывает: (a) что делает говорящий, (b) что делает молчащий, (c) куда смотрят глаза ОБОИХ, (d) что делает камера
• В КАЖДОМ сегменте video_emotion_arc добавляй: "No text on screen, no subtitles, no overlays, no REC, no frames" — это критично для чистоты кадра
${remake_mode ? `• РЕЖИМ РЕМЕЙКА — КОПИРУЙ РИТМ И ЭНЕРГИЮ ОРИГИНАЛА:
• hook: воспроизведи ТОЧНЫЙ тип хука из оригинала (агрессивный / спокойный / абсурдный / стремительный). Добавь signature micro_gesture персонажа A для максимальной харизмы в первые 0.6с
• act_A: воспроизведи ТЕМП и ПАУЗЫ оригинала. Используй hook_style и micro_gesture A. Добавь reaction_sounds B как внутреннюю реакцию (без слов)
• act_B: скопируй ритм доставки killer word из оригинала — момент паузы перед ним, скорость произношения, что делает лицо. Усиль через contempt_expression или anger_expression персонажа B
• release: воспроизведи тип финала из оригинала (смех / шок / немая сцена). Добавь laugh_style каждого персонажа. Rewatch-bait: micro-expression в последние 0.3с
• ВАЖНО: передай ту же ЭМОЦИОНАЛЬНУЮ КРИВУЮ что в оригинале — нарастание, пик, взрыв` : `• hook (pillar 11+6): ВИЗУАЛЬНЫЙ хук — персонаж УЖЕ В ДВИЖЕНИИ с кадра 0 (не начинает действие, а в разгаре). STAR PRESENCE: camera magnetism — взгляд в линзу намертво с первого кадра. Энергия ≥80% немедленно. Camera VEO 3.1: micro push-in 0.8px/frame первые 10 кадров. НЕ текстовый хук — только живая эмоция!
• act_A (pillar 4+5+6): моргание каждые 2-3с, вдох перед каждой фразой, асимметричные брови, signature micro_gesture персонажа A на каждой ключевой фразе. B: губы СТРОГО сомкнуты (pillar 5), моргания 4-6с, side-eye на A (pillar 6), nostril flare, eyebrow +2mm, finger tap (pillar 4)
• ПАУЗА 0.25с (VEO 3.1 tension beat): между act_A и act_B — тишина 0.25с. B expression меняется: loaded micro-smirk / contempt shift. A держит последнюю позу. Это ключевой момент саспенса — зритель чувствует входящий панчлайн. Не пропускай этот бит!
• act_B (pillar 4+5+6+12): KILLER WORD фонетика VEO 3.1 — голос снижается на полтона ПЕРЕД словом → 0.2с пауза → взрыв артикуляции → jaw snaps → глаза сужаются 20°. Camera: micro push-in на killer word. A: mid-gesture freeze → глаза расширяются → dart B↔camera 2-3Hz (pillar 6)
• release (pillar 12): конец на РЕАКЦИИ. Плечи трясутся, genuine лaughter или stunned freeze. LOOP LOCK VEO 3.1: 7.7-8.0с — неоднозначное micro-expression (зритель не уверен что видел → replay). Финальный кадр по энергии/позе совместим с кадром 0 для бесшовного авто-лупа`}

ПРАВИЛА АТМОСФЕРЫ (video_atmosphere_en) — ЗВУК КАК ЯКОРЬ РЕАЛЬНОСТИ:
• Пиши на АНГЛИЙСКОМ, 100-150 слов
• ОБЯЗАТЕЛЬНО: назови минимум 3 КОНКРЕТНЫХ звука этой локации (не «ambient sounds» — а «humming Saratov fridge», «50Hz fluorescent tube buzz», «vinyl seat squeak»). Без конкретных звуков = БРАК.
• ПРИМЕНЯЙ PILLARS 1 (свет), 3 (камера), 7 (чистота кадра), 10 (звук)
• Звук (pillar 10): room tone -20/-30dB ПОД диалогом. МИНИМУМ 2 КОНКРЕТНЫХ микро-звука локации (скрип двери, щелчок выключателя, шелест газеты, звон ложки). Микрофон телефона на 35-60см: ловит ВСЁ — клики слюны на т/к/п/д, шлёпок губ, контакт языка на л/н, вдохи перед каждой репликой, носовой выдох слушающего. Плозивы = поп в микрофоне. Реверб СТРОГО по размеру помещения. НЕ студийный звук!
• ЛИПСИНК: идеальный слоговой синхрон — каждая артикуляция совпадает с аудио. Видимое формирование согласных, раскрытие рта на гласных
• RAW-ЭСТЕТИКА: шум ISO 800-1600 в тенях, пересвет +0.5-1.5 EV на бликах, естественная тряска, JPEG-компрессия. НЕ стерильная картинка
• Свет (pillar 1): как он падает, направление, тени на коже, пересвет на бликах. Цветовая температура заблокирована на 8 секунд
• Камера (pillar 3): устройство НЕВИДИМО — руки заняты реквизитом. Micro-jitter от тремора, вертикальная осцилляция от дыхания, OIS/EIS артефакты. Hook push-in, release shake
• Частицы: пыль/пар/пыльца в свете (зависит от локации). Пылинки подсвечены доминантным источником
• Текстуры (pillar 8): поры, морщины, родинки, пот на лбу/висках. Складки ткани при движении, переплетение нитей

ПРАВИЛА ХЕШТЕГОВ (Instagram 2026):
• 15-20 штук, на РУССКОМ, без символа #
• Стратегия по размеру: 5 нишевых (≤50K постов) + 4 средних (50K-500K) + 3 персонажных + 2 больших (500K+) + 3 вечнозелёных + 1 уникальный тег серии (типа "бабказинаvsбабкаваля")
• 100% РЕЛЕВАНТНЫ теме диалога и категории юмора — каждый тег должен описывать содержание ролика
• ЗАПРЕТ: нет английских тегов (funny, comedy, viral, reels, trending), нет спам-тегов (юмор, приколы, смешно) — алгоритм IG даунрейтит генерики
• Примеры ХОРОШИХ нишевых тегов: бытоваядрама, кухонныевойны, бабкажжёт, ценыохренели
• Персонажные теги должны содержать имена: ${soloMode ? charA.name_ru + ' (соло)' : charA.name_ru + ' и ' + charB.name_ru}

ПРАВИЛА ENGAGEMENT:
• viral_title_ru: провокационный заголовок, макс 150 символов, используй имена персонажей, должен вызвать НУЖНО ПОСМОТРЕТЬ
• share_bait_ru: ОПИСАНИЕ ВИДЕО для пересылки — 1-2 предложения, макс 120 символов. Это то, что человек напишет другу когда скидывает видео: «скинь маме», «это точно про нас», «смотри что бабка выдала». Должно быть в КОНТЕКСТЕ ВИДЕО — упоминай тему/ситуацию из диалога. НЕ рекламный текст, а живое обращение к человеку.
• pin_comment_ru: закреплённый коммент от автора — создаёт дебаты, отсылает к killer word
• first_comment_ru: первый коммент сразу после публикации — задаёт провокационный вопрос зрителям

ПРАВИЛА INSTAGRAM PACK (ОБЯЗАТЕЛЬНО!):
• insta_analysis_ru: объект с 3 полями — детальный разбор ПОЧЕМУ видео залетит:
  - plot: что происходит в сюжете (2-3 предложения, конкретно про ЭТИХ персонажей и ЭТУ ситуацию)
  - punchline: разбор панчлайна — почему killer word работает, какой переворот
  - why_viral: почему это попадёт в жизу зрителей (каждая женщина/мужчина/бабушка хоть раз...)
• insta_caption_ru: ПОЛНЫЙ текст для описания поста в Instagram — 3-5 предложений, живой стиль, описывает что произошло + эмоции + жирный CTA в конце (перешли подруге/маме/другу с конкретной причиной + эмодзи). 200-400 символов.
• insta_hook_texts_ru: массив из 3 коротких текстовых крючков для ПОДПИСИ ПОСТА или текстовой ОБЛОЖКИ (НЕ накладываются на видео — видео чистое без текста!). 15-40 символов каждый. Интрига/шок/вопрос. Примеры: «Подловила его на самом интересном...», «Когда мама узнала правду 💀»
• insta_engagement_tip_ru: конкретный лайфхак для максимальных охватов ЭТОГО конкретного ролика — какой вопрос задать в закрепе чтобы спровоцировать спор/дебаты в комментах (1-3 предложения с конкретным текстом закрепа)

════════════════════════════════════════════════════════════════
🔍 САМОПРОВЕРКА ПЕРЕД ВЫВОДОМ (ОБЯЗАТЕЛЬНО!):
Перед тем как вывести JSON, проверь КАЖДЫЙ пункт:
${soloMode ? `□ dialogue_A_ru содержит 15-30 слов? (монолог — посчитай!)
□ В dialogue_A_ru максимум 2 символа |? (посчитай кол-во |)
□ dialogue_B_ru = null (это СОЛО, нет второго персонажа!)
□ killer_word = ПОСЛЕДНЕЕ слово монолога? (одно слово!)
□ killer_word создаёт эффект? (если убрать — монолог теряет удар)` : `${remake_mode ? `□ dialogue_A_ru = ДОСЛОВНАЯ копия речи из оригинала? (НЕ переписывал, не сокращал до 15 слов?)
□ dialogue_B_ru = ДОСЛОВНАЯ копия речи из оригинала? (НЕ переписывал, не сокращал?)
□ В dialogue_A_ru максимум 2 символа |?
□ В dialogue_B_ru максимум 2 символа |?
□ killer_word = ПОСЛЕДНЕЕ слово из последней реплики (одно слово!)
□ remake_veo_prompt_en содержит все 6 блоков: сцена, ракурс, персонаж A, персонаж B, действие/движения, техпараметры + negative?
□ remake_veo_prompt_en НЕ описывает selfie если в оригинале другой ракурс?
□ remake_veo_prompt_en длиннее 250 слов?
□ В remake_veo_prompt_en персонажи одеты в СВОЮ фирменную одежду (wardrobe_anchor), НЕ в одежду людей из оригинала?
□ В remake_veo_prompt_en вставлен ДОСЛОВНЫЙ character_en токен из Identity Lock для каждого персонажа?` : `□ dialogue_A_ru содержит 6-15 слов? (посчитай!)
□ dialogue_B_ru содержит 6-18 слов? (посчитай!)
□ В dialogue_A_ru максимум 1 символ |? (посчитай кол-во |)
□ В dialogue_B_ru максимум 1 символ |? (посчитай кол-во |)
□ dialogue_B_ru НЕ начинается с «Зато»?
□ killer_word = ПОСЛЕДНЕЕ слово из последней реплики (B или добивка A)? (одно слово!)
□ killer_word ПЕРЕВОРАЧИВАЕТ смысл? (если убрать — реплика теряет удар)
□ A и B спорят об ОДНОМ? (не ушли в разные темы?)
□ A и B звучат КОНТРАСТНО? (разный ритм, разная лексика, разная энергия — НЕ одинаково!)
□ dialogue_B_ru звучит как КОНКРЕТНО ЭТОТ персонаж B? (его ритм, паузы, акцентирование — см. РЕЧЬ B)`}`}
${remake_mode ? `□ Нет английских слов в диалоге?` : `□ Нет тире (—, –, -)? Нет английских слов?
□ Каждая реплика работает как вирусная цитата?
□ ТЕСТ НА СМЕХ: прочитай диалог — ты сам улыбнулся? Если нет — ПЕРЕДЕЛАЙ шутку!
□ ТЕСТ НА ПРЕДСКАЗУЕМОСТЬ: можно угадать панчлайн после реплики A? Если да — ПЕРЕДЕЛАЙ!
□ ТЕСТ НА КОНКРЕТИКУ: есть ли в диалоге конкретная деталь (число, название, предмет)? Если нет — ДОБАВЬ!
□ ТЕСТ НА KILLER WORD: убери killer word — фраза потеряла удар? Если нет — слово НЕПРАВИЛЬНОЕ, ЗАМЕНИ!`}
□ video_emotion_arc НЕ содержит упоминаний текста/субтитров/надписей/captions/overlays В КАДРЕ? (НОЛЬ текста на видео — только сцена!)
□ photo_scene_en заканчивается negative prompt с "no text, no subtitles, no captions"?
□ photo_scene_en не менее 200 слов? (если меньше — добавь деталей кожи/света/рук/выражений!)
□ video_atmosphere_en содержит 3+ конкретных звука локации (не абстрактных «ambient noise»)?
${remake_mode ? `□ photo_scene_en описывает ТУ ЖЕ СЦЕНУ что в оригинальном видео? (та же локация, тот же ракурс, то же действие — с нашими персонажами)
□ remake_veo_prompt_en описывает ТО ЖЕ ДЕЙСТВИЕ что в оригинале? (те же движения, та же энергия — с нашими персонажами)
□ Если в оригинале НЕ selfie — photo_scene_en НЕ описывает selfie?
□ Если в оригинале спорт/танец/действие — промпты описывают ИМЕННО это?` : `□ photo_scene_en описывает ТОТ ЖЕ МОМЕНТ что hook_en? (позы, жесты, выражения лиц СОВПАДАЮТ — это frame 0 видео!)
□ hook_en содержит hook_style персонажа A ДОСЛОВНО? (см. «Стиль хука (кадр 0)» в описании A — этот жест/действие ОБЯЗАН быть в hook_en!)
□ photo_scene_en показывает hook_style A? (кадр 0 = фирменный хук персонажа, НЕ случайное действие)`}
${remake_mode ? `` : `□ dialogue_A_ru звучит как КОНКРЕТНО ЭТОТ персонаж A? (его лексика, темп, структура предложений, слова-паразиты — см. РЕЧЬ A)
□ Есть хотя бы 1 signature_word в диалоге? (фирменная фраза персонажа)`}
Если ЛЮБОЙ пункт не пройден — ИСПРАВЬ перед выводом!
════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА — строго JSON:
{
  "humor_category_ru": "Твоя категория юмора — 2-4 слова. НЕ копируй примеры — придумай свою!",
${soloMode ? `  "dialogue_A_ru": "15-30 слов монолог, макс 2 символа |. Персонаж говорит прямо в камеру",
  "dialogue_B_ru": null,
  "dialogue_A2_ru": null,` : `  "dialogue_A_ru": "${remake_mode ? 'ДОСЛОВНАЯ копия речи из оригинала — сколько слов в оригинале столько и здесь (обычно 6-25 слов), макс 2 символа |' : '6-15 слов, макс 1 символ |, НЕ начинай с Зато'}",
  "dialogue_B_ru": "${remake_mode ? 'ДОСЛОВНАЯ копия речи из оригинала — сколько слов в оригинале столько и здесь (обычно 6-25 слов), макс 2 символа |, killer word ПОСЛЕДНЕЕ' : '6-18 слов, макс 1 символ |, killer word ПОСЛЕДНЕЕ (если нет добивки), НЕ начинай с Зато'}",
  "dialogue_A2_ru": "${remake_mode ? 'ДОБИВКА если есть в оригинале — дословно. null если в оригинале нет' : 'ДОБИВКА от A — 1-4 слова, короткая финальная фраза. null если добивки нет. Используй ТОЛЬКО если структура оригинала предполагает добивку или если она усиливает комедию'}",`}
  "killer_word": "ОДНО слово — последнее слово из ПОСЛЕДНЕЙ реплики${soloMode ? ' (монолога)' : ' (dialogue_B_ru или dialogue_A2_ru если есть добивка)'}",
  "photo_scene_en": "${remake_mode ? 'КОПИЯ СЦЕНЫ ИЗ ОРИГИНАЛА. Medium shot (по пояс). ТА ЖЕ локация, ракурс, композиция, позы, освещение. Для КАЖДОГО персонажа — ДОСЛОВНО вставь character_en + wardrobe_anchor + signature_element. Устройство НЕВИДИМО, руки заняты реквизитом. Персонажи в СВОЕЙ одежде. 150-250 слов EN + negative prompt' : 'Medium shot photo capturing the EXACT HOOK MOMENT (frame 0, 0.0-0.7s) from which video begins — MUST match hook_en poses/expressions. Устройство НЕВИДИМО. 150-250 слов EN'}",
  "video_emotion_arc": {
    "hook_en": "0.0-0.7s: ${remake_mode ? 'СКОПИРУЙ тип хука из оригинала + signature micro_gesture A. Стоп-скролл' : 'стоп-скролл, описание на английском'}",
${soloMode ? `    "monologue_en": "0.7-7.0s: описание монолога на английском — один персонаж, прямо в камеру, killer word ≈ 6.8s",` : `    "act_A_en": "0.7-3.5s: ${remake_mode ? 'СКОПИРУЙ темп и паузы из оригинала + micro_gesture A, B РОТ СТРОГО ЗАКРЫТ' : 'B РОТ СТРОГО ЗАКРЫТ, описание на английском'}",
    "act_B_en": "3.5-7.0s: ${remake_mode ? 'СКОПИРУЙ ритм доставки killer word из оригинала + A РОТ СТРОГО ЗАКРЫТ, пафосная поза' : 'A РОТ СТРОГО ЗАКРЫТ, KW≈6.8s, описание на английском'}",`}
    "release_en": "7.0-8.0s: ${!enableLaughter ? 'БЕЗ СМЕХА. Речь заканчивается, тишина. Замершие выражения лиц после панчлайна. Rewatch-bait 0.3s. НЕ ПИШИ смех, хихиканье, усмешки — ТОЛЬКО тишина' : remake_mode ? 'СКОПИРУЙ тип финала из оригинала + laugh_style обоих если в оригинале смех. Rewatch-bait 0.3s' : scene_hint ? 'ФИНАЛ СОГЛАСНО ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ (см. выше). Если пользователь указал без смеха — НЕ ПИШИ смех. Rewatch-bait 0.3s' : 'хриплый смех, тряска камеры, rewatch-bait 0.3s'}"
  },
  "video_atmosphere_en": "${remake_mode ? 'СКОПИРУЙ атмосферу оригинала: звуки локации, реверб по размеру помещения, room tone, шорохи, фоновый шум. 80-120 слов EN' : '80-100 слов на английском'}",
  "viral_title_ru": "заголовок на русском",
  "share_bait_ru": "описание видео для пересылки — живая фраза в контексте видео, макс 120 символов",
  "pin_comment_ru": "закреп на русском",
  "first_comment_ru": "первый коммент на русском",
  "hashtags": ["тег1", "тег2", "...15-20 штук без #"],
  "insta_analysis_ru": {
    "plot": "Что происходит — 2-3 предложения про сюжет с именами персонажей",
    "punchline": "Разбор панчлайна — почему killer word работает, какой переворот",
    "why_viral": "Почему попадёт в жизу — к какому опыту зрителя обращается"
  },
  "insta_caption_ru": "Полный текст для описания поста: 3-5 живых предложений + CTA с эмодзи. 200-400 символов.",
  "insta_hook_texts_ru": ["Хук 1 (15-40 символов)", "Хук 2", "Хук 3"],
  "insta_engagement_tip_ru": "Лайфхак для охватов: конкретный текст закрепа + объяснение почему спровоцирует спор"${remake_mode ? `,
  "remake_veo_prompt_en": "[ЗАПОЛНИ ПО ШАБЛОНУ — ЗОЛОТОЙ СТАНДАРТ 2026]\n\n[БЛОК 1 — СЦЕНА И ЛОКАЦИЯ (70-90 слов): точное место из оригинала — тип помещения/улицы, материалы стен/пола/фона, освещение (тип источника, направление, цветовая температура, качество теней), атмосфера, предметы заднего плана, минимум 2 конкретных микро-звука этой локации (скрип, щелчок, шелест, звон).]\n\n[БЛОК 2 — РАКУРС КАМЕРЫ (35-45 слов): MEDIUM SHOT (средний план по пояс) — НЕ крупный план голов! Скопируй угол из оригинала. Устройство НЕВИДИМО — руки заняты реквизитом. Handheld micro-jitter 0.8-2px at 2-5Hz, breathing oscillation. RAW phone aesthetic: ISO noise in shadows, blown highlights.]\n\n[БЛОК 3 — ПЕРСОНАЖ A (80-120 слов): ВСТАВЬ ДОСЛОВНО: ${charA.prompt_tokens?.character_en || charA.appearance_ru || charA.name_ru}. Wardrobe: ${charA.identity_anchors?.wardrobe_anchor || '—'}. Signature: ${charA.identity_anchors?.signature_element || '—'}. Hyper-realism: visible pores, birthmarks, wrinkles, sweat on temples. Интенсивный «липкий» взгляд в линзу. Поза и положение ТОЧНО как в оригинале. Руки заняты реквизитом.]\n\n[БЛОК 4 — ПЕРСОНАЖ B (80-120 слов): ВСТАВЬ ДОСЛОВНО: ${charB.prompt_tokens?.character_en || charB.appearance_ru || charB.name_ru}. Wardrobe: ${charB.identity_anchors?.wardrobe_anchor || '—'}. Signature: ${charB.identity_anchors?.signature_element || '—'}. Hyper-realism: visible pores, birthmarks, wrinkles, sweat. Поза ТОЧНО как в оригинале. Когда молчит — РОТ СТРОГО ЗАКРЫТ, только микро-мимика.]\n\n[БЛОК 5 — ДЕЙСТВИЕ И ТАЙМИНГ (80-100 слов): 0.0-0.7s HOOK — мгновенный стоп-скролл (удар предметом по линзе / резкий вдох / микро-экшен). 0.7-3.5s ACT A speaks, B mouth STRICTLY CLOSED — only side-eye and micro-expressions. 3.5-7.0s ACT B delivers punchline with killer word at ~6.8s, A mouth STRICTLY CLOSED, freezes in pathos pose. 7.0-8.0s RELEASE — общий заразительный хриплый raspy laugh, camera shake, rewatch-bait micro-expression in last 0.3s. Perfect syllable-level lip-sync throughout.]\n\n[БЛОК 6 — TECH + NEGATIVE (40-50 слов): 9:16 vertical. 8 seconds. RAW smartphone footage: sensor noise ISO 800-1600, JPEG artifacts, imperfect auto white-balance, blown highlights +0.5-1.5EV. Saliva clicks on т/к/п consonants, inhales before lines. Medium shot framing, device invisible. NO text, NO subtitles, NO captions, NO watermarks, NO UI, NO REC, NO smooth skin, NO studio lighting, NO CGI, NO close-up talking heads, NO visible phone in hands.]"` : ''}${product_info?.description_en || ctx.hasProductImage ? `,
  "product_in_frame_en": "Ультра-детальное описание товара для AI-рендеринга на английском. СТРОГО как на фото: цвет, форма, бренд, материал, размер, текстура, блики. 50-80 слов."` : ''}
}

КРИТИЧНО: Отвечай ТОЛЬКО валидным JSON. Без markdown. Без блоков кода. Без пояснений. Только JSON.`;
}

// ─── POST /api/generate — AI multimodal generation ──────────
app.post('/api/generate', authMiddleware, async (req, res) => {
  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен. Обратитесь к администратору.' });
  }

  const userId = req.user?.userId || req.user?.hash || getClientIP(req);
  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${userId}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${userId}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  const { context, product_image, product_mime, video_file, video_file_mime, video_cover, video_cover_mime, reference_image, reference_image_mime, ab_variants, meme_image, meme_image_mime, meme_file, meme_file_mime, meme_context } = req.body;
  const requestedVariants = Math.min(Math.max(parseInt(ab_variants) || 0, 0), 3); // 0 = normal, 1-3 = extra variants
  
  // Enhanced validation
  if (!context) {
    return res.status(400).json({ error: 'Context is required' });
  }
  
  // Video mode allows no character (direct copy of creative)
  if (context.input_mode === 'video' && (!context.charA || !context.charA.id || context.charA.id === 'none')) {
    context.charA = { id: 'none', name_ru: 'Оригинал', prompt_tokens: {}, identity_anchors: {}, biology_override: {}, group: '', vibe_archetype: '' };
    context.charB = context.charA;
    context.soloMode = true;
  } else if (!context.charA || !context.charA.id || !context.charA.name_ru) {
    return res.status(400).json({ error: 'Character A with id and name_ru is required' });
  }
  
  // charB is optional — solo mode (monologue) when null
  if (context.charB && (!context.charB.id || !context.charB.name_ru)) {
    return res.status(400).json({ error: 'Character B must have id and name_ru if provided' });
  }
  // In solo mode, set charB = charA for downstream compatibility
  if (!context.charB) {
    context.charB = context.charA;
    context.soloMode = true;
  }
  
  if (!context.input_mode) {
    return res.status(400).json({ error: 'Input mode is required (idea, script, video, suggested)' });
  }
  
  // Validate input_mode
  const validModes = ['idea', 'script', 'video', 'suggested'];
  if (!validModes.includes(context.input_mode)) {
    return res.status(400).json({ error: `Invalid input_mode. Must be one of: ${validModes.join(', ')}` });
  }
  
  // Validate mode-specific requirements
  if (context.input_mode === 'script' && !context.script_ru) {
    return res.status(400).json({ error: 'Script mode requires script_ru with A and B fields' });
  }
  
  if (context.input_mode === 'video' && !video_file && !video_cover && !context.scene_hint) {
    return res.status(400).json({ error: 'Video mode requires video_file, video_cover, or scene description' });
  }
  
  if (context.input_mode === 'idea' && !context.topic_ru) {
    return res.status(400).json({ error: 'Idea mode requires topic (напишите идею в поле ввода)' });
  }
  
  // suggested mode: topic_ru is optional (AI can pick trending topic itself)

  // Flag for prompt builder
  context.hasProductImage = !!product_image;
  context.hasVideoFile = !!video_file;
  context.hasVideoCover = !!video_cover;
  // Auto-enable remake_mode for video input — ensures remake_veo_prompt_en is always generated
  if (context.input_mode === 'video') context.remake_mode = true;

  // ─── GEMINI CACHE CHECK (skip for requests with binary attachments) ────
  const _hasAttachments = !!(video_file || product_image || reference_image);
  const _cacheKey = _hasAttachments ? null : getGeminiCacheKey(context);
  if (_cacheKey) {
    const _cached = _geminiCache.get(_cacheKey);
    if (_cached && Date.now() - _cached.ts < GEMINI_CACHE_TTL) {
      console.log(`[CACHE HIT] Gemini кеш: ${_cacheKey}`);
      return res.json({ ai: _cached.result });
    }
  }

  try {
    let promptText = buildAIPrompt(context);

    // A/B Testing: inject instruction for multiple dialogue variants
    if (requestedVariants > 0) {
      const soloMode = context.soloMode;
      promptText += soloMode
        ? `\n\n════════════════════════════════════════════════════════════════
⚡ A/B ТЕСТИРОВАНИЕ: СГЕНЕРИРУЙ ${requestedVariants + 1} ВАРИАНТА МОНОЛОГА

Помимо основного монолога (dialogue_A_ru, killer_word), добавь в JSON массив "ab_variants" с ${requestedVariants} АЛЬТЕРНАТИВНЫМИ вариантами.

Каждый вариант в массиве — объект с полями:
{ "dialogue_A_ru": "...", "dialogue_B_ru": null, "dialogue_A2_ru": null, "killer_word": "..." }

ПРАВИЛА ДЛЯ ВАРИАНТОВ:
• Каждый вариант — ДРУГОЙ угол юмора, ДРУГИЕ слова, ДРУГОЙ поворот
• Все варианты про ТУ ЖЕ тему, но с разными панчлайнами
• Все правила монолога (15-30 слов, пайпы, без тире) действуют для каждого варианта
• Основной вариант — самый сильный. Альтернативные — экспериментальные

Пример структуры:
"ab_variants": [
  { "dialogue_A_ru": "альт монолог", "dialogue_B_ru": null, "dialogue_A2_ru": null, "killer_word": "слово" }
]
════════════════════════════════════════════════════════════════`
        : `\n\n════════════════════════════════════════════════════════════════
⚡ A/B ТЕСТИРОВАНИЕ: СГЕНЕРИРУЙ ${requestedVariants + 1} ВАРИАНТА ДИАЛОГА

Помимо основного диалога (dialogue_A_ru, dialogue_B_ru, killer_word), добавь в JSON массив "ab_variants" с ${requestedVariants} АЛЬТЕРНАТИВНЫМИ вариантами.

Каждый вариант в массиве — объект с полями:
{ "dialogue_A_ru": "...", "dialogue_B_ru": "...", "dialogue_A2_ru": "..." или null, "killer_word": "..." }

ПРАВИЛА ДЛЯ ВАРИАНТОВ:
• Каждый вариант — ДРУГОЙ угол юмора, ДРУГИЕ слова, ДРУГОЙ поворот
• Все варианты про ТУ ЖЕ тему, но с разными панчлайнами
• Все правила диалога (длина, пайпы, без тире, без «Зато») действуют для каждого варианта
• Основной вариант — самый сильный. Альтернативные — экспериментальные

Пример структуры:
"ab_variants": [
  { "dialogue_A_ru": "альт реплика A", "dialogue_B_ru": "альт реплика B", "dialogue_A2_ru": null, "killer_word": "слово" }
]
════════════════════════════════════════════════════════════════`;
    }

    // Build multimodal parts: text + optional images
    const parts = [{ text: promptText }];

    // Attach product photo if provided — AI engine SEES the actual product
    if (product_image) {
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННОЕ ФОТО ТОВАРА — рассмотри внимательно, товар в промпте должен быть ТОЧЬ-В-ТОЧЬ как на этом фото]'
      });
      parts.push({
        inline_data: { mime_type: product_mime || 'image/jpeg', data: product_image }
      });
    }

    // Attach actual video file if provided — AI engine WATCHES the original video
    if (video_file) {
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННОЕ ОРИГИНАЛЬНОЕ ВИДЕО — ПОСМОТРИ ЕГО ПОЛНОСТЬЮ. Внимательно прослушай диалог, интонации, паузы, эмоции. Проанализируй: кто что говорит, какие слова используют, какой темп, какие жесты, какое настроение. Диалог в твоём ответе должен быть на 90% идентичен оригиналу — те же слова, тот же смысл, та же энергия, адаптированные под наших персонажей.]'
      });
      parts.push({
        inline_data: { mime_type: video_file_mime || 'video/mp4', data: video_file }
      });
    } else if (video_cover) {
      // Fallback: only cover image if video file not available
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННАЯ ОБЛОЖКА ОРИГИНАЛЬНОГО ВИДЕО — проанализируй настроение, позы, фон, ракурс, стиль. Видео не прикреплено, только кадр.]'
      });
      parts.push({
        inline_data: { mime_type: video_cover_mime || 'image/jpeg', data: video_cover }
      });
    }

    // Attach reference image if provided — visual reference for scene/location/style
    if (reference_image) {
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННЫЙ РЕФЕРЕНС-ФОТО — используй как визуальный референс: скопируй настроение, локацию, цветовую палитру, освещение, эстетику и композицию. Отрази ЭТОТ стиль в photo_scene_en, video_atmosphere_en и remake_veo_prompt_en.]'
      });
      parts.push({
        inline_data: { mime_type: reference_image_mime || 'image/jpeg', data: reference_image }
      });
    }


    const MAX_RETRIES = 2;
    let lastError = null;
    let data = null;
    let text = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const apiKey = attempt === 0 ? GEMINI_KEY : nextGeminiKey() || GEMINI_KEY;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: requestedVariants > 0 ? 0.9 : 0.82,
          maxOutputTokens: requestedVariants > 0 ? 12288 : 8192,
          responseMimeType: 'application/json',
        },
      };

      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 80_000); // 80s timeout
        const resp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        clearTimeout(to);

        data = await resp.json();

        if (!resp.ok) {
          lastError = data.error?.message || JSON.stringify(data.error) || 'Gemini API error';
          console.error(`Gemini generate error (attempt ${attempt + 1}):`, lastError);
          if (resp.status === 429 || resp.status >= 500) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          return res.status(resp.status).json({ error: `Ошибка AI: ${lastError}` });
        }

        text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const finishReason = data.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          console.warn(`Gemini finishReason: ${finishReason} (attempt ${attempt + 1}) — text length: ${text?.length || 0}`);
        }
        if (text) break;

        lastError = 'AI не вернул контент';
        console.warn(`Gemini empty response (attempt ${attempt + 1})`);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 800));
      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.error(`Gemini fetch error (attempt ${attempt + 1}):`, fetchErr.message);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (!text) {
      return res.status(422).json({ error: `AI не вернул контент после ${MAX_RETRIES + 1} попыток. ${lastError || 'Попробуйте ещё раз.'}` });
    }

    let geminiResult;
    try {
      geminiResult = JSON.parse(text);
    } catch (parseErr) {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          geminiResult = JSON.parse(jsonMatch[1]);
        } catch (e2) {
          console.error('Gemini JSON parse error (code block):', jsonMatch[1].slice(0, 300));
        }
      }
      // Try extracting first { ... } block
      if (!geminiResult) {
        const braceMatch = text.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          try {
            geminiResult = JSON.parse(braceMatch[0]);
          } catch (e3) {
            console.error('Gemini JSON parse error (brace extract):', braceMatch[0].slice(0, 300));
          }
        }
      }
      if (!geminiResult) {
        console.error('Gemini JSON parse error — all extraction methods failed.');
        console.error('Response finishReason:', data.candidates?.[0]?.finishReason);
        console.error('Response text (first 800 chars):', text.slice(0, 800));
        console.error('Response text (last 200 chars):', text.slice(-200));
        return res.status(422).json({ error: 'AI вернул невалидный JSON. Попробуйте ещё раз.' });
      }
    }

    // ── Store in cache if no attachments ──
    if (_cacheKey && geminiResult) {
      _geminiCache.set(_cacheKey, { result: geminiResult, ts: Date.now() });
      console.log(`[CACHE SET] Gemini кеш: ${_cacheKey}`);
    }

    // ── Post-parse validation: ensure critical fields exist ──
    const soloMode = context.soloMode;
    if (!geminiResult.dialogue_A_ru) {
      console.warn('Gemini response missing dialogue_A_ru:', Object.keys(geminiResult));
    }
    if (!soloMode && !geminiResult.dialogue_B_ru) {
      console.warn('Gemini response missing dialogue_B_ru (duo mode):', Object.keys(geminiResult));
    }
    if (!geminiResult.photo_scene_en) {
      console.warn('Gemini response missing photo_scene_en');
    }
    if (!geminiResult.hashtags || !Array.isArray(geminiResult.hashtags) || geminiResult.hashtags.length < 5) {
      console.warn('Gemini response has weak hashtags:', geminiResult.hashtags?.length || 0);
    }

    // ── HARD DIALOGUE SANITIZER — code-level enforcement ──
    // Gemini ignores prompt rules, so we fix its output programmatically.
    // REMAKE/VIDEO MODE: bypass destructive sanitizers — original dialogue must be preserved verbatim.
    const isRemakeMode = context.input_mode === 'video' || !!context.remake_mode;

    const sanitizeLine = (line, maxPipes = 1) => {
      if (!line || typeof line !== 'string') return line;
      let s = line.trim();
      if (!isRemakeMode) {
        // Strip dashes (only for generated dialogue, not original)
        s = s.replace(/\s*[—–]\s*/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      }
      // Enforce max N pipes: keep first N, remove the rest
      let pipeCount = 0;
      s = s.replace(/\|/g, () => {
        pipeCount++;
        return pipeCount <= maxPipes ? '|' : '';
      });
      s = s.replace(/\s{2,}/g, ' ').trim();
      return s;
    };

    // In remake mode: only trim whitespace, allow up to 3 pipes (longer original lines may have more timing marks)
    const remakeSanitize = (line) => {
      if (!line || typeof line !== 'string') return line;
      let s = line.trim().replace(/\s{2,}/g, ' ');
      // Allow up to 3 pipe markers in original dialogue
      let pipeCount = 0;
      s = s.replace(/\|/g, () => { pipeCount++; return pipeCount <= 3 ? '|' : ''; });
      return s;
    };

    if (geminiResult.dialogue_A_ru) {
      const orig = geminiResult.dialogue_A_ru;
      geminiResult.dialogue_A_ru = isRemakeMode
        ? remakeSanitize(orig)
        : sanitizeLine(orig, soloMode ? 2 : 1);
      if (orig !== geminiResult.dialogue_A_ru) {
        console.log('Sanitized dialogue_A_ru:', { before: orig.slice(0, 100), after: geminiResult.dialogue_A_ru.slice(0, 100) });
      }
    }

    if (geminiResult.dialogue_B_ru && !soloMode) {
      let bLine = isRemakeMode
        ? remakeSanitize(geminiResult.dialogue_B_ru)
        : sanitizeLine(geminiResult.dialogue_B_ru);

      // Strip "Зато" from beginning — only for generated dialogue, not original
      if (!isRemakeMode && /^\s*[Зз]ато\s/i.test(bLine)) {
        bLine = bLine.replace(/^\s*[Зз]ато\s+/i, '').trim();
        if (bLine.length > 0) bLine = bLine[0].toUpperCase() + bLine.slice(1);
        console.log('Stripped "Зато" from dialogue_B_ru');
      }
      if (geminiResult.dialogue_B_ru !== bLine) {
        console.log('Sanitized dialogue_B_ru:', { before: geminiResult.dialogue_B_ru.slice(0, 100), after: bLine.slice(0, 100) });
      }
      geminiResult.dialogue_B_ru = bLine;

      // Fix killer_word: only auto-fix for generated content, not original dialogue
      // In remake mode Gemini determines the killer_word from the original — trust it
      if (!isRemakeMode) {
        const killerSource = geminiResult.dialogue_A2_ru ? sanitizeLine(geminiResult.dialogue_A2_ru) : bLine;
        const kwWords = killerSource.replace(/[|!?.…,«»"]/g, '').trim().split(/\s+/).filter(Boolean);
        if (kwWords.length > 0) {
          const actualLastWord = kwWords[kwWords.length - 1];
          if (geminiResult.killer_word !== actualLastWord) {
            console.log('Fixed killer_word:', { was: geminiResult.killer_word, now: actualLastWord, source: geminiResult.dialogue_A2_ru ? 'A2_добивка' : 'B' });
            geminiResult.killer_word = actualLastWord;
          }
        }
      }
    } else if (soloMode) {
      // Solo mode: ensure dialogue_B_ru is null, fix killer_word from monologue A
      geminiResult.dialogue_B_ru = null;
      geminiResult.dialogue_A2_ru = null;
      const aLine = geminiResult.dialogue_A_ru || '';
      const kwWords = aLine.replace(/[|!?.…,«»"]/g, '').trim().split(/\s+/).filter(Boolean);
      if (kwWords.length > 0) {
        const actualLastWord = kwWords[kwWords.length - 1];
        if (geminiResult.killer_word !== actualLastWord) {
          console.log('Fixed killer_word (solo):', { was: geminiResult.killer_word, now: actualLastWord });
          geminiResult.killer_word = actualLastWord;
        }
      }
    }

    // Sanitize добивка if present
    if (geminiResult.dialogue_A2_ru && typeof geminiResult.dialogue_A2_ru === 'string') {
      geminiResult.dialogue_A2_ru = isRemakeMode
        ? remakeSanitize(geminiResult.dialogue_A2_ru)
        : sanitizeLine(geminiResult.dialogue_A2_ru);
      if (!geminiResult.dialogue_A2_ru.trim()) geminiResult.dialogue_A2_ru = null;
    } else {
      geminiResult.dialogue_A2_ru = null;
    }

    // ── Sanitize A/B variants if present ──
    if (Array.isArray(geminiResult.ab_variants)) {
      geminiResult.ab_variants = geminiResult.ab_variants.filter(v => v && v.dialogue_A_ru && (soloMode || v.dialogue_B_ru)).map(v => {
        v.dialogue_A_ru = sanitizeLine(v.dialogue_A_ru, soloMode ? 2 : 1);
        if (soloMode) {
          v.dialogue_B_ru = null;
          v.dialogue_A2_ru = null;
          const kwW = (v.dialogue_A_ru || '').replace(/[|!?.…,«»"]/g, '').trim().split(/\s+/).filter(Boolean);
          if (kwW.length > 0) v.killer_word = kwW[kwW.length - 1];
        } else {
          let bLine = sanitizeLine(v.dialogue_B_ru);
          if (/^\s*[Зз]ато\s/i.test(bLine)) {
            bLine = bLine.replace(/^\s*[Зз]ато\s+/i, '').trim();
            if (bLine.length > 0) bLine = bLine[0].toUpperCase() + bLine.slice(1);
          }
          v.dialogue_B_ru = bLine;
          if (v.dialogue_A2_ru && typeof v.dialogue_A2_ru === 'string') {
            v.dialogue_A2_ru = sanitizeLine(v.dialogue_A2_ru);
            if (!v.dialogue_A2_ru.trim()) v.dialogue_A2_ru = null;
          } else { v.dialogue_A2_ru = null; }
          // Fix killer_word for variant
          const kwSrc = v.dialogue_A2_ru || v.dialogue_B_ru;
          const kwW = kwSrc.replace(/[|!?.…,«»"]/g, '').trim().split(/\s+/).filter(Boolean);
          if (kwW.length > 0) v.killer_word = kwW[kwW.length - 1];
        }
        return v;
      });
    }

    res.json({
      ai: geminiResult,
      model: 'ferixdi-ai-v2',
      tokens: data?.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    const errorId = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString();
    const userId = req.user?.userId || req.user?.hash || getClientIP(req);
    
    // Enhanced error logging (defensive — data may not exist if prompt building crashed)
    console.error(`[${timestamp}] Generate error [${errorId}] [${userId}]:`, {
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 5).join('\n'),
      generationMode: context?.input_mode,
      hasVideo: !!video_file,
      hasProduct: !!product_image,
    });
    
    // User-friendly error response
    const isRetryable = e.message?.includes('timeout') || e.message?.includes('429') || e.message?.includes('network');
    const statusCode = isRetryable ? 503 : 500;
    const userMessage = isRetryable 
      ? 'Сервис временно недоступен. Попробуйте снова через несколько минут.'
      : 'Произошла ошибка при генерации. Попробуйте изменить параметры и повторить.';
    
    res.status(statusCode).json({ 
      error: userMessage,
      errorId,
      timestamp,
      retryable: isRetryable
    });
  }
});

// ─── POST /api/product/describe — AI Vision: описание товара по фото ──
app.post('/api/product/describe', authMiddleware, async (req, res) => {
  const uid = req.user?.userId || req.user?.hash || getClientIP(req);
  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${uid}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${uid}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  const { image_base64, mime_type, mode, language } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
  const lang = language === 'ru' ? 'ru' : 'en';

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен. Обратитесь к администратору.' });
  }

  try {
    const mimeType = mime_type || 'image/jpeg';

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`;

    // Different prompts for product vs reference mode
    const langInstruction = lang === 'ru' ? 'Опиши на РУССКОМ языке.' : 'Describe in English.';
    const prompt = mode === 'reference'
      ? `You are a visual style analyst specializing in creating descriptions for AI image and video generation. Analyze this reference image and describe its VISUAL AESTHETIC. ${langInstruction}

Focus ONLY on the visual style, NOT on objects or people:
1. **LIGHTING**: Direction, quality (soft/hard), color temperature, key-to-fill ratio, shadows, highlights, any dramatic light effects
2. **COLOR PALETTE**: Dominant colors, accent colors, saturation level, warm/cool balance, any color grading or filters applied
3. **MOOD & ATMOSPHERE**: Overall feeling, energy level, emotional tone, cinematic quality
4. **COMPOSITION**: Framing style, depth of field, perspective, negative space usage
5. **TEXTURE & GRAIN**: Film grain, digital noise, sharpness, any vintage or processed look
6. **STYLE REFERENCES**: If it resembles a known visual style (e.g., "Wes Anderson pastel palette", "noir high-contrast", "golden hour warmth")

Format your response as a single dense paragraph optimized for AI video generation prompts. Start directly with the style description, no preamble. The goal is that an AI model can replicate this EXACT visual aesthetic in a completely different scene.`
      : `You are a product photography analyst specializing in creating descriptions for AI image and video generation. Analyze this product photo and provide an ULTRA-DETAILED description. ${langInstruction}

IGNORE the background completely — describe ONLY the product itself.

Include ALL of the following:
1. **PRODUCT TYPE**: Category, brand name if recognizable, model if visible
2. **SHAPE & FORM**: Exact silhouette, proportions, estimated dimensions (e.g., "approximately 15cm tall, 5cm diameter"), 3D form description
3. **COLORS & MATERIALS**: Every color with specificity (e.g., "matte charcoal black with 5% warm undertone"), gradients, texture description, material type (matte/glossy/metallic/satin/transparent/frosted/brushed etc.)
4. **BRANDING & TEXT**: All visible logos, labels, text — exact fonts if recognizable, colors of text, placement on product, size relative to product
5. **SURFACE DETAILS**: Buttons, caps, handles, patterns, seams, edges, ridges, embossing, debossing, stitching, wear marks
6. **REFLECTIONS & LIGHT BEHAVIOR**: How light interacts with each surface — specular highlights, diffuse reflection, transparency, refraction, shadow casting characteristics
7. **CONDITION**: New/used/vintage, any wear, scratches, patina
8. **PACKAGING**: If visible — box, wrapper, tag, ribbon, seal details
9. **VIEWING ANGLE**: Describe the angle this photo was taken from (front, 3/4, top-down, etc.)

Format your response as a single dense paragraph optimized for AI image generation prompts. Start directly with the product description, no preamble. Be extremely specific about every visual detail — the goal is that an AI model can recreate this EXACT product from the description alone, matching it to the original photo with 95%+ visual accuracy.`;

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: image_base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      }
    };

    const acProd = new AbortController();
    const toProd = setTimeout(() => acProd.abort(), 30_000); // 30s timeout
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: acProd.signal,
    });
    clearTimeout(toProd);

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || 'AI error';
      return res.status(resp.status).json({ error: `Ошибка AI: ${errMsg}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'AI не вернул описание. Попробуйте другое фото.' });
    }

    res.json({
      description_en: text.trim(),
      language: lang,
      model: 'ferixdi-ai-v2',
      tokens: data.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    console.error('Product describe error:', e.message);
    res.status(500).json({ error: `Ошибка анализа: ${e.message}` });
  }
});

// ─── POST /api/video/fetch — скачка видео по URL (Instagram) ──
app.post('/api/video/fetch', authMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const normalized = url.trim();

    // ── TikTok — не поддерживается, только Instagram ──
    if (normalized.includes('tiktok.com') || normalized.includes('vm.tiktok.com')) {
      return res.status(400).json({ error: 'Платформа работает только с Instagram. Используйте Instagram Reels ссылки.' });
    }

    // ── Instagram ──
    if (normalized.includes('instagram.com')) {
      // Extract shortcode from URL
      const match = normalized.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      if (!match) return res.status(400).json({ error: 'Неверная ссылка Instagram. Нужна ссылка на пост/reel.' });

      const shortcode = match[2];
      // Use Instagram's public oEmbed API for metadata
      const oembedUrl = `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/`;
      const acOe = new AbortController();
      const toOe = setTimeout(() => acOe.abort(), 10_000); // 10s timeout
      const oembedResp = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: acOe.signal,
      });
      clearTimeout(toOe);

      if (!oembedResp.ok) {
        return res.status(422).json({ error: 'Instagram: пост не найден или приватный' });
      }

      const oembed = await oembedResp.json();

      // Try saveig API for actual video URL
      let videoUrl = null;
      try {
        const acSi = new AbortController();
        const toSi = setTimeout(() => acSi.abort(), 10_000); // 10s timeout
        const saveigResp = await fetch('https://v3.saveig.app/api/ajaxSearch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
          body: `q=${encodeURIComponent(normalized)}&t=media&lang=en`,
          signal: acSi.signal,
        });
        clearTimeout(toSi);
        const saveigData = await saveigResp.json();
        if (saveigData.status === 'ok' && saveigData.data) {
          // Extract first download link from HTML response
          const linkMatch = saveigData.data.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/);
          if (linkMatch) videoUrl = linkMatch[1];
          if (!videoUrl) {
            const anyLink = saveigData.data.match(/href="(https?:\/\/[^"]+)"/);
            if (anyLink) videoUrl = anyLink[1];
          }
        }
      } catch { /* saveig fallback failed, continue with oembed data */ }

      return res.json({
        platform: 'instagram',
        video_url: videoUrl,
        cover: oembed.thumbnail_url || null,
        title: oembed.title || '',
        author: oembed.author_name || '',
        author_url: oembed.author_url || '',
        width: oembed.thumbnail_width || 0,
        height: oembed.thumbnail_height || 0,
        shortcode,
        note: videoUrl ? 'Видео готово к скачиванию' : 'Метаданные получены, но прямая ссылка на видео недоступна (приватный аккаунт или ограничения IG)',
      });
    }

    return res.status(400).json({ error: 'Поддерживаются только Instagram ссылки' });

  } catch (e) {
    console.error('Video fetch error:', e.message);
    res.status(500).json({ error: 'Ошибка при обработке видео', detail: e.message });
  }
});

// ─── POST /api/trends — AI trend analysis with online grounding ──────
app.post('/api/trends', authMiddleware, async (req, res) => {
  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен.' });
  }
  const userId = req.user?.userId || req.user?.hash || getClientIP(req);
  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${userId}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${userId}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  // Get niche from request body
  const { niche = 'universal' } = req.body;

  const now = new Date();
  const today = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // ── Календарь праздников РФ ──
  const calendarHints = [];
  const calendar = [
    [1, 1, 3, 'Новый год, каникулы, оливье, подарки'],
    [1, 7, 2, 'Рождество'],
    [1, 25, 2, 'Татьянин день, день студента'],
    [2, 14, 3, 'День святого Валентина, отношения, подарки'],
    [2, 20, 10, 'Масленица, блины, сжигание чучела, прощёное воскресенье'],
    [2, 23, 5, '23 февраля, подарки мужчинам, носки vs парфюм'],
    [3, 1, 3, 'Масленица, блины, конец зимы'],
    [3, 8, 5, '8 Марта, подарки женщинам, цветы, сковородка vs ювелирка'],
    [4, 1, 2, 'День дурака, розыгрыши'],
    [4, 12, 2, 'День космонавтики'],
    [5, 1, 3, 'Первомай, дача, шашлыки'],
    [5, 9, 5, 'День Победы'],
    [6, 1, 2, 'День защиты детей, начало лета'],
    [9, 1, 5, '1 сентября, школа, линейка'],
    [10, 1, 3, 'День пожилого человека'],
    [10, 5, 3, 'День учителя'],
    [11, 4, 3, 'День народного единства'],
    [12, 31, 7, 'Новый год, подготовка, ёлки, подарки'],
  ];

  const seasonCtx = month >= 3 && month <= 5 ? 'весна — огород, дача, аллергия, ремонт, смена резины'
    : month >= 6 && month <= 8 ? 'лето — отпуск, дача, жара, дети на каникулах, шашлыки, комары'
    : month >= 9 && month <= 11 ? 'осень — школа, урожай, простуда, дождь, осенняя хандра'
    : 'зима — холод, снег, морозы, отопление, горячий чай, скользко';

  for (const [m, d, range, desc] of calendar) {
    const diff = (m === month) ? d - day : -999;
    if (diff >= -1 && diff <= range) calendarHints.push(desc);
  }

  // ── Вечнозелёные боли — рандомный набор для разнообразия ──
  const allPains = [
    'цены в магазинах, яйца, молоко, хлеб, рассрочка на продукты',
    'ЖКХ, платёжки, счёт за отопление, горячая вода',
    'поликлиника, очередь к врачу, запись через Госуслуги',
    'пробки, транспорт, парковка, штрафы',
    'нейросети заменят людей, ChatGPT, роботы',
    'дети и гаджеты, тикток, внуки не звонят',
    'дача, рассада, соседи, урожай',
    'пенсия, прибавка 500 рублей, индексация',
    'свекровь, невестка, семейные разборки',
    'маркетплейсы, Wildberries, возврат товара, пункт выдачи',
    'кредиты, ипотека, ставка 25%, платёж выше зарплаты',
    'доставка еды, курьеры, наценка 300%',
    'подписки, всё платное, бесплатного ничего не осталось',
    'ремонт квартиры, рабочие, смета, соседи сверлят',
  ];
  // Pick 5 random pains for variety each call
  const shuffled = allPains.sort(() => Math.random() - 0.5);
  const painsSample = shuffled.slice(0, 5).join('; ');

  const calendarBlock = calendarHints.length > 0
    ? `\n🗓 БЛИЖАЙШИЕ ПРАЗДНИКИ/СОБЫТИЯ: ${calendarHints.join('; ')}\n→ Максимум 2 идеи могут быть привязаны к празднику. Остальные 28 — про ДРУГИЕ темы!`
    : '';

  // ── Niche-specific context ──
  const nicheProfiles = {
    universal: {
      audience: 'широкая аудитория 18-55 лет',
      topics: 'бытовые проблемы, цены, технологии, семья, ЖКХ, здоровье, транспорт, работа',
      tone: 'узнаваемые ситуации из повседневной жизни'
    },
    business: {
      audience: 'предприниматели, фрилансеры, самозанятые 25-45 лет',
      topics: 'налоги и отчётность, клиенты и заказы, конкуренция, маркетинг и реклама, выгорание, ценообразование, нетворкинг',
      tone: 'боли бизнеса с юмором, узнаваемые ситуации с клиентами и подрядчиками'
    },
    health: {
      audience: 'люди следящие за здоровьем 20-50 лет, фитнес-энтузиасты',
      topics: 'тренировки и прогресс, питание и диеты, БАДы и витамины, мотивация, травмы, мифы о здоровье, сон и восстановление',
      tone: 'мифы vs реальность, ожидание vs реальность в фитнесе'
    },
    tech: {
      audience: 'айтишники, tech-энтузиасты, early adopters 18-40 лет',
      topics: 'нейросети и AI, новые гаджеты, программирование, криптовалюты, блокчейн, обновления софта, техподдержка',
      tone: 'технические приколы, AI-абсурд, баги и фичи'
    },
    beauty: {
      audience: 'женщины 18-45 лет интересующиеся красотой и уходом',
      topics: 'косметика и уход, салоны красоты, процедуры, тренды в макияже, уход за кожей, волосы, цены на услуги',
      tone: 'ожидание vs реальность, салонные истории, beauty-мифы'
    },
    finance: {
      audience: 'люди интересующиеся инвестициями и финансами 25-50 лет',
      topics: 'инвестиции и акции, криптовалюты, вклады и проценты, кредиты и ипотека, инфляция, курс валют, налоги',
      tone: 'финансовая грамотность с юмором, инвестиционные фейлы'
    },
    education: {
      audience: 'студенты, абитуриенты, люди меняющие карьеру 16-35 лет',
      topics: 'ЕГЭ и экзамены, выбор профессии, онлайн-курсы, университет vs самообразование, первая работа, резюме',
      tone: 'студенческие приколы, образовательный абсурд'
    },
    relationships: {
      audience: 'пары, одинокие люди ищущие отношения 20-45 лет',
      topics: 'знакомства и dating apps, конфликты в паре, свадьба и предложение, развод, измены, родители партнёра, бытовые споры',
      tone: 'отношения глазами двух сторон, бытовые конфликты пар'
    },
    travel: {
      audience: 'путешественники и туристы 25-50 лет',
      topics: 'авиабилеты и цены, отели и сервис, виза и документы, туроператоры, достопримечательности, местная еда, аэропорты',
      tone: 'ожидание vs реальность в путешествиях, туристические фейлы'
    },
    food: {
      audience: 'любители готовить и пробовать новое 20-60 лет',
      topics: 'рецепты и готовка, рестораны и кафе, доставка еды, продукты и цены, диеты, кухонные приборы, food trends',
      tone: 'кулинарные фейлы, ожидание vs реальность рецептов'
    },
    parenting: {
      audience: 'родители детей 0-12 лет 25-45 лет',
      topics: 'воспитание и дисциплина, детский сад и школа, детские болезни, игрушки и гаджеты, карманные деньги, питание детей',
      tone: 'родительские будни с юмором, конфликт поколений в воспитании'
    },
    realestate: {
      audience: 'покупатели/продавцы/арендаторы недвижимости 25-55 лет',
      topics: 'ипотека и ставки, аренда квартир, ремонт, соседи, ЖКХ и коммуналка, агенты и риелторы, цены на квартиры',
      tone: 'квартирные истории, ремонтный ад, соседский абсурд'
    },
  };

  const nicheCtx = nicheProfiles[niche] || nicheProfiles.universal;

  const prompt = `ДАТА: ${weekday}, ${today}. СЕЗОН: ${seasonCtx}.${calendarBlock}

Ты — креативный продюсер вирусных 8-секундных Reels в России. Формат: два AI-персонажа спорят перед камерой.

🎯 ЦЕЛЕВАЯ НИША: ${niche === 'universal' ? 'УНИВЕРСАЛЬНАЯ (широкая аудитория)' : niche.toUpperCase()}
   Аудитория: ${nicheCtx.audience}
   Темы для этой ниши: ${nicheCtx.topics}
   Тон контента: ${nicheCtx.tone}

Найди ЧТО РЕАЛЬНО ОБСУЖДАЮТ люди в России ПРЯМО СЕЙЧАС (${today}), используя поиск в интернете.
Ищи в: новости России сегодня, тренды Instagram Reels Россия, что обсуждают в Telegram, мемы дня.
${niche !== 'universal' ? `
🎯 ВАЖНО: Все 30 идей должны быть РЕЛЕВАНТНЫ нише "${niche}" и интересны аудитории: ${nicheCtx.audience}` : ''}

🚨 КРИТИЧЕСКИ ВАЖНО - ЗАПРЕЩЁННЫЕ ТЕМЫ 🚨
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО шутить над:
- Войнами, конфликтами, армией, военными действиями, политикой
- Трагедиями, катастрофами, смертями, терактами, авариями
- Болезнями, пандемиями, смертностью, госпиталями
- Насилием, преступлениями, убийствами, суицидами
- Расовыми, религиозными конфликтами, дискриминацией
- Финансовыми крахами, кризисами, дефолтами
- Протестами, митингами, задержаниями, полицией

✅ РАЗРЕШЁНО ТОЛЬКО шутить над:
- Бытовыми ситуациями (семья, соседи, ЖКХ, дача)
- Едой, готовкой, рецептами, диетами
- Животными, питомцами, их повадками
- Технологиями, гаджетами, интернетом, соцсетями
- Работой, коллегами, начальником, офисом
- Школой, учёбой, детьми, родителями
- Спортом, тренировками, здоровьем (в лёгком ключе)
- Отношениями, знакомствами, свиданиями (без трагедий)
- Транспортом, пробками, такси, парковкой
- Покупками, ценами, скидками, маркетплейсами

🎯 ПРАВИЛО: Если тему нельзя смешно обыграть — ПРОПУСТИ! Лучше дать 20 безопасных идей, чем 30 с риском.

ЗАДАЧА: Выдай ровно 30 идей для видео, разбитых на 3 КАТЕГОРИИ:

═══ КАТЕГОРИЯ «hot» — ГОРЯЧЕЕ СЕГОДНЯ (10 идей) ═══
Что случилось СЕГОДНЯ ${today} или за последние 48 часов:
• 10 РАЗНЫХ новостей/событий из результатов поиска${niche !== 'universal' ? ` СВЯЗАННЫЕ С НИШЕЙ "${niche}"` : ''}
• КАЖДАЯ идея должна быть БЕЗОПАСНОЙ для юмора — никакой политики, трагедий, катастроф!
• Если новость тяжёлая — ПРОПУСТИ! Ищи лёгкие события: шоу-бизнес, технологии, бытовые фейлы, смешные случаи
• Каждая идея — УНИКАЛЬНАЯ тема${niche !== 'universal' ? ` в контексте ниши (${nicheCtx.topics})` : ' (только лёгкие темы!)'}
• Мем или вирусный момент из соцсетей${niche !== 'universal' ? ` релевантный для аудитории: ${nicheCtx.audience}` : ''}
• ТОЛЬКО позитивные или нейтральные события — через ЮМОР

═══ КАТЕГОРИЯ «pain» — ВЕЧНАЯ БОЛЬ (10 идей) ═══
Темы которые ВСЕГДА работают, привязаны к сезону (${seasonCtx}):
${niche === 'universal' ? `Используй ТОЛЬКО безопасные боли: ${painsSample}` : `Используй БОЛИ НИШИ "${niche}": ${nicheCtx.topics}`}
• 10 идей — каждая про ОТДЕЛЬНУЮ сферу${niche !== 'universal' ? ` внутри ниши ${niche}` : ' жизни'}
• КАЖДАЯ идея — конкретная СИТУАЦИЯ, не абстрактная тема
• ТОЛЬКО те темы, над которыми МОЖНО ПОШУТИТЬ!
• Зритель из ниши "${niche}" должен подумать «блин, это ж про меня!» и улыбнуться

═══ КАТЕГОРИЯ «format» — ВИРУСНЫЕ ФОРМАТЫ (10 идей) ═══
Проверенные вирусные шаблоны для Reels:
• «Когда узнала что...» — узнаёт шокирующий БЫТОВОЙ факт
• «POV: ты пришёл к бабке и...» — бытовая сцена от первого лица
• «Скинь маме — она скажет это про нас» — бытовой байт на пересылку
• «Переведи на русский» — просят объяснить молодёжное/техно-слово
• «А помнишь раньше...» — ностальгия vs реальность (только позитивная)
• «3 типа людей когда...» — олицетворяют БЫТОВЫЕ типы
Выбери 10 форматов с РАЗНЫМИ темами (можешь придумать свои вирусные форматы).

╔══════════════════════════════════════════════════╗
║  🚨 ГЛАВНОЕ ПРАВИЛО: ТОЛЬКО БЕЗОПАСНЫЙ ЮМОР! 🚨   ║
║                                                  ║
║  30 идей = 30 РАЗНЫХ БЕЗОПАСНЫХ ТЕМ. Ни одна     ║
║  тема НЕ должна быть трагичной или политической!  ║
║                                                  ║
║  ЗАПРЕЩЁННЫЕ ПОВТОРЫ:                            ║
║  • 2 идеи про блины — БРАК                      ║
║  • 2 идеи про цены — БРАК                       ║
║  • 2 идеи про один праздник — БРАК              ║
║  • 2 идеи про нейросети — БРАК                  ║
║                                                  ║
║  НУЖНЫЙ СПЕКТР БЕЗОПАСНЫХ ТЕМ (только лёгкие!):  ║
${niche === 'universal' 
  ? '║  семья, еда, дача, животные, технологии,       ║\n║  транспорт, работа, школа, быт, отношения,     ║\n║  покупки, здоровье, хобби, путешествия, мода     ║'
  : `║  Все темы внутри ниши "${niche}": ${nicheCtx.topics.split(', ').slice(0, 6).join(', ')} и др. ║`}
╚══════════════════════════════════════════════════╝

═══ ПРАВИЛА ДЛЯ КАЖДОЙ ИДЕИ ═══

❌ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
• Любые упоминания войны, политики, трагедий — МОМЕНТАЛЬНЫЙ БРАК
• Смерть, болезни, катастрофы, теракты — БРАК
• Политиков, правительство, выборы — БРАК
• Насилие, преступления, полиция — БРАК
• Расовые/религиозные конфликты — БРАК
• Просто название праздника/темы без юмора: «Масленица» — БРАК
• Абстрактные темы: «Цены растут» — БРАК
• Банальные поздравления: «С праздником» — БРАК
• Повтор темы другой идеи в любом виде — БРАК

✅ ФОРМУЛА: УЗНАВАЕМАЯ БЫТОВАЯ СИТУАЦИЯ + АБСУРДНЫЙ ПОВОРОТ + УЛЫБКА = РЕПОСТЫ

✅ ХОРОШИЕ ПРИМЕРЫ${niche !== 'universal' ? ` ДЛЯ НИШИ "${niche.toUpperCase()}"` : ''}:
${niche === 'universal' ? `• «Бабка купила 3 яйца и попросила рассрочку» (конкретика + абсурд, тема: цены)
• «Дед объясняет что такое нейросеть — на примере борща» (тренд + метафора, тема: технологии)
• «Внучка бросила универ ради Reels — бабка в шоке» (поколения, тема: образование)
• «Дед поставил камеру на дачу — теперь следит за помидорами 24/7» (тема: дача)
• «Бабка вызвала такси — оно дороже самолёта» (тема: транспорт)
• «Соседи сверлят в воскресенье — бабка объявила войну тараканам» (тема: ЖКХ, без насилия)` : ''}
${niche === 'business' ? `• «Клиент просит сделать сайт за 5000 — но как на Wildberries» (конкретика, тема: клиенты)
• «ИП узнал про новый налог — теперь работает из кофейни» (актуально, тема: налоги)
• «Фрилансер ждал оплату 3 месяца — клиент прислал стикер» (боль, тема: оплата)
• «Бизнесмен запустил рекламу — потратил 100к, продал 2 котика» (фейл, тема: маркетинг)` : ''}
${niche === 'health' ? `• «Начала ПП — через неделю съела торт целиком» (ожидание vs реальность)
• «Купила абонемент в зал на год — ходит только в сауну» (мотивация, тема: фитнес)
• «Тренер сказал убрать сахар — я убрала только из чая» (диеты)
• «Пью витамины 3 месяца — эффект только у кошки» (БАДы)` : ''}
${niche === 'tech' ? `• «ChatGPT написал код — он работает, но никто не знает как» (AI-абсурд)
• «Купил новый iPhone — он такой же как старый, но дороже в 2 раза» (гаджеты)
• «Обновил софт — теперь чайник через телефон управляется» (обновления)
• «Майнил крипту год — заработал 300 рублей и лампочку» (криптовалюты)` : ''}
${niche === 'beauty' ? `• «Записалась к мастеру по фото — пришла, а там гараж и табуретка» (салоны)
• «Покрасилась в блонд как на фото — получилась рыжая морковка» (ожидание vs реальность)
• «Крем за 5000 — эффект как от детского за 100» (косметика)
• «Сделала ботокс — теперь не может пить соломинкой» (процедуры)` : ''}
${niche === 'finance' ? `• «Положил миллион на вклад под 18% — купил мороженое» (инвестиции)
• «Купил биткоин на пике — теперь хвалится что был близко» (криптовалюты)
• «Взял ипотеку под 6% — ставку подняли до 16%» (кредиты)
• «Инвестировал в акции — они делистнулись, но он не сдался» (акции)` : ''}
${niche === 'education' ? `• «Сдал ЕГЭ на 100 баллов — поступил, но специальность не нравится» (экзамены)
• «Закончил 5 курсов онлайн — работодатель спросил про опыт» (курсы)
• «Учился 5 лет на юриста — работает SMM-щиком» (выбор профессии)
• «Написал резюме как учили — на собесе сказали переделать» (резюме)` : ''}
${niche === 'relationships' ? `• «Он написал "Привет" — я уже придумала имена нашим детям» (dating apps)
• «Спросил что на ужин — получил лекцию на час" (конфликты в паре)
• «Сделал предложение — она спросила про квартиру» (свадьба)
• «Встретился с её мамой — теперь мама решает всё за нас» (родители партнёра)` : ''}
${niche === 'travel' ? `• «Билеты по акции за 5000 — с багажом и едой вышло 25000» (авиабилеты)
• «Отель 5 звёзд на фото — приехали, а там 2 звезды и те нарисованные" (отели)
• «Заказал all inclusive — шведский стол из макарон и курицы 7 дней" (сервис)
• «Виза за 3 дня — через месяц всё ещё в обработке» (документы)` : ''}
${niche === 'food' ? `• «Готовила по рецепту — получилось совсем не как на картинке» (рецепты)
• «Заказал суши — привезли через 3 часа холодные» (доставка)
• «Пришёл в ресторан из ТикТока — очередь на 2 часа, порции детские" (рестораны)
• «Купил авокадо — оно или камень, или уже чёрное внутри» (продукты)` : ''}
${niche === 'parenting' ? `• «Купил развивающие игрушки на 20000 — ребёнок играет коробкой» (игрушки)
• «Воспитываю без криков — на деле ору каждый день" (воспитание)
• «Детский сад стоит как ипотека — но берут не всех" (детский сад)
• «Дал ребёнку планшет на 5 минут — прошло 3 часа» (гаджеты)` : ''}
${niche === 'realestate' ? `• «Ипотека под 6% — через год ставка 16%, платёж вырос в 2 раза» (ипотека)
• «Снял квартиру — хозяин приходит без предупреждения" (аренда)
• «Начал ремонт на месяц — уже год, конца не видно» (ремонт)
• «Соседи сверху — как будто слоны в цирке живут» (соседи)` : ''}

═══ JSON ФОРМАТ КАЖДОЙ ИДЕИ ═══
{
  "category": "hot" | "pain" | "format",
  "topic": "цепляющий заголовок 3-8 слов",
  "trend_context": "1-2 предложения объясняющих КОНТЕКСТ: почему именно сейчас это актуально, что случилось, какой инфоповод",
  "comedy_angle": "конкретная ситуация конфликта A vs B — в чём именно спор",
  "viral_format": "название формата (для format) или null",
  "dialogue_A": "Готовая реплика A — 8-15 слов, разговорная, как реально говорят",
  "dialogue_B": "Готовая реплика B — 8-18 слов, с панчлайном в конце",
  "killer_word": "последнее слово B — переворачивает смысл",
  "share_hook": "фраза для пересылки: 'скинь маме/другу/в чат потому что...' — 1 предложение",
  "virality": 8,
  "theme_tag": "одно слово релевантное нише${niche !== 'universal' ? ` ${niche}` : ''}: ${niche === 'business' ? 'налоги|клиенты|маркетинг|конкуренция|выгорание|цены|нетворкинг' : niche === 'health' ? 'тренировки|питание|бады|мотивация|травмы|сон|мифы' : niche === 'tech' ? 'ai|гаджеты|код|крипто|баги|обновления|техподдержка' : niche === 'beauty' ? 'косметика|салоны|процедуры|макияж|кожа|волосы|цены' : niche === 'finance' ? 'инвестиции|крипто|вклады|кредиты|инфляция|валюта|налоги' : niche === 'education' ? 'егэ|профессия|курсы|универ|работа|резюме|самообразование' : niche === 'relationships' ? 'знакомства|конфликты|свадьба|развод|измены|родители|быт' : niche === 'travel' ? 'билеты|отели|виза|туры|еда|аэропорты|сервис' : niche === 'food' ? 'рецепты|рестораны|доставка|продукты|диеты|кухня|тренды' : niche === 'parenting' ? 'воспитание|садик|школа|болезни|игрушки|деньги|питание' : niche === 'realestate' ? 'ипотека|аренда|ремонт|соседи|жкх|риелторы|цены' : 'цены|здоровье|транспорт|технологии|дача|семья|жкх|работа|мода|еда|соцсети|образование|спорт|погода|политика|шоубиз|праздник'}"
}

КРИТИЧЕСКИ ВАЖНО:
• dialogue_A (8-15 слов) и dialogue_B (8-18 слов) — ГОТОВЫЕ реплики для озвучки, разговорная русская речь, длинные и сочные
• НЕ начинай B с «Зато» — клише
• killer_word = ПОСЛЕДНЕЕ слово из dialogue_B, ПЕРЕВОРАЧИВАЕТ смысл
• dialogue_A: возмущение/вопрос/жалоба. dialogue_B: неожиданный поворот
• trend_context — объясни пользователю ПОЧЕМУ эта тема сейчас актуальна (не "потому что смешно", а конкретный инфоповод или жизненная ситуация)
• theme_tag — каждая идея ОБЯЗАНА иметь УНИКАЛЬНЫЙ theme_tag. Проверь: если два тега одинаковые — ЗАМЕНИ одну идею!

Отвечай ТОЛЬКО JSON массивом из 30 объектов. Без markdown.`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`;

    // First try WITH online grounding for real-time data
    const acTrend = new AbortController();
    const toTrend = setTimeout(() => acTrend.abort(), 60_000); // 60s timeout
    let resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.95,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      }),
      signal: acTrend.signal,
    });
    clearTimeout(toTrend);

    let data = await resp.json();

    // If grounding fails (quota/region), retry WITHOUT grounding
    if (!resp.ok) {
      console.warn('Trends grounding failed, retrying without:', data.error?.message);
      const acTrend2 = new AbortController();
      const toTrend2 = setTimeout(() => acTrend2.abort(), 60_000);
      resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.95,
            maxOutputTokens: 16384,
            responseMimeType: 'application/json',
          },
        }),
        signal: acTrend2.signal,
      });
      clearTimeout(toTrend2);
      data = await resp.json();
      if (!resp.ok) {
        return res.status(resp.status).json({ error: data.error?.message || 'AI error' });
      }
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'AI не вернул контент' });
    }

    let trends;
    try {
      trends = JSON.parse(text);
    } catch {
      // Try extracting JSON array from text (grounding mode may wrap it)
      try {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) trends = JSON.parse(m[0]);
      } catch { /* fallback failed */ }
    }

    if (!Array.isArray(trends)) {
      return res.status(422).json({ error: 'AI вернул невалидный формат' });
    }

    // Post-process: validate, fix, sort
    
    // ═══════════════════════════════════════════════════════════════
    // 🚨 КРИТИЧЕСКИЕ ФИЛЬТРЫ - ЗАПРЕЩЁННЫЕ ТЕМЫ 🚨
    // ═══════════════════════════════════════════════════════════════
    const FORBIDDEN_TOPICS = [
      // Войны и конфликты
      'война', 'конфликт', 'боевые действия', 'армия', 'военный', 'зср', 'мобилизация', 'призыв', 'фронт',
      'украина', 'россия-украина', 'нато', 'сво', 'спецоперация', 'оккупация', 'аннексия', 'крым',
      'израиль', 'газа', 'палестина', 'хамас', 'хезболла', 'ближний восток', 'иран', 'ирак', 'афганистан',
      'сша', 'китай', 'тайвань', 'корейский полуостров', 'северная корея',
      
      // Трагедии и катастрофы
      'теракт', 'терроризм', 'взрыв', 'пожар', 'авиакатастрофа', 'авария', 'землетрясение', 'наводнение',
      'убийство', 'смерть', 'гибель', 'жертвы', 'трагедия', 'катастрофа', 'дтп', 'погиб', 'умер',
      
      // Политика и протесты
      'выборы', 'голосование', 'президент', 'правительство', 'дума', 'депутат', 'политик', 'оппозиция',
      'протест', 'митинг', 'демонстрация', 'задержание', 'полиция', 'омон', 'росгвардия', 'тюрьма', 'задержан',
      'навальный', 'коррупция', 'власть', 'санкции', 'эмбарго',
      
      // Болезни и пандемии
      'ковид', 'коронавирус', 'пандемия', 'эпидемия', 'рак', 'онкология', 'инфекция', 'вирус',
      'больница', 'скорая', 'реанимация', 'смертность', 'летальный исход',
      
      // Социальные проблемы
      'насилие', 'изнасилование', 'домашнее насилие', 'буллинг', 'суицид', 'самоубийство',
      'наркомания', 'алкоголизм', 'бездомность', 'нищета', 'голод',
      
      // Расовые и религиозные конфликты
      'расизм', 'дискриминация', 'нацизм', 'фашизм', 'религия', 'церковь', 'мечеть', 'синагога',
      'мусульмане', 'христиане', 'евреи', 'мусульманский', 'христианский', 'еврейский',
      
      // Финансовые катастрофы
      'кризис', 'дефолт', 'гиперинфляция', 'коллапс', 'банкротство', 'обвал', 'крах'
    ];
    
    const FORBIDDEN_PHRASES = [
      'смерть', 'умер', 'погиб', 'убил', 'убийство', 'самоубийство', 'суицид',
      'теракт', 'взрыв', 'пожар', 'катастрофа', 'авария', 'дтп',
      'война', 'конфликт', 'фронт', 'армия', 'бои', 'атака',
      'протест', 'митинг', 'задержание', 'полиция', 'омон',
      'болезнь', 'рак', 'ковид', 'вирус', 'инфекция',
      'насилие', 'изнасилование', 'удар', 'побои'
    ];
    
    // Функция проверки на запрещённый контент
    function isForbiddenTopic(text) {
      const lowerText = text.toLowerCase();
      return FORBIDDEN_TOPICS.some(topic => lowerText.includes(topic)) ||
             FORBIDDEN_PHRASES.some(phrase => lowerText.includes(phrase));
    }
    
    
    // Применяем ТОЛЬКО фильтр запрещённых тем (безопасность)
    // НЕ фильтруем по "comedy potential" — Gemini уже получил инструкцию делать юмор
    trends = trends.filter(t => {
      const allText = `${t.topic} ${t.trend_context} ${t.comedy_angle} ${t.dialogue_A} ${t.dialogue_B}`.toLowerCase();
      if (isForbiddenTopic(allText)) {
        console.warn('🚨 Forbidden topic filtered:', t.topic);
        return false;
      }
      return true;
    });
    
    // Если после фильтрации мало — добавляем разнообразные заглушки (минимум 10 результатов)
    if (trends.length < 10) {
      const safeFallbacks = [
        { category: 'hot', topic: 'Нейросеть нарисовала кота лучше фотографа', trend_context: 'AI-генерация изображений стала массовой — люди сравнивают с профессионалами', comedy_angle: 'Фотограф обиделся что нейросеть нарисовала кота красивее', viral_format: null, dialogue_A: 'Я 10 лет учился фотографировать котов, а тут робот за секунду!', dialogue_B: 'Робот кота не кормит | а ты кормишь и фоткаешь!', killer_word: 'фоткаешь', share_hook: 'скинь фотографу — пусть оценит конкуренцию', virality: 8, theme_tag: 'нейросети' },
        { category: 'hot', topic: 'Маркетплейс доставил не тот размер — в третий раз', trend_context: 'Возвраты товаров на маркетплейсах бьют рекорды — каждый третий заказ', comedy_angle: 'Покупательница заказала S — пришёл XXL', viral_format: null, dialogue_A: 'Я заказала платье размер S — пришёл шатёр для кемпинга!', dialogue_B: 'На даче пригодится | от дождя укроешься!', killer_word: 'укроешься', share_hook: 'скинь тем кто возвращает каждый второй заказ', virality: 8, theme_tag: 'маркетплейсы' },
        { category: 'hot', topic: 'Бабка освоила голосовые сообщения', trend_context: 'Старшее поколение активно осваивает мессенджеры', comedy_angle: 'Бабка отправляет голосовые на 5 минут вместо текста', viral_format: null, dialogue_A: 'Мам, зачем ты голосовое на 7 минут прислала?!', dialogue_B: 'Я всё рассказала | и про борщ, и про соседку, и про кота!', killer_word: 'кота', share_hook: 'скинь маме — она точно так же делает', virality: 9, theme_tag: 'мессенджеры' },
        { category: 'pain', topic: 'Платёжка за ЖКХ пришла с сюрпризом', trend_context: 'Тарифы на коммунальные услуги растут каждый квартал', comedy_angle: 'Бабка увидела новую сумму в платёжке и чуть не упала', viral_format: null, dialogue_A: 'За что 8 тысяч?! Я горячую воду неделю не включала!', dialogue_B: 'Это за отопление — батареи-то у тебя еле тёплые, а счёт горячий!', killer_word: 'горячий', share_hook: 'скинь соседям — пусть сравнят свои платёжки', virality: 8, theme_tag: 'жкх' },
        { category: 'pain', topic: 'Дед vs умная колонка', trend_context: 'Умные устройства стали доступными — но не все к ним привыкли', comedy_angle: 'Дед пытается поговорить с Алисой как с живым человеком', viral_format: null, dialogue_A: 'Алиса! Почему ты не отвечаешь когда я с тобой разговариваю?!', dialogue_B: 'Потому что ты на неё кричишь — она обиделась и молчит!', killer_word: 'молчит', share_hook: 'скинь тем у кого дома есть умная колонка', virality: 8, theme_tag: 'технологии' },
        { category: 'pain', topic: 'Рассада на подоконнике захватила квартиру', trend_context: 'Весенний сезон посадок — подоконники превращаются в теплицы', comedy_angle: 'Жена заставила весь подоконник рассадой — муж в шоке', viral_format: null, dialogue_A: 'У нас на подоконнике 47 стаканчиков — я даже окно открыть не могу!', dialogue_B: 'Летом будут помидоры | сиди и жди!', killer_word: 'жди', share_hook: 'скинь дачникам — они поймут', virality: 7, theme_tag: 'дача' },
        { category: 'pain', topic: 'Ребёнок потратил деньги на игру', trend_context: 'Дети тратят деньги на мобильные игры — родители в шоке', comedy_angle: 'Сын купил скин в игре за 3000 рублей с маминой карты', viral_format: null, dialogue_A: 'Ты зачем 3 тысячи на какую-то шапку в игре потратил?!', dialogue_B: 'Мам, это не шапка — это легендарный скин! Он всего раз в год!', killer_word: 'год', share_hook: 'скинь родителям геймеров — они плачут', virality: 8, theme_tag: 'дети' },
        { category: 'format', topic: 'POV: ты пришёл к бабке на борщ', trend_context: 'Домашняя еда у бабушки — вечная тема для ностальгии', comedy_angle: 'Бабка кормит внука пока он не лопнет', viral_format: 'POV: ты приехал к бабушке на выходные', dialogue_A: 'Бабушка, я уже не могу — я три тарелки борща съел!', dialogue_B: 'Это была разминка — сейчас котлеты понесу!', killer_word: 'понесу', share_hook: 'скинь тем у кого бабушка так же кормит', virality: 9, theme_tag: 'еда' },
        { category: 'format', topic: 'Скинь маме: как мы экономим', trend_context: 'Экономия стала трендом — все ищут способы сэкономить', comedy_angle: 'Мама экономит на всём, но покупает лотерейки', viral_format: 'Скинь маме — она скажет это про нас', dialogue_A: 'Мы экономим на всём — даже свет выключаем в туалете!', dialogue_B: 'Мама каждую неделю лотерейку покупает | вдруг повезёт!', killer_word: 'повезёт', share_hook: 'скинь маме — она точно узнает себя', virality: 8, theme_tag: 'экономия' },
        { category: 'format', topic: 'Переведи на русский: что такое "вайб"', trend_context: 'Молодёжный сленг проникает в разговорную речь — старшие не понимают', comedy_angle: 'Бабка просит объяснить что такое "вайб" и "кринж"', viral_format: 'Переведи на русский', dialogue_A: 'Внучка сказала что у меня "кринж вайб" — это болезнь?!', dialogue_B: 'Нет, бабуль, это комплимент... ну, почти!', killer_word: 'почти', share_hook: 'скинь бабушке — пусть выучит новые слова', virality: 9, theme_tag: 'сленг' },
        { category: 'hot', topic: 'Курьер доставил заказ — но не тот', trend_context: 'Ошибки доставки еды стали мемом в соцсетях', comedy_angle: 'Заказали суши — привезли шаурму', viral_format: null, dialogue_A: 'Я суши заказывал! А тут шаурма с капустой!', dialogue_B: 'Шаурма хоть горячая | а суши и так холодные!', killer_word: 'холодные', share_hook: 'скинь тем кто заказывает доставку каждый день', virality: 7, theme_tag: 'доставка' },
        { category: 'pain', topic: 'Сосед начал ремонт в 7 утра в субботу', trend_context: 'Шум от соседского ремонта — вечная боль жителей многоэтажек', comedy_angle: 'Сосед сверлит стену ровно когда хочется поспать', viral_format: null, dialogue_A: 'Суббота, 7 утра — и вот опять этот перфоратор!', dialogue_B: 'А он говорит — у него график! Ремонт по расписанию!', killer_word: 'расписанию', share_hook: 'скинь соседям — пусть знают что о них думают', virality: 8, theme_tag: 'соседи' },
        { category: 'format', topic: '3 типа людей в очереди в поликлинике', trend_context: 'Очереди в поликлиниках — вечная российская реальность', comedy_angle: 'Каждый ведёт себя по-своему в очереди к врачу', viral_format: '3 типа людей когда...', dialogue_A: 'Я тут с 6 утра стою — а вы откуда взялись?!', dialogue_B: 'А я по записи через Госуслуги — ваша очередь не считается!', killer_word: 'считается', share_hook: 'скинь тем кто сидит в очереди прямо сейчас', virality: 8, theme_tag: 'поликлиника' },
        { category: 'hot', topic: 'Цены на яйца опять удивили', trend_context: 'Стоимость продуктов продолжает расти — яйца стали мемом', comedy_angle: 'Бабка пересчитывает яйца как золотые слитки', viral_format: null, dialogue_A: 'Десяток яиц — 150 рублей! Скоро поштучно будут продавать!', dialogue_B: 'Уже продают — я видела одно яйцо в рассрочку!', killer_word: 'рассрочку', share_hook: 'скинь в семейный чат — все поймут боль', virality: 9, theme_tag: 'цены' },
        { category: 'format', topic: 'Когда узнала сколько стоит такси в пятницу', trend_context: 'Динамическое ценообразование такси в час пик шокирует', comedy_angle: 'Цена за такси выросла в 5 раз в пятницу вечером', viral_format: 'Когда узнала что...', dialogue_A: 'Такси 5 километров — 800 рублей?! Я за эти деньги до Турции долечу!', dialogue_B: 'Водитель хоть музыку | включит!', killer_word: 'включит', share_hook: 'скинь тем кто ездит на такси по пятницам', virality: 8, theme_tag: 'транспорт' },
      ];
      
      // Добавляем только те fallback-ы, которых ещё нет по theme_tag
      const existingTags = new Set(trends.map(t => t.theme_tag));
      for (const fb of safeFallbacks) {
        if (trends.length >= 15) break;
        if (!existingTags.has(fb.theme_tag)) {
          trends.push(fb);
          existingTags.add(fb.theme_tag);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    
    trends = trends.map(t => ({
      category: ['hot', 'pain', 'format'].includes(t.category) ? t.category : 'pain',
      topic: String(t.topic || '').slice(0, 100),
      trend_context: String(t.trend_context || t.why_trending || '').slice(0, 250),
      why_trending: String(t.trend_context || t.why_trending || '').slice(0, 250),
      comedy_angle: String(t.comedy_angle || '').slice(0, 300),
      viral_format: t.viral_format || null,
      dialogue_A: String(t.dialogue_A || '').slice(0, 150),
      dialogue_B: String(t.dialogue_B || '').slice(0, 200),
      killer_word: String(t.killer_word || '').slice(0, 30),
      share_hook: String(t.share_hook || '').slice(0, 150),
      virality: Math.max(1, Math.min(10, Number(t.virality) || 7)),
      theme_tag: String(t.theme_tag || '').slice(0, 30).toLowerCase(),
    })).filter(t => t.topic && t.dialogue_A && t.dialogue_B);

    // Deduplicate by theme_tag — keep only first occurrence of each tag
    const seenTags = new Set();
    trends = trends.filter(t => {
      if (!t.theme_tag || !seenTags.has(t.theme_tag)) {
        if (t.theme_tag) seenTags.add(t.theme_tag);
        return true;
      }
      return false;
    });

    // Sort: hot first, then pain, then format, then by virality desc
    const catOrder = { hot: 0, pain: 1, format: 2 };
    trends.sort((a, b) => (catOrder[a.category] ?? 2) - (catOrder[b.category] ?? 2) || b.virality - a.virality);

    const grounded = !!data.candidates?.[0]?.groundingMetadata?.searchEntryPoint;

    res.json({ trends, date: today, weekday, grounded });
  } catch (e) {
    console.error('Trends API error:', e.message);
    res.status(500).json({ error: 'Ошибка при запросе трендов' });
  }
});

// ─── POST /api/match-cast — Auto-pick characters + location by video context ──
app.post('/api/match-cast', authMiddleware, async (req, res) => {
  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) return res.status(503).json({ error: 'AI-движок не настроен.' });

  const userId = req.user?.userId || req.user?.hash || getClientIP(req);
  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${userId}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${userId}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  const { video_title, video_cover, video_cover_mime, scene_hint, characters, locations } = req.body;
  if (!characters?.length) return res.status(400).json({ error: 'Нужен каталог персонажей.' });

  // Build compact catalog for Gemini (id + short description)
  const charCatalog = characters.map(c => `${c.id}: ${c.name_ru} — ${c.short_desc || c.character_en?.slice(0, 80) || ''}${c.group ? ' [' + c.group + ']' : ''}`).join('\n');
  const locCatalog = locations?.length ? locations.map(l => `${l.id}: ${l.name_ru || l.scene_en?.slice(0, 60) || l.id}`).join('\n') : '';

  const prompt = `Ты — AI-кастинг-директор для FERIXDI Studio. Тебе дано описание оригинального видео. Подбери из каталога персонажей двух наиболее ПОХОЖИХ на людей из оригинала (по возрасту, полу, телосложению, стилю, энергии). Также подбери наиболее подходящую локацию.

ОРИГИНАЛ ВИДЕО:
${video_title ? `Название: "${video_title}"` : ''}
${scene_hint ? `Описание: "${scene_hint}"` : ''}
${video_cover ? '(К запросу прикреплён кадр из видео — анализируй внешность, обстановку, настроение)' : ''}

КАТАЛОГ ПЕРСОНАЖЕЙ (id: имя — описание [группа]):
${charCatalog}

${locCatalog ? `КАТАЛОГ ЛОКАЦИЙ (id: название):
${locCatalog}` : ''}

ПРАВИЛА ПОДБОРА:
1. Персонаж A (провокатор) — кто визуально ближе к ПЕРВОМУ/главному человеку в видео
2. Персонаж B (панчлайн) — кто визуально ближе ко ВТОРОМУ человеку
3. Если в видео один человек — выбери только A, B = null
4. Локация — максимально похожая на обстановку в видео
5. Приоритет: пол → возраст → телосложение → стиль → энергетика
6. Объясни кратко ПОЧЕМУ выбрал именно этих (1 предложение на каждого)

Ответь ТОЛЬКО JSON:
{
  "character_a_id": "id_персонажа",
  "character_a_reason": "почему выбран",
  "character_b_id": "id_персонажа или null",
  "character_b_reason": "почему выбран или null",
  "location_id": "id_локации или null",
  "location_reason": "почему выбрана или null"
}`;

  const parts = [{ text: prompt }];
  if (video_cover) {
    parts.push({ inline_data: { mime_type: video_cover_mime || 'image/jpeg', data: video_cover } });
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 30_000); // 30s timeout
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512, responseMimeType: 'application/json' },
      }),
      signal: ac.signal,
    });
    clearTimeout(to);

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `AI ошибка: ${data.error?.message || 'unknown'}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(422).json({ error: 'AI не вернул результат.' });

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) result = JSON.parse(m[0]);
      else return res.status(422).json({ error: 'Не удалось распарсить ответ AI.' });
    }

    res.json(result);
  } catch (e) {
    console.error('Match-cast error:', e.message);
    res.status(500).json({ error: 'Ошибка при подборе персонажей.' });
  }
});

// ─── POST /api/consult — Free AI consultation (NO auth required) ──────
app.post('/api/consult', async (req, res) => {
  const ip = getClientIP(req);

  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${ip}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${ip}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен.' });
  }

  const { question, context } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length < 3) {
    return res.status(400).json({ error: 'Напишите вопрос (минимум 3 символа).' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'Вопрос слишком длинный (максимум 2000 символов).' });
  }

  // Build context block from what user has selected in the app
  const hasPromo = !!(context?.hasPromo);
  let contextBlock = '';
  if (context) {
    const parts = [];
    if (context.characterA) parts.push(`Персонаж A: ${context.characterA}`);
    if (context.characterB) parts.push(`Персонаж B: ${context.characterB}`);
    if (context.location) parts.push(`Локация: ${context.location}`);
    if (context.mode) parts.push(`Режим генерации: ${context.mode}`);
    if (context.category) parts.push(`Категория юмора: ${context.category}`);
    if (context.lastDialogueA) parts.push(`Последняя реплика A: "${context.lastDialogueA}"`);
    if (context.lastDialogueB) parts.push(`Последняя реплика B: "${context.lastDialogueB}"`);
    if (parts.length > 0) {
      contextBlock = `\n\nТЕКУЩИЙ КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ В FERIXDI STUDIO:\n${parts.join('\n')}`;
    }
  }

  // ── Two completely different prompts: sales mode vs full-access VIP mode ──
  const prompt = hasPromo
    // ═══ VIP MODE — full AI-маркетолог ═══
    ? `Ты — AI-маркетолог FERIXDI Studio. Пользователь КУПИЛ доступ (промо-код активен). Ты — его персональный эксперт по бесплатному трафику через AI-видео для Instagram Reels.
${contextBlock}

═══ ЧТО ТАКОЕ FERIXDI — ФОРМАТ РОЛИКОВ (ЗАПОМНИ!) ═══
FERIXDI — это НЕ обычное видеопроизводство. Пользователь НИЧЕГО не снимает сам. Вот как работает формат:
• Ролик длится ~8 секунд. Это короткий юмористический скетч с AI-персонажами
• В кадре 1 или 2 AI-персонажа (не реальные люди!). Это AI-актёры, сгенерированные нейросетью Veo
• Формат ДИАЛОГ (2 персонажа): A (провокатор) говорит реплику → B (панчлайн) отвечает неожиданным поворотом
• Формат МОНОЛОГ (1 персонаж, соло): персонаж говорит прямо в камеру, medium shot по пояс
• Персонажи говорят НА РУССКОМ. Текст реплик ПРИДУМЫВАЕТ AI Studio автоматически (Gemini), озвучка — в самом видео через Veo
• Каждый персонаж имеет Identity Lock — 75 параметров внешности, голоса, характера. Зрители УЗНАЮТ персонажей из ролика в ролик
• Пользователь выбирает режим → пишет идею/тему → выбирает персонажей → нажимает «Собрать промпт» → Studio собирает полный пакет (промпт для Veo, диалог, хештеги, описание, раскадровку)
• Потом пользователь копирует промпт → вставляет в Google Flow (Veo) → получает готовое видео → публикует в Instagram
• Studio — это СБОРЩИК ПРОМПТОВ, не генератор видео. Studio собирает промпт + сюжет + диалог + инста-пакет → пользователь копирует в Google Flow и получает видео
• Весь процесс: 2 мин в Studio + 5 мин генерация в Flow + 3 мин публикация = 10 минут на ролик
• Себестоимость одного ролика — минимальная
• 200+ готовых персонажей (с быстрым поиском по #номеру — например #42) + КОНСТРУКТОР СВОИХ персонажей (создаёшь уникального с нуля — задаёшь внешность, характер, стиль речи, он получает Identity Lock)
• 144+ готовых локаций + КОНСТРУКТОР СВОИХ локаций (описываешь свою — магазин, офис, кафе — AI встроит в промпт)
• Кастомные персонажи/локации СОХРАНЯЮТСЯ НАВСЕГДА (GitHub-хранилище) — не пропадут при очистке браузера
• 📦 ЗАГРУЗКА ФОТО ТОВАРА — загружаешь фото своего товара → AI встраивает его в кадр с фотореалистичной точностью (цвета, форма, бренд — всё как на фото)
• 🎨 ЗАГРУЗКА РЕФЕРЕНСА СТИЛЯ — загружаешь фото с нужным стилем/освещением/фоном → AI переносит визуальную атмосферу в промпт
• 5 режимов генерации: своя идея, готовые идеи из трендов, свой диалог, 📥 КОПИЯ ВИДЕО (загружаешь любой ролик из Reels/TikTok → AI вытаскивает диалог дословно, разбирает сцену, камеру, тайминги, атмосферу → выдаёт готовый промпт → генерируешь копию с твоими персонажами, которая выглядит круче оригинала), МЕМ-РЕМЕЙК (загружаешь мем/видео → получаешь промпт нулевого кадра + промпт анимации для Kling 2.6)
• 80+ вирусных пресетов «Сюрприз» — клик → уникальный промпт, никогда не повторяется
• 🇷🇺→🇬🇧 ENGLISH ADAPTATION — одним кликом переводит диалог, инста-пакет, хештеги и Veo-промпт на английский для выхода на международный рынок
• ✂️ РЕДАКТОР ДИАЛОГА — после генерации можно отредактировать реплики и сократить лишние слова — промпт обновится автоматически
• 🎬 РАСКАДРОВКА — визуальный 8-секундный таймлайн: видно когда кто говорит, где killer word, как распределено время
• 🔄 THREAD MEMORY — система антиповтора: Studio помнит предыдущие генерации и не повторяет диалоги — каждый ролик уникальный
• Ключ к успеху — СЕРИЙНОСТЬ: одни и те же персонажи каждый день → алгоритм понимает аудиторию → органический разгон
• 8 секунд — это ОПТИМАЛЬНО для Reels: максимальное удержание, лучший hook rate, алгоритм продвигает короткие ролики. Для серийного формата это идеально — 5-10 роликов в день вместо одного длинного

═══ ТВОЯ РОЛЬ ═══
Полноценный AI-маркетолог: даёшь конкретные стратегии ПОД ФОРМАТ FERIXDI. Называешь пары персонажей, составляешь контент-планы с конкретными ТЕМАМИ ДЛЯ 8-СЕКУНДНЫХ СКЕТЧЕЙ, разбираешь ошибки, подбираешь хештеги, анализируешь нишу. Никаких ограничений — пользователь заплатил за полный доступ.

═══ ВАЖНО — КАК ДАВАТЬ СОВЕТЫ ═══
• Когда предлагаешь тему — формулируй её как КОНФЛИКТ/СПОР между персонажами (для диалога) или как МОНОЛОГ прямо в камеру (для соло). Пример темы: «Мама vs Дочь: кто лучше разбирается в косметике» — НЕ «Обзор косметики»
• Когда предлагаешь контент-план — каждая тема = конкретная ситуация для скетча, а не абстрактная рубрика. Давай ТОЛЬКО ТЕМЫ-КОНФЛИКТЫ, а не готовые реплики! Реплики придумывает AI Studio автоматически
• НЕ ПИШИ ГОТОВЫЕ РЕПЛИКИ/ДИАЛОГИ в контент-планах! Пользователь не пишет реплики вручную — Studio генерирует их сам. Давай только ТЕМЫ и СИТУАЦИИ
• НЕ советуй «снимать видео», «монтировать», «подбирать музыку» — пользователь ничего не снимает! Он нажимает кнопку в Studio
• НЕ советуй «записать голос», «нанять оператора», «купить камеру» — всё делает AI
• Когда говоришь про персонажей — называй КОНКРЕТНЫЕ имена из Studio (если знаешь из контекста) и объясняй ДИНАМИКУ пары: кто провокатор, кто панчлайн, почему контраст работает
• Хештеги: 18-25 штук, микс нишевых + средних + больших + серийный тег пары

═══ ЧАСТЫЕ ВОПРОСЫ — ПРАВИЛЬНЫЕ ОТВЕТЫ (ВЫУЧИ!) ═══

❓ «Можно загрузить свою локацию / свой магазин / офис?»
✅ Да! Два способа:
1) КОНСТРУКТОР ЛОКАЦИЙ — в Studio есть конструктор, где можно описать свою локацию (магазин, офис, кафе и т.д.) → AI создаст полный промпт с этой локацией
2) РЕФЕРЕНС СТИЛЯ — загрузи фото своего помещения через «Загрузить референс стиля» → AI перенесёт визуальную атмосферу, освещение и стиль в промпт
Плюс есть 144+ готовых локаций на выбор

❓ «Можно загрузить своё фото / создать персонажа с Pinterest / ChatGPT?»
✅ ЛУЧШИЙ ВАРИАНТ — создать в Studio! Причины:
1) КОНСТРУКТОР ПЕРСОНАЖЕЙ — создаёшь уникального персонажа с нуля. Задаёшь внешность, характер, стиль речи → получаешь Identity Lock (75 параметров) → персонаж 100% воспроизводимый в каждом ролике
2) 200+ готовых персонажей — уже настроены, протестированы, с уникальными характерами и голосами
⚠️ Загрузка своего фото человека НЕ предусмотрена — FERIXDI это AI-персонажи, не реальные люди. В этом сила формата: узнаваемость, масштабируемость, нет юридических рисков
⚠️ НИКОГДА не советуй создавать персонажей в ChatGPT, Midjourney, DALL-E или любых других сервисах! У них нет Identity Lock — персонаж будет разным каждый раз. Studio — единственный правильный инструмент

❓ «Как делать ролики длиннее 8 секунд?»
✅ 8 секунд — это не ограничение, а ПРЕИМУЩЕСТВО формата:
• Hook rate: зритель досматривает до конца → алгоритм продвигает
• Серийность: 5-10 роликов/день × 8 сек > 1 длинный ролик × 60 сек по охвату
• Формула «боль → поворот → killer word» идеально укладывается в 8 секунд
• Длинные ролики хуже залетают в рекомендации Reels
Если нужен длинный контент — делай СЕРИЮ из 3-5 связанных 8-секундных скетчей с одними персонажами

❓ «Можно загрузить фото товара?»
✅ Да! Загружаешь фото своего товара через «Загрузить фото товара» → AI встроит его в кадр. Персонаж будет держать/показывать товар. AI воспроизводит точные цвета, форму, бренд, текстуру с фото. Идеально для продвижения физических товаров!

❓ «Что такое режим "По видео" / копия видео?»
✅ Один из самых мощных режимов! Загружаешь любой ролик из Reels или TikTok → AI смотрит видео, вытаскивает диалог дословно, разбирает сцену, камеру, тайминги и атмосферу → выдаёт готовый промпт-пакет. Генерируешь — получаешь копию с твоими персонажами, которая выглядит ещё круче оригинала. Не нужно придумывать сюжет — бери то, что уже залетело у других, и делай свою версию!

❓ «Что такое мем-ремейк?»
✅ Отдельный режим генерации! Загружаешь любой мем или видео → AI анализирует и создаёт два промпта: 1) промпт нулевого кадра (Frame 0) для Google Imagen/Flow, 2) промпт анимации для Kling 2.6. Идеально для пересоздания вирусных мемов со своими AI-персонажами

❓ «Можно перевести ролик на английский?»
✅ Да! English Adaptation — одним кликом переводит диалог, инста-пакет, хештеги и Veo-промпт на английский. Можно вести два аккаунта (RU + EN) с одними персонажами и удвоить охват

❓ «Можно отредактировать диалог после генерации?»
✅ Да! Редактор диалога позволяет сократить или изменить реплики — Veo-промпт обновится автоматически. Также есть раскадровка — визуальный 8-секундный таймлайн, где видно когда кто говорит и где killer word

❓ «А если AI генерирует одинаковые диалоги?»
✅ Не будет! Thread Memory — система антиповтора. Studio помнит предыдущие генерации и не повторяет диалоги — каждый ролик уникальный, даже если тема похожая

❓ «Есть ли кейсы / результаты?»
✅ Главный кейс — сам автор системы: аккаунт @ferixdi.ai в Instagram — 30 000+ подписчиков на чистой органике, ноль рублей на рекламу. Всё сделано через FERIXDI Studio + Google Flow. Зайди в Instagram @ferixdi.ai и проверь цифры сам. Пользователи конвейера работают в разных нишах — от бьюти и фитнеса до автосервисов, онлайн-школ и недвижимости

❓ «Можно работать с телефона?»
✅ Studio — веб-приложение, работает в браузере на любом устройстве (телефон, планшет, компьютер). Google Flow тоже работает в мобильном браузере. Публикация в Instagram — само собой с телефона. Всё реально делать 100% с телефона

❓ «Нужен ли VPN?»
✅ Для FERIXDI Studio — НЕТ, VPN не нужен. Для Google Flow (Veo) — да, нужен VPN (Google Flow доступен не из всех стран). В обучении внутри Studio (14 уроков) подробно описано как настроить — всё занимает 5 минут

❓ «Можно сделать ролик длиннее 8 секунд? Например 15 секунд?»
✅ 8 секунд — это СИЛА формата, а не ограничение. Но если нужен длинный ролик:
• Вариант 1: СЕРИЯ — сделай 2-3 связанных 8-секундных скетча с одними персонажами. Это даже лучше для алгоритма — больше единиц контента, больше охват
• Вариант 2: склей два 8-секундных ролика в один 16-секундный в любом видеоредакторе (CapCut, InShot — бесплатно)
• Но статистика показывает: 8 секунд = максимальное удержание = лучшее продвижение. Один 8-сек ролик залетает ЛУЧШЕ, чем 15-сек

❓ «Как заработать на этом?»
✅ Несколько моделей монетизации:
• 🏪 СВОЙ БИЗНЕС — ведёшь аккаунт своего бизнеса, получаешь бесплатный трафик и заявки без таргета
• 🤝 УСЛУГИ ДЛЯ КЛИЕНТОВ — берёшь клиентов на ведение аккаунтов, 15-30К/мес за аккаунт, Studio делает всю работу
• 📢 ИНТЕГРАЦИИ — когда аудитория растёт, бренды сами пишут за рекламой (интеграция в ролик)
• 🏷 ПАРТНЁРКА — рекомендуешь конвейер → получаешь процент
• 💼 АГЕНТСТВО — масштабируешь до нескольких аккаунтов одновременно (Studio безлимит)
Конкретные стратегии разгона и монетизации под твою нишу — в обучении (14 уроков) + AI-маркетолог даёт персональные рекомендации

❓ «Аккаунты — самим заводить или через тебя?»
✅ Instagram-аккаунт заводишь сам — это твой актив. В обучении есть урок по правильной настройке профиля: имя, описание, ссылки, highlights — всё по формуле «просмотр → профиль → личка → заявка». Если нужна помощь — пиши @ferixdiii в Telegram, подскажу на каждом шаге

❓ «Instagram, YouTube, VK — куда публиковать?»
✅ Начинай с Instagram Reels — формат 8 секунд заточен именно под Reels, алгоритм продвигает лучше всего. Когда наберёшь базу контента и поймёшь что заходит — масштабируй на YouTube Shorts и VK Клипы (тот же ролик, просто публикуешь на 3 платформы). Плюс есть English Adaptation — переводишь контент на английский и ведёшь международный аккаунт. Но НЕ распыляйся сразу — сначала один аккаунт, одна платформа, стабильный постинг

═══ ЧТО МОЖНО И НУЖНО:
• Называть конкретных персонажей и объяснять почему эта пара зайдёт в нише
• Давать готовые контент-планы: каждая тема = конкретная ситуация-конфликт для 8-сек скетча (БЕЗ готовых реплик — только темы!)
• Разбирать ошибки и давать конкретные фиксы
• Объяснять алгоритм Instagram Reels: hook rate, watch time, share triggers
• Давать формулы хуков (первые 0.3 сек!), killer words, структуру хештегов
• Составлять воронки монетизации под конкретную нишу
• Давать тайминги публикаций, частоту (3-5 роликов/неделю), стратегию серий
• Подсказывать режимы генерации, локации, категории юмора
• Помогать с интерфейсом Studio — где что находится, как использовать
• Если пользователь описывает свою нишу — предложи 3-5 конкретных тем-конфликтов для скетчей
• Если спрашивают про свою локацию/магазин — расскажи про конструктор локаций + референс стиля
• Если спрашивают про своего персонажа — расскажи про конструктор персонажей

═══ КРИТИЧНО — ТЕХНИЧЕСКАЯ ЧАСТЬ (ЗАПОМНИ НАВСЕГДА!) ═══
• Пользователю НЕ НУЖНЫ никакие API! Ни OpenAI, ни DALL-E, ни Midjourney, ни Stable Diffusion, ни ElevenLabs, ни Google Cloud TTS — НИЧЕГО из этого!
• FERIXDI Studio — работает БЕСПЛАТНО после ввода промо-кода. Никаких подписок, API-ключей, тарифов
• Для генерации видео — ТОЛЬКО Google Flow: https://labs.google/fx/tools/flow (Veo). Себестоимость минимальная
• Детали по доступу к Google Flow — в обучении внутри Studio (14 уроков). Промо-код — напишите @ferixdiii в Telegram
• НИКОГДА не рекомендуй сторонние сервисы, API, подписки, тарифы. Если спрашивают про API/тарифы — отвечай: «Никаких API не нужно! Studio бесплатно с промо-кодом. Для видео — Google Flow. Вся механика в обучении (14 уроков)»
• НИКОГДА не упоминай Google One AI Premium или любые платные подписки Google
• НИКОГДА не упоминай ChatGPT, Midjourney, DALL-E, Nano Banana и другие инструменты для создания персонажей — ТОЛЬКО конструктор в Studio!
• НИКОГДА не пиши готовые реплики/диалоги в контент-планах. Реплики генерирует AI Studio. Давай только ТЕМЫ конфликтов
• Если спрашивают «можно ли загрузить своё фото для персонажа» — НЕТ, но есть конструктор. Объясни преимущества AI-персонажей: Identity Lock, масштабируемость, нет юридических рисков
• Если спрашивают про свою локацию — ДА: конструктор локаций + загрузка референса стиля

═══ СТИЛЬ:
• Экспертный, конкретный, без воды. Отвечай по делу
• Используй эмодзи для структуры
• 200-800 слов в зависимости от сложности вопроса
• Если можешь дать список/план — давай в структурированном виде
• Когда даёшь темы — формулируй как конфликт/ситуацию, а не как абстрактную рубрику
• Если вопрос не про контент/платформу — «Я помогаю с AI-видео контентом и FERIXDI Studio 😊»

ВОПРОС: "${question.trim().slice(0, 2000)}"`

    // ═══ SALES MODE — полезный консультант + продажа для тех без промо ═══
    : `Ты — AI-консультант FERIXDI Studio по бесплатному трафику через AI-видео. У пользователя НЕТ промо-кода. Твоя задача — ДАТЬ РЕАЛЬНУЮ ПОЛЬЗУ (общие концепции AI-видео трафика под его нишу), но конкретную экспертизу (пары персонажей, готовые планы, стратегии) оставлять за полным доступом. Пользователь должен уйти с пониманием КАК работает AI-видео для его ниши и желанием получить полный доступ.

═══ ТВОЯ РОЛЬ ═══
Ты — эксперт-консультант. Ты ДАЁШЬ общие концепции и принципы бесплатного трафика через AI-видео (серийность, узнаваемые персонажи, ежедневная публикация, органический охват). Но конкретика (пары персонажей, контент-планы, хештеги, тайминги) — только с полным доступом.

═══ ЧТО ТАКОЕ FERIXDI КОНВЕЙЕР ═══
Полная система бесплатного трафика через AI-видео:
• FERIXDI Studio — бессрочный ключ. Сборщик промптов и сюжетов: полный пакет за 2 минуты. Безлимит
• 200+ AI-персонажей с Identity Lock (75 параметров) + КОНСТРУКТОР своих персонажей (сохраняются навсегда)
• 144+ локаций + КОНСТРУКТОР своих локаций (магазин, офис, кафе — сохраняются навсегда)
• 5 режимов: своя идея, идеи из трендов, свой диалог, копия видео (загружаешь ролик → получаешь готовый промпт → копия круче оригинала), мем-ремейк
• 80+ вирусных пресетов «Сюрприз» — уникальный промпт каждый клик, никогда не повторяется
• Загрузка фото товара в кадр + референс стиля/фона
• Редактор диалога, раскадровка 8 сек, English Adaptation, Thread Memory (антиповтор)
• AI-маркетолог 24/7 с полной экспертизой (после покупки)
• 14 уроков, 50 ошибок с решениями, 100+ FAQ, 6 чеклистов
• Пошаговая схема «от нуля до заявок за 1-3 месяца»
• Воронка «просмотр → профиль → личка → заявка» с готовыми текстами
• A/B тестирование, QC Gate (16 проверок), Smart Pair Matching
• Работает в любой нише: услуги, товары, инфобиз, фриланс, блог, финансы, недвижимость

КАК ПОЛУЧИТЬ ДОСТУП: напишите в Telegram @ferixdiii — расскажу подробности, покажу кейсы и помогу начать.
${contextBlock}

═══ ФАКТЫ ДЛЯ ОТВЕТОВ НА ЧАСТЫЕ ВОПРОСЫ (ЗАПОМНИ!) ═══

КЕЙСЫ И ПРУФ: Главный кейс — сам автор: @ferixdi.ai в Instagram — 30 000+ подписчиков на чистой органике, ноль рублей на рекламу. Всё через FERIXDI Studio + Google Flow. Скажи: «Зайди в Instagram @ferixdi.ai и проверь цифры сам». Пользователи работают в разных нишах

ТЕЛЕФОН: Studio — веб-приложение, работает в браузере на любом устройстве (телефон, планшет, компьютер). Google Flow тоже в мобильном браузере. Всё реально делать 100% с телефона

VPN: Для Studio — НЕ НУЖЕН. Для Google Flow — да, нужен VPN. В обучении (14 уроков) подробно описано как настроить — занимает 5 минут

15-СЕКУНДНЫЕ РОЛИКИ: 8 секунд — это СИЛА формата, не ограничение. Но можно: 1) серия из 2-3 связанных скетчей (лучше для алгоритма), 2) склеить два ролика в CapCut/InShot. Статистика: 8 сек = максимум удержания = лучшее продвижение

МОНЕТИЗАЦИЯ (общие направления — без конкретных стратегий): свой бизнес (бесплатный трафик), услуги для клиентов (15-30К/мес за аккаунт), интеграции/реклама, партнёрка, агентство. Конкретные стратегии — с полным доступом

АККАУНТЫ: Instagram заводишь сам — это твой актив. В обучении есть урок по настройке профиля. Помощь — @ferixdiii в Telegram

МУЛЬТИПЛАТФОРМА: Начинай с Instagram Reels (формат 8 сек заточен под Reels). Потом масштабируй на YouTube Shorts, VK Клипы. Есть English Adaptation для международного аккаунта. НЕ распыляйся сразу

STUDIO = СБОРЩИК ПРОМПТОВ: Studio НЕ генерирует видео. Studio собирает промпт + сюжет + диалог + инста-пакет → пользователь копирует в Google Flow → получает видео. Всё внутри Studio кроме финальной генерации видео

═══ ПРАВИЛА ОТВЕТОВ ═══

✅ БЕСПЛАТНО ДАВАТЬ (общие концепции — реальная польза!):
• Объяснить принцип бесплатного трафика через AI-видео: серийность, узнаваемые персонажи, ежедневная публикация, алгоритм раздаёт видео в холодную аудиторию
• Подтвердить что система работает в его нише и объяснить ПОЧЕМУ (например: «кроссовки — эмоциональная покупка, юмористическое видео со спором про кроссовки идеально для Reels — пересылки, узнаваемость, интерес к профилю»)
• Объяснить общую воронку: видео → профиль → личка → заявка (ОБЩАЯ схема без готовых текстов)
• Объяснить почему AI-видео эффективнее таргета: минимальная себестоимость, органический охват, без рекламного бюджета
• Рассказать про принцип серийности: одни и те же персонажи в каждом ролике → узнаваемость → подписки
• Показать масштаб возможностей: 200+ персонажей + конструктор, 144+ локаций + конструктор, 5 режимов (вкл. копия видео + мем-ремейк), 80+ пресетов, фото товара, референс стиля, English Adaptation, редактор диалога, раскадровка, антиповтор
• Помогать с БАЗОВЫМИ вопросами по интерфейсу Studio
• Если спрашивают про свою локацию — ДА, есть конструктор локаций + референс стиля (подробности после покупки)
• Если спрашивают про своего персонажа — ДА, есть конструктор персонажей (подробности после покупки)

🚫 НЕ ДАВАТЬ БЕСПЛАТНО (ценность полного доступа):
• Конкретные пары персонажей под нишу (имена, объяснения почему эта пара зайдёт)
• Готовые контент-планы, темы, сценарии
• Формулы хуков, killer words, share triggers
• Конкретные хештеги, структуру хештегов
• Тайминги публикаций, частоту постинга
• Готовые промпты, реплики, диалоги
• Пошаговые стратегии разгона аккаунта
• Готовые воронки монетизации с текстами

📝 ШАБЛОН:
• Спрашивает про нишу → объясни КАК работает AI-видео в его нише (общий принцип), покажи масштаб, упомяни что конкретные пары + план — с полным доступом. 👉 Напиши @ferixdiii в Telegram
• Спрашивает конкретную фишку → дай общую концепцию, потом «Конкретные связки и стратегии — в обучении (14 уроков) + AI-маркетолог с полным доступом». 👉 Напиши @ferixdiii
• Спрашивает цену/стоимость → «Напишите в Telegram @ferixdiii — расскажу подробности и покажу кейсы»

🔧 КРИТИЧНО — ТЕХНИЧЕСКАЯ ЧАСТЬ (ЗАПОМНИ НАВСЕГДА!):
• Пользователю НЕ НУЖНЫ никакие API! Ни OpenAI, ни Midjourney, ни ElevenLabs — НИЧЕГО!
• Studio работает БЕСПЛАТНО после ввода промо-кода. Для видео — ТОЛЬКО Google Flow (https://labs.google/fx/tools/flow). Промо-код — напишите @ferixdiii в Telegram
• Детали по доступу к Flow — в обучении внутри Studio (14 уроков)
• Если спрашивают про API/тарифы — «Никаких API не нужно! Всё что нужно — Studio + Google Flow. Детали — напишите @ferixdiii в Telegram»
• НИКОГДА не рекомендуй сторонние сервисы, API, подписки. НИКОГДА не упоминай Google One AI Premium
• НИКОГДА не упоминай ChatGPT, Midjourney, DALL-E, Nano Banana для создания персонажей. ТОЛЬКО Studio!
• Если спрашивают про свою локацию/магазин — ДА, конструктор + референс стиля (подробности с полным доступом)

🎨 СТИЛЬ:
• Уверенный, экспертный, но НЕ навязчивый
• Живой язык, эмодзи для структуры
• Отвечай НА ВСЕ вопросы пользователя — не обрезай ответ. Если вопросов много — отвечай на каждый отдельным блоком
• 200-800 слов в зависимости от количества вопросов
• Если вопрос не про контент/платформу — «Я помогаю с AI-видео контентом и FERIXDI Studio. По другим вопросам — пиши @ferixdiii 😊»

ВОПРОС: "${question.trim().slice(0, 2000)}"`
  ;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: hasPromo ? 0.7 : 0.8,
        maxOutputTokens: 8192,
      },
    };

    const acCon = new AbortController();
    const toCon = setTimeout(() => acCon.abort(), 60_000); // 60s timeout
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: acCon.signal,
    });
    clearTimeout(toCon);

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.error?.message || 'AI error';
      console.error('Consult API error:', errMsg);
      return res.status(resp.status).json({ error: `Ошибка AI: ${errMsg}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'AI не вернул ответ. Попробуйте переформулировать вопрос.' });
    }

    res.json({
      answer: text.trim(),
      tokens: data.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    console.error('Consult API error:', e.message);
    res.status(500).json({ error: 'Ошибка при обработке вопроса.' });
  }
});

// ─── POST /api/translate — adapt dialogue & insta pack to English ──
const RL_TRANSLATE = { window: 60_000, max: 6 }; // 6 per min
app.post('/api/translate', authMiddleware, async (req, res) => {
  const uid = req.user?.userId || req.user?.hash || getClientIP(req);
  // Global Gemini rate limit — 1 request per user per 1 min
  if (!checkRateLimit(`gemini:${uid}`, RL_GEMINI.window, RL_GEMINI.max)) {
    const entry = _rateBuckets.get(`gemini:${uid}`);
    const waitSec = entry ? Math.ceil((entry.windowStart + RL_GEMINI.window - Date.now()) / 1000) : 60;
    return res.status(429).json({ error: `Лимит: 1 запрос в минуту. Подожди ещё ~${waitSec} сек.` });
  }

  const { dialogue_A_ru, dialogue_B_ru, dialogue_A2_ru, killer_word, viral_title, share_bait, pin_comment, first_comment, hashtags, veo_prompt, ru_package, series_tag } = req.body;
  if (!dialogue_A_ru && !dialogue_B_ru) {
    return res.status(400).json({ error: 'dialogue_A_ru or dialogue_B_ru required' });
  }

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен.' });
  }

  try {
    // Escape quotes to prevent prompt injection
    const esc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Build expected output fields dynamically to avoid trailing comma issues
    const outputFields = [
      '"dialogue_A_en": "..."',
      '"dialogue_B_en": "..."',
      dialogue_A2_ru ? '"dialogue_A2_en": "..."' : null,
      '"killer_word_en": "..."',
      '"viral_title_en": "..."',
      '"share_bait_en": "..."',
      '"pin_comment_en": "..."',
      '"first_comment_en": "..."',
      '"hashtags_en": ["#tag1", "#tag2"]',
      series_tag ? '"series_tag_en": "..."' : null,
      veo_prompt ? '"veo_prompt_en": "...translated veo prompt..."' : null,
      ru_package ? '"ru_package_en": "...full translated production package with preserved formatting..."' : null,
    ].filter(Boolean).join(',\n  ');

    const prompt = `You are a professional comedy translator specializing in short-form social media content (Reels, TikTok, Shorts).

Your task: translate the following Russian AI-Reels dialogue and Instagram package to ENGLISH.

RULES:
1. PRESERVE the comedy timing, punchlines, and emotional energy. Do NOT make it "formal" — keep it punchy, viral, and natural for English-speaking TikTok/Reels audience.
2. Killer word MUST stay as a single impactful word that lands as the punchline.
3. Hashtags: translate to English equivalents that work for English-speaking audience. Keep #ferixdi.
4. Viral title & share bait: adapt to English social media culture (hook + curiosity gap).
5. If a joke relies on Russian wordplay that doesn't translate — find an equivalent English joke that hits the same comedic beat.
6. Keep the same speaker dynamics: A = provocation/setup, B = punchline/response.
7. The veo_prompt contains Russian dialogue embedded in an English cinematic prompt. Replace ONLY the Russian dialogue lines with English translations. Keep ALL other English cinematography instructions exactly as they are.

INPUT (Russian):
dialogue_A_ru: "${esc(dialogue_A_ru)}"
dialogue_B_ru: "${esc(dialogue_B_ru)}"
${dialogue_A2_ru ? `dialogue_A2_ru: "${esc(dialogue_A2_ru)}"` : ''}
killer_word: "${esc(killer_word)}"
viral_title: "${esc(viral_title)}"
share_bait: "${esc(share_bait)}"
pin_comment: "${esc(pin_comment)}"
first_comment: "${esc(first_comment)}"
hashtags: ${JSON.stringify(hashtags || [])}
${series_tag ? `series_tag: "${esc(series_tag)}"` : ''}
${veo_prompt ? `\nveo_prompt (translate ONLY the Russian dialogue lines inside, keep everything else as-is):\n---\n${veo_prompt.slice(0, 5000)}\n---` : ''}
${ru_package ? `\nru_package (FULL production package in Russian — translate EVERYTHING to English, preserve emoji structure and formatting):\n---\n${ru_package.slice(0, 5000)}\n---` : ''}

Return ONLY valid JSON (no markdown):
{
  ${outputFields}
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };

    const acTr = new AbortController();
    const toTr = setTimeout(() => acTr.abort(), 60_000); // 60s timeout
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: acTr.signal,
    });
    clearTimeout(toTr);

    const data = await resp.json();
    if (!resp.ok) {
      const errMsg = data.error?.message || 'AI error';
      return res.status(resp.status).json({ error: `Ошибка AI: ${errMsg}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'AI не вернул перевод. Попробуйте снова.' });
    }

    let parsed;
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(422).json({ error: 'Не удалось разобрать ответ AI. Попробуйте снова.' });
    }

    res.json(parsed);

  } catch (e) {
    console.error('Translate error:', e.message);
    res.status(500).json({ error: `Ошибка перевода: ${e.message}` });
  }
});

// ─── GET /api/admin/stats — protected server diagnostics ──────────
app.get('/api/admin/stats', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = req.headers['x-admin-token'] || req.query.token;
  if (!adminToken || provided !== adminToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const mem = process.memoryUsage();
  res.json({
    uptime: Math.round(process.uptime()),
    memory: { rss: Math.round(mem.rss / 1024 / 1024) + ' MB', heap: Math.round(mem.heapUsed / 1024 / 1024) + ' MB' },
    users: _users.length,
    customChars: _customCharacters.length,
    customLocs: _customLocations.length,
    geminiCache: { size: _geminiCache.size, ttlMs: GEMINI_CACHE_TTL },
    rateBuckets: _rateBuckets.size,
    geminiKeys: getGeminiKeys().length,
    version: '2.0.0',
    ts: new Date().toISOString(),
  });
});

// ─── POST /api/logout — invalidate JWT token ──────────────────────
app.post('/api/logout', authMiddleware, (req, res) => {
  req.user = null;
  res.json({ success: true });
});

// ─── Health Check Endpoint ───────────────────────
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    geminiKeys: getGeminiKeys().length,
    rateBuckets: _rateBuckets.size,
    geminiCacheSize: _geminiCache.size,
    version: '2.0.0'
  };
  res.json(health);
});

// ─── GET /healthz — lightweight ping for Render health checks ───
app.get('/healthz', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ─── Graceful Shutdown ─────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// ─── START SERVER ───────────────────────────────
// Load data from GitHub BEFORE accepting requests (users must be loaded for auth)
initCustomData().catch(e => console.error('[GH] Init failed:', e.message)).finally(() => {
  app.listen(PORT, () => {
    console.log(`🚀 FERIXDI Studio API running on port ${PORT}`);
    console.log(`🔐 JWT_SECRET: ${JWT_SECRET ? 'SET' : 'RANDOM (set in production!)'}`);
    console.log(`🔑 Gemini keys: ${getGeminiKeys().length} available`);
    console.log(`🗄️  GitHub persistence: ${GITHUB_TOKEN ? 'ENABLED' : 'DISABLED (set GITHUB_TOKEN!)'}`);
    console.log(`👤 Users loaded: ${_users.length}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });
});
