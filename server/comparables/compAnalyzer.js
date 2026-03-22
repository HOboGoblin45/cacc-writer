/**
 * server/comparables/compAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered comparable analysis engine.
 * 
 * Automatically:
 *   1. Ranks comps by similarity to subject
 *   2. Suggests adjustments with dollar amounts
 *   3. Identifies the best 3 comps for the grid
 *   4. Generates comp discussion narratives
 *   5. Flags potential issues (stale sales, excessive adjustments)
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbAll, dbRun } from '../db/database.js';
import { geocodeAddress, distanceMiles } from '../geocoder.js';
import log from '../logger.js';

// ── Similarity Scoring ───────────────────────────────────────────────────────

/**
 * Score how similar a comp is to the subject.
 * Higher = more similar = better comp.
 * 
 * @param {Object} subject — subject property facts
 * @param {Object} comp — comp property data
 * @returns {Object} { totalScore, breakdown }
 */
export function scoreCompSimilarity(subject, comp) {
  const breakdown = {};
  let totalScore = 0;
  const maxScore = 100;

  // GLA (25 points max)
  const subjectGla = parseFloat(subject.gla || subject.improvements?.gla || 0);
  const compGla = parseFloat(comp.gla || 0);
  if (subjectGla && compGla) {
    const glaPct = Math.abs(subjectGla - compGla) / subjectGla;
    const glaScore = Math.max(0, 25 - glaPct * 100);
    breakdown.gla = { score: Math.round(glaScore), diff: compGla - subjectGla, pct: (glaPct * 100).toFixed(1) };
    totalScore += glaScore;
  }

  // Year Built / Age (15 points max)
  const subjectYear = parseInt(subject.yearBuilt || subject.improvements?.yearBuilt || 0);
  const compYear = parseInt(comp.yearBuilt || 0);
  if (subjectYear && compYear) {
    const ageDiff = Math.abs(subjectYear - compYear);
    const ageScore = Math.max(0, 15 - ageDiff * 0.75);
    breakdown.age = { score: Math.round(ageScore), diff: compYear - subjectYear };
    totalScore += ageScore;
  }

  // Bedrooms (10 points)
  const subjectBed = parseInt(subject.bedrooms || subject.improvements?.bedrooms || 0);
  const compBed = parseInt(comp.bedrooms || 0);
  if (subjectBed && compBed) {
    const bedDiff = Math.abs(subjectBed - compBed);
    const bedScore = bedDiff === 0 ? 10 : bedDiff === 1 ? 6 : bedDiff === 2 ? 2 : 0;
    breakdown.bedrooms = { score: bedScore, diff: compBed - subjectBed };
    totalScore += bedScore;
  }

  // Bathrooms (10 points)
  const subjectBath = parseFloat(subject.bathrooms || subject.improvements?.bathrooms || 0);
  const compBath = parseFloat(comp.bathrooms || 0);
  if (subjectBath && compBath) {
    const bathDiff = Math.abs(subjectBath - compBath);
    const bathScore = bathDiff === 0 ? 10 : bathDiff <= 0.5 ? 7 : bathDiff <= 1 ? 4 : 0;
    breakdown.bathrooms = { score: bathScore, diff: compBath - subjectBath };
    totalScore += bathScore;
  }

  // Lot Size (10 points)
  const subjectLot = parseFloat(subject.lotSize || subject.site?.lotSize || subject.site?.area || 0);
  const compLot = parseFloat(comp.lotSize || 0);
  if (subjectLot && compLot) {
    const lotPct = Math.abs(subjectLot - compLot) / subjectLot;
    const lotScore = Math.max(0, 10 - lotPct * 40);
    breakdown.lotSize = { score: Math.round(lotScore), diff: compLot - subjectLot, pct: (lotPct * 100).toFixed(1) };
    totalScore += lotScore;
  }

  // Sale Date Recency (15 points — more recent = better)
  if (comp.saleDate || comp.sale_date) {
    const saleDate = new Date(comp.saleDate || comp.sale_date);
    const now = new Date();
    const monthsAgo = (now - saleDate) / (1000 * 60 * 60 * 24 * 30);
    const dateScore = monthsAgo <= 3 ? 15 : monthsAgo <= 6 ? 12 : monthsAgo <= 9 ? 8 : monthsAgo <= 12 ? 5 : 0;
    breakdown.saleDate = { score: dateScore, monthsAgo: Math.round(monthsAgo) };
    totalScore += dateScore;
  }

  // Proximity (15 points — closer = better)
  if (comp.distance || comp.proximityMiles) {
    const dist = parseFloat(comp.distance || comp.proximityMiles);
    const distScore = dist <= 0.25 ? 15 : dist <= 0.5 ? 12 : dist <= 1 ? 9 : dist <= 2 ? 5 : dist <= 3 ? 2 : 0;
    breakdown.proximity = { score: distScore, miles: dist.toFixed(2) };
    totalScore += distScore;
  }

  return {
    totalScore: Math.round(totalScore),
    maxScore,
    percentMatch: Math.round((totalScore / maxScore) * 100),
    breakdown,
  };
}

