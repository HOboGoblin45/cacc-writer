import form1004 from './1004.js';

const form1073 = {
  ...form1004,
  id: '1073',
  label: '1073 — Individual Condo Unit',
  uspap: 'Fannie Mae Form 1073 Individual Condominium Unit Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a 1073 condo unit appraisal in Bloomington-Normal, IL.',
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Neighborhood description + boundaries (10 pts)
- Market conditions with supported stats (10 pts)
- Improvements/condition narrative completeness (10 pts)
- Condo project analysis: HOA health, legal compliance, owner-occupancy ratio, common elements (15 pts)
- Sales comparison approach rigor (15 pts)
- Reconciliation narrative quality (10 pts)
- USPAP compliance / no unsupported statements (10 pts)
- Professional tone + internal consistency (10 pts)
`,
  questionnairePriorities: [
    'HOA financial health and reserve fund adequacy',
    'Owner-occupancy ratio for the condo project',
    'HOA monthly dues and any special assessments',
    'Project legal compliance (1076 questionnaire findings)',
    'Neighborhood boundaries (if null)',
    'Subject UAD condition (C1-C6) and quality (Q1-Q6) ratings',
    'Comp selection (same project vs. competing projects, bracketing)',
    'Seller concessions amount and type',
    'Market trend stat and source (if null)',
    'Prior sale/listing history for subject',
  ],
  factsSchema: {
    ...form1004.factsSchema,
    condoProject: {
      hoaDues: { value: null, confidence: 'low', source: '' },
      reserveFundAdequacy: { value: null, confidence: 'low', source: '' },
      ownerOccupancyRatio: { value: null, confidence: 'low', source: '' },
      specialAssessments: { value: null, confidence: 'low', source: '' },
      totalUnits: { value: null, confidence: 'low', source: '' },
      projectLegalCompliance: { value: null, confidence: 'low', source: '' },
      pendingLitigation: { value: null, confidence: 'low', source: '' },
    },
  },
  fields: [
    ...form1004.fields,
    {
      id: 'condo_project_analysis',
      title: 'Condo Project Analysis',
      note: '1073: HOA health, owner-occupancy, legal compliance, common elements',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address'],
      tpl: 'Write a Condo Project Analysis narrative in Charlie Cresci\'s concise style.\nAddress HOA financial health, reserve fund adequacy, owner-occupancy ratio, any special assessments, and project legal compliance.\nDo NOT invent facts. Use [INSERT] where missing.\nReturn ONLY the narrative text.',
    },
  ],
  voiceFields: [
    ...form1004.voiceFields,
    { id: 'condo_project_analysis', title: 'Condo Project Analysis' },
  ],
  docTypes: [
    { id: 'purchase_contract', label: 'Purchase Contract' },
    { id: 'public_record', label: 'Public Record' },
    { id: 'appraisal_order', label: 'Appraisal Order' },
    { id: 'mls_sheet', label: 'MLS Sheet' },
    { id: 'condo_questionnaire_1076', label: 'Condo Questionnaire (1076)' },
    { id: 'hoa_docs', label: 'HOA Docs' },
    { id: 'project_legal_docs', label: 'Project Legal Docs' },
    { id: 'budget_financials', label: 'HOA Budget/Financials' },
    { id: 'comp_1', label: 'Comparable 1' },
    { id: 'comp_2', label: 'Comparable 2' },
    { id: 'comp_3', label: 'Comparable 3' },
    { id: 'tax_record', label: 'Tax Record' },
    { id: 'photos', label: 'Photo Addendum' },
  ],
};

export default form1073;
