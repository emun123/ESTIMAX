/**
 * smoketest-office-brand.mjs — בדיקות לזהות משרד השמאות
 * מאמת: אחסון, פיצול שם לחותמת, התאמת גופן, בדיקת קובץ, שורת פוטר,
 * והזרקת הלוגו/החותמת/השם לתוך דוח שכבר נבנה.
 *
 * הרצה: node tests/smoketest-office-brand.mjs
 */

import { readFileSync } from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

const SRC = readFileSync(new URL('../docs/office-brand.js', import.meta.url), 'utf8');

/* ── DOM מינימלי: מספיק כדי ש-applyToReport יעבוד ── */
function makeEl(tag = 'div') {
  return {
    tag, innerHTML: '', textContent: '', value: '',
    _listeners: {}, children: [], style: {},
    addEventListener(e, f) { (this._listeners[e] ||= []).push(f); },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    querySelector: () => null,
  };
}

function build({ stored = null, nodes = {} } = {}) {
  const store = {};
  if (stored) store['estimax_office_v1'] = JSON.stringify(stored);

  const els = {
    '.rp-brand': nodes.brand === undefined ? makeEl() : nodes.brand,
    '.rp-stamp-row': nodes.stamp === undefined ? makeEl() : nodes.stamp,
  };
  const byId = {
    rpOfficeLbl: nodes.officeLbl === undefined ? makeEl() : nodes.officeLbl,
    rpFooterOffice: nodes.footer === undefined ? makeEl() : nodes.footer,
    'f-tik': Object.assign(makeEl('input'), { value: nodes.tik ?? '2026-047' }),
  };

  const toasts = [];
  const sandbox = {
    console, Promise, Math, String, JSON, Date,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; },
    },
    document: {
      readyState: 'complete',
      querySelector: sel => els[sel] ?? null,
      getElementById: id => byId[id] ?? null,
      createElement: makeEl,
      addEventListener: () => {},
      body: makeEl(),
    },
    FileReader: class { readAsDataURL() {} },
  };
  sandbox.window = sandbox;
  sandbox.toast = m => toasts.push(m);
  sandbox.renderReport = () => {};
  sandbox.exOpenProfile = () => {};

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, els, byId, store, toasts, OB: sandbox.OfficeBrand };
}

/* ═══ 1. התקנה ═══ */
{
  const { OB } = build();
  check('המודול נטען וחושף API', !!OB && typeof OB.applyToReport === 'function');
}

/* ═══ 2. normalize — כל השדות תמיד קיימים ═══ */
{
  const { OB } = build();
  const o = OB.normalize({ name: '  אמון שמאים  ' });
  check('normalize משלים שדות ומנקה רווחים',
    o.name === 'אמון שמאים' && o.logo === '' && o.stamp === '' && o.phone === '',
    JSON.stringify(o.name));
}

/* ═══ 3. splitName — שתי שורות לחותמת ═══ */
{
  const { OB } = build();
  const a = OB.splitName('אמון שמאים ומעריכים');
  check('שם מתפצל נכון לחותמת', a.top === 'אמון' && a.bottom === 'שמאים ומעריכים',
    `${a.top} / ${a.bottom}`);
  const b = OB.splitName('אמון');
  check('מילה אחת → שורה שנייה ריקה', b.top === 'אמון' && b.bottom === '');
  const c = OB.splitName('');
  check('שם ריק לא מפיל', c.top === '' && c.bottom === '');
}

/* ═══ 4. fitFont — שם ארוך מקטין גופן, קצר לא ═══ */
{
  const { OB } = build();
  check('שם קצר שומר על הגודל', OB.fitFont('אמון', 20, 5) === 20);
  const big = OB.fitFont('משרד שמאות ארוך במיוחד', 10, 15);
  check('שם ארוך מקטין גופן', big < 10 && big >= 5.5, String(big));
}

/* ═══ 5. validateImage ═══ */
{
  const { OB } = build();
  check('PDF נדחה', OB.validateImage({ type: 'application/pdf', size: 100 }).ok === false);
  check('תמונה ענקית נדחית', OB.validateImage({ type: 'image/png', size: 9e6 }).ok === false);
  check('PNG סביר מתקבל', OB.validateImage({ type: 'image/png', size: 50000 }).ok === true);
}

/* ═══ 6. footerLine — מדלג על שדות ריקים ═══ */
{
  const { OB } = build();
  check('פוטר מלא', OB.footerLine({ name: 'אמון', phone: '04-1', website: 'a.co.il' })
    === 'אמון  |  04-1  |  a.co.il');
  check('פוטר בלי טלפון', OB.footerLine({ name: 'אמון', phone: '', website: 'a.co.il' })
    === 'אמון  |  a.co.il');
}

/* ═══ 7. אחסון: set → get ═══ */
{
  const { OB, store } = build();
  OB.set({ name: 'אמון שמאים ומעריכים', phone: '04-8000000' });
  check('נשמר ב-localStorage', !!store['estimax_office_v1']);
  check('נקרא חזרה', OB.get().name === 'אמון שמאים ומעריכים');
}

