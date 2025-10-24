// src/middleware/validator.js
const { body, validationResult } = require("express-validator");

// --- Validation Rules ---

exports.validateRegistration = [
  body("email", "Please include a valid email").isEmail().normalizeEmail(),
  body("password", "Password must be at least 6 characters").isLength({
    min: 6,
  }),
  body("name", "Name is required").not().isEmpty().trim().escape(),
  body("userType", "User type must be rider or driver").isIn([
    "rider",
    "driver",
  ]),
  // Add validation for phone number, etc. if needed
];

exports.validateLogin = [
  // We only need the token in the header for Firebase login
  // If using email/password login directly via API, add rules here:
  // body('email', 'Please include a valid email').isEmail().normalizeEmail(),
  // body('password', 'Password is required').exists(),
];

exports.validateProfileUpdate = [
  body("name").optional().not().isEmpty().trim().escape(),
  body("phone")
    .optional()
    .isMobilePhone("any", { strictMode: false })
    .withMessage("Invalid phone number"),
  // Allow updating emergency contacts - expect an array of objects
  body("emergencyContacts")
    .optional()
    .isArray()
    .withMessage("Emergency contacts must be an array"),
  body("emergencyContacts.*.name")
    .optional()
    .notEmpty()
    .trim()
    .escape()
    .withMessage("Contact name cannot be empty"),
  body("emergencyContacts.*.phone")
    .optional()
    .isMobilePhone("any", { strictMode: false })
    .withMessage("Invalid contact phone number"),
  // Add other fields as needed (e.g., vehicle details for drivers)
];

exports.validateGetRoutes = [
  body("origin", "Origin {lat, lng} is required").isObject(),
  body("origin.lat", "Origin latitude is required").isNumeric(),
  body("origin.lng", "Origin longitude is required").isNumeric(),
  body("destination", "Destination {lat, lng} is required").isObject(),
  body("destination.lat", "Destination latitude is required").isNumeric(),
  body("destination.lng", "Destination longitude is required").isNumeric(),
  body("time")
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage("Invalid time format HH:MM"),
];

exports.validateRequestRide = [
  // Assuming riderId comes from authenticated user (req.user.uid)
  body("pickupLocation", "Pickup location {lat, lng} is required").isObject(),
  body("pickupLocation.lat", "Pickup latitude is required").isNumeric(),
  body("pickupLocation.lng", "Pickup longitude is required").isNumeric(),
  body(
    "destinationLocation",
    "Destination location {lat, lng} is required"
  ).isObject(),
  body(
    "destinationLocation.lat",
    "Destination latitude is required"
  ).isNumeric(),
  body(
    "destinationLocation.lng",
    "Destination longitude is required"
  ).isNumeric(),
  body("routePolyline", "Route polyline is required").notEmpty().isString(),
];

exports.validateStartJourney = [
  // Assuming riderAUid comes from authenticated user (req.user.uid)
  body("riderBUid", "UID of the other rider is required").isString().notEmpty(),
  body("startLocation", "Start location {lat, lng} is required").isObject(),
  body("startLocation.lat", "Start latitude is required").isNumeric(),
  body("startLocation.lng", "Start longitude is required").isNumeric(),
];

exports.validateSOS = [
  body("location", "Current location {lat, lng} is required").isObject(),
  body("location.lat", "Latitude is required").isNumeric(),
  body("location.lng", "Longitude is required").isNumeric(),
  body("message").optional().isString().trim().escape(),
];

exports.validateRating = [
  body("rideId", "Ride ID is required").isString().notEmpty(), // Or isUUID if using UUIDs for rides
  body("ratedUserId", "UID of the user being rated is required")
    .isString()
    .notEmpty(),
  body("rating", "Rating must be between 1 and 5").isInt({ min: 1, max: 5 }),
  body("comment").optional().isString().trim().escape(),
];

// --- Validation Handler Middleware ---

exports.handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Log the validation errors for debugging
    console.error("Validation Errors:", errors.array());
    // Return a 400 Bad Request with the first error message
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  next(); // Proceed if no errors
};
