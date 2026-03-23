/**
 * server/ai/appraiserBrain.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The Appraiser Brain — Chain-of-thought reasoning prompts that teach the AI
 * to THINK like an appraiser, not just write like one.
 * 
 * This module generates structured reasoning prompts that guide the AI through
 * the same mental process a human appraiser follows. Combined with the
 * fine-tuned model (which knows Charles's writing style), this produces
 * output that reflects both style AND judgment.
 */

import { ADJUSTMENT_LOGIC, VALUATION_LOGIC, MARKET_LOGIC, HBU_LOGIC, CONDITION_LOGIC } from './reasoningEngine.js';
import log from '../logger.js';

/**
 * Build a chain-of-thought reasoning prompt for any appraisal task.
 * This prompt forces the AI to show its work — just like an appraiser
 * would think through a problem before writing.
 */
export function buildReasoningPrompt(task, caseData) {
  const { facts = {}, comps = [], outputs = {} } = caseData;
  const subject = facts.subject || {};
  const improvements = facts.improvements || {};
  const site = facts.site || {};
  const neighborhood = facts.neighborhood || {};

  switch (task) {
    case 'comp_selection':
      return buildCompSelectionReasoning(subject, improvements, site, comps);
    case 'adjustments':
      return buildAdjustmentReasoning(subject, improvements, comps);
    case 'reconciliation':
      return buildReconciliationReasoning(subject, improvements, comps, outputs);
    case 'highest_best_use':
      return buildHBUReasoning(facts);
    case 'market_analysis':
      return buildMarketReasoning(neighborhood, comps);
    case 'full_analysis':
      return buildFullAnalysisReasoning(caseData);
    default:
      return null;
  }
}

function buildCompSelectionReasoning(subject, improvements, site, availableComps) {
  return `You are a certified residential appraiser analyzing comparable sales for this subject property:

SUBJECT PROPERTY:
- Address: ${subject.address}, ${subject.city}, ${subject.state}
- Design: ${improvements.design || 'Unknown'} | Year Built: ${improvements.yearBuilt || 'Unknown'}
- GLA: ${improvements.gla || 'Unknown'} SF | Bedrooms: ${improvements.bedrooms || '?'} | Bathrooms: ${improvements.bathrooms || '?'}
- Condition: ${improvements.condition || 'Unknown'} | Quality: ${improvements.quality || 'Unknown'}
- Lot Size: ${site.lotSize || 'Unknown'} | Garage: ${improvements.garage || 'Unknown'}

THINK STEP BY STEP:

1. PROXIMITY — Which comparables are closest to the subject? Closer is better (same neighborhood > same city > surrounding area).

2. SIMILARITY — Score each comp on how similar it is to the subject:
   - Same design/style? (Ranch vs Ranch = good, Ranch vs Two-Story = adjustment needed)
   - Age within 10 years? (closer age = fewer adjustments)
   - GLA within 20%? (similar size = fewer adjustments)
   - Same condition rating? (C3 vs C3 = no adjustment)
   - Same quality rating? (Q3 vs Q3 = no adjustment)

3. RECENCY — When did each comp sell? More recent = more reliable.
   - Under 6 months = excellent
   - 6-12 months = good (may need time adjustment)
   - Over 12 months = use only if necessary

4. ADJUSTMENTS — Which comps would require the FEWEST adjustments? Fewer adjustments = more reliable indication.

5. FANNIE MAE COMPLIANCE — Will net adjustments stay under 15% and gross under 25%?

RANK the comparables from best to worst and explain your reasoning for selecting the top 3.`;
}

