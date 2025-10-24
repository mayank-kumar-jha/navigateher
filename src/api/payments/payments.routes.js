// src/api/payments/payments.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./payments.controller");
const { isAuth, isRider } = require("../../middleware/isAuth"); // Import auth middleware
const {
  validateRideIdParam,
  handleValidationErrors,
} = require("../../middleware/validators");

// --- Protected Routes ---

// @route   POST /api/v1/payments/create-intent/ride/:rideId
// @desc    Creates a Stripe Payment Intent for a specific ride to collect payment from the rider.
// @access  Private (Rider only)
router.post(
  "/create-intent/ride/:rideId",
  isAuth,
  isRider,
  validateRideIdParam,
  handleValidationErrors,
  controller.createRidePaymentIntent
);

// --- Add other payment routes as needed ---
// Example: Get user's payment history (requires isAuth)
// router.get('/history', isAuth, controller.getPaymentHistory);

// Example: Add a new payment method (requires isAuth)
// router.post('/add-method', isAuth, controller.addPaymentMethod);

// Example: Set default payment method (requires isAuth)
// router.put('/default-method', isAuth, controller.setDefaultMethod);

module.exports = router;
