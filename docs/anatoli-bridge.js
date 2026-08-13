/**
 * anatoli-bridge.js — גשר בין הטופס למנוע אנטולי
 * ---------------------------------------------------------------------------
 * עוטף את sendToAnatoli() הקיימת ומוסיף שתי יכולות שחסרו:
 *
 *   1. איסוף נתוני הרכב מהטופס (שנה, שווי, ק"מ, תאריך עלייה לכביש)
 *      ושליחתם למנוע — בלעדיהם אי אפשר לחשב אובדן להלכה, כלל
 *      מקורי/חליפי, או זכאות לירידת ערך.
 *
 *   2. הצגה עשירה של התוצאה: מוקד פגיעה, התראות ADAS, סטטוס אובדן
 *      להלכה, בדיקות חסרות ודיסקליימר.
 *
 * ⚠ לא נוגע בלוגיקה העסקית. עוטף בלבד, כמו estimax-cloud-bridge.js.
 * טעינה: אחרי index.html, לפני </body>.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  function val(id) {
    var el = document.getElementById(id);
    return el && el.value ? String(el.value).trim() : '';
  }

  function num(id) {
    var raw = val(id).replace(/[^\d.]/g, '');
    var n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }

  /** אוסף את נתוני הרכב שהמנוע צריך לכללי השמאות */
  function collectVehicle() {
    var v = {
      plate: val('f-plate'),
      vin: val('f-vin'),
      model: val('f-model'),
      year: num('f-year'),
      km: num('f-km'),
      value: num('f-value-manual'),
      on_road_date: val('f-roaddate'),
      moked: val('f-moked'),
      carcode: val('f-carcode'),
    };
    Object.keys(v).forEach(function (k) {
      if (v[k] === '' || v[k] === null) delete v[k];
    });
    return v;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ul(items) {
    return '<ul style="margin:4px 0 8px;padding-inline-start:18px">' +
      items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
  }

  /** בונה את תצוגת הממצאים המלאה */
  function renderResult(data) {
    var box = document.getElementById('anatoliResult');
    if (!box) return;

    var h = '<div class="anatoli-box"><div class="anatoli-hd">🔍 ממצאי אנטולי</div>' +
      '<div style="font-size:12px;color:var(--text2);line-height:1.7">';

    // סטטוס אובדן להלכה — הכי חשוב, ראשון ובולט
    if (data.total_loss_status) {
      var isLoss = data.total_loss_status === 'אובדן להלכה';
      var isWarn = data.total_loss_status === 'מתקרב לסף';
      var bg = isLoss ? 'var(--red-light)' : (isWarn ? 'var(--amber-light)' : 'var(--green-light)');
      var fg = isLoss ? 'var(--red)' : (isWarn ? 'var(--amber)' : 'var(--green)');
      h += '<div style="background:' + bg + ';color:' + fg + ';padding:9px 12px;' +
        'border-radius:var(--radius);font-weight:600;margin-bottom:10px">' +
        (isLoss ? '⚠ ' : '') + esc(data.total_loss_status);
      if (data.cost_estimate && data.cost_estimate.ratio_pct != null) {
        h += ' — ' + data.cost_estimate.ratio_pct + '% משווי הרכב';
      }
      h += '</div>';
    }

    if (data.adas_alert && data.adas_alert.length) {
      h += '<div style="background:var(--amber-light);color:var(--amber);padding:8px 12px;' +
        'border-radius:var(--radius);margin-bottom:10px">' +
        '<b>⚠ רכיבים מתקדמים באזור הפגיעה — נדרש כיול:</b>' + ul(data.adas_alert) + '</div>';
    }

    if (data.damages && data.damages.length) {
      h += '<b>נזקים שזוהו:</b>' + ul(data.damages);
    }

    if (data.parts && data.parts.length) {
      h += '<b>חלקים פגועים:</b>' + ul(data.parts.map(function (p) {
        return typeof p === 'string' ? p : (p.part_label || p.name);
      }));
    }

    if (data.missing_checks && data.missing_checks.length) {
      h += '<b>בדיקות משלימות שלא ניתן לבצע מתמונות:</b>' + ul(data.missing_checks);
    }

    if (data.recommendation) {
      h += '<b>המלצה:</b> ' + esc(data.recommendation) + '<br>';
    }

    if (data.disclaimer) {
      h += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);' +
        'font-size:11px;color:var(--text3)">' + esc(data.disclaimer) + '</div>';
    }

    h += '</div></div>';
    box.className = '';
    box.innerHTML = h;
  }

  /* ── עטיפת sendToAnatoli ── */
  function install() {
    if (typeof window.sendToAnatoli !== 'function') return false;
    if (window.__anatoliBridgeInstalled) return true;

    var original = window.sendToAnatoli;

    window.sendToAnatoli = function () {
      // אין שרת מחובר → נופל בחזרה למצב ההדגמה המקורי, לא נשבר
      if (!window.ANATOLI_API_ENDPOINT) return original.apply(this, arguments);

      if (window.CURRENT_USER_ROLE !== 'Anatoli_Appraiser') {
        if (window.toast) toast('אין הרשאה לשליחת תמונות לניתוח', 'info');
        return;
      }

      var key = window.currentTikKey ? window.currentTikKey() : '';
      var arr = (window.tikPhotos && window.tikPhotos[key]) || [];
      if (!arr.length) {
        if (window.toast) toast('יש להעלות תמונות תחילה', 'info');
        return;
      }

      var vehicle = collectVehicle();
      if (!vehicle.value && window.toast) {
        toast('טיפ: מילוי שווי הרכב יאפשר בדיקת אובדן להלכה', 'info');
      }

      if (window.toast) toast('שולח ' + arr.length + ' תמונות לניתוח אנטולי…', 'info');

      fetch(window.ANATOLI_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tik: key,
          role: window.CURRENT_USER_ROLE,
          photos: arr.map(function (p) { return p.src; }),
          vehicle: vehicle,
        }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error(j.error || 'שגיאת שרת');
            return j;
          });
        })
        .then(function (data) {
          renderResult(data);

          // הזרמה לטבלאות הקיימות — הפונקציות המקוריות, ללא שינוי
          (data.parts || []).forEach(function (p) {
            if (typeof window.addAnatoliPart !== 'function') return;
            if (typeof p === 'string') {
              window.addAnatoliPart({ name: p, orig: 'מקורי', cat: '', pr: 0, pa: 0 });
            } else {
              window.addAnatoliPart({
                name: p.name,
                orig: p.part_source || 'מקורי',
                cat: p.oem || '',
                pr: p.est_price_ils || 0,
                pa: 0,
              });
            }
          });

          (data.works || []).forEach(function (w) {
            if (typeof window.addAnatoliWork !== 'function') return;
            if (typeof w === 'string') window.addAnatoliWork({ type: w, hours: 0 });
            else window.addAnatoliWork({ type: w.type, hours: w.hours || 0 });
          });

          if (window.toast) {
            toast('הניתוח הושלם — שורות אנטולי ממתינות לאישור השמאי', 'success');
          }
          if (typeof window.scheduleDraftSave === 'function') window.scheduleDraftSave();
        })
        .catch(function (err) {
          console.error('[Anatoli]', err);
          if (window.toast) toast('שגיאה בניתוח: ' + err.message, 'info');
        });
    };

    window.__anatoliBridgeInstalled = true;
    window.AnatoliBridge = { collectVehicle: collectVehicle, renderResult: renderResult };
    console.log('[Anatoli] הגשר הותקן');
    return true;
  }

  if (!install()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      var tries = 0;
      var t = setInterval(function () {
        if (install() || ++tries > 40) clearInterval(t);
      }, 100);
    }
  }
})();
