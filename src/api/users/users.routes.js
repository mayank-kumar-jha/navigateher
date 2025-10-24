// src/api/users/users.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./users.controller");
// Import Auth Middleware
const { isAuth } = require("../../middleware/isAuth");
// Import Validation Rules & Handler
const {
  validateUpdateProfile,
  handleValidationErrors,
} = require("../../middleware/validators");

// --- Protected Routes ---

// @route   GET /api/v1/users/me
// @desc    Get the profile of the currently logged-in user
// @access  Private (Requires valid token)
router.get(
  "/me",
  isAuth, // Check if logged in
  // No specific input validation needed for this GET request
  controller.getMyProfile // Proceed directly to controller
);

// @route   PUT /api/v1/users/me
// @desc    Update the profile of the currently logged-in user (e.g., name, phone, emergency contacts)
// @access  Private (Requires valid token)
router.put(
  "/me",
  isAuth, // Check if logged in
  validateUpdateProfile, // Validate the request body fields
  handleValidationErrors, // Handle validation errors
  controller.updateMyProfile // Proceed if valid
);

// --- Add other user-related routes here ---
// Example: Route to get another user's public profile (maybe limited info)
// Needs its own controller function and validation rules
// router.get('/:userId/profile', isAuth, validateUserIdParam, handleValidationErrors, controller.getUserProfile);

module.exports = router;
