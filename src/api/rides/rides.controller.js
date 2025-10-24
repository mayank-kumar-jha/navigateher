// src/api/rides/rides.controller.js

const {
  getAlternativeRoutes,
  findPOIsAlongRoute,
} = require("../../services/googleMaps");
const { validationResult } = require("express-validator"); // For input validation
const firebaseConfig = require("../../config/firebase"); // Need this for db and messaging
// Assuming models are loaded and attached in postgres.js or server.js
const { models } = require("../../config/postgres");
const { Op } = require("sequelize"); // For Sequelize operators if needed

// --- Define Scoring Weights FIRST ---
const WEIGHTS = {
  SAFETY: { police: 10, hospital: 5, atm: 1, pharmacy: 2 },
  CROWDEDNESS: {
    transit_station: 8,
    shopping_mall: 6,
    market: 6,
    tourist_attraction: 4,
    restaurant: 5,
    cafe: 4,
    bar: 3,
    movie_theater: 4,
  },
};
const SAFETY_POI_TYPES = Object.keys(WEIGHTS.SAFETY);
const CROWD_POI_TYPES = Object.keys(WEIGHTS.CROWDEDNESS);

/**
 * @description Calculates safest route alternatives based on POI density and time.
 */
exports.getSafestRoutes = async (req, res, next) => {
  // --- Input Validation ---
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { origin, destination, time } = req.body;

    const googleRoutes = await getAlternativeRoutes(origin, destination);
    if (!googleRoutes || googleRoutes.length === 0) {
      return res
        .status(404)
        .json({ message: "No routes found between the specified locations." });
    }

    const scoringPromises = googleRoutes.map(async (route, index) => {
      if (
        !route.legs ||
        !route.legs[0] ||
        !route.legs[0].steps ||
        !route.overview_polyline
      ) {
        console.warn(
          `[Safest Route] Skipping invalid route structure at index ${index}`
        );
        return null;
      }
      const searchRadiusMeters = 750;
      const safetyPOIs = await findPOIsAlongRoute(
        route,
        SAFETY_POI_TYPES,
        searchRadiusMeters
      );
      const crowdPOIs = await findPOIsAlongRoute(
        route,
        CROWD_POI_TYPES,
        searchRadiusMeters
      );

      let safetyScore = 0;
      let crowdScore = 0;
      const currentHour = time
        ? parseInt(time.split(":")[0], 10)
        : new Date().getHours();

      safetyPOIs.forEach((poi) => {
        const type = poi.types?.find((t) => WEIGHTS.SAFETY[t]);
        if (type) safetyScore += WEIGHTS.SAFETY[type];
      });

      crowdPOIs.forEach((poi) => {
        const type = poi.types?.find((t) => WEIGHTS.CROWDEDNESS[t]);
        if (type) {
          let weight = WEIGHTS.CROWDEDNESS[type];
          if (type === "restaurant" && (currentHour < 18 || currentHour > 23))
            weight *= 0.2;
          if (type === "cafe" && (currentHour < 8 || currentHour > 18))
            weight *= 0.3;
          if (type === "bar" && (currentHour < 19 || currentHour > 2))
            weight = 0;
          if (
            type === "shopping_mall" &&
            (currentHour < 10 || currentHour > 21)
          )
            weight *= 0.1;
          if (type === "market" && (currentHour < 9 || currentHour > 19))
            weight *= 0.1;
          crowdScore += weight;
        }
      });

      return {
        summary: route.summary || `Route ${index + 1}`,
        duration: route.legs[0].duration?.text || "N/A",
        distance: route.legs[0].distance?.text || "N/A",
        safetyScore: Math.round(safetyScore),
        crowdScore: Math.round(crowdScore),
        totalScore: Math.round(safetyScore + crowdScore),
        isDefaultRoute: index === 0,
        polyline: route.overview_polyline.points,
      };
    });

    let scoredRoutes = await Promise.all(scoringPromises);
    scoredRoutes = scoredRoutes.filter((route) => route !== null);
    scoredRoutes.sort((a, b) => b.totalScore - a.totalScore);
    if (scoredRoutes.length > 0) scoredRoutes[0].isRecommended = true;

    res.status(200).json(scoredRoutes);
  } catch (error) {
    console.error("[Safest Route] Error in getSafestRoutes:", error);
    next(error);
  }
};

/**
 * @description Initiates a ride request after the rider selects a route.
 */
