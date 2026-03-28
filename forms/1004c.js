import form1004 from './1004.js';

const form1004c = {
  ...form1004,
  id: '1004c',
  label: '1004C — Manufactured Home',
  uspap: 'Fannie Mae Form 1004C Manufactured Home Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a 1004C manufactured home appraisal in Bloomington-Normal, IL.',
  fields: [
    ...form1004.fields,
    {
      id: 'manufactured_home_comments',
      title: 'Manufactured Housing Comments',
      note: '1004C: HUD tags, foundation, and marketability commentary',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address'],
      tpl: 'Write a concise manufactured housing commentary in Charlie Cresci\'s style.\nInclude foundation/chassis/HUD label considerations when available.\nDo NOT invent facts. Use [INSERT] where missing.\nReturn ONLY the narrative text.',
    },
  ],
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Neighborhood and site description completeness (10 pts)
- Market conditions with supported stats (10 pts)
- Manufactured housing comments: HUD labels, foundation certification, chassis/tow-hitch removal, marketability (20 pts)
- Improvements/condition narrative completeness (10 pts)
- Sales comparison approach rigor (15 pts)
- Reconciliation narrative quality (10 pts)
- USPAP compliance / no unsupported statements (5 pts)
- Professional tone + internal consistency (10 pts)
`,
  questionnairePriorities: [
    'HUD label / data plate number and compliance status',
    'Foundation certification type and conformance to FHA/HUD standards',
    'Chassis and tow-hitch removal confirmation',
    'Permanent utility connections and owned vs. leased site',
    'Comparable manufactured home sales (MH vs. site-built distinction)',
    'Subject UAD condition (C1-C6) and quality (Q1-Q6) ratings',
    'Zoning compatibility for manufactured housing',
    'Financing and marketability considerations',
    'Prior sale/listing history for subject (12 and 36 month)',
  ],
  voiceFields: [
    ...form1004.voiceFields,
    { id: 'manufactured_home_comments', title: 'Manufactured Housing Comments' },
  ],
  factsSchema: {
    ...form1004.factsSchema,
    manufacturedHome: {
      hudLabelNumbers: { value: null, confidence: 'low', source: '' },
      dataPlateNumber: { value: null, confidence: 'low', source: '' },
      foundationType: { value: null, confidence: 'low', source: '' },
      foundationCertification: { value: null, confidence: 'low', source: '' },
      chassisRemoved: { value: null, confidence: 'low', source: '' },
      towHitchRemoved: { value: null, confidence: 'low', source: '' },
      siteOwnership: { value: null, confidence: 'low', source: '' },
      permanentUtilities: { value: null, confidence: 'low', source: '' },
      zoningCompliance: { value: null, confidence: 'low', source: '' },
    },
  },
  docTypes: [
    { id: 'purchase_contract', label: 'Purchase Contract' },
    { id: 'public_record', label: 'Public Record' },
    { id: 'appraisal_order', label: 'Appraisal Order' },
    { id: 'mls_sheet', label: 'MLS Sheet' },
    { id: 'hud_labels', label: 'HUD Labels / Data Plate' },
    { id: 'foundation_cert', label: 'Foundation Certification' },
    { id: 'title_docs', label: 'Title / VIN Docs' },
    { id: 'comp_1', label: 'Comparable 1' },
    { id: 'comp_2', label: 'Comparable 2' },
    { id: 'comp_3', label: 'Comparable 3' },
    { id: 'tax_record', label: 'Tax Record' },
    { id: 'photos', label: 'Photo Addendum' },
  ],
};

export default form1004c;
