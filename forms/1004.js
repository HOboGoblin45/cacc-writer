const factsSchema = {
  subject: {
    address: { value: null, confidence: 'low', source: '' },
    city: { value: null, confidence: 'low', source: '' },
    county: { value: null, confidence: 'low', source: '' },
    state: { value: null, confidence: 'low', source: '' },
    parcelId: { value: null, confidence: 'low', source: '' },
    gla: { value: null, confidence: 'low', source: '' },
    beds: { value: null, confidence: 'low', source: '' },
    baths: { value: null, confidence: 'low', source: '' },
    yearBuilt: { value: null, confidence: 'low', source: '' },
    siteSize: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    basement: { value: null, confidence: 'low', source: '' },
    garage: { value: null, confidence: 'low', source: '' },
    condition: { value: null, confidence: 'low', source: '' },
    quality: { value: null, confidence: 'low', source: '' },
    style: { value: null, confidence: 'low', source: '' },
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
    trendStat: { value: null, confidence: 'low', source: '' },
    trendStatSource: { value: null, confidence: 'low', source: '' },
    typicalDOM: { value: null, confidence: 'low', source: '' },
    exposureTime: { value: null, confidence: 'low', source: '' },
    priceRange: { value: null, confidence: 'low', source: '' },
  },
  neighborhood: {
    boundaries: { value: null, confidence: 'low', source: '' },
    description: { value: null, confidence: 'low', source: '' },
    landUse: { value: null, confidence: 'low', source: '' },
    builtUp: { value: null, confidence: 'low', source: '' },
  },
  comps: [
    {
      number: 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 2,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 3,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
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

const form1004 = {
  id: '1004',
  label: '1004 URAR — Single Family',
  uspap: 'URAR Fannie Mae Form 1004',
  extractContext:
    'You are an appraisal data extractor for a 1004 URAR in Bloomington-Normal, IL.',
  fields: [
    {
      id: 'offering_history', title: 'Offering History',
      note: 'ACI: Report data source(s), offering price(s) and date(s)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'contract.contractPrice', 'contract.contractDate'],
      tpl: 'Write the Offering History narrative for a 1004 appraisal in Charlie Cresci\'s concise style.\nDo NOT invent facts. Use [INSERT] for missing data.\nSubject area: {{area}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'contract_analysis', title: 'Contract Analysis',
      note: 'ACI: Analysis of agreement of sale',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.contractPrice', 'contract.contractDate'],
      tpl: 'Write the Contract Analysis narrative for a 1004 appraisal in Charlie Cresci\'s concise style.\nDo NOT invent contract details. Use [INSERT] for missing data.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'concessions', title: 'Concessions / Financial Assistance',
      note: 'ACI: Financial assistance / concessions',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.sellerConcessions'],
      tpl: 'Write the Concessions / Financial Assistance narrative in Charlie Cresci\'s exact style.\n\nCHARLIE\'S CONCESSIONS TEMPLATE (follow this structure):\nIf NO concessions: "There are no seller paid concessions associated with this transaction."\nIf concessions exist: "The seller has agreed to pay [concession_amount] toward the buyer\'s closing costs. This is [typical/atypical] for the market area. Seller concessions in the subject\'s market typically range from [INSERT typical concession range]. The concessions do not appear to have inflated the sale price of the subject."\n\nRules:\n1. Use the concession data from facts. If missing, use [INSERT concessions].\n2. Do NOT invent concession amounts.\n3. Always comment on whether concessions are typical for the market.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'neighborhood_boundaries', title: 'Neighborhood Boundaries',
      note: 'ACI: Neighborhood boundaries statement',
      aiEligibility: 'ai_draft',
      requiredFacts: ['neighborhood.boundaries'],
      tpl: 'Write the Neighborhood Boundaries statement in Charlie Cresci\'s exact style.\n\nCHARLIE\'S BOUNDARIES TEMPLATE:\n"The subject\'s neighborhood boundaries are delineated as follows: [north_boundary] to the north, [south_boundary] to the south, [east_boundary] to the east, and [west_boundary] to the west."\n\nRules:\n1. Use cardinal direction boundary facts (roads, streets, natural features).\n2. Boundaries should be specific (road names, landmarks) — not vague.\n3. If boundaries are unknown, use [INSERT north boundary], etc.\n4. Keep to 1-2 sentences maximum.\nSubject area: {{area}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'neighborhood_description', title: 'Neighborhood Description',
      note: 'ACI: Neighborhood description narrative',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city', 'subject.county'],
      tpl: 'Write the Neighborhood Description in Charlie Cresci\'s exact voice (direct, not fluffy).\n\nCHARLIE\'S NEIGHBORHOOD TEMPLATE (follow this structure):\n"The subject is located in [neighborhood_name/area] on the [direction]side of [city], [county] County, Illinois. The neighborhood is [built-up level — e.g., over 75%, 25-75%] built-up with [land use description — e.g., predominantly single-family residential]. The area features [amenities/characteristics from facts]. The neighborhood boundaries are considered [stable/changing]. Property values have been [stable/increasing/declining] over the past [timeframe]."\n\nRules:\n1. Do NOT use vague phrases like "desirable neighborhood" or "pleasant area."\n2. Reference specific facts: land use percentages, built-up level, neighborhood age range.\n3. Use [INSERT] for unknown specifics.\n4. Keep to 3-5 sentences.\nSubject area: {{area}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'market_conditions', title: 'Market Conditions Addendum',
      note: 'ACI: Market conditions addendum narrative',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.trend'],
      tpl: 'Write the Market Conditions narrative in Charlie Cresci\'s exact voice.\n\nCHARLES\'S ACTUAL MARKET CONDITIONS TEMPLATE (follow this structure exactly):\n"Fixed rate and ARM financing is readily available for qualified borrowers. Rates have [rate_trend - e.g. decreased slightly / remained stable] in the last few months. The area employment remains above average. Local market conditions are considered average. Typical marketing times are under [marketing_time_days] days. Neighborhood appeal is [market_appeal]. Typical sales do involve seller paid concessions. Supply and demand [supply_demand - e.g. are considered in balance / appear to be in favor of demand]."\n\nFill in the bracketed values from the market facts provided. If a value is missing, use [INSERT]. Do NOT use vague phrases like "Market conditions are stable with moderate demand." Use Charles\'s sentence-by-sentence template above.\nMarket stat: {{market_stat}}\nSubject area: {{area}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'site_comments', title: 'Site / Utilities / Adverse Conditions',
      note: 'ACI: Site/utilities/adverse conditions comments',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.siteSize', 'subject.zoning'],
      tpl: 'Write the Site / Utilities / Adverse Conditions comments in Charlie Cresci\'s exact style.\n\nCHARLIE\'S SITE TEMPLATE (follow this structure):\n"The subject site is a [shape — e.g., rectangular, irregular] lot of approximately [site_size]. The site is at street grade with [topography — e.g., level terrain]. Utilities to the site include [public water/private well], [public sewer/private septic], [electricity provider], and [natural gas/propane]. Off-site improvements include [paved streets, concrete curbs, public sidewalks, street lights — list what applies]. [If adverse: State any adverse conditions. If none: No apparent adverse site conditions were observed.]"\n\nRules:\n1. List ALL utilities specifically — do not generalize.\n2. Mention off-site improvements (streets, curbs, sidewalks, street lights).\n3. Use [INSERT] for unknown utility or site data.\n4. State zoning classification and compliance.\n5. Keep to 3-5 sentences.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'improvements_condition', title: 'Improvements / Condition Narrative',
      note: 'ACI: Improvements / condition narrative',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.beds', 'subject.baths', 'subject.condition'],
      tpl: `Write the Improvements/Condition narrative in Charlie Cresci's exact style.

CRITICAL: Use EXACTLY the condition_rating, kitchen_update, and bathroom_update values from the facts block. Do not use values from examples — the facts override everything.

REQUIRED FORMAT (fill in from facts only):
[condition_rating];Kitchen-[kitchen_update];Bathrooms-[bathroom_update];The improvements are well maintained and feature limited physical depreciation due to normal wear and tear. Some components, but not every major building component, may be updated or recently rehabilitated. The structure has been well maintained.

Rules:
1. condition_rating = subject.condition value from facts (e.g. "C3", "C4"). If missing use [INSERT condition].
2. kitchen_update = the kitchen update timeframe from facts (e.g. "updated three to five years ago", "original"). If missing use [INSERT kitchen update].
3. bathroom_update = the bathroom update timeframe from facts (e.g. "updated three to five years ago", "original"). If missing use [INSERT bathroom update].
4. Keep the trailing sentence VERBATIM as shown above.
5. Do NOT invent timeframes. Do NOT copy timeframes from examples. Use only facts.
6. Return ONLY the narrative text.

Subject: {{summary}}`,
    },
    {
      id: 'adverse_conditions', title: 'Adverse Conditions / External Factors',
      note: 'ACI: Adverse conditions and external obsolescence',
      aiEligibility: 'ai_draft',
      requiredFacts: ['site.adverse_conditions'],
      tpl: 'Write the Adverse Conditions narrative for a 1004 appraisal in Charlie Cresci\'s style.\nStandard template when no adverse conditions: \"There are no apparent adverse site conditions, encroachments, environmental conditions, or land uses. The subject appears to have no adverse conditions that would affect the livability, soundness, or structural integrity of the improvements.\"\nWell/septic variant: \"The subject utilizes a private well and septic system. This aspect of the subject property is typical for the market area and has limited impact on marketability.\"\nUse the standard template unless facts indicate well/septic or other adverse conditions.\nReturn ONLY the narrative text.',
    },
    {
      id: 'functional_utility', title: 'Functional Utility',
      note: 'ACI: Functional utility and features of the subject property',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.beds', 'subject.baths'],
      tpl: 'Write the Functional Utility narrative using the subject facts above.\nFormat: "The subject features [spell out number] above grade bedrooms, [spell out number] above grade bathrooms, [features from facts]."\nCRITICAL rules:\n1. Write ALL numbers as English words: four, two, two-and-a-half, three, attached two-car, etc.\n2. Do NOT add article \"a\" before features: write \"living room fireplace\" not \"a living room fireplace\"\n3. Write \"partial\" not \"partially\" for basement: \"partial unfinished basement\" or \"partial finished basement\"\n4. List features without articles: \"living room fireplace, partial unfinished basement, attached two-car garage, patio\"\nReturn ONLY the narrative text (1-2 sentences).',
    },
    {
      id: 'functional_utility_conformity', title: 'Functional Utility / Conformity',
      note: 'ACI: Subject conformity to neighborhood',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.style'],
      tpl: 'Write the Functional Utility / Conformity narrative in Charlie Cresci\'s exact style.\n\nCHARLIE\'S CONFORMITY TEMPLATE:\n"The subject property generally conforms to the neighborhood in terms of age, style, size, and condition. The subject is a [style] style [dwelling_type] that is [typical/atypical] for the area. [If non-conforming: Describe the specific non-conformity and its impact on marketability.]"\n\nRules:\n1. Use subject.style and subject.yearBuilt facts if available.\n2. Mention specific conformity dimensions: age, style, size, condition, quality.\n3. If the subject does NOT conform in any dimension, state which and why.\n4. Use [INSERT] for missing data.\n5. Keep to 2-3 sentences maximum.\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'sales_comparison_commentary', title: 'Sales Comparison Commentary',
      note: 'ACI: Commentary on comparable sales selection and adjustments',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: 'Write the Sales Comparison Commentary in Charlie Cresci\'s exact structure and voice.\n\nCHARLIE\'S SALES COMPARISON COMMENTARY TEMPLATE:\n"The comparable sales were selected based on [selection criteria — e.g., similar location, design, age, condition, GLA, and room count]. Adjustments were made for [list major adjustment categories — e.g., market time, location, condition, GLA, basement, garage]. The comparables bracket the subject in terms of [GLA/condition/quality — state which dimensions]. [If significant adjustments: The largest adjustments were made for {category} due to {reason}.] Net and gross adjustments are within acceptable guidelines."\n\nRules:\n1. Discuss WHY these comps were selected (proximity, similarity).\n2. Reference bracketing of subject characteristics.\n3. Comment on adjustment magnitude WITHOUT inventing specific dollar amounts.\n4. Reference the grid — do not contradict grid values.\n5. Do NOT state a final value conclusion (that belongs in reconciliation).\n6. Use [INSERT] for unknown values.\nSubject area: {{area}}\nSubject: {{summary}}\nReturn ONLY the narrative text.',
    },
    {
      id: 'sca_summary', title: 'Sales Comparison Approach Summary',
      note: 'ACI: Sales comparison approach summary narrative',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: `Write the Sales Comparison Approach summary in Charlie Cresci's EXACT style and voice.

CRITICAL: You must choose ONE of two opening variants based on the facts:

VARIANT A — Standard (use when comps found in subject neighborhood):
"All comparables have been found in the subject's neighborhood on the [north/south/east/west]side of [city], IL and were selected to demonstrate the marketability of houses of a similar location, design, age, [quality,] condition, GLA, room count, and basement finish. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

VARIANT B — Extended search (use when facts indicate lack of comparable sales in neighborhood):
"Due to a lack of recent comparable sales in the subject's neighborhood, an extensive search was made to find [property type] of a similar location, design, quality, condition, and room count. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

RULES (strict):
1. Use Variant B ONLY if the fact market.extended_search is explicitly true OR facts explicitly indicate extended search / lack of neighborhood comps.
2. Use Variant A by default when market.extended_search is false or not set.
3. Fill [X.X]% from market_stat if available (e.g. "0.5%", "1.0%"). If missing, use [INSERT market time adjustment %].
4. Fill [city] from subject city fact. Fill [north/south/east/west]side from neighborhood facts if available.
5. Do NOT invent comp adjustments. Do NOT add adjustment detail lines.
6. End EXACTLY with: "After adjustments are made the comparables provide a good basis for an estimate of market value."
7. Return ONLY the narrative text — no headers, no extra lines.

Subject area: {{area}}
Subject: {{summary}}
Market stat: {{market_stat}}
Extended search: {{market.extended_search}}`,
    },
    {
      id: 'reconciliation', title: 'Reconciliation Narrative',
      note: 'ACI: Reconciliation narrative',
      aiEligibility: 'manual_review',
      requiredFacts: ['subject.gla', 'subject.condition', 'subject.quality'],
      tpl: 'Write the Reconciliation narrative for a 1004 appraisal in Charlie Cresci\'s exact style.\nUse this EXACT template (fill in the blanks):\n"The greatest weight is applied to the Sales Comparison Approach. It provides the best indication to market value. The Cost Approach was not developed at the request of the lender. However, information is held in the appraiser\'s file to complete the Cost Approach if required. The Income Approach was not developed due to the lack of market data. The appraisal is made with the subject in \'as is\' condition. There is no personal property included in the final estimate of value."\nThis template is FIXED - do not change the wording. Copy it verbatim.\nReturn ONLY this narrative text.',
    },
    {
      id: 'exposure_time', title: 'Exposure Time',
      note: 'ACI: Exposure time statement',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.typicalDOM'],
      tpl: 'Write the Exposure Time statement in Charlie Cresci\'s exact style.\n\nCHARLIE\'S EXPOSURE TIME TEMPLATE:\n"Based on the analysis of the comparable sales and market activity in the subject\'s area, the estimated exposure time for the subject property is [exposure_time_range] months, which is consistent with the typical marketing time of [typical_DOM] days observed in the subject\'s market area."\n\nRules:\n1. Exposure time should be stated as a range (e.g., "3-6 months", "1-3 months").\n2. Reference the typical days on market (DOM) from market facts.\n3. If DOM is unknown, use [INSERT typical marketing time].\n4. Do NOT state an exact number — always use a range.\n5. Keep to 1-2 sentences.\nSubject area: {{area}}\nReturn ONLY the narrative text.',
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
  ],
  factsSchema,
  gradingRubric: `
- Contract/offering history completeness (15 pts)
- Neighborhood description + boundaries (10 pts)
- Market conditions with supported stats (15 pts)
- Improvements/condition narrative completeness (10 pts)
- Sales comparison approach rigor (20 pts)
- Reconciliation narrative quality (10 pts)
- USPAP compliance / no unsupported statements (10 pts)
- Professional tone + internal consistency (10 pts)
`,
  questionnairePriorities: [
    'Neighborhood boundaries (if null)',
    'Subject UAD condition (C1-C6) and quality (Q1-Q6) ratings',
    'Functional issues, external obsolescence, adverse site conditions',
    'Comp selection reasoning (why these comps? bracketing issues?)',
    'Seller concessions amount and type',
    'Market trend stat and source (if null)',
    'Prior sale/listing history for subject (12 and 36 month)',
    'Intended use / intended user (if null)',
    'Exposure time rationale',
  ],
  voiceFields: [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'subject_improvements', title: 'Subject Improvements' },
    { id: 'contract_analysis', title: 'Contract Analysis' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation', title: 'Reconciliation' },
    { id: 'prior_sales_subject', title: 'Prior Sales / Offering History' },
    { id: 'listing_history', title: 'Listing History' },
    { id: 'functional_utility', title: 'Functional Utility' },
    { id: 'adverse_conditions', title: 'Adverse Conditions / External Factors' },
    { id: 'final_value_opinion', title: 'Final Value Opinion' },
  ],
};

export default form1004;

