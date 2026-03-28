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
import crypto from 'crypto';

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
import { getUserDb } from '../db/database.js';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function normalizeMetaForDigest(meta = {}, caseId = null) {
  const safe = applyMetaDefaults({ ...(meta || {}) });
  safe.formType = normalizeFormType(safe.formType);
  safe.caseId = caseId || safe.caseId || null;
  safe.unresolvedIssues = Array.isArray(meta?.unresolvedIssues)
    ? meta.unresolvedIssues
    : [];
  return safe;
}

function comparableCasePayload(raw) {
  return {
    meta: normalizeMetaForDigest(raw?.meta || {}, raw?.caseId || null),
    facts: raw?.facts || {},
    provenance: raw?.provenance || {},
    outputs: raw?.outputs || {},
    history: raw?.history || {},
  };
}

function buildCaseDigest(raw) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(comparableCasePayload(raw)))
    .digest('hex');
}

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
    provenance: raw.provenance || {},
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

function readFactSources(caseId) {
  return readJSON(path.join(casePath(caseId), 'fact_sources.json'), {});
}

function loadRawCaseFromDb(caseId, opts = {}) {
  const agg = getCaseAggregate(caseId, opts);
  if (!agg) return null;

  return normalizeRawCase({
    caseId: agg.caseId,
    meta: agg.meta,
    facts: agg.facts,
    provenance: agg.provenance,
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
  const provenance = readJSON(path.join(caseDir, 'fact_sources.json'), {});
  const docText = readJSON(path.join(caseDir, 'doc_text.json'), {});
  const outputs = readJSON(path.join(caseDir, 'outputs.json'), {});
  const history = readJSON(path.join(caseDir, 'history.json'), {});

  return normalizeRawCase({ caseId, meta, facts, provenance, outputs, history, docText });
}

function writeCompatibilityFiles(raw) {
  const caseDir = casePath(raw.caseId);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  writeJSON(path.join(caseDir, 'meta.json'), raw.meta || {});
  writeJSON(path.join(caseDir, 'facts.json'), raw.facts || {});
  writeJSON(path.join(caseDir, 'fact_sources.json'), raw.provenance || {});
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

function persistRawCase(raw, { writeLegacyFiles = false, db } = {}) {
  const normalized = normalizeRawCase(raw);

  saveCaseAggregate({
    caseId: normalized.caseId,
    meta: normalized.meta,
    facts: normalized.facts,
    provenance: normalized.provenance,
    outputs: normalized.outputs,
    history: normalized.history,
  }, db ? { db } : {});

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
      provenance: raw.provenance,
      outputs: raw.outputs,
      docSummary: raw.docSummary,
    }),
  };
}

export function saveCaseProjection({
  caseId,
  meta,
  facts = {},
  provenance = {},
  outputs = {},
  history = {},
  docText = {},
}, options = {}) {
  // Support userId-based tenant isolation
  if (options.userId && !options.db) {
    options.db = getUserDb(options.userId);
  }
  const normalized = persistRawCase({ caseId, meta, facts, provenance, outputs, history, docText }, options);
  return toProjection(normalized);
}

export function syncCaseRecordFromFilesystem(caseId) {
  const raw = loadRawCaseFromFilesystem(caseId);
  if (!raw) return null;
  persistRawCase(raw, { writeLegacyFiles: false });
  return toProjection(raw);
}

export function getCaseProjection(caseId, options = {}) {
  const dbOptsObj = options.userId ? { db: getUserDb(options.userId) } : {};
  const dbRaw = loadRawCaseFromDb(caseId, dbOptsObj);
  if (dbRaw) return toProjection(dbRaw);

  const fsRaw = loadRawCaseFromFilesystem(caseId);
  if (!fsRaw) return null;

  // One-time backfill for legacy cases not yet in canonical tables.
  persistRawCase(fsRaw, { writeLegacyFiles: false, ...dbOptsObj });
  return toProjection(fsRaw);
}

