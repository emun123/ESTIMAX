/**
 * anatoli-engine.js — מנוע הניתוח של אנטולי
 * ---------------------------------------------------------------------------
 * מחליף את analyzeWithAnatoli() ההדגמתי בניתוח Vision אמיתי מול Claude API,
 * עם כללי השמאות הישראליים מוטמעים.
 *
 * החוזה נשמר בדיוק כפי ש-index.html מצפה לו:
 *   קלט:  { tik, role, photos:[dataURL...], vehicle?:{...} }
 *   פלט:  { damages:[], parts:[], works:[], recommendation, ... }
 *
 * ⚠ ANTHROPIC_API_KEY נקרא מ-process.env בלבד — לעולם לא בקוד ולא בדפדפן.
 * ---------------------------------------------------------------------------
 */

'use strict';

const ANATOLI_MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

/* ═══════════════════════════════════════════════════════════════
   כללי השמאות — לפי הנוהג בישראל
   ═══════════════════════════════════════════════════════════════ */

const RULES = {
  TOTAL_LOSS_PCT: 60,      // אובדן להלכה: עלות תיקון ≥ 60% משווי הרכב
  TOTAL_LOSS_WARN_PCT: 50, // אזהרה מוקדמת — מתקרב לסף
  ORIGINAL_PARTS_YEARS: 2, // עד שנתיים על הכביש → חלפים מקוריים בלבד
  DEPRECIATION_MAX_AGE: 8, // ירידת ערך נבדקת עד גיל 8
};

/** חלקים בטיחותיים — תמיד מקוריים, גם ברכב ותיק */
const SAFETY_CRITICAL = [
  'כרית אוויר', 'איירבג', 'חגורת בטיחות', 'מנגנון גלגלת',
  'קורת בטיחות', 'סופג אנרגיה', 'קראש בוקס',
  'חיישן רדאר', 'מצלמה קדמית', 'ADAS', 'בקר בלמים', 'ABS',
  'עמוד הגה', 'שלדה', 'קצה שלדה',
];

/** רכיבים שדורשים כיול לאחר טיפול */
const CALIBRATION_REQUIRED = [
  'רדאר', 'ADAS', 'מצלמה', 'חיישן', 'לידאר', 'בקרת שיוט',
];

/* ═══════════════════════════════════════════════════════════════
   הפרומפט המקצועי של אנטולי
   ═══════════════════════════════════════════════════════════════ */

