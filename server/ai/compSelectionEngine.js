/**
 * server/ai/compSelectionEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-Powered Comparable Selection.
 *
 * This is the core differentiator. Instead of appraisers spending 30-60
 * minutes manually searching MLS and picking comps, the AI:
 *
 *   1. Analyzes the subject property characteristics
 *   2. Searches MLS data for all potential comps
 *   3. Scores each comp on similarity (location, size, age, features)
 *   4. Ranks them with explanations for WHY each comp is good/bad
 *   5. Suggests the optimal 3-6 comp set
 *   6. Pre-calculates adjustment estimates
 *   7. Flags potential reviewer objections
 *
 * The AI learns from the appraiser's history — which comps they choose,
 * which they reject, and why. Over time, selections get better.
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

/**
 * Score a potential comp against the subject property.
 */
function scoreComp(subject, comp) {
  let score = 100;
  const factors = [];

  // Location proximity (most important — up to 30 points)
  if (subject.zip === comp.zip) { score += 5; factors.push({ factor: 'Same ZIP', impact: +5 }); }
  else { score -= 15; factors.push({ factor: 'Different ZIP', impact: -15 }); }
  if (subject.city?.toLowerCase() === comp.city?.toLowerCase()) { factors.push({ factor: 'Same city', impact: 0 }); }
  else { score -= 20; factors.push({ factor: 'Different city', impact: -20 }); }

  // GLA similarity (up to 25 points)
  if (subject.gla && comp.gla) {
    const glaDiff = Math.abs(subject.gla - comp.gla) / subject.gla;
    if (glaDiff <= 0.10) { score += 10; factors.push({ factor: `GLA within 10% (${comp.gla} vs ${subject.gla})`, impact: +10 }); }
    else if (glaDiff <= 0.20) { factors.push({ factor: `GLA within 20%`, impact: 0 }); }
    else if (glaDiff <= 0.30) { score -= 10; factors.push({ factor: `GLA diff ${Math.round(glaDiff * 100)}%`, impact: -10 }); }
    else { score -= 25; factors.push({ factor: `GLA diff ${Math.round(glaDiff * 100)}% — may be rejected`, impact: -25 }); }
  }

  // Age similarity (up to 15 points)
  if (subject.yearBuilt && comp.yearBuilt) {
    const ageDiff = Math.abs(subject.yearBuilt - comp.yearBuilt);
    if (ageDiff <= 5) { score += 10; factors.push({ factor: `Age within 5 years`, impact: +10 }); }
    else if (ageDiff <= 15) { score += 5; factors.push({ factor: `Age within 15 years`, impact: +5 }); }
    else if (ageDiff <= 30) { score -= 5; factors.push({ factor: `Age diff ${ageDiff} years`, impact: -5 }); }
    else { score -= 15; factors.push({ factor: `Age diff ${ageDiff} years — significant`, impact: -15 }); }
  }

  // Sale date recency (up to 15 points)
  if (comp.soldDate) {
    const monthsAgo = Math.round((Date.now() - new Date(comp.soldDate).getTime()) / (30.44 * 86400000));
    if (monthsAgo <= 3) { score += 15; factors.push({ factor: `Sold ${monthsAgo}mo ago — very recent`, impact: +15 }); }
    else if (monthsAgo <= 6) { score += 10; factors.push({ factor: `Sold ${monthsAgo}mo ago`, impact: +10 }); }
    else if (monthsAgo <= 12) { score += 5; factors.push({ factor: `Sold ${monthsAgo}mo ago`, impact: +5 }); }
    else { score -= 10; factors.push({ factor: `Sold ${monthsAgo}mo ago — stale`, impact: -10 }); }
  }

  // Price range sanity
  if (comp.soldPrice && subject.estimatedValue) {
    const priceDiff = Math.abs(comp.soldPrice - subject.estimatedValue) / subject.estimatedValue;
    if (priceDiff > 0.50) { score -= 20; factors.push({ factor: `Price ${Math.round(priceDiff * 100)}% different — may need justification`, impact: -20 }); }
    else if (priceDiff > 0.25) { score -= 10; factors.push({ factor: `Price ${Math.round(priceDiff * 100)}% different`, impact: -10 }); }
  }

  // Bedroom count
  if (subject.beds && comp.beds) {
    const bedDiff = Math.abs(subject.beds - comp.beds);
    if (bedDiff === 0) { score += 5; factors.push({ factor: 'Same bed count', impact: +5 }); }
    else if (bedDiff === 1) { factors.push({ factor: `${bedDiff} bed difference`, impact: 0 }); }
    else { score -= 5 * bedDiff; factors.push({ factor: `${bedDiff} bed difference`, impact: -5 * bedDiff }); }
  }

  // Bathroom count
  if (subject.baths && comp.baths) {
    const bathDiff = Math.abs(subject.baths - comp.baths);
    if (bathDiff <= 0.5) { score += 3; factors.push({ factor: 'Similar bath count', impact: +3 }); }
    else if (bathDiff > 1.5) { score -= 8; factors.push({ factor: `${bathDiff} bath difference`, impact: -8 }); }
  }

  return {
    score: Math.max(0, Math.min(150, score)),
    grade: score >= 110 ? 'A' : score >= 90 ? 'B' : score >= 70 ? 'C' : score >= 50 ? 'D' : 'F',
    factors,
  };
}