export function listCaseProjections(options = {}) {
  const dbOptsObj = options.userId ? { db: getUserDb(options.userId) } : {};
  const fromDb = listCaseAggregates(1000, dbOptsObj)
    .map(agg => normalizeRawCase({
      caseId: agg.caseId,
      meta: agg.meta,
      facts: agg.facts,
      provenance: agg.provenance,
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

export function deleteCanonicalCaseRecord(caseId, options = {}) {
  const dbOptsObj = options.userId ? { db: getUserDb(options.userId) } : {};
  deleteCaseAggregate(caseId, dbOptsObj);
}

export function updateCaseFactProvenance(caseId, incoming = {}, { replace = false } = {}) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const nextProvenance = replace
    ? { ...(incoming || {}) }
    : { ...(projection.provenance || {}), ...(incoming || {}) };

  const nextMeta = {
    ...(projection.meta || {}),
    updatedAt: new Date().toISOString(),
  };

  return saveCaseProjection({
    caseId,
    meta: nextMeta,
    facts: projection.facts || {},
    provenance: nextProvenance,
    outputs: projection.outputs || {},
    history: projection.history || {},
    docText: projection.docText || readDocText(caseId),
  }, { writeLegacyFiles: true });
}

export function getCaseFactProvenance(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;
  return projection.provenance || readFactSources(caseId) || {};
}

export function listFilesystemCaseIds() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(caseId => CASE_ID_RE.test(caseId))
    .filter(caseId => {
      try {
        return fs.statSync(path.join(CASES_DIR, caseId)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function checkCanonicalCaseIntegrity(caseId) {
  const fsRaw = loadRawCaseFromFilesystem(caseId);
  const dbRaw = loadRawCaseFromDb(caseId);

  if (!fsRaw && !dbRaw) {
    return {
      caseId,
      ok: false,
      reason: 'case_missing_in_filesystem_and_canonical',
      hasFilesystemCase: false,
      hasCanonicalCase: false,
      expectedDigest: null,
      actualDigest: null,
    };
  }

  if (!fsRaw) {
    return {
      caseId,
      ok: false,
      reason: 'filesystem_case_missing',
      hasFilesystemCase: false,
      hasCanonicalCase: true,
      expectedDigest: null,
      actualDigest: buildCaseDigest(dbRaw),
    };
  }

  if (!dbRaw) {
    return {
      caseId,
      ok: false,
      reason: 'canonical_record_missing',
      hasFilesystemCase: true,
      hasCanonicalCase: false,
      expectedDigest: buildCaseDigest(fsRaw),
      actualDigest: null,
    };
  }

  const expectedDigest = buildCaseDigest(fsRaw);
  const actualDigest = buildCaseDigest(dbRaw);
  const ok = expectedDigest === actualDigest;

  return {
    caseId,
    ok,
    reason: ok ? 'matched' : 'digest_mismatch',
    hasFilesystemCase: true,
    hasCanonicalCase: true,
    expectedDigest,
    actualDigest,
  };
}

export function runCanonicalBackfill({
  caseIds = null,
  verifyAfterWrite = true,
  limit = null,
} = {}) {
  const inputCaseIds = Array.isArray(caseIds) && caseIds.length
    ? caseIds
      .map(v => String(v || '').trim())
      .filter(v => CASE_ID_RE.test(v))
    : listFilesystemCaseIds();

  const deduped = Array.from(new Set(inputCaseIds));
  const selected = Number.isInteger(limit) && limit > 0
    ? deduped.slice(0, limit)
    : deduped;

  const summary = {
    ok: true,
    totalDiscovered: deduped.length,
    totalProcessed: selected.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (const caseId of selected) {
    const fsRaw = loadRawCaseFromFilesystem(caseId);
    if (!fsRaw) {
      summary.skipped += 1;
      summary.results.push({
        caseId,
        status: 'skipped',
        reason: 'filesystem_case_missing',
      });
      continue;
    }

    const sourceDigest = buildCaseDigest(fsRaw);
    const existingCanonical = loadRawCaseFromDb(caseId);
    const existingDigest = existingCanonical ? buildCaseDigest(existingCanonical) : null;

    let status = 'unchanged';
    let reason = 'already_synced';

    if (!existingCanonical) {
      persistRawCase(fsRaw, { writeLegacyFiles: false });
      summary.inserted += 1;
      status = 'inserted';
      reason = 'created_canonical_record';
    } else if (existingDigest !== sourceDigest) {
      persistRawCase(fsRaw, { writeLegacyFiles: false });
      summary.updated += 1;
      status = 'updated';
      reason = 'refreshed_from_filesystem';
    } else {
      summary.unchanged += 1;
    }

    let integrity = null;
    if (verifyAfterWrite) {
      integrity = checkCanonicalCaseIntegrity(caseId);
      if (!integrity.ok) {
        summary.failed += 1;
        summary.ok = false;

        if (status === 'inserted') summary.inserted -= 1;
        if (status === 'updated') summary.updated -= 1;
        if (status === 'unchanged') summary.unchanged -= 1;

        status = 'failed';
        reason = integrity.reason;
      }
    }

    summary.results.push({
      caseId,
      status,
      reason,
      sourceDigest,
      canonicalDigest: integrity?.actualDigest || sourceDigest,
      integrityOk: integrity ? integrity.ok : null,
    });
  }

  return summary;
}

export function getCanonicalBackfillStatus({
  includeIntegrity = false,
  integrityLimit = null,
} = {}) {
  const filesystemCaseIds = listFilesystemCaseIds();
  const canonicalCaseIds = new Set(listCaseAggregates(100000).map(item => item.caseId));
  const missingCanonicalCaseIds = filesystemCaseIds.filter(caseId => !canonicalCaseIds.has(caseId));

  const status = {
    filesystemCaseCount: filesystemCaseIds.length,
    canonicalCaseCount: canonicalCaseIds.size,
    missingCanonicalCount: missingCanonicalCaseIds.length,
    syncedCaseCount: filesystemCaseIds.length - missingCanonicalCaseIds.length,
    missingCanonicalCaseIds,
  };

  if (includeIntegrity) {
    const scopedCaseIds = Number.isInteger(integrityLimit) && integrityLimit > 0
      ? filesystemCaseIds.slice(0, integrityLimit)
      : filesystemCaseIds;

    const mismatchedCases = [];
    for (const caseId of scopedCaseIds) {
      const integrity = checkCanonicalCaseIntegrity(caseId);
      if (!integrity.ok) mismatchedCases.push(integrity);
    }

    status.integrityCheckedCount = scopedCaseIds.length;
    status.integrityMismatchCount = mismatchedCases.length;
    status.integrityMismatches = mismatchedCases;
  }

  return status;
}
