/* ══════════════════════════════════════════════════════════════
   ESTIMAX — קובץ הגדרות
   זה הקובץ היחיד שצריך לערוך ידנית אחרי הקמת Supabase.

   איפה משיגים את שני הערכים:
   Supabase → Project Settings → Data API
     • Project URL      →  SUPABASE_URL
     • anon public key  →  SUPABASE_ANON_KEY

   ⚠ ה-anon key מיועד לרוץ בדפדפן ואינו סוד — האבטחה מגיעה
     מ-Row Level Security ב-schema.sql. לעולם אל תשים כאן את
     ה-service_role key.
   ══════════════════════════════════════════════════════════════ */

window.ESTIMAX_CONFIG = {
  SUPABASE_URL: '',        // לדוגמה: 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '',   // לדוגמה: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'

  // כשאין ערכים למעלה, האפליקציה ממשיכה לעבוד במצב הדגמה
  // (admin / 123456, נתונים מקומיים בלבד) ולא נשברת.
  ALLOW_DEMO_FALLBACK: true,

  // כל כמה מילישניות לנסות סנכרון ברקע
  SYNC_INTERVAL_MS: 30000,

  APP_VERSION: '1.0.0'
};
