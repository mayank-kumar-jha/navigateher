// src/api/users/users.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db/auth

/**
 * @description Get the profile details of the currently authenticated user.
 * Relies on the `isAuth` middleware to attach `req.user`.
 */
exports.getMyProfile = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  try {
    // isAuth middleware adds the verified user info to req.user
    const userId = req.user.uid;
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      console.warn(`[Users] Profile not found in Firestore for UID: ${userId}`);
      return res.status(404).json({ message: "User profile not found." });
    }
    // Return Firestore profile data
    res.status(200).json(userDoc.data());
  } catch (error) {
    console.error("[Users] Error fetching user profile:", error);
    next(error); // Pass error to the global error handler
  }
};

/**
 * @description Update the profile details of the currently authenticated user.
 * Allows updating specific fields like name, phone, emergency contacts.
 */
exports.updateMyProfile = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  try {
    const userId = req.user.uid; // UID from authenticated token
    const updateData = req.body;

    // --- Data Validation & Sanitization ---
    const allowedUpdates = [
      "name",
      "phoneNumber",
      "emergencyContacts",
      "profilePictureUrl",
    ];
    const finalUpdate = {};
    for (const key in updateData) {
      if (allowedUpdates.includes(key)) {
        if (key === "emergencyContacts") {
          if (!Array.isArray(updateData[key])) {
            return res
              .status(400)
              .json({
                message:
                  "Invalid format for emergencyContacts (must be an array).",
              });
          }
          if (
            !updateData[key].every(
              (contact) =>
                contact &&
                typeof contact.name === "string" &&
                typeof contact.phone === "string"
            )
          ) {
            return res
              .status(400)
              .json({
                message:
                  "Invalid format for emergencyContacts (must be an array of {name, phone} objects).",
              });
          }
        }
        finalUpdate[key] = updateData[key];
      }
    }
    finalUpdate.updatedAt = new Date().toISOString();

    if (Object.keys(finalUpdate).length <= 1) {
      return res
        .status(400)
        .json({ message: "No valid fields provided for update." });
    }

    const userDocRef = db.collection("users").doc(userId);
    await userDocRef.update(finalUpdate);

    console.log(`[Users] Profile updated for UID: ${userId}`);
    res.status(200).json({ message: "Profile updated successfully." });
  } catch (error) {
    if (error.code === 5) {
      // Firestore 'NOT_FOUND'
      console.warn(
        `[Users] Attempted update non-existent profile: ${req.user?.uid}`
      );
      return res.status(404).json({ message: "User profile not found." });
    }
    console.error("[Users] Error updating user profile:", error);
    next(error);
  }
};
