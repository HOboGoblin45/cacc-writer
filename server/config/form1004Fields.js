/**
 * server/config/form1004Fields.js
 * --------------------------------
 * Complete 1004 URAR form field definitions.
 * Every checkbox, data field, calculated value, and grid on the form.
 *
 * Field types:
 *   text       — free text input
 *   number     — numeric value
 *   currency   — dollar amount
 *   percent    — percentage value
 *   date       — date field
 *   select     — single-choice dropdown (options array)
 *   yesno      — yes/no radio
 *   multicheck — multiple checkboxes (options array)
 *   textarea   — multi-line text
 *   calculated — auto-computed from other fields (read-only)
 */

export const FORM_1004_FIELDS = {

  // ── SUBJECT PROPERTY ─────────────────────────────────────────────────────
  subject: {
    propertyAddress:         { type: 'text',     label: 'Property Address',                required: true },
    city:                    { type: 'text',     label: 'City',                            required: true },
    state:                   { type: 'text',     label: 'State',                           required: true },
    zipCode:                 { type: 'text',     label: 'Zip Code',                        required: true },
    county:                  { type: 'text',     label: 'County',                          required: true },
    legalDescription:        { type: 'text',     label: 'Legal Description' },
    assessorsParcelNumber:   { type: 'text',     label: "Assessor's Parcel #" },
    taxYear:                 { type: 'text',     label: 'Tax Year' },
    realEstateTaxes:         { type: 'currency', label: 'R.E. Taxes $' },
    specialAssessments:      { type: 'currency', label: 'Special Assessments $' },
    borrowerName:            { type: 'text',     label: 'Borrower',                        required: true },
    ownerOfPublicRecord:     { type: 'text',     label: 'Owner of Public Record' },
    occupant:                { type: 'select',   label: 'Occupant',                        options: ['Owner', 'Tenant', 'Vacant'] },
    propertyRightsAppraised: { type: 'select',   label: 'Property Rights Appraised',       options: ['Fee Simple', 'Leasehold', 'Other'] },
    propertyRightsOther:     { type: 'text',     label: 'Property Rights Other (specify)' },
    assignmentType:          { type: 'select',   label: 'Assignment Type',                 options: ['Purchase Transaction', 'Refinance Transaction', 'Other'] },
    assignmentTypeOther:     { type: 'text',     label: 'Assignment Type Other (specify)' },
    lenderClient:            { type: 'text',     label: 'Lender/Client' },
    lenderAddress:           { type: 'text',     label: 'Lender/Client Address' },
    appraisalFileNumber:     { type: 'text',     label: 'Appraisal File #' },
  },

  // ── CONTRACT ─────────────────────────────────────────────────────────────
  contract: {
    isPropertyForSale:               { type: 'yesno',    label: 'Is the subject property currently offered for sale or has it been offered for sale in the twelve months prior to the effective date?' },
    listingPrice:                    { type: 'currency', label: 'Listing Price $' },
    listingDate:                     { type: 'date',     label: 'Date Listed' },
    isSubjectUnderContract:          { type: 'yesno',    label: 'Is the subject property currently under contract for sale?' },
    contractPrice:                   { type: 'currency', label: 'Contract Price $' },
    contractDate:                    { type: 'date',     label: 'Date of Contract' },
    isPropertySellerOwnerOfRecord:   { type: 'yesno',    label: 'Is the property seller the owner of public record?' },
    sellerConcessions:               { type: 'text',     label: 'Seller Concessions (describe)' },
    dataSource:                      { type: 'text',     label: 'Data Source(s)' },
    personalProperty:                { type: 'text',     label: 'Personal Property Included in Sale $' },
  },

  // ── NEIGHBORHOOD ─────────────────────────────────────────────────────────
  neighborhood: {
    // Market Conditions checkboxes
    builtUp:               { type: 'select',   label: 'Built-Up',        options: ['Over 75%', '25-75%', 'Under 25%'] },
    growth:                { type: 'select',   label: 'Growth',          options: ['Rapid', 'Stable', 'Slow'] },
    propertyValues:        { type: 'select',   label: 'Property Values', options: ['Increasing', 'Stable', 'Declining'] },
    demandSupply:          { type: 'select',   label: 'Demand/Supply',   options: ['Shortage', 'In Balance', 'Over Supply'] },
    marketingTime:         { type: 'select',   label: 'Marketing Time',  options: ['Under 3 Months', '3-6 Months', 'Over 6 Months'] },

    // Predominant occupancy
    predominantOccupancy:  { type: 'select',   label: 'Predominant Occupancy', options: ['Owner', 'Tenant', 'Vacant (0-5%)', 'Vacant (>5%)'] },

    // Single family housing price/age
    singleFamilyPriceRange_Low:    { type: 'currency', label: 'Single Family Price Range Low $' },
    singleFamilyPriceRange_High:   { type: 'currency', label: 'Single Family Price Range High $' },
    singleFamilyPredominant:       { type: 'currency', label: 'Single Family Predominant Price $' },
    singleFamilyAgeRange_Low:      { type: 'number',   label: 'Single Family Age Range Low (yrs)' },
    singleFamilyAgeRange_High:     { type: 'number',   label: 'Single Family Age Range High (yrs)' },
    singleFamilyPredominantAge:    { type: 'number',   label: 'Single Family Predominant Age (yrs)' },

    // Land use percentages
    landUseOneFamily:    { type: 'percent', label: '1-Family %' },
    landUseTwoToFour:    { type: 'percent', label: '2-4 Family %' },
    landUseMultiFamily:  { type: 'percent', label: 'Multi-Family %' },
    landUseCommercial:   { type: 'percent', label: 'Commercial %' },
    landUseOther:        { type: 'percent', label: 'Other %' },
    changeInLandUse:     { type: 'select',  label: 'Present Land Use Change', options: ['Not Likely', 'Likely', 'In Process'] },
    changeInLandUseTo:   { type: 'text',    label: 'Land Use Likely to Change To' },

    // Neighborhood description
    neighborhoodBoundaries:  { type: 'text',     label: 'Neighborhood Boundaries' },
    neighborhoodDescription: { type: 'textarea', label: 'Neighborhood Description' },
    marketConditions:        { type: 'textarea', label: 'Market Conditions (including support for above conclusions)' },
  },

  // ── SITE ─────────────────────────────────────────────────────────────────
  site: {
    lotDimensions:                  { type: 'text',     label: 'Dimensions' },
    lotArea:                        { type: 'text',     label: 'Area' },
    shape:                          { type: 'text',     label: 'Shape' },
    view:                           { type: 'text',     label: 'View' },
    specificLocationDescription:    { type: 'text',     label: 'Specific Zoning Classification' },
    zoningClassification:           { type: 'text',     label: 'Zoning Classification' },
    zoningDescription:              { type: 'text',     label: 'Zoning Description' },
    zoningCompliance:               { type: 'select',   label: 'Zoning Compliance', options: ['Legal', 'Legal Nonconforming', 'No Zoning', 'Illegal'] },
    isZoningComplianceIllegalDescribe: { type: 'text',  label: 'Zoning Compliance Illegal (describe)' },
    highestAndBestUseVacant:        { type: 'select',   label: 'Highest & Best Use — If vacant', options: ['Present use', 'Other'] },
    highestAndBestUseAsImproved:    { type: 'select',   label: 'Highest & Best Use — As improved', options: ['Present use', 'Other'] },
    highestAndBestUseOther:         { type: 'text',     label: 'H&BU Other (describe)' },

    // Utilities
    utilities_electric:    { type: 'select', label: 'Electric',        options: ['Public', 'Other'] },
    utilities_gas:         { type: 'select', label: 'Gas',             options: ['Public', 'Other', 'None'] },
    utilities_water:       { type: 'select', label: 'Water',           options: ['Public', 'Private'] },
    utilities_sewer:       { type: 'select', label: 'Sanitary Sewer',  options: ['Public', 'Private'] },

    // Off-site improvements
    offSiteImprovements_street:   { type: 'select', label: 'Street Type',    options: ['Public', 'Private'] },
    offSiteImprovements_surface:  { type: 'text',   label: 'Street Surface' },
    offSiteImprovements_alley:    { type: 'select', label: 'Alley',          options: ['Public', 'Private', 'None'] },

    // FEMA flood info
    isInFloodHazardArea:  { type: 'yesno', label: 'Is subject in a FEMA Special Flood Hazard Area?' },
    femaFloodZone:        { type: 'text',  label: 'FEMA Flood Zone' },
    femaMapNumber:        { type: 'text',  label: 'FEMA Map #' },
    femaMapDate:          { type: 'date',  label: 'FEMA Map Date' },

    // PUD / HOA
    isPUD:          { type: 'yesno',    label: 'Is subject in a PUD?' },
    isHOA:          { type: 'yesno',    label: 'Does the subject have an HOA?' },
    hoaDues:        { type: 'currency', label: 'HOA Dues $/Month' },

    // Site comments
    siteComments:   { type: 'textarea', label: 'Site Comments' },

    // Adverse conditions
    hasAdverseEasements:      { type: 'yesno', label: 'Adverse Easements?' },
    hasAdverseEncroachments:  { type: 'yesno', label: 'Adverse Encroachments?' },
    hasAdverseConditions:     { type: 'yesno', label: 'Adverse Environmental Conditions?' },
    adverseConditionsDescribe:{ type: 'text',  label: 'Adverse Conditions (describe)' },
  },

  // ── IMPROVEMENTS ─────────────────────────────────────────────────────────
  improvements: {
    // General Description
    generalDescription_units:            { type: 'select', label: 'Units', options: ['One', 'One with Accessory Unit', 'Det.', 'Att.', 'S-Det/End Unit'] },
    generalDescription_stories:          { type: 'number', label: '# of Stories' },
    generalDescription_type:             { type: 'text',   label: 'Type (Det./Att./S-Det)' },
    generalDescription_design:           { type: 'text',   label: 'Design (Style)' },
    generalDescription_existingProposed: { type: 'select', label: 'Existing/Proposed/Under Construction', options: ['Existing', 'Proposed', 'Under Construction'] },
    yearBuilt:                           { type: 'number', label: 'Year Built',    required: true },
    effectiveAge:                        { type: 'number', label: 'Effective Age (Yrs)' },

    // Foundation
    foundationType:            { type: 'multicheck', label: 'Foundation', options: ['Concrete Slab', 'Crawl Space', 'Full Basement', 'Partial Basement'] },
    foundationOutsideEntry:    { type: 'yesno',      label: 'Outside Entry/Exit?' },
    foundationSumpPump:        { type: 'yesno',      label: 'Sump Pump?' },
    foundationEvidenceDampness:{ type: 'yesno',      label: 'Evidence of Dampness/Settlement/Infestation?' },
    foundationSettlement:      { type: 'yesno',      label: 'Evidence of Settlement?' },
    foundationInfestation:     { type: 'yesno',      label: 'Evidence of Infestation?' },

    // Basement
    basementArea:              { type: 'number',  label: 'Basement Area sq.ft.' },
    basementFinishPercent:     { type: 'percent', label: '% Finished' },
    basementCeilingHeight:     { type: 'text',    label: 'Ceiling Height' },

    // Exterior
    exteriorWalls:             { type: 'text', label: 'Exterior Walls' },
    roofSurface:               { type: 'text', label: 'Roof Surface' },
    guttersDownspouts:         { type: 'text', label: 'Gutters & Downspouts' },
    windowType:                { type: 'text', label: 'Window Type' },
    stormSashInsulatedGlass:   { type: 'text', label: 'Storm Sash/Insulated Glass' },
    screens:                   { type: 'text', label: 'Screens' },
    manufacturedHousing:       { type: 'yesno', label: 'Manufactured Home?' },

    // Interior
    floors:                    { type: 'text', label: 'Floors' },
    walls:                     { type: 'text', label: 'Walls' },
    trimFinish:                { type: 'text', label: 'Trim/Finish' },
    bathFloor:                 { type: 'text', label: 'Bath Floor' },
    bathWainscot:              { type: 'text', label: 'Bath Wainscot' },

    // Mechanical
    heating_type:              { type: 'text', label: 'Heating Type' },
    heating_fuel:              { type: 'text', label: 'Heating Fuel' },
    cooling_type:              { type: 'text', label: 'Cooling Type (Central/Other)' },

    // Room count / GLA
    roomCount:                 { type: 'number', label: 'Total # Rooms' },
    bedroomCount:              { type: 'number', label: 'Bedrooms' },
    bathroomCount:             { type: 'number', label: 'Bathroom(s)' },
    grossLivingArea:           { type: 'number', label: 'Total Sq.Ft. of Gross Living Area', required: true },

    // Attic
    attic:                     { type: 'multicheck', label: 'Attic', options: ['None', 'Stairs', 'Drop Stair', 'Scuttle', 'Floor', 'Heated', 'Finished'] },

    // Amenities
    amenities_woodstoveCount:  { type: 'number', label: 'Woodstove(s) #' },
    amenities_fireplace:       { type: 'text',   label: 'Fireplace(s) #' },
    amenities_patioDeck:       { type: 'text',   label: 'Patio/Deck' },
    amenities_pool:            { type: 'text',   label: 'Pool' },
    amenities_fence:           { type: 'text',   label: 'Fence' },
    amenities_porch:           { type: 'text',   label: 'Porch' },
    amenities_other:           { type: 'text',   label: 'Other Amenities' },

    // Car Storage
    carStorage:                { type: 'multicheck', label: 'Car Storage', options: ['None', 'Garage', 'Carport', 'Driveway', 'Att.', 'Det.', 'Built-in'] },
    carStorageCount:           { type: 'number',     label: '# of Cars' },
    carStorageFinished:        { type: 'yesno',      label: 'Garage Finished?' },
    carStorageHeated:          { type: 'yesno',      label: 'Garage Heated?' },

    // Appliances
    appliances:                { type: 'multicheck', label: 'Appliances', options: ['Refrigerator', 'Range/Oven', 'Dishwasher', 'Disposal', 'Microwave', 'Washer/Dryer'] },
    flooringTypes:             { type: 'text',       label: 'Finished Area Above Grade Flooring' },

    // Condition ratings
    conditionOverall:          { type: 'select', label: 'Condition (C1–C6)', options: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] },
    qualityOverall:            { type: 'select', label: 'Quality (Q1–Q6)',   options: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'] },

    // Physical deficiencies
    hasPhysicalDeficiencies:   { type: 'yesno', label: 'Are there physical deficiencies or adverse conditions that affect the livability, soundness, or structural integrity of the property?' },
    physicalDeficienciesDescribe: { type: 'textarea', label: 'Physical Deficiencies (describe)' },

    // Functional utility
    doesConformToNeighborhood: { type: 'yesno',    label: 'Does the property generally conform to the neighborhood (functional utility, style, condition, use, construction, etc.)?' },
    doesNotConformDescribe:    { type: 'textarea', label: 'Non-Conformity (describe)' },

    // Additional comments
    improvementsComments:      { type: 'textarea', label: 'Additional Improvements Comments' },
  },

  // ── SALES COMPARISON APPROACH ────────────────────────────────────────────
  // Stored as salesComparison.comps[0..5] — each comp uses this template
  salesComparison: {
    // Narrative fields
    salesComparisonAnalysis:     { type: 'textarea', label: 'Summary of Sales Comparison Approach' },
    priorSalesSubject_12mo:      { type: 'yesno',    label: 'Subject sold in prior 12 months?' },
    priorSalesSubject_12mo_date: { type: 'text',     label: 'Prior Sale Date (12 mo)' },
    priorSalesSubject_12mo_price:{ type: 'currency', label: 'Prior Sale Price (12 mo)' },
    priorSalesSubject_36mo:      { type: 'yesno',    label: 'Subject sold in prior 36 months?' },
    priorSalesSubject_36mo_date: { type: 'text',     label: 'Prior Sale Date (36 mo)' },
    priorSalesSubject_36mo_price:{ type: 'currency', label: 'Prior Sale Price (36 mo)' },

    // comp_template is used by the UI/auto-populate to know which fields each comp has
    // Actual comp data lives in formData.salesComparison.comps[]
    _compTemplate: {
      address:                       { type: 'text',     label: 'Address' },
      proximityToSubject:            { type: 'text',     label: 'Proximity to Subject' },
      salePrice:                     { type: 'currency', label: 'Sale Price $' },
      salePricePerGLA:               { type: 'currency', label: 'Price/Gross Liv. Area $' },
      dataSource:                    { type: 'text',     label: 'Data Source' },
      verificationSource:            { type: 'text',     label: 'Verification Source' },
      saleDate:                      { type: 'text',     label: 'Date of Sale/Time' },
      conditionsOfSale:              { type: 'text',     label: 'Conditions of Sale' },
      financingConcessions:          { type: 'text',     label: 'Financing Concessions' },

      // Location, site, view
      location:                      { type: 'text', label: 'Location' },
      siteArea:                      { type: 'text', label: 'Site Area' },
      viewDescription:               { type: 'text', label: 'View' },
      designStyle:                   { type: 'text', label: 'Design (Style)' },
      qualityOfConstruction:         { type: 'text', label: 'Quality of Construction' },
      actualAge:                     { type: 'text', label: 'Actual Age' },
      condition:                     { type: 'text', label: 'Condition' },
      aboveGradeRooms:               { type: 'text', label: 'Above Grade Rooms' },
      aboveGradeBedrooms:            { type: 'text', label: 'Above Grade Bedrooms' },
      aboveGradeBathrooms:           { type: 'text', label: 'Above Grade Bathrooms' },
      grossLivingArea:               { type: 'number', label: 'GLA sq.ft.' },
      basementAndFinished:           { type: 'text', label: 'Basement & Finished' },
      functionalUtility:             { type: 'text', label: 'Functional Utility' },
      heatingCooling:                { type: 'text', label: 'Heating/Cooling' },
      energyEfficientItems:          { type: 'text', label: 'Energy Efficient Items' },
      garageCarport:                 { type: 'text', label: 'Garage/Carport' },
      porchPatioDeck:                { type: 'text', label: 'Porch/Patio/Deck' },
      other1Description:             { type: 'text', label: 'Other 1 Description' },
      other2Description:             { type: 'text', label: 'Other 2 Description' },

      // Adjustments
      adj_saleOrFinancingConcessions: { type: 'currency', label: 'Adj. Sale/Financing Concessions' },
      adj_dateOfSaleTime:             { type: 'currency', label: 'Adj. Date of Sale/Time' },
      adj_location:                   { type: 'currency', label: 'Adj. Location' },
      adj_leaseholdFeeSimple:         { type: 'currency', label: 'Adj. Leasehold/Fee Simple' },
      adj_site:                       { type: 'currency', label: 'Adj. Site' },
      adj_view:                       { type: 'currency', label: 'Adj. View' },
      adj_design:                     { type: 'currency', label: 'Adj. Design' },
      adj_quality:                    { type: 'currency', label: 'Adj. Quality of Construction' },
      adj_age:                        { type: 'currency', label: 'Adj. Actual Age' },
      adj_condition:                  { type: 'currency', label: 'Adj. Condition' },
      adj_aboveGradeRoomCount:        { type: 'currency', label: 'Adj. Above Grade Room Count' },
      adj_aboveGradeBedrooms:         { type: 'currency', label: 'Adj. Above Grade Bedrooms' },
      adj_aboveGradeBathrooms:        { type: 'currency', label: 'Adj. Above Grade Bathrooms' },
      adj_grossLivingArea:            { type: 'currency', label: 'Adj. Gross Living Area' },
      adj_basement:                   { type: 'currency', label: 'Adj. Basement & Finished Rooms' },
      adj_functionalUtility:          { type: 'currency', label: 'Adj. Functional Utility' },
      adj_heatingCooling:             { type: 'currency', label: 'Adj. Heating/Cooling' },
      adj_energyEfficient:            { type: 'currency', label: 'Adj. Energy Efficient Items' },
      adj_garageCarport:              { type: 'currency', label: 'Adj. Garage/Carport' },
      adj_porchPatioDeck:             { type: 'currency', label: 'Adj. Porch/Patio/Deck' },
      adj_other1:                     { type: 'currency', label: 'Adj. Other 1' },
      adj_other2:                     { type: 'currency', label: 'Adj. Other 2' },

      // Calculated
      netAdjustment:                  { type: 'calculated', label: 'Net Adjustment (Total) $' },
      netAdjustmentPercent:           { type: 'calculated', label: 'Net Adj. %' },
      grossAdjustment:                { type: 'calculated', label: 'Gross Adjustment $' },
      grossAdjustmentPercent:         { type: 'calculated', label: 'Gross Adj. %' },
      adjustedSalePrice:              { type: 'calculated', label: 'Indicated Value of Subject $' },
    },
  },

  // ── RECONCILIATION ───────────────────────────────────────────────────────
  reconciliation: {
    indicatedValueBySalesComparison: { type: 'currency', label: 'Indicated Value by Sales Comparison Approach $', required: true },
    indicatedValueByCostApproach:    { type: 'currency', label: 'Indicated Value by Cost Approach $' },
    indicatedValueByIncomeApproach:  { type: 'currency', label: 'Indicated Value by Income Approach $' },
    reconciliationComments:          { type: 'textarea', label: 'Reconciliation Comments' },
    finalOpinionOfValue:             { type: 'currency', label: 'Opinion of Market Value $', required: true },
    effectiveDate:                   { type: 'date',     label: 'As of (Effective Date)',     required: true },
    appraisalDate:                   { type: 'date',     label: 'Date of Appraisal Report' },
  },

  // ── COST APPROACH (optional but included) ────────────────────────────────
  costApproach: {
    provideEstimateOfSite:         { type: 'yesno',    label: 'Provide Cost Approach?' },
    siteValue:                     { type: 'currency', label: 'Estimated Site Value $' },
    sourceSiteValue:               { type: 'text',     label: 'Source of Site Value' },
    asIsValue:                     { type: 'currency', label: 'As-Is Value of Site Improvements $' },

    // Dwelling
    dwellingGLA:                   { type: 'number',   label: 'Dwelling sq.ft. @ $' },
    dwellingCostPerSqFt:           { type: 'currency', label: 'Cost Per Sq.Ft. $' },
    dwellingCost:                  { type: 'calculated', label: 'Dwelling Cost $' },

    // Additions/extras
    extrasGarage:                  { type: 'currency', label: 'Garage/Carport $' },
    extrasPorch:                   { type: 'currency', label: 'Porch/Patio/Deck $' },
    extrasOther:                   { type: 'currency', label: 'Other Extras $' },
    totalEstimateOfCostNew:        { type: 'calculated', label: 'Total Estimate of Cost-New $' },

    // Depreciation
    physicalDepreciation:          { type: 'currency', label: 'Physical Depreciation $' },
    functionalDepreciation:        { type: 'currency', label: 'Functional Depreciation $' },
    externalDepreciation:          { type: 'currency', label: 'External Depreciation $' },
    totalDepreciation:             { type: 'calculated', label: 'Depreciated Cost of Improvements $' },

    // Totals
    asImprovedValue:               { type: 'calculated', label: 'As-Improved Value $' },
    indicatedValueByCostApproach:  { type: 'calculated', label: 'Indicated Value By Cost Approach $' },
    costApproachComments:          { type: 'textarea',   label: 'Comments on Cost Approach' },
  },

  // ── INCOME APPROACH (optional) ───────────────────────────────────────────
  incomeApproach: {
    estimatedMonthlyMarketRent:    { type: 'currency', label: 'Estimated Monthly Market Rent $' },
    grossRentMultiplier:           { type: 'number',   label: 'Gross Rent Multiplier' },
    indicatedValueByIncomeApproach:{ type: 'calculated', label: 'Indicated Value by Income Approach $' },
    summaryOfIncomeApproach:       { type: 'textarea', label: 'Summary of Income Approach' },
  },

  // ── PUD / HOMEOWNER ASSOCIATION ──────────────────────────────────────────
  pud: {
    isPUD:                         { type: 'yesno', label: 'Is subject property in a PUD?' },
    developerBuilderInControl:     { type: 'yesno', label: 'Developer/Builder in Control of HOA?' },
    unitType:                      { type: 'select', label: 'Unit Type', options: ['Detached', 'Attached'] },
    hoaProjectName:                { type: 'text',   label: 'HOA Project Name' },
    totalUnits:                    { type: 'number', label: 'Total # of Units' },
    totalUnitsForSale:             { type: 'number', label: 'Total # of Units For Sale' },
    totalUnitsRented:              { type: 'number', label: 'Total # of Units Currently Rented' },
    totalUnitsSold:                { type: 'number', label: 'Total # of Units Sold' },
    wasProjectCreatedByConversion: { type: 'yesno',  label: 'Was project created by conversion of existing building(s)?' },
    projectConversionDate:         { type: 'date',   label: 'Conversion Date' },
    monthlyAssessment:             { type: 'currency', label: 'Monthly Assessment $' },
    managementCompany:             { type: 'text',   label: 'Management Company' },
    isMasterAssociationBudget:     { type: 'yesno',  label: 'Are the units, common elements, and recreation facilities complete?' },
    areCommonElementsComplete:     { type: 'yesno',  label: 'Are common elements complete?' },
    pudComments:                   { type: 'textarea', label: 'PUD Comments' },
  },

  // ── APPRAISER CERTIFICATION ──────────────────────────────────────────────
  appraiser: {
    appraiserName:            { type: 'text', label: 'Appraiser Name',             required: true },
    appraiserCompany:         { type: 'text', label: 'Appraiser Company' },
    appraiserAddress:         { type: 'text', label: 'Appraiser Address' },
    appraiserPhone:           { type: 'text', label: 'Appraiser Phone' },
    appraiserEmail:           { type: 'text', label: 'Appraiser Email' },
    appraiserLicenseNumber:   { type: 'text', label: 'Appraiser License #',        required: true },
    appraiserLicenseState:    { type: 'text', label: 'Appraiser License State',    required: true },
    appraiserLicenseExpiry:   { type: 'date', label: 'Appraiser License Expiry' },
    appraiserCertification:   { type: 'select', label: 'Appraiser Certification', options: ['Certified Residential', 'Certified General', 'Licensed', 'Trainee'] },
    didInspectInterior:       { type: 'yesno', label: 'Did Inspect Interior?' },
    didInspectExterior:       { type: 'yesno', label: 'Did Inspect Exterior?' },
    inspectionDate:           { type: 'date',  label: 'Inspection Date' },

    supervisoryAppraiserName:        { type: 'text',   label: 'Supervisory Appraiser Name (if applicable)' },
    supervisoryAppraiserLicense:     { type: 'text',   label: 'Supervisory Appraiser License #' },
    supervisoryAppraiserLicenseState:{ type: 'text',   label: 'Supervisory Appraiser License State' },
    supervisoryDidInspect:           { type: 'yesno',  label: 'Did Supervisory Appraiser Inspect?' },
  },

};

