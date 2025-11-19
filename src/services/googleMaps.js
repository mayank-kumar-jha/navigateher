const axios = require('axios');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_API_BASE_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const DIRECTIONS_API_BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';

if (!GOOGLE_MAPS_API_KEY) {
    console.warn("[Google Maps Service] GOOGLE_MAPS_API_KEY is missing!");
}

exports.getAlternativeRoutes = async (origin, destination) => {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const params = {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      key: GOOGLE_MAPS_API_KEY,
      provideRouteAlternatives: true,
      travelMode: 'DRIVING',
    };
    console.log(`[Google Maps] Directions requested: ${params.origin} to ${params.destination}`);
    const response = await axios.get(DIRECTIONS_API_BASE_URL, { params });

    if (response.data.status !== 'OK') {
      console.error('[Google Maps] Directions Error:', response.data.status, response.data.error_message);
      return [];
    }
    return response.data.routes;
  } catch (error) {
    console.error('[Google Maps] Directions Network Error:', error.message);
    return [];
  }
};

// Updated to search multiple points along the route
exports.findPOIsAlongRoute = async (route, poiTypes, radius = 1500) => {
  if (!GOOGLE_MAPS_API_KEY || !route?.legs?.[0]?.steps) return [];

  try {
    const leg = route.legs[0];
    const steps = leg.steps;
    let searchLocations = [];

    // 1. Pick 5 strategic points: Start, End, and 3 equidistant points in between
    searchLocations.push(leg.start_location);
    if (steps.length > 0) {
        const stepCount = steps.length;
        searchLocations.push(steps[Math.floor(stepCount * 0.25)].end_location); // 25%
        searchLocations.push(steps[Math.floor(stepCount * 0.50)].end_location); // 50%
        searchLocations.push(steps[Math.floor(stepCount * 0.75)].end_location); // 75%
    }
    searchLocations.push(leg.end_location);

    console.log(`[Google Maps] Scanning ${searchLocations.length} points along route for POIs...`);

    const uniquePlaces = new Map();

    // 2. Search around each point
    for (const location of searchLocations) {
        const searchPromises = poiTypes.map(type => {
            return axios.get(PLACES_API_BASE_URL, {
                params: {
                    location: `${location.lat},${location.lng}`,
                    radius: radius, // Increased radius
                    type: type,
                    key: GOOGLE_MAPS_API_KEY,
                }
            }).catch(e => ({ data: { status: 'ERROR' } })); // Catch individual errors
        });

        const responses = await Promise.all(searchPromises);

        responses.forEach(res => {
            if (res.data?.status === 'OK') {
                res.data.results.forEach(place => {
                    uniquePlaces.set(place.place_id, place); // Store by ID to avoid duplicates
                });
            }
        });
    }

    const results = Array.from(uniquePlaces.values());
    console.log(`[Google Maps] Found ${results.length} unique POIs total.`);
    return results;

  } catch (error) {
    console.error('[Google Maps] POI Search Error:', error.message);
    return [];
  }
};