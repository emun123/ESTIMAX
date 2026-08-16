/**
 * smoketest-anatoli-bridge.mjs — בדיקת אינטגרציה לגשר אנטולי
 * מדמה DOM מינימלי ומאמת:
 *   • איסוף נתוני הרכב מהטופס
 *   • נפילה למצב הדגמה כשאין שרת (לא נשבר!)
 *   • שליחה נכונה לשרת כשיש
 *   • הזרמת התוצאה לטבלאות הקיימות
 *
 * הרצה: node tests/smoketest-anatoli-bridge.mjs
 */

import { readFileSync } from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

/* ── DOM מדומה ── */
function makeEl(id, value) {
  return { id, value: value ?? '', className: '', innerHTML: '', tagName: 'INPUT' };
}

function buildSandbox(fields, endpoint) {
  const els = {};
  Object.entries(fields).forEach(([k, v]) => { els[k] = makeEl(k, v); });
  els['anatoliResult'] = makeEl('anatoliResult');

  const calls = { parts: [], works: [], toasts: [], fetches: [], originalRan: 0 };

  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      addEventListener: () => {},
    },
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: (url, opts) => {
      calls.fetches.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          damages: ['שבר בפנס קדמי שמאל'],
          parts: [{
            name: 'פנס ראשי שמאל', part_label: 'פנס ראשי שמאל — החלפה (מקורי)',
            part_source: 'מקורי', oem: '81150-02M60', est_price_ils: 1800,
            action: 'החלפה', requires_calibration: false,
          }],
          works: [{ type: 'חשמל', hours: 1.5 }],
          adas_alert: ['מצלמה קדמית באזור הפגיעה'],
          missing_checks: ['נדרש פירוק פגוש לבדיקת סופגי אנרגיה'],
          total_loss_status: 'תיקון כדאי',
          cost_estimate: { ratio_pct: 4.2 },
          recommendation: 'תיקון כדאי.',
          disclaimer: 'זהו אומדן חזותי ראשוני בלבד...',
        }),
      });
    },
  };

  sandbox.window = sandbox;
  sandbox.ANATOLI_API_ENDPOINT = endpoint;
  sandbox.CURRENT_USER_ROLE = 'Anatoli_Appraiser';
  sandbox.tikPhotos = { '2026-114': [{ src: 'data:image/jpeg;base64,AAA' }] };
  sandbox.currentTikKey = () => '2026-114';
  sandbox.toast = (m) => calls.toasts.push(m);
  sandbox.addAnatoliPart = (p) => calls.parts.push(p);
  sandbox.addAnatoliWork = (w) => calls.works.push(w);
  sandbox.scheduleDraftSave = () => {};
  sandbox.sendToAnatoli = function () { calls.originalRan++; };

  return { sandbox, calls, els };
}

const bridgeSrc = readFileSync(new URL('../docs/anatoli-bridge.js', import.meta.url), 'utf8');

const VEHICLE = {
  'f-plate': '12-345-67', 'f-year': '2023', 'f-km': '45,000',
  'f-value-manual': '₪120,000', 'f-roaddate': '2023-03-15',
  'f-model': 'טויוטה קורולה', 'f-vin': 'JTDBR32E320012345',
  'f-moked': 'פרונט שמאל', 'f-tik': '2026-114',
};