/**
 * Suggest adjustment amounts based on subject-comp differences.
 * Uses market-standard per-unit values.
 *
 * @param {Object} subject
 * @param {Object} comp
 * @param {Object} [marketFactors] — local market multipliers
 * @returns {Object} adjustments with amounts and reasoning
 */
export function suggestAdjustments(subject, comp, marketFactors = {}) {
  const adjustments = [];

  // Per-SF GLA adjustment (default $35/SF, adjustable by market)
  const glaSfValue = marketFactors.glaSfValue || 35;
  const subjectGla = parseFloat(subject.gla || subject.improvements?.gla || 0);
  const compGla = parseFloat(comp.gla || 0);
  if (subjectGla && compGla && subjectGla !== compGla) {
    const glaDiff = subjectGla - compGla;
    const amount = Math.round(glaDiff * glaSfValue);
    adjustments.push({
      category: 'gla',
      label: 'Gross Living Area',
      amount,
      reasoning: `Subject ${subjectGla} SF vs comp ${compGla} SF = ${glaDiff > 0 ? '+' : ''}${glaDiff} SF × $${glaSfValue}/SF`,
      confidence: 'high',
    });
  }

  // Age adjustment (default $1,500/year)
  const ageYearValue = marketFactors.ageYearValue || 1500;
  const subjectYear = parseInt(subject.yearBuilt || subject.improvements?.yearBuilt || 0);
  const compYear = parseInt(comp.yearBuilt || 0);
  if (subjectYear && compYear && subjectYear !== compYear) {
    const ageDiff = compYear - subjectYear; // positive = comp is newer
    const amount = Math.round(ageDiff * ageYearValue * -1); // newer comp → negative adj
    adjustments.push({
      category: 'age',
      label: 'Age',
      amount,
      reasoning: `Subject built ${subjectYear} vs comp built ${compYear} = ${Math.abs(ageDiff)} year difference × $${ageYearValue}/yr`,
      confidence: 'medium',
    });
  }

  // Bedroom adjustment (default $5,000/bedroom)
  const bedroomValue = marketFactors.bedroomValue || 5000;
  const subjectBed = parseInt(subject.bedrooms || subject.improvements?.bedrooms || 0);
  const compBed = parseInt(comp.bedrooms || 0);
  if (subjectBed && compBed && subjectBed !== compBed) {
    const bedDiff = subjectBed - compBed;
    adjustments.push({
      category: 'bedrooms',
      label: 'Bedrooms',
      amount: bedDiff * bedroomValue,
      reasoning: `Subject ${subjectBed} bed vs comp ${compBed} bed = ${bedDiff > 0 ? '+' : ''}${bedDiff} × $${bedroomValue}`,
      confidence: 'medium',
    });
  }

  // Bathroom adjustment (default $7,500/bathroom)
  const bathroomValue = marketFactors.bathroomValue || 7500;
  const subjectBath = parseFloat(subject.bathrooms || subject.improvements?.bathrooms || 0);
  const compBath = parseFloat(comp.bathrooms || 0);
  if (subjectBath && compBath && subjectBath !== compBath) {
    const bathDiff = subjectBath - compBath;
    adjustments.push({
      category: 'bathrooms',
      label: 'Bathrooms',
      amount: Math.round(bathDiff * bathroomValue),
      reasoning: `Subject ${subjectBath} bath vs comp ${compBath} bath = ${bathDiff > 0 ? '+' : ''}${bathDiff} × $${bathroomValue}`,
      confidence: 'medium',
    });
  }

  // Garage adjustment (default $10,000/car)
  const garageValue = marketFactors.garageValue || 10000;
  const subjectGarage = parseInt(subject.garageCars || subject.improvements?.garageCars || 0);
  const compGarage = parseInt(comp.garageCars || 0);
  if (subjectGarage !== compGarage) {
    const garageDiff = subjectGarage - compGarage;
    adjustments.push({
      category: 'garage_carport',
      label: 'Garage/Carport',
      amount: garageDiff * garageValue,
      reasoning: `Subject ${subjectGarage}-car vs comp ${compGarage}-car = ${garageDiff > 0 ? '+' : ''}${garageDiff} × $${garageValue}`,
      confidence: 'medium',
    });
  }

  // Basement adjustment (default $25/SF finished)
  const basementSfValue = marketFactors.basementSfValue || 25;
  const subjectBasement = parseFloat(subject.basementFinished || subject.improvements?.basementFinished || 0);
  const compBasement = parseFloat(comp.basementFinished || 0);
  if (subjectBasement !== compBasement) {
    const diff = subjectBasement - compBasement;
    adjustments.push({
      category: 'basement',
      label: 'Basement Finished Area',
      amount: Math.round(diff * basementSfValue),
      reasoning: `Subject ${subjectBasement} SF finished vs comp ${compBasement} SF = ${diff > 0 ? '+' : ''}${diff} SF × $${basementSfValue}/SF`,
      confidence: 'low',
    });
  }

  // Calculate totals
  const netAdjustment = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const grossAdjustment = adjustments.reduce((sum, a) => sum + Math.abs(a.amount), 0);
  const salePrice = parseFloat(comp.salePrice || comp.sale_price || 0);
  const adjustedPrice = salePrice + netAdjustment;
  const netAdjustmentPct = salePrice ? ((Math.abs(netAdjustment) / salePrice) * 100).toFixed(1) : 0;
  const grossAdjustmentPct = salePrice ? ((grossAdjustment / salePrice) * 100).toFixed(1) : 0;

  // Flag issues
  const flags = [];
  if (parseFloat(netAdjustmentPct) > 15) flags.push('Net adjustment exceeds 15% — may weaken this comp');
  if (parseFloat(grossAdjustmentPct) > 25) flags.push('Gross adjustment exceeds 25% — consider a different comp');

  return {
    adjustments,
    netAdjustment,
    grossAdjustment,
    adjustedPrice,
    netAdjustmentPct,
    grossAdjustmentPct,
    salePrice,
    flags,
  };
}

