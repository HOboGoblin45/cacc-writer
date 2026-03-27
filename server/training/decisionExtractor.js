/**
 * server/training/decisionExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts DECISION DATA from completed appraisal XML files.
 * 
 * This goes beyond narrative extraction — it captures the appraiser's
 * professional judgment: adjustment amounts, comp selection reasoning,
 * value reconciliation, condition ratings, and market analysis decisions.
 * 
 * The output is structured training data that teaches an AI model to
 * THINK like the appraiser, not just write like them.
 * 
 * Input: MISMO 2.6 XML files (from ACI batch conversion)
 * Output: decision_training_data.jsonl — structured decision examples
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract all decision data from a single MISMO XML file.
 */
export function extractDecisions(xmlContent, sourceFile = '') {
  const decisions = {
    source: sourceFile,
    subject: {},
    comps: [],
    adjustments: [],
    reconciliation: {},
    marketAnalysis: {},
    conditionRating: {},
    qualityRating: {},
    hbuDecision: {},
    narrativeDecisions: {},
  };

  try {
    // ── Subject Property Data ──────────────────────────────────────────────
    decisions.subject = {
      address: extractAttr(xmlContent, '_STREET_ADDRESS'),
      city: extractAttr(xmlContent, '_CITY'),
      state: extractAttr(xmlContent, '_STATE'),
      county: extractAttr(xmlContent, '_COUNTY'),
      yearBuilt: extractAttr(xmlContent, 'YearBuilt') || extractAttr(xmlContent, 'PropertyAge'),
      gla: extractAttr(xmlContent, 'GrossLivingArea') || extractAttr(xmlContent, 'LivingArea'),
      bedrooms: extractAttr(xmlContent, 'BedroomCount'),
      bathrooms: extractAttr(xmlContent, 'BathroomCount'),
      lotSize: extractAttr(xmlContent, 'LotSizeSquareFeet'),
      salePrice: extractAttr(xmlContent, 'SalePrice') || extractAttr(xmlContent, 'ContractPrice'),
      condition: extractAttr(xmlContent, 'PropertyCondition') || extractConditionFromNarrative(xmlContent),
      quality: extractAttr(xmlContent, 'QualityRating'),
      design: extractAttr(xmlContent, 'DesignStyle') || extractAttr(xmlContent, 'ArchitecturalStyle'),
    };

    // ── Comparable Sales + Adjustments ─────────────────────────────────────
    // Extract up to 6 comps with their adjustment data
    const compSections = xmlContent.match(/<COMPARABLE_SALE[^>]*>[\s\S]*?<\/COMPARABLE_SALE>/gi) || [];
    
    for (let i = 0; i < compSections.length; i++) {
      const section = compSections[i];
      const comp = {
        number: i + 1,
        address: extractAttr(section, '_STREET_ADDRESS'),
        salePrice: extractAttr(section, 'SalePrice') || extractAttr(section, 'ClosedPrice'),
        gla: extractAttr(section, 'GrossLivingArea') || extractAttr(section, 'LivingArea'),
        yearBuilt: extractAttr(section, 'YearBuilt'),
        bedrooms: extractAttr(section, 'BedroomCount'),
        bathrooms: extractAttr(section, 'BathroomCount'),
        lotSize: extractAttr(section, 'LotSizeSquareFeet'),
        condition: extractAttr(section, 'PropertyCondition'),
        saleDate: extractAttr(section, 'SaleDate') || extractAttr(section, 'ClosedDate'),
        proximity: extractAttr(section, 'ProximityToSubject'),
      };

      // Extract adjustment amounts
      const adjustmentData = {
        saleOrFinancing: extractAdjustment(section, 'SaleOrFinancing'),
        dateOfSale: extractAdjustment(section, 'DateOfSale') || extractAdjustment(section, 'TimeAdjustment'),
        location: extractAdjustment(section, 'Location'),
        site: extractAdjustment(section, 'Site') || extractAdjustment(section, 'LotSize'),
        view: extractAdjustment(section, 'View'),
        design: extractAdjustment(section, 'Design') || extractAdjustment(section, 'Style'),
        quality: extractAdjustment(section, 'Quality'),
        age: extractAdjustment(section, 'Age') || extractAdjustment(section, 'ActualAge'),
        condition: extractAdjustment(section, 'Condition'),
        gla: extractAdjustment(section, 'GrossLivingArea') || extractAdjustment(section, 'LivingArea'),
        basement: extractAdjustment(section, 'Basement'),
        functionalUtility: extractAdjustment(section, 'FunctionalUtility'),
        heatingCooling: extractAdjustment(section, 'HeatingCooling'),
        garage: extractAdjustment(section, 'Garage') || extractAdjustment(section, 'CarStorage'),
        porchPatioDeck: extractAdjustment(section, 'PorchPatioDeck'),
        other: extractAdjustment(section, 'Other'),
        netAdjustment: extractAttr(section, 'NetAdjustment'),
        grossAdjustment: extractAttr(section, 'GrossAdjustment'),
        adjustedPrice: extractAttr(section, 'AdjustedSalePrice') || extractAttr(section, 'AdjustedPrice'),
      };

      decisions.comps.push(comp);
      decisions.adjustments.push({
        compNumber: i + 1,
        compAddress: comp.address,
        ...adjustmentData,
      });
    }

    // ── Reconciliation / Value Opinion ─────────────────────────────────────
    decisions.reconciliation = {
      indicatedValueSCA: extractAttr(xmlContent, 'IndicatedValueBySalesComparison') 
        || extractAttr(xmlContent, 'SalesComparisonApproachValue'),
      indicatedValueCost: extractAttr(xmlContent, 'IndicatedValueByCostApproach')
        || extractAttr(xmlContent, 'CostApproachValue'),
      indicatedValueIncome: extractAttr(xmlContent, 'IndicatedValueByIncomeApproach')
        || extractAttr(xmlContent, 'IncomeApproachValue'),
      finalValue: extractAttr(xmlContent, 'FinalOpinionOfValue')
        || extractAttr(xmlContent, 'AppraisedValue')
        || extractAttr(xmlContent, 'MarketValue'),
      effectiveDate: extractAttr(xmlContent, 'EffectiveDate')
        || extractAttr(xmlContent, 'InspectionDate'),
    };

    // ── Condition & Quality Decisions ──────────────────────────────────────
    decisions.conditionRating = {
      rating: decisions.subject.condition,
      yearBuilt: decisions.subject.yearBuilt,
      ageAtAppraisal: decisions.reconciliation.effectiveDate && decisions.subject.yearBuilt
        ? new Date(decisions.reconciliation.effectiveDate).getFullYear() - parseInt(decisions.subject.yearBuilt)
        : null,
    };

    // ── Market Analysis Decisions ─────────────────────────────────────────
    // Extract market time adjustment percentage from narratives
    const marketTimeMatch = xmlContent.match(/market time adjustment of (\d+\.?\d*)%/i);
    decisions.marketAnalysis = {
      marketTimeAdjustment: marketTimeMatch ? parseFloat(marketTimeMatch[1]) : null,
      propertyValues: extractAttr(xmlContent, 'PropertyValues') || 'Unknown',
      demandSupply: extractAttr(xmlContent, 'DemandSupply') || 'Unknown',
      marketingTime: extractAttr(xmlContent, 'MarketingTime') || 'Unknown',
    };

  } catch (err) {
    log.error('decision-extractor:error', { source: sourceFile, error: err.message });
  }

  return decisions;
}

