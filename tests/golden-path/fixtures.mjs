/**
 * tests/golden-path/fixtures.mjs
 * --------------------------------
 * Phase 8 — Golden-Path Case Fixtures
 *
 * Realistic 1004 and Commercial case data for end-to-end validation.
 * Each fixture provides the minimal complete dataset needed to exercise
 * the full appraisal lifecycle: case → facts → generation → QC → insertion → archive.
 */

// ── 1004 URAR Fixture ──────────────────────────────────────────────────────

export const FIXTURE_1004 = {
  label: '1004 URAR — Single-Family Residential',
  formType: '1004',

  caseCreate: {
    property_address: '1234 Oak Lane',
    property_city: 'Normal',
    property_state: 'IL',
    property_zip: '61761',
    property_county: 'McLean',
    borrower_name: 'Jane Smith',
    lender_client: 'First National Bank',
    intended_use: 'Mortgage lending decision',
    intended_user: 'First National Bank and its assigns',
    form_type: '1004',
    assignment_type: 'Purchase',
    property_type: 'Single Family',
    status: 'active',
  },

  facts: [
    { field_name: 'property_address', value: '1234 Oak Lane, Normal, IL 61761', category: 'subject', source: 'engagement_letter', confidence: 1.0 },
    { field_name: 'legal_description', value: 'Lot 12, Block 3, Oak Park Subdivision', category: 'subject', source: 'assessor', confidence: 0.95 },
    { field_name: 'tax_year', value: '2025', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'tax_amount', value: '4250', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'assessor_parcel', value: '17-04-201-012', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'census_tract', value: '0003.02', category: 'subject', source: 'assessor', confidence: 0.9 },
    { field_name: 'map_reference', value: 'McLean Co. Plat Book 12, Page 45', category: 'subject', source: 'assessor', confidence: 0.9 },
    { field_name: 'sale_price', value: '285000', category: 'contract', source: 'purchase_contract', confidence: 1.0 },
    { field_name: 'contract_date', value: '2026-01-15', category: 'contract', source: 'purchase_contract', confidence: 1.0 },
    { field_name: 'concessions', value: 'Seller to pay $3,000 toward closing costs', category: 'contract', source: 'purchase_contract', confidence: 1.0 },
    { field_name: 'neighborhood_name', value: 'Oak Park', category: 'neighborhood', source: 'mls', confidence: 0.9 },
    { field_name: 'neighborhood_built_up', value: 'Over 75%', category: 'neighborhood', source: 'observation', confidence: 0.85 },
    { field_name: 'neighborhood_growth', value: 'Stable', category: 'neighborhood', source: 'market_data', confidence: 0.85 },
    { field_name: 'property_values', value: 'Stable', category: 'neighborhood', source: 'market_data', confidence: 0.85 },
    { field_name: 'demand_supply', value: 'In balance', category: 'neighborhood', source: 'market_data', confidence: 0.8 },
    { field_name: 'marketing_time', value: '3-6 months', category: 'neighborhood', source: 'market_data', confidence: 0.8 },
    { field_name: 'location', value: 'Suburban', category: 'neighborhood', source: 'observation', confidence: 0.9 },
    { field_name: 'zoning', value: 'R-1 Single Family Residential', category: 'site', source: 'assessor', confidence: 1.0 },
    { field_name: 'zoning_compliance', value: 'Legal conforming', category: 'site', source: 'assessor', confidence: 0.95 },
    { field_name: 'lot_size', value: '10,200 sf', category: 'site', source: 'assessor', confidence: 0.95 },
    { field_name: 'lot_shape', value: 'Rectangular', category: 'site', source: 'observation', confidence: 0.9 },
    { field_name: 'topography', value: 'Level', category: 'site', source: 'observation', confidence: 0.9 },
    { field_name: 'utilities', value: 'Public water, public sewer, electric, natural gas', category: 'site', source: 'assessor', confidence: 0.95 },
    { field_name: 'year_built', value: '2004', category: 'improvements', source: 'assessor', confidence: 1.0 },
    { field_name: 'gla', value: '1,850', category: 'improvements', source: 'measurement', confidence: 1.0 },
    { field_name: 'bedrooms', value: '4', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'bathrooms', value: '2.5', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'stories', value: '2', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'basement', value: 'Full, partially finished', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'basement_area', value: '925 sf', category: 'improvements', source: 'measurement', confidence: 0.95 },
    { field_name: 'basement_finished', value: '400 sf', category: 'improvements', source: 'measurement', confidence: 0.95 },
    { field_name: 'garage', value: 'Attached 2-car', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'heating', value: 'Forced air, natural gas', category: 'improvements', source: 'observation', confidence: 0.95 },
    { field_name: 'cooling', value: 'Central air conditioning', category: 'improvements', source: 'observation', confidence: 0.95 },
    { field_name: 'condition', value: 'C3 — Well maintained, minor deferred maintenance', category: 'improvements', source: 'observation', confidence: 0.9 },
    { field_name: 'quality', value: 'Q3 — Standard residential quality', category: 'improvements', source: 'observation', confidence: 0.9 },
    { field_name: 'exterior_material', value: 'Vinyl siding, brick wainscot', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'roof', value: 'Asphalt shingle, hip roof', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'comp1_address', value: '1456 Elm Street', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
    { field_name: 'comp1_sale_price', value: '278000', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp1_sale_date', value: '2025-11-20', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp1_gla', value: '1,780', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
    { field_name: 'comp2_address', value: '987 Maple Drive', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
    { field_name: 'comp2_sale_price', value: '292000', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp2_sale_date', value: '2025-12-05', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp2_gla', value: '1,920', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
    { field_name: 'comp3_address', value: '2210 Birch Court', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
    { field_name: 'comp3_sale_price', value: '275000', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp3_sale_date', value: '2025-10-30', category: 'sales_comparison', source: 'mls', confidence: 1.0 },
    { field_name: 'comp3_gla', value: '1,800', category: 'sales_comparison', source: 'mls', confidence: 0.95 },
  ],

  // Sections that must exist after generation (maps to generatorProfiles)
  expectedSections: [
    'neighborhood_description',
    'site_description',
    'improvements_description',
    'condition_description',
    'highest_best_use',
    'sales_comparison_summary',
    'cost_approach_summary',
    'reconciliation',
    'contract_analysis',
    'prior_sales',
  ],
};

// ── Commercial Fixture ──────────────────────────────────────────────────────

export const FIXTURE_COMMERCIAL = {
  label: 'Commercial — Office Building',
  formType: 'commercial',

  caseCreate: {
    property_address: '500 Commerce Drive',
    property_city: 'Bloomington',
    property_state: 'IL',
    property_zip: '61704',
    property_county: 'McLean',
    borrower_name: 'Commerce Holdings LLC',
    lender_client: 'Heartland Business Bank',
    intended_use: 'Commercial lending decision',
    intended_user: 'Heartland Business Bank',
    form_type: 'commercial',
    assignment_type: 'Refinance',
    property_type: 'Office',
    status: 'active',
  },

  facts: [
    { field_name: 'property_address', value: '500 Commerce Drive, Bloomington, IL 61704', category: 'subject', source: 'engagement_letter', confidence: 1.0 },
    { field_name: 'legal_description', value: 'Lot 1A, Commerce Park Business Center', category: 'subject', source: 'assessor', confidence: 0.95 },
    { field_name: 'tax_year', value: '2025', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'tax_amount', value: '42500', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'assessor_parcel', value: '17-22-400-001', category: 'subject', source: 'assessor', confidence: 1.0 },
    { field_name: 'zoning', value: 'B-2 General Business', category: 'site', source: 'assessor', confidence: 1.0 },
    { field_name: 'lot_size', value: '1.2 acres (52,272 sf)', category: 'site', source: 'assessor', confidence: 0.95 },
    { field_name: 'year_built', value: '2008', category: 'improvements', source: 'assessor', confidence: 1.0 },
    { field_name: 'gba', value: '15,000', category: 'improvements', source: 'measurement', confidence: 1.0 },
    { field_name: 'rentable_area', value: '13,500', category: 'improvements', source: 'lease_abstract', confidence: 0.95 },
    { field_name: 'stories', value: '2', category: 'improvements', source: 'observation', confidence: 1.0 },
    { field_name: 'parking_spaces', value: '60', category: 'improvements', source: 'observation', confidence: 0.95 },
    { field_name: 'condition', value: 'Good — well maintained, modern finishes', category: 'improvements', source: 'observation', confidence: 0.9 },
    { field_name: 'occupancy_rate', value: '92%', category: 'income', source: 'rent_roll', confidence: 0.95 },
    { field_name: 'gross_income', value: '270000', category: 'income', source: 'rent_roll', confidence: 0.95 },
    { field_name: 'vacancy_rate', value: '8%', category: 'income', source: 'rent_roll', confidence: 0.9 },
    { field_name: 'operating_expenses', value: '95000', category: 'income', source: 'financial_statements', confidence: 0.9 },
    { field_name: 'noi', value: '175000', category: 'income', source: 'calculated', confidence: 0.9 },
    { field_name: 'cap_rate_market', value: '7.5%', category: 'income', source: 'market_data', confidence: 0.8 },
    { field_name: 'neighborhood_name', value: 'Commerce Park', category: 'neighborhood', source: 'observation', confidence: 0.9 },
    { field_name: 'market_conditions', value: 'Stable with moderate demand for Class B office', category: 'neighborhood', source: 'market_data', confidence: 0.8 },
    { field_name: 'comp1_address', value: '720 Enterprise Blvd', category: 'sales_comparison', source: 'costar', confidence: 0.9 },
    { field_name: 'comp1_sale_price', value: '2150000', category: 'sales_comparison', source: 'costar', confidence: 0.95 },
    { field_name: 'comp1_gba', value: '14,200', category: 'sales_comparison', source: 'costar', confidence: 0.9 },
    { field_name: 'comp2_address', value: '310 Professional Way', category: 'sales_comparison', source: 'costar', confidence: 0.9 },
    { field_name: 'comp2_sale_price', value: '2350000', category: 'sales_comparison', source: 'costar', confidence: 0.95 },
    { field_name: 'comp2_gba', value: '16,100', category: 'sales_comparison', source: 'costar', confidence: 0.9 },
  ],

  expectedSections: [
    'neighborhood_description',
    'site_description',
    'improvements_description',
    'sales_comparison_summary',
    'income_approach_summary',
  ],
};

// ── Validation Step Definitions ─────────────────────────────────────────────

export const GOLDEN_PATH_STEPS = [
  { id: 'case_create',      label: 'Create case from assignment',         dod: '#1' },
  { id: 'facts_load',       label: 'Load facts with provenance',          dod: '#3' },
  { id: 'facts_verify',     label: 'Verify all facts have source/confidence', dod: '#3' },
  { id: 'workspace_check',  label: 'Workspace matches form type',         dod: '#4' },
  { id: 'pre_draft_gate',   label: 'Pre-draft gate enforced',             dod: '#3' },
  { id: 'generation_run',   label: 'Generate all priority sections',      dod: '#5' },
  { id: 'sections_exist',   label: 'All expected sections created',       dod: '#5' },
  { id: 'qc_run',           label: 'QC run executes without crash',       dod: '#7' },
  { id: 'qc_findings',      label: 'QC findings have severity levels',    dod: '#7' },
  { id: 'insertion_prepare', label: 'Insertion run prepares successfully', dod: '#8' },
  { id: 'insertion_items',   label: 'Insertion maps fields correctly',     dod: '#8' },
  { id: 'audit_events',     label: 'Audit trail records lifecycle events', dod: '#10' },
  { id: 'case_archive',     label: 'Case can be archived and restored',   dod: '#9' },
  { id: 'backup_create',    label: 'Backup creates and verifies',         dod: '#10' },
];
