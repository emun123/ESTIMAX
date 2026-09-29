/**
 * signature-persist.js — חתימה מתמדת
 * ---------------------------------------------------------------------------
 * סוגר שני פערים בחתימה הדיגיטלית:
 *
 *   1. saveSignature() המקורית רק הציגה הודעת הצלחה — לא שמרה כלום.
 *      במצב הדגמה (וכשהענן לא זמין) החתימה נעלמה ברענון.
 *      עכשיו היא נשמרת ב-localStorage כגיבוי מקומי.
 *
 *   2. הקנבס בדוח התחיל ריק בכל תיק, כך שהשמאי נאלץ לחתום מחדש
 *      שוב ושוב. עכשיו החתימה השמורה נטענת אוטומטית לתוך הדוח.
 *
 * סדר העדיפויות בטעינה: ענן (אם מחובר) → מקומי → ריק.
 * הענן נשאר מקור האמת; המקומי הוא רשת ביטחון.
 *
 * ⚠ עוטף בלבד. לא נוגע בלוגיקה העסקית ולא בשמירה לענן.
 * טעינה: אחרי estimax-cloud-bridge.js.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  var KEY = 'estimax_signature_v1';
  var MAX_BYTES = 400 * 1024;   // תקרה סבירה לחתימה; מונע מילוי localStorage

  function readLocal() {
    try { return localStorage.getItem(KEY) || null; } catch (_) { return null; }
  }

  function writeLocal(dataUrl) {
    try {
      if (!dataUrl || dataUrl.length > MAX_BYTES) return false;
      localStorage.setItem(KEY, dataUrl);
      return true;
    } catch (_) { return false; }   // מצב פרטי / אחסון מלא
  }

  /** האם הקנבס ריק? (כל הפיקסלים שקופים) */
  function isBlank(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
      return true;
    } catch (_) { return false; }   // canvas מזוהם — לא נניח שהוא ריק
  }

  /** מצייר dataURL על הקנבס תוך שמירת יחס הגובה-רוחב */
  function drawOnto(canvas, dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          var scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
          var w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          resolve(true);
        } catch (_) { resolve(false); }
      };
      img.onerror = function () { resolve(false); };
      img.src = dataUrl;
    });
  }

  /** טוען את החתימה השמורה לקנבס הדוח — ענן קודם, מקומי כגיבוי */
  function loadInto(canvas) {
    if (!canvas || !canvas.getContext) return Promise.resolve(false);
    // לא דורסים חתימה שהמשתמש כרגע צייר
    if (!isBlank(canvas)) return Promise.resolve(false);

    var API = window.EstimaxAPI;
    var cloud = (API && !API.isDemo() && typeof API.getSignatureUrl === 'function')
      ? API.getSignatureUrl().catch(function () { return null; })
      : Promise.resolve(null);

    return cloud.then(function (url) {
      var src = url || readLocal();
      if (!src) return false;
      return drawOnto(canvas, src).then(function (ok) {
        if (ok) canvas.setAttribute('data-signed', 'saved');
        return ok;
      });
    });
  }

  function install() {
    if (window.__sigPersistInstalled) return;

    /* ── 1. שמירה מקומית בנוסף לענן ── */
    if (typeof window.saveSignature === 'function') {
      var origSave = window.saveSignature;
      window.saveSignature = function () {
        var r = origSave.apply(this, arguments);
        var c = document.getElementById('sigCanvas');
        if (c && c.toDataURL) {
          if (isBlank(c)) {
            if (window.toast) toast('הקנבס ריק — צייר חתימה לפני השמירה', 'info');
            return r;
          }
          try { writeLocal(c.toDataURL('image/png')); } catch (_) {}
        }
        return r;
      };
    }

    /* ── 2. ניקוי מוחק גם את המקומי ── */
    if (typeof window.clearSignature === 'function') {
      var origClear = window.clearSignature;
      window.clearSignature = function () {
        var r = origClear.apply(this, arguments);
        var c = document.getElementById('sigCanvas');
        if (c) c.removeAttribute('data-signed');
        return r;
      };
    }

    /* ── 3. טעינה אוטומטית כשהדוח נבנה ── */
    if (typeof window.renderReport === 'function') {
      var origRender = window.renderReport;
      window.renderReport = function () {
        var r = origRender.apply(this, arguments);
        // הקנבס נוצר בתוך הרינדור — ממתינים לו
        setTimeout(function () {
          var c = document.getElementById('sigCanvas');
          if (c) loadInto(c);
        }, 250);
        return r;
      };
    }

    window.__sigPersistInstalled = true;
    window.SignaturePersist = {
      load: loadInto,
      hasLocal: function () { return !!readLocal(); },
      getLocal: readLocal,
      clearLocal: function () { try { localStorage.removeItem(KEY); } catch (_) {} },
      isBlank: isBlank,
    };
    console.log('[Signature] שכבת החתימה המתמדת הותקנה');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
