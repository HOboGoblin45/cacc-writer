/**
 * server/intelligence/index.js
 * ------------------------------
 * Phase 4 — Assignment Intelligence Bundle Facade
 *
 * Single entry point for building the complete assignment intelligence
 * bundle from raw case data. Orchestrates all Phase 4 subsystems:
 *
 *   1. Normalize raw case data → NormalizedAssignmentContext v2
 *   2. Derive deterministic flags → DerivedAssignmentFlags
 *   3. Build compliance profile → ComplianceProfile
 *   4. Resolve report family → ReportFamilyManifest
 *   5. Select applicable canonical fields
 *   6. Build section plan v2 → SectionPlanV2
 *   7. Assemble → AssignmentIntelligenceBundle
 *
 * The bundle is persisted to SQLite and can be retrieved without rebuilding.
 *
 * Usage:
 *   import { buildIntelligenceBundle, getIntelligenceBundle } from './intelligence/index.js';
 *   const bundle = await buildIntelligenceBundle(caseId);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { normalizeAssignmentContextV2 } from './normalizer.js';
import { deriveAssignmentFlags, summarizeFlags } from './derivedFlags.js';
import { buildComplianceProfile } from './complianceProfile.js';
import { getManifestForFormType, resolveReportFamily } from './reportFamilyManifest.js';
import { getApplicableFields, groupFieldsBySectionGroup } from './canonicalFields.js';
import { buildSectionPlanV2, toOrchestratorPlan } from './sectionPlanner.js';
import { buildSectionRequirementMatrix } from './sectionRequirementMatrix.js';
import { evaluateHardComplianceRules } from './hardComplianceRules.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR  = path.join(__dirname, '..', '..', 'cases');

// ── File I/O helpers ────────────────────────────────────────────────────────

function readJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete AssignmentIntelligenceBundle for a case.
 * Persists to SQLite `assignment_intelligence` table.
 *
 * @param {string} caseId
 * @returns {Promise<import('./assignmentSchema.js').AssignmentIntelligenceBundle>}
 */
export async function buildIntelligenceBundle(caseId) {
  const t0 = Date.now();
  const caseDir = path.join(CASES_DIR, caseId);

  if (!fs.existsSync(caseDir)) {
    throw new Error(`Case directory not found: ${caseId}`);
  }

  const meta  = readJSON(path.join(caseDir, 'meta.json'),  {});
  const facts = readJSON(path.join(caseDir, 'facts.json'), {});

  // 1. Normalize
  const context = normalizeAssignmentContextV2(caseId, meta, facts);

  // 2. Derive flags
  const flags = deriveAssignmentFlags(context);
  const flagSummary = summarizeFlags(flags);

  // 3. Compliance profile
  const compliance = buildComplianceProfile(context, flags);

  // 4. Report family
  const reportFamilyId = resolveReportFamily(context.formType, flags);
  const manifest = getManifestForFormType(context.formType, flags);

  // 5. Applicable canonical fields
  const applicableFields = getApplicableFields(flags, reportFamilyId);
  const fieldsByGroup = groupFieldsBySectionGroup(applicableFields);

  // 6. Section plan v2
  const sectionPlan = buildSectionPlanV2(context, flags, compliance, manifest, applicableFields);
  const sectionRequirements = buildSectionRequirementMatrix({
    manifest,
    flags,
    applicableFields,
  });
  const complianceChecks = evaluateHardComplianceRules({
    context,
    flags,
    compliance,
    sectionRequirements,
  });

  // 7. Assemble bundle
  const bundle = {
    caseId,
    context,
    flags,
    flagSummary,
    compliance,
    reportFamily: {
      id:          manifest.id,
      displayName: manifest.displayName,
      formType:    manifest.formType,
      sectionGroups: manifest.sectionGroups,
      destinationHints: manifest.destinationHints,
    },
    canonicalFields: {
      applicable: applicableFields.map(f => ({
        fieldId:        f.fieldId,
        label:          f.label,
        sectionGroup:   f.sectionGroup,
        contentType:    f.contentType,
        triggeringFlags: f.triggeringFlags,
      })),
      byGroup:    Object.fromEntries(
        Object.entries(fieldsByGroup).map(([group, fields]) => [
          group,
          fields.map(f => f.fieldId),
        ])
      ),
      totalApplicable: applicableFields.length,
    },
    sectionPlan,
    sectionRequirements,
    complianceChecks,

    _version: '4.0',
    _builtAt: new Date().toISOString(),
    _buildMs: Date.now() - t0,
  };

  // Persist to SQLite
  persistBundle(caseId, bundle);

  return bundle;
}

