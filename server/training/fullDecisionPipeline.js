/**
 * server/training/fullDecisionPipeline.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full decision pipeline that generates 6 types of training examples from
 * MISMO XML appraisal files for Llama fine-tuning.
 *
 * Example types:
 *   1. narrative_writing     — given facts, write section narrative
 *   2. adjustment_reasoning  — given subject+comp, calculate adjustments
 *   3. comp_selection        — given subject + candidates, select best comps
 *   4. reconciliation        — given approach values, determine final value
 *   5. condition_quality     — given description, assign C/Q ratings
 *   6. full_appraisal        — given order info, produce complete appraisal
 *
 * Usage:
 *   node server/training/fullDecisionPipeline.js
 *   node server/training/fullDecisionPipeline.js --xml-dir /path/to/xmls --output-dir /path/to/output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMismoXml } from './aciExtractor.js';
import { extractDecisions } from './decisionExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Path detection ────────────────────────────────────────────────────────────

/**
 * Walk up from startDir looking for training_output/xml_exports.
 * Works in both the main repo and git worktree contexts.
 */
function findXmlDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'training_output', 'xml_exports');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findOutputDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'training_output');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to creating relative to project root
  const projectRoot = path.resolve(__dirname, '../../');
  return path.join(projectRoot, 'training_output');
}

// ── Training example generators ───────────────────────────────────────────────

const SYSTEM_APPRAISER = `You are an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC). You write USPAP-compliant appraisal reports in a professional, concise, data-driven style. You reference specific comparables by number, include market conditions context, and every sentence adds value.`;

/**
 * TYPE 1: narrative_writing
 * Given structured facts about a property, write the narrative section.
 */
function makeNarrativeExamples(parsed) {
  const examples = [];
  const { subject, narratives, formType, purpose } = parsed;
  if (!narratives || Object.keys(narratives).length === 0) return examples;

  const subjectSummary = formatSubjectSummary(subject, formType, purpose);

  for (const [section, text] of Object.entries(narratives)) {
    if (!text || text.length < 30) continue;

    const sectionLabel = section.replace(/_/g, ' ');
    examples.push({
      type: 'narrative_writing',
      messages: [
        { role: 'system', content: SYSTEM_APPRAISER },
        {
          role: 'user',
          content: `Write the "${sectionLabel}" narrative section for this appraisal report.\n\n${subjectSummary}`,
        },
        { role: 'assistant', content: text },
      ],
    });
  }
  return examples;
}

/**
 * TYPE 2: adjustment_reasoning
 * Given subject and a comparable, explain the adjustment amounts with reasoning.
 */