exports.requestRide = async (req, res, next) => {
  const { findNearbyDrivers, sendRideRequestToDriver, findNearbyRiders } =
    req.app.get("socketHelpers");
  const { db } = firebaseConfig;
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });

  try {
    const { pickupLocation, destinationLocation, routePolyline } = req.body;
    const riderId = req.user.uid;

    const nearbyDrivers = findNearbyDrivers(pickupLocation, 10);

    if (!nearbyDrivers || nearbyDrivers.length === 0) {
      console.log(
        `[Ride Request] No drivers found for rider ${riderId}. Searching for community match.`
      );
      const nearbyRiders = findNearbyRiders(
        riderId,
        pickupLocation,
        destinationLocation
      );
      if (!nearbyRiders || nearbyRiders.length === 0) {
        return res
          .status(404)
          .json({
            message: "No available drivers or community matches found.",
            code: "NO_DRIVERS_OR_RIDERS",
          });
      }
      console.log(
        `[Ride Request] Community matches found for rider ${riderId}:`,
        nearbyRiders.map((r) => r.uid)
      );
      return res
        .status(200)
        .json({
          message:
            "No drivers found, but potential community matches are available!",
          code: "COMMUNITY_MATCH_FOUND",
          matches: nearbyRiders,
        });
    }

    const closestDriver = nearbyDrivers[0];
    console.log(
      `[Ride Request] Closest driver found for rider ${riderId}: ${
        closestDriver.uid
      } (${closestDriver.distance.toFixed(1)}km away)`
    );

    const rideData = {
      riderId: riderId,
      driverId: null,
      status: "pending",
      pickup: pickupLocation,
      destination: destinationLocation,
      routePolyline: routePolyline,
      requestedAt: new Date().toISOString(),
      riderFirebaseUid: riderId,
      driverFirebaseUid: null,
    };
    const rideRef = await db.collection("rides").add(rideData);
    console.log(
      `[Ride Request] Created pending ride document ${rideRef.id} in Firestore.`
    );

    // TODO: Create corresponding Ride record in Postgres?

    const rideDetailsForDriver = {
      rideId: rideRef.id,
      pickup: pickupLocation,
      destination: destinationLocation,
    };
    const success = sendRideRequestToDriver(
      closestDriver.uid,
      rideDetailsForDriver
    );

    if (!success) {
      console.warn(
        `[Ride Request] Driver ${closestDriver.uid} found but could not be contacted.`
      );
      await rideRef.update({
        status: "cancelled_system",
        cancellationReason: "Driver unavailable",
      });
      // TODO: Implement logic to try the next driver
      return res
        .status(503)
        .json({
          message: "Driver found but became unavailable. Please try again.",
        });
    }

    res
      .status(200)
      .json({
        message: `Requesting ride...`,
        rideId: rideRef.id,
        driverUid: closestDriver.uid,
      });
  } catch (error) {
    console.error("[Ride Request] Error:", error);
    next(error);
  }
};

// --- NEW: Ride Lifecycle Functions ---

/**
 * @description Get details of a specific ride.
 * Ensures the requesting user is either the rider or the driver.
 */
exports.getRideDetails = async (req, res, next) => {
  const { db } = firebaseConfig;
  try {
    const { rideId } = req.params;
    const userId = req.user.uid; // From isAuth middleware

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found." });
    }

    const rideData = rideDoc.data();

    // Authorization check: User must be the rider or the driver
    if (rideData.riderId !== userId && rideData.driverId !== userId) {
      return res
        .status(403)
        .json({
          message: "Forbidden: You are not authorized to view this ride.",
        });
    }

    res.status(200).json({ id: rideDoc.id, ...rideData });
  } catch (error) {
    console.error(
      `[Ride Details] Error fetching ride ${req.params.rideId}:`,
      error
    );
    next(error);
  }
};

/**
 * @description Driver marks their arrival at the pickup location.
 * Updates ride status and notifies the rider.
 */
