/**
 * server/comparables/compPatternLearner.js
 * ------------------------------------------
 * Learns Charles's comp selection preferences from completed appraisals.
 *
 * Every time comps are imported from XML or MRED, the system extracts
 * measurable patterns: GLA ratio, distance, sale age, style match, beds match.
 * Over time, these patterns inform guidance for new appraisals.
 *
 * Storage: data/comp-patterns.json
 * Max 50 patterns per form type (sliding window, oldest dropped first).
 */

import path from 'path';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import fs from 'fs';

const PATTERNS_FILE = path.join(process.cwd(), 'data', 'comp-patterns.json');

// ── Pattern extraction ────────────────────────────────────────────────────────

/**
 * Extract measurable patterns from a set of comps vs the subject.
 *
 * @param {Object} subjectFacts - case facts object
 * @param {Array}  comps        - array of comp objects
 * @returns {Object|null}
 */
export function extractCompPatterns(subjectFacts, comps) {
  if (!comps || comps.length === 0) return null;

  const subject = {
    gla:       parseFloat(subjectFacts?.subject?.gla?.value || subjectFacts?.gla || 0),
    beds:      parseInt(subjectFacts?.subject?.bedrooms_above_grade?.value || subjectFacts?.beds || 0),
    baths:     parseFloat(subjectFacts?.subject?.bathrooms_above_grade?.value || subjectFacts?.baths || 0),
    style:     subjectFacts?.subject?.style?.value || subjectFacts?.style || '',
    yearBuilt: parseInt(subjectFacts?.subject?.year_built?.value || subjectFacts?.yearBuilt || 0),
  };

  const patterns = comps
    .map(comp => ({
      glaRatio:      comp.gla && subject.gla ? comp.gla / subject.gla : null,
      distanceMiles: typeof comp.distanceMiles === 'number' ? comp.distanceMiles : null,
      saleAgeDays:   comp.saleDate
        ? Math.floor((Date.now() - new Date(comp.saleDate)) / 86_400_000)
        : null,
      sameStyle: comp.style && subject.style ? comp.style === subject.style : null,
      sameBeds:  comp.beds && subject.beds ? comp.beds === subject.beds : null,
    }))
    .filter(p => p.glaRatio !== null && p.glaRatio > 0);

  if (patterns.length === 0) return null;

  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const distValues  = patterns.map(p => p.distanceMiles).filter(v => v !== null);
  const ageValues   = patterns.map(p => p.saleAgeDays).filter(v => v !== null);
  const styleValues = patterns.map(p => p.sameStyle).filter(v => v !== null);
  const bedValues   = patterns.map(p => p.sameBeds).filter(v => v !== null);

  return {
    compCount:        patterns.length,
    avgGlaRatio:      avg(patterns.map(p => p.glaRatio)),
    maxDistanceMiles: distValues.length ? Math.max(...distValues) : null,
    maxSaleAgeDays:   ageValues.length  ? Math.max(...ageValues)  : null,
    styleConsistency: styleValues.length ? styleValues.filter(Boolean).length / styleValues.length : null,
    bedConsistency:   bedValues.length   ? bedValues.filter(Boolean).length   / bedValues.length   : null,
    subjectGla:       subject.gla || null,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Save extracted patterns for a given form type.
 */
export function saveCompPatterns(formType, patterns) {
  if (!patterns) return;
  fs.mkdirSync(path.dirname(PATTERNS_FILE), { recursive: true });
  const existing = readJSON(PATTERNS_FILE, { patterns: {} });
  if (!existing.patterns[formType]) existing.patterns[formType] = [];
  existing.patterns[formType].push({ ...patterns, learnedAt: new Date().toISOString() });
  // Keep last 50 per form type
  if (existing.patterns[formType].length > 50) {
    existing.patterns[formType] = existing.patterns[formType].slice(-50);
  }
  writeJSON(PATTERNS_FILE, existing);
}

// ── Guidance generation ───────────────────────────────────────────────────────

/**
 * Generate comp selection guidance for a new appraisal based on past patterns.
 *
 * @param {string} formType     - e.g. '1004'
 * @param {Object} subjectFacts - current case facts
 * @returns {Object|null}       - guidance object or null if insufficient data
 */
export function getCompGuidance(formType, subjectFacts) {
  const data     = readJSON(PATTERNS_FILE, { patterns: {} });
  const patterns = data.patterns?.[formType] || [];
  if (patterns.length < 3) return null;

  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

  const glaRatios  = patterns.map(p => p.avgGlaRatio).filter(Boolean);
  const distances  = patterns.map(p => p.maxDistanceMiles).filter(v => v != null);
  const ages       = patterns.map(p => p.maxSaleAgeDays).filter(v => v != null);

  const avgGlaRatio = glaRatios.length ? avg(glaRatios) : 1.0;
  const avgDist     = distances.length  ? avg(distances)  : 1.0;
  const avgAge      = ages.length       ? avg(ages)        : 365;

  const subjectGla = parseFloat(subjectFacts?.subject?.gla?.value || 0);

  return {
    glaRange: subjectGla ? {
      min: Math.round(subjectGla * (avgGlaRatio - 0.15)),
      max: Math.round(subjectGla * (avgGlaRatio + 0.15)),
    } : null,
    maxDistanceMiles: Math.round(avgDist * 10) / 10,
    maxSaleAgeDays:   Math.round(avgAge),
    basedOnReports:   patterns.length,
    confidence:       patterns.length >= 10 ? 'high' : patterns.length >= 5 ? 'medium' : 'low',
  };
}
