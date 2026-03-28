/**
 * forms/uad36_urar.js
 * ──────────────────────────────────────────────────────────────
 * UAD 3.6 Redesigned URAR — Dynamic Conditional Form Engine
 *
 * This is the Wave 1 centerpiece. The UAD 3.6 form replaces static 1004/1025/1073
 * with a single dynamic form where sections show/hide based on property type,
 * approach applicability, and assignment conditions.
 *
 * Key features:
 * - Dynamic conditional section registry with shouldShow(caseData) evaluators
 * - MISMO 3.6 field mapping (http://www.mismo.org/residential/2009/schemas/36)
 * - Support for property types: SFR, Condo, 2-4 Unit, Manufactured, Co-op
 * - Support for approaches: Sales Comparison (always), Cost Approach (conditional),
 *   Income Approach (conditional for investment properties)
 * - Section types: required, conditional, optional
 * - Extended factsSchema incorporating all UAD 3.6 data points
 */

// ─────────────────────────────────────────────────────────────────────────
// factsSchema — Extended data dictionary for UAD 3.6 URAR
// ─────────────────────────────────────────────────────────────────────────

const factsSchema = {
  // ── Subject Property ───────────────────────────────────────────────────
  subject: {
    address: { value: null, confidence: 'low', source: '' },
    city: { value: null, confidence: 'low', source: '' },
    county: { value: null, confidence: 'low', source: '' },
    state: { value: null, confidence: 'low', source: '' },
    parcelId: { value: null, confidence: 'low', source: '' },
    // Property type
    propertyType: { value: 'sfr', confidence: 'low', source: '' }, // 'sfr', 'condo', '2-4unit', 'manufactured', 'co-op'
    // UAD 3.6 ratings
    conditionRating: { value: null, confidence: 'low', source: '' },    // C1-C6
    qualityRating: { value: null, confidence: 'low', source: '' },      // Q1-Q6
    viewRating: { value: 'N', confidence: 'low', source: '' },          // N, B, A
    locationRating: { value: null, confidence: 'low', source: '' },     // Urban, Suburban, Rural
    designStyle: { value: null, confidence: 'low', source: '' },        // UAD code: DT, AT, SD, etc.
    constructionType: { value: null, confidence: 'low', source: '' },   // Wood, Masonry, Steel, etc.
    yearBuilt: { value: null, confidence: 'low', source: '' },
    effectiveAge: { value: null, confidence: 'low', source: '' },
    remainingEconomicLife: { value: null, confidence: 'low', source: '' },
    // Physical characteristics
    gla: { value: null, confidence: 'low', source: '' },
    beds: { value: null, confidence: 'low', source: '' },
    baths: { value: null, confidence: 'low', source: '' },
    siteSize: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    basement: { value: null, confidence: 'low', source: '' },
    garage: { value: null, confidence: 'low', source: '' },
    // Green / Energy Features (UAD 3.6 extensions)
    energyCertification: { value: null, confidence: 'low', source: '' }, // ENERGY STAR, etc.
    solarPanels: { value: false, confidence: 'low', source: '' },
    highEfficiencyHVAC: { value: false, confidence: 'low', source: '' },
    greenFeatures: { value: null, confidence: 'low', source: '' },      // Array or text description
    // Disaster Mitigation (UAD 3.6 extensions)
    disasterMitigation: { value: null, confidence: 'low', source: '' }, // Flood mitigation, wind resistance, etc.
    floodZone: { value: null, confidence: 'low', source: '' },          // FEMA SFHA, X, etc.
    // Condo-specific (for property type = 'condo')
    projectName: { value: null, confidence: 'low', source: '' },
    projectTotalUnits: { value: null, confidence: 'low', source: '' },
    condoFloor: { value: null, confidence: 'low', source: '' },
    hoaMonthlyFee: { value: null, confidence: 'low', source: '' },
    hoaFeeIncludes: { value: null, confidence: 'low', source: '' },
    hoaReserveAdequacy: { value: null, confidence: 'low', source: '' },
    // 2-4 Unit / Multi-family (for property type = '2-4unit')
    totalUnits: { value: null, confidence: 'low', source: '' },
    unitFloors: { value: null, confidence: 'low', source: '' },
    occupancyType: { value: null, confidence: 'low', source: '' },      // Owner-occupied, investor, mixed
  },

  // ── Contract / Financing ───────────────────────────────────────────────
  contract: {
    contractPrice: { value: null, confidence: 'low', source: '' },
    contractDate: { value: null, confidence: 'low', source: '' },
    closingDate: { value: null, confidence: 'low', source: '' },
    sellerConcessions: { value: null, confidence: 'low', source: '' },
    financing: { value: null, confidence: 'low', source: '' },          // 'conventional', 'fha', 'va', 'cash'
    daysOnMarket: { value: null, confidence: 'low', source: '' },
    offeringHistory: { value: null, confidence: 'low', source: '' },
    priorSalesHistory: { value: null, confidence: 'low', source: '' },  // Array of {date, price, days on market}
  },

  // ── Market Conditions (UAD 3.6 structured data) ────────────────────────
  market: {
    trend: { value: null, confidence: 'low', source: '' },              // 'stable', 'appreciating', 'depreciating'
    appreciationRate: { value: null, confidence: 'low', source: '' },   // % per year (UAD requirement)
    medianDOM: { value: null, confidence: 'low', source: '' },          // Median days on market (UAD)
    listToSaleRatio: { value: null, confidence: 'low', source: '' },    // Ratio (UAD)
    inventoryMonths: { value: null, confidence: 'low', source: '' },    // Months supply (UAD)
    absorptionRate: { value: null, confidence: 'low', source: '' },     // % per month (UAD)
    priceRange: { value: null, confidence: 'low', source: '' },
    exposureTime: { value: null, confidence: 'low', source: '' },
    trendStat: { value: null, confidence: 'low', source: '' },
    trendStatSource: { value: null, confidence: 'low', source: '' },
    extended_search: { value: false, confidence: 'high', source: '' },  // True if comps found outside neighborhood
  },

  // ── Neighborhood ───────────────────────────────────────────────────────
  neighborhood: {
    boundaries: { value: null, confidence: 'low', source: '' },         // N/S/E/W boundaries
    description: { value: null, confidence: 'low', source: '' },
    landUse: { value: null, confidence: 'low', source: '' },
    builtUp: { value: null, confidence: 'low', source: '' },            // % built-up (UAD)
    landUsePercentages: { value: null, confidence: 'low', source: '' }, // Structured percentages (UAD)
    locationClass: { value: null, confidence: 'low', source: '' },      // Urban, Suburban, Rural
  },

  // ── Site / Utilities ───────────────────────────────────────────────────
  site: {
    lotDimensions: { value: null, confidence: 'low', source: '' },
    topography: { value: null, confidence: 'low', source: '' },
    utilities: { value: null, confidence: 'low', source: '' },          // Object: {water, sewer, electric, gas}
    offSiteImprovements: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    flood: { value: null, confidence: 'low', source: '' },              // FEMA flood zone
    shape: { value: null, confidence: 'low', source: '' },
    drainage: { value: null, confidence: 'low', source: '' },
    easements: { value: null, confidence: 'low', source: '' },
    encroachments: { value: null, confidence: 'low', source: '' },
    adverseConditions: { value: null, confidence: 'low', source: '' },
  },

  // ── Sales Comparison Approach ──────────────────────────────────────────
  comps: [
    {
      number: 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      daysOnMarket: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      beds: { value: null, confidence: 'low', source: '' },
      baths: { value: null, confidence: 'low', source: '' },
      locationRating: { value: null, confidence: 'low', source: '' },
      conditionRating: { value: null, confidence: 'low', source: '' },
      qualityRating: { value: null, confidence: 'low', source: '' },
      adjustments: {
        propertyRightsConveyed: { value: null, confidence: 'low', source: '' },
        financingTerms: { value: null, confidence: 'low', source: '' },
        marketConditions: { value: null, confidence: 'low', source: '' },
        location: { value: null, confidence: 'low', source: '' },
        gla: { value: null, confidence: 'low', source: '' },
        condition: { value: null, confidence: 'low', source: '' },
        quality: { value: null, confidence: 'low', source: '' },
        view: { value: null, confidence: 'low', source: '' },
        designStyle: { value: null, confidence: 'low', source: '' },
        age: { value: null, confidence: 'low', source: '' },
        basement: { value: null, confidence: 'low', source: '' },
        garage: { value: null, confidence: 'low', source: '' },
        amenities: { value: null, confidence: 'low', source: '' },
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' },
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
      adjustedPrice: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 2,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      daysOnMarket: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      beds: { value: null, confidence: 'low', source: '' },
      baths: { value: null, confidence: 'low', source: '' },
      locationRating: { value: null, confidence: 'low', source: '' },
      conditionRating: { value: null, confidence: 'low', source: '' },
      qualityRating: { value: null, confidence: 'low', source: '' },
      adjustments: {
        propertyRightsConveyed: { value: null, confidence: 'low', source: '' },
        financingTerms: { value: null, confidence: 'low', source: '' },
        marketConditions: { value: null, confidence: 'low', source: '' },
        location: { value: null, confidence: 'low', source: '' },
        gla: { value: null, confidence: 'low', source: '' },
        condition: { value: null, confidence: 'low', source: '' },
        quality: { value: null, confidence: 'low', source: '' },
        view: { value: null, confidence: 'low', source: '' },
        designStyle: { value: null, confidence: 'low', source: '' },
        age: { value: null, confidence: 'low', source: '' },
        basement: { value: null, confidence: 'low', source: '' },
        garage: { value: null, confidence: 'low', source: '' },
        amenities: { value: null, confidence: 'low', source: '' },
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' },
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
      adjustedPrice: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 3,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      daysOnMarket: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      beds: { value: null, confidence: 'low', source: '' },
      baths: { value: null, confidence: 'low', source: '' },
      locationRating: { value: null, confidence: 'low', source: '' },
      conditionRating: { value: null, confidence: 'low', source: '' },
      qualityRating: { value: null, confidence: 'low', source: '' },
      adjustments: {
        propertyRightsConveyed: { value: null, confidence: 'low', source: '' },
        financingTerms: { value: null, confidence: 'low', source: '' },
        marketConditions: { value: null, confidence: 'low', source: '' },
        location: { value: null, confidence: 'low', source: '' },
        gla: { value: null, confidence: 'low', source: '' },
        condition: { value: null, confidence: 'low', source: '' },
        quality: { value: null, confidence: 'low', source: '' },
        view: { value: null, confidence: 'low', source: '' },
        designStyle: { value: null, confidence: 'low', source: '' },
        age: { value: null, confidence: 'low', source: '' },
        basement: { value: null, confidence: 'low', source: '' },
        garage: { value: null, confidence: 'low', source: '' },
        amenities: { value: null, confidence: 'low', source: '' },
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' },
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
      adjustedPrice: { value: null, confidence: 'low', source: '' },
    },
  ],

  // ── Cost Approach (conditional) ────────────────────────────────────────
  costApproach: {
    landValue: { value: null, confidence: 'low', source: '' },
    reproductionCost: { value: null, confidence: 'low', source: '' },   // Total reproduction cost new
    replacementCost: { value: null, confidence: 'low', source: '' },    // Replacement cost new
    physicalDepreciation: { value: null, confidence: 'low', source: '' },
    functionalObsolescence: { value: null, confidence: 'low', source: '' },
    externalObsolescence: { value: null, confidence: 'low', source: '' },
    totalDepreciation: { value: null, confidence: 'low', source: '' },
    depreciatedValue: { value: null, confidence: 'low', source: '' },
    entrepreneurialProfit: { value: null, confidence: 'low', source: '' },
    costApproachConclusion: { value: null, confidence: 'low', source: '' },
  },

  // ── Income Approach (conditional for investment properties) ────────────
  incomeApproach: {
    grossMonthlyRent: { value: null, confidence: 'low', source: '' },
    marketRent: { value: null, confidence: 'low', source: '' },
    vacancyRate: { value: null, confidence: 'low', source: '' },
    grossOperatingIncome: { value: null, confidence: 'low', source: '' },
    operatingExpenses: { value: null, confidence: 'low', source: '' },
    netOperatingIncome: { value: null, confidence: 'low', source: '' },
    capRate: { value: null, confidence: 'low', source: '' },
    grossRentMultiplier: { value: null, confidence: 'low', source: '' },
    incomeApproachConclusion: { value: null, confidence: 'low', source: '' },
  },

  // ── Assignment / Scope ─────────────────────────────────────────────────
  assignment: {
    intendedUse: { value: null, confidence: 'low', source: '' },
    intendedUser: { value: null, confidence: 'low', source: '' },
    effectiveDate: { value: null, confidence: 'low', source: '' },
    typeOfValue: { value: 'market', confidence: 'high', source: '' },    // 'market', 'assessed', 'appraised', etc.
    extraordinaryAssumptions: { value: null, confidence: 'low', source: '' },
    hypotheticalConditions: { value: null, confidence: 'low', source: '' },
    scopeOfWork: { value: null, confidence: 'low', source: '' },
  },

  // ── Reconciliation & Final Opinion ─────────────────────────────────────
  reconciliation: {
    saleComparisonIndication: { value: null, confidence: 'low', source: '' },
    saleComparisonWeight: { value: null, confidence: 'low', source: '' }, // % weight
    costApproachIndication: { value: null, confidence: 'low', source: '' },
    costApproachWeight: { value: null, confidence: 'low', source: '' },
    incomeApproachIndication: { value: null, confidence: 'low', source: '' },
    incomeApproachWeight: { value: null, confidence: 'low', source: '' },
    finalValueOpinion: { value: null, confidence: 'low', source: '' },
    confidenceLevel: { value: null, confidence: 'low', source: '' },
    assumptionsLimitations: { value: null, confidence: 'low', source: '' },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Section Registry — Dynamic conditional sections
// ─────────────────────────────────────────────────────────────────────────

const sections = [
  // ── REQUIRED SECTIONS ──────────────────────────────────────────────────
  {
    id: 'subject',
    title: 'Subject Property',
    type: 'required',
    shouldShow: () => true,
    description: 'Subject property identification and description',
  },
  {
    id: 'contract',
    title: 'Contract and Financing',
    type: 'required',
    shouldShow: () => true,
    description: 'Agreement of sale analysis and financing terms',
  },
  {
    id: 'neighborhood',
    title: 'Neighborhood Analysis',
    type: 'required',
    shouldShow: () => true,
    description: 'Location, boundaries, land use, and market characteristics',
  },
  {
    id: 'site',
    title: 'Site Description',
    type: 'required',
    shouldShow: () => true,
    description: 'Lot characteristics, utilities, topography, zoning',
  },
  {
    id: 'improvements',
    title: 'Description of Improvements',
    type: 'required',
    shouldShow: () => true,
    description: 'Building characteristics, condition, quality, design',
  },
  {
    id: 'market_conditions',
    title: 'Market Conditions',
    type: 'required',
    shouldShow: () => true,
    description: 'Market trend analysis with UAD metrics (DOM, appreciation rate, etc)',
  },
  {
    id: 'highest_best_use',
    title: 'Highest and Best Use',
    type: 'required',
    shouldShow: () => true,
    description: 'Four-test HBU analysis (legally permissible, physically possible, financially feasible, maximally productive)',
  },
  {
    id: 'sales_comparison',
    title: 'Sales Comparison Approach',
    type: 'required',
    shouldShow: () => true,
    description: 'Comparable analysis with quantified adjustments (67 pages of detail)',
  },

  // ── CONDITIONAL SECTIONS ───────────────────────────────────────────────
  {
    id: 'cost_approach',
    title: 'Cost Approach',
    type: 'conditional',
    shouldShow: (caseData) => {
      // Cost approach is developed for most property types, deferred only for very old properties
      // or if appraiser determines it's not applicable
      return true; // Default include; appraiser can mark as "not developed" in narrative
    },
    description: 'Land value, reproduction/replacement cost, depreciation',
    conditions: ['newer property', 'potential cost approach relevance'],
  },
  {
    id: 'income_approach',
    title: 'Income Approach',
    type: 'conditional',
    shouldShow: (caseData) => {
      // Income approach is developed only for investment/income-producing properties
      const propertyType = caseData?.subject?.propertyType?.value || 'sfr';
      const occupancy = caseData?.subject?.occupancyType?.value || 'owner-occupied';
      return (
        propertyType === '2-4unit' ||
        (propertyType === 'sfr' && occupancy === 'investor') ||
        occupancy === 'investor-occupied'
      );
    },
    description: 'Gross rent multiplier, market rent, cap rate analysis',
    conditions: ['investment property', 'income-producing property'],
  },
  {
    id: 'condo_analysis',
    title: 'Condominium Analysis',
    type: 'conditional',
    shouldShow: (caseData) => caseData?.subject?.propertyType?.value === 'condo',
    description: 'HOA analysis, project information, condo-specific considerations',
    conditions: ['property type = condo'],
  },
  {
    id: 'manufactured_analysis',
    title: 'Manufactured Home Analysis',
    type: 'conditional',
    shouldShow: (caseData) => caseData?.subject?.propertyType?.value === 'manufactured',
    description: 'Manufactured home specific factors, title status, park compliance',
    conditions: ['property type = manufactured'],
  },

  // ── OPTIONAL / APPRAISER DISCRETION ────────────────────────────────────
  {
    id: 'green_energy_features',
    title: 'Green and Energy Efficiency Features',
    type: 'optional',
    shouldShow: (caseData) => {
      // Show if property has any green features mentioned
      const greenFeatures = caseData?.subject?.greenFeatures?.value;
      const energyCert = caseData?.subject?.energyCertification?.value;
      const solar = caseData?.subject?.solarPanels?.value;
      const hvac = caseData?.subject?.highEfficiencyHVAC?.value;
      return Boolean(greenFeatures || energyCert || solar || hvac);
    },
    description: 'Energy certifications, solar panels, HVAC efficiency, green features',
    conditions: ['appraiser discretion', 'green features present'],
  },
  {
    id: 'disaster_mitigation',
    title: 'Disaster Mitigation Features',
    type: 'optional',
    shouldShow: (caseData) => {
      // Show if property is in flood zone or has mitigation features
      const disasterMitigation = caseData?.subject?.disasterMitigation?.value;
      const floodZone = caseData?.subject?.floodZone?.value;
      return Boolean(disasterMitigation || floodZone);
    },
    description: 'Flood mitigation, wind resistance, seismic bracing, elevation information',
    conditions: ['appraiser discretion', 'disaster risk present'],
  },
  {
    id: 'prior_sales',
    title: 'Prior Sales / Transfer History',
    type: 'optional',
    shouldShow: () => true, // Usually included for context
    description: 'Subject and comparable prior sales/transfers',
    conditions: ['appraiser discretion'],
  },

  // ── RECONCILIATION & CONCLUSIONS ───────────────────────────────────────
  {
    id: 'reconciliation',
    title: 'Reconciliation and Final Value Opinion',
    type: 'required',
    shouldShow: () => true,
    description: 'Synthesis of approaches, weighting, final value conclusion',
  },
  {
    id: 'scope_of_work',
    title: 'Scope of Work',
    type: 'required',
    shouldShow: () => true,
    description: 'Definition of appraisal engagement, extent of research, limitations',
  },
  {
    id: 'assumptions_limiting_conditions',
    title: 'General Assumptions and Limiting Conditions',
    type: 'required',
    shouldShow: () => true,
    description: 'Standard assumptions, conditions, extraordinary assumptions, hypothetical conditions',
  },
  {
    id: 'appraiser_certification',
    title: 'Appraiser Certification',
    type: 'required',
    shouldShow: () => true,
    description: 'Professional certification and signature',
  },

  // ── EXHIBITS ────────────────────────────────────────────────────────────
  {
    id: 'photos',
    title: 'Photo Addendum',
    type: 'optional',
    shouldShow: () => true,
    description: 'Subject and comparable property photographs',
  },
  {
    id: 'sketches',
    title: 'Sketches and Diagrams',
    type: 'optional',
    shouldShow: () => true,
    description: 'Floor plan sketches, utility diagram, site plan',
  },
  {
    id: 'exhibits',
    title: 'Additional Exhibits',
    type: 'optional',
    shouldShow: () => true,
    description: 'MLS sheets, public records, flood maps, market data',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Condition Evaluators
// ─────────────────────────────────────────────────────────────────────────

/**
 * shouldShow(sectionId, caseData) → boolean
 * Evaluates whether a section should be shown based on caseData
 */
function shouldShow(sectionId, caseData) {
  const section = sections.find(s => s.id === sectionId);
  if (!section) return false;
  if (section.type === 'required') return true;
  return section.shouldShow(caseData || {});
}

/**
 * evaluateConditions(caseData) → { sectionId: boolean }
 * Returns a map of all sections and their visibility
 */
function evaluateConditions(caseData) {
  const result = {};
  sections.forEach(s => {
    result[s.id] = shouldShow(s.id, caseData);
  });
  return result;
}

/**
 * getActiveSections(caseData) → section[]
 * Returns only sections that should be shown for this case
 */
function getActiveSections(caseData) {
  return sections.filter(s => shouldShow(s.id, caseData));
}

// ─────────────────────────────────────────────────────────────────────────
// MISMO 3.6 Field Mapping
// ─────────────────────────────────────────────────────────────────────────

const mismoFieldMap = {
  // Namespace: http://www.mismo.org/residential/2009/schemas/36
  namespace: 'http://www.mismo.org/residential/2009/schemas/36',

  // Subject property
  'subject.address': 'AppraisalPropertyAddress/StreetAddress',
  'subject.city': 'AppraisalPropertyAddress/City',
  'subject.county': 'AppraisalPropertyAddress/County',
  'subject.state': 'AppraisalPropertyAddress/State',
  'subject.parcelId': 'AppraisalPropertyAddress/AppraisalParcelIdentifier',
  'subject.propertyType': 'AppraisalPropertyDetail/PropertyType',
  'subject.gla': 'AppraisalPropertyDetail/LivingArea',
  'subject.beds': 'AppraisalPropertyDetail/BedroomCount',
  'subject.baths': 'AppraisalPropertyDetail/BathroomCount',
  'subject.yearBuilt': 'AppraisalPropertyDetail/YearBuilt',
  'subject.effectiveAge': 'AppraisalPropertyDetail/EffectiveAge',
  'subject.conditionRating': 'AppraisalPropertyDetail/Condition',     // C1-C6
  'subject.qualityRating': 'AppraisalPropertyDetail/Quality',         // Q1-Q6
  'subject.designStyle': 'AppraisalPropertyDetail/DesignStyle',       // UAD codes
  'subject.constructionType': 'AppraisalPropertyDetail/ConstructionType',
  'subject.viewRating': 'AppraisalPropertyDetail/View',               // N, B, A
  'subject.locationRating': 'AppraisalPropertyDetail/LocationRating', // Urban, Suburban, Rural

  // Site
  'site.lotDimensions': 'AppraisalSiteDetail/LotDimensions',
  'site.topography': 'AppraisalSiteDetail/Topography',
  'site.zoning': 'AppraisalSiteDetail/Zoning',
  'site.flood': 'AppraisalSiteDetail/FloodZone',

  // Contract
  'contract.contractPrice': 'AppraisalContractDetail/ContractPrice',
  'contract.contractDate': 'AppraisalContractDetail/ContractDate',
  'contract.financing': 'AppraisalContractDetail/FinancingType',

  // Market conditions
  'market.appreciationRate': 'AppraisalMarketData/AppreciationRate',
  'market.medianDOM': 'AppraisalMarketData/MedianDaysOnMarket',
  'market.listToSaleRatio': 'AppraisalMarketData/ListToSaleRatio',
  'market.inventoryMonths': 'AppraisalMarketData/InventoryMonths',

  // Comparables (per comp)
  'comps[n].address': 'ComparablePropertyDetail[n]/PropertyAddress',
  'comps[n].salePrice': 'ComparablePropertyDetail[n]/SalePrice',
  'comps[n].saleDate': 'ComparablePropertyDetail[n]/SaleDate',
  'comps[n].adjustments.location': 'ComparablePropertyDetail[n]/Adjustment[@type="Location"]',
  'comps[n].adjustments.gla': 'ComparablePropertyDetail[n]/Adjustment[@type="GrosLivingArea"]',
};

// ─────────────────────────────────────────────────────────────────────────
// Document Types
// ─────────────────────────────────────────────────────────────────────────

const documentTypes = [
  { id: 'purchase_contract', label: 'Purchase Contract' },
  { id: 'public_record', label: 'Public Record' },
  { id: 'appraisal_order', label: 'Appraisal Order' },
  { id: 'mls_sheet', label: 'MLS Sheet' },
  { id: 'plat_map', label: 'Plat Map' },
  { id: 'fema_flood', label: 'FEMA Flood Map' },
  { id: 'comp_1', label: 'Comparable 1' },
  { id: 'comp_2', label: 'Comparable 2' },
  { id: 'comp_3', label: 'Comparable 3' },
  { id: 'prior_appraisal', label: 'Prior Appraisal' },
  { id: 'tax_record', label: 'Tax Record' },
  { id: 'photos', label: 'Photo Addendum' },
  { id: 'energy_cert', label: 'Energy Certificate' },
  { id: 'hoa_docs', label: 'HOA Documents (Condo)' },
  { id: 'reserve_study', label: 'Reserve Study (Condo)' },
];

// ─────────────────────────────────────────────────────────────────────────
// Grading Rubric (QC scoring)
// ─────────────────────────────────────────────────────────────────────────

const gradingRubric = `
GRADING RUBRIC — UAD 3.6 URAR Quality Control

1. Subject & Contract Completeness (10 pts)
   - Subject property identification and key characteristics
   - Contract terms, financing, seller concessions
   - Accurate date of appraisal and contract date

2. Neighborhood & Market Analysis (15 pts)
   - Clear neighborhood boundaries (N/S/E/W)
   - Land use percentages and built-up percentage
   - UAD market metrics: appreciation rate %, median DOM, list-to-sale ratio
   - Market trend narrative with quantified support

3. Site & Improvements Description (12 pts)
   - Lot size, topography, utilities (water, sewer, electric, gas)
   - Zoning compliance and off-site improvements
   - Design style (UAD codes: DT, AT, SD, etc.)
   - GLA, room count, basement, garage

4. Condition & Quality Ratings (12 pts)
   - Condition rating (C1-C6) with UAD-compliant justification
   - Quality rating (Q1-Q6) with detailed explanation
   - View rating (N/B/A) and location rating (Urban/Suburban/Rural)
   - Effective age and remaining economic life statements

5. Sales Comparison Approach (25 pts)
   - Comparable selection methodology (location, design, age, condition)
   - Quantified adjustments in dollar amounts
   - Adjustment per SF rates clearly stated
   - Net vs. gross adjustment percentages
   - Bracketing verification (subject within comp range)
   - Reconciliation of comp indications
   - 67 pages of detailed per-comparable narratives

6. Highest & Best Use Analysis (8 pts)
   - Four-test framework: legally permissible, physically possible,
     financially feasible, maximally productive
   - Clear conclusions for "as vacant" and "as improved"

7. Cost Approach (8 pts)
   - Land value estimation
   - Reproduction/replacement cost
   - Physical, functional, external depreciation breakdown
   - Final conclusion (or clear statement of why not developed)

8. Income Approach (5 pts)
   - Market rent analysis
   - Vacancy rate, cap rate application
   - GRM calculation (if applicable)
   - Clear statement if property is non-income-producing

9. Reconciliation & Final Opinion (12 pts)
   - Summary of all approach indications
   - Weight given to each approach with rationale
   - Final value opinion with confidence statement
   - Effective date of appraisal clearly stated

10. Scope of Work & Assumptions (8 pts)
    - Intended use and user
    - Extraordinary assumptions (if any)
    - Hypothetical conditions (if any)
    - Limiting conditions and assumptions

11. Professional Presentation (10 pts)
    - Professional appraiser voice and tone
    - No unsupported statements or speculations
    - Internal consistency (no contradictions)
    - USPAP compliance

12. Conditional Sections (10 pts)
    - Condo analysis (if property is condo): HOA fee, reserves, litigation
    - Green/energy features (if present): certifications, solar, HVAC
    - Disaster mitigation (if in flood zone): elevation, mitigation measures
    - Prior sales history (if applicable): dates, prices, market context

TOTAL: 125 pts
`;

// ─────────────────────────────────────────────────────────────────────────
// Form Export
// ─────────────────────────────────────────────────────────────────────────

const formUad36Urar = {
  formId: 'uad36_urar',
  formLabel: 'UAD 3.6 Redesigned URAR — Dynamic Conditional Form',
  uspap: 'Uniform Appraisal Dataset 3.6 (UAD 3.6) Redesigned Uniform Residential Appraisal Report',
  description: 'Dynamic form engine supporting all residential property types (SFR, condo, 2-4 unit, manufactured, co-op) with conditional sections for approaches, property-specific analysis, and sustainability/disaster features.',

  // Section registry with conditional evaluation
  sections,
  factsSchema,

  // Condition evaluators
  shouldShow,
  evaluateConditions,
  getActiveSections,

  // MISMO 3.6 field mapping
  mismoFieldMap,

  // Document types
  documentTypes,

  // Quality control
  gradingRubric,

  // Form fields (for legacy compatibility with forms/1004.js pattern)
  fields: [
    {
      id: 'scope_of_work',
      title: 'Scope of Work',
      note: 'UAD 3.6: Defined scope of appraisal engagement',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'assignment.intendedUse'],
      tpl: 'Write the Scope of Work statement for UAD 3.6.',
    },
    {
      id: 'subject_property',
      title: 'Subject Property Description',
      note: 'UAD 3.6: Complete property identification and characteristics',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.gla', 'subject.conditionRating'],
      tpl: 'Write the Subject Property Description for UAD 3.6.',
    },
    {
      id: 'neighborhood',
      title: 'Neighborhood Analysis',
      note: 'UAD 3.6: Location, boundaries, and market characteristics',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city', 'neighborhood.boundaries'],
      tpl: 'Write the Neighborhood Analysis for UAD 3.6.',
    },
    {
      id: 'site',
      title: 'Site Description',
      note: 'UAD 3.6: Site characteristics, utilities, zoning',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.siteSize', 'subject.zoning'],
      tpl: 'Write the Site Description for UAD 3.6.',
    },
    {
      id: 'improvements',
      title: 'Description of Improvements',
      note: 'UAD 3.6: Building characteristics with UAD ratings',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.designStyle', 'subject.conditionRating'],
      tpl: 'Write the Description of Improvements for UAD 3.6.',
    },
    {
      id: 'market_conditions',
      title: 'Market Conditions Analysis',
      note: 'UAD 3.6: Market metrics and trend analysis',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.trend', 'market.appreciationRate'],
      tpl: 'Write the Market Conditions Analysis for UAD 3.6.',
    },
    {
      id: 'sales_comparison',
      title: 'Sales Comparison Approach',
      note: 'UAD 3.6: Comparable analysis with quantified adjustments (67 pages)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'comps[0].salePrice'],
      tpl: 'Write the Sales Comparison Analysis for UAD 3.6.',
    },
    {
      id: 'cost_approach',
      title: 'Cost Approach',
      note: 'UAD 3.6: Cost development (conditional)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.yearBuilt', 'subject.gla'],
      tpl: 'Write the Cost Approach narrative for UAD 3.6 (if applicable).',
    },
    {
      id: 'income_approach',
      title: 'Income Approach',
      note: 'UAD 3.6: Income analysis (conditional for investment properties)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.propertyType'],
      tpl: 'Write the Income Approach narrative for UAD 3.6 (if applicable).',
    },
    {
      id: 'reconciliation',
      title: 'Reconciliation and Final Value Opinion',
      note: 'UAD 3.6: Synthesis of approaches and final value',
      aiEligibility: 'manual_review',
      requiredFacts: ['subject.gla', 'subject.conditionRating'],
      tpl: 'Write the Reconciliation and Final Value Opinion for UAD 3.6.',
    },
    {
      id: 'assumptions_limiting_conditions',
      title: 'General Assumptions and Limiting Conditions',
      note: 'UAD 3.6: Standard assumptions and special conditions',
      aiEligibility: 'ai_draft',
      requiredFacts: ['assignment.intendedUse'],
      tpl: 'Write the General Assumptions and Limiting Conditions for UAD 3.6.',
    },
  ],

  // Voice fields for audio capture
  voiceFields: [
    { id: 'neighborhood', title: 'Neighborhood Analysis' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'improvements', title: 'Description of Improvements' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation', title: 'Reconciliation & Final Value Opinion' },
  ],

  // Questionnaire priorities for data extraction
  questionnairePriorities: [
    'Subject property type (SFR, condo, 2-4 unit, manufactured, co-op)',
    'Subject UAD condition rating (C1-C6) with justification',
    'Subject UAD quality rating (Q1-Q6) with justification',
    'Subject effective age vs. year built',
    'View rating (N/B/A) and location rating (Urban/Suburban/Rural)',
    'Market appreciation rate (% per year)',
    'Market median DOM and list-to-sale ratio',
    'Inventory months supply',
    'Comparable adjustments (quantified in dollars per SF)',
    'Design/style UAD abbreviation',
    'Neighborhood land use percentages and built-up percentage',
    'Highest & best use four-test analysis (as vacant and as improved)',
    'Cost approach applicability and depreciation components',
    'Income approach applicability (investment property?)',
    'Green/energy features (if any)',
    'Disaster mitigation features (if in flood zone)',
    'Prior sales history for subject (12 and 36 month)',
    'Extraordinary assumptions or hypothetical conditions',
  ],
};

export default formUad36Urar;