/**
 * Convert extracted decisions into training examples.
 * Each example teaches the model a specific type of decision.
 */
export function decisionsToTraining(decisions) {
  const examples = [];
  const subject = decisions.subject;

  // ── Adjustment Training Examples ────────────────────────────────────────
  for (const adj of decisions.adjustments) {
    const comp = decisions.comps.find(c => c.number === adj.compNumber);
    if (!comp || !comp.salePrice) continue;

    const example = {
      type: 'adjustment_reasoning',
      messages: [
        {
          role: 'system',
          content: 'You are an expert appraiser calculating adjustments for the sales comparison grid. Show your reasoning for each adjustment amount.'
        },
        {
          role: 'user',
          content: `Calculate adjustments between the subject and comparable sale:

SUBJECT: ${subject.address || 'N/A'} | ${subject.gla || '?'} SF | Built ${subject.yearBuilt || '?'} | ${subject.bedrooms || '?'}BR/${subject.bathrooms || '?'}BA | ${subject.condition || '?'}
COMP #${adj.compNumber}: ${comp.address || 'N/A'} | $${parseInt(comp.salePrice || 0).toLocaleString()} | ${comp.gla || '?'} SF | Built ${comp.yearBuilt || '?'} | ${comp.bedrooms || '?'}BR/${comp.bathrooms || '?'}BA | ${comp.condition || '?'}

What adjustments would you make and why?`
        },
        {
          role: 'assistant',
          content: formatAdjustmentResponse(subject, comp, adj)
        }
      ]
    };

    if (example.messages[2].content.length > 50) {
      examples.push(example);
    }
  }

  // ── Reconciliation Training Example ─────────────────────────────────────
  if (decisions.reconciliation.finalValue) {
    examples.push({
      type: 'reconciliation_reasoning',
      messages: [
        {
          role: 'system',
          content: 'You are an expert appraiser reconciling the approaches to value. Explain your reasoning for the final value opinion.'
        },
        {
          role: 'user',
          content: `Reconcile the following value indications for ${subject.address || 'the subject'}:
Sales Comparison: $${parseInt(decisions.reconciliation.indicatedValueSCA || 0).toLocaleString() || 'Not developed'}
Cost Approach: $${parseInt(decisions.reconciliation.indicatedValueCost || 0).toLocaleString() || 'Not developed'}
Income Approach: $${parseInt(decisions.reconciliation.indicatedValueIncome || 0).toLocaleString() || 'Not developed'}`
        },
        {
          role: 'assistant',
          content: `The final opinion of market value is $${parseInt(decisions.reconciliation.finalValue).toLocaleString()}. The greatest weight is applied to the Sales Comparison Approach as it best reflects the actions of buyers and sellers in this market.`
        }
      ]
    });
  }

  // ── Condition Rating Training Example ───────────────────────────────────
  if (decisions.conditionRating.rating && decisions.conditionRating.yearBuilt) {
    examples.push({
      type: 'condition_rating',
      messages: [
        {
          role: 'system',
          content: 'You are an expert appraiser assigning condition ratings (C1-C6) based on property characteristics.'
        },
        {
          role: 'user',
          content: `What condition rating would you assign to a ${subject.design || 'residential'} property built in ${subject.yearBuilt}? GLA: ${subject.gla || 'Unknown'} SF.`
        },
        {
          role: 'assistant',
          content: `${decisions.conditionRating.rating}. The property was built ${decisions.conditionRating.ageAtAppraisal || '?'} years ago.`
        }
      ]
    });
  }

  return examples;
}

