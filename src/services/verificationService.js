// src/services/verificationService.js
require("dotenv").config();

// --- Mock Implementation ---
// In a real implementation, you would use the SDK for IDfy, Onfido, Checkr etc.

/**
 * Simulates initiating a background/ID check for a user.
 * @param {string} userId - Your internal User ID (e.g., Firebase UID)
 * @param {object} userData - User details needed for the check (e.g., name, email, DOB, address)
 * @returns {Promise<object>} - Mock result indicating check started.
 */
const startVerificationCheck = async (userId, userData) => {
  console.log(
    `[Verification Mock] Starting check for user ${userId} with data:`,
    userData
  );

  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 second delay

  // Simulate a successful initiation
  const mockCheckId = `check_mock_${Date.now()}`;
  console.log(
    `[Verification Mock] Check initiated. Mock Check ID: ${mockCheckId}`
  );

  // --- Simulate receiving a webhook later ---
  // This simulates the external service sending a result back after some time.
  // In reality, this happens via the handleVerificationWebhook controller.
  setTimeout(() => {
    const mockWebhookPayload = {
      status: "completed", // 'completed' or 'failed'
      userId: userId, // The ID you passed
      result: Math.random() > 0.1 ? "clear" : "consider", // 90% chance of 'clear'
      reportId: `report_mock_${mockCheckId}`,
      timestamp: new Date().toISOString(),
    };
    console.log(
      `[Verification Mock] Simulating webhook received for user ${userId}:`,
      mockWebhookPayload
    );
    // In a real test setup, you might actually POST this to your own /webhooks/verification endpoint
    // const axios = require('axios');
    // axios.post('http://localhost:8080/api/v1/webhooks/verification', mockWebhookPayload, {
    //    headers: { 'x-verification-token': process.env.VERIFICATION_WEBHOOK_TOKEN }
    // }).catch(err => console.error("Mock webhook POST failed:", err.message));
  }, 5000 + Math.random() * 10000); // Simulate delay of 5-15 seconds

  return Promise.resolve({
    success: true,
    message: "Verification check initiated successfully.",
    checkId: mockCheckId, // Return a mock ID
  });
};

/**
 * Simulates fetching the status/details of a specific check.
 * @param {string} checkId - The ID returned by startVerificationCheck.
 * @returns {Promise<object>} - Mock status.
 */
const getVerificationStatus = async (checkId) => {
  console.log(`[Verification Mock] Getting status for check ${checkId}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Return a generic pending status for the mock
  return Promise.resolve({
    checkId: checkId,
    status: "pending",
    message: "Check is currently processing (mock response).",
  });
};

module.exports = {
  startVerificationCheck,
  getVerificationStatus,
};
