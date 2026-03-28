const commercialFactsSchema = {
  subject: {
    address: { value: null, confidence: 'low', source: '' },
    city: { value: null, confidence: 'low', source: '' },
    county: { value: null, confidence: 'low', source: '' },
    state: { value: null, confidence: 'low', source: '' },
    legalDescription: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    siteSize: { value: null, confidence: 'low', source: '' },
    utilities: { value: null, confidence: 'low', source: '' },
    accessExposure: { value: null, confidence: 'low', source: '' },
    highestBestUseVacant: { value: null, confidence: 'low', source: '' },
    highestBestUseImproved: { value: null, confidence: 'low', source: '' },
  },
  improvements: {
    propertyType: { value: null, confidence: 'low', source: '' },
    buildingClass: { value: null, confidence: 'low', source: '' },
    constructionType: { value: null, confidence: 'low', source: '' },
    grossBuildingArea: { value: null, confidence: 'low', source: '' },
    yearBuilt: { value: null, confidence: 'low', source: '' },
    condition: { value: null, confidence: 'low', source: '' },
    effectiveAge: { value: null, confidence: 'low', source: '' },
  },
  income: {
    pgi: { value: null, confidence: 'low', source: '' },
    vacancyCollectionLoss: { value: null, confidence: 'low', source: '' },
    egi: { value: null, confidence: 'low', source: '' },
    operatingExpenses: { value: null, confidence: 'low', source: '' },
    noi: { value: null, confidence: 'low', source: '' },
    capRate: { value: null, confidence: 'low', source: '' },
    valueIndication: { value: null, confidence: 'low', source: '' },
  },
  market: {
    submarket: { value: null, confidence: 'low', source: '' },
    vacancyTrend: { value: null, confidence: 'low', source: '' },
    rentTrend: { value: null, confidence: 'low', source: '' },
    capRateTrend: { value: null, confidence: 'low', source: '' },
    demandSupply: { value: null, confidence: 'low', source: '' },
  },
  sales: [
    {
      number: 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitOfComparison: { value: null, confidence: 'low', source: '' },
      adjustmentsNarrative: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 2,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitOfComparison: { value: null, confidence: 'low', source: '' },
      adjustmentsNarrative: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 3,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitOfComparison: { value: null, confidence: 'low', source: '' },
      adjustmentsNarrative: { value: null, confidence: 'low', source: '' },
    },
  ],
  assignment: {
    intendedUse: { value: null, confidence: 'low', source: '' },
    intendedUser: { value: null, confidence: 'low', source: '' },
    effectiveDate: { value: null, confidence: 'low', source: '' },
    extraordinaryAssumptions: { value: null, confidence: 'low', source: '' },
    hypotheticalConditions: { value: null, confidence: 'low', source: '' },
    scopeOfWork: { value: null, confidence: 'low', source: '' },
  },
};

