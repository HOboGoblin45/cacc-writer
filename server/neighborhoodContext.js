/**
 * neighborhoodContext.js
 * ----------------------
 * Queries the OpenStreetMap Overpass API for neighborhood boundary features
 * around a subject property. No API key required. Free to use.
 *
 * Returns major roads, land use types, and natural/water features within
 * a configurable radius. This data is injected into the AI prompt so it can
 * write accurate neighborhood boundary descriptions like:
 *   "The subject neighborhood is bounded to the north by Veterans Parkway
 *    (US-51), to the east by the Illinois River, to the south by I-74,
 *    and to the west by the Burlington Northern Santa Fe rail corridor."
 *
 * Overpass API: https://overpass-api.de/
 * No authentication required. Reasonable use policy applies.
 */

import log from './logger.js';
import { distanceMiles, cardinalDirection } from './geocoder.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ── Feature type labels ───────────────────────────────────────────────────────

const HIGHWAY_LABELS = {
  motorway:      'Interstate/Freeway',
  motorway_link: 'Interstate ramp',
  trunk:         'US Highway',
  trunk_link:    'US Highway ramp',
  primary:       'State Highway / Major Arterial',
  primary_link:  'Major Arterial ramp',
  secondary:     'Secondary Arterial',
  secondary_link:'Secondary Arterial ramp',
};

const LANDUSE_LABELS = {
  residential:       'residential neighborhood',
  commercial:        'commercial district',
  retail:            'retail/commercial area',
  industrial:        'industrial area',
  farmland:          'agricultural/farmland',
  farm:              'agricultural/farmland',
  forest:            'forested area',
  park:              'park/open space',
  recreation_ground: 'recreational area',
  cemetery:          'cemetery',
  military:          'military installation',
  allotments:        'allotment gardens',
  meadow:            'open meadow/grassland',
};

const NATURAL_LABELS = {
  water:    'body of water',
  wood:     'wooded area',
  grassland:'open grassland',
  wetland:  'wetland',
  scrub:    'scrubland',
};

const WATERWAY_LABELS = {
  river:  'river',
  stream: 'stream',
  canal:  'canal',
  drain:  'drainage channel',
};

// Fields that benefit from location context injection
export const LOCATION_CONTEXT_FIELDS = new Set([
  'neighborhood_description',
  'neighborhood_boundaries',
  'market_conditions',
  'market_conditions_addendum',
  'market_area',
  'sca_summary',
  'sales_comparison',
  'sales_comparison_commentary',
]);

// ── Overpass query ────────────────────────────────────────────────────────────

/**
 * getNeighborhoodBoundaryFeatures(lat, lng, radiusMiles)
 *
 * Queries Overpass for features that typically define neighborhood boundaries
 * in residential appraisal reports.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusMiles=1.5]  Search radius (1.5 miles covers most neighborhoods)
 * @returns {Promise<object>}
 *   {
 *     majorRoads:    string[],   // named roads with type labels
 *     landUseTypes:  string[],   // surrounding land use descriptions
 *     waterFeatures: string[],   // named water bodies and features
 *     parks:         string[],   // named parks and open spaces
 *     summary:       string|null // formatted summary for prompt injection
 *   }
 */
export async function getNeighborhoodBoundaryFeatures(lat, lng, radiusMiles = 1.5) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  // Overpass QL — query roads, land use, water, parks around the subject
  const query = `
[out:json][timeout:30];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"](around:${radiusMeters},${lat},${lng});
  way["landuse"~"^(residential|commercial|retail|industrial|farmland|farm|forest|park|recreation_ground|cemetery|military|allotments|meadow)$"](around:${radiusMeters},${lat},${lng});
  way["natural"~"^(water|wood|grassland|wetland)$"](around:${radiusMeters},${lat},${lng});
  relation["natural"="water"](around:${radiusMeters},${lat},${lng});
  way["waterway"~"^(river|stream|canal)$"](around:${radiusMeters},${lat},${lng});
  way["leisure"~"^(park|nature_reserve|golf_course)$"](around:${radiusMeters},${lat},${lng});
  node["railway"="station"](around:${radiusMeters},${lat},${lng});
  way["railway"~"^(rail|light_rail)$"](around:${radiusMeters},${lat},${lng});
);
out tags;
  `.trim();

  try {
    const res = await fetch(OVERPASS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query),
      signal:  AbortSignal.timeout(35_000),
    });

    if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);
    const data = await res.json();

    return processOverpassResults(data.elements || [], lat, lng);
  } catch (err) {
    log.warn('neighborhoodContext:overpass-failed', { error: err.message });
    return {
      majorRoads:    [],
      landUseTypes:  [],
      waterFeatures: [],
      parks:         [],
      railFeatures:  [],
      summary:       null,
      error:         err.message,
    };
  }
}

