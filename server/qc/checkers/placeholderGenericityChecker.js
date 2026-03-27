/**
 * server/qc/checkers/placeholderGenericityChecker.js
 * -----------------------------------------------------
 * Phase 7 — Weak Language / Placeholder / Genericity Detection
 *
 * Quality filter for low-value or obviously unsafe draft language.
 *
 * Detects:
 *   - Unresolved placeholders ([INSERT], TBD, bracket markers)
 *   - Obviously generic AI filler
 *   - Repetitive empty phrasing
 *   - Unsupported conclusory language
 *   - Low-information / low-specificity sections
 *   - Overconfident language without support
 *   - Internally contradictory hedging
 *
 * All checks are pattern-based or heuristic — no LLM involvement.
 */

import { registerRules } from '../qcRuleRegistry.js';

// ── Pattern libraries ───────────────────────────────────────────────────────

/** Unresolved placeholder patterns */
const PLACEHOLDER_PATTERNS = [
  { pattern: /\[INSERT[^\]]*\]/gi, label: '[INSERT...]' },
  { pattern: /\[TBD[^\]]*\]/gi, label: '[TBD...]' },
  { pattern: /\[TODO[^\]]*\]/gi, label: '[TODO...]' },
  { pattern: /\[PLACEHOLDER[^\]]*\]/gi, label: '[PLACEHOLDER...]' },
  { pattern: /\[FILL[^\]]*\]/gi, label: '[FILL...]' },
  { pattern: /\[ENTER[^\]]*\]/gi, label: '[ENTER...]' },
  { pattern: /\[ADD[^\]]*\]/gi, label: '[ADD...]' },
  { pattern: /\[REPLACE[^\]]*\]/gi, label: '[REPLACE...]' },
  { pattern: /\[YOUR[^\]]*\]/gi, label: '[YOUR...]' },
  { pattern: /\[XX+\]/gi, label: '[XX]' },
  { pattern: /\{INSERT[^}]*\}/gi, label: '{INSERT...}' },
  { pattern: /\{TBD[^}]*\}/gi, label: '{TBD...}' },
  { pattern: /___+/g, label: '___' },
  { pattern: /\bTBD\b/gi, label: 'TBD' },
  { pattern: /\bXXX+\b/gi, label: 'XXX' },
  { pattern: /\bN\/A\b(?!\s*(?:–|—|-)\s*(?:not|the))/gi, label: 'N/A (possibly unresolved)' },
];

