/**
 * server/factIntegrity/factDecisionQueue.js
 * ------------------------------------------
 * Phase C: unresolved fact decision queue + deterministic conflict resolution.
 */

import { getDb } from '../db/database.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { detectFactConflicts } from './factConflictEngine.js';
import { evaluatePreDraftGate } from './preDraftGate.js';

const NUMERIC_PATH_HINTS = /(price|value|gla|size|lot|dom|bed|bath|year|rate|income|expense|noi|count|area|sf)/i;
const DATE_PATH_HINTS = /(date|effectiveDate|saleDate|closingDate|contractDate|dueDate)/i;
const ADDRESS_PATH_HINTS = /(address)/i;

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDate(value) {
  const text = asText(value);
  if (!text) return '';
  const ts = Date.parse(text);
  if (!Number.isNaN(ts)) return new Date(ts).toISOString().slice(0, 10);
  return text.toLowerCase();
}

function normalizeNumeric(value) {
  const text = asText(value);
  if (!text) return '';
  const raw = text.replace(/[^0-9.\-]/g, '');
  if (!raw) return text.toLowerCase();
  const num = Number(raw);
  if (Number.isNaN(num)) return text.toLowerCase();
  return String(num);
}

function normalizeAddress(value) {
  return asText(value).toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ');
}

function normalizeValueForPath(factPath, value) {
  const path = asText(factPath);
  const text = asText(value);
  if (!path || !text) return '';
  if (DATE_PATH_HINTS.test(path)) return normalizeDate(text);
  if (NUMERIC_PATH_HINTS.test(path)) return normalizeNumeric(text);
  if (ADDRESS_PATH_HINTS.test(path)) return normalizeAddress(text);
  return text.toLowerCase();
}

function setPathValue(target, factPath, valueObj) {
  const parts = asText(factPath).split('.').filter(Boolean);
  if (!parts.length) return;

  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  node[parts[parts.length - 1]] = valueObj;
}

function groupPendingFactsByPath(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const factPath = asText(row.fact_path);
    if (!factPath) continue;
    if (!groups.has(factPath)) groups.set(factPath, []);
    groups.get(factPath).push({
      factId: row.id,
      value: row.fact_value,
      confidence: row.confidence,
      documentId: row.document_id,
      sourceText: row.source_text || '',
      createdAt: row.created_at,
    });
  }
  return [...groups.entries()].map(([factPath, candidates]) => ({
    factPath,
    pendingCount: candidates.length,
    candidates,
  }));
}

export function buildFactDecisionQueue(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const conflictReport = detectFactConflicts(caseId) || {
    summary: { totalConflicts: 0, blockerCount: 0, highCount: 0, mediumCount: 0 },
    conflicts: [],
  };
  const gate = evaluatePreDraftGate({ caseId }) || { blockers: [], warnings: [], summary: {} };

  const pendingFacts = getDb().prepare(`
    SELECT id, fact_path, fact_value, confidence, document_id, source_text, created_at
      FROM extracted_facts
     WHERE case_id = ? AND review_status = 'pending'
     ORDER BY created_at ASC
  `).all(caseId);

  const pendingByPath = groupPendingFactsByPath(pendingFacts);

  const queueItems = conflictReport.conflicts.map(conflict => ({
    factPath: conflict.factPath,
    severity: conflict.severity,
    hasCanonicalValue: Boolean(conflict.hasCanonicalValue),
    hasPendingReview: Boolean(conflict.hasPendingReview),
    candidateValues: conflict.values.map(value => ({
      normalizedValue: value.normalizedValue,
      displayValue: value.displayValue,
      maxConfidence: value.maxConfidence,
      sourceCount: value.sourceCount,
      sources: value.sources.map(source => ({
        factId: source.factId || null,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        docType: source.docType,
        filename: source.filename,
        confidence: source.confidence,
        reviewStatus: source.reviewStatus,
        value: source.value,
      })),
    })),
  }));

  const blockerTypes = Array.isArray(gate.blockers)
    ? gate.blockers.map(b => b.type).filter(Boolean)
    : [];

  return {
    caseId,
    queuedAt: new Date().toISOString(),
    summary: {
      conflictCount: queueItems.length,
      blockerConflictCount: queueItems.filter(item => item.severity === 'blocker').length,
      pendingFactCount: pendingFacts.length,
      pendingPathsCount: pendingByPath.length,
      preDraftBlocked: gate.ok === false,
      preDraftBlockerTypes: blockerTypes,
    },
    conflicts: queueItems,
    pendingFactGroups: pendingByPath,
    gateSummary: gate.summary || {},
  };
}

