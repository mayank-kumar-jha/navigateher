// src/realtime/socketHandler.js
const firebaseConfig = require("../config/firebase");
const haversine = require("haversine");

// --- In-Memory Data Stores ---
const onlineDrivers = {}; // { driverUid: { socketId, location, uid, status } }
const lookingRiders = {}; // { riderUid: { socketId, uid, location, destination, pendingRequestFrom? } }
const userSocketMap = {}; // { userId: socketId } - Map any connected user to their socket

// --- Main Initialization Function ---
function initializeSocket(io) {
  io.on("connection", (socket) => {
    console.log(`[Socket.IO] New connection: ${socket.id}`);
    let currentUserId = null; // To track who this socket belongs to

    // --- General User Connection ---
    // App should send this immediately after connecting, includes Firebase UID
    socket.on("user_connect", (data) => {
      if (data && data.uid) {
        currentUserId = data.uid;
        userSocketMap[currentUserId] = socket.id;
        socket.userId = currentUserId; // Store on socket for disconnect
        console.log(
          `[Socket.IO] User ${currentUserId} mapped to socket ${socket.id}`
        );
        // Re-join rooms if necessary (e.g., safety team room)
        // if (userIsSafetyTeam(currentUserId)) {
        //    socket.join('safety_team_room');
        // }
      }
    });

    // --- DRIVER EVENTS ---
    socket.on("driver_online", (data) => {
      if (!data || !data.uid || !data.location) return;
      currentUserId = data.uid; // Assume driver connects with their UID
      userSocketMap[currentUserId] = socket.id;
      socket.userId = currentUserId;
      socket.driverUID = currentUserId; // Keep specific driver flag too

      console.log(
        `[Socket.IO] Driver ${data.uid} is online at ${JSON.stringify(
          data.location
        )}.`
      );
      onlineDrivers[data.uid] = {
        socketId: socket.id,
        location: data.location,
        uid: data.uid,
        status: "available",
      };
    });

    socket.on("update_location", (data) => {
      if (!data || !data.uid || !data.location) return;
      if (onlineDrivers[data.uid]) {
        onlineDrivers[data.uid].location = data.location;
        // Broadcast location ONLY to the specific rider on this trip
        // We need a way to know which rider is associated with this driver
        // const ride = findRideForDriver(data.uid); // Need this lookup
        // if (ride && ride.riderSocketId) {
        //    io.to(ride.riderSocketId).emit('driver_location_update', data.location);
        // }
      }
    });

    socket.on("driver_offline", () => {
      if (socket.driverUID && onlineDrivers[socket.driverUID]) {
        console.log(`[Socket.IO] Driver ${socket.driverUID} went offline.`);
        delete onlineDrivers[socket.driverUID];
      }
    });

    // --- RIDE ACCEPTANCE/REJECTION EVENTS ---
    socket.on("driver_accepted", async (data) => {
      const { db } = firebaseConfig;
      if (!data || !data.rideId || !socket.driverUID) return;
      console.log(
        `[Socket.IO] Driver ${socket.driverUID} accepted ride ${data.rideId}`
      );
      if (onlineDrivers[socket.driverUID]) {
        onlineDrivers[socket.driverUID].status = "on-ride";
      }
      try {
        const rideRef = db.collection("rides").doc(data.rideId);
        await rideRef.update({
          status: "accepted",
          driverId: socket.driverUID, // Assign driver UID on acceptance
          driverFirebaseUid: socket.driverUID, // Assign driver UID on acceptance
          driverDetails: data.driverDetails || {},
          acceptedAt: new Date().toISOString(),
        });
        socket.emit("ride_confirmed", { rideId: data.rideId });
        // Find rider and notify them
        const rideData = (await rideRef.get()).data();
        if (rideData?.riderId) {
          notifyRider(rideData.riderId, "ride_accepted", {
            rideId: data.rideId,
            driverDetails: data.driverDetails || {},
          });
        }
      } catch (error) {
        console.error(
          `[Socket.IO] Error updating ride ${data.rideId} to 'accepted':`,
          error
        );
        socket.emit("ride_update_failed", {
          rideId: data.rideId,
          error: "Failed to update ride status.",
        });
        if (onlineDrivers[socket.driverUID]) {
          onlineDrivers[socket.driverUID].status = "available";
        }
      }
    });

    socket.on("driver_rejected", async (data) => {
      const { db } = firebaseConfig;
      if (!data || !data.rideId || !socket.driverUID) return;
      console.log(
        `[Socket.IO] Driver ${socket.driverUID} rejected ride ${data.rideId}`
      );
      if (onlineDrivers[socket.driverUID]) {
        onlineDrivers[socket.driverUID].status = "available";
      }
      try {
        const rideRef = db.collection("rides").doc(data.rideId);
        const rideSnapshot = await rideRef.get();
        const rideData = rideSnapshot.data();

        await rideRef.update({
          status: "rejected_by_driver", // More specific status
          rejectedBy: socket.driverUID,
        });

        // --- Find the *next* available driver ---
        if (rideData) {
          console.log(
            `[Socket.IO] Ride ${data.rideId} rejected. Finding next driver...`
          );
          const riderLocation = rideData.pickup;
          const excludedDriverId = socket.driverUID;
          // Find drivers again, excluding the one who rejected
          const nearbyDrivers = findNearbyDrivers(
            riderLocation,
            10,
            excludedDriverId
          );

          if (nearbyDrivers.length > 0) {
            const nextDriver = nearbyDrivers[0];
            const rideDetailsForDriver = {
              rideId: data.rideId,
              pickup: rideData.pickup,
              destination: rideData.destination,
            };
            // Update ride doc to pending again before sending to next driver?
            await rideRef.update({
              status: "pending",
              driverId: null,
              driverFirebaseUid: null,
            });
            sendRideRequestToDriver(nextDriver.uid, rideDetailsForDriver);
            console.log(
              `[Socket.IO] Sent request for ride ${data.rideId} to next driver ${nextDriver.uid}`
            );
          } else {
            console.log(
              `[Socket.IO] No other drivers found for ride ${data.rideId} after rejection.`
            );
            await rideRef.update({
              status: "cancelled_system",
              cancellationReason: "No drivers available after rejection.",
            });
            // Notify rider that no drivers are available
            notifyRider(rideData.riderId, "no_driver_found", {
              rideId: data.rideId,
            });
          }
        }
      } catch (error) {
        console.error(
          `[Socket.IO] Error updating ride ${data.rideId} after rejection:`,
          error
        );
      }
    });

    // --- RIDER COMMUNITY CONNECT EVENTS ---
    socket.on("rider_looking_for_match", (data) => {
      if (!data || !data.uid || !data.location || !data.destination) return;
      currentUserId = data.uid; // Assume rider connects with their UID
      userSocketMap[currentUserId] = socket.id;
      socket.userId = currentUserId;
      socket.riderUID = currentUserId; // Keep specific rider flag

      console.log(
        `[Socket.IO] Rider ${
          data.uid
        } is looking for a match near ${JSON.stringify(data.location)}.`
      );
      lookingRiders[data.uid] = {
        socketId: socket.id,
        uid: data.uid,
        location: data.location,
        destination: data.destination,
      };
    });

    socket.on("rider_stopped_looking", () => {
      if (socket.riderUID && lookingRiders[socket.riderUID]) {
        console.log(`[Socket.IO] Rider ${socket.riderUID} stopped looking.`);
        delete lookingRiders[socket.riderUID];
      }
    });

    // --- COMMUNITY CONNECT INVITATION EVENTS ---
    socket.on("request_community_connection", (data) => {
      if (!data || !data.fromUid || !data.toUid || !data.riderADetails) return;
      const { fromUid, toUid, riderADetails } = data;
      const riderB = lookingRiders[toUid];
      if (riderB) {
        riderB.pendingRequestFrom = { uid: fromUid, details: riderADetails };
        console.log(
          `[Community] Rider ${fromUid} requesting connection with ${toUid}`
        );
        io.to(riderB.socketId).emit("community_connection_requested", {
          fromUid: fromUid,
          riderDetails: riderADetails,
        });
      } else {
        socket.emit("community_request_failed", {
          toUid: toUid,
          reason: "User is no longer available.",
        });
      }
    });

    socket.on("accept_community_connection", (data) => {
      if (!data || !data.acceptedUid || !data.myUid || !data.myDetails) return;
      const { acceptedUid, myUid, myDetails } = data;
      const riderA = lookingRiders[acceptedUid];
      const riderB = lookingRiders[myUid];
      const riderADetails = riderB?.pendingRequestFrom?.details;

      if (riderA && riderADetails) {
        console.log(
          `[Community] Rider ${myUid} accepted connection with ${acceptedUid}`
        );
        io.to(riderA.socketId).emit("community_connection_accepted", {
          acceptedByUid: myUid,
          riderDetails: myDetails,
        });

        const videoCallRoomId = `video_${Date.now()}_${acceptedUid}_${myUid}`;
        io.to(riderA.socketId).emit("initiate_video_call", {
          roomId: videoCallRoomId,
          otherUserId: myUid,
          otherUserDetails: myDetails,
        });
        socket.emit("initiate_video_call", {
          roomId: videoCallRoomId,
          otherUserId: acceptedUid,
          otherUserDetails: riderADetails,
        });
        console.log(
          `[Community] Initiating video call for room: ${videoCallRoomId}`
        );

        if (riderB) delete riderB.pendingRequestFrom;
        delete lookingRiders[acceptedUid];
        delete lookingRiders[myUid];
        console.log(
          `[Community] Removed ${acceptedUid} and ${myUid} from looking pool.`
        );
      } else {
        console.warn(
          `[Community] Could not find Rider A (${acceptedUid}) or details for video call.`
        );
        socket.emit("community_video_failed", {
          reason: "Other user disconnected or request expired.",
        });
        if (riderB) delete riderB.pendingRequestFrom;
      }
    });

    socket.on("reject_community_connection", (data) => {
      if (!data || !data.rejectedUid || !data.myUid) return;
      const { rejectedUid, myUid } = data;
      const riderB = lookingRiders[myUid];
      if (riderB?.pendingRequestFrom?.uid === rejectedUid) {
        delete riderB.pendingRequestFrom;
      }
      const riderA = lookingRiders[rejectedUid];
      if (riderA) {
        console.log(
          `[Community] Rider ${myUid} rejected connection with ${rejectedUid}`
        );
        io.to(riderA.socketId).emit("community_connection_rejected", {
          rejectedByUid: myUid,
        });
      }
    });

    // --- DISCONNECT HANDLER ---
    socket.on("disconnect", () => {
      const disconnectedUid = socket.userId; // Use the stored UID
      if (disconnectedUid) {
        console.log(
          `[Socket.IO] User ${disconnectedUid} disconnected (Socket: ${socket.id})`
        );
        // Remove from user map
        if (userSocketMap[disconnectedUid] === socket.id) {
          // Ensure it's the correct socket
          delete userSocketMap[disconnectedUid];
        }
        // Cleanup driver pool
        if (
          socket.driverUID === disconnectedUid &&
          onlineDrivers[disconnectedUid]
        ) {
          console.log(
            `[Socket.IO] Driver ${disconnectedUid} removed from online pool due to disconnect.`
          );
          delete onlineDrivers[disconnectedUid];
        }
        // Cleanup rider pool
        if (
          socket.riderUID === disconnectedUid &&
          lookingRiders[disconnectedUid]
        ) {
          console.log(
            `[Socket.IO] Rider ${disconnectedUid} removed from looking pool due to disconnect.`
          );
          // Check if this rider had a pending request TO them
          for (const otherUid in lookingRiders) {
            if (
              lookingRiders[otherUid]?.pendingRequestFrom?.uid ===
              disconnectedUid
            ) {
              delete lookingRiders[otherUid].pendingRequestFrom;
              // Notify the requesting rider that the target disconnected?
              notifyRider(otherUid, "community_request_failed", {
                toUid: disconnectedUid,
                reason: "User disconnected.",
              });
            }
          }
          delete lookingRiders[disconnectedUid];
        }
      } else {
        console.log(`[Socket.IO] Anonymous connection closed: ${socket.id}`);
      }
    });
  }); // End of io.on('connection')

  // --- HELPER FUNCTIONS (Exposed to API Controllers) ---

  /** Finds socket ID for a given user UID */
  function findSocketIdForUser(userId) {
    return userSocketMap[userId] || null;
  }

  /** Emits an event to a specific user if they are connected */
  function notifyUser(userId, eventName, data) {
    const socketId = findSocketIdForUser(userId);
    if (socketId) {
      io.to(socketId).emit(eventName, data);
      console.log(
        `[Socket.IO Helper] Notified user ${userId} (Socket: ${socketId}) - Event: ${eventName}`
      );
      return true;
    } else {
      console.warn(
        `[Socket.IO Helper] Cannot notify user ${userId} - Socket not found.`
      );
      // TODO: Fallback to Firebase Push Notification?
      return false;
    }
  }
  // Specific aliases for clarity
  const notifyRider = notifyUser;
  const notifyDriver = notifyUser;

  /** Marks a driver as available in the live pool */
  function makeDriverAvailable(driverUid) {
    if (onlineDrivers[driverUid]) {
      onlineDrivers[driverUid].status = "available";
      console.log(
        `[Socket.IO Helper] Marked driver ${driverUid} as available.`
      );
    }
  }

  function findNearbyDrivers(
    riderLocation,
    radiusInKm = 10,
    excludedDriverId = null
  ) {
    const availableDrivers = [];
    for (const uid in onlineDrivers) {
      // Skip excluded driver
      if (uid === excludedDriverId) continue;

      const driver = onlineDrivers[uid];
      if (driver.status === "available") {
        const distance = haversine(
          { latitude: riderLocation.lat, longitude: riderLocation.lng },
          { latitude: driver.location.lat, longitude: driver.location.lng },
          { unit: "km" }
        );
        if (distance <= radiusInKm) {
          availableDrivers.push({ ...driver, distance });
        }
      }
    }
    return availableDrivers.sort((a, b) => a.distance - b.distance);
  }

  function sendRideRequestToDriver(driverUid, rideDetails) {
    const driver = onlineDrivers[driverUid];
    if (driver && driver.socketId) {
      console.log(
        `[Socket.IO] Emitting 'new_ride_request' to driver ${driverUid} (Socket: ${driver.socketId})`
      );
      io.to(driver.socketId).emit("new_ride_request", rideDetails);
      driver.status = "pending";
      setTimeout(() => {
        if (
          onlineDrivers[driverUid] &&
          onlineDrivers[driverUid].status === "pending"
        ) {
          onlineDrivers[driverUid].status = "available";
          console.log(
            `[Socket.IO] Resetting status for driver ${driverUid} due to request timeout.`
          );
          // Trigger finding the next driver (needs rideId and original rider details)
          // findNextDriverForRide(rideDetails.rideId); // Need a function like this
        }
      }, 30000); // 30 second timeout
      return true;
    }
    console.warn(
      `[Socket.IO] Could not find online driver ${driverUid} to send ride request.`
    );
    return false;
  }

  function findNearbyRiders(selfUid, riderLocation, riderDestination) {
    const matches = [];
    const MAX_WALKING_DISTANCE_KM = 1.5;
    const MAX_DESTINATION_DISTANCE_KM = 5;
    for (const uid in lookingRiders) {
      if (uid === selfUid) continue;
      const otherRider = lookingRiders[uid];
      const pickupDistance = haversine(riderLocation, otherRider.location, {
        unit: "km",
      });
      if (pickupDistance <= MAX_WALKING_DISTANCE_KM) {
        const destinationDistance = haversine(
          riderDestination,
          otherRider.destination,
          { unit: "km" }
        );
        if (destinationDistance <= MAX_DESTINATION_DISTANCE_KM) {
          matches.push({
            uid: otherRider.uid,
            location: otherRider.location,
            destination: otherRider.destination,
            distance: pickupDistance,
            socketId: otherRider.socketId,
          });
        }
      }
    }
    return matches.sort((a, b) => a.distance - b.distance);
  }

  // --- Return Helper Functions ---
  return {
    findNearbyDrivers,
    sendRideRequestToDriver,
    findNearbyRiders,
    // NEW Helpers:
    notifyRider,
    notifyDriver,
    notifyUser, // Generic notifier
    makeDriverAvailable,
    findSocketIdForUser,
  };
} // End of initializeSocket

// --- Export the Initializer ---
module.exports = { initializeSocket };
