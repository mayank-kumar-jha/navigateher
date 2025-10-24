// src/api/community/community.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./community.controller");
// Import Auth Middleware
const { isAuth, isRider } = require("../../middleware/isAuth");
// Import Validation Rules & Handler
const {
  validateStartSharedJourney,
  validateUpdateSharedJourneyLocation, // Assuming you added this validation
  validateEndSharedJourney, // Assuming you added this validation
  handleValidationErrors,
} = require("../../middleware/validators");

// --- Protected Routes ---

// @route   POST /api/v1/community/start-journey
// @desc    Links two riders after successful video verification to start a shared journey
// @access  Private (Rider only)
router.post(
  "/start-journey",
  isAuth, // Must be logged in
  isRider, // Must be a rider
  validateStartSharedJourney, // Validate request body (other rider UID, start location)
  handleValidationErrors, // Handle validation errors
  controller.startSharedJourney // Proceed if valid
);

// @route   PUT /api/v1/community/journey/:journeyId/location
// @desc    Updates the location of the current user within a shared journey
// @access  Private (Rider who is part of the journey)
router.put(
  "/journey/:journeyId/location",
  isAuth, // Must be logged in
  isRider, // Must be a rider
  validateUpdateSharedJourneyLocation, // Validate journeyId (param) and location (body)
  handleValidationErrors, // Handle validation errors
  controller.updateSharedJourneyLocation // Proceed if valid
);

// @route   PUT /api/v1/community/journey/:journeyId/end
// @desc    Marks a shared journey as completed or cancelled by one of the riders
// @access  Private (Rider who is part of the journey)
router.put(
  "/journey/:journeyId/end",
  isAuth, // Must be logged in
  isRider, // Must be a rider
  validateEndSharedJourney, // Validate journeyId (param) and status/reason (body)
  handleValidationErrors, // Handle validation errors
  controller.endSharedJourney // Proceed if valid
);

module.exports = router;