/**
 * Analyze all comps for a case, rank them, and suggest the best 3.
 *
 * @param {string} caseId
 * @returns {Object} analysis results
 */
export async function analyzeComps(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) throw new Error(`Case not found: ${caseId}`);

  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
  const subject = { ...facts.subject, ...facts.improvements, ...facts.site };

  let comps = [];
  try {
    comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1', [caseId]);
  } catch { return { error: 'No comps table' }; }

  if (comps.length === 0) return { error: 'No comps found for this case' };

  const analyzed = comps.map(comp => {
    const data = JSON.parse(comp.candidate_json || '{}');
    const similarity = scoreCompSimilarity(subject, data);
    const adjustmentAnalysis = suggestAdjustments(subject, data);

    return {
      id: comp.id,
      address: data.address || data.streetAddress || comp.source_key,
      city: data.city,
      salePrice: data.salePrice || data.sale_price,
      saleDate: data.saleDate || data.sale_date,
      similarity,
      adjustments: adjustmentAnalysis,
      data,
    };
  });

  // Sort by similarity score (highest first)
  analyzed.sort((a, b) => b.similarity.totalScore - a.similarity.totalScore);

  // Recommend top 3
  const recommended = analyzed.slice(0, 3);
  const alternates = analyzed.slice(3);

  // Generate flags
  const globalFlags = [];
  if (analyzed.length < 3) globalFlags.push(`Only ${analyzed.length} comps available — consider finding more`);
  if (recommended[0]?.similarity.percentMatch < 60) globalFlags.push('Best comp is only ' + recommended[0].similarity.percentMatch + '% match — may need better comps');

  const staleComps = analyzed.filter(c => {
    const months = c.similarity.breakdown?.saleDate?.monthsAgo;
    return months && months > 12;
  });
  if (staleComps.length > 0) globalFlags.push(`${staleComps.length} comp(s) have sale dates older than 12 months`);

  log.info('comp-analysis:complete', { caseId, totalComps: analyzed.length, recommended: recommended.length });

  return {
    caseId,
    subjectAddress: subject.address || subject.streetAddress,
    totalComps: analyzed.length,
    recommended,
    alternates,
    flags: globalFlags,
  };
}

export default { scoreCompSimilarity, suggestAdjustments, analyzeComps };
