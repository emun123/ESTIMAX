/**
 * smoketest-anatoli.mjs — בדיקות ללוגיקת השמאות של המנוע
 * מאמת את הכללים הישראליים: אובדן להלכה, מקורי/חליפי, ירידת ערך, כיול ADAS.
 * לא קורא ל-API — בודק את שכבת אכיפת הכללים בלבד.
 *
 * הרצה: node tests/smoketest-anatoli.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../anatoli-engine.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}` + (detail ? `  → ${detail}` : '')); }
  else { fail++; console.log(`✗ ${name}  → ${detail || 'נכשל'}`); }
}

const thisYear = new Date().getFullYear();

/* ── 1. רכב חדש (שנה) → הכל מקורי ── */
{
  const raw = { parts: [{ name: 'פגוש קדמי', part_source: 'חליפי', est_price_ils: 2000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 1, value: 100000 });
  check('רכב מתחת לשנתיים → חלף מקורי',
    r.parts[0].part_source === 'מקורי', r.parts[0].source_reason);
}

/* ── 2. רכב ותיק → חליפי מותר ── */
{
  const raw = { parts: [{ name: 'פגוש קדמי', est_price_ils: 2000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 6, value: 100000 });
  check('רכב מעל שנתיים → חליפי מותר',
    r.parts[0].part_source === 'חליפי', r.parts[0].part_source);
}

/* ── 3. חלק בטיחותי ברכב ותיק → עדיין מקורי ── */
{
  const raw = { parts: [{ name: 'כרית אוויר נהג', part_source: 'משומש', est_price_ils: 4000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 10, value: 100000 });
  check('חלק בטיחותי ברכב ותיק → מקורי בלבד',
    r.parts[0].part_source === 'מקורי' && r.parts[0].safety_critical === true,
    r.parts[0].source_reason);
}

/* ── 4. אובדן להלכה — מעל 60% ── */
{
  const raw = { parts: [{ name: 'שלדה קדמית', est_price_ils: 65000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 5, value: 100000 });
  check('עלות 65% משווי → אובדן להלכה',
    r.total_loss_status === 'אובדן להלכה', `${r.cost_estimate.ratio_pct}%`);
}

/* ── 5. מתקרב לסף — 50-60% ── */
{
  const raw = { parts: [{ name: 'דלת', est_price_ils: 55000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 5, value: 100000 });
  check('עלות 55% משווי → אזהרת התקרבות לסף',
    r.total_loss_status === 'מתקרב לסף', `${r.cost_estimate.ratio_pct}%`);
}

/* ── 6. תיקון כדאי — מתחת ל-50% ── */
{
  const raw = { parts: [{ name: 'פנס', est_price_ils: 3000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 5, value: 100000 });
  check('עלות 3% משווי → תיקון כדאי',
    r.total_loss_status === 'תיקון כדאי', `${r.cost_estimate.ratio_pct}%`);
}

/* ── 7. ADAS → שורת כיול נוספת אוטומטית ── */
{
  const raw = { parts: [{ name: 'חיישן רדאר קדמי', est_price_ils: 5000 }], works: [] };
  const r = E.enforceRules(raw, { year: thisYear - 3, value: 200000 });
  const hasCal = r.works.some(w => String(w.type).includes('כיול'));
  check('רכיב ADAS → נוספה שורת כיול',
    hasCal && r.parts[0].requires_calibration === true,
    r.works.map(w => w.type).join(','));
}

/* ── 8. ירידת ערך — רכב עד 8 שנים ── */
{
  const raw = { parts: [] };
  const r = E.enforceRules(raw, { year: thisYear - 4, value: 100000 });
  check('רכב בן 4 → זכאי לירידת ערך',
    r.depreciation_eligible === true, r.depreciation_note);
}

/* ── 9. ירידת ערך — רכב מעל 8 שנים ── */
{
  const raw = { parts: [] };
  const r = E.enforceRules(raw, { year: thisYear - 12, value: 50000 });
  check('רכב בן 12 → לא זכאי לירידת ערך',
    r.depreciation_eligible === false, r.depreciation_reason);
}

/* ── 10. חסר שווי רכב → לא קורס ── */
{
  const raw = { parts: [{ name: 'פגוש', est_price_ils: 2000 }] };
  const r = E.enforceRules(raw, { year: thisYear - 3 });
  check('חסר שווי רכב → מדווח ולא קורס',
    r.total_loss_status.includes('לא ניתן לחשב'), r.total_loss_status);
}

/* ── 11. דיסקליימר תמיד קיים ── */
{
  const r = E.enforceRules({ parts: [] }, {});
  check('דיסקליימר מצורף תמיד',
    r.disclaimer.includes('אינו מחליף') && r.pending_review === true);
}

/* ── 12. חילוץ JSON עטוף ב-markdown ── */
{
  const p = E.parseJsonLoose('```json\n{"damages":["שריטה"]}\n```');
  check('JSON עטוף ב-markdown נחלץ', p && p.damages[0] === 'שריטה');
}

/* ── 13. חילוץ JSON עם טקסט מסביב ── */
{
  const p = E.parseJsonLoose('הנה הניתוח:\n{"parts":[]}\nבברכה');
  check('JSON עם טקסט מסביב נחלץ', p && Array.isArray(p.parts));
}

/* ── 14. dataURL תקין → בלוק תמונה ── */
{
  const b = E.toImageBlock('data:image/jpeg;base64,AAAA');
  check('dataURL תקין → בלוק image',
    b && b.source.media_type === 'image/jpeg' && b.source.data === 'AAAA');
}

/* ── 15. dataURL פסול → נדחה ── */
{
  check('קלט פסול נדחה בשקט',
    E.toImageBlock('not-an-image') === null && E.toImageBlock('data:text/html;base64,XX') === null);
}

/* ── 16. image/jpg מנורמל ל-image/jpeg ── */
{
  const b = E.toImageBlock('data:image/jpg;base64,BBBB');
  check('image/jpg מנורמל ל-jpeg', b && b.source.media_type === 'image/jpeg');
}

/* ── 17. פלט תואם לחוזה של index.html ── */
{
  const r = E.enforceRules({
    impact_zone: { primary: 'פרונט ימין', secondary: 'כנף' },
    damages: ['שבר בפנס'],
    parts: [{ name: 'פנס ראשי ימין', action: 'החלפה', est_price_ils: 1800 }],
    works: [{ type: 'חשמל', hours: 1 }],
    adas_alert: ['מצלמה קדמית באזור הפגיעה'],
    recommendation: 'תיקון כדאי.',
  }, { year: thisYear - 3, value: 90000 });
  const c = E.toClientShape(r);

  check('חוזה: damages/parts/works/recommendation קיימים',
    Array.isArray(c.damages) && Array.isArray(c.parts) &&
    Array.isArray(c.works) && typeof c.recommendation === 'string');
  check('חוזה: מוקד הפגיעה נכנס לראש damages',
    c.damages[0].includes('מוקד ראשי'), c.damages[0]);
  check('חוזה: התראת ADAS נכנסה ל-damages',
    c.damages.some(d => d.includes('ADAS')));
  check('חוזה: part_label קריא לתצוגה',
    c.parts[0].part_label.includes('פנס ראשי ימין'), c.parts[0].part_label);
  check('חוזה: pending_review — ממתין לאישור השמאי',
    c.pending_review === true);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`עברו: ${pass} | נכשלו: ${fail}`);
process.exit(fail ? 1 : 0);
