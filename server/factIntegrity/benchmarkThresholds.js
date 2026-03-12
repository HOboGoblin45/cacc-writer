/**
 * server/factIntegrity/benchmarkThresholds.js
 * --------------------------------------------
 * Deterministic threshold checks for Phase C benchmark results.
 */

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round4(value) {
  return Math.round(toFiniteNumber(value) * 10000) / 10000;
}

export const DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS = Object.freeze({
  extraction: Object.freeze({
    minFixtureCount: 3,
    minAvgPrecision: 0.85,
    minAvgRecall: 0.8,
    minAvgF1: 0.82,
    minLaneFixtureCounts: Object.freeze({
      residential: 3,
      commercial: 1,
    }),
  }),
  gate: Object.freeze({
    minFixtureCount: 2,
    minPassRate: 1,
    minComplianceExpectationFixtureCount: 1,
    minComplianceExpectationPassRate: 1,
    minLaneFixtureCounts: Object.freeze({
      residential: 1,
      commercial: 1,
    }),
  }),
});

function normalizeLaneThresholdMap(input, fallback) {
  const result = {};
  const source = input && typeof input === 'object' ? input : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};
  const lanes = new Set([
    ...Object.keys(defaults),
    ...Object.keys(source),
  ]);

  for (const lane of lanes) {
    result[String(lane).toLowerCase()] = Math.max(0, Math.floor(toFiniteNumber(
      source[lane],
      defaults[lane] ?? 0,
    )));
  }
  return result;
}

function normalizeThresholds(input = {}) {
  return {
    extraction: {
      minFixtureCount: Math.max(0, Math.floor(toFiniteNumber(
        input?.extraction?.minFixtureCount,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.extraction.minFixtureCount,
      ))),
      minAvgPrecision: toFiniteNumber(
        input?.extraction?.minAvgPrecision,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.extraction.minAvgPrecision,
      ),
      minAvgRecall: toFiniteNumber(
        input?.extraction?.minAvgRecall,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.extraction.minAvgRecall,
      ),
      minAvgF1: toFiniteNumber(
        input?.extraction?.minAvgF1,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.extraction.minAvgF1,
      ),
      minLaneFixtureCounts: normalizeLaneThresholdMap(
        input?.extraction?.minLaneFixtureCounts,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.extraction.minLaneFixtureCounts,
      ),
    },
    gate: {
      minFixtureCount: Math.max(0, Math.floor(toFiniteNumber(
        input?.gate?.minFixtureCount,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.gate.minFixtureCount,
      ))),
      minPassRate: toFiniteNumber(
        input?.gate?.minPassRate,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.gate.minPassRate,
      ),
      minComplianceExpectationFixtureCount: Math.max(0, Math.floor(toFiniteNumber(
        input?.gate?.minComplianceExpectationFixtureCount,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.gate.minComplianceExpectationFixtureCount,
      ))),
      minComplianceExpectationPassRate: toFiniteNumber(
        input?.gate?.minComplianceExpectationPassRate,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.gate.minComplianceExpectationPassRate,
      ),
      minLaneFixtureCounts: normalizeLaneThresholdMap(
        input?.gate?.minLaneFixtureCounts,
        DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS.gate.minLaneFixtureCounts,
      ),
    },
  };
}

function makeCheck({ id, label, actual, target, passed }) {
  return {
    id,
    label,
    actual: round4(actual),
    target: round4(target),
    passed: Boolean(passed),
  };
}

/**
 * Evaluate benchmark result thresholds for release quality-gating.
 *
 * @param {object} results - run.results payload from benchmarkRunner
 * @param {object} [thresholds] - optional threshold overrides
 * @returns {object}
 */
