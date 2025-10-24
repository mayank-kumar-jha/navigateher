// src/services/twilioService.js
require("dotenv").config();
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER; // Your Twilio number

let twilioClient;
let isTwilioConfigured = false;

if (accountSid && authToken && twilioPhoneNumber) {
  try {
    twilioClient = twilio(accountSid, authToken);
    isTwilioConfigured = true;
    console.log("[Twilio Service] Initialized successfully.");
  } catch (error) {
    console.error("[Twilio Service] Initialization failed:", error.message);
    // Fallback to mock functions if init fails
  }
} else {
  console.warn(
    "[Twilio Service] TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER not found in .env. Twilio functionality will be mocked."
  );
}

/**
 * Sends an SMS message to one or multiple recipients.
 * @param {string | string[]} recipients - A single phone number or an array of numbers (E.164 format).
 * @param {string} messageBody - The text message content.
 * @returns {Promise<boolean>} - True if message sending was attempted/mocked, false otherwise.
 */
const sendSmsAlert = async (recipients, messageBody) => {
  if (!isTwilioConfigured || !twilioClient) {
    console.log(
      `[Twilio Mock] Sending SMS to ${
        Array.isArray(recipients) ? recipients.join(", ") : recipients
      }: "${messageBody}"`
    );
    return Promise.resolve(true); // Simulate success
  }

  const numbersToMessage = Array.isArray(recipients)
    ? recipients
    : [recipients];
  const messagePromises = numbersToMessage.map((number) => {
    // Basic validation for E.164 format (starts with +, digits only)
    if (!/^\+[1-9]\d{1,14}$/.test(number)) {
      console.warn(
        `[Twilio Service] Invalid phone number format skipped: ${number}`
      );
      return Promise.resolve({ sid: null, error: "Invalid format" }); // Skip invalid numbers
    }
    return twilioClient.messages
      .create({
        body: messageBody,
        from: twilioPhoneNumber,
        to: number,
      })
      .then((message) => {
        console.log(
          `[Twilio Service] SMS sent to ${number}. SID: ${message.sid}`
        );
        return { sid: message.sid };
      })
      .catch((error) => {
        console.error(
          `[Twilio Service] Failed to send SMS to ${number}:`,
          error.message
        );
        return { sid: null, error: error.message }; // Return error info
      });
  });

  try {
    await Promise.all(messagePromises);
    // Consider returning detailed results if needed
    return true; // Indicate that sending was attempted
  } catch (error) {
    // This catch might not be strictly necessary with individual catches above,
    // but provides a fallback.
    console.error("[Twilio Service] Error during bulk SMS sending:", error);
    return false;
  }
};

/**
 * Placeholder for creating a masked call session (Proxy).
 * This requires more setup with Twilio Proxy service.
 */
const createMaskedCall = async (
  userAPhone,
  userBPhone,
  durationMinutes = 10
) => {
  if (!isTwilioConfigured || !twilioClient) {
    console.log(
      `[Twilio Mock] Creating masked call between ${userAPhone} and ${userBPhone}.`
    );
    // Simulate returning proxy numbers or session details
    return Promise.resolve({
      proxyNumberA: "+15550001111",
      proxyNumberB: "+15550002222",
      sessionId: `mock_session_${Date.now()}`,
    });
  }

  console.warn(
    "[Twilio Service] createMaskedCall (Proxy) not fully implemented."
  );
  // --- TODO: Implement Twilio Proxy API calls ---
  // 1. Ensure Twilio Proxy Service SID exists in .env
  // 2. Create a Proxy Session
  // 3. Add Participant A (userAPhone)
  // 4. Add Participant B (userBPhone)
  // 5. Return the session details or assigned proxy numbers
  return Promise.reject(new Error("Twilio Proxy not implemented."));
};

module.exports = {
  sendSmsAlert,
  createMaskedCall,
  // Export twilioClient if direct access is needed elsewhere
};
