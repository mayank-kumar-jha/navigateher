// src/api/community/community.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db

/**
 * @description Creates a 'shared_journey' document in Firestore when two riders agree to travel together.
 * Notifies the other rider via Socket.IO.
 * @route POST /api/v1/community/start-journey
 * @access Private (Requires authentication via isAuth/isRider)
 */
exports.startSharedJourney = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  try {
    // Assume app sends the UID of the *other* rider (Rider B)
    // The initiator (Rider A) is available via req.user from isAuth
    const { riderBUid, startLocation } = req.body;
    const riderAUid = req.user.uid; // Get initiator's UID from isAuth middleware

    // --- Input Validation ---
    if (!riderAUid || !riderBUid) {
      // Should not happen if isAuth is working, but good to check
      return res
        .status(400)
        .json({ message: "Initiator or target rider UID is missing." });
    }
    if (riderAUid === riderBUid) {
      return res
        .status(400)
        .json({ message: "Cannot start a shared journey with yourself." });
    }
    if (
      !startLocation ||
      typeof startLocation.lat !== "number" ||
      typeof startLocation.lng !== "number"
    ) {
      return res
        .status(400)
        .json({ message: "Valid startLocation { lat, lng } is required." });
    }

    // --- Create Journey Document in Firestore ---
    const journeyData = {
      riderIds: [riderAUid, riderBUid].sort(), // Sort UIDs for consistent querying
      status: "active", // 'active', 'completed', 'cancelled', 'sos_triggered'
      startedAt: new Date().toISOString(),
      startLocation: {
        // Store as GeoPoint for potential future geospatial queries
        latitude: startLocation.lat,
        longitude: startLocation.lng,
      },
      // Store last known locations, initialized to start location
      lastKnownLocations: {
        [riderAUid]: {
          latitude: startLocation.lat,
          longitude: startLocation.lng,
          timestamp: new Date().toISOString(),
        },
        [riderBUid]: {
          latitude: startLocation.lat,
          longitude: startLocation.lng,
          timestamp: new Date().toISOString(),
        },
      },
      endedAt: null,
      sosTriggeredBy: null,
    };

    // Add the new document to the 'shared_journeys' collection
    const journeyRef = await db.collection("shared_journeys").add(journeyData);
    const journeyId = journeyRef.id;

    console.log(
      `[Community] Started Shared Journey ${journeyId} for riders ${riderAUid} and ${riderBUid}`
    );

    // --- Respond to Rider A (the initiator) ---
    // Let them know the journey is created and provide the ID
    res.status(201).json({
      message: "Shared journey started successfully.",
      journeyId: journeyId,
      journeyData: { ...journeyData, id: journeyId }, // Send back created data + ID
    });

    // --- Notify Rider B via Socket.IO (No longer a placeholder) ---
    try {
      // Get the notifyRider helper function attached to the app in server.js
      const { notifyRider } = req.app.get("socketHelpers");

      if (notifyRider) {
        // Fetch Rider A's details to send to Rider B
        let initiatorDetails = { name: "Fellow Rider" }; // Default
        const initiatorDoc = await db.collection("users").doc(riderAUid).get();
        if (initiatorDoc.exists) {
          initiatorDetails.name =
            initiatorDoc.data().name || initiatorDetails.name;
          // Add rating? initiatorDetails.rating = initiatorDoc.data().ratings?.average;
        }

        // Send the notification to Rider B's device
        const notificationSent = notifyRider(
          riderBUid,
          "shared_journey_started",
          {
            journeyId: journeyId,
            startedBy: riderAUid,
            otherRiderDetails: initiatorDetails, // Send Rider A's info
            startLocation: startLocation,
          }
        );

        if (notificationSent) {
          console.log(
            `[Community] Notified rider ${riderBUid} about journey start.`
          );
        } else {
          // Log if the rider wasn't connected via socket
          console.warn(
            `[Community] Rider ${riderBUid} was not connected via Socket.IO to receive journey start notification.`
          );
          // Consider sending a Firebase Push Notification as a fallback?
        }
      } else {
        // This would indicate an issue with how socketHelpers are passed in server.js
        console.error(
          "[Community] `notifyRider` helper function not found in socketHelpers. Cannot notify other rider."
        );
      }
    } catch (socketError) {
      // Log errors during notification but don't fail the primary API request
      console.error(
        "[Community] Error notifying other rider via Socket.IO:",
        socketError
      );
    }
  } catch (error) {
    console.error("[Community] Error starting shared journey:", error);
    next(error); // Pass error to the global error handler
  }
};

// --- Fully Implemented Placeholders (Basic Logic) ---

