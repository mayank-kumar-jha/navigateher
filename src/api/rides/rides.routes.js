// src/api/rides/rides.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./rides.controller");
// Import Auth Middleware
const { isAuth, isRider, isDriver } = require("../../middleware/isAuth");
// Import Validation Rules & Handler
const {
  validateGetSafestRoutes,
  validateRequestRide,
  validateRideIdParam,
  validateCompleteRide,
  validateCancelRide,
  handleValidationErrors, // Import the error handler
} = require("../../middleware/validators");

// --- Protected Routes ---

// @route   POST /api/v1/rides/get-routes
// @desc    Get safest route alternatives based on origin, destination, and time.
// @access  Private (Requires any logged-in user)
router.post(
  "/get-routes",
  isAuth, // Check if logged in
  validateGetSafestRoutes, // Validate request body
  handleValidationErrors, // Handle validation errors
  controller.getSafestRoutes // Proceed if valid
);

// @route   POST /api/v1/rides/request
// @desc    Rider requests a ride after selecting a route, triggering driver search.
// @access  Private (Rider only)
router.post(
  "/request",
  isAuth, // Check if logged in
  isRider, // Check if user is a rider
  validateRequestRide, // Validate request body
  handleValidationErrors, // Handle validation errors
  controller.requestRide // Proceed if valid
);

// @route   GET /api/v1/rides/:rideId
// @desc    Get details of a specific ride (for rider or driver involved)
// @access  Private (Rider or Driver of the ride)
router.get(
  "/:rideId",
  isAuth, // Check if logged in
  validateRideIdParam, // Validate rideId in URL
  handleValidationErrors, // Handle validation errors
  controller.getRideDetails // Proceed if valid
);

// @route   PUT /api/v1/rides/:rideId/arrive
// @desc    Driver marks arrival at pickup location
// @access  Private (Driver of the ride only)
router.put(
  "/:rideId/arrive",
  isAuth, // Check if logged in
  isDriver, // Check if user is a driver
  validateRideIdParam, // Validate rideId in URL
  handleValidationErrors, // Handle validation errors
  controller.markArrived // Proceed if valid
);

// @route   PUT /api/v1/rides/:rideId/start
// @desc    Driver starts the ride after pickup
// @access  Private (Driver of the ride only)
router.put(
  "/:rideId/start",
  isAuth,
  isDriver,
  validateRideIdParam,
  handleValidationErrors,
  controller.startRide
);

// @route   PUT /api/v1/rides/:rideId/complete
// @desc    Driver completes the ride at destination
// @access  Private (Driver of the ride only)
router.put(
  "/:rideId/complete",
  isAuth,
  isDriver,
  validateCompleteRide, // Validate rideId (param) and optional body
  handleValidationErrors,
  controller.completeRide
);

// @route   PUT /api/v1/rides/:rideId/cancel
// @desc    Cancel an ongoing or requested ride
// @access  Private (Rider or Driver of the ride only)
router.put(
  "/:rideId/cancel",
  isAuth, // Rider OR Driver can cancel
  validateCancelRide, // Validate rideId (param) and optional reason (body)
  handleValidationErrors,
  controller.cancelRide
);

module.exports = router;
