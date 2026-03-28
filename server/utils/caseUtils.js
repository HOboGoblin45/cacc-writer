/**
 * server/utils/caseUtils.js
 * --------------------------
 * Case path resolution and form-type normalization utilities.
 * Used by route modules and domain modules that need to locate case directories.
 *
 * Narrow purpose: case directory resolution, case ID validation, form-type
 * normalization, and case-level config loading.
 * No business logic — no AI calls, no generation decisions.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_FORM_TYPE, isValidFormType, getFormConfig } from '../../forms/index.js';
import { readJSON } from './fileUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Constants ─────────────────────────────────────────────────────────────────

/** Absolute path to the cases/ directory at project root. */
export const CASES_DIR = path.join(__dirname, '..', '..', 'cases');

/** Valid case ID: exactly 8 lowercase hex characters. */
export const CASE_ID_RE = /^[a-f0-9]{8}$/i;

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * casePath(id)
 * Returns the absolute path to a case directory (does NOT validate the ID).
 *
 * @param {string} id — 8-char hex case ID
 * @returns {string}
 */
export function casePath(id) {
  return path.join(CASES_DIR, id);
}

/**
 * resolveCaseDir(caseId)
 * Validates the case ID format and returns the absolute case directory path.
 * Returns null if the ID is invalid or the path escapes CASES_DIR (path traversal guard).
 *
 * @param {string} caseId
 * @returns {string|null}
 */
export function resolveCaseDir(caseId) {
  if (!CASE_ID_RE.test(String(caseId || ''))) return null;
  const cd  = casePath(caseId);
  const rel = path.relative(CASES_DIR, cd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return cd;
}

// ── Form-type helpers ─────────────────────────────────────────────────────────

/**
 * normalizeFormType(ft)
 * Returns a valid form type string, falling back to DEFAULT_FORM_TYPE.
 *
 * @param {string} ft
 * @returns {string}
 */
export function normalizeFormType(ft) {
  const s = String(ft || '').trim();
  return isValidFormType(s) ? s : DEFAULT_FORM_TYPE;
}

/**
 * getCaseFormConfig(caseDir)
 * Reads meta.json from a case directory and returns the resolved form type,
 * form config, and raw meta object.
 *
 * @param {string} caseDir — absolute path to case directory
 * @returns {{ formType: string, formConfig: object, meta: object }}
 */
export function getCaseFormConfig(caseDir) {
  const meta     = readJSON(path.join(caseDir, 'meta.json'), {});
  const formType = normalizeFormType(meta.formType);
  return { formType, formConfig: getFormConfig(formType), meta };
}
