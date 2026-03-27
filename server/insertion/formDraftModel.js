/**
 * server/insertion/formDraftModel.js
 * -----------------------------------
 * Builds an explicit, non-persistent draft model for form output.
 *
 * This keeps the case record + generated sections as the source of truth while
 * giving the UI, golden-path harness, and insertion engine a stable field-level
 * projection to validate before any destination automation starts.
 */

import { getDb } from '../db/database.js';
import { getFieldsForForm } from '../fieldRegistry.js';
import { resolveMapping, inferTargetSoftware } from './destinationMapper.js';
import { getLatestInsertionRun, getInsertionRunItems } from './insertionRepo.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import { normalizeAssignmentContextV2 } from '../intelligence/normalizer.js';
import { deriveAssignmentFlags } from '../intelligence/derivedFlags.js';
import { resolveReportFamily, getManifestForFormType } from '../intelligence/reportFamilyManifest.js';
import { getApplicableFields } from '../intelligence/canonicalFields.js';
import { buildSectionRequirementMatrix } from '../intelligence/sectionRequirementMatrix.js';

const FORM_SOURCE_ALIASES = {
  '1004': {
    offering_history: ['prior_sales'],
    sales_comparison_commentary: ['sca_summary', 'sales_comparison'],
  },
  '1025': {
    offering_history: ['prior_sales'],
    sales_comparison_commentary: ['sca_summary', 'sales_comparison'],
  },
  '1073': {
    offering_history: ['prior_sales'],
    sales_comparison_commentary: ['sca_summary', 'sales_comparison'],
  },
  '1004c': {
    offering_history: ['prior_sales'],
    sales_comparison_commentary: ['sca_summary', 'sales_comparison'],
  },
  commercial: {
    rent_roll_remarks: ['market_rent_analysis'],
    expense_remarks: ['income_approach'],
    direct_capitalization_conclusion: ['income_approach'],
  },
};

function trimToText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceStatusForRow(row) {
  if (trimToText(row.final_text)) return 'final';
  if (trimToText(row.reviewed_text)) return 'reviewed';
  if (trimToText(row.draft_text)) return row.approved ? 'approved_draft' : 'draft';
  return 'missing';
}

function textForRow(row) {
  return trimToText(row.final_text) || trimToText(row.reviewed_text) || trimToText(row.draft_text) || '';
}

