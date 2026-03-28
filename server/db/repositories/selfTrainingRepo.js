import log from '../../logger.js';

export function createBatch(db, batchId, totalEntries) {
  try {
    const stmt = db.prepare(`
      INSERT INTO self_training_batches (batch_id, status, total_entries, started_at)
      VALUES (?, 'pending', ?, datetime('now'))
    `);
    const result = stmt.run(batchId, totalEntries);
    log.info(`Created self-training batch: ${batchId} with ${totalEntries} entries`);
    return result;
  } catch (err) {
    log.error(`Error creating batch ${batchId}:`, err);
    throw err;
  }
}

export function updateBatchProgress(db, batchId, updates) {
  try {
    const {
      completedEntries,
      passed = 0,
      close = 0,
      weak = 0,
      failed = 0
    } = updates;

    const stmt = db.prepare(`
      UPDATE self_training_batches
      SET completed_entries = ?, passed = ?, close = ?, weak = ?, failed = ?, updated_at = datetime('now')
      WHERE batch_id = ?
    `);
    const result = stmt.run(completedEntries, passed, close, weak, failed, batchId);
    log.info(`Updated batch progress ${batchId}: ${completedEntries} completed`);
    return result;
  } catch (err) {
    log.error(`Error updating batch progress for ${batchId}:`, err);
    throw err;
  }
}

export function completeBatch(db, batchId, avgScore) {
  try {
    const stmt = db.prepare(`
      UPDATE self_training_batches
      SET status = 'completed', avg_composite_score = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE batch_id = ?
    `);
    const result = stmt.run(avgScore, batchId);
    log.info(`Completed batch ${batchId} with avg score ${avgScore}`);
    return result;
  } catch (err) {
    log.error(`Error completing batch ${batchId}:`, err);
    throw err;
  }
}

export function failBatch(db, batchId, error) {
  try {
    const stmt = db.prepare(`
      UPDATE self_training_batches
      SET status = 'failed', updated_at = datetime('now')
      WHERE batch_id = ?
    `);
    const result = stmt.run(batchId);
    log.error(`Failed batch ${batchId}: ${error}`);
    return result;
  } catch (err) {
    log.error(`Error failing batch ${batchId}:`, err);
    throw err;
  }
}

export function getBatch(db, batchId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM self_training_batches
      WHERE batch_id = ?
    `);
    const batch = stmt.get(batchId);
    return batch;
  } catch (err) {
    log.error(`Error getting batch ${batchId}:`, err);
    throw err;
  }
}

export function listBatches(db, { limit = 50, offset = 0 } = {}) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM self_training_batches
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const batches = stmt.all(limit, offset);
    return batches;
  } catch (err) {
    log.error('Error listing batches:', err);
    throw err;
  }
}

export function insertResult(db, result) {
  try {
    const {
      batchId,
      corpusEntryId,
      sectionType,
      originalText,
      regeneratedText,
      embeddingSimilarity,
      rougeLScore,
      factCoverage,
      compositeScore,
      classification,
      extractedFacts,
      missingFacts
    } = result;

    const stmt = db.prepare(`
      INSERT INTO self_training_results (
        batch_id, corpus_entry_id, section_type, original_text, regenerated_text,
        embedding_similarity, rouge_l_score, fact_coverage, composite_score,
        classification, extracted_facts, missing_facts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertResult = stmt.run(
      batchId,
      corpusEntryId,
      sectionType,
      originalText,
      regeneratedText,
      embeddingSimilarity,
      rougeLScore,
      factCoverage,
      compositeScore,
      classification,
      JSON.stringify(extractedFacts || []),
      JSON.stringify(missingFacts || [])
    );

    return insertResult;
  } catch (err) {
    log.error(`Error inserting result for batch ${result.batchId}:`, err);
    throw err;
  }
}

export function getResultsByBatch(db, batchId, { limit = 50, offset = 0 } = {}) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM self_training_results
      WHERE batch_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const results = stmt.all(batchId, limit, offset);
    return results;
  } catch (err) {
    log.error(`Error getting results for batch ${batchId}:`, err);
    throw err;
  }
}

export function getResultsByClassification(db, batchId, classification) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM self_training_results
      WHERE batch_id = ? AND classification = ?
      ORDER BY created_at DESC
    `);
    const results = stmt.all(batchId, classification);
    return results;
  } catch (err) {
    log.error(`Error getting results for batch ${batchId} with classification ${classification}:`, err);
    throw err;
  }
}

export function upsertSectionTrend(db, sectionType, batchId, scores) {
  try {
    const {
      avgComposite,
      avgEmbedding,
      avgRouge,
      avgFactCoverage,
      sampleCount
    } = scores;

    // Check if trend exists
    const existing = db.prepare(`
      SELECT id FROM self_training_section_trends
      WHERE section_type = ? AND batch_id = ?
    `).get(sectionType, batchId);

    let result;
    if (existing) {
      const stmt = db.prepare(`
        UPDATE self_training_section_trends
        SET avg_composite = ?, avg_embedding = ?, avg_rouge = ?, avg_fact_coverage = ?, sample_count = ?
        WHERE section_type = ? AND batch_id = ?
      `);
      result = stmt.run(avgComposite, avgEmbedding, avgRouge, avgFactCoverage, sampleCount, sectionType, batchId);
    } else {
      const stmt = db.prepare(`
        INSERT INTO self_training_section_trends (section_type, batch_id, avg_composite, avg_embedding, avg_rouge, avg_fact_coverage, sample_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      result = stmt.run(sectionType, batchId, avgComposite, avgEmbedding, avgRouge, avgFactCoverage, sampleCount);
    }

    return result;
  } catch (err) {
    log.error(`Error upserting section trend for ${sectionType}:`, err);
    throw err;
  }
}

export function getSectionTrends(db, sectionType, { limit = 20 } = {}) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM self_training_section_trends
      WHERE section_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const trends = stmt.all(sectionType, limit);
    return trends;
  } catch (err) {
    log.error(`Error getting section trends for ${sectionType}:`, err);
    throw err;
  }
}

export function getOverallStats(db) {
  try {
    const statsStmt = db.prepare(`
      SELECT
        COUNT(*) as total_batches,
        SUM(total_entries) as total_entries,
        SUM(completed_entries) as completed_entries,
        SUM(passed) as total_passed,
        SUM(close) as total_close,
        SUM(weak) as total_weak,
        SUM(failed) as total_failed,
        AVG(avg_composite_score) as avg_score,
        MAX(created_at) as latest_batch
      FROM self_training_batches
      WHERE status = 'completed'
    `);

    const stats = statsStmt.get();

    const sectionStatsStmt = db.prepare(`
      SELECT
        section_type,
        COUNT(*) as result_count,
        AVG(composite_score) as avg_composite,
        AVG(embedding_similarity) as avg_embedding,
        AVG(rouge_l_score) as avg_rouge,
        AVG(fact_coverage) as avg_fact_coverage
      FROM self_training_results
      GROUP BY section_type
      ORDER BY avg_composite DESC
    `);

    const sectionStats = sectionStatsStmt.all();

    return {
      overall: stats,
      bySection: sectionStats
    };
  } catch (err) {
    log.error('Error getting overall stats:', err);
    throw err;
  }
}
