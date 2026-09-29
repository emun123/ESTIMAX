/**
 * smoketest-depreciation.mjs — בדיקות לטבלת ירידת הערך
 * מאמת מקדמי גיל, טווחים, והתאמה לכלל גיל 8.
 *
 * הרצה: node tests/smoketest-depreciation.mjs
 */

import { readFileSync } from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

function build(fields = {}) {
  const els = {};
  Object.entries(fields).forEach(([k, v]) => { els[k] = { id: k, value: v }; });

  const rows = [];
  const sandbox = {
    console, Date, Math, parseInt, parseFloat, isNaN, String, Number,
    document: {
      readyState: 'complete',
      getElementById: id => els[id] || null,
      querySelectorAll: () => rows,
      createElement: () => ({
        className: '', style: { cssText: '' }, innerHTML: '', textContent: '',
        querySelector: () => null, onchange: null,
      }),
      addEventListener: () => {},
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  sandbox.window = sandbox;
  sandbox.addDeprecRow = () => {};
  sandbox.calcDeprec = () => {};

  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../docs/depreciation-table.js', import.meta.url), 'utf8'), sandbox);
  return sandbox;
}

const thisYear = new Date().getFullYear();

/* ── 1. הטבלה נטענה ── */
{
  const s = build();
  check('הטבלה הותקנה', !!s.DepreciationTable && s.DepreciationTable.TYPES.length === 12,
    s.DepreciationTable.TYPES.length + ' סוגי פגיעה');
}

/* ── 2. רכב חדש → מקדם מלא ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('chassis_main', 0.5);
  check('רכב עד שנה → מקדם 1.0', r.factor === 1 && r.min === 8 && r.max === 15,
    `${r.min}%–${r.max}%`);
}

/* ── 3. רכב בן 4 → מקדם מופחת ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('chassis_main', 4);
  check('רכב בן 4 → מקדם 0.75', r.factor === 0.75 && r.min === 6 && r.max === 11.3,
    `${r.min}%–${r.max}% (${r.ageLabel})`);
}

/* ── 4. מעל גיל 8 → לא זכאי ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('chassis_main', 10);
  check('רכב בן 10 → לא זכאי', r.eligible === false && r.min === 0, r.ageLabel);
}

/* ── 5. בדיוק גיל 8 → עדיין זכאי ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('chassis_main', 7.9);
  check('גיל 7.9 → עדיין זכאי', r.eligible === true && r.factor === 0.40, r.ageLabel);
}

/* ── 6. שלדה חמורה יותר מחלק מתברג ── */
{
  const s = build();
  const chassis = s.DepreciationTable.suggest('chassis_main', 2);
  const bolted = s.DepreciationTable.suggest('bolted_panel', 2);
  check('שלדה > חלק מתברג', chassis.max > bolted.max * 3,
    `${chassis.max}% מול ${bolted.max}%`);
}

/* ── 7. הצפה — הטווח הגבוה ביותר ── */
{
  const s = build();
  const all = s.DepreciationTable.TYPES.map(t => t.max);
  const flood = s.DepreciationTable.TYPES.find(t => t.id === 'flood');
  check('הצפה היא החמורה ביותר', flood.max === Math.max(...all), flood.max + '%');
}

/* ── 8. אמצע הטווח מחושב נכון ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('paint_single', 0.5);
  check('mid = אמצע הטווח', r.mid === 1, `${r.min}/${r.mid}/${r.max}`);
}

/* ── 9. סוג לא קיים → null ── */
{
  const s = build();
  check('סוג לא מוכר מוחזר null', s.DepreciationTable.suggest('nope', 2) === null);
}

/* ── 10. גיל מתאריך עלייה לכביש ── */
{
  const s = build({ 'f-roaddate': (thisYear - 3) + '-01-01' });
  const age = s.DepreciationTable.vehicleAge();
  check('גיל מחושב מתאריך עלייה לכביש', age >= 3 && age < 4, age?.toFixed(1));
}

/* ── 11. נפילה לשנת ייצור ── */
{
  const s = build({ 'f-year': String(thisYear - 5) });
  const age = s.DepreciationTable.vehicleAge();
  check('נפילה לשנת ייצור', age >= 5 && age < 6, age?.toFixed(1));
}

/* ── 12. תאריך עלייה גובר על שנת ייצור ── */
{
  const s = build({ 'f-year': String(thisYear - 9), 'f-roaddate': (thisYear - 2) + '-01-01' });
  const age = s.DepreciationTable.vehicleAge();
  check('תאריך עלייה לכביש קודם', age < 3, age?.toFixed(1));
}

/* ── 13. אין נתוני גיל → null, לא קורס ── */
{
  const s = build();
  check('חסר גיל → null', s.DepreciationTable.vehicleAge() === null);
}

/* ── 14. גיל לא ידוע → מקדם 1 (לא מעניש) ── */
{
  const s = build();
  const r = s.DepreciationTable.suggest('roof', null);
  check('גיל לא ידוע → לא מעניש', r.factor === 1, r.ageLabel);
}

/* ── 15. תאריך פסול → לא קורס ── */
{
  const s = build({ 'f-roaddate': 'לא-תאריך' });
  check('תאריך פסול → null', s.DepreciationTable.vehicleAge() === null);
}

/* ── 16. כל הסוגים תקינים ── */
{
  const s = build();
  const bad = s.DepreciationTable.TYPES.filter(t =>
    !t.id || !t.name || t.min <= 0 || t.max <= t.min);
  check('כל 12 הסוגים תקינים', bad.length === 0,
    bad.length ? bad.map(b => b.id).join(',') : 'תקין');
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