function buildSectionSourceIndex({ caseId, formType, generationRunId = null }) {
  const db = getDb();

  let sql = `
    SELECT section_id, draft_text, reviewed_text, final_text, approved, created_at
    FROM generated_sections
    WHERE case_id = ? AND form_type = ?
  `;
  const params = [caseId, formType];

  if (generationRunId) {
    sql += ' AND run_id = ?';
    params.push(generationRunId);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  const sources = new Map();

  for (const row of rows) {
    const text = textForRow(row);
    if (!text || sources.has(row.section_id)) continue;
    sources.set(row.section_id, {
      fieldId: row.section_id,
      text,
      sourceStatus: sourceStatusForRow(row),
      approved: !!row.approved,
      createdAt: row.created_at || null,
    });
  }

  const projection = getCaseProjection(caseId) || {};
  const outputs = projection.outputs || {};
  for (const [fieldId, output] of Object.entries(outputs)) {
    const text = trimToText(output?.text);
    if (!text) continue;

    const approved = !!(
      output?.approved
      || output?.sectionStatus === 'approved'
      || output?.status === 'approved'
    );

    sources.set(fieldId, {
      fieldId,
      text,
      sourceStatus: approved ? 'approved_output' : 'case_output',
      approved,
      createdAt: output?.updatedAt || projection.meta?.updatedAt || null,
    });
  }

  return sources;
}

function getSourceCandidates(formType, fieldId) {
  const candidates = [fieldId];
  const explicit = FORM_SOURCE_ALIASES[formType]?.[fieldId] || [];
  for (const alias of explicit) candidates.push(alias);

  const simplified = fieldId.replace(/_commentary$/, '').replace(/_comments$/, '');
  if (simplified && simplified !== fieldId) candidates.push(simplified);

  return [...new Set(candidates)];
}

function selectSource(sectionSources, formType, fieldId) {
  for (const candidate of getSourceCandidates(formType, fieldId)) {
    const source = sectionSources.get(candidate);
    if (source?.text) {
      return {
        ...source,
        aliasUsed: candidate !== fieldId,
        requestedFieldId: fieldId,
      };
    }
  }

  return {
    fieldId,
    requestedFieldId: fieldId,
    text: '',
    sourceStatus: 'missing',
    approved: false,
    createdAt: null,
    aliasUsed: false,
  };
}

function loadPreviousInsertionStatuses(caseId) {
  const statuses = new Map();
  const latestRun = getLatestInsertionRun(caseId);
  if (!latestRun) return statuses;

  const items = getInsertionRunItems(latestRun.id);
  for (const item of items) {
    statuses.set(item.fieldId, item.status);
  }
  return statuses;
}

function buildRequirementMetadata(caseId, formType) {
  try {
    const projection = getCaseProjection(caseId) || { meta: {}, facts: {} };
    const context = normalizeAssignmentContextV2(
      caseId,
      {
        ...(projection.meta || {}),
        formType: formType || projection.meta?.formType || '1004',
      },
      projection.facts || {},
    );
    const flags = deriveAssignmentFlags(context);
    const reportFamilyId = resolveReportFamily(context.formType, flags);
    const manifest = getManifestForFormType(context.formType, flags);
    const applicableFields = getApplicableFields(flags, reportFamilyId);
    const sectionRequirements = buildSectionRequirementMatrix({
      manifest,
      flags,
      applicableFields,
    });

    const requirementsByFieldId = new Map(
      (sectionRequirements.sections || []).map(section => [section.sectionId, section]),
    );

    return {
      reportFamilyId,
      sectionRequirements,
      requirementsByFieldId,
    };
  } catch {
    return {
      reportFamilyId: null,
      sectionRequirements: null,
      requirementsByFieldId: new Map(),
    };
  }
}

export function buildFormDraftModel({
  caseId,
  formType,
  generationRunId = null,
  targetSoftware = inferTargetSoftware(formType),
} = {}) {
  const fieldDefs = getFieldsForForm(formType)
    .filter(field => field.softwareTargets?.[targetSoftware]);
  const sectionSources = buildSectionSourceIndex({ caseId, formType, generationRunId });
  const previousStatuses = loadPreviousInsertionStatuses(caseId);
  const requirementMetadata = buildRequirementMetadata(caseId, formType);

  const fields = fieldDefs.map(fieldDef => {
    const mapping = resolveMapping(fieldDef.fieldId, formType, targetSoftware);
    const source = selectSource(sectionSources, formType, fieldDef.fieldId);
    const hasText = !!source.text;
    const requirement = requirementMetadata.requirementsByFieldId.get(fieldDef.fieldId) || null;
    const required = requirementMetadata.sectionRequirements
      ? requirement?.required === true
      : !!fieldDef.verifyRequired;
    const issues = [];

    if (!hasText && required) {
      issues.push({
        severity: 'error',
        code: 'missing_required_text',
        message: `Required draft text is missing for "${mapping.humanLabel}".`,
      });
    } else if (!hasText) {
      issues.push({
        severity: 'info',
        code: 'missing_optional_text',
        message: `No draft text is present for "${mapping.humanLabel}".`,
      });
    }

    if (source.aliasUsed) {
      issues.push({
        severity: 'info',
        code: 'alias_source',
        message: `Using "${source.fieldId}" as the source for "${mapping.humanLabel}".`,
      });
    }

    if (!mapping.supported) {
      issues.push({
        severity: 'warning',
        code: 'unsupported_destination',
        message: `No destination mapping is available for "${mapping.humanLabel}" in ${targetSoftware}.`,
      });
    } else if (!mapping.calibrated) {
      issues.push({
        severity: 'warning',
        code: 'uncalibrated_destination',
        message: `Destination mapping for "${mapping.humanLabel}" is not live calibrated.`,
      });
    }

    const sourceReady = hasText || !required;
    const destinationReady = hasText && mapping.supported && mapping.calibrated;

    return {
      fieldId: fieldDef.fieldId,
      humanLabel: mapping.humanLabel,
      sectionName: fieldDef.sectionName,
      priority: fieldDef.priority,
      verifyRequired: !!fieldDef.verifyRequired,
      required,
      requirementStatus: requirement?.status || (required ? 'required' : 'optional'),
      requirementReason: requirement?.reason || (required && !requirement ? 'Field registry requires verification.' : null),
      generationSupported: fieldDef.generationSupported !== false,
      text: source.text,
      textLength: source.text.length,
      hasText,
      sourceFieldId: source.fieldId,
      sourceStatus: source.sourceStatus,
      aliasUsed: source.aliasUsed,
      previousInsertionStatus: previousStatuses.get(fieldDef.fieldId) || null,
      targetSoftware,
      destinationKey: mapping.destinationKey,
      tabName: mapping.tabName,
      editorTarget: mapping.editorTarget,
      verificationMode: mapping.verificationMode,
      supported: mapping.supported,
      calibrated: mapping.calibrated,
      sourceReady,
      destinationReady,
      issues,
    };
  });

  const missingRequiredFields = fields.filter(field => !field.hasText && field.required).length;
  const aliasBackfilledFields = fields.filter(field => field.aliasUsed && field.hasText).length;
  const insertionReadyFields = fields.filter(field => field.destinationReady).length;
  const destinationBlockedFields = fields.filter(
    field => field.hasText && (!field.supported || !field.calibrated),
  ).length;

  const sourceReadiness = missingRequiredFields > 0 ? 'not_ready' : 'ready_for_review';
  const insertionReadiness = missingRequiredFields > 0
    ? 'not_ready'
    : destinationBlockedFields > 0
      ? 'needs_destination_review'
      : 'ready_for_insertion';

  return {
    caseId,
    formType,
    generationRunId,
    targetSoftware,
    generatedAt: new Date().toISOString(),
    summary: {
      totalFields: fields.length,
      requiredFields: fields.filter(field => field.required).length,
      fieldsWithText: fields.filter(field => field.hasText).length,
      missingRequiredFields,
      aliasBackfilledFields,
      supportedDestinationFields: fields.filter(field => field.supported).length,
      calibratedDestinationFields: fields.filter(field => field.calibrated).length,
      insertionReadyFields,
      destinationBlockedFields,
      sourceReadiness,
      insertionReadiness,
    },
    reportFamilyId: requirementMetadata.reportFamilyId,
    fields,
  };
}

export function getFormDraftTextMap(options) {
  const model = buildFormDraftModel(options);
  const texts = new Map();

  for (const field of model.fields) {
    if (field.text) texts.set(field.fieldId, field.text);
  }

  return texts;
}
