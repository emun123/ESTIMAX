/**
 * depreciation-table.js — טבלת אחוזי ירידת ערך
 * ---------------------------------------------------------------------------
 * מוסיף הנחיה מקצועית לשורות ירידת הערך. עד היום השמאי הזין אחוזים
 * מהראש, בלי עוגן. עכשיו הוא בוחר סוג פגיעה מרשימה ומקבל טווח מוצע
 * לפי חומרה — עם התאמה אוטומטית לגיל הרכב.
 *
 * ⚠ חשוב: אלה **הצעות בלבד**. שיקול הדעת נשאר של השמאי, והוא יכול
 *   לדרוס כל ערך. המספרים מבוססים על הנוהג המקובל בשוק הישראלי
 *   ואינם תחליף לטבלה רשמית — ערוך אותם לפי הפרקטיקה שלך.
 *
 * עוטף בלבד. לא נוגע ב-calcDeprec() ולא בלוגיקת החישוב.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  /* ── מקדם גיל: ככל שהרכב ותיק יותר, ירידת הערך פוחתת ── */
  var AGE_FACTORS = [
    { maxAge: 1,  factor: 1.00, label: 'עד שנה' },
    { maxAge: 3,  factor: 0.90, label: '1–3 שנים' },
    { maxAge: 5,  factor: 0.75, label: '3–5 שנים' },
    { maxAge: 7,  factor: 0.55, label: '5–7 שנים' },
    { maxAge: 8,  factor: 0.40, label: '7–8 שנים' },
    { maxAge: 999, factor: 0,   label: 'מעל 8 — לא זכאי' },
  ];

  /* ── סוגי פגיעה וטווחי אחוזים לפני מקדם גיל ── */
  var DAMAGE_TYPES = [
    { id: 'chassis_main',  name: 'שלדה — קורה ראשית / רצפה',      min: 8,   max: 15,  note: 'הפגיעה החמורה ביותר; מחייבת תיעוד מדידה' },
    { id: 'chassis_edge',  name: 'קצה שלדה / קורה קדמית-אחורית',  min: 5,   max: 10,  note: 'נדרש דוח יישור על מכשיר' },
    { id: 'pillar',        name: 'עמוד (A/B/C) — חיתוך או ריתוך', min: 4,   max: 8,   note: 'פוגע בשלמות תא הנוסעים' },
    { id: 'roof',          name: 'גג — החלפה או ריתוך',            min: 4,   max: 8,   note: '' },
    { id: 'welded_panel',  name: 'פאנל מרותך (כנף אחורית, דופן)', min: 2.5, max: 5,   note: 'להבדיל מחלק מתברג' },
    { id: 'airbag',        name: 'פתיחת כריות אוויר',              min: 2,   max: 5,   note: 'מתועד ביחידת השליטה — לא ניתן להסתרה' },
    { id: 'bolted_panel',  name: 'חלק מתברג (דלת, כנף קדמית)',     min: 1,   max: 2.5, note: 'השפעה מוגבלת — ניתן להחלפה מלאה' },
    { id: 'paint_multi',   name: 'צבע — 3 פאנלים ומעלה',           min: 1,   max: 3,   note: 'לפי מספר הפאנלים והתאמת הגוון' },
    { id: 'paint_single',  name: 'צבע — פאנל בודד',                min: 0.5, max: 1.5, note: '' },
    { id: 'mechanical',    name: 'מכלול מכני (מנוע, גיר, מתלים)',  min: 1,   max: 4,   note: 'לפי היקף הפירוק' },
    { id: 'adas',          name: 'מערכות ADAS — החלפה וכיול',      min: 1,   max: 3,   note: 'נדרש אישור כיול ממוסך מורשה' },
    { id: 'flood',         name: 'נוקי מים / הצפה',                min: 10,  max: 25,  note: 'פגיעה מערכתית; שקול אובדן להלכה' },
  ];

  function ageFactor(years) {
    if (years == null) return { factor: 1, label: 'גיל לא ידוע' };
    for (var i = 0; i < AGE_FACTORS.length; i++) {
      if (years <= AGE_FACTORS[i].maxAge) return AGE_FACTORS[i];
    }
    return AGE_FACTORS[AGE_FACTORS.length - 1];
  }

  /** גיל הרכב מהטופס — תאריך עלייה לכביש עדיף על שנת ייצור */
  function vehicleAge() {
    function v(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
    var road = v('f-roaddate');
    var year = parseInt(String(v('f-year')).replace(/[^\d]/g, ''), 10);
    var ref = road || (year ? year + '-01-01' : null);
    if (!ref) return null;
    var d = new Date(ref);
    if (isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  }

  /** מחשב טווח מוצע לסוג פגיעה, אחרי מקדם גיל */
  function suggest(typeId, years) {
    var t = null;
    for (var i = 0; i < DAMAGE_TYPES.length; i++) {
      if (DAMAGE_TYPES[i].id === typeId) { t = DAMAGE_TYPES[i]; break; }
    }
    if (!t) return null;
    var af = ageFactor(years);
    var round = function (n) { return Math.round(n * 10) / 10; };
    return {
      type: t,
      ageLabel: af.label,
      factor: af.factor,
      min: round(t.min * af.factor),
      max: round(t.max * af.factor),
      mid: round(((t.min + t.max) / 2) * af.factor),
      eligible: af.factor > 0,
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** בונה את בורר סוג הפגיעה עבור שורה */
  function buildPicker(row) {
    if (row.querySelector('.dep-type')) return;   // כבר קיים

    var sel = document.createElement('select');
    sel.className = 'dep-type';
    sel.style.cssText = 'font-size:11px;max-width:190px;padding:4px;border:1px solid var(--border2);border-radius:4px';

    var opts = '<option value="">— בחר סוג פגיעה —</option>';
    DAMAGE_TYPES.forEach(function (t) {
      opts += '<option value="' + t.id + '">' + esc(t.name) + '</option>';
    });
    sel.innerHTML = opts;

    var hint = document.createElement('div');
    hint.className = 'dep-hint';
    hint.style.cssText = 'font-size:10px;color:var(--text3);margin-top:3px;width:100%';

    sel.onchange = function () {
      var s = suggest(sel.value, vehicleAge());
      if (!s) { hint.textContent = ''; return; }

      if (!s.eligible) {
        hint.innerHTML = '<span style="color:var(--amber)">הרכב מעל גיל 8 — לא נבדקת ירידת ערך</span>';
        return;
      }

      hint.innerHTML = 'מוצע: <b>' + s.min + '%–' + s.max + '%</b> ' +
        '<span style="opacity:.75">(' + esc(s.ageLabel) + ')</span>' +
        (s.type.note ? ' · ' + esc(s.type.note) : '') +
        ' <a href="#" class="dep-apply" style="color:var(--blue);text-decoration:underline">החל ' + s.mid + '%</a>';

      var link = hint.querySelector('.dep-apply');
      if (link) link.onclick = function (e) {
        e.preventDefault();
        var pctInput = row.querySelector('.dp');
        var descInput = row.querySelector('input[type="text"]');
        if (pctInput) {
          pctInput.value = s.mid;
          if (typeof window.calcDeprec === 'function') window.calcDeprec();
        }
        if (descInput && !descInput.value) descInput.value = s.type.name;
      };
    };

    row.insertBefore(sel, row.firstChild);
    row.appendChild(hint);
    row.style.flexWrap = 'wrap';
  }

  function enhanceAll() {
    document.querySelectorAll('#deprecRows .deprec-row').forEach(buildPicker);
  }

  function install() {
    if (window.__depTableInstalled) return;

    if (typeof window.addDeprecRow === 'function') {
      var orig = window.addDeprecRow;
      window.addDeprecRow = function () {
        var r = orig.apply(this, arguments);
        setTimeout(enhanceAll, 30);
        return r;
      };
    }

    window.__depTableInstalled = true;
    window.DepreciationTable = {
      TYPES: DAMAGE_TYPES,
      AGE_FACTORS: AGE_FACTORS,
      suggest: suggest,
      ageFactor: ageFactor,
      vehicleAge: vehicleAge,
      enhanceAll: enhanceAll,
    };
    console.log('[Depreciation] טבלת ירידת הערך הותקנה');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
