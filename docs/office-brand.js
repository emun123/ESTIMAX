/**
 * office-brand.js — זהות משרד השמאות
 * ---------------------------------------------------------------------------
 * EstiMax היא בית התוכנה. המשרד שמפיק את חוות הדעת הוא לקוח שלה, ולכל משרד
 * זהות משלו. עד היום שם ולוגו EstiMax היו מקודדים קשיח בתוך הדוח — כלומר
 * כל משרד שיתקין את המערכת היה מוציא חוות דעת עם המותג של ספק התוכנה.
 *
 * כאן זה נפתר: כל מה שמזהה את המשרד יושב בהגדרות, נשמר, ומוזרק לדוח:
 *   • לוגו המשרד      → בכותרת חוות הדעת, במקום המקובל
 *   • חותמת המשרד     → בסוף הדוח; אם לא הועלתה, נוצרת חותמת עגולה עם שם המשרד
 *   • שם, רישיון,     → שורת החתימות, החותמת והפוטר
 *     טלפון, אתר
 *
 * EstiMax נשארת בדוח ככיתוב קרדיט קטן בפוטר בלבד — כך שמי שקורא את חוות
 * הדעת רואה את המשרד, ומי שמחפש את התוכנה מוצא אותה.
 *
 * ⚠ עוטף בלבד. לא נוגע בלוגיקה העסקית ולא בחישובים.
 * טעינה: אחרי signature-upload.js.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  var KEY = 'estimax_office_v1';
  var MAX_IMG = 400 * 1024;          // תקרה לכל תמונה, כדי לא למלא את localStorage
  var CREDIT = 'מופק באמצעות EstiMax';

  var FIELDS = ['name', 'license', 'phone', 'email', 'website', 'address', 'logo', 'stamp'];

  /* ═════════════════════ פונקציות טהורות (נבדקות) ═════════════════════ */

  /** מנקה ומשלים אובייקט משרד — תמיד מחזיר את כל השדות כמחרוזות */
  function normalize(raw) {
    var o = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i];
      var v = (raw && raw[k] != null) ? String(raw[k]) : '';
      o[k] = (k === 'logo' || k === 'stamp') ? v : v.trim();
    }
    return o;
  }

  /** האם הוגדרה זהות משרד בכלל? */
  function isConfigured(o) {
    return !!(o && (o.name || o.logo || o.stamp));
  }

  /**
   * מפצל שם משרד לשתי שורות לחותמת העגולה.
   * "אמון שמאים ומעריכים" → { top: 'אמון', bottom: 'שמאים ומעריכים' }
   */
  function splitName(name) {
    var s = String(name || '').trim().replace(/\s+/g, ' ');
    if (!s) return { top: '', bottom: '' };
    var sp = s.indexOf(' ');
    if (sp < 0) return { top: s, bottom: '' };
    return { top: s.slice(0, sp), bottom: s.slice(sp + 1) };
  }

  /** גודל גופן שמתאים את עצמו לאורך הטקסט בתוך החותמת */
  function fitFont(text, base, maxChars) {
    var n = String(text || '').length;
    if (!n || n <= maxChars) return base;
    var f = base * maxChars / n;
    return Math.round(Math.max(base * 0.55, f) * 10) / 10;
  }

  /** בדיקת קובץ תמונה לפני קריאה */
  function validateImage(file) {
    if (!file) return { ok: false, error: 'לא נבחר קובץ' };
    if (!/^image\//.test(file.type || '')) return { ok: false, error: 'צריך קובץ תמונה — PNG או JPG' };
    if (file.size > 4 * 1024 * 1024) return { ok: false, error: 'הקובץ גדול מדי (מעל 4MB)' };
    return { ok: true };
  }

  /** שורת הפוטר של המשרד — מדלגת על שדות ריקים */
  function footerLine(o) {
    var parts = [o.name, o.phone, o.website].filter(function (x) { return !!x; });
    return parts.join('  |  ');
  }

  /* ═══════════════════════════ אחסון ═══════════════════════════ */

  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (_) { return normalize(null); }
  }

  function write(o) {
    try { localStorage.setItem(KEY, JSON.stringify(normalize(o))); return true; }
    catch (_) { return false; }     // מצב פרטי / אחסון מלא
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════ הזרקת הזהות לתוך הדוח ═══════════════════ */

  /** בונה את ה-SVG של החותמת העגולה עם שם המשרד */
  function sealSvg(o, tik) {
    var n = splitName(o.name || '');
    var topSize = fitFont(n.top, 20, 5);
    var botSize = fitFont(n.bottom, 10, 15);
    return '' +
      '<svg class="rp-stamp" viewBox="0 0 160 160" role="img" aria-label="חותמת חתימה דיגיטלית מאומתת">' +
      '<circle cx="80" cy="80" r="76" fill="#FBFCFD"/>' +
      '<circle cx="80" cy="80" r="75" fill="none" stroke="#1B3A5C" stroke-width="2.8"/>' +
      '<circle cx="80" cy="80" r="68.5" fill="none" stroke="#C39B2E" stroke-width="5" stroke-dasharray="1.6 5.2" stroke-linecap="round" opacity=".85"/>' +
      '<circle cx="80" cy="80" r="62" fill="none" stroke="#C39B2E" stroke-width="1.5"/>' +
      '<circle cx="80" cy="80" r="58.5" fill="none" stroke="#1B3A5C" stroke-width=".9" opacity=".45"/>' +
      '<circle cx="80" cy="38" r="11" fill="none" stroke="#C39B2E" stroke-width="2"/>' +
      '<path d="M75.2 38.1l3.5 3.6 6.4-6.8" fill="none" stroke="#1B3A5C" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="80" y="66" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="#1B3A5C">מסמך נחתם דיגיטלית</text>' +
      '<path d="M42 73h76" stroke="#C39B2E" stroke-width="1.3"/>' +
      '<text x="80" y="92" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="' + topSize + '" font-weight="700" fill="#1B3A5C">' + esc(n.top) + '</text>' +
      '<text x="80" y="105" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + botSize + '" font-weight="700" fill="#1B3A5C">' + esc(n.bottom) + '</text>' +
      '<path d="M52 113h56" stroke="#C39B2E" stroke-width="1" opacity=".7"/>' +
      '<text x="80" y="126" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="9.5" font-weight="700" fill="#1B3A5C">תיק ' + esc(tik || '—') + '</text>' +
      '</svg>';
  }

  /** מחיל את זהות המשרד על הדוח שכבר נבנה */
  function applyToReport(doc, o) {
    doc = doc || document;
    o = normalize(o || read());
    var q = function (sel) { return doc.querySelector(sel); };

    /* ── לוגו בכותרת ── */
    var brand = q('.rp-brand');
    if (brand) {
      if (o.logo) {
        brand.innerHTML = '<img class="rp-brand-img" src="' + esc(o.logo) + '" alt="' + esc(o.name) + '"/>';
      } else if (o.name) {
        brand.innerHTML = '<div class="rp-office-name">' + esc(o.name) + '</div>' +
          (o.license ? '<div class="rp-office-sub">רישיון שמאי ' + esc(o.license) + '</div>' : '');
      }
      // אם לא הוגדר כלום — משאירים את מה שיש, כדי לא לרוקן את הכותרת
    }

    /* ── שם המשרד בשורת החתימות ── */
    var offBlock = doc.getElementById('rpOfficeLbl');
    if (offBlock && o.name) offBlock.innerHTML = 'חותמת המשרד<br/>' + esc(o.name);

    /* ── חותמת: תמונה שהועלתה גוברת על החותמת המחושבת ── */
    var row = q('.rp-stamp-row');
    if (row) {
      var tikEl = doc.getElementById('f-tik');
      var tik = tikEl ? tikEl.value : '';
      if (o.stamp) {
        row.innerHTML = '<img class="rp-stamp-img" src="' + esc(o.stamp) + '" alt="חותמת ' + esc(o.name) + '"/>';
      } else if (o.name) {
        row.innerHTML = sealSvg(o, tik);
      }
    }

    /* ── פוטר: פרטי המשרד + קרדיט קטן לבית התוכנה ── */
    var foot = doc.getElementById('rpFooterOffice');
    if (foot) {
      var line = footerLine(o);
      if (line) foot.textContent = line;
    }
    return o;
  }

  /* ═══════════════════ מסך ההגדרות ═══════════════════ */

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve) {
      var v = validateImage(file);
      if (!v.ok) return resolve({ ok: false, error: v.error });
      var r = new FileReader();
      r.onerror = function () { resolve({ ok: false, error: 'קריאת הקובץ נכשלה' }); };
      r.onload = function () {
        if (String(r.result).length > MAX_IMG) {
          return resolve({ ok: false, error: 'התמונה כבדה מדי לשמירה — הקטן אותה ונסה שוב' });
        }
        resolve({ ok: true, dataUrl: String(r.result) });
      };
      r.readAsDataURL(file);
    });
  }

  function imgSlot(id, label, hint) {
    return '' +
      '<div class="fg"><label>' + label + '</label>' +
      '<div class="ob-slot">' +
        '<div class="ob-prev" id="' + id + 'Prev">' + hint + '</div>' +
        '<div class="ob-actions">' +
          '<button type="button" class="sig-btn" id="' + id + 'Pick">בחר קובץ</button>' +
          '<button type="button" class="sig-btn" id="' + id + 'Clear">הסר</button>' +
        '</div>' +
      '</div></div>';
  }

  function paintPreview(id, dataUrl, hint) {
    var el = document.getElementById(id + 'Prev');
    if (!el) return;
    el.innerHTML = dataUrl
      ? '<img src="' + esc(dataUrl) + '" alt=""/>'
      : hint;
  }

  function wireSlot(id, field, state, hint) {
    var pick = document.getElementById(id + 'Pick');
    var clear = document.getElementById(id + 'Clear');
    if (pick) pick.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        readFileAsDataUrl(f).then(function (res) {
          if (!res.ok) { if (window.toast) toast(res.error, 'error'); return; }
          state[field] = res.dataUrl;
          paintPreview(id, res.dataUrl, hint);
        });
      });
      inp.click();
    });
    if (clear) clear.addEventListener('click', function () {
      state[field] = '';
      paintPreview(id, '', hint);
    });
  }

  function injectSettings() {
    var body = document.querySelector('#exProfileModal .modal-body');
    if (!body || document.getElementById('obSection')) return false;

    var o = read();
    var state = { logo: o.logo, stamp: o.stamp };

    var sec = document.createElement('div');
    sec.id = 'obSection';
    sec.innerHTML =
      '<div class="ob-title">זהות משרד השמאות</div>' +
      '<div class="ob-note">הפרטים והתמונות כאן הם מה שמופיע על חוות הדעת — לוגו בכותרת, ' +
      'חותמת בסיום, ושם המשרד בשורת החתימות ובפוטר. כל משרד מגדיר את שלו.</div>' +
      '<div class="fg"><label>שם המשרד</label><input type="text" id="obName" placeholder="לדוגמה: אמון שמאים ומעריכים" value="' + esc(o.name) + '"/></div>' +
      '<div class="fg"><label>מספר רישיון</label><input type="text" id="obLicense" placeholder="12345" value="' + esc(o.license) + '"/></div>' +
      '<div class="fg"><label>טלפון</label><input type="tel" id="obPhone" placeholder="04-000-0000" value="' + esc(o.phone) + '"/></div>' +
      '<div class="fg"><label>אתר / דוא״ל</label><input type="text" id="obWebsite" placeholder="example.co.il" value="' + esc(o.website) + '"/></div>' +
      '<div class="fg"><label>כתובת</label><input type="text" id="obAddress" placeholder="רחוב, עיר" value="' + esc(o.address) + '"/></div>' +
      imgSlot('obLogo', 'לוגו המשרד (מופיע בכותרת הדוח)', 'לא הועלה לוגו') +
      imgSlot('obStamp', 'חותמת המשרד (מופיעה בסיום הדוח)', 'אין חותמת — תיווצר חותמת עם שם המשרד') +
      '<div class="ob-actions" style="margin-top:4px"><button type="button" class="tb-btn tb-btn-primary" id="obSave">שמור זהות משרד</button></div>';
    body.insertBefore(sec, body.firstChild);

    paintPreview('obLogo', o.logo, 'לא הועלה לוגו');
    paintPreview('obStamp', o.stamp, 'אין חותמת — תיווצר חותמת עם שם המשרד');
    wireSlot('obLogo', 'logo', state, 'לא הועלה לוגו');
    wireSlot('obStamp', 'stamp', state, 'אין חותמת — תיווצר חותמת עם שם המשרד');

    var save = document.getElementById('obSave');
    if (save) save.addEventListener('click', function () {
      var v = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
      var next = normalize({
        name: v('obName'), license: v('obLicense'), phone: v('obPhone'),
        email: o.email, website: v('obWebsite'), address: v('obAddress'),
        logo: state.logo, stamp: state.stamp,
      });
      var ok = write(next);
      if (window.toast) toast(ok ? 'זהות המשרד נשמרה' : 'לא ניתן לשמור — האחסון חסום', ok ? 'success' : 'error');
      if (ok) {
        try { applyToReport(document, next); } catch (_) {}
      }
    });
    return true;
  }

  /* ═══════════════════════════ התקנה ═══════════════════════════ */

  function install() {
    if (window.__officeBrandInstalled) return;

    if (typeof window.renderReport === 'function') {
      var origRender = window.renderReport;
      window.renderReport = function () {
        var r = origRender.apply(this, arguments);
        setTimeout(function () { try { applyToReport(document); } catch (_) {} }, 60);
        setTimeout(function () { try { applyToReport(document); } catch (_) {} }, 420);
        return r;
      };
    }

    if (typeof window.exOpenProfile === 'function') {
      var origProfile = window.exOpenProfile;
      window.exOpenProfile = function () {
        var r = origProfile.apply(this, arguments);
        setTimeout(injectSettings, 40);
        return r;
      };
    }

    window.__officeBrandInstalled = true;
    window.OfficeBrand = {
      get: read,
      set: write,
      normalize: normalize,
      isConfigured: isConfigured,
      splitName: splitName,
      fitFont: fitFont,
      validateImage: validateImage,
      footerLine: footerLine,
      sealSvg: sealSvg,
      applyToReport: applyToReport,
      injectSettings: injectSettings,
      CREDIT: CREDIT,
    };
    console.log('[OfficeBrand] זהות משרד השמאות הותקנה');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
