// ═══════════════════════════════════════════════════════════════
// Firebase Configuration for Estimax
// ═══════════════════════════════════════════════════════════════
//
// INSTRUCTIONS:
// 1. Go to Firebase Console: https://console.firebase.google.com/
// 2. Create a new project called "Estimax"
// 3. Add a Web app
// 4. Copy your config values below
// 5. Enable Authentication (Email/Password)
// 6. Create Firestore Database
// 7. Enable Cloud Storage
// ═══════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  // TODO: Replace with your Firebase project values
  apiKey: "AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "estimax-xxxxx.firebaseapp.com",
  projectId: "estimax-xxxxx",
  storageBucket: "estimax-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:xxxxxxxxxxxxxxxx"
};

// ═══════════════════════════════════════════════════════════════
// Initialize Firebase (in index.html)
// ═══════════════════════════════════════════════════════════════
/*
<script>
  // Initialize Firebase
  if (!window.firebase) {
    console.error('Firebase SDK not loaded');
  } else {
    firebase.initializeApp(FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();
    console.log('✅ Firebase initialized');
  }
</script>
*/

// ═══════════════════════════════════════════════════════════════
// Firestore Collections Schema
// ═══════════════════════════════════════════════════════════════

const FIRESTORE_SCHEMA = {
  // Users Collection
  users: {
    // userId as document ID
    email: "string",
    name: "string",
    role: "Anatoli_Appraiser | Manager | Client",
    avatar: "string (initials or URL)",
    createdAt: "timestamp",
    lastLogin: "timestamp",
    settings: {
      theme: "light | dark",
      notifications: "boolean",
      language: "he | en"
    }
  },

  // Cases Collection
  cases: {
    // caseId as document ID (e.g., "2026-047")
    caseNumber: "string",
    clientId: "string (reference to users)",
    clientName: "string",
    licensePlate: "string",
    vehicleModel: "string",
    damageDate: "timestamp",
    caseType: "car | expert | replacement",
    status: "open | in_progress | closed",
    appraiserUID: "string (reference to users)",
    estimatedAmount: "number (₪)",
    notes: "string",
    photos: ["array of photo IDs"],
    anatoli_analysis: {
      status: "pending | completed | failed",
      parts: ["array"],
      labor: ["array"],
      totalCost: "number"
    },
    createdAt: "timestamp",
    updatedAt: "timestamp",
    closedAt: "timestamp (optional)"
  },

  // Photos Collection
  photos: {
    // photoId as document ID
    caseId: "string",
    url: "string (Cloud Storage URL)",
    type: "damage | full_car | detail",
    uploadedAt: "timestamp",
    uploadedBy: "string (userUID)",
    anatoli_processed: "boolean",
    ai_analysis: {
      damageLevel: "minor | moderate | severe",
      affectedAreas: ["array"],
      confidence: "number (0-1)"
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// Firebase Security Rules
// ═══════════════════════════════════════════════════════════════
/*
Copy this to Firebase Console → Firestore → Rules:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users - own profile only
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }

    // Cases - appraiser or client access
    match /cases/{caseId} {
      allow read: if
        request.auth.uid == resource.data.appraiserUID ||
        request.auth.uid == resource.data.clientId;
      allow create: if request.auth != null;
      allow update: if
        request.auth.uid == resource.data.appraiserUID ||
        request.auth.uid == resource.data.clientId;
    }

    // Photos - attached to cases
    match /photos/{photoId} {
      allow read, write: if
        get(/databases/$(database)/documents/cases/$(request.resource.data.caseId)).data.appraiserUID == request.auth.uid;
    }
  }
}
*/

// ═══════════════════════════════════════════════════════════════
// Auth Setup Code (add to index.html)
// ═══════════════════════════════════════════════════════════════
/*
// Replace handleLogin function in index.html with:

async function handleLoginFirebase(email, password) {
  try {
    const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
    const user = userCredential.user;

    // Get user profile from Firestore
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (!userDoc.exists) {
      throw new Error('User profile not found');
    }

    const userData = userDoc.data();
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      uid: user.uid,
      email: user.email,
      name: userData.name,
      role: userData.role,
      avatar: userData.avatar
    }));

    console.log('✅ Logged in:', user.email);
    document.getElementById('loginOverlay').classList.add('hidden');
    updateUserDisplay();

  } catch (error) {
    console.error('Login error:', error);
    showLoginError(error.message);
  }
}

// Signup function
async function signupUser(email, password, name) {
  try {
    const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;

    // Create user profile in Firestore
    await db.collection('users').doc(user.uid).set({
      email: email,
      name: name,
      role: 'Anatoli_Appraiser',
      createdAt: new Date(),
      settings: {
        theme: 'light',
        notifications: true,
        language: 'he'
      }
    });

    console.log('✅ User created:', user.email);
    return user;

  } catch (error) {
    console.error('Signup error:', error);
    throw error;
  }
}

// Logout
function logoutFirebase() {
  firebase.auth().signOut().then(() => {
    localStorage.removeItem(AUTH_KEY);
    location.reload();
  });
}

// Listen for auth state changes
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    console.log('✅ User authenticated:', user.email);
  } else {
    console.log('❌ User not authenticated');
  }
});
*/

// ═══════════════════════════════════════════════════════════════
// Demo: Create Case in Firestore
// ═══════════════════════════════════════════════════════════════
/*
async function createCaseInFirebase(caseData) {
  try {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const caseRef = await db.collection('cases').add({
      caseNumber: caseData.caseNumber,
      clientId: caseData.clientId,
      clientName: caseData.clientName,
      licensePlate: caseData.licensePlate,
      vehicleModel: caseData.vehicleModel,
      damageDate: new Date(caseData.damageDate),
      caseType: caseData.caseType,
      status: 'open',
      appraiserUID: user.uid,
      estimatedAmount: 0,
      notes: '',
      photos: [],
      anatoli_analysis: {
        status: 'pending',
        parts: [],
        labor: [],
        totalCost: 0
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Case created:', caseRef.id);
    return caseRef.id;

  } catch (error) {
    console.error('Create case error:', error);
    throw error;
  }
}
*/

// ═══════════════════════════════════════════════════════════════
// Upload Photo to Cloud Storage
// ═══════════════════════════════════════════════════════════════
/*
async function uploadPhotoToStorage(file, caseId) {
  try {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const timestamp = Date.now();
    const fileName = `${caseId}_${timestamp}_${file.name}`;
    const storageRef = firebase.storage().ref(`cases/${caseId}/${fileName}`);

    // Upload file
    const snapshot = await storageRef.put(file);
    const url = await snapshot.ref.getDownloadURL();

    // Add to Firestore
    const photoRef = await db.collection('photos').add({
      caseId: caseId,
      url: url,
      type: 'damage',
      uploadedAt: new Date(),
      uploadedBy: user.uid,
      anatoli_processed: false,
      ai_analysis: {}
    });

    console.log('✅ Photo uploaded:', url);
    return { photoId: photoRef.id, url: url };

  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}
*/

// ═══════════════════════════════════════════════════════════════
// Read Cases (Real-time listener)
// ═══════════════════════════════════════════════════════════════
/*
function listenToCases(userUID) {
  return db.collection('cases')
    .where('appraiserUID', '==', userUID)
    .orderBy('createdAt', 'desc')
    .onSnapshot(snapshot => {
      const cases = [];
      snapshot.forEach(doc => {
        cases.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('📋 Cases updated:', cases.length);
      return cases;
    });
}
*/

console.log('✅ Firebase config loaded');
