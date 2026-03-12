/**
 * server/workspace/1004WorkspaceDefinition.js
 * -------------------------------------------
 * Phase D0 foundation for the CACC 1004 section-based workspace.
 *
 * The uploaded blank CACC 1004 PDF is the canonical structural reference.
 * This definition does not render the PDF directly. Instead it describes
 * the editable workspace in section order, along with locked standard blocks
 * and field bindings into the case record.
 */

function textField(fieldId, label, workspacePath, options = {}) {
  return {
    fieldId,
    label,
    inputType: 'text',
    workspacePath,
    suggestionPath: options.suggestionPath || null,
    syncPaths: options.syncPaths || [],
    page: options.page || null,
    group: options.group || 'General',
    placeholder: options.placeholder || '',
    helperText: options.helperText || '',
    width: options.width || 'half',
  };
}

function textareaField(fieldId, label, workspacePath, options = {}) {
  return {
    fieldId,
    label,
    inputType: 'textarea',
    workspacePath,
    suggestionPath: options.suggestionPath || null,
    syncPaths: options.syncPaths || [],
    page: options.page || null,
    group: options.group || 'Narrative',
    placeholder: options.placeholder || '',
    helperText: options.helperText || '',
    rows: options.rows || 4,
    width: options.width || 'full',
  };
}

function selectField(fieldId, label, workspacePath, choices, options = {}) {
  return {
    fieldId,
    label,
    inputType: 'select',
    workspacePath,
    suggestionPath: options.suggestionPath || null,
    syncPaths: options.syncPaths || [],
    options: choices,
    page: options.page || null,
    group: options.group || 'General',
    helperText: options.helperText || '',
    width: options.width || 'half',
  };
}

function gridField(fieldId, label, workspacePath, columns, rows, options = {}) {
  return {
    fieldId,
    label,
    inputType: 'grid',
    workspacePath,
    suggestionPath: options.suggestionPath || null,
    syncPaths: options.syncPaths || [],
    columns,
    defaultValue: rows,
    page: options.page || null,
    group: options.group || 'Grid',
    helperText: options.helperText || '',
    width: 'full',
  };
}

const yesNoUnknown = [
  { value: '', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const occupantChoices = [
  { value: '', label: 'Unknown' },
  { value: 'owner', label: 'Owner' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'vacant', label: 'Vacant' },
];

const propertyRightsChoices = [
  { value: '', label: 'Unknown' },
  { value: 'fee_simple', label: 'Fee Simple' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'other', label: 'Other' },
];

const assignmentTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'purchase', label: 'Purchase Transaction' },
  { value: 'refinance', label: 'Refinance Transaction' },
  { value: 'other', label: 'Other' },
];

const zoningComplianceChoices = [
  { value: '', label: 'Unknown' },
  { value: 'legal', label: 'Legal' },
  { value: 'legal_nonconforming', label: 'Legal Nonconforming' },
  { value: 'no_zoning', label: 'No Zoning' },
  { value: 'illegal', label: 'Illegal' },
];

const reportOptionChoices = [
  { value: '', label: 'Unknown' },
  { value: 'appraisal_report', label: 'Appraisal Report' },
  { value: 'restricted_appraisal_report', label: 'Restricted Appraisal Report' },
];

const hoaPeriodChoices = [
  { value: '', label: 'Unknown' },
  { value: 'per_year', label: 'Per Year' },
  { value: 'per_month', label: 'Per Month' },
];

const pudIndicatorChoices = [
  { value: '', label: 'Unknown' },
  { value: 'pud', label: 'PUD' },
  { value: 'not_pud', label: 'Not PUD' },
];

const utilityServiceChoices = [
  { value: '', label: 'Unknown' },
  { value: 'public', label: 'Public' },
  { value: 'other', label: 'Other' },
];

const offsiteImprovementChoices = [
  { value: '', label: 'Unknown' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];

const unitCountChoices = [
  { value: '', label: 'Unknown' },
  { value: 'one', label: 'One' },
  { value: 'one_with_accessory_unit', label: 'One with Accessory Unit' },
];

const propertyTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'detached', label: 'Detached' },
  { value: 'attached', label: 'Attached' },
  { value: 'semi_detached_end_unit', label: 'Semi-Detached / End Unit' },
];

const constructionStatusChoices = [
  { value: '', label: 'Unknown' },
  { value: 'existing', label: 'Existing' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'under_construction', label: 'Under Construction' },
];

const paddChoices = [
  { value: '', label: 'Unknown' },
  { value: 'none', label: 'None' },
  { value: 'yes', label: 'Yes' },
];

const heatingTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'fwa', label: 'FWA' },
  { value: 'hwbb', label: 'HWBB' },
  { value: 'radiant', label: 'Radiant' },
  { value: 'other', label: 'Other' },
];

const coolingTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'central_air', label: 'Central Air Conditioning' },
  { value: 'individual', label: 'Individual' },
  { value: 'other', label: 'Other' },
];

const carStorageChoices = [
  { value: '', label: 'Unknown' },
  { value: 'none', label: 'None' },
  { value: 'driveway', label: 'Driveway' },
  { value: 'garage', label: 'Garage' },
  { value: 'carport', label: 'Carport' },
];

const amenityAttachmentChoices = [
  { value: '', label: 'Unknown' },
  { value: 'attached', label: 'Attached' },
  { value: 'detached', label: 'Detached' },
  { value: 'built_in', label: 'Built-in' },
];

const pudUnitTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'detached', label: 'Detached' },
  { value: 'attached', label: 'Attached' },
];

const inspectionLevelChoices = [
  { value: '', label: 'Unknown' },
  { value: 'did_not_inspect', label: 'Did Not Inspect' },
  { value: 'exterior_only', label: 'Exterior-Only from Street' },
  { value: 'interior_and_exterior', label: 'Interior and Exterior' },
];

const conditionRatingChoices = [
  { value: '', label: 'Unknown' },
  { value: 'C1', label: 'C1' },
  { value: 'C2', label: 'C2' },
  { value: 'C3', label: 'C3' },
  { value: 'C4', label: 'C4' },
  { value: 'C5', label: 'C5' },
  { value: 'C6', label: 'C6' },
];

const qualityRatingChoices = [
  { value: '', label: 'Unknown' },
  { value: 'Q1', label: 'Q1' },
  { value: 'Q2', label: 'Q2' },
  { value: 'Q3', label: 'Q3' },
  { value: 'Q4', label: 'Q4' },
  { value: 'Q5', label: 'Q5' },
  { value: 'Q6', label: 'Q6' },
];

const reportConditionChoices = [
  { value: '', label: 'Unknown' },
  { value: 'as_is', label: '"As Is"' },
  { value: 'subject_to_repairs', label: 'Subject to Completion of Repairs' },
  { value: 'subject_to_alterations', label: 'Subject to Alterations / Conditions' },
  { value: 'subject_to_completion', label: 'Subject to Completion per Plans/Specifications' },
];

const surfaceTypeChoices = [
  { value: '', label: 'Unknown' },
  { value: 'asphalt', label: 'Asphalt' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'gravel', label: 'Gravel' },
  { value: 'dirt', label: 'Dirt' },
];

const adjustmentGridRows = [
  'Address',
  'Proximity to Subject',
  'Sale Price',
  'Sale Price / Gross Liv. Area',
  'Data Source(s)',
  'Verification Source(s)',
  'Sale or Financing Concessions',
  'Date of Sale / Time',
  'Location',
  'Leasehold / Fee Simple',
  'Site',
  'View',
  'Design (Style)',
  'Quality of Construction',
  'Actual Age',
  'Condition',
  'Above Grade Beds / Baths',
  'Room Count',
  'Gross Living Area',
  'Basement / Finished Rooms Below Grade',
  'Functional Utility',
  'Heating / Cooling',
  'Energy Efficient Items',
  'Garage / Carport',
  'Porch / Patio / Deck',
  'Net Adjustment',
  'Adjusted Sale Price',
];

const priorSaleGridRows = [
  'Date of Prior Sale / Transfer',
  'Price of Prior Sale / Transfer',
  'Data Source(s)',
  'Effective Date of Data Source(s)',
];

const measurementRows = [
  {
    area: 'Living',
    areaType: 'GLA',
    measurements: '',
    factor: '',
    total: '',
    level1: '',
    level2: '',
    level3: '',
    other: '',
    basement: '',
    garage: '',
  },
  {
    area: 'Basement',
    areaType: 'Below Grade',
    measurements: '',
    factor: '',
    total: '',
    level1: '',
    level2: '',
    level3: '',
    other: '',
    basement: '',
    garage: '',
  },
  {
    area: 'Garage',
    areaType: 'Ancillary',
    measurements: '',
    factor: '',
    total: '',
    level1: '',
    level2: '',
    level3: '',
    other: '',
    basement: '',
    garage: '',
  },
];