export function resolveFactDecision({
  caseId,
  factPath,
  selectedValue,
  sourceType = 'manual',
  sourceId = null,
  selectedFactId = null,
  rejectOtherPending = true,
  note = '',
}) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const safePath = asText(factPath);
  const safeValue = asText(selectedValue);
  if (!safePath || !safeValue) {
    throw new Error('factPath and selectedValue are required.');
  }

  const safeSourceType = asText(sourceType).toLowerCase() || 'manual';
  const safeSourceId = asText(sourceId) || null;
  const safeFactId = asText(selectedFactId) || null;
  const safeNote = asText(note);

  const facts = { ...(projection.facts || {}) };
  const provenance = { ...(projection.provenance || {}) };

  setPathValue(facts, safePath, {
    value: safeValue,
    confidence: safeSourceType === 'manual' ? 'medium' : 'high',
    source: `${safeSourceType}:${safeSourceId || (safeFactId || 'manual')}`,
  });

  provenance[safePath] = {
    sourceType: safeSourceType,
    sourceId: safeSourceId || safeFactId || 'manual',
    confidence: safeSourceType === 'manual' ? 'medium' : 'high',
    quote: safeNote || '',
    updatedAt: new Date().toISOString(),
  };

  const updated = saveCaseProjection({
    caseId,
    meta: {
      ...(projection.meta || {}),
      updatedAt: new Date().toISOString(),
    },
    facts,
    provenance,
    outputs: projection.outputs || {},
    history: projection.history || {},
    docText: projection.docText || {},
  }, { writeLegacyFiles: true });

  const db = getDb();
  const normalizedSelected = normalizeValueForPath(safePath, safeValue);

  const pendingRows = db.prepare(`
    SELECT id, fact_value
      FROM extracted_facts
     WHERE case_id = ? AND fact_path = ? AND review_status = 'pending'
  `).all(caseId, safePath);

  const selectedMergedIds = [];
  const rejectedIds = [];

  for (const row of pendingRows) {
    const rowId = asText(row.id);
    const rowNorm = normalizeValueForPath(safePath, row.fact_value);

    const selectedById = safeFactId && rowId === safeFactId;
    const selectedByValue = !safeFactId && rowNorm && rowNorm === normalizedSelected;
    const shouldSelect = safeSourceType === 'extracted' && (selectedById || selectedByValue);

    if (shouldSelect) {
      db.prepare(`
        UPDATE extracted_facts
           SET review_status = 'merged', merged_at = datetime('now')
         WHERE id = ?
      `).run(rowId);
      selectedMergedIds.push(rowId);
      continue;
    }

    if (rejectOtherPending) {
      db.prepare(`
        UPDATE extracted_facts
           SET review_status = 'rejected'
         WHERE id = ?
      `).run(rowId);
      rejectedIds.push(rowId);
    }
  }

  const queue = buildFactDecisionQueue(caseId);

  return {
    caseId,
    factPath: safePath,
    selectedValue: safeValue,
    sourceType: safeSourceType,
    sourceId: safeSourceId,
    selectedFactId: safeFactId,
    mergedFactIds: selectedMergedIds,
    rejectedFactIds: rejectedIds,
    queueSummary: queue?.summary || null,
    caseProjection: {
      meta: updated?.meta || projection.meta || {},
      facts: updated?.facts || facts,
      provenance: updated?.provenance || provenance,
    },
  };
}

