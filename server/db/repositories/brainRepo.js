/**
 * server/db/repositories/brainRepo.js
 * ----------------------------------------
 * Phase 1.5 — Proprietary AI Engine & Knowledge Brain
 *
 * Centralized repository for all brain-related SQLite operations:
 *   - model_registry CRUD (model version tracking, promotion, rollback)
 *   - graph_nodes / graph_edges CRUD (knowledge graph persistence)
 *   - brain_chat_history (AI chat persistence per case)
 *   - ai_cost_log (GPU cost tracking per user)
 *
 * All functions are synchronous (better-sqlite3).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, dbAll, dbGet, dbRun } from '../database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function now() {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register a new model version.
 * @param {Object} model — model metadata
 * @returns {string} model ID
 */
export function registerModel(model) {
  const id = model.id || 'model_' + uuidv4().slice(0, 12);
  dbRun(
    `INSERT INTO model_registry (id, model_name, version, base_model, status,
       training_data_hash, training_samples, hyperparams_json, eval_scores_json,
       deployed_endpoint, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      model.modelName || 'cacc-appraiser',
      model.version || 'v1',
      model.baseModel || 'meta-llama/Llama-3.1-8B',
      model.status || 'training',
      model.trainingDataHash || null,
      model.trainingSamples || 0,
      toJSON(model.hyperparams),
      toJSON(model.evalScores),
      model.deployedEndpoint || null,
      model.notes || '',
      now(),
      now()
    ]
  );
  return id;
}

/**
 * Get the currently active model (most recently deployed).
 * @returns {Object|null}
 */
export function getActiveModel() {
  const row = dbGet(
    `SELECT * FROM model_registry WHERE status = 'active' ORDER BY deployed_at DESC LIMIT 1`
  );
  if (!row) return null;
  return {
    ...row,
    hyperparams: parseJSON(row.hyperparams_json),
    evalScores: parseJSON(row.eval_scores_json)
  };
}

/**
 * Get a model by ID.
 */
export function getModel(id) {
  const row = dbGet(`SELECT * FROM model_registry WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    ...row,
    hyperparams: parseJSON(row.hyperparams_json),
    evalScores: parseJSON(row.eval_scores_json)
  };
}

/**
 * List all model versions for a given model name, newest first.
 */
export function listModels(modelName = 'cacc-appraiser', limit = 50) {
  return dbAll(
    `SELECT * FROM model_registry WHERE model_name = ? ORDER BY created_at DESC LIMIT ?`,
    [modelName, limit]
  ).map(row => ({
    ...row,
    hyperparams: parseJSON(row.hyperparams_json),
    evalScores: parseJSON(row.eval_scores_json)
  }));
}

/**
 * Promote a model to active — retires the current active model first.
 */
export function promoteModel(id, endpoint) {
  // Retire current active
  dbRun(
    `UPDATE model_registry SET status = 'retired', retired_at = ?, updated_at = ?
     WHERE status = 'active'`,
    [now(), now()]
  );
  // Promote new
  dbRun(
    `UPDATE model_registry SET status = 'active', deployed_endpoint = ?,
       deployed_at = ?, updated_at = ?
     WHERE id = ?`,
    [endpoint, now(), now(), id]
  );
}

/**
 * Update model eval scores (after evaluation run).
 */
export function updateModelEvalScores(id, evalScores) {
  dbRun(
    `UPDATE model_registry SET eval_scores_json = ?, status = 'evaluating', updated_at = ?
     WHERE id = ?`,
    [toJSON(evalScores), now(), id]
  );
}

/**
 * Rollback — retire current active and re-activate a previous version.
 */
