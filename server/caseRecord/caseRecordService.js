/**
 * server/caseRecord/caseRecordService.js
 * ---------------------------------------
 * Phase B foundation service for canonical case read models.
 *
 * Current backing store: filesystem case folders.
 * Future backing store: canonical SQLite case tables.
 */

import fs from 'fs';
import path from 'path';

import { CASES_DIR, CASE_ID_RE, casePath, normalizeFormType } from '../utils/caseUtils.js';
import { readJSON } from '../utils/fileUtils.js';
import { applyMetaDefaults } from '../caseMetadata.js';
import { computeWorkflowStatus } from '../workflowStatus.js';
import { getScopeMetaForForm } from '../config/productionScope.js';
import { buildCanonicalCaseRecord } from './canonicalCaseSchema.js';

function buildDocSummary(docText) {
  const summary = {};
  for (const [label, text] of Object.entries(docText || {})) {
    if (typeof text !== 'string') continue;
    summary[label] = {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      preview: text.slice(0, 200),
    };
  }
  return summary;
}

function loadRawCase(caseId) {
  const caseDir = casePath(caseId);
  if (!fs.existsSync(caseDir)) return null;

  let meta = readJSON(path.join(caseDir, 'meta.json'), {});
  meta.formType = normalizeFormType(meta.formType);
  meta = applyMetaDefaults(meta);

  const facts = readJSON(path.join(caseDir, 'facts.json'), {});
  const docText = readJSON(path.join(caseDir, 'doc_text.json'), {});
  const outputs = readJSON(path.join(caseDir, 'outputs.json'), {});
  const docSummary = buildDocSummary(docText);

  meta.workflowStatus = computeWorkflowStatus(meta, facts, outputs);
  const scopeMeta = getScopeMetaForForm(meta.formType);

  return { caseId, meta, facts, docText, outputs, docSummary, scopeMeta };
}

export function getCaseProjection(caseId) {
  const raw = loadRawCase(caseId);
  if (!raw) return null;

  return {
    ...raw,
    caseRecord: buildCanonicalCaseRecord({
      caseId: raw.caseId,
      meta: raw.meta,
      facts: raw.facts,
      outputs: raw.outputs,
      docSummary: raw.docSummary,
    }),
  };
}

export function listCaseProjections() {
  if (!fs.existsSync(CASES_DIR)) return [];

  const dirs = fs.readdirSync(CASES_DIR).filter(
    d => CASE_ID_RE.test(d) && fs.statSync(path.join(CASES_DIR, d)).isDirectory(),
  );

  return dirs
    .map(getCaseProjection)
    .filter(Boolean)
    .sort((a, b) => new Date(b.meta.updatedAt) - new Date(a.meta.updatedAt));
}
