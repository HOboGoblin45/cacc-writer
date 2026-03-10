#!/usr/bin/env node
/**
 * scripts/validateFieldRegistry.js
 * ---------------------------------
 * Phase 1 validation utility for the canonical field registry.
 *
 * Checks:
 *   1. Registry integrity (duplicates, missing required fields)
 *   2. Cross-reference: registry fieldIds vs. form config field arrays
 *   3. Cross-reference: registry fieldIds vs. ACI field map keys
 *   4. Cross-reference: registry fieldIds vs. RQ field map keys
 *   5. Missing humanLabels or sectionNames
 *   6. Software target completeness for generation-supported fields
 *
 * Usage:
 *   node scripts/validateFieldRegistry.js
 *   node scripts/validateFieldRegistry.js --verbose
 *   node scripts/validateFieldRegistry.js --form 1004
 *
 * Exit codes:
 *   0 = all checks passed (warnings may exist)
 *   1 = one or more errors found
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const FORM    = args.includes('--form') ? args[args.indexOf('--form') + 1] : null;

// ── Import registry ───────────────────────────────────────────────────────────
let validateRegistry, getFieldsForForm, getRegistryStats, FIELDS;
try {
  const reg = await import('../server/fieldRegistry.js');
  validateRegistry = reg.validateRegistry;
  getFieldsForForm = reg.getFieldsForForm;
  getRegistryStats = reg.getRegistryStats;
  FIELDS           = reg.FIELDS;
} catch (err) {
  console.error('FATAL: Could not import server/fieldRegistry.js:', err.message);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadJson(relPath) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf8'));
  } catch {
    return null;
  }
}

function loadFormModule(formType) {
  try {
    // Dynamic import of ES module form configs
    return import(`../forms/${formType}.js`).then(m => m.default);
  } catch {
    return null;
  }
}

let errors   = 0;
let warnings = 0;

function err(msg)  { console.error(`  ✗ ERROR:   ${msg}`);   errors++;   }
function warn(msg) { console.warn(`  ⚠ WARNING: ${msg}`);    warnings++; }
function ok(msg)   { if (VERBOSE) console.log(`  ✓ OK:      ${msg}`); }
function info(msg) { console.log(`\n── ${msg}`); }

// ── Check 1: Registry internal integrity ─────────────────────────────────────
info('Check 1: Registry internal integrity');

const result = validateRegistry();
if (result.errors.length > 0) {
  result.errors.forEach(e => err(e));
} else {
  ok(`No duplicate keys. Total fields: ${result.fieldCount}`);
}
if (result.warnings.length > 0) {
  result.warnings.forEach(w => warn(w));
}

const stats = getRegistryStats();
console.log(`  Registry stats: ${stats.totalFields} total fields, ${Object.keys(stats.formCounts).length} form types, ${stats.sectionCount} section keys`);
if (VERBOSE) {
  for (const [ft, count] of Object.entries(stats.formCounts)) {
    console.log(`    ${ft}: ${count} fields`);
  }
}

// ── Check 2: Cross-reference registry vs. ACI field maps ─────────────────────
info('Check 2: Registry vs. ACI field maps');

const ACI_FORMS = ['1004', '1025', '1073', '1004c', 'commercial'];
for (const formType of ACI_FORMS) {
  if (FORM && formType !== FORM) continue;

  const mapPath = `desktop_agent/field_maps/${formType}.json`;
  const aciMap  = loadJson(mapPath);
  if (!aciMap) {
    warn(`ACI map not found: ${mapPath}`);
    continue;
  }

  const aciKeys      = Object.keys(aciMap).filter(k => !k.startsWith('_'));
  const registryKeys = getFieldsForForm(formType)
    .filter(f => f.softwareTargets?.aci !== null)
    .map(f => f.fieldId);

  // ACI map keys not in registry
  for (const key of aciKeys) {
    if (!registryKeys.includes(key)) {
      warn(`ACI map key '${key}' (${formType}) has no registry entry — add to fieldRegistry.js`);
    } else {
      ok(`ACI key '${key}' (${formType}) found in registry`);
    }
  }

  // Registry fields with ACI target but not in ACI map
  for (const field of getFieldsForForm(formType)) {
    if (!field.softwareTargets?.aci) continue;
    if (!aciKeys.includes(field.fieldId)) {
      if (VERBOSE) warn(`Registry field '${field.fieldId}' (${formType}) has ACI target but no ACI map entry — will be added during Phase 2 calibration`);
    }
  }
}

// ── Check 3: Cross-reference registry vs. Real Quantum field map ──────────────
info('Check 3: Registry vs. Real Quantum field map');

const rqMap = loadJson('real_quantum_agent/field_maps/commercial.json');
if (!rqMap) {
  warn('RQ field map not found: real_quantum_agent/field_maps/commercial.json');
} else {
  const rqKeys       = Object.keys(rqMap).filter(k => !k.startsWith('_'));
  const registryRqFields = getFieldsForForm('commercial')
    .filter(f => f.softwareTargets?.real_quantum !== null)
    .map(f => f.fieldId);

  for (const key of rqKeys) {
    if (!registryRqFields.includes(key)) {
      warn(`RQ map key '${key}' has no registry entry — add to fieldRegistry.js`);
    } else {
      ok(`RQ key '${key}' found in registry`);
    }
  }

  for (const field of getFieldsForForm('commercial')) {
    if (!field.softwareTargets?.real_quantum) continue;
    if (!rqKeys.includes(field.fieldId)) {
      if (VERBOSE) warn(`Registry field '${field.fieldId}' (commercial) has RQ target but no RQ map entry — may be new or RQ-only`);
    }
  }
}

// ── Check 4: Cross-reference registry vs. form config field arrays ────────────
info('Check 4: Registry vs. form config field arrays');

const FORM_FILES = ['1004', '1025', '1073', '1004c', 'commercial'];
for (const formType of FORM_FILES) {
  if (FORM && formType !== FORM) continue;

  let formConfig;
  try {
    const mod = await import(`../forms/${formType}.js`);
    formConfig = mod.default;
  } catch {
    warn(`Could not load forms/${formType}.js`);
    continue;
  }

  const formFieldIds     = (formConfig?.fields || []).map(f => f.id);
  const registryFieldIds = getFieldsForForm(formType).map(f => f.fieldId);

  for (const fid of formFieldIds) {
    if (!registryFieldIds.includes(fid)) {
      warn(`Form field '${fid}' (${formType}) not in registry — add to fieldRegistry.js`);
    } else {
      ok(`Form field '${fid}' (${formType}) found in registry`);
    }
  }
}

// ── Check 5: Generation-supported fields must have a software target ──────────
info('Check 5: Generation-supported fields must have at least one software target');

for (const field of FIELDS) {
  if (FORM && !field.formTypes.includes(FORM)) continue;
  if (!field.generationSupported) continue;

  const hasAci = field.softwareTargets?.aci !== null && field.softwareTargets?.aci !== undefined;
  const hasRq  = field.softwareTargets?.real_quantum !== null && field.softwareTargets?.real_quantum !== undefined;

  if (!hasAci && !hasRq) {
    warn(`Generation field '${field.fieldId}' (${field.formTypes.join(',')}) has no software target — insertion will fail`);
  } else {
    ok(`'${field.fieldId}' has software target`);
  }
}

// ── Check 6: Spot-check the canonical sample field ───────────────────────────
info('Check 6: Spot-check neighborhood_description (1004)');

const sample = FIELDS.find(f => f.fieldId === 'neighborhood_description' && f.formTypes.includes('1004'));
if (!sample) {
  err('neighborhood_description not found for formType 1004');
} else {
  if (!sample.humanLabel)                    err('neighborhood_description missing humanLabel');
  else ok(`humanLabel: "${sample.humanLabel}"`);

  if (!sample.sectionName)                   err('neighborhood_description missing sectionName');
  else ok(`sectionName: "${sample.sectionName}"`);

  if (!sample.softwareTargets?.aci)          err('neighborhood_description missing ACI target');
  else ok(`ACI label: "${sample.softwareTargets.aci.label}", tab: "${sample.softwareTargets.aci.tabName}"`);

  if (sample.softwareTargets?.real_quantum !== null && sample.softwareTargets?.real_quantum !== undefined) {
    warn('neighborhood_description (1004) unexpectedly has a RQ target — should be null for residential');
  } else {
    ok('RQ target is null (correct — residential form)');
  }

  if (!sample.promptCategory)                err('neighborhood_description missing promptCategory');
  else ok(`promptCategory: "${sample.promptCategory}"`);

  if (!sample.verifyRequired)                warn('neighborhood_description verifyRequired is false — consider setting true');
  else ok('verifyRequired: true');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`VALIDATION COMPLETE`);
console.log(`  Errors:   ${errors}`);
console.log(`  Warnings: ${warnings}`);
console.log(`  Fields:   ${FIELDS.length}`);
console.log('─'.repeat(60));

if (errors > 0) {
  console.error(`\nFAILED — ${errors} error(s) must be resolved before Phase 2.\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\nPASSED with ${warnings} warning(s). Review warnings before Phase 2.\n`);
  process.exit(0);
} else {
  console.log('\nPASSED — registry is clean.\n');
  process.exit(0);
}
