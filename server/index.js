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

app.use(cors());
app.use(express.json({ limit: '15mb' }));

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
    hookAction, releaseAction, aesthetic, script_ru } = ctx;

  // ── MODE-SPECIFIC TASK BLOCK ──
  let taskBlock = '';

  if (input_mode === 'video' && (video_meta || scene_hint)) {
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

${video_meta?.cover ? 'К этому сообщению ПРИКРЕПЛЕНА ОБЛОЖКА оригинального видео. Внимательно проанализируй её: настроение, позы, фон, цветовую палитру, ракурс, выражения лиц.' : ''}

ЧТО ДЕЛАТЬ:
1. Проанализируй структуру и энергию оригинала (темп, подача, тип юмора)
2. Извлеки КЛЮЧЕВУЮ комедийную механику (что именно смешно, какой тип конфликта)
3. Создай ПОЛНОСТЬЮ НОВЫЙ диалог на ту же тему, но от лица персонажей ниже
4. Адаптируй подачу под темп речи и характер каждого персонажа
5. Сохрани энергию и вайб оригинала, но слова должны быть 100% оригинальными`;

  } else if (input_mode === 'script' && script_ru) {
    taskBlock = `
══════════ ЗАДАНИЕ: ДОРАБОТКА СКРИПТА ══════════
Пользователь написал свой диалог. Твоя задача — сделать его ВИРУСНЫМ.

ИСХОДНЫЙ ДИАЛОГ:
• Реплика A: "${script_ru.A || '—'}"
• Реплика B: "${script_ru.B || '—'}"

ЧТО ДЕЛАТЬ:
1. Сохрани суть и тему — пользователь вложил свою идею
2. Переработай формулировки: сделай короче, резче, панчевее
3. Добавь характерные словечки и манеру речи каждого персонажа
4. Убедись что killer word в конце реплики B бьёт как пощёчина
5. Оптимизируй по длине: A = 6-9 слов, B = 6-11 слов
6. Можешь переписать полностью если оригинал не работает в 8 секунд`;

  } else {
    taskBlock = `
══════════ ЗАДАНИЕ: ОТ ИДЕИ К КОНТЕНТУ ══════════
${topic_ru ? `
ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${topic_ru}"

ЧТО ДЕЛАТЬ:
1. Возьми идею пользователя как ЯДРО — весь контент должен крутиться вокруг неё
2. Найди в этой идее конфликтную точку: о чём бы ЭТИ ДВА персонажа спорили?
3. Персонаж A должен обвинять/жаловаться/возмущаться по теме идеи
4. Персонаж B должен найти неожиданный угол и перевернуть тему
5. Killer word должен РЕЗКО переключить контекст — вот почему видео пересматривают
6. Не уходи от темы пользователя — если он написал про цены, спор про цены` : `
СВОБОДНАЯ ГЕНЕРАЦИЯ:
Пользователь не указал тему. Придумай свежую, неожиданную комедийную ситуацию по категории "${category.ru}".
Что-то о чём реально спорят пожилые русские люди. Бытовое, узнаваемое, с абсурдным поворотом.`}`;
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
${taskBlock}
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
• Фирменные слова: ${(charA.signature_words_ru || []).join(', ') || '—'}
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
• Фирменные слова: ${(charB.signature_words_ru || []).join(', ') || '—'}
• Микрожест: ${charB.identity_anchors?.micro_gesture || '—'}
• Смех: ${charB.modifiers?.laugh_style || 'quiet chuckle'}
• Гардероб: ${wardrobeB}

════════════════════════════════════════════════════════════════
СЦЕНА:
• Категория юмора: ${category.ru} (${category.en})
• Локация: ${location}
• Освещение: ${lightingMood.style} | Настроение: ${lightingMood.mood}
• Реквизит в кадре: ${propAnchor}
• Эстетика мира: ${aesthetic}

ТАЙМИНГ (строго 8 секунд ±0.2s):
[0.00–0.80] ХУК — ${hookAction.action_ru} (звук: ${hookAction.audio}). Без слов. Зрителя надо зацепить за 0.8 секунды.
[0.80–3.60] AKT A — ${charA.name_ru} произносит провокацию. 6-9 слов, темп: ${charA.speech_pace}. B молчит: губы сомкнуты, реагирует только глазами.
[3.60–7.10] AKT B — ${charB.name_ru} отвечает панчлайном. 6-11 слов, темп: ${charB.speech_pace}. KILLER WORD ≈ 7.0s. A замирает.
[7.10–8.00] RELEASE — ${releaseAction.action_ru}. НОЛЬ слов. Только смех и физическая реакция.

════════════════════════════════════════════════════════════════
ПРАВИЛА ДИАЛОГА:
• 100% естественная русская разговорная речь — как реально говорят пожилые люди
• Используй фирменные словечки и манеру каждого персонажа (см. данные выше)
• Символ | обозначает естественную паузу-вдох внутри реплики
• НИКОГДА не используй английские слова в русском диалоге
• Уровень мата СТРОГО соответствует данным: 0=абсолютно без мата, 1=мягкие выражения (блин, чёрт), 2=средние (чёрт, блядь как междометие), 3=тяжёлые
• Killer word — последнее значимое слово в реплике B. Оно должно быть НЕОЖИДАННЫМ но ЛОГИЧНЫМ. Это слово заставляет пересматривать видео.
• Между репликами A и B — тишина 0.15-0.25 секунд (gap stitch)

ПРАВИЛА ФОТО-ПРОМПТА (photo_scene_en):
• Пиши на АНГЛИЙСКОМ, начинай со слова "Hyper-realistic"
• 150-200 слов, единый плотный абзац
• Формат: вертикальное 9:16, 1080×1920, selfie POV
• Оба персонажа в кадре, лица 40-60см от камеры
• Описывай конкретные микро-выражения: ширину открытия рта, положение бровей, направление взгляда, натяжение мышц лица
• Свет: как именно он падает на кожу, тени под носом и скулами, блики в глазах
• Текстуры: поры, морщины, влага на губах, сосуды в склерах, текстура ткани одежды
• Руки: СТРОГО 5 пальцев, анатомически корректные пропорции
• Негатив: no cartoon, no anime, no plastic skin, no 6th finger, no watermark
${product_info?.description_en || ctx.hasProductImage ? `• ТОВАР: опиши товар ультра-детально в сцене, точь-в-точь как на прикреплённом фото` : ''}

ПРАВИЛА ВИДЕО (video_emotion_arc):
• Пиши на АНГЛИЙСКОМ
• Описывай МИКРО-ВЫРАЖЕНИЯ и физические изменения побитово
• hook: точное физическое действие + звук + реакция камеры
• act_A: как A подаёт реплику (жесты, мимика, движение глаз), как B молча реагирует
• act_B: как B отвечает (темп, паузы, как именно произносит killer word), как A реагирует
• release: как ИМЕННО вспыхивает смех — трясутся ли плечи, слезы, хлопок по коленке

ПРАВИЛА АТМОСФЕРЫ (video_atmosphere_en):
• Пиши на АНГЛИЙСКОМ, 80-100 слов
• Конкретные звуки данной локации (не generic "ambient sound")
• Изменения света в течение 8 секунд
• Частицы в воздухе (пыль, пар, пыльца — зависит от локации)
• Текстуры поверхностей которых касаются персонажи

ПРАВИЛА ХЕШТЕГОВ:
• 15-20 штук, на РУССКОМ, без символа #
• Стратегия: 5 нишевых (≤50K постов) + 4 средних (50K-500K) + 3 персонажных + 2 больших (500K+) + 3 вечнозелёных + 1 уникальный тег серии (типа "бабказинаvsбабкаваля")
• Хештеги РЕЛЕВАНТНЫ теме диалога и категории юмора

ПРАВИЛА ENGAGEMENT:
• viral_title_ru: провокационный заголовок, макс 150 символов, используй имена персонажей, должен вызвать НУЖНО ПОСМОТРЕТЬ
• pin_comment_ru: закреплённый коммент от автора — создаёт дебаты, отсылает к killer word
• first_comment_ru: первый коммент сразу после публикации — задаёт провокационный вопрос зрителям

════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА — строго JSON:
{
  "dialogue_A_ru": "реплика A | с паузами | 6-9 слов",
  "dialogue_B_ru": "ответ B | строится к | killer word в конце",
  "killer_word": "одно_слово",
  "photo_scene_en": "Hyper-realistic... 150-200 слов на английском",
  "video_emotion_arc": {
    "hook_en": "0.0-0.8s: описание на английском",
    "act_A_en": "0.8-3.6s: описание на английском",
    "act_B_en": "3.6-7.1s: описание на английском",
    "release_en": "7.1-8.0s: описание на английском"
  },
  "video_atmosphere_en": "80-100 слов на английском",
  "viral_title_ru": "заголовок на русском",
  "pin_comment_ru": "закреп на русском",
  "first_comment_ru": "первый коммент на русском",
  "hashtags": ["тег1", "тег2", "...15-20 штук без #"]${product_info?.description_en || ctx.hasProductImage ? `,
  "product_in_frame_en": "Ультра-детальное описание товара для AI-рендеринга на английском. СТРОГО как на фото: цвет, форма, бренд, материал, размер, текстура, блики. 50-80 слов."` : ''}
}

КРИТИЧНО: Отвечай ТОЛЬКО валидным JSON. Без markdown. Без блоков кода. Без пояснений. Только JSON.`;
}