/**
 * Run the full extraction pipeline on a directory of XML files.
 */
export async function runDecisionPipeline(xmlDir, outputDir) {
  const files = fs.readdirSync(xmlDir).filter(f => f.endsWith('.xml'));
  log.info('decision-pipeline:start', { files: files.length, xmlDir });

  let totalDecisions = 0;
  let totalExamples = 0;
  const allExamples = [];
  const adjustmentStats = { totalComps: 0, avgNetPercent: 0, avgGrossPercent: 0 };
  const valueStats = [];
  const conditionCounts = {};

  for (const file of files) {
    try {
      const xmlContent = fs.readFileSync(path.join(xmlDir, file), 'utf8');
      const decisions = extractDecisions(xmlContent, file);
      const examples = decisionsToTraining(decisions);

      totalDecisions++;
      totalExamples += examples.length;
      allExamples.push(...examples);

      // Aggregate statistics
      if (decisions.comps.length) adjustmentStats.totalComps += decisions.comps.length;
      if (decisions.reconciliation.finalValue) {
        valueStats.push(parseInt(decisions.reconciliation.finalValue));
      }
      if (decisions.conditionRating.rating) {
        conditionCounts[decisions.conditionRating.rating] = (conditionCounts[decisions.conditionRating.rating] || 0) + 1;
      }
    } catch (err) {
      log.warn('decision-pipeline:file-error', { file, error: err.message });
    }
  }

  // Write training data
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'decision_training_data.jsonl');
  fs.writeFileSync(outputPath, allExamples.map(e => JSON.stringify(e)).join('\n'), 'utf8');

  // Write statistics
  const stats = {
    filesProcessed: totalDecisions,
    totalExamples,
    examplesByType: {},
    adjustmentStats,
    valueStats: valueStats.length ? {
      count: valueStats.length,
      avgValue: Math.round(valueStats.reduce((s, v) => s + v, 0) / valueStats.length),
      minValue: Math.min(...valueStats),
      maxValue: Math.max(...valueStats),
    } : null,
    conditionDistribution: conditionCounts,
  };

  allExamples.forEach(e => {
    stats.examplesByType[e.type] = (stats.examplesByType[e.type] || 0) + 1;
  });

  fs.writeFileSync(path.join(outputDir, 'decision_pipeline_stats.json'), JSON.stringify(stats, null, 2), 'utf8');

  log.info('decision-pipeline:complete', stats);
  return stats;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractAttr(xml, attrName) {
  const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAdjustment(xml, fieldName) {
  // Try multiple patterns for adjustment amounts
  const patterns = [
    new RegExp(`${fieldName}Adjustment="([^"]*)"`, 'i'),
    new RegExp(`${fieldName}AdjustmentAmount="([^"]*)"`, 'i'),
    new RegExp(`Adj.*${fieldName}.*?="([\\d\\-+,]+)"`, 'i'),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1].replace(/,/g, '').trim();
  }
  return null;
}

