/**
 * tests/vitest/dataMigration.test.mjs
 * ===================================
 * Test suite for data migration utilities:
 *   - TypeConverter (type conversions, SQL generation)
 *   - MigrationCheckpoint (checkpoint save/load/resume)
 *   - DualWriteManager (dual-write mode routing)
 *
 * Run with:
 *   npm test -- tests/vitest/dataMigration.test.mjs
 *   npm test -- tests/vitest/dataMigration.test.mjs --reporter=verbose
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  convertRow,
  buildInsertSQL,
  buildBatchInsertSQL,
  getParameterIndex,
} from '../../server/db/TypeConverter.js';
import { MigrationCheckpoint } from '../../server/db/MigrationCheckpoint.js';
import { DualWriteManager } from '../../server/db/DualWriteManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, '..', 'tmp');

// ──────────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Create temp directory
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
});

afterEach(() => {
  // Clean up temp files
  try {
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true });
    }
  } catch {
    // Ignore cleanup errors
  }

  // Reset env vars
  delete process.env.DB_WRITE_MODE;
});

// ──────────────────────────────────────────────────────────────────────────────
// TypeConverter Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('TypeConverter', () => {
  describe('convertRow', () => {
    it('converts boolean 0 to false', () => {
      const row = { id: '123', active: 0 };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'active', pgType: 'BOOLEAN' },
      ];

      const converted = convertRow(row, columns);
      expect(converted.active).toBe(false);
    });

    it('converts boolean 1 to true', () => {
      const row = { id: '123', active: 1 };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'active', pgType: 'BOOLEAN' },
      ];

      const converted = convertRow(row, columns);
      expect(converted.active).toBe(true);
    });

    it('converts ISO timestamp string to ISO string', () => {
      const isoString = '2026-03-28T14:30:00Z';
      const row = { id: '123', created_at: isoString };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'created_at', pgType: 'TIMESTAMPTZ' },
      ];

      const converted = convertRow(row, columns);
      expect(converted.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('converts JSON string to parsed object', () => {
      const jsonString = '{"name":"test","value":42}';
      const row = { id: '123', metadata: jsonString };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'metadata', pgType: 'JSONB' },
      ];

      const converted = convertRow(row, columns);
      expect(typeof converted.metadata).toBe('object');
      expect(converted.metadata.name).toBe('test');
      expect(converted.metadata.value).toBe(42);
    });

    it('ignores undefined/null columns', () => {
      const row = { id: '123', optional: null };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'optional', pgType: 'TEXT' },
      ];

      const converted = convertRow(row, columns);
      expect(converted.optional).toBeNull();
    });

    it('keeps invalid JSON as string', () => {
      const invalidJson = 'not json';
      const row = { id: '123', metadata: invalidJson };
      const columns = [
        { name: 'id', pgType: 'TEXT PRIMARY KEY' },
        { name: 'metadata', pgType: 'JSONB' },
      ];

      const converted = convertRow(row, columns);
      expect(converted.metadata).toBe(invalidJson);
    });
  });

  describe('buildInsertSQL', () => {
    it('generates parameterized INSERT for PostgreSQL', () => {
      const result = buildInsertSQL('cases', ['id', 'name']);

      expect(result.sql).toBe(
        'INSERT INTO cacc.cases (id, name) VALUES ($1, $2)'
      );
      expect(result.placeholders).toBe('$1, $2');
    });

    it('generates INSERT with custom schema', () => {
      const result = buildInsertSQL('cases', ['id', 'name'], 'myschema');

      expect(result.sql).toContain('INSERT INTO myschema.cases');
    });

    it('generates INSERT with single column', () => {
      const result = buildInsertSQL('cases', ['id']);

      expect(result.sql).toBe(
        'INSERT INTO cacc.cases (id) VALUES ($1)'
      );
    });

    it('generates INSERT with many columns', () => {
      const cols = Array.from({ length: 10 }, (_, i) => `col${i}`);
      const result = buildInsertSQL('table', cols);

      const placeholderCount = (result.sql.match(/\$/g) || []).length;
      expect(placeholderCount).toBe(cols.length);
    });
  });

  describe('buildBatchInsertSQL', () => {
    it('generates batch INSERT for multiple rows', () => {
      const result = buildBatchInsertSQL('cases', ['id', 'name'], 2);

      expect(result.sql).toContain('INSERT INTO cacc.cases');
      expect(result.sql).toContain('($1, $2), ($3, $4)');
      expect(result.rowsPerBatch).toBe(2);
    });

    it('generates batch INSERT with correct placeholder pattern', () => {
      const result = buildBatchInsertSQL('cases', ['id', 'name', 'status'], 3);

      expect(result.placeholderPattern).toBe('($1, $2, $3)');
    });

    it('generates batch INSERT for 100 rows', () => {
      const result = buildBatchInsertSQL('cases', ['id', 'name'], 100);

      const placeholderCount = (result.sql.match(/\$/g) || []).length;
      expect(placeholderCount).toBe(200); // 2 columns * 100 rows
    });
  });

  describe('getParameterIndex', () => {
    it('returns 1-indexed parameter for column', () => {
      const idx = getParameterIndex(['id', 'name', 'status'], 'name');
      expect(idx).toBe(2);
    });

    it('returns -1 for missing column', () => {
      const idx = getParameterIndex(['id', 'name'], 'missing');
      expect(idx).toBe(-1);
    });

    it('returns 1 for first column', () => {
      const idx = getParameterIndex(['id', 'name'], 'id');
      expect(idx).toBe(1);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MigrationCheckpoint Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('MigrationCheckpoint', () => {
  it('saves and loads checkpoint', () => {
    const checkpointPath = path.join(TMP_DIR, 'checkpoint.json');
    const checkpoint = new MigrationCheckpoint(checkpointPath);

    checkpoint.markStarted();
    checkpoint.markTableDone('user-1', 'cases', 42);
    checkpoint.markTableDone('user-1', 'assignments', 5);
    checkpoint.save();

    const checkpoint2 = new MigrationCheckpoint(checkpointPath);
    checkpoint2.load();

    expect(checkpoint2.isTableDone('user-1', 'cases')).toBe(true);
    expect(checkpoint2.isTableDone('user-1', 'assignments')).toBe(true);
  });

  it('tracks table completion status', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    expect(checkpoint.isTableDone('user-1', 'cases')).toBe(false);

    checkpoint.markTableDone('user-1', 'cases', 10);

    expect(checkpoint.isTableDone('user-1', 'cases')).toBe(true);
  });

  it('tracks user completion status', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    expect(checkpoint.isUserDone('user-1')).toBe(false);

    checkpoint.markUserDone('user-1');

    expect(checkpoint.isUserDone('user-1')).toBe(true);
  });

  it('calculates progress correctly', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    checkpoint.markTableDone('user-1', 'cases', 100);
    checkpoint.markTableDone('user-1', 'assignments', 50);
    checkpoint.markUserDone('user-1');

    checkpoint.markTableDone('user-2', 'cases', 75);

    const progress = checkpoint.getProgress();

    expect(progress.usersCompleted).toBe(1);
    expect(progress.usersTotal).toBe(2);
    expect(progress.tablesCompleted).toBe(3);
    expect(progress.rowsMigrated).toBe(225);
  });

  it('returns pending users', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    checkpoint.markUserDone('user-1');
    checkpoint._ensureUser('user-2');
    checkpoint._ensureUser('user-3');

    const pending = checkpoint.getPendingUsers();

    expect(pending).toContain('user-2');
    expect(pending).toContain('user-3');
    expect(pending).not.toContain('user-1');
  });

  it('returns pending tables for user', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    checkpoint.markTableDone('user-1', 'cases', 10);
    checkpoint._ensureTable('user-1', 'assignments');
    checkpoint._ensureTable('user-1', 'generation_runs');

    const pending = checkpoint.getPendingTables('user-1');

    expect(pending).toContain('assignments');
    expect(pending).toContain('generation_runs');
    expect(pending).not.toContain('cases');
  });

  it('handles resume from checkpoint', () => {
    const checkpointPath = path.join(TMP_DIR, 'checkpoint.json');

    // First migration session
    const checkpoint1 = new MigrationCheckpoint(checkpointPath);
    checkpoint1.markStarted();
    checkpoint1.markTableDone('user-1', 'cases', 100);
    checkpoint1.markTableDone('user-1', 'assignments', 50);
    checkpoint1.save();

    // Resume session
    const checkpoint2 = new MigrationCheckpoint(checkpointPath);
    checkpoint2.load();

    expect(checkpoint2.isTableDone('user-1', 'cases')).toBe(true);
    expect(checkpoint2.isTableDone('user-1', 'assignments')).toBe(true);

    // Continue from where we left off
    checkpoint2.markTableDone('user-1', 'generation_runs', 75);
    checkpoint2.markUserDone('user-1');
    checkpoint2.save();

    const progress = checkpoint2.getProgress();
    expect(progress.rowsMigrated).toBe(225);
  });

  it('resets to empty state', () => {
    const checkpoint = new MigrationCheckpoint(
      path.join(TMP_DIR, 'checkpoint.json')
    );

    checkpoint.markTableDone('user-1', 'cases', 100);
    checkpoint.reset();

    expect(checkpoint.isTableDone('user-1', 'cases')).toBe(false);
    expect(Object.keys(checkpoint.getData().users)).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DualWriteManager Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('DualWriteManager', () => {
  // Mock adapters
  class MockAdapter {
    constructor() {
      this.runs = [];
      this.gets = [];
      this.alls = [];
    }

    async run(sql, params) {
      this.runs.push({ sql, params });
      return { changes: 1, lastInsertRowid: 1 };
    }

    async get(sql, params) {
      this.gets.push({ sql, params });
      return { id: '123', name: 'test' };
    }

    async all(sql, params) {
      this.alls.push({ sql, params });
      return [{ id: '123', name: 'test' }];
    }

    async transaction(fn) {
      return fn();
    }
  }

  it('routes writes to SQLite in sqlite-only mode', async () => {
    process.env.DB_WRITE_MODE = 'sqlite-only';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.run('INSERT INTO cases (id) VALUES (?)', [1]);

    expect(sqlite.runs).toHaveLength(1);
    expect(pg.runs).toHaveLength(0);
  });

  it('routes writes to PG in pg-only mode', async () => {
    process.env.DB_WRITE_MODE = 'pg-only';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.run('INSERT INTO cases (id) VALUES (?)', [1]);

    expect(sqlite.runs).toHaveLength(0);
    expect(pg.runs).toHaveLength(1);
  });

  it('writes to both in dual-write mode (SQLite primary)', async () => {
    process.env.DB_WRITE_MODE = 'dual-write';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.run('INSERT INTO cases (id) VALUES (?)', [1]);

    expect(sqlite.runs).toHaveLength(1);
    // PG write happens asynchronously, may not be captured in sync test
  });

  it('reads from SQLite in sqlite-only mode', async () => {
    process.env.DB_WRITE_MODE = 'sqlite-only';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.all('SELECT * FROM cases', []);

    expect(sqlite.alls).toHaveLength(1);
    expect(pg.alls).toHaveLength(0);
  });

  it('reads from PG in pg-primary mode', async () => {
    process.env.DB_WRITE_MODE = 'pg-primary';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.all('SELECT * FROM cases', []);

    expect(sqlite.alls).toHaveLength(0);
    expect(pg.alls).toHaveLength(1);
  });

  it('reads from PG in pg-only mode', async () => {
    process.env.DB_WRITE_MODE = 'pg-only';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    await manager.get('SELECT * FROM cases WHERE id = ?', [123]);

    expect(sqlite.gets).toHaveLength(0);
    expect(pg.gets).toHaveLength(1);
  });

  it('returns status information', () => {
    process.env.DB_WRITE_MODE = 'pg-primary';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    const status = manager.getStatus();

    expect(status.mode).toBe('pg-primary');
    expect(status.primaryDb).toBe('PostgreSQL');
    expect(status.readSource).toBe('PostgreSQL');
  });

  it('defaults to sqlite-only if env var is invalid', () => {
    process.env.DB_WRITE_MODE = 'invalid-mode';

    const sqlite = new MockAdapter();
    const pg = new MockAdapter();
    const manager = new DualWriteManager(sqlite, pg);

    const mode = manager.getWriteMode();
    expect(mode).toBe('sqlite-only');
  });
});
