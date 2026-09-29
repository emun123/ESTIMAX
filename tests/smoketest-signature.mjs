/**
 * smoketest-signature.mjs — בדיקות לשכבת החתימה המתמדת
 * מדמה DOM + canvas ומאמת שמירה, טעינה, ועדיפות ענן על מקומי.
 *
 * הרצה: node tests/smoketest-signature.mjs
 */

import { readFileSync } from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANS';
const CLOUD_SIG = 'https://cloud.example/signed-url.png';

/** canvas מדומה — blank נקבע ידנית */
function makeCanvas(blank) {
  const px = new Uint8ClampedArray(4 * 4);
  if (!blank) px[3] = 255;              // פיקסל אחד אטום → לא ריק
  return {
    id: 'sigCanvas',
    width: 2, height: 2,
    _attrs: {},
    getContext: () => ({
      getImageData: () => ({ data: px }),
      clearRect: () => {},
      drawImage: () => {},
    }),
    toDataURL: () => SIG,
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
  };
}

function build({ blank = true, demo = true, cloudUrl = null, stored = null } = {}) {
  const store = {};
  if (stored) store['estimax_signature_v1'] = stored;

  const calls = { origSave: 0, origClear: 0, origRender: 0, toasts: [], drawn: [] };
  const canvas = makeCanvas(blank);

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; },
    },
    document: {
      readyState: 'complete',
      getElementById: id => (id === 'sigCanvas' ? canvas : null),
      addEventListener: () => {},
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    Promise,
    Math,
    Image: class {
      set src(v) { calls.drawn.push(v); setTimeout(() => this.onload && this.onload(), 0); }
    },
  };
  sandbox.window = sandbox;
  sandbox.toast = m => calls.toasts.push(m);
  sandbox.saveSignature = () => { calls.origSave++; };
  sandbox.clearSignature = () => { calls.origClear++; };
  sandbox.renderReport = () => { calls.origRender++; };
  sandbox.EstimaxAPI = {
    isDemo: () => demo,
    getSignatureUrl: () => Promise.resolve(cloudUrl),
  };

  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../docs/signature-persist.js', import.meta.url), 'utf8'), sandbox);
  return { sandbox, calls, canvas, store };
}

/* ── 1. התקנה לא שוברת את הפונקציות הקיימות ── */
{
  const { sandbox, calls } = build();
  sandbox.saveSignature();
  sandbox.clearSignature();
  sandbox.renderReport();
  check('הפונקציות המקוריות עדיין רצות',
    calls.origSave === 1 && calls.origClear === 1 && calls.origRender === 1);
}

/* ── 2. חתימה מצוירת נשמרת מקומית ── */
{
  const { sandbox, store } = build({ blank: false });
  sandbox.saveSignature();
  check('חתימה נשמרה ב-localStorage', store['estimax_signature_v1'] === SIG);
}

/* ── 3. קנבס ריק → לא נשמר, והמשתמש מקבל התראה ── */
{
  const { sandbox, store, calls } = build({ blank: true });
  sandbox.saveSignature();
  check('קנבס ריק לא נשמר',
    !store['estimax_signature_v1'] && calls.toasts.some(t => t.includes('ריק')),
    calls.toasts[0]);
}

/* ── 4. טעינה מהמקומי כשאין ענן ── */
{
  const { sandbox, canvas } = build({ blank: true, demo: true, stored: SIG });
  const ok = await sandbox.SignaturePersist.load(canvas);
  check('חתימה מקומית נטענה לקנבס', ok === true && canvas._attrs['data-signed'] === 'saved');
}

/* ── 5. ענן גובר על מקומי ── */
{
  const { sandbox, canvas, calls } = build({
    blank: true, demo: false, cloudUrl: CLOUD_SIG, stored: SIG,
  });
  await sandbox.SignaturePersist.load(canvas);
  check('הענן הוא מקור האמת', calls.drawn[0] === CLOUD_SIG, calls.drawn[0]);
}

/* ── 6. נפילה למקומי כשהענן נכשל ── */
{
  const { sandbox, canvas, calls } = build({ blank: true, demo: false, stored: SIG });
  sandbox.EstimaxAPI.getSignatureUrl = () => Promise.reject(new Error('רשת'));
  await sandbox.SignaturePersist.load(canvas);
  check('כשל ענן → נפילה למקומי, בלי קריסה', calls.drawn[0] === SIG);
}

/* ── 7. לא דורסים חתימה שהמשתמש כרגע צייר ── */
{
  const { sandbox, canvas, calls } = build({ blank: false, stored: SIG });
  const ok = await sandbox.SignaturePersist.load(canvas);
  check('קנבס מצויר לא נדרס', ok === false && calls.drawn.length === 0);
}

/* ── 8. אין חתימה בכלל → מחזיר false בשקט ── */
{
  const { sandbox, canvas } = build({ blank: true });
  const ok = await sandbox.SignaturePersist.load(canvas);
  check('אין חתימה שמורה → false בלי שגיאה', ok === false);
}

/* ── 9. localStorage חסום (מצב פרטי) → לא קורס ── */
{
  const { sandbox } = build({ blank: false });
  sandbox.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  let threw = false;
  try { sandbox.saveSignature(); } catch (_) { threw = true; }
  check('אחסון חסום לא מפיל את האפליקציה', !threw);
}

/* ── 10. ניקוי מסיר את סימון החתימה ── */
{
  const { sandbox, canvas } = build({ blank: true, stored: SIG });
  await sandbox.SignaturePersist.load(canvas);
  sandbox.clearSignature();
  check('ניקוי מסיר data-signed', !canvas._attrs['data-signed']);
}

/* ── 11. clearLocal מוחק את הגיבוי ── */
{
  const { sandbox, store } = build({ stored: SIG });
  sandbox.SignaturePersist.clearLocal();
  check('clearLocal מוחק', !store['estimax_signature_v1']);
}

/* ── 12. renderReport מפעיל טעינה אוטומטית ── */
{
  const { sandbox, canvas, calls } = build({ blank: true, stored: SIG });
  sandbox.renderReport();
  await new Promise(r => setTimeout(r, 400));
  check('הדוח טוען את החתימה אוטומטית',
    calls.drawn.length > 0, 'נטען: ' + (calls.drawn[0] || '').slice(0, 20));
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
