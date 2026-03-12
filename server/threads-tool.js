/**
 * FERIXDI Studio — Threads Batch Tool (Internal)
 * Multi-stage Gemini pipeline → Buffer scheduled posting for Threads.
 * Mounted at /internal/threads-queue
 */

import { Router } from 'express';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function createThreadsTool(deps) {
  const { nextGeminiKey, fetchRealHeadlines, checkRateLimit, getClientIP } = deps;
  const router = Router();

  // ── ENV CONFIG ──────────────────────────────────────────────────────────
  const BUFFER_API_KEY       = process.env.BUFFER_API_KEY || '';
  const BUFFER_CHANNEL_ID    = process.env.BUFFER_THREADS_CHANNEL_ID || '';
  const TOOL_PASSWORD         = process.env.THREADS_TOOL_PASSWORD || 'ferixdiai';
  const GEMINI_MODEL         = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
  const USE_GROUNDING        = process.env.GEMINI_USE_GROUNDING !== 'false';
  const TZ                   = process.env.THREADS_TOOL_TIMEZONE || 'Europe/Moscow';
  const DEFAULT_POSTS        = parseInt(process.env.THREADS_DEFAULT_POSTS_PER_DAY) || 36;
  const DEFAULT_START        = process.env.THREADS_DEFAULT_WINDOW_START || '08:00';
  const DEFAULT_END          = process.env.THREADS_DEFAULT_WINDOW_END || '23:30';
  const DEFAULT_MIN_INT      = parseInt(process.env.THREADS_DEFAULT_MIN_INTERVAL_MINUTES) || 18;
  const DEFAULT_MAX_INT      = parseInt(process.env.THREADS_DEFAULT_MAX_INTERVAL_MINUTES) || 55;
  const THREADS_CHAR_LIMIT   = 500;

  // ── BUFFER FREE PLAN CONFIG ────────────────────────────────────────────
  const BUFFER_TARGET_QUEUE  = parseInt(process.env.BUFFER_TARGET_QUEUE_DEPTH) || 10;
  const BUFFER_REFILL_MS     = _parseRefillInterval(process.env.BUFFER_REFILL_CRON || '*/20 * * * *');
  const BUFFER_SAFE_MODE     = process.env.BUFFER_SAFE_MODE_ON_QUEUE_UNKNOWN !== 'false';
  const BUFFER_MAX_PER_RUN   = parseInt(process.env.BUFFER_MAX_SEND_PER_RUN) || 10;

  function _parseRefillInterval(cron) {
    const m = cron.match(/\*\/(\d+)/);
    return (m ? parseInt(m[1]) : 20) * 60_000;
  }

  // ── IN-MEMORY STORAGE & RESERVOIR ──────────────────────────────────────
  let _batches = [];
  const _reservoir = [];          // approved posts waiting to be sent
  const _sentHashes = new Set();
  const _auditLog = [];
  const MAX_BATCHES = 50;
  const MAX_AUDIT = 500;
  const MAX_RESERVOIR = 500;

  // ── REFILL ENGINE STATE ────────────────────────────────────────────────
  let _refillTimer = null;
  let _refillLock = false;
  let _refillPaused = false;
  let _lastRefill = { ts: null, status: 'idle', sent: 0, skipped: 0, error: null, queue_depth: null };
  let _bufferQueueCache = { depth: null, ts: 0, posts: [] };
  const QUEUE_CACHE_TTL = 60_000; // cache queue depth for 1 min

  // ── SESSION MANAGEMENT ─────────────────────────────────────────────────
  const _sessions = new Map();
  const SESSION_TTL = 24 * 3600_000;

  function _cookie(req, name) {
    const h = req.headers.cookie || '';
    const m = h.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
    return m ? m[1] : null;
  }

  function _setSid(res, sid, req) {
    const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `tq_sid=${sid}; HttpOnly; SameSite=Strict; Max-Age=86400; Path=/internal/threads-queue${sec}`);
  }

  function _clearSid(res) {
    res.setHeader('Set-Cookie', 'tq_sid=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/internal/threads-queue');
  }

  function _audit(action, ip, ok = true, detail = '') {
    _auditLog.unshift({ ts: new Date().toISOString(), action, ip, ok, detail });
    if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  }

  // ── AUTH MIDDLEWARE ─────────────────────────────────────────────────────
  function toolAuth(req, res, next) {
    const sid = _cookie(req, 'tq_sid');
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    const s = _sessions.get(sid);
    if (!s || Date.now() > s.expires) {
      _sessions.delete(sid);
      return res.status(401).json({ error: 'Session expired' });
    }
    s.lastActivity = Date.now();
    req.toolUser = s.user;
    next();
  }

  // ── HELPERS ─────────────────────────────────────────────────────────────
  function textHash(text) {
    return crypto.createHash('md5').update((text || '').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
  }

  function ngramSet(text, n = 3) {
    const words = (text || '').toLowerCase().replace(/[^\wа-яё]/gi, ' ').split(/\s+/).filter(Boolean);
    const s = new Set();
    for (let i = 0; i <= words.length - n; i++) s.add(words.slice(i, i + n).join(' '));
    return s;
  }

  function jaccardSim(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }

  function firstNWords(text, n = 5) {
    return (text || '').split(/\s+/).slice(0, n).join(' ').toLowerCase();
  }

  // ── GEMINI CALLER ──────────────────────────────────────────────────────
  async function callGemini(prompt, { grounding = false, temperature = 0.92, maxTokens = 65536 } = {}) {
    const key = nextGeminiKey();
    if (!key) throw new Error('GEMINI_API_KEY not configured');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };

    if (grounding && USE_GROUNDING) {
      body.tools = [{ google_search: {} }];
    }

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 180_000);
    let resp, data;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      data = await resp.json().catch(() => ({}));
    } finally {
      clearTimeout(to);
    }

    // Fallback: if grounding failed, retry without
    if (grounding && USE_GROUNDING && (!resp.ok || !data.candidates)) {
      console.warn('[TQ] Grounding failed, retrying without...');
      delete body.tools;
      body.generationConfig.responseMimeType = 'application/json';
      const ac2 = new AbortController();
      const to2 = setTimeout(() => ac2.abort(), 180_000);
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac2.signal,
        });
        data = await resp.json().catch(() => ({}));
      } finally {
        clearTimeout(to2);
      }
    }

    if (!resp.ok) throw new Error(data.error?.message || `Gemini HTTP ${resp.status}`);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const raw = parts.map(p => p.text || '').join('').trim();
    if (!raw) throw new Error('Empty Gemini response');

    const usedGrounding = !!(data.candidates?.[0]?.groundingMetadata?.groundingChunks?.length);
    return { raw, usedGrounding };
  }

  function parseJSON(raw) {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/gi, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const m = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    const fixed = cleaned.replace(/,\s*([\]\}])/g, '$1');
    const m2 = fixed.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (m2) try { return JSON.parse(m2[0]); } catch {}
    // Try object wrapper
    try {
      const obj = JSON.parse(cleaned);
      const k = Object.keys(obj).find(k => Array.isArray(obj[k]));
      if (k) return obj[k];
    } catch {}
    return null;
  }

  // ── SCHEDULING ENGINE ──────────────────────────────────────────────────
  function buildSchedule(count, { windowStart, windowEnd, minInterval, maxInterval, mode }) {
    const [sh, sm] = windowStart.split(':').map(Number);
    const [eh, em] = windowEnd.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const totalMin = endMin - startMin;

    if (count <= 0 || totalMin <= 0) return [];

    const slots = [];
    if (mode === 'aggressive') {
      // Dense posting — use min interval
      const gap = Math.max(minInterval, Math.floor(totalMin / count));
      for (let i = 0; i < count; i++) {
        slots.push(startMin + i * gap);
      }
    } else if (mode === 'custom') {
      // Even distribution
      const gap = totalMin / count;
      for (let i = 0; i < count; i++) {
        slots.push(Math.round(startMin + i * gap));
      }
    } else {
      // Normal — organic-looking distribution with jitter
      const avgGap = totalMin / count;
      let cursor = startMin;
      for (let i = 0; i < count; i++) {
        const jitter = (Math.random() - 0.5) * (maxInterval - minInterval);
        const gap = Math.max(minInterval, Math.min(maxInterval, avgGap + jitter));
        cursor += (i === 0) ? 0 : gap;
        if (cursor > endMin) cursor = endMin;
        slots.push(Math.round(cursor));
      }
    }

    // Convert minutes to ISO times for today in the configured timezone
    const now = new Date();
    // Simple offset-based approach: use Intl to get the offset
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
    const today = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate());

    return slots.map(m => {
      const d = new Date(today.getTime() + m * 60_000);
      // Adjust for timezone offset difference
      const localOffset = now.getTimezoneOffset();
      const tzOffset = (now.getTime() - tzDate.getTime()) / 60_000;
      d.setMinutes(d.getMinutes() + localOffset + Math.round(tzOffset));
      return d.toISOString();
    });
  }

  // ── DEDUP ENGINE ───────────────────────────────────────────────────────
  function dedup(candidates) {
    const kept = [];
    const seenHashes = new Set([..._sentHashes]);
    const seenNgrams = [];
    const seenStarts = new Set();

    for (const c of candidates) {
      const h = textHash(c.text);
      // Exact hash
      if (seenHashes.has(h)) { c._rejected = 'exact_dup'; continue; }
      // Same start (first 5 words)
      const start = firstNWords(c.text, 5);
      if (seenStarts.has(start)) { c._rejected = 'same_start'; continue; }
      // N-gram similarity > 0.4
      const ng = ngramSet(c.text);
      let tooSimilar = false;
      for (const prev of seenNgrams) {
        if (jaccardSim(ng, prev) > 0.4) { tooSimilar = true; break; }
      }
      if (tooSimilar) { c._rejected = 'too_similar'; continue; }

      seenHashes.add(h);
      seenStarts.add(start);
      seenNgrams.push(ng);
      kept.push(c);
    }
    return kept;
  }

  // ── DIVERSITY REORDER ──────────────────────────────────────────────────
  function diversityReorder(candidates) {
    if (candidates.length <= 2) return candidates;
    const result = [];
    const pool = [...candidates];
    let lastType = '';
    let lastTopic = '';
    let sameTypeStreak = 0;
    let sameTopicStreak = 0;

    while (pool.length > 0) {
      let best = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        let ds = c.total_score || 0;
        if (c.post_type === lastType) ds -= 20 + (sameTypeStreak >= 1 ? 30 : 0);
        if (c.signal_id === lastTopic) ds -= 15 + (sameTopicStreak >= 1 ? 30 : 0);
        if (ds > bestScore) { bestScore = ds; best = i; }
      }
      const picked = pool.splice(best, 1)[0];
      sameTypeStreak = (picked.post_type === lastType) ? sameTypeStreak + 1 : 0;
      sameTopicStreak = (picked.signal_id === lastTopic) ? sameTopicStreak + 1 : 0;
      lastType = picked.post_type;
      lastTopic = picked.signal_id;
      result.push(picked);
    }
    return result;
  }

  // ── BUFFER API — ROLLING QUEUE MANAGER ───────────────────────────────

  async function bufferGraphQL(query, variables = {}) {
    if (!BUFFER_API_KEY) throw new Error('BUFFER_API_KEY not configured');
    const resp = await fetch('https://graph.bufferapp.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BUFFER_API_KEY}` },
      body: JSON.stringify({ query, variables }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.errors?.length) {
      throw new Error(data.errors?.[0]?.message || `Buffer HTTP ${resp.status}`);
    }
    return data.data || {};
  }

  async function getBufferQueueDepth() {
    if (!BUFFER_API_KEY || !BUFFER_CHANNEL_ID) return { depth: null, posts: [], error: 'not_configured' };
    // Return cache if fresh
    if (_bufferQueueCache.depth !== null && Date.now() - _bufferQueueCache.ts < QUEUE_CACHE_TTL) {
      return { depth: _bufferQueueCache.depth, posts: _bufferQueueCache.posts, cached: true };
    }
    try {
      const data = await bufferGraphQL(`query GetPosts($channelId: ID!) {
        channel(id: $channelId) {
          pendingQueue { totalCount edges { node { id text dueAt status } } }
        }
      }`, { channelId: BUFFER_CHANNEL_ID });

      const queue = data.channel?.pendingQueue;
      const posts = (queue?.edges || []).map(e => e.node);
      const depth = queue?.totalCount ?? posts.length;
      _bufferQueueCache = { depth, posts, ts: Date.now() };
      return { depth, posts };
    } catch (e) {
      console.warn('[TQ] Buffer queue check failed:', e.message);
      return { depth: null, posts: [], error: e.message };
    }
  }

  async function sendOneToBuffer(text, dueAt) {
    if (!BUFFER_CHANNEL_ID) throw new Error('BUFFER_THREADS_CHANNEL_ID not configured');
    const result = await bufferGraphQL(`mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) { id status scheduledAt }
    }`, {
      input: {
        channelIds: [BUFFER_CHANNEL_ID],
        text: text.slice(0, THREADS_CHAR_LIMIT),
        schedulingType: 'custom',
        mode: 'customSchedule',
        dueAt,
      },
    });
    return result.createPost || {};
  }

  // ── STALENESS & FRESHNESS DECAY ────────────────────────────────────────

  function computeStaleAfter(candidate, approvedAt) {
    const topicality = candidate.scores?.topicality_today || 0;
    const hoursWindow = topicality >= 8 ? 12 : topicality >= 5 ? 24 : 72;
    return new Date(new Date(approvedAt).getTime() + hoursWindow * 3600_000).toISOString();
  }

  function computeFreshnessDecay(candidate) {
    if (!candidate.stale_after || !candidate.approved_at) return 10;
    const now = Date.now();
    const approved = new Date(candidate.approved_at).getTime();
    const staleAt = new Date(candidate.stale_after).getTime();
    const window = staleAt - approved;
    if (window <= 0) return 0;
    const elapsed = now - approved;
    return Math.max(0, Math.round(10 * (1 - elapsed / window) * 10) / 10);
  }

  function computeRefillPriority(candidate) {
    const s = candidate.scores || {};
    const decay = computeFreshnessDecay(candidate);
    // Higher decay risk = higher urgency (invert: low decay score = send ASAP)
    const urgency = Math.max(0, 10 - decay);
    return (
      urgency * 3 +
      (s.comment_bait || 0) * 3 +
      (s.topicality_today || 0) * 3 +
      (s.novelty || 0) * 2 +
      (s.social_relatability || 0) * 2 +
      (s.hook_strength || 0) * 2
    );
  }

  function markStaleInReservoir() {
    const now = Date.now();
    let staleCount = 0;
    for (const p of _reservoir) {
      if (p.internal_status !== 'pending_send') continue;
      if (p.stale_after && now > new Date(p.stale_after).getTime()) {
        p.internal_status = 'stale';
        staleCount++;
      } else {
        p.freshness_decay_score = computeFreshnessDecay(p);
        p.priority_score = computeRefillPriority(p);
      }
    }
    if (staleCount > 0) console.log(`[TQ] Marked ${staleCount} posts as stale`);
    return staleCount;
  }

  // ── REFILL ENGINE ──────────────────────────────────────────────────────

  async function runRefill(manual = false) {
    if (_refillLock) {
      console.log('[TQ] Refill skipped — already running');
      return { status: 'locked', sent: 0 };
    }
    if (_refillPaused && !manual) {
      return { status: 'paused', sent: 0 };
    }
    _refillLock = true;
    const runId = `refill_${Date.now().toString(36)}`;

    try {
      // 1. Mark stale posts
      markStaleInReservoir();

      // 2. Get pending posts
      const pending = _reservoir
        .filter(p => p.internal_status === 'pending_send')
        .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

      if (pending.length === 0) {
        _lastRefill = { ts: new Date().toISOString(), status: 'empty', sent: 0, skipped: 0, error: null, queue_depth: _bufferQueueCache.depth };
        console.log('[TQ] Refill: no pending posts in reservoir');
        return { status: 'empty', sent: 0 };
      }

      // 3. Check Buffer queue depth
      const qInfo = await getBufferQueueDepth();

      if (qInfo.depth === null) {
        // Queue depth unknown
        if (BUFFER_SAFE_MODE) {
          _lastRefill = { ts: new Date().toISOString(), status: 'safe_mode', sent: 0, skipped: 0, error: 'Queue depth unknown — safe mode', queue_depth: null };
          console.warn('[TQ] Refill: queue depth unknown, safe mode — skipping');
          return { status: 'safe_mode', sent: 0 };
        }
        // Unsafe fallback: send max 1
        console.warn('[TQ] Refill: queue depth unknown, sending max 1 (unsafe fallback)');
      }

      const currentDepth = qInfo.depth ?? BUFFER_TARGET_QUEUE;
      const freeSlots = Math.max(0, BUFFER_TARGET_QUEUE - currentDepth);

      if (freeSlots === 0) {
        _lastRefill = { ts: new Date().toISOString(), status: 'queue_full', sent: 0, skipped: 0, error: null, queue_depth: currentDepth };
        console.log(`[TQ] Refill: queue full (${currentDepth}/${BUFFER_TARGET_QUEUE})`);
        return { status: 'queue_full', sent: 0 };
      }

      // 4. Apply diversity filter to pending queue
      const toSendCount = Math.min(freeSlots, BUFFER_MAX_PER_RUN, pending.length, qInfo.depth === null ? 1 : Infinity);
      const toSend = diversityReorder(pending.slice(0, toSendCount * 2)).slice(0, toSendCount);

      // 5. Compute scheduling times for the batch
      const times = buildSchedule(toSend.length, {
        windowStart: DEFAULT_START, windowEnd: DEFAULT_END,
        minInterval: DEFAULT_MIN_INT, maxInterval: DEFAULT_MAX_INT,
        mode: 'normal',
      });

      // 6. Send to Buffer one by one
      let sent = 0, failed = 0;
      for (let i = 0; i < toSend.length; i++) {
        const post = toSend[i];

        // Idempotency: skip if already sent
        if (post.buffer_post_id || post.internal_status === 'sent_to_buffer') continue;

        post.last_send_attempt_at = new Date().toISOString();
        post.send_attempts = (post.send_attempts || 0) + 1;
        post.refill_batch_id = runId;

        const dueAt = times[i] || new Date(Date.now() + (i + 1) * DEFAULT_MIN_INT * 60_000).toISOString();

        try {
          const bufResult = await sendOneToBuffer(post.text, dueAt);
          post.buffer_post_id = bufResult.id || `buf_${Date.now()}`;
          post.internal_status = 'sent_to_buffer';
          post.buffer_status = 'queued';
          post.queued_at = new Date().toISOString();
          post.scheduled_at = dueAt;
          _sentHashes.add(post.text_hash);
          sent++;
        } catch (e) {
          post.buffer_status = 'error';
          post.send_error = e.message;
          failed++;
          console.error(`[TQ] Refill send failed for ${post.id}:`, e.message);
          // If Buffer is down, stop sending more
          if (e.message.includes('HTTP 5') || e.message.includes('fetch failed')) break;
        }

        // Throttle between sends
        if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 800));
      }

      // Invalidate queue cache after sends
      _bufferQueueCache.ts = 0;

      _lastRefill = {
        ts: new Date().toISOString(),
        status: failed === 0 ? 'ok' : 'partial',
        sent, skipped: failed, error: null,
        queue_depth: currentDepth,
      };
      _audit('refill', 'system', true, `run=${runId} sent=${sent} fail=${failed} depth=${currentDepth}`);
      console.log(`[TQ] Refill ${runId}: sent=${sent} failed=${failed} depth=${currentDepth}→${currentDepth + sent}`);
      return { status: 'ok', sent, failed, queue_depth: currentDepth + sent };

    } catch (e) {
      _lastRefill = { ts: new Date().toISOString(), status: 'error', sent: 0, skipped: 0, error: e.message, queue_depth: null };
      console.error('[TQ] Refill error:', e.message);
      return { status: 'error', sent: 0, error: e.message };
    } finally {
      _refillLock = false;
    }
  }

  function startRefillTimer() {
    if (_refillTimer) return;
    if (!BUFFER_API_KEY || !BUFFER_CHANNEL_ID) {
      console.log('[TQ] Refill timer NOT started (Buffer not configured)');
      return;
    }
    _refillTimer = setInterval(() => {
      runRefill(false).catch(e => console.error('[TQ] Refill interval error:', e.message));
    }, BUFFER_REFILL_MS);
    console.log(`[TQ] Refill timer started: every ${Math.round(BUFFER_REFILL_MS / 60_000)} min, target depth: ${BUFFER_TARGET_QUEUE}`);
  }

  function stopRefillTimer() {
    if (_refillTimer) { clearInterval(_refillTimer); _refillTimer = null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ── ROUTES ────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── LOGIN ──────────────────────────────────────────────────────────────
  router.post('/login', async (req, res) => {
    const ip = getClientIP(req);
    if (!checkRateLimit(`tq_login:${ip}`, 900_000, 5)) {
      _audit('login', ip, false, 'rate_limited');
      return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
    }
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password required' });
    }

    if (password !== TOOL_PASSWORD) {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
      _audit('login', ip, false, 'wrong_password');
      return res.status(401).json({ error: 'Неверный ключ доступа' });
    }

    const sid = crypto.randomBytes(32).toString('hex');
    _sessions.set(sid, { user: 'admin', ip, created: Date.now(), expires: Date.now() + SESSION_TTL, lastActivity: Date.now() });
    _setSid(res, sid, req);
    _audit('login', ip, true);
    console.log(`[TQ] ✓ Login from ${ip}`);
    res.json({ ok: true });
  });

  // ── LOGOUT ─────────────────────────────────────────────────────────────
  router.post('/logout', (req, res) => {
    const sid = _cookie(req, 'tq_sid');
    if (sid) { _sessions.delete(sid); _audit('logout', getClientIP(req)); }
    _clearSid(res);
    res.json({ ok: true });
  });

  // ── STATUS ─────────────────────────────────────────────────────────────
  router.get('/api/status', toolAuth, (req, res) => {
    const pendingCount = _reservoir.filter(p => p.internal_status === 'pending_send').length;
    const sentCount = _reservoir.filter(p => p.internal_status === 'sent_to_buffer').length;
    const staleCount = _reservoir.filter(p => p.internal_status === 'stale').length;
    res.json({
      ok: true, user: req.toolUser,
      batches: _batches.length, sent_hashes: _sentHashes.size,
      defaults: { posts_count: DEFAULT_POSTS, window_start: DEFAULT_START, window_end: DEFAULT_END, timezone: TZ, min_interval: DEFAULT_MIN_INT, max_interval: DEFAULT_MAX_INT },
      buffer_ok: !!(BUFFER_API_KEY && BUFFER_CHANNEL_ID),
      gemini_ok: !!nextGeminiKey(),
      reservoir: { total: _reservoir.length, pending: pendingCount, sent: sentCount, stale: staleCount },
      queue: { cached_depth: _bufferQueueCache.depth, target: BUFFER_TARGET_QUEUE, free_slots: _bufferQueueCache.depth !== null ? Math.max(0, BUFFER_TARGET_QUEUE - _bufferQueueCache.depth) : null },
      refill: { paused: _refillPaused, interval_min: Math.round(BUFFER_REFILL_MS / 60_000), last: _lastRefill },
    });
  });

  // ── STAGE A: HARVEST SIGNALS ───────────────────────────────────────────
  router.post('/api/harvest', toolAuth, async (req, res) => {
    const ip = getClientIP(req);
    if (!checkRateLimit(`tq_harvest:${ip}`, 120_000, 2)) {
      return res.status(429).json({ error: 'Подождите 2 мин. между сборами сигналов.' });
    }

    let rssHeadlines = [];
    try { rssHeadlines = await fetchRealHeadlines(); } catch (e) {
      console.warn('[TQ] RSS fetch failed:', e.message);
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    const rssBlock = rssHeadlines.length > 0
      ? `\n\nВЕРИФИЦИРОВАННЫЕ НОВОСТИ ДНЯ (RSS, ${dateStr}):\n${rssHeadlines.slice(0, 25).map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.desc ? ' — ' + h.desc.slice(0, 120) : ''}`).join('\n')}\n`
      : '';

    const prompt = `Сегодня ${dateStr}. Ты — аналитик инфополя и бытовых триггеров для Threads-постинга.
${rssBlock}
ЗАДАЧА: Собери 15-20 СИГНАЛОВ текущего дня — темы, события, триггеры, бытовые раздражители, инфоповоды.

КАТЕГОРИИ СИГНАЛОВ:
- Новости/события дня (массовые сбои, скандалы, решения, запуски)
- Бытовые триггеры (цены, очереди, погода, маркетплейсы, доставка)
- Технологии (AI, приложения, обновления, баги)
- Деньги/работа (зарплаты, увольнения, курс, ипотека)
- Отношения/быт (универсальные триггеры дня)
- Соцсети (тренды, мемы, вирусные темы)
- Спорные вопросы (о чём спорят прямо сейчас)

Для каждого сигнала определи:
- КАКИЕ ЭМОЦИИ он вызывает (злость, удивление, юмор, раздражение, ностальгия)
- КАКИЕ УГЛЫ ЗАХОДА возможны (бытовой вопрос, спорный тезис, наблюдение, "а у вас тоже", выбор из двух, "что бесит", "что переоценено", "в какой момент это стало нормой")
- ПОТЕНЦИАЛ КОММЕНТАРИЕВ (0-100)

Верни ТОЛЬКО валидный JSON массив. Без markdown, без пояснений.

[
  {
    "id": "sig_1",
    "topic_ru": "Краткое описание сигнала",
    "category": "tech|finance|social|lifestyle|news|relations",
    "freshness": "breaking|today|trending",
    "emotion": "anger|surprise|curiosity|humor|concern|irritation",
    "source": "RSS: Lenta.ru" или "Тренд дня" или "Бытовой триггер",
    "bait_potential": 85,
    "angles": ["бытовой вопрос", "спорный тезис", "а у вас тоже"]
  }
]`;

    try {
      const { raw, usedGrounding } = await callGemini(prompt, { grounding: true, temperature: 0.8 });
      let signals = parseJSON(raw);
      if (!Array.isArray(signals)) {
        return res.status(422).json({ error: 'Не удалось разобрать сигналы. Попробуйте ещё раз.' });
      }

      signals = signals.slice(0, 25).map((s, i) => ({
        id: s.id || `sig_${i + 1}`,
        topic_ru: String(s.topic_ru || '').slice(0, 200),
        category: s.category || 'news',
        freshness: s.freshness || 'today',
        emotion: s.emotion || 'curiosity',
        source: String(s.source || '').slice(0, 100),
        bait_potential: Math.min(100, Math.max(0, parseInt(s.bait_potential) || 50)),
        angles: Array.isArray(s.angles) ? s.angles.slice(0, 8).map(a => String(a).slice(0, 60)) : [],
      }));

      console.log(`[TQ] Harvested ${signals.length} signals (grounding: ${usedGrounding}, RSS: ${rssHeadlines.length})`);
      res.json({ signals, grounding: usedGrounding, rss_count: rssHeadlines.length, date: dateStr });
    } catch (e) {
      console.error('[TQ] Harvest error:', e.message);
      res.status(500).json({ error: `Ошибка сбора сигналов: ${e.message}` });
    }
  });

  // ── STAGE B+C+D: GENERATE & SCORE CANDIDATES ──────────────────────────
  router.post('/api/generate', toolAuth, async (req, res) => {
    const ip = getClientIP(req);
    if (!checkRateLimit(`tq_gen:${ip}`, 120_000, 2)) {
      return res.status(429).json({ error: 'Подождите 2 мин.' });
    }

    const { signals, posts_count = DEFAULT_POSTS, format_mix } = req.body;
    if (!Array.isArray(signals) || signals.length === 0) {
      return res.status(400).json({ error: 'Signals array required' });
    }

    const targetCount = Math.min(60, Math.max(5, parseInt(posts_count) || DEFAULT_POSTS));
    const genCount = Math.min(180, targetCount * 4);

    // Recent sent posts for anti-duplication context
    const recentSent = _batches
      .filter(b => b.status === 'sent' || b.status === 'approved')
      .flatMap(b => b.candidates.filter(c => c.internal_status === 'sent_to_buffer' || c.internal_status === 'pending_send').map(c => c.text))
      .slice(0, 30);

    const recentBlock = recentSent.length > 0
      ? `\n\nУЖЕ ОТПРАВЛЕННЫЕ ПОСТЫ (НЕ ПОВТОРЯЙ!):\n${recentSent.map((t, i) => `${i + 1}. "${t.slice(0, 80)}..."`).join('\n')}\n`
      : '';

    const signalsBlock = signals.map((s, i) =>
      `${i + 1}. [${s.category}] ${s.topic_ru} (${s.emotion}, потенциал: ${s.bait_potential}) → углы: ${(s.angles || []).join(', ')}`
    ).join('\n');

    const defaultMix = {
      'актуалка_дня': 25, 'бытовой_вброс': 15, 'спорный_тезис': 15,
      'выбор_из_двух': 10, 'а_у_вас_тоже': 10, 'что_бесит': 10,
      'что_переоценено': 8, 'в_какой_момент': 7,
    };
    const mix = format_mix || defaultMix;
    const mixBlock = Object.entries(mix).map(([k, v]) => `- ${k}: ${v}%`).join('\n');

    const prompt = `Ты — лучший контент-мейкер для Threads. Сегодня ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}.

СИГНАЛЫ ДНЯ:
${signalsBlock}
${recentBlock}
МИКС ФОРМАТОВ:
${mixBlock}

ЗАДАЧА: Сгенерируй ${genCount} УНИКАЛЬНЫХ коротких comment-bait постов для Threads.

ТИПЫ ПОСТОВ:
- актуалка_дня: "На фоне [события] — что бесит больше всего…"
- бытовой_вброс: бытовая ситуация-триггер без привязки к новостям
- спорный_тезис: провокационное утверждение 50/50
- выбор_из_двух: "X или Y — и почему?"
- а_у_вас_тоже: "У вас тоже от [триггер] ломается день?"
- что_бесит: "Что бесит непропорционально сильно именно сегодня…"
- что_переоценено: "Что из этого переоценено сильнее всего…"
- в_какой_момент: "В какой момент [явление] стало нормой…"

ЖЁСТКИЕ ПРАВИЛА ДЛЯ КАЖДОГО ПОСТА:
1. Длина: 80-500 символов (ограничение Threads)
2. Живой разговорный тон — как пишет реальный человек, НЕ бот
3. Сильный первый заход — тормозит ленту
4. Максимально комментоёмкий — хочется ответить, оспорить, дополнить
5. БЕЗ эмодзи (если не органично), БЕЗ хэштегов, БЕЗ канцелярита
6. БЕЗ AI-тона ("в мире где", "давайте разберёмся", "важно понимать")
7. БЕЗ повторения одних и тех же шаблонов — каждый пост УНИКАЛЕН
8. БЕЗ одинаковых начал, концовок, вопросов в другой упаковке
9. Разнообразие: чередуй тон (злость, юмор, наблюдение, провокация, ирония)
10. Не более 40% постов заканчиваются вопросом

СКОРИНГ (оцени каждый пост 0-10):
- topicality_today (вес 3): привязка к дню
- hook_strength (вес 3): сила первого захода
- comment_bait (вес 3): вероятность комментария
- novelty (вес 2): небанальность
- emotional_tension (вес 2): эмоциональный заряд
- clarity (вес 1): понятность с первого прочтения
- contrarian_pull (вес 1): желание спорить
- social_relatability (вес 2): "это про меня"
- freshness_score (вес 2): свежесть формулировки

Верни ТОЛЬКО JSON массив. Без markdown, без пояснений.

[
  {
    "id": "c_1",
    "text": "Текст поста для Threads",
    "signal_id": "sig_1",
    "post_type": "актуалка_дня",
    "source_signal": "Краткое описание источника",
    "scores": {
      "topicality_today": 8,
      "hook_strength": 9,
      "comment_bait": 8,
      "novelty": 7,
      "emotional_tension": 8,
      "clarity": 9,
      "contrarian_pull": 6,
      "social_relatability": 8,
      "freshness_score": 9
    },
    "why_good": "Почему этот пост сильный (1 предложение)"
  }
]`;

    try {
      const { raw } = await callGemini(prompt, { grounding: false, temperature: 0.95, maxTokens: 65536 });
      let candidates = parseJSON(raw);
      if (!Array.isArray(candidates)) {
        return res.status(422).json({ error: 'Не удалось разобрать кандидатов.' });
      }

      // Normalize
      candidates = candidates.map((c, i) => {
        const scores = c.scores || {};
        const weighted =
          (parseInt(scores.topicality_today) || 0) * 3 +
          (parseInt(scores.hook_strength) || 0) * 3 +
          (parseInt(scores.comment_bait) || 0) * 3 +
          (parseInt(scores.novelty) || 0) * 2 +
          (parseInt(scores.emotional_tension) || 0) * 2 +
          (parseInt(scores.clarity) || 0) * 1 +
          (parseInt(scores.contrarian_pull) || 0) * 1 +
          (parseInt(scores.social_relatability) || 0) * 2 +
          (parseInt(scores.freshness_score) || 0) * 2;

        return {
          id: c.id || `c_${i + 1}`,
          text: String(c.text || '').slice(0, THREADS_CHAR_LIMIT),
          signal_id: c.signal_id || '',
          post_type: c.post_type || 'актуалка_дня',
          source_signal: String(c.source_signal || '').slice(0, 150),
          scores: {
            topicality_today: Math.min(10, parseInt(scores.topicality_today) || 0),
            hook_strength: Math.min(10, parseInt(scores.hook_strength) || 0),
            comment_bait: Math.min(10, parseInt(scores.comment_bait) || 0),
            novelty: Math.min(10, parseInt(scores.novelty) || 0),
            emotional_tension: Math.min(10, parseInt(scores.emotional_tension) || 0),
            clarity: Math.min(10, parseInt(scores.clarity) || 0),
            contrarian_pull: Math.min(10, parseInt(scores.contrarian_pull) || 0),
            social_relatability: Math.min(10, parseInt(scores.social_relatability) || 0),
            freshness_score: Math.min(10, parseInt(scores.freshness_score) || 0),
          },
          total_score: weighted,
          why_good: String(c.why_good || '').slice(0, 200),
          text_hash: textHash(c.text),
          selected: false,
          // Reservoir status fields
          internal_status: 'generated',
          buffer_status: null,
          approved_at: null,
          queued_at: null,
          buffer_post_id: null,
          last_send_attempt_at: null,
          send_attempts: 0,
          refill_batch_id: null,
          stale_after: null,
          priority_score: weighted,
          freshness_decay_score: 10,
          send_error: null,
          scheduled_at: null,
        };
      }).filter(c => c.text.length >= 20);

      // Dedup
      const beforeDedup = candidates.length;
      candidates = dedup(candidates);

      // Sort by score
      candidates.sort((a, b) => b.total_score - a.total_score);

      // Take top N and apply diversity reorder
      const shortlist = diversityReorder(candidates.slice(0, targetCount));

      // Auto-select the shortlist
      shortlist.forEach(c => { c.selected = true; });

      // Create batch
      const batchId = `batch_${Date.now().toString(36)}`;
      const batch = {
        id: batchId,
        created_at: new Date().toISOString(),
        status: 'draft',
        settings: { posts_count: targetCount, format_mix: mix },
        signals_count: signals.length,
        candidates: shortlist,
        all_candidates_count: beforeDedup,
        after_dedup_count: candidates.length,
        shortlisted_count: shortlist.length,
      };

      _batches.unshift(batch);
      if (_batches.length > MAX_BATCHES) _batches.length = MAX_BATCHES;

      console.log(`[TQ] Generated: ${beforeDedup} → dedup: ${candidates.length} → shortlist: ${shortlist.length}`);
      res.json({ batch_id: batchId, candidates: shortlist, stats: { total: beforeDedup, after_dedup: candidates.length, shortlisted: shortlist.length } });
    } catch (e) {
      console.error('[TQ] Generate error:', e.message);
      res.status(500).json({ error: `Ошибка генерации: ${e.message}` });
    }
  });

  // ── EDIT CANDIDATE ─────────────────────────────────────────────────────
  router.put('/api/candidate', toolAuth, (req, res) => {
    const { batch_id, candidate_id, text, selected } = req.body;
    const batch = _batches.find(b => b.id === batch_id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const cand = batch.candidates.find(c => c.id === candidate_id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found' });

    if (text !== undefined) {
      cand.text = String(text).slice(0, THREADS_CHAR_LIMIT);
      cand.text_hash = textHash(cand.text);
    }
    if (selected !== undefined) cand.selected = !!selected;
    res.json({ ok: true, candidate: cand });
  });

  // ── DELETE CANDIDATE ───────────────────────────────────────────────────
  router.delete('/api/candidate', toolAuth, (req, res) => {
    const { batch_id, candidate_id } = req.body;
    const batch = _batches.find(b => b.id === batch_id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    batch.candidates = batch.candidates.filter(c => c.id !== candidate_id);
    res.json({ ok: true, remaining: batch.candidates.length });
  });

  // ── REGENERATE ONE CANDIDATE ───────────────────────────────────────────
  router.post('/api/candidate/regenerate', toolAuth, async (req, res) => {
    const ip = getClientIP(req);
    if (!checkRateLimit(`tq_regen:${ip}`, 30_000, 5)) {
      return res.status(429).json({ error: 'Подождите.' });
    }

    const { batch_id, candidate_id } = req.body;
    const batch = _batches.find(b => b.id === batch_id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const idx = batch.candidates.findIndex(c => c.id === candidate_id);
    if (idx === -1) return res.status(404).json({ error: 'Candidate not found' });
    const old = batch.candidates[idx];

    const prompt = `Ты — контент-мейкер для Threads. Перепиши этот пост СОВЕРШЕННО ПО-ДРУГОМУ, сохранив тему.

СТАРЫЙ ПОСТ: "${old.text}"
ТЕМА: ${old.source_signal}
ТИП: ${old.post_type}

Правила:
- Другая структура, другой заход, другая интонация
- 80-500 символов, живой тон, без AI-канцелярита
- Должен быть ЛУЧШЕ оригинала по комментоёмкости

Верни ТОЛЬКО JSON:
{ "text": "Новый текст поста", "why_good": "Почему лучше" }`;

    try {
      const { raw } = await callGemini(prompt, { temperature: 1.0, maxTokens: 2048 });
      const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/gi, '').trim();
      let result;
      try { result = JSON.parse(cleaned); } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) result = JSON.parse(m[0]);
      }
      if (!result?.text) return res.status(422).json({ error: 'Не удалось перегенерировать.' });

      old.text = String(result.text).slice(0, THREADS_CHAR_LIMIT);
      old.text_hash = textHash(old.text);
      old.why_good = String(result.why_good || '').slice(0, 200);
      old._regenerated = true;

      res.json({ ok: true, candidate: old });
    } catch (e) {
      res.status(500).json({ error: `Ошибка: ${e.message}` });
    }
  });

  // ── APPROVE → RESERVOIR (rolling queue mode) ────────────────────────────
  router.post('/api/approve', toolAuth, (req, res) => {
    const { batch_id } = req.body;
    const batch = _batches.find(b => b.id === batch_id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const selected = batch.candidates.filter(c => c.selected && c.internal_status === 'generated');
    if (selected.length === 0) return res.status(400).json({ error: 'Нет новых выбранных постов для одобрения' });

    const now = new Date().toISOString();
    let approved = 0;
    for (const cand of selected) {
      // Idempotency: don't re-approve already approved posts
      if (cand.internal_status !== 'generated') continue;

      cand.internal_status = 'pending_send';
      cand.approved_at = now;
      cand.stale_after = computeStaleAfter(cand, now);
      cand.freshness_decay_score = 10;
      cand.priority_score = computeRefillPriority(cand);

      // Add to reservoir (avoid duplicates by text_hash)
      if (!_reservoir.find(r => r.text_hash === cand.text_hash)) {
        _reservoir.push(cand);
        if (_reservoir.length > MAX_RESERVOIR) _reservoir.shift();
      }
      approved++;
    }

    batch.status = 'approved';
    batch.approved_at = now;
    _audit('approve', getClientIP(req), true, `batch=${batch_id} approved=${approved}`);

    console.log(`[TQ] Approved ${approved} posts from batch ${batch_id} → reservoir (total: ${_reservoir.filter(p => p.internal_status === 'pending_send').length} pending)`);
    res.json({
      ok: true, batch_id, approved,
      reservoir_pending: _reservoir.filter(p => p.internal_status === 'pending_send').length,
      reservoir_total: _reservoir.length,
    });
  });

  // ── QUEUE STATUS (live Buffer depth + reservoir) ───────────────────────
  router.get('/api/queue-status', toolAuth, async (req, res) => {
    const qInfo = await getBufferQueueDepth();
    const pending = _reservoir.filter(p => p.internal_status === 'pending_send');
    const sentToBuffer = _reservoir.filter(p => p.internal_status === 'sent_to_buffer');
    const stale = _reservoir.filter(p => p.internal_status === 'stale');
    const freeSlots = qInfo.depth !== null ? Math.max(0, BUFFER_TARGET_QUEUE - qInfo.depth) : null;
    const nextRefillWould = freeSlots !== null ? Math.min(freeSlots, BUFFER_MAX_PER_RUN, pending.length) : null;

    res.json({
      buffer: {
        queue_depth: qInfo.depth,
        target_depth: BUFFER_TARGET_QUEUE,
        free_slots: freeSlots,
        queue_posts: qInfo.posts?.map(p => ({ id: p.id, text: (p.text || '').slice(0, 80), dueAt: p.dueAt })) || [],
        error: qInfo.error || null,
      },
      reservoir: {
        pending: pending.length,
        sent_to_buffer: sentToBuffer.length,
        stale: stale.length,
        total: _reservoir.length,
      },
      refill: {
        paused: _refillPaused,
        locked: _refillLock,
        last: _lastRefill,
        next_would_send: nextRefillWould,
        interval_min: Math.round(BUFFER_REFILL_MS / 60_000),
      },
    });
  });

  // ── MANUAL REFILL NOW ──────────────────────────────────────────────────
  router.post('/api/refill-now', toolAuth, async (req, res) => {
    const ip = getClientIP(req);
    if (!checkRateLimit(`tq_refill:${ip}`, 60_000, 3)) {
      return res.status(429).json({ error: 'Подождите минуту.' });
    }
    _audit('manual_refill', ip, true);
    const result = await runRefill(true);
    res.json(result);
  });

  // ── PAUSE / RESUME REFILL ─────────────────────────────────────────────
  router.post('/api/refill-pause', toolAuth, (req, res) => {
    _refillPaused = true;
    _audit('refill_pause', getClientIP(req));
    console.log('[TQ] Refill PAUSED');
    res.json({ ok: true, paused: true });
  });

  router.post('/api/refill-resume', toolAuth, (req, res) => {
    _refillPaused = false;
    _audit('refill_resume', getClientIP(req));
    console.log('[TQ] Refill RESUMED');
    res.json({ ok: true, paused: false });
  });

  // ── HISTORY ────────────────────────────────────────────────────────────
  router.get('/api/history', toolAuth, (req, res) => {
    const summary = _batches.map(b => ({
      id: b.id,
      created_at: b.created_at,
      status: b.status,
      candidates_count: b.candidates.length,
      selected_count: b.candidates.filter(c => c.selected).length,
      sent_count: b.candidates.filter(c => c.internal_status === 'sent_to_buffer').length,
      approved_count: b.candidates.filter(c => c.internal_status === 'pending_send').length,
      approved_at: b.approved_at || null,
    }));
    res.json({ batches: summary, audit: _auditLog.slice(0, 20) });
  });

  // ── BATCH DETAIL ───────────────────────────────────────────────────────
  router.get('/api/batch/:id', toolAuth, (req, res) => {
    const batch = _batches.find(b => b.id === req.params.id);
    if (!batch) return res.status(404).json({ error: 'Not found' });
    res.json(batch);
  });

  // ── SERVE HTML PAGE ────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    res.sendFile(join(__dirname, '..', 'app', 'threads-queue.html'));
  });

  // ── START REFILL TIMER ───────────────────────────────────────────────
  startRefillTimer();

  console.log(`[TQ] Threads Batch Tool initialized. Buffer: ${BUFFER_API_KEY ? 'configured' : 'NOT configured'}. Gemini model: ${GEMINI_MODEL}. Target queue: ${BUFFER_TARGET_QUEUE}`);
  return router;
}