function makeAdjustmentExamples(decisions) {
  const examples = [];
  const { subject, comps, adjustments } = decisions;
  if (!comps.length || !adjustments.length) return examples;

  for (const adj of adjustments) {
    const comp = comps.find(c => c.number === adj.compNumber);
    if (!comp || !comp.salePrice) continue;

    const activeAdj = getActiveAdjustments(adj);
    if (activeAdj.length === 0) continue;

    const userPrompt = `Calculate the market adjustments for this comparable sale pair:

SUBJECT PROPERTY:
- Address: ${subject.address || 'N/A'}
- GLA: ${subject.gla || '?'} SF
- Year Built: ${subject.yearBuilt || '?'}
- Bedrooms/Baths: ${subject.bedrooms || '?'}/${subject.bathrooms || '?'}
- Condition: ${subject.condition || '?'}
- Lot Size: ${subject.lotSize || '?'} SF

COMPARABLE #${adj.compNumber}:
- Address: ${comp.address || 'N/A'}
- Sale Price: $${parseInt(comp.salePrice || 0).toLocaleString()}
- Sale Date: ${comp.saleDate || 'N/A'}
- GLA: ${comp.gla || '?'} SF
- Year Built: ${comp.yearBuilt || '?'}
- Bedrooms/Baths: ${comp.bedrooms || '?'}/${comp.bathrooms || '?'}
- Condition: ${comp.condition || '?'}
- Lot Size: ${comp.lotSize || '?'} SF
- Proximity: ${comp.proximity || 'N/A'}

What adjustment amounts would you apply and why?`;

    const assistantResponse = formatAdjustmentReasoning(subject, comp, adj, activeAdj);
    if (assistantResponse.length < 20) continue;

    examples.push({
      type: 'adjustment_reasoning',
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_APPRAISER}\n\nWhen calculating adjustments, show your reasoning for each line item. Reference GLA adjustment rates ($/SF), time/market adjustment percentages, and condition differences in C1-C6 scale.`,
        },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantResponse },
      ],
    });
  }
  return examples;
}

/**
 * TYPE 3: comp_selection
 * Given subject and a pool of comps (from same file), explain which were selected.
 */
function makeCompSelectionExamples(decisions, allDecisionsFromSameFile) {
  const examples = [];
  const { subject, comps, reconciliation } = decisions;
  if (!comps || comps.length < 2) return examples;

  // Build a narrative about comp selection
  const selectedComps = comps.slice(0, 3);
  const additionalComps = comps.slice(3);

  const compDescriptions = selectedComps.map((c, i) =>
    `COMP ${i + 1}: ${c.address || 'N/A'} | $${parseInt(c.salePrice || 0).toLocaleString()} | ${c.gla || '?'} SF | Built ${c.yearBuilt || '?'} | ${c.condition || '?'} | ${c.saleDate || 'N/A'} | ${c.proximity || 'N/A'} from subject`
  ).join('\n');

  const assistantText = buildCompSelectionRationale(subject, selectedComps, additionalComps, reconciliation);
  if (!assistantText) return examples;

  examples.push({
    type: 'comp_selection',
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_APPRAISER}\n\nFor comp selection, explain why these specific sales were chosen over alternatives. Discuss proximity, date of sale, similarity of physical characteristics, and market area.`,
      },
      {
        role: 'user',
        content: `You are appraising: ${subject.address || 'N/A'} | ${subject.gla || '?'} SF | Built ${subject.yearBuilt || '?'} | ${subject.condition || '?'}\n\nThe following comparable sales were selected:\n${compDescriptions}\n\nExplain why these comparables were chosen and how they support the value conclusion.`,
      },
      { role: 'assistant', content: assistantText },
    ],
  });
  return examples;
}

/**
 * TYPE 4: reconciliation
 * Given the indicated values from each approach, explain the final value.
 */
function makeReconciliationExamples(decisions) {
  const examples = [];
  const { subject, reconciliation } = decisions;
  if (!reconciliation.finalValue) return examples;

  const finalVal = parseInt(reconciliation.finalValue);
  if (!finalVal || finalVal < 10000) return examples;

  const scaVal = reconciliation.indicatedValueSCA ? parseInt(reconciliation.indicatedValueSCA) : null;
  const costVal = reconciliation.indicatedValueCost ? parseInt(reconciliation.indicatedValueCost) : null;
  const incomeVal = reconciliation.indicatedValueIncome ? parseInt(reconciliation.indicatedValueIncome) : null;

  const approachLines = [];
  if (scaVal) approachLines.push(`Sales Comparison Approach: $${scaVal.toLocaleString()}`);
  if (costVal) approachLines.push(`Cost Approach: $${costVal.toLocaleString()}`);
  if (incomeVal) approachLines.push(`Income Approach: $${incomeVal.toLocaleString()}`);
  if (approachLines.length === 0) return examples;

  const reconciliationText = buildReconciliationNarrative(finalVal, scaVal, costVal, incomeVal, subject);

  examples.push({
    type: 'reconciliation',
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_APPRAISER}\n\nFor reconciliation, explain which approaches were given the most weight and why. Address the reliability and applicability of each approach for this property type and market.`,
      },
      {
        role: 'user',
        content: `Reconcile the following value indications for ${subject.address || 'the subject property'} and provide a final opinion of market value:\n\n${approachLines.join('\n')}`,
      },
      { role: 'assistant', content: reconciliationText },
    ],
  });
  return examples;
}

/**
 * TYPE 5: condition_quality
 * Given a property description, assign FNMA C1-C6 and Q1-Q6 ratings.
 */
function makeConditionQualityExamples(decisions) {
  const examples = [];
  const { subject, conditionRating } = decisions;

  if (!conditionRating.rating || !subject.yearBuilt) return examples;

  const conditionCode = conditionRating.rating;
  const yearBuilt = parseInt(subject.yearBuilt);
  const age = conditionRating.ageAtAppraisal || (new Date().getFullYear() - yearBuilt);

  const conditionDescriptions = {
    C1: 'The improvements have been very recently constructed and have not previously been occupied. The entire structure and all components are new and the dwelling features no physical depreciation.',
    C2: 'The improvements feature no deferred maintenance, little or no physical depreciation, and require no repairs. Virtually all building components are new or have been recently repaired, refinished, or rehabilitated.',
    C3: 'The improvements are well maintained and feature limited physical depreciation due to normal wear and tear. Some components, but not every major building component, may be updated or recently rehabilitated.',
    C4: 'The improvements feature some minor deferred maintenance and physical deterioration due to normal wear and tear. The dwelling has been adequately maintained and requires only minimal repairs to building components.',
    C5: 'The improvements feature obvious deferred maintenance and are in need of some significant repairs. Some building components need repairs, rehabilitation, or updating.',
    C6: 'The improvements have substantial damage or deferred maintenance with deficiencies or defects that are severe enough to affect the safety, soundness, or structural integrity of the improvements.',
  };

  const description = conditionDescriptions[conditionCode];
  if (!description) return examples;

  examples.push({
    type: 'condition_quality',
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_APPRAISER}\n\nAssign Fannie Mae condition ratings (C1-C6) and quality ratings (Q1-Q6) based on FNMA guidelines. C1 is new/no depreciation; C6 is severely deteriorated. Q1 is unique/luxury; Q6 is very poor quality.`,
      },
      {
        role: 'user',
        content: `Assign a condition rating for this property:\n\nProperty built: ${yearBuilt} (approximately ${age} years old)\nGLA: ${subject.gla || 'Unknown'} SF\nDesign/Style: ${subject.design || 'Conventional'}\nBedrooms/Baths: ${subject.bedrooms || '?'}/${subject.bathrooms || '?'}\n\nWhat FNMA condition rating (C1-C6) is appropriate and why?`,
      },
      {
        role: 'assistant',
        content: `This property would receive a condition rating of ${conditionCode}. ${description}\n\nAt ${age} years of age, the property has experienced ${getDepreciationDescription(age, conditionCode)}.`,
      },
    ],
  });
  return examples;
}