/** Generic AI filler phrases — these indicate low-quality output */
const GENERIC_FILLER_PATTERNS = [
  /\b(?:it is important to note that|it should be noted that|it is worth mentioning that)\b/gi,
  /\b(?:in today's (?:real estate )?market|in the current market environment)\b/gi,
  /\b(?:the subject property is (?:a |an )?(?:well-maintained|well maintained|attractive|nice|good))\b/gi,
  /\b(?:overall[,]?\s+the (?:subject|property|neighborhood|market) (?:is|appears|seems) (?:to be )?(?:in |)(?:good|fair|average|typical))\b/gi,
  /\b(?:this is a (?:typical|standard|normal|average) (?:property|home|residence|dwelling))\b/gi,
  /\b(?:the (?:neighborhood|area|market|location) is (?:considered |deemed )?(?:desirable|attractive|pleasant|nice))\b/gi,
  /\b(?:based on (?:my|our|the) (?:analysis|research|review|inspection)[,]?\s+(?:it is|we|I) (?:conclude|determine|find|believe))\b/gi,
  /\b(?:all (?:things|factors) considered)\b/gi,
  /\b(?:taking (?:all|everything) into (?:account|consideration))\b/gi,
];

/** Unsupported conclusory language — strong claims without evidence */
const UNSUPPORTED_CONCLUSORY_PATTERNS = [
  /\b(?:clearly|obviously|undoubtedly|without question|unquestionably|indisputably)\s+(?:the|this|it)\b/gi,
  /\b(?:there is no (?:doubt|question) that)\b/gi,
  /\b(?:it is (?:clear|evident|obvious|apparent) that)\b/gi,
  /\b(?:the market (?:clearly |obviously )?(?:supports|indicates|demonstrates|shows|proves))\b/gi,
];

/** Vague market/value statements with no specificity */
const VAGUE_MARKET_PATTERNS = [
  /\b(?:the market (?:appears?|seems?) (?:to be )?(?:stable|active|healthy|strong|weak|soft))\b/gi,
  /\b(?:values (?:have been|are) (?:stable|increasing|decreasing|fluctuating))\b/gi,
  /\b(?:supply and demand (?:appear|seem)s? (?:to be )?(?:balanced|in balance|in equilibrium))\b/gi,
  /\b(?:the (?:area|neighborhood|market) (?:has|is) (?:experienced?|experiencing|seen|seeing) (?:growth|decline|stability))\b/gi,
];

/** Contradictory hedging patterns */
const CONTRADICTORY_HEDGING = [
  { pattern: /\b(?:however|but|although|nevertheless)[,]?\s+(?:it is|this is|the) (?:also |still )?(?:clear|evident|obvious)\b/gi, label: 'hedge-then-assert' },
  { pattern: /\b(?:while|although) (?:there (?:is|are|may be)|some|certain)\b[^.]{10,80}\b(?:clearly|obviously|undoubtedly)\b/gi, label: 'hedge-with-certainty' },
];

// ── Rule definitions ────────────────────────────────────────────────────────

const rules = [
  {
    ruleId: 'PLH-001',
    displayName: 'Unresolved Placeholder Detected',
    category: 'placeholder',
    defaultSeverity: 'blocker',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Section contains unresolved placeholder text ([INSERT], TBD, ___, etc.).',
    check: checkPlaceholders,
  },
  {
    ruleId: 'PLH-002',
    displayName: 'Generic AI Filler Language',
    category: 'section_quality',
    defaultSeverity: 'medium',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Section contains obviously generic AI filler phrases that add no value.',
    check: checkGenericFiller,
  },
  {
    ruleId: 'PLH-003',
    displayName: 'Unsupported Conclusory Language',
    category: 'unsupported_certainty',
    defaultSeverity: 'medium',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Section contains strong conclusory language without supporting evidence.',
    check: checkUnsupportedConclusions,
  },
  {
    ruleId: 'PLH-004',
    displayName: 'Vague Market Statement',
    category: 'section_quality',
    defaultSeverity: 'low',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Section contains vague market or value statements with no assignment-specific grounding.',
    check: checkVagueMarketStatements,
  },
  {
    ruleId: 'PLH-005',
    displayName: 'Low-Information Section',
    category: 'section_quality',
    defaultSeverity: 'medium',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context'],
    ruleType: 'heuristic',
    sourceReference: null,
    active: true,
    description: 'Section has very low specificity — no numbers, addresses, or assignment-specific details.',
    check: checkLowInformationSection,
  },
  {
    ruleId: 'PLH-006',
    displayName: 'Contradictory Hedging',
    category: 'unsupported_certainty',
    defaultSeverity: 'low',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Section contains internally contradictory hedging and certainty language.',
    check: checkContradictoryHedging,
  },
  {
    ruleId: 'PLH-007',
    displayName: 'Repetitive Phrasing',
    category: 'section_quality',
    defaultSeverity: 'low',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'heuristic',
    sourceReference: null,
    active: true,
    description: 'Section contains repetitive sentences or phrases.',
    check: checkRepetitivePhrasing,
  },
];

// ── Check implementations ───────────────────────────────────────────────────

/** @param {import('../types.js').QCRuleContext} ctx */
function checkPlaceholders(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text;
    const allMatches = [];

    for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        allMatches.push(...matches.map(m => ({ match: m, label })));
      }
    }

    if (allMatches.length > 0) {
      const severity = allMatches.length >= 3 ? 'blocker' : 'high';
      results.push({
        ruleId: 'PLH-001',
        severity,
        category: 'placeholder',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `${allMatches.length} unresolved placeholder(s) in "${sectionId}".`,
        detailMessage: `Found: ${allMatches.slice(0, 5).map(m => `"${m.match}"`).join(', ')}${allMatches.length > 5 ? ` and ${allMatches.length - 5} more` : ''}.`,
        suggestedAction: 'Replace all placeholders with actual content before finalizing.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: allMatches.slice(0, 10).map(m => m.match),
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkGenericFiller(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text;
    const allMatches = [];

    for (const pattern of GENERIC_FILLER_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        allMatches.push(...matches);
      }
    }

    if (allMatches.length >= 2) {
      results.push({
        ruleId: 'PLH-002',
        severity: allMatches.length >= 4 ? 'high' : 'medium',
        category: 'section_quality',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `${allMatches.length} generic filler phrase(s) in "${sectionId}".`,
        detailMessage: `Detected generic phrases: ${allMatches.slice(0, 4).map(m => `"${m.trim()}"`).join(', ')}. These add no value and should be replaced with assignment-specific language.`,
        suggestedAction: 'Replace generic filler with specific observations about this assignment.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: allMatches.slice(0, 6),
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkUnsupportedConclusions(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text;
    const allMatches = [];

    for (const pattern of UNSUPPORTED_CONCLUSORY_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        allMatches.push(...matches);
      }
    }

    if (allMatches.length > 0) {
      results.push({
        ruleId: 'PLH-003',
        severity: 'medium',
        category: 'unsupported_certainty',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Unsupported conclusory language in "${sectionId}".`,
        detailMessage: `Found ${allMatches.length} instance(s) of strong conclusory language: ${allMatches.slice(0, 3).map(m => `"${m.trim()}"`).join(', ')}. Strong claims should be supported by specific evidence.`,
        suggestedAction: 'Either support the claim with specific data or soften the language.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: allMatches.slice(0, 5),
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkVagueMarketStatements(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text;
    const allMatches = [];

    for (const pattern of VAGUE_MARKET_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        allMatches.push(...matches);
      }
    }

    if (allMatches.length > 0) {
      results.push({
        ruleId: 'PLH-004',
        severity: 'low',
        category: 'section_quality',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Vague market statement(s) in "${sectionId}".`,
        detailMessage: `Found: ${allMatches.slice(0, 3).map(m => `"${m.trim()}"`).join(', ')}. Market commentary should reference specific data (DOM, price trends, absorption rates).`,
        suggestedAction: 'Add specific market data to support the statement.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: allMatches.slice(0, 5),
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkLowInformationSection(ctx) {
  const results = [];
  const assignmentCtx = ctx.assignmentContext || {};

  // Build a set of assignment-specific terms to look for
  const specificTerms = [];
  if (assignmentCtx.subject) {
    const subj = assignmentCtx.subject;
    if (subj.address) specificTerms.push(subj.address.toLowerCase());
    if (subj.city) specificTerms.push(subj.city.toLowerCase());
    if (subj.county) specificTerms.push(subj.county.toLowerCase());
  }

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // Only check sections with enough text to evaluate
    if (wordCount < 30) continue;

    const textLower = text.toLowerCase();

    // Count specificity indicators
    let specificityScore = 0;

    // Numbers (dates, prices, measurements, percentages)
    const numberMatches = text.match(/\d+/g);
    specificityScore += Math.min((numberMatches || []).length, 10);

    // Dollar amounts
    const dollarMatches = text.match(/\$[\d,]+/g);
    specificityScore += (dollarMatches || []).length * 2;

    // Percentage
    const pctMatches = text.match(/\d+\.?\d*\s*%/g);
    specificityScore += (pctMatches || []).length * 2;

    // Assignment-specific terms
    for (const term of specificTerms) {
      if (term && textLower.includes(term)) specificityScore += 3;
    }

    // Proper nouns (capitalized words not at sentence start)
    const properNouns = text.match(/(?<=[.!?]\s+\w+\s+)[A-Z][a-z]+/g);
    specificityScore += Math.min((properNouns || []).length, 5);

    // Normalize by word count
    const normalizedScore = specificityScore / (wordCount / 50);

    if (normalizedScore < 1.5 && wordCount > 50) {
      results.push({
        ruleId: 'PLH-005',
        severity: 'medium',
        category: 'section_quality',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Low specificity in "${sectionId}" — few assignment-specific details.`,
        detailMessage: `This section has ${wordCount} words but very few specific details (numbers, addresses, data points). Specificity score: ${normalizedScore.toFixed(1)}/10. It may read as generic rather than assignment-specific.`,
        suggestedAction: 'Add specific data, measurements, addresses, or market statistics relevant to this assignment.',
        evidence: {
          type: 'threshold',
          charCount: text.length,
          threshold: 1.5,
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkContradictoryHedging(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text;
    const allMatches = [];

    for (const { pattern, label } of CONTRADICTORY_HEDGING) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        allMatches.push(...matches.map(m => ({ match: m, label })));
      }
    }

    if (allMatches.length > 0) {
      results.push({
        ruleId: 'PLH-006',
        severity: 'low',
        category: 'unsupported_certainty',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Contradictory hedging in "${sectionId}".`,
        detailMessage: `Found language that hedges and then asserts certainty: ${allMatches.slice(0, 2).map(m => `"${m.match.trim()}"`).join(', ')}. This undermines credibility.`,
        suggestedAction: 'Choose either a hedged or confident tone — not both in the same statement.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: allMatches.slice(0, 4).map(m => m.match),
        },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkRepetitivePhrasing(ctx) {
  const results = [];

  for (const [sectionId, sec] of Object.entries(ctx.sections)) {
    if (!sec || !sec.text) continue;
    const text = sec.text.trim();

    // Split into sentences
    const sentences = text.split(/[.!?]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);

    if (sentences.length < 3) continue;

    // Check for duplicate or near-duplicate sentences
    const seen = new Map();
    const duplicates = [];

    for (const sentence of sentences) {
      // Normalize whitespace
      const normalized = sentence.replace(/\s+/g, ' ');
      const key = normalized.substring(0, 60); // First 60 chars as key

      if (seen.has(key)) {
        duplicates.push(normalized.substring(0, 80));
      } else {
        seen.set(key, true);
      }
    }

    if (duplicates.length >= 2) {
      results.push({
        ruleId: 'PLH-007',
        severity: 'low',
        category: 'section_quality',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Repetitive phrasing in "${sectionId}" (${duplicates.length} repeated sentences).`,
        detailMessage: `Found ${duplicates.length} repeated or near-duplicate sentences. Example: "${duplicates[0]}..."`,
        suggestedAction: 'Remove duplicate sentences and vary the language.',
        evidence: {
          type: 'pattern_match',
          matchedPatterns: duplicates.slice(0, 3),
        },
      });
    }
  }

  return results;
}

// ── Register all rules ──────────────────────────────────────────────────────

registerRules(rules);

export { rules as placeholderGenericityRules };
export default rules;