exports.markArrived = async (req, res, next) => {
  const { db } = firebaseConfig;
  const { notifyRider } = req.app.get("socketHelpers"); // Get notify helper
  try {
    const { rideId } = req.params;
    const driverId = req.user.uid; // Driver UID from isAuth/isDriver

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found." });
    }
    const rideData = rideDoc.data();

    // Validation: Only assigned driver can mark arrival, status must be 'accepted'
    if (rideData.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not the driver for this ride." });
    }
    if (rideData.status !== "accepted") {
      return res
        .status(400)
        .json({
          message: `Cannot mark arrival for ride with status: ${rideData.status}`,
        });
    }

    // Update Firestore
    await rideRef.update({
      status: "driver_arrived",
      arrivedAtPickupAt: new Date().toISOString(),
    });

    // Notify Rider via Socket.IO
    if (notifyRider) {
      notifyRider(rideData.riderId, "driver_arrived", { rideId });
      console.log(
        `[Ride Lifecycle] Notified rider ${rideData.riderId} of driver arrival for ride ${rideId}`
      );
    } else {
      console.warn(
        `[Ride Lifecycle] notifyRider helper not found. Cannot notify rider ${rideData.riderId}.`
      );
    }

    console.log(
      `[Ride Lifecycle] Driver ${driverId} marked arrival for ride ${rideId}`
    );
    res
      .status(200)
      .json({ message: "Arrival marked successfully. Rider notified." });
  } catch (error) {
    console.error(
      `[Ride Lifecycle] Error marking arrival for ride ${req.params.rideId}:`,
      error
    );
    next(error);
  }
};

/**
 * @description Driver starts the actual trip after picking up the rider.
 * Updates ride status and notifies the rider.
 */
exports.startRide = async (req, res, next) => {
  const { db } = firebaseConfig;
  const { notifyRider } = req.app.get("socketHelpers");
  try {
    const { rideId } = req.params;
    const driverId = req.user.uid;

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists)
      return res.status(404).json({ message: "Ride not found." });
    const rideData = rideDoc.data();

    // Validation: Only assigned driver, status must be 'driver_arrived'
    if (rideData.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not the driver for this ride." });
    }
    if (rideData.status !== "driver_arrived") {
      return res
        .status(400)
        .json({
          message: `Cannot start ride with status: ${rideData.status}. Driver must mark arrival first.`,
        });
    }

    // Update Firestore
    await rideRef.update({
      status: "ongoing",
      startedAt: new Date().toISOString(),
    });

    // Notify Rider via Socket.IO
    if (notifyRider) {
      notifyRider(rideData.riderId, "ride_started", { rideId });
      console.log(
        `[Ride Lifecycle] Notified rider ${rideData.riderId} of ride start for ${rideId}`
      );
    }

    console.log(`[Ride Lifecycle] Driver ${driverId} started ride ${rideId}`);
    res
      .status(200)
      .json({ message: "Ride started successfully. Rider notified." });
  } catch (error) {
    console.error(
      `[Ride Lifecycle] Error starting ride ${req.params.rideId}:`,
      error
    );
    next(error);
  }
};

/**
 * @description Driver completes the trip at the destination.
 * Updates status, calculates fare (placeholder), notifies rider.
 */
exports.completeRide = async (req, res, next) => {
  const { db } = firebaseConfig;
  const { notifyRider, makeDriverAvailable } = req.app.get("socketHelpers");
  try {
    const { rideId } = req.params;
    const driverId = req.user.uid;
    const finalLocation = req.body.finalLocation; // Optional: driver app sends final coords {lat, lng}

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists)
      return res.status(404).json({ message: "Ride not found." });
    const rideData = rideDoc.data();

    // Validation: Only assigned driver, status must be 'ongoing'
    if (rideData.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not the driver for this ride." });
    }
    if (rideData.status !== "ongoing") {
      return res
        .status(400)
        .json({
          message: `Cannot complete ride with status: ${rideData.status}. Ride must be ongoing.`,
        });
    }

    // --- TODO: Calculate Final Fare ---
    // This logic depends heavily on your pricing model (distance, time, base fare, surge?)
    // Example placeholder:
    const calculatedFare = calculateFare(
      rideData.pickup,
      finalLocation || rideData.destination,
      rideData.startedAt
    ); // Implement this
    console.log(
      `[Ride Lifecycle] Calculated fare for ride ${rideId}: ${calculatedFare}`
    );

    // Update Firestore
    await rideRef.update({
      status: "completed",
      endedAt: new Date().toISOString(),
      actualFare: calculatedFare,
      finalDropoffLocation: finalLocation || null, // Store actual dropoff if provided
      paymentStatus: "pending", // Ready for payment processing
    });

    // Make driver available again in the live pool
    if (makeDriverAvailable) makeDriverAvailable(driverId);

    // Notify Rider via Socket.IO (including fare)
    if (notifyRider) {
      notifyRider(rideData.riderId, "ride_completed", {
        rideId,
        fare: calculatedFare,
        paymentStatus: "pending",
      });
      console.log(
        `[Ride Lifecycle] Notified rider ${rideData.riderId} of ride completion for ${rideId}`
      );
    }

    // --- TODO: Update Postgres Ride record ---
    // await models.Ride.update({ status: 'completed', endedAt: new Date(), actualFare: calculatedFare }, { where: { firestoreRideId: rideId } });

    console.log(`[Ride Lifecycle] Driver ${driverId} completed ride ${rideId}`);
    res
      .status(200)
      .json({
        message: "Ride completed successfully. Rider notified.",
        fare: calculatedFare,
      });
  } catch (error) {
    console.error(
      `[Ride Lifecycle] Error completing ride ${req.params.rideId}:`,
      error
    );
    // If error, potentially revert driver status if changed
    if (makeDriverAvailable) makeDriverAvailable(req.user.uid); // Make available on error? Or keep on-ride? Needs thought.
    next(error);
  }
};

