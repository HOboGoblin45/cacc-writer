/**
 * server/data/addressVerification.js
 * ─────────────────────────────────────────────────────────────────────────────
 * USPS Address Verification & Standardization.
 *
 * Validates and standardizes addresses against USPS records:
 *   - Corrects misspellings and typos
 *   - Adds ZIP+4 code
 *   - Standardizes street abbreviations (St, Ave, Blvd, etc.)
 *   - Confirms deliverability
 *   - Detects vacant/undeliverable addresses
 *   - Returns standardized USPS format
 *
 * Uses USPS Addresses 3.0 API (free, requires registration at developers.usps.com).
 * Falls back to geocoder-based validation if USPS key not configured.
 *
 * For appraisals, address verification is critical:
 *   - Ensures MISMO/UAD XML has correct USPS-standard address
 *   - Prevents UCDP rejection for address mismatches
 *   - Catches order form typos before they propagate
 */

import { geocodeAddress } from '../geocoder.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

const USPS_API_URL = process.env.USPS_API_URL || 'https://apis.usps.com/addresses/v3/address';
const USPS_CLIENT_ID = process.env.USPS_CLIENT_ID || '';
const USPS_CLIENT_SECRET = process.env.USPS_CLIENT_SECRET || '';

let uspsAccessToken = null;
let uspsTokenExpiry = 0;

/**
 * Get USPS OAuth token.
 */
