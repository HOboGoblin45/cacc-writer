/**
 * server/config/uad36FormConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete UAD 3.6 / Redesigned URAR Form Definition
 *
 * The Redesigned URAR (UAD 3.6) goes mandatory November 2, 2026. It replaces
 * the legacy 1004, 1025, and 1073 forms with a single universal form.
 *
 * Key UAD 3.6 additions vs UAD 2.6:
 *   - Energy/green features section (mandatory)
 *   - ADU (Accessory Dwelling Unit) section
 *   - Expanded scope of work requirements
 *   - Separate extraordinary assumptions / hypothetical conditions sections
 *   - Expanded condition & quality rating definitions
 *   - Disaster mitigation / resilience section
 *
 * References:
 *   - Fannie Mae UAD 3.6 Specification (2024 draft)
 *   - MISMO Residential Reference Model 3.6
 */

// ── Complete UAD 3.6 Section Definitions ─────────────────────────────────────
//
// type values:
//   'data'         — structured data fields only, no narrative
//   'narrative'    — AI-generated free-text commentary
//   'data_narrative' — hybrid: structured data + narrative commentary
//   'grid'         — sales comparison adjustment grid
//   'photos'       — photo display section

export const UAD36_SECTIONS = [
  // ── Subject Property ──────────────────────────────────────────────────────
  {
    id: 'subject_property_info',
    title: 'Subject Property Information',
    type: 'data',
    required: true,
    fields: [
      'address', 'unit', 'city', 'state', 'zip', 'county',
      'censusTract', 'mapReference', 'legalDescription', 'taxParcelId',
      'neighborhoodName', 'occupancy', 'propertyRights',
      'assignmentType', 'intendedUse', 'intendedUser',
    ],
  },

  // ── Contract ──────────────────────────────────────────────────────────────
  {
    id: 'contract_info',
    title: 'Contract Information',
    type: 'data',
    required: false, // only when subject is listed/under contract
    fields: [
      'salePrice', 'saleDate', 'contractType', 'sellerConcessions',
      'financingType', 'personalProperty', 'listingPrice', 'daysOnMarket',
    ],
  },
  {
    id: 'contract_analysis',
    title: 'Contract Analysis',
    type: 'narrative',
    required: false,
    legacyId: 'contract_analysis',
    prompt: 'Analyze the contract terms, concessions, and whether the sale price reflects market value.',
  },

  // ── Neighborhood ──────────────────────────────────────────────────────────
  {
    id: 'neighborhood_characteristics',
    title: 'Neighborhood Characteristics',
    type: 'data',
    required: true,
    fields: [
      'builtUp', 'growth', 'propertyValues', 'demandSupply', 'marketingTime',
      'predominantOccupancy', 'landUse', 'oneUnitHousing', 'presentLandUseChange',
      'neighborhoodBoundaries',
    ],
  },
  {
    id: 'neighborhood_description',
    title: 'Neighborhood Description',
    type: 'narrative',
    required: true,
    legacyId: 'neighborhood_description',
    prompt: 'Describe the neighborhood including location, character, land uses, amenities, and any factors affecting value.',
  },
  {
    id: 'market_conditions',
    title: 'Market Conditions Analysis',
    type: 'narrative',
    required: true,
    legacyId: 'market_conditions',
    prompt: 'Analyze current market conditions including supply/demand, price trends, marketing times, and any relevant economic factors.',
  },

  // ── Site ──────────────────────────────────────────────────────────────────
  {
    id: 'site_characteristics',
    title: 'Site Characteristics',
    type: 'data',
    required: true,
    fields: [
      'lotSize', 'lotDimensions', 'shape', 'topography', 'drainage', 'view',
      'zoning', 'zoningCompliance', 'utilities', 'offSiteImprovements',
      'floodZone', 'floodMapNumber', 'femaDate',
    ],
  },
  {
    id: 'site_description',
    title: 'Site Description',
    type: 'narrative',
    required: true,
    legacyId: 'site_description',
    prompt: 'Describe the site including size, shape, topography, utilities, zoning, flood zone status, and any adverse conditions.',
  },

  // ── Improvements ─────────────────────────────────────────────────────────
  {
    id: 'improvement_characteristics',
    title: 'Improvement Characteristics',
    type: 'data',
    required: true,
    fields: [
      'yearBuilt', 'effectiveAge', 'gla', 'design', 'stories', 'condition',
      'quality', 'foundation', 'basement', 'basementFinished',
      'exteriorWalls', 'roofSurface', 'heating', 'cooling',
      'rooms', 'bedrooms', 'bathrooms', 'fireplace',
      'garage', 'garageType', 'garageCars',
      'pool', 'patio', 'fence', 'driveway',
      'functionalUtility', 'externalFactors',
    ],
  },
  {
    id: 'improvements_description',
    title: 'Description of Improvements',
    type: 'narrative',
    required: true,
    legacyId: 'improvements_description',
    prompt: 'Describe the improvements including construction quality, features, room count, finishes, and overall appeal.',
  },
  {
    id: 'condition_description',
    title: 'Condition of Improvements',
    type: 'narrative',
    required: true,
    legacyId: 'improvements_condition',
    prompt: 'Describe the physical condition of the improvements, noting deferred maintenance, updates, and effective age support.',
  },

  // ── Energy / Green Features (NEW in UAD 3.6) ─────────────────────────────
  {
    id: 'energy_features',
    title: 'Energy Efficient / Green Features',
    type: 'data_narrative',
    required: true, // UAD 3.6 requires disclosure even if none present
    legacyId: null,
    fields: [
      'energyRating', 'energyScore', 'solarPanels', 'solarOwnership',
      'greenCertification', 'certificationBody', 'certificationLevel',
      'insulationType', 'windowEfficiency', 'hvacEfficiency',
      'electricVehicleCharging', 'batteryStorage', 'rainwaterCollection',
    ],
    prompt: 'Describe any energy efficient or green features, certifications, ratings, and their impact on value if applicable.',
  },

  // ── ADU Section (NEW in UAD 3.6) ──────────────────────────────────────────
  {
    id: 'adu_description',
    title: 'Accessory Dwelling Unit (ADU)',
    type: 'data_narrative',
    required: true, // must disclose presence or absence
    legacyId: null,
    fields: [
      'hasADU', 'aduType', 'aduGla', 'aduYearBuilt',
      'aduBedrooms', 'aduBathrooms', 'aduKitchen',
      'aduSeparateEntrance', 'aduSeparateUtilities',
      'aduCondition', 'aduQuality',
      'aduRental', 'aduMonthlyRent',
    ],
    prompt: 'Describe the ADU if present, including type, size, condition, and any rental income. If no ADU, state "No ADU identified."',
  },

  // ── Highest & Best Use ────────────────────────────────────────────────────
  {
    id: 'highest_best_use',
    title: 'Highest & Best Use Analysis',
    type: 'narrative',
    required: true,
    legacyId: 'highest_best_use',
    prompt: 'Analyze highest and best use as vacant and as improved, addressing legal permissibility, physical possibility, financial feasibility, and maximum productivity.',
  },

  // ── Sales Comparison Approach (EXPANDED in UAD 3.6) ───────────────────────
  {
    id: 'sales_comparison_grid',
    title: 'Sales Comparison Grid',
    type: 'grid',
    required: true,
    fields: [
      'salePrice', 'saleDate', 'location', 'leasehold', 'siteArea',
      'view', 'design', 'quality', 'age', 'condition',
      'aboveGradeRooms', 'gla', 'basement', 'functional', 'heating',
      'energy', 'garage', 'porch', 'fireplace', 'other',
      'netAdjustment', 'adjustedSalePrice',
    ],
  },
  {
    id: 'sales_comparison_narrative',
    title: 'Sales Comparison Analysis',
    type: 'narrative',
    required: true,
    legacyId: 'sca_summary',
    prompt: 'Explain comp selection, adjustments methodology, and the reconciled value indication from the sales comparison approach.',
  },
  {
    id: 'comp_photo_page',
    title: 'Comparable Photos',
    type: 'photos',
    required: false,
  },

  // ── Cost Approach (optional) ──────────────────────────────────────────────
  {
    id: 'cost_approach',
    title: 'Cost Approach',
    type: 'data_narrative',
    required: false,
    legacyId: null,
    fields: [
      'siteValue', 'costNewStructure', 'physicalDepreciation',
      'functionalDepreciation', 'externalDepreciation',
      'totalDepreciation', 'depreciatedCost', 'asImprovedValue',
    ],
    prompt: 'Summarize the cost approach methodology, depreciation analysis, and indicated value.',
  },

  // ── Income Approach (optional) ────────────────────────────────────────────
  {
    id: 'income_approach',
    title: 'Income Approach',
    type: 'data_narrative',
    required: false,
    legacyId: null,
    fields: [
      'estimatedMonthlyMarketRent', 'grossRentMultiplier',
      'annualPotentialGrossIncome', 'vacancyCollectionLoss',
      'effectiveGrossIncome', 'totalOperatingExpenses',
      'netOperatingIncome', 'capitalizationRate', 'indicatedValue',
    ],
    prompt: 'Summarize the income approach methodology and indicated value if applicable.',
  },

  // ── Reconciliation ────────────────────────────────────────────────────────
  {
    id: 'reconciliation',
    title: 'Reconciliation & Final Value Opinion',
    type: 'narrative',
    required: true,
    legacyId: 'reconciliation',
    prompt: 'Reconcile the approaches to value, explain the weighting rationale, and state the final opinion of value with effective date.',
  },

  // ── Scope of Work (EXPANDED in UAD 3.6) ───────────────────────────────────
  {
    id: 'scope_of_work',
    title: 'Scope of Work',
    type: 'narrative',
    required: true,
    legacyId: 'scope_of_work',
    prompt: 'Define the scope of work including inspection type, research performed, data sources, and any scope limitations.',
  },

  // ── Prior Sales / Transfers ───────────────────────────────────────────────
  {
    id: 'prior_sales',
    title: 'Prior Sales / Transfers History',
    type: 'narrative',
    required: true,
    legacyId: 'prior_sales_subject',
    prompt: 'Report prior sales and transfers of the subject within the past 3 years and comparable sales within 12 months of sale date.',
  },

  // ── Certification & Conditions ────────────────────────────────────────────
  {
    id: 'certification',
    title: 'Appraiser Certification',
    type: 'data',
    required: true,
    fields: [
      'appraiserName', 'appraiserLicense', 'appraiserLicenseState',
      'appraiserLicenseExpiry', 'appraiserSignatureDate',
      'supervisoryAppraiserName', 'supervisoryLicense',
      'inspectionType', 'inspectionDate',
      'companyName', 'companyAddress',
    ],
  },
  {
    id: 'conditions_assumptions',
    title: 'General Assumptions & Limiting Conditions',
    type: 'narrative',
    required: true,
    legacyId: 'conditions_of_appraisal',
    prompt: 'List general assumptions and limiting conditions that apply to this appraisal.',
  },
  {
    id: 'extraordinary_assumptions',
    title: 'Extraordinary Assumptions',
    type: 'narrative',
    required: false, // required only if any extraordinary assumptions apply
    legacyId: null,
    prompt: 'State any extraordinary assumptions that, if found to be false, could alter the conclusions of this appraisal.',
  },
  {
    id: 'hypothetical_conditions',
    title: 'Hypothetical Conditions',
    type: 'narrative',
    required: false, // required only if any hypothetical conditions apply
    legacyId: null,
    prompt: 'State any hypothetical conditions upon which this appraisal is based.',
  },
];

