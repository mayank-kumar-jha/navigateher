// src/api/auth/auth.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db/auth
const { models } = require("../../config/postgres"); // Sequelize models
const {
  startVerificationCheck,
} = require("../../services/verificationService"); // Import the mock/real service

/**
 * @description Registers a new user (rider or driver) in Firebase Auth, Firestore, and Postgres.
 * Also initiates a (mock) verification check.
 * @route POST /api/v1/auth/register
 * @access Public
 */
exports.registerUser = async (req, res, next) => {
  // Get db/auth instances inside the function
  const { db, auth } = firebaseConfig;
  try {
    const { email, password, name, userType, phoneNumber } = req.body;

    // Input validation (basic - more robust validation is in middleware)
    if (
      !email ||
      !password ||
      !name ||
      !userType ||
      !["rider", "driver"].includes(userType)
    ) {
      return res
        .status(400)
        .json({
          message:
            "Email, password, name, and valid userType (rider/driver) are required.",
        });
    }

    // --- 1. Create User in Firebase Authentication ---
    const userRecord = await auth.createUser({
      email: email,
      password: password, // Firebase handles hashing
      displayName: name,
      phoneNumber: phoneNumber || undefined, // Pass if provided
    });
    const userUid = userRecord.uid;
    console.log(`[Auth] Created Firebase Auth user: ${userUid}`);

    // --- 2. Set Custom Claims in Firebase Auth (for roles) ---
    await auth.setCustomUserClaims(userUid, { type: userType });
    console.log(
      `[Auth] Set custom claim 'type: ${userType}' for user ${userUid}`
    );

    // --- 3. Create User Profile in Firestore ---
    const userProfileFirestore = {
      uid: userUid,
      email: email,
      name: name,
      userType: userType,
      phoneNumber: phoneNumber || null,
      isVerified: false, // Starts as unverified
      verificationStatus: "not_started", // Initial verification status
      isOnline: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ratings: {
        // Initial rating structure
        average: 0,
        count: 0,
      },
      emergencyContacts: [], // Initialize empty array
      profilePictureUrl: null, // Default
      // Driver specific fields (initialized null/default)
      driverLicenseNumber: null,
      vehicleDetails: null,
      stripeAccountId: null,
      stripeAccountStatus: null,
    };
    await db.collection("users").doc(userUid).set(userProfileFirestore);
    console.log(`[Auth] Created Firestore profile for user ${userUid}`);

    // --- 4. Create User Record in Postgres ---
    try {
      await models.User.create({
        uid: userUid, // Link to Firebase UID
        email: email,
        name: name,
        userType: userType,
        phoneNumber: phoneNumber || null,
        // Other fields will use defaults defined in the migration/model
        emergencyContacts: [], // Ensure default is set here too if model allows null
        averageRating: 0,
        totalRatings: 0,
      });
      console.log(`[Auth] Created Postgres user record for UID: ${userUid}`);
    } catch (dbError) {
      // CRITICAL: If Postgres fails, we should ideally roll back Firebase user creation
      // This prevents inconsistent states. For now, log and throw.
      console.error(
        `[Auth] CRITICAL: Failed to create Postgres user for UID ${userUid} after Firebase success:`,
        dbError
      );
      // Attempt to delete the Firebase user to rollback
      try {
        await auth.deleteUser(userUid);
        console.log(
          `[Auth] Rolled back Firebase user ${userUid} due to Postgres error.`
        );
      } catch (deleteError) {
        console.error(
          `[Auth] CRITICAL: Failed to rollback Firebase user ${userUid} after Postgres error:`,
          deleteError
        );
        // Log this critical state for manual intervention
      }
      // Throw an error to be caught by the outer catch block
      throw new Error("Database synchronization failed during registration.");
    }

    // --- 5. Initiate Verification Check (Asynchronous - Don't wait) ---
    console.log(`[Auth] Initiating verification check for user ${userUid}.`);
    startVerificationCheck(userUid, {
      // Call the service function (mock or real)
      email: email,
      name: name,
      phoneNumber: phoneNumber,
      // Add other required data like DOB, address if collected during signup
    })
      .then((result) => {
        console.log(
          `[Auth] Verification initiation for ${userUid} completed (async). Result: ${result.message}`
        );
        // Update Firestore status to 'pending' maybe?
        db.collection("users")
          .doc(userUid)
          .update({ verificationStatus: "pending_submission" })
          .catch((err) =>
            console.error("Error updating verification status:", err)
          );
      })
      .catch((verificationError) => {
        // Log if initiation fails, but don't fail the registration response
        console.error(
          `[Auth] Failed to initiate verification for ${userUid}:`,
          verificationError
        );
        // Optionally update status in DB to 'initiation_failed'
        db.collection("users")
          .doc(userUid)
          .update({ verificationStatus: "initiation_failed" })
          .catch((err) =>
            console.error("Error updating verification status:", err)
          );
      });

    // --- 6. Respond to Client ---
    // Respond quickly, verification happens in the background via webhooks
    res.status(201).json({
      message:
        "User registered successfully. Verification pending. Please login.",
      uid: userUid,
    });
  } catch (error) {
    // Handle specific Firebase errors
    if (error.code === "auth/email-already-exists") {
      return res
        .status(400)
        .json({ message: "The email address is already in use." });
    }
    if (error.code === "auth/phone-number-already-exists") {
      return res
        .status(400)
        .json({ message: "The phone number is already in use." });
    }
    // Handle Postgres sync error thrown above
    if (
      error.message === "Database synchronization failed during registration."
    ) {
      return res.status(500).json({ message: error.message });
    }
    // Pass other errors to the global error handler
    console.error("[Auth] General Registration Error:", error);
    next(error);
  }
};

/**
 * @description Logs in a user by verifying their Firebase ID token.
 * Fetches the user's profile from Firestore.
 * @route POST /api/v1/auth/login
 * @access Public (Requires Firebase ID token in Authorization header)
 */
exports.loginUser = async (req, res, next) => {
  // Get db/auth instances inside the function
  const { db, auth } = firebaseConfig;
  try {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({
          message:
            "Unauthorized. Authorization header missing or invalid format (Bearer <token>).",
        });
    }

    const idToken = authorizationHeader.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({ message: "Unauthorized. Token missing." });
    }

    // --- Verify Firebase ID Token ---
    // This checks if the token is valid, not expired, and signed by your Firebase project
    const decodedToken = await auth.verifyIdToken(idToken);
    const userUid = decodedToken.uid;
    console.log(`[Auth] Token verified for UID: ${userUid}`);

    // --- Fetch User Profile from Firestore ---
    // We rely on Firestore as the primary source of truth for profile details after login
    const userDocRef = db.collection("users").doc(userUid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      // This is an inconsistent state - user exists in Firebase Auth but not Firestore profile
      // Could happen if registration failed partially or data was deleted.
      console.warn(
        `[Auth] Login successful for UID ${userUid} but Firestore profile is missing!`
      );
      // Options: Try to recreate from Postgres? Force logout? For now, deny login.
      return res
        .status(404)
        .json({ message: "User profile not found. Please contact support." });
    }

    // --- Login Successful ---
    // Return the profile data from Firestore
    res.status(200).json({
      message: "Login successful.",
      user: userDoc.data(), // Send Firestore profile data to the app
    });
  } catch (error) {
    // Let global error handler deal with token verification errors (expired, invalid)
    console.error("[Auth] Login Error:", error);
    next(error);
  }
};
