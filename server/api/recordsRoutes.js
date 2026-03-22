/**
 * server/api/recordsRoutes.js
 * ----------------------------
 * Auto Public Records Pull — geocoding, FEMA flood zones, Census tract data,
 * and address verification via free public APIs.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST /api/cases/:caseId/pull-records  — pull all public records for case address
 *   GET  /api/cases/:caseId/records       — retrieve cached public records
 *   POST /api/geocode                     — standalone address geocoding utility
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';

import { casePath } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import log from '../logger.js';

const router = Router();

// ── Geocoding helper ──────────────────────────────────────────────────────────

/**
 * Geocode an address to lat/lng using the Census Bureau geocoder.
 * Free, no API key required.
 *
 * @param {string} address - full address string
 * @returns {Promise<{ lat: number, lng: number, matchedAddress: string, tigerLine: object }|null>}
 */
export async function geocodeAddressCensus(address) {
  if (!address) return null;

  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn('records:geocode-http-error', { status: response.status, address });
      return null;
    }

    const data = await response.json();
    const matches = data?.result?.addressMatches || [];
    if (matches.length === 0) return null;

    const match = matches[0];
    return {
      lat: parseFloat(match.coordinates?.y) || null,
      lng: parseFloat(match.coordinates?.x) || null,
      matchedAddress: match.matchedAddress || address,
      tigerLine: match.tigerLine || null,
    };
  } catch (err) {
    log.warn('records:geocode-error', { error: err.message, address });
    return null;
  }
}

/**
 * Pull Census geographic data (tract, block, county, state, FIPS) using geographies endpoint.
 *
 * @param {string} address - full address string
 * @returns {Promise<{ censusTract: string, censusBlock: string, county: string, state: string, fips: string, stateFips: string }|null>}
 */
async function fetchCensusGeographies(address) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('layers', 'Census Tracts,Census Blocks,Counties');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn('records:census-geo-http-error', { status: response.status });
      return null;
    }

    const data = await response.json();
    const matches = data?.result?.addressMatches || [];
    if (matches.length === 0) return null;

    const match = matches[0];
    const geos = match.geographies || {};

    // Extract census tract
    const tractData = (geos['Census Tracts'] || [])[0] || {};
    const blockData = (geos['Census Blocks'] || [])[0] || {};
    const countyData = (geos['Counties'] || [])[0] || {};

    return {
      censusTract: tractData.TRACT || tractData.NAME || null,
      censusBlock: blockData.BLOCK || null,
      censusBlockGroup: blockData.BLKGRP || null,
      county: countyData.NAME || null,
      state: countyData.STATE || null,
      stateFips: countyData.STATE || null,
      countyFips: countyData.COUNTY || null,
      fips: countyData.STATE && countyData.COUNTY
        ? `${countyData.STATE}${countyData.COUNTY}`
        : null,
      geoid: tractData.GEOID || null,
      verifiedAddress: match.matchedAddress || null,
      coordinates: {
        lat: parseFloat(match.coordinates?.y) || null,
        lng: parseFloat(match.coordinates?.x) || null,
      },
    };
  } catch (err) {
    log.warn('records:census-geo-error', { error: err.message });
    return null;
  }
}

/**
 * Look up FEMA flood zone for a lat/lng coordinate.
 * Uses the FEMA NFHL (National Flood Hazard Layer) REST API — free, no key required.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ floodZone: string, floodMapNumber: string, effectiveDate: string }|null>}
 */
