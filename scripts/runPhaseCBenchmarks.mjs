/**
 * scripts/runPhaseCBenchmarks.mjs
 * --------------------------------
 * Run Phase C benchmark fixtures and persist the latest result snapshot.
 */

import {
  runPhaseCBenchmarksFromFile,
  writePhaseCBenchmarkResults,
  DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH,
  DEFAULT_PHASE_C_BENCHMARK_RESULTS_PATH,
} from '../server/factIntegrity/benchmarkRunner.js';
import {
  evaluatePhaseCBenchmarkThresholds,
  DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
} from '../server/factIntegrity/benchmarkThresholds.js';

const fixturePath = process.argv[2] || DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH;
const outputPath = process.argv[3] || DEFAULT_PHASE_C_BENCHMARK_RESULTS_PATH;

try {
  const run = await runPhaseCBenchmarksFromFile({ fixturePath });
  writePhaseCBenchmarkResults(run.results, outputPath);

  const extraction = run.results.summary.extraction;
  const gate = run.results.summary.gate;
  const qualityGate = evaluatePhaseCBenchmarkThresholds(
    run.results,
    DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
  );

  console.log('Phase C benchmarks completed');
  console.log(`Fixture path: ${fixturePath}`);
  console.log(`Output path:  ${outputPath}`);
  console.log(
    `Extraction: fixtures=${extraction.fixtureCount} avgPrecision=${extraction.avgPrecision} avgRecall=${extraction.avgRecall} avgF1=${extraction.avgF1}`,
  );
  console.log(
    `Gate: fixtures=${gate.fixtureCount} passed=${gate.passedCount} passRate=${gate.passRate}`,
  );
  console.log(
    `Quality gate: ok=${qualityGate.ok} (${qualityGate.summary.passedChecks}/${qualityGate.summary.totalChecks} checks passed)`,
  );
} catch (err) {
  console.error('Phase C benchmark run failed:', err.message);
  process.exit(1);
}
