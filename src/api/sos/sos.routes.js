// src/api/sos/sos.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./sos.controller");
const { isAuth } = require("../../middleware/isAuth"); // Import auth middleware
const { body } = require("express-validator"); // For input validation
const {
  validateTriggerSOS,
  handleValidationErrors,
} = require("../../middleware/validators");

// --- Protected Route ---

// @route   POST /api/v1/sos/trigger
// @desc    Trigger an SOS alert for the currently authenticated user
// @access  Private (Requires valid Firebase token)
router.post(
  "/trigger",
  isAuth,
  validateTriggerSOS,
  handleValidationErrors,
  controller.triggerSOS
);

// Add routes for cancelling SOS or for safety team actions if needed later

module.exports = router;