// ── Narrative-only sections (for generation loops) ───────────────────────────
export const UAD36_NARRATIVE_SECTIONS = UAD36_SECTIONS.filter(
  s => s.type === 'narrative' || s.type === 'data_narrative',
);

// ── Sections with no legacy equivalent (net-new in UAD 3.6) ──────────────────
export const UAD36_NEW_SECTIONS = UAD36_SECTIONS.filter(s => s.legacyId === null);

// ── Section ID lookup ─────────────────────────────────────────────────────────
export function getUad36Section(id) {
  return UAD36_SECTIONS.find(s => s.id === id) || null;
}

// ── UAD 3.6 Condition Rating Definitions (C1–C6) ─────────────────────────────
// Full definitions as published in the UAD 3.6 specification.
export const UAD36_CONDITION_RATINGS = {
  C1: {
    label: 'New Construction',
    description:
      'The improvements were recently constructed and have not been previously occupied. ' +
      'There is no physical depreciation. All components and systems are new with no repairs needed.',
  },
  C2: {
    label: 'No Updates Needed',
    description:
      'The improvements feature no deferred maintenance, little or no physical depreciation, ' +
      'and require no repairs. Virtually all building components are new or have been recently ' +
      'repaired, refinished, or rehabilitated. All short-lived building components have been ' +
      'updated and/or replaced as needed.',
  },
  C3: {
    label: 'Well Maintained',
    description:
      'The improvements are well maintained and feature limited physical depreciation due to ' +
      'normal wear and tear. Some components, but not every major building component, may be ' +
      'updated or recently rehabilitated. The structure has been well maintained.',
  },
  C4: {
    label: 'Adequately Maintained',
    description:
      'The improvements feature some minor deferred maintenance and physical deterioration due ' +
      'to normal wear and tear. The dwelling has been adequately maintained and requires only ' +
      'minimal repairs to building components/mechanical systems and cosmetic repairs.',
  },
  C5: {
    label: 'Poorly Maintained',
    description:
      'The improvements feature obvious deferred maintenance and are in need of some significant ' +
      'repairs. Some building components need repairs, rehabilitation, or updating. The functional ' +
      'utility and overall livability is somewhat diminished due to condition, but the dwelling ' +
      'remains useable and functional.',
  },
  C6: {
    label: 'Substantial Damage / Not Habitable',
    description:
      'The improvements have substantial damage or deferred maintenance with deficiencies or ' +
      'defects that are severe enough to affect the safety, soundness, or structural integrity ' +
      'of the improvements. The improvements are in need of substantial repairs and rehabilitation, ' +
      'including many or most major components. This rating may also be used for properties ' +
      'not deemed safe, sound, or habitable.',
  },
};

