/**
 * smoketest-signature-upload.mjs — בדיקות לפאד החי ולהעלאת החתימה
 * מדמה DOM + canvas + FileReader ומאמת: אתחול הפאד בכל רינדור, קשירת מגע,
 * מפתוח רקע, גזירת שוליים, מירכוז, ושמירה דרך saveSignature הקיימת.
 *
 * הרצה: node tests/smoketest-signature-upload.mjs
 */

import { readFileSync } from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

const SRC = readFileSync(new URL('../docs/signature-upload.js', import.meta.url), 'utf8');

/* ── קנבס מדומה ─────────────────────────────────────────────────────── */
function makeCanvas(id, opts = {}) {
  const calls = { draws: [], clears: [], strokes: 0, transform: null, listeners: {} };
  const c = {
    id,
    width: opts.width ?? 0,
    height: opts.height ?? 0,
    offsetWidth: opts.cssW ?? 300,
    offsetHeight: opts.cssH ?? 120,
    style: {},
    _attrs: {},
    _calls: calls,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: opts.cssW ?? 300, height: opts.cssH ?? 120 }),
    getContext: () => ({
      setTransform: (a, b, cc, d, e, f) => { calls.transform = [a, b, cc, d, e, f]; },
      clearRect: (...a) => calls.clears.push(a),
      drawImage: (...a) => calls.draws.push(a),
      beginPath() {}, moveTo() {}, lineTo() {},
      stroke: () => { calls.strokes++; },
      getImageData: (x, y, w, h) => ({ data: opts.pixels ? opts.pixels(w, h) : new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
      set lineCap(v) {}, set lineJoin(v) {}, set lineWidth(v) {}, set strokeStyle(v) {},
    }),
    toDataURL: () => opts.dataUrl ?? 'data:image/png;base64,KEEP',
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(ev, fn) { (calls.listeners[ev] ||= []).push(fn); },
  };
  return c;
}

