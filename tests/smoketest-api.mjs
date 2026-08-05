// בדיקת עשן לשכבת הנתונים במצב הדגמה (לא נדרש לפריסה — אפשר למחוק)
import fs from 'fs';
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const nav = { onLine: true };
const w = {
  ESTIMAX_CONFIG: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ALLOW_DEMO_FALLBACK: true },
  addEventListener() {}, localStorage: global.localStorage, crypto: globalThis.crypto
};
global.window = w;

const src = fs.readFileSync(new URL('../docs/estimax-api.js', import.meta.url), 'utf8');
new Function('window', 'navigator', 'localStorage', 'console', src)(w, nav, global.localStorage, console);

const API = w.EstimaxAPI;
console.log('init            ->', await API.init());
console.log('bad login       ->', await API.login('x', 'y').catch(e => 'rejected: ' + e.message));
console.log('good login      ->', (await API.login('admin', '123456')).email);

const rec = await API.saveCase({
  data: { formType: 'חוות דעת מלאה', staticFields: {
    'f-tik': '2026-114', 'f-plate': '12-345-67', 'f-owner': 'ישראל ישראלי',
    'f-ins': 'הראל', 'f-value': '12,500', 'f-8': '3.5'
  } }
});
console.log('extracted       ->', {
  case_number: rec.case_number, plate: rec.plate, client: rec.client_name,
  insurer: rec.insurer, total: rec.damage_total, depreciation: rec.depreciation
});
console.log('listCases       ->', (await API.listCases()).length);
await API.deleteCase(rec.id);
console.log('after delete    ->', (await API.listCases()).length);
console.log('pending queue   ->', API.pendingCount());
