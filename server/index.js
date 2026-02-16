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
const JWT_SECRET = process.env.JWT_SECRET || 'ferixdi-dev-secret-change-me';

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

// ─── Rate Limiting (in-memory) ──────────────
const _rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
function checkRateLimit(userId) {
  const now = Date.now();
  let entry = _rateLimits.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    _rateLimits.set(userId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}
// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateLimits) {
    if (now - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) _rateLimits.delete(k);
  }
}, 300_000);

app.use(cors());
app.use(express.json({ limit: '75mb' }));

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
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });

  // Support both plain-text key and pre-hashed key from frontend
  const isHex64 = /^[a-f0-9]{64}$/.test(key);
  const hash = isHex64 ? key : crypto.createHash('sha256').update(key).digest('hex');
  try {
    const keysPath = join(__dirname, '..', 'app', 'data', 'access_keys.json');
    const keys = JSON.parse(readFileSync(keysPath, 'utf-8'));
    const match = keys.keys.find(k => k.hash === hash);
    if (!match) return res.status(403).json({ error: 'Invalid key' });

    const token = jwt.sign({ label: match.label, hash }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ jwt: token, label: match.label });
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed' });
  }
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

// ─── Gemini Production Contract Builder ──────
function buildGeminiPrompt(ctx) {
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
3. Если реплика слишком длинная (>12 слов) — можешь НЕМНОГО сократить, сохранив смысл и ключевые слова
4. Killer word = последнее ударное слово реплики B
5. Всё остальное (фото-промпт, видео-промпт, хештеги, заголовок) генерируй по теме ЭТОГО диалога
6. Категорию юмора определи по содержанию диалога пользователя`;

  } else {
    taskBlock = `
══════════ ЗАДАНИЕ: ОТ ИДЕИ К КОНТЕНТУ ══════════
${topic_ru ? `
ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${topic_ru}"

ЧТО ДЕЛАТЬ:
1. Возьми идею пользователя как ЯДРО — весь контент должен крутиться вокруг неё
2. Найди в этой идее конфликтную точку: о чём бы ЭТИ ДВА персонажа спорили?
3. ПРИДУМАЙ ДИАЛОГ САМ — реплики A и B ты генерируешь с нуля, исходя из персонажей и темы
4. Персонаж A должен обвинять/жаловаться/возмущаться по теме идеи — в СВОЕЙ манере речи
5. Персонаж B должен найти неожиданный угол и перевернуть тему — в СВОЁМ стиле
6. Killer word должен РЕЗКО переключить контекст — вот почему видео пересматривают
7. Не уходи от темы пользователя — если он написал про цены, спор про цены
8. Диалог должен быть СМЕШНЫМ и звучать как реальный разговор этих конкретных людей` : `
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
[0.60–3.80] AKT A — ${charA.name_ru} произносит провокацию. 6-10 слов (${charA.speech_pace === 'slow' ? 'макс 7 слов при медленном темпе' : charA.speech_pace === 'fast' ? 'до 10 слов при быстром темпе' : '7-9 слов оптимально'}), темп: ${charA.speech_pace}. Окно: 3.2с. B молчит: губы сомкнуты, реагирует только глазами.
[3.80–7.30] AKT B — ${charB.name_ru} отвечает панчлайном. 6-12 слов (${charB.speech_pace === 'slow' ? 'макс 8 слов при медленном темпе' : charB.speech_pace === 'fast' ? 'до 12 слов при быстром темпе' : '8-10 слов оптимально'}), темп: ${charB.speech_pace}. Окно: 3.5с. KILLER WORD ≈ 7.1s. A замирает.
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
• A: СТРОГО 6-10 слов. Посчитай каждое слово. Если больше 10 — СОКРАТИ.
• B: СТРОГО 6-12 слов. Посчитай каждое слово. Если больше 12 — СОКРАТИ.
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

🎭 ФОРМУЛА СМЕШНОГО ДИАЛОГА (3 шага):

ШАГ 1 — A создаёт УЗНАВАЕМУЮ боль:
A кричит о том, что БЕСИТ ВСЕХ. Зритель думает: «да это про меня!»
Приёмы: повтор ключевого слова, риторический вопрос, крик.

ШАГ 2 — B ПЕРЕВОРАЧИВАЕТ угол зрения:
B берёт ТУ ЖЕ тему и показывает её с НЕОЖИДАННОЙ стороны. Зритель думал одно — B показывает другое.
ЗАПРЕТ: B НИКОГДА не начинает с «Зато» — это клише. «Зато» = БРАК.

ШАГ 3 — KILLER WORD завершает переворот:
Killer word = буквально ПОСЛЕДНЕЕ слово B. Оно меняет смысл всей фразы. Без него шутка разваливается.

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

ПРАВИЛА ФОТО-ПРОМПТА (photo_scene_en) — СМАРТФОННЫЙ РЕАЛИЗМ:
• Пиши на АНГЛИЙСКОМ, начинай: "Smartphone selfie photo taken mid-argument"
• 150-250 слов, единый плотный абзац
• Камера: фронталка смартфона (24-28mm, f/1.9-2.2, маленький сенсор). НЕ DSLR, НЕ кинокамера!
• Формат: 9:16, 1080×1920, selfie POV, лица 35-55см от камеры
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

════════════════════════════════════════════════════════════════
🔍 САМОПРОВЕРКА ПЕРЕД ВЫВОДОМ (ОБЯЗАТЕЛЬНО!):
Перед тем как вывести JSON, проверь КАЖДЫЙ пункт:
□ dialogue_A_ru содержит 6-10 слов? (посчитай!)
□ dialogue_B_ru содержит 6-12 слов? (посчитай!)
□ В dialogue_A_ru максимум 1 символ |? (посчитай кол-во |)
□ В dialogue_B_ru максимум 1 символ |? (посчитай кол-во |)
□ dialogue_B_ru НЕ начинается с «Зато»?
□ killer_word = ПОСЛЕДНЕЕ слово из dialogue_B_ru? (одно слово!)
□ killer_word ПЕРЕВОРАЧИВАЕТ смысл? (если убрать — реплика теряет удар)
□ B отвечает на ТУ ЖЕ тему что A? (не ушёл в другую тему?)
□ Нет тире (—, –, -)? Нет английских слов?
□ Каждая реплика работает как вирусная цитата?
Если ЛЮБОЙ пункт не пройден — ИСПРАВЬ перед выводом!
════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА — строго JSON:
{
  "humor_category_ru": "Твоя категория юмора — 2-4 слова. НЕ копируй примеры — придумай свою!",
  "dialogue_A_ru": "СТРОГО 6-10 слов, макс 1 символ |, НЕ начинай с Зато",
  "dialogue_B_ru": "СТРОГО 6-12 слов, макс 1 символ |, killer word ПОСЛЕДНЕЕ, НЕ начинай с Зато",
  "killer_word": "ОДНО слово — последнее слово из dialogue_B_ru",
  "photo_scene_en": "Smartphone selfie photo taken mid-argument... 150-250 слов на английском",
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
  "hashtags": ["тег1", "тег2", "...15-20 штук без #"]${product_info?.description_en || ctx.hasProductImage ? `,
  "product_in_frame_en": "Ультра-детальное описание товара для AI-рендеринга на английском. СТРОГО как на фото: цвет, форма, бренд, материал, размер, текстура, блики. 50-80 слов."` : ''}
}

КРИТИЧНО: Отвечай ТОЛЬКО валидным JSON. Без markdown. Без блоков кода. Без пояснений. Только JSON.`;
}

// ─── POST /api/generate — Gemini multimodal generation ──────────
app.post('/api/generate', authMiddleware, async (req, res) => {
  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен. Обратитесь к администратору.' });
  }

  // Rate limiting
  const userId = req.user?.hash || req.ip;
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
  }

  const { context, product_image, product_mime, video_file, video_file_mime, video_cover, video_cover_mime } = req.body;
  if (!context || !context.charA || !context.charB) {
    return res.status(400).json({ error: 'Context with charA, charB required' });
  }

  // Flag for prompt builder
  context.hasProductImage = !!product_image;
  context.hasVideoFile = !!video_file;
  context.hasVideoCover = !!video_cover;

  try {
    const promptText = buildGeminiPrompt(context);

    // Build multimodal parts: text + optional images
    const parts = [{ text: promptText }];

    // Attach product photo if provided — Gemini SEES the actual product
    if (product_image) {
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННОЕ ФОТО ТОВАРА — рассмотри внимательно, товар в промпте должен быть ТОЧЬ-В-ТОЧЬ как на этом фото]'
      });
      parts.push({
        inline_data: { mime_type: product_mime || 'image/jpeg', data: product_image }
      });
    }

    // Attach actual video file if provided — Gemini WATCHES the original video
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
          temperature: 0.82,
          maxOutputTokens: 4096,
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
        return res.status(422).json({ error: 'Gemini вернул невалидный JSON. Попробуйте ещё раз.' });
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
      s = s.replace(/\s*[—–]\s*/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
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

      // Fix killer_word: must be the LAST word of B's dialogue
      const bWords = bLine.replace(/[|!?.…,«»"]/g, '').trim().split(/\s+/).filter(Boolean);
      if (bWords.length > 0) {
        const actualLastWord = bWords[bWords.length - 1];
        if (geminiResult.killer_word !== actualLastWord) {
          console.log('Fixed killer_word:', { was: geminiResult.killer_word, now: actualLastWord });
          geminiResult.killer_word = actualLastWord;
        }
      }
    }

    res.json({
      gemini: geminiResult,
      model: 'gemini-2.0-flash',
      tokens: data.usageMetadata?.totalTokenCount || 0,
    });

  } catch (e) {
    console.error('Generate error:', e.message);
    res.status(500).json({ error: `Ошибка генерации: ${e.message}` });
  }
});

