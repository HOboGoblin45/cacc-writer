/**
 * server/workspace/workspaceService.js
 * -----------------------------------
 * Phase D0 workspace helpers:
 * - form definition lookup
 * - case record workspace projection
 * - autosave patch application
 * - field-level version history
 */

import { get1004WorkspaceDefinition } from './1004WorkspaceDefinition.js';

const WORKSPACE_HISTORY_LIMIT = 10;

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function splitPath(path) {
  return String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getWorkspaceDefinition(formType) {
  const normalized = String(formType || '').trim().toLowerCase();
  if (normalized === '1004') return get1004WorkspaceDefinition();
  return null;
}

export function getNestedValue(target, path) {
  const parts = Array.isArray(path) ? path : splitPath(path);
  let node = target;
  for (const part of parts) {
    if (!node || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

export function setNestedValue(target, path, value) {
  const parts = Array.isArray(path) ? path : splitPath(path);
  if (!parts.length) return target;
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) {
      node[part] = {};
    }
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
  return target;
}

function normalizeScalar(value) {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return value === null ? null : cloneValue(value);
}

function normalizeFieldValue(field, value) {
  if (field.inputType === 'grid') {
    if (!Array.isArray(value)) return cloneValue(field.defaultValue || []);
    return value.map((row) => {
      const safeRow = {};
      for (const column of field.columns || []) {
        const next = row && typeof row === 'object' ? row[column.key] : null;
        safeRow[column.key] = next == null ? '' : String(next);
      }
      return safeRow;
    });
  }

  return normalizeScalar(value);
}

function getLeafValue(facts, path) {
  const leaf = getNestedValue(facts, path);
  if (!leaf || typeof leaf !== 'object' || Array.isArray(leaf) || !Object.prototype.hasOwnProperty.call(leaf, 'value')) {
    return undefined;
  }
  return leaf;
}

function fieldEvidencePaths(field) {
  return [...new Set([
    field.suggestionPath,
    ...(Array.isArray(field.syncPaths) ? field.syncPaths : []),
  ].filter(Boolean))];
}

function reviewStatusRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'merged') return 4;
  if (normalized === 'accepted') return 3;
  if (normalized === 'pending') return 2;
  if (normalized === 'rejected') return 1;
  return 0;
}

function confidenceRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
}

function normalizeEvidenceCandidate(raw, factPath) {
  if (!raw || typeof raw !== 'object') return null;
  const factId = raw.id || raw.factId || null;
  const candidate = {
    factId: factId ? String(factId) : null,
    factPath: String(factPath || raw.fact_path || raw.factPath || '').trim(),
    value: raw.fact_value ?? raw.value ?? null,
    confidence: raw.confidence ? String(raw.confidence).trim().toLowerCase() : null,
    reviewStatus: raw.review_status || raw.reviewStatus || 'pending',
    documentId: raw.document_id || raw.documentId || null,
    docType: raw.doc_type || raw.docType || null,
    filename: raw.original_filename || raw.filename || null,
    sourceText: raw.source_text || raw.sourceText || '',
    createdAt: raw.created_at || raw.createdAt || null,
  };

  if (!candidate.factPath || candidate.value == null || candidate.value === '') return null;
  return candidate;
}

function sortEvidenceCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    const reviewDelta = reviewStatusRank(right.reviewStatus) - reviewStatusRank(left.reviewStatus);
    if (reviewDelta !== 0) return reviewDelta;

    const confidenceDelta = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;

    const createdAtDelta = Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0);
    if (!Number.isNaN(createdAtDelta) && createdAtDelta !== 0) return createdAtDelta;

    return String(left.factPath || '').localeCompare(String(right.factPath || ''));
  });
}

function buildExtractedFactIndex(extractedFacts = []) {
  const index = new Map();
  for (const raw of extractedFacts) {
    const factPath = String(raw?.fact_path || raw?.factPath || '').trim();
    if (!factPath) continue;
    const candidate = normalizeEvidenceCandidate(raw, factPath);
    if (!candidate) continue;
    if (!index.has(factPath)) index.set(factPath, []);
    index.get(factPath).push(candidate);
  }

  for (const [factPath, candidates] of index.entries()) {
    index.set(factPath, sortEvidenceCandidates(candidates));
  }

  return index;
}

function buildConflictIndex(conflictReport = {}) {
  const index = new Map();
  for (const conflict of conflictReport?.conflicts || []) {
    const factPath = String(conflict?.factPath || '').trim();
    if (!factPath) continue;
    index.set(factPath, cloneValue(conflict));
  }
  return index;
}

