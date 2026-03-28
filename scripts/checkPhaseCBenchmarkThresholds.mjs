/**
 * scripts/checkPhaseCBenchmarkThresholds.mjs
 * -------------------------------------------
 * Run Phase C benchmark fixtures and fail when threshold checks do not pass.
 */

import {
  runPhaseCBenchmarksFromFile,
  DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH,
} from '../server/factIntegrity/benchmarkRunner.js';
import {
  evaluatePhaseCBenchmarkThresholds,
  DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
} from '../server/factIntegrity/benchmarkThresholds.js';

const fixturePath = process.argv[2] || DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH;

function parseThresholdOverrideEnv() {
  const envRaw = process.env.PHASE_C_BENCH_THRESHOLDS;
  if (!envRaw) return null;
  try {
    const parsed = JSON.parse(envRaw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

try {
  const run = await runPhaseCBenchmarksFromFile({ fixturePath });
  const thresholdOverrides = parseThresholdOverrideEnv();
  const thresholdResult = evaluatePhaseCBenchmarkThresholds(
    run.results,
    thresholdOverrides || DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
  );

  console.log('Phase C benchmark threshold check');
  console.log(`Fixture path: ${fixturePath}`);
  console.log(`Checks: ${thresholdResult.summary.passedChecks}/${thresholdResult.summary.totalChecks} passed`);
  for (const check of thresholdResult.checks) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} ${check.id} actual=${check.actual} target>=${check.target}`,
    );
  }

  if (!thresholdResult.ok) {
    console.error('Phase C benchmark threshold gate failed.');
    process.exit(1);
  }

  console.log('Phase C benchmark threshold gate passed.');
} catch (err) {
  console.error('Phase C benchmark threshold check failed:', err.message);
  process.exit(1);
}

