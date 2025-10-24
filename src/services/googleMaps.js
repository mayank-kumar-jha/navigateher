// We'll use 'axios' to make API calls. It's cleaner than the default 'fetch'.
// Let's install it. In your terminal, run:
// npm install axios
const axios = require("axios");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_API_BASE_URL =
  "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const DIRECTIONS_API_BASE_URL =
  "https://maps.googleapis.com/maps/api/directions/json";

/**
 * Gets 3 alternative routes from Google Maps.
 * @param {object} origin - { lat: number, lng: number }
 * @param {object} destination - { lat: number, lng: number }
 * @returns {Array} An array of Google Maps route objects.
 */
exports.getAlternativeRoutes = async (origin, destination) => {
  try {
    const params = {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      key: GOOGLE_MAPS_API_KEY,
      provideRouteAlternatives: true,
      travelMode: "DRIVING",
    };

    const response = await axios.get(DIRECTIONS_API_BASE_URL, { params });

    if (response.data.status !== "OK" || !response.data.routes) {
      console.error("Google Directions API Error:", response.data.status);
      return [];
    }

    // Return all available routes
    return response.data.routes;
  } catch (error) {
    console.error("Error fetching alternative routes:", error.message);
    throw error;
  }
};

/**
 * Finds Points of Interest (POIs) along a given route.
 * For now, we'll just search around the *midpoint* of the route.
 * A more advanced version would check every 500m.
 * @param {object} route - A Google Maps route object.
 * @param {Array<string>} poiTypes - e.g., ['police', 'hospital']
 * @param {number} radius - Search radius in meters.
 * @returns {Array} A list of found places.
 */
exports.findPOIsAlongRoute = async (route, poiTypes, radius = 1000) => {
  try {
    // Find the midpoint of the route
    const leg = route.legs[0];
    const midpointIndex = Math.floor(leg.steps.length / 2);
    const midpoint = leg.steps[midpointIndex].end_location; // { lat, lng }

    const searchPromises = poiTypes.map((type) => {
      const params = {
        location: `${midpoint.lat},${midpoint.lng}`,
        radius: radius,
        type: type,
        key: GOOGLE_MAPS_API_KEY,
      };
      return axios.get(PLACES_API_BASE_URL, { params });
    });

    const responses = await Promise.all(searchPromises);

    let allPlaces = [];
    for (const response of responses) {
      if (response.data.status === "OK") {
        allPlaces = allPlaces.concat(response.data.results);
      }
    }

    return allPlaces;
  } catch (error) {
    console.error("Error fetching POIs along route:", error.message);
    throw error;
  }
};
