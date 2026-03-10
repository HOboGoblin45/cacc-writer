/**
 * server/insertion/destinationMapper.js
 * ---------------------------------------
 * Phase 9: Canonical-to-destination mapping layer.
 *
 * Derives destination mappings from:
 *   1. fieldRegistry.js — canonical field definitions with softwareTargets
 *   2. Agent field maps — ACI (desktop_agent/field_maps/*.json) and RQ (real_quantum_agent/field_maps/*.json)
 *
 * This is the single source of truth for "which canonical field maps to which
 * destination target in which software."
 *
 * destinationRegistry.js is kept as a thin compatibility shim but new code
 * should use this module.
 */

import { getFieldsForForm, getSoftwareTarget, getFieldDefinition, getFieldLabel } from '../fieldRegistry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ── Agent Field Map Cache ─────────────────────────────────────────────────────

/** @type {Map<string, Object>} */
const _agentFieldMapCache = new Map();

/**
 * Load an agent field map from disk.
 * Caches in memory after first load.
 *
 * @param {'aci' | 'real_quantum'} software
 * @param {string} formType
 * @returns {Object} field map keyed by field name
 */
function loadAgentFieldMap(software, formType) {
  const cacheKey = `${software}::${formType}`;
  if (_agentFieldMapCache.has(cacheKey)) {
    return _agentFieldMapCache.get(cacheKey);
  }

  let filePath;
  if (software === 'aci') {
    filePath = path.join(PROJECT_ROOT, 'desktop_agent', 'field_maps', `${formType}.json`);
  } else if (software === 'real_quantum') {
    filePath = path.join(PROJECT_ROOT, 'real_quantum_agent', 'field_maps', `${formType}.json`);
  } else {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    // Strip metadata keys (start with _)
    const cleaned = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (!key.startsWith('_') && typeof val === 'object') {
        cleaned[key] = val;
      }
    }
    _agentFieldMapCache.set(cacheKey, cleaned);
    return cleaned;
  } catch {
    _agentFieldMapCache.set(cacheKey, {});
    return {};
  }
}

/**
 * Clear the agent field map cache (e.g. after reload).
 */
export function clearFieldMapCache() {
  _agentFieldMapCache.clear();
}

// ── Mapping Resolution ────────────────────────────────────────────────────────

/**
 * Resolve the destination mapping for a single canonical field.
 *
 * @param {string} fieldId - Canonical field ID from fieldRegistry
 * @param {string} formType - Form type (e.g. '1004', 'commercial')
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @returns {import('./types.js').DestinationMapping}
 */
export function resolveMapping(fieldId, formType, targetSoftware) {
  const fieldDef = getFieldDefinition(formType, fieldId);
  const softwareTarget = fieldDef ? getSoftwareTarget(formType, fieldId, targetSoftware) : null;
  const agentMap = loadAgentFieldMap(targetSoftware, formType);

  // Try to find the agent field map entry
  // The agent field key may match fieldId directly, or via softwareTarget.fieldKey
  const agentFieldKey = resolveAgentFieldKey(fieldId, softwareTarget, agentMap);
  const agentEntry = agentFieldKey ? agentMap[agentFieldKey] : null;

  const destinationKey = `${targetSoftware}::${formType}::${fieldId}`;

  // Determine formatting mode
  let formattingMode = 'plain_text';
  if (targetSoftware === 'real_quantum') {
    formattingMode = 'html';
  }

  // Determine fallback strategy
  let fallbackStrategy = 'retry_then_clipboard';
  if (softwareTarget?.fallbackStrategy) {
    fallbackStrategy = softwareTarget.fallbackStrategy;
  }

  // Determine tab/navigation info
  let tabName = null;
  let editorTarget = null;
  let verificationMode = null;

  if (targetSoftware === 'aci' && agentEntry) {
    tabName = agentEntry.tab_name || null;
    editorTarget = agentEntry.label || null;
    verificationMode = agentEntry.verification_mode || 'tx32_readback';
  } else if (targetSoftware === 'real_quantum' && agentEntry) {
    tabName = agentEntry.nav_url_slug || null;
    editorTarget = agentEntry.input_selector || agentEntry.tinymce_iframe_id || null;
    verificationMode = 'contains_text';
  }

  // Determine calibration status
  let calibrated = false;
  if (agentEntry) {
    calibrated = !!(agentEntry.calibrated || agentEntry.verified);
  }

  return {
    fieldId,
    formType,
    targetSoftware,
    destinationKey,
    humanLabel: getFieldLabel(formType, fieldId) || fieldDef?.title || fieldId,
    agentFieldKey: agentFieldKey || null,
    formattingMode,
    tabName,
    editorTarget,
    verificationMode,
    fallbackStrategy,
    calibrated,
    supported: !!agentEntry,
  };
}

