/**
 * server/dataPipeline/admMapper.js
 * Maps raw extracted Cloudflare crawl data into the ADM schema structure.
 * Handles field normalization, unit conversion, UAD formatting, and conflict detection.
 *
 * The ADM (Appraisal Data Model) is an intermediate representation that sits between
 * raw web-scraped data and the facts schemas defined in forms/1004.js and forms/commercial.js.
 */

// ---------------------------------------------------------------------------
// FIELD NORMALIZATION MAPS
// ---------------------------------------------------------------------------

/** Maps common variations of field names from different sources to canonical ADM names. */
const FIELD_ALIASES = {
  // GLA / square footage
  sqft:            'gross_living_area',
  square_feet:     'gross_living_area',
  square_footage:  'gross_living_area',
  living_area:     'gross_living_area',
  gla:             'gross_living_area',
  heated_area:     'gross_living_area',
  finished_area:   'gross_living_area',
  above_grade_sf:  'gross_living_area',

  // Year built
  yr_built:        'year_built',
  year:            'year_built',
  built:           'year_built',
  year_constructed: 'year_built',

  // Bedrooms / Bathrooms
  beds:            'bedrooms',
  br:              'bedrooms',
  bed:             'bedrooms',
  num_beds:        'bedrooms',
  baths:           'bathrooms_full',
  ba:              'bathrooms_full',
  full_baths:      'bathrooms_full',
  full_bathrooms:  'bathrooms_full',
  half_baths:      'bathrooms_half',
  half_ba:         'bathrooms_half',

  // Site / lot
  lot_sqft:        'site_area',
  lot_size:        'site_area',
  lot_sf:          'site_area',
  lot_acres:       'site_area_acres',
  acreage:         'site_area_acres',
  land_area:       'site_area',

  // Sale / price
  sale_amount:     'sale_price',
  sold_price:      'sale_price',
  close_price:     'sale_price',
  selling_price:   'sale_price',
  sp:              'sale_price',
  close_date:      'sale_date',
  sold_date:       'sale_date',
  settlement_date: 'sale_date',
  list_amount:     'list_price',
  asking_price:    'list_price',
  lp:              'list_price',
  original_list_price: 'original_list_price',

  // DOM
  dom:             'days_on_market',
  cdom:            'days_on_market',
  market_time:     'days_on_market',
  days_listed:     'days_on_market',

  // Location / address
  street_address:  'address',
  street:          'address',
  prop_address:    'address',
  zip:             'zip_code',
  zipcode:         'zip_code',
  postal_code:     'zip_code',

  // Condition / quality
  cond:            'condition',
  property_condition: 'condition',
  qual:            'quality',
  construction_quality: 'quality',

  // Basement
  bsmt:            'basement',
  basement_sf:     'basement_area',
  basement_sqft:   'basement_area',
  bsmt_fin:        'basement_finished',
  basement_finished_sf: 'basement_finished',

  // Garage
  gar:             'garage',
  garage_spaces:   'garage_count',
  garage_type:     'garage',
  carport:         'garage',

  // Style / design
  style:           'design_style',
  design:          'design_style',
  arch_style:      'design_style',
  prop_type:       'property_type',
  type:            'property_type',

  // View
  view_type:       'view',

  // Stories
  stories:         'stories',
  num_stories:     'stories',
  floors:          'stories',

  // Fireplace
  fireplace:       'fireplaces',
  fp:              'fireplaces',
  num_fireplaces:  'fireplaces',

  // Pool
  pool:            'pool',
  has_pool:        'pool',

  // Zoning
  zone:            'zoning',
  zoning_class:    'zoning',

  // Commercial-specific
  gross_building_area: 'gross_building_area',
  gba:             'gross_building_area',
  building_sf:     'gross_building_area',
  noi:             'net_operating_income',
  cap_rate:        'capitalization_rate',
  pgi:             'potential_gross_income',
  egi:             'effective_gross_income',
  opex:            'operating_expenses',
  vacancy_rate:    'vacancy_rate',

  // Misc
  legal:           'legal_description',
  legal_desc:      'legal_description',
  parcel:          'parcel_id',
  apn:             'parcel_id',
  pid:             'parcel_id',
  tax_id:          'parcel_id',
  hoa_fee:         'hoa_dues',
  hoa:             'hoa_dues',
  flood_zone:      'flood_zone',
  fema_zone:       'flood_zone',
};

// ---------------------------------------------------------------------------
// UAD RATING LOOKUPS
// ---------------------------------------------------------------------------

/** UAD Condition ratings — C1 (new) through C6 (major deficiencies). */
const UAD_CONDITION = {
  // Canonical
  C1: 'C1', C2: 'C2', C3: 'C3', C4: 'C4', C5: 'C5', C6: 'C6',
  // Descriptive aliases → rating
  new:            'C1',
  'brand new':    'C1',
  excellent:      'C2',
  good:           'C3',
  average:        'C4',
  fair:           'C5',
  poor:           'C6',
  // Numeric aliases
  1: 'C1', 2: 'C2', 3: 'C3', 4: 'C4', 5: 'C5', 6: 'C6',
};