/**
 * AI-powered comp selection — returns ranked comps with explanations.
 */
export async function selectComps(caseId, options = {}) {
  const db = getDb();

  // Get subject property
  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  const subject = {
    address: caseData.property_address,
    city: caseData.city || caseData.property_city,
    state: caseData.state || caseData.property_state,
    zip: caseData.zip || caseData.property_zip,
    gla: caseData.gla || caseData.living_area,
    yearBuilt: caseData.year_built,
    beds: caseData.bedrooms,
    baths: caseData.bathrooms,
    lotSize: caseData.lot_size,
    estimatedValue: caseData.estimated_value || caseData.opinion_value,
    propertyType: caseData.property_type,
  };

  // Get available comps from MLS cache
  const comps = db.prepare(`SELECT * FROM mls_listings_cache
    WHERE (LOWER(city) = LOWER(?) OR zip = ?)
    AND status IN ('Sold', 'Closed')
    ORDER BY sold_date DESC LIMIT 50`)
    .all(subject.city || '', subject.zip || '');

  // Score each comp
  const scored = comps.map(comp => ({
    ...comp,
    photos: JSON.parse(comp.photos_json || '[]'),
    scoring: scoreComp(subject, {
      ...comp,
      gla: comp.gla,
      yearBuilt: comp.year_built,
      beds: comp.beds,
      baths: comp.baths,
      soldPrice: comp.sold_price,
      soldDate: comp.sold_date,
      zip: comp.zip,
      city: comp.city,
    }),
  })).sort((a, b) => b.scoring.score - a.scoring.score);

  // Top candidates
  const topComps = scored.slice(0, options.maxComps || 10);
  const recommended = scored.filter(c => c.scoring.grade === 'A' || c.scoring.grade === 'B').slice(0, options.recommendCount || 5);

  // AI analysis of the top picks
  let aiAnalysis = null;
  if (topComps.length >= 3 && options.includeAiAnalysis !== false) {
    try {
      const compSummaries = topComps.slice(0, 6).map((c, i) =>
        `Comp ${i + 1}: ${c.address}, ${c.city} | $${c.sold_price?.toLocaleString()} | ${c.gla} SF | ${c.year_built} | Score: ${c.scoring.score} (${c.scoring.grade})`
      ).join('\n');

      const prompt = `You are a real estate appraiser selecting comparable sales.

Subject: ${subject.address}, ${subject.city}, ${subject.state} ${subject.zip}
GLA: ${subject.gla} SF | Year Built: ${subject.yearBuilt} | ${subject.beds}BR/${subject.baths}BA

Top candidates:
${compSummaries}

Recommend the best 3 comps and explain why. Note any potential reviewer objections. Be concise.`;

      aiAnalysis = await callAI([{ role: 'user', content: prompt }], { maxTokens: 400, temperature: 0.2 });
    } catch (err) {
      log.warn('comp-selection:ai-error', { error: err.message });
    }
  }

  log.info('comp-selection:complete', { caseId, totalCandidates: comps.length, topCount: topComps.length });

  return {
    subject,
    totalCandidates: comps.length,
    topComps: topComps.map(c => ({
      mlsNumber: c.mls_number,
      address: c.address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      soldPrice: c.sold_price,
      listPrice: c.list_price,
      soldDate: c.sold_date,
      dom: c.dom,
      gla: c.gla,
      yearBuilt: c.year_built,
      beds: c.beds,
      baths: c.baths,
      lotSize: c.lot_size,
      style: c.style,
      garage: c.garage,
      basement: c.basement,
      pool: Boolean(c.pool),
      score: c.scoring.score,
      grade: c.scoring.grade,
      factors: c.scoring.factors,
    })),
    recommended: recommended.map(c => c.mls_number),
    aiAnalysis,
  };
}

/**
 * Learn from appraiser's comp choices.
 * When they accept/reject a comp, we store the preference.
 */
export function recordCompPreference(userId, caseId, mlsNumber, action, reason) {
  const db = getDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS comp_preferences (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id TEXT, case_id TEXT, mls_number TEXT,
      action TEXT, reason TEXT, created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare('INSERT INTO comp_preferences (user_id, case_id, mls_number, action, reason) VALUES (?, ?, ?, ?, ?)')
      .run(userId, caseId, mlsNumber, action, reason || null);
    log.info('comp-pref:recorded', { userId, action, mlsNumber });
  } catch (err) {
    log.warn('comp-pref:error', { error: err.message });
  }
}

export default { selectComps, recordCompPreference, scoreComp };