async function fetchFemaFloodZone(lat, lng) {
  if (!lat || !lng) return null;

  // FEMA NFHL Feature Layer 28 — Flood Hazard Zones
  const url = new URL('https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query');
  url.searchParams.set('geometry', `${lng},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,FIRM_PANEL,EFF_DATE,SOURCE_CIT');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn('records:fema-http-error', { status: response.status });
      return null;
    }

    const data = await response.json();
    const features = data?.features || [];
    if (features.length === 0) {
      // No flood data — likely outside mapped area or Zone X (minimal hazard)
      return {
        floodZone: 'X',
        floodZoneDescription: 'Area of minimal flood hazard (outside 500-year floodplain) or unmapped area',
        floodMapNumber: null,
        sfha: false,
        note: 'No NFHL data returned — may be in Zone X or outside mapped area',
      };
    }

    const attrs = features[0].attributes || {};
    const zone = attrs.FLD_ZONE || 'Unknown';
    const sfha = attrs.SFHA_TF === 'T' || ['A', 'AE', 'AH', 'AO', 'AR', 'V', 'VE'].some(z => zone.startsWith(z));

    return {
      floodZone: zone,
      floodZoneSubtype: attrs.ZONE_SUBTY || null,
      floodZoneDescription: describeFloodZone(zone),
      floodMapNumber: attrs.FIRM_PANEL || null,
      effectiveDate: attrs.EFF_DATE || null,
      staticBfe: attrs.STATIC_BFE || null,
      depth: attrs.DEPTH || null,
      sfha, // Special Flood Hazard Area
      sourceCitation: attrs.SOURCE_CIT || null,
    };
  } catch (err) {
    log.warn('records:fema-error', { error: err.message });
    return null;
  }
}

/**
 * Human-readable description of a FEMA flood zone code.
 */
function describeFloodZone(zone) {
  if (!zone) return 'Unknown';
  const z = zone.toUpperCase().trim();
  if (z === 'A') return 'Special Flood Hazard Area — 1% annual chance flood, no BFE determined';
  if (z.startsWith('AE')) return 'Special Flood Hazard Area — 1% annual chance flood, BFE determined';
  if (z === 'AH') return 'Special Flood Hazard Area — 1% annual chance shallow flooding (ponding)';
  if (z === 'AO') return 'Special Flood Hazard Area — 1% annual chance shallow flooding (sheet flow)';
  if (z === 'AR') return 'Special Flood Hazard Area — flood hazard due to restoration of levee system';
  if (z === 'A99') return 'Special Flood Hazard Area — protected by federal flood control system under construction';
  if (z.startsWith('V')) return 'Special Flood Hazard Area — coastal flooding with wave action';
  if (z === 'X' || z === 'B') return 'Area of minimal or moderate flood hazard (outside 100-year floodplain)';
  if (z === 'C') return 'Area of minimal flood hazard';
  if (z === 'D') return 'Area of undetermined flood hazard';
  return `Flood Zone ${zone}`;
}

/**
 * Extract subject address from case facts/meta.
 * Tries multiple common locations where address may be stored.
 */
function extractSubjectAddress(projection) {
  const meta = projection?.meta || {};
  const facts = projection?.facts || {};

  // Try meta fields
  if (meta.address) return meta.address;
  if (meta.subjectAddress) return meta.subjectAddress;

  // Try facts fields
  const subject = facts.subject || {};
  if (subject.address) return subject.address;
  if (subject.propertyAddress) return subject.propertyAddress;

  // Build from components
  const street = subject.street || facts.street || facts.propertyAddress || '';
  const city = subject.city || facts.city || meta.city || '';
  const state = subject.state || facts.state || meta.state || '';
  const zip = subject.zip || facts.zip || meta.zip || facts.zipCode || '';

  if (street && city) {
    return [street, city, state, zip].filter(Boolean).join(', ');
  }

  // Fallback
  return facts.address || facts.propertyAddress || null;
}

// ── POST /cases/:caseId/pull-records ─────────────────────────────────────────

/**
 * Auto-pull public records for the case's subject property address.
 * Hits Census geocoder, FEMA NFHL, and derives associated geographic data.
 */
router.post('/cases/:caseId/pull-records', async (req, res) => {
  try {
    const { caseId } = req.params;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    // Get address — allow override from request body
    const address = req.body?.address || extractSubjectAddress(projection);
    if (!address) {
      return res.status(400).json({
        ok: false,
        error: 'No subject address found. Set facts.subject.address or provide "address" in request body.',
      });
    }

    log.info('records:pull-start', { caseId, address });

    // Run Census geographies lookup (includes geocoding + tract/block/county data)
    const [censusData, coordsOnly] = await Promise.all([
      fetchCensusGeographies(address),
      null, // we'll use censusData.coordinates
    ]);

    const lat = censusData?.coordinates?.lat || null;
    const lng = censusData?.coordinates?.lng || null;

    // Run FEMA flood zone lookup (requires lat/lng from geocoding)
    const femaData = lat && lng ? await fetchFemaFloodZone(lat, lng) : null;

    // Build result object
    const records = {
      pulledAt: new Date().toISOString(),
      address,
      geocode: lat && lng ? { lat, lng } : null,
      verifiedAddress: censusData?.verifiedAddress || null,

      // FEMA Flood Data
      floodZone: femaData?.floodZone || null,
      floodZoneSubtype: femaData?.floodZoneSubtype || null,
      floodZoneDescription: femaData?.floodZoneDescription || null,
      floodMapNumber: femaData?.floodMapNumber || null,
      floodEffectiveDate: femaData?.effectiveDate || null,
      sfha: femaData?.sfha ?? null,
      staticBfe: femaData?.staticBfe || null,

      // Census Geographic Data
      censusTract: censusData?.censusTract || null,
      censusBlock: censusData?.censusBlock || null,
      censusBlockGroup: censusData?.censusBlockGroup || null,
      county: censusData?.county || null,
      state: censusData?.state || null,
      stateFips: censusData?.stateFips || null,
      countyFips: censusData?.countyFips || null,
      fips: censusData?.fips || null,
      geoid: censusData?.geoid || null,

      // Errors/warnings
      errors: [
        ...(!censusData ? ['Census geocoding failed — verify address format'] : []),
        ...(censusData && !lat ? ['Coordinates not returned from Census geocoder'] : []),
        ...(!femaData && lat ? ['FEMA flood data unavailable — check address or NFHL coverage'] : []),
        ...(!femaData && !lat ? ['FEMA flood data skipped — geocoding required first'] : []),
      ],
    };

    // Save records to case file
    const cd = path.join(casePath(caseId));
    fs.mkdirSync(cd, { recursive: true });
    writeJSON(path.join(cd, 'records.json'), records);

    // Update case facts with pulled data
    try {
      const facts = { ...(projection.facts || {}) };
      const subject = { ...(facts.subject || {}) };

      // Merge records into subject facts
      if (records.verifiedAddress) subject.verifiedAddress = records.verifiedAddress;
      if (records.floodZone) subject.floodZone = records.floodZone;
      if (records.floodMapNumber) subject.floodMapNumber = records.floodMapNumber;
      if (records.censusTract) subject.censusTract = records.censusTract;
      if (records.censusBlock) subject.censusBlock = records.censusBlock;
      if (records.county) subject.county = records.county;
      if (records.state) subject.state = records.state;
      if (records.fips) subject.fips = records.fips;
      if (records.geocode) {
        subject.lat = records.geocode.lat;
        subject.lng = records.geocode.lng;
      }

      facts.subject = subject;
      facts.publicRecords = {
        pulledAt: records.pulledAt,
        floodZone: records.floodZone,
        censusTract: records.censusTract,
        county: records.county,
        fips: records.fips,
      };
      facts.updatedAt = new Date().toISOString();

      saveCaseProjection({ ...projection, facts });
    } catch (saveErr) {
      log.warn('records:save-projection-warning', { error: saveErr.message });
    }

    log.info('records:pull-complete', {
      caseId,
      floodZone: records.floodZone,
      censusTract: records.censusTract,
      county: records.county,
      geocoded: !!(lat && lng),
    });

    res.json({
      ok: true,
      records,
      summary: {
        geocoded: !!(lat && lng),
        floodZone: records.floodZone,
        floodZoneDescription: records.floodZoneDescription,
        censusTract: records.censusTract,
        county: records.county,
        state: records.state,
        fips: records.fips,
        verifiedAddress: records.verifiedAddress,
        sfha: records.sfha,
        errorCount: records.errors.length,
      },
    });
  } catch (err) {
    log.error('records:pull-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/records ────────────────────────────────────────────────

/**
 * Retrieve cached public records for a case.
 */
router.get('/cases/:caseId/records', (req, res) => {
  try {
    const { caseId } = req.params;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const cd = casePath(caseId);
    const records = readJSON(path.join(cd, 'records.json'), null);

    if (!records) {
      return res.status(404).json({
        ok: false,
        error: 'No public records found for this case. Run POST /api/cases/:caseId/pull-records first.',
      });
    }

    res.json({ ok: true, records });
  } catch (err) {
    log.error('records:get-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/geocode ─────────────────────────────────────────────────────────

/**
 * Standalone address geocoding utility.
 * Body: { address: string }
 * Returns: { lat, lng, matchedAddress, censusTract, county, state, fips }
 */
router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) {
      return res.status(400).json({ ok: false, error: 'Body must include "address" string' });
    }

    const geoData = await fetchCensusGeographies(address);
    if (!geoData) {
      return res.status(422).json({
        ok: false,
        error: 'Address could not be geocoded. Check format: "123 Main St, Chicago, IL 60601"',
      });
    }

    res.json({ ok: true, ...geoData });
  } catch (err) {
    log.error('geocode:error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
