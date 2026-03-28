/**
 * server/intelligence/sectionRequirementMatrix.js
 * ------------------------------------------------
 * Deterministic required-section matrix builder.
 *
 * This module converts manifest rules + derived flags into an explainable
 * section requirement matrix that can be used for:
 *   - pre-draft gating
 *   - compliance review
 *   - UI explanations ("why this section is required")
 */

import { getCanonicalField } from './canonicalFields.js';

const STATUS_RANK = {
  required: 4,
  conditional_required: 3,
  optional: 2,
  excluded: 1,
};

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toLabelFromId(sectionId) {
  return asText(sectionId)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildFieldLookup(applicableFields = []) {
  const map = new Map();
  for (const field of applicableFields) {
    if (!field?.fieldId) continue;
    map.set(field.fieldId, field);
  }
  return map;
}

function resolveField(sectionId, applicableFieldMap) {
  return applicableFieldMap.get(sectionId) || getCanonicalField(sectionId) || null;
}

function sectionGroupOrderMap(manifest) {
  const map = new Map();
  const groups = Array.isArray(manifest?.sectionGroups) ? manifest.sectionGroups : [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupId = asText(group?.id);
    if (!groupId) continue;
    const order = Number(group?.order);
    map.set(groupId, Number.isFinite(order) ? order : i + 1);
  }
  return map;
}

function reasonForConditional(condition, met) {
  const key = asText(condition) || 'always';
  if (key === 'always') {
    return {
      reasonCode: 'manifest_always',
      reason: 'Manifest marks this section as always required.',
      triggerFlag: null,
    };
  }

  if (met) {
    return {
      reasonCode: 'manifest_condition_met',
      reason: `Manifest condition "${key}" is active.`,
      triggerFlag: key,
    };
  }

  return {
    reasonCode: 'manifest_condition_not_met',
    reason: `Manifest condition "${key}" is not active.`,
    triggerFlag: key,
  };
}

function shouldReplace(existing, next) {
  if (!existing) return true;
  return (STATUS_RANK[next.status] || 0) > (STATUS_RANK[existing.status] || 0);
}

function upsertEntry(entries, nextEntry) {
  const existing = entries.get(nextEntry.sectionId);
  if (shouldReplace(existing, nextEntry)) {
    entries.set(nextEntry.sectionId, nextEntry);
  }
}

function buildEntry({
  sectionId,
  status,
  label,
  sectionGroup,
  contentType,
  required,
  reasonCode,
  reason,
  source,
  triggerFlag = null,
}) {
  return {
    sectionId,
    label: asText(label) || toLabelFromId(sectionId),
    sectionGroup: asText(sectionGroup) || 'unknown',
    contentType: asText(contentType) || 'narrative',
    status,
    required: Boolean(required),
    reasonCode,
    reason,
    source,
    triggerFlag,
  };
}

/**
 * Build deterministic section requirement matrix for a report family.
 *
 * @param {object} params
 * @param {object} params.manifest
 * @param {object} params.flags
 * @param {object[]} params.applicableFields
 * @returns {object}
 */
export function buildSectionRequirementMatrix({
  manifest,
  flags = {},
  applicableFields = [],
}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('buildSectionRequirementMatrix requires a report manifest.');
  }

  const applicableFieldMap = buildFieldLookup(applicableFields);
  const entries = new Map();

  for (const sectionIdRaw of (manifest.requiredSections || [])) {
    const sectionId = asText(sectionIdRaw);
    if (!sectionId) continue;
    const field = resolveField(sectionId, applicableFieldMap);
    upsertEntry(entries, buildEntry({
      sectionId,
      status: 'required',
      required: true,
      label: field?.label,
      sectionGroup: field?.sectionGroup,
      contentType: field?.contentType,
      reasonCode: 'manifest_required',
      reason: 'Listed in manifest.requiredSections.',
      source: 'manifest.requiredSections',
    }));
  }

  for (const condition of (manifest.conditionalSections || [])) {
    const sectionId = asText(condition?.sectionId);
    if (!sectionId) continue;

    const conditionKey = asText(condition?.condition) || 'always';
    const met = conditionKey === 'always' || flags[conditionKey] === true;
    const ruleReason = reasonForConditional(conditionKey, met);
    const field = resolveField(sectionId, applicableFieldMap);

    upsertEntry(entries, buildEntry({
      sectionId,
      status: met ? 'conditional_required' : 'excluded',
      required: met,
      label: condition?.label || field?.label,
      sectionGroup: field?.sectionGroup,
      contentType: field?.contentType,
      reasonCode: ruleReason.reasonCode,
      reason: ruleReason.reason,
      source: 'manifest.conditionalSections',
      triggerFlag: ruleReason.triggerFlag,
    }));
  }

  for (const block of (manifest.optionalCommentaryBlocks || [])) {
    const sectionId = asText(block?.id);
    if (!sectionId) continue;

    const triggerFlag = asText(block?.triggerFlag);
    const met = Boolean(triggerFlag && flags[triggerFlag] === true);
    const field = resolveField(sectionId, applicableFieldMap);

    upsertEntry(entries, buildEntry({
      sectionId,
      status: met ? 'conditional_required' : 'excluded',
      required: met,
      label: field?.label,
      sectionGroup: field?.sectionGroup || 'commentary',
      contentType: field?.contentType || 'commentary',
      reasonCode: met ? 'commentary_triggered' : 'commentary_not_triggered',
      reason: met
        ? `Commentary block triggered by "${triggerFlag}".`
        : `Commentary block not triggered (flag "${triggerFlag}" is false).`,
      source: 'manifest.optionalCommentaryBlocks',
      triggerFlag: triggerFlag || null,
    }));
  }

  for (const field of applicableFields) {
    const sectionId = asText(field?.fieldId);
    if (!sectionId || entries.has(sectionId)) continue;

    upsertEntry(entries, buildEntry({
      sectionId,
      status: 'optional',
      required: false,
      label: field?.label,
      sectionGroup: field?.sectionGroup,
      contentType: field?.contentType,
      reasonCode: 'applicable_optional',
      reason: 'Applicable canonical field that is not required by manifest rules.',
      source: 'canonical_fields',
    }));
  }

  const groupOrder = sectionGroupOrderMap(manifest);
  const sections = [...entries.values()].sort((a, b) => {
    const ga = groupOrder.get(a.sectionGroup) ?? 999;
    const gb = groupOrder.get(b.sectionGroup) ?? 999;
    if (ga !== gb) return ga - gb;
    const sa = STATUS_RANK[a.status] || 0;
    const sb = STATUS_RANK[b.status] || 0;
    if (sa !== sb) return sb - sa;
    return a.sectionId.localeCompare(b.sectionId);
  });

  const required = sections.filter(s => s.status === 'required' || s.status === 'conditional_required');
  const optional = sections.filter(s => s.status === 'optional');
  const excluded = sections.filter(s => s.status === 'excluded');

  return {
    reportFamilyId: manifest.id,
    formType: manifest.formType,
    generatedAt: new Date().toISOString(),
    sections,
    requiredSectionIds: required.map(s => s.sectionId),
    optionalSectionIds: optional.map(s => s.sectionId),
    excludedSectionIds: excluded.map(s => s.sectionId),
    summary: {
      totalSections: sections.length,
      requiredCount: required.length,
      optionalCount: optional.length,
      excludedCount: excluded.length,
    },
  };
}

