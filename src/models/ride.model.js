const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Ride = sequelize.define(
    "Ride",
    {
      // Use standard 'id' with UUID for database primary key (Best Practice for PG)
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4, // Auto-generate UUIDs
        primaryKey: true,
        allowNull: false,
      },
      // Optional: Store the Firestore ID separately if needed for linking live data
      firestoreRideId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      riderUid: { // Foreign key to User model (Firebase UID)
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "users", key: "uid" },
      },
      driverUid: { // Foreign key to User model (Firebase UID)
        type: DataTypes.STRING,
        allowNull: true, // Driver might not be assigned/accept initially
        references: { model: "users", key: "uid" },
      },
      status: {
        type: DataTypes.ENUM(
          "pending", // Rider requested, searching for driver
          "rejected", // A driver rejected, searching for next
          "accepted", // Driver accepted, en route to pickup
          "arrived", // Driver arrived at pickup
          "started", // Ride is in progress
          "completed", // Ride finished successfully
          "cancelled_rider", // Rider cancelled
          "cancelled_driver", // Driver cancelled
          "no_drivers" // Failed to find any driver
        ),
        allowNull: false,
        defaultValue: "pending",
      },

       // --- CHANGED TO JSONB (Fixes "geometry does not exist" error) ---
       // We will store location as { lat: 28.123, lng: 77.123 }
      pickupLocation: {
        type: DataTypes.JSONB, 
        allowNull: false,
      },
      destinationLocation: {
        type: DataTypes.JSONB, 
        allowNull: false,
      },
      // --------------------------------------------------------------

      // Optional: Human-readable address
      pickupAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      destinationAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Store the chosen route (or the one actually taken)
      routePolyline: {
        type: DataTypes.TEXT, // Encoded polyline string can be long
        allowNull: true,
      },
      fareAmount: {
        // Final calculated fare
        type: DataTypes.DECIMAL(10, 2), // Example: 123.45
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3), // e.g., 'INR', 'USD'
        allowNull: true,
        defaultValue: "INR",
      },
      paymentStatus: {
        type: DataTypes.ENUM("pending", "processing", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      stripePaymentIntentId: { // Renamed for clarity, matches Stripe
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Keep stripeChargeId if you use Charges API instead of PaymentIntents
      stripeChargeId: {
         type: DataTypes.STRING,
         allowNull: true,
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      acceptedAt: { type: DataTypes.DATE, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },

      // Ratings given after the ride
      ratingGivenToDriver: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1, max: 5 } },
      ratingGivenToRider: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1, max: 5 } },
    },
    {
      tableName: "rides",
      timestamps: true, // Uses createdAt, updatedAt
      indexes: [
        { fields: ["riderUid"] },
        { fields: ["driverUid"] },
        { fields: ["status"] },
        { fields: ["requestedAt"] },
      ],
    }
  );

  return Ride;
};