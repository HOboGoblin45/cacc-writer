/**
 * server/data/dropdownOptions.js
 * --------------------------------
 * Centralized dropdown option definitions for CACC Writer case metadata.
 *
 * All UI dropdowns and server-side validation reference these arrays.
 * To add a new option: add it here — no other files need changing.
 * To move to a database/config later: replace exports with async loaders.
 *
 * Used by:
 *   - server/caseMetadata.js  (validation)
 *   - index.html / app.js     (UI rendering via /api/dropdown-options)
 *   - server/promptBuilder.js (context injection)
 */

// ── Assignment Purpose ────────────────────────────────────────────────────────
export const ASSIGNMENT_PURPOSES = [
  'Sale',
  'Refinance',
  'Construction',
  'Purchase',
  'Other',
];

// ── Loan Program ──────────────────────────────────────────────────────────────
export const LOAN_PROGRAMS = [
  'Conventional',
  'FHA',
  'USDA',
  'VA',
  'Construction',
  'Cash',
  'Other',
];

// ── Property Type ─────────────────────────────────────────────────────────────
export const PROPERTY_TYPES = [
  'Single Family',
  '2-4 Unit',
  'Condo',
  'PUD',
  'Manufactured',
  'Commercial',
  'Mixed Use',
  'Other',
];

// ── Occupancy Type ────────────────────────────────────────────────────────────
export const OCCUPANCY_TYPES = [
  'Owner Occupied',
  'Tenant Occupied',
  'Vacant',
  'Proposed',
  'Other',
];

// ── Report Condition Mode ─────────────────────────────────────────────────────
export const REPORT_CONDITION_MODES = [
  'As Is',
  'Subject To Completion',
  'Subject To Repairs',
  'Subject As Complete per Plans/Specs',
  'Other',
];

// ── Subject Condition (ANSI/Fannie Mae C-rating) ──────────────────────────────
// C1 = New / never occupied
// C2 = No deferred maintenance, minor wear
// C3 = Well-maintained, limited updating needed
// C4 = Adequately maintained, some deferred maintenance
// C5 = Poor condition, significant deferred maintenance
// C6 = Substantial damage, unsafe, uninhabitable
export const SUBJECT_CONDITIONS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

// ── Market Type ───────────────────────────────────────────────────────────────
export const MARKET_TYPES = [
  'urban',
  'suburban',
  'rural',
  'agricultural',
  'mixed',
];

// ── Workflow Status ───────────────────────────────────────────────────────────
// Mirrors server/workflowStatus.js — kept here for UI reference
export const WORKFLOW_STATUSES = [
  'facts_incomplete',
  'ready_for_generation',
  'generation_in_progress',
  'sections_drafted',
  'awaiting_review',
  'automation_ready',
  'insertion_in_progress',
  'verified',
  'exception_flagged',
];

// ── Consolidated export for API endpoint ─────────────────────────────────────
// GET /api/dropdown-options returns this object so the UI can render
// all dropdowns dynamically without hardcoding values in HTML.
export const ALL_OPTIONS = {
  assignmentPurpose:   ASSIGNMENT_PURPOSES,
  loanProgram:         LOAN_PROGRAMS,
  propertyType:        PROPERTY_TYPES,
  occupancyType:       OCCUPANCY_TYPES,
  reportConditionMode: REPORT_CONDITION_MODES,
  subjectCondition:    SUBJECT_CONDITIONS,
  marketType:          MARKET_TYPES,
};
