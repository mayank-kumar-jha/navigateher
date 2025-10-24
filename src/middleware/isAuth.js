// src/middleware/isAuth.js

const firebaseConfig = require("../config/firebase"); // Import Firebase admin config

/**
 * Middleware to verify Firebase ID token sent in the Authorization header.
 * If valid, attaches the decoded token (including UID and custom claims) to req.user.
 * If invalid or missing, sends a 401 or 403 response.
 */
const isAuth = async (req, res, next) => {
  // --- Get 'auth' inside the function ---
  const { auth } = firebaseConfig;

  const authorizationHeader = req.headers.authorization;

  // 1. Check if the Authorization header exists and starts with "Bearer "
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    // console.log('[Auth] Missing or invalid Authorization header'); // Debug log
    return res
      .status(401)
      .json({ message: "Unauthorized: No token provided or invalid format." });
  }

  // 2. Extract the token
  const idToken = authorizationHeader.split("Bearer ")[1];
  if (!idToken) {
    // console.log('[Auth] Token missing after Bearer'); // Debug log
    return res
      .status(401)
      .json({ message: "Unauthorized: Token is missing after Bearer." });
  }

  try {
    // 3. Verify the token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(idToken);

    // 4. Token is valid! Attach the decoded payload to the request object
    req.user = decodedToken; // Includes uid, email, name, custom claims (like type)
    // console.log('[Auth] Token verified for UID:', req.user.uid); // Debug log

    // 5. Call next() to pass control to the next middleware or route handler
    next();
  } catch (error) {
    // Token verification failed (expired, invalid signature, etc.)
    console.error("[Auth] Firebase Token Verification Error:", error.message);
    if (error.code === "auth/id-token-expired") {
      return res
        .status(401)
        .json({
          message: "Unauthorized: Token expired.",
          code: "TOKEN_EXPIRED",
        });
    }
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid token.", code: "INVALID_TOKEN" });
  }
};

// Middleware specifically for drivers
const isDriver = (req, res, next) => {
  // Assumes isAuth ran first and attached req.user
  if (req.user && req.user.type === "driver") {
    next();
  } else {
    res.status(403).json({ message: "Forbidden: Requires driver privileges." });
  }
};

// Middleware specifically for riders
const isRider = (req, res, next) => {
  // Assumes isAuth ran first and attached req.user
  if (req.user && req.user.type === "rider") {
    next();
  } else {
    res.status(403).json({ message: "Forbidden: Requires rider privileges." });
  }
};

module.exports = {
  isAuth,
  isDriver,
  isRider,
};
