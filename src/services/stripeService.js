// src/services/stripeService.js
require("dotenv").config(); // Ensure environment variables are loaded
const Stripe = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
let stripeInstance;

if (STRIPE_SECRET_KEY) {
  stripeInstance = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20", // Use a recent, fixed API version
    typescript: false, // Adjust if using TypeScript
  });
  console.log("[Stripe Service] Initialized successfully.");
} else {
  console.warn(
    "[Stripe Service] STRIPE_SECRET_KEY not found in .env. Stripe functionality will be mocked."
  );
  // Provide mock functions if key is missing
  stripeInstance = {
    paymentIntents: {
      create: async (params) => {
        console.log("[Stripe Mock] paymentIntents.create called with:", params);
        // Simulate a successful payment intent creation
        const mockId = `pi_mock_${Date.now()}`;
        const mockSecret = `pi_${mockId}_secret_mock_${Date.now()}`;
        return Promise.resolve({
          id: mockId,
          client_secret: mockSecret,
          amount: params.amount,
          currency: params.currency,
          status: "requires_payment_method", // Initial status
          metadata: params.metadata,
        });
      },
    },
    customers: {
      create: async (params) => {
        console.log("[Stripe Mock] customers.create called with:", params);
        const mockId = `cus_mock_${Date.now()}`;
        return Promise.resolve({
          id: mockId,
          email: params.email,
          metadata: params.metadata,
        });
      },
      // Add mock search if needed: list: async(params) => { ... }
    },
    accounts: {
      create: async (params) => {
        console.log("[Stripe Mock] accounts.create called with:", params);
        const mockId = `acct_mock_${Date.now()}`;
        return Promise.resolve({ id: mockId /* other needed fields */ });
      },
      createLoginLink: async (accountId) => {
        console.log(
          `[Stripe Mock] accounts.createLoginLink called for: ${accountId}`
        );
        return Promise.resolve({
          url: `https://dashboard.stripe.com/test/connect/accounts/${accountId}/onboarding`,
        }); // Example link
      },
      // Add mock retrieve if needed
    },
    webhooks: {
      // Keep webhook verification even in mock for structure
      constructEvent: (body, sig, secret) => {
        console.log(
          "[Stripe Mock] webhooks.constructEvent called (returning mock event)"
        );
        // In a real mock, you might return different event types based on tests
        return {
          id: `evt_mock_${Date.now()}`,
          type: "payment_intent.succeeded", // Default mock event
          data: {
            object: {
              id: `pi_mock_${Date.now()}`,
              amount: 1000,
              currency: "inr",
              metadata: { rideId: "mock_ride_123" },
              status: "succeeded",
            },
          },
        };
      },
    },
    // Add other Stripe objects/methods as needed
  };
}

// Export the initialized (or mocked) Stripe instance
module.exports = {
  stripeInstance,
};