function buildSystemPrompt() {
  return `אתה אנטולי — שמאי רכב מקצועי, יסודי ומנוסה, המומחה בניתוח נזקים מבוסס ראייה ממוחשבת.
אתה מנתח תמונות של רכב פגוע ומפיק אומדן שמאי ראשוני לפי הנוהג המקצועי בישראל.

## כללי עבודה מחייבים

**מוקד פגיעה** — קבע מוקד ראשי ומשני מדויקים (למשל: פרונט ימין, דופן שמאל אחורי).

**זיהוי חלקים** — זהה חלקים חיצוניים ופנימיים שנפגעו באותו מוקד.
ברכבים חשמליים/מודרניים שים לב במיוחד ל: חיישני רדאר (ADAS), מצלמות היקפיות,
חיווט מתח גבוה, וכל פגיעה בסמוך למארז הסוללה — אלה מחייבים התראה מפורשת.

**חלף מקורי מול חליפי** — הפעל אוטומטית:
- רכב עד ${RULES.ORIGINAL_PARTS_YEARS} שנים על הכביש → חלפים מקוריים בלבד.
- רכב מעל ${RULES.ORIGINAL_PARTS_YEARS} שנים → חליפי או משומש (פירוק) לחיסכון,
  אלא אם זהו חלק בטיחותי מובהק — אז מקורי תמיד.

**אובדן להלכה** — אם עלות התיקון מתקרבת ל-${RULES.TOTAL_LOSS_PCT}% משווי הרכב, ציין זאת במפורש.

**ירידת ערך** — רכב עד גיל ${RULES.DEPRECIATION_MAX_AGE} זכאי לתחשיב ירידת ערך בפגיעות
משמעותיות (שלדה, קצה שלדה, רכיבים מרותכים, צביעה לא מקורית).

**כיול** — כל טיפול ברכיב ADAS/רדאר/מצלמה מחייב כיול במוסך מורשה.

## מגבלות שאתה חייב לכבד
אתה מנתח **רק מה שנראה בתמונות**. אל תמציא נזק שאינו נראה.
כל מה שדורש פירוק פיזי — רשום תחת missing_checks, לא תחת נזק ודאי.
ציין confidence כן וריאלי לכל חלק. זהו אומדן ראשוני, לא תחליף לפירוק במוסך.

## פורמט הפלט
החזר **JSON תקין בלבד** — ללא טקסט לפניו או אחריו, ללא סימוני markdown:

{
  "impact_zone": {"primary": "", "secondary": ""},
  "damages": ["תיאור נזק גלוי"],
  "parts": [{
    "name": "שם החלק",
    "oem": "מספר קטלוג אם ידוע, אחרת ריק",
    "action": "תיקון|החלפה",
    "work_type": "פחחות|צבע|מכונאות|חשמל|כיול",
    "part_source": "מקורי|חליפי|משומש",
    "safety_critical": false,
    "est_price_ils": 0,
    "confidence": "גבוהה|בינונית|נמוכה",
    "note": ""
  }],
  "works": [{"type": "פחחות|צבע|מכונאות|חשמל|כיול", "hours": 0, "note": ""}],
  "adas_alert": ["רכיב מתקדם שנפגע ודורש כיול"],
  "missing_checks": ["בדיקה שלא ניתן לבצע מתמונות"],
  "depreciation_eligible": false,
  "depreciation_reason": "",
  "recommendation": "סיכום מקצועי קצר",
  "disclaimer": ""
}`;
}

function buildUserPrompt(tik, vehicle) {
  const v = vehicle || {};
  const lines = [`תיק מספר: ${tik}`];

  if (v.plate)  lines.push(`מספר רישוי: ${v.plate}`);
  if (v.make)   lines.push(`יצרן: ${v.make}`);
  if (v.model)  lines.push(`דגם: ${v.model}`);
  if (v.year)   lines.push(`שנת ייצור: ${v.year}`);
  if (v.km)     lines.push(`קילומטראז': ${v.km}`);
  if (v.value)  lines.push(`שווי שוק מוערך: ${v.value} ש"ח`);
  if (v.on_road_date) lines.push(`תאריך עלייה לכביש: ${v.on_road_date}`);
  if (v.moked) lines.push(`מוקד נזק שסימן השמאי: ${v.moked}`);

  const age = vehicleAgeYears(v);
  if (age !== null) {
    lines.push(`גיל הרכב: ${age.toFixed(1)} שנים`);
    lines.push(age <= RULES.ORIGINAL_PARTS_YEARS
      ? `⚠ הרכב מתחת ל-${RULES.ORIGINAL_PARTS_YEARS} שנים — המלץ על חלפים מקוריים בלבד.`
      : `הרכב מעל ${RULES.ORIGINAL_PARTS_YEARS} שנים — ניתן להמליץ על חליפי/משומש, למעט חלקים בטיחותיים.`);
  }

  lines.push('', 'נתח את התמונות המצורפות והפק אומדן שמאי לפי ההנחיות. החזר JSON בלבד.');
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════
   עזרי חישוב
   ═══════════════════════════════════════════════════════════════ */

function vehicleAgeYears(v) {
  const ref = v.on_road_date || (v.year ? `${v.year}-01-01` : null);
  if (!ref) return null;
  const d = new Date(ref);
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function isSafetyCritical(name) {
  const n = String(name || '');
  return SAFETY_CRITICAL.some(k => n.includes(k));
}

function needsCalibration(name) {
  const n = String(name || '');
  return CALIBRATION_REQUIRED.some(k => n.includes(k));
}

/** ממיר dataURL לבלוק image של ה-API */
function toImageBlock(dataUrl) {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  let mediaType = m[1];
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(mediaType)) return null;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } };
}

