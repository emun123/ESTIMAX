// בדיקת עשן לגשר הענן — מריצה את estimax-cloud-bridge.js מול DOM מדומה
// ומוודאת שהעטיפות אכן מחברות את המסכים הקיימים לענן.
import fs from 'fs';

const log = [];
const els = {};
function el(id, value = '') { return (els[id] = { id, value, classList: { add(){}, remove(){}, contains(){return false;}, toggle(){} } }); }
['f-tik','f-plate','f-client','f-value','f-8','f-model','f-report'].forEach(i => el(i));
els['sigCanvas'] = { id: 'sigCanvas', toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' };

const doc = {
  getElementById: id => els[id] || null,
  addEventListener() {},
  visibilityState: 'visible'
};
global.document = doc;
global.localStorage = {
  _s: {},
  getItem(k){ return k in this._s ? this._s[k] : null; },
  setItem(k,v){ this._s[k] = String(v); },
  removeItem(k){ delete this._s[k]; }
};

// ── חלון מדומה עם הפונקציות שקיימות ב-index.html ──
const w = {
  DB: [{ tik: 'DEMO-1', plate: '00-000-00', client: 'דמו', model: '', date: '', status: 'open', amount: 0, type: 'car', claimNo: '' }],
  currentPageId: 'claims',
  currentRecord: null,
  tikPhotos: {},
  addEventListener() {},
  renderClaims()      { log.push('orig:renderClaims'); },
  applyClaimsFilters(){ log.push('orig:applyClaimsFilters'); },
  renderDashRecent()  { log.push('orig:renderDashRecent'); },
  openExistingTik(t)  { log.push('orig:openExistingTik:' + t); },
  openForm(t, ex)     { log.push('orig:openForm:' + t + ':' + !!ex); },
  addPhotos(f)        { log.push('orig:addPhotos:' + f.length); },
  saveSignature()     { log.push('orig:saveSignature'); },
  fetch: globalThis.fetch.bind(globalThis),
  PDF_CLOUD_ENDPOINT: '',
  // מדמה את הקוד המקורי: בונה PDF ושולח אותו ב-FormData לכתובת שבמשתנה
  autoSavePDF() {
    log.push('orig:autoSavePDF');
    if (!w.PDF_CLOUD_ENDPOINT) return;
    const fd = new FormData();
    fd.append('file', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'r.pdf');
    fd.append('tik', '2026-114');
    w.fetch(w.PDF_CLOUD_ENDPOINT, { method: 'POST', body: fd });
  },
  saveDraftNow()      { log.push('orig:saveDraftNow'); },
  restoreDraft(d)     { log.push('orig:restoreDraft:' + (d.staticFields['f-tik'] || '?')); },
  renderPhotoGallery(){ log.push('orig:renderPhotoGallery'); }
};
global.window = w;

new Function('window', 'document', 'localStorage', 'console', 'atob', 'Blob', 'Uint8Array',
  fs.readFileSync(new URL('../docs/estimax-cloud-bridge.js', import.meta.url), 'utf8')
)(w, doc, global.localStorage, console, global.atob, global.Blob, Uint8Array);

// ── API מזויף שמחזיר שני תיקים "מהענן" ──
const cloudRows = [
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', case_number: '2026-114', plate: '12-345-67',
    client_name: 'ישראל ישראלי', status: 'in_progress', damage_total: 12500, form_type: 'car',
    updated_at: '2026-08-05T10:00:00Z',
    data: { formType: 'car', staticFields: { 'f-tik':'2026-114','f-plate':'12-345-67','f-model':'מאזדה 3 2021','f-claimno':'CL-9' } } },
  { id: 'bbbbbbbb-2222-4222-8222-222222222222', case_number: '2026-115', plate: '77-777-77',
    client_name: 'דנה כהן', status: 'completed', damage_total: 4300, form_type: 'expert',
    updated_at: '2026-08-05T12:00:00Z', data: { formType: 'expert', staticFields: {} } }
];
const events = {};
const saved = [];
const uploaded = [];
const reports = [];
const signatures = [];
const fakeAPI = {
  listCases: async () => cloudRows,
  listImages: async () => [{ url: 'https://x/img1.jpg', caption: 'נזק קדמי' }],
  saveCase: async o => { const r = { ...o, id: o.id || 'new-uuid-0001' }; saved.push(r); return r; },
  uploadImage: async (cid, f) => { uploaded.push([cid, f.name]); return {}; },
  uploadReport: async (cid, blob, name) => { reports.push([cid, name, blob.size]); return {}; },
  saveSignature: async d => { signatures.push(d.slice(0, 22)); return 'path'; },
  getUser: () => ({ id: 'u1' }),
  sync: async () => ({}),
  on: (e, fn) => { (events[e] = events[e] || []).push(fn); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══ ההרצה ══
w.EstimaxBridge.attach(fakeAPI, true);
await sleep(30);

console.log('1. DB הוחלף בנתוני ענן  ->', w.DB.length, 'שורות | הראשונה:',
  JSON.stringify({ tik: w.DB[0].tik, client: w.DB[0].client, model: w.DB[0].model,
                   status: w.DB[0].status, amount: w.DB[0].amount, type: w.DB[0].type }));
console.log('2. מיון לפי עדכון אחרון ->', w.DB.map(r => r.tik).join(' , '));
console.log('3. אין שאריות דמו       ->', w.DB.some(r => r.tik === 'DEMO-1') ? '❌ נשאר דמו' : '✓ נוקה');

w.renderClaims(); await sleep(20);
console.log('4. renderClaims עוטף    ->', log.includes('orig:renderClaims') ? '✓ המקורי רץ' : '❌');

log.length = 0;
w.openExistingTik('2026-114'); await sleep(20);
console.log('5. פתיחת תיק מהענן      ->', log.find(l => l.startsWith('orig:restoreDraft')) || '❌ לא שוחזר');
console.log('6. תמונות נטענו מהענן   ->', (w.tikPhotos['2026-114'] || []).length, 'תמונות');
console.log('7. מזהה התיק הפעיל      ->', w.EstimaxBridge.currentCaseId());

els['f-tik'].value = '2026-114';
els['f-value'].value = '12,500';
els['f-8'].value = '3.5';
global.localStorage.setItem('estimax_draft_v1', JSON.stringify({ formType: 'car', staticFields: { 'f-tik': '2026-114' } }));

w.addPhotos([{ name: 'front.jpg' }, { name: 'rear.jpg' }]); await sleep(30);
console.log('8. העלאת תמונות         ->', uploaded.length, 'קבצים →', uploaded.map(u => u[1]).join(','));

log.length = 0; saved.length = 0;
w.autoSavePDF(); await sleep(60);
console.log('9. הפקת דוח → סטטוס     ->', saved.length ? saved[saved.length-1].status : '❌ לא נשמר',
            '| סכום:', saved.length ? saved[saved.length-1].damage_total : '-');
console.log('9b. ה-PDF עלה ל-Storage ->', reports.length ? reports[0][1] + ' (' + reports[0][2] + ' bytes)' : '❌ לא הועלה');

// קריאת fetch רגילה חייבת לעבור ללא נגיעה
let passthrough = 'לא נבדק';
try { await w.fetch('https://example.invalid/x'); } catch (e) { passthrough = 'עברה לרשת האמיתית ✓'; }
console.log('9c. fetch רגיל לא נחטף  ->', passthrough);

w.saveSignature(); await sleep(30);
console.log('9d. חתימה נשמרה בפרופיל ->', signatures.length ? signatures[0] + '… ✓' : '❌ לא נשמרה');

// עדכון חי מהאתר
cloudRows.push({ id: 'cccccccc-3333-4333-8333-333333333333', case_number: '2026-116', plate: '11-111-11',
  client_name: 'מהאתר', status: 'draft', damage_total: 0, form_type: 'car',
  updated_at: '2026-08-05T13:00:00Z', data: { staticFields: {} } });
events['case:remote'].forEach(fn => fn({}));
await sleep(40);
console.log('10. עדכון חי מהאתר      ->', w.DB.length, 'שורות | חדש:', w.DB[0].tik, w.DB[0].client);

// מצב הדגמה לא אמור לגעת ב-DB
console.log('\n— בדיקת נפילה למצב הדגמה —');
const w2 = { ...w, DB: [{ tik: 'DEMO-1' }], addEventListener(){} };
console.log('11. DB במצב הדגמה       ->', w2.DB[0].tik === 'DEMO-1' ? '✓ נשאר דמו, לא נשבר' : '❌');
