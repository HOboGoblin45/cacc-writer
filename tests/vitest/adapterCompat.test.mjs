/**
 * tests/vitest/adapterCompat.test.mjs
 * ==================================
 * Unit tests for the AdapterCompat compatibility shim.
 *
 * Tests verify that:
 * - createSyncCompat wraps SQLite adapters correctly
 * - prepare().run() works through the compat layer
 * - prepare().get() works through the compat layer
 * - prepare().all() works through the compat layer
 * - exec() works through the compat layer
 * - Throws error for non-SQLite adapters
 * - Updated Phase 3 repos work with adapter (smoke tests)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteAdapter } from '../../server/db/adapters/SQLiteAdapter.js';
import { createSyncCompat } from '../../server/db/AdapterCompat.js';
import * as autoTuneRepo from '../../server/db/repositories/autoTuneRepo.js';
import * as voiceEmbeddingRepo from '../../server/db/repositories/voiceEmbeddingRepo.js';
import * as stmRepo from '../../server/db/repositories/stmRepo.js';

describe('AdapterCompat', () => {
  let adapter;

  beforeAll(async () => {
    adapter = new SQLiteAdapter();
    await adapter.connect({ filename: ':memory:' });

    // Initialize schema for testing
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS autotune_ema_state (
        id INTEGER PRIMARY KEY,
        context_key TEXT UNIQUE NOT NULL,
        form_type TEXT NOT NULL,
        section_id TEXT NOT NULL,
        avg_score REAL DEFAULT 0.5,
        avg_tokens_used REAL DEFAULT 500,
        optimal_temperature REAL DEFAULT 0.7,
        optimal_max_tokens INTEGER DEFAULT 1000,
        optimal_top_p REAL DEFAULT 0.9,
        sample_count INTEGER DEFAULT 0,
        alpha REAL DEFAULT 0.3,
        last_updated TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS autotune_outcomes (
        id INTEGER PRIMARY KEY,
        context_key TEXT NOT NULL,
        section_id TEXT NOT NULL,
        form_type TEXT NOT NULL,
        quality_score REAL,
        tokens_used INTEGER,
        was_approved INTEGER DEFAULT 0,
        temperature_used REAL,
        max_tokens_used INTEGER,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS voice_reference_embeddings (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        form_type TEXT NOT NULL,
        section_id TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        source TEXT DEFAULT 'approved_narrative',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, form_type, section_id, text_hash)
      );

      CREATE TABLE IF NOT EXISTS stm_normalization_log (
        id INTEGER PRIMARY KEY,
        section_id TEXT NOT NULL,
        form_type TEXT NOT NULL,
        original_length INTEGER,
        cleaned_length INTEGER,
        regex_changes INTEGER DEFAULT 0,
        llm_pass_used INTEGER DEFAULT 0,
        preamble_stripped INTEGER DEFAULT 0,
        postamble_stripped INTEGER DEFAULT 0,
        truncated INTEGER DEFAULT 0,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  describe('createSyncCompat', () => {
    it('should create a compat wrapper for SQLite adapter', () => {
      const db = createSyncCompat(adapter);
      expect(db).toBeDefined();
      expect(db.prepare).toBeDefined();
      expect(db.exec).toBeDefined();
      expect(db.transaction).toBeDefined();
      expect(db.pragma).toBeDefined();
    });

    it('should throw error if adapter is missing', () => {
      expect(() => createSyncCompat(null)).toThrow('Adapter is required');
    });

    it('should throw error if adapter does not have _db property', () => {
      const mockAdapter = {
        getDialect: () => 'postgresql',
      };
      expect(() => createSyncCompat(mockAdapter)).toThrow(
        /Sync compat only works with SQLite adapter/
      );
    });

    it('should provide access to internal db via _getInternalDb()', () => {
      const db = createSyncCompat(adapter);
      const internalDb = db._getInternalDb();
      expect(internalDb).toBe(adapter._db);
    });
  });

  describe('Compat Statement - prepare().run()', () => {
    it('should execute INSERT and return result with changes', () => {
      const db = createSyncCompat(adapter);
      const result = db
        .prepare(
          'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
        )
        .run('ctx-1', '1004', 'section-1');

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should execute UPDATE and return changes', () => {
      const db = createSyncCompat(adapter);

      // Insert first
      db.prepare(
        'INSERT INTO autotune_ema_state (context_key, form_type, section_id, avg_score) VALUES (?, ?, ?, ?)'
      ).run('ctx-2', '1004', 'section-2', 0.5);

      // Update
      const result = db
        .prepare('UPDATE autotune_ema_state SET avg_score = ? WHERE context_key = ?')
        .run(0.8, 'ctx-2');

      expect(result.changes).toBe(1);
    });

    it('should execute DELETE and return changes', () => {
      const db = createSyncCompat(adapter);

      // Insert first
      db.prepare(
        'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
      ).run('ctx-3', '1004', 'section-3');

      // Delete
      const result = db
        .prepare('DELETE FROM autotune_ema_state WHERE context_key = ?')
        .run('ctx-3');

      expect(result.changes).toBe(1);
    });
  });

  describe('Compat Statement - prepare().get()', () => {
    it('should execute SELECT and return single row', () => {
      const db = createSyncCompat(adapter);

      // Insert test data
      db.prepare(
        'INSERT INTO autotune_ema_state (context_key, form_type, section_id, avg_score) VALUES (?, ?, ?, ?)'
      ).run('ctx-get-1', '1004', 'section-get-1', 0.75);

      // Retrieve
      const row = db
        .prepare('SELECT * FROM autotune_ema_state WHERE context_key = ?')
        .get('ctx-get-1');

      expect(row).toBeDefined();
      expect(row.context_key).toBe('ctx-get-1');
      expect(row.form_type).toBe('1004');
      expect(row.avg_score).toBe(0.75);
    });

    it('should return undefined if no row found', () => {
      const db = createSyncCompat(adapter);
      const row = db
        .prepare('SELECT * FROM autotune_ema_state WHERE context_key = ?')
        .get('nonexistent');

      expect(row).toBeUndefined();
    });
  });

  describe('Compat Statement - prepare().all()', () => {
    it('should execute SELECT and return all rows', () => {
      const db = createSyncCompat(adapter);

      // Insert test data
      db.prepare(
        'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
      ).run('ctx-all-1', '1004', 'section-all-1');
      db.prepare(
        'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
      ).run('ctx-all-2', '1025', 'section-all-2');

      // Retrieve all
      const rows = db.prepare('SELECT * FROM autotune_ema_state WHERE form_type = ?').all('1004');

      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some(r => r.context_key === 'ctx-all-1')).toBe(true);
    });

    it('should return empty array if no rows found', () => {
      const db = createSyncCompat(adapter);
      const rows = db
        .prepare('SELECT * FROM autotune_ema_state WHERE form_type = ?')
        .all('9999');

      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(0);
    });
  });

  describe('Compat - exec()', () => {
    it('should execute DDL statements', async () => {
      const db = createSyncCompat(adapter);

      // Create a test table
      db.exec(`
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      // Verify it exists
      const exists = await adapter.tableExists('test_table');
      expect(exists).toBe(true);
    });
  });

  describe('Compat - pragma()', () => {
    it('should execute PRAGMA statements', () => {
      const db = createSyncCompat(adapter);

      // Get current journal mode
      const mode = db.pragma('journal_mode');
      expect(mode).toBeDefined();
    });

    it('should set PRAGMA values', () => {
      const db = createSyncCompat(adapter);

      // Set foreign_keys (returns the value)
      const result = db.pragma('foreign_keys', 'ON');
      expect(result).toBeDefined();
    });
  });

  describe('Compat - transaction()', () => {
    it('should execute function within transaction', () => {
      const db = createSyncCompat(adapter);

      const result = db.transaction(() => {
        db.prepare(
          'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
        ).run('ctx-tx-1', '1004', 'section-tx-1');

        db.prepare(
          'INSERT INTO autotune_ema_state (context_key, form_type, section_id) VALUES (?, ?, ?)'
        ).run('ctx-tx-2', '1004', 'section-tx-2');

        return 'success';
      });

      expect(result).toBe('success');

      // Verify both records exist
      const rows = db
        .prepare('SELECT * FROM autotune_ema_state WHERE context_key LIKE ?')
        .all('ctx-tx-%');
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Phase 3 Repo Integration - AutoTune', () => {
    it('should work with async adapter methods', async () => {
      // Upsert EMA state
      const key = await autoTuneRepo.upsertEmaState(adapter, 'ctx-smoke-1', {
        formType: '1004',
        sectionId: 'section-smoke',
        avgScore: 0.85,
      });

      expect(key).toBe('ctx-smoke-1');

      // Retrieve it
      const state = await autoTuneRepo.getEmaState(adapter, 'ctx-smoke-1');
      expect(state).toBeDefined();
      expect(state.contextKey).toBe('ctx-smoke-1');
      expect(state.avgScore).toBe(0.85);

      // Get all
      const allStates = await autoTuneRepo.getAllEmaStates(adapter);
      expect(Array.isArray(allStates)).toBe(true);
      expect(allStates.length).toBeGreaterThan(0);
    });

    it('should record and retrieve outcomes', async () => {
      const id = await autoTuneRepo.recordOutcome(adapter, {
        contextKey: 'ctx-smoke-2',
        sectionId: 'section-smoke',
        formType: '1004',
        qualityScore: 0.9,
        tokensUsed: 250,
      });

      expect(id).toBeGreaterThan(0);

      const history = await autoTuneRepo.getOutcomeHistory(adapter, 'ctx-smoke-2');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].qualityScore).toBe(0.9);
    });
  });

  describe('Phase 3 Repo Integration - VoiceEmbedding', () => {
    it('should store and retrieve embeddings', async () => {
      const id = await voiceEmbeddingRepo.storeEmbedding(adapter, {
        userId: 'user-smoke-1',
        formType: '1004',
        sectionId: 'section-smoke',
        textHash: 'hash-123',
        embeddingJson: JSON.stringify([0.1, 0.2, 0.3]),
        source: 'approved_narrative',
      });

      expect(id).toBeGreaterThan(0);

      const embeddings = await voiceEmbeddingRepo.getEmbeddings(
        adapter,
        'user-smoke-1',
        '1004',
        'section-smoke'
      );
      expect(embeddings.length).toBeGreaterThan(0);
      expect(embeddings[0].textHash).toBe('hash-123');
    });

    it('should get embedding count', async () => {
      const count = await voiceEmbeddingRepo.getEmbeddingCount(
        adapter,
        'user-smoke-1',
        '1004'
      );
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Phase 3 Repo Integration - STM', () => {
    it('should log normalization', async () => {
      const id = await stmRepo.logNormalization(adapter, {
        sectionId: 'section-smoke',
        formType: '1004',
        originalLength: 500,
        cleanedLength: 400,
        regexChanges: true,
        userId: 'user-smoke-1',
      });

      expect(id).toBeGreaterThan(0);
    });

    it('should retrieve stats', async () => {
      const stats = await stmRepo.getStats(adapter, 'user-smoke-1', '1004');
      expect(stats).toBeDefined();
      expect(stats.totalNormalizations).toBeGreaterThan(0);
      expect(stats.totalOriginalBytes).toBeGreaterThan(0);
    });

    it('should retrieve recent logs', async () => {
      const logs = await stmRepo.getRecentLogs(adapter, 'user-smoke-1', 10);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