function build({ withCanvas = true, pixels, blank = true } = {}) {
  const calls = { toasts: [], saved: 0, origRender: 0, origClear: 0, appended: [], created: [] };
  const canvas = withCanvas ? makeCanvas('sigCanvas', { pixels }) : null;
  const sigButtons = { children: [], firstChild: null, insertBefore(el) { this.children.unshift(el); } };

  function element(tag) {
    const el = {
      tag, style: {}, _attrs: {}, children: [], files: null, value: '',
      _listeners: {},
      width: 0, height: 0,
      className: '', id: '', type: '', accept: '', textContent: '', title: '', innerHTML: '',
      addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
      appendChild(c) { this.children.push(c); return c; },
      querySelector: () => null,
      click() { (this._listeners.click || []).forEach(f => f()); },
      setAttribute(k, v) { this._attrs[k] = v; },
      removeAttribute(k) { delete this._attrs[k]; },
      getContext: () => ({
        drawImage: () => {},
        clearRect: () => {},
        getImageData: (x, y, w, h) => ({ data: pixels ? pixels(w, h) : new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
      }),
    };
    calls.created.push(el);
    return el;
  }

  const byId = {};
  if (canvas) byId.sigCanvas = canvas;

  const sandbox = {
    console,
    Promise, Math, Uint8ClampedArray, Date,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout,
    devicePixelRatio: 2,
    PointerEvent: function () {},
    document: {
      readyState: 'complete',
      body: { appendChild: (el) => { calls.appended.push(el); return el; } },
      getElementById: id => byId[id] || null,
      querySelector: sel => (sel === '.sig-buttons' ? sigButtons : null),
      createElement: element,
      addEventListener: () => {},
    },
    Image: class {
      constructor() { this.naturalWidth = 40; this.naturalHeight = 20; }
      set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
      get src() { return this._src; }
    },
    FileReader: class {
      readAsDataURL(f) {
        setTimeout(() => {
          if (f && f.__fail) { this.onerror && this.onerror(); return; }
          this.result = 'data:image/png;base64,UPLOAD';
          this.onload && this.onload();
        }, 0);
      }
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.toast = (m, k) => calls.toasts.push(m);
  sandbox.saveSignature = () => { calls.saved++; };
  sandbox.clearSignature = () => { calls.origClear++; };
  sandbox.renderReport = () => { calls.origRender++; };
  sandbox.SignaturePersist = { isBlank: () => blank, hasLocal: () => false, getLocal: () => null };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, calls, canvas, sigButtons };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ 1. הפונקציות המקוריות שורדות את העטיפה ═══ */
{
  const { sandbox, calls } = build();
  sandbox.renderReport();
  sandbox.clearSignature();
  check('renderReport ו-clearSignature המקוריים עדיין רצים',
    calls.origRender === 1 && calls.origClear === 1);
}

/* ═══ 2. הפאד מאותחל ברזולוציית DPR ═══ */
{
  const { canvas } = build();
  check('הקנבס עבר ל-devicePixelRatio',
    canvas.width === 600 && canvas.height === 240 && canvas._calls.transform[0] === 2,
    `${canvas.width}x${canvas.height} @${canvas._calls.transform[0]}x`);
}

/* ═══ 3. אירועי Pointer נקשרים — חתימה בנייד ═══ */
{
  const { canvas } = build();
  const L = canvas._calls.listeners;
  check('pointerdown/move/up נקשרו לקנבס',
    !!(L.pointerdown && L.pointermove && L.pointerup),
    Object.keys(L).join(','));
}

/* ═══ 4. הפאד מאותחל מחדש בכל רינדור של הדוח — הבאג המרכזי ═══ */
{
  const { sandbox, canvas } = build();
  canvas.width = 0; canvas.height = 0;
  sandbox.renderReport();
  await wait(250);
  check('רינדור הדוח מחזיר את הפאד לחיים', canvas.width === 600, `width=${canvas.width}`);
}

/* ═══ 5. ציור במגע מגיע ל-stroke ═══ */
{
  const { canvas } = build();
  const L = canvas._calls.listeners;
  const ev = (x, y) => ({ clientX: x, clientY: y, preventDefault() {} });
  L.pointerdown[0](ev(10, 10));
  L.pointermove[0](ev(20, 20));
  L.pointermove[0](ev(30, 25));
  check('תנועת מגע מציירת קו', canvas._calls.strokes === 2, `${canvas._calls.strokes} קווים`);
}

/* ═══ 6. clearSignature באמת מנקה (המקורי לא ניקה — sigCtx היה null) ═══ */
{
  const { sandbox, canvas } = build();
  canvas.setAttribute('data-signed', 'drawn');
  const before = canvas._calls.clears.length;
  sandbox.clearSignature();
  check('ניקוי מוחק את הקנבס ואת הסימון',
    canvas._calls.clears.length > before && !canvas._attrs['data-signed']);
}

/* ═══ 7. כפתור ההעלאה מוזרק לשורת הכפתורים ═══ */
{
  const { sigButtons } = build();
  const btn = sigButtons.children[0];
  check('כפתור "העלה חתימה" נוסף', !!btn && btn.textContent === 'העלה חתימה', btn && btn.textContent);
}

/* ═══ 8. validateFile — סוג וגודל ═══ */
{
  const { sandbox } = build();
  const V = sandbox.SignatureUpload.validateFile;
  check('PDF נדחה', V({ type: 'application/pdf', size: 100 }).ok === false);
  check('קובץ ענק נדחה', V({ type: 'image/png', size: 9e6 }).ok === false);
  check('PNG סביר מתקבל', V({ type: 'image/png', size: 200000 }).ok === true);
}

/* ═══ 9. keyOut — נייר לבן הופך שקוף, דיו נשאר ═══ */
{
  const { sandbox } = build();
  const px = new Uint8ClampedArray([
    255, 255, 255, 255,   // נייר
    250, 250, 248, 255,   // נייר מעט אפור
    20, 30, 90, 255,      // דיו כחול
  ]);
  const kept = sandbox.SignatureUpload.keyOut(px);
  check('רקע לבן הופך שקוף', px[3] === 0 && px[7] === 0);
  check('הדיו נשאר ושומר על צבעו',
    px[11] === 255 && px[8] === 20 && px[10] === 90, `kept=${kept}`);
}

/* ═══ 10. trimBounds — מסגרת סביב הדיו בלבד ═══ */
{
  const { sandbox } = build();
  const w = 5, h = 4;
  const px = new Uint8ClampedArray(w * h * 4);
  const ink = (x, y) => { px[(y * w + x) * 4 + 3] = 255; };
  ink(1, 1); ink(3, 2);
  const b = sandbox.SignatureUpload.trimBounds(px, w, h);
  check('מסגרת הגזירה מדויקת',
    b.x === 1 && b.y === 1 && b.w === 3 && b.h === 2, JSON.stringify(b));
  check('תמונה ריקה → null',
    sandbox.SignatureUpload.trimBounds(new Uint8ClampedArray(w * h * 4), w, h) === null);
}

/* ═══ 11. fitRect — ממרכז ומגדיל חתימה קטנה ═══ */
{
  const { sandbox } = build();
  const r = sandbox.SignatureUpload.fitRect(40, 20, 300, 120, 6);
  check('החתימה ממורכזת בפאד',
    Math.abs((r.x + r.w / 2) - 150) < 0.01 && Math.abs((r.y + r.h / 2) - 60) < 0.01,
    `x=${r.x.toFixed(1)} w=${r.w.toFixed(1)}`);
  check('חתימה קטנה מוגדלת ולא נחתכת',
    r.w <= 288.01 && r.h <= 108.01 && r.w > 40, `w=${r.w.toFixed(1)}`);
}

/* ═══ 12. downscale — תמונת ענק מוקטנת לפני עיבוד ═══ */
{
  const { sandbox } = build();
  const d = sandbox.SignatureUpload.downscale(4000, 3000);
  check('תמונה 4000px מוקטנת ל-1600', d.w === 1600 && d.h === 1200, `${d.w}x${d.h}`);
  const s = sandbox.SignatureUpload.downscale(300, 100);
  check('תמונה קטנה לא נוגעים בה', s.w === 300 && s.h === 100);
}

/* ═══ 13. העלאה מלאה → הפאד מצויר והחתימה נשמרת ═══ */
{
  // פיקסלים: חצי נייר, חצי דיו — כדי ש-keyOut ימצא דיו
  const pixels = (w, h) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < a.length; i += 4) {
      const dark = (i / 4) % 2 === 0;
      a[i] = dark ? 10 : 255; a[i + 1] = dark ? 10 : 255; a[i + 2] = dark ? 10 : 255; a[i + 3] = 255;
    }
    return a;
  };
  const { sandbox, calls, canvas } = build({ pixels });
  const res = await sandbox.SignatureUpload.handleFile({ type: 'image/png', size: 1000 });
  check('ההעלאה הצליחה', res.ok === true, res.error);
  check('החתימה צוירה על הפאד', canvas._calls.draws.length > 0);
  check('החתימה נשמרה דרך saveSignature (ענן + מקומי)', calls.saved === 1);
  check('הפאד סומן כחתום', canvas._attrs['data-signed'] === 'uploaded');
}

/* ═══ 14. תמונה לבנה לגמרי → הודעה ברורה, בלי שמירה ═══ */
{
  const pixels = (w, h) => {
    const a = new Uint8ClampedArray(w * h * 4).fill(255);
    return a;
  };
  const { sandbox, calls } = build({ pixels });
  const res = await sandbox.SignatureUpload.handleFile({ type: 'image/png', size: 1000 });
  check('תמונה ריקה נדחית בלי לשמור',
    res.ok === false && calls.saved === 0 && calls.toasts.some(t => t.includes('לא נמצאה חתימה')),
    calls.toasts[0]);
}

/* ═══ 15. כשל קריאת קובץ לא מפיל את האפליקציה ═══ */
{
  const { sandbox, calls } = build();
  const res = await sandbox.SignatureUpload.handleFile({ type: 'image/png', size: 1000, __fail: true });
  check('כשל קריאה מטופל בשקט', res.ok === false && calls.saved === 0, calls.toasts.slice(-1)[0]);
}

/* ═══ 16. אין פאד (לא במסך הדוח) → הודעה מנחה ═══ */
{
  const { sandbox, calls } = build({ withCanvas: false });
  const res = await sandbox.SignatureUpload.handleFile({ type: 'image/png', size: 1000 });
  check('העלאה מחוץ למסך הדוח מונחית',
    res.ok === false && calls.toasts.some(t => t.includes('מסך הדוח')), calls.toasts[0]);
}

/* ═══ 17. התקנה כפולה לא משכפלת עטיפות ═══ */
{
  const { sandbox, calls } = build();
  vm.runInContext(SRC, sandbox);   // טעינה שנייה של אותו קובץ
  sandbox.renderReport();
  check('טעינה כפולה לא מכפילה קריאות', calls.origRender === 1);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
