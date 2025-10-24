// src/utils/errorHandler.js

/**
 * Global Express error handling middleware.
 * Catches errors passed via next(error).
 * Logs the error and sends a generic error response to the client.
 */
const errorHandler = (error, req, res, next) => {
  // Log the error for server-side debugging
  console.error("--- Global Error Handler ---");
  console.error("Timestamp:", new Date().toISOString());
  console.error("Request Path:", req.path);
  // Avoid logging sensitive req.body data in production logs
  if (
    process.env.NODE_ENV === "development" &&
    req.body &&
    Object.keys(req.body).length > 0
  ) {
    console.error("Request Body:", req.body);
  }
  console.error("Error Stack:", error.stack || error); // Log the full stack trace

  let statusCode = 500;
  let message = "An unexpected error occurred. Please try again later."; // More user-friendly default

  // --- Customize response based on specific known error types ---

  // Sequelize Validation Errors (e.g., not null constraints, unique constraints)
  if (
    error.name === "SequelizeValidationError" ||
    error.name === "SequelizeUniqueConstraintError"
  ) {
    statusCode = 400; // Bad Request
    // Extract specific validation messages from Sequelize error object
    message =
      error.errors && error.errors.length > 0
        ? error.errors.map((e) => e.message).join(". ")
        : "Database validation failed.";
  }
  // Sequelize Connection/Database Errors
  else if (error.name?.startsWith("Sequelize")) {
    // Catch other Sequelize errors
    statusCode = 503; // Service Unavailable (database issue)
    message = "Database service is temporarily unavailable.";
    // In development, you might want more detail:
    // message = process.env.NODE_ENV === 'development' ? error.message : message;
  }
  // Stripe API Errors (includes Card Errors)
  else if (error.type?.startsWith("Stripe")) {
    statusCode = error.statusCode || 400; // Use Stripe's status code if available
    message = `Payment Error: ${error.message}`;
    // Specific handling for card errors
    if (error.type === "StripeCardError") {
      message = `Card Error: ${error.message}`;
    }
  }
  // Custom Errors with status property (e.g., from controllers/services)
  else if (error.status && typeof error.status === "number") {
    statusCode = error.status;
    message = error.message || "An error occurred."; // Use error's message if provided
  }
  // Firebase Authentication Errors
  else if (error.code && error.code.startsWith("auth/")) {
    statusCode = 401; // Unauthorized
    message = "Authentication failed."; // Generic message for security
    if (error.code === "auth/id-token-expired") {
      statusCode = 401; // Explicitly Unauthorized for expired token
      message = "Authentication token has expired. Please log in again.";
    } else if (error.code === "auth/user-not-found") {
      statusCode = 404;
      message = "User account not found.";
    }
    // Add more specific Firebase Auth error codes if needed
  }
  // Express Validator Errors (if not handled earlier) - Should ideally be handled in routes
  else if (Array.isArray(error.errors) && error.errors[0]?.msg) {
    // Basic check for express-validator format
    statusCode = 400;
    message = error.errors.map((e) => e.msg).join(". ");
  }

  // --- Send the final JSON response ---
  // Ensure response hasn't already been sent
  if (!res.headersSent) {
    res.status(statusCode).json({
      message: message,
      // Optionally include more details ONLY in development for debugging
      ...(process.env.NODE_ENV === "development" && {
        errorType: error.name,
        errorCode: error.code,
        // Provide a cleaner stack snippet in dev, avoid full stack exposure
        stackHint: error.stack?.split("\n")[1]?.trim(),
      }),
    });
  } else {
    // If headers already sent, maybe the error happened while streaming response?
    // Node's default handler might close the connection.
    console.error(
      "[ErrorHandler] Headers already sent, could not send error response."
    );
  }

  // Ensure `next` is not called with the error again if we handled it
};

module.exports = errorHandler;
