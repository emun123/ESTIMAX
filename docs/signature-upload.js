/**
 * signature-upload.js — פאד חתימה חי + העלאת חתימה מקובץ
 * ---------------------------------------------------------------------------
 * ממשיך את signature-persist.js וסוגר שלושה פערים שנשארו פתוחים:
 *
 *   1. ⚠ הפאד היה מת לחלוטין.
 *      initSignature() רץ פעם אחת ב-DOMContentLoaded, אבל הקנבס נוצר רק
 *      מאוחר יותר בתוך renderReport(). לכן getElementById('sigCanvas')
 *      החזיר null, הפונקציה יצאה מיד — ואף אירוע ציור לא נקשר.
 *      גם sigCtx נשאר null, ולכן clearSignature() לא ניקה כלום.
 *      כאן הפאד מאותחל מחדש בכל רינדור של הדוח.
 *
 *   2. אין תמיכה במגע. הקוד המקורי קשר onmousedown/onmousemove בלבד,
 *      כך שבנייד — הפלטפורמה העיקרית של PWA — אי אפשר היה לחתום.
 *      כאן: Pointer Events (עכבר + מגע + עט), עם נפילה למגע/עכבר.
 *
 *   3. אין דרך להעלות חתימה קיימת. שמאי שסרק או צילם את חתימתו נאלץ
 *      לצייר אותה מחדש בעכבר. כאן: בחירת קובץ → הרקע הלבן מוסר,
 *      השוליים נגזרים, והחתימה ממורכזת בפאד ונשמרת.
 *
 * בנוסף: הקנבס עובר ל-devicePixelRatio, כך שהחתימה חדה בנייד ובהדפסה.
 *
 * ⚠ עוטף בלבד. לא נוגע בלוגיקה העסקית, לא בשמירה לענן ולא ב-signature-persist.
 * השמירה עצמה נשארת בידי window.saveSignature() הקיימת — כלומר ענן + מקומי.
 * טעינה: אחרי signature-persist.js.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  var MAX_FILE   = 6 * 1024 * 1024;  // 6MB — צילום חתימה סביר
  var MAX_SIDE   = 1600;             // תקרת עיבוד; מונע קיפאון על תמונות ענק
  var WHITE_CUT  = 238;              // בהיר מזה = נייר, הופך לשקוף
  var CONTRAST   = 1.55;             // הגברת ניגודיות הדיו אחרי המפתוח
  var MIN_ALPHA  = 24;               // סף "יש כאן דיו" לחישוב מסגרת הגזירה
  var PAD        = 6;                // שוליים בתוך הפאד, בפיקסלי CSS
  var INK        = '#0C447C';

  /* ═══════════════════ פונקציות טהורות (נבדקות ביחידה) ═══════════════════ */

  /** בדיקת קובץ לפני קריאה — סוג וגודל */
  function validateFile(file) {
    if (!file) return { ok: false, error: 'לא נבחר קובץ' };
    if (!/^image\//.test(file.type || '')) {
      return { ok: false, error: 'צריך קובץ תמונה — PNG או JPG' };
    }
    if (file.size > MAX_FILE) {
      return { ok: false, error: 'הקובץ גדול מדי (מעל 6MB) — צלם מחדש או הקטן' };
    }
    return { ok: true };
  }

  /**
   * מפתוח רקע: פיקסל בהיר הופך לשקוף, פיקסל כהה מקבל אלפא לפי כהותו.
   * צבע הדיו המקורי נשמר — חתימה כחולה נשארת כחולה.
   * מחזיר את מספר פיקסלי הדיו שנותרו.
   */
  function keyOut(data, cut, contrast) {
    cut = cut || WHITE_CUT;
    contrast = contrast || CONTRAST;
    var kept = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;                     // כבר שקוף
      var lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum >= cut) { data[i + 3] = 0; continue; }       // נייר
      var a = Math.round((1 - lum / cut) * 255 * contrast);
      if (a > 255) a = 255;
      data[i + 3] = a;
      if (a > MIN_ALPHA) kept++;
    }
    return kept;
  }

  /** מסגרת הגזירה סביב הדיו; null אם אין דיו בכלל */
  function trimBounds(data, w, h, minAlpha) {
    minAlpha = (minAlpha === undefined) ? MIN_ALPHA : minAlpha;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > minAlpha) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** מלבן ממורכז ששומר יחס גובה-רוחב בתוך היעד (כולל הגדלה) */
  function fitRect(sw, sh, dw, dh, pad) {
    pad = (pad === undefined) ? PAD : pad;
    if (!sw || !sh) return { x: 0, y: 0, w: 0, h: 0 };
    var aw = Math.max(1, dw - pad * 2);
    var ah = Math.max(1, dh - pad * 2);
    var s = Math.min(aw / sw, ah / sh);
    var w = sw * s, h = sh * s;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w: w, h: h };
  }

  /** קנה מידה להורדת תמונת ענק לפני עיבוד */
  function downscale(w, h, maxSide) {
    maxSide = maxSide || MAX_SIDE;
    var s = Math.min(1, maxSide / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  /* ═══════════════════════════ עזרי קנבס ═══════════════════════════ */

  function isBlank(canvas) {
    var SP = window.SignaturePersist;
    if (SP && typeof SP.isBlank === 'function') return SP.isBlank(canvas);
    try {
      var d = canvas.getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
      return true;
    } catch (_) { return false; }
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toast(msg, kind) {
    if (typeof window.toast === 'function') window.toast(msg, kind || 'info');
  }

  /* ═════════════════════ אתחול הפאד (התיקון המרכזי) ═════════════════════ */

  function cssSize(canvas) {
    var w = canvas.offsetWidth || canvas.clientWidth || 0;
    var h = canvas.offsetHeight || canvas.clientHeight || 0;
    if (!w && canvas.getBoundingClientRect) {
      var r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
    }
    return { w: Math.round(w) || 300, h: Math.round(h) || 120 };
  }

  function pointIn(canvas, e) {
    var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cx = (e.clientX !== undefined) ? e.clientX
           : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    var cy = (e.clientY !== undefined) ? e.clientY
           : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (!r || !r.width) return { x: cx, y: cy };
    var k = (canvas.__sigCssW || r.width) / r.width;
    return { x: (cx - r.left) * k, y: (cy - r.top) * k };
  }

  function bindDrawing(canvas) {
    if (canvas.__sigBound) return;
    canvas.__sigBound = true;

    // מנטרלים את המאזינים המקוריים (עכבר בלבד, ובמערכת קואורדינטות ישנה)
    canvas.onmousedown = canvas.onmousemove = canvas.onmouseup = canvas.onmouseleave = null;

    var drawing = false;

    function begin(e) {
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawing = true;
      var p = pointIn(canvas, e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      if (e.preventDefault) e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var p = pointIn(canvas, e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (e.preventDefault) e.preventDefault();
    }
    function end() {
      if (!drawing) return;
      drawing = false;
      canvas.setAttribute('data-signed', 'drawn');
    }

    var on = canvas.addEventListener ? canvas.addEventListener.bind(canvas) : null;
    if (!on) return;

    if (window.PointerEvent) {
      on('pointerdown', begin);
      on('pointermove', move);
      on('pointerup', end);
      on('pointercancel', end);
      on('pointerleave', end);
    } else {
      on('mousedown', begin);
      on('mousemove', move);
      on('mouseup', end);
      on('mouseleave', end);
      on('touchstart', begin, { passive: false });
      on('touchmove', move, { passive: false });
      on('touchend', end);
      on('touchcancel', end);
    }
  }

  /** מאתחל את הפאד: רזולוציית DPR, סגנון קו, ואירועי ציור */
  function setupPad(canvas) {
    if (!canvas || !canvas.getContext) return false;

    var keep = null;
    try {
      if (canvas.width && canvas.height && !isBlank(canvas)) {
        keep = canvas.toDataURL('image/png');
      }
    } catch (_) { keep = null; }

    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var size = cssSize(canvas);
    canvas.__sigCssW = size.w;
    canvas.__sigCssH = size.h;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);

    var ctx = canvas.getContext('2d');
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = INK;
    if (canvas.style) canvas.style.touchAction = 'none';

    bindDrawing(canvas);
    if (keep) placeDataUrl(canvas, keep, false);
    return true;
  }

  /* ═══════════════════ ציור תמונה אל תוך הפאד ═══════════════════ */

  /**
   * מצייר dataURL על הפאד. process=true מפעיל מפתוח רקע + גזירת שוליים
   * (למסלול ההעלאה); process=false רק ממרכז (לשחזור אחרי שינוי גודל).
   */
  function placeDataUrl(canvas, dataUrl, process) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onerror = function () { resolve({ ok: false, error: 'הקובץ אינו תמונה תקינה' }); };
      img.onload = function () {
        try {
          var sw = img.naturalWidth || img.width;
          var sh = img.naturalHeight || img.height;
          if (!sw || !sh) return resolve({ ok: false, error: 'תמונה ריקה' });

          var d = downscale(sw, sh);
          var work = newCanvas(d.w, d.h);
          var wctx = work.getContext('2d');
          wctx.drawImage(img, 0, 0, d.w, d.h);

          var src = work, sx = 0, sy = 0, sWidth = d.w, sHeight = d.h;

          if (process) {
            var idata = wctx.getImageData(0, 0, d.w, d.h);
            var kept = keyOut(idata.data);
            if (!kept) {
              return resolve({ ok: false, error: 'לא נמצאה חתימה בתמונה — נסה תמונה ברורה יותר' });
            }
            wctx.clearRect(0, 0, d.w, d.h);
            wctx.putImageData(idata, 0, 0);

            var b = trimBounds(idata.data, d.w, d.h);
            if (b) { sx = b.x; sy = b.y; sWidth = b.w; sHeight = b.h; }
          }

          var cw = canvas.__sigCssW || canvas.width;
          var ch = canvas.__sigCssH || canvas.height;
          var r = fitRect(sWidth, sHeight, cw, ch);

          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, cw, ch);
          ctx.drawImage(src, sx, sy, sWidth, sHeight, r.x, r.y, r.w, r.h);
          canvas.setAttribute('data-signed', process ? 'uploaded' : 'restored');
          resolve({ ok: true });
        } catch (e) {
          resolve({ ok: false, error: 'לא הצלחתי לעבד את התמונה' });
        }
      };
      img.src = dataUrl;
    });
  }

  /** המסלול המלא: קובץ → פאד → שמירה (ענן + מקומי, דרך saveSignature הקיימת) */
  function handleFile(file) {
    var v = validateFile(file);
    if (!v.ok) { toast(v.error, 'error'); return Promise.resolve(v); }

    var canvas = document.getElementById('sigCanvas');
    if (!canvas) {
      toast('פתח את מסך הדוח לפני העלאת חתימה', 'error');
      return Promise.resolve({ ok: false, error: 'אין פאד חתימה' });
    }

    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () {
        toast('קריאת הקובץ נכשלה', 'error');
        resolve({ ok: false, error: 'קריאה נכשלה' });
      };
      reader.onload = function () {
        placeDataUrl(canvas, reader.result, true).then(function (res) {
          if (!res.ok) { toast(res.error, 'error'); return resolve(res); }
          try {
            if (typeof window.saveSignature === 'function') window.saveSignature();
          } catch (_) {}
          resolve({ ok: true });
        });
      };
      reader.readAsDataURL(file);
    });
  }

  /* ═══════════════════════ הזרקת כפתור ההעלאה ═══════════════════════ */

  function fileInput() {
    var el = document.getElementById('sigUploadInput');
    if (el) return el;
    el = document.createElement('input');
    el.type = 'file';
    el.id = 'sigUploadInput';
    el.accept = 'image/png,image/jpeg,image/webp';
    if (el.style) el.style.display = 'none';
    el.addEventListener('change', function () {
      var f = el.files && el.files[0];
      if (f) handleFile(f);
      el.value = '';
    });
    if (document.body) document.body.appendChild(el);
    return el;
  }

  function injectButton() {
    var host = document.querySelector ? document.querySelector('.sig-buttons') : null;
    if (!host || document.getElementById('sigUploadBtn')) return false;
    var btn = document.createElement('button');
    btn.id = 'sigUploadBtn';
    btn.type = 'button';
    btn.className = 'sig-btn';
    btn.textContent = 'העלה חתימה';
    btn.title = 'העלאת חתימה סרוקה או מצולמת — הרקע הלבן יוסר אוטומטית';
    btn.addEventListener('click', function () { fileInput().click(); });
    host.insertBefore(btn, host.firstChild);
    return true;
  }

  /* ═══════════════════════════ התקנה ═══════════════════════════ */

  function refresh() {
    var c = document.getElementById('sigCanvas');
    if (c) setupPad(c);
    injectButton();
  }

  function install() {
    if (window.__sigUploadInstalled) return;

    /* הפאד מאותחל מחדש בכל פעם שהדוח נבנה — כאן היה הבאג */
    if (typeof window.renderReport === 'function') {
      var origRender = window.renderReport;
      window.renderReport = function () {
        var r = origRender.apply(this, arguments);
        setTimeout(refresh, 120);
        setTimeout(refresh, 400);   // שכבה שנייה: פריסות איטיות בנייד
        return r;
      };
    }

    /* ניקוי אמיתי — sigCtx המקורי נשאר null ולכן לא ניקה כלום */
    var origClear = window.clearSignature;
    window.clearSignature = function () {
      var r;
      try { if (typeof origClear === 'function') r = origClear.apply(this, arguments); } catch (_) {}
      var c = document.getElementById('sigCanvas');
      if (c && c.getContext) {
        try {
          c.getContext('2d').clearRect(0, 0, c.width, c.height);
          c.removeAttribute('data-signed');
        } catch (_) {}
      }
      return r;
    };

    /* תצוגת החתימה בפרופיל: גם גיבוי מקומי, לא רק ענן */
    if (typeof window.exOpenProfile === 'function') {
      var origProfile = window.exOpenProfile;
      window.exOpenProfile = function () {
        var r = origProfile.apply(this, arguments);
        setTimeout(function () {
          var prev = document.getElementById('exSigPreview');
          var SP = window.SignaturePersist;
          if (!prev || !SP || !SP.hasLocal()) return;
          if (prev.querySelector && prev.querySelector('img')) return;  // הענן כבר הציג
          prev.innerHTML = '<img src="' + SP.getLocal() + '" style="max-height:60px" alt="חתימה שמורה"/>';
        }, 400);
        return r;
      };
    }

    /* שינוי כיוון מסך / גודל חלון — מכייל את הפאד מחדש */
    if (window.addEventListener) {
      var t = null;
      window.addEventListener('resize', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          var c = document.getElementById('sigCanvas');
          if (c && c.offsetWidth && c.offsetWidth !== c.__sigCssW) setupPad(c);
        }, 200);
      });
    }

    refresh();

    window.__sigUploadInstalled = true;
    window.SignatureUpload = {
      validateFile: validateFile,
      keyOut: keyOut,
      trimBounds: trimBounds,
      fitRect: fitRect,
      downscale: downscale,
      setupPad: setupPad,
      placeDataUrl: placeDataUrl,
      handleFile: handleFile,
      refresh: refresh,
    };
    console.log('[Signature] פאד חי + העלאת חתימה הותקנו');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
