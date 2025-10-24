// src/models/ride.model.js
const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Ride = sequelize.define(
    "Ride",
    {
      // Use Firestore Ride ID as primary key? Or generate UUID here?
      // Let's use Firestore ID for consistency if Firestore is the source of truth for live rides.
      // If Postgres is the main store for *completed* rides, use UUID. Let's assume Firestore ID for now.
      firestoreRideId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      riderId: {
        // Foreign key to User model (Firebase UID)
        type: DataTypes.STRING,
        allowNull: false,
        references: {
          model: "users", // Name of the table
          key: "uid",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL", // Or 'CASCADE' if rides should be deleted with user
      },
      driverId: {
        // Foreign key to User model (Firebase UID)
        type: DataTypes.STRING,
        allowNull: true, // Driver might not be assigned initially or reject
        references: {
          model: "users",
          key: "uid",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
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
      pickupAddress: {
        // Optional: Human-readable address
        type: DataTypes.STRING,
        allowNull: true,
      },
      pickupLocation: {
        // Store precise coordinates
        type: DataTypes.GEOMETRY("POINT"), // Use PostGIS POINT type
        allowNull: false,
      },
      destinationAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      destinationLocation: {
        type: DataTypes.GEOMETRY("POINT"),
        allowNull: false,
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
        type: DataTypes.ENUM("pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      stripeChargeId: {
        // Reference to the Stripe charge
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

      // Add fields for ratings later if needed, or link to a separate Rating model
      // riderRating: { type: DataTypes.INTEGER, allowNull: true },
      // driverRating: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      // Sequelize options
      tableName: "rides",
      timestamps: true, // Uses createdAt, updatedAt
      // paranoid: true, // Optional soft deletes
      indexes: [
        { fields: ["riderId"] },
        { fields: ["driverId"] },
        { fields: ["status"] },
        { fields: ["requestedAt"] },
      ],
    }
  );

  return Ride;
};