// ─── POST /api/generate — Gemini multimodal generation ──────────
app.post('/api/generate', authMiddleware, async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY не настроен. Добавьте переменную окружения на сервере.' });
  }

  const { context, product_image, product_mime, video_cover, video_cover_mime } = req.body;
  if (!context || !context.charA || !context.charB) {
    return res.status(400).json({ error: 'Context with charA, charB required' });
  }

  // Flag for prompt builder
  context.hasProductImage = !!product_image;
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

    // Attach video cover if provided — Gemini SEES the original video
    if (video_cover) {
      parts.push({
        text: '\n\n[ПРИКРЕПЛЁННАЯ ОБЛОЖКА ОРИГИНАЛЬНОГО ВИДЕО — проанализируй настроение, позы, фон, ракурс, стиль]'
      });
      parts.push({
        inline_data: { mime_type: video_cover_mime || 'image/jpeg', data: video_cover }
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.88,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    };

    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || 'Gemini API error';
      console.error('Gemini generate error:', errMsg);
      return res.status(resp.status).json({ error: `Gemini: ${errMsg}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'Gemini не вернул контент. Попробуйте ещё раз.' });
    }

    let geminiResult;
    try {
      geminiResult = JSON.parse(text);
    } catch (parseErr) {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        geminiResult = JSON.parse(jsonMatch[1]);
      } else {
        console.error('Gemini JSON parse error:', text.slice(0, 500));
        return res.status(422).json({ error: 'Gemini вернул невалидный JSON. Попробуйте ещё раз.' });
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

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY не настроен. Добавьте переменную окружения на сервере.' });
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
      const errMsg = data.error?.message || JSON.stringify(data.error) || 'Gemini API error';
      return res.status(resp.status).json({ error: `Gemini: ${errMsg}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(422).json({ error: 'Gemini не вернул описание. Попробуйте другое фото.' });
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

// ─── Health ──────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'api' }));

// ─── SPA Fallback ───────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(appDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FERIXDI Studio API running on port ${PORT}`);
});
