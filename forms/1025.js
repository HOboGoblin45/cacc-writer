const factsSchema = {
  subject: {
    address: { value: null, confidence: 'low', source: '' },
    city: { value: null, confidence: 'low', source: '' },
    county: { value: null, confidence: 'low', source: '' },
    state: { value: null, confidence: 'low', source: '' },
    parcelId: { value: null, confidence: 'low', source: '' },
    unitCount: { value: null, confidence: 'low', source: '' },
    totalGLA: { value: null, confidence: 'low', source: '' },
    averageUnitGLA: { value: null, confidence: 'low', source: '' },
    bedsByUnit: { value: null, confidence: 'low', source: '' },
    bathsByUnit: { value: null, confidence: 'low', source: '' },
    yearBuilt: { value: null, confidence: 'low', source: '' },
    siteSize: { value: null, confidence: 'low', source: '' },
    zoning: { value: null, confidence: 'low', source: '' },
    basement: { value: null, confidence: 'low', source: '' },
    garage: { value: null, confidence: 'low', source: '' },
    condition: { value: null, confidence: 'low', source: '' },
    quality: { value: null, confidence: 'low', source: '' },
    style: { value: null, confidence: 'low', source: '' },
    rentalUnits: { value: null, confidence: 'low', source: '' },
    ownerOccupiedUnits: { value: null, confidence: 'low', source: '' },
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
    rentalMarketTrend: { value: null, confidence: 'low', source: '' },
    vacancyRate: { value: null, confidence: 'low', source: '' },
    vacancyRateSource: { value: null, confidence: 'low', source: '' },
    extended_search: { value: false, confidence: 'high', source: '' },
  },
  neighborhood: {
    boundaries: { value: null, confidence: 'low', source: '' },
    description: { value: null, confidence: 'low', source: '' },
    landUse: { value: null, confidence: 'low', source: '' },
    builtUp: { value: null, confidence: 'low', source: '' },
    multiFamilyPrevalence: { value: null, confidence: 'low', source: '' },
  },
  comps: [
    {
      number: 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitCount: { value: null, confidence: 'low', source: '' },
      totalGLA: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 2,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitCount: { value: null, confidence: 'low', source: '' },
      totalGLA: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
    },
    {
      number: 3,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      unitCount: { value: null, confidence: 'low', source: '' },
      totalGLA: { value: null, confidence: 'low', source: '' },
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
    capRateIndication: { value: null, confidence: 'low', source: '' },
    capRateSource: { value: null, confidence: 'low', source: '' },
    rentMultiplier: { value: null, confidence: 'low', source: '' },
  },
};

const form1025 = {
  id: '1025',
  label: '1025 — Small Residential Income (2-4 Unit)',
  uspap: 'Fannie Mae Form 1025 Small Residential Income Property Appraisal Report',
  extractContext:
    'You are an appraisal data extractor for a 1025 small residential income appraisal. Focus on rent data, lease terms, income/expense analysis, multi-unit configuration, and rental market conditions.',
  fields: [
    {
      id: 'offering_history',
      title: 'Offering History',
      note: 'ACI: Report data source(s), offering price(s) and date(s)',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'contract.contractPrice', 'contract.contractDate'],
      tpl: `Write the Offering History narrative for a 1025 small residential income appraisal in Charlie Cresci's concise style.

Focus on:
1. Prior listing/offering history for the subject property (12-month and 36-month lookback)
2. Current contract terms: price, date, seller concessions if any
3. How the rental market has affected buyer behavior and pricing

Do NOT invent facts. Use [INSERT] for missing data.
Subject area: {{area}}
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'contract_analysis',
      title: 'Contract Analysis',
      note: 'ACI: Analysis of agreement of sale, including terms relevant to rental property',
      aiEligibility: 'ai_draft',
      requiredFacts: ['contract.contractPrice', 'contract.contractDate'],
      tpl: `Write the Contract Analysis narrative for a 1025 appraisal in Charlie Cresci's concise style.

For a small residential income property, address:
1. Contract price and date of agreement
2. Type of financing (conventional, FHA, portfolio, cash)
3. Any seller assistance or concessions
4. Lease assumptions (leases binding to new owner, etc.)
5. Contingencies related to rent verification or lease review

Do NOT invent contract details. Use [INSERT] for missing data.
Subject: {{summary}} ({{subject.unitCount}} units, {{subject.rentalUnits}} rental units)
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
If concessions exist: "The seller has agreed to pay [concession_amount] toward the buyer's closing costs. This is [typical/atypical] for small residential income properties in the market area. Seller concessions in the subject's market for multi-unit rentals typically range from [INSERT typical concession range]. The concessions do not appear to have inflated the sale price of the subject."

Rules:
1. Use the concession data from facts. If missing, use [INSERT concessions].
2. Do NOT invent concession amounts.
3. Always comment on whether concessions are typical for the multi-unit rental market.
4. For income properties, note if concessions relate to lease assumption or tenant relations.
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'neighborhood_boundaries',
      title: 'Neighborhood Boundaries',
      note: 'ACI: Neighborhood boundaries statement, relevant to multi-family market',
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
      note: 'ACI: Neighborhood description with emphasis on rental market and multi-family prevalence',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.city', 'subject.county'],
      tpl: `Write the Neighborhood Description in Charlie Cresci's exact voice for a small residential income property.

CHARLIE'S NEIGHBORHOOD TEMPLATE (modified for 1025):
"The subject is located in [neighborhood_name/area] on the [direction]side of [city], [county] County, Illinois. The neighborhood is [built-up level — e.g., over 75%, 25-75%] built-up with [land use description]. Multi-family residential properties comprise approximately [multi-family prevalence %] of the neighborhood. The area features [amenities/characteristics from facts]. The neighborhood boundaries are considered [stable/changing]. Property values and rental demand have been [stable/increasing/declining] over the past [timeframe]."

Rules:
1. Do NOT use vague phrases like "desirable neighborhood" or "pleasant area."
2. Reference specific facts: land use percentages, built-up level, multi-family prevalence, neighborhood age range.
3. Emphasize rental market characteristics and multi-family property concentration.
4. Use [INSERT] for unknown specifics.
5. Keep to 4-6 sentences.
Subject area: {{area}}
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'market_conditions',
      title: 'Market Conditions Addendum',
      note: 'ACI: Market conditions with emphasis on rental market data and vacancy rates',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.trend', 'market.vacancyRate'],
      tpl: `Write the Market Conditions narrative in Charlie Cresci's exact voice for a 1025 income property.

CHARLIE'S MARKET CONDITIONS TEMPLATE (modified for rental market):
"Fixed rate and ARM financing is readily available for qualified borrowers. Rates have [rate_trend - e.g. decreased slightly / remained stable] in the last few months. The area employment remains [above average / average / below average]. Local market conditions are [balanced / favoring demand / favoring supply]. Typical marketing times for multi-unit residential properties are [marketing_time_days] days. Rental market conditions in the subject's area show [rental_trend]. Vacancy rates typically range from [INSERT vacancy range]%. Supply and demand [supply_demand - e.g. are considered in balance / appear to be in favor of demand]."

Fill in the bracketed values from the market facts provided. If a value is missing, use [INSERT]. Reference the vacancy rate facts if available.
Market stat: {{market_stat}}
Vacancy rate: {{market.vacancyRate}}
Rental trend: {{market.rentalMarketTrend}}
Subject area: {{area}}
Return ONLY the narrative text.`,
    },
    {
      id: 'site_comments',
      title: 'Site / Utilities / Adverse Conditions',
      note: 'ACI: Site/utilities/adverse conditions, emphasizing multi-family zoning and configuration',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.address', 'subject.siteSize', 'subject.zoning'],
      tpl: `Write the Site / Utilities / Adverse Conditions comments in Charlie Cresci's exact style for a multi-unit property.

CHARLIE'S SITE TEMPLATE (modified for 1025):
"The subject site is a [shape — e.g., rectangular, irregular] lot of approximately [site_size]. The site is at street grade with [topography — e.g., level terrain]. The property is zoned [zoning classification], which permits multi-family residential use and is consistent with the subject's current use. Utilities to the site include [public water/private well], [public sewer/private septic], [electricity provider], and [natural gas/propane]. Off-site improvements include [paved streets, concrete curbs, public sidewalks, street lights — list what applies]. [If adverse: State any adverse conditions affecting rental viability or property marketability. If none: No apparent adverse site conditions were observed.]"

Rules:
1. List ALL utilities specifically — do not generalize.
2. Emphasize multi-family zoning and its compatibility with current use.
3. Mention off-site improvements (streets, curbs, sidewalks, street lights).
4. Address site layout as it relates to rental unit configuration.
5. Use [INSERT] for unknown utility or site data.
6. Keep to 4-6 sentences.
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'improvements_condition',
      title: 'Improvements / Condition Narrative',
      note: 'ACI: Improvements and condition for multi-unit property with common areas',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.totalGLA', 'subject.unitCount', 'subject.condition'],
      tpl: `Write the Improvements/Condition narrative in Charlie Cresci's exact style for a 1025 multi-unit property.

STRUCTURE FOR 1025:
[condition_rating];[unit_mix — e.g., "Two 2-bed/1-bath units, two 1-bed/1-bath units"];[Kitchen condition — e.g., "Kitchens updated within the past five years"];[Bathroom condition — e.g., "Bathrooms original to structure"];Common areas include [list: foyer, basement, shared laundry, etc.]. The improvements are [well/adequately/fair condition] and feature [minimal/moderate/significant] physical depreciation. Major building components have been [recently updated/updated within the past decade/not recently updated]. The structure has been [well/adequately] maintained.

Rules:
1. Use condition_rating from facts (e.g., "C3", "C4").
2. Describe unit mix: bedroom/bathroom count and diversity.
3. Note kitchen and bathroom update status for the units.
4. Describe common areas relevant to rental operation.
5. Do NOT invent update timeframes. Use only facts.
6. Return ONLY the narrative text.

Subject: {{summary}} ({{subject.unitCount}} units, {{subject.totalGLA}} GLA)`,
    },
    {
      id: 'adverse_conditions',
      title: 'Adverse Conditions / External Factors',
      note: 'ACI: Adverse conditions and external obsolescence affecting rental viability',
      aiEligibility: 'ai_draft',
      requiredFacts: ['site.adverse_conditions'],
      tpl: `Write the Adverse Conditions narrative for a 1025 appraisal in Charlie Cresci's style.

For a small residential income property, consider:
1. Environmental issues or hazards
2. Neighborhood decline or deterioration
3. External noise, traffic, or nuisance factors
4. Zoning conflicts or legal encumbrances
5. Physical site constraints affecting rental marketability

Standard template when no adverse conditions: "There are no apparent adverse site conditions, encroachments, environmental conditions, or land uses. The subject appears to have no adverse conditions that would affect the livability, soundness, or structural integrity of the improvements or the rental viability of the property."

Well/septic variant: "The subject utilizes a private well and septic system. This aspect of the subject property is typical for the market area for properties of this type and has limited impact on marketability or rental income."

Use the standard template unless facts indicate well/septic or other adverse conditions specific to rental operation.
Return ONLY the narrative text.`,
    },
    {
      id: 'functional_utility',
      title: 'Functional Utility',
      note: 'ACI: Functional utility for multi-unit layout and unit mix',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.unitCount', 'subject.bedsByUnit', 'subject.bathsByUnit'],
      tpl: `Write the Functional Utility narrative for a 1025 property in Charlie Cresci's style.

FORMAT: "The subject contains [number] rental units with the following configuration: [unit breakdown by bedroom/bathroom count]. Each unit features [amenities by unit type — e.g., 'separate entry, in-unit laundry hookups'] as applicable. Common areas include [list from facts: shared laundry, storage, outdoor space, parking, etc.]. The layout and unit mix are [typical/atypical] for the market area and [favorable/acceptable/limited] from a rental operations perspective."

CRITICAL rules:
1. Write ALL numbers as English words: four, two, two-and-a-half, three, etc.
2. List unit mix explicitly (e.g., "two two-bedroom units and two one-bedroom units").
3. Describe functional elements that support rental income: entry access, laundry, parking, storage.
4. Do NOT add articles before features: write "laundry hookup" not "a laundry hookup".
5. Emphasize how the layout supports efficient multi-unit management.
6. Return ONLY the narrative text (2-4 sentences).

Subject: {{summary}} ({{subject.unitCount}} units)`,
    },
    {
      id: 'functional_utility_conformity',
      title: 'Functional Utility / Conformity',
      note: 'ACI: Subject conformity to neighborhood and multi-unit rental market',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.style', 'subject.yearBuilt'],
      tpl: `Write the Functional Utility / Conformity narrative in Charlie Cresci's exact style for a 1025 property.

CHARLIE'S CONFORMITY TEMPLATE (modified for multi-unit):
"The subject property generally conforms to the neighborhood in terms of age, style, size, construction type, and condition. The subject is a [style] style [multi-unit building type] that is [typical/atypical] for the area as a rental property. [If non-conforming: Describe the specific non-conformity — e.g., "The subject is a converted single-family residence, which is less typical than purpose-built multi-unit structures in the area" — and its impact on rental marketability and operating expenses.] The unit count of [X] units is [typical/atypical] for the neighborhood."

Rules:
1. Use subject.style and subject.yearBuilt facts if available.
2. Mention specific conformity dimensions: age, style, size, construction type, condition, purpose-built vs. converted.
3. Address unit count conformity relative to the neighborhood.
4. If the subject does NOT conform in any dimension, state which and why, with impact on rental income.
5. Use [INSERT] for missing data.
6. Keep to 2-3 sentences maximum.
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'income_approach',
      title: 'Income Approach Narrative',
      note: '1025: Income and rent support commentary with GRM and cap rate analysis',
      aiEligibility: 'ai_draft',
      requiredFacts: ['incomeApproach.marketRent', 'incomeApproach.contractRent', 'incomeApproach.grmIndication'],
      tpl: `Write a comprehensive income approach narrative for a 1025 appraisal in Charlie Cresci's style.

INCOME APPROACH TEMPLATE (follow this structure):
"The Income Approach to value is developed for this 1025 appraisal, as rental income is a primary driver of value for small residential income properties.

Market Rent Analysis:
[Describe market rent evidence: comparable rental properties, lease comps, market surveys.]
Market rent for [unit type descriptions] units in the subject's area is estimated at [INSERT monthly rent ranges] based on [source].

Contract Rent vs. Market:
The subject's current rents are [INSERT lease terms and amounts]. Compare to market: [how subject rents compare to market — above, below, in line].

Vacancy and Collection Loss:
Market vacancy for this property type in the subject's area is estimated at [INSERT vacancy %]. A [INSERT %] vacancy and collection loss assumption has been applied, yielding [EGI amount].

Operating Expenses:
[If expense data available: Operating expenses for comparable properties average [INSERT %] of effective gross income. The subject's expense ratio is [INSERT %].] [If unavailable: Operating expense data is limited; a typical range of [INSERT %] of EGI has been considered.]

Gross Rent Multiplier Analysis:
Based on comparable sales of multi-unit properties, the gross rent multiplier is estimated at [INSERT GRM] (market range: [INSERT range]). Applied to the subject's market rent indication of [INSERT EGI], this yields an income approach value indication of [INSERT value].

[If NOI/cap rate available: A cap rate analysis yields a value indication of [INSERT value] based on NOI of [INSERT] and cap rate of [INSERT %].]

Conclusion:
The income approach provides a [primary/supporting] indication to value for the subject property."

Rules:
1. Do NOT invent income data. Use [INSERT] where missing.
2. Source all assumptions (market rent, vacancy, GRM).
3. Show the calculation chain: market rent → EGI → NOI (if available) → value indication.
4. Reference comparable income properties if available.
5. Reconcile market rent vs. contract rent with explanation.
6. Return ONLY the narrative text.

Subject: {{summary}} ({{subject.unitCount}} units, {{subject.rentalUnits}} rental units)
Market rent: {{incomeApproach.marketRent}}
Contract rent: {{incomeApproach.contractRent}}
GRM: {{incomeApproach.grmIndication}}
Vacancy rate: {{market.vacancyRate}}`,
    },
    {
      id: 'sales_comparison_commentary',
      title: 'Sales Comparison Commentary',
      note: 'ACI: Commentary on comparable sales selection and adjustments for 1025',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.totalGLA', 'subject.unitCount', 'subject.condition'],
      tpl: `Write the Sales Comparison Commentary in Charlie Cresci's exact structure and voice for a 1025 property.

CHARLIE'S SALES COMPARISON COMMENTARY TEMPLATE (modified for 1025):
"The comparable sales were selected based on [selection criteria — e.g., similar location, design, unit count (2-4 units), age, condition, rental status, and tenant profile]. Adjustments were made for [list major adjustment categories — e.g., market time, location, unit count, condition, GLA, rental rate, lease assumptions]. The comparables bracket the subject in terms of [unit count/GLA/condition/rental income — state which dimensions]. [If significant adjustments: The largest adjustments were made for {category} due to {reason}.] Multi-unit properties in the subject's market with [unit count] units and similar rental profiles show [range of sale prices], supporting the subject's market position. Net and gross adjustments are within acceptable guidelines."

Rules:
1. Discuss WHY these comps were selected (proximity, unit count similarity, rental status).
2. Reference bracketing of subject characteristics (especially unit count and rental income).
3. Comment on adjustment magnitude WITHOUT inventing specific dollar amounts.
4. Emphasize comparability in rental profile and lease terms.
5. Reference the grid — do not contradict grid values.
6. Do NOT state a final value conclusion (that belongs in reconciliation).
7. Use [INSERT] for unknown values.
Subject area: {{area}}
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
    {
      id: 'sca_summary',
      title: 'Sales Comparison Approach Summary',
      note: 'ACI: Sales comparison approach summary for 1025',
      aiEligibility: 'ai_draft',
      requiredFacts: ['subject.unitCount', 'subject.condition'],
      tpl: `Write the Sales Comparison Approach summary in Charlie Cresci's EXACT style and voice for a 1025 property.

CRITICAL: You must choose ONE of two opening variants based on the facts:

VARIANT A — Standard (use when comps found in subject neighborhood):
"All comparables have been found in the subject's neighborhood on the [north/south/east/west]side of [city], IL and were selected to demonstrate the marketability of [2-4 unit] rental properties of a similar location, design, age, condition, unit count, rental profile, and lease assumptions. The comparable multi-unit residential properties have received adjustments for current market conditions and rental market trends. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

VARIANT B — Extended search (use when facts indicate lack of comparable sales in neighborhood):
"Due to a lack of recent comparable sales of [2-4 unit] rental properties in the subject's neighborhood, an extensive search was made to find multi-unit properties of a similar location, design, construction type, condition, unit count, and rental profile. The comparable properties have received adjustments for differences in lease terms and local rental market conditions. Due to recent market trends the comparables have received a market time adjustment of [X.X]% based on the sales statistics chart included in this report."

RULES (strict):
1. Use Variant B ONLY if the fact market.extended_search is explicitly true OR facts explicitly indicate extended search / lack of neighborhood comps.
2. Use Variant A by default when market.extended_search is false or not set.
3. Fill [X.X]% from market_stat if available (e.g. "0.5%", "1.0%"). If missing, use [INSERT market time adjustment %].
4. Fill [city] from subject city fact. Fill [north/south/east/west]side from neighborhood facts if available.
5. Emphasize unit count and rental profile comparability (not just structure).
6. Do NOT invent comp adjustments. Do NOT add adjustment detail lines.
7. End EXACTLY with: "After adjustments are made the comparables provide a good basis for an estimate of market value."
8. Return ONLY the narrative text — no headers, no extra lines.

Subject area: {{area}}
Subject: {{summary}} ({{subject.unitCount}} units)
Market stat: {{market_stat}}
Extended search: {{market.extended_search}}`,
    },
    {
      id: 'reconciliation',
      title: 'Reconciliation Narrative',
      note: 'ACI: Reconciliation narrative weighing Sales Comparison AND Income Approach',
      aiEligibility: 'manual_review',
      requiredFacts: ['subject.totalGLA', 'subject.unitCount', 'subject.condition'],
      tpl: `Write the Reconciliation narrative for a 1025 appraisal in Charlie Cresci's exact style.

CRITICAL FOR 1025: The reconciliation MUST weigh BOTH the Sales Comparison Approach AND the Income Approach.

RECONCILIATION TEMPLATE (for 1025 with income property):
"In valuing this small residential income property, both the Sales Comparison Approach and the Income Approach have been developed.

Sales Comparison Approach:
The Sales Comparison Approach provides an indication of value based on recent sales of comparable [2-4 unit] properties in and around the subject's market area. The comparable sales analyzed indicate a value range of [INSERT range], with an indicated value of [INSERT]. This approach is given [PRIMARY / SECONDARY] weight due to [market liquidity / availability of comparable sales / rental market factors].

Income Approach:
The Income Approach is given [PRIMARY / SECONDARY / SUPPORTING] weight. The property's current rental income and market rent analysis support a value indication of [INSERT]. The [GRM / cap rate] indication of [INSERT] is [consistent with / supports / does not align with] the sales comparison indication.

Reconciliation:
Weighing both approaches, with emphasis on [Sales Comparison / Income / equal weight], the final value opinion is [INSERT VALUE]. The subject's position as a small residential income property warrants consideration of both market-based (sales) and income-based valuations.

The appraisal is made with the subject in 'as is' condition. There is no personal property included in the final estimate of value."

Rules:
1. NEVER use the 1004 template that states "Income Approach was not developed."
2. For 1025, the Income Approach IS developed and MUST be discussed.
3. Explicitly state the weighting given to Sales Comparison vs. Income Approach.
4. Show how the two approaches compare (convergence or divergence).
5. Justify the final reconciliation based on property type and market conditions.
6. Use [INSERT] for value conclusions.
7. Return ONLY the narrative text.

Subject: {{summary}} ({{subject.unitCount}} units, {{subject.rentalUnits}} rental)`,
    },
    {
      id: 'exposure_time',
      title: 'Exposure Time',
      note: 'ACI: Exposure time statement for rental property market',
      aiEligibility: 'ai_draft',
      requiredFacts: ['market.typicalDOM'],
      tpl: `Write the Exposure Time statement in Charlie Cresci's exact style for a 1025 property.

CHARLIE'S EXPOSURE TIME TEMPLATE (modified for rental market):
"Based on the analysis of the comparable sales and market activity in the subject's area, the estimated exposure time for the subject property is [exposure_time_range] months, which is consistent with the typical marketing time of [typical_DOM] days observed in the subject's market area for [2-4 unit] rental properties. Buyer motivations for income properties [vary based on / are driven by] rental market conditions and investment returns."

Rules:
1. Exposure time should be stated as a range (e.g., "3-6 months", "1-3 months").
2. Reference the typical days on market (DOM) from market facts.
3. If DOM is unknown, use [INSERT typical marketing time].
4. Do NOT state an exact number — always use a range.
5. Note how rental market conditions affect exposure time.
6. Keep to 2-3 sentences.
Subject area: {{area}}
Subject: {{summary}} ({{subject.unitCount}} units)
Return ONLY the narrative text.`,
    },
  ],
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
  factsSchema,
  gradingRubric: `
- Contract/offering history completeness (10 pts)
- Neighborhood and market conditions support, including rental market data (15 pts)
- Improvements/condition narrative with multi-unit detail (10 pts)
- Income approach rigor: rent support, market rent analysis, GRM/cap rate analysis, vacancy assumption (25 pts)
- Sales comparison approach with unit count comparability (15 pts)
- Reconciliation narrative quality, weighting of both approaches (15 pts)
- USPAP compliance / no unsupported statements (10 pts)
- Professional tone + internal consistency (10 pts)
`,
  questionnairePriorities: [
    'Current contract rents vs. market rent comparability (ALL units)',
    'Lease terms and tenant profile: lease lengths, renewal rates, tenant stability',
    'Vacancy and collection loss assumption support and market data',
    'Gross rent multiplier (GRM) comparable data and source',
    'Cap rate and NOI assumptions if income expense data available',
    'Income approach data gaps (PGI, EGI, OpEx, NOI)',
    'Multi-family zoning verification and compliance',
    'Unit mix and functional utility for rental operations',
    'Comparable selection reasoning (multi-unit rental comps, bracketing)',
    'Seller concessions amount, type, and market context',
    'Market trend stat and source (sales AND rental market trends)',
    'Prior sale/listing history for subject (12 and 36 month)',
  ],
  voiceFields: [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'improvements_condition', title: 'Improvements / Condition' },
    { id: 'functional_utility', title: 'Functional Utility' },
    { id: 'contract_analysis', title: 'Contract Analysis' },
    { id: 'income_approach', title: 'Income Approach' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation', title: 'Reconciliation' },
    { id: 'prior_sales_subject', title: 'Prior Sales / Offering History' },
    { id: 'listing_history', title: 'Listing History' },
    { id: 'site_comments', title: 'Site / Utilities / Adverse Conditions' },
    { id: 'adverse_conditions', title: 'Adverse Conditions / External Factors' },
  ],
};

export default form1025;