/**
 * TYPE 6: full_appraisal
 * Given order information, produce a complete structured appraisal outline.
 */
function makeFullAppraisalExamples(parsed, decisions) {
  const examples = [];
  const { subject, formType, purpose } = parsed;
  const { reconciliation } = decisions;

  if (!reconciliation.finalValue || !subject.address) return examples;

  const finalVal = parseInt(reconciliation.finalValue);
  if (!finalVal || finalVal < 10000) return examples;

  const orderInfo = `Property Address: ${subject.address}${subject.city ? `, ${subject.city}` : ''}${subject.state ? `, ${subject.state}` : ''}${subject.zip ? ` ${subject.zip}` : ''}
Form Type: ${formType || 'URAR (1004)'}
Purpose: ${purpose || 'Purchase'}
Effective Date: ${decisions.reconciliation.effectiveDate || 'Current'}`;

  const fullAppraisalOutline = buildFullAppraisalOutline(subject, decisions, parsed);
  if (!fullAppraisalOutline) return examples;

  examples.push({
    type: 'full_appraisal',
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_APPRAISER}\n\nFor a complete appraisal, provide a structured analysis covering: subject description, market area analysis, highest and best use, sales comparison approach with adjustments, reconciliation, and final value conclusion.`,
      },
      {
        role: 'user',
        content: `Complete a full appraisal analysis for the following assignment:\n\n${orderInfo}`,
      },
      { role: 'assistant', content: fullAppraisalOutline },
    ],
  });
  return examples;
}

// ── Helper formatters ─────────────────────────────────────────────────────────

function formatSubjectSummary(subject, formType, purpose) {
  const lines = [`Form: ${formType || 'URAR (1004)'}`, `Purpose: ${purpose || 'N/A'}`];
  if (subject.address) lines.push(`Address: ${subject.address}${subject.city ? `, ${subject.city}` : ''}${subject.state ? `, ${subject.state}` : ''}`);
  if (subject.gla) lines.push(`GLA: ${subject.gla} SF`);
  if (subject.yearBuilt) lines.push(`Year Built: ${subject.yearBuilt}`);
  if (subject.bedrooms) lines.push(`Bedrooms: ${subject.bedrooms}`);
  if (subject.bathrooms) lines.push(`Bathrooms: ${subject.bathrooms}`);
  if (subject.appraisedValue) lines.push(`Appraised Value: $${subject.appraisedValue.toLocaleString()}`);
  return lines.join('\n');
}

function getActiveAdjustments(adj) {
  const fields = ['saleOrFinancing', 'dateOfSale', 'location', 'site', 'view',
    'design', 'quality', 'age', 'condition', 'gla', 'basement',
    'functionalUtility', 'heatingCooling', 'garage', 'porchPatioDeck', 'other'];
  return fields
    .filter(f => adj[f] && adj[f] !== '0' && adj[f] !== '')
    .map(f => ({ field: f, value: adj[f] }));
}

function formatAdjustmentReasoning(subject, comp, adj, activeAdj) {
  const lines = [];

  const fieldLabels = {
    saleOrFinancing: 'Sale or Financing Concessions',
    dateOfSale: 'Date of Sale/Time',
    location: 'Location',
    site: 'Site/Lot Size',
    view: 'View',
    design: 'Design (Style)',
    quality: 'Quality of Construction',
    age: 'Actual Age',
    condition: 'Condition',
    gla: 'Gross Living Area',
    basement: 'Basement & Finished Rooms',
    functionalUtility: 'Functional Utility',
    heatingCooling: 'Heating/Cooling',
    garage: 'Garage/Carport',
    porchPatioDeck: 'Porch/Patio/Deck',
    other: 'Other',
  };

  for (const { field, value } of activeAdj) {
    const label = fieldLabels[field] || field;
    const amount = parseInt(String(value).replace(/[^0-9\-]/g, '')) || 0;
    if (amount === 0) continue;
    const sign = amount > 0 ? '+' : '';
    lines.push(`${label}: ${sign}$${amount.toLocaleString()}`);
  }

  if (adj.netAdjustment) {
    const net = parseInt(adj.netAdjustment);
    if (net) lines.push(`\nNet Adjustment: ${net > 0 ? '+' : ''}$${net.toLocaleString()}`);
  }
  if (adj.adjustedPrice) {
    const ap = parseInt(adj.adjustedPrice);
    if (ap) lines.push(`Adjusted Sale Price: $${ap.toLocaleString()}`);
  }

  if (lines.length === 0) return '';

  const glaDiff = subject.gla && comp.gla
    ? parseInt(subject.gla) - parseInt(comp.gla)
    : null;

  const preamble = `Based on a paired sales analysis and market data, the following adjustments are applied to Comparable Sale #${adj.compNumber}:`;
  const suffix = glaDiff !== null && Math.abs(glaDiff) > 0
    ? `\n\nThe GLA difference of ${Math.abs(glaDiff)} SF was adjusted at the market-extracted rate. All adjustments reflect typical buyer/seller reactions in this market area.`
    : '\n\nAll adjustments are based on market-extracted rates and paired sales analysis.';

  return `${preamble}\n\n${lines.join('\n')}${suffix}`;
}

function buildCompSelectionRationale(subject, selectedComps, additionalComps, reconciliation) {
  if (!selectedComps.length) return null;

  const parts = [
    `The comparable sales selected for this analysis represent the most proximate, recent, and similar properties available in the subject's market area.`,
  ];

  selectedComps.forEach((comp, i) => {
    const pricePart = comp.salePrice ? `at $${parseInt(comp.salePrice).toLocaleString()}` : '';
    const datePart = comp.saleDate ? `(${comp.saleDate})` : '';
    const glaDiff = subject.gla && comp.gla
      ? Math.abs(parseInt(subject.gla) - parseInt(comp.gla))
      : null;
    const glaPart = glaDiff !== null ? `with a GLA difference of only ${glaDiff} SF` : '';
    parts.push(`Comparable ${i + 1} is located ${comp.proximity || 'in the subject market area'} and sold ${pricePart} ${datePart}${glaPart ? `, ${glaPart}` : ''}. This sale offers a good indicator of value due to its physical and locational similarity to the subject.`);
  });

  if (reconciliation.finalValue) {
    parts.push(`The three comparable sales bracket the subject's value conclusion of $${parseInt(reconciliation.finalValue).toLocaleString()}, providing strong market support.`);
  }

  return parts.join('\n\n');
}

function buildReconciliationNarrative(finalVal, scaVal, costVal, incomeVal, subject) {
  const parts = [];

  if (scaVal) {
    const diff = Math.abs(finalVal - scaVal);
    const pct = Math.round(diff / scaVal * 100);
    parts.push(`The Sales Comparison Approach indicates a value of $${scaVal.toLocaleString()}. This approach is given primary weight as it directly reflects market behavior — the actions of buyers and sellers in arm's-length transactions for properties similar to the subject.`);
  }

  if (costVal) {
    parts.push(`The Cost Approach indicates a value of $${costVal.toLocaleString()}. This approach is given secondary consideration. Cost approach reliability diminishes with older properties due to difficulties in estimating accrued depreciation accurately.`);
  }

  if (incomeVal) {
    parts.push(`The Income Approach indicates a value of $${incomeVal.toLocaleString()}. As the subject is a single-family residence in an owner-occupied market, the income approach is not typically relied upon by buyers and sellers and is given limited weight.`);
  }

  parts.push(`Based on the above analysis, my final opinion of market value for the subject property is:\n\n$${finalVal.toLocaleString()}\n\nThis conclusion is most supported by the Sales Comparison Approach, which best reflects the motivations of typical buyers and sellers in the subject's market area.`);

  return parts.join('\n\n');
}

function buildFullAppraisalOutline(subject, decisions, parsed) {
  const { reconciliation, marketAnalysis, comps } = decisions;
  const finalVal = parseInt(reconciliation.finalValue);
  if (!finalVal) return null;

  const sections = [];

  sections.push(`SUBJECT PROPERTY DESCRIPTION
${subject.address || 'N/A'}${subject.city ? `, ${subject.city}` : ''}${subject.state ? `, ${subject.state}` : ''}
GLA: ${subject.gla || 'N/A'} SF | Year Built: ${subject.yearBuilt || 'N/A'} | Bedrooms: ${subject.bedrooms || 'N/A'} | Bathrooms: ${subject.bathrooms || 'N/A'}
Condition: ${subject.condition || 'N/A'} | Design: ${subject.design || 'Conventional'}`);

  sections.push(`MARKET AREA ANALYSIS
The subject is located in a ${marketAnalysis.demandSupply || 'balanced'} market with ${marketAnalysis.marketingTime || 'typical'} marketing times. Property values are ${marketAnalysis.propertyValues || 'stable'}.`);

  sections.push(`HIGHEST AND BEST USE
As Improved: The existing use as a single-family residential property is the highest and best use, being legally permissible, physically possible, financially feasible, and maximally productive.`);

  if (comps.length > 0) {
    const compSummary = comps.slice(0, 3).map((c, i) =>
      `  Comp ${i + 1}: ${c.address || 'N/A'} — $${parseInt(c.salePrice || 0).toLocaleString()} (${c.saleDate || 'N/A'})`
    ).join('\n');
    sections.push(`SALES COMPARISON APPROACH
Comparable Sales Used:\n${compSummary}

After appropriate adjustments for location, time, GLA, condition, and other relevant factors, the adjusted sale prices support the value conclusion.`);
  }

  sections.push(`RECONCILIATION AND FINAL VALUE OPINION
The Sales Comparison Approach is given primary weight. After careful analysis of all available market data:

FINAL OPINION OF MARKET VALUE: $${finalVal.toLocaleString()}
Effective Date: ${reconciliation.effectiveDate || 'As of inspection date'}`);

  return sections.join('\n\n');
}

function getDepreciationDescription(age, conditionCode) {
  if (conditionCode === 'C1') return 'no physical depreciation as a new construction';
  if (conditionCode === 'C2') return 'minimal depreciation with excellent maintenance';
  if (conditionCode === 'C3') return `normal wear and tear typical for a property of this age, with adequate ongoing maintenance`;
  if (conditionCode === 'C4') return `some physical deterioration consistent with its age and typical maintenance levels`;
  if (conditionCode === 'C5') return `significant physical deterioration and deferred maintenance requiring attention`;
  return `substantial physical deterioration requiring major repairs or rehabilitation`;
}

/**
 * TYPE 2 (supplemental): adjustment_reasoning using raw MISMO comp data
 * Used when decisionExtractor doesn't find specific adjustment line items.
 */
function makeAdjustmentExamplesFromSupp(subject, compsFromXml) {
  const examples = [];
  if (!compsFromXml || compsFromXml.length === 0) return examples;

  for (const comp of compsFromXml) {
    if (!comp.salePrice || !comp.adjustedPrice) continue;

    const salePrice = parseInt(comp.salePrice);
    const adjPrice = parseInt(comp.adjustedPrice);
    const netAdj = parseInt(comp.netAdjustment || 0);
    const netPct = parseFloat(comp.netPercent || 0);
    const grossPct = parseFloat(comp.grossPercent || 0);

    if (!salePrice || !adjPrice) continue;

    const userPrompt = `Calculate adjustments for Comparable Sale #${comp.number}:

SUBJECT: ${subject.address || 'N/A'} | ${subject.gla || '?'} SF | Built ${subject.yearBuilt || '?'} | ${subject.condition || '?'}
COMP #${comp.number}: Sale Price $${salePrice.toLocaleString()} | ${subject.gla || '?'} SF (approx)

Provide the net and gross adjustment summary.`;

    const adjDirection = netAdj >= 0 ? 'upward' : 'downward';
    const assistantText = `After analyzing the differences between the subject and Comparable #${comp.number}, the following net adjustment applies:

Net Adjustment: ${netAdj >= 0 ? '+' : ''}$${netAdj.toLocaleString()} (${netPct}% net / ${grossPct}% gross)
Adjusted Sale Price: $${adjPrice.toLocaleString()}

The ${grossPct}% gross adjustment is within acceptable guidelines. The comparable required ${adjDirection} adjustment primarily for differences in site, condition, and/or GLA relative to the subject property. The adjusted price provides a reliable indicator of market value.`;

    examples.push({
      type: 'adjustment_reasoning',
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_APPRAISER}\n\nWhen summarizing adjustments, reference net and gross percentages. FNMA guidelines suggest net adjustments not exceed 15% and gross adjustments not exceed 25% of comparable sale price.`,
        },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantText },
      ],
    });
  }
  return examples;
}

// ── Supplemental MISMO extraction ────────────────────────────────────────────
// The decisionExtractor uses some field names that don't match the actual MISMO 2.6 GSE schema.
// This function extracts the missing fields directly.

function extractMismoSupplemental(xmlContent) {
  const get = (name) => {
    const m = xmlContent.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return m ? m[1].trim() : null;
  };

  // Final value — MISMO uses AppraisedValueAmount
  const finalValue = get('AppraisedValueAmount')
    || get('MarketValueAmount')
    || get('PropertyAppraisedValueAmount');

  // Approach values
  const scaValue = get('SalesComparisonApproachAmount')
    || get('IndicatedValueBySalesComparisonApproach');

  const costValue = get('CostApproachAmount')
    || get('IndicatedValueByCostApproach');

  const incomeValue = get('IncomeApproachAmount')
    || get('IndicatedValueByIncomeApproach');

  // Effective date
  const effectiveDate = get('InspectionDate') || get('EffectiveDate');

  // Condition rating — appears as C1-C6 in the XML text
  const conditionMatches = xmlContent.match(/\b(C[1-6])\b/g) || [];
  // Most common condition rating = subject's rating
  const conditionCounts = {};
  for (const c of conditionMatches) conditionCounts[c] = (conditionCounts[c] || 0) + 1;
  const conditionRating = Object.entries(conditionCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Quality rating — appears as Q1-Q6
  const qualityMatches = xmlContent.match(/\b(Q[1-6])\b/g) || [];
  const qualityCounts = {};
  for (const q of qualityMatches) qualityCounts[q] = (qualityCounts[q] || 0) + 1;
  const qualityRating = Object.entries(qualityCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Year built
  const yearBuilt = get('PropertyStructureBuiltYear') || get('YearBuilt');

  // GLA — look for actual living area, not $/SF
  const glaMatch = xmlContent.match(/FinishedGrossLivingAreaSquareFeetCount="(\d+)"/i)
    || xmlContent.match(/GrossLivingAreaAmount="(\d{3,5})"/i);  // 3-5 digit = SF not $/SF
  const gla = glaMatch ? glaMatch[1] : null;

  // Comp adjusted prices from self-closing COMPARABLE_SALE tags
  const compTags = xmlContent.match(/<COMPARABLE_SALE[^>]+>/gi) || [];
  const compsFromXml = [];
  for (const tag of compTags) {
    const seqId = tag.match(/PropertySequenceIdentifier="(\d+)"/i)?.[1];
    if (seqId === '0') continue; // sequence 0 = subject in MISMO

    const salePrice = tag.match(/PropertySalesAmount="([^"]+)"/i)?.[1];
    const adjPrice = tag.match(/AdjustedSalesPriceAmount="([^"]+)"/i)?.[1];
    const netAdj = tag.match(/SalePriceTotalAdjustmentAmount="([^"]+)"/i)?.[1];
    const netPct = tag.match(/SalePriceTotalAdjustmentNetPercent="([^"]+)"/i)?.[1];
    const grossPct = tag.match(/SalesPriceTotalAdjustmentGrossPercent="([^"]+)"/i)?.[1];

    if (salePrice) {
      compsFromXml.push({
        number: parseInt(seqId) || compsFromXml.length + 1,
        salePrice,
        adjustedPrice: adjPrice,
        netAdjustment: netAdj,
        netPercent: netPct,
        grossPercent: grossPct,
      });
    }
  }

  return { finalValue, scaValue, costValue, incomeValue, effectiveDate, conditionRating, qualityRating, yearBuilt, gla, compsFromXml };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runFullDecisionPipeline(xmlDir = null, outputDir = null) {
  // Auto-detect paths
  const projectRoot = path.resolve(__dirname, '../../');

  if (!xmlDir) {
    xmlDir = findXmlDir(projectRoot);
    if (!xmlDir) {
      // Try one level up (worktree -> main repo)
      xmlDir = findXmlDir(path.resolve(projectRoot, '../../..'));
    }
    if (!xmlDir) {
      throw new Error(
        'Cannot find training_output/xml_exports/. ' +
        'Pass --xml-dir <path> or ensure the directory exists relative to project root.'
      );
    }
  }

  if (!outputDir) {
    outputDir = findOutputDir(projectRoot);
    if (!outputDir) {
      outputDir = path.join(projectRoot, 'training_output');
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const xmlFiles = fs.readdirSync(xmlDir).filter(f => f.toLowerCase().endsWith('.xml'));
  console.log(`[fullDecisionPipeline] Found ${xmlFiles.length} XML files in: ${xmlDir}`);
  console.log(`[fullDecisionPipeline] Writing output to: ${outputDir}`);

  const allExamples = [];
  const stats = {
    filesProcessed: 0,
    filesErrored: 0,
    examplesByType: {
      narrative_writing: 0,
      adjustment_reasoning: 0,
      comp_selection: 0,
      reconciliation: 0,
      condition_quality: 0,
      full_appraisal: 0,
    },
    totalExamples: 0,
    valueDistribution: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
    conditionDistribution: {},
    errors: [],
  };

  let processed = 0;
  for (const file of xmlFiles) {
    const xmlPath = path.join(xmlDir, file);
    try {
      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');

      // Extract structured data via both extractors
      const parsed = parseMismoXml(xmlPath);
      const decisions = extractDecisions(xmlContent, file);

      // Supplemental extraction for MISMO 2.6 GSE fields that decisionExtractor misses
      const supp = extractMismoSupplemental(xmlContent);

      // Merge supplemental data into decisions where missing
      if (!decisions.reconciliation.finalValue && supp.finalValue) {
        decisions.reconciliation.finalValue = supp.finalValue;
      }
      if (!decisions.reconciliation.indicatedValueSCA && supp.scaValue) {
        decisions.reconciliation.indicatedValueSCA = supp.scaValue;
      }
      if (!decisions.reconciliation.indicatedValueCost && supp.costValue) {
        decisions.reconciliation.indicatedValueCost = supp.costValue;
      }
      if (!decisions.reconciliation.effectiveDate && supp.effectiveDate) {
        decisions.reconciliation.effectiveDate = supp.effectiveDate;
      }
      if (!decisions.conditionRating.rating && supp.conditionRating) {
        decisions.conditionRating.rating = supp.conditionRating;
      }
      if (!decisions.subject.yearBuilt && supp.yearBuilt) {
        decisions.subject.yearBuilt = supp.yearBuilt;
        decisions.conditionRating.yearBuilt = supp.yearBuilt;
      }
      if (!decisions.subject.gla && supp.gla) {
        decisions.subject.gla = supp.gla;
      }
      // Recalculate ageAtAppraisal
      if (decisions.conditionRating.rating && decisions.subject.yearBuilt && !decisions.conditionRating.ageAtAppraisal) {
        const yr = parseInt(decisions.subject.yearBuilt);
        const effectiveYr = supp.effectiveDate
          ? new Date(supp.effectiveDate).getFullYear()
          : new Date().getFullYear();
        if (yr > 1800 && yr < effectiveYr) {
          decisions.conditionRating.ageAtAppraisal = effectiveYr - yr;
        }
      }

      // Generate all 6 example types
      const narrative = makeNarrativeExamples(parsed);
      // decisionExtractor uses wrong MISMO field names for comp.salePrice and adjustments;
      // always use supplemental extraction which reads correct MISMO 2.6 attributes
      const adjustment = makeAdjustmentExamplesFromSupp(decisions.subject, supp.compsFromXml);
      const compSel = makeCompSelectionExamples(decisions, null);
      const recon = makeReconciliationExamples(decisions);
      const condQual = makeConditionQualityExamples(decisions);
      const full = makeFullAppraisalExamples(parsed, decisions);

      const fileExamples = [...narrative, ...adjustment, ...compSel, ...recon, ...condQual, ...full];
      allExamples.push(...fileExamples);

      // Accumulate stats
      stats.filesProcessed++;
      for (const ex of fileExamples) {
        stats.examplesByType[ex.type] = (stats.examplesByType[ex.type] || 0) + 1;
      }

      if (decisions.reconciliation.finalValue) {
        const val = parseInt(decisions.reconciliation.finalValue);
        if (val > 0) {
          stats.valueDistribution.sum += val;
          stats.valueDistribution.count++;
          if (val < stats.valueDistribution.min) stats.valueDistribution.min = val;
          if (val > stats.valueDistribution.max) stats.valueDistribution.max = val;
        }
      }

      if (decisions.conditionRating.rating) {
        const c = decisions.conditionRating.rating;
        stats.conditionDistribution[c] = (stats.conditionDistribution[c] || 0) + 1;
      }

      processed++;
      if (processed % 50 === 0) {
        console.log(`  Progress: ${processed}/${xmlFiles.length} files (${allExamples.length} examples so far)`);
      }
    } catch (err) {
      stats.filesErrored++;
      stats.errors.push({ file, error: err.message });
    }
  }

  stats.totalExamples = allExamples.length;
  if (stats.valueDistribution.count > 0) {
    stats.valueDistribution.avg = Math.round(stats.valueDistribution.sum / stats.valueDistribution.count);
    if (stats.valueDistribution.min === Infinity) stats.valueDistribution.min = null;
    if (stats.valueDistribution.max === -Infinity) stats.valueDistribution.max = null;
  }

  // Write JSONL
  const jsonlPath = path.join(outputDir, 'llama_training_data.jsonl');
  const jsonlContent = allExamples.map(ex => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(jsonlPath, jsonlContent, 'utf-8');

  // Write stats
  const statsPath = path.join(outputDir, 'training_stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');

  console.log(`\n[fullDecisionPipeline] Complete!`);
  console.log(`  Total examples: ${stats.totalExamples}`);
  console.log(`  By type:`);
  for (const [type, count] of Object.entries(stats.examplesByType)) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`  Output: ${jsonlPath}`);
  console.log(`  Stats:  ${statsPath}`);
  if (stats.filesErrored > 0) {
    console.warn(`  Errors: ${stats.filesErrored} files failed`);
  }

  return { stats, outputPath: jsonlPath, statsPath };
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────────
if (process.argv[1] === __filename || process.argv[1]?.endsWith('fullDecisionPipeline.js')) {
  const args = process.argv.slice(2);
  let xmlDir = null;
  let outputDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--xml-dir') xmlDir = args[++i];
    if (args[i] === '--output-dir') outputDir = args[++i];
  }

  runFullDecisionPipeline(xmlDir, outputDir).catch(err => {
    console.error('Pipeline failed:', err.message);
    process.exit(1);
  });
}

export default { runFullDecisionPipeline };
