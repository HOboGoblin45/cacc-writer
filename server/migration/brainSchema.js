/**
 * server/migration/brainSchema.js
 * --------------------------------
 * Phase 1.5 — Proprietary AI Engine & Knowledge Brain
 *
 * Tables:
 *   model_registry     — tracks fine-tuned model versions, eval scores, deployment state
 *   graph_nodes        — persisted knowledge graph nodes (survive pod restarts)
 *   graph_edges        — persisted knowledge graph edges with weights and metadata
 *   brain_chat_history — AI chat conversations per case
 *   ai_cost_log        — GPU cost tracking per user/case for billing
 */

import log from '../logger.js';

export function initBrainSchema(db) {
  db.exec(`
    -- ── Model Registry ──────────────────────────────────────────────────
    -- Tracks every fine-tuned model version with training metadata,
    -- evaluation scores, and deployment status. Enables rollback.
    CREATE TABLE IF NOT EXISTS model_registry (
      id                TEXT PRIMARY KEY,
      model_name        TEXT NOT NULL,
      version           TEXT NOT NULL,
      base_model        TEXT NOT NULL DEFAULT 'meta-llama/Llama-3.1-8B',
      status            TEXT NOT NULL DEFAULT 'training'
                          CHECK (status IN ('training', 'evaluating', 'staged', 'active', 'retired', 'failed')),
      training_data_hash TEXT,
      training_samples  INTEGER DEFAULT 0,
      hyperparams_json  TEXT NOT NULL DEFAULT '{}',
      eval_scores_json  TEXT NOT NULL DEFAULT '{}',
      deployed_endpoint TEXT,
      deployed_at       TEXT,
      retired_at        TEXT,
      notes             TEXT DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(model_name, version)
    );
    CREATE INDEX IF NOT EXISTS idx_model_registry_status
      ON model_registry(status);
    CREATE INDEX IF NOT EXISTS idx_model_registry_name_version
      ON model_registry(model_name, version);

    -- ── Knowledge Graph Nodes ───────────────────────────────────────────
    -- Persisted nodes from the NetworkX knowledge graph.
    -- Types: case, property, comp, market_area, pattern, concept, appraiser
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT,
      node_type       TEXT NOT NULL
                        CHECK (node_type IN ('case', 'property', 'comp', 'market_area',
                               'pattern', 'concept', 'appraiser', 'adjustment', 'section')),
      label           TEXT NOT NULL,
      properties_json TEXT NOT NULL DEFAULT '{}',
      embedding_json  TEXT,
      weight          REAL NOT NULL DEFAULT 1.0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_user
      ON graph_nodes(user_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_type
      ON graph_nodes(node_type);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_user_type
      ON graph_nodes(user_id, node_type);

    -- ── Knowledge Graph Edges ───────────────────────────────────────────
    -- Persisted edges connecting graph nodes with typed relationships.
    CREATE TABLE IF NOT EXISTS graph_edges (
      id              TEXT PRIMARY KEY,
      user_id         TEXT,
      source_id       TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      target_id       TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      edge_type       TEXT NOT NULL
                        CHECK (edge_type IN ('related_to', 'comparable_to', 'located_in',
                               'derived_from', 'adjusted_by', 'generated_for',
                               'similar_pattern', 'market_trend', 'appraised_by')),
      weight          REAL NOT NULL DEFAULT 1.0,
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source
      ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target
      ON graph_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_user
      ON graph_edges(user_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_type
      ON graph_edges(edge_type);

    -- ── Brain Chat History ──────────────────────────────────────────────
    -- Persists AI chat conversations so users can resume across sessions.
    CREATE TABLE IF NOT EXISTS brain_chat_history (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      case_id     TEXT,
      role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content     TEXT NOT NULL,
      model_id    TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_brain_chat_user_case
      ON brain_chat_history(user_id, case_id);
    CREATE INDEX IF NOT EXISTS idx_brain_chat_created
      ON brain_chat_history(created_at);

    -- ── AI Cost Log ─────────────────────────────────────────────────────
    -- Tracks GPU compute cost per request for billing and monitoring.
    CREATE TABLE IF NOT EXISTS ai_cost_log (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      case_id         TEXT,
      model_id        TEXT,
      provider        TEXT NOT NULL DEFAULT 'runpod'
                        CHECK (provider IN ('runpod', 'openai', 'gemini', 'anthropic', 'ollama')),
      operation       TEXT NOT NULL DEFAULT 'generate'
                        CHECK (operation IN ('generate', 'chat', 'embed', 'extract', 'eval')),
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      gpu_seconds     REAL DEFAULT 0,
      estimated_cost  REAL DEFAULT 0,
      metadata_json   TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_cost_user
      ON ai_cost_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_cost_user_date
      ON ai_cost_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_cost_provider
      ON ai_cost_log(provider);
  `);

  log.info('schema:brain', 'Brain schema initialized (model_registry, graph_nodes, graph_edges, brain_chat_history, ai_cost_log)');
}