async function getUspsToken() {
  if (uspsAccessToken && Date.now() < uspsTokenExpiry - 60000) {
    return uspsAccessToken;
  }

  if (!USPS_CLIENT_ID || !USPS_CLIENT_SECRET) return null;

  try {
    const res = await fetch('https://apis.usps.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(USPS_CLIENT_ID)}&client_secret=${encodeURIComponent(USPS_CLIENT_SECRET)}`,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    uspsAccessToken = data.access_token;
    uspsTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return uspsAccessToken;
  } catch (e) {
    log.warn('usps:token-failed', { error: e.message });
    return null;
  }
}

/**
 * Verify and standardize an address against USPS.
 *
 * @param {Object} address
 * @param {string} address.street — street address line
 * @param {string} [address.unit] — apartment/unit number
 * @param {string} address.city
 * @param {string} address.state — 2-letter code
 * @param {string} [address.zip] — 5-digit ZIP
 * @returns {Object} verification result
 */
export async function verifyAddress(address) {
  const { street, unit, city, state, zip } = address;

  if (!street) throw new Error('Street address is required');
  if (!city && !zip) throw new Error('City or ZIP code is required');

  // Try USPS API first
  const uspsResult = await verifyWithUsps(address);
  if (uspsResult) return uspsResult;

  // Fall back to geocoder-based verification
  return await verifyWithGeocoder(address);
}

/**
 * Verify via USPS Addresses 3.0 API.
 */
async function verifyWithUsps(address) {
  const token = await getUspsToken();
  if (!token) return null;

  try {
    const params = new URLSearchParams();
    params.set('streetAddress', address.street);
    if (address.unit) params.set('secondaryAddress', address.unit);
    if (address.city) params.set('city', address.city);
    if (address.state) params.set('state', address.state);
    if (address.zip) params.set('ZIPCode', address.zip);

    const res = await fetch(`${USPS_API_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      log.warn('usps:api-error', { status: res.status });
      return null;
    }

    const data = await res.json();
    const addr = data.address || data;

    return {
      source: 'USPS',
      verified: true,
      deliverable: !addr.vacant && !addr.noStat,
      standardized: {
        street: addr.streetAddress || addr.addressLine1 || address.street,
        unit: addr.secondaryAddress || addr.addressLine2 || address.unit || null,
        city: addr.city || address.city,
        state: addr.state || address.state,
        zip: addr.ZIPCode || addr.zip5 || address.zip,
        zip4: addr.ZIPPlus4 || addr.zip4 || null,
        fullZip: (addr.ZIPCode || addr.zip5 || '') + (addr.ZIPPlus4 ? '-' + addr.ZIPPlus4 : ''),
      },
      usps: {
        deliveryPoint: addr.deliveryPoint || null,
        carrierRoute: addr.carrierRoute || null,
        dpvConfirmation: addr.DPVConfirmation || null,
        dpvFootnotes: addr.DPVFootnotes || null,
        vacant: addr.vacant || false,
        business: addr.business || false,
        centralDeliveryPoint: addr.centralDeliveryPoint || false,
      },
      corrections: detectCorrections(address, addr),
      confidence: 'high',
    };
  } catch (e) {
    log.warn('usps:verify-failed', { error: e.message });
    return null;
  }
}

/**
 * Fallback: verify via geocoder.
 */
async function verifyWithGeocoder(address) {
  const fullAddress = `${address.street}, ${address.city || ''}, ${address.state || ''} ${address.zip || ''}`;

  try {
    const geo = await geocodeAddress(fullAddress);
    if (!geo) {
      return {
        source: 'geocoder',
        verified: false,
        deliverable: null,
        standardized: {
          street: address.street,
          unit: address.unit || null,
          city: address.city,
          state: address.state,
          zip: address.zip,
          zip4: null,
          fullZip: address.zip || '',
        },
        error: 'Address could not be geocoded — may not exist',
        confidence: 'low',
      };
    }

    return {
      source: 'geocoder',
      verified: true,
      deliverable: null, // Geocoder can't confirm deliverability
      standardized: {
        street: geo.formattedStreet || address.street,
        unit: address.unit || null,
        city: geo.city || address.city,
        state: geo.state || address.state,
        zip: geo.zip || address.zip,
        zip4: null,
        fullZip: geo.zip || address.zip || '',
      },
      coordinates: { lat: geo.lat, lon: geo.lon },
      confidence: 'medium',
      note: 'Verified via geocoding. For USPS-standard formatting, configure USPS_CLIENT_ID and USPS_CLIENT_SECRET.',
    };
  } catch (e) {
    return {
      source: 'geocoder',
      verified: false,
      error: e.message,
      confidence: 'low',
    };
  }
}

/**
 * Detect what USPS corrected in the address.
 */
function detectCorrections(original, usps) {
  const corrections = [];
  const stdStreet = usps.streetAddress || usps.addressLine1 || '';
  const stdCity = usps.city || '';
  const stdState = usps.state || '';
  const stdZip = usps.ZIPCode || usps.zip5 || '';

  if (original.street && stdStreet && original.street.toUpperCase() !== stdStreet.toUpperCase()) {
    corrections.push({ field: 'street', original: original.street, corrected: stdStreet });
  }
  if (original.city && stdCity && original.city.toUpperCase() !== stdCity.toUpperCase()) {
    corrections.push({ field: 'city', original: original.city, corrected: stdCity });
  }
  if (original.state && stdState && original.state.toUpperCase() !== stdState.toUpperCase()) {
    corrections.push({ field: 'state', original: original.state, corrected: stdState });
  }
  if (original.zip && stdZip && original.zip !== stdZip) {
    corrections.push({ field: 'zip', original: original.zip, corrected: stdZip });
  }

  return corrections;
}

/**
 * Verify a case's subject address and update facts with standardized version.
 *
 * @param {string} caseId
 * @returns {Object} verification result
 */
export async function verifyCaseAddress(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};

  const address = {
    street: subject.address || subject.streetAddress,
    unit: subject.unit,
    city: subject.city,
    state: subject.state,
    zip: subject.zip || subject.zipCode,
  };

  if (!address.street) throw new Error('Subject address is required');

  const result = await verifyAddress(address);

  // Update facts with standardized address
  if (result.verified && result.standardized) {
    const std = result.standardized;
    facts.subject = {
      ...subject,
      address: std.street,
      streetAddress: std.street,
      unit: std.unit || subject.unit,
      city: std.city,
      state: std.state,
      zip: std.zip,
      zipCode: std.zip,
      zip4: std.zip4,
      fullZip: std.fullZip,
    };

    if (result.coordinates) {
      facts.subject.latitude = result.coordinates.lat;
      facts.subject.longitude = result.coordinates.lon;
    }

    // Store verification metadata
    facts.addressVerification = {
      source: result.source,
      verified: result.verified,
      deliverable: result.deliverable,
      confidence: result.confidence,
      corrections: result.corrections || [],
      verifiedAt: new Date().toISOString(),
      usps: result.usps || null,
    };

    const now = new Date().toISOString();
    dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
      [JSON.stringify(facts), now, caseId]);
  }

  log.info('address:verified', {
    caseId,
    source: result.source,
    verified: result.verified,
    corrections: result.corrections?.length || 0,
  });

  return result;
}

/**
 * Check if USPS API is configured.
 */
export function isUspsConfigured() {
  return Boolean(USPS_CLIENT_ID && USPS_CLIENT_SECRET);
}

export default { verifyAddress, verifyCaseAddress, isUspsConfigured };