// ── UAD 3.6 Quality Rating Definitions (Q1–Q6) ───────────────────────────────
export const UAD36_QUALITY_RATINGS = {
  Q1: {
    label: 'Unique / Exceptional',
    description:
      'Buildings with this quality rating are usually unique structures that are individually ' +
      'designed by an architect for a specified user. Such residences are typically constructed ' +
      'from detailed architectural plans and specifications and feature an exceptionally high ' +
      'level of workmanship and exceptionally high-grade materials throughout the interior and ' +
      'exterior of the structure.',
  },
  Q2: {
    label: 'Premium',
    description:
      'Buildings with this quality rating are often custom designed for construction on an ' +
      'individual property owner\'s site. However, dwellings in this quality grade are also ' +
      'found in high-quality tract developments featuring residences constructed from individual ' +
      'plans or from highly modified or upgraded plans. The design features exceptionally high ' +
      'quality exterior refinements and ornamentation, and exceptionally high-grade interior ' +
      'refinements.',
  },
  Q3: {
    label: 'Above Standard',
    description:
      'Residences at the lower end of this quality grade are often highly upgraded and well-finished ' +
      'tract homes. Residences at the higher end of this grade are often custom homes. Dwellings ' +
      'with this quality rating are differentiated by extras such as ornate entries, high ceilings, ' +
      'and elaborate trim work.',
  },
  Q4: {
    label: 'Standard',
    description:
      'Dwellings with this quality rating meet or exceed the requirements of applicable building ' +
      'codes. Standard or modified standard building plans are utilized and the workmanship is ' +
      'average. Upgrades to the typical level of interior finishes are at the discretion of the ' +
      'owner, builder, or buyer.',
  },
  Q5: {
    label: 'Below Standard',
    description:
      'Dwellings with this quality rating feature economy of construction and basic functionality ' +
      'as main considerations. Such dwellings feature a plain design using readily available or ' +
      'basic floor plans featuring minimal fenestration and basic finishes with minimal ' +
      'ornamentation. Construction costs are similar to the lower end of the local range.',
  },
  Q6: {
    label: 'Minimal',
    description:
      'Dwellings with this quality rating are of basic quality and lower cost; some may not be ' +
      'suitable for year-round occupancy. Such dwellings are often built with simple plans or ' +
      'without plans, often utilizing the lowest quality building materials. Such dwellings are ' +
      'often built or expanded by the occupants/owners and may or may not conform to local ' +
      'building codes.',
  },
};

