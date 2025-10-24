# Female Travel Safety - Backend API

This server powers the Female Travel Safety mobile application, managing users, rides, payments, and real-time safety features.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18.x or later)
- [PostgreSQL](https://www.postgresql.org/) (a running instance, either local or cloud-based)
- A Google Firebase Project (for Authentication and Firestore)

## 1. Setup

1.  **Clone the repository:**

    ```bash
    git clone <your-repo-url>
    cd female-safety-backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## 2. Environment Configuration

1.  **Get Firebase Service Account Key:**

    - Go to your Firebase Project Settings > Service Accounts.
    - Click "Generate new private key".
    - A JSON file will be downloaded. Rename it to `service-account-key.json` and place it in the root of this project.

2.  **Create your `.env` file:**
    - Rename `.env.example` to `.env`.
    - Fill in all the required values:
      - `DB_USER`, `DB_PASSWORD`, etc. for your PostgreSQL database.
      - `FIREBASE_SERVICE_ACCOUNT_PATH` (should be `./service-account-key.json`)
      - Generate a strong `JWT_SECRET`.

## 3. Running the Server

1.  **For development (with auto-reload):**
    ```bash
    npm run dev
    ```

The server will start on the port defined in your `.env` file (e.g., `http://localhost:8080`).
