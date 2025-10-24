const admin = require("firebase-admin");
const path = require("path");

let db, auth, messaging;

function initializeFirebaseAdmin() {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!serviceAccountPath) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH is not set in .env file.");
    }

    const absolutePath = path.resolve(serviceAccountPath);
    const serviceAccount = require(absolutePath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Add databaseURL if using Realtime Database
    });

    // Assign after initialization
    db = admin.firestore();
    auth = admin.auth();
    messaging = admin.messaging(); // Initialize Firebase Cloud Messaging
  } catch (error) {
    console.error("[Firebase] Initialization failed:", error.message);
    throw error;
  }
}

// Export getters to ensure services are initialized before use
module.exports = {
  initializeFirebaseAdmin,
  get db() {
    if (!db) {
      throw new Error(
        "Firestore is not initialized. Call initializeFirebaseAdmin first."
      );
    }
    return db;
  },
  get auth() {
    if (!auth) {
      throw new Error(
        "Firebase Auth is not initialized. Call initializeFirebaseAdmin first."
      );
    }
    return auth;
  },
  get messaging() {
    if (!messaging) {
      throw new Error(
        "Firebase Messaging is not initialized. Call initializeFirebaseAdmin first."
      );
    }
    return messaging;
  },
};