// ── Legacy → UAD 3.6 Section ID Mapping ──────────────────────────────────────
// Maps legacy (UAD 2.6 / 1004) section IDs to UAD 3.6 section IDs.
// Used by the convert-to-uad36 endpoint to carry over existing narratives.
export const LEGACY_TO_UAD36_MAP = {
  // Direct carry-overs
  neighborhood_description:       'neighborhood_description',
  market_conditions:               'market_conditions',
  site_description:                'site_description',
  improvements_condition:          'condition_description',
  improvements_description:        'improvements_description',
  highest_best_use:                'highest_best_use',
  sca_summary:                     'sales_comparison_narrative',
  sales_comparison_commentary:     'sales_comparison_narrative',
  reconciliation:                  'reconciliation',
  scope_of_work:                   'scope_of_work',
  conditions_of_appraisal:         'conditions_assumptions',
  contract_analysis:               'contract_analysis',
  prior_sales_subject:             'prior_sales',

  // Merged into improvements_description in UAD 3.6
  functional_utility:              'improvements_description',
  functional_utility_conformity:   'improvements_description',

  // Merged into site_description in UAD 3.6
  adverse_conditions:              'site_description',

  // 1025 / 1073 equivalents
  market_area:                     'neighborhood_description',
  improvement_description:         'improvements_description',
  hbu_analysis:                    'highest_best_use',
};

// ── UAD 3.6 Compliance Requirements ──────────────────────────────────────────
// Sections that MUST have content for a compliant UAD 3.6 submission.
export const UAD36_REQUIRED_NARRATIVE_SECTIONS = UAD36_SECTIONS
  .filter(s => s.required && (s.type === 'narrative' || s.type === 'data_narrative'))
  .map(s => s.id);

export default {
  UAD36_SECTIONS,
  UAD36_NARRATIVE_SECTIONS,
  UAD36_NEW_SECTIONS,
  UAD36_CONDITION_RATINGS,
  UAD36_QUALITY_RATINGS,
  LEGACY_TO_UAD36_MAP,
  UAD36_REQUIRED_NARRATIVE_SECTIONS,
  getUad36Section,
};
