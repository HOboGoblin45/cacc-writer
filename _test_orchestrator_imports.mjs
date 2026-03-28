/**
 * _test_orchestrator_imports.mjs
 * Quick smoke test: verifies all orchestrator modules import and initialize correctly.
 * Run: node _test_orchestrator_imports.mjs
 */

import { getDb, getDbPath, getTableCounts, closeDb } from './server/db/database.js';
import { getSectionDefs, getSectionDef } from './server/context/reportPlanner.js';
import { getMemoryItemStats } from './server/migration/legacyKbImport.js';
import { getProfile, resolveProfileForSection } from './server/generators/generatorProfiles.js';

let passed = 0;
let failed = 0;

function ok(label, val) {
  if (val) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

try {
  console.log('\n── SQLite Database ──────────────────────────────────────');
  const db = getDb();
  ok('getDb() returns instance', !!db);
  ok('getDbPath() returns string', typeof getDbPath() === 'string');

  const counts = getTableCounts();
  ok('getTableCounts() returns object', typeof counts === 'object');
  const expectedTables = [
    'assignments', 'report_plans', 'generation_runs', 'section_jobs',
    'generated_sections', 'memory_items', 'retrieval_cache',
    'analysis_artifacts', 'ingest_jobs', 'staged_memory_reviews',
  ];
  for (const t of expectedTables) {
    ok(`table "${t}" exists (count=${counts[t]})`, counts[t] !== -1);
  }

  console.log('\n── Report Planner ───────────────────────────────────────');
  const defs1004 = getSectionDefs('1004');
  ok('getSectionDefs("1004") returns array', Array.isArray(defs1004));
  ok('1004 has ≥ 5 sections', defs1004.length >= 5);
  console.log(`     1004 sections (${defs1004.length}): ${defs1004.map(d => d.id).join(', ')}`);

  const defsComm = getSectionDefs('commercial');
  ok('getSectionDefs("commercial") returns array', Array.isArray(defsComm));
  ok('commercial has ≥ 3 sections', defsComm.length >= 3);
  console.log(`     commercial sections (${defsComm.length}): ${defsComm.map(d => d.id).join(', ')}`);

  const neigh = getSectionDef('1004', 'neighborhood_description');
  ok('getSectionDef("1004","neighborhood_description") found', !!neigh);
  if (neigh) ok('section has generatorProfile', !!neigh.generatorProfile);

  console.log('\n── Generator Profiles ───────────────────────────────────');
  const profiles = ['template-heavy', 'retrieval-guided', 'data-driven', 'logic-template', 'analysis-narrative', 'synthesis'];
  for (const p of profiles) {
    const prof = getProfile(p);
    ok(`profile "${p}" exists`, !!prof);
  }

  if (neigh) {
    const resolved = resolveProfileForSection(neigh);
    ok('resolveProfileForSection() returns profile', !!resolved);
    console.log(`     neighborhood_description profile: ${neigh.generatorProfile}`);
  }

  console.log('\n── Memory Items ─────────────────────────────────────────');
  const stats = getMemoryItemStats();
  ok('getMemoryItemStats() returns object', typeof stats === 'object');
  ok('stats.total is a number', typeof stats.total === 'number');
  console.log(`     memory_items: total=${stats.total}, bySource=${JSON.stringify(stats.bySource || {})}`);

  closeDb();
  ok('closeDb() completes without error', true);

} catch (e) {
  console.error('\nFATAL ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

console.log('\n─────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✓ ALL ORCHESTRATOR IMPORTS OK\n');
  process.exit(0);
} else {
  console.error('✗ SOME CHECKS FAILED\n');
  process.exit(1);
}