// ── Result processing ─────────────────────────────────────────────────────────

function processOverpassResults(elements, subjectLat, subjectLng) {
  const majorRoads    = new Map(); // name → { type, label, ref }
  const landUseTypes  = new Set();
  const waterFeatures = new Set();
  const parks         = new Set();
  const railFeatures  = new Set();

  for (const el of elements) {
    const tags = el.tags || {};

    // ── Major roads ──────────────────────────────────────────────────────────
    if (tags.highway && HIGHWAY_LABELS[tags.highway]) {
      const name = tags.name || null;
      const ref  = tags.ref  || null;
      const key  = name || ref;
      if (key && !majorRoads.has(key)) {
        majorRoads.set(key, {
          type:  tags.highway,
          label: HIGHWAY_LABELS[tags.highway],
          name,
          ref,
        });
      }
    }

    // ── Land use ─────────────────────────────────────────────────────────────
    if (tags.landuse && LANDUSE_LABELS[tags.landuse]) {
      landUseTypes.add(LANDUSE_LABELS[tags.landuse]);
    }

    // ── Parks and open space ─────────────────────────────────────────────────
    if (tags.leisure === 'park' || tags.leisure === 'nature_reserve' || tags.leisure === 'golf_course') {
      const name = tags.name;
      if (name) parks.add(name + (tags.leisure === 'golf_course' ? ' (golf course)' : ' (park)'));
      else parks.add('unnamed park/open space');
    }

    // ── Water features ───────────────────────────────────────────────────────
    if (tags.natural === 'water' || tags.waterway) {
      const name = tags.name || null;
      const type = tags.waterway
        ? (WATERWAY_LABELS[tags.waterway] || tags.waterway)
        : 'body of water';
      if (name) waterFeatures.add(`${name} (${type})`);
      else if (type !== 'body of water') waterFeatures.add(type);
    }
    if (tags.natural === 'wood') landUseTypes.add('wooded area');
    if (tags.natural === 'wetland') waterFeatures.add('wetland area');

    // ── Rail features ────────────────────────────────────────────────────────
    if (tags.railway === 'rail' || tags.railway === 'light_rail') {
      const name = tags.name || tags.operator || null;
      if (name) railFeatures.add(name + ' rail corridor');
      else railFeatures.add('railroad corridor');
    }
    if (tags.railway === 'station' && tags.name) {
      railFeatures.add(tags.name + ' (rail station)');
    }
  }

  // Build sorted, deduplicated arrays
  const roadList  = Array.from(majorRoads.entries())
    .slice(0, 10)
    .map(([, info]) => {
      const parts = [];
      if (info.name) parts.push(info.name);
      if (info.ref && info.ref !== info.name) parts.push(`(${info.ref})`);
      parts.push(`[${info.label}]`);
      return parts.join(' ');
    });

  const landList  = Array.from(landUseTypes).slice(0, 6);
  const waterList = Array.from(waterFeatures).slice(0, 5);
  const parkList  = Array.from(parks).slice(0, 4);
  const railList  = Array.from(railFeatures).slice(0, 3);

  return {
    majorRoads:   roadList,
    landUseTypes: landList,
    waterFeatures: waterList,
    parks:        parkList,
    railFeatures: railList,
    summary:      buildBoundarySummary(roadList, landList, waterList, parkList, railList),
  };
}

function buildBoundarySummary(roads, landUse, water, parks, rail) {
  const parts = [];
  if (roads.length)   parts.push(`Major roads/boundaries nearby: ${roads.join('; ')}`);
  if (water.length)   parts.push(`Water/natural features: ${water.join(', ')}`);
  if (parks.length)   parts.push(`Parks/open space: ${parks.join(', ')}`);
  if (rail.length)    parts.push(`Rail features: ${rail.join(', ')}`);
  if (landUse.length) parts.push(`Surrounding land uses: ${landUse.join(', ')}`);
  return parts.length ? parts.join('\n') : null;
}

