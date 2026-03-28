/**
 * forms/uad36.js
 * ──────────────
 * UAD 3.6 (Uniform Appraisal Dataset 3.6) Form Definition
 * Redesigned URAR — mandatory November 2, 2026
 *
 * Key differences from 1004:
 * - Property condition must use C1-C6 ratings (standardized UAD scale)
 * - Quality ratings Q1-Q6 with defined UAD criteria
 * - Market conditions require structured data: appreciation rate %, DOM median, list-to-sale ratio
 * - Comparable adjustments must be quantified in dollars (not just "similar")
 * - Location ratings: Urban/Suburban/Rural
 * - View ratings: N (Neutral), B (Beneficial), A (Adverse)
 * - Design/style uses specific UAD abbreviations (DT, AT, SD, etc.)
 * - Age/effective age must be stated explicitly
 * - GLA adjustments must show per-SF adjustment rate
 */

const factsSchema = {
  subject: {
    address: { value: null, confidence: 'low', source: '' },
    city: { value: null, confidence: 'low', source: '' },
    county: { value: null, confidence: 'low', source: '' },
    state: { value: null, confidence: 'low', source: '' },
    parcelId: { value: null, confidence: 'low', source: '' },
    // UAD 3.6 specific
    conditionRating: { value: null, confidence: 'low', source: '' },  // C1-C6
    qualityRating: { value: null, confidence: 'low', source: '' },    // Q1-Q6
    designStyle: { value: null, confidence: 'low', source: '' },      // UAD code: DT, AT, SD, etc.
    constructionType: { value: null, confidence: 'low', source: '' }, // Wood, Masonry, Steel, etc.
    yearBuilt: { value: null, confidence: 'low', source: '' },
    effectiveAge: { value: null, confidence: 'low', source: '' },
    remainingEconomicLife: { value: null, confidence: 'low', source: '' },
    // Standard fields
    gla: { value: null, confidence: 'low', source: '' },
    beds: { value: null, confidence: 'low', source: '' },
    baths: { value: null, confidence: 'low', source: '' },
    siteSize: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    basement: { value: null, confidence: 'low', source: '' },
    garage: { value: null, confidence: 'low', source: '' },
    viewRating: { value: null, confidence: 'low', source: '' },       // N, B, A
    locationRating: { value: null, confidence: 'low', source: '' },   // Urban, Suburban, Rural
  },
  contract: {
    contractPrice: { value: null, confidence: 'low', source: '' },
    contractDate: { value: null, confidence: 'low', source: '' },
    closingDate: { value: null, confidence: 'low', source: '' },
    sellerConcessions: { value: null, confidence: 'low', source: '' },
    financing: { value: null, confidence: 'low', source: '' },
    daysOnMarket: { value: null, confidence: 'low', source: '' },
    offeringHistory: { value: null, confidence: 'low', source: '' },
  },
  market: {
    trend: { value: null, confidence: 'low', source: '' },
    appreciationRate: { value: null, confidence: 'low', source: '' }, // UAD: % per year
    medianDOM: { value: null, confidence: 'low', source: '' },        // UAD: median days on market
    listToSaleRatio: { value: null, confidence: 'low', source: '' },  // UAD: ratio
    inventoryMonths: { value: null, confidence: 'low', source: '' },  // UAD: months supply
    absorptionRate: { value: null, confidence: 'low', source: '' },   // UAD: % per month
    priceRange: { value: null, confidence: 'low', source: '' },
    exposureTime: { value: null, confidence: 'low', source: '' },
    trendStat: { value: null, confidence: 'low', source: '' },
    trendStatSource: { value: null, confidence: 'low', source: '' },
    extended_search: { value: false, confidence: 'high', source: '' },
  },
  neighborhood: {
    boundaries: { value: null, confidence: 'low', source: '' },
    description: { value: null, confidence: 'low', source: '' },
    landUse: { value: null, confidence: 'low', source: '' },
    builtUp: { value: null, confidence: 'low', source: '' },
    landUsePercentages: { value: null, confidence: 'low', source: '' }, // UAD: structured %s
  },
  comps: [
    {
      number: 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      // UAD 3.6: structured adjustments
      adjustments: {
        location: { value: null, confidence: 'low', source: '' },      // $ amount
        gla: { value: null, confidence: 'low', source: '' },           // $ amount
        age: { value: null, confidence: 'low', source: '' },           // $ amount
        condition: { value: null, confidence: 'low', source: '' },     // $ amount
        quality: { value: null, confidence: 'low', source: '' },       // $ amount
        view: { value: null, confidence: 'low', source: '' },          // $ amount
        // ... other adjustment categories
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' }, // UAD: $/SF
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 2,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: {
        location: { value: null, confidence: 'low', source: '' },
        gla: { value: null, confidence: 'low', source: '' },
        age: { value: null, confidence: 'low', source: '' },
        condition: { value: null, confidence: 'low', source: '' },
        quality: { value: null, confidence: 'low', source: '' },
        view: { value: null, confidence: 'low', source: '' },
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' },
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 3,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: {
        location: { value: null, confidence: 'low', source: '' },
        gla: { value: null, confidence: 'low', source: '' },
        age: { value: null, confidence: 'low', source: '' },
        condition: { value: null, confidence: 'low', source: '' },
        quality: { value: null, confidence: 'low', source: '' },
        view: { value: null, confidence: 'low', source: '' },
      },
      adjustmentPerSF: { value: null, confidence: 'low', source: '' },
      netAdjustment: { value: null, confidence: 'low', source: '' },
      grossAdjustment: { value: null, confidence: 'low', source: '' },
    },
  ],
  assignment: {
    intendedUse: { value: null, confidence: 'low', source: '' },
    intendedUser: { value: null, confidence: 'low', source: '' },
    effectiveDate: { value: null, confidence: 'low', source: '' },
    extraordinaryAssumptions: { value: null, confidence: 'low', source: '' },
    hypotheticalConditions: { value: null, confidence: 'low', source: '' },
  },
};

const formUad36 = {
  id: 'uad36',
  label: 'UAD 3.6 — Redesigned URAR',
  uspap: 'UAD 3.6 Redesigned Uniform Residential Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a UAD 3.6 redesigned URAR. Focus on standardized UAD ratings (C1-C6, Q1-Q6), structured market conditions, and quantified comparable adjustments.',
  fields: [
    {
      id: 'contract_analysis',
      title: 'Contract Analysis',
      note: 'UAD 3.6: Analysis of agreement of sale with required data points',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.contractPrice', 'contract.contractDate'],
      tpl: 'Write the Contract Analysis narrative for a UAD 3.6 appraisal.\n\nFocus on:\n1. Contract price and date\n2. Financing type and terms\n3. Seller concessions amount and type\n4. Contingencies\n5. Comparable to market sales patterns\n\nDo NOT invent facts. Use [INSERT] for missing data.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'neighborhood_description',
      title: 'Neighborhood Description',
      note: 'UAD 3.6: Neighborhood analysis with structured data',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city', 'subject.county'],
      tpl: 'Write the Neighborhood Description in UAD 3.6 format.\n\nInclude:\n1. Geographic location and boundaries\n2. Land use percentages (residential %, commercial %, etc.)\n3. Built-up percentage\n4. Neighborhood stability/trends\n5. Property values trend (appreciation/depreciation %)\n\nUse specific percentages from facts. Use [INSERT] for missing data.\nSubject area: {{area}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'market_conditions',
      title: 'Market Conditions Analysis',
      note: 'UAD 3.6: Structured market data with required metrics',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.trend'],
      tpl: 'Write the Market Conditions Analysis for UAD 3.6 format.\n\nMust include:\n1. Appreciation rate (% per year) or rate of change\n2. Median DOM (days on market)\n3. List-to-sale ratio\n4. Inventory months (supply)\n5. Absorption rate (if available)\n6. Market trend description (stable/appreciating/depreciating)\n\nUse facts for quantified metrics. Use [INSERT] for missing specific numbers.\nMarket: {{market_stat}}\nSubject area: {{area}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'site_description',
      title: 'Site Description',
      note: 'UAD 3.6: Site analysis with utility and improvement details',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.siteSize', 'subject.zoning'],
      tpl: 'Write the Site Description for UAD 3.6 format.\n\nInclude:\n1. Lot dimensions and size in specific units\n2. Topography (level, sloping, etc.)\n3. Utilities: water (public/private), sewer (public/private), electric, gas\n4. Off-site improvements: paved streets, sidewalks, curbs, street lights\n5. Zoning classification and compliance\n6. Adverse conditions (if any)\n\nUse specific facts. Use [INSERT] for unknown utilities/dimensions.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'improvements_description',
      title: 'Description of Improvements',
      note: 'UAD 3.6: Complete property description with UAD codes',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.beds', 'subject.baths', 'subject.designStyle'],
      tpl: 'Write the Description of Improvements for UAD 3.6 format.\n\nMust include:\n1. Design/Style (use UAD abbreviations: DT=Detached, AT=Attached, SD=Semi-Detached, etc.)\n2. Construction type (Wood Frame, Masonry, Steel, etc.)\n3. Year built and effective age\n4. Gross living area (GLA) in square feet\n5. Room count: [X] bedrooms, [Y] bathrooms\n6. Major components and systems\n7. View rating (N/B/A): Neutral, Beneficial, or Adverse\n8. Location rating (Urban/Suburban/Rural)\n\nUse specific facts. Do NOT invent architectural details.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'condition_description',
      title: 'Condition of Improvements',
      note: 'UAD 3.6: Condition rating C1-C6 with detailed justification',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.conditionRating'],
      tpl: 'Write the Condition of Improvements narrative for UAD 3.6.\n\nCondition Rating Scale (must state which applies):\nC1: New — just completed\nC2: Like New — little to no deferred maintenance\nC3: Well Maintained — normal wear and tear, minor maintenance\nC4: Average — some deferred maintenance, typical updates needed\nC5: Fair — significant deferred maintenance visible, major systems aging\nC6: Poor — substantial deferred maintenance, major systems near end of life\n\nMust include:\n1. Overall condition rating (C1-C6) from facts\n2. Justification for specific rating based on property observations\n3. Deferred maintenance (if any)\n4. Recent updates or renovations\n5. Remaining useful life consideration\n\nCondition Rating: {{subject.conditionRating}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'quality_rating_detail',
      title: 'Quality & Construction Rating',
      note: 'UAD 3.6: Quality rating Q1-Q6 with detailed justification',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.qualityRating'],
      tpl: 'Write the Quality & Construction Rating narrative for UAD 3.6.\n\nQuality Rating Scale (must state which applies):\nQ1: Excellent — finest materials, superior construction and design\nQ2: Very Good — above-average materials and construction\nQ3: Good — average materials and workmanship\nQ4: Average — typical materials and construction\nQ5: Fair — below-average materials and workmanship\nQ6: Poor — minimal/substandard materials and construction\n\nMust include:\n1. Overall quality rating (Q1-Q6) from facts\n2. Materials assessment (finishes, fixtures, systems quality)\n3. Construction quality (workmanship, structural integrity)\n4. Design/layout assessment\n5. Comparison to neighborhood standard\n\nQuality Rating: {{subject.qualityRating}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'highest_best_use',
      title: 'Highest & Best Use Analysis',
      note: 'UAD 3.6: Four-test HBU analysis',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.zoning'],
      tpl: 'Write the Highest & Best Use Analysis for UAD 3.6 format.\n\nMust address four tests:\n1. Physically Possible — Does zoning allow it? Are utilities adequate?\n2. Legally Permissible — Current zoning and restrictions allow use?\n3. Financially Feasible — Would improvements produce positive returns?\n4. Maximally Productive — Which use generates highest value?\n\nConclusion: The highest and best use of the subject as improved is [current use or alternative], which produces [specific value indication or reasoning].\n\nSubject: {{summary}}\nZoning: {{subject.zoning}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'sales_comparison_narrative',
      title: 'Sales Comparison Analysis',
      note: 'UAD 3.6: Comp analysis with quantified adjustments',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.conditionRating'],
      tpl: 'Write the Sales Comparison Analysis for UAD 3.6 format.\n\nMust include:\n1. Comp selection methodology (location, design, age, size, condition similarity)\n2. Adjustment categories with dollar amounts (required):\n   - Property Rights Conveyed\n   - Financing Terms\n   - Market Conditions (days on market)\n   - Location\n   - Physical Characteristics (GLA, condition, quality, design, view)\n3. Quantified adjustments: Show $ per SF for GLA adjustments\n4. Net vs. Gross adjustment percentages\n5. Verification of bracketing (subject falls within comp range)\n6. Reconciliation of comp indications to final value\n\nDo NOT invent adjustment amounts. Use [INSERT] for missing data.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'cost_approach',
      title: 'Cost Approach',
      note: 'UAD 3.6: Cost approach development (if applicable)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.yearBuilt', 'subject.gla'],
      tpl: 'Write the Cost Approach narrative for UAD 3.6 (if applicable).\n\nIf developed, include:\n1. Land value estimate\n2. Reproduction/replacement cost of improvements\n3. Accrued depreciation:\n   - Physical deterioration (curable and incurable)\n   - Functional obsolescence\n   - External obsolescence\n4. Total depreciated value\n5. Final cost approach conclusion\n\nIf not developed, state reason (e.g., "The cost approach is not developed as the subject is an older property and market data supports the income/sales approaches").\n\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'income_approach',
      title: 'Income Approach',
      note: 'UAD 3.6: Income approach (if applicable for rental/multi-family)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address'],
      tpl: 'Write the Income Approach narrative for UAD 3.6 (if applicable).\n\nIf developed, include:\n1. Rental income analysis (market rent vs. contract rent)\n2. Vacancy and collection loss\n3. Operating expenses\n4. Net operating income (NOI)\n5. Cap rate selection and application\n6. GRM (Gross Rent Multiplier) if applicable\n7. Final income approach conclusion\n\nIf not developed, state reason (e.g., "The income approach is not developed as the subject is owner-occupied single-family residential property").\n\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'reconciliation',
      title: 'Reconciliation & Final Value Opinion',
      note: 'UAD 3.6: Reconciliation with approach weighting',
      aiEligibility: 'manual_review',
      requiredFacts: ['subject.gla', 'subject.conditionRating', 'subject.qualityRating'],
      tpl: 'Write the Reconciliation & Final Value Opinion for UAD 3.6 format.\n\nMust include:\n1. Summary of approach indications:\n   - Sales Comparison: [value range and weight]\n   - Cost Approach: [if developed, value and weight]\n   - Income Approach: [if developed, value and weight]\n\n2. Weighting rationale:\n   - Why one approach received primary weight\n   - How other approaches support or contradict indication\n   - Convergence or divergence analysis\n\n3. Final Value Opinion:\n   - Specific concluded value\n   - Confidence level\n   - Date of value (effective date)\n   - Type of value (market value definition)\n\n4. Closing statements:\n   - "As is" condition disclaimer\n   - Personal property exclusion\n   - Special conditions or limitations\n\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'scope_of_work',
      title: 'Scope of Work',
      note: 'UAD 3.6: Defined scope of appraisal engagement',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address'],
      tpl: 'Write the Scope of Work statement for UAD 3.6.\n\nMust address:\n1. Subject property identification\n2. Intended use and user\n3. Type of value (market value)\n4. Effective date of appraisal\n5. Extent of data collection and research\n6. Extent of comparable market analysis\n7. Methods and techniques employed\n8. Limitations of appraisal\n9. Extraordinary assumptions or hypothetical conditions (if any)\n\nKeep factual and specific to this assignment.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'prior_sales',
      title: 'Prior Sales / Transfers History',
      note: 'UAD 3.6: Subject and comparable prior sales',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address'],
      tpl: 'Write the Prior Sales / Transfers History for UAD 3.6.\n\nInclude:\n1. Subject property:\n   - Sales/transfers in past 12 months (if any)\n   - Sales/transfers in past 36 months\n   - Price trends (if multiple sales)\n   - Reasons for sales (if known)\n\n2. Comparable properties:\n   - Prior sales of each comp (within market data period)\n   - Price changes and time between sales\n   - Analysis of price trends\n\n3. Market implications:\n   - Does prior sales history indicate market stability?\n   - Any unusual circumstances affecting values?\n\nUse [INSERT] for unknown prior sales data.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'conditions_assumptions',
      title: 'General Assumptions & Limiting Conditions',
      note: 'UAD 3.6: Standard assumptions and limitations',
      aiEligibility: 'ai_draft',
      requiredFacts: ['assignment.intendedUse'],
      tpl: 'Write the General Assumptions & Limiting Conditions for UAD 3.6.\n\nMust include standard statements:\n1. Appraiser has no financial interest in property or transaction\n2. Compensation is not contingent on value reported\n3. Appraisal assumes property is free and clear of liens\n4. Title is assumed marketable (lender may verify)\n5. Property is appraised without physical inspection limitation (if inspected) or noting if not inspected\n6. Subject property is assumed to be in compliance with all applicable laws and regulations\n7. Appraiser is not aware of material facts affecting value that have not been disclosed\n8. As-is condition assumption (unless modified)\n9. No personal property included unless stated\n10. Extraordinary assumptions or hypothetical conditions (if applicable)\n\nKeep professional and standard format.\nReturn ONLY the narrative text.',
    },
    {
      id: 'extraordinary_assumptions',
      title: 'Extraordinary Assumptions',
      note: 'UAD 3.6: If applicable to this assignment',
      aiEligibility: 'ai_draft',
      requiredFacts: ['assignment.extraordinaryAssumptions'],
      tpl: 'Write the Extraordinary Assumptions section for UAD 3.6.\n\nIf extraordinary assumptions exist (from facts), list each and explain impact on value.\nFormat: "It is assumed that [specific extraordinary assumption]. If this assumption is not correct, the value conclusion may be significantly affected."\n\nIf none exist, state: "There are no extraordinary assumptions for this appraisal."\n\nExtraordinary Assumptions (from facts): {{assignment.extraordinaryAssumptions}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'hypothetical_conditions',
      title: 'Hypothetical Conditions',
      note: 'UAD 3.6: If applicable to this assignment',
      aiEligibility: 'ai_draft',
      requiredFacts: ['assignment.hypotheticalConditions'],
      tpl: 'Write the Hypothetical Conditions section for UAD 3.6.\n\nIf hypothetical conditions exist (from facts), list each and explain impact on value.\nFormat: "This appraisal assumes [specific hypothetical condition]. If this condition is not met, the value conclusion may change."\n\nIf none exist, state: "There are no hypothetical conditions for this appraisal."\n\nHypothetical Conditions (from facts): {{assignment.hypotheticalConditions}}\nReturn ONLY the narrative text.',
    },
  ],
  docTypes: [
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
  ],
  factsSchema,
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Neighborhood description with structured market data (15 pts)
- Market conditions with quantified UAD metrics (15 pts)
- Site and improvements descriptions completeness (10 pts)
- Condition & Quality ratings (C/Q) with justified narratives (15 pts)
- Sales comparison with quantified adjustments and bracketing (20 pts)
- Reconciliation with approach weighting and confidence (10 pts)
- USPAP compliance and no unsupported statements (10 pts)
`,
  questionnairePriorities: [
    'Subject UAD condition rating (C1-C6) with justification',
    'Subject UAD quality rating (Q1-Q6) with justification',
    'Subject effective age vs. year built',
    'Market appreciation rate (% per year)',
    'Market median DOM and list-to-sale ratio',
    'Comparable adjustments (quantified in dollars)',
    'GLA adjustment per square foot',
    'View rating (N/B/A) and location rating (Urban/Suburban/Rural)',
    'Design/style UAD abbreviation',
    'Neighborhood land use percentages',
    'Highest & best use four-test analysis',
    'Prior sales history for subject (12 and 36 month)',
  ],
  voiceFields: [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'condition_description', title: 'Condition of Improvements' },
    { id: 'quality_rating_detail', title: 'Quality & Construction Rating' },
    { id: 'sales_comparison_narrative', title: 'Sales Comparison Analysis' },
    { id: 'reconciliation', title: 'Reconciliation & Final Value Opinion' },
    { id: 'highest_best_use', title: 'Highest & Best Use Analysis' },
  ],
};

export default formUad36;
