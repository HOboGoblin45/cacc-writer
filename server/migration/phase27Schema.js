import log from '../logger.js';

export function initPhase27Schema(db) {
  try {
    // Create self_training_batches table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS self_training_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        total_entries INTEGER DEFAULT 0,
        completed_entries INTEGER DEFAULT 0,
        passed INTEGER DEFAULT 0,
        close INTEGER DEFAULT 0,
        weak INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        avg_composite_score REAL,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // Create self_training_results table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS self_training_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        corpus_entry_id TEXT,
        section_type TEXT,
        original_text TEXT,
        regenerated_text TEXT,
        embedding_similarity REAL,
        rouge_l_score REAL,
        fact_coverage REAL,
        composite_score REAL,
        classification TEXT,
        extracted_facts TEXT,
        missing_facts TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (batch_id) REFERENCES self_training_batches(batch_id) ON DELETE CASCADE
      )
    `).run();

    // Create self_training_section_trends table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS self_training_section_trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_type TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        avg_composite REAL,
        avg_embedding REAL,
        avg_rouge REAL,
        avg_fact_coverage REAL,
        sample_count INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (batch_id) REFERENCES self_training_batches(batch_id) ON DELETE CASCADE
      )
    `).run();

    // Create indexes for performance
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_batches_batch_id
      ON self_training_batches(batch_id)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_batches_status
      ON self_training_batches(status)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_results_batch_id
      ON self_training_results(batch_id)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_results_section_type
      ON self_training_results(section_type)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_results_classification
      ON self_training_results(classification)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_results_composite_score
      ON self_training_results(composite_score)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_section_trends_section_type
      ON self_training_section_trends(section_type)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_self_training_section_trends_batch_id
      ON self_training_section_trends(batch_id)
    `).run();

    log.info('Phase 27 schema initialized successfully');
  } catch (err) {
    log.error('Error initializing Phase 27 schema:', err);
    throw err;
  }
}
