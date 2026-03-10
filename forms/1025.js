import form1004 from './1004.js';

const form1025 = {
  ...form1004,
  id: '1025',
  label: '1025 — Small Residential Income (2-4 Unit)',
  uspap: 'Fannie Mae Form 1025 Small Residential Income Property Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a 1025 small residential income appraisal in Bloomington-Normal, IL.',
  fields: [
    ...form1004.fields,
    {
      id: 'income_approach',
      title: 'Income Approach Narrative',
      note: '1025: Income and rent support commentary',
      aiEligibility: 'ai_draft',
      requiredFacts: [],
      tpl: 'Write a concise income approach narrative for a 1025 appraisal in Charlie Cresci\'s style.\nDiscuss rent support, GRM/cap indications if available, and key assumptions.\nDo NOT invent data. Use [INSERT] where missing.\nReturn ONLY the narrative text.',
    },
  ],
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Neighborhood and market conditions support (15 pts)
- Improvements/condition narrative completeness (10 pts)
- Income approach: rent support, market rent analysis, GRM comparables, vacancy assumption (20 pts)
- Sales comparison approach rigor (15 pts)
- Reconciliation narrative quality and approach weighting (10 pts)
- USPAP compliance / no unsupported statements (10 pts)
- Professional tone + internal consistency (10 pts)
`,
  questionnairePriorities: [
    'Current contract rents vs. market rent comparability',
    'Vacancy and collection loss assumption support',
    'Gross rent multiplier (GRM) comparable data and source',
    'Lease terms and tenant history',
    'Income approach data gaps (PGI, EGI, expenses)',
    'Comp selection reasoning (income properties, bracketing)',
    'Seller concessions amount and type',
    'Market trend stat and source (if null)',
    'Prior sale/listing history for subject (12 and 36 month)',
  ],
  voiceFields: [
    ...form1004.voiceFields,
    { id: 'income_approach', title: 'Income Approach' },
  ],
  factsSchema: {
    ...form1004.factsSchema,
    incomeApproach: {
      marketRent: { value: null, confidence: 'low', source: '' },
      contractRent: { value: null, confidence: 'low', source: '' },
      vacancyCollectionLoss: { value: null, confidence: 'low', source: '' },
      pgi: { value: null, confidence: 'low', source: '' },
      egi: { value: null, confidence: 'low', source: '' },
      operatingExpenses: { value: null, confidence: 'low', source: '' },
      noi: { value: null, confidence: 'low', source: '' },
      grmIndication: { value: null, confidence: 'low', source: '' },
      grmSource: { value: null, confidence: 'low', source: '' },
    },
  },
  docTypes: [
    { id: 'purchase_contract', label: 'Purchase Contract' },
    { id: 'public_record', label: 'Public Record' },
    { id: 'appraisal_order', label: 'Appraisal Order' },
    { id: 'mls_sheet', label: 'MLS Sheet' },
    { id: 'rent_roll', label: 'Rent Roll' },
    { id: 'leases', label: 'Leases' },
    { id: 'income_expense', label: 'Income/Expense Statement' },
    { id: 'comp_1', label: 'Comparable 1' },
    { id: 'comp_2', label: 'Comparable 2' },
    { id: 'comp_3', label: 'Comparable 3' },
    { id: 'tax_record', label: 'Tax Record' },
    { id: 'photos', label: 'Photo Addendum' },
  ],
};

export default form1025;
