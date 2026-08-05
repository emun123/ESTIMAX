/* ══════════════════════════════════════════════════════════════
   ESTIMAX Service Worker
   ──────────────────────────────────────────────────────────────
   אסטרטגיה:
     • קבצי האפליקציה (HTML/JS/CSS/אייקונים) — network-first עם
       נפילה למטמון. כך תמיד מקבלים את הגרסה החדשה כשיש רשת,
       ואפשר לעבוד גם בלי רשת.
     • קריאות ל-Supabase ולממשקי API חיצוניים — לעולם לא נשמרות
       במטמון. הסנכרון מטופל ב-estimax-api.js.

   ⚠ אחרי כל שינוי בקוד — העלה את CACHE_VERSION למספר הבא.
     בלי זה המכשירים ימשיכו להציג את הגרסה הישנה.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'estimax-v1';
const PRECACHE = [
  './',
  './index.html',
  './estimax-config.js',
  './estimax-api.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './offline.html'
];

// דומיינים שאסור לשמור במטמון — נתונים חיים
const NEVER_CACHE = [
  'supabase.co',
  'supabase.in',
  'data.gov.il',
  'vpic.nhtsa.dot.gov',
  'api.anthropic.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE).catch(err => {
        console.warn('[SW] חלק מהקבצים לא נשמרו במטמון', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER_CACHE.some(d => url.hostname.includes(d))) return;   // ישר לרשת
  if (url.protocol === 'chrome-extension:') return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(cached => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./offline.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        })
      )
  );
});

// מאפשר לדף לבקש עדכון מיידי ("יש גרסה חדשה — רענן")
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
