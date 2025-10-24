// src/api/webhooks/webhooks.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./webhooks.controller");

// IMPORTANT: Stripe webhook needs the raw request body for signature verification.
// We apply the raw body parser *only* to this specific route.
router.post(
  "/stripe",
  express.raw({ type: "application/json" }), // Use raw body parser here
  controller.handleStripeWebhook
);

// Add route for verification service webhook
router.post("/verification", controller.handleVerificationWebhook);

// Add routes for other webhooks if needed

module.exports = router;