/* ═══ 8. אחסון חסום לא מפיל ═══ */
{
  const { OB, sandbox } = build();
  sandbox.localStorage.setItem = () => { throw new Error('Quota'); };
  let threw = false;
  let r;
  try { r = OB.set({ name: 'x' }); } catch (_) { threw = true; }
  check('אחסון חסום מחזיר false בלי לקרוס', !threw && r === false);
}

/* ═══ 9. לוגו מוזרק לכותרת ═══ */
{
  const { OB, els } = build({ stored: { name: 'אמון שמאים ומעריכים', logo: 'data:image/png;base64,AAA' } });
  OB.applyToReport();
  check('לוגו המשרד נכנס לכותרת',
    /rp-brand-img/.test(els['.rp-brand'].innerHTML) && /base64,AAA/.test(els['.rp-brand'].innerHTML));
}

/* ═══ 10. בלי לוגו → שם המשרד כטקסט ═══ */
{
  const { OB, els } = build({ stored: { name: 'אמון שמאים ומעריכים', license: '1234' } });
  OB.applyToReport();
  const h = els['.rp-brand'].innerHTML;
  check('בלי לוגו מוצג שם המשרד',
    /rp-office-name/.test(h) && h.includes('אמון שמאים ומעריכים') && h.includes('1234'));
}

/* ═══ 11. משרד לא מוגדר → הכותרת לא מתרוקנת ═══ */
{
  const { OB, els } = build();
  els['.rp-brand'].innerHTML = '<img class="rp-brand-img" src="./icons/logo-estimax.png"/>';
  OB.applyToReport();
  check('בלי הגדרות הכותרת נשארת כמות שהיא',
    els['.rp-brand'].innerHTML.includes('logo-estimax.png'));
}

/* ═══ 12. חותמת שהועלתה גוברת על החותמת המחושבת ═══ */
{
  const { OB, els } = build({ stored: { name: 'אמון', stamp: 'data:image/png;base64,BBB' } });
  OB.applyToReport();
  const h = els['.rp-stamp-row'].innerHTML;
  check('חותמת שהועלתה מוצגת', /rp-stamp-img/.test(h) && /base64,BBB/.test(h));
  check('לא נוצרה חותמת SVG במקביל', !/<svg/.test(h));
}

/* ═══ 13. בלי חותמת → נוצרת חותמת עם שם המשרד ומס׳ התיק ═══ */
{
  const { OB, els } = build({ stored: { name: 'אמון שמאים ומעריכים' } });
  OB.applyToReport();
  const h = els['.rp-stamp-row'].innerHTML;
  check('נוצרה חותמת SVG', /<svg/.test(h) && /rp-stamp/.test(h));
  check('החותמת נושאת את שם המשרד', h.includes('אמון') && h.includes('שמאים ומעריכים'));
  check('החותמת נושאת את מס׳ התיק', h.includes('2026-047'));
}

/* ═══ 14. שם המשרד בשורת החתימות ובפוטר ═══ */
{
  const { OB, byId } = build({ stored: { name: 'אמון שמאים ומעריכים', phone: '04-8000000' } });
  OB.applyToReport();
  check('שם המשרד בשורת החתימות', byId.rpOfficeLbl.innerHTML.includes('אמון שמאים ומעריכים'));
  check('פרטי המשרד בפוטר',
    byId.rpFooterOffice.textContent.includes('אמון שמאים ומעריכים') &&
    byId.rpFooterOffice.textContent.includes('04-8000000'),
    byId.rpFooterOffice.textContent);
}

/* ═══ 15. escaping — שם עם תווי HTML לא שובר את הדוח ═══ */
{
  const { OB, els } = build({ stored: { name: '<script>x</script> שמאים' } });
  OB.applyToReport();
  const h = els['.rp-brand'].innerHTML;
  check('שם זדוני עבר escaping', !/<script>/.test(h) && /&lt;script&gt;/.test(h));
}

/* ═══ 16. isConfigured ═══ */
{
  const { OB } = build();
  check('ריק → לא מוגדר', OB.isConfigured(OB.normalize({})) === false);
  check('עם שם → מוגדר', OB.isConfigured(OB.normalize({ name: 'אמון' })) === true);
  check('עם לוגו בלבד → מוגדר', OB.isConfigured(OB.normalize({ logo: 'data:...' })) === true);
}

/* ═══ 17. DOM חסר לא מפיל ═══ */
{
  const { OB } = build({ nodes: { brand: null, stamp: null, officeLbl: null, footer: null } });
  let threw = false;
  try { OB.applyToReport(); } catch (_) { threw = true; }
  check('דוח שלא נבנה עדיין לא גורם לקריסה', !threw);
}

/* ═══ 18. הקרדיט לבית התוכנה קיים וקבוע ═══ */
{
  const { OB } = build();
  check('קרדיט EstiMax מוגדר', OB.CREDIT.includes('EstiMax'), OB.CREDIT);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
