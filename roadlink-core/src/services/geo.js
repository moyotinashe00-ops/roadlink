const config = require('../config');

/** Real roads are longer than the straight line; 1.4 is a common urban detour factor. */
const DETOUR_FACTOR = 1.4;

/**
 * Built-in ETA estimate from straight-line metres. This is deliberately simple and is the
 * single place to swap in a routing provider (Google Directions / Mapbox) later: replace the
 * body with an API call and keep the signature.
 */
function estimateMinutes(meters) {
  if (meters == null) return null;
  const metresPerMinute = (config.etaAvgSpeedKmh * 1000) / 60;
  return Math.max(1, Math.ceil((meters * DETOUR_FACTOR) / metresPerMinute));
}

function insideZimbabwe(lat, lng) {
  const b = config.zwBounds;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

module.exports = { estimateMinutes, insideZimbabwe };
