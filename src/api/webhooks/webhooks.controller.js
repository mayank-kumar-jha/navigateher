// src/api/webhooks/webhooks.controller.js

// Import the entire config module, don't destructure db or auth at the top level
const firebaseConfig = require("../../config/firebase");
// Assuming stripeService.js exports an initialized instance or a getter
const stripeService = require("../../services/stripeService");
// Retrieve secrets from environment variables
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const VERIFICATION_WEBHOOK_TOKEN = process.env.VERIFICATION_WEBHOOK_TOKEN; // Example for token auth

/**
 * @description Handles incoming webhook events from Stripe.
 * Verifies the signature and processes relevant events like payment success/failure.
 * @route POST /api/v1/webhooks/stripe
 * @access Public (secured by Stripe signature verification)
 */
exports.handleStripeWebhook = async (req, res) => {
  // Get Stripe instance and webhook secret safely inside the function
  const stripe = stripeService?.stripeInstance;
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error(
      "[Stripe Webhook] Stripe service or webhook secret not configured properly in .env or stripeService.js."
    );
    // Return 500 because this is a server configuration issue
    return res.status(500).send("Webhook configuration error.");
  }

  // IMPORTANT: Stripe requires the raw request body.
  // Ensure `express.raw({ type: 'application/json' })` middleware is applied to this specific route.
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Verify the event came from Stripe using the webhook signing secret
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      STRIPE_WEBHOOK_SECRET
    );
    console.log(
      `[Stripe Webhook] Received verified event: ${event.type} (${event.id})`
    );
  } catch (err) {
    // On error, log and respond to Stripe
    console.error(
      `[Stripe Webhook] ⚠️ Webhook signature verification failed:`,
      err.message
    );
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Get Firestore db instance ONLY when needed
  const { db } = firebaseConfig;

  // Handle the event based on its type
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log(
          `[Stripe Webhook] PaymentIntent successful: ${paymentIntent.id}`
        );
        const rideId = paymentIntent.metadata?.rideId; // Get associated ride ID
        if (rideId) {
          const rideRef = db.collection("rides").doc(rideId);
          await rideRef.update({
            paymentStatus: "paid",
            stripePaymentIntentId: paymentIntent.id, // Store the successful PI ID
          });
          console.log(
            `[Stripe Webhook] Updated Firestore ride ${rideId} paymentStatus to 'paid'.`
          );
          // TODO: Update Postgres Ride record as well
          // const { models } = require('../../config/postgres');
          // await models.Ride.update({ paymentStatus: 'paid', stripePaymentIntentId: paymentIntent.id }, { where: { firestoreRideId: rideId } });

          // TODO: Notify rider/driver of successful payment?
        } else {
          console.warn(
            `[Stripe Webhook] PaymentIntent ${paymentIntent.id} succeeded but missing 'rideId' metadata.`
          );
        }
        break;

      case "payment_intent.payment_failed":
        const failedPaymentIntent = event.data.object;
        const failureMessage =
          failedPaymentIntent.last_payment_error?.message || "Unknown reason";
        console.log(
          `[Stripe Webhook] PaymentIntent failed: ${failedPaymentIntent.id}. Reason: ${failureMessage}`
        );
        const failedRideId = failedPaymentIntent.metadata?.rideId;
        if (failedRideId) {
          const failedRideRef = db.collection("rides").doc(failedRideId);
          await failedRideRef.update({
            paymentStatus: "failed",
            stripePaymentIntentId: failedPaymentIntent.id, // Store failed PI ID
          });
          console.log(
            `[Stripe Webhook] Updated Firestore ride ${failedRideId} paymentStatus to 'failed'.`
          );
          // TODO: Update Postgres Ride record as well
          // TODO: Notify rider of payment failure via Socket.IO or Push Notification
          // const rideData = (await failedRideRef.get()).data();
          // const { notifyRider } = req.app.get('socketHelpers'); // Requires passing req or io somehow
          // if (rideData && notifyRider) {
          //     notifyRider(rideData.riderId, 'payment_failed', { rideId: failedRideId, reason: failureMessage });
          // }
        } else {
          console.warn(
            `[Stripe Webhook] PaymentIntent ${failedPaymentIntent.id} failed but missing 'rideId' metadata.`
          );
        }
        break;

      // --- Handle other necessary Stripe Connect events ---
      case "account.updated":
        const account = event.data.object;
        console.log(
          `[Stripe Webhook] Connected account updated: ${account.id}, Charges enabled: ${account.charges_enabled}, Payouts enabled: ${account.payouts_enabled}`
        );
        const driverUid = account.metadata?.firebaseUid; // Assume you store firebaseUid in Stripe metadata when creating account
        if (driverUid) {
          // Update driver's payout readiness status in Firestore
          await db
            .collection("users")
            .doc(driverUid)
            .update({
              stripeAccountStatus: {
                // Example structure
                chargesEnabled: account.charges_enabled,
                payoutsEnabled: account.payouts_enabled,
                detailsSubmitted: account.details_submitted,
              },
              stripeAccountId: account.id, // Ensure Stripe Account ID is stored
            });
          console.log(
            `[Stripe Webhook] Updated Stripe status for driver ${driverUid}.`
          );
          // TODO: Update Postgres User record as well
        } else {
          console.warn(
            `[Stripe Webhook] Account ${account.id} updated but missing 'firebaseUid' metadata.`
          );
        }
        break;

      case "payout.paid":
        const payout = event.data.object;
        console.log(
          `[Stripe Webhook] Payout paid: ${payout.id} (Amount: ${
            payout.amount / 100
          } ${payout.currency}) to account ${payout.destination}`
        );
        // TODO: Record payout details in a separate 'payouts' table/collection if needed for accounting
        break;

      case "payout.failed":
        const failedPayout = event.data.object;
        console.error(
          `[Stripe Webhook] Payout failed: ${failedPayout.id} to account ${
            failedPayout.destination
          }. Failure: ${failedPayout.failure_message || "Unknown"}`
        );
        // TODO: Notify admin or the driver via email/push notification
        break;

      // Add cases for other events like 'charge.refunded', 'customer.subscription.deleted' etc. if needed

      default:
        // Acknowledge event types you don't explicitly handle
        console.log(
          `[Stripe Webhook] Received unhandled event type: ${event.type}`
        );
    }
  } catch (dbOrProcessingError) {
    // Catch errors during Firestore/Postgres updates or other logic
    console.error(
      `[Stripe Webhook] Error processing event ${event.id} (${event.type}):`,
      dbOrProcessingError
    );
    // Return 500 so Stripe knows something went wrong and might retry
    return res
      .status(500)
      .send("Internal server error processing webhook event.");
  }

  // Return a 200 response to acknowledge successful receipt of the event to Stripe
  res.status(200).json({ received: true });
};

/**
 * @description Handles incoming webhook events from a verification service (e.g., IDfy, Onfido).
 * Verifies the source and updates user verification status in Firestore.
 * @route POST /api/v1/webhooks/verification
 * @access Public (secured by token/signature verification)
 */
exports.handleVerificationWebhook = async (req, res) => {
  // Get db instance inside the function
  const { db } = firebaseConfig;

  // --- 1. Verify Webhook Source ---
  // IMPORTANT: Replace this placeholder with your chosen provider's actual security mechanism!
  // Example using a simple token in the header:
  if (!VERIFICATION_WEBHOOK_TOKEN) {
    console.error(
      "[Verification Webhook] VERIFICATION_WEBHOOK_TOKEN is not set in .env. Cannot verify webhook."
    );
    return res.status(500).send("Webhook configuration error.");
  }
  const receivedToken = req.headers["x-verification-token"]; // Adjust header name as needed
  if (receivedToken !== VERIFICATION_WEBHOOK_TOKEN) {
    console.warn(
      "[Verification Webhook] Unauthorized: Invalid or missing verification token."
    );
    // Log detailed headers ONLY in development for debugging
    if (process.env.NODE_ENV === "development") {
      console.log("Received Headers:", req.headers);
    }
    return res.status(401).send("Unauthorized");
  }
  // If using signature verification (like Stripe), implement that here instead.

  console.log(
    "[Verification Webhook] Received verified webhook payload:",
    JSON.stringify(req.body, null, 2)
  ); // Log payload for debugging
  const payload = req.body;

  try {
    // --- 2. Extract Data (Adapt structure based on provider) ---
    // These are common fields, adjust names based on IDfy/Onfido/Checkr docs
    const verificationStatus = payload.status;
    const userIdentifier =
      payload.userId ||
      payload.applicant_id ||
      payload.external_user_id ||
      payload.reference_id; // The ID you passed when starting
    const checkResult = payload.result || payload.summary?.result; // e.g., 'clear', 'consider', 'rejected'
    const reportId = payload.report_id || payload.id;
    const failureReason =
      payload.failure_reason ||
      payload.result_details?.failure_reason ||
      payload.breakdown?.result; // May vary

    if (!userIdentifier) {
      console.error(
        "[Verification Webhook] Missing user identifier (e.g., userId, applicant_id) in payload."
      );
      // Send 400 Bad Request as the payload is invalid
      return res
        .status(400)
        .send("Missing user identifier in webhook payload.");
    }

    const userRef = db.collection("users").doc(userIdentifier);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error(
        `[Verification Webhook] User ${userIdentifier} referenced in webhook not found in Firestore.`
      );
      // Acknowledge receipt (200 OK) so provider doesn't retry indefinitely for a user that doesn't exist here.
      return res
        .status(200)
        .json({ received: true, error: "User not found in our system." });
    }

    // --- 3. Process Based on Status ---
    let updatePayload = {
      // Build the object to update in Firestore
      verificationStatus: verificationStatus, // Store the latest status text
      lastVerificationResult: checkResult || null, // Store 'clear', 'consider' etc.
      lastVerificationReportId: reportId || null, // Store reference to the report
      lastVerificationCheckedAt: new Date().toISOString(), // Track when webhook was processed
    };
    let isVerifiedValue = null; // Use null initially

    // Map provider's status/result to your internal `isVerified` boolean
    // This logic NEEDS to be adjusted based on your provider's specific responses
    if (
      verificationStatus === "completed" ||
      verificationStatus === "complete"
    ) {
      // Only mark as verified if the result is definitively 'clear'
      isVerifiedValue = checkResult === "clear";
      updatePayload.isVerified = isVerifiedValue;
      if (isVerifiedValue) {
        updatePayload.verifiedAt = new Date().toISOString(); // Record time of successful verification
      }
      console.log(
        `[Verification Webhook] Verification completed for user ${userIdentifier}. Result: ${checkResult}. Setting isVerified: ${isVerifiedValue}`
      );
      // TODO: Notify the user via push notification or Socket.IO?
    } else if (verificationStatus === "failed" || checkResult === "rejected") {
      isVerifiedValue = false; // Explicitly mark as not verified on failure/rejection
      updatePayload.isVerified = isVerifiedValue;
      console.log(
        `[Verification Webhook] Verification failed or rejected for user ${userIdentifier}. Reason: ${
          failureReason || "See report"
        }`
      );
      // TODO: Notify user? Provide info on how to retry/contact support?
    } else {
      // Handle intermediate statuses ('pending', 'action_required', 'review', 'processing')
      // Do NOT change the isVerified flag for these statuses.
      console.log(
        `[Verification Webhook] Received intermediate status '${verificationStatus}' for user ${userIdentifier}.`
      );
    }

    // --- 4. Update User in Firestore ---
    await userRef.update(updatePayload);
    console.log(
      `[Verification Webhook] Updated Firestore user ${userIdentifier} verification status.`
    );
    // TODO: Update Postgres User record as well?
    // const { models } = require('../../config/postgres');
    // await models.User.update({ isVerified: isVerifiedValue, verificationStatus: verificationStatus }, { where: { uid: userIdentifier } });

    // --- 5. Acknowledge Receipt ---
    // Send 200 OK back to the verification service quickly
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Verification Webhook] Error processing webhook:", error);
    // Send 500 Internal Server Error so the provider might retry (check provider docs)
    res
      .status(500)
      .send("Internal Server Error processing verification webhook.");
  }
};

// Add handlers for other webhooks (e.g., Twilio message status callbacks) if needed
