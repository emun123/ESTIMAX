/* ══════════════════════════════════════════════════════════════
   ESTIMAX — שכבת נתונים וסנכרון
   ──────────────────────────────────────────────────────────────
   מה זה עושה:
     • התחברות אמיתית מול Supabase Auth (במקום admin/123456)
     • שמירת תיקי שמאות בענן — האתר והאפליקציה רואים אותו מידע
     • עבודה אופליין: מה שנשמר בלי רשת נכנס לתור ונשלח כשחוזרת
     • עדכון חי (Realtime) — תיק שנשמר בטלפון מופיע באתר מיד

   שימוש בסיסי:
     await EstimaxAPI.init();
     await EstimaxAPI.login('me@estimax.co.il','••••••');
     await EstimaxAPI.saveCase({ id, plate, data });
     const cases = await EstimaxAPI.listCases();

   אם estimax-config.js ריק — הכל עובד במצב הדגמה מקומי,
   בלי לשבור את האתר הקיים.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var CFG        = global.ESTIMAX_CONFIG || {};
  var SDK_URL    = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  var LS_QUEUE   = 'estimax_sync_queue_v1';
  var LS_CACHE   = 'estimax_cases_cache_v1';
  var LS_DEVICE  = 'estimax_device_id_v1';
  var LS_PULLED  = 'estimax_last_pull_v1';

  var sb = null;             // לקוח Supabase
  var currentUser = null;
  var currentProfile = null;
  var demoMode = true;
  var syncTimer = null;
  var listeners = {};        // { event: [fn,...] }

  /* ─── עזרי אחסון מקומי ─── */
  function lsGet(k, fallback) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.warn('[Estimax] אחסון מקומי מלא', e); return false; }
  }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function deviceId() {
    var id = lsGet(LS_DEVICE, null);
    if (!id) { id = uuid(); lsSet(LS_DEVICE, id); }
    return id;
  }

  /* ─── אירועים ─── */
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[Estimax] listener', e); }
    });
  }

  /* ══════════════ אתחול ══════════════ */
  async function init() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      demoMode = true;
      console.warn('[Estimax] מצב הדגמה — estimax-config.js עדיין ריק. הנתונים נשמרים מקומית בלבד.');
      emit('mode', { demo: true });
      return { demo: true };
    }
    try {
      var mod = await import(SDK_URL);
      sb = mod.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'estimax_session_v1' }
      });
      demoMode = false;

      var res = await sb.auth.getSession();
      if (res.data && res.data.session) {
        currentUser = res.data.session.user;
        await loadProfile();
        startSync();
      }

      sb.auth.onAuthStateChange(function (event, session) {
        currentUser = session ? session.user : null;
        if (!currentUser) { stopSync(); currentProfile = null; }
        emit('auth', { user: currentUser, event: event });
      });

      global.addEventListener('online', function () { sync(); });
      emit('mode', { demo: false });
      return { demo: false };

    } catch (e) {
      console.error('[Estimax] טעינת Supabase נכשלה — עובר למצב הדגמה', e);
      demoMode = true;
      emit('mode', { demo: true, error: e });
      return { demo: true, error: e };
    }
  }

  /* ══════════════ התחברות ══════════════ */
  async function login(email, password) {
    if (demoMode) {
      if (!CFG.ALLOW_DEMO_FALLBACK) throw new Error('המערכת אינה מחוברת לשרת');
      if (email === 'admin' && password === '123456') {
        currentUser = { id: 'demo-user', email: 'admin@estimax.co.il' };
        currentProfile = { full_name: 'משה כהן', role: 'appraiser' };
        lsSet('estimax_user_v1', { username: 'admin', role: 'Anatoli_Appraiser', name: 'משה כהן' });
        emit('auth', { user: currentUser, event: 'DEMO_SIGNED_IN' });
        return currentUser;
      }
      throw new Error('שם משתמש או סיסמה שגויים');
    }

    var r = await sb.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw new Error(translateAuthError(r.error.message));
    currentUser = r.data.user;
    await loadProfile();
    startSync();
    await sync();
    return currentUser;
  }

  async function logout() {
    stopSync();
    if (!demoMode && sb) await sb.auth.signOut();
    localStorage.removeItem('estimax_user_v1');
    currentUser = null;
    currentProfile = null;
  }

  async function resetPassword(email) {
    if (demoMode) throw new Error('שחזור סיסמה זמין רק כשהמערכת מחוברת לשרת');
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (r.error) throw new Error(r.error.message);
    return true;
  }

  async function loadProfile() {
    if (demoMode || !currentUser) return null;
    var r = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    currentProfile = r.data || null;
    return currentProfile;
  }

  function translateAuthError(msg) {
    if (/Invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
    if (/Email not confirmed/i.test(msg))       return 'המייל טרם אומת — בדוק את תיבת הדואר';
    if (/rate limit/i.test(msg))                return 'יותר מדי ניסיונות. נסה שוב בעוד דקה';
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'אין חיבור לשרת — בדוק את האינטרנט';
    return msg;
  }

  function getUser()    { return currentUser; }
  function getProfile() { return currentProfile; }
  function isDemo()     { return demoMode; }
  function isOnline()   { return navigator.onLine !== false; }

  /* ══════════════ תיקי שמאות ══════════════ */

  // שדות שנשלפים מתוך ה-JSON כדי לאפשר חיפוש ומיון
  function extractFields(c) {
    var d = c.data || {};
    var f = d.staticFields || {};
    function num(v) {
      if (v == null || v === '') return null;
      var n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
      return isNaN(n) ? null : n;
    }
    return {
      case_number:  c.case_number  || f['f-tik']    || null,   // מספר תיק
      plate:        c.plate        || f['f-plate']  || null,   // מספר רישוי
      form_type:    c.form_type    || d.formType    || null,   // סוג חוות דעת
      client_name:  c.client_name  || f['f-owner']  || f['f-client'] || null,
      insurer:      c.insurer      || f['f-ins']    || null,   // חברת ביטוח
      status:       c.status       || 'draft',
      damage_total: c.damage_total != null ? c.damage_total : num(f['f-value']),
      depreciation: c.depreciation != null ? c.depreciation : num(f['f-8'])
    };
  }

  /**
   * שמירת תיק. עובד גם בלי רשת — נכנס לתור ונשלח אוטומטית.
   * מחזיר את התיק עם ה-id שלו מיד, בלי להמתין לשרת.
   */
  async function saveCase(caseObj) {
    var rec = Object.assign({}, caseObj);
    if (!rec.id) rec.id = uuid();
    rec.device_id  = deviceId();
    rec.updated_at = new Date().toISOString();
    Object.assign(rec, extractFields(rec));

    // 1. תמיד שומרים מקומית קודם — המשתמש לא מאבד עבודה
    var cache = lsGet(LS_CACHE, {});
    cache[rec.id] = rec;
    lsSet(LS_CACHE, cache);
    emit('case:saved', rec);

    // 2. מנסים לשלוח לשרת
    if (demoMode || !currentUser) return rec;
    if (!isOnline()) { enqueue(rec); return rec; }

    try {
      await pushCase(rec);
    } catch (e) {
      console.warn('[Estimax] שמירה בשרת נכשלה — נכנס לתור', e);
      enqueue(rec);
    }
    return rec;
  }

  async function pushCase(rec) {
    var row = {
      id: rec.id,
      owner_id: currentUser.id,
      case_number: rec.case_number, plate: rec.plate, form_type: rec.form_type,
      client_name: rec.client_name, insurer: rec.insurer, status: rec.status,
      damage_total: rec.damage_total, depreciation: rec.depreciation,
      data: rec.data || {}, device_id: rec.device_id,
      deleted_at: rec.deleted_at || null
    };
    var r = await sb.from('cases').upsert(row, { onConflict: 'id' }).select().single();
    if (r.error) throw r.error;
    var cache = lsGet(LS_CACHE, {});
    cache[r.data.id] = r.data;
    lsSet(LS_CACHE, cache);
    return r.data;
  }

  async function listCases(opts) {
    opts = opts || {};
    if (demoMode || !currentUser) {
      return Object.values(lsGet(LS_CACHE, {}))
        .filter(function (c) { return !c.deleted_at; })
        .sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
    }
    var q = sb.from('cases').select('*').is('deleted_at', null).order('updated_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.limit)  q = q.limit(opts.limit);

    var r = await q;
    if (r.error) {                                    // אין רשת — מגישים מהמטמון
      console.warn('[Estimax] שליפה מהשרת נכשלה, מגיש מטמון מקומי', r.error);
      return Object.values(lsGet(LS_CACHE, {})).filter(function (c) { return !c.deleted_at; });
    }
    var cache = {};
    r.data.forEach(function (c) { cache[c.id] = c; });
    lsSet(LS_CACHE, cache);
    return r.data;
  }

  async function getCase(id) {
    var cache = lsGet(LS_CACHE, {});
    if (demoMode || !currentUser) return cache[id] || null;
    var r = await sb.from('cases').select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data) return cache[id] || null;
    cache[id] = r.data; lsSet(LS_CACHE, cache);
    return r.data;
  }

  // מחיקה רכה — כדי שהמחיקה תסונכרן לשאר המכשירים
  async function deleteCase(id) {
    var cache = lsGet(LS_CACHE, {});
    var rec = cache[id] || { id: id };
    rec.deleted_at = new Date().toISOString();
    cache[id] = rec; lsSet(LS_CACHE, cache);
    if (demoMode || !currentUser) return true;
    try { await pushCase(rec); } catch (e) { enqueue(rec); }
    emit('case:deleted', { id: id });
    return true;
  }

  /* ══════════════ תמונות נזק ══════════════ */
  async function uploadImage(caseId, file, caption) {
    if (demoMode || !currentUser) throw new Error('העלאת תמונות דורשת חיבור לשרת');
    var ext  = (file.name || 'jpg').split('.').pop().toLowerCase();
    var path = currentUser.id + '/' + caseId + '/' + uuid() + '.' + ext;

    var up = await sb.storage.from('case-images').upload(path, file, { upsert: false, contentType: file.type });
    if (up.error) throw up.error;

    var r = await sb.from('case_images').insert({
      case_id: caseId, owner_id: currentUser.id, storage_path: path, caption: caption || null
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function listImages(caseId) {
    if (demoMode || !currentUser) return [];
    var r = await sb.from('case_images').select('*').eq('case_id', caseId).order('sort_order');
    if (r.error) return [];
    // כתובות זמניות לצפייה (הבאקט פרטי)
    for (var i = 0; i < r.data.length; i++) {
      var s = await sb.storage.from('case-images').createSignedUrl(r.data[i].storage_path, 3600);
      r.data[i].url = s.data ? s.data.signedUrl : null;
    }
    return r.data;
  }

  /* ══════════════ דוחות מופקים (PDF) ══════════════ */
  async function uploadReport(caseId, blob, filename, reportType) {
    if (demoMode || !currentUser) throw new Error('שמירת דוח בענן דורשת חיבור לשרת');
    var path = currentUser.id + '/' + caseId + '/' + Date.now() + '-' + (filename || 'report.pdf');

    var up = await sb.storage.from('reports').upload(path, blob, {
      upsert: false, contentType: 'application/pdf'
    });
    if (up.error) throw up.error;

    var r = await sb.from('reports').insert({
      case_id: caseId, owner_id: currentUser.id,
      storage_path: path, report_type: reportType || null
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function listReports(caseId) {
    if (demoMode || !currentUser) return [];
    var r = await sb.from('reports').select('*').eq('case_id', caseId).order('issued_at', { ascending: false });
    if (r.error) return [];
    for (var i = 0; i < r.data.length; i++) {
      var s = await sb.storage.from('reports').createSignedUrl(r.data[i].storage_path, 3600);
      r.data[i].url = s.data ? s.data.signedUrl : null;
    }
    return r.data;
  }

  /* ══════════════ פרופיל וחתימה דיגיטלית ══════════════ */
  async function updateProfile(fields) {
    if (demoMode || !currentUser) throw new Error('עדכון פרופיל דורש חיבור לשרת');
    var r = await sb.from('profiles').update(fields).eq('id', currentUser.id).select().single();
    if (r.error) throw new Error(r.error.message);
    currentProfile = r.data;
    emit('profile', currentProfile);
    return currentProfile;
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // החתימה נשמרת תחת <uid>/_signature/ — נופל תחת אותה מדיניות RLS
  // של הבאקט case-images, ולכן אינו דורש שינוי בסכמה.
  async function saveSignature(dataUrl) {
    if (demoMode || !currentUser) throw new Error('שמירת חתימה דורשת חיבור לשרת');
    var path = currentUser.id + '/_signature/signature.png';
    var up = await sb.storage.from('case-images').upload(path, dataUrlToBlob(dataUrl), {
      upsert: true, contentType: 'image/png'
    });
    if (up.error) throw up.error;
    await updateProfile({ signature_url: path });
    return path;
  }

  async function getSignatureUrl() {
    if (demoMode || !currentUser || !currentProfile || !currentProfile.signature_url) return null;
    var s = await sb.storage.from('case-images').createSignedUrl(currentProfile.signature_url, 3600);
    return s.data ? s.data.signedUrl : null;
  }

  /* ══════════════ תור אופליין + סנכרון ══════════════ */
  function enqueue(rec) {
    var q = lsGet(LS_QUEUE, []);
    q = q.filter(function (x) { return x.id !== rec.id; });   // רק הגרסה האחרונה
    q.push(rec);
    lsSet(LS_QUEUE, q);
    emit('queue', { pending: q.length });
  }

  function pendingCount() { return lsGet(LS_QUEUE, []).length; }

  async function sync() {
    if (demoMode || !currentUser || !isOnline()) return { skipped: true };
    var q = lsGet(LS_QUEUE, []);
    var failed = [];

    for (var i = 0; i < q.length; i++) {
      try { await pushCase(q[i]); }
      catch (e) { failed.push(q[i]); }
    }
    lsSet(LS_QUEUE, failed);

    // משיכה: כל מה שהשתנה מאז הסנכרון האחרון (כולל שינויים מהאתר)
    var since = lsGet(LS_PULLED, '1970-01-01T00:00:00Z');
    var r = await sb.from('cases').select('*').gt('updated_at', since).order('updated_at');
    if (!r.error && r.data) {
      var cache = lsGet(LS_CACHE, {});
      r.data.forEach(function (c) { cache[c.id] = c; });
      lsSet(LS_CACHE, cache);
      if (r.data.length) {
        lsSet(LS_PULLED, r.data[r.data.length - 1].updated_at);
        emit('sync:pulled', { count: r.data.length });
      }
    }
    emit('sync:done', { pushed: q.length - failed.length, pending: failed.length });
    return { pushed: q.length - failed.length, pending: failed.length };
  }

  function startSync() {
    stopSync();
    syncTimer = setInterval(sync, CFG.SYNC_INTERVAL_MS || 30000);

    // עדכון חי — שינוי באתר מופיע באפליקציה מיד
    if (sb && currentUser) {
      sb.channel('cases-live')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'cases', filter: 'owner_id=eq.' + currentUser.id },
            function (payload) {
              var rec = payload.new || payload.old;
              if (!rec) return;
              if (rec.device_id === deviceId()) return;   // זה אנחנו — לא צריך להגיב
              var cache = lsGet(LS_CACHE, {});
              cache[rec.id] = rec;
              lsSet(LS_CACHE, cache);
              emit('case:remote', rec);
            })
        .subscribe();
    }
  }
  function stopSync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (sb) { try { sb.removeAllChannels(); } catch (e) {} }
  }

  /* ─── ייצוא ─── */
  global.EstimaxAPI = {
    init: init,
    login: login, logout: logout, resetPassword: resetPassword,
    getUser: getUser, getProfile: getProfile, isDemo: isDemo, isOnline: isOnline,
    saveCase: saveCase, listCases: listCases, getCase: getCase, deleteCase: deleteCase,
    uploadImage: uploadImage, listImages: listImages,
    uploadReport: uploadReport, listReports: listReports,
    updateProfile: updateProfile, loadProfile: loadProfile,
    saveSignature: saveSignature, getSignatureUrl: getSignatureUrl,
    sync: sync, pendingCount: pendingCount,
    on: on,
    _deviceId: deviceId
  };
})(window);
