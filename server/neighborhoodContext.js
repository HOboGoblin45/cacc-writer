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
 * Uses an 800m radius (≈0.5 mile) for boundary roads to find the perimeter
 * roads that form the neighborhood edge — not just adjacent streets.
 * Roads are found by cardinal extremes (northernmost, southernmost, etc.)
 * so the AI can write accurate N/S/E/W boundary descriptions.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusMiles=1.5]  Search radius for land use / non-road features
 * @returns {Promise<object>}
 *   {
 *     majorRoads:      string[],   // named roads with type labels (all)
 *     boundaryRoads:   object,     // { north, south, east, west } — named boundary roads
 *     landUseTypes:    string[],   // surrounding land use descriptions
 *     waterFeatures:   string[],   // named water bodies and features
 *     parks:           string[],   // named parks and open spaces
 *     summary:         string|null // formatted summary for prompt injection
 *   }
 */
export async function getNeighborhoodBoundaryFeatures(lat, lng, radiusMiles = 1.5) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  // Use a fixed ~800m radius for boundary roads (neighborhood perimeter)
  const boundaryRadiusMeters = 800;

  // Overpass QL — query roads, land use, water, parks around the subject
  // Use `out center;` for roads so we get center coordinates for cardinal positioning
  const query = `
[out:json][timeout:30];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"]["name"](around:${boundaryRadiusMeters},${lat},${lng});
  way["landuse"~"^(residential|commercial|retail|industrial|farmland|farm|forest|park|recreation_ground|cemetery|military|allotments|meadow)$"](around:${radiusMeters},${lat},${lng});
  way["natural"~"^(water|wood|grassland|wetland)$"](around:${radiusMeters},${lat},${lng});
  relation["natural"="water"](around:${radiusMeters},${lat},${lng});
  way["waterway"~"^(river|stream|canal)$"](around:${radiusMeters},${lat},${lng});
  way["leisure"~"^(park|nature_reserve|golf_course)$"](around:${radiusMeters},${lat},${lng});
  node["railway"="station"](around:${radiusMeters},${lat},${lng});
  way["railway"~"^(rail|light_rail)$"](around:${radiusMeters},${lat},${lng});
);
out center tags;
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

// Highway types eligible for boundary road selection (ordered by priority)
const BOUNDARY_HIGHWAY_PRIORITY = {
  motorway:   5,
  trunk:      5,
  primary:    4,
  secondary:  3,
  tertiary:   2,
  residential: 1,
};

function processOverpassResults(elements, subjectLat, subjectLng) {
  const majorRoads    = new Map(); // name → { type, label, ref }
  const landUseTypes  = new Set();
  const waterFeatures = new Set();
  const parks         = new Set();
  const railFeatures  = new Set();

  // For boundary road detection: track road candidates with center coordinates
  // Structure: { name, type, priority, centerLat, centerLng }
  const boundaryRoadCandidates = [];

  for (const el of elements) {
    const tags = el.tags || {};

    // ── Major roads ──────────────────────────────────────────────────────────
    const hwType = tags.highway;
    if (hwType && (HIGHWAY_LABELS[hwType] || BOUNDARY_HIGHWAY_PRIORITY[hwType])) {
      const name = tags.name || null;
      const ref  = tags.ref  || null;
      const key  = name || ref;
      if (key && HIGHWAY_LABELS[hwType] && !majorRoads.has(key)) {
        majorRoads.set(key, {
          type:  hwType,
          label: HIGHWAY_LABELS[hwType],
          name,
          ref,
        });
      }
      // Collect for boundary detection if named and has center coords
      if (name && BOUNDARY_HIGHWAY_PRIORITY[hwType]) {
        const centerLat = el.center?.lat ?? null;
        const centerLng = el.center?.lon ?? null;
        if (centerLat !== null && centerLng !== null) {
          boundaryRoadCandidates.push({
            name,
            type:     hwType,
            priority: BOUNDARY_HIGHWAY_PRIORITY[hwType],
            centerLat,
            centerLng,
          });
        }
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

  // ── Boundary roads: find the road at each cardinal extreme ───────────────
  // For each direction, find the road whose center point is the furthest
  // in that direction. Prefer higher-priority road types when close in position.
  // Deduplicate so the same road isn't used for multiple directions.
  const boundaryRoads = computeBoundaryRoads(boundaryRoadCandidates, subjectLat, subjectLng);

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
    majorRoads:    roadList,
    boundaryRoads,
    landUseTypes:  landList,
    waterFeatures: waterList,
    parks:         parkList,
    railFeatures:  railList,
    summary:       buildBoundarySummary(roadList, boundaryRoads, landList, waterList, parkList, railList),
  };
}

/**
 * computeBoundaryRoads(candidates, subjectLat, subjectLng)
 *
 * Finds the road at each cardinal extreme of the candidate set.
 * Uses a scoring approach: northernmost road for north boundary, etc.
 * Deduplicates across directions (same road won't serve two boundaries).
 *
 * Returns { north, south, east, west } — each is a road name string or null.
 */
function computeBoundaryRoads(candidates, subjectLat, subjectLng) {
  if (!candidates.length) return { north: null, south: null, east: null, west: null };

  // Score each candidate for each direction: distance in that axis from subject
  // northernmost = highest lat, southernmost = lowest lat, etc.
  // Tiebreak by priority (prefer secondary > tertiary > residential)
  const scored = candidates.map(c => ({
    ...c,
    dLat: c.centerLat - subjectLat,   // positive = north of subject
    dLng: c.centerLng - subjectLng,   // positive = east of subject
  }));

  // Group by name to get the most extreme point for each named road
  const byName = new Map();
  for (const c of scored) {
    if (!byName.has(c.name)) {
      byName.set(c.name, { ...c, maxLat: c.centerLat, minLat: c.centerLat, maxLng: c.centerLng, minLng: c.centerLng });
    } else {
      const existing = byName.get(c.name);
      if (c.centerLat > existing.maxLat) existing.maxLat = c.centerLat;
      if (c.centerLat < existing.minLat) existing.minLat = c.centerLat;
      if (c.centerLng > existing.maxLng) existing.maxLng = c.centerLng;
      if (c.centerLng < existing.minLng) existing.minLng = c.centerLng;
      // Use highest priority type seen
      if (c.priority > existing.priority) {
        existing.priority = c.priority;
        existing.type = c.type;
      }
    }
  }

  const roads = Array.from(byName.values());

  // Pick boundary roads for each direction
  // North = road with highest maxLat (furthest north of subject)
  // South = road with lowest minLat (furthest south of subject)
  // East = road with highest maxLng (furthest east)
  // West = road with lowest minLng (furthest west)
  function pickBest(sortFn, used = new Set()) {
    const sorted = roads
      .filter(r => !used.has(r.name))
      .sort(sortFn);
    return sorted[0] || null;
  }

  const used = new Set();

  const northRoad = pickBest((a, b) => b.maxLat - a.maxLat || b.priority - a.priority, used);
  if (northRoad) used.add(northRoad.name);

  const southRoad = pickBest((a, b) => a.minLat - b.minLat || b.priority - a.priority, used);
  if (southRoad) used.add(southRoad.name);

  const eastRoad = pickBest((a, b) => b.maxLng - a.maxLng || b.priority - a.priority, used);
  if (eastRoad) used.add(eastRoad.name);

  const westRoad = pickBest((a, b) => a.minLng - b.minLng || b.priority - a.priority, used);
  if (westRoad) used.add(westRoad.name);

  return {
    north: northRoad?.name || null,
    south: southRoad?.name || null,
    east:  eastRoad?.name  || null,
    west:  westRoad?.name  || null,
  };
}

function buildBoundarySummary(roads, boundaryRoads, landUse, water, parks, rail) {
  const parts = [];

  // Boundary roads summary (N/S/E/W)
  if (boundaryRoads && Object.values(boundaryRoads).some(Boolean)) {
    const bParts = [];
    if (boundaryRoads.north) bParts.push(`north: ${boundaryRoads.north}`);
    if (boundaryRoads.south) bParts.push(`south: ${boundaryRoads.south}`);
    if (boundaryRoads.east)  bParts.push(`east: ${boundaryRoads.east}`);
    if (boundaryRoads.west)  bParts.push(`west: ${boundaryRoads.west}`);
    if (bParts.length) parts.push(`Neighborhood boundary roads: ${bParts.join('; ')}`);
  }

  if (roads.length)   parts.push(`Additional roads nearby: ${roads.join('; ')}`);
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
    lines.push('\nNEIGHBORHOOD BOUNDARY FEATURES (within ~800m of subject):');

    // ── Directional boundary roads (primary reference) ─────────────────────
    const br = boundaryFeatures.boundaryRoads;
    if (br && Object.values(br).some(Boolean)) {
      lines.push('  BOUNDARY ROADS (use these for N/S/E/W boundary descriptions):');
      if (br.north) lines.push(`    North boundary: ${br.north}`);
      if (br.south) lines.push(`    South boundary: ${br.south}`);
      if (br.east)  lines.push(`    East boundary:  ${br.east}`);
      if (br.west)  lines.push(`    West boundary:  ${br.west}`);
    }

    if (boundaryFeatures.majorRoads?.length) {
      lines.push('  Other major roads nearby:');
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
    lines.push('  MANDATORY NEIGHBORHOOD BOUNDARY SENTENCE (use this verbatim):');
    const filledSentence = `  "The subject neighborhood is bordered to the North by ${br.north || '[INSERT north road]'}, to the South by ${br.south || '[INSERT south road]'}, to the East by ${br.east || '[INSERT east road]'}, and to the West by ${br.west || '[INSERT west road]'}."`;    lines.push(filledSentence);
    lines.push('  The road names above are ALREADY KNOWN. Do NOT replace them with [INSERT]. Use them verbatim.');
  } else if (boundaryFeatures?.error) {
    lines.push('\n  [Location boundary data unavailable — describe boundaries based on known facts]');
  }

  return lines.join('\n');
}
