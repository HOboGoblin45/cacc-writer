/**
 * tests/vitest/dbMonitor.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for database health monitoring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock database module to avoid needing a real SQLite file
vi.mock('../../server/db/database.js', () => {
  const mockDb = {
    prepare: vi.fn(() => ({ get: vi.fn(() => ({ c: 42 })), all: vi.fn(() => []) })),
    pragma: vi.fn((cmd) => {
      if (cmd === 'journal_mode') return 'wal';
      if (typeof cmd === 'string' && cmd.includes('journal_mode')) return 'wal';
      if (cmd === 'foreign_keys') return 1;
      if (cmd === 'integrity_check') return [{ integrity_check: 'ok' }];
      if (typeof cmd === 'string' && cmd.includes('wal_checkpoint')) return [{ busy: 0, log: 10, checkpointed: 10 }];
      return null;
    }),
  };
  return {
    getDb: vi.fn(() => mockDb),
    getDbPath: vi.fn(() => '/tmp/test.db'),
    getDbSizeBytes: vi.fn(() => 1024 * 1024 * 5), // 5MB
  };
});

import {
  recordQueryTime,
  getSlowQueries,
  clearSlowQueries,
  getDbHealth,
  runIntegrityCheck,
  getTableStats,
} from '../../server/db/dbMonitor.js';

describe('recordQueryTime / getSlowQueries', () => {
  beforeEach(() => {
    clearSlowQueries();
  });

  it('should not record queries below threshold', () => {
    recordQueryTime('SELECT 1', 10);
    expect(getSlowQueries()).toHaveLength(0);
  });

  it('should record queries at or above 500ms', () => {
    recordQueryTime('SELECT * FROM big_table', 500, 'test');
    const queries = getSlowQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('big_table');
    expect(queries[0].durationMs).toBe(500);
    expect(queries[0].context).toBe('test');
    expect(queries[0].timestamp).toBeDefined();
  });

  it('should cap stored queries at 50', () => {
    for (let i = 0; i < 60; i++) {
      recordQueryTime(`SELECT ${i}`, 600, 'load');
    }
    expect(getSlowQueries()).toHaveLength(50);
  });

  it('should truncate SQL to 200 chars', () => {
    const longSql = 'SELECT ' + 'x'.repeat(300);
    recordQueryTime(longSql, 1000);
    expect(getSlowQueries()[0].sql.length).toBe(200);
  });
});

describe('clearSlowQueries', () => {
  it('should clear all recorded queries', () => {
    recordQueryTime('SELECT slow', 600);
    expect(getSlowQueries().length).toBeGreaterThan(0);
    clearSlowQueries();
    expect(getSlowQueries()).toHaveLength(0);
  });
});

describe('getDbHealth', () => {
  beforeEach(() => {
    clearSlowQueries();
  });

  it('should return health object with expected fields', () => {
    const health = getDbHealth();
    expect(health).toHaveProperty('connected');
    expect(health).toHaveProperty('dbPath');
    expect(health).toHaveProperty('dbSizeBytes');
    expect(health).toHaveProperty('dbSizeMB');
    expect(health).toHaveProperty('walSizeBytes');
    expect(health).toHaveProperty('journalMode');
    expect(health).toHaveProperty('foreignKeys');
    expect(health).toHaveProperty('slowQueries');
    expect(health).toHaveProperty('checkedAt');
  });

  it('should report connected=true with mock db', () => {
    const health = getDbHealth();
    expect(health.connected).toBe(true);
  });

  it('should calculate MB from bytes', () => {
    const health = getDbHealth();
    expect(health.dbSizeMB).toBe('5.00');
  });
});

describe('runIntegrityCheck', () => {
  it('should return ok when database is healthy', () => {
    const result = runIntegrityCheck();
    expect(result.ok).toBe(true);
    expect(result.result).toBe('ok');
  });
});

describe('getTableStats', () => {
  it('should return counts for known tables', () => {
    const stats = getTableStats();
    expect(stats).toHaveProperty('users');
    expect(stats).toHaveProperty('case_records');
  });
});