/**
 * Resolve all destination mappings for a form type + target software.
 *
 * @param {string} formType
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @returns {import('./types.js').DestinationMapping[]}
 */
export function resolveAllMappings(formType, targetSoftware) {
  const fields = getFieldsForForm(formType) || [];
  const mappings = [];

  for (const fieldDef of fields) {
    const softwareTarget = getSoftwareTarget(formType, fieldDef.fieldId, targetSoftware);
    // Only include fields that have a software target defined
    if (!softwareTarget) continue;

    const mapping = resolveMapping(fieldDef.fieldId, formType, targetSoftware);
    mappings.push(mapping);
  }

  return mappings;
}

/**
 * Get the target software for a given form type.
 * Infers from form type conventions.
 *
 * @param {string} formType
 * @returns {'aci' | 'real_quantum'}
 */
export function inferTargetSoftware(formType) {
  const commercial = ['commercial'];
  if (commercial.includes(formType)) return 'real_quantum';
  return 'aci';
}

/**
 * Build a mapping preview for the UI.
 * Shows what will be inserted where, with text snippets.
 *
 * @param {string} formType
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @param {Map<string, string>} fieldTexts - Map of fieldId → approved/final text
 * @param {Map<string, string>} [previousStatuses] - Map of fieldId → last insertion status
 * @returns {import('./types.js').MappingPreview}
 */
export function buildMappingPreview(formType, targetSoftware, fieldTexts, previousStatuses = new Map()) {
  const mappings = resolveAllMappings(formType, targetSoftware);
  const items = [];

  let supportedCount = 0;
  let unsupportedCount = 0;
  let withTextCount = 0;
  let withoutTextCount = 0;
  let alreadyVerified = 0;

  for (const mapping of mappings) {
    const text = fieldTexts.get(mapping.fieldId) || '';
    const hasText = text.length > 0;
    const prevStatus = previousStatuses.get(mapping.fieldId) || null;

    if (mapping.supported) supportedCount++;
    else unsupportedCount++;

    if (hasText) withTextCount++;
    else withoutTextCount++;

    if (prevStatus === 'verified') alreadyVerified++;

    items.push({
      fieldId: mapping.fieldId,
      humanLabel: mapping.humanLabel,
      targetSoftware: mapping.targetSoftware,
      destinationKey: mapping.destinationKey,
      formattingMode: mapping.formattingMode,
      tabName: mapping.tabName,
      textSnippet: hasText ? text.slice(0, 120) + (text.length > 120 ? '…' : '') : '',
      textLength: text.length,
      supported: mapping.supported,
      calibrated: mapping.calibrated,
      hasText,
      previousInsertionStatus: prevStatus,
    });
  }

  return {
    caseId: null, // caller fills this
    formType,
    targetSoftware,
    destinationProfileId: null, // caller fills this
    items,
    totalFields: items.length,
    supportedFields: supportedCount,
    unsupportedFields: unsupportedCount,
    fieldsWithText: withTextCount,
    fieldsWithoutText: withoutTextCount,
    alreadyVerified,
    qcGate: null, // caller fills this
  };
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the agent field map key for a canonical field.
 * Tries multiple strategies:
 *   1. Direct match: fieldId exists in agentMap
 *   2. softwareTarget.fieldKey from fieldRegistry
 *   3. softwareTarget.agentKey from fieldRegistry
 *
 * @param {string} fieldId
 * @param {Object|null} softwareTarget
 * @param {Object} agentMap
 * @returns {string|null}
 */
function resolveAgentFieldKey(fieldId, softwareTarget, agentMap) {
  // Strategy 1: direct match
  if (agentMap[fieldId]) return fieldId;

  // Strategy 2: fieldKey from softwareTarget
  if (softwareTarget?.fieldKey && agentMap[softwareTarget.fieldKey]) {
    return softwareTarget.fieldKey;
  }

  // Strategy 3: agentKey from softwareTarget
  if (softwareTarget?.agentKey && agentMap[softwareTarget.agentKey]) {
    return softwareTarget.agentKey;
  }

  // Strategy 4: try common aliases
  // e.g. 'sales_comparison_commentary' → 'sales_comparison'
  const simplified = fieldId.replace(/_commentary$/, '').replace(/_comments$/, '');
  if (simplified !== fieldId && agentMap[simplified]) return simplified;

  return null;
}
