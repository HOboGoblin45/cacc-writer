/**
 * server/caseMetadata.js
 * ----------------------
 * Assignment metadata schema, validation, and backward-compat helpers.
 *
 * All new fields default to null / '' so older cases without them load safely.
 * Use applyMetaDefaults() when reading meta.json to ensure all fields exist.
 * Use extractMetaFields() when writing from a request body.
 *
 * Option arrays are re-exported from server/data/dropdownOptions.js
 * so there is ONE canonical source of truth for all dropdown values.
 */

// ── Re-export centralized option arrays ───────────────────────────────────────
export {
  ASSIGNMENT_PURPOSES,
  LOAN_PROGRAMS,
  PROPERTY_TYPES,
  OCCUPANCY_TYPES,
  REPORT_CONDITION_MODES,
  SUBJECT_CONDITIONS,
  MARKET_TYPES,
} from './data/dropdownOptions.js';

import {
  ASSIGNMENT_PURPOSES,
  LOAN_PROGRAMS,
  PROPERTY_TYPES,
  OCCUPANCY_TYPES,
  REPORT_CONDITION_MODES,
  SUBJECT_CONDITIONS,
  MARKET_TYPES,
} from './data/dropdownOptions.js';

// ── Default values for all metadata fields ────────────────────────────────────
// Applied when loading older cases that predate this schema.
// Only fills undefined keys — never overwrites existing values.

export const META_DEFAULTS = {
  // Assignment classification
  assignmentPurpose:    null,
  loanProgram:          null,
  propertyType:         null,
  occupancyType:        null,
  reportConditionMode:  null,
  subjectCondition:     null,   // NEW — C1–C6 Fannie Mae condition rating

  // Parties
  clientName:           '',
  lenderName:           '',
  amcName:              '',

  // Geography — statewide Illinois support (no Bloomington-Normal assumption)
  state:                'IL',   // default Illinois
  county:               '',
  city:                 '',     // NEW
  marketArea:           '',
  neighborhood:         '',     // NEW
  marketType:           null,   // NEW — urban/suburban/rural/agricultural/mixed

  // Notes
  assignmentNotes:      '',

  // Workflow
  workflowStatus:       'facts_incomplete',
};

// ── applyMetaDefaults ─────────────────────────────────────────────────────────
/**
 * Merges META_DEFAULTS into an existing meta object.
 * Only fills in keys that are undefined — never overwrites existing values.
 * Safe to call on both new and old cases.
 *
 * @param {object} meta — raw meta.json object
 * @returns {object} — meta with all new fields guaranteed present
 */
export function applyMetaDefaults(meta) {
  const result = { ...meta };
  for (const [key, defaultVal] of Object.entries(META_DEFAULTS)) {
    if (result[key] === undefined) result[key] = defaultVal;
  }
  return result;
}

// ── extractMetaFields ─────────────────────────────────────────────────────────
/**
 * Safely extracts and validates new assignment metadata fields from a request body.
 * Only includes fields that are present in the body (undefined = not provided).
 * Validates enum fields against allowed values.
 *
 * @param {object} body — Express request body
 * @param {function} trimFn — optional trim helper (defaults to built-in)
 * @returns {object} — validated fields ready to merge into meta.json
 */
export function extractMetaFields(body, trimFn) {
  const trim = trimFn || ((v, max) => String(v ?? '').trim().slice(0, max || 200));
  const fields = {};

  // ── Enum fields — validate against allowed values, null if invalid ─────────
  if (body.assignmentPurpose !== undefined) {
    fields.assignmentPurpose = ASSIGNMENT_PURPOSES.includes(body.assignmentPurpose)
      ? body.assignmentPurpose : null;
  }
  if (body.loanProgram !== undefined) {
    fields.loanProgram = LOAN_PROGRAMS.includes(body.loanProgram)
      ? body.loanProgram : null;
  }
  if (body.propertyType !== undefined) {
    fields.propertyType = PROPERTY_TYPES.includes(body.propertyType)
      ? body.propertyType : null;
  }
  if (body.occupancyType !== undefined) {
    fields.occupancyType = OCCUPANCY_TYPES.includes(body.occupancyType)
      ? body.occupancyType : null;
  }
  if (body.reportConditionMode !== undefined) {
    fields.reportConditionMode = REPORT_CONDITION_MODES.includes(body.reportConditionMode)
      ? body.reportConditionMode : null;
  }
  // NEW — subject condition C1–C6
  if (body.subjectCondition !== undefined) {
    fields.subjectCondition = SUBJECT_CONDITIONS.includes(body.subjectCondition)
      ? body.subjectCondition : null;
  }
  // NEW — market type
  if (body.marketType !== undefined) {
    fields.marketType = MARKET_TYPES.includes(body.marketType)
      ? body.marketType : null;
  }

  // ── Free-text fields — trim and cap length ────────────────────────────────
  if (body.clientName      !== undefined) fields.clientName      = trim(body.clientName,      200);
  if (body.lenderName      !== undefined) fields.lenderName      = trim(body.lenderName,      200);
  if (body.amcName         !== undefined) fields.amcName         = trim(body.amcName,         200);
  if (body.state           !== undefined) fields.state           = trim(body.state,             50);
  if (body.county          !== undefined) fields.county          = trim(body.county,           100);
  if (body.city            !== undefined) fields.city            = trim(body.city,             100); // NEW
  if (body.marketArea      !== undefined) fields.marketArea      = trim(body.marketArea,       200);
  if (body.neighborhood    !== undefined) fields.neighborhood    = trim(body.neighborhood,     200); // NEW
  if (body.assignmentNotes !== undefined) fields.assignmentNotes = trim(body.assignmentNotes, 2000);

  return fields;
}

// ── buildAssignmentMetaBlock ──────────────────────────────────────────────────
/**
 * Builds a compact assignment metadata object for injection into prompts.
 * Only includes non-null / non-empty fields.
 *
 * @param {object} meta — case meta.json (with defaults applied)
 * @returns {object|null} — compact meta object, or null if nothing useful
 */
export function buildAssignmentMetaBlock(meta) {
  if (!meta) return null;
  const block = {};

  // Assignment classification
  if (meta.assignmentPurpose)   block.assignmentPurpose   = meta.assignmentPurpose;
  if (meta.loanProgram)         block.loanProgram         = meta.loanProgram;
  if (meta.propertyType)        block.propertyType        = meta.propertyType;
  if (meta.occupancyType)       block.occupancyType       = meta.occupancyType;
  if (meta.reportConditionMode) block.reportConditionMode = meta.reportConditionMode;
  if (meta.subjectCondition)    block.subjectCondition    = meta.subjectCondition;   // NEW

  // Geography — full statewide support
  if (meta.state)               block.state               = meta.state;
  if (meta.county)              block.county              = meta.county;
  if (meta.city)                block.city                = meta.city;               // NEW
  if (meta.marketArea)          block.marketArea          = meta.marketArea;
  if (meta.neighborhood)        block.neighborhood        = meta.neighborhood;       // NEW
  if (meta.marketType)          block.marketType          = meta.marketType;         // NEW

  // Parties
  if (meta.clientName)          block.clientName          = meta.clientName;
  if (meta.lenderName)          block.lenderName          = meta.lenderName;

  return Object.keys(block).length ? block : null;
}
