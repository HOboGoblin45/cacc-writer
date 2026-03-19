/**
 * server/comparables/mredCsvParser.js
 * -------------------------------------
 * Parse MRED/connectMLS CSV exports into structured comp objects.
 *
 * MRED exports vary by search configuration. This parser handles the most
 * common column names Charles uses. Unknown columns are preserved in rawRow.
 *
 * NOTE: csv-parse is not installed. This uses a hand-rolled CSV parser that
 * handles quoted fields, commas inside quotes, and Windows line endings.
 * If you install csv-parse (npm install csv-parse), swap in the import at top.
 *
 * Usage:
 *   const comps = parseMredCsv(csvText);
 */

// ── Simple CSV parser (no external deps) ─────────────────────────────────────

/**
 * Parse a CSV string into an array of row arrays.
 * Handles: quoted fields, embedded commas, embedded newlines, CRLF.
 */
function parseRawCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  // Last field / row
  if (field.trim() || row.length > 0) {
    row.push(field.trim());
    if (row.some(f => f !== '')) rows.push(row);
  }

  return rows;
}

/**
 * Convert raw rows to array of objects using first row as headers.
 */
function csvToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function parseMoney(val) {
  if (!val) return 0;
  return parseInt(String(val).replace(/[$,\s]/g, '')) || 0;
}

function pick(record, ...keys) {
  for (const k of keys) {
    const v = record[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse MRED CSV export text into structured comp objects.
 *
 * @param {string} csvText - raw CSV file contents
 * @returns {Array<Object>} - array of comp objects
 */
export function parseMredCsv(csvText) {
  const rows = parseRawCsv(csvText);
  const records = csvToObjects(rows);

  return records.map((r, i) => {
    const address = [
      pick(r, 'Address', 'Street Address', 'Prop Address'),
      pick(r, 'City'),
      pick(r, 'State', 'ST') || 'IL',
    ].filter(Boolean).join(', ');

    return {
      index:       i + 1,
      mlsNumber:   pick(r, 'MLS#', 'MLS Number', 'List Number', 'ML#'),
      address,
      salePrice:   parseMoney(pick(r, 'Sale Price', 'Sold Price', 'Close Price', 'Closed Price')),
      saleDate:    pick(r, 'Sale Date', 'Close Date', 'Sold Date', 'Closed Date'),
      listDate:    pick(r, 'List Date', 'Listing Date'),
      daysOnMarket: parseInt(pick(r, 'DOM', 'Days on Market', 'Days On Market')) || 0,
      beds:        parseInt(pick(r, 'Beds', 'Bedrooms', 'Bed')) || 0,
      baths:       parseFloat(pick(r, 'Baths', 'Bathrooms', 'Bath', 'Total Baths')) || 0,
      gla:         parseInt(pick(r, 'Sq Ft', 'GLA', 'Sqft', 'Total Sq Ft', 'Above Grade Sq Ft', 'SqFt')) || 0,
      yearBuilt:   parseInt(pick(r, 'Year Built', 'Yr Built')) || 0,
      lotSize:     pick(r, 'Lot Size', 'Lot Acres', 'Lot Sq Ft', 'Lot Area'),
      garage:      pick(r, 'Garage', 'Garage Spaces', 'Gar Spaces', 'Garage Type'),
      basement:    pick(r, 'Basement', 'Bsmt', 'Basement Type'),
      concessions: parseMoney(pick(r, 'Seller Concessions', 'Concessions', 'Seller Contrib')),
      subdivision: pick(r, 'Subdivision', 'Neighborhood', 'Subdiv', 'Sub'),
      listPrice:   parseMoney(pick(r, 'List Price', 'Original List Price')),
      style:       pick(r, 'Style', 'Architectural Style', 'Arch Style'),
      status:      pick(r, 'Status', 'MLS Status'),
      // Filled in after geocoding
      distanceMiles:   null,
      cardinalDir:     '',
      proximity:       '',
      rawRow: r,
    };
  }).filter(c => c.address || c.mlsNumber); // drop totally empty rows
}

/**
 * Format a parsed comp for display in the UI table.
 */
export function formatCompForDisplay(comp, subjectGla = 0) {
  const glaStr  = comp.gla ? `${comp.gla.toLocaleString()} sf` : '—';
  const glaDiff = (comp.gla && subjectGla)
    ? ((comp.gla - subjectGla) / subjectGla * 100).toFixed(1) + '%'
    : '—';
  const priceStr = comp.salePrice ? `$${comp.salePrice.toLocaleString()}` : '—';
  const pricePerSf = (comp.salePrice && comp.gla)
    ? `$${Math.round(comp.salePrice / comp.gla)}/sf`
    : '—';
  const distStr = comp.distanceMiles !== null ? `${comp.distanceMiles.toFixed(2)} mi` : '—';
  const proximity = comp.proximity || (comp.distanceMiles !== null
    ? `${comp.distanceMiles.toFixed(2)} miles ${comp.cardinalDir || ''}`.trim()
    : '');

  return {
    ...comp,
    glaDisplay:    glaStr,
    glaDiff,
    priceDisplay:  priceStr,
    pricePerSf,
    distDisplay:   distStr,
    proximityText: proximity,
  };
}