/**
 * @description Updates the location of a rider during a shared journey.
 * Should be called periodically by the app.
 * @route PUT /api/v1/community/journey/:journeyId/location
 * @access Private (Riders in the journey only)
 */
exports.updateSharedJourneyLocation = async (req, res, next) => {
  const { db } = require("../../config/firebase");
  try {
    const { journeyId } = req.params;
    const { location } = req.body; // { lat, lng }
    const userId = req.user.uid;

    if (
      !location ||
      typeof location.lat !== "number" ||
      typeof location.lng !== "number"
    ) {
      return res
        .status(400)
        .json({ message: "Valid location { lat, lng } is required." });
    }

    const journeyRef = db.collection("shared_journeys").doc(journeyId);
    const journeyDoc = await journeyRef.get();

    if (!journeyDoc.exists) {
      return res.status(404).json({ message: "Shared journey not found." });
    }
    const journeyData = journeyDoc.data();

    // Authorization: Ensure user is part of this journey
    if (!journeyData.riderIds?.includes(userId)) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not part of this journey." });
    }
    // Ensure journey is active
    if (journeyData.status !== "active") {
      return res
        .status(400)
        .json({
          message: `Cannot update location for journey with status: ${journeyData.status}`,
        });
    }

    // Update the specific rider's last known location using dot notation
    const updateField = `lastKnownLocations.${userId}`;
    await journeyRef.update({
      [updateField]: {
        latitude: location.lat,
        longitude: location.lng,
        timestamp: new Date().toISOString(),
      },
    });

    // --- Notify the OTHER rider of location update via Socket.IO ---
    try {
      const { notifyRider } = req.app.get("socketHelpers");
      const otherRiderUid = journeyData.riderIds.find((id) => id !== userId);
      if (otherRiderUid && notifyRider) {
        notifyRider(otherRiderUid, "journey_location_update", {
          journeyId: journeyId,
          userId: userId, // Let them know *who* updated
          location: location,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (socketError) {
      console.error(
        "[Community] Error notifying other rider of location update:",
        socketError
      );
    }

    res.status(200).json({ message: "Location updated for shared journey." });
  } catch (error) {
    console.error("[Community] Error updating shared journey location:", error);
    next(error);
  }
};

/**
 * @description Marks a shared journey as completed or cancelled by one of the riders.
 * @route PUT /api/v1/community/journey/:journeyId/end
 * @access Private (Riders in the journey only)
 */
exports.endSharedJourney = async (req, res, next) => {
  const { db } = require("../../config/firebase");
  try {
    const { journeyId } = req.params;
    const { status, reason } = req.body; // status should be 'completed' or 'cancelled'
    const userId = req.user.uid;

    if (!status || !["completed", "cancelled"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be 'completed' or 'cancelled'." });
    }

    const journeyRef = db.collection("shared_journeys").doc(journeyId);
    const journeyDoc = await journeyRef.get();

    if (!journeyDoc.exists) {
      return res.status(404).json({ message: "Shared journey not found." });
    }
    const journeyData = journeyDoc.data();

    // Authorization: Ensure user is part of this journey
    if (!journeyData.riderIds?.includes(userId)) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not part of this journey." });
    }
    // Prevent ending an already ended journey
    if (
      journeyData.status !== "active" &&
      journeyData.status !== "sos_triggered"
    ) {
      // Can end if SOS was triggered
      return res
        .status(400)
        .json({
          message: `Journey is already in a terminal state: ${journeyData.status}`,
        });
    }

    // Update journey status and end time
    await journeyRef.update({
      status: status, // 'completed' or 'cancelled'
      endedAt: new Date().toISOString(),
      endedBy: userId, // Record who ended it
      cancellationReason:
        status === "cancelled" ? reason || "No reason provided" : null,
    });

    console.log(
      `[Community] Ended Shared Journey ${journeyId} with status ${status} by user ${userId}`
    );

    // --- Notify the OTHER rider via Socket.IO ---
    try {
      const { notifyRider } = req.app.get("socketHelpers");
      const otherRiderUid = journeyData.riderIds.find((id) => id !== userId);
      if (otherRiderUid && notifyRider) {
        notifyRider(otherRiderUid, "shared_journey_ended", {
          journeyId: journeyId,
          status: status,
          endedBy: userId,
          reason:
            status === "cancelled" ? reason || "No reason provided" : null,
        });
      }
    } catch (socketError) {
      console.error(
        "[Community] Error notifying other rider of journey end:",
        socketError
      );
    }

    res.status(200).json({ message: `Shared journey marked as ${status}.` });
  } catch (error) {
    console.error("[Community] Error ending shared journey:", error);
    next(error);
  }
};
