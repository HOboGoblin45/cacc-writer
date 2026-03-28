/**
 * server/factIntegrity/benchmarkRunner.js
 * ----------------------------------------
 * Phase C (OS-C6) benchmark fixture runner.
 */

import fs from 'fs';
import path from 'path';
import { extractStructuredFacts } from '../ingestion/documentExtractors.js';
import {
  scoreExtractionFixture,
  scoreGateFixture,
  summarizeBenchmarkSuite,
} from './accuracyBenchmarks.js';

export const DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH = path.resolve(
  process.cwd(),
  'benchmarks/phase-c/fixtures.v1.json',
);

export const DEFAULT_PHASE_C_BENCHMARK_RESULTS_PATH = path.resolve(
  process.cwd(),
  'benchmarks/phase-c/latest-results.json',
);

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeExtractionFixtures(input) {
  if (!Array.isArray(input)) return [];
  return input.map((fixture, idx) => ({
    id: asText(fixture?.id) || `extraction-${idx + 1}`,
    lane: asText(fixture?.lane) || 'unspecified',
    docType: asText(fixture?.docType),
    text: asText(fixture?.text),
    expectedFacts: Array.isArray(fixture?.expectedFacts) ? fixture.expectedFacts : [],
  })).filter(f => f.docType && f.text);
}

function normalizeGateFixtures(input) {
  if (!Array.isArray(input)) return [];
  return input.map((fixture, idx) => ({
    id: asText(fixture?.id) || `gate-${idx + 1}`,
    lane: asText(fixture?.lane) || 'unspecified',
    expectedOk: fixture?.expectedOk !== false,
    expectedBlockerTypes: Array.isArray(fixture?.expectedBlockerTypes)
      ? fixture.expectedBlockerTypes
      : [],
    expectedComplianceRuleIds: Array.isArray(fixture?.expectedComplianceRuleIds)
      ? fixture.expectedComplianceRuleIds
      : [],
    gateResult: fixture?.gateResult && typeof fixture.gateResult === 'object'
      ? fixture.gateResult
      : { ok: true, blockers: [] },
  }));
}

/**
 * Read and normalize Phase C benchmark fixtures.
 *
 * @param {string} [fixturePath]
 * @returns {object}
 */
export function readPhaseCBenchmarkFixtures(
  fixturePath = DEFAULT_PHASE_C_BENCHMARK_FIXTURE_PATH,
) {
  const parsed = readJSON(fixturePath);
  return {
    version: asText(parsed?.version) || 'phase-c.v1',
    extractionFixtures: normalizeExtractionFixtures(parsed?.extractionFixtures),
    gateFixtures: normalizeGateFixtures(parsed?.gateFixtures),
    fixturePath,
  };
}

/**
 * Run extraction + gate benchmarks from normalized fixtures.
 *
 * @param {object} fixtures
 * @returns {Promise<object>}
 */
export async function runPhaseCBenchmarkSuite(fixtures) {
  const extractionFixtures = normalizeExtractionFixtures(fixtures?.extractionFixtures);
  const gateFixtures = normalizeGateFixtures(fixtures?.gateFixtures);

  const extractionRuns = [];
  for (const fixture of extractionFixtures) {
    const extractedFacts = await extractStructuredFacts(
      fixture.docType,
      fixture.text,
      { disableAI: true },
    );

    extractionRuns.push({
      ...scoreExtractionFixture({
        fixtureId: fixture.id,
        expectedFacts: fixture.expectedFacts,
        extractedFacts,
      }),
      lane: fixture.lane,
      docType: fixture.docType,
    });
  }

  const gateRuns = gateFixtures.map(fixture => ({
    ...scoreGateFixture({
      fixtureId: fixture.id,
      expectedOk: fixture.expectedOk,
      expectedBlockerTypes: fixture.expectedBlockerTypes,
      expectedComplianceRuleIds: fixture.expectedComplianceRuleIds,
      gateResult: fixture.gateResult,
    }),
    lane: fixture.lane,
  }));

  const summary = summarizeBenchmarkSuite({
    extractionRuns,
    gateRuns,
  });

  return {
    version: asText(fixtures?.version) || 'phase-c.v1',
    ranAt: new Date().toISOString(),
    extractionRuns,
    gateRuns,
    summary,
  };
}

/**
 * Run benchmarks from fixture JSON file.
 *
 * @param {object} [options]
 * @param {string} [options.fixturePath]
 * @returns {Promise<object>}
 */
export async function runPhaseCBenchmarksFromFile(options = {}) {
  const fixtures = readPhaseCBenchmarkFixtures(options.fixturePath);
  const results = await runPhaseCBenchmarkSuite(fixtures);
  return {
    fixturePath: fixtures.fixturePath,
    fixtures,
    results,
  };
}

/**
 * Persist benchmark results to disk.
 *
 * @param {object} results
 * @param {string} [outputPath]
 * @returns {string}
 */
export function writePhaseCBenchmarkResults(
  results,
  outputPath = DEFAULT_PHASE_C_BENCHMARK_RESULTS_PATH,
) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  return outputPath;
}

/**
 * Read persisted benchmark results, if available.
 *
 * @param {string} [outputPath]
 * @returns {object|null}
 */
export function readPhaseCBenchmarkResults(
  outputPath = DEFAULT_PHASE_C_BENCHMARK_RESULTS_PATH,
) {
  if (!fs.existsSync(outputPath)) return null;
  return readJSON(outputPath);
}