/**
 * Retrieve a persisted intelligence bundle from SQLite.
 * Returns null if not found.
 *
 * @param {string} caseId
 * @returns {import('./assignmentSchema.js').AssignmentIntelligenceBundle|null}
 */
export function getIntelligenceBundle(caseId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT bundle_json FROM assignment_intelligence WHERE case_id = ?'
  ).get(caseId);

  if (!row) return null;
  try {
    return JSON.parse(row.bundle_json);
  } catch {
    return null;
  }
}

/**
 * Build the intelligence bundle AND return a Phase 3-compatible plan.
 * This is the integration point for the orchestrator.
 *
 * @param {string} caseId
 * @returns {Promise<{ bundle: object, orchestratorPlan: object, context: object }>}
 */
export async function buildIntelligenceForOrchestrator(caseId) {
  const bundle = await buildIntelligenceBundle(caseId);

  // Also update the v1 assignments table for backward compat
  const db = getDb();
  const existingAssignment = db.prepare('SELECT id FROM assignments WHERE case_id = ?').get(caseId);
  let assignmentId;

  if (existingAssignment) {
    assignmentId = existingAssignment.id;
    db.prepare(`
      UPDATE assignments
         SET context_json = ?, form_type = ?, updated_at = datetime('now')
       WHERE case_id = ?
    `).run(JSON.stringify(bundle.context), bundle.context.formType, caseId);
  } else {
    assignmentId = uuidv4();
    db.prepare(`
      INSERT INTO assignments (id, case_id, form_type, context_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(assignmentId, caseId, bundle.context.formType, JSON.stringify(bundle.context));
  }

  // Add the assignment id to the context for downstream use
  bundle.context.id = assignmentId;

  // Convert section plan v2 to orchestrator-compatible format
  const orchestratorPlan = toOrchestratorPlan(bundle.sectionPlan, assignmentId);

  return {
    bundle,
    orchestratorPlan,
    context: bundle.context,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

function persistBundle(caseId, bundle) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM assignment_intelligence WHERE case_id = ?'
  ).get(caseId);

  const bundleJson = JSON.stringify(bundle);

  if (existing) {
    db.prepare(`
      UPDATE assignment_intelligence
         SET bundle_json = ?, form_type = ?, updated_at = datetime('now')
       WHERE case_id = ?
    `).run(bundleJson, bundle.context.formType, caseId);
  } else {
    db.prepare(`
      INSERT INTO assignment_intelligence (id, case_id, form_type, bundle_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(uuidv4(), caseId, bundle.context.formType, bundleJson);
  }
}

// ── Re-exports for convenience ──────────────────────────────────────────────

export { deriveAssignmentFlags, summarizeFlags } from './derivedFlags.js';
export { buildComplianceProfile } from './complianceProfile.js';
export { getManifestForFormType, resolveReportFamily, listReportFamilies, getManifestSummaries } from './reportFamilyManifest.js';
export { getApplicableFields, getCanonicalField, getAllCanonicalFields, getCanonicalFieldStats } from './canonicalFields.js';
export { buildSectionPlanV2, toOrchestratorPlan } from './sectionPlanner.js';
export { buildSectionRequirementMatrix } from './sectionRequirementMatrix.js';
export { evaluateHardComplianceRules } from './hardComplianceRules.js';
export { normalizeAssignmentContextV2 } from './normalizer.js';