// ── Prompt block formatter ────────────────────────────────────────────────────

/**
 * formatLocationContextBlock(geocodeData)
 *
 * Formats geocoded subject + comp data + boundary features into a
 * prompt-ready string block for injection into buildPromptMessages().
 *
 * @param {object} geocodeData
 *   {
 *     subject:          { address, result: geocodeResult },
 *     comps:            [{ address, result, distance, direction }],
 *     boundaryFeatures: overpassResult
 *   }
 * @returns {string}
 */
export function formatLocationContextBlock(geocodeData) {
  if (!geocodeData) return '';

  const { subject, comps = [], boundaryFeatures } = geocodeData;
  const lines = ['LOCATION CONTEXT (use for neighborhood boundaries and comp proximity):'];

  // ── Subject location ──────────────────────────────────────────────────────
  if (subject?.result) {
    const s = subject.result;
    lines.push('\nSUBJECT LOCATION:');
    if (s.neighborhood) lines.push(`  Neighborhood/Subdivision: ${s.neighborhood}`);
    if (s.suburb)       lines.push(`  Suburb/Area: ${s.suburb}`);
    if (s.city)         lines.push(`  City: ${s.city}`);
    if (s.county)       lines.push(`  County: ${s.county}`);
    if (s.state)        lines.push(`  State: ${s.state}`);
    lines.push(`  Coordinates: ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`);
  }

  // ── Comp distances and directions ─────────────────────────────────────────
  if (comps.length) {
    lines.push('\nCOMPARABLE SALE PROXIMITY (distance and direction from subject):');
    comps.forEach((comp, i) => {
      if (!comp.result) {
        lines.push(`  Comp ${i + 1}: ${comp.address} — [geocode unavailable]`);
        return;
      }
      const dist = comp.distance != null ? comp.distance.toFixed(2) + ' miles' : 'unknown distance';
      const dir  = comp.direction ? comp.direction + ' of subject' : 'of subject';
      lines.push(`  Comp ${i + 1}: ${comp.address}`);
      lines.push(`    → ${dist} ${dir}`);
      // Flag if comp is in a different city (relevant for neighborhood analysis)
      const subjectCity = subject?.result?.city;
      if (comp.result.city && subjectCity && comp.result.city !== subjectCity) {
        lines.push(`    → NOTE: Located in ${comp.result.city} (different city than subject)`);
      }
    });
  }

  // ── Neighborhood boundary features ───────────────────────────────────────
  if (boundaryFeatures && !boundaryFeatures.error) {
    lines.push('\nNEIGHBORHOOD BOUNDARY FEATURES (within ~1.5 miles of subject):');

    if (boundaryFeatures.majorRoads?.length) {
      lines.push('  Major roads that may form neighborhood boundaries:');
      boundaryFeatures.majorRoads.forEach(r => lines.push(`    - ${r}`));
    }
    if (boundaryFeatures.waterFeatures?.length) {
      lines.push(`  Water/natural barriers: ${boundaryFeatures.waterFeatures.join(', ')}`);
    }
    if (boundaryFeatures.parks?.length) {
      lines.push(`  Parks/open space: ${boundaryFeatures.parks.join(', ')}`);
    }
    if (boundaryFeatures.railFeatures?.length) {
      lines.push(`  Rail corridors: ${boundaryFeatures.railFeatures.join(', ')}`);
    }
    if (boundaryFeatures.landUseTypes?.length) {
      lines.push(`  Surrounding land uses: ${boundaryFeatures.landUseTypes.join(', ')}`);
    }

    lines.push('');
    lines.push('  INSTRUCTION: Use the roads, water features, and land use changes above to');
    lines.push('  describe the neighborhood boundaries. Example format:');
    lines.push('  "The subject neighborhood is bounded to the north by [road/feature],');
    lines.push('   to the east by [road/feature], to the south by [road/feature],');
    lines.push('   and to the west by [road/feature]."');
    lines.push('  Only use features that are actually present in the data above.');
  } else if (boundaryFeatures?.error) {
    lines.push('\n  [Location boundary data unavailable — describe boundaries based on known facts]');
  }

  return lines.join('\n');
}