// ── Flat field count (for completeness checking) ─────────────────────────────

/**
 * Check how complete a formData object is against the FORM_1004_FIELDS schema.
 * Sales comp data lives in formData.salesComparison.comps[] — handled separately.
 *
 * @param {object} formData  — The case's form_data object
 * @param {string} [formType='1004']
 * @returns {{ total: number, filled: number, percentage: number, missing: Array }}
 */
export function checkFormCompleteness(formData = {}, formType = '1004') {
  let total = 0;
  let filled = 0;
  const missing = [];

  // Skip these top-level sections from flat counting
  const SKIP_SECTIONS = new Set(['salesComparison']);

  for (const [section, sectionFields] of Object.entries(FORM_1004_FIELDS)) {
    if (SKIP_SECTIONS.has(section)) continue;

    for (const [fieldId, config] of Object.entries(sectionFields)) {
      // Skip nested _compTemplate-like objects
      if (typeof config !== 'object' || !config.type) continue;
      // Skip calculated fields — they don't need manual input
      if (config.type === 'calculated') continue;

      total++;
      const value = formData?.[section]?.[fieldId];
      const isEmpty = value === null || value === undefined || value === '';

      if (!isEmpty) {
        filled++;
      } else if (config.required) {
        missing.push({ section, field: fieldId, label: config.label });
      }
    }
  }

  // Also check comps
  const comps = formData?.salesComparison?.comps ?? [];
  const compTemplate = FORM_1004_FIELDS.salesComparison._compTemplate;
  const COMP_REQUIRED = ['address', 'salePrice', 'saleDate', 'grossLivingArea'];
  const compCount = comps.length;

  let compTotal = 0;
  let compFilled = 0;
  for (let i = 0; i < compCount; i++) {
    const comp = comps[i] ?? {};
    for (const [fieldId, config] of Object.entries(compTemplate)) {
      if (config.type === 'calculated') continue;
      compTotal++;
      const value = comp[fieldId];
      const isEmpty = value === null || value === undefined || value === '';
      if (!isEmpty) {
        compFilled++;
      } else if (COMP_REQUIRED.includes(fieldId)) {
        missing.push({ section: `comp_${i + 1}`, field: fieldId, label: config.label });
      }
    }
  }

  total += compTotal;
  filled += compFilled;

  return {
    total,
    filled,
    percentage: total > 0 ? Math.round((filled / total) * 100) : 0,
    compCount,
    missing,
  };
}

/**
 * Returns a blank form data object pre-populated with null values for every field.
 * Useful as a starting point before auto-populate.
 */
export function getBlankFormData() {
  const data = {};
  const SKIP_SECTIONS = new Set(['salesComparison']);

  for (const [section, sectionFields] of Object.entries(FORM_1004_FIELDS)) {
    if (SKIP_SECTIONS.has(section)) continue;
    data[section] = {};
    for (const [fieldId, config] of Object.entries(sectionFields)) {
      if (typeof config !== 'object' || !config.type) continue;
      data[section][fieldId] = null;
    }
  }

  data.salesComparison = { comps: [] };
  return data;
}