const dimensionAreaSummaryRows = [
  { areaLabel: 'Living', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Level 1', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Level 2', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Level 3', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Other', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'GBA', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Basement', area: '', glaPercent: '', gbaPercent: '' },
  { areaLabel: 'Garage', area: '', glaPercent: '', gbaPercent: '' },
];

function buildAdjustmentGridRows() {
  return adjustmentGridRows.map((feature) => ({
    feature,
    subject: '',
    comp1: '',
    comp2: '',
    comp3: '',
  }));
}

function buildPriorSaleGridRows() {
  return priorSaleGridRows.map((label) => ({
    item: label,
    subject: '',
    comp1: '',
    comp2: '',
    comp3: '',
  }));
}

const sections = [
  {
    id: 'assignment',
    label: 'Assignment',
    pageHint: 'Cover + page 1',
    description: 'Assignment setup, intended use, and client identifiers.',
    fields: [
      textField('assignment_file_number', 'File Number', 'workspace1004.assignment.fileNumber', {
        page: 1,
        group: 'Assignment Setup',
        width: 'third',
      }),
      textField('assignment_cover_appraisal_of', 'Cover: Appraisal Of', 'workspace1004.assignment.cover.appraisalOf', {
        page: 1,
        group: 'Cover Sheet',
        width: 'half',
      }),
      textField('assignment_cover_located_at', 'Cover: Located At', 'workspace1004.assignment.cover.locatedAt', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 1,
        group: 'Cover Sheet',
        width: 'half',
      }),
      textField('assignment_cover_for', 'Cover: For', 'workspace1004.assignment.cover.forParty', {
        page: 1,
        group: 'Cover Sheet',
        width: 'third',
      }),
      textField('assignment_cover_borrower', 'Cover: Borrower', 'workspace1004.assignment.cover.borrower', {
        page: 1,
        group: 'Cover Sheet',
        width: 'third',
      }),
      textField('assignment_cover_as_of', 'Cover: As Of', 'workspace1004.assignment.cover.asOfDate', {
        suggestionPath: 'assignment.effectiveDate',
        syncPaths: ['assignment.effectiveDate'],
        page: 1,
        group: 'Cover Sheet',
        width: 'third',
      }),
      textField('assignment_cover_by', 'Cover: By', 'workspace1004.assignment.cover.by', {
        page: 1,
        group: 'Cover Sheet',
        width: 'third',
      }),
      textField('assignment_intended_use', 'Intended Use', 'workspace1004.assignment.intendedUse', {
        suggestionPath: 'assignment.intendedUse',
        syncPaths: ['assignment.intendedUse'],
        page: 1,
        group: 'Assignment Setup',
        width: 'third',
      }),
      textField('assignment_intended_user', 'Intended User', 'workspace1004.assignment.intendedUser', {
        suggestionPath: 'assignment.intendedUser',
        syncPaths: ['assignment.intendedUser'],
        page: 1,
        group: 'Assignment Setup',
        width: 'third',
      }),
      textField('assignment_effective_date', 'Effective Date of Appraisal', 'workspace1004.assignment.effectiveDate', {
        suggestionPath: 'assignment.effectiveDate',
        syncPaths: ['assignment.effectiveDate'],
        page: 1,
        group: 'Assignment Setup',
        width: 'third',
      }),
      textField('assignment_lender_client', 'Lender / Client', 'workspace1004.assignment.lenderClient', {
        page: 1,
        group: 'Client',
        width: 'half',
      }),
      textField('assignment_lender_address', 'Lender / Client Address', 'workspace1004.assignment.lenderAddress', {
        page: 1,
        group: 'Client',
        width: 'half',
      }),
      textField('assignment_transmittal_property_address', 'Transmittal: Real Property Address', 'workspace1004.assignment.transmittal.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 2,
        group: 'Transmittal',
        width: 'half',
      }),
      textField('assignment_transmittal_market_value', 'Transmittal: Market Value Opinion', 'workspace1004.assignment.transmittal.marketValueOpinion', {
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_market_value_as_of', 'Transmittal: Value As Of', 'workspace1004.assignment.transmittal.marketValueAsOfDate', {
        suggestionPath: 'assignment.effectiveDate',
        syncPaths: ['assignment.effectiveDate'],
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_census_tract', 'Transmittal: Census Tract', 'workspace1004.assignment.transmittal.censusTract', {
        suggestionPath: 'subject.censusTract',
        syncPaths: ['subject.censusTract'],
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_map_reference', 'Transmittal: Map Reference', 'workspace1004.assignment.transmittal.mapReference', {
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_county', 'Transmittal: County', 'workspace1004.assignment.transmittal.county', {
        suggestionPath: 'subject.county',
        syncPaths: ['subject.county'],
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_state', 'Transmittal: State', 'workspace1004.assignment.transmittal.state', {
        suggestionPath: 'subject.state',
        syncPaths: ['subject.state'],
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_zip', 'Transmittal: Zip Code', 'workspace1004.assignment.transmittal.zip', {
        suggestionPath: 'subject.zip',
        syncPaths: ['subject.zip'],
        page: 2,
        group: 'Transmittal',
        width: 'quarter',
      }),
      textField('assignment_transmittal_borrower', 'Transmittal: Borrower', 'workspace1004.assignment.transmittal.borrower', {
        page: 2,
        group: 'Transmittal',
        width: 'half',
      }),
      textField('assignment_transmittal_legal_description', 'Transmittal: Legal Description', 'workspace1004.assignment.transmittal.legalDescription', {
        page: 2,
        group: 'Transmittal',
        width: 'full',
      }),
      textareaField('assignment_scope_notes', 'Scope Notes / Special Instructions', 'workspace1004.assignment.scopeNotes', {
        suggestionPath: 'assignment.scopeOfWork',
        page: 1,
        group: 'Assignment Setup',
        rows: 4,
      }),
      textareaField('assignment_extraordinary_assumptions', 'Extraordinary Assumptions', 'workspace1004.assignment.extraordinaryAssumptions', {
        suggestionPath: 'assignment.extraordinaryAssumptions',
        syncPaths: ['assignment.extraordinaryAssumptions'],
        page: 2,
        group: 'Assignment Setup',
        rows: 3,
      }),
      textareaField('assignment_hypothetical_conditions', 'Hypothetical Conditions', 'workspace1004.assignment.hypotheticalConditions', {
        suggestionPath: 'assignment.hypotheticalConditions',
        syncPaths: ['assignment.hypotheticalConditions'],
        page: 2,
        group: 'Assignment Setup',
        rows: 3,
      }),
    ],
  },
  {
    id: 'subject',
    label: 'Subject',
    pageHint: 'Page 1',
    description: 'Subject identity, ownership, and property rights.',
    fields: [
      textField('subject_property_address', 'Property Address', 'workspace1004.subject.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 1,
        group: 'Identity',
        width: 'full',
      }),
      textField('subject_city', 'City', 'workspace1004.subject.city', {
        suggestionPath: 'subject.city',
        syncPaths: ['subject.city'],
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
      textField('subject_state', 'State', 'workspace1004.subject.state', {
        suggestionPath: 'subject.state',
        syncPaths: ['subject.state'],
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
      textField('subject_zip', 'Zip Code', 'workspace1004.subject.zip', {
        suggestionPath: 'subject.zip',
        syncPaths: ['subject.zip'],
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
      textField('subject_borrower', 'Borrower', 'workspace1004.subject.borrower', {
        page: 1,
        group: 'Identity',
        width: 'half',
      }),
      textField('subject_owner_of_record', 'Owner of Public Record', 'workspace1004.subject.ownerOfRecord', {
        page: 1,
        group: 'Identity',
        width: 'half',
      }),
      textField('subject_county', 'County', 'workspace1004.subject.county', {
        suggestionPath: 'subject.county',
        syncPaths: ['subject.county'],
        page: 1,
        group: 'Identity',
        width: 'half',
      }),
      textareaField('subject_legal_description', 'Legal Description', 'workspace1004.subject.legalDescription', {
        page: 1,
        group: 'Legal',
        rows: 3,
      }),
      textField('subject_apn', "Assessor's Parcel #", 'workspace1004.subject.assessorParcelNumber', {
        suggestionPath: 'subject.parcelId',
        syncPaths: ['subject.parcelId'],
        page: 1,
        group: 'Legal',
        width: 'third',
      }),
      textField('subject_tax_year', 'Tax Year', 'workspace1004.subject.taxYear', {
        page: 1,
        group: 'Legal',
        width: 'third',
      }),
      textField('subject_re_taxes', 'R.E. Taxes', 'workspace1004.subject.realEstateTaxes', {
        page: 1,
        group: 'Legal',
        width: 'third',
      }),
      textField('subject_neighborhood_name', 'Neighborhood Name', 'workspace1004.subject.neighborhoodName', {
        page: 1,
        group: 'Market Reference',
        width: 'third',
      }),
      textField('subject_map_reference', 'Map Reference', 'workspace1004.subject.mapReference', {
        page: 1,
        group: 'Market Reference',
        width: 'third',
      }),
      textField('subject_census_tract', 'Census Tract', 'workspace1004.subject.censusTract', {
        page: 1,
        group: 'Market Reference',
        width: 'third',
      }),
      selectField('subject_occupant', 'Occupant', 'workspace1004.subject.occupant', occupantChoices, {
        page: 1,
        group: 'Occupancy',
        width: 'third',
      }),
      textField('subject_special_assessments', 'Special Assessments', 'workspace1004.subject.specialAssessments', {
        page: 1,
        group: 'Occupancy',
        width: 'third',
      }),
      selectField('subject_pud_indicator', 'PUD Indicator', 'workspace1004.subject.pudIndicator', pudIndicatorChoices, {
        page: 1,
        group: 'Occupancy',
        width: 'third',
      }),
      textField('subject_hoa_dues', 'PUD / HOA Dues', 'workspace1004.subject.hoaDues', {
        page: 1,
        group: 'Occupancy',
        width: 'third',
      }),
      selectField('subject_hoa_period', 'HOA Dues Period', 'workspace1004.subject.hoaPeriod', hoaPeriodChoices, {
        page: 1,
        group: 'Occupancy',
        width: 'third',
      }),
      selectField('subject_property_rights', 'Property Rights Appraised', 'workspace1004.subject.propertyRightsAppraised', propertyRightsChoices, {
        page: 1,
        group: 'Assignment Type',
        width: 'half',
      }),
      textField('subject_property_rights_other', 'Other Property Rights Description', 'workspace1004.subject.propertyRightsOther', {
        page: 1,
        group: 'Assignment Type',
        width: 'half',
      }),
      selectField('subject_assignment_type', 'Assignment Type', 'workspace1004.subject.assignmentType', assignmentTypeChoices, {
        page: 1,
        group: 'Assignment Type',
        width: 'half',
      }),
      textField('subject_assignment_type_other', 'Other Assignment Type Description', 'workspace1004.subject.assignmentTypeOther', {
        page: 1,
        group: 'Assignment Type',
        width: 'full',
      }),
      textField('subject_sale_price', 'Sale Price of Subject', 'workspace1004.subject.salePrice', {
        suggestionPath: 'contract.contractPrice',
        syncPaths: ['contract.contractPrice'],
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
      textField('subject_date_of_sale', 'Date of Sale', 'workspace1004.subject.dateOfSale', {
        suggestionPath: 'contract.contractDate',
        syncPaths: ['contract.contractDate'],
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
      textField('subject_data_source_sale_price', 'Data Source(s) for Sale Price', 'workspace1004.subject.dataSources', {
        page: 1,
        group: 'Identity',
        width: 'third',
      }),
    ],
  },
  {
    id: 'contract',
    label: 'Contract',
    pageHint: 'Page 1',
    description: 'Contract analysis, offering history, and concessions.',
    fields: [
      selectField('contract_offered_for_sale', 'Offered for Sale in Prior 12 Months?', 'workspace1004.contract.offeredForSalePrior12Months', yesNoUnknown, {
        page: 1,
        group: 'Offering',
        width: 'half',
      }),
      textareaField('contract_offering_history', 'Report Data Sources, Offering Price(s), and Date(s)', 'workspace1004.contract.offeringHistory', {
        suggestionPath: 'contract.offeringHistory',
        syncPaths: ['contract.offeringHistory'],
        page: 1,
        group: 'Offering',
        rows: 4,
      }),
      selectField('contract_analyzed', 'Contract for Sale Analyzed?', 'workspace1004.contract.contractAnalyzed', yesNoUnknown, {
        page: 1,
        group: 'Analysis',
        width: 'half',
      }),
      textareaField('contract_analysis', 'Analysis of Contract for Sale', 'workspace1004.contract.contractAnalysis', {
        suggestionPath: 'contract.contractAnalysis',
        page: 1,
        group: 'Analysis',
        rows: 4,
      }),
      textField('contract_price', 'Contract Price', 'workspace1004.contract.contractPrice', {
        suggestionPath: 'contract.contractPrice',
        syncPaths: ['contract.contractPrice'],
        page: 1,
        group: 'Analysis',
        width: 'third',
      }),
      textField('contract_date', 'Date of Contract', 'workspace1004.contract.contractDate', {
        suggestionPath: 'contract.contractDate',
        syncPaths: ['contract.contractDate'],
        page: 1,
        group: 'Analysis',
        width: 'third',
      }),
      selectField('contract_seller_owner_record', 'Seller is Owner of Record?', 'workspace1004.contract.sellerIsOwnerOfRecord', yesNoUnknown, {
        page: 1,
        group: 'Analysis',
        width: 'third',
      }),
      textField('contract_data_sources', 'Contract Data Source(s)', 'workspace1004.contract.dataSources', {
        page: 1,
        group: 'Analysis',
        width: 'full',
      }),
      selectField('contract_financial_assistance', 'Financial Assistance to Borrower?', 'workspace1004.contract.financialAssistancePresent', yesNoUnknown, {
        page: 1,
        group: 'Concessions',
        width: 'half',
      }),
      textField('contract_financial_assistance_amount', 'Total Dollar Amount', 'workspace1004.contract.financialAssistanceAmount', {
        suggestionPath: 'contract.sellerConcessions',
        syncPaths: ['contract.sellerConcessions'],
        page: 1,
        group: 'Concessions',
        width: 'half',
      }),
      textareaField('contract_financial_assistance_items', 'Items Paid / Described', 'workspace1004.contract.financialAssistanceItems', {
        page: 1,
        group: 'Concessions',
        rows: 3,
      }),
    ],
  },
  {
    id: 'neighborhood',
    label: 'Neighborhood',
    pageHint: 'Page 1',
    description: 'Neighborhood metrics, boundaries, and market commentary.',
    fields: [
      textField('neighborhood_location_type', 'Location', 'workspace1004.neighborhood.locationType', {
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_built_up', 'Built-Up', 'workspace1004.neighborhood.builtUp', {
        suggestionPath: 'neighborhood.builtUp',
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_growth', 'Growth', 'workspace1004.neighborhood.growth', {
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_property_values', 'Property Values Trend', 'workspace1004.neighborhood.propertyValuesTrend', {
        suggestionPath: 'market.trend',
        syncPaths: ['market.trend'],
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_demand_supply', 'Demand / Supply', 'workspace1004.neighborhood.demandSupply', {
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_marketing_time', 'Marketing Time', 'workspace1004.neighborhood.marketingTime', {
        suggestionPath: 'market.typicalDOM',
        syncPaths: ['market.typicalDOM'],
        page: 1,
        group: 'Trends',
        width: 'third',
      }),
      textField('neighborhood_price_range', 'Price Range', 'workspace1004.neighborhood.priceRange', {
        suggestionPath: 'market.priceRange',
        syncPaths: ['market.priceRange'],
        page: 1,
        group: 'Housing Stock',
        width: 'half',
      }),
      textField('neighborhood_pred_age', 'Predominant Age', 'workspace1004.neighborhood.predominantAge', {
        page: 1,
        group: 'Housing Stock',
        width: 'quarter',
      }),
      textField('neighborhood_pred_price', 'Predominant Price', 'workspace1004.neighborhood.predominantPrice', {
        suggestionPath: 'market.predominantPrice',
        page: 1,
        group: 'Housing Stock',
        width: 'quarter',
      }),
      textField('neighborhood_age_range', 'Age Range', 'workspace1004.neighborhood.ageRange', {
        page: 1,
        group: 'Housing Stock',
        width: 'quarter',
      }),
      textField('neighborhood_one_unit_percent', 'One-Unit %', 'workspace1004.neighborhood.oneUnitPercent', {
        page: 1,
        group: 'Land Use',
        width: 'quarter',
      }),
      textField('neighborhood_two_to_four_percent', '2-4 Unit %', 'workspace1004.neighborhood.twoToFourUnitPercent', {
        page: 1,
        group: 'Land Use',
        width: 'quarter',
      }),
      textField('neighborhood_multi_percent', 'Multi-Family %', 'workspace1004.neighborhood.multiFamilyPercent', {
        page: 1,
        group: 'Land Use',
        width: 'quarter',
      }),
      textField('neighborhood_commercial_percent', 'Commercial %', 'workspace1004.neighborhood.commercialPercent', {
        page: 1,
        group: 'Land Use',
        width: 'quarter',
      }),
      textField('neighborhood_other_percent', 'Pred. Other %', 'workspace1004.neighborhood.otherPercent', {
        page: 1,
        group: 'Land Use',
        width: 'quarter',
      }),
      textareaField('neighborhood_boundaries', 'Neighborhood Boundaries', 'workspace1004.neighborhood.boundaries', {
        suggestionPath: 'neighborhood.boundaries',
        syncPaths: ['neighborhood.boundaries'],
        page: 1,
        group: 'Narrative',
        rows: 3,
      }),
      textareaField('neighborhood_description', 'Neighborhood Description', 'workspace1004.neighborhood.description', {
        suggestionPath: 'neighborhood.description',
        syncPaths: ['neighborhood.description'],
        page: 1,
        group: 'Narrative',
        rows: 5,
      }),
      textareaField('neighborhood_market_conditions', 'Market Conditions', 'workspace1004.neighborhood.marketConditions', {
        suggestionPath: 'market.marketConditions',
        syncPaths: ['market.marketConditions'],
        page: 1,
        group: 'Narrative',
        rows: 5,
      }),
    ],
  },
  {
    id: 'site',
    label: 'Site',
    pageHint: 'Page 1',
    description: 'Site characteristics, zoning, utilities, flood, and adverse conditions.',
    fields: [
      textField('site_dimensions', 'Dimensions', 'workspace1004.site.dimensions', {
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      textField('site_area', 'Area', 'workspace1004.site.area', {
        suggestionPath: 'subject.siteSize',
        syncPaths: ['subject.siteSize'],
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      textField('site_shape', 'Shape', 'workspace1004.site.shape', {
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      textField('site_view', 'View', 'workspace1004.site.view', {
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      textField('site_topography', 'Topography', 'workspace1004.site.topography', {
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      textField('site_drainage', 'Drainage', 'workspace1004.site.drainage', {
        page: 1,
        group: 'Physical',
        width: 'quarter',
      }),
      selectField('site_street_surface', 'Street Surface', 'workspace1004.site.streetSurface', surfaceTypeChoices, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'quarter',
      }),
      selectField('site_curb_gutter', 'Curb / Gutter', 'workspace1004.site.curbGutter', yesNoUnknown, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'quarter',
      }),
      selectField('site_sidewalk', 'Sidewalk', 'workspace1004.site.sidewalk', yesNoUnknown, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'quarter',
      }),
      selectField('site_street_lights', 'Street Lights', 'workspace1004.site.streetLights', yesNoUnknown, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'quarter',
      }),
      textField('site_zoning_classification', 'Specific Zoning Classification', 'workspace1004.site.zoningClassification', {
        suggestionPath: 'subject.zoning',
        syncPaths: ['subject.zoning'],
        page: 1,
        group: 'Zoning',
        width: 'half',
      }),
      textField('site_zoning_description', 'Zoning Description', 'workspace1004.site.zoningDescription', {
        page: 1,
        group: 'Zoning',
        width: 'half',
      }),
      selectField('site_zoning_compliance', 'Zoning Compliance', 'workspace1004.site.zoningCompliance', zoningComplianceChoices, {
        page: 1,
        group: 'Zoning',
        width: 'half',
      }),
      selectField('site_hbu_present_use', 'Highest and Best Use is Present Use?', 'workspace1004.site.highestBestUsePresentUse', yesNoUnknown, {
        page: 1,
        group: 'Zoning',
        width: 'half',
      }),
      textareaField('site_hbu_comment', 'If No, Describe Highest and Best Use', 'workspace1004.site.highestBestUseComment', {
        page: 1,
        group: 'Zoning',
        rows: 3,
      }),
      selectField('site_electricity_service', 'Electricity', 'workspace1004.site.utilities.electricity', utilityServiceChoices, {
        page: 1,
        group: 'Utilities',
        width: 'third',
      }),
      selectField('site_gas_service', 'Gas', 'workspace1004.site.utilities.gas', utilityServiceChoices, {
        page: 1,
        group: 'Utilities',
        width: 'third',
      }),
      selectField('site_water_service', 'Water', 'workspace1004.site.utilities.water', utilityServiceChoices, {
        page: 1,
        group: 'Utilities',
        width: 'third',
      }),
      selectField('site_sanitary_sewer_service', 'Sanitary Sewer', 'workspace1004.site.utilities.sanitarySewer', utilityServiceChoices, {
        page: 1,
        group: 'Utilities',
        width: 'third',
      }),
      textField('site_utility_other_descriptions', 'Utility Other Description(s)', 'workspace1004.site.utilities.otherDescriptions', {
        page: 1,
        group: 'Utilities',
        width: 'full',
      }),
      selectField('site_street_improvement', 'Street', 'workspace1004.site.offsiteImprovements.street', offsiteImprovementChoices, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'half',
      }),
      selectField('site_alley_improvement', 'Alley', 'workspace1004.site.offsiteImprovements.alley', offsiteImprovementChoices, {
        page: 1,
        group: 'Off-Site Improvements',
        width: 'half',
      }),
      selectField('site_flood_hazard_area', 'FEMA Special Flood Hazard Area?', 'workspace1004.site.femaSpecialFloodHazardArea', yesNoUnknown, {
        suggestionPath: 'subject.floodZone',
        page: 1,
        group: 'Flood',
        width: 'third',
      }),
      textField('site_flood_zone', 'FEMA Flood Zone', 'workspace1004.site.femaFloodZone', {
        suggestionPath: 'subject.floodZone',
        page: 1,
        group: 'Flood',
        width: 'third',
      }),
      textField('site_flood_map_number', 'FEMA Map #', 'workspace1004.site.femaMapNumber', {
        page: 1,
        group: 'Flood',
        width: 'third',
      }),
      textField('site_flood_map_date', 'FEMA Map Date', 'workspace1004.site.femaMapDate', {
        page: 1,
        group: 'Flood',
        width: 'third',
      }),
      selectField('site_utilities_typical', 'Utilities Typical for Market Area?', 'workspace1004.site.utilitiesTypical', yesNoUnknown, {
        page: 1,
        group: 'Adverse Conditions',
        width: 'half',
      }),
      textareaField('site_utilities_typical_comment', 'If No, Describe Utility / Off-Site Difference', 'workspace1004.site.utilitiesTypicalComment', {
        page: 1,
        group: 'Adverse Conditions',
        rows: 3,
      }),
      selectField('site_adverse_conditions_present', 'Adverse Site Conditions / External Factors?', 'workspace1004.site.adverseConditionsPresent', yesNoUnknown, {
        page: 1,
        group: 'Adverse Conditions',
        width: 'half',
      }),
      textareaField('site_adverse_conditions_comment', 'Adverse Site Conditions / External Factors Description', 'workspace1004.site.adverseConditionsComment', {
        suggestionPath: 'site.adverseConditions',
        page: 1,
        group: 'Adverse Conditions',
        rows: 4,
      }),
    ],
  },
  {
    id: 'improvements',
    label: 'Improvements',
    pageHint: 'Page 1',
    description: 'Dwelling form, room count, condition, utility, and deficiency commentary.',
    fields: [
      selectField('improvements_units', 'Units', 'workspace1004.improvements.units', unitCountChoices, {
        page: 1,
        group: 'General Description',
        width: 'third',
      }),
      textField('improvements_stories', '# of Stories', 'workspace1004.improvements.stories', {
        page: 1,
        group: 'General Description',
        width: 'third',
      }),
      selectField('improvements_type', 'Type', 'workspace1004.improvements.type', propertyTypeChoices, {
        page: 1,
        group: 'General Description',
        width: 'third',
      }),
      selectField('improvements_construction_status', 'Construction Status', 'workspace1004.improvements.constructionStatus', constructionStatusChoices, {
        page: 1,
        group: 'General Description',
        width: 'third',
      }),
      textField('improvements_design_style', 'Design (Style)', 'workspace1004.improvements.designStyle', {
        suggestionPath: 'subject.style',
        syncPaths: ['subject.style'],
        page: 1,
        group: 'General Description',
        width: 'half',
      }),
      textField('improvements_year_built', 'Year Built', 'workspace1004.improvements.yearBuilt', {
        suggestionPath: 'subject.yearBuilt',
        syncPaths: ['subject.yearBuilt'],
        page: 1,
        group: 'General Description',
        width: 'quarter',
      }),
      textField('improvements_effective_age', 'Effective Age', 'workspace1004.improvements.effectiveAge', {
        page: 1,
        group: 'General Description',
        width: 'quarter',
      }),
      selectField('improvements_quality_rating', 'Quality Rating (Q1-Q6)', 'workspace1004.improvements.qualityRating', qualityRatingChoices, {
        suggestionPath: 'subject.quality',
        syncPaths: ['subject.quality'],
        page: 1,
        group: 'General Description',
        width: 'quarter',
      }),
      selectField('improvements_condition_rating', 'Condition Rating (C1-C6)', 'workspace1004.improvements.conditionRating', conditionRatingChoices, {
        suggestionPath: 'subject.condition',
        syncPaths: ['subject.condition'],
        page: 1,
        group: 'General Description',
        width: 'quarter',
      }),
      selectField('improvements_foundation_slab', 'Concrete Slab', 'workspace1004.improvements.foundation.concreteSlab', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_foundation_crawl_space', 'Crawl Space', 'workspace1004.improvements.foundation.crawlSpace', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_foundation_full_basement', 'Full Basement', 'workspace1004.improvements.foundation.fullBasement', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_foundation_partial_basement', 'Partial Basement', 'workspace1004.improvements.foundation.partialBasement', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      textField('improvements_foundation_walls', 'Foundation Walls', 'workspace1004.improvements.foundation.walls', {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      textField('improvements_basement_area', 'Basement Area sq. ft.', 'workspace1004.improvements.basement.area', {
        suggestionPath: 'subject.basement',
        syncPaths: ['subject.basement'],
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      textField('improvements_basement_finish_percent', 'Basement Finish %', 'workspace1004.improvements.basement.finishPercent', {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_basement_outside_entry', 'Outside Entry / Exit', 'workspace1004.improvements.basement.outsideEntryExit', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_basement_sump_pump', 'Sump Pump', 'workspace1004.improvements.basement.sumpPump', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_basement_infestation', 'Evidence of Infestation', 'workspace1004.improvements.basement.evidenceOfInfestation', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_basement_dampness', 'Dampness', 'workspace1004.improvements.basement.dampness', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      selectField('improvements_basement_settlement', 'Settlement', 'workspace1004.improvements.basement.settlement', yesNoUnknown, {
        page: 1,
        group: 'Construction',
        width: 'third',
      }),
      textField('improvements_exterior_walls', 'Exterior Walls', 'workspace1004.improvements.exterior.exteriorWalls', {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      textField('improvements_roof_surface', 'Roof Surface', 'workspace1004.improvements.exterior.roofSurface', {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      textField('improvements_gutters_downspouts', 'Gutters & Downspouts', 'workspace1004.improvements.exterior.guttersDownspouts', {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      textField('improvements_window_type', 'Window Type', 'workspace1004.improvements.exterior.windowType', {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      selectField('improvements_storm_sash_insulated', 'Storm Sash / Insulated', 'workspace1004.improvements.exterior.stormSashInsulated', yesNoUnknown, {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      selectField('improvements_screens', 'Screens', 'workspace1004.improvements.exterior.screens', yesNoUnknown, {
        page: 1,
        group: 'Exterior Description',
        width: 'third',
      }),
      textField('improvements_trim_finish', 'Trim / Finish', 'workspace1004.improvements.interior.trimFinish', {
        page: 1,
        group: 'Interior Description',
        width: 'quarter',
      }),
      textField('improvements_walls', 'Walls', 'workspace1004.improvements.interior.walls', {
        page: 1,
        group: 'Interior Description',
        width: 'quarter',
      }),
      textField('improvements_floors', 'Floors', 'workspace1004.improvements.interior.floors', {
        page: 1,
        group: 'Interior Description',
        width: 'quarter',
      }),
      textField('improvements_bath_floor', 'Bath Floor', 'workspace1004.improvements.interior.bathFloor', {
        page: 1,
        group: 'Interior Description',
        width: 'quarter',
      }),
      textField('improvements_bath_wainscot', 'Bath Wainscot', 'workspace1004.improvements.interior.bathWainscot', {
        page: 1,
        group: 'Interior Description',
        width: 'quarter',
      }),
      textField('improvements_exterior_materials', 'Exterior Materials / Condition', 'workspace1004.improvements.exteriorDescription', {
        page: 1,
        group: 'Exterior Description',
        width: 'half',
      }),
      textField('improvements_interior_materials', 'Interior Materials / Condition', 'workspace1004.improvements.interiorDescription', {
        page: 1,
        group: 'Interior Description',
        width: 'full',
      }),
      textField('improvements_room_count', 'Room Count', 'workspace1004.improvements.roomCount', {
        page: 1,
        group: 'Rooms',
        width: 'quarter',
      }),
      textField('improvements_bedrooms', 'Bedrooms', 'workspace1004.improvements.bedrooms', {
        suggestionPath: 'subject.beds',
        syncPaths: ['subject.beds'],
        page: 1,
        group: 'Rooms',
        width: 'quarter',
      }),
      textField('improvements_bathrooms', 'Bath(s)', 'workspace1004.improvements.bathrooms', {
        suggestionPath: 'subject.baths',
        syncPaths: ['subject.baths'],
        page: 1,
        group: 'Rooms',
        width: 'quarter',
      }),
      textField('improvements_gla', 'Gross Living Area Above Grade', 'workspace1004.improvements.gla', {
        suggestionPath: 'subject.gla',
        syncPaths: ['subject.gla'],
        page: 1,
        group: 'Rooms',
        width: 'quarter',
      }),
      selectField('improvements_attic_none', 'Attic: None', 'workspace1004.improvements.attic.none', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_attic_drop_stair', 'Attic: Drop Stair', 'workspace1004.improvements.attic.dropStair', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_attic_stairs', 'Attic: Stairs', 'workspace1004.improvements.attic.stairs', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_attic_floor_scuttle', 'Attic: Floor Scuttle', 'workspace1004.improvements.attic.floorScuttle', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_attic_finished', 'Attic: Finished', 'workspace1004.improvements.attic.finished', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_attic_heated', 'Attic: Heated', 'workspace1004.improvements.attic.heated', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_heating_type', 'Heating', 'workspace1004.improvements.heating.type', heatingTypeChoices, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      textField('improvements_heating_fuel', 'Heating Fuel', 'workspace1004.improvements.heating.fuel', {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      selectField('improvements_cooling_type', 'Cooling', 'workspace1004.improvements.cooling.type', coolingTypeChoices, {
        page: 1,
        group: 'Amenities',
        width: 'third',
      }),
      textField('improvements_heating_cooling', 'Heating / Cooling Summary', 'workspace1004.improvements.heatingCooling', {
        page: 1,
        group: 'Amenities',
        width: 'full',
      }),
      textField('improvements_wood_stoves', 'Wood Stove(s) #', 'workspace1004.improvements.amenities.woodStoves', {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      textField('improvements_fireplaces', 'Fireplace(s) #', 'workspace1004.improvements.amenities.fireplaces', {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      selectField('improvements_fence', 'Fence', 'workspace1004.improvements.amenities.fence', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      selectField('improvements_patio_deck', 'Patio / Deck', 'workspace1004.improvements.amenities.patioDeck', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      selectField('improvements_porch', 'Porch', 'workspace1004.improvements.amenities.porch', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      selectField('improvements_pool', 'Pool', 'workspace1004.improvements.amenities.pool', yesNoUnknown, {
        page: 1,
        group: 'Amenities',
        width: 'quarter',
      }),
      textField('improvements_other_amenities', 'Other Amenities', 'workspace1004.improvements.amenities.other', {
        page: 1,
        group: 'Amenities',
        width: 'half',
      }),
      selectField('improvements_car_storage', 'Car Storage', 'workspace1004.improvements.carStorage.type', carStorageChoices, {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      textField('improvements_driveway_cars', 'Driveway # of Cars', 'workspace1004.improvements.carStorage.drivewayCars', {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      textField('improvements_driveway_surface', 'Driveway Surface', 'workspace1004.improvements.carStorage.drivewaySurface', {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      textField('improvements_garage_cars', 'Garage # of Cars', 'workspace1004.improvements.carStorage.garageCars', {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      textField('improvements_carport_cars', 'Carport # of Cars', 'workspace1004.improvements.carStorage.carportCars', {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      selectField('improvements_car_storage_attachment', 'Car Storage Attachment', 'workspace1004.improvements.carStorage.attachment', amenityAttachmentChoices, {
        page: 1,
        group: 'Car Storage',
        width: 'quarter',
      }),
      textField('improvements_garage_carport', 'Garage / Carport', 'workspace1004.improvements.garageCarport', {
        suggestionPath: 'subject.garage',
        syncPaths: ['subject.garage'],
        page: 1,
        group: 'Car Storage',
        width: 'half',
      }),
      selectField('improvements_appliance_refrigerator', 'Refrigerator', 'workspace1004.improvements.appliances.refrigerator', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      selectField('improvements_appliance_range_oven', 'Range / Oven', 'workspace1004.improvements.appliances.rangeOven', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      selectField('improvements_appliance_dishwasher', 'Dishwasher', 'workspace1004.improvements.appliances.dishwasher', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      selectField('improvements_appliance_disposal', 'Disposal', 'workspace1004.improvements.appliances.disposal', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      selectField('improvements_appliance_microwave', 'Microwave', 'workspace1004.improvements.appliances.microwave', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      selectField('improvements_appliance_washer_dryer', 'Washer / Dryer', 'workspace1004.improvements.appliances.washerDryer', paddChoices, {
        page: 1,
        group: 'Appliances',
        width: 'quarter',
      }),
      textField('improvements_appliance_other', 'Other Appliance Description', 'workspace1004.improvements.appliances.other', {
        page: 1,
        group: 'Appliances',
        width: 'half',
      }),
      textareaField('improvements_additional_features', 'Additional Features / Energy Efficient Items', 'workspace1004.improvements.additionalFeatures', {
        page: 1,
        group: 'Amenities',
        rows: 3,
      }),
      textareaField('improvements_condition_description', 'Condition / Repairs / Renovations / Remodeling', 'workspace1004.improvements.conditionDescription', {
        suggestionPath: 'subject.condition',
        syncPaths: ['subject.condition'],
        page: 1,
        group: 'Condition',
        rows: 5,
      }),
      selectField('improvements_physical_deficiencies_present', 'Physical Deficiencies or Adverse Conditions?', 'workspace1004.improvements.physicalDeficienciesPresent', yesNoUnknown, {
        page: 1,
        group: 'Condition',
        width: 'half',
      }),
      textareaField('improvements_physical_deficiencies_comment', 'Physical Deficiencies / Structural Integrity Comment', 'workspace1004.improvements.physicalDeficienciesComment', {
        page: 1,
        group: 'Condition',
        rows: 3,
      }),
      selectField('improvements_conforms_to_neighborhood', 'Generally Conforms to Neighborhood?', 'workspace1004.improvements.conformsToNeighborhood', yesNoUnknown, {
        page: 1,
        group: 'Utility',
        width: 'half',
      }),
      textareaField('improvements_conforms_comment', 'Functional Utility / Style / Condition / Use Comment', 'workspace1004.improvements.conformsComment', {
        suggestionPath: 'improvements.functionalUtility',
        page: 1,
        group: 'Utility',
        rows: 3,
      }),
    ],
  },
  {
    id: 'sales_comparison',
    label: 'Sales Comparison',
    pageHint: 'Page 2',
    description: 'Comparable sale grid and summary of the sales comparison approach.',
    fields: [
      textField('sales_comp_active_listing_from', 'Current Listings From', 'workspace1004.salesComparison.currentListingFrom', {
        page: 2,
        group: 'Market Snapshot',
        width: 'quarter',
      }),
      textField('sales_comp_active_listing_to', 'Current Listings To', 'workspace1004.salesComparison.currentListingTo', {
        page: 2,
        group: 'Market Snapshot',
        width: 'quarter',
      }),
      textField('sales_comp_recent_sale_from', 'Recent Sales From', 'workspace1004.salesComparison.recentSaleFrom', {
        page: 2,
        group: 'Market Snapshot',
        width: 'quarter',
      }),
      textField('sales_comp_recent_sale_to', 'Recent Sales To', 'workspace1004.salesComparison.recentSaleTo', {
        page: 2,
        group: 'Market Snapshot',
        width: 'quarter',
      }),
      gridField(
        'sales_comp_grid',
        'Comparable Grid',
        'workspace1004.salesComparison.grid',
        [
          { key: 'feature', label: 'Feature', editable: false },
          { key: 'subject', label: 'Subject', editable: true },
          { key: 'comp1', label: 'Comp 1', editable: true },
          { key: 'comp2', label: 'Comp 2', editable: true },
          { key: 'comp3', label: 'Comp 3', editable: true },
        ],
        buildAdjustmentGridRows(),
        {
          page: 2,
          group: 'Comparable Grid',
          helperText: 'Use this as the internal editable comp grid. Candidate ranking and adjustment support layers can attach to these rows later.',
        },
      ),
      textareaField('sales_comp_summary', 'Summary of Sales Comparison Approach', 'workspace1004.salesComparison.summary', {
        suggestionPath: 'salesComparison.summary',
        page: 2,
        group: 'Narrative',
        rows: 5,
      }),
      textField('sales_comp_indicated_value', 'Indicated Value by Sales Comparison Approach', 'workspace1004.salesComparison.indicatedValue', {
        page: 2,
        group: 'Narrative',
        width: 'half',
      }),
      textField('sales_comp_net_adjustment_percent', 'Net Adjustment %', 'workspace1004.salesComparison.netAdjustmentPercent', {
        page: 2,
        group: 'Narrative',
        width: 'quarter',
      }),
      textField('sales_comp_gross_adjustment_percent', 'Gross Adjustment %', 'workspace1004.salesComparison.grossAdjustmentPercent', {
        page: 2,
        group: 'Narrative',
        width: 'quarter',
      }),
    ],
  },
  {
    id: 'prior_sales',
    label: 'Prior Sales',
    pageHint: 'Page 2',
    description: 'Research status, prior transfers, and analysis of subject/comp history.',
    fields: [
      selectField('prior_sales_researched', 'Researched Sale / Transfer History?', 'workspace1004.priorSales.researched', yesNoUnknown, {
        page: 2,
        group: 'Research Status',
        width: 'half',
      }),
      textareaField('prior_sales_not_researched_reason', 'If Not, Explain', 'workspace1004.priorSales.notResearchedReason', {
        page: 2,
        group: 'Research Status',
        rows: 3,
      }),
      selectField('prior_sales_subject_history_found', 'Subject Prior Sales Found (3 Years)?', 'workspace1004.priorSales.subjectHistoryFound', yesNoUnknown, {
        page: 2,
        group: 'Research Status',
        width: 'half',
      }),
      textField('prior_sales_subject_data_sources', 'Subject Data Source(s)', 'workspace1004.priorSales.subjectDataSources', {
        page: 2,
        group: 'Research Status',
        width: 'half',
      }),
      selectField('prior_sales_comp_history_found', 'Comparable Prior Sales Found (1 Year)?', 'workspace1004.priorSales.compHistoryFound', yesNoUnknown, {
        page: 2,
        group: 'Research Status',
        width: 'half',
      }),
      textField('prior_sales_comp_data_sources', 'Comparable Data Source(s)', 'workspace1004.priorSales.compDataSources', {
        page: 2,
        group: 'Research Status',
        width: 'half',
      }),
      gridField(
        'prior_sales_grid',
        'Prior Sale / Transfer Grid',
        'workspace1004.priorSales.grid',
        [
          { key: 'item', label: 'Item', editable: false },
          { key: 'subject', label: 'Subject', editable: true },
          { key: 'comp1', label: 'Comp 1', editable: true },
          { key: 'comp2', label: 'Comp 2', editable: true },
          { key: 'comp3', label: 'Comp 3', editable: true },
        ],
        buildPriorSaleGridRows(),
        {
          page: 2,
          group: 'Transfer History',
        },
      ),
      textareaField('prior_sales_analysis', 'Analysis of Prior Sale / Transfer History', 'workspace1004.priorSales.analysis', {
        page: 2,
        group: 'Transfer History',
        rows: 4,
      }),
    ],
  },
  {
    id: 'cost_approach',
    label: 'Cost Approach',
    pageHint: 'Page 3',
    description: 'Site value support, cost components, and depreciation commentary.',
    fields: [
      textareaField('cost_additional_comments', 'Additional Comments', 'workspace1004.costApproach.additionalComments', {
        page: 3,
        group: 'Narrative',
        rows: 3,
      }),
      textareaField('cost_site_value_support', 'Support for Opinion of Site Value', 'workspace1004.costApproach.siteValueSupport', {
        page: 3,
        group: 'Narrative',
        rows: 4,
      }),
      textField('cost_source_of_cost_data', 'Source of Cost Data', 'workspace1004.costApproach.sourceOfCostData', {
        page: 3,
        group: 'Cost Data',
        width: 'half',
      }),
      textField('cost_quality_rating', 'Quality Rating from Cost Service', 'workspace1004.costApproach.qualityRating', {
        page: 3,
        group: 'Cost Data',
        width: 'quarter',
      }),
      textField('cost_effective_date', 'Effective Date of Cost Data', 'workspace1004.costApproach.costDataEffectiveDate', {
        page: 3,
        group: 'Cost Data',
        width: 'quarter',
      }),
      textareaField('cost_comments', 'Comments on Cost Approach', 'workspace1004.costApproach.comments', {
        page: 3,
        group: 'Cost Data',
        rows: 3,
      }),
      textField('cost_remaining_economic_life', 'Estimated Remaining Economic Life', 'workspace1004.costApproach.remainingEconomicLifeYears', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_site_value', 'Opinion of Site Value', 'workspace1004.costApproach.siteValue', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_dwelling_cost', 'Dwelling Cost New', 'workspace1004.costApproach.dwellingCostNew', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_dwelling_square_feet', 'Dwelling Sq. Ft.', 'workspace1004.costApproach.dwellingSquareFeet', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_dwelling_rate', 'Dwelling Rate per Sq. Ft.', 'workspace1004.costApproach.dwellingRate', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_additional_line_square_feet', 'Additional Line Sq. Ft.', 'workspace1004.costApproach.additionalLineSquareFeet', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_additional_line_rate', 'Additional Line Rate', 'workspace1004.costApproach.additionalLineRate', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_additional_costs', 'Other Cost Components', 'workspace1004.costApproach.additionalCostComponents', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_garage_cost', 'Garage / Carport Cost', 'workspace1004.costApproach.garageCarportCost', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_garage_square_feet', 'Garage / Carport Sq. Ft.', 'workspace1004.costApproach.garageCarportSquareFeet', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_garage_rate', 'Garage / Carport Rate', 'workspace1004.costApproach.garageCarportRate', {
        page: 3,
        group: 'Cost Calculation',
        width: 'quarter',
      }),
      textField('cost_porches_patios', 'Porches / Patios / Decks', 'workspace1004.costApproach.porchesPatios', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_other_improvements', 'Other (describe)', 'workspace1004.costApproach.otherImprovements', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_total_cost_new', 'Total Estimate of Cost New', 'workspace1004.costApproach.totalCostNew', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_depreciation', 'Depreciation', 'workspace1004.costApproach.depreciation', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_depreciation_physical', 'Physical Depreciation', 'workspace1004.costApproach.physicalDepreciation', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_depreciation_functional', 'Functional Depreciation', 'workspace1004.costApproach.functionalDepreciation', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_depreciation_external', 'External Depreciation', 'workspace1004.costApproach.externalDepreciation', {
        page: 3,
        group: 'Cost Calculation',
        width: 'third',
      }),
      textField('cost_depreciated_improvements', 'Depreciated Cost of Improvements', 'workspace1004.costApproach.depreciatedCostOfImprovements', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_site_improvements', 'As-Is Value of Site Improvements', 'workspace1004.costApproach.siteImprovementsValue', {
        page: 3,
        group: 'Cost Calculation',
        width: 'half',
      }),
      textField('cost_indicated_value', 'Indicated Value by Cost Approach', 'workspace1004.costApproach.indicatedValue', {
        page: 3,
        group: 'Cost Calculation',
        width: 'full',
      }),
    ],
  },
  {
    id: 'income_approach',
    label: 'Income Approach',
    pageHint: 'Page 3',
    description: 'Market rent, GRM, and income summary support.',
    fields: [
      textField('income_market_rent', 'Estimated Monthly Market Rent', 'workspace1004.incomeApproach.estimatedMonthlyMarketRent', {
        page: 3,
        group: 'Income Inputs',
        width: 'third',
      }),
      textField('income_grm', 'Gross Rent Multiplier', 'workspace1004.incomeApproach.grossRentMultiplier', {
        page: 3,
        group: 'Income Inputs',
        width: 'third',
      }),
      textField('income_indicated_value', 'Indicated Value by Income Approach', 'workspace1004.incomeApproach.indicatedValue', {
        page: 3,
        group: 'Income Inputs',
        width: 'third',
      }),
      textField('income_rent_comp1_address', 'Rent Comp 1 Address', 'workspace1004.incomeApproach.rentComps.comp1.address', {
        page: 3,
        group: 'Rent Comparables',
        width: 'half',
      }),
      textField('income_rent_comp1_rent', 'Rent Comp 1 Rent', 'workspace1004.incomeApproach.rentComps.comp1.rent', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textField('income_rent_comp1_data_source', 'Rent Comp 1 Data Source', 'workspace1004.incomeApproach.rentComps.comp1.dataSource', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textField('income_rent_comp2_address', 'Rent Comp 2 Address', 'workspace1004.incomeApproach.rentComps.comp2.address', {
        page: 3,
        group: 'Rent Comparables',
        width: 'half',
      }),
      textField('income_rent_comp2_rent', 'Rent Comp 2 Rent', 'workspace1004.incomeApproach.rentComps.comp2.rent', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textField('income_rent_comp2_data_source', 'Rent Comp 2 Data Source', 'workspace1004.incomeApproach.rentComps.comp2.dataSource', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textField('income_rent_comp3_address', 'Rent Comp 3 Address', 'workspace1004.incomeApproach.rentComps.comp3.address', {
        page: 3,
        group: 'Rent Comparables',
        width: 'half',
      }),
      textField('income_rent_comp3_rent', 'Rent Comp 3 Rent', 'workspace1004.incomeApproach.rentComps.comp3.rent', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textField('income_rent_comp3_data_source', 'Rent Comp 3 Data Source', 'workspace1004.incomeApproach.rentComps.comp3.dataSource', {
        page: 3,
        group: 'Rent Comparables',
        width: 'quarter',
      }),
      textareaField('income_summary', 'Summary of Income Approach', 'workspace1004.incomeApproach.summary', {
        page: 3,
        group: 'Narrative',
        rows: 4,
      }),
      selectField('income_pud_developer_control', "PUD: Developer / Builder Controls HOA?", 'workspace1004.incomeApproach.pud.developerControlsHoa', yesNoUnknown, {
        page: 3,
        group: 'PUD Information',
        width: 'half',
      }),
      selectField('income_pud_unit_type', 'PUD: Unit Type', 'workspace1004.incomeApproach.pud.unitType', pudUnitTypeChoices, {
        page: 3,
        group: 'PUD Information',
        width: 'half',
      }),
      textField('income_pud_project_name', 'PUD: Legal Name of Project', 'workspace1004.incomeApproach.pud.projectName', {
        page: 3,
        group: 'PUD Information',
        width: 'full',
      }),
      textField('income_pud_total_phases', 'PUD: Total Number of Phases', 'workspace1004.incomeApproach.pud.totalPhases', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_total_units', 'PUD: Total Number of Units', 'workspace1004.incomeApproach.pud.totalUnits', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_units_sold', 'PUD: Units Sold', 'workspace1004.incomeApproach.pud.unitsSold', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_units_rented', 'PUD: Units Rented', 'workspace1004.incomeApproach.pud.unitsRented', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_units_for_sale', 'PUD: Units for Sale', 'workspace1004.incomeApproach.pud.unitsForSale', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_data_sources', 'PUD: Data Source(s)', 'workspace1004.incomeApproach.pud.dataSources', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      selectField('income_pud_project_conversion', 'PUD: Created by Conversion?', 'workspace1004.incomeApproach.pud.createdByConversion', yesNoUnknown, {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_conversion_date', 'PUD: Date of Conversion', 'workspace1004.incomeApproach.pud.conversionDate', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      selectField('income_pud_multi_dwelling_units', 'PUD: Multi-Dwelling Units?', 'workspace1004.incomeApproach.pud.multiDwellingUnits', yesNoUnknown, {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      textField('income_pud_multi_dwelling_data_sources', 'PUD: Multi-Dwelling Data Source(s)', 'workspace1004.incomeApproach.pud.multiDwellingDataSources', {
        page: 3,
        group: 'PUD Information',
        width: 'quarter',
      }),
      selectField('income_pud_common_elements_complete', 'PUD: Units/Common Elements/Recreation Complete?', 'workspace1004.incomeApproach.pud.commonElementsComplete', yesNoUnknown, {
        page: 3,
        group: 'PUD Information',
        width: 'half',
      }),
      textareaField('income_pud_completion_status', 'PUD: If No, Describe Completion Status', 'workspace1004.incomeApproach.pud.completionStatus', {
        page: 3,
        group: 'PUD Information',
        rows: 3,
      }),
      selectField('income_pud_common_elements_leased', 'PUD: Common Elements Leased?', 'workspace1004.incomeApproach.pud.commonElementsLeased', yesNoUnknown, {
        page: 3,
        group: 'PUD Information',
        width: 'half',
      }),
      textareaField('income_pud_rental_terms', 'PUD: Rental Terms and Options', 'workspace1004.incomeApproach.pud.rentalTerms', {
        page: 3,
        group: 'PUD Information',
        rows: 3,
      }),
      textareaField('income_pud_common_elements_description', 'PUD: Common Elements and Recreational Facilities', 'workspace1004.incomeApproach.pud.commonElementsDescription', {
        page: 3,
        group: 'PUD Information',
        rows: 3,
      }),
    ],
  },
  {
    id: 'reconciliation',
    label: 'Reconciliation',
    pageHint: 'Page 2',
    description: 'Approach indications, hypothetical conditions, and final reconciliation.',
    fields: [
      textField('reconciliation_sales_value', 'Indicated Value by Sales Comparison', 'workspace1004.reconciliation.salesComparisonValue', {
        page: 2,
        group: 'Value Indications',
        width: 'third',
      }),
      textField('reconciliation_cost_value', 'Indicated Value by Cost Approach', 'workspace1004.reconciliation.costApproachValue', {
        page: 2,
        group: 'Value Indications',
        width: 'third',
      }),
      textField('reconciliation_income_value', 'Indicated Value by Income Approach', 'workspace1004.reconciliation.incomeApproachValue', {
        page: 2,
        group: 'Value Indications',
        width: 'third',
      }),
      selectField('reconciliation_report_condition', 'Report Condition Type', 'workspace1004.reconciliation.reportConditionType', reportConditionChoices, {
        page: 2,
        group: 'Conditions',
        width: 'half',
      }),
      textareaField('reconciliation_conditions', 'As-Is / Hypothetical Condition / Repair Condition Statement', 'workspace1004.reconciliation.conditionStatement', {
        page: 2,
        group: 'Conditions',
        rows: 4,
      }),
      textField('reconciliation_market_value', 'Opinion of Market Value', 'workspace1004.reconciliation.marketValueOpinion', {
        page: 2,
        group: 'Final Opinion',
        width: 'half',
      }),
      textField('reconciliation_effective_date', 'Date of Inspection / Effective Date', 'workspace1004.reconciliation.effectiveDate', {
        page: 2,
        group: 'Final Opinion',
        width: 'half',
      }),
      textareaField('reconciliation_narrative', 'Reconciliation Narrative', 'workspace1004.reconciliation.narrative', {
        suggestionPath: 'reconciliation.commentary',
        page: 2,
        group: 'Final Opinion',
        rows: 5,
      }),
    ],
  },
  {
    id: 'uspap_addendum',
    label: 'USPAP Addendum',
    pageHint: 'USPAP addendum + certifications',
    description: 'USPAP reporting option, prior services, and locked standard certification blocks.',
    lockedTextBlocks: [
      {
        title: 'Locked Standard Scope / Assumptions / Limiting Conditions',
        body: 'The standard 1004 scope of work, assumptions, limiting conditions, appraiser certification, and supervisory appraiser certification are locked to the canonical form structure.',
      },
    ],
    fields: [
      textField('uspap_borrower', 'Borrower', 'workspace1004.uspap.borrower', {
        page: 11,
        group: 'Header',
        width: 'half',
      }),
      textField('uspap_property_address', 'Property Address', 'workspace1004.uspap.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 11,
        group: 'Header',
        width: 'half',
      }),
      textField('uspap_city', 'City', 'workspace1004.uspap.city', {
        suggestionPath: 'subject.city',
        syncPaths: ['subject.city'],
        page: 11,
        group: 'Header',
        width: 'quarter',
      }),
      textField('uspap_county', 'County', 'workspace1004.uspap.county', {
        suggestionPath: 'subject.county',
        syncPaths: ['subject.county'],
        page: 11,
        group: 'Header',
        width: 'quarter',
      }),
      textField('uspap_state', 'State', 'workspace1004.uspap.state', {
        suggestionPath: 'subject.state',
        syncPaths: ['subject.state'],
        page: 11,
        group: 'Header',
        width: 'quarter',
      }),
      textField('uspap_zip', 'Zip Code', 'workspace1004.uspap.zip', {
        suggestionPath: 'subject.zip',
        syncPaths: ['subject.zip'],
        page: 11,
        group: 'Header',
        width: 'quarter',
      }),
      textField('uspap_lender', 'Lender', 'workspace1004.uspap.lender', {
        page: 11,
        group: 'Header',
        width: 'full',
      }),
      selectField('uspap_reporting_option', 'USPAP Reporting Option', 'workspace1004.uspap.reportingOption', reportOptionChoices, {
        page: 11,
        group: 'Reporting Option',
        width: 'half',
      }),
      textField('uspap_reasonable_exposure_time', 'Reasonable Exposure Time', 'workspace1004.uspap.reasonableExposureTime', {
        suggestionPath: 'market.exposureTime',
        syncPaths: ['market.exposureTime'],
        page: 11,
        group: 'Reporting Option',
        width: 'half',
      }),
      selectField('uspap_prior_services_performed', 'Prior Services Performed in Prior Three Years?', 'workspace1004.uspap.priorServicesPerformed', yesNoUnknown, {
        page: 11,
        group: 'Prior Services',
        width: 'half',
      }),
      textareaField('uspap_prior_services_comment', 'Prior Services Description', 'workspace1004.uspap.priorServicesComment', {
        page: 11,
        group: 'Prior Services',
        rows: 3,
      }),
      textareaField('uspap_additional_certifications', 'Additional Certifications', 'workspace1004.uspap.additionalCertifications', {
        page: 11,
        group: 'Addendum',
        rows: 3,
      }),
      textareaField('uspap_additional_comments', 'Additional Comments', 'workspace1004.uspap.additionalComments', {
        page: 11,
        group: 'Addendum',
        rows: 4,
      }),
      textField('uspap_cert_property_address', 'Certification: Address of Property Appraised', 'workspace1004.uspap.certification.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 8,
        group: 'Certification Page',
        width: 'half',
      }),
      textField('uspap_cert_appraised_value', 'Certification: Appraised Value of Subject Property', 'workspace1004.uspap.certification.appraisedValue', {
        page: 8,
        group: 'Certification Page',
        width: 'half',
      }),
      textField('uspap_cert_lender_client_name', 'Certification: Lender / Client Name', 'workspace1004.uspap.certification.lenderClientName', {
        page: 8,
        group: 'Certification Page',
        width: 'third',
      }),
      textField('uspap_cert_lender_client_company', 'Certification: Lender / Client Company Name', 'workspace1004.uspap.certification.lenderClientCompanyName', {
        page: 8,
        group: 'Certification Page',
        width: 'third',
      }),
      textField('uspap_cert_lender_client_email', 'Certification: Lender / Client Email', 'workspace1004.uspap.certification.lenderClientEmail', {
        page: 8,
        group: 'Certification Page',
        width: 'third',
      }),
      textField('uspap_cert_lender_client_address', 'Certification: Lender / Client Company Address', 'workspace1004.uspap.certification.lenderClientCompanyAddress', {
        page: 8,
        group: 'Certification Page',
        width: 'full',
      }),
      textField('uspap_appraiser_name', 'Appraiser Name', 'workspace1004.uspap.appraiser.name', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_company_name', 'Appraiser Company Name', 'workspace1004.uspap.appraiser.companyName', {
        page: 8,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_company_address', 'Appraiser Company Address', 'workspace1004.uspap.appraiser.companyAddress', {
        page: 8,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_telephone', 'Appraiser Telephone Number', 'workspace1004.uspap.appraiser.telephoneNumber', {
        page: 8,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_email', 'Appraiser Email Address', 'workspace1004.uspap.appraiser.emailAddress', {
        page: 8,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_report_date', 'Date of Signature and Report', 'workspace1004.uspap.appraiser.dateOfSignatureAndReport', {
        page: 8,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_date_signed', 'Appraiser Date Signed', 'workspace1004.uspap.appraiser.dateSigned', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_state_certification', 'Appraiser State Certification #', 'workspace1004.uspap.appraiser.stateCertificationNumber', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_state_license', 'Appraiser State License #', 'workspace1004.uspap.appraiser.stateLicenseNumber', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_other_description', 'Appraiser Other (Describe)', 'workspace1004.uspap.appraiser.otherDescription', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_state_number', 'Appraiser State #', 'workspace1004.uspap.appraiser.stateNumber', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_state', 'Appraiser State', 'workspace1004.uspap.appraiser.state', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_expiration_date', 'Appraiser Expiration Date', 'workspace1004.uspap.appraiser.expirationDate', {
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_appraiser_effective_date', 'Effective Date of Appraisal', 'workspace1004.uspap.appraiser.effectiveDateOfAppraisal', {
        suggestionPath: 'assignment.effectiveDate',
        syncPaths: ['assignment.effectiveDate'],
        page: 11,
        group: 'Appraiser Signature',
        width: 'third',
      }),
      textField('uspap_supervisory_name', 'Supervisory Appraiser Name', 'workspace1004.uspap.supervisoryAppraiser.name', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_company_name', 'Supervisory Company Name', 'workspace1004.uspap.supervisoryAppraiser.companyName', {
        page: 8,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_company_address', 'Supervisory Company Address', 'workspace1004.uspap.supervisoryAppraiser.companyAddress', {
        page: 8,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_telephone', 'Supervisory Telephone Number', 'workspace1004.uspap.supervisoryAppraiser.telephoneNumber', {
        page: 8,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_email', 'Supervisory Email Address', 'workspace1004.uspap.supervisoryAppraiser.emailAddress', {
        page: 8,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_date_signed', 'Supervisory Date Signed', 'workspace1004.uspap.supervisoryAppraiser.dateSigned', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_state_certification', 'Supervisory State Certification #', 'workspace1004.uspap.supervisoryAppraiser.stateCertificationNumber', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_state_license', 'Supervisory State License #', 'workspace1004.uspap.supervisoryAppraiser.stateLicenseNumber', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_state', 'Supervisory State', 'workspace1004.uspap.supervisoryAppraiser.state', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      textField('uspap_supervisory_expiration_date', 'Supervisory Expiration Date', 'workspace1004.uspap.supervisoryAppraiser.expirationDate', {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'third',
      }),
      selectField('uspap_supervisory_inspection_level', 'Supervisory Inspection of Subject Property', 'workspace1004.uspap.supervisoryAppraiser.inspectionLevel', inspectionLevelChoices, {
        page: 11,
        group: 'Supervisory Appraiser',
        width: 'half',
      }),
      selectField('uspap_subject_inspection_level', 'Subject Property Inspection', 'workspace1004.uspap.certification.subjectInspectionLevel', inspectionLevelChoices, {
        page: 8,
        group: 'Inspection',
        width: 'half',
      }),
      textField('uspap_subject_inspection_date', 'Subject Property Inspection Date', 'workspace1004.uspap.certification.subjectInspectionDate', {
        page: 8,
        group: 'Inspection',
        width: 'half',
      }),
      selectField('uspap_comp_inspection_level', 'Comparable Sales Inspection', 'workspace1004.uspap.certification.comparableInspectionLevel', inspectionLevelChoices, {
        page: 8,
        group: 'Inspection',
        width: 'half',
      }),
      textField('uspap_comp_inspection_date', 'Comparable Sales Inspection Date', 'workspace1004.uspap.certification.comparableInspectionDate', {
        page: 8,
        group: 'Inspection',
        width: 'half',
      }),
    ],
  },
  {
    id: 'dimension_addendum',
    label: 'Dimension Addendum',
    pageHint: 'Dimension list addendum',
    description: 'GLA / GBA measurement worksheet with editable line items.',
    fields: [
      textField('dimension_borrower', 'Borrower', 'workspace1004.dimensionAddendum.borrower', {
        page: 12,
        group: 'Header',
        width: 'half',
      }),
      textField('dimension_file_number', 'File No.', 'workspace1004.dimensionAddendum.fileNumber', {
        page: 12,
        group: 'Header',
        width: 'half',
      }),
      textField('dimension_property_address', 'Property Address', 'workspace1004.dimensionAddendum.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 12,
        group: 'Header',
        width: 'half',
      }),
      textField('dimension_case_number', 'Case No.', 'workspace1004.dimensionAddendum.caseNumber', {
        page: 12,
        group: 'Header',
        width: 'half',
      }),
      textField('dimension_city', 'City', 'workspace1004.dimensionAddendum.city', {
        suggestionPath: 'subject.city',
        syncPaths: ['subject.city'],
        page: 12,
        group: 'Header',
        width: 'quarter',
      }),
      textField('dimension_state', 'State', 'workspace1004.dimensionAddendum.state', {
        suggestionPath: 'subject.state',
        syncPaths: ['subject.state'],
        page: 12,
        group: 'Header',
        width: 'quarter',
      }),
      textField('dimension_zip', 'Zip', 'workspace1004.dimensionAddendum.zip', {
        suggestionPath: 'subject.zip',
        syncPaths: ['subject.zip'],
        page: 12,
        group: 'Header',
        width: 'quarter',
      }),
      textField('dimension_lender', 'Lender', 'workspace1004.dimensionAddendum.lender', {
        page: 12,
        group: 'Header',
        width: 'quarter',
      }),
      gridField(
        'dimension_area_summary',
        'GBA / GLA Area Summary',
        'workspace1004.dimensionAddendum.areaSummary',
        [
          { key: 'areaLabel', label: 'Area(s)', editable: false },
          { key: 'area', label: 'Area', editable: true },
          { key: 'glaPercent', label: '% of GLA', editable: true },
          { key: 'gbaPercent', label: '% of GBA', editable: true },
        ],
        dimensionAreaSummaryRows,
        {
          page: 12,
          group: 'Area Summary',
        },
      ),
      gridField(
        'dimension_measurements',
        'Dimension Measurement Worksheet',
        'workspace1004.dimensionAddendum.measurements',
        [
          { key: 'area', label: 'Area(s)', editable: true },
          { key: 'areaType', label: 'Area Type', editable: true },
          { key: 'measurements', label: 'Measurements', editable: true },
          { key: 'factor', label: 'Factor', editable: true },
          { key: 'total', label: 'Total', editable: true },
          { key: 'level1', label: 'Level 1', editable: true },
          { key: 'level2', label: 'Level 2', editable: true },
          { key: 'level3', label: 'Level 3', editable: true },
          { key: 'other', label: 'Other', editable: true },
          { key: 'basement', label: 'Bsmt.', editable: true },
          { key: 'garage', label: 'Garage', editable: true },
        ],
        measurementRows,
        {
          page: 12,
          group: 'Measurements',
          helperText: 'Use this addendum for the manual dimension list and GLA/GBA breakout.',
        },
      ),
      textareaField('dimension_sketch_notes', 'Measurement Notes', 'workspace1004.dimensionAddendum.notes', {
        page: 12,
        group: 'Measurements',
        rows: 3,
      }),
    ],
  },
  {
    id: 'photo_addendum',
    label: 'Photo Addendum',
    pageHint: 'Subject property photo addendum',
    description: 'Subject photo slots, captions, and photo notes.',
    fields: [
      textField('photo_borrower', 'Borrower', 'workspace1004.photoAddendum.borrower', {
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_file_number', 'File No.', 'workspace1004.photoAddendum.fileNumber', {
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_property_address', 'Property Address', 'workspace1004.photoAddendum.propertyAddress', {
        suggestionPath: 'subject.address',
        syncPaths: ['subject.address'],
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_case_number', 'Case No.', 'workspace1004.photoAddendum.caseNumber', {
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_city', 'City', 'workspace1004.photoAddendum.city', {
        suggestionPath: 'subject.city',
        syncPaths: ['subject.city'],
        page: 14,
        group: 'Header',
        width: 'quarter',
      }),
      textField('photo_state', 'State', 'workspace1004.photoAddendum.state', {
        suggestionPath: 'subject.state',
        syncPaths: ['subject.state'],
        page: 14,
        group: 'Header',
        width: 'quarter',
      }),
      textField('photo_zip', 'Zip', 'workspace1004.photoAddendum.zip', {
        suggestionPath: 'subject.zip',
        syncPaths: ['subject.zip'],
        page: 14,
        group: 'Header',
        width: 'quarter',
      }),
      textField('photo_lender', 'Lender', 'workspace1004.photoAddendum.lender', {
        page: 14,
        group: 'Header',
        width: 'quarter',
      }),
      textField('photo_appraised_date', 'Appraised Date', 'workspace1004.photoAddendum.appraisedDate', {
        suggestionPath: 'assignment.effectiveDate',
        syncPaths: ['assignment.effectiveDate'],
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_appraised_value', 'Appraised Value', 'workspace1004.photoAddendum.appraisedValue', {
        page: 14,
        group: 'Header',
        width: 'half',
      }),
      textField('photo_front_caption', 'Front View Caption', 'workspace1004.photoAddendum.frontCaption', {
        page: 14,
        group: 'Photos',
        width: 'third',
      }),
      textField('photo_rear_caption', 'Rear View Caption', 'workspace1004.photoAddendum.rearCaption', {
        page: 14,
        group: 'Photos',
        width: 'third',
      }),
      textField('photo_street_caption', 'Street Scene Caption', 'workspace1004.photoAddendum.streetCaption', {
        page: 14,
        group: 'Photos',
        width: 'third',
      }),
      textareaField('photo_notes', 'Photo Addendum Notes', 'workspace1004.photoAddendum.notes', {
        page: 14,
        group: 'Photos',
        rows: 3,
      }),
    ],
  },
  {
    id: 'qc_review',
    label: 'QC Review',
    pageHint: 'Workspace QA',
    description: 'Case record QA summary, contradiction review, and appraiser sign-off notes.',
    fields: [
      textareaField('qc_review_notes', 'QC Review Notes', 'workspace1004.qcReview.notes', {
        page: null,
        group: 'Review',
        rows: 4,
      }),
      textareaField('qc_resolution_notes', 'Issue Resolution Notes', 'workspace1004.qcReview.resolutionNotes', {
        page: null,
        group: 'Review',
        rows: 4,
      }),
    ],
  },
];

const fieldIndex = {};
for (const section of sections) {
  for (const field of section.fields) {
    field.sectionId = section.id;
    field.sectionLabel = section.label;
    fieldIndex[field.fieldId] = field;
  }
}

export const workspace1004Definition = {
  formType: '1004',
  version: '2026-03-12',
  title: 'CACC 1004 Workspace',
  primaryInterface: true,
  canonicalPdf: {
    fileName: 'cacc-writer 1004 report.PDF',
    pageCount: 14,
    extractedAt: '2026-03-12',
  },
  sections,
  fieldIndex,
};

export function get1004WorkspaceDefinition() {
  return workspace1004Definition;
}