function buildPendingGroupIndex(decisionQueue = {}) {
  const index = new Map();
  for (const group of decisionQueue?.pendingFactGroups || []) {
    const factPath = String(group?.factPath || '').trim();
    if (!factPath) continue;
    index.set(factPath, cloneValue(group));
  }
  return index;
}

function buildSuggestion(field, facts, provenance, evidenceCandidates = []) {
  if (!field.suggestionPath && !evidenceCandidates.length) return null;

  if (field.suggestionPath) {
  const leaf = getLeafValue(facts, field.suggestionPath);
    if (leaf && leaf.value != null && leaf.value !== '') {
      return {
        value: cloneValue(leaf.value),
        confidence: leaf.confidence || null,
        source: leaf.source || null,
        provenance: cloneValue(provenance?.[field.suggestionPath] || null),
        origin: 'canonical',
        factPath: field.suggestionPath,
        factId: null,
      };
    }
  }

  const topCandidate = sortEvidenceCandidates(evidenceCandidates)[0] || null;
  if (!topCandidate) return null;

  return {
    value: cloneValue(topCandidate.value),
    confidence: topCandidate.confidence || null,
    source: topCandidate.filename || topCandidate.docType || 'extracted evidence',
    provenance: {
      sourceType: 'extracted',
      sourceId: topCandidate.documentId || topCandidate.factId || null,
      docType: topCandidate.docType || null,
      quote: topCandidate.sourceText || '',
      confidence: topCandidate.confidence || null,
      reviewStatus: topCandidate.reviewStatus || null,
      factPath: topCandidate.factPath || null,
      factId: topCandidate.factId || null,
    },
    origin: 'extracted',
    factPath: topCandidate.factPath || null,
    factId: topCandidate.factId || null,
  };
}

function buildEntry(field, facts = {}, provenance = {}, history = {}, extractedFactIndex = new Map(), conflictIndex = new Map(), pendingGroupIndex = new Map()) {
  const manualLeaf = getLeafValue(facts, field.workspacePath);
  const evidencePaths = fieldEvidencePaths(field);
  const candidates = sortEvidenceCandidates(
    evidencePaths.flatMap((factPath) => extractedFactIndex.get(factPath) || [])
  );
  const suggestion = buildSuggestion(field, facts, provenance, candidates);
  const value = manualLeaf?.value !== undefined
    ? cloneValue(manualLeaf.value)
    : suggestion?.value !== undefined
      ? cloneValue(suggestion.value)
      : cloneValue(field.defaultValue ?? null);

  const versions = cloneValue(getNestedValue(history, ['workspace', field.fieldId]) || []);
  const conflicts = evidencePaths
    .map((factPath) => conflictIndex.get(factPath))
    .filter(Boolean)
    .map((conflict) => cloneValue(conflict));
  const pendingGroups = evidencePaths
    .map((factPath) => pendingGroupIndex.get(factPath))
    .filter(Boolean)
    .map((group) => cloneValue(group));

  return {
    fieldId: field.fieldId,
    sectionId: field.sectionId,
    workspacePath: field.workspacePath,
    value,
    manualValue: manualLeaf?.value !== undefined ? cloneValue(manualLeaf.value) : null,
    suggestion,
    history: Array.isArray(versions) ? versions : [],
    updatedAt: manualLeaf?.updatedAt || null,
    source: manualLeaf?.source || null,
    evidencePaths,
    candidates,
    conflicts,
    pendingGroups,
    pendingReviewCount: candidates.filter((candidate) => candidate.reviewStatus === 'pending').length,
    acceptedCandidateCount: candidates.filter((candidate) => candidate.reviewStatus === 'accepted').length,
    hasConflict: conflicts.length > 0,
  };
}

