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
app.use(express.json());

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

  const hash = crypto.createHash('sha256').update(key).digest('hex');
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

// ─── POST /api/thread/summarize ──────────────
app.post('/api/thread/summarize', authMiddleware, (req, res) => {
  const { messages, lastN = 10 } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  const recent = messages.slice(-lastN);
  const summary = recent.map(m => `[${m.role}] ${m.content}`).join('\n');
  res.json({ memory: `STYLE_MEMORY (${recent.length} msgs):\n${summary}`, count: recent.length });
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

// ─── POST /api/remix/generate ────────────────
app.post('/api/remix/generate', authMiddleware, (req, res) => {
  // In production: call Gemini API or other LLM
  // For now: return demo package stub
  res.json({
    status: 'demo',
    message: 'Production generation requires Gemini API key. Configure GEMINI_API_KEY env var.',
    demo_hint: 'Use frontend Demo mode for full local generation without API.',
  });
});

// ─── Health ──────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'api' }));

app.listen(PORT, () => {
  console.log(`FERIXDI Studio API running on port ${PORT}`);
});