/** UAD Quality ratings — Q1 (unique/custom) through Q6 (basic). */
const UAD_QUALITY = {
  Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4', Q5: 'Q5', Q6: 'Q6',
  custom:         'Q1',
  unique:         'Q1',
  'semi-custom':  'Q2',
  'above average': 'Q3',
  average:        'Q4',
  'below average': 'Q5',
  basic:          'Q6',
  economy:        'Q6',
  1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4', 5: 'Q5', 6: 'Q6',
};

/** UAD View abbreviations. Multiple views are semicolon-delimited. */
const UAD_VIEW = {
  neutral:        'N',
  residential:    'Res',
  park:           'Prk',
  golf:           'Gf',
  water:          'Wtr',
  'city skyline': 'CtyS',
  mountain:       'Mtn',
  pastoral:       'Pst',
  woods:          'Wds',
  industrial:     'Ind',
  'busy road':    'BsyRd',
  'power lines':  'PwrLn',
  'limited sight': 'LtdSght',
  commercial:     'Comm',
};

/** UAD Location ratings. */
const UAD_LOCATION = {
  neutral:        'N',
  beneficial:     'B',
  adverse:        'A',
};

// ---------------------------------------------------------------------------
// UNIT CONVERSION HELPERS
// ---------------------------------------------------------------------------

/**
 * Converts acres to square feet.
 * @param {number} acres
 * @returns {number} Square feet
 */
function acresToSqft(acres) {
  return acres * 43560;
}

/**
 * Converts square feet to acres.
 * @param {number} sqft
 * @returns {number} Acres (4 decimal places)
 */
function sqftToAcres(sqft) {
  return Math.round((sqft / 43560) * 10000) / 10000;
}

/**
 * Strips currency symbols, commas, and whitespace; returns a numeric value or null.
 * @param {*} val
 * @returns {number|null}
 */
