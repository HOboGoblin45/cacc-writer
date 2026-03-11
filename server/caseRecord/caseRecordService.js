/**
 * server/caseRecord/caseRecordService.js
 * ---------------------------------------
 * Phase B service for canonical case read models.
 *
 * Authoritative read path: SQLite canonical case tables.
 * Compatibility path: filesystem case folders (read/write-through during migration).
 */

import fs from 'fs';
import path from 'path';

import { CASES_DIR, CASE_ID_RE, casePath, normalizeFormType } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { applyMetaDefaults } from '../caseMetadata.js';
import { computeWorkflowStatus } from '../workflowStatus.js';
import { getScopeMetaForForm } from '../config/productionScope.js';
import { buildCanonicalCaseRecord } from './canonicalCaseSchema.js';
import {
  saveCaseAggregate,
  getCaseAggregate,
  listCaseAggregates,
  deleteCaseAggregate,
} from '../db/repositories/caseRecordRepo.js';

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

function normalizeRawCase(raw) {
  const safeMeta = applyMetaDefaults({ ...(raw.meta || {}) });
  safeMeta.formType = normalizeFormType(safeMeta.formType);
  safeMeta.caseId = raw.caseId;
  safeMeta.workflowStatus = computeWorkflowStatus(safeMeta, raw.facts || {}, raw.outputs || {});

  const safeDocText = raw.docText || {};
  const safeDocSummary = raw.docSummary || buildDocSummary(safeDocText);

  return {
    caseId: raw.caseId,
    meta: safeMeta,
    facts: raw.facts || {},
    outputs: raw.outputs || {},
    history: raw.history || {},
    docText: safeDocText,
    docSummary: safeDocSummary,
    scopeMeta: getScopeMetaForForm(safeMeta.formType),
  };
}

function readDocText(caseId) {
  return readJSON(path.join(casePath(caseId), 'doc_text.json'), {});
}

function loadRawCaseFromDb(caseId) {
  const agg = getCaseAggregate(caseId);
  if (!agg) return null;

  return normalizeRawCase({
    caseId: agg.caseId,
    meta: agg.meta,
    facts: agg.facts,
    outputs: agg.outputs,
    history: agg.history,
    docText: readDocText(caseId),
  });
}

function loadRawCaseFromFilesystem(caseId) {
  const caseDir = casePath(caseId);
  if (!fs.existsSync(caseDir)) return null;

  const meta = applyMetaDefaults({
    ...readJSON(path.join(caseDir, 'meta.json'), {}),
    caseId,
  });
  meta.formType = normalizeFormType(meta.formType);

  const facts = readJSON(path.join(caseDir, 'facts.json'), {});
  const docText = readJSON(path.join(caseDir, 'doc_text.json'), {});
  const outputs = readJSON(path.join(caseDir, 'outputs.json'), {});
  const history = readJSON(path.join(caseDir, 'history.json'), {});

  return normalizeRawCase({ caseId, meta, facts, outputs, history, docText });
}

function writeCompatibilityFiles(raw) {
  const caseDir = casePath(raw.caseId);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  writeJSON(path.join(caseDir, 'meta.json'), raw.meta || {});
  writeJSON(path.join(caseDir, 'facts.json'), raw.facts || {});
  writeJSON(path.join(caseDir, 'outputs.json'), raw.outputs || {});
  writeJSON(path.join(caseDir, 'history.json'), raw.history || {});

  const docTextPath = path.join(caseDir, 'doc_text.json');
  if (!fs.existsSync(docTextPath)) {
    writeJSON(docTextPath, raw.docText || {});
  }

  const feedbackPath = path.join(caseDir, 'feedback.json');
  if (!fs.existsSync(feedbackPath)) {
    writeJSON(feedbackPath, []);
  }
}

function persistRawCase(raw, { writeLegacyFiles = false } = {}) {
  const normalized = normalizeRawCase(raw);

  saveCaseAggregate({
    caseId: normalized.caseId,
    meta: normalized.meta,
    facts: normalized.facts,
    outputs: normalized.outputs,
    history: normalized.history,
  });

  if (writeLegacyFiles) {
    writeCompatibilityFiles(normalized);
  }

  return normalized;
}

function toProjection(raw) {
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

export function saveCaseProjection({ caseId, meta, facts = {}, outputs = {}, history = {}, docText = {} }, options = {}) {
  const normalized = persistRawCase({ caseId, meta, facts, outputs, history, docText }, options);
  return toProjection(normalized);
}

export function syncCaseRecordFromFilesystem(caseId) {
  const raw = loadRawCaseFromFilesystem(caseId);
  if (!raw) return null;
  persistRawCase(raw, { writeLegacyFiles: false });
  return toProjection(raw);
}

export function getCaseProjection(caseId) {
  const dbRaw = loadRawCaseFromDb(caseId);
  if (dbRaw) return toProjection(dbRaw);

  const fsRaw = loadRawCaseFromFilesystem(caseId);
  if (!fsRaw) return null;

  // One-time backfill for legacy cases not yet in canonical tables.
  persistRawCase(fsRaw, { writeLegacyFiles: false });
  return toProjection(fsRaw);
}

export function listCaseProjections() {
  const fromDb = listCaseAggregates(1000)
    .map(agg => normalizeRawCase({
      caseId: agg.caseId,
      meta: agg.meta,
      facts: agg.facts,
      outputs: agg.outputs,
      history: agg.history,
      docText: readDocText(agg.caseId),
    }))
    .map(toProjection);

  if (fromDb.length) {
    return fromDb.sort((a, b) => new Date(b.meta.updatedAt || 0) - new Date(a.meta.updatedAt || 0));
  }

  if (!fs.existsSync(CASES_DIR)) return [];

  const dirs = fs.readdirSync(CASES_DIR).filter(
    d => CASE_ID_RE.test(d) && fs.statSync(path.join(CASES_DIR, d)).isDirectory(),
  );

  const projections = dirs
    .map(getCaseProjection)
    .filter(Boolean)
    .sort((a, b) => new Date(b.meta.updatedAt || 0) - new Date(a.meta.updatedAt || 0));

  return projections;
}

export function deleteCanonicalCaseRecord(caseId) {
  deleteCaseAggregate(caseId);
}
