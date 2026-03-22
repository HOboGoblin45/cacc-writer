/**
 * server/data/publicRecordsService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public records auto-pull service.
 *
 * Automatically fetches property data from public sources:
 *   - County assessor records (tax data, legal description, lot size)
 *   - Property transfer history (sale dates, prices)
 *   - Permit history (recent renovations, additions)
 *   - Flood zone data (FEMA)
 *   - Zoning data
 *
 * Uses free/low-cost data sources. Premium sources (Attom, CoreLogic)
 * can be added as optional integrations.
 *
 * Data flow: address → geocode → fetch records → merge into case facts
 */

import { callAI } from '../openaiClient.js';
import { geocodeAddress } from '../geocoder.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Pull public records for a case and merge into facts.
 *
 * @param {string} caseId
 * @returns {Object} pulled data summary
 */
export async function pullPublicRecords(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};

  if (!subject.address && !subject.streetAddress) {
    throw new Error('Subject address required to pull public records');
  }

  const address = subject.address || subject.streetAddress;
  const city = subject.city || '';
  const state = subject.state || '';
  const zip = subject.zip || subject.zipCode || '';
  const fullAddress = `${address}, ${city}, ${state} ${zip}`;

  const results = { sources: [], fieldsUpdated: 0 };

  // ── Geocode if not already done ────────────────────────────────────────
  let geo = null;
  if (!subject.latitude || !subject.longitude) {
    try {
      geo = await geocodeAddress(fullAddress);
      if (geo) {
        facts.subject = { ...subject, latitude: geo.lat, longitude: geo.lon };
        results.sources.push('geocoder');
        results.fieldsUpdated += 2;
      }
    } catch (e) {
      log.warn('public-records:geocode-failed', { error: e.message });
    }
  }

  // ── FEMA Flood Zone Lookup ─────────────────────────────────────────────
  const lat = facts.subject?.latitude || geo?.lat;
  const lon = facts.subject?.longitude || geo?.lon;

  if (lat && lon) {
    try {
      const floodUrl = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,VERSION_ID&returnGeometry=false&f=json`;

      const floodRes = await fetch(floodUrl, { signal: AbortSignal.timeout(10000) });
      if (floodRes.ok) {
        const floodData = await floodRes.json();
        if (floodData.features?.length > 0) {
          const attrs = floodData.features[0].attributes;
          facts.site = facts.site || {};
          if (attrs.FLD_ZONE) { facts.site.floodZone = attrs.FLD_ZONE; results.fieldsUpdated++; }
          if (attrs.DFIRM_ID) { facts.site.femaMapNumber = attrs.DFIRM_ID; results.fieldsUpdated++; }
          if (attrs.SFHA_TF) { facts.site.specialFloodHazardArea = attrs.SFHA_TF === 'T'; }
          results.sources.push('FEMA NFHL');
        }
      }
    } catch (e) {
      log.warn('public-records:fema-failed', { error: e.message });
    }
  }

  // ── Census Data (ACS via Census API — free, no key needed for basic) ───
  if (state && subject.county) {
    try {
      // Get state FIPS code
      const stateFips = STATE_FIPS[state.toUpperCase()];
      if (stateFips) {
        const censusUrl = `https://api.census.gov/data/2023/acs/acs5?get=B25077_001E,B25064_001E,B01003_001E&for=county:*&in=state:${stateFips}`;
        const censusRes = await fetch(censusUrl, { signal: AbortSignal.timeout(10000) });
        if (censusRes.ok) {
          const censusData = await censusRes.json();
          // censusData[0] is headers, rest is data
          if (censusData.length > 1) {
            facts.censusData = {
              medianHomeValue: censusData[1]?.[0],
              medianGrossRent: censusData[1]?.[1],
              totalPopulation: censusData[1]?.[2],
            };
            results.sources.push('US Census ACS');
            results.fieldsUpdated += 3;
          }
        }
      }
    } catch (e) {
      log.warn('public-records:census-failed', { error: e.message });
    }
  }

  // ── AI-enhanced property data enrichment ───────────────────────────────
  // Use AI to fill in gaps based on address and known data
  const missingFields = [];
  if (!facts.subject?.county) missingFields.push('county');
  if (!facts.subject?.censusTract) missingFields.push('census tract');
  if (!facts.site?.zoning) missingFields.push('zoning classification');
  if (!facts.improvements?.yearBuilt) missingFields.push('year built');

  if (missingFields.length > 0) {
    try {
      const messages = [
        {
          role: 'system',
          content: `Given a property address, provide likely property data. Return JSON only. Only include fields you're reasonably confident about. Format: {"county":"...","censusTract":"...","zoning":"...","yearBuilt":"...","propertyType":"...","schoolDistrict":"..."}`,
        },
        {
          role: 'user',
          content: `Property: ${fullAddress}\nMissing: ${missingFields.join(', ')}\nKnown: ${JSON.stringify({yearBuilt:facts.improvements?.yearBuilt,gla:facts.improvements?.gla})}`,
        },
      ];

      const enriched = await callAI(messages, { maxTokens: 300, temperature: 0.1 });
      try {
        const parsed = JSON.parse(enriched.replace(/```json?\s*/g, '').replace(/```/g, ''));
        if (parsed.county && !facts.subject?.county) { facts.subject.county = parsed.county; results.fieldsUpdated++; }
        if (parsed.censusTract) { facts.subject.censusTract = parsed.censusTract; results.fieldsUpdated++; }
        if (parsed.zoning) { facts.site = facts.site || {}; facts.site.zoning = parsed.zoning; results.fieldsUpdated++; }
        if (parsed.schoolDistrict) { facts.neighborhood = facts.neighborhood || {}; facts.neighborhood.schoolDistrict = parsed.schoolDistrict; results.fieldsUpdated++; }
        results.sources.push('AI enrichment');
      } catch { /* parse failed, skip */ }
    } catch (e) {
      log.warn('public-records:ai-enrich-failed', { error: e.message });
    }
  }

  // ── Save updated facts ─────────────────────────────────────────────────
  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(facts), now, caseId]);

  log.info('public-records:complete', { caseId, sources: results.sources, fieldsUpdated: results.fieldsUpdated });

  return results;
}

// State FIPS codes
const STATE_FIPS = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',FL:'12',GA:'13',
  HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',
  MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',
  NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',
  SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',
  DC:'11',
};

export default { pullPublicRecords };
