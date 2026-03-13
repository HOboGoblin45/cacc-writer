/**
 * server/migration/pipelineSchema.js
 * ------------------------------------
 * Schema for the Cloudflare Browser Rendering data pipeline.
 *
 * Tables:
 *   pipeline_cache         — stores crawled + extracted data per case
 *   pipeline_crawl_jobs    — tracks async crawl job metadata
 *   pipeline_presets       — custom user crawl presets
 */

export function initPipelineSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_cache (
      case_id       TEXT PRIMARY KEY,
      data          TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      crawl_count   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pipeline_crawl_jobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id       TEXT NOT NULL,
      job_id        TEXT NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      source_type   TEXT NOT NULL DEFAULT 'custom',
      url           TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'running',
      records_json  TEXT,
      browser_ms    REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_crawl_jobs_case
      ON pipeline_crawl_jobs(case_id);

    CREATE TABLE IF NOT EXISTS pipeline_presets (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      options_json  TEXT NOT NULL DEFAULT '{}',
      schema_key    TEXT,
      prompt        TEXT,
      is_builtin    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
