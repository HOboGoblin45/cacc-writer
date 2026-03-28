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
    condition: { value: null, confidence: 'low', source: '' },
    quality: { value: null, confidence: 'low', source: '' },
    style: { value: null, confidence: 'low', source: '' },
    floor: { value: null, confidence: 'low', source: '' },
    view: { value: null, confidence: 'low', source: '' },
    parking: { value: null, confidence: 'low', source: '' },
    storageUnit: { value: null, confidence: 'low', source: '' },
  },
  project: {
    name: { value: null, confidence: 'low', source: '' },
    totalUnits: { value: null, confidence: 'low', source: '' },
    stories: { value: null, confidence: 'low', source: '' },
    yearBuilt: { value: null, confidence: 'low', source: '' },
    developer: { value: null, confidence: 'low', source: '' },
    phase: { value: null, confidence: 'low', source: '' },
    percentSold: { value: null, confidence: 'low', source: '' },
  },
  hoa: {
    monthlyFee: { value: null, confidence: 'low', source: '' },
    includes: { value: null, confidence: 'low', source: '' },
    specialAssessments: { value: null, confidence: 'low', source: '' },
    reserves: { value: null, confidence: 'low', source: '' },
    reserveAdequacy: { value: null, confidence: 'low', source: '' },
    litigation: { value: null, confidence: 'low', source: '' },
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
    condoMarketTrend: { value: null, confidence: 'low', source: '' },
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

const form1073 = {
  id: '1073',
  label: '1073 — Individual Condominium Unit Appraisal Report',
  uspap: 'Fannie Mae Form 1073 Individual Condominium Unit Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a 1073 condominium unit appraisal. Focus on condo-specific features, HOA analysis, project information, unit condition, and comparable condo sales.',
  fields: [
    {
      id: 'offering_history',
      title: 'Offering History',
      note: 'ACI: Report data source(s), offering price(s) and date(s)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'contract.contractPrice', 'contract.contractDate'],
      tpl: `Write the Offering History narrative for a 1073 condominium unit appraisal in Charlie Cresci's concise style.

Focus on:
1. Prior listing/offering history for the subject unit (12-month and 36-month lookback)
2. Current contract terms: price, date, seller concessions if any
3. How the condominium market has affected buyer behavior and pricing

Do NOT invent facts. Use [INSERT] for missing data.
Subject area: {{area}}
Subject: {{summary}} (Unit {{subject.floor}}, {{project.name}})
Return ONLY the narrative text.`,
    },
    {
      id: 'contract_analysis',
      title: 'Contract Analysis',
      note: 'ACI: Analysis of agreement of sale, including HOA/condo-specific terms',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.contractPrice', 'contract.contractDate'],
      tpl: `Write the Contract Analysis narrative for a 1073 condominium appraisal in Charlie Cresci's concise style.

For a condominium unit, address:
1. Contract price and date of agreement
2. Type of financing (conventional, FHA, VA, cash)
3. Any seller assistance or concessions
4. HOA fee assumptions and transfer of duties to new owner
5. Contingencies related to HOA approval, condo documents, or reserve study review

Do NOT invent contract details. Use [INSERT] for missing data.
Subject: {{summary}} ({{project.name}}, Unit {{subject.floor}})
HOA monthly fee: {{hoa.monthlyFee}}
Return ONLY the narrative text.`,
    },
    {
      id: 'concessions',
      title: 'Concessions / Financial Assistance',
      note: 'ACI: Financial assistance / concessions and their market context',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.sellerConcessions'],
      tpl: `Write the Concessions / Financial Assistance narrative in Charlie Cresci's exact style.

CHARLIE'S CONCESSIONS TEMPLATE (follow this structure):
If NO concessions: "There are no seller paid concessions associated with this transaction."
If concessions exist: "The seller has agreed to pay [concession_amount] toward the buyer's closing costs. This is [typical/atypical] for condominium units in the market area. Seller concessions in the subject's market for condominiums typically range from [INSERT typical concession range]. The concessions do not appear to have inflated the sale price of the subject."

Rules:
1. Use the concession data from facts. If missing, use [INSERT concessions].
2. Do NOT invent concession amounts.
3. Always comment on whether concessions are typical for the condominium market.
4. Note HOA fee or reserve funding as potential concession factors if applicable.
Subject: {{summary}} ({{project.name}})
Return ONLY the narrative text.`,
    },
    {
      id: 'neighborhood_boundaries',
      title: 'Neighborhood Boundaries',
      note: 'ACI: Neighborhood boundaries statement, relevant to condo market',
      aiEligibility: 'ai_draft',
      requiredFacts: ['neighborhood.boundaries'],
      tpl: `Write the Neighborhood Boundaries statement in Charlie Cresci's exact style.

CHARLIE'S BOUNDARIES TEMPLATE:
"The subject's neighborhood boundaries are delineated as follows: [north_boundary] to the north, [south_boundary] to the south, [east_boundary] to the east, and [west_boundary] to the west."

Rules:
1. Use cardinal direction boundary facts (roads, streets, natural features).
2. Boundaries should be specific (road names, landmarks) — not vague.
3. If boundaries are unknown, use [INSERT north boundary], etc.
4. Keep to 1-2 sentences maximum.
Subject area: {{area}}
Return ONLY the narrative text.`,
    },
    {
      id: 'neighborhood_description',
      title: 'Neighborhood Description',
      note: 'ACI: Neighborhood description with emphasis on condo market characteristics',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city', 'subject.county'],
      tpl: `Write the Neighborhood Description in Charlie Cresci's exact voice for a condominium unit.

CHARLIE'S NEIGHBORHOOD TEMPLATE (modified for 1073):
"The subject is located in [neighborhood_name/area] on the [direction]side of [city], [county] County, Illinois. The neighborhood is [built-up level — e.g., over 75%, 25-75%] built-up with [land use description]. Condominium and multi-family residential properties comprise approximately [prevalence %] of the neighborhood. The area features [amenities/characteristics from facts]. The neighborhood boundaries are considered [stable/changing]. Property values and condo demand have been [stable/increasing/declining] over the past [timeframe]."

Rules:
1. Do NOT use vague phrases like "desirable neighborhood" or "pleasant area."
2. Reference specific facts: land use percentages, built-up level, condo market prevalence, neighborhood age range.
3. Emphasize condominium market characteristics and multi-family property concentration.
4. Use [INSERT] for unknown specifics.
5. Keep to 4-6 sentences.
Subject area: {{area}}
Subject: {{summary}} ({{project.name}})
Return ONLY the narrative text.`,
    },
    {
      id: 'project_description',
      title: 'Condominium Project Description',
      note: 'ACI: Project name, age, total units, stories, common areas',
      aiEligibility: 'ai_draft',
      requiredFacts: ['project.name', 'project.totalUnits', 'project.stories'],
      tpl: `Write the Condominium Project Description in Charlie Cresci's exact style.

CHARLIE'S PROJECT DESCRIPTION TEMPLATE:
"The subject unit is located in {{project.name}}, a condominium project consisting of [total_units] total units in [stories] stories. The project was constructed in [year_built]. [If applicable: The project was developed by [developer_name] and is currently [X%] sold.] Common areas and amenities include [list: parking facilities, pool, fitness center, community room, landscaped grounds, etc.]. The project is organized under a homeowner association (HOA) that oversees maintenance of common areas and enforces condo rules and regulations."

Rules:
1. Use project facts: name, total units, stories, year built, developer, percentage sold.
2. List specific common areas and amenities if available in facts.
3. Note project phase if applicable.
4. Comment on project marketability or desirability if supported by facts.
5. Do NOT invent amenities not provided in facts. Use [INSERT] for missing details.
6. Keep to 4-6 sentences.
Subject: {{summary}} ({{project.name}})
Project: {{project.name}} | Units: {{project.totalUnits}} | Stories: {{project.stories}} | Built: {{project.yearBuilt}}
Return ONLY the narrative text.`,
    },
    {
      id: 'project_analysis',
      title: 'Condominium Project Analysis',
      note: 'ACI: Budget analysis, reserve adequacy, special assessments, litigation',
      aiEligibility: 'ai_draft',
      requiredFacts: ['project.name', 'hoa.reserves'],
      tpl: `Write the Condominium Project Analysis in Charlie Cresci's exact style.

CHARLIE'S PROJECT ANALYSIS TEMPLATE:
"The condominium project's financial stability is important to the marketability and value of the subject unit. The HOA budget includes reserves for major capital expenditures and ongoing maintenance. Reserve funding status: [adequately funded / underfunded / special assessment pending]. [If adequate reserves: The project maintains adequate reserves (typically 25-50% of annual operating budget) for major replacements and unexpected repairs.] [If special assessments: Special assessments have been or may be imposed on unit owners for [specific purpose — e.g., roof replacement, foundation repair, parking lot resurfacing]. Owners should be aware of any pending or anticipated special assessment obligations.] [If litigation: The project is [not] involved in material litigation affecting unit owners.] The project appears to be [warrantable / adequately maintained / in need of repairs] from a condo financing perspective."

Rules:
1. Address reserve adequacy from facts: adequate, underfunded, or inadequate.
2. Note special assessments if provided in facts.
3. Address litigation status if provided.
4. Comment on FHA/VA/financing warrantability if determinable.
5. Use [INSERT] for missing details about reserves, assessments, or litigation.
6. Keep factual language consistent with appraisal standards.
7. Return ONLY the narrative text.

Reserve status: {{hoa.reserves}}
Special assessments: {{hoa.specialAssessments}}
Litigation: {{hoa.litigation}}
Project: {{project.name}}`,
    },
    {
      id: 'hoa_analysis',
      title: 'HOA Analysis',
      note: 'ACI: HOA fees, what included, fee history, comparison to market',
      aiEligibility: 'ai_draft',
      requiredFacts: ['hoa.monthlyFee', 'hoa.includes'],
      tpl: `Write the HOA Analysis in Charlie Cresci's exact style for a condominium unit.

CHARLIE'S HOA ANALYSIS TEMPLATE:
"The subject condominium is subject to a monthly homeowner association (HOA) fee of $[monthly_fee]. The HOA fee includes [specific items — e.g., property taxes on common areas, insurance on building, trash collection, exterior maintenance, landscaping, pool maintenance, fitness center operations, parking maintenance, etc.]. [If fee history available: The HOA fee has [remained stable / increased by X% annually / varied significantly] over the past [timeframe].] Comparable condominium projects in the subject's market area typically charge HOA fees ranging from $[low] to $[high] per month depending on amenities and reserve funding. The subject's HOA fee of $[monthly_fee] [is typical / is above market / is below market] for the project's size, age, amenities, and reserve status. The monthly fee is a significant consideration in the subject unit's affordability and marketability."

Rules:
1. Use actual HOA monthly fee from facts.
2. List ALL items included in HOA fee (not just select items).
3. Note fee history (stable, increasing, variable) if available.
4. Reference comparable condo HOA fees if available.
5. Comment on whether subject fee is typical, above, or below market.
6. Use [INSERT] for missing information.
7. Keep to 5-7 sentences. Return ONLY the narrative text.

HOA monthly fee: {{hoa.monthlyFee}}
HOA includes: {{hoa.includes}}
Project: {{project.name}}`,
    },
    {
      id: 'market_conditions',
      title: 'Market Conditions Addendum',
      note: 'ACI: Market conditions with emphasis on condominium market data',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.trend'],
      tpl: `Write the Market Conditions narrative in Charlie Cresci's exact voice for a 1073 condominium unit.

CHARLIE'S MARKET CONDITIONS TEMPLATE (modified for condo market):
"Fixed rate and ARM financing is readily available for qualified borrowers purchasing condominium units. Rates have [rate_trend - e.g. decreased slightly / remained stable] in the last few months. The area employment remains [above average / average / below average]. Local market conditions are [balanced / favoring demand / favoring supply]. Typical marketing times for condominium units are [marketing_time_days] days. Condominium market conditions in the subject's area show [condo_trend]. [If applicable: New construction condominiums are [available / limited] in the market area.] Supply and demand [supply_demand - e.g. are considered in balance / appear to be in favor of demand]."

Rules:
1. Reference condo-specific market data and trends.
2. Comment on new condo construction if relevant.
3. Address condo financing availability (FHA/VA restrictions may apply).
4. Fill [X.X]% from market facts. If missing, use [INSERT].
5. Keep to 5-7 sentences. Return ONLY the narrative text.

Market stat: {{market_stat}}
Condo trend: {{market.condoMarketTrend}}
Subject area: {{area}}
Return ONLY the narrative text.`,
    },
    {
      id: 'site_comments',
      title: 'Site / Common Areas / Adverse Conditions',
      note: 'ACI: Building site, common areas, amenities, adverse conditions',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'project.name'],
      tpl: `Write the Site / Common Areas / Adverse Conditions comments in Charlie Cresci's exact style for a condominium unit.

CHARLIE'S SITE TEMPLATE (modified for condo):
"The subject unit is located in {{project.name}}, a condominium project situated on approximately [site_size] of land. The site includes [describe parking — e.g., assigned covered parking, assigned open parking, guest parking, etc.], common area grounds, and [other site features]. The building and common areas are maintained by the HOA. Common amenities include [specific list from facts: pool, fitness center, community room, landscaped grounds, etc.]. [If adverse conditions: State any adverse conditions affecting the condo project or unit marketability. If none: No apparent adverse site conditions were observed that would negatively impact the marketability of the subject unit.]"

Rules:
1. Reference project name and site characteristics.
2. Describe parking arrangements specifically.
3. List ALL common amenities from facts.
4. Note site condition and maintenance level.
5. Address any adverse conditions or constraints.
6. Use [INSERT] for unknown site or amenity details.
7. Keep to 4-6 sentences. Return ONLY the narrative text.

Project: {{project.name}}
Subject: {{summary}} (Unit {{subject.floor}})
Return ONLY the narrative text.`,
    },
    {
      id: 'subject_description',
      title: 'Subject Unit Description',
      note: 'ACI: Unit-specific features, floor level, view, parking, storage',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.beds', 'subject.baths', 'subject.floor'],
      tpl: `Write the Subject Unit Description in Charlie Cresci's exact style.

CHARLIE'S UNIT DESCRIPTION TEMPLATE:
"The subject unit is a [insert description: studio / one-bedroom / two-bedroom / etc.] condominium unit located on the [floor_level] floor of {{project.name}}. The unit features [beds] bedrooms, [baths] bathrooms, and approximately [gla] square feet of gross living area. [If floor level note: Being located on the [floor_level] floor, the unit offers [specific advantages — e.g., enhanced privacy, natural light, view potential, etc.].] [If view: The unit features [view description — e.g., golf course view, lake view, city view, courtyard view, etc.].] [If parking: Parking for the unit includes [description — e.g., assigned covered parking space(s), assigned open parking, guest parking access, etc.].] [If storage: The unit includes [storage description — e.g., assigned storage locker, walk-in closets, pantry, basement storage, etc.].] The unit layout is [describe layout — e.g., open floor plan, traditional compartmentalized, galley kitchen, etc.] and typical for the project."

Rules:
1. Use exact bedroom and bathroom count from facts.
2. Include GLA and floor level.
3. Note specific unit features: view, parking type, storage.
4. Describe layout briefly if available.
5. Comment on unit's desirability relative to project typical units.
6. Use [INSERT] for missing specific details.
7. Keep to 5-7 sentences. Return ONLY the narrative text.

Subject: {{summary}}
Floor: {{subject.floor}} | View: {{subject.view}} | Parking: {{subject.parking}}
Return ONLY the narrative text.`,
    },
    {
      id: 'improvements_condition',
      title: 'Improvements / Condition Narrative',
      note: 'ACI: Unit and building condition, updates, deferred maintenance',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: `Write the Improvements/Condition narrative in Charlie Cresci's exact style for a 1073 condominium unit.

REQUIRED FORMAT (fill in from facts only):
[condition_rating];Kitchen-[kitchen_update];Bathrooms-[bathroom_update];The unit is [well/adequately] maintained and features [minimal/moderate/significant] physical depreciation. Some components may be updated or recently renovated. The building exterior and common areas have been [recently updated/adequately maintained/in need of repairs]. The structure has been [well/adequately] maintained overall.

Rules:
1. condition_rating = subject.condition value from facts (e.g. "C3", "C4"). If missing use [INSERT condition].
2. kitchen_update = the kitchen update timeframe from facts (e.g. "updated three to five years ago", "original"). If missing use [INSERT kitchen update].
3. bathroom_update = the bathroom update timeframe from facts (e.g. "updated three to five years ago", "original"). If missing use [INSERT bathroom update].
4. Describe unit interior condition and building/common area condition separately.
5. Do NOT invent timeframes. Use only facts.
6. Return ONLY the narrative text.

Subject: {{summary}} ({{project.name}})`,
    },
    {
      id: 'functional_utility',
      title: 'Functional Utility',
      note: 'ACI: Unit layout, bedroom/bathroom configuration, and functional features',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.beds', 'subject.baths', 'subject.gla'],
      tpl: `Write the Functional Utility narrative for a 1073 condominium unit in Charlie Cresci's style.

FORMAT: "The subject unit features [spell out number] above grade bedrooms, [spell out number] above grade bathrooms, and [list functional features — e.g., separate entry, balcony/patio, laundry hookup, den/office, etc.]. Common areas within the project include [list: pool, fitness center, community room, etc.] which enhance the functional appeal of the unit. The unit layout is [describe: open, traditional, galley kitchen, etc.] and is [typical / somewhat atypical] for the project. Overall, the functional utility is [excellent / good / adequate / limited] for a [unit type] condominium unit."

CRITICAL rules:
1. Write ALL numbers as English words: four, two, two-and-a-half, three, etc.
2. List features without articles: "living room fireplace" not "a living room fireplace"
3. Describe balcony/patio, laundry, etc.
4. Note how unit layout supports functional use.
5. Comment on functionality relative to project type.
6. Return ONLY the narrative text (2-4 sentences).

Subject: {{summary}} ({{project.name}})`,
    },
    {
      id: 'functional_utility_conformity',
      title: 'Functional Utility / Conformity',
      note: 'ACI: Unit conformity to project, design, and condo market standards',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.style', 'subject.yearBuilt'],
      tpl: `Write the Functional Utility / Conformity narrative in Charlie Cresci's exact style for a 1073 unit.

CHARLIE'S CONFORMITY TEMPLATE (modified for condo):
"The subject unit generally conforms to comparable units in {{project.name}} in terms of age, finish quality, layout, and condition. The unit is a [style] style unit that is [typical/atypical] for the project. [If non-conforming: Describe the specific non-conformity — e.g., 'The subject features a [feature] which is less typical than comparable units in the project' — and its impact on marketability within the condo community.] The unit's bedroom/bathroom configuration and size are [typical/atypical] for the project."

Rules:
1. Use subject.style and subject.yearBuilt facts if available.
2. Reference conformity to PROJECT, not neighborhood (for condo units).
3. Mention specific conformity dimensions: layout, size, quality, condition.
4. Address bedroom/bath configuration conformity to similar project units.
5. If the subject does NOT conform in any dimension, state which and why, with impact on unit value.
6. Use [INSERT] for missing data.
7. Keep to 2-3 sentences maximum.
Subject: {{summary}} ({{project.name}})
Return ONLY the narrative text.`,
    },
    {
      id: 'highest_best_use',
      title: 'Highest & Best Use',
      note: 'ACI: As improved (owner-occupancy or investment)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'project.name'],
      tpl: `Write the Highest and Best Use narrative for a 1073 condominium unit in Charlie Cresci's style.

CHARLIE'S HBU TEMPLATE (modified for condo):
"The subject unit is a condominium unit subject to the restrictions, covenants, and conditions of {{project.name}} homeowner association. The highest and best use as improved is continued use as a [owner-occupied residential unit / investment condominium unit]. This conclusion is supported by the four tests of highest and best use: Legally permissible (zoning permits residential condominium use and HOA CC&Rs do not restrict use); Physically possible (unit structure and project support [owner-occupancy / investment] use); Financially feasible (market demand for [owner-occupant / investor] purchasers is evident); and Maximally productive (continued residential use is [owner-occupied / investment] generates superior income and value relative to alternative uses)."

Rules:
1. Note HOA restrictions and CC&Rs impact on highest and best use.
2. Determine primary market: owner-occupancy or investment.
3. Reference all four HBU tests.
4. Use [INSERT] for specific zoning details if not provided.
5. Keep to 3-4 sentences. Return ONLY the narrative text.

Subject: {{summary}} ({{project.name}})`,
    },
    {
      id: 'sales_comparison_commentary',
      title: 'Sales Comparison Commentary',
      note: 'ACI: Comp selection, unit-level and project-level adjustments',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: `Write the Sales Comparison Commentary in Charlie Cresci's exact structure and voice for a 1073 unit.

CHARLIE'S SALES COMPARISON COMMENTARY TEMPLATE (modified for condo):
"The comparable sales were selected based on [selection criteria — e.g., similar condominium units within the same project or nearby projects of similar design, age, condition, floor level, view, unit mix, and amenities]. Adjustments were made for [list major adjustment categories — e.g., time/market conditions, location within project, floor level, view, condition, GLA, parking, HOA fees]. [If within-project comps: Most comparables are from the same or nearby condominium projects of similar design and amenities, providing strong comparability.] [If significant adjustments: The largest adjustments were made for {category} due to {reason}.] The comparables bracket the subject in terms of [GLA/condition/floor level/view — state which dimensions]. Net and gross adjustments are within acceptable guidelines."

Rules:
1. Discuss WHY these comps were selected (project proximity, unit comparability, project similarity).
2. Reference bracketing of subject characteristics.
3. Comment on adjustment magnitude WITHOUT inventing specific dollar amounts.
4. Reference the grid — do not contradict grid values.
5. Note if comps are primarily from same project vs. comparable projects.
6. Do NOT state a final value conclusion (that belongs in reconciliation).
7. Use [INSERT] for unknown values.
Subject area: {{area}}
Subject: {{summary}} ({{project.name}})
Return ONLY the narrative text.`,
    },
    {
      id: 'sca_summary',
      title: 'Sales Comparison Approach Summary',
      note: 'ACI: Sales comparison approach summary for condo units',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: `Write the Sales Comparison Approach summary in Charlie Cresci's EXACT style and voice for a 1073 unit.

CRITICAL: You must choose ONE of two opening variants based on the facts:

VARIANT A — Within-project/nearby comps (use when comps found in same or nearby projects):
"All comparables have been found within {{project.name}} or in comparable condominium projects in the same geographic area and were selected to demonstrate the marketability of condominium units of similar location, design, age, condition, unit size, floor level, view, and amenities. The comparable condominium units have received adjustments for current market conditions and time adjustments based on recent condo market trends. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

VARIANT B — Extended search (use when facts indicate lack of comparable sales in project/nearby):
"Due to a lack of recent comparable sales of condominium units within {{project.name}} or nearby projects, an extensive search was made to find condominium units of a similar location, design, condition, unit size, view, and amenities. The comparable units have received adjustments for differences in location, project amenities, and local market conditions. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

RULES (strict):
1. Use Variant B ONLY if the fact market.extended_search is explicitly true OR facts explicitly indicate extended search.
2. Use Variant A by default when market.extended_search is false or not set.
3. Fill [X.X]% from market_stat if available. If missing, use [INSERT market time adjustment %].
4. Emphasize unit and project comparability (not just structure).
5. Do NOT invent comp adjustments. Do NOT add adjustment detail lines.
6. End EXACTLY with: "After adjustments are made the comparables provide a good basis for an estimate of market value."
7. Return ONLY the narrative text — no headers, no extra lines.

Subject area: {{area}}
Subject: {{summary}} ({{project.name}})
Market stat: {{market_stat}}
Extended search: {{market.extended_search}}`,
    },
    {
      id: 'reconciliation',
      title: 'Reconciliation Narrative',
      note: 'ACI: Reconciliation narrative for condo unit valuation',
      aiEligibility: 'manual_review',
      requiredFacts: ['subject.gla', 'subject.condition'],
      tpl: `Write the Reconciliation narrative for a 1073 appraisal in Charlie Cresci's exact style.

RECONCILIATION TEMPLATE (for 1073 condominium unit):
"In valuing this condominium unit, the Sales Comparison Approach has been developed.

Sales Comparison Approach:
The Sales Comparison Approach provides the primary indication of value for the subject condominium unit based on recent sales of comparable units within the same project and comparable nearby condominium projects. The comparable units analyzed indicate a value range of [INSERT range], with an indicated value of [INSERT]. This approach is given PRIMARY weight due to the availability of comparable condominium unit sales and the direct market evidence of buyer demand for similar units in the subject's market area.

Unit-Level and Project-Level Considerations:
The subject unit's specific characteristics including [floor level, view, condition, parking, storage] have been analyzed relative to comparable units. The underlying project's amenities, HOA financial status, and market position have been considered in the valuation analysis. These factors support the value indication derived from comparable sales.

Final Value Opinion:
Weighing the sales comparison evidence, the final value opinion for the subject condominium unit is [INSERT VALUE]. The appraisal is made with the subject in 'as is' condition. There is no personal property included in the final estimate of value."

Rules:
1. State that Sales Comparison Approach is PRIMARY for condo units.
2. Explain comp selection and adjustment strategy briefly.
3. Mention unit-level factors (floor, view, condition, parking).
4. Mention project-level factors (HOA financial status, amenities, marketability).
5. Use [INSERT] for value conclusions and ranges.
6. Keep to 5-7 sentences. Return ONLY the narrative text.

Subject: {{summary}} ({{project.name}})`,
    },
    {
      id: 'exposure_time',
      title: 'Exposure Time',
      note: 'ACI: Exposure time statement for condominium market',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.typicalDOM'],
      tpl: `Write the Exposure Time statement in Charlie Cresci's exact style for a 1073 unit.

CHARLIE'S EXPOSURE TIME TEMPLATE (modified for condo):
"Based on the analysis of the comparable sales and market activity in the subject's area, the estimated exposure time for the subject condominium unit is [exposure_time_range] months, which is consistent with the typical marketing time of [typical_DOM] days observed in the subject's market area for condominium units of similar design, condition, and project amenities. [If market conditions support: The [appreciating/stable/declining] condominium market in the subject's area [supports shorter/longer] marketing periods than historical norms.]"

Rules:
1. Exposure time should be stated as a range (e.g., "2-4 months", "3-6 months").
2. Reference the typical days on market (DOM) from market facts.
3. If DOM is unknown, use [INSERT typical marketing time].
4. Do NOT state an exact number — always use a range.
5. Note how condo market conditions affect exposure time.
6. Keep to 2-3 sentences.
Subject area: {{area}}
Subject: {{summary}} ({{project.name}})
Return ONLY the narrative text.`,
    },
  ],
  docTypes: [
    { id: 'purchase_contract', label: 'Purchase Contract' },
    { id: 'public_record', label: 'Public Record' },
    { id: 'appraisal_order', label: 'Appraisal Order' },
    { id: 'mls_sheet', label: 'MLS Sheet' },
    { id: 'hoa_documents', label: 'HOA Documents / CC&Rs' },
    { id: 'reserve_study', label: 'Reserve Study' },
    { id: 'condo_questionnaire', label: 'Condo Questionnaire' },
    { id: 'comp_1', label: 'Comparable 1' },
    { id: 'comp_2', label: 'Comparable 2' },
    { id: 'comp_3', label: 'Comparable 3' },
    { id: 'tax_record', label: 'Tax Record' },
    { id: 'photos', label: 'Photo Addendum' },
  ],
  factsSchema,
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Project description with amenities and status (10 pts)
- HOA analysis with fee comparison and reserve adequacy (15 pts)
- Neighborhood and market conditions with condo market focus (10 pts)
- Unit and building condition narrative (10 pts)
- Sales comparison approach with condo-specific adjustments (20 pts)
- Reconciliation narrative quality (10 pts)
- USPAP compliance / no unsupported statements (10 pts)
- Professional tone + internal consistency (5 pts)
`,
  questionnairePriorities: [
    'Project name, total units, stories, developer, year built',
    'HOA monthly fee and what is included in that fee',
    'HOA reserve funding status and any special assessments pending',
    'HOA litigation status and impact on financing',
    'Subject unit floor level, view, parking type, storage',
    'Unit condition and major updates (kitchen, bathrooms, appliances)',
    'Project common amenities and facilities',
    'HOA fee trend (increasing, stable, variable)',
    'Comparable condo HOA fees and amenity comparisons',
    'Project occupancy/resale rate and market demand',
    'FHA/VA financing restrictions or warnings for project',
    'Comparable condo unit sales within project and nearby',
    'Seller concessions amount and market context',
    'Market trend for condo units in area',
    'Prior sale/listing history for subject unit (12 and 36 month)',
  ],
  voiceFields: [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'project_description', title: 'Condominium Project Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'subject_description', title: 'Subject Unit Description' },
    { id: 'improvements_condition', title: 'Unit & Building Condition' },
    { id: 'hoa_analysis', title: 'HOA Analysis' },
    { id: 'project_analysis', title: 'Project Financial Analysis' },
    { id: 'contract_analysis', title: 'Contract Analysis' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation', title: 'Reconciliation' },
    { id: 'offering_history', title: 'Offering History' },
    { id: 'site_comments', title: 'Site / Common Areas / Adverse Conditions' },
  ],
};

export default form1073;
