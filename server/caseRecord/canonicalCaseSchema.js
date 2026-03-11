/**
 * server/caseRecord/canonicalCaseSchema.js
 * -----------------------------------------
 * Phase B foundation: canonical case record projection.
 *
 * This does not replace persistence yet. It defines the canonical read-model
 * that downstream layers should use while filesystem -> DB migration proceeds.
 */

export const CANONICAL_CASE_SCHEMA_VERSION = 1;

function normalizeOutputs(outputs = {}) {
  const sectionIds = Object.keys(outputs).filter(k => k !== 'updatedAt');
  return {
    sectionIds,
    sectionCount: sectionIds.length,
    updatedAt: outputs.updatedAt || null,
  };
}

export function buildCanonicalCaseRecord({
  caseId,
  meta,
  facts,
  outputs,
  docSummary,
}) {
  const normalizedOutputs = normalizeOutputs(outputs);
  return {
    schemaVersion: CANONICAL_CASE_SCHEMA_VERSION,
    caseId,
    header: {
      formType: meta.formType || null,
      address: meta.address || '',
      borrower: meta.borrower || '',
      status: meta.status || 'active',
      pipelineStage: meta.pipelineStage || 'intake',
      workflowStatus: meta.workflowStatus || 'facts_incomplete',
      createdAt: meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
    },
    evidence: {
      documentSummary: docSummary || {},
      facts: facts || {},
    },
    drafting: {
      outputs: outputs || {},
      outputSummary: normalizedOutputs,
    },
    unresolvedIssues: Array.isArray(meta.unresolvedIssues) ? meta.unresolvedIssues : [],
  };
}
