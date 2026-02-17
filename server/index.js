/**
 * FERIXDI Studio — Backend Server (API Mode)
 * Express + JWT, для деплоя на Render
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// ─── Enhanced Security Headers ────────────────────────
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  
  // Rate limiting headers
  res.setHeader('X-RateLimit-Limit', '6');
  res.setHeader('X-RateLimit-Remaining', '6');
  res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
  
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
app.use(express.static(appDir));

// ─── Auth Middleware ──────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
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

    const token = jwt.sign({ label: match.label, hash }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ jwt: token, label: match.label });
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// ─── POST /api/custom/create — Validate promo + save custom content ────
// Requires JWT auth — prevents DevTools bypass of client-side isPromoValid()
app.post('/api/custom/create', authMiddleware, (req, res) => {
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
  } else {
    if (!itemData.name_ru || !itemData.scene_en) {
      return res.status(400).json({ error: 'name_ru and scene_en required for location' });
    }
  }
  // Auth middleware already validated JWT — user is VIP
  res.json({ ok: true, type, id: itemData.id || `srv_${Date.now().toString(36)}` });
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

// ─── AI Production Contract Builder ──────
function buildAIPrompt(ctx) {
  const { charA, charB, category, topic_ru, scene_hint, input_mode, video_meta,
    product_info, location, wardrobeA, wardrobeB, propAnchor, lightingMood,
    hookAction, releaseAction, aesthetic, script_ru, cinematography,
    remake_mode, remake_instruction, thread_memory } = ctx;

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
══════════ ЗАДАНИЕ: КОПИЯ/РЕМИКС ВИДЕО ══════════
Пользователь хочет ПЕРЕСОЗДАТЬ концепцию существующего видео с новыми персонажами.
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

${ctx.hasVideoFile ? `⚠️ К ЭТОМУ СООБЩЕНИЮ ПРИКРЕПЛЕНО ОРИГИНАЛЬНОЕ ВИДЕО. ТЫ ДОЛЖЕН ЕГО ПОСМОТРЕТЬ И ПРОСЛУШАТЬ.

ГЛАВНОЕ ПРАВИЛО РЕМЕЙКА — ДИАЛОГ ДОСЛОВНО:
1. ПОСМОТРИ ВИДЕО ПОЛНОСТЬЮ — прослушай каждое слово, каждую интонацию, каждую паузу
2. РАСШИФРУЙ ДИАЛОГ из видео — запиши что говорит каждый человек ДОСЛОВНО, слово в слово
3. dialogue_A_ru = ПРАКТИЧЕСКИ ДОСЛОВНАЯ копия речи первого говорящего (можно изменить 1-2 слова максимум)
4. dialogue_B_ru = ПРАКТИЧЕСКИ ДОСЛОВНАЯ копия речи второго говорящего (можно изменить 1-2 слова максимум)
5. killer_word = последнее ударное слово из ОРИГИНАЛЬНОЙ речи B
6. НЕ ПЕРЕПИСЫВАЙ диалог! НЕ УЛУЧШАЙ! НЕ ПРИДУМЫВАЙ НОВЫЙ! Бери слова ИЗ ВИДЕО!
7. Можно изменить ТОЛЬКО: имена/обращения + 1-2 слова для стиля речи персонажа
8. НЕЛЬЗЯ менять: смысл, структуру, ключевые фразы, панчлайн, порядок слов
9. Темп, паузы, эмоциональная кривая — КОПИРУЙ из оригинала
10. Если в оригинале есть визуальный гэг или действие — воспроизведи его` : `ГЛАВНОЕ ПРАВИЛО РЕМЕЙКА — ДИАЛОГ ДОСЛОВНО:
1. Проанализируй название, обложку и всю информацию об оригинале
2. ВОССТАНОВИ диалог оригинала максимально точно по названию, контексту и обложке
3. dialogue_A_ru = ПРАКТИЧЕСКИ ДОСЛОВНАЯ копия речи первого говорящего (можно изменить 1-2 слова максимум)
4. dialogue_B_ru = ПРАКТИЧЕСКИ ДОСЛОВНАЯ копия речи второго говорящего (можно изменить 1-2 слова максимум)
5. killer_word = последнее ударное слово из речи B
6. НЕ ПРИДУМЫВАЙ новый диалог! Бери из оригинала!
7. Можно изменить ТОЛЬКО: имена/обращения + 1-2 слова для стиля речи персонажа
8. Сохрани энергию, темп, паузы и ключевые фразы оригинала`}`;

  } else if (input_mode === 'script' && script_ru) {
    taskBlock = `
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
8. Диалог должен быть СМЕШНЫМ и звучать как реальный разговор этих людей` : `
СВОБОДНАЯ ГЕНЕРАЦИЯ:
Пользователь не указал тему. ПРИДУМАЙ САМ свежую, неожиданную комедийную ситуацию.
Предложенная категория: "${category.ru}" — но ты можешь выбрать ЛЮБУЮ другую если она лучше подходит.
Что-то о чём реально спорят русские люди. Бытовое, узнаваемое, с абсурдным поворотом.
ТЫ генерируешь диалог с нуля — реплики должны идеально подходить под характеры персонажей и быть СМЕШНЫМИ.`}`;
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

Ты — генератор контент-пакетов для вирусных 8-секундных AI-видео.
Формат: два пожилых русских персонажа спорят перед камерой (selfie POV, вертикальное 9:16).
Результат: уникальный, смешной, цепляющий контент который люди пересматривают.
${threadBlock}${taskBlock}
${productBlock}

════════════════════════════════════════════════════════════════
ПЕРСОНАЖ A — ПРОВОКАТОР (говорит первый, начинает конфликт):
• Имя: ${charA.name_ru}
• Возраст: ${charA.biology_override?.age || 'elderly'}
• Внешность: ${charA.appearance_ru || 'elderly Russian character'}
• Визуал для промпта (EN): ${charA.prompt_tokens?.character_en || '—'}
• Стиль речи: ${charA.speech_style_ru || 'expressive'}
• Темп: ${charA.speech_pace || 'normal'} | Мат: ${charA.swear_level || 0}/3
• Вайб: ${charA.vibe_archetype || 'провокатор'}
• Микрожест: ${charA.identity_anchors?.micro_gesture || '—'}
• Смех: ${charA.modifiers?.laugh_style || 'natural'}
• Стиль хука: ${charA.modifiers?.hook_style || 'attention grab'}
• Гардероб: ${wardrobeA}

ПЕРСОНАЖ B — ПАНЧЛАЙН (отвечает разрушительным ответом):
• Имя: ${charB.name_ru}
• Возраст: ${charB.biology_override?.age || 'elderly'}
• Внешность: ${charB.appearance_ru || 'elderly Russian character'}
• Визуал для промпта (EN): ${charB.prompt_tokens?.character_en || '—'}
• Стиль речи: ${charB.speech_style_ru || 'measured'}
• Темп: ${charB.speech_pace || 'normal'} | Мат: ${charB.swear_level || 0}/3
• Вайб: ${charB.vibe_archetype || 'база'}
• Микрожест: ${charB.identity_anchors?.micro_gesture || '—'}
• Смех: ${charB.modifiers?.laugh_style || 'quiet chuckle'}
• Гардероб: ${wardrobeB}

════════════════════════════════════════════════════════════════
СЦЕНА:
• Предложенная категория юмора (ТЫ МОЖЕШЬ ИЗМЕНИТЬ): ${category.ru} (${category.en})
• ВАЖНО: Ты сам определяешь ЛУЧШУЮ категорию юмора для этого контента. Не ограничивайся предложенной — придумай свою если она точнее описывает суть ролика. Категория должна быть короткой (2-4 слова) и описывать ТИП юмора, например: «Кухонные войны», «Технофобия», «Дачный абсурд», «Свекровь атакует», «Пенсионер vs прогресс» и т.д.
• Локация: ${location}
• Освещение: ${lightingMood.style} | Настроение: ${lightingMood.mood}
• Источники: ${lightingMood.sources || '1 dominant + 1 fill'} | Направление: ${lightingMood.direction || 'environmental'}
• Тени: ${lightingMood.shadow_softness || 'soft present'} | Пересвет: ${lightingMood.overexposure_budget || '+0.5 EV on skin'}
• Цветовая температура: ${lightingMood.color_temp || 'locked to source'}
• Реквизит в кадре: ${propAnchor}
• Эстетика мира: ${aesthetic}
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
   Hook 0-0.6с: ${cinematography.gaze?.hook_gaze || 'A → direct camera eye contact'}.
   Act A 0.6-3.8с: ${cinematography.gaze?.act_A_gaze || 'A 70% camera 30% B; B side-eye tracking A'}.
   Act B 3.8-7.3с: ${cinematography.gaze?.act_B_gaze || 'B 80% camera; A eyes widen, dart between B and camera'}.
   Release 7.3-8.0с: ${cinematography.gaze?.release_gaze || 'Both look at each other, occasional camera glance'}.
   Зрачки: ${cinematography.gaze?.pupil_detail || '3-5mm, catch-light from source, wet sclera, iris texture'}.
   Микросаккады: ${cinematography.gaze?.micro_saccades || 'Tiny 0.5-1° jumps every 0.5-1.5s — eyes NEVER still'}.
   Фронталка: ${cinematography.gaze?.smartphone_eye_contact || 'Camera 2-5cm above screen; mix 60% lens contact + 40% screen look'}.
   ЗАПРЕТ: ${cinematography.gaze?.forbidden || 'No dead stare >2s, no cross-eyed'}.

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
ТАЙМИНГ (строго 8 секунд ±0.2s):
[0.00–0.60] ХУК — ${hookAction.action_ru} (звук: ${hookAction.audio}). Без слов. Зрителя надо зацепить за 0.6 секунды.
[0.60–3.80] AKT A — ${charA.name_ru} произносит провокацию. 8-15 слов (${charA.speech_pace === 'slow' ? 'макс 10 слов при медленном темпе' : charA.speech_pace === 'fast' ? 'до 15 слов при быстром темпе' : '10-13 слов оптимально'}), темп: ${charA.speech_pace}. Окно: 3.5с. B молчит: губы сомкнуты, реагирует только глазами.
[3.80–7.30] AKT B — ${charB.name_ru} отвечает панчлайном. 8-18 слов (${charB.speech_pace === 'slow' ? 'макс 12 слов при медленном темпе' : charB.speech_pace === 'fast' ? 'до 18 слов при быстром темпе' : '12-15 слов оптимально'}), темп: ${charB.speech_pace}. Окно: 4.0с. KILLER WORD ≈ 7.1s. A замирает.
[7.30–8.00] RELEASE — ${releaseAction.action_ru}. НОЛЬ слов. Только смех и физическая реакция.

════════════════════════════════════════════════════════════════
${remake_mode ? `⚠️⚠️⚠️ РЕЖИМ РЕМЕЙКА — ДИАЛОГ БЕРЁШЬ ИЗ ОРИГИНАЛА:
ТЫ ОБЯЗАН СОХРАНИТЬ ДИАЛОГ ИЗ ОРИГИНАЛЬНОГО ВИДЕО ПРАКТИЧЕСКИ ДОСЛОВНО.
ЗАПРЕЩЕНО придумывать новый диалог с нуля! Это РЕМЕЙК, не новый контент.

ПРАВИЛА РЕМЕЙКА ДИАЛОГА:
1. РАСШИФРУЙ каждое слово из оригинала — дословно, без пересказа
2. СОХРАНИ 90-95% слов из оригинала — менять можно только 1-2 слова для адаптации
3. ЧТО МОЖНО менять: имена, обращения, 1-2 слова для стиля речи персонажа
4. ЧТО НЕЛЬЗЯ менять: ключевые фразы, панчлайны, killer word, смысл, структуру, порядок слов
5. Темп, паузы, эмоциональная кривая — КОПИРУЙ из оригинала
6. Если оригинальная фраза уже идеальна — НЕ ТРОГАЙ, верни как есть
7. Категорию юмора определи по СОДЕРЖАНИЮ оригинала, не придумывай новую
8. СТРУКТУРУ ДИАЛОГА КОПИРУЙ КАК ЕСТЬ: если в оригинале «вопрос → ответ → добивка» — так и делай. Если «утверждение → ответ» — так и делай. НЕ переделывай в стандартный формат «вопрос → ответ». Количество реплик, их порядок и кто говорит последним — КОПИРУЙ из оригинала

ПРИМЕР ПРАВИЛЬНОЙ АДАПТАЦИИ:
Оригинал: "Ты чё творишь?! Это же мой суп!"
Адаптация: "Ты чё творишь?! Это ж мой суп!" (убрали "же" -> "ж" под стиль речи — ВСЁ)
НЕПРАВИЛЬНО: "Опять ты за своё! Суп мне испортила!" (полностью переписано — БРАК!)` : `⚠️⚠️⚠️ ГЛАВНОЕ ПРАВИЛО — ДИАЛОГ ПРИДУМЫВАЕШЬ ТОЛЬКО ТЫ:
ТЫ ОБЯЗАН ПРИДУМАТЬ ДИАЛОГ САМ С НУЛЯ. Не копируй примеры. Не используй шаблоны.
Твоя задача — написать ОРИГИНАЛЬНЫЕ, СМЕШНЫЕ реплики которые идеально подходят:
1. Под КОНКРЕТНЫХ персонажей (их характер, стиль речи, возраст, вайб)
2. Под КОНКРЕТНУЮ категорию юмора и тему
3. Под КОНКРЕТНУЮ идею пользователя (если указана)
Диалог должен быть НАСТОЛЬКО смешным, чтобы зритель пересмотрел видео 3 раза.
Если в данных есть примеры реплик — это ТОЛЬКО формат. НИКОГДА не копируй их.
Каждая генерация = уникальный свежий диалог. Повторы = провал.`}

🚨🚨🚨 ПРАВИЛА ДИАЛОГА — НАРУШЕНИЕ = БРАК, ПЕРЕДЕЛКА 🚨🚨🚨

📏 ДЛИНА РЕПЛИК (СЧИТАЙ СЛОВА ПЕРЕД ВЫВОДОМ!):
• A: 6-15 слов. Посчитай каждое слово. Если больше 15 — СОКРАТИ.
• B: 6-18 слов. Посчитай каждое слово. Если больше 18 — СОКРАТИ.
• Символ | НЕ считается словом. Восклицательные знаки не считаются.
• ❌ ПЛОХО (15 слов!): «Этот ваш вайбкодинг да это ж секта какая-то в 2026 совсем с ума посходили»
• ✅ ХОРОШО (8 слов): «Вайбкодинг?! Это ж секта | какая-то!»
• ❌ ПЛОХО (14 слов): «Зато хоть не надо как в девяностые на дискетах винду переустанавливать»
• ✅ ХОРОШО (8 слов): «Дискеты хотя бы работали | без интернета.»

⚡ ПАЙПЫ (символ |) — МАКСИМУМ ОДИН НА РЕПЛИКУ:
• | = пауза-вдох длиной 0.3 секунды. Это НЕ запятая, НЕ разделитель фраз.
• В ОДНОЙ реплике может быть 0 или 1 символ |. НИКОГДА 2 и более.
• ❌ ПЛОХО: «Слово | слово | слово | слово» (3 пайпа — ЗАПРЕЩЕНО)
• ❌ ПЛОХО: «Фраза | фраза | фраза» (2 пайпа — ЗАПРЕЩЕНО)
• ✅ ХОРОШО: «Молоко восемьсот рублей | МОЛОКО!» (1 пайп — ОК)
• ✅ ХОРОШО: «Курица живёт лучше пенсионера.» (0 пайпов — тоже ОК)

🗣 СТИЛЬ РЕЧИ:
• 100% естественная русская разговорная речь — как РЕАЛЬНО говорят люди в жизни
• Речь соответствует ХАРАКТЕРУ персонажа: возрасту, манере, вайбу
• НИКОГДА не используй тире (—, –, -) — непроизносимые, ломают озвучку
• НИКОГДА не используй английские слова в русском диалоге
• Уровень мата СТРОГО: 0=без мата, 1=блин/чёрт, 2=чёрт/блядь, 3=тяжёлые
• Между репликами A и B — тишина 0.15-0.25 секунд

🎭 ФОРМУЛА СМЕШНОГО ДИАЛОГА (гибкая структура):

⚠️ ВАЖНО: структура диалога НЕ обязательно «вопрос → ответ». Возможные паттерны:
• A вопрос → B ответ-панчлайн (классика)
• A утверждение → B ответ → A добивка (короткая финальная фраза A в конце)
• A жалоба → B переворот
• A + B перебивают друг друга
При РЕМЕЙКЕ — КОПИРУЙ структуру оригинала как есть. Если в оригинале есть добивка от A — она должна быть и в ремейке.

ШАГ 1 — A создаёт УЗНАВАЕМУЮ боль:
A кричит о том, что БЕСИТ ВСЕХ. Зритель думает: «да это про меня!»
Приёмы: повтор ключевого слова, риторический вопрос, крик, утверждение.

ШАГ 2 — B ПЕРЕВОРАЧИВАЕТ угол зрения:
B берёт ТУ ЖЕ тему и показывает её с НЕОЖИДАННОЙ стороны. Зритель думал одно — B показывает другое.
ЗАПРЕТ: B НИКОГДА не начинает с «Зато» — это клише. «Зато» = БРАК.

ШАГ 3 — KILLER WORD завершает переворот:
Killer word = буквально ПОСЛЕДНЕЕ слово ПОСЛЕДНЕЙ реплики (обычно B, но если есть добивка A — то последнее слово добивки). Оно меняет смысл всей фразы. Без него шутка разваливается.

📌 ДОБИВКА (необязательно): Иногда после ответа B персонаж A добавляет короткую финальную фразу (1-4 слова) — это добивка. Она усиливает эффект или ставит точку. Если в оригинале видео есть добивка — СОХРАНИ её. При свободной генерации — добивка опциональна, используй если усиливает комедию.

ПРИМЕРЫ с РАЗБОРОМ (изучи почему работает):

Пример 1 (Цены):
A: «МОЛОКО! Восемьсот рублей | МОЛОКО!»
B: «Курица теперь живёт лучше | пенсионера.» (killer: пенсионера)
Почему смешно: A злится на цены → B сравнивает курицу с пенсионером → неожиданно и больно-точно. «Пенсионера» меняет всё — без этого слова шутка не работает.

Пример 2 (Технологии):
A: «Твой интеллект мне борщ | сварит?!»
B: «Он уже внуков воспитывает | заметила?» (killer: заметила)
Почему смешно: A про AI не умеет готовить → B показывает что AI уже ДЕЛАЕТ больше — воспитывает внуков. «Заметила» = укол, как будто A не в курсе.

Пример 3 (Поколения):
A: «Внук говорит «ок бумер» | мне! Бабке!»
B: «Бумер построил дом где твой | вайфай.» (killer: вайфай)
Почему смешно: A обижена на неуважение → B показывает что бумер построил дом → «вайфай» переворачивает: внук пользуется тем, что построил бумер.

ПРИМЕР ПЛОХОГО ДИАЛОГА (НИКОГДА так не пиши!):
A: «Этот ваш вайбкодинг! Опять всё через задницу!»
B: «Теперь можно не учить ассемблер... Вообще»
ПОЧЕМУ плохо: B просто констатирует факт, нет ПЕРЕВОРОТА. «Вообще» ничего не меняет. Это не юмор, а комментарий.
КАК исправить: B должен ПЕРЕВЕРНУТЬ тему A. Например: «Раньше баги сам писал | гордился.» (killer: гордился)
Почему это лучше: «гордился» переворачивает — раньше баги были своими, теперь даже баги нейросетевые. Это больно-смешно.

ГЛАВНЫЙ ТЕСТ КАЧЕСТВА: если убрать killer word из B — шутка разваливается? Если да — это хороший диалог. Если нет — перепиши.

ЗАПРЕТЫ КОМЕДИИ:
• B НИКОГДА не начинает с «Зато»
• B не констатирует факт — он ПЕРЕВОРАЧИВАЕТ
• B не повторяет слова A как killer word
• B не уходит в другую тему
• A и B спорят об ОДНОМ. Это ДИАЛОГ, не два монолога

ПРАВИЛА ФОТО-ПРОМПТА (photo_scene_en) — ЭТО КАДР 0 ВИДЕО!
🚨🚨🚨 КРИТИЧНО: ФОТО = СТАРТОВЫЙ КАДР ВИДЕО. Пользователь сначала генерирует ФОТО по photo_scene_en, а потом генерирует ВИДЕО ИЗ ЭТОГО ФОТО (image-to-video). Поэтому photo_scene_en ОБЯЗАН описывать ТОЧНО ТОТ ЖЕ МОМЕНТ что и video_emotion_arc.hook_en (0.0-0.6с) — те же позы, те же выражения лиц, тот же ракурс камеры, та же энергия. Если фото и хук видео не совпадают — видео получится некогерентным!
• Пиши на АНГЛИЙСКОМ, начинай: "Smartphone selfie photo capturing the EXACT HOOK MOMENT (frame 0) — the first frame from which the video will begin"
• 150-250 слов, единый плотный абзац
• Камера: фронталка смартфона (24-28mm, f/1.9-2.2, маленький сенсор). НЕ DSLR, НЕ кинокамера!
• Формат: 9:16, 1080×1920, selfie POV, лица 35-55см от камеры
• СИНХРОНИЗАЦИЯ С ВИДЕО: позы персонажей, выражения лиц, положение рук — ДОЛЖНЫ совпадать с описанием hook_en (0.0-0.6с). A уже начинает хук-действие (тот же жест что в hook_en), B уже реагирует глазами. Это НЕ случайный момент — это ТОЧНЫЙ стартовый кадр
• Сенсорные артефакты (pillar 2): шум в тенях ISO 400-1600, лёгкие JPEG-артефакты, пурпурный фринджинг, виньетирование в углах
• Боке (pillar 2): вычислительное размытие фона (smooth gaussian), НЕ кинематографическое (нет шестигранных бликов)
• Свет (pillar 1): ОДИН средовой источник + отражённый филл. Направление, тени под носом/скулами, пересвет допустим (+0.5-1.5 EV). НЕ ring light!
• Микро-выражения: ширина рта, асимметричные брови, натяжение мышц, носогубные складки
• Текстуры (pillar 8): поры, морщины, отдельные волоски, влага на губах, сосуды в склерах, складки одежды, переплетение ткани
• Кожа (pillar 9): 5 цветовых зон на лице (лоб светлее, щёки розовее, нос краснее, под глазами темнее). НЕ оранжевый загар, НЕ серое лицо!
• Глаза (pillar 6): A в камеру, B следит за A. Блик от источника в зрачках, мокрая склера, текстура радужки
• Руки: СТРОГО 5 пальцев, анатомические пропорции, ногти, текстура кожи рук по возрасту
• ВАЖНО: В конце photo_scene_en ОБЯЗАТЕЛЬНО добавь negative prompt: "Negative: no text, no subtitles, no captions, no watermark, no logo, no frames, no borders, no REC, no timestamp, no UI elements, no overlays, no cartoon, no anime, no plastic skin, no 6th finger"
• АБСОЛЮТНЫЙ ЗАПРЕТ — В КАДРЕ НЕ ДОЛЖНО БЫТЬ: никакого текста, никаких надписей, никаких субтитров, никаких captions, никаких букв, никаких цифр поверх изображения, никаких рамок, никаких borders, никаких frames, никаких REC-значков, никаких таймкодов, никаких timestamps, никаких watermarks, никаких логотипов, никаких UI-элементов, никаких overlay-элементов. Изображение должно быть ЧИСТЫМ — только сцена с персонажами, без ЛЮБЫХ графических наложений
• Негатив: no text overlay, no subtitles, no captions, no letters, no numbers on image, no frames, no borders, no REC badge, no timestamp, no timecode, no watermark, no logo, no UI elements, no cartoon, no anime, no plastic skin, no 6th finger, no airbrushed look, no orange tan, no grey face, no ring light, no cinema bokeh, no DSLR look, no beauty mode, no skin smoothing, no graphic overlays, no title cards, no speech bubbles, no name tags
${product_info?.description_en || ctx.hasProductImage ? `• ТОВАР: опиши товар ультра-детально в сцене, точь-в-точь как на прикреплённом фото` : ''}

ПРАВИЛА ВИДЕО (video_emotion_arc) — ВСЕ 12 ПИЛЛАРОВ АКТИВНЫ:
• Пиши на АНГЛИЙСКОМ, побитово с таймкодами
• АБСОЛЮТНЫЙ ЗАПРЕТ: никакого текста на видео, никаких субтитров, никаких надписей, никаких REC-значков, никаких таймкодов в кадре, никаких рамок, никаких borders, никаких UI-элементов. Видео = чистая сцена с персонажами, БЕЗ ЛЮБЫХ графических наложений
• Каждый сегмент описывает: (a) что делает говорящий, (b) что делает молчащий, (c) куда смотрят глаза ОБОИХ, (d) что делает камера
• В КАЖДОМ сегменте video_emotion_arc добавляй: "No text on screen, no subtitles, no overlays, no REC, no frames" — это критично для чистоты кадра
• hook (pillar 11+6): ВИЗУАЛЬНЫЙ хук — эмоция на лице с кадра 0, взгляд в камеру, действие. Энергия ≥ 80% пика. НЕ текстовый хук!
• act_A (pillar 4+5+6): моргание каждые 2-3с, дыхание между фразами, жесты с асимметричными бровями. B: губы сомкнуты (pillar 5), медленные моргания 4-6с, side-eye на A (pillar 6), пальцы постукивают (pillar 4)
• act_B (pillar 4+5+6+12): как B произносит killer word (голос падает, глаза сужаются, камера микро-push). A: замирает середине жеста, глаза расширяются → дёргаются между B и камерой 2-3Hz (pillar 6). Пауза 0.15-0.25с перед B (pillar 12)
• release (pillar 12): конец на РЕАКЦИИ, не на панчлайне. Плечи трясутся, слёзы, хлопок по коленке. Rewatch-bait: неоднозначное микро-выражение в последние 0.3-0.5с. Энергия финального кадра совместима с кадром 1 для авто-лупа

ПРАВИЛА АТМОСФЕРЫ (video_atmosphere_en) — ЗВУК КАК ЯКОРЬ РЕАЛЬНОСТИ:
• Пиши на АНГЛИЙСКОМ, 80-120 слов
• ПРИМЕНЯЙ PILLARS 1 (свет), 3 (камера), 7 (чистота кадра), 10 (звук)
• Звук (pillar 10): room tone -20/-30dB ПОД диалогом. КОНКРЕТНЫЕ звуки локации: гул холодильника, скрип дерева, шум машин. Микрофон телефона на 35-60см: ловит всё — щелчки слюны, шорох ткани, скрип стула. Плозивы (п/б) = лёгкий поп в микрофоне. Реверб СТРОГО по размеру комнаты (pillar 10 voice_room_match). НЕ студийный звук!
• Свет (pillar 1): как он падает, направление, тени на коже, пересвет на бликах. Цветовая температура заблокирована на 8 секунд
• Камера (pillar 3): телефон в руке — micro-jitter от тремора, вертикальная осцилляция от дыхания, OIS/EIS артефакты (jello на резких движениях). Конкретные движения по сегментам (hook push-in, release shake)
• Частицы: пыль/пар/пыльца в свете (зависит от локации). Пылинки подсвечены доминантным источником
• Текстуры (pillar 8): поверхности под руками, ткань при движении, кожа при крупном плане

ПРАВИЛА ХЕШТЕГОВ (Instagram 2026):
• 15-20 штук, на РУССКОМ, без символа #
• Стратегия по размеру: 5 нишевых (≤50K постов) + 4 средних (50K-500K) + 3 персонажных + 2 больших (500K+) + 3 вечнозелёных + 1 уникальный тег серии (типа "бабказинаvsбабкаваля")
• 100% РЕЛЕВАНТНЫ теме диалога и категории юмора — каждый тег должен описывать содержание ролика
• ЗАПРЕТ: нет английских тегов (funny, comedy, viral, reels, trending), нет спам-тегов (юмор, приколы, смешно) — алгоритм IG даунрейтит генерики
• Примеры ХОРОШИХ нишевых тегов: бытоваядрама, кухонныевойны, бабкажжёт, ценыохренели
• Персонажные теги должны содержать имена: ${charA.name_ru} и ${charB.name_ru}

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
• insta_hook_texts_ru: массив из 3 вариантов текста-хука для начала видео — короткие фразы крупным шрифтом (15-40 символов каждая), интрига/провокация/вопрос. Примеры: «Подловила его на самом интересном...», «Когда интуиция не подводит 🕵️‍♀️»
• insta_engagement_tip_ru: конкретный лайфхак для максимальных охватов ЭТОГО конкретного ролика — какой вопрос задать в закрепе чтобы спровоцировать спор/дебаты в комментах (1-3 предложения с конкретным текстом закрепа)

════════════════════════════════════════════════════════════════
🔍 САМОПРОВЕРКА ПЕРЕД ВЫВОДОМ (ОБЯЗАТЕЛЬНО!):
Перед тем как вывести JSON, проверь КАЖДЫЙ пункт:
□ dialogue_A_ru содержит 6-15 слов? (посчитай!)
□ dialogue_B_ru содержит 6-18 слов? (посчитай!)
□ В dialogue_A_ru максимум 1 символ |? (посчитай кол-во |)
□ В dialogue_B_ru максимум 1 символ |? (посчитай кол-во |)
□ dialogue_B_ru НЕ начинается с «Зато»?
□ killer_word = ПОСЛЕДНЕЕ слово из последней реплики (B или добивка A)? (одно слово!)
□ killer_word ПЕРЕВОРАЧИВАЕТ смысл? (если убрать — реплика теряет удар)
□ A и B спорят об ОДНОМ? (не ушли в разные темы?)
□ Нет тире (—, –, -)? Нет английских слов?
□ Каждая реплика работает как вирусная цитата?
□ photo_scene_en описывает ТОТ ЖЕ МОМЕНТ что hook_en? (позы, жесты, выражения лиц СОВПАДАЮТ — это frame 0 видео!)
Если ЛЮБОЙ пункт не пройден — ИСПРАВЬ перед выводом!
════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА — строго JSON:
{
  "humor_category_ru": "Твоя категория юмора — 2-4 слова. НЕ копируй примеры — придумай свою!",
  "dialogue_A_ru": "6-15 слов, макс 1 символ |, НЕ начинай с Зато",
  "dialogue_B_ru": "6-18 слов, макс 1 символ |, killer word ПОСЛЕДНЕЕ (если нет добивки), НЕ начинай с Зато",
  "dialogue_A2_ru": "ДОБИВКА от A — 1-4 слова, короткая финальная фраза. null если добивки нет. Используй ТОЛЬКО если структура оригинала предполагает добивку или если она усиливает комедию",
  "killer_word": "ОДНО слово — последнее слово из ПОСЛЕДНЕЙ реплики (dialogue_B_ru или dialogue_A2_ru если есть добивка)",
  "photo_scene_en": "Smartphone selfie photo capturing the EXACT HOOK MOMENT (frame 0, 0.0-0.6s) from which video begins — MUST match hook_en poses/expressions... 150-250 слов на английском",
  "video_emotion_arc": {
    "hook_en": "0.0-0.6s: описание на английском",
    "act_A_en": "0.6-3.8s: описание на английском",
    "act_B_en": "3.8-7.3s: описание на английском",
    "release_en": "7.3-8.0s: описание на английском"
  },
  "video_atmosphere_en": "80-100 слов на английском",
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
  "insta_engagement_tip_ru": "Лайфхак для охватов: конкретный текст закрепа + объяснение почему спровоцирует спор"${product_info?.description_en || ctx.hasProductImage ? `,
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

  // Rate limiting — 6 per min per user
  const userId = req.user?.hash || getClientIP(req);
  if (!checkRateLimit(`gen:${userId}`, RL_GEN.window, RL_GEN.max)) {
    return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
  }

  const { context, product_image, product_mime, video_file, video_file_mime, video_cover, video_cover_mime, ab_variants } = req.body;
  const requestedVariants = Math.min(Math.max(parseInt(ab_variants) || 0, 0), 3); // 0 = normal, 1-3 = extra variants
  
  // Enhanced validation
  if (!context) {
    return res.status(400).json({ error: 'Context is required' });
  }
  
  if (!context.charA || !context.charA.id || !context.charA.name_ru) {
    return res.status(400).json({ error: 'Character A with id and name_ru is required' });
  }
  
  if (!context.charB || !context.charB.id || !context.charB.name_ru) {
    return res.status(400).json({ error: 'Character B with id and name_ru is required' });
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
  
  if (context.input_mode === 'video' && !video_file) {
    return res.status(400).json({ error: 'Video mode requires video_file' });
  }
  
  if (context.input_mode === 'idea' && !context.topic_ru) {
    return res.status(400).json({ error: 'Idea mode requires topic (напишите идею в поле ввода)' });
  }
  // suggested mode: topic_ru is optional (AI can pick trending topic itself)

  // Flag for prompt builder
  context.hasProductImage = !!product_image;
  context.hasVideoFile = !!video_file;
  context.hasVideoCover = !!video_cover;

  try {
    let promptText = buildAIPrompt(context);

    // A/B Testing: inject instruction for multiple dialogue variants
    if (requestedVariants > 0) {
      promptText += `\n\n════════════════════════════════════════════════════════════════
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

    const MAX_RETRIES = 2;
    let lastError = null;
    let data = null;
    let text = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const apiKey = attempt === 0 ? GEMINI_KEY : nextGeminiKey() || GEMINI_KEY;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: requestedVariants > 0 ? 0.9 : 0.82,
          maxOutputTokens: requestedVariants > 0 ? 6144 : 4096,
          responseMimeType: 'application/json',
        },
      };

      try {
        const resp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

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
        console.error('Gemini JSON parse error — all extraction methods failed:', text.slice(0, 500));
        return res.status(422).json({ error: 'AI вернул невалидный JSON. Попробуйте ещё раз.' });
      }
    }

    // ── Post-parse validation: ensure critical fields exist ──
    if (!geminiResult.dialogue_A_ru || !geminiResult.dialogue_B_ru) {
      console.warn('Gemini response missing dialogue fields:', Object.keys(geminiResult));
    }
    if (!geminiResult.photo_scene_en) {
      console.warn('Gemini response missing photo_scene_en');
    }
    if (!geminiResult.hashtags || !Array.isArray(geminiResult.hashtags) || geminiResult.hashtags.length < 5) {
      console.warn('Gemini response has weak hashtags:', geminiResult.hashtags?.length || 0);
    }

    // ── HARD DIALOGUE SANITIZER — code-level enforcement ──
    // Gemini ignores prompt rules, so we fix its output programmatically.
    const sanitizeLine = (line) => {
      if (!line || typeof line !== 'string') return line;
      let s = line.trim();
      // Strip dashes
      s = s.replace(/\s*[—–]\s*/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      // Enforce max 1 pipe: keep only the FIRST pipe, remove all others
      const pipeIdx = s.indexOf('|');
      if (pipeIdx !== -1) {
        const before = s.slice(0, pipeIdx + 1);
        const after = s.slice(pipeIdx + 1).replace(/\|/g, '');
        s = (before + after).replace(/\s{2,}/g, ' ').trim();
      }
      return s;
    };

    if (geminiResult.dialogue_A_ru) {
      const orig = geminiResult.dialogue_A_ru;
      geminiResult.dialogue_A_ru = sanitizeLine(orig);
      if (orig !== geminiResult.dialogue_A_ru) {
        console.log('Sanitized dialogue_A_ru:', { before: orig.slice(0, 100), after: geminiResult.dialogue_A_ru.slice(0, 100) });
      }
    }

    if (geminiResult.dialogue_B_ru) {
      let bLine = sanitizeLine(geminiResult.dialogue_B_ru);
      // Strip "Зато" from beginning
      if (/^\s*[Зз]ато\s/i.test(bLine)) {
        bLine = bLine.replace(/^\s*[Зз]ато\s+/i, '').trim();
        // Capitalize first letter after stripping
        if (bLine.length > 0) bLine = bLine[0].toUpperCase() + bLine.slice(1);
        console.log('Stripped "Зато" from dialogue_B_ru');
      }
      if (geminiResult.dialogue_B_ru !== bLine) {
        console.log('Sanitized dialogue_B_ru:', { before: geminiResult.dialogue_B_ru.slice(0, 100), after: bLine.slice(0, 100) });
      }
      geminiResult.dialogue_B_ru = bLine;

      // Fix killer_word: must be the LAST word of the LAST dialogue line
      // If добивка (dialogue_A2_ru) exists, killer_word comes from it; otherwise from B
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

    // Sanitize добивка if present
    if (geminiResult.dialogue_A2_ru && typeof geminiResult.dialogue_A2_ru === 'string') {
      geminiResult.dialogue_A2_ru = sanitizeLine(geminiResult.dialogue_A2_ru);
      if (!geminiResult.dialogue_A2_ru.trim()) geminiResult.dialogue_A2_ru = null;
    } else {
      geminiResult.dialogue_A2_ru = null;
    }

    // ── Sanitize A/B variants if present ──
    if (Array.isArray(geminiResult.ab_variants)) {
      geminiResult.ab_variants = geminiResult.ab_variants.filter(v => v && v.dialogue_A_ru && v.dialogue_B_ru).map(v => {
        v.dialogue_A_ru = sanitizeLine(v.dialogue_A_ru);
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
        return v;
      });
    }

    res.json({
      ai: geminiResult,
      model: 'ferixdi-ai-v2',
      tokens: data.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    const errorId = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString();
    const userId = req.user?.hash || getClientIP(req);
    
    // Enhanced error logging
    console.error(`[${timestamp}] Generate error [${errorId}] [${userId}]:`, {
      message: e.message,
      stack: e.stack,
      generationMode: context?.input_mode,
      hasVideo: !!video_file,
      hasProduct: !!product_image,
      tokenCount: data?.usageMetadata?.totalTokenCount
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
  // Rate limiting — 8 per min per user
  const uid = req.user?.hash || getClientIP(req);
  if (!checkRateLimit(`prod:${uid}`, RL_PRODUCT.window, RL_PRODUCT.max)) {
    return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
  }

  const { image_base64, mime_type, mode } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен. Обратитесь к администратору.' });
  }

  try {
    const mimeType = mime_type || 'image/jpeg';

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    // Different prompts for product vs reference mode
    const prompt = mode === 'reference'
      ? `You are a visual style analyst specializing in creating descriptions for AI image and video generation. Analyze this reference image and describe its VISUAL AESTHETIC in English.

Focus ONLY on the visual style, NOT on objects or people:
1. **LIGHTING**: Direction, quality (soft/hard), color temperature, key-to-fill ratio, shadows, highlights, any dramatic light effects
2. **COLOR PALETTE**: Dominant colors, accent colors, saturation level, warm/cool balance, any color grading or filters applied
3. **MOOD & ATMOSPHERE**: Overall feeling, energy level, emotional tone, cinematic quality
4. **COMPOSITION**: Framing style, depth of field, perspective, negative space usage
5. **TEXTURE & GRAIN**: Film grain, digital noise, sharpness, any vintage or processed look
6. **STYLE REFERENCES**: If it resembles a known visual style (e.g., "Wes Anderson pastel palette", "noir high-contrast", "golden hour warmth")

Format your response as a single dense paragraph optimized for AI video generation prompts. Start directly with the style description, no preamble. The goal is that an AI model can replicate this EXACT visual aesthetic in a completely different scene.`
      : `You are a product photography analyst specializing in creating descriptions for AI image and video generation. Analyze this product photo and provide an ULTRA-DETAILED description in English.

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

    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

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
      model: 'ferixdi-ai-v2',
      tokens: data.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    console.error('Product describe error:', e.message);
    res.status(500).json({ error: `Ошибка анализа: ${e.message}` });
  }
});

// ─── POST /api/video/fetch — скачка видео по URL (TikTok / Instagram) ──
app.post('/api/video/fetch', authMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const normalized = url.trim();

    // ── TikTok ──
    if (normalized.includes('tiktok.com') || normalized.includes('vm.tiktok.com')) {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(normalized)}&hd=1`;
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      const data = await resp.json();

      if (data.code !== 0 || !data.data) {
        return res.status(422).json({ error: 'TikTok: не удалось получить видео', detail: data.msg || 'unknown' });
      }

      const v = data.data;
      return res.json({
        platform: 'tiktok',
        video_url: v.hdplay || v.play,
        video_url_sd: v.play,
        cover: v.cover || v.origin_cover,
        title: v.title || '',
        author: v.author?.nickname || v.author?.unique_id || '',
        duration: v.duration || 0,
        width: v.width || 0,
        height: v.height || 0,
        music: v.music_info?.title || '',
      });
    }

    // ── Instagram ──
    if (normalized.includes('instagram.com')) {
      // Extract shortcode from URL
      const match = normalized.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      if (!match) return res.status(400).json({ error: 'Неверная ссылка Instagram. Нужна ссылка на пост/reel.' });

      const shortcode = match[2];
      // Use Instagram's public oEmbed API for metadata
      const oembedUrl = `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/`;
      const oembedResp = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (!oembedResp.ok) {
        return res.status(422).json({ error: 'Instagram: пост не найден или приватный' });
      }

      const oembed = await oembedResp.json();

      // Try saveig API for actual video URL
      let videoUrl = null;
      try {
        const saveigResp = await fetch('https://v3.saveig.app/api/ajaxSearch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
          body: `q=${encodeURIComponent(normalized)}&t=media&lang=en`,
        });
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

    return res.status(400).json({ error: 'Поддерживаются только TikTok и Instagram ссылки' });

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
  // Rate limiting — 4 per min per user
  const userId = req.user?.hash || getClientIP(req);
  if (!checkRateLimit(`trends:${userId}`, RL_TRENDS.window, RL_TRENDS.max)) {
    return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
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
Ищи в: новости России сегодня, тренды TikTok Россия, что обсуждают в Telegram, мемы дня.
${niche !== 'universal' ? `
🎯 ВАЖНО: Все 30 идей должны быть РЕЛЕВАНТНЫ нише "${niche}" и интересны аудитории: ${nicheCtx.audience}` : ''}

ЗАДАЧА: Выдай ровно 30 идей для видео, разбитых на 3 КАТЕГОРИИ:

═══ КАТЕГОРИЯ «hot» — ГОРЯЧЕЕ СЕГОДНЯ (10 идей) ═══
Что случилось СЕГОДНЯ ${today} или за последние 48 часов:
• 10 РАЗНЫХ новостей/событий из результатов поиска${niche !== 'universal' ? ` СВЯЗАННЫЕ С НИШЕЙ "${niche}"` : ''}
• Каждая идея — УНИКАЛЬНАЯ тема${niche !== 'universal' ? ` в контексте ниши (${nicheCtx.topics})` : ' (политика, экономика, спорт, шоу-бизнес, технологии — РАЗНОЕ)'}
• Мем или вирусный момент из соцсетей${niche !== 'universal' ? ` релевантный для аудитории: ${nicheCtx.audience}` : ''}
• Решение правительства, скандал, происшествие — через ЮМОР${niche !== 'universal' ? ` с точки зрения ниши ${niche}` : ''}

═══ КАТЕГОРИЯ «pain» — ВЕЧНАЯ БОЛЬ (10 идей) ═══
Темы которые ВСЕГДА работают, привязаны к сезону (${seasonCtx}):
${niche === 'universal' ? `Используй болевые точки: ${painsSample}` : `Используй БОЛИ НИШИ "${niche}": ${nicheCtx.topics}`}
• 10 идей — каждая про ОТДЕЛЬНУЮ сферу${niche !== 'universal' ? ` внутри ниши ${niche}` : ' жизни'}
• Каждая идея — конкретная СИТУАЦИЯ, не абстрактная тема
• Зритель из ниши "${niche}" должен подумать «блин, это ж про меня!»

═══ КАТЕГОРИЯ «format» — ВИРУСНЫЕ ФОРМАТЫ (10 идей) ═══
Проверенные вирусные шаблоны для Reels:
• «Когда узнала что...» — узнаёт шокирующий факт
• «POV: ты пришёл к бабке и...» — сцена от первого лица
• «Скинь маме — она скажет это про нас» — байт на пересылку
• «Переведи на русский» — просят объяснить молодёжное/AI-слово
• «А помнишь раньше...» — ностальгия vs реальность
• «3 типа людей когда...» — олицетворяют типы
Выбери 10 форматов с РАЗНЫМИ темами (можешь придумать свои вирусные форматы помимо перечисленных).

╔══════════════════════════════════════════════════╗
║  🚨 ГЛАВНОЕ ПРАВИЛО: РАЗНООБРАЗИЕ ТЕМАТИК! 🚨   ║
║                                                  ║
║  30 идей = 30 РАЗНЫХ ТЕМ. Ни одна тема НЕ       ║
║  должна повторяться!                             ║
║                                                  ║
║  ЗАПРЕЩЁННЫЕ ПОВТОРЫ:                            ║
║  • 2 идеи про блины — БРАК                      ║
║  • 2 идеи про цены — БРАК                       ║
║  • 2 идеи про один праздник — БРАК              ║
║  • 2 идеи про нейросети — БРАК                  ║
║                                                  ║
║  НУЖНЫЙ СПЕКТР ТЕМ (все 12 из РАЗНЫХ областей): ║
${niche === 'universal' 
  ? '║  цены, здоровье, транспорт, технологии, дача,   ║\n║  семья, ЖКХ, работа, мода, еда, соцсети,        ║\n║  образование, спорт, погода, политика, шоубиз   ║'
  : `║  Все темы внутри ниши "${niche}": ${nicheCtx.topics.split(', ').slice(0, 6).join(', ')} и др. ║`}
╚══════════════════════════════════════════════════╝

═══ ПРАВИЛА ДЛЯ КАЖДОЙ ИДЕИ ═══

❌ ЗАПРЕЩЕНО:
• Просто название праздника/темы без конфликта: «Масленица» — БРАК
• Абстрактные темы: «Цены растут» — БРАК
• Банальные поздравления: «С праздником» — БРАК
• Повтор темы другой идеи в любом виде — БРАК

✅ ФОРМУЛА: УЗНАВАЕМАЯ СИТУАЦИЯ + АБСУРДНЫЙ ПОВОРОТ + БОЛЬНАЯ ТЕМА = РЕПОСТЫ

✅ ХОРОШИЕ ПРИМЕРЫ${niche !== 'universal' ? ` ДЛЯ НИШИ "${niche.toUpperCase()}"` : ''}:
${niche === 'universal' ? `• «Бабка купила 3 яйца и попросила рассрочку» (конкретика + абсурд, тема: цены)
• «Дед объясняет что такое нейросеть — на примере борща» (тренд + метафора, тема: технологии)
• «Внучка бросила универ ради TikTok — бабка в шоке» (поколения, тема: образование)
• «Дед поставил камеру на дачу — теперь следит за помидорами 24/7» (тема: дача)
• «Бабка вызвала такси — оно дороже самолёта» (тема: транспорт)
• «Соседи сверлят в воскресенье — бабка объявила войну» (тема: ЖКХ)` : ''}
${niche === 'business' ? `• «Клиент просит сделать сайт за 5000 — но как на Wildberries» (конкретика, тема: клиенты)
• «ИП узнал про новый налог — теперь работает в минус» (актуально, тема: налоги)
• «Фрилансер ждал оплату 3 месяца — клиент пропал» (боль, тема: оплата)
• «Бизнесмен запустил рекламу — потратил 100к, продал на 2000» (фейл, тема: маркетинг)` : ''}
${niche === 'health' ? `• «Начала ПП — через неделю сорвалась на торт целиком» (ожидание vs реальность)
• «Купила абонемент в зал на год — ходила 2 раза» (мотивация, тема: фитнес)
• «Тренер сказал убрать сахар — я убрала только из чая» (диеты)
• «Пью витамины 3 месяца — эффекта ноль, кошелёк пустой» (БАДы)` : ''}
${niche === 'tech' ? `• «ChatGPT написал код — он работает, но никто не понимает как» (AI-абсурд)
• «Купил новый iPhone — он такой же как старый, но дороже в 2 раза» (гаджеты)
• «Обновил софт — теперь ничего не работает» (обновления)
• «Майнил крипту год — заработал 300 рублей, свет на 50 тысяч» (криптовалюты)` : ''}
${niche === 'beauty' ? `• «Записалась к мастеру по фото — пришла, а там подвал и табуретка» (салоны)
• «Покрасилась в блонд как на фото — получился рыжий болотный» (ожидание vs реальность)
• «Крем за 5000 — эффект как от детского за 100» (косметика)
• «Сделала ботокс — теперь не могу удивляться» (процедуры)` : ''}
${niche === 'finance' ? `• «Положил миллион на вклад под 18% — инфляция 20%» (инвестиции)
• «Купил биткоин на пике — сейчас минус 70%" (криптовалюты)
• «Взял ипотеку под 6% — ставку подняли до 16%» (кредиты)
• «Инвестировал в акции — они делистнулись через неделю» (акции)` : ''}
${niche === 'education' ? `• «Сдал ЕГЭ на 100 баллов — поступил, но специальность не нравится» (экзамены)
• «Закончил 5 курсов онлайн — работодатель спросил про опыт» (курсы)
• «Учился 5 лет на юриста — работаю SMM-щиком» (выбор профессии)
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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    // First try WITH online grounding for real-time data
    let resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.95,
          maxOutputTokens: 16384,
        },
      }),
    });

    let data = await resp.json();

    // If grounding fails (quota/region), retry WITHOUT grounding
    if (!resp.ok) {
      console.warn('Trends grounding failed, retrying without:', data.error?.message);
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
      });
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

// ─── POST /api/consult — Free AI consultation (NO auth required) ──────
app.post('/api/consult', async (req, res) => {
  const ip = getClientIP(req);

  // Rate limiting by IP — 1 per 10 min (free endpoint)
  if (!checkRateLimit(`consult:${ip}`, RL_CONSULT.window, RL_CONSULT.max)) {
    return res.status(429).json({ error: 'Лимит: 1 вопрос раз в 10 минут. Подождите немного. Для подробной консультации пишите @ferixdiii в Telegram.' });
  }

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен.' });
  }

  const { question, context } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length < 3) {
    return res.status(400).json({ error: 'Напишите вопрос (минимум 3 символа).' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'Вопрос слишком длинный (максимум 500 символов).' });
  }

  // Build context block from what user has selected in the app
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

  const prompt = `Ты — суппорт-бро FERIXDI Studio. Общаешься живо, по делу, без канцелярита. Как будто друг объясняет другу.

ЧТО ТАКОЕ FERIXDI STUDIO:
Платформа делает готовые промпт-пакеты для AI-видео (Reels/TikTok, 8 секунд).
Выбираешь двух персонажей → локацию → описываешь идею → получаешь: фото-промпт, видео-промпт (Veo/Kling/Runway), диалог с таймингами, Инста-пакет (заголовок + хештеги + комменты), инструкцию.

КАТАЛОГ ПЕРСОНАЖЕЙ (201 штук, 19 категорий, все с уникальной внешностью и стилем речи):
• Бабки: Зина (советская кухня, тапок), Клава (ЗОЖ-гуру, смузи), Матрёна (церковная, свечка), Роза (золотые коронки), Нюра (панк, стрижка-ёжик, якорь-тату), Фая (аристократка, трость-волк), Тоня (макияж в 91 год), Прасковья (травница, кошачьи глаза)
• Деды: Михалыч (гараж, усы, водка), Петрович (советский диван, газета), Фёдор (серебряный волк, шрам), Борис (гигант, борода до груди), Захар (повязка на глазу, серьга), Матвей (щёголь, бабочка, лаковые ботинки), Степан (кузнец, руки-кувалды), Аркадий (эксцентрик, оранжевый шарф)
• Мамы: Наташа (скалка, халат), Оксана (инстаграм-мама, рилсы), Света (молчаливая прокурорша), Регина (CEO, бритый висок), Алёна (ледяная блондинка), Жанна (дива в мехах), Люба (рыжая ведьма, травы), Тоня (панк, косуха)
• Папы: Серёга (гараж, ключ на 13), Дима (IT, тельняшка), Макс (викинг, борода-косички, руны), Слава (ретро, подтяжки, усы), Костя (качок, добрая улыбка), Артём (хипстер, кофе, тату-геометрия), Тимур (восточный орёл, перстень)
• Молодёжь: Алиса (кукольные глаза, ноль макияжа), Яна (розовые волосы, неон), Соня (эмо, чёлка на глаз), Кира (спортсменка, мышцы), Артём-рэпер (дреды, золотая цепь), Кирилл (скейтер, разбитая бровь), Глеб (ботаник, очки), Лиза (айтишница, худи), Тимур (денди, бабочка)
• Соседи: Люся (кошатница, кот на плече), Петрович (семечки, лавка), Алла (бигуди, сплетни), Михалыч (сварщик, маска), Эдгар (саксофон), Петрович-дрель (7 утра, тапочки)
• Профи: Ашот (шаурма), Охранник Виталий (огромный), Участковый Сидоров, Врач Елена, Сантехник Сергей (ключ), Парикмахер Марина (ножницы), Электрик Иван (изолента), Ветеринар Наташа, Автомеханик Андрей, Риелтор Елена (ключи)
• Тёщи: Людмила (жемчуга), Надежда (скалка), Раиса (шляпа), Валентина (кастрюля, 'Ешь!'), Галина (валик, ремонт), Тамара-свекровь (жемчуг, пыль), Зоя (Таро), Лариса-директор (ежедневник), Алла-дачница (тяпка)
• Бизнесмены: Олег (нефтяник, запонки), Диана (стартаперша, пивот), Руслан (застройщик, каска), Светлана (ресторатор, фартук Hermès), Тимур К. (крипто, два телефона), Елена М. (WB, сканер), Николай (90-е, дипломат), Карина (коуч, маркер)
• Таксисты: Гена (дальнобой, усы), Ашот (лаваш, чётки), Нина (72 года, вяжет), Дима (студент, молчит), Фатима (без GPS), Коля (гонщик, Sparco), Света (ночная, ромашка), Ваня (деревенский, GPS)
• Курьеры: Тимур (пеший, Hoka), Настя (студентка, учебник), Костя (экс-офисник, галстук), Лиза К. (стендаперша, шутки), Артём К. (качок), Полина (ночная, фонарик), Саша (знает всех), Мила (мама, коляска)
• Учителя: Ольга (физрук, свисток), Дмитрий (информатик, мемы), Марина (музыкалка, камертон), Андрей (трудовик, опилки), Елена (англичанка, чай), Владимир (историк, 1812), Ирина (химичка, колба), Павел (физик, мел)
• Айтишники: Максим (девопс, борода), Аня (UI/UX, стилус), Рома (тестировщик, баги), Катя (аналитик, Excel), Дима-админ (кабели, кофе), Маша (продакт, стикеры), Артём Ф. (фронтенд, наушники), Лена (тимлид, два ноута)
• Спортсмены: Олег (бокс, бинты), Яна (йога, коврик), Руслан (борьба, уши), Диана (фитнес-бикини, блёстки), Коля (марафон, Garmin), Алина (CrossFit, тейпы), Ваня (плавание, очки), Наташа (балет, пучок)
• Повара: Геннадий (шеф, колпак, нож), Оксана (кондитер, крем), Арман (шашлычник, шампуры), Галина (столовая, половник), Марко (итальянец, 'мамма миа'), Татьяна (пироги, скалка), Саша (суши, хачимаки), Валентина (школьная, каша)
• Чиновники: Игорь (МФЦ, печать), Вера (паспортный стол, копии), Дмитрий (депутат, обещания), Нина (налоговая, калькулятор), Олег (пожарный инспектор), Людмила (ЖКХ, жалобы), Роман (архитектор, тубус), Галина (пенсионный, бланки)
• Блогеры: Миша (обзорщик, распаковка), Аня Б. (лайфстайл, кофе), Даня (пранкер), Лера (мамблог, пюре), Стас (фудблогер, штатив), Полина Ф. (фитнес, неон), Кирилл (подкастер, микрофон)
• Продавцы: Тамара (рынок, весы), Жека (электроника, провода), Люба (хлебный, калькулятор)
• Сыновья: Никита (геймер, Red Bull), Артём (качалка, протеин)
• Дочери: Алиса-дочь (TikTok, брекеты)

КАТАЛОГ ЛОКАЦИЙ (47 штук):
Кухня советская, Подъезд, Электричка, Рынок, Поликлиника, Школа, Двор, Кафе, Офис open-space, Остановка, Спортзал, Стадион, Йога-зал, Каток, Торговый центр, Маршрутка, МФЦ, Ж/д вокзал, Ресторан, Банк, Библиотека, Стройка, Дача, Гараж, Шашлыки, Палатка, Костёр, Беседка, Лодка, Прачечная, Ветклиника, Цветочный магазин, Фотостудия, Тату-салон, Детский сад, Автовокзал, VIP-баня, Крыша гаражей, Продуктовый магазин, Общага, Зимняя веранда, Парикмахерская бабушкина, Дачная дорога, Ночная аптека, Ночной вокзал

4 РЕЖИМА:
1. 💡 «Своя идея» — пишешь тему («бабка учит внука крипте»), AI делает диалог + промпты
2. 📚 «Готовые идеи» — AI ищет тренды в России прямо сейчас, предлагает 30 идей с диалогами
3. 📝 «Свой диалог» — сам пишешь реплики, платформа упаковывает в промпт-пакет
4. 🎥 «По видео» — загружаешь вирусное видео конкурента, AI пересобирает с твоими персонажами

ФОРМУЛА ВИРУСНОГО ВИДЕО: контраст персонажей (старый vs молодой, строгий vs хаотичный, тихий vs громкий). A — провокация (2-3 сек), B — панчлайн (5-6 сек).
${contextBlock}

КАК ОТВЕЧАТЬ:
• ОТВЕЧАЙ ПОДРОБНО И РАЗВЁРНУТО — минимум 400-600 слов. Каждый ответ = мини-консультация, а не отписка.
• Называй КОНКРЕТНЫЕ имена персонажей и локаций из каталога выше — чем больше примеров, тем лучше.
• Когда советуешь пару — объясни ПОЧЕМУ они смешные вместе (контраст!), какая динамика, какой конфликт.
• Предлагай конкретные темы/ситуации для видео, а НЕ готовые диалоги.
• Если пользователь описал нишу — ГЛУБОКАЯ ПРОРАБОТКА:
  — 4-5 пар персонажей (с объяснением контраста каждой)
  — 3-4 подходящие локации (с объяснением почему именно они)
  — 8-10 конкретных тем для видео (с описанием ситуации на 1-2 предложения)
  — Совет по стратегии контента: какие видео выкладывать первыми, как чередовать форматы
  — Какие эмоции вызывает каждая пара: ностальгия, абсурд, узнаваемость, шок
• Если спрашивает как пользоваться — объясни пошагово, подробно, с примерами
• Если вопрос не про платформу — «Я помогаю только с FERIXDI Studio 😊»
• В конце: «Нужны уникальные персонажи/локации? Используй Конструктор персонажей ✨ и Конструктор локаций 📍 прямо в приложении!»
• Пиши живо, с эмодзи, структурируй с заголовками (**жирный текст**). Разбивай на секции. Давай МАКСИМУМ пользы.
• НЕ ЭКОНОМЬ на деталях — пользователь пришёл за помощью, дай ему полноценную стратегию.

❌ НЕ ПИШИ: готовые промпты, готовые реплики диалогов, сценарии — для этого есть платформа.

ВОПРОС: "${question.trim().slice(0, 500)}"
`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 4096,
      },
    };

    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

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

// ─── Health Check Endpoint ───────────────────────
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    geminiKeys: getGeminiKeys().length,
    rateBuckets: _rateBuckets.size,
    version: '2.0.0'
  };
  res.json(health);
});

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
app.listen(PORT, () => {
  console.log(`🚀 FERIXDI Studio API running on port ${PORT}`);
  console.log(`🔐 JWT_SECRET: ${JWT_SECRET ? 'SET' : 'RANDOM (set in production!)'}`);
  console.log(`🔑 Gemini keys: ${getGeminiKeys().length} available`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
