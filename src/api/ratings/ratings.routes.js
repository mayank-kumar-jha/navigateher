// src/api/ratings/ratings.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./ratings.controller");
const { isAuth } = require("../../middleware/isAuth"); // Import auth middleware
const { body } = require("express-validator"); // For input validation
const {
  validateSubmitRating,
  handleValidationErrors,
} = require("../../middleware/validators");

// --- Protected Route ---

// @route   POST /api/v1/ratings/ride/:rideId
// @desc    Submit a rating (1-5) and optional comment for a completed ride.
// @access  Private (Requires valid Firebase token)
router.post(
  "/ride/:rideId",
  isAuth,
  validateSubmitRating,
  handleValidationErrors,
  controller.submitRideRating
);

// Add other rating-related routes if needed (e.g., get ratings for a user)

module.exports = router;