/* ── 1. איסוף נתוני הרכב ── */
{
  const { sandbox } = buildSandbox(VEHICLE, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  const v = sandbox.AnatoliBridge.collectVehicle();
  check('נתוני רכב נאספו', v.plate === '12-345-67' && v.model === 'טויוטה קורולה');
  check('שנה כמספר', v.year === 2023, String(v.year));
  check('שווי מנוקה מ-₪ ופסיקים', v.value === 120000, String(v.value));
  check('ק"מ מנוקה מפסיקים', v.km === 45000, String(v.km));
  check('תאריך עלייה לכביש נאסף', v.on_road_date === '2023-03-15', v.on_road_date);
  check('מוקד הנזק נאסף', v.moked === 'פרונט שמאל', v.moked);
}

/* ── 2. שדות ריקים לא נשלחים ── */
{
  const { sandbox } = buildSandbox({ 'f-plate': '11-222-33' }, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  const v = sandbox.AnatoliBridge.collectVehicle();
  check('שדות ריקים מושמטים',
    v.plate === '11-222-33' && !('year' in v) && !('value' in v),
    Object.keys(v).join(','));
}

/* ── 3. אין שרת → נופל למקורי, לא נשבר ── */
{
  const { sandbox, calls } = buildSandbox(VEHICLE, '');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.sendToAnatoli();
  check('אין שרת → הפונקציה המקורית רצה (מצב הדגמה)',
    calls.originalRan === 1 && calls.fetches.length === 0);
}

/* ── 4. יש שרת → נשלחת בקשה נכונה ── */
{
  const { sandbox, calls } = buildSandbox(VEHICLE, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.sendToAnatoli();
  await new Promise(r => setTimeout(r, 30));

  check('נשלחה בקשה לשרת', calls.fetches.length === 1, calls.fetches[0]?.url);
  const b = calls.fetches[0].body;
  check('הבקשה כוללת tik/role/photos', b.tik === '2026-114' &&
    b.role === 'Anatoli_Appraiser' && b.photos.length === 1);
  check('הבקשה כוללת נתוני רכב — זה החידוש',
    b.vehicle && b.vehicle.year === 2023 && b.vehicle.value === 120000,
    JSON.stringify(b.vehicle).slice(0, 60));

  check('חלק הוזרם לטבלה', calls.parts.length === 1 &&
    calls.parts[0].name === 'פנס ראשי שמאל', calls.parts[0]?.name);
  check('OEM עבר לשדה הקטלוג', calls.parts[0].cat === '81150-02M60', calls.parts[0]?.cat);
  check('מחיר עבר לטבלה', calls.parts[0].pr === 1800, String(calls.parts[0]?.pr));
  check('מקור החלף עבר', calls.parts[0].orig === 'מקורי', calls.parts[0]?.orig);
  check('עבודה הוזרמה', calls.works.length === 1 && calls.works[0].hours === 1.5);
}

/* ── 5. תצוגת הממצאים ── */
{
  const { sandbox, els } = buildSandbox(VEHICLE, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.sendToAnatoli();
  await new Promise(r => setTimeout(r, 30));

  const html = els['anatoliResult'].innerHTML;
  check('התצוגה כוללת סטטוס אובדן להלכה', html.includes('תיקון כדאי'));
  check('התצוגה כוללת התראת ADAS', html.includes('כיול') && html.includes('מצלמה קדמית'));
  check('התצוגה כוללת בדיקות חסרות', html.includes('סופגי אנרגיה'));
  check('התצוגה כוללת דיסקליימר', html.includes('אומדן חזותי ראשוני'));
}

/* ── 6. אין הרשאה → נחסם ── */
{
  const { sandbox, calls } = buildSandbox(VEHICLE, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.CURRENT_USER_ROLE = 'Viewer';
  sandbox.sendToAnatoli();
  check('תפקיד ללא הרשאה נחסם',
    calls.fetches.length === 0 && calls.toasts.some(t => t.includes('אין הרשאה')));
}

/* ── 7. אין תמונות → נחסם ── */
{
  const { sandbox, calls } = buildSandbox(VEHICLE, 'https://api.test/analyze');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.tikPhotos = {};
  sandbox.sendToAnatoli();
  check('ללא תמונות → נחסם עם הודעה',
    calls.fetches.length === 0 && calls.toasts.some(t => t.includes('להעלות תמונות')));
}

/* ── 8. הגנת XSS בתצוגה ── */
{
  const { sandbox, els } = buildSandbox(VEHICLE, '');
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox);

  sandbox.AnatoliBridge.renderResult({
    damages: ['<img src=x onerror=alert(1)>'],
    recommendation: '<script>alert(2)</script>',
  });
  const html = els['anatoliResult'].innerHTML;
  check('קלט זדוני עבר escaping',
    !html.includes('<img src=x') && !html.includes('<script>alert(2)'),
    'מסונן');
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
