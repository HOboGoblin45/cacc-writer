/**
 * server/data/dropdownOptions.js
 * --------------------------------
 * Centralized dropdown option definitions for Appraisal Agent case metadata.
 *
 * All UI dropdowns and server-side validation reference these arrays.
 * To add a new option: add it here â€” no other files need changing.
 * To move to a database/config later: replace exports with async loaders.
 *
 * Used by:
 *   - server/caseMetadata.js  (validation)
 *   - index.html / app.js     (UI rendering via /api/dropdown-options)
 *   - server/promptBuilder.js (context injection)
 */

// â”€â”€ Assignment Purpose â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ASSIGNMENT_PURPOSES = [
  'Sale',
  'Refinance',
  'Construction',
  'Purchase',
  'Other',
];

// â”€â”€ Loan Program â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const LOAN_PROGRAMS = [
  'Conventional',
  'FHA',
  'USDA',
  'VA',
  'Construction',
  'Cash',
  'Other',
];

// â”€â”€ Property Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Occupancy Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const OCCUPANCY_TYPES = [
  'Owner Occupied',
  'Tenant Occupied',
  'Vacant',
  'Proposed',
  'Other',
];

// â”€â”€ Report Condition Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const REPORT_CONDITION_MODES = [
  'As Is',
  'Subject To Completion',
  'Subject To Repairs',
  'Subject As Complete per Plans/Specs',
  'Other',
];

// â”€â”€ Subject Condition (ANSI/Fannie Mae C-rating) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// C1 = New / never occupied
// C2 = No deferred maintenance, minor wear
// C3 = Well-maintained, limited updating needed
// C4 = Adequately maintained, some deferred maintenance
// C5 = Poor condition, significant deferred maintenance
// C6 = Substantial damage, unsafe, uninhabitable
export const SUBJECT_CONDITIONS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

// â”€â”€ Market Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const MARKET_TYPES = [
  'urban',
  'suburban',
  'rural',
  'agricultural',
  'mixed',
];

// â”€â”€ Workflow Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Mirrors server/workflowStatus.js â€” kept here for UI reference
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

// â”€â”€ Consolidated export for API endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

