/**
 * server/factIntegrity/accuracyBenchmarks.js
 * -------------------------------------------
 * Phase C (OS-C6) deterministic benchmark helpers for extraction and gate checks.
 */

const NUMERIC_PATH_HINTS = /(price|value|gla|size|lot|dom|bed|bath|year|rate|income|expense|noi|count|area|sf)/i;
const DATE_PATH_HINTS = /(date|effectiveDate|saleDate|closingDate|contractDate|dueDate)/i;
const ADDRESS_PATH_HINTS = /(address)/i;

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDate(value) {
  const text = asText(value);
  if (!text) return '';
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return text.toLowerCase();
  return new Date(ts).toISOString().slice(0, 10);
}

function normalizeNumeric(value) {
  const text = asText(value);
  if (!text) return '';
  const raw = text.replace(/[^0-9.\-]/g, '');
  if (!raw) return text.toLowerCase();
  const num = Number(raw);
  if (Number.isNaN(num)) return text.toLowerCase();
  return String(num);
}

function normalizeAddress(value) {
  return asText(value).toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ');
}

function normalizeValueForPath(path, value) {
  const p = asText(path);
  const text = asText(value);
  if (!p || !text) return '';
  if (DATE_PATH_HINTS.test(p)) return normalizeDate(text);
  if (NUMERIC_PATH_HINTS.test(p)) return normalizeNumeric(text);
  if (ADDRESS_PATH_HINTS.test(p)) return normalizeAddress(text);
  return text.toLowerCase();
}

function normalizeFactEntries(entries = []) {
  const set = new Set();
  for (const row of entries) {
    const factPath = asText(row?.factPath);
    if (!factPath) continue;
    const normalizedValue = normalizeValueForPath(factPath, row?.value);
    if (!normalizedValue) continue;
    set.add(`${factPath}=${normalizedValue}`);
  }
  return set;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeLane(value) {
  const lane = asText(value).toLowerCase();
  return lane || 'unspecified';
}

function extractRuleId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return asText(value);
  if (typeof value !== 'object') return '';
  return asText(value.ruleId || value.rule_id || value.id);
}

function collectRuleIds(entries = [], target = new Set()) {
  if (!Array.isArray(entries)) return target;
  for (const entry of entries) {
    const ruleId = extractRuleId(entry);
    if (ruleId) target.add(ruleId);
  }
  return target;
}

function collectComplianceRuleIds(gateResult = {}) {
  const ids = new Set();
  const blockers = Array.isArray(gateResult?.blockers) ? gateResult.blockers : [];

  for (const blocker of blockers) {
    if (asText(blocker?.type) !== 'compliance_hard_rules') continue;
    collectRuleIds(blocker?.findings, ids);
    collectRuleIds(blocker?.rules, ids);
    collectRuleIds(blocker?.ruleIds, ids);
  }

  collectRuleIds(gateResult?.details?.complianceChecks?.blockers, ids);
  collectRuleIds(gateResult?.complianceChecks?.blockers, ids);

  return [...ids];
}

/**
 * Score extraction accuracy for one benchmark fixture.
 *
 * @param {object} params
 * @param {string} params.fixtureId
 * @param {{factPath:string, value:string}[]} params.expectedFacts
 * @param {{factPath:string, value:string}[]} params.extractedFacts
 * @returns {object}
 */
export function scoreExtractionFixture({
  fixtureId = '',
  expectedFacts = [],
  extractedFacts = [],
}) {
  const expectedSet = normalizeFactEntries(expectedFacts);
  const extractedSet = normalizeFactEntries(extractedFacts);

  let matchedCount = 0;
  for (const key of extractedSet) {
    if (expectedSet.has(key)) matchedCount++;
  }

  const falsePositiveCount = [...extractedSet].filter(key => !expectedSet.has(key)).length;
  const falseNegativeCount = [...expectedSet].filter(key => !extractedSet.has(key)).length;

  const precision = extractedSet.size > 0 ? matchedCount / extractedSet.size : 1;
  const recall = expectedSet.size > 0 ? matchedCount / expectedSet.size : 1;
  const f1 = (precision + recall) > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return {
    fixtureId: asText(fixtureId),
    expectedCount: expectedSet.size,
    extractedCount: extractedSet.size,
    matchedCount,
    falsePositiveCount,
    falseNegativeCount,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
  };
}

/**
 * Score pre-draft gate expectation for one fixture.
 *
 * @param {object} params
 * @param {string} params.fixtureId
 * @param {boolean} params.expectedOk
 * @param {string[]} [params.expectedBlockerTypes]
 * @param {string[]} [params.expectedComplianceRuleIds]
 * @param {object} params.gateResult
 * @returns {object}
 */
