// src/middleware/validators.js

const { body, param, validationResult } = require("express-validator");

// --- Validation Rules ---

exports.validateRegistration = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address."),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long."),
  body("name").trim().notEmpty().withMessage("Name is required."),
  body("userType")
    .isIn(["rider", "driver"])
    .withMessage("User type must be either rider or driver."),
  body("phoneNumber")
    .optional({ checkFalsy: true })
    .isMobilePhone("any", { strictMode: false })
    .withMessage("Invalid phone number format."), // Optional validation
];

exports.validateLogin = [
  // We rely on Firebase token verification, but could add basic header check
  // header('Authorization').startsWith('Bearer ').withMessage('Authorization header format is Bearer <token>')
  // No body validation needed here as we only use the token from the header
];

exports.validateGetSafestRoutes = [
  body("origin").isObject().withMessage("Origin object is required."),
  body("origin.lat")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Valid origin latitude is required."),
  body("origin.lng")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Valid origin longitude is required."),
  body("destination").isObject().withMessage("Destination object is required."),
  body("destination.lat")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Valid destination latitude is required."),
  body("destination.lng")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Valid destination longitude is required."),
  body("time")
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage("Time must be in HH:MM format (e.g., 21:30)."),
];

exports.validateRequestRide = [
  body("pickupLocation").isObject(),
  body("pickupLocation.lat").isFloat({ min: -90, max: 90 }),
  body("pickupLocation.lng").isFloat({ min: -180, max: 180 }),
  body("destinationLocation").isObject(),
  body("destinationLocation.lat").isFloat({ min: -90, max: 90 }),
  body("destinationLocation.lng").isFloat({ min: -180, max: 180 }),
  body("routePolyline")
    .isString()
    .notEmpty()
    .withMessage("Route polyline is required."),
];

exports.validateRideIdParam = [
  param("rideId")
    .isString()
    .notEmpty()
    .withMessage("Ride ID parameter is required."),
  // Add specific format check if your ride IDs have one (e.g., isUUID, isLength)
];

exports.validateCompleteRide = [
  // Validate rideId in the path
  param("rideId")
    .isString()
    .notEmpty()
    .withMessage("Ride ID parameter is required."),
  // Validate optional finalLocation in the body
  body("finalLocation").optional().isObject(),
  body("finalLocation.lat").optional().isFloat({ min: -90, max: 90 }),
  body("finalLocation.lng").optional().isFloat({ min: -180, max: 180 }),
];

exports.validateCancelRide = [
  param("rideId")
    .isString()
    .notEmpty()
    .withMessage("Ride ID parameter is required."),
  body("reason").optional().isString().trim().isLength({ max: 200 }).escape(), // Escape potentially harmful chars
];

exports.validateStartSharedJourney = [
  body("riderBUid")
    .isString()
    .notEmpty()
    .withMessage("The other rider's UID is required."),
  body("startLocation").isObject(),
  body("startLocation.lat").isFloat({ min: -90, max: 90 }),
  body("startLocation.lng").isFloat({ min: -180, max: 180 }),
];

exports.validateUpdateSharedJourneyLocation = [
  param("journeyId")
    .isString()
    .notEmpty()
    .withMessage("Journey ID parameter is required."),
  body("location").isObject(),
  body("location.lat").isFloat({ min: -90, max: 90 }),
  body("location.lng").isFloat({ min: -180, max: 180 }),
];

exports.validateEndSharedJourney = [
  param("journeyId")
    .isString()
    .notEmpty()
    .withMessage("Journey ID parameter is required."),
  body("status")
    .isIn(["completed", "cancelled"])
    .withMessage("Status must be 'completed' or 'cancelled'."),
  body("reason")
    .optional()
    .if(body("status").equals("cancelled"))
    .isString()
    .trim()
    .isLength({ max: 200 })
    .escape(),
];

exports.validateUpdateProfile = [
  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Name cannot be empty."),
  body("phoneNumber")
    .optional({ checkFalsy: true })
    .isMobilePhone("any", { strictMode: false })
    .withMessage("Invalid phone number format."),
  body("emergencyContacts")
    .optional()
    .isArray()
    .withMessage("Emergency contacts must be an array."),
  // Validate structure within the array
  body("emergencyContacts.*.name")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Contact name cannot be empty."),
  body("emergencyContacts.*.phone")
    .optional()
    .isMobilePhone("any", { strictMode: false })
    .withMessage("Invalid contact phone number format."),
  body("profilePictureUrl")
    .optional({ checkFalsy: true })
    .isURL()
    .withMessage("Invalid URL format for profile picture."),
  // Add validation for driver-specific fields if needed
];

exports.validateTriggerSOS = [
  body("location").isObject(),
  body("location.lat").isFloat({ min: -90, max: 90 }),
  body("location.lng").isFloat({ min: -180, max: 180 }),
];

exports.validateSubmitRating = [
  param("rideId")
    .isString()
    .notEmpty()
    .withMessage("Ride ID parameter is required."),
  body("rating")
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be an integer between 1 and 5."),
  body("comment").optional().isString().trim().isLength({ max: 500 }).escape(), // Limit length and escape
];

// --- Middleware to Handle Validation Results ---
// This function checks if any validation rules failed
exports.handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Log the detailed errors for debugging
    console.warn("[Validation Error]", JSON.stringify(errors.array()));
    // Send a 400 Bad Request response with the first error message
    return res
      .status(400)
      .json({ message: errors.array()[0].msg, errors: errors.array() });
  }
  // If no errors, proceed to the next middleware/controller
  next();
};
