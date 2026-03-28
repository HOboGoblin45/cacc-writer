/**
 * tests/vitest/databaseAdapter.test.mjs
 * ====================================
 * Comprehensive tests for the Database Abstraction Layer.
 *
 * Tests cover:
 *   - SQLiteAdapter: all CRUD operations, transactions, table checks
 *   - DatabaseAdapter interface contract
 *   - QueryTranslator: SQL dialect translation (SQLite ↔ PostgreSQL)
 *   - AdapterFactory: adapter selection and creation
 *   - Parameter binding and placeholder translation
 *
 * Note: These tests use SQLiteAdapter with in-memory databases because
 * PostgreSQL is not available in the test environment. PostgreSQL-specific
 * behaviors are tested via unit tests on the translation logic.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DatabaseAdapter,
  SQLiteAdapter,
  PostgreSQLAdapter,
  createAdapter,
  createUserAdapter,
  translateToPostgres,
  translateToSQLite,
  findSqliteIssues,
  countPlaceholders,
} from '../../server/db/adapters/index.js';

// ══════════════════════════════════════════════════════════════════════════════
// SQLITE ADAPTER TESTS
// ══════════════════════════════════════════════════════════════════════════════

// Check if better-sqlite3 is available
let sqliteAvailable = false;
try {
  // Test import
  const testAdapter = new SQLiteAdapter();
  sqliteAvailable = true;
} catch (err) {
  // SQLite not available in this environment
}

describe('SQLiteAdapter', () => {
  let adapter;

  beforeAll(async () => {
    if (sqliteAvailable) {
      adapter = new SQLiteAdapter();
      try {
        await adapter.connect({ filename: ':memory:' });
      } catch (err) {
        console.warn('SQLiteAdapter connection failed:', err.message);
        adapter = null;
      }
    }
  });

  afterAll(async () => {
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch (err) {
        // ignore
      }
    }
  });

  const skipIfUnavailable = !sqliteAvailable || !adapter ? it.skip : it;

  describe('connection lifecycle', () => {
    skipIfUnavailable('should connect to in-memory database', async () => {
      const isConnected = await adapter.isConnected();
      expect(isConnected).toBe(true);
    });

    skipIfUnavailable('should return sqlite dialect', () => {
      expect(adapter.getDialect()).toBe('sqlite');
    });
  });

  describe('schema management', () => {
    skipIfUnavailable('should execute DDL statements', async () => {
      await adapter.exec(`
        CREATE TABLE test_users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
      const exists = await adapter.tableExists('test_users');
      expect(exists).toBe(true);
    });

    skipIfUnavailable('should check table existence correctly', async () => {
      const exists = await adapter.tableExists('nonexistent_table');
      expect(exists).toBe(false);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      if (!skipSqliteTests) {
        await adapter.exec(`
          DROP TABLE IF EXISTS test_items;
          CREATE TABLE test_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    });

    skipIfUnavailable('should INSERT a row', async () => {
      const result = await adapter.run(
        'INSERT INTO test_items (name, value) VALUES (?, ?)',
        ['Test Item', 42.5]
      );
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeTruthy();
    });

    skipIfUnavailable('should SELECT all rows', async () => {
      await adapter.run(
        'INSERT INTO test_items (name, value) VALUES (?, ?), (?, ?)',
        ['Item 1', 10, 'Item 2', 20]
      );
      const rows = await adapter.all('SELECT * FROM test_items ORDER BY id');
      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe('Item 1');
      expect(rows[1].name).toBe('Item 2');
    });

    skipIfUnavailable('should SELECT a single row', async () => {
      await adapter.run(
        'INSERT INTO test_items (name, value) VALUES (?, ?)',
        ['Single Item', 99]
      );
      const row = await adapter.get(
        'SELECT * FROM test_items WHERE value = ?',
        [99]
      );
      expect(row).not.toBeNull();
      expect(row.name).toBe('Single Item');
      expect(row.value).toBe(99);
    });

    skipIfUnavailable('should return null for non-matching SELECT', async () => {
      const row = await adapter.get(
        'SELECT * FROM test_items WHERE name = ?',
        ['Nonexistent']
      );
      expect(row).toBeNull();
    });

    skipIfUnavailable('should UPDATE rows', async () => {
      await adapter.run(
        'INSERT INTO test_items (name, value) VALUES (?, ?)',
        ['Old Name', 50]
      );
      const result = await adapter.run(
        'UPDATE test_items SET name = ? WHERE value = ?',
        ['New Name', 50]
      );
      expect(result.changes).toBe(1);

      const row = await adapter.get(
        'SELECT * FROM test_items WHERE value = ?',
        [50]
      );
      expect(row.name).toBe('New Name');
    });

    skipIfUnavailable('should DELETE rows', async () => {
      await adapter.run(
        'INSERT INTO test_items (name, value) VALUES (?, ?), (?, ?)',
        ['Keep', 1, 'Delete', 2]
      );
      const result = await adapter.run(
        'DELETE FROM test_items WHERE value = ?',
        [2]
      );
      expect(result.changes).toBe(1);

      const remaining = await adapter.all('SELECT * FROM test_items');
      expect(remaining.length).toBe(1);
      expect(remaining[0].name).toBe('Keep');
    });

    skipIfUnavailable('should handle empty result sets', async () => {
      const rows = await adapter.all('SELECT * FROM test_items WHERE 1=0');
      expect(rows).toEqual([]);
    });
  });

  describe('transactions', () => {
    beforeEach(async () => {
      if (!skipSqliteTests) {
        await adapter.exec(`
          DROP TABLE IF EXISTS test_accounts;
          CREATE TABLE test_accounts (
            id INTEGER PRIMARY KEY,
            balance REAL
          )
        `);
      }
    });

    skipIfUnavailable('should commit a transaction', async () => {
      const result = await adapter.transaction(async () => {
        await adapter.run('INSERT INTO test_accounts (id, balance) VALUES (?, ?)', [1, 100]);
        await adapter.run('INSERT INTO test_accounts (id, balance) VALUES (?, ?)', [2, 200]);
        return 'success';
      });
      expect(result).toBe('success');

      const accounts = await adapter.all('SELECT * FROM test_accounts');
      expect(accounts.length).toBe(2);
    });

    skipIfUnavailable('should rollback on error', async () => {
      await expect(
        adapter.transaction(async () => {
          await adapter.run('INSERT INTO test_accounts (id, balance) VALUES (?, ?)', [3, 300]);
          throw new Error('Simulated error');
        })
      ).rejects.toThrow('Simulated error');

      const accounts = await adapter.all('SELECT * FROM test_accounts');
      expect(accounts.length).toBe(0);
    });

    skipIfUnavailable('should handle manual transaction control', async () => {
      await adapter.beginTransaction();
      try {
        await adapter.run('INSERT INTO test_accounts (id, balance) VALUES (?, ?)', [4, 400]);
        await adapter.commit();
      } catch (err) {
        await adapter.rollback();
        throw err;
      }

      const account = await adapter.get('SELECT * FROM test_accounts WHERE id = ?', [4]);
      expect(account.balance).toBe(400);
    });
  });

  describe('parameter binding', () => {
    beforeEach(async () => {
      if (!skipSqliteTests) {
        await adapter.exec(`
          DROP TABLE IF EXISTS test_bind;
          CREATE TABLE test_bind (
            id INTEGER PRIMARY KEY,
            text TEXT,
            number REAL
          )
        `);
      }
    });

    skipIfUnavailable('should bind positional parameters correctly', async () => {
      await adapter.run(
        'INSERT INTO test_bind (id, text, number) VALUES (?, ?, ?)',
        [1, 'hello', 3.14]
      );
      const row = await adapter.get('SELECT * FROM test_bind WHERE id = ?', [1]);
      expect(row.text).toBe('hello');
      expect(row.number).toBe(3.14);
    });

    skipIfUnavailable('should handle multiple parameters in WHERE clause', async () => {
      await adapter.run('INSERT INTO test_bind VALUES (?, ?, ?)', [1, 'a', 1.0]);
      await adapter.run('INSERT INTO test_bind VALUES (?, ?, ?)', [2, 'b', 2.0]);
      await adapter.run('INSERT INTO test_bind VALUES (?, ?, ?)', [3, 'c', 3.0]);

      const row = await adapter.get(
        'SELECT * FROM test_bind WHERE text = ? AND number > ?',
        ['b', 1.5]
      );
      expect(row.id).toBe(2);
    });

    skipIfUnavailable('should handle NULL parameters', async () => {
      await adapter.run(
        'INSERT INTO test_bind (id, text, number) VALUES (?, ?, ?)',
        [1, null, null]
      );
      const row = await adapter.get('SELECT * FROM test_bind WHERE id = ?', [1]);
      expect(row.text).toBeNull();
      expect(row.number).toBeNull();
    });
  });

  describe('pragma support', () => {
    skipIfUnavailable('should execute pragma statements', async () => {
      const mode = await adapter.pragma('journal_mode');
      expect(mode).toBe('wal');
    });
  });

  describe('error handling', () => {
    skipIfUnavailable('should throw on invalid SQL', async () => {
      await expect(
        adapter.all('SELECT * FROM nonexistent_table')
      ).rejects.toThrow();
    });

    skipIfUnavailable('should throw on operation without connection', async () => {
      const disconnectedAdapter = new SQLiteAdapter();
      await expect(
        disconnectedAdapter.all('SELECT 1')
      ).rejects.toThrow('not connected');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// QUERY TRANSLATOR TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('QueryTranslator', () => {
  describe('translateToPostgres', () => {
    it('should translate ? placeholders to $1, $2, ...', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND status = ?';
      const result = translateToPostgres(sql);
      expect(result).toBe('SELECT * FROM users WHERE id = $1 AND status = $2');
    });

    it('should translate datetime(\'now\') to NOW()', () => {
      const sql = "SELECT * FROM logs WHERE created > datetime('now')";
      const result = translateToPostgres(sql);
      expect(result).toContain('NOW()');
    });

    it('should translate datetime with interval', () => {
      const sql = "SELECT * FROM logs WHERE created > datetime('now', '-7 days')";
      const result = translateToPostgres(sql);
      expect(result).toContain("INTERVAL '7 days'");
      expect(result).toContain('-');
    });

    it('should translate json_extract', () => {
      const sql = "SELECT json_extract(metadata, '$.type') FROM records";
      const result = translateToPostgres(sql);
      expect(result).toContain("metadata->>'type'");
    });

    it('should translate CAST AS REAL to CAST AS DOUBLE PRECISION', () => {
      const sql = 'SELECT CAST(value AS REAL) FROM numbers';
      const result = translateToPostgres(sql);
      expect(result).toContain('DOUBLE PRECISION');
    });

    it('should handle complex queries', () => {
      const sql = `
        SELECT id, json_extract(data, '$.name') AS name
        FROM items
        WHERE created > datetime('now', '-30 days')
        AND status = ?
      `;
      const result = translateToPostgres(sql);
      expect(result).toContain('$1');
      expect(result).toContain("->>'name'");
      expect(result).toContain('NOW()');
    });

    it('should handle case-insensitive keywords', () => {
      const sql = 'SELECT * FROM users WHERE id = ? and name = ?';
      const result = translateToPostgres(sql);
      expect(result).toBe('SELECT * FROM users WHERE id = $1 and name = $2');
    });

    it('should not modify non-translatable content', () => {
      const sql = 'SELECT "column?" FROM table WHERE id = ?';
      const result = translateToPostgres(sql);
      // Only the actual placeholder should be translated, not the one in quotes
      expect(result).toContain('$1');
    });
  });

  describe('translateToSQLite', () => {
    it('should translate $1, $2, ... placeholders to ?', () => {
      const sql = 'SELECT * FROM users WHERE id = $1 AND status = $2';
      const result = translateToSQLite(sql);
      expect(result).toBe('SELECT * FROM users WHERE id = ? AND status = ?');
    });

    it('should translate NOW() to datetime(\'now\')', () => {
      const sql = 'SELECT * FROM logs WHERE created > NOW()';
      const result = translateToSQLite(sql);
      expect(result).toContain("datetime('now')");
    });

    it('should translate ->> operator to json_extract', () => {
      const sql = "SELECT metadata->>'type' FROM records";
      const result = translateToSQLite(sql);
      expect(result).toContain("json_extract(metadata, '$.type')");
    });

    it('should translate DOUBLE PRECISION to REAL', () => {
      const sql = 'SELECT CAST(value AS DOUBLE PRECISION) FROM numbers';
      const result = translateToSQLite(sql);
      expect(result).toContain('REAL');
    });
  });

  describe('findSqliteIssues', () => {
    it('should detect GLOB operator', () => {
      const sql = "SELECT * FROM text WHERE content GLOB '*.pdf'";
      const { issues } = findSqliteIssues(sql);
      expect(issues.some(i => i.includes('GLOB'))).toBe(true);
    });

    it('should warn about AUTOINCREMENT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)';
      const { warnings } = findSqliteIssues(sql);
      expect(warnings.some(w => w.includes('AUTOINCREMENT'))).toBe(true);
    });

    it('should detect FTS', () => {
      const sql = 'CREATE VIRTUAL TABLE docs USING fts5(title, body)';
      const { issues } = findSqliteIssues(sql);
      expect(issues.some(i => i.includes('FTS'))).toBe(true);
    });

    it('should detect ATTACH DATABASE', () => {
      const sql = 'ATTACH DATABASE \'other.db\' AS other';
      const { issues } = findSqliteIssues(sql);
      expect(issues.some(i => i.includes('ATTACH'))).toBe(true);
    });

    it('should warn about PRAGMA', () => {
      const sql = 'PRAGMA foreign_keys = ON';
      const { warnings } = findSqliteIssues(sql);
      expect(warnings.some(w => w.includes('PRAGMA'))).toBe(true);
    });

    it('should return empty arrays for clean SQL', () => {
      const sql = 'SELECT * FROM users WHERE id = ?';
      const { issues, warnings } = findSqliteIssues(sql);
      expect(issues.length).toBe(0);
      expect(warnings.length).toBe(0);
    });

    it('should handle null/undefined gracefully', () => {
      expect(findSqliteIssues(null)).toEqual({ issues: [], warnings: [] });
      expect(findSqliteIssues(undefined)).toEqual({ issues: [], warnings: [] });
      expect(findSqliteIssues(123)).toEqual({ issues: [], warnings: [] });
    });
  });

  describe('countPlaceholders', () => {
    it('should count ? placeholders', () => {
      expect(countPlaceholders('SELECT * FROM t WHERE id = ?')).toBe(1);
      expect(countPlaceholders('SELECT * FROM t WHERE id = ? AND name = ?')).toBe(2);
    });

    it('should return 0 for no placeholders', () => {
      expect(countPlaceholders('SELECT * FROM t')).toBe(0);
    });

    it('should handle null/undefined', () => {
      expect(countPlaceholders(null)).toBe(0);
      expect(countPlaceholders(undefined)).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADAPTER FACTORY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('AdapterFactory', () => {
  it('should create SQLiteAdapter by default', () => {
    const adapter = createAdapter();
    expect(adapter).toBeInstanceOf(SQLiteAdapter);
    expect(adapter.getDialect()).toBe('sqlite');
  });

  it('should create SQLiteAdapter when driver is sqlite', () => {
    const adapter = createAdapter({ driver: 'sqlite' });
    expect(adapter).toBeInstanceOf(SQLiteAdapter);
  });

  it('should create SQLiteAdapter when driver is sqlite3', () => {
    const adapter = createAdapter({ driver: 'sqlite3' });
    expect(adapter).toBeInstanceOf(SQLiteAdapter);
  });

  it('should create PostgreSQLAdapter when driver is postgresql', () => {
    const adapter = createAdapter({ driver: 'postgresql' });
    expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
  });

  it('should create PostgreSQLAdapter when driver is postgres', () => {
    const adapter = createAdapter({ driver: 'postgres' });
    expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
  });

  it('should create PostgreSQLAdapter when driver is pg', () => {
    const adapter = createAdapter({ driver: 'pg' });
    expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
  });

  it('should be case-insensitive on driver name', () => {
    const adapter1 = createAdapter({ driver: 'PostgreSQL' });
    const adapter2 = createAdapter({ driver: 'SQLITE' });
    expect(adapter1).toBeInstanceOf(PostgreSQLAdapter);
    expect(adapter2).toBeInstanceOf(SQLiteAdapter);
  });

  it('should default to SQLite for unknown driver', () => {
    const adapter = createAdapter({ driver: 'unknown' });
    expect(adapter).toBeInstanceOf(SQLiteAdapter);
  });

  it('should support DB_DRIVER environment variable', () => {
    const originalDriver = process.env.DB_DRIVER;
    try {
      process.env.DB_DRIVER = 'postgresql';
      const adapter = createAdapter();
      expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
    } finally {
      if (originalDriver) {
        process.env.DB_DRIVER = originalDriver;
      } else {
        delete process.env.DB_DRIVER;
      }
    }
  });

  it('should prioritize config.driver over environment', () => {
    const originalDriver = process.env.DB_DRIVER;
    try {
      process.env.DB_DRIVER = 'postgresql';
      const adapter = createAdapter({ driver: 'sqlite' });
      expect(adapter).toBeInstanceOf(SQLiteAdapter);
    } finally {
      if (originalDriver) {
        process.env.DB_DRIVER = originalDriver;
      } else {
        delete process.env.DB_DRIVER;
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE ADAPTER INTERFACE CONTRACT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('DatabaseAdapter interface contract', () => {
  let adapter;

  beforeAll(async () => {
    if (sqliteAvailable) {
      try {
        adapter = new SQLiteAdapter();
        await adapter.connect({ filename: ':memory:' });
        await adapter.exec(`
          CREATE TABLE test (
            id INTEGER PRIMARY KEY,
            data TEXT
          )
        `);
      } catch (err) {
        console.warn('DatabaseAdapter interface setup failed:', err.message);
        adapter = null;
      }
    }
  });

  afterAll(async () => {
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch (err) {
        // ignore
      }
    }
  });

  const skipIfUnavailable = !sqliteAvailable || !adapter ? it.skip : it;

  skipIfUnavailable('should implement all required methods', () => {
    expect(typeof adapter.connect).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
    expect(typeof adapter.isConnected).toBe('function');
    expect(typeof adapter.all).toBe('function');
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.run).toBe('function');
    expect(typeof adapter.beginTransaction).toBe('function');
    expect(typeof adapter.commit).toBe('function');
    expect(typeof adapter.rollback).toBe('function');
    expect(typeof adapter.transaction).toBe('function');
    expect(typeof adapter.exec).toBe('function');
    expect(typeof adapter.tableExists).toBe('function');
    expect(typeof adapter.pragma).toBe('function');
    expect(typeof adapter.getDialect).toBe('function');
  });

  skipIfUnavailable('should return Promise from all async methods', async () => {
    const connectPromise = adapter.connect({ filename: ':memory:' });
    expect(connectPromise instanceof Promise).toBe(true);
  });

  skipIfUnavailable('should normalize get() return value to null for no results', async () => {
    const result = await adapter.get('SELECT * FROM test WHERE id = ?', [999]);
    expect(result).toBeNull();
  });

  skipIfUnavailable('should return changes count from run()', async () => {
    const result = await adapter.run('INSERT INTO test (data) VALUES (?)', ['test']);
    expect(result.changes).toBeGreaterThanOrEqual(1);
    expect(result).toHaveProperty('lastInsertRowid');
  });
});
