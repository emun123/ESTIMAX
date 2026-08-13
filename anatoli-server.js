/**
 * anatoli-server.js — שרת נקודת הקצה של אנטולי
 * ---------------------------------------------------------------------------
 * מקבל תמונות מ-index.html, מריץ את מנוע הניתוח, ומחזיר אומדן שמאי.
 *
 * זהו השרת המלא שמחליף את anatoli-backend-starter.js ההדגמתי.
 * רץ על כל פלטפורמה שתומכת ב-Node (Render / Railway / Fly / VPS).
 *
 * הפעלה מקומית:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npm install express cors
 *   node anatoli-server.js
 *
 * ואז ב-index.html:  var ANATOLI_API_ENDPOINT='http://localhost:8787/analyze';
 * ---------------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const cors = require('cors');
const { analyzeWithAnatoli } = require('./anatoli-engine.js');

const PORT = process.env.PORT || 8787;
const ALLOWED_ROLES = ['Anatoli_Appraiser'];

/* מקורות מורשים — ברירת המחדל מתירה רק את האתר החי ולוקאלהוסט.
   להוספת דומיין: ANATOLI_ALLOWED_ORIGINS="https://a.com,https://b.com" */
const ALLOWED_ORIGINS = (process.env.ANATOLI_ALLOWED_ORIGINS ||
  'https://emun123.github.io,http://localhost:8080,http://127.0.0.1:8080')
  .split(',').map(s => s.trim()).filter(Boolean);

const app = express();

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);           // curl / אפליקציה נייטיב
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
}));

// תמונות base64 תופסות מקום — מגבלה נדיבה אך לא אינסופית
app.use(express.json({ limit: '25mb' }));

/* ── הגבלת קצב פשוטה בזיכרון: מונע הצפה והתרוקנות ארנק ── */
const hits = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, start: now };

  if (now - rec.start > RATE_WINDOW_MS) { rec.count = 0; rec.start = now; }
  rec.count++;
  hits.set(ip, rec);

  if (rec.count > RATE_MAX) {
    return res.status(429).json({ error: 'יותר מדי בקשות — נסה שוב בעוד דקה' });
  }
  next();
}

// ניקוי תקופתי כדי שהמפה לא תתנפח
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (now - rec.start > RATE_WINDOW_MS * 5) hits.delete(ip);
  }
}, RATE_WINDOW_MS * 5).unref();

/* ── בדיקת בריאות ── */
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'anatoli',
    engine_ready: !!process.env.ANTHROPIC_API_KEY,
    time: new Date().toISOString(),
  });
});

/* ── נקודת הקצה הראשית ── */
app.post('/analyze', rateLimit, async (req, res) => {
  const started = Date.now();

  try {
    const { tik, role, photos, vehicle } = req.body || {};

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(403).json({ error: 'אין הרשאה — נדרש תפקיד Anatoli_Appraiser' });
    }
    if (!tik) {
      return res.status(400).json({ error: 'חסר מספר תיק' });
    }
    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'לא צורפו תמונות לניתוח' });
    }
    if (photos.length > 8) {
      return res.status(400).json({ error: 'עד 8 תמונות בבקשה אחת' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'המנוע אינו מוגדר — חסר ANTHROPIC_API_KEY בשרת' });
    }

    const result = await analyzeWithAnatoli(tik, photos, vehicle);

    console.log(`[anatoli] תיק ${tik} | ${photos.length} תמונות | ` +
      `${result.parts.length} חלקים | ${Date.now() - started}ms`);

    res.json(result);

  } catch (err) {
    console.error('[anatoli] שגיאה:', err.message);
    // לא מחזירים stack ללקוח
    res.status(500).json({ error: 'שגיאה בניתוח התמונות: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🔍 שרת אנטולי פועל על פורט ${PORT}`);
  console.log(`   בריאות:  http://localhost:${PORT}/health`);
  console.log(`   ניתוח:   POST http://localhost:${PORT}/analyze`);
  console.log(`   מנוע:    ${process.env.ANTHROPIC_API_KEY ? '✓ מוכן' : '✗ חסר ANTHROPIC_API_KEY'}`);
  console.log(`   מקורות:  ${ALLOWED_ORIGINS.join(', ')}\n`);
});

module.exports = app;
