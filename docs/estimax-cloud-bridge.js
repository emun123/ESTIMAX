/* ══════════════════════════════════════════════════════════════
   ESTIMAX — גשר ענן
   ──────────────────────────────────────────────────────────────
   מחבר את המסכים הקיימים (רשימת תיקים, טופס, תמונות, דוח)
   לשכבת הנתונים ב-estimax-api.js — בלי לשכתב את הקוד המקורי.

   השיטה: עטיפה (monkey-patch) של הפונקציות הקיימות. כל פונקציה
   מקורית ממשיכה לרוץ כרגיל, והגשר מוסיף מעליה את חלק הענן.
   כשאין חיבור לשרת הגשר מנטרל את עצמו והאפליקציה חוזרת
   להתנהגות המקורית בדיוק.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var API = null;
  var attached = false;
  var active = false;          // true רק כשמחוברים לשרת אמיתי
  var activeCaseId = null;     // התיק הפתוח כרגע בטופס
  var caseIdByTik = {};        // 'f-tik' → uuid בענן
  var refreshing = false;

  /* ─── מיפוי סטטוסים בין הענן לממשק ─── */
  var CLOUD_TO_UI = { draft: 'open', in_progress: 'prog', completed: 'done', sent: 'done', archived: 'done' };
  var UI_TO_CLOUD = { open: 'draft', prog: 'in_progress', done: 'completed' };

  function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function num(v) {
    if (v == null || v === '') return 0;
    var n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  }

  /* ─── המרת רשומת ענן לשורה בטבלה הקיימת ─── */
  function toRow(c) {
    var f = (c.data && c.data.staticFields) || {};
    return {
      tik:      c.case_number || f['f-tik'] || (c.id || '').slice(0, 8),
      plate:    c.plate || f['f-plate'] || '',
      client:   c.client_name || f['f-client'] || f['f-owner'] || '',
      model:    f['f-model'] || f['f-vehicle'] || '',
      date:     fmtDate(c.updated_at || c.created_at),
      status:   CLOUD_TO_UI[c.status] || 'open',
      amount:   c.damage_total || 0,
      type:     c.form_type || (c.data && c.data.formType) || 'car',
      claimNo:  f['f-claimno'] || '',
      hasEstimate: !!f['f-8'],
      _cloudId: c.id,
      _cloud:   c
    };
  }

  /* ─── משיכת התיקים מהענן אל תוך המערך DB שהממשק קורא ממנו ─── */
  async function refreshDB(silent) {
    if (!active || refreshing) return;
    refreshing = true;
    try {
      var rows = await API.listCases();
      var mapped = rows.map(toRow);
      mapped.sort(function (a, b) { return (b._cloud.updated_at || '').localeCompare(a._cloud.updated_at || ''); });

      caseIdByTik = {};
      mapped.forEach(function (r) { if (r.tik) caseIdByTik[r.tik] = r._cloudId; });

      global.DB.length = 0;                       // החלפה במקום — שומר על ההפניה
      Array.prototype.push.apply(global.DB, mapped);

      if (!silent) rerender();
    } catch (e) {
      console.warn('[Bridge] רענון רשימת התיקים נכשל', e);
    } finally {
      refreshing = false;
    }
  }

  function rerender() {
    try {
      if (global.currentPageId === 'claims' && typeof global.applyClaimsFilters === 'function') global.applyClaimsFilters();
      if (global.currentPageId === 'dashboard' && typeof global.renderDashRecent === 'function') global.renderDashRecent();
    } catch (e) { /* המסך עוד לא נבנה */ }
  }

  /* ─── איסוף התיק הנוכחי מהטופס ודחיפה לענן ─── */
  async function pushCurrentForm(status) {
    if (!active) return null;
    var draft = typeof global.serializeDraft === 'function' ? null : null;
    var raw = null;
    try {
      if (typeof global.saveDraftNow === 'function') global.__origSaveDraftNow ? global.__origSaveDraftNow() : global.saveDraftNow();
      raw = JSON.parse(localStorage.getItem('estimax_draft_v1'));
    } catch (e) { /* אין טיוטה */ }
    if (!raw) return null;

    var tik = gv('f-tik');
    if (!activeCaseId && tik && caseIdByTik[tik]) activeCaseId = caseIdByTik[tik];

    var rec = await API.saveCase({
      id: activeCaseId,
      data: raw,
      status: status || 'in_progress',
      damage_total: num(gv('f-value')),
      depreciation: num(gv('f-8'))
    });
    activeCaseId = rec.id;
    if (tik) caseIdByTik[tik] = rec.id;
    return rec;
  }

  /* ─── dataURL → Blob (להעלאת תמונות ל-Storage) ─── */
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ══════════════════════════════════════════════════════════
     עטיפת הפונקציות הקיימות
     ══════════════════════════════════════════════════════════ */
  function install() {
    if (attached) return;
    attached = true;

    /* 1. רשימת התיקים — מושכת מהענן בכל כניסה למסך */
    if (typeof global.renderClaims === 'function') {
      var origClaims = global.renderClaims;
      global.renderClaims = function () {
        origClaims.apply(this, arguments);
        refreshDB();
      };
    }
    if (typeof global.renderDashRecent === 'function') {
      var origDash = global.renderDashRecent;
      global.renderDashRecent = function () {
        origDash.apply(this, arguments);
        refreshDB();
      };
    }

    /* 2. פתיחת תיק קיים — שחזור מלא של הטופס מהענן */
    if (typeof global.openExistingTik === 'function') {
      var origOpen = global.openExistingTik;
      global.openExistingTik = function (tik) {
        var rec = global.DB.find(function (r) { return r.tik === tik; });

        if (active && rec && rec._cloud && rec._cloud.data &&
            rec._cloud.data.staticFields && Object.keys(rec._cloud.data.staticFields).length) {
          activeCaseId = rec._cloudId;
          global.currentRecord = rec;
          try {
            global.restoreDraft(JSON.parse(JSON.stringify(rec._cloud.data)));
            loadCloudPhotos(rec._cloudId, rec.tik);
            return;
          } catch (e) {
            console.warn('[Bridge] שחזור מהענן נכשל — נפתח במצב רגיל', e);
          }
        }
        activeCaseId = rec ? rec._cloudId || null : null;
        return origOpen.apply(this, arguments);
      };
    }

    /* 3. תיק חדש — מאפסים את מזהה הענן */
    if (typeof global.openForm === 'function') {
      var origForm = global.openForm;
      global.openForm = function (type, isExisting) {
        if (!isExisting) activeCaseId = null;
        return origForm.apply(this, arguments);
      };
    }

    /* 4. תמונות נזק — העלאה ל-Storage במקביל לתצוגה המקומית */
    if (typeof global.addPhotos === 'function') {
      var origPhotos = global.addPhotos;
      global.addPhotos = function (files) {
        origPhotos.apply(this, arguments);
        if (!active || !files || !files.length) return;

        pushCurrentForm('in_progress').then(function (rec) {
          if (!rec) return;
          Array.prototype.forEach.call(files, function (file) {
            API.uploadImage(rec.id, file, file.name)
              .then(function () { console.log('[Bridge] תמונה הועלתה לענן:', file.name); })
              .catch(function (e) { console.warn('[Bridge] העלאת תמונה נכשלה', file.name, e); });
          });
        });
      };
    }

    /* 5. הפקת דוח — סימון התיק כהושלם + העלאת ה-PDF */
    if (typeof global.autoSavePDF === 'function') {
      var origPdf = global.autoSavePDF;
      global.autoSavePDF = function () {
        var r = origPdf.apply(this, arguments);
        if (active) {
          pushCurrentForm('completed')
            .then(function () { refreshDB(); })
            .catch(function (e) { console.warn('[Bridge] סימון התיק כהושלם נכשל', e); });
        }
        return r;
      };
    }

    /* 6. שמירה אוטומטית של הטופס → ענן (מקסימום פעם ב-8 שניות) */
    if (typeof global.saveDraftNow === 'function') {
      global.__origSaveDraftNow = global.saveDraftNow;
      var timer = null;
      global.saveDraftNow = function () {
        global.__origSaveDraftNow.apply(this, arguments);
        if (!active) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          pushCurrentForm('in_progress').catch(function (e) {
            console.warn('[Bridge] שמירה אוטומטית לענן נכשלה', e);
          });
        }, 8000);
      };
    }

    /* 7. יציאה מהטופס — דחיפה מיידית, בלי להמתין ל-8 שניות */
    global.addEventListener('beforeunload', function () {
      if (active) { try { pushCurrentForm('in_progress'); } catch (e) {} }
    });
    document.addEventListener('visibilitychange', function () {
      if (active && document.visibilityState === 'hidden') {
        try { pushCurrentForm('in_progress'); } catch (e) {}
      }
    });
  }

  /* ─── טעינת תמונות התיק מהענן לגלריה הקיימת ─── */
  async function loadCloudPhotos(caseId, tik) {
    if (!active) return;
    try {
      var imgs = await API.listImages(caseId);
      if (!imgs.length) return;
      global.tikPhotos = global.tikPhotos || {};
      global.tikPhotos[tik] = imgs.filter(function (i) { return i.url; })
                                  .map(function (i) { return { name: i.caption || 'תמונה', src: i.url }; });
      if (typeof global.renderPhotoGallery === 'function') global.renderPhotoGallery();
    } catch (e) {
      console.warn('[Bridge] טעינת תמונות מהענן נכשלה', e);
    }
  }

  /* ══════════════════════════════════════════════════════════
     הפעלה
     ══════════════════════════════════════════════════════════ */
  function attach(api, isActive) {
    API = api;
    active = !!isActive;
    install();
    if (!active) {
      console.warn('[Bridge] מצב הדגמה — הרשימה מציגה נתוני דמו מקומיים.');
      return;
    }
    // תיק שנשמר במכשיר אחר / באתר — מתעדכן מיד
    API.on('case:remote', function () { refreshDB(); });
    API.on('sync:pulled', function () { refreshDB(); });
    API.on('auth', function (e) { if (e.user) refreshDB(); });
    if (API.getUser()) refreshDB();
  }

  global.EstimaxBridge = {
    attach: attach,
    refresh: refreshDB,
    currentCaseId: function () { return activeCaseId; },
    push: pushCurrentForm,
    _toRow: toRow,
    _dataUrlToBlob: dataUrlToBlob
  };
})(window);