function extractConditionFromNarrative(xml) {
  const match = xml.match(/\b(C[1-6])\b/);
  return match ? match[1] : null;
}

function formatAdjustmentResponse(subject, comp, adj) {
  const parts = [];
  
  const fields = [
    ['dateOfSale', 'Date of Sale/Time'],
    ['location', 'Location'],
    ['site', 'Site'],
    ['view', 'View'],
    ['design', 'Design'],
    ['quality', 'Quality'],
    ['age', 'Age'],
    ['condition', 'Condition'],
    ['gla', 'GLA'],
    ['basement', 'Basement'],
    ['garage', 'Garage/Carport'],
    ['porchPatioDeck', 'Porch/Patio/Deck'],
  ];

  for (const [key, label] of fields) {
    const val = adj[key];
    if (val && val !== '0' && val !== '$0') {
      const amount = parseInt(val.replace(/[^0-9\-]/g, '')) || 0;
      if (amount !== 0) {
        parts.push(`${label}: ${amount > 0 ? '+' : ''}$${amount.toLocaleString()}`);
      }
    }
  }

  if (adj.netAdjustment) parts.push(`Net Adjustment: $${parseInt(adj.netAdjustment).toLocaleString()}`);
  if (adj.adjustedPrice) parts.push(`Adjusted Sale Price: $${parseInt(adj.adjustedPrice).toLocaleString()}`);

  return parts.length > 0 ? parts.join('\n') : 'No significant adjustments required.';
}

export default { extractDecisions, decisionsToTraining, runDecisionPipeline };
