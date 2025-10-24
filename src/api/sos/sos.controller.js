// src/api/sos/sos.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db
const { sendSmsAlert } = require("../../services/twilioService"); // Use mock/real Twilio service
// Import Sequelize models for potential lookups if needed (e.g., getting user ID for PG queries)
const { models } = require("../../config/postgres");

/**
 * @description Triggers an SOS alert. Fetches user details, checks for active shared journeys,
 * gathers emergency contacts, sends SMS alerts, and notifies internal team.
 * @route POST /api/v1/sos/trigger
 * @access Private (Requires valid Firebase token via isAuth)
 */
exports.triggerSOS = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  try {
    const userId = req.user.uid; // User UID from isAuth middleware
    const userLocation = req.body.location; // App must send current location { lat, lng }

    // --- Input Validation (basic - more in middleware) ---
    if (
      !userLocation ||
      typeof userLocation.lat !== "number" ||
      typeof userLocation.lng !== "number"
    ) {
      return res
        .status(400)
        .json({
          message:
            "Valid current location { lat, lng } is required to trigger SOS.",
        });
    }

    console.log(
      `[SOS] Triggered by user ${userId} at Lat: ${userLocation.lat}, Lng: ${userLocation.lng}`
    );

    // --- 1. Fetch Triggering User's Profile (Firestore) ---
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      // Should not happen if isAuth worked, but handle defensively
      console.error(
        `[SOS] Critical: User profile not found in Firestore for authenticated user ${userId}`
      );
      return res.status(404).json({ message: "User profile not found." });
    }
    const userData = userDoc.data();
    const emergencyContacts = userData.emergencyContacts || []; // Expecting [{ name: "...", phone: "+..." }]
    const userName = userData.name || `User (${userId.substring(0, 6)}...)`; // Use name or partial UID

    // --- 2. Check for Active Shared Journey ---
    let alertMessage = `SOS Alert! ${userName} requires immediate assistance. Last known location: https://maps.google.com/?q=${userLocation.lat},${userLocation.lng}`;
    let combinedContacts = [...emergencyContacts]; // Start with the triggering user's contacts
    let otherRiderData = null;
    let activeJourneyId = null;

    const activeJourney = await findActiveSharedJourneyForUser(userId, db); // Pass db instance

    if (activeJourney) {
      activeJourneyId = activeJourney.id;
      console.log(
        `[SOS] User ${userId} is in active shared journey ${activeJourneyId}. Fetching linked rider details.`
      );
      const otherRiderUid = activeJourney.riderIds.find((id) => id !== userId);

      if (otherRiderUid) {
        const otherRiderDocRef = db.collection("users").doc(otherRiderUid);
        const otherRiderDoc = await otherRiderDocRef.get();
        if (otherRiderDoc.exists) {
          otherRiderData = otherRiderDoc.data();
          const otherRiderName =
            otherRiderData.name || `User (${otherRiderUid.substring(0, 6)}...)`;
          // Add other rider's contacts (prevent duplicates later)
          combinedContacts = combinedContacts.concat(
            otherRiderData.emergencyContacts || []
          );
          // Enhance alert message
          alertMessage += `\nThey were in a shared journey (ID: ${activeJourneyId}) with ${otherRiderName}.`;
          console.log(
            `[SOS] Found linked rider ${otherRiderUid} (${otherRiderName}). Combining emergency contacts.`
          );

          // Mark journey as having SOS triggered
          try {
            await db.collection("shared_journeys").doc(activeJourneyId).update({
              status: "sos_triggered",
              sosTriggeredBy: userId,
              sosTriggeredAt: new Date().toISOString(),
            });
            console.log(
              `[SOS] Marked shared journey ${activeJourneyId} as 'sos_triggered'.`
            );
          } catch (updateError) {
            console.error(
              `[SOS] Failed to update shared journey ${activeJourneyId} status:`,
              updateError
            );
            // Continue with SOS despite this failure
          }
        } else {
          console.warn(
            `[SOS] Linked rider ${otherRiderUid} in journey ${activeJourneyId} not found in Firestore.`
          );
          alertMessage += `\nThey were in a shared journey (ID: ${activeJourneyId}) with another user (profile not found).`;
        }
      } else {
        console.warn(
          `[SOS] Active journey ${activeJourneyId} found but could not identify other rider.`
        );
      }
    } else {
      console.log(
        `[SOS] User ${userId} is not currently in an active shared journey.`
      );
    }
    // --- End Linked SOS Logic ---

    // --- 3. Prepare Contact List & Send SMS Alerts ---
    // Ensure contacts have phone numbers and remove duplicates based on phone
    const validContacts = combinedContacts.filter(
      (c) => c && typeof c.phone === "string" && c.phone.trim() !== ""
    );
    const uniquePhoneNumbers = [
      ...new Set(validContacts.map((c) => c.phone.trim())),
    ];

    if (uniquePhoneNumbers.length > 0) {
      console.log(
        "[SOS] Sending SMS alerts via Twilio service to:",
        uniquePhoneNumbers
      );
      // Call the service function (mock or real) - Don't wait if not critical for response
      sendSmsAlert(uniquePhoneNumbers, alertMessage)
        .then((success) => {
          if (success)
            console.log("[SOS] Twilio SMS sending process initiated.");
          else
            console.error(
              "[SOS] Twilio SMS sending process failed to initiate."
            );
        })
        .catch((smsError) =>
          console.error("[SOS] Error calling sendSmsAlert:", smsError)
        );
    } else {
      console.warn(
        `[SOS] No valid emergency contacts found for user ${userId} (and linked rider, if any).`
      );
    }

    // --- 4. Notify Internal Safety Team (via Socket.IO) ---
    // Requires io instance to be available (passed via req.app.get('io'))
    try {
      const io = req.app.get("io");
      if (io) {
        const safetyTeamPayload = {
          triggeredBy: { uid: userId, name: userName, location: userLocation },
          journey: activeJourneyId
            ? {
                id: activeJourneyId,
                otherRider: otherRiderData
                  ? { uid: otherRiderData.uid, name: otherRiderData.name }
                  : null,
              }
            : null,
          timestamp: new Date().toISOString(),
        };
        // Emit to a specific room where safety team members are listening
        io.to("safety_team_room").emit("sos_alert", safetyTeamPayload);
        console.log("[SOS] Notified internal safety team via Socket.IO.");
      } else {
        console.error(
          "[SOS] Cannot notify safety team: Socket.IO instance not found on app."
        );
      }
    } catch (socketError) {
      console.error(
        "[SOS] Error emitting SOS alert to safety team via Socket.IO:",
        socketError
      );
    }

    // --- 5. Respond to User App ---
    // Respond quickly to confirm SOS was received and processing started
    res
      .status(200)
      .json({
        message:
          "SOS triggered. Emergency contacts and safety team are being notified.",
      });
  } catch (error) {
    console.error("[SOS] Unexpected error triggering SOS:", error);
    next(error); // Pass to global error handler
  }
};

// --- Helper Function (kept internal to this controller) ---
/**
 * Finds the most recent active shared journey for a user in Firestore.
 * @param {string} userId - The Firebase UID of the user.
 * @param {FirebaseFirestore.Firestore} dbInstance - The Firestore DB instance.
 * @returns {Promise<object|null>} - The journey data object (including ID) or null if not found.
 */
async function findActiveSharedJourneyForUser(userId, dbInstance) {
  try {
    const snapshot = await dbInstance
      .collection("shared_journeys")
      .where("status", "==", "active") // Only look for currently active journeys
      .where("riderIds", "array-contains", userId) // Where the user is one of the participants
      .orderBy("startedAt", "desc") // Get the most recent one if multiple somehow exist
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null; // No active journey found
    }
    // Return the first document found, including its ID
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error(
      `[SOS Helper] Error finding active shared journey for user ${userId}:`,
      error
    );
    return null; // Return null on error
  }
}
