// src/models/user.model.js
const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      // We use Firebase UID as the primary key for consistency
      uid: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true, // Make phone optional initially
        unique: true,
      },
      userType: {
        type: DataTypes.ENUM("rider", "driver"),
        allowNull: false,
      },
      isVerified: {
        // Flag set by verification service (e.g., IDfy)
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isOnline: {
        // For driver status, maybe rider looking status?
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Store emergency contacts as JSONB for flexibility
      emergencyContacts: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [], // Default to an empty array
      },
      // Driver-specific fields
      vehicleDetails: {
        type: DataTypes.JSONB, // Store { model, licensePlate, color }
        allowNull: true,
        defaultValue: null,
      },
      // Store rating summary here for quick access
      averageRating: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 5,
        },
      },
      totalRatings: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Stripe customer ID (for riders) or connected account ID (for drivers)
      stripeId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      // Add other fields as needed: profilePictureUrl, etc.
    },
    {
      // Sequelize options
      tableName: "users",
      timestamps: true, // Automatically adds createdAt and updatedAt
      // paranoid: true, // Optional: enable soft deletes (adds deletedAt)
      // Indexes can improve query performance
      indexes: [
        { unique: true, fields: ["email"] },
        { unique: true, fields: ["phone"] },
        { fields: ["userType"] },
      ],
    }
  );

  return User;
};
