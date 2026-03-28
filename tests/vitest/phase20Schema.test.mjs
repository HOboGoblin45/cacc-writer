/**
 * tests/vitest/phase20Schema.test.mjs
 * ------------------------------------
 * Unit tests for Phase 20 schema migration and repositories.
 *
 * Tests:
 *   - Phase 20 schema initialization (exec called)
 *   - AutoTune CRUD operations (with mocked db)
 *   - Voice Embedding CRUD operations (with mocked db)
 *   - STM Normalization logging (with mocked db)
 *   - Repository error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initPhase20Schema } from '../../server/migration/phase20Schema.js';

vi.mock('../../server/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  upsertEmaState,
  getEmaState,
  getAllEmaStates,
  recordOutcome,
  getOutcomeHistory,
  resetEmaState,
  deleteOldOutcomes,
} from '../../server/db/repositories/autoTuneRepo.js';
import {
  storeEmbedding,
  getEmbeddings,
  getAllEmbeddingsForUser,
  deleteEmbedding,
  getEmbeddingCount,
} from '../../server/db/repositories/voiceEmbeddingRepo.js';
import {
  logNormalization,
  getStats,
  getRecentLogs,
} from '../../server/db/repositories/stmRepo.js';

// ── Mock Database Builder ────────────────────────────────────────────────────

function createMockDb() {
  return {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn((a, b, c, d, e, f, g, h, i, j, k, l) => ({
        changes: 1,
        lastInsertRowid: 42,
      })),
      get: vi.fn(() => null),
      all: vi.fn(() => []),
    })),
    pragma: vi.fn(),
    transaction: vi.fn((fn) => fn),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEMA INITIALIZATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 20 Schema Initialization', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should call db.exec with CREATE TABLE statements', () => {
    initPhase20Schema(mockDb);
    expect(mockDb.exec).toHaveBeenCalled();
    expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
  });

  it('should create autotune_ema_state table definition', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS autotune_ema_state');
    expect(sql).toContain('context_key TEXT NOT NULL UNIQUE');
    expect(sql).toContain('form_type TEXT NOT NULL');
    expect(sql).toContain('section_id TEXT NOT NULL');
    expect(sql).toContain('optimal_temperature REAL DEFAULT 0.7');
  });

  it('should create autotune_outcomes table definition', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS autotune_outcomes');
    expect(sql).toContain('context_key TEXT NOT NULL');
    expect(sql).toContain('quality_score REAL');
    expect(sql).toContain('was_approved INTEGER DEFAULT 0');
  });

  it('should create voice_reference_embeddings table definition', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS voice_reference_embeddings');
    expect(sql).toContain('user_id TEXT NOT NULL');
    expect(sql).toContain('embedding_json TEXT NOT NULL');
    expect(sql).toContain('UNIQUE(user_id, form_type, section_id, text_hash)');
  });

  it('should create stm_normalization_log table definition', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS stm_normalization_log');
    expect(sql).toContain('regex_changes INTEGER DEFAULT 0');
    expect(sql).toContain('preamble_stripped INTEGER DEFAULT 0');
    expect(sql).toContain('postamble_stripped INTEGER DEFAULT 0');
    expect(sql).toContain('truncated INTEGER DEFAULT 0');
  });

  it('should create indexes for autotune tables', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('idx_autotune_ema_context_key');
    expect(sql).toContain('idx_autotune_outcomes_context_key');
    expect(sql).toContain('idx_autotune_outcomes_user_id');
  });

  it('should create indexes for voice tables', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('idx_voice_embeddings_user_id');
    expect(sql).toContain('idx_voice_embeddings_form_type');
  });

  it('should create indexes for STM tables', () => {
    initPhase20Schema(mockDb);
    const sql = mockDb.exec.mock.calls[0][0];
    expect(sql).toContain('idx_stm_normalization_section_id');
    expect(sql).toContain('idx_stm_normalization_user_id');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTOTUNE REPOSITORY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('AutoTune Repository', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe('upsertEmaState', () => {
    it('should call prepare with correct INSERT statement', () => {
      const contextKey = 'test_ctx';
      const state = {
        formType: '1004',
        sectionId: 'description',
        avgScore: 0.75,
      };

      upsertEmaState(mockDb, contextKey, state);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('INSERT INTO autotune_ema_state');
      expect(sqlCall).toContain('ON CONFLICT(context_key) DO UPDATE SET');
    });

    it('should execute statement with correct parameters', () => {
      const contextKey = 'test_ctx_2';
      const state = {
        formType: '1025',
        sectionId: 'market',
        avgScore: 0.8,
        sampleCount: 5,
      };

      upsertEmaState(mockDb, contextKey, state);

      // Check that prepare was called and the returned mock's run was called
      expect(mockDb.prepare).toHaveBeenCalled();
      const preparedStatement = mockDb.prepare.mock.results[0].value;
      expect(preparedStatement.run).toHaveBeenCalled();
      const params = preparedStatement.run.mock.calls[0];
      expect(params[0]).toBe(contextKey);
      expect(params[1]).toBe('1025');
      expect(params[2]).toBe('market');
    });

    it('should throw error if contextKey is missing', () => {
      expect(() => upsertEmaState(mockDb, null, { formType: '1004', sectionId: 'desc' }))
        .toThrow('contextKey is required');
    });

    it('should throw error if required state fields missing', () => {
      expect(() => upsertEmaState(mockDb, 'ctx', { sectionId: 'desc' }))
        .toThrow('formType and sectionId are required in state');
    });
  });

  describe('getEmaState', () => {
    it('should call prepare with SELECT statement', () => {
      getEmaState(mockDb, 'test_ctx');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM autotune_ema_state');
    });

    it('should return null when no state found', () => {
      const result = getEmaState(mockDb, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should throw if contextKey is missing', () => {
      expect(() => getEmaState(mockDb, null)).toThrow('contextKey is required');
    });
  });

  describe('getAllEmaStates', () => {
    it('should call prepare with SELECT all statement', () => {
      getAllEmaStates(mockDb);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM autotune_ema_state');
      expect(sqlCall).toContain('ORDER BY created_at DESC');
    });

    it('should return empty array when no states', () => {
      const result = getAllEmaStates(mockDb);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('resetEmaState', () => {
    it('should call prepare with DELETE statement', () => {
      resetEmaState(mockDb, 'test_ctx');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('DELETE FROM autotune_ema_state');
    });

    it('should return true when delete succeeds', () => {
      const result = resetEmaState(mockDb, 'test_ctx');
      expect(result).toBe(true);
    });

    it('should throw if contextKey is missing', () => {
      expect(() => resetEmaState(mockDb, null)).toThrow('contextKey is required');
    });
  });

  describe('recordOutcome', () => {
    it('should call prepare with INSERT statement', () => {
      const outcome = {
        contextKey: 'ctx',
        sectionId: 'desc',
        formType: '1004',
      };

      recordOutcome(mockDb, outcome);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('INSERT INTO autotune_outcomes');
    });

    it('should return outcome ID', () => {
      const outcome = {
        contextKey: 'ctx',
        sectionId: 'desc',
        formType: '1004',
      };

      const id = recordOutcome(mockDb, outcome);
      expect(typeof id).toBe('number');
    });

    it('should throw if required fields missing', () => {
      expect(() => recordOutcome(mockDb, { sectionId: 'desc' }))
        .toThrow('contextKey, sectionId, and formType are required');
    });
  });

  describe('getOutcomeHistory', () => {
    it('should call prepare with SELECT statement including context filter', () => {
      getOutcomeHistory(mockDb, 'test_ctx', 100);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM autotune_outcomes');
      expect(sqlCall).toContain('WHERE context_key = ?');
      expect(sqlCall).toContain('ORDER BY created_at DESC');
    });

    it('should return empty array when no outcomes', () => {
      const result = getOutcomeHistory(mockDb, 'nonexistent');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('should throw if contextKey is missing', () => {
      expect(() => getOutcomeHistory(mockDb, null)).toThrow('contextKey is required');
    });
  });

  describe('deleteOldOutcomes', () => {
    it('should call prepare with DELETE statement', () => {
      deleteOldOutcomes(mockDb, 90);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('DELETE FROM autotune_outcomes');
      expect(sqlCall).toContain('datetime');
    });

    it('should return number of deleted rows', () => {
      const result = deleteOldOutcomes(mockDb, 90);
      expect(typeof result).toBe('number');
    });

    it('should throw if daysOld is invalid', () => {
      expect(() => deleteOldOutcomes(mockDb, 0)).toThrow('daysOld must be >= 1');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VOICE EMBEDDING REPOSITORY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Voice Embedding Repository', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe('storeEmbedding', () => {
    it('should call prepare with INSERT statement', () => {
      storeEmbedding(mockDb, {
        userId: 'user_001',
        formType: '1004',
        sectionId: 'description',
        textHash: 'hash_abc',
        embeddingJson: JSON.stringify([0.1, 0.2]),
      });

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('INSERT INTO voice_reference_embeddings');
      expect(sqlCall).toContain('ON CONFLICT(user_id, form_type, section_id, text_hash)');
    });

    it('should return embedding ID', () => {
      const id = storeEmbedding(mockDb, {
        userId: 'user_001',
        formType: '1004',
        sectionId: 'description',
        textHash: 'hash_abc',
        embeddingJson: JSON.stringify([0.1]),
      });

      expect(typeof id).toBe('number');
    });

    it('should throw if required fields missing', () => {
      expect(() => storeEmbedding(mockDb, {
        userId: 'user',
        formType: '1004',
        // missing sectionId
        textHash: 'hash',
        embeddingJson: '[]',
      })).toThrow('required');
    });
  });

  describe('getEmbeddings', () => {
    it('should call prepare with SELECT statement', () => {
      getEmbeddings(mockDb, 'user_001', '1004', 'description');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM voice_reference_embeddings');
      expect(sqlCall).toContain('WHERE user_id = ? AND form_type = ? AND section_id = ?');
    });

    it('should return empty array when no embeddings', () => {
      const result = getEmbeddings(mockDb, 'user_001', '1004', 'description');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('should throw if required fields missing', () => {
      expect(() => getEmbeddings(mockDb, 'user', '1004', null))
        .toThrow('required');
    });
  });

  describe('getAllEmbeddingsForUser', () => {
    it('should call prepare with SELECT statement', () => {
      getAllEmbeddingsForUser(mockDb, 'user_001', '1004');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM voice_reference_embeddings');
      expect(sqlCall).toContain('WHERE user_id = ? AND form_type = ?');
    });

    it('should return empty array when no embeddings', () => {
      const result = getAllEmbeddingsForUser(mockDb, 'user_001', '1004');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('deleteEmbedding', () => {
    it('should call prepare with DELETE statement', () => {
      deleteEmbedding(mockDb, 42);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('DELETE FROM voice_reference_embeddings');
    });

    it('should return boolean result', () => {
      const result = deleteEmbedding(mockDb, 42);
      expect(typeof result).toBe('boolean');
    });

    it('should throw if id is missing', () => {
      expect(() => deleteEmbedding(mockDb, null)).toThrow('id is required');
    });
  });

  describe('getEmbeddingCount', () => {
    it('should call prepare with COUNT statement', () => {
      getEmbeddingCount(mockDb, 'user_001', '1004');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT COUNT(*)');
      expect(sqlCall).toContain('FROM voice_reference_embeddings');
    });

    it('should return number', () => {
      const result = getEmbeddingCount(mockDb, 'user_001', '1004');
      expect(typeof result).toBe('number');
    });

    it('should throw if required fields missing', () => {
      expect(() => getEmbeddingCount(mockDb, 'user', null))
        .toThrow('required');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STM NORMALIZATION REPOSITORY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('STM Normalization Repository', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe('logNormalization', () => {
    it('should call prepare with INSERT statement', () => {
      logNormalization(mockDb, {
        sectionId: 'description',
        formType: '1004',
        originalLength: 500,
        cleanedLength: 450,
      });

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('INSERT INTO stm_normalization_log');
    });

    it('should return log entry ID', () => {
      const id = logNormalization(mockDb, {
        sectionId: 'description',
        formType: '1004',
      });

      expect(typeof id).toBe('number');
    });

    it('should throw if required fields missing', () => {
      expect(() => logNormalization(mockDb, { originalLength: 500 }))
        .toThrow('required');
    });
  });

  describe('getStats', () => {
    it('should call prepare with aggregation query', () => {
      getStats(mockDb, 'user_001', '1004');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT');
      expect(sqlCall).toContain('COUNT(*)');
      expect(sqlCall).toContain('SUM(');
      expect(sqlCall).toContain('FROM stm_normalization_log');
    });

    it('should return stats object with expected fields', () => {
      const result = getStats(mockDb, 'user_001', '1004');

      expect(result).toHaveProperty('totalNormalizations');
      expect(result).toHaveProperty('totalOriginalBytes');
      expect(result).toHaveProperty('regexOperations');
      expect(result).toHaveProperty('llmOperations');
    });

    it('should throw if required fields missing', () => {
      expect(() => getStats(mockDb, 'user', null))
        .toThrow('required');
    });
  });

  describe('getRecentLogs', () => {
    it('should call prepare with SELECT statement', () => {
      getRecentLogs(mockDb, 'user_001', 50);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlCall = mockDb.prepare.mock.calls[0][0];
      expect(sqlCall).toContain('SELECT * FROM stm_normalization_log');
      expect(sqlCall).toContain('WHERE user_id = ?');
      expect(sqlCall).toContain('ORDER BY created_at DESC');
    });

    it('should return array of logs', () => {
      const result = getRecentLogs(mockDb, 'user_001');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw if userId is missing', () => {
      expect(() => getRecentLogs(mockDb, null))
        .toThrow('userId is required');
    });
  });
});
