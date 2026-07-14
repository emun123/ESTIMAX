/**
 * anatoli-backend-starter.js
 * -----------------------------------------------------------------------
 * נקודת קצה (API) לדוגמה שמקבלת תמונות רכב + מספר תיק מ-shamai-pro.html
 * ומחזירה ניתוח (נזקים / חלקים / המלצה).
 *
 * למה Firebase? זו הדרך הכי מהירה להקים "שרת" בלי לנהל מכונה בעצמך:
 *   - Cloud Functions  = הקוד שרץ בענן (הקובץ הזה)
 *   - Cloud Storage    = שמירת התמונות בענן
 *   - Firestore        = שמירת תוצאות הניתוח לפי מספר תיק
 * יש שכבה חינמית שמספיקה לשלב הזה.
 *
 * התקנה (חד-פעמי):
 *   1. npm install -g firebase-tools
 *   2. firebase login
 *   3. firebase init functions   (ולבחור פרויקט / ליצור חדש ב-console.firebase.google.com)
 *   4. להעתיק את הקובץ הזה ל- functions/index.js
 *   5. firebase deploy --only functions
 *   6. להעתיק את ה-URL שיוחזר (https://REGION-PROJECT.cloudfunctions.net/analyzeCarPhotos)
 *      אל המשתנה ANATOLI_API_ENDPOINT בראש ה-<script> של shamai-pro.html
 *
 * הערה: הפונקציה כאן מחזירה תשובה לדוגמה (placeholder).
 * כדי שאנטולי *באמת* ינתח את התמונות, יש להחליף את analyzeWithAnatoli()
 * בקריאה בפועל למנוע הניתוח (למשל מודל Vision, או קריאה ל-API של Claude
 * עם הנחיות השמאות של אנטולי).
 * -----------------------------------------------------------------------
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// תפקידים מורשים לשלוח תמונות לניתוח
const ALLOWED_ROLES = ['Anatoli_Appraiser'];

exports.analyzeCarPhotos = functions.https.onRequest(async (req, res) => {
  // CORS בסיסי — כדי שהקריאה מהדפדפן (מה-HTML) תעבוד
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const { tik, role, photos } = req.body || {};

    if (!ALLOWED_ROLES.includes(role)) {
      res.status(403).json({ error: 'אין הרשאה — נדרש תפקיד Anatoli_Appraiser' });
      return;
    }
    if (!tik || !Array.isArray(photos) || photos.length === 0) {
      res.status(400).json({ error: 'חסר מספר תיק או תמונות' });
      return;
    }

    // 1. שמירת התמונות בענן (Cloud Storage), מקושרות למספר התיק
    const savedUrls = [];
    for (let i = 0; i < photos.length; i++) {
      const base64 = photos[i].split(',')[1]; // מסירים את ה-prefix data:image/...;base64,
      const buffer = Buffer.from(base64, 'base64');
      const file = bucket.file(`cases/${tik}/photo_${Date.now()}_${i}.jpg`);
      await file.save(buffer, { metadata: { contentType: 'image/jpeg' } });
      savedUrls.push(file.name);
    }

    // 2. ניתוח בפועל — כאן מתחברים למנוע האמיתי של אנטולי
    const result = await analyzeWithAnatoli(tik, savedUrls);

    // 3. שמירת תוצאת הניתוח ב-Firestore, לפי מספר תיק
    await db.collection('cases').doc(tik).set({
      photos: savedUrls,
      lastAnalysis: result,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת בניתוח התמונות' });
  }
});

/**
 * TODO: להחליף את הפונקציה הזו בקריאה אמיתית למנוע הניתוח של אנטולי
 * (למשל מודל Vision, או קריאה מאובטחת ל-Claude API עם הנחיות השמאות).
 * כרגע היא מחזירה נתוני דוגמה בלבד.
 */
async function analyzeWithAnatoli(tik, photoPaths) {
  return {
    damages: ['שריטה עמוקה בדלת ימין קדמית', 'שבר בפנס קדמי שמאל'],
    parts: ['דלת קדמית ימין — תיקון פחחות', 'פנס קדמי שמאל — החלפה'],
    recommendation: 'מומלץ תיקון (לא אובדן) — עלות משוערת מתחת ל-30% משווי הרכב.',
  };
}