function parseNumeric(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[$,\s%]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parses an area string, handling "1,847 sf", "0.5 acres", "2400", etc.
 * Always returns value in square feet, or null.
 * @param {*} val
 * @returns {number|null} Area in square feet
 */
function parseArea(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim().toLowerCase();
  if (s === '' || s === '-') return null;

  // Check for acres first
  const acreMatch = s.match(/([\d,.]+)\s*(?:acres?|ac)/);
  if (acreMatch) {
    const acres = parseNumeric(acreMatch[1]);
    return acres != null ? acresToSqft(acres) : null;
  }

  // Strip unit labels and parse
  const cleaned = s.replace(/\s*(sf|sqft|sq\.?\s*ft\.?|square\s*feet)\s*/gi, '').trim();
  return parseNumeric(cleaned);
}

/**
 * Normalizes a date string to YYYY-MM-DD format, or returns null.
 * @param {*} val
 * @returns {string|null}
 */
function parseDate(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || s === '-') return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  const mdySlash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdySlash) {
    const [, m, d, y] = mdySlash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YY
  const mdyShort = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    const fullYear = Number(y) > 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try native Date parse as last resort
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Converts a string to title case.
 * @param {string} s
 * @returns {string}
 */
function titleCase(s) {
  if (!s) return '';
  return String(s).replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

// ---------------------------------------------------------------------------
// ADM FIELD CLASSIFICATIONS
// ---------------------------------------------------------------------------

/** Fields that should be parsed as integers. */
const INTEGER_FIELDS = new Set([
  'gross_living_area', 'gross_building_area', 'bedrooms', 'bathrooms_full',
  'bathrooms_half', 'year_built', 'days_on_market', 'stories', 'fireplaces',
  'garage_count', 'basement_area', 'basement_finished', 'site_area',
]);

/** Fields that should be parsed as currency / floating point. */
const CURRENCY_FIELDS = new Set([
  'sale_price', 'list_price', 'original_list_price', 'hoa_dues',
  'net_operating_income', 'potential_gross_income', 'effective_gross_income',
  'operating_expenses',
]);

/** Fields that should be parsed as percentages / rates. */
const RATE_FIELDS = new Set([
  'capitalization_rate', 'vacancy_rate',
]);

/** Fields that should be date-normalized. */
const DATE_FIELDS = new Set([
  'sale_date', 'list_date', 'contract_date', 'closing_date',
]);

/** Fields that are UAD-formatted. */
const UAD_FIELDS = {
  condition: UAD_CONDITION,
  quality:   UAD_QUALITY,
};

/** Conflict severity thresholds — difference above which a conflict is "high" severity. */
const CONFLICT_THRESHOLDS = {
  gross_living_area: 100,    // > 100 sf difference = high
  site_area:         2000,   // > 2000 sf
  year_built:        2,      // > 2 years
  bedrooms:          1,
  bathrooms_full:    1,
  sale_price:        10000,  // > $10k
  basement_area:     200,
};

// ---------------------------------------------------------------------------
// ADJUSTMENT RATE CONSTANTS (residential)
// ---------------------------------------------------------------------------

const ADJUSTMENT_RATES = {
  gla_per_sqft:            50,     // $/sqft for GLA differences
  site_per_sqft:           1.5,    // $/sqft for site area differences
  age_per_year:            1500,   // $/year for effective age differences
  bedroom_each:            5000,   // $ per bedroom difference
  bathroom_full_each:      8000,   // $ per full bath difference
  bathroom_half_each:      4000,   // $ per half bath difference
  basement_per_sqft:       25,     // $/sqft for basement area differences
  basement_finished_per_sqft: 30,  // $/sqft for finished basement differences
  garage_per_space:        8000,   // $ per garage space difference
  fireplace_each:          3000,   // $ per fireplace difference
  pool_lump:               15000,  // lump-sum pool adjustment
  condition_per_rating:    10000,  // $ per UAD condition rating step
  quality_per_rating:      12000,  // $ per UAD quality rating step
  view_beneficial:         5000,   // $ if view rating differs
  location_beneficial:     5000,   // $ if location rating differs
};

// ---------------------------------------------------------------------------
// ADMMapper CLASS
// ---------------------------------------------------------------------------

export class ADMMapper {
  /**
   * Maps raw extracted property data to ADM schema fields.
   * @param {object} extractedData - Raw data from Cloudflare extraction
   * @param {string} sourceType - 'assessor' | 'listing' | 'market' | 'commercial'
   * @returns {object} ADM-formatted property data
   */
  mapPropertyToADM(extractedData, sourceType) {
    if (!extractedData || typeof extractedData !== 'object') {
      return {};
    }

    const adm = {};
    const source = sourceType || 'unknown';

    for (const [rawKey, rawValue] of Object.entries(extractedData)) {
      if (rawValue == null || rawValue === '') continue;

      // Normalize the key
      const normalizedKey = rawKey.toLowerCase().replace(/[\s-]+/g, '_');
      const admField = FIELD_ALIASES[normalizedKey] || normalizedKey;

      // Convert value based on field type
      const value = this._convertValue(admField, rawValue);
      if (value == null) continue;

      adm[admField] = {
        value,
        source,
        rawKey,
        rawValue,
      };
    }

    // Post-processing: convert acres to sqft if we got site_area_acres but no site_area
    if (adm.site_area_acres && !adm.site_area) {
      const acres = typeof adm.site_area_acres.value === 'number'
        ? adm.site_area_acres.value
        : parseNumeric(adm.site_area_acres.value);
      if (acres != null) {
        adm.site_area = {
          value:    Math.round(acresToSqft(acres)),
          source,
          rawKey:   adm.site_area_acres.rawKey,
          rawValue: adm.site_area_acres.rawValue,
          derived:  true,
        };
      }
    }

    // Apply UAD formatting where applicable
    for (const uadField of Object.keys(UAD_FIELDS)) {
      if (adm[uadField]) {
        adm[uadField].uadFormatted = this.formatUAD(uadField, adm[uadField].value);
      }
    }

    return adm;
  }

  /**
   * Maps comp data into 1004 URAR comp grid structure.
   * @param {object} extractedComp - Raw comp data
   * @param {object} subjectData - Subject property ADM data for comparison
   * @returns {object} Comp grid row with sale info, physical characteristics, and adjustments
   */
  mapCompToGrid(extractedComp, subjectData) {
    const compADM = this.mapPropertyToADM(extractedComp, 'listing');
    const val = (field) => compADM[field]?.value ?? null;
    const subVal = (field) => {
      if (!subjectData) return null;
      // Handle both ADM-mapped objects and plain values
      const v = subjectData[field];
      return v && typeof v === 'object' && 'value' in v ? v.value : v ?? null;
    };

    const grid = {
      address:            val('address') || null,
      proximity:          val('proximity') || null,
      salePrice:          val('sale_price'),
      salePricePerSqft:   null,
      dataSource:         val('data_source') || null,
      verificationSource: val('verification_source') || null,
      saleDate:           val('sale_date'),
      saleType:           val('sale_type') || null,
      financingType:      val('financing_type') || 'Conv',
      concessions:        val('concessions') || 'None',
      location:           this.formatUAD('location', val('location') || 'N'),
      leaseholdFeeSimple: val('leasehold_fee_simple') || 'Fee Simple',
      site:               val('site_area'),
      view:               this.formatUAD('view', val('view') || 'N;Res'),
      designStyle:        val('design_style') || null,
      quality:            this.formatUAD('quality', val('quality')),
      actualAge:          val('year_built') ? new Date().getFullYear() - val('year_built') : null,
      condition:          this.formatUAD('condition', val('condition')),
      gla:                val('gross_living_area'),
      totalRoomCount:     this._totalRoomCount(val('bedrooms'), val('bathrooms_full'), val('bathrooms_half')),
      bedrooms:           val('bedrooms'),
      bathrooms:          this._formatBathCount(val('bathrooms_full'), val('bathrooms_half')),
      basement:           this._formatBasement(val('basement_area'), val('basement_finished')),
      functionalUtility:  val('functional_utility') || null,
      heatingCooling:     val('heating_cooling') || null,
      energyEfficient:    val('energy_efficient') || null,
      garage:             val('garage') || null,
      garageCount:        val('garage_count') || null,
      porch:              val('porch') || null,
      pool:               val('pool') || null,
      fireplaces:         val('fireplaces') || null,
      dom:                val('days_on_market'),
    };

    // Compute price per sqft
    if (grid.salePrice && grid.gla) {
      grid.salePricePerSqft = Math.round(grid.salePrice / grid.gla);
    }

    // Generate adjustments vs subject if subject data provided
    if (subjectData) {
      grid.adjustments = this.suggestAdjustments(subjectData, compADM);
      grid.netAdjustment = this._sumAdjustments(grid.adjustments);
      grid.grossAdjustment = this._sumAbsAdjustments(grid.adjustments);
      grid.adjustedSalePrice = grid.salePrice != null
        ? grid.salePrice + grid.netAdjustment
        : null;
    }

    return grid;
  }

  /**
   * Detects conflicts between multiple sources for the same property.
   * @param {object} source1Data - First source ADM data
   * @param {object} source2Data - Second source ADM data
   * @returns {Array<{field, value1, value2, source1, source2, severity}>} Conflicts
   */
  detectConflicts(source1Data, source2Data) {
    if (!source1Data || !source2Data) return [];

    const conflicts = [];
    const allFields = new Set([
      ...Object.keys(source1Data),
      ...Object.keys(source2Data),
    ]);

    for (const field of allFields) {
      const entry1 = source1Data[field];
      const entry2 = source2Data[field];
      if (!entry1 || !entry2) continue;

      const v1 = entry1.value ?? entry1;
      const v2 = entry2.value ?? entry2;

      // Skip if values are identical
      if (v1 === v2) continue;
      if (typeof v1 === 'number' && typeof v2 === 'number' && v1 === v2) continue;

      // For numeric fields, check if difference exceeds threshold
      const numV1 = typeof v1 === 'number' ? v1 : parseNumeric(v1);
      const numV2 = typeof v2 === 'number' ? v2 : parseNumeric(v2);

      let severity = 'low';
      if (numV1 != null && numV2 != null) {
        const diff = Math.abs(numV1 - numV2);
        const threshold = CONFLICT_THRESHOLDS[field];
        if (threshold != null) {
          severity = diff > threshold ? 'high' : diff > 0 ? 'medium' : 'low';
        } else {
          // Default: any numeric difference > 5% is medium, > 15% is high
          const avg = (Math.abs(numV1) + Math.abs(numV2)) / 2;
          if (avg > 0) {
            const pctDiff = diff / avg;
            severity = pctDiff > 0.15 ? 'high' : pctDiff > 0.05 ? 'medium' : 'low';
          }
        }
        // Identical numeric values — no conflict
        if (numV1 === numV2) continue;
      } else {
        // String comparison — any mismatch on critical fields is at least medium
        const criticalFields = new Set([
          'address', 'sale_price', 'year_built', 'gross_living_area',
          'condition', 'quality',
        ]);
        severity = criticalFields.has(field) ? 'medium' : 'low';
      }

      if (String(v1).toLowerCase() === String(v2).toLowerCase()) continue;

      conflicts.push({
        field,
        value1: v1,
        value2: v2,
        source1: entry1.source || 'source1',
        source2: entry2.source || 'source2',
        severity,
      });
    }

    // Sort: high severity first
    const severityOrder = { high: 0, medium: 1, low: 2 };
    conflicts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

    return conflicts;
  }

  /**
   * Generates preliminary adjustment suggestions based on paired comparison.
   * @param {object} subjectADM - Subject property ADM data
   * @param {object} compADM - Comparable property ADM data
   * @returns {object} Adjustments keyed by field name with amounts (positive = comp inferior)
   */
  suggestAdjustments(subjectADM, compADM) {
    const adjustments = {};
    const subVal = (field) => this._extractValue(subjectADM, field);
    const compVal = (field) => this._extractValue(compADM, field);

    // GLA adjustment: (subject - comp) * rate
    const subGLA = subVal('gross_living_area');
    const compGLA = compVal('gross_living_area');
    if (subGLA != null && compGLA != null) {
      const diff = subGLA - compGLA;
      if (diff !== 0) {
        adjustments.gross_living_area = {
          amount: diff * ADJUSTMENT_RATES.gla_per_sqft,
          subjectValue: subGLA,
          compValue: compGLA,
          difference: diff,
          rate: ADJUSTMENT_RATES.gla_per_sqft,
          unit: '$/sqft',
        };
      }
    }

    // Site area adjustment
    const subSite = subVal('site_area');
    const compSite = compVal('site_area');
    if (subSite != null && compSite != null) {
      const diff = subSite - compSite;
      if (Math.abs(diff) > 500) { // Only adjust if > 500 sf difference
        adjustments.site_area = {
          amount: Math.round(diff * ADJUSTMENT_RATES.site_per_sqft),
          subjectValue: subSite,
          compValue: compSite,
          difference: diff,
          rate: ADJUSTMENT_RATES.site_per_sqft,
          unit: '$/sqft',
        };
      }
    }

    // Age adjustment based on year_built
    const subYear = subVal('year_built');
    const compYear = compVal('year_built');
    if (subYear != null && compYear != null) {
      const diff = compYear - subYear; // Newer comp = negative adjustment (comp superior)
      if (diff !== 0) {
        adjustments.age = {
          amount: diff * ADJUSTMENT_RATES.age_per_year * -1,
          subjectValue: subYear,
          compValue: compYear,
          difference: diff,
          rate: ADJUSTMENT_RATES.age_per_year,
          unit: '$/year',
        };
      }
    }

    // Bedroom adjustment
    const subBeds = subVal('bedrooms');
    const compBeds = compVal('bedrooms');
    if (subBeds != null && compBeds != null) {
      const diff = subBeds - compBeds;
      if (diff !== 0) {
        adjustments.bedrooms = {
          amount: diff * ADJUSTMENT_RATES.bedroom_each,
          subjectValue: subBeds,
          compValue: compBeds,
          difference: diff,
          rate: ADJUSTMENT_RATES.bedroom_each,
          unit: '$/bedroom',
        };
      }
    }

    // Full bathroom adjustment
    const subBathF = subVal('bathrooms_full');
    const compBathF = compVal('bathrooms_full');
    if (subBathF != null && compBathF != null) {
      const diff = subBathF - compBathF;
      if (diff !== 0) {
        adjustments.bathrooms_full = {
          amount: diff * ADJUSTMENT_RATES.bathroom_full_each,
          subjectValue: subBathF,
          compValue: compBathF,
          difference: diff,
          rate: ADJUSTMENT_RATES.bathroom_full_each,
          unit: '$/bath',
        };
      }
    }

    // Half bathroom adjustment
    const subBathH = subVal('bathrooms_half');
    const compBathH = compVal('bathrooms_half');
    if (subBathH != null && compBathH != null) {
      const diff = subBathH - compBathH;
      if (diff !== 0) {
        adjustments.bathrooms_half = {
          amount: diff * ADJUSTMENT_RATES.bathroom_half_each,
          subjectValue: subBathH,
          compValue: compBathH,
          difference: diff,
          rate: ADJUSTMENT_RATES.bathroom_half_each,
          unit: '$/half-bath',
        };
      }
    }

    // Basement area adjustment
    const subBsmt = subVal('basement_area');
    const compBsmt = compVal('basement_area');
    if (subBsmt != null && compBsmt != null) {
      const diff = subBsmt - compBsmt;
      if (diff !== 0) {
        adjustments.basement_area = {
          amount: diff * ADJUSTMENT_RATES.basement_per_sqft,
          subjectValue: subBsmt,
          compValue: compBsmt,
          difference: diff,
          rate: ADJUSTMENT_RATES.basement_per_sqft,
          unit: '$/sqft',
        };
      }
    }

    // Basement finished area adjustment
    const subBsmtFin = subVal('basement_finished');
    const compBsmtFin = compVal('basement_finished');
    if (subBsmtFin != null && compBsmtFin != null) {
      const diff = subBsmtFin - compBsmtFin;
      if (diff !== 0) {
        adjustments.basement_finished = {
          amount: diff * ADJUSTMENT_RATES.basement_finished_per_sqft,
          subjectValue: subBsmtFin,
          compValue: compBsmtFin,
          difference: diff,
          rate: ADJUSTMENT_RATES.basement_finished_per_sqft,
          unit: '$/sqft',
        };
      }
    }

    // Garage adjustment
    const subGarage = subVal('garage_count');
    const compGarage = compVal('garage_count');
    if (subGarage != null && compGarage != null) {
      const diff = subGarage - compGarage;
      if (diff !== 0) {
        adjustments.garage = {
          amount: diff * ADJUSTMENT_RATES.garage_per_space,
          subjectValue: subGarage,
          compValue: compGarage,
          difference: diff,
          rate: ADJUSTMENT_RATES.garage_per_space,
          unit: '$/space',
        };
      }
    }

    // Fireplace adjustment
    const subFP = subVal('fireplaces');
    const compFP = compVal('fireplaces');
    if (subFP != null && compFP != null) {
      const diff = subFP - compFP;
      if (diff !== 0) {
        adjustments.fireplaces = {
          amount: diff * ADJUSTMENT_RATES.fireplace_each,
          subjectValue: subFP,
          compValue: compFP,
          difference: diff,
          rate: ADJUSTMENT_RATES.fireplace_each,
          unit: '$/fireplace',
        };
      }
    }

    // Pool adjustment (binary)
    const subPool = this._booleanize(subVal('pool'));
    const compPool = this._booleanize(compVal('pool'));
    if (subPool !== null && compPool !== null && subPool !== compPool) {
      adjustments.pool = {
        amount: subPool ? ADJUSTMENT_RATES.pool_lump : -ADJUSTMENT_RATES.pool_lump,
        subjectValue: subPool,
        compValue: compPool,
        difference: subPool ? 1 : -1,
        rate: ADJUSTMENT_RATES.pool_lump,
        unit: 'lump sum',
      };
    }

    // Condition adjustment (UAD rating step)
    const subCond = this._uadRatingNumber('condition', subVal('condition'));
    const compCond = this._uadRatingNumber('condition', compVal('condition'));
    if (subCond != null && compCond != null) {
      const diff = compCond - subCond; // Higher rating number = worse condition
      if (diff !== 0) {
        adjustments.condition = {
          amount: diff * ADJUSTMENT_RATES.condition_per_rating,
          subjectValue: subVal('condition'),
          compValue: compVal('condition'),
          difference: diff,
          rate: ADJUSTMENT_RATES.condition_per_rating,
          unit: '$/rating step',
        };
      }
    }

    // Quality adjustment (UAD rating step)
    const subQual = this._uadRatingNumber('quality', subVal('quality'));
    const compQual = this._uadRatingNumber('quality', compVal('quality'));
    if (subQual != null && compQual != null) {
      const diff = compQual - subQual; // Higher rating number = worse quality
      if (diff !== 0) {
        adjustments.quality = {
          amount: diff * ADJUSTMENT_RATES.quality_per_rating,
          subjectValue: subVal('quality'),
          compValue: compVal('quality'),
          difference: diff,
          rate: ADJUSTMENT_RATES.quality_per_rating,
          unit: '$/rating step',
        };
      }
    }

    return adjustments;
  }

  /**
   * Formats values to UAD conventions.
   * @param {string} field - Field name
   * @param {*} value - Raw value
   * @returns {string} UAD-formatted value
   */
  formatUAD(field, value) {
    if (value == null || value === '') return '';

    const s = String(value).trim();

    switch (field) {
      case 'condition': {
        const key = s.toLowerCase();
        return UAD_CONDITION[key] || UAD_CONDITION[s] || s.toUpperCase();
      }

      case 'quality': {
        const key = s.toLowerCase();
        return UAD_QUALITY[key] || UAD_QUALITY[s] || s.toUpperCase();
      }

      case 'view': {
        // Handle multi-value views: "Residential;Neutral" → "Res;N"
        const parts = s.split(/[;,/]+/).map(p => p.trim().toLowerCase());
        const uadParts = parts.map(p => UAD_VIEW[p] || titleCase(p));
        return uadParts.join(';');
      }

      case 'location': {
        const key = s.toLowerCase();
        return UAD_LOCATION[key] || s.substring(0, 1).toUpperCase();
      }

      case 'gross_living_area':
      case 'gla': {
        const num = parseNumeric(s);
        return num != null ? String(Math.round(num)) : s;
      }

      case 'days_on_market':
      case 'dom': {
        const num = parseNumeric(s);
        return num != null ? String(Math.round(num)) : s;
      }

      case 'sale_price': {
        const num = parseNumeric(s);
        return num != null ? `$${num.toLocaleString('en-US')}` : s;
      }

      case 'site_area': {
        // UAD: if < 1 acre equivalent, show in sqft; otherwise show acres
        const sqft = parseArea(s);
        if (sqft == null) return s;
        if (sqft >= 43560) {
          return `${sqftToAcres(sqft)} ac`;
        }
        return `${Math.round(sqft)} sf`;
      }

      case 'sale_date': {
        // UAD format: mm/yy for comp grid
        const d = parseDate(s);
        if (!d) return s;
        const [y, m] = d.split('-');
        return `${m}/${y.slice(2)}`;
      }

      case 'basement': {
        // e.g., "1,200sf;600fin"
        return s;
      }

      default:
        return s;
    }
  }

  /**
   * Takes ADM-mapped data and produces a facts object matching the case facts structure.
   * Compatible with PUT /api/cases/:caseId/facts.
   * @param {object} admData - Mapped ADM data
   * @param {string} formType - '1004', 'commercial', etc.
   * @returns {object} Facts object
   */
  toFactsFormat(admData, formType) {
    if (!admData || typeof admData !== 'object') return {};

    const val = (field) => admData[field]?.value ?? admData[field] ?? null;
    const src = (field) => admData[field]?.source ?? '';

    const makeFact = (v, source) => ({
      value: v,
      confidence: v != null ? 'medium' : 'low',
      source: source || '',
    });

    if (formType === 'commercial') {
      return this._toCommercialFacts(admData, val, src, makeFact);
    }

    // Default: residential (1004, 1025, 1073, 1004c)
    return {
      subject: {
        address:   makeFact(val('address'), src('address')),
        city:      makeFact(val('city'), src('city')),
        county:    makeFact(val('county'), src('county')),
        state:     makeFact(val('state'), src('state')),
        parcelId:  makeFact(val('parcel_id'), src('parcel_id')),
        gla:       makeFact(val('gross_living_area'), src('gross_living_area')),
        beds:      makeFact(val('bedrooms'), src('bedrooms')),
        baths:     makeFact(val('bathrooms_full'), src('bathrooms_full')),
        yearBuilt: makeFact(val('year_built'), src('year_built')),
        siteSize:  makeFact(val('site_area'), src('site_area')),
        zoning:    makeFact(val('zoning'), src('zoning')),
        basement:  makeFact(val('basement') || val('basement_area'), src('basement') || src('basement_area')),
        garage:    makeFact(val('garage'), src('garage')),
        condition: makeFact(this.formatUAD('condition', val('condition')), src('condition')),
        quality:   makeFact(this.formatUAD('quality', val('quality')), src('quality')),
        style:     makeFact(val('design_style'), src('design_style')),
      },
      contract: {
        contractPrice:    makeFact(val('sale_price'), src('sale_price')),
        contractDate:     makeFact(val('contract_date') || val('sale_date'), src('contract_date') || src('sale_date')),
        closingDate:      makeFact(val('closing_date'), src('closing_date')),
        sellerConcessions: makeFact(val('concessions'), src('concessions')),
        financing:        makeFact(val('financing_type'), src('financing_type')),
        daysOnMarket:     makeFact(val('days_on_market'), src('days_on_market')),
        offeringHistory:  makeFact(val('offering_history'), src('offering_history')),
      },
      market: {
        trend:           makeFact(val('market_trend'), src('market_trend')),
        trendStat:       makeFact(val('market_trend_stat'), src('market_trend_stat')),
        trendStatSource: makeFact(val('market_trend_source'), src('market_trend_source')),
        typicalDOM:      makeFact(val('typical_dom'), src('typical_dom')),
        exposureTime:    makeFact(val('exposure_time'), src('exposure_time')),
        priceRange:      makeFact(val('price_range'), src('price_range')),
      },
      neighborhood: {
        boundaries:  makeFact(val('neighborhood_boundaries'), src('neighborhood_boundaries')),
        description: makeFact(val('neighborhood_description'), src('neighborhood_description')),
        landUse:     makeFact(val('land_use'), src('land_use')),
        builtUp:     makeFact(val('built_up'), src('built_up')),
      },
      assignment: {
        intendedUse:               makeFact(val('intended_use'), src('intended_use')),
        intendedUser:              makeFact(val('intended_user'), src('intended_user')),
        effectiveDate:             makeFact(val('effective_date'), src('effective_date')),
        extraordinaryAssumptions:  makeFact(val('extraordinary_assumptions'), src('extraordinary_assumptions')),
        hypotheticalConditions:    makeFact(val('hypothetical_conditions'), src('hypothetical_conditions')),
      },
    };
  }

  // -----------------------------------------------------------------------
  // PRIVATE HELPERS
  // -----------------------------------------------------------------------

  /**
   * Converts a raw value to the appropriate type for an ADM field.
   * @private
   */
  _convertValue(admField, rawValue) {
    if (rawValue == null || rawValue === '') return null;

    if (INTEGER_FIELDS.has(admField)) {
      const parsed = admField === 'site_area' || admField === 'gross_living_area' || admField === 'gross_building_area'
        ? parseArea(rawValue)
        : parseNumeric(rawValue);
      return parsed != null ? Math.round(parsed) : null;
    }

    if (CURRENCY_FIELDS.has(admField)) {
      return parseNumeric(rawValue);
    }

    if (RATE_FIELDS.has(admField)) {
      const num = parseNumeric(rawValue);
      // If value looks like a percentage > 1 (e.g., "5.5" meaning 5.5%), keep as-is
      return num;
    }

    if (DATE_FIELDS.has(admField)) {
      return parseDate(rawValue);
    }

    if (admField === 'site_area_acres') {
      return parseNumeric(rawValue);
    }

    // Default: trim string
    return typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  }

  /**
   * Extracts the plain value from an ADM entry (handles both {value} objects and plain values).
   * @private
   */
  _extractValue(admData, field) {
    if (!admData) return null;
    const entry = admData[field];
    if (entry == null) return null;
    if (typeof entry === 'object' && 'value' in entry) return entry.value;
    return entry;
  }

  /**
   * Extracts the UAD rating number (1-6) from a condition or quality value.
   * @private
   */
  _uadRatingNumber(type, value) {
    if (value == null) return null;
    const formatted = this.formatUAD(type, value);
    const match = formatted.match(/[CQ](\d)/);
    return match ? Number(match[1]) : null;
  }

  /**
   * Converts a value to boolean (for pool, etc.).
   * @private
   */
  _booleanize(val) {
    if (val == null) return null;
    if (typeof val === 'boolean') return val;
    const s = String(val).toLowerCase().trim();
    if (['yes', 'true', '1', 'y'].includes(s)) return true;
    if (['no', 'false', '0', 'n', 'none'].includes(s)) return false;
    return null;
  }

  /**
   * Calculates total room count (bedrooms + bathrooms + kitchen + living).
   * @private
   */
  _totalRoomCount(beds, bathsFull, bathsHalf) {
    const b = parseNumeric(beds) || 0;
    const bf = parseNumeric(bathsFull) || 0;
    const bh = parseNumeric(bathsHalf) || 0;
    // Convention: total rooms = beds + baths + 2 (kitchen + living room)
    return b + bf + bh + 2;
  }

  /**
   * Formats bathroom count for comp grid (e.g., "2.1" for 2 full, 1 half).
   * @private
   */
  _formatBathCount(full, half) {
    const f = parseNumeric(full) || 0;
    const h = parseNumeric(half) || 0;
    if (f === 0 && h === 0) return null;
    return h > 0 ? `${f}.${h}` : String(f);
  }

  /**
   * Formats basement description for comp grid (e.g., "1,200sf;600fin").
   * @private
   */
  _formatBasement(totalSf, finishedSf) {
    const total = parseNumeric(totalSf);
    const finished = parseNumeric(finishedSf);
    if (total == null && finished == null) return null;
    const parts = [];
    if (total != null) parts.push(`${total.toLocaleString('en-US')}sf`);
    if (finished != null) parts.push(`${finished.toLocaleString('en-US')}fin`);
    return parts.join(';') || null;
  }

  /**
   * Sums all adjustment amounts (net).
   * @private
   */
  _sumAdjustments(adjustments) {
    if (!adjustments) return 0;
    return Object.values(adjustments).reduce((sum, adj) => sum + (adj.amount || 0), 0);
  }

  /**
   * Sums absolute values of all adjustments (gross).
   * @private
   */
  _sumAbsAdjustments(adjustments) {
    if (!adjustments) return 0;
    return Object.values(adjustments).reduce((sum, adj) => sum + Math.abs(adj.amount || 0), 0);
  }

  /**
   * Produces commercial facts format from ADM data.
   * @private
   */
  _toCommercialFacts(admData, val, src, makeFact) {
    return {
      subject: {
        address:                makeFact(val('address'), src('address')),
        city:                   makeFact(val('city'), src('city')),
        county:                 makeFact(val('county'), src('county')),
        state:                  makeFact(val('state'), src('state')),
        legalDescription:       makeFact(val('legal_description'), src('legal_description')),
        zoning:                 makeFact(val('zoning'), src('zoning')),
        siteSize:               makeFact(val('site_area'), src('site_area')),
        utilities:              makeFact(val('utilities'), src('utilities')),
        accessExposure:         makeFact(val('access_exposure'), src('access_exposure')),
        highestBestUseVacant:   makeFact(val('highest_best_use_vacant'), src('highest_best_use_vacant')),
        highestBestUseImproved: makeFact(val('highest_best_use_improved'), src('highest_best_use_improved')),
      },
      improvements: {
        propertyType:      makeFact(val('property_type'), src('property_type')),
        buildingClass:     makeFact(val('building_class'), src('building_class')),
        constructionType:  makeFact(val('construction_type'), src('construction_type')),
        grossBuildingArea: makeFact(val('gross_building_area'), src('gross_building_area')),
        yearBuilt:         makeFact(val('year_built'), src('year_built')),
        condition:         makeFact(val('condition'), src('condition')),
        effectiveAge:      makeFact(val('effective_age'), src('effective_age')),
      },
      income: {
        pgi:                    makeFact(val('potential_gross_income'), src('potential_gross_income')),
        vacancyCollectionLoss:  makeFact(val('vacancy_rate'), src('vacancy_rate')),
        egi:                    makeFact(val('effective_gross_income'), src('effective_gross_income')),
        operatingExpenses:      makeFact(val('operating_expenses'), src('operating_expenses')),
        noi:                    makeFact(val('net_operating_income'), src('net_operating_income')),
        capRate:                makeFact(val('capitalization_rate'), src('capitalization_rate')),
        valueIndication:        makeFact(val('value_indication'), src('value_indication')),
      },
      market: {
        submarket:     makeFact(val('submarket'), src('submarket')),
        vacancyTrend:  makeFact(val('vacancy_trend'), src('vacancy_trend')),
        rentTrend:     makeFact(val('rent_trend'), src('rent_trend')),
        capRateTrend:  makeFact(val('cap_rate_trend'), src('cap_rate_trend')),
        demandSupply:  makeFact(val('demand_supply'), src('demand_supply')),
      },
      assignment: {
        intendedUse:               makeFact(val('intended_use'), src('intended_use')),
        intendedUser:              makeFact(val('intended_user'), src('intended_user')),
        effectiveDate:             makeFact(val('effective_date'), src('effective_date')),
        extraordinaryAssumptions:  makeFact(val('extraordinary_assumptions'), src('extraordinary_assumptions')),
        hypotheticalConditions:    makeFact(val('hypothetical_conditions'), src('hypothetical_conditions')),
        scopeOfWork:               makeFact(val('scope_of_work'), src('scope_of_work')),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// MODULE EXPORTS (convenience re-exports for direct use)
// ---------------------------------------------------------------------------

export { FIELD_ALIASES, UAD_CONDITION, UAD_QUALITY, UAD_VIEW, UAD_LOCATION };
export { ADJUSTMENT_RATES, CONFLICT_THRESHOLDS };
export { acresToSqft, sqftToAcres, parseNumeric, parseArea, parseDate };