const commercial = {
  id: 'commercial',
  label: 'Commercial Narrative',
  uspap: 'USPAP SR 1-4 Commercial Narrative',
  extractContext:
    'You are an appraisal data extractor for a commercial narrative appraisal assignment.',
  fields: [
    {
      id: 'site_description', title: 'Site Description',
      note: 'Legal description, utilities, access, zoning, HBU context',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.siteSize'],
      tpl: 'Write a commercial site description narrative in concise professional style.\nCover legal description, access, utilities, zoning, and land utility where available.\nDo NOT invent facts. Use [INSERT] placeholders when unknown.\nReturn ONLY the narrative text.',
    },
    {
      id: 'improvement_description', title: 'Improvement Description',
      note: 'Building class, construction, age, condition, utility',
      aiEligibility: 'ai_draft',
      requiredFacts: ['improvements.grossBuildingArea', 'improvements.condition'],
      tpl: 'Write a commercial improvement description narrative.\nCover building class/type, construction, age, condition, and functional utility.\nDo NOT invent facts. Use [INSERT] placeholders when unknown.\nReturn ONLY the narrative text.',
    },
    {
      id: 'market_area', title: 'Market Area Analysis',
      note: 'Submarket trends, vacancy, absorption, rent/cap trends',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city'],
      tpl: 'Write a commercial market area narrative.\nDiscuss submarket conditions, vacancy, absorption, rent trends, and cap rate trends where supported.\nDo NOT invent statistics. Use [INSERT] placeholders when unknown.\nReturn ONLY the narrative text.',
    },
    {
      id: 'hbu_analysis', title: 'Highest and Best Use Analysis',
      note: 'As vacant and as improved',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.zoning'],
      tpl: 'Write a Highest and Best Use analysis with both as-vacant and as-improved conclusions.\nSupport with legal/physical/financial/max productivity tests where possible.\nDo NOT invent facts.\nReturn ONLY the narrative text.',
    },
    {
      id: 'income_approach', title: 'Income Approach',
      note: 'PGI, vacancy, EGI, expenses, NOI, cap rate rationale',
      aiEligibility: 'ai_draft',
      requiredFacts: [],
      tpl: 'Write an income approach narrative.\nCover PGI, vacancy/collection loss, EGI, expenses, NOI, cap rate selection, and value indication.\nDo NOT invent numbers. Use [INSERT] placeholders when unknown.\nReturn ONLY the narrative text.',
    },
    {
      id: 'sales_comparison', title: 'Sales Comparison Narrative',
      note: 'Comparable selection rationale and adjustment discussion',
      aiEligibility: 'ai_draft',
      requiredFacts: [],
      tpl: 'Write a commercial sales comparison narrative.\nUse prose discussion for comparable selection, unit of comparison, and adjustment rationale.\nDo NOT invent data. Use [INSERT] placeholders when unknown.\nReturn ONLY the narrative text.',
    },
    {
      id: 'cost_approach', title: 'Cost Approach',
      note: 'Land value, RCN, depreciation (if applicable)',
      aiEligibility: 'ai_draft',
      requiredFacts: [],
      tpl: 'Write a cost approach narrative when applicable.\nAddress land value, replacement cost new, and depreciation categories with support level.\nIf not applicable, explain briefly.\nDo NOT invent facts.\nReturn ONLY the narrative text.',
    },
    {
      id: 'reconciliation', title: 'Reconciliation and Final Value Opinion',
      note: 'Weight of approaches and final reconciliation',
      aiEligibility: 'manual_review',
      requiredFacts: [],
      tpl: 'Write a reconciliation narrative for a commercial appraisal.\nExplain weight assigned to income, sales, and cost approaches and rationale.\nDo NOT invent unsupported certainty; use [INSERT] placeholders as needed.\nReturn ONLY the narrative text.',
    },
  ],
  docTypes: [
    { id: 'engagement_letter', label: 'Engagement Letter' },
    { id: 'rent_roll', label: 'Rent Roll' },
    { id: 'lease_abstracts', label: 'Lease Abstracts' },
    { id: 'income_expense_statement', label: 'Income/Expense Statements' },
    { id: 'noi_support', label: 'NOI Support Docs' },
    { id: 'cap_rate_comps', label: 'Cap Rate Comparable Data' },
    { id: 'sales_comps', label: 'Comparable Sale Data' },
    { id: 'zoning_report', label: 'Zoning Report' },
    { id: 'environmental', label: 'Environmental Reports' },
    { id: 'site_plan', label: 'Site Plan / Survey' },
    { id: 'photos', label: 'Photo Addendum' },
  ],
  factsSchema: commercialFactsSchema,
  gradingRubric: `
- Scope of work and intended use clarity (10 pts)
- Site and improvement description completeness (10 pts)
- Market/submarket support and trend logic (15 pts)
- HBU analysis quality (15 pts)
- Income approach support (PGI->NOI->cap) (20 pts)
- Sales comparison narrative rigor (15 pts)
- Reconciliation logic and approach weighting (10 pts)
- USPAP narrative compliance and internal consistency (5 pts)
`,
  questionnairePriorities: [
    'Intended use/intended user and scope of work (if null)',
    'HBU as vacant / as improved support',
    'Income approach data gaps (PGI, vacancy, expenses, NOI)',
    'Cap rate selection support and source',
    'Lease terms and rent comparability gaps',
    'Sales comparison unit-of-comparison rationale',
    'Zoning/legal permissibility details',
    'Market vacancy and rent trend support',
  ],
  voiceFields: [
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvement_description', title: 'Improvement Description' },
    { id: 'market_area', title: 'Market Area Analysis' },
    { id: 'hbu_analysis', title: 'Highest and Best Use Analysis' },
    { id: 'income_approach', title: 'Income Approach' },
    { id: 'sales_comparison', title: 'Sales Comparison Narrative' },
    { id: 'cost_approach', title: 'Cost Approach' },
    { id: 'reconciliation', title: 'Reconciliation and Final Value Opinion' },
  ],
};

export default commercial;
