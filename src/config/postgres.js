const { Sequelize } = require("sequelize");

// Load environment variables
const { DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, NODE_ENV, DB_SSL } =
  process.env;

// Basic validation for required DB env vars
if (!DB_NAME || !DB_USER || !DB_PASSWORD || !DB_HOST || !DB_PORT) {
  console.error(
    "[Postgres] Missing required database environment variables (DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT)."
  );
  process.exit(1); // Exit if DB config is missing
}

// Initialize Sequelize
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: "postgres",
  logging: NODE_ENV === "development" ? console.log : false, // Log SQL in dev
  native: false, // Helps with potential IPv6 issues
  dialectOptions: {
    // Enable SSL if DB_SSL is set to 'true' in .env
    ssl:
      DB_SSL === "true"
        ? {
            require: true,
            rejectUnauthorized: false, // Common setting for cloud DBs
          }
        : false,
  },
  pool: {
    // Optional: configure connection pool
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

// Function to test the connection
async function testPostgresConnection() {
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.error("[Postgres] Unable to connect to the database:", error);
    throw error; // Re-throw error to stop server startup
  }
}

// Define models object (will be populated by loadModels)
const models = {};

// Helper to load models dynamically
function loadModels() {
  try {
    // Import and initialize models, attaching them to the 'models' object
    models.User = require("../models/user.model")(sequelize);
    models.Ride = require("../models/ride.model")(sequelize);
    // Add other models here (e.g., Transaction, Rating)
    // models.Rating = require('../models/rating.model')(sequelize);
    // models.Transaction = require('../models/transaction.model')(sequelize);

    // --- Define Associations ---
    // Example: A User can have many Rides (as Rider or Driver)
    models.User.hasMany(models.Ride, {
      foreignKey: "riderId",
      as: "ridesAsRider",
    });
    models.User.hasMany(models.Ride, {
      foreignKey: "driverId",
      as: "ridesAsDriver",
    });

    // Example: A Ride belongs to one Rider and one Driver
    models.Ride.belongsTo(models.User, { foreignKey: "riderId", as: "rider" });
    models.Ride.belongsTo(models.User, {
      foreignKey: "driverId",
      as: "driver",
    });

    // Add other associations (e.g., Ratings)
    // models.Rating.belongsTo(models.User, { foreignKey: 'ratedUserId' });
    // models.Rating.belongsTo(models.User, { foreignKey: 'raterUserId' });
    // models.Rating.belongsTo(models.Ride, { foreignKey: 'rideId' });
    // models.Ride.hasOne(models.Rating, { foreignKey: 'rideId' });

    console.log("[Postgres] Sequelize models loaded and associations defined.");
  } catch (error) {
    console.error(
      "[Postgres] Error loading models or defining associations:",
      error
    );
    throw error;
  }
}

module.exports = {
  sequelize,
  models, // Export the populated models object
  testPostgresConnection,
  loadModels, // Export the loader function
};