export function buildWorkspacePayload({
  formType,
  facts = {},
  provenance = {},
  history = {},
  meta = {},
  qc = {},
  extractedFacts = [],
  conflictReport = {},
  decisionQueue = {},
}) {
  const definition = getWorkspaceDefinition(formType);
  if (!definition) return null;

  const extractedFactIndex = buildExtractedFactIndex(extractedFacts);
  const conflictIndex = buildConflictIndex(conflictReport);
  const pendingGroupIndex = buildPendingGroupIndex(decisionQueue);
  const entries = {};
  for (const [fieldId, field] of Object.entries(definition.fieldIndex)) {
    entries[fieldId] = buildEntry(field, facts, provenance, history, extractedFactIndex, conflictIndex, pendingGroupIndex);
  }

  return {
    definition,
    entries,
    meta: {
      updatedAt: meta.updatedAt || null,
      workflowStatus: meta.workflowStatus || null,
      pipelineStage: meta.pipelineStage || null,
      unresolvedIssues: Array.isArray(meta.unresolvedIssues) ? meta.unresolvedIssues : [],
    },
    qc: {
      ...(qc || {}),
      factReviewQueueSummary: decisionQueue?.summary || qc?.factReviewQueueSummary || null,
    },
  };
}

function makeFactLeaf(value, source, updatedAt) {
  return {
    value: cloneValue(value),
    confidence: source === 'appraiser' ? 'high' : 'medium',
    source,
    updatedAt,
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sanitizeProvenanceEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = {
    sourceType: raw.sourceType ? String(raw.sourceType).trim().slice(0, 60) : undefined,
    sourceId: raw.sourceId ? String(raw.sourceId).trim().slice(0, 180) : undefined,
    docType: raw.docType ? String(raw.docType).trim().slice(0, 100) : undefined,
    page: raw.page ? String(raw.page).trim().slice(0, 40) : undefined,
    confidence: raw.confidence ? String(raw.confidence).trim().slice(0, 20) : undefined,
    quote: raw.quote ? String(raw.quote).trim().slice(0, 2000) : undefined,
    note: raw.note ? String(raw.note).trim().slice(0, 600) : undefined,
  };

  const keys = Object.keys(entry).filter((key) => entry[key]);
  if (!keys.length) return null;
  return entry;
}

export function applyWorkspacePatch({
  definition,
  projection,
  changes = [],
  actor = 'appraiser',
}) {
  if (!definition) throw new Error('Workspace definition is required');
  if (!projection) throw new Error('Case projection is required');

  const now = new Date().toISOString();
  const facts = cloneValue(projection.facts || {});
  const provenance = cloneValue(projection.provenance || {});
  const history = cloneValue(projection.history || {});
  if (!history.workspace || typeof history.workspace !== 'object' || Array.isArray(history.workspace)) {
    history.workspace = {};
  }

  const saved = [];

  for (const change of changes) {
    const field = definition.fieldIndex[change.fieldId];
    if (!field) throw new Error(`Unknown workspace field: ${change.fieldId}`);

    const nextValue = normalizeFieldValue(field, change.value);
    const currentEntry = buildEntry(field, facts, provenance, history);
    const previousValue = currentEntry.manualValue !== null ? currentEntry.manualValue : currentEntry.value;

    if (valuesEqual(previousValue, nextValue)) {
      saved.push(buildEntry(field, facts, provenance, history));
      continue;
    }

    const historyBucket = Array.isArray(history.workspace[field.fieldId])
      ? history.workspace[field.fieldId]
      : [];

    if (previousValue !== null && previousValue !== undefined && previousValue !== '') {
      historyBucket.unshift({
        value: cloneValue(previousValue),
        savedAt: now,
        actor,
        source: currentEntry.source || (currentEntry.suggestion ? 'suggested' : 'workspace'),
      });
      history.workspace[field.fieldId] = historyBucket.slice(0, WORKSPACE_HISTORY_LIMIT);
    } else {
      history.workspace[field.fieldId] = historyBucket.slice(0, WORKSPACE_HISTORY_LIMIT);
    }

    setNestedValue(facts, field.workspacePath, makeFactLeaf(nextValue, actor, now));
    for (const syncPath of field.syncPaths || []) {
      setNestedValue(facts, syncPath, makeFactLeaf(nextValue, actor, now));
    }

    const provenanceEntry = sanitizeProvenanceEntry(change.provenance);
    if (provenanceEntry) {
      provenanceEntry.updatedAt = now;
      provenance[field.workspacePath] = provenanceEntry;
      for (const syncPath of field.syncPaths || []) {
        provenance[syncPath] = cloneValue(provenanceEntry);
      }
    }

    saved.push(buildEntry(field, facts, provenance, history));
  }

  const nextMeta = {
    ...(projection.meta || {}),
    updatedAt: now,
  };

  return {
    caseId: projection.caseId,
    meta: nextMeta,
    facts,
    provenance,
    history,
    saved,
    savedAt: now,
  };
}