function buildAdjustmentReasoning(subject, improvements, comps) {
  const compLines = comps.map((c, i) => {
    return `Comp #${i+1}: ${c.address} | $${parseInt(c.salePrice || 0).toLocaleString()} | ${c.gla || '?'} SF | ${c.yearBuilt || '?'} | ${c.bedrooms || '?'}BR/${c.bathrooms || '?'}BA | ${c.condition || '?'}`;
  }).join('\n');

  // Pre-calculate adjustments using our logic engine
  const preCalc = comps.map(c => ADJUSTMENT_LOGIC.calculateAdjustments(improvements, c));

  return `You are a certified residential appraiser making adjustments on the sales comparison grid.

SUBJECT: ${subject.address} | ${improvements.gla || '?'} SF | ${improvements.yearBuilt || '?'} | ${improvements.bedrooms || '?'}BR/${improvements.bathrooms || '?'}BA | ${improvements.condition || '?'} | ${improvements.garage || '?'}

COMPARABLES:
${compLines}

PRE-CALCULATED ADJUSTMENTS (verify and modify based on your market knowledge):
${preCalc.map((p, i) => `Comp #${i+1}: Net ${p.summary.netAdjustment > 0 ? '+' : ''}$${p.summary.netAdjustment.toLocaleString()} (${p.summary.netPercent}%) | Gross $${p.summary.grossAdjustment.toLocaleString()} (${p.summary.grossPercent}%) | Adjusted: $${p.summary.adjustedPrice.toLocaleString()}`).join('\n')}

THINK THROUGH EACH ADJUSTMENT:
1. For each comp, go line by line through the grid
2. Explain WHY each adjustment is warranted
3. Show your calculation for each adjustment amount
4. Verify Fannie Mae guidelines: Net ≤ 15%, Gross ≤ 25%
5. If a comp exceeds guidelines, explain why it's still a valid comparable

MARKET RATES USED:
- GLA: $${ADJUSTMENT_LOGIC.defaults.gla_per_sf}/SF
- Age: $${ADJUSTMENT_LOGIC.defaults.age_per_year}/year
- Bedrooms: $${ADJUSTMENT_LOGIC.defaults.bedroom_value} each
- Full Bath: $${ADJUSTMENT_LOGIC.defaults.bathroom_full} each
- Garage: $${ADJUSTMENT_LOGIC.defaults.garage_per_car}/car space
- Condition: $${ADJUSTMENT_LOGIC.defaults.condition_per_rating}/rating level`;
}

function buildReconciliationReasoning(subject, improvements, comps, outputs) {
  return `You are a certified residential appraiser reconciling the approaches to value.

SUBJECT: ${subject.address}, ${subject.city}, ${subject.state}

APPROACHES DEVELOPED:
1. Sales Comparison Approach: ${outputs.sca_summary ? 'Developed' : 'Not yet developed'}
2. Cost Approach: ${outputs.cost_approach ? 'Developed' : 'Not developed (at lender request)'}
3. Income Approach: ${outputs.income_approach ? 'Developed' : 'Not developed (lack of rental data)'}

THINK STEP BY STEP:
1. Which approach provides the MOST reliable indication of value? Why?
2. What are the strengths and weaknesses of each developed approach?
3. What weight should each approach receive in the final reconciliation?
4. For residential properties, the Sales Comparison Approach typically receives the greatest weight because:
   - Buyers make purchase decisions based on what similar homes have sold for
   - The market reaction is directly observable
   - It reflects actual buyer behavior

5. State your final value opinion and explain how you arrived at it.
6. Is the final value "as is" or subject to conditions?

Remember: The final value should be rounded to the nearest $500 or $1,000 depending on the price range.`;
}

function buildHBUReasoning(facts) {
  const result = HBU_LOGIC.evaluate(facts);
  return `You are evaluating Highest and Best Use for:
${facts.subject?.address}, ${facts.subject?.city}, ${facts.subject?.state}

Apply the four tests of Highest and Best Use:

1. LEGALLY PERMISSIBLE: ${result.tests.legallyPermissible.reasoning}
2. PHYSICALLY POSSIBLE: ${result.tests.physicallyPossible.reasoning}
3. FINANCIALLY FEASIBLE: ${result.tests.financiallyFeasible.reasoning}
4. MAXIMALLY PRODUCTIVE: ${result.tests.maximallyProductive.reasoning}

CONCLUSION: ${result.conclusion}

Write a professional narrative that addresses all four tests and reaches a conclusion.`;
}

function buildMarketReasoning(neighborhood, comps) {
  const analysis = MARKET_LOGIC.analyzeMarketTrends(comps);
  return `Analyze the market conditions for this neighborhood:

Market Data:
- Built-Up: ${neighborhood.builtUp || 'Unknown'}
- Growth: ${neighborhood.growth || 'Unknown'}
- Property Values: ${neighborhood.propertyValues || 'Unknown'}
- Demand/Supply: ${neighborhood.demandSupply || 'Unknown'}
- Marketing Time: ${neighborhood.marketingTime || 'Unknown'}

${analysis ? `Calculated Market Trends:
- Annual Appreciation: ${analysis.annualAppreciation}%
- Average $/SF: $${analysis.avgPricePerSf}
- Trend: ${analysis.trend}` : 'Insufficient comp data for trend analysis.'}

THINK STEP BY STEP:
1. What is the current state of this market?
2. Is supply keeping up with demand?
3. Are financing conditions favorable?
4. What is the typical marketing time and what does that indicate?
5. Are there any factors that could change the market trajectory?`;
}

function buildFullAnalysisReasoning(caseData) {
  const { facts = {}, comps = [] } = caseData;
  const subject = facts.subject || {};
  const improvements = facts.improvements || {};

  // Run all analysis
  const compAnalyses = comps.map(c => ADJUSTMENT_LOGIC.calculateAdjustments(improvements, c));
  const valuation = VALUATION_LOGIC.reconcileValue(compAnalyses);
  const market = MARKET_LOGIC.analyzeMarketTrends(comps);
  const hbu = HBU_LOGIC.evaluate(facts);
  const condition = CONDITION_LOGIC.suggestRating(facts);

  return {
    subject: `${subject.address}, ${subject.city}, ${subject.state}`,
    condition: condition,
    hbu: hbu,
    market: market,
    compAnalyses: compAnalyses,
    valuation: valuation,
    reasoning: [
      `Property: ${subject.address}, ${subject.city} ${subject.state}`,
      `${improvements.design || 'Residential'} | Built ${improvements.yearBuilt} | ${improvements.gla || '?'} SF | ${improvements.condition}`,
      `Suggested condition: ${condition.rating} (${condition.confidence} confidence) — ${condition.reasoning}`,
      `HBU: ${hbu.conclusion}`,
      market ? `Market: ${market.trend} (${market.annualAppreciation}% annual appreciation)` : 'Insufficient market data',
      valuation ? `Indicated value: $${valuation.indicatedValue.toLocaleString()} (range $${valuation.range.low.toLocaleString()}-$${valuation.range.high.toLocaleString()})` : 'Insufficient comp data for valuation',
    ],
  };
}

export default { buildReasoningPrompt };