export function rollbackToModel(id) {
  dbRun(
    `UPDATE model_registry SET status = 'retired', retired_at = ?, updated_at = ?
     WHERE status = 'active'`,
    [now(), now()]
  );
  dbRun(
    `UPDATE model_registry SET status = 'active', retired_at = NULL, updated_at = ?
     WHERE id = ?`,
    [now(), id]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — NODES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create or update a graph node.
 */
export function upsertGraphNode(node) {
  const id = node.id || 'gn_' + uuidv4().slice(0, 12);
  dbRun(
    `INSERT INTO graph_nodes (id, user_id, node_type, label, properties_json, embedding_json, weight, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       properties_json = excluded.properties_json,
       embedding_json = excluded.embedding_json,
       weight = excluded.weight,
       updated_at = excluded.updated_at`,
    [
      id,
      node.userId || null,
      node.nodeType || 'concept',
      node.label || '',
      toJSON(node.properties),
      node.embedding ? toJSON(node.embedding) : null,
      node.weight ?? 1.0,
      now(),
      now()
    ]
  );
  return id;
}

/**
 * Get all nodes for a user (or shared nodes where user_id is NULL).
 */
export function getGraphNodes(userId, { nodeType, limit = 1000 } = {}) {
  let sql = `SELECT * FROM graph_nodes WHERE (user_id = ? OR user_id IS NULL)`;
  const params = [userId];
  if (nodeType) {
    sql += ` AND node_type = ?`;
    params.push(nodeType);
  }
  sql += ` ORDER BY weight DESC, updated_at DESC LIMIT ?`;
  params.push(limit);

  return dbAll(sql, params).map(row => ({
    ...row,
    properties: parseJSON(row.properties_json),
    embedding: row.embedding_json ? parseJSON(row.embedding_json, []) : null
  }));
}

/**
 * Delete a graph node (cascades to edges via FK).
 */
export function deleteGraphNode(id) {
  dbRun(`DELETE FROM graph_nodes WHERE id = ?`, [id]);
}

// ══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — EDGES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a graph edge.
 */
export function createGraphEdge(edge) {
  const id = edge.id || 'ge_' + uuidv4().slice(0, 12);
  dbRun(
    `INSERT INTO graph_edges (id, user_id, source_id, target_id, edge_type, weight, properties_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      edge.userId || null,
      edge.sourceId,
      edge.targetId,
      edge.edgeType || 'related_to',
      edge.weight ?? 1.0,
      toJSON(edge.properties),
      now()
    ]
  );
  return id;
}

/**
 * Get all edges for a user's graph (including shared edges).
 */
export function getGraphEdges(userId, { edgeType, limit = 5000 } = {}) {
  let sql = `SELECT * FROM graph_edges WHERE (user_id = ? OR user_id IS NULL)`;
  const params = [userId];
  if (edgeType) {
    sql += ` AND edge_type = ?`;
    params.push(edgeType);
  }
  sql += ` ORDER BY weight DESC LIMIT ?`;
  params.push(limit);

  return dbAll(sql, params).map(row => ({
    ...row,
    properties: parseJSON(row.properties_json)
  }));
}

/**
 * Get the full graph (nodes + edges) for a user — ready for D3.js rendering.
 */
export function getFullGraph(userId, { limit = 500 } = {}) {
  const nodes = getGraphNodes(userId, { limit });
  const edges = getGraphEdges(userId, { limit: limit * 3 });
  return { nodes, edges };
}

/**
 * Delete a graph edge.
 */
export function deleteGraphEdge(id) {
  dbRun(`DELETE FROM graph_edges WHERE id = ?`, [id]);
}

// ══════════════════════════════════════════════════════════════════════════════
// BRAIN CHAT HISTORY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Save a chat message.
 */
export function saveChatMessage({ userId, caseId, role, content, modelId, tokensUsed }) {
  const id = 'chat_' + uuidv4().slice(0, 12);
  dbRun(
    `INSERT INTO brain_chat_history (id, user_id, case_id, role, content, model_id, tokens_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, caseId || null, role, content, modelId || null, tokensUsed || 0, now()]
  );
  return id;
}

/**
 * Get chat history for a case (or general chat if no caseId).
 */
export function getChatHistory(userId, caseId = null, limit = 100) {
  if (caseId) {
    return dbAll(
      `SELECT * FROM brain_chat_history WHERE user_id = ? AND case_id = ?
       ORDER BY created_at ASC LIMIT ?`,
      [userId, caseId, limit]
    );
  }
  return dbAll(
    `SELECT * FROM brain_chat_history WHERE user_id = ? AND case_id IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    [userId, limit]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AI COST LOG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Log an AI compute cost event.
 */
export function logAiCost({ userId, caseId, modelId, provider, operation,
                            inputTokens, outputTokens, gpuSeconds, estimatedCost, metadata }) {
  const id = 'cost_' + uuidv4().slice(0, 12);
  dbRun(
    `INSERT INTO ai_cost_log (id, user_id, case_id, model_id, provider, operation,
       input_tokens, output_tokens, gpu_seconds, estimated_cost, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, caseId || null, modelId || null,
      provider || 'runpod', operation || 'generate',
      inputTokens || 0, outputTokens || 0,
      gpuSeconds || 0, estimatedCost || 0,
      toJSON(metadata), now()
    ]
  );
  return id;
}

/**
 * Get total AI cost for a user in a date range.
 */
export function getUserCostSummary(userId, since = null) {
  const sinceDate = since || new Date(Date.now() - 30 * 86400000).toISOString();
  return dbGet(
    `SELECT
       COUNT(*) as total_requests,
       SUM(input_tokens) as total_input_tokens,
       SUM(output_tokens) as total_output_tokens,
       SUM(gpu_seconds) as total_gpu_seconds,
       SUM(estimated_cost) as total_estimated_cost
     FROM ai_cost_log
     WHERE user_id = ? AND created_at >= ?`,
    [userId, sinceDate]
  );
}

/**
 * Get cost breakdown by provider for a user.
 */
export function getUserCostByProvider(userId, since = null) {
  const sinceDate = since || new Date(Date.now() - 30 * 86400000).toISOString();
  return dbAll(
    `SELECT
       provider,
       COUNT(*) as requests,
       SUM(estimated_cost) as total_cost,
       SUM(input_tokens + output_tokens) as total_tokens
     FROM ai_cost_log
     WHERE user_id = ? AND created_at >= ?
     GROUP BY provider
     ORDER BY total_cost DESC`,
    [userId, sinceDate]
  );
}
