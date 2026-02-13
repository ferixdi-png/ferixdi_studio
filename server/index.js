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

// ─── Gemini Meta-Prompt Builder ──────────────
function buildGeminiPrompt(ctx) {
  const { charA, charB, category, topic_ru, scene_hint, input_mode, video_meta,
    product_info, location, wardrobeA, wardrobeB, propAnchor, lightingMood,
    hookAction, releaseAction, aesthetic, script_ru } = ctx;

  let modeBlock = '';
  if (input_mode === 'video' && (video_meta || scene_hint)) {
    modeBlock = `
РЕЖИМ: ВИДЕО-РЕМИКС
Пользователь хочет пересоздать концепцию видео с этими персонажами.
${scene_hint ? `Описание оригинального видео: "${scene_hint}"` : ''}
${video_meta ? `Метаданные видео: title="${video_meta.title || ''}", author="${video_meta.author || ''}", duration=${video_meta.duration || '?'}s` : ''}
Проанализируй оригинальную концепцию, извлеки комедийную структуру и энергию, затем АДАПТИРУЙ под персонажей ниже. Сохрани вайб оригинала, но диалог должен быть 100% оригинальным и in-character.`;
  } else if (input_mode === 'script' && script_ru) {
    modeBlock = `
РЕЖИМ: ДОРАБОТКА СКРИПТА
Пользователь написал свой диалог. Доработай его — сделай панчевее, больше в характере персонажей, оптимизируй для 8-секундной подачи.
Реплика A (исходная): "${script_ru.A || '—'}"
Реплика B (исходная): "${script_ru.B || '—'}"
Сохрани суть, но сделай ВИРУСНЫМ. Можешь переписать полностью если нужно.`;
  } else {
    modeBlock = `
РЕЖИМ: ОТ ИДЕИ К КОНТЕНТУ
${topic_ru ? `Идея пользователя: "${topic_ru}"` : 'Придумай свежую комедийную концепцию на основе категории.'}
Создай полностью оригинальный, неожиданный диалог который эта конкретная пара персонажей сказала бы естественно.`;
  }

  return `Ты — FERIXDI, элитный креативный директор, специализирующийся на вирусных 8-секундных комедийных видео для TikTok/Reels. Ты создаёшь контент с пожилыми русскими персонажами, которые спорят в гиперреалистичных AI-видео.
${modeBlock}

═══════════════════════════════════════════
ПЕРСОНАЖ A (ПРОВОКАТОР — говорит первый, начинает конфликт):
Имя: ${charA.name_ru}
Возраст: ${charA.biology_override?.age || 'elderly'}
Внешность: ${charA.appearance_ru || 'elderly Russian character'}
Стиль речи: ${charA.speech_style_ru || 'expressive'}
Темп: ${charA.speech_pace || 'normal'}
Уровень мата: ${charA.swear_level || 0}/3
Вайб: ${charA.vibe_archetype || 'провокатор'}
Фирменные слова: ${(charA.signature_words_ru || []).join(', ') || '—'}
Стиль смеха: ${charA.modifiers?.laugh_style || 'natural'}
Стиль хука: ${charA.modifiers?.hook_style || 'attention grab'}

ПЕРСОНАЖ B (ПАНЧЛАЙН — отвечает разрушительным ответом):
Имя: ${charB.name_ru}
Возраст: ${charB.biology_override?.age || 'elderly'}
Внешность: ${charB.appearance_ru || 'elderly Russian character'}
Стиль речи: ${charB.speech_style_ru || 'measured'}
Темп: ${charB.speech_pace || 'normal'}
Уровень мата: ${charB.swear_level || 0}/3
Вайб: ${charB.vibe_archetype || 'база'}
Фирменные слова: ${(charB.signature_words_ru || []).join(', ') || '—'}
Стиль смеха: ${charB.modifiers?.laugh_style || 'quiet chuckle'}

═══════════════════════════════════════════
КОНТЕКСТ СЦЕНЫ:
Категория: ${category.ru} (${category.en})
Локация: ${location}
Освещение: ${lightingMood.style} — настроение: ${lightingMood.mood}
Реквизит: ${propAnchor}
Эстетика: ${aesthetic}
Гардероб A: ${wardrobeA}
Гардероб B: ${wardrobeB}
${product_info?.description_en ? `\nТОВАР В КАДРЕ: ${product_info.description_en}\nТовар ОБЯЗАН быть вплетён в диалог и сцену естественно.` : ''}

═══════════════════════════════════════════
ТАЙМИНГ-КОНТРАКТ (строго 8 секунд):
[0.00–0.80] ХУК: Физическое действие A (${hookAction.action_ru}), без слов
[0.80–3.60] AKT A: ${charA.name_ru} произносит провокацию (6-9 русских слов, темп ${charA.speech_pace})
[3.60–7.10] AKT B: ${charB.name_ru} отвечает панчлайном (6-11 русских слов, темп ${charB.speech_pace})
  → KILLER WORD должен приземлиться около отметки 7.0s — это слово вызывает реакцию
[7.10–8.00] RELEASE: Оба смеются (${releaseAction.action_ru}), НОЛЬ слов

═══════════════════════════════════════════
ФОРМАТ ОТВЕТА — строго JSON с этими полями:
{
  "dialogue_A_ru": "Реплика A на русском. Используй | для естественных пауз-вдохов. 6-9 слов макс. Должно звучать как ЕСТЕСТВЕННАЯ речь этого персонажа — используй его фирменные слова и манеру.",
  "dialogue_B_ru": "Разрушительный ответ B на русском. Используй | для пауз. 6-11 слов. Должен строиться к killer_word в самом конце.",
  "killer_word": "Одно русское слово которое бьёт как пощёчина. Должно быть последним значимым словом в реплике B.",
  "photo_scene_en": "Ультра-детализированный абзац для AI-генерации изображений на английском. Гиперреалистичный крупный план обоих персонажей в момент спора. Включи конкретные микро-выражения, как свет взаимодействует с кожей, текстуру окружения, эмоциональное напряжение видимое в языке тела. Начни со слова 'Hyper-realistic'. 150-200 слов.",
  "video_emotion_arc": {
    "hook_en": "Опиши на английском точное физическое действие, выражение лица и энергию первых 0.8 секунд",
    "act_A_en": "На английском опиши подачу A — жесты, изменения лица побитово. Как B реагирует молча?",
    "act_B_en": "На английском опиши подачу B — темп, паузы, как произносится killer word. Как A реагирует?",
    "release_en": "На английском опиши как именно вспыхивает смех, язык тела, трансформация лица от напряжения к радости"
  },
  "video_atmosphere_en": "Детальное описание окружения для видео-генерации на английском — звуки, изменения света, движение фона, частицы в воздухе, текстуры поверхностей. 80-100 слов.",
  "viral_title_ru": "Заголовок для Instagram/TikTok на русском. Провокационный, заставляет НУЖНО посмотреть. Используй имена персонажей. Макс 150 символов.",
  "pin_comment_ru": "Закреплённый коммент автора на русском. Создаёт спор/дебаты. Отсылает к killer word или панчлайну.",
  "first_comment_ru": "Первый коммент для публикации сразу после видео. Задаёт вопрос провоцирующий дискуссию.",
  "hashtags": ["массив", "из", "15-20", "русских", "хештегов", "без решётки"]
}

ПРАВИЛА:
- Диалог должен быть 100% естественная русская речь — разговорная, с манерами конкретного персонажа
- НИКОГДА не используй английские слова в диалоге
- Killer word должен быть неожиданным но логичным — такое слово заставляет пересматривать
- Фото-сцена должна быть настолько детализирована, что AI отрендерит её без малейшей двусмысленности
- Видео emotion arc должен описывать МИКРО-ВЫРАЖЕНИЯ и тонкие физические изменения
- Каждая генерация должна быть УНИКАЛЬНОЙ — никогда не повторяй паттерны, всегда удивляй
- Уровень мата должен точно соответствовать данным персонажа (0=нет, 1=мягкий, 2=средний, 3=тяжёлый)
- Весь текст должен уважать ограничение 8 секунд

ОТВЕЧАЙ ТОЛЬКО ВАЛИДНЫМ JSON. Без markdown, без блоков кода, без объяснений.`;
}

// ─── POST /api/generate — Gemini-powered generation ──────────
app.post('/api/generate', authMiddleware, async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY не настроен. Добавьте переменную окружения на сервере.' });
  }

  const { context } = req.body;
  if (!context || !context.charA || !context.charB) {
    return res.status(400).json({ error: 'Context with charA, charB required' });
  }

  try {
    const prompt = buildGeminiPrompt(context);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
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

    // Parse JSON response from Gemini
    let geminiResult;
    try {
      geminiResult = JSON.parse(text);
    } catch (parseErr) {
      // Try to extract JSON from markdown code blocks if Gemini wrapped it
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