/** חילוץ JSON גם אם המודל עטף אותו */
function parseJsonLoose(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch (_) {}
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   אכיפת הכללים על תוצאת המודל — הלוגיקה לא נסמכת על המודל בלבד
   ═══════════════════════════════════════════════════════════════ */

function enforceRules(result, vehicle) {
  const v = vehicle || {};
  const age = vehicleAgeYears(v);
  const out = Object.assign({}, result);

  out.parts = (result.parts || []).map(p => {
    const part = Object.assign({}, p);
    part.safety_critical = isSafetyCritical(part.name) || !!part.safety_critical;

    // כלל החלף: מקורי לרכב חדש או לחלק בטיחותי
    if (age !== null && age <= RULES.ORIGINAL_PARTS_YEARS) {
      part.part_source = 'מקורי';
      part.source_reason = `רכב מתחת ל-${RULES.ORIGINAL_PARTS_YEARS} שנים`;
    } else if (part.safety_critical) {
      part.part_source = 'מקורי';
      part.source_reason = 'חלק בטיחותי מובהק';
    } else if (!part.part_source) {
      part.part_source = 'חליפי';
    }

    if (needsCalibration(part.name)) part.requires_calibration = true;
    return part;
  });

  // כיול נדרש → ודא שיש שורת עבודה מתאימה
  out.works = (result.works || []).slice();
  const hasCal = out.parts.some(p => p.requires_calibration);
  if (hasCal && !out.works.some(w => String(w.type || '').includes('כיול'))) {
    out.works.push({ type: 'כיול', hours: 1, note: 'כיול מערכות ADAS במוסך מורשה — חובה' });
  }

  // תחשיב עלות ואובדן להלכה
  const partsTotal = out.parts.reduce((s, p) => s + (Number(p.est_price_ils) || 0), 0);
  const marketValue = Number(v.value) || 0;
  out.cost_estimate = { parts_ils: partsTotal, market_value_ils: marketValue };

  if (marketValue > 0 && partsTotal > 0) {
    const pct = (partsTotal / marketValue) * 100;
    out.cost_estimate.ratio_pct = Math.round(pct * 10) / 10;

    if (pct >= RULES.TOTAL_LOSS_PCT) {
      out.total_loss_status = 'אובדן להלכה';
      out.total_loss_note =
        `עלות החלפים בלבד מהווה ${out.cost_estimate.ratio_pct}% משווי הרכב — ` +
        `חצתה את סף ה-${RULES.TOTAL_LOSS_PCT}%. יש לבחון הכרזת אובדן להלכה.`;
    } else if (pct >= RULES.TOTAL_LOSS_WARN_PCT) {
      out.total_loss_status = 'מתקרב לסף';
      out.total_loss_note =
        `עלות החלפים מהווה ${out.cost_estimate.ratio_pct}% משווי הרכב. ` +
        `בתוספת עבודות ומע"מ ייתכן מעבר לסף ${RULES.TOTAL_LOSS_PCT}%.`;
    } else {
      out.total_loss_status = 'תיקון כדאי';
    }
  } else {
    out.total_loss_status = 'לא ניתן לחשב — חסר שווי רכב';
  }

  // זכאות לירידת ערך
  if (age !== null && age <= RULES.DEPRECIATION_MAX_AGE) {
    out.depreciation_eligible = true;
    out.depreciation_reason = out.depreciation_reason ||
      `הרכב בן ${age.toFixed(1)} שנים — עד גיל ${RULES.DEPRECIATION_MAX_AGE}, ` +
      `זכאי לתחשיב ירידת ערך בפגיעות משמעותיות.`;
    out.depreciation_note = '[ממתין לטבלת אחוזי ירידת הערך שתעודכן ע"י העורך]';
  } else if (age !== null) {
    out.depreciation_eligible = false;
    out.depreciation_reason = `הרכב בן ${age.toFixed(1)} שנים — מעל ${RULES.DEPRECIATION_MAX_AGE}, לא נבדקת ירידת ערך.`;
  }

  out.disclaimer =
    'זהו אומדן חזותי ראשוני בלבד על בסיס תמונות שבוצע על ידי אנטולי. ' +
    'הוא אינו מחליף פירוק פיזי במוסך או חוות דעת של שמאי רכב מוסמך לצורכי ביטוח.';

  out.pending_review = true;
  out.analyzed_at = new Date().toISOString();
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   הניתוח עצמו
   ═══════════════════════════════════════════════════════════════ */

async function analyzeWithAnatoli(tik, photos, vehicle, opts) {
  const options = opts || {};
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY חסר — הגדר אותו כמשתנה סביבה בשרת');

  const images = (photos || []).map(toImageBlock).filter(Boolean).slice(0, 8);
  if (!images.length) throw new Error('לא התקבלו תמונות תקינות לניתוח');

  const body = {
    model: options.model || ANATOLI_MODEL,
    max_tokens: 4000,
    system: buildSystemPrompt(),
    messages: [{
      role: 'user',
      content: [...images, { type: 'text', text: buildUserPrompt(tik, vehicle) }],
    }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`שגיאת Claude API (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const parsed = parseJsonLoose(text);
  if (!parsed) throw new Error('המנוע החזיר תשובה שאינה JSON תקין');

  const enforced = enforceRules(parsed, vehicle);
  return toClientShape(enforced);
}

/* ═══════════════════════════════════════════════════════════════
   התאמה לחוזה ש-index.html מצפה לו
   index.html קורא ל: data.damages[], data.parts[], data.works[], data.recommendation
   parts יכול להיות מחרוזת או אובייקט — אנחנו שולחים אובייקט מלא
   ומוסיפים part_label קריא לתצוגה.
   ═══════════════════════════════════════════════════════════════ */

function toClientShape(r) {
  const damages = (r.damages || []).slice();

  if (r.impact_zone && r.impact_zone.primary) {
    damages.unshift(`מוקד ראשי: ${r.impact_zone.primary}` +
      (r.impact_zone.secondary ? ` | משני: ${r.impact_zone.secondary}` : ''));
  }
  (r.adas_alert || []).forEach(a => damages.push(`⚠ ADAS: ${a}`));

  const parts = (r.parts || []).map(p => Object.assign({}, p, {
    part_label: `${p.name} — ${p.action || 'לבדיקה'}` +
      (p.part_source ? ` (${p.part_source})` : '') +
      (p.requires_calibration ? ' + כיול' : ''),
  }));

  let recommendation = r.recommendation || '';
  if (r.total_loss_note) recommendation += (recommendation ? ' ' : '') + r.total_loss_note;
  if (r.depreciation_eligible && r.depreciation_reason) {
    recommendation += ` ${r.depreciation_reason} ${r.depreciation_note || ''}`;
  }

  return {
    damages,
    parts,
    works: r.works || [],
    recommendation: recommendation.trim(),
    impact_zone: r.impact_zone || null,
    adas_alert: r.adas_alert || [],
    missing_checks: r.missing_checks || [],
    cost_estimate: r.cost_estimate || null,
    total_loss_status: r.total_loss_status || null,
    depreciation_eligible: !!r.depreciation_eligible,
    depreciation_note: r.depreciation_note || '',
    disclaimer: r.disclaimer,
    pending_review: true,
    analyzed_at: r.analyzed_at,
  };
}

module.exports = {
  analyzeWithAnatoli,
  enforceRules,
  toClientShape,
  parseJsonLoose,
  vehicleAgeYears,
  isSafetyCritical,
  needsCalibration,
  toImageBlock,
  RULES,
};