export function scoreGateFixture({
  fixtureId = '',
  expectedOk = true,
  expectedBlockerTypes = [],
  expectedComplianceRuleIds = [],
  gateResult = {},
}) {
  const actualOk = Boolean(gateResult?.ok);
  const actualBlockerTypes = Array.isArray(gateResult?.blockers)
    ? gateResult.blockers.map(b => asText(b?.type)).filter(Boolean)
    : [];
  const actualComplianceRuleIds = collectComplianceRuleIds(gateResult);
  const expectedSet = new Set((expectedBlockerTypes || []).map(asText).filter(Boolean));
  const actualSet = new Set(actualBlockerTypes);
  const expectedRuleSet = new Set((expectedComplianceRuleIds || []).map(asText).filter(Boolean));
  const actualRuleSet = new Set(actualComplianceRuleIds);

  const missingExpectedBlockers = [...expectedSet].filter(type => !actualSet.has(type));
  const unexpectedBlockers = [...actualSet].filter(type => !expectedSet.has(type));
  const missingExpectedComplianceRuleIds = [...expectedRuleSet].filter(ruleId => !actualRuleSet.has(ruleId));
  const unexpectedComplianceRuleIds = [...actualRuleSet].filter(ruleId => !expectedRuleSet.has(ruleId));
  const okMatch = expectedOk === actualOk;

  return {
    fixtureId: asText(fixtureId),
    expectedOk: Boolean(expectedOk),
    expectedComplianceRuleIds: [...expectedRuleSet],
    actualOk,
    okMatch,
    missingExpectedBlockers,
    unexpectedBlockers,
    missingExpectedComplianceRuleIds,
    unexpectedComplianceRuleIds,
    actualComplianceRuleIds,
    passed: okMatch
      && missingExpectedBlockers.length === 0
      && missingExpectedComplianceRuleIds.length === 0,
  };
}

/**
 * Build a suite-level benchmark summary.
 *
 * @param {object} params
 * @param {object[]} [params.extractionRuns]
 * @param {object[]} [params.gateRuns]
 * @returns {object}
 */
export function summarizeBenchmarkSuite({
  extractionRuns = [],
  gateRuns = [],
}) {
  const extraction = Array.isArray(extractionRuns) ? extractionRuns : [];
  const gate = Array.isArray(gateRuns) ? gateRuns : [];

  const avg = (values) => {
    if (!values.length) return null;
    const total = values.reduce((sum, v) => sum + v, 0);
    return round4(total / values.length);
  };

  const summarizeExtraction = (runs) => ({
    fixtureCount: runs.length,
    avgPrecision: avg(runs.map(r => Number(r.precision || 0))),
    avgRecall: avg(runs.map(r => Number(r.recall || 0))),
    avgF1: avg(runs.map(r => Number(r.f1 || 0))),
  });

  const summarizeGate = (runs) => {
    const passed = runs.filter(r => r.passed === true).length;
    const complianceExpectationRuns = runs.filter(
      r => Array.isArray(r.expectedComplianceRuleIds) && r.expectedComplianceRuleIds.length > 0,
    );
    const complianceExpectationPassed = complianceExpectationRuns.filter(r => r.passed === true).length;
    return {
      fixtureCount: runs.length,
      passedCount: passed,
      passRate: runs.length > 0 ? round4(passed / runs.length) : null,
      complianceExpectationFixtureCount: complianceExpectationRuns.length,
      complianceExpectationPassedCount: complianceExpectationPassed,
      complianceExpectationPassRate: complianceExpectationRuns.length > 0
        ? round4(complianceExpectationPassed / complianceExpectationRuns.length)
        : null,
    };
  };

  const extractionSummary = summarizeExtraction(extraction);
  const extractionByLane = {};
  for (const run of extraction) {
    const lane = normalizeLane(run?.lane);
    if (!extractionByLane[lane]) extractionByLane[lane] = [];
    extractionByLane[lane].push(run);
  }
  extractionSummary.byLane = Object.fromEntries(
    Object.entries(extractionByLane).map(([lane, runs]) => [lane, summarizeExtraction(runs)]),
  );

  const gateSummary = summarizeGate(gate);
  const gateByLane = {};
  for (const run of gate) {
    const lane = normalizeLane(run?.lane);
    if (!gateByLane[lane]) gateByLane[lane] = [];
    gateByLane[lane].push(run);
  }
  gateSummary.byLane = Object.fromEntries(
    Object.entries(gateByLane).map(([lane, runs]) => [lane, summarizeGate(runs)]),
  );

  return {
    generatedAt: new Date().toISOString(),
    extraction: extractionSummary,
    gate: gateSummary,
  };
}