export function evaluatePhaseCBenchmarkThresholds(results, thresholds = {}) {
  const normalized = normalizeThresholds(thresholds);
  const extractionSummary = results?.summary?.extraction || {};
  const gateSummary = results?.summary?.gate || {};

  const extractionFixtureCount = toFiniteNumber(extractionSummary.fixtureCount, 0);
  const extractionAvgPrecision = toFiniteNumber(extractionSummary.avgPrecision, 0);
  const extractionAvgRecall = toFiniteNumber(extractionSummary.avgRecall, 0);
  const extractionAvgF1 = toFiniteNumber(extractionSummary.avgF1, 0);
  const extractionByLane = extractionSummary?.byLane && typeof extractionSummary.byLane === 'object'
    ? extractionSummary.byLane
    : {};

  const gateFixtureCount = toFiniteNumber(gateSummary.fixtureCount, 0);
  const gatePassRate = toFiniteNumber(gateSummary.passRate, 0);
  const gateComplianceFixtureCount = toFiniteNumber(gateSummary.complianceExpectationFixtureCount, 0);
  const gateCompliancePassRate = toFiniteNumber(gateSummary.complianceExpectationPassRate, 0);
  const gateByLane = gateSummary?.byLane && typeof gateSummary.byLane === 'object'
    ? gateSummary.byLane
    : {};

  const checks = [
    makeCheck({
      id: 'extraction.fixture_count',
      label: 'Extraction fixture count',
      actual: extractionFixtureCount,
      target: normalized.extraction.minFixtureCount,
      passed: extractionFixtureCount >= normalized.extraction.minFixtureCount,
    }),
    makeCheck({
      id: 'extraction.avg_precision',
      label: 'Extraction average precision',
      actual: extractionAvgPrecision,
      target: normalized.extraction.minAvgPrecision,
      passed: extractionAvgPrecision >= normalized.extraction.minAvgPrecision,
    }),
    makeCheck({
      id: 'extraction.avg_recall',
      label: 'Extraction average recall',
      actual: extractionAvgRecall,
      target: normalized.extraction.minAvgRecall,
      passed: extractionAvgRecall >= normalized.extraction.minAvgRecall,
    }),
    makeCheck({
      id: 'extraction.avg_f1',
      label: 'Extraction average F1',
      actual: extractionAvgF1,
      target: normalized.extraction.minAvgF1,
      passed: extractionAvgF1 >= normalized.extraction.minAvgF1,
    }),
    makeCheck({
      id: 'gate.fixture_count',
      label: 'Gate fixture count',
      actual: gateFixtureCount,
      target: normalized.gate.minFixtureCount,
      passed: gateFixtureCount >= normalized.gate.minFixtureCount,
    }),
    makeCheck({
      id: 'gate.pass_rate',
      label: 'Gate pass rate',
      actual: gatePassRate,
      target: normalized.gate.minPassRate,
      passed: gatePassRate >= normalized.gate.minPassRate,
    }),
    makeCheck({
      id: 'gate.compliance_expectation.fixture_count',
      label: 'Gate compliance expectation fixture count',
      actual: gateComplianceFixtureCount,
      target: normalized.gate.minComplianceExpectationFixtureCount,
      passed: gateComplianceFixtureCount >= normalized.gate.minComplianceExpectationFixtureCount,
    }),
    makeCheck({
      id: 'gate.compliance_expectation.pass_rate',
      label: 'Gate compliance expectation pass rate',
      actual: gateCompliancePassRate,
      target: normalized.gate.minComplianceExpectationPassRate,
      passed: gateCompliancePassRate >= normalized.gate.minComplianceExpectationPassRate,
    }),
  ];

  for (const [lane, threshold] of Object.entries(normalized.extraction.minLaneFixtureCounts)) {
    const actual = toFiniteNumber(extractionByLane?.[lane]?.fixtureCount, 0);
    checks.push(makeCheck({
      id: `extraction.lane.${lane}.fixture_count`,
      label: `Extraction fixture count (${lane})`,
      actual,
      target: threshold,
      passed: actual >= threshold,
    }));
  }

  for (const [lane, threshold] of Object.entries(normalized.gate.minLaneFixtureCounts)) {
    const actual = toFiniteNumber(gateByLane?.[lane]?.fixtureCount, 0);
    checks.push(makeCheck({
      id: `gate.lane.${lane}.fixture_count`,
      label: `Gate fixture count (${lane})`,
      actual,
      target: threshold,
      passed: actual >= threshold,
    }));
  }

  const failedChecks = checks.filter(check => !check.passed);

  return {
    checkedAt: new Date().toISOString(),
    ok: failedChecks.length === 0,
    thresholds: normalized,
    summary: {
      totalChecks: checks.length,
      passedChecks: checks.length - failedChecks.length,
      failedChecks: failedChecks.length,
    },
    checks,
    failedCheckIds: failedChecks.map(check => check.id),
  };
}
