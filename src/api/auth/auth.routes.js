// src/api/auth/auth.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./auth.controller");
// Import validation rules and the error handler
const {
  validateRegistration,
  handleValidationErrors,
} = require("../../middleware/validators");
const { isAuth } = require("../../middleware/isAuth"); // Import isAuth for potential future use

// @route   POST /api/v1/auth/register
// @desc    Register a new user (rider or driver)
// @access  Public
router.post(
  "/register",
  validateRegistration, // Apply validation rules first
  handleValidationErrors, // Handle any errors from validation
  controller.registerUser // If validation passes, proceed to controller
);

// @route   POST /api/v1/auth/login
// @desc    Login a user by verifying their Firebase ID Token sent in header
// @access  Public (Requires Bearer token, verified in controller)
router.post(
  "/login",
  // No specific body validation needed here, token is in header
  // handleValidationErrors, // Could add if header validation was added
  controller.loginUser
);

// Example protected route for testing auth middleware later
// router.get('/verify-token', isAuth, (req, res) => {
//    res.status(200).json({ message: "Token is valid", user: req.user });
// });

module.exports = router;