// ─── POST /api/product/describe — Gemini Vision: описание товара по фото ──
app.post('/api/product/describe', authMiddleware, async (req, res) => {
  const { image_base64, mime_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен. Обратитесь к администратору.' });
  }

  try {
    const mimeType = mime_type || 'image/jpeg';

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const prompt = `You are a product photography analyst specializing in creating descriptions for AI image and video generation. Analyze this product photo and provide an ULTRA-DETAILED description in English.

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
      model: 'gemini-2.0-flash',
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

// ─── POST /api/trends — Gemini analyzes current Russia trends ──────
app.post('/api/trends', authMiddleware, async (req, res) => {
  const GEMINI_KEY = nextGeminiKey();
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'AI-движок не настроен.' });
  }
  const userId = req.user?.hash || req.ip;
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
  }

  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `Сегодня ${today}. Ты — аналитик трендов российского интернета.

ЗАДАЧА: Составь список из 10 самых обсуждаемых и актуальных тем в России ПРЯМО СЕЙЧАС (последние 24-48 часов).

ИСТОЧНИКИ для анализа (используй свои знания о текущих событиях):
- Google Trends Россия (trends.google.com/trending?geo=RU)
- Яндекс.Новости, РИА, ТАСС
- Telegram-каналы, Twitter/X русскоязычный сегмент
- TikTok и Instagram тренды в РФ

ПРАВИЛА ФИЛЬТРАЦИИ — ИСКЛЮЧИ:
- Спортивные матчи и результаты (футбол, хоккей, баскетбол и т.д.)
- Просто фамилии без контекста (если непонятно почему человек в тренде — не включай)
- Погоду и прогнозы
- Рутинные новости без вирусного потенциала
- Политические скандалы без комедийного потенциала

ПРАВИЛА ВКЛЮЧЕНИЯ — бери только то, что:
- Люди ОБСУЖДАЮТ и спорят (есть две стороны мнений)
- Можно обыграть в КОМЕДИЙНОМ 8-секундном видео с двумя персонажами
- Вызывает ЭМОЦИИ: удивление, возмущение, ностальгию, смех
- Актуально для широкой аудитории 25-55 лет в РФ

Для КАЖДОЙ темы укажи:
1. topic — короткое название темы (3-6 слов)
2. why_trending — почему это сейчас обсуждают (1 предложение)
3. comedy_angle — как обыграть в комедийном видео с двумя персонажами (бабки/деды/мамы/папы спорят на эту тему)
4. example_idea — конкретная идея для 8-секундного видео: кто A, кто B, о чём спор, какой панчлайн
5. virality — оценка вирусности от 1 до 10

ФОРМАТ — строго JSON массив:
[
  {
    "topic": "тема",
    "why_trending": "почему обсуждают",
    "comedy_angle": "как обыграть",
    "example_idea": "A (бабка): '...' → B (дед): '...'",
    "virality": 8
  }
]

Отвечай ТОЛЬКО JSON массивом. Без markdown. Без пояснений. Только JSON.`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: data.error?.message || 'Gemini error' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'AI не вернул контент' });
    }

    let trends;
    try {
      trends = JSON.parse(text);
    } catch {
      try {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) trends = JSON.parse(m[0]);
      } catch { /* fallback parse also failed */ }
    }

    if (!Array.isArray(trends)) {
      return res.status(422).json({ error: 'AI вернул невалидный формат' });
    }

    res.json({ trends, date: today });
  } catch (e) {
    console.error('Trends API error:', e.message);
    res.status(500).json({ error: 'Ошибка при запросе трендов' });
  }
});

// ─── Health ──────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'api' }));

// ─── SPA Fallback ───────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(appDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FERIXDI Studio API running on port ${PORT}`);
});
