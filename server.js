// --- 1. Load Environment Variables ---
require("dotenv").config();

// --- 2. Import Core Dependencies ---
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

// --- 3. Import Our Custom Modules & Routes ---
const { initializeFirebaseAdmin } = require("./src/config/firebase");
const {
  sequelize,
  testPostgresConnection,
  loadModels,
} = require("./src/config/postgres"); // Import sequelize instance and loader
const { initializeSocket } = require("./src/realtime/socketHandler");
const errorHandler = require("./src/utils/errorHandler"); // Global error handler
const { isAuth } = require("./src/middleware/isAuth"); // Auth middleware

// Import Routes
const authRoutes = require("./src/api/auth/auth.routes");
const usersRoutes = require("./src/api/users/users.routes");
const ridesRoutes = require("./src/api/rides/rides.routes");
const communityRoutes = require("./src/api/community/community.routes");
const sosRoutes = require("./src/api/sos/sos.routes");
const ratingsRoutes = require("./src/api/ratings/ratings.routes");
const paymentsRoutes = require("./src/api/payments/payments.routes");
const webhooksRoutes = require("./src/api/webhooks/webhooks.routes");

// --- 4. Initialize Express App, HTTP Server, and Socket.IO ---
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*", // Use env var for client URL
    methods: ["GET", "POST"],
  },
});

// --- 5. Apply Global Middleware ---
app.use(cors()); // Allow configured cross-origin requests
app.use(morgan("dev")); // Logging

// IMPORTANT: Stripe webhook needs raw body, BEFORE express.json()
// We handle this specifically in the webhook route file now.
app.use(express.json()); // Parse incoming request bodies as JSON
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- 6. Mount API Routes ---
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", isAuth, usersRoutes); // Protect user routes
app.use("/api/v1/rides", isAuth, ridesRoutes); // Protect ride routes
app.use("/api/v1/community", isAuth, communityRoutes); // Protect community routes
app.use("/api/v1/sos", isAuth, sosRoutes); // Protect SOS routes
app.use("/api/v1/ratings", isAuth, ratingsRoutes); // Protect ratings routes
app.use("/api/v1/payments", isAuth, paymentsRoutes); // Protect payment routes
app.use("/api/v1/webhooks", webhooksRoutes); // Webhooks are usually public but secured differently

// Simple health check route
app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    message: "Welcome to the Female Safety Backend API!",
  });
});

// --- 7. Global Error Handler ---
// Catches errors passed via next(error)
app.use(errorHandler);

// Handle 404 for routes not found
app.use((req, res, next) => {
  res.status(404).json({ message: "Not Found" });
});

// --- 8. Define Server Startup Function ---
const PORT = process.env.PORT || 8080;

const startServer = async () => {
  try {
    console.log("[Startup] Initializing...");

    // STEP 1: Connect to Firebase
    initializeFirebaseAdmin();
    console.log("[Startup] Firebase Admin SDK initialized.");

    // STEP 2: Connect to PostgreSQL & Load/Sync Models
    await testPostgresConnection();
    console.log("[Startup] Postgres Database connection successful.");
    loadModels(); // Load models into sequelize
    // Sync models - use alter:true carefully in dev, never in prod without backups
    await sequelize.sync({ alter: process.env.NODE_ENV === "development" });
    console.log("[Startup] Sequelize models loaded and synced.");

    // STEP 3: Initialize Socket.IO
    const socketHelpers = initializeSocket(io);
    console.log("[Startup] Socket.IO real-time handler initialized.");

    // STEP 4: "Inject" helpers and io into Express app
    app.set("socketHelpers", socketHelpers);
    app.set("io", io);

    // STEP 5: Start the HTTP server
    server.listen(PORT, () => {
      console.log(`[Startup] Server Running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("[Startup] Failed to start server:", error);
    process.exit(1);
  }
};

// --- 9. Run the Server! ---
startServer();
