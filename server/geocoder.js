/**
 * geocoder.js
 * -----------
 * Free geocoding using Nominatim (OpenStreetMap). No API key required.
 * Respects Nominatim's 1 request/second rate limit.
 *
 * Also provides Haversine distance (miles) and 8-point cardinal direction
 * utilities used to describe comp proximity in appraisal narratives.
 *
 * Nominatim terms of use: https://operations.osmfoundation.org/policies/nominatim/
 *   - Must include a descriptive User-Agent
 *   - Max 1 request/second
 */

import log from './logger.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'CACC-Writer/2.0 (appraisal-drafting-tool; single-user-internal)';

// ── Rate limiter — Nominatim requires max 1 req/sec ──────────────────────────
let _lastNominatimCall = 0;
async function nominatimDelay() {
  const now = Date.now();
  const elapsed = now - _lastNominatimCall;
  if (elapsed < 1100) await new Promise(r => setTimeout(r, 1100 - elapsed));
  _lastNominatimCall = Date.now();
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

/**
 * geocodeAddress(address)
 * Converts a US street address to lat/lng + OSM location metadata.
 * Returns null if geocoding fails or address is not found.
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== 'string' || address.trim().length < 5) return null;

  await nominatimDelay();

  try {
    const params = new URLSearchParams({
      q:              address.trim(),
      format:         'json',
      addressdetails: '1',
      limit:          '1',
      countrycodes:   'us',
    });

    const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      log.warn('geocoder:nominatim-error', { status: res.status, address });
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const r    = data[0];
    const addr = r.address || {};

    return {
      lat:          parseFloat(r.lat),
      lng:          parseFloat(r.lon),
      displayName:  r.display_name || address,
      neighborhood: addr.neighbourhood || addr.quarter || null,
      suburb:       addr.suburb || null,
      city:         addr.city || addr.town || addr.village || addr.hamlet || null,
      county:       addr.county || null,
      state:        addr.state || null,
      postcode:     addr.postcode || null,
      osmType:      r.osm_type || null,
      osmId:        r.osm_id   || null,
    };
  } catch (err) {
    log.warn('geocoder:geocode-failed', { address, error: err.message });
    return null;
  }
}

// ── Distance and direction ────────────────────────────────────────────────────

/**
 * distanceMiles(lat1, lng1, lat2, lng2)
 * Haversine formula — great-circle distance in miles.
 */
export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R    = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(dist * 100) / 100; // 2 decimal places
}

/**
 * cardinalDirection(fromLat, fromLng, toLat, toLng)
 * Returns 8-point compass direction from point A to point B.
 * e.g. "NE", "SW", "N"
 */
export function cardinalDirection(fromLat, fromLng, toLat, toLng) {
  const dLat       = toLat - fromLat;
  const dLng       = toLng - fromLng;
  const angle      = Math.atan2(dLng, dLat) * 180 / Math.PI;
  const normalized = (angle + 360) % 360;
  const dirs       = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(normalized / 45) % 8];
}

/**
 * geocodeAll(addressList)
 * Geocodes multiple addresses sequentially (respects 1 req/sec rate limit).
 * Returns array of { address, result } where result may be null on failure.
 */
export async function geocodeAll(addressList) {
  const results = [];
  for (const address of addressList) {
    const result = await geocodeAddress(address);
    results.push({ address, result });
  }
  return results;
}

/**
 * buildAddressString(facts, section)
 * Extracts a full address string from a facts section object.
 * Handles both { value } wrapper format and plain string format.
 */
export function buildAddressString(facts, section) {
  const sec = facts?.[section];
  if (!sec) return null;

  const v = (key) => {
    const f = sec[key];
    if (!f) return '';
    return String(f?.value ?? f ?? '').trim();
  };

  const street = v('address');
  const city   = v('city');
  const state  = v('state');
  const zip    = v('zip') || v('zipCode') || v('postalCode');

  if (!street) return null;

  const parts = [street];
  if (city)  parts.push(city);
  if (state) parts.push(state);
  if (zip)   parts.push(zip);

  return parts.join(', ');
}
