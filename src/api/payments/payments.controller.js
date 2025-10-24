// src/api/payments/payments.controller.js

const firebaseConfig = require("../../config/firebase"); // Use getters for db
const { stripeInstance: stripe } = require("../../services/stripeService"); // Get initialized Stripe instance
// Assuming models are loaded and attached in postgres.js or server.js
const { models } = require("../../config/postgres");

/**
 * @description Creates a Stripe Payment Intent for a specific ride.
 * This is called by the rider's app before confirming payment.
 * It returns a client_secret that the app uses to finalize the payment with Stripe's SDK.
 */
exports.createRidePaymentIntent = async (req, res, next) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;
  try {
    const { rideId } = req.params;
    const riderUid = req.user.uid; // Rider UID from isAuth middleware

    // --- 1. Fetch Ride Data (Fare, Driver ID, Rider ID) ---
    // Prioritize fetching from Postgres as the 'source of truth' for completed rides/fares
    // Fallback to Firestore if needed or if Postgres model isn't fully implemented yet.
    let rideData = null;
    let driverData = null; // To get Stripe Connect Account ID

    // Option A: Fetch from Postgres (Recommended for structured data)
    const pgRide = await models.Ride?.findOne({
      where: { firestoreRideId: rideId },
    }); // Need firestoreRideId field in Ride model
    if (pgRide) {
      rideData = pgRide.toJSON();
      // Fetch driver details if needed for Stripe Connect
      if (rideData.driverId) {
        const pgDriver = await models.User?.findByPk(rideData.driverId);
        if (pgDriver) driverData = pgDriver.toJSON();
      }
    } else {
      // Option B: Fallback to Firestore
      const rideDoc = await db.collection("rides").doc(rideId).get();
      if (rideDoc.exists) {
        rideData = rideDoc.data();
        rideData.id = rideDoc.id; // Add Firestore ID
        // Fetch driver details if needed for Stripe Connect
        if (rideData.driverId) {
          // Assumes driverId is Firebase UID here
          const driverDoc = await db
            .collection("users")
            .doc(rideData.driverId)
            .get();
          if (driverDoc.exists) driverData = driverDoc.data();
        }
      }
    }

    // --- 2. Validation ---
    if (!rideData) {
      return res.status(404).json({ message: "Ride not found." });
    }
    // Ensure the authenticated user is the rider for this ride
    // Adjust field names based on which source (Postgres/Firestore) was used
    const rideRiderUid = rideData.riderFirebaseUid || rideData.riderId;
    if (rideRiderUid !== riderUid) {
      return res
        .status(403)
        .json({ message: "Forbidden: You cannot pay for this ride." });
    }
    // Ensure fare is calculated and ride is in a payable state
    if (
      rideData.status !== "completed" ||
      !rideData.actualFare ||
      rideData.actualFare <= 0
    ) {
      return res
        .status(400)
        .json({ message: "Ride cannot be paid for (invalid state or fare)." });
    }
    if (rideData.paymentStatus === "paid") {
      return res
        .status(400)
        .json({ message: "This ride has already been paid." });
    }

    // --- 3. Get or Create Stripe Customer ID ---
    const stripeCustomerId = await getOrCreateStripeCustomer(
      db,
      riderUid,
      req.user.email
    ); // Pass db instance

    // --- 4. Prepare Payment Intent Data ---
    const amountInPaisa = Math.round(rideData.actualFare * 100); // Amount must be in smallest unit (e.g., paisa for INR)
    const currency = process.env.STRIPE_CURRENCY || "inr"; // Get from env or default

    const paymentIntentData = {
      amount: amountInPaisa,
      currency: currency,
      customer: stripeCustomerId,
      // setup_future_usage: 'off_session', // Optional: Save card for later? Requires careful handling
      metadata: {
        // Attach internal IDs for reconciliation via webhooks
        rideId: rideId,
        riderUid: riderUid,
        driverUid: rideData.driverFirebaseUid || rideData.driverId || "N/A",
      },
    };

    // --- 5. Add Stripe Connect Data (for Driver Payouts) ---
    // This assumes you are using Stripe Connect Standard/Express accounts
    const driverStripeAccountId = driverData?.stripeAccountId; // Get from driver's profile

    if (driverStripeAccountId) {
      const applicationFeeAmount = calculateApplicationFee(amountInPaisa); // Your commission
      if (applicationFeeAmount >= 0) {
        // Ensure fee is non-negative
        paymentIntentData.application_fee_amount = applicationFeeAmount;
        paymentIntentData.transfer_data = {
          destination: driverStripeAccountId,
        };
        console.log(
          `[Payments] Stripe Connect: Routing payment to ${driverStripeAccountId}, fee: ${applicationFeeAmount}`
        );
      } else {
        console.warn(
          `[Payments] Invalid application fee calculated (${applicationFeeAmount}), skipping Connect transfer.`
        );
      }
    } else {
      console.warn(
        `[Payments] Driver Stripe Account ID not found for ride ${rideId}. Cannot perform Connect transfer.`
      );
      // Decide how to handle this - fail payment? Hold funds?
    }

    // --- 6. Create the Stripe Payment Intent ---
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    console.log(
      `[Payments] Created PaymentIntent ${paymentIntent.id} for ride ${rideId}`
    );

    // --- TODO: Update Ride status to 'processing_payment'? ---
    // await db.collection('rides').doc(rideId).update({ paymentStatus: 'processing', stripePaymentIntentId: paymentIntent.id });
    // await models.Ride.update({ paymentStatus: 'processing', stripePaymentIntentId: paymentIntent.id }, { where: { firestoreRideId: rideId } });

    // --- 7. Send Client Secret to App ---
    // The app uses this secret with Stripe's mobile SDK to confirm the payment
    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: rideData.actualFare,
      currency: currency,
    });
  } catch (error) {
    console.error("[Payments] Error creating payment intent:", error);
    // Provide a more specific error message if it's a Stripe error
    if (error.type === "StripeCardError") {
      return res
        .status(400)
        .json({ message: `Payment failed: ${error.message}` });
    }
    next(error); // Pass to global handler
  }
};

// --- Helper Functions ---

/**
 * Gets a Stripe Customer ID for a user, creating one if it doesn't exist.
 * Stores the ID in the user's Firestore profile.
 * @param {FirebaseFirestore.Firestore} dbInstance - Firestore instance.
 * @param {string} userUid - Firebase UID.
 * @param {string} userEmail - User's email.
 * @returns {Promise<string>} Stripe Customer ID (e.g., 'cus_xxx').
 */
async function getOrCreateStripeCustomer(dbInstance, userUid, userEmail) {
  const userRef = dbInstance.collection("users").doc(userUid);
  try {
    const userDoc = await userRef.get();
    if (userDoc.exists && userDoc.data()?.stripeCustomerId) {
      return userDoc.data().stripeCustomerId;
    } else {
      console.log(`[Payments] Creating Stripe customer for UID: ${userUid}`);
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { firebaseUid: userUid },
      });
      // Save the new ID back to the user's profile
      await userRef.set({ stripeCustomerId: customer.id }, { merge: true });
      return customer.id;
    }
  } catch (error) {
    console.error(
      `[Payments] Error getting/creating Stripe customer for ${userUid}:`,
      error
    );
    throw new Error("Could not retrieve or create payment profile."); // Throw error to be caught by controller
  }
}

/**
 * Calculates your application fee (commission) in the smallest currency unit.
 * @param {number} totalAmountInSmallestUnit - Total transaction amount (e.g., in paisa).
 * @returns {number} The amount you take as commission.
 */
function calculateApplicationFee(totalAmountInSmallestUnit) {
  const commissionRate = parseFloat(process.env.APP_COMMISSION_RATE || "0.15"); // e.g., 0.15 for 15%
  if (isNaN(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
    console.error(
      `[Payments] Invalid APP_COMMISSION_RATE: ${process.env.APP_COMMISSION_RATE}. Defaulting to 0.`
    );
    return 0; // Default to no fee if rate is invalid
  }
  const fee = Math.round(totalAmountInSmallestUnit * commissionRate);
  // Stripe has minimums for application fees, ensure it's not too small (e.g., min 50 cents/INR equiv)
  const minFee = 50; // Example minimum fee in paisa/cents
  return Math.max(fee, minFee);
}

// --- Placeholder for other payment functions ---
// exports.getPaymentHistory = async (req, res, next) => { ... };
// exports.addPaymentMethod = async (req, res, next) => { ... };
// exports.setDefaultMethod = async (req, res, next) => { ... };