/**
 * @description Rider or Driver cancels a ride.
 * Updates status, notifies the other party. Cancellation fees logic TBD.
 */
exports.cancelRide = async (req, res, next) => {
  const { db } = firebaseConfig;
  const { notifyRider, notifyDriver, makeDriverAvailable } =
    req.app.get("socketHelpers");
  try {
    const { rideId } = req.params;
    const cancellerUid = req.user.uid;
    const cancellerType = req.user.type; // 'rider' or 'driver'
    const reason = req.body.reason || "No reason provided"; // Optional reason from app

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists)
      return res.status(404).json({ message: "Ride not found." });
    const rideData = rideDoc.data();

    // Validation: User must be part of the ride
    if (
      rideData.riderId !== cancellerUid &&
      rideData.driverId !== cancellerUid
    ) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not part of this ride." });
    }

    // Validation: Cannot cancel already completed or cancelled rides
    const terminalStatuses = [
      "completed",
      "cancelled_rider",
      "cancelled_driver",
      "cancelled_system",
    ];
    if (terminalStatuses.includes(rideData.status)) {
      return res
        .status(400)
        .json({
          message: `Cannot cancel ride with status: ${rideData.status}.`,
        });
    }

    // Determine new status and who to notify
    const newStatus =
      cancellerType === "rider" ? "cancelled_rider" : "cancelled_driver";
    const otherPartyUid =
      cancellerType === "rider" ? rideData.driverId : rideData.riderId;
    const notifyFunction =
      cancellerType === "rider" ? notifyDriver : notifyRider;

    // --- TODO: Cancellation Fee Logic ---
    // Check conditions (e.g., time since acceptance, driver proximity) to apply fee
    let cancellationFee = 0; // Placeholder
    // if (shouldApplyCancellationFee(rideData, cancellerType)) {
    //    cancellationFee = 50; // Example fee
    // }

    // Update Firestore
    await rideRef.update({
      status: newStatus,
      endedAt: new Date().toISOString(),
      cancellationReason: reason,
      cancellationFee: cancellationFee > 0 ? cancellationFee : null,
    });

    // Make driver available if they were assigned or on the way/ongoing
    if (rideData.driverId && makeDriverAvailable) {
      makeDriverAvailable(rideData.driverId);
      console.log(
        `[Ride Lifecycle] Made driver ${rideData.driverId} available after cancellation.`
      );
    }

    // Notify the other party via Socket.IO
    if (otherPartyUid && notifyFunction) {
      notifyFunction(otherPartyUid, "ride_cancelled", {
        rideId,
        cancelledBy: cancellerType,
        reason: reason,
        fee: cancellationFee > 0 ? cancellationFee : null,
      });
      console.log(
        `[Ride Lifecycle] Notified ${otherPartyUid} of ride cancellation for ${rideId}`
      );
    } else {
      console.log(
        `[Ride Lifecycle] No other party to notify for ride ${rideId} cancellation.`
      );
    }

    // --- TODO: Update Postgres Ride record ---

    console.log(
      `[Ride Lifecycle] ${cancellerType} ${cancellerUid} cancelled ride ${rideId}`
    );
    res.status(200).json({ message: "Ride cancelled successfully." });
  } catch (error) {
    console.error(
      `[Ride Lifecycle] Error cancelling ride ${req.params.rideId}:`,
      error
    );
    next(error);
  }
};

// --- Placeholder Helper Function for Fare Calculation ---
function calculateFare(pickupCoords, dropoffCoords, startTimeIsoString) {
  // --- TODO: Implement actual fare calculation ---
  // 1. Calculate distance using Haversine or Google Distance Matrix API
  // 2. Calculate duration (using startTime and current time, or from rideData if stored)
  // 3. Apply base fare, per km rate, per minute rate
  // 4. Consider surge pricing based on time/demand (complex)
  console.log("[Fare Calc] TODO: Implement actual fare calculation.");
  return Math.floor(Math.random() * 300) + 50; // Return random fare for now
}
