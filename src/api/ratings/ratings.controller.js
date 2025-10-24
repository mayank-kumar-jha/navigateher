// src/api/ratings/ratings.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db
const { sequelize } = require("../../config/postgres"); // Sequelize instance for transactions
// Assuming models are loaded and attached in postgres.js or server.js
const { models } = require("../../config/postgres");
const { validationResult } = require("express-validator"); // To check validation results

/**
 * @description Submits a rating for a specific ride, updating both the ride record
 * and the average rating of the user being rated.
 */
exports.submitRideRating = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  // --- Input Validation ---
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Use a Sequelize transaction to ensure atomicity across Postgres updates if needed
  // const transaction = await sequelize.transaction(); // Uncomment if updating Postgres Ride/User models

  try {
    const { rideId } = req.params;
    const { rating, comment } = req.body; // rating (1-5), comment (optional string)
    const submitterUid = req.user.uid; // User submitting the rating (from isAuth)
    const submitterType = req.user.type; // 'rider' or 'driver'

    // --- 1. Fetch Ride Data from Firestore ---
    // (Assuming Firestore is the primary source for ongoing ride details)
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      // await transaction.rollback(); // Uncomment if using transaction
      return res.status(404).json({ message: "Ride not found." });
    }
    const rideData = rideDoc.data();

    // --- 2. Validation Checks ---
    // a) Check if ride is completed
    if (rideData.status !== "completed") {
      // await transaction.rollback(); // Uncomment if using transaction
      return res
        .status(400)
        .json({ message: "Cannot rate a ride that is not completed." });
    }

    // b) Determine who is being rated and check authorization/double-rating
    let targetUid; // Firebase UID of the user being rated
    let targetUserId; // Postgres ID of the user being rated (if needed)
    let updateFieldFirestore; // Field in Firestore Ride doc (e.g., 'driverRatingByRider')
    let updateFieldPostgres; // Field in Postgres Ride table (e.g., 'driverRatingByRider')
    let targetType; // 'rider' or 'driver'

    if (submitterType === "rider" && rideData.riderId === submitterUid) {
      if (
        rideData.driverRatingByRider !== undefined &&
        rideData.driverRatingByRider !== null
      ) {
        // await transaction.rollback();
        return res
          .status(400)
          .json({ message: "You have already rated this driver." });
      }
      targetUid = rideData.driverId;
      updateFieldFirestore = "driverRatingByRider";
      updateFieldPostgres = "driverRatingByRider";
      targetType = "driver";
    } else if (
      submitterType === "driver" &&
      rideData.driverId === submitterUid
    ) {
      if (
        rideData.riderRatingByDriver !== undefined &&
        rideData.riderRatingByDriver !== null
      ) {
        // await transaction.rollback();
        return res
          .status(400)
          .json({ message: "You have already rated this rider." });
      }
      targetUid = rideData.riderId;
      updateFieldFirestore = "riderRatingByDriver";
      updateFieldPostgres = "riderRatingByDriver";
      targetType = "rider";
    } else {
      // await transaction.rollback();
      return res
        .status(403)
        .json({ message: "You are not authorized to rate this ride." });
    }

    if (!targetUid) {
      // await transaction.rollback();
      return res
        .status(400)
        .json({
          message: "Cannot rate ride: Target user ID not found in ride data.",
        });
    }

    // --- 3. Update Ride Document/Record ---
    const rideUpdateData = {
      [updateFieldFirestore]: rating,
      [`${updateFieldFirestore}Comment`]: comment || null, // Add comment field
      updatedAt: new Date().toISOString(), // Keep track of updates
    };
    await rideRef.update(rideUpdateData);

    // --- TODO: Update corresponding Ride record in Postgres using Sequelize ---
    // Find the Postgres Ride ID (maybe stored in Firestore or queried by firestoreId)
    // Example:
    // const pgRide = await models.Ride.findOne({ where: { firestoreRideId: rideId } }); // Assuming you store firestore ID
    // if (pgRide) {
    //     await pgRide.update({ [updateFieldPostgres]: rating }, { transaction });
    // } else {
    //     console.warn(`[Ratings] Postgres Ride record not found for Firestore ID: ${rideId}`);
    // }

    // --- 4. Update Target User's Average Rating (in Firestore) ---
    const targetUserRef = db.collection("users").doc(targetUid);
    let newAverageRating = 0;
    let newRatingCount = 0;

    // Use a Firestore transaction for atomic read-modify-write
    try {
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(targetUserRef);
        if (!userDoc.exists) {
          // This should ideally not happen if UIDs are consistent
          throw new Error(
            `Rated user profile not found in Firestore (UID: ${targetUid}).`
          );
        }
        const userData = userDoc.data();
        const currentAvg = userData.ratings?.average || 0;
        const currentCount = userData.ratings?.count || 0;

        newRatingCount = currentCount + 1;
        // Calculate new average: (old_total + new_rating) / new_count
        newAverageRating =
          (currentAvg * currentCount + rating) / newRatingCount;

        t.update(targetUserRef, {
          ratings: {
            average: parseFloat(newAverageRating.toFixed(2)), // Store with 2 decimal places
            count: newRatingCount,
          },
          // Consider storing last rated timestamp?
        });
      });
      console.log(
        `[Ratings] Updated average rating for user ${targetUid} to ${newAverageRating.toFixed(
          2
        )} (${newRatingCount} ratings)`
      );
    } catch (transactionError) {
      console.error(
        "[Ratings] Firestore transaction failed while updating user rating:",
        transactionError
      );
      // Don't rollback Sequelize transaction here, let the main catch handle it.
      throw transactionError; // Re-throw to trigger main catch block
    }

    // --- TODO: Update corresponding User record in Postgres ---
    // Example:
    // await models.User.update(
    //     { averageRating: parseFloat(newAverageRating.toFixed(2)) },
    //     { where: { uid: targetUid }, transaction }
    // );

    // --- 5. Commit Transaction & Respond ---
    // await transaction.commit(); // Uncomment if using transaction
    res.status(200).json({ message: "Rating submitted successfully." });
  } catch (error) {
    // await transaction.rollback(); // Uncomment if using transaction
    console.error("[Ratings] Error submitting rating:", error);
    next(error); // Pass to global error handler
  }
};
