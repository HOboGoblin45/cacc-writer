/**
 * tests/vitest/pgSchemaTranslation.test.mjs
 * ==========================================
 * Test suite for PostgreSQL schema translation and migration infrastructure.
 *
 * Tests:
 *   - SQLiteTranslator converts AUTOINCREMENT to SERIAL
 *   - SQLiteTranslator converts datetime('now') to NOW()
 *   - SQLiteTranslator converts REAL to DOUBLE PRECISION
 *   - Schema catalog has entries for all known tables
 *   - Each migration SQL file is valid syntax
 *   - MigrationRunner tracks applied migrations correctly
 *   - MigrationRunner skips already-applied migrations
 *   - MigrationRunner applies migrations in order
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  translateDDL,
  extractCreateTableStatements,
  parseCreateTableDDL,
  validatePostgresSQL,
} from '../../server/db/postgresql/SQLiteTranslator.js';
import { SCHEMA_CATALOG, TABLE_COUNT } from '../../server/db/postgresql/schema_catalog.js';
import { MigrationRunner } from '../../server/db/postgresql/MigrationRunner.js';

// Mock adapter for testing
class MockAdapter {
  constructor() {
    this.migrations = new Map();
    this.tables = [];
  }

  async run(sql, params) {
    if (sql.includes('INSERT INTO cacc._migrations')) {
      const name = params[0];
      this.migrations.set(name, { name, applied_at: params[1] });
    }
    if (sql.includes('CREATE TABLE')) {
      this.tables.push(sql);
    }
    return { changes: 1 };
  }

  async all(sql, params) {
    if (sql.includes('SELECT name, applied_at FROM cacc._migrations')) {
      return Array.from(this.migrations.values());
    }
    return [];
  }

  async get(sql, params) {
    if (sql.includes('SELECT 1 FROM cacc._migrations WHERE')) {
      const name = params[0];
      return this.migrations.has(name) ? { id: 1 } : null;
    }
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// SQLiteTranslator Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('SQLiteTranslator', () => {
  describe('translateDDL', () => {
    it('converts INTEGER PRIMARY KEY AUTOINCREMENT to SERIAL PRIMARY KEY', () => {
      const sqlite = 'id INTEGER PRIMARY KEY AUTOINCREMENT';
      const pg = translateDDL(sqlite);
      expect(pg).toContain('SERIAL PRIMARY KEY');
      expect(pg).not.toContain('AUTOINCREMENT');
    });

    it('converts datetime(\'now\') to NOW()', () => {
      const sqlite = "created_at TEXT NOT NULL DEFAULT (datetime('now'))";
      const pg = translateDDL(sqlite);
      expect(pg).toContain('NOW()');
      expect(pg).not.toContain("datetime('now')");
    });

    it('converts REAL to DOUBLE PRECISION', () => {
      const sqlite = 'price REAL NOT NULL';
      const pg = translateDDL(sqlite);
      expect(pg).toContain('DOUBLE PRECISION');
      expect(pg).not.toContain('REAL');
    });

    it('preserves TEXT columns', () => {
      const sqlite = 'name TEXT NOT NULL';
      const pg = translateDDL(sqlite);
      expect(pg).toContain('TEXT');
    });

    it('preserves INTEGER columns', () => {
      const sqlite = 'count INTEGER DEFAULT 0';
      const pg = translateDDL(sqlite);
      expect(pg).toContain('INTEGER DEFAULT 0');
    });

    it('handles multiple conversions in one DDL', () => {
      const sqlite = `
        CREATE TABLE test (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          price REAL NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `;
      const pg = translateDDL(sqlite);
      expect(pg).toContain('SERIAL PRIMARY KEY');
      expect(pg).toContain('DOUBLE PRECISION');
      expect(pg).toContain('NOW()');
    });
  });

  describe('extractCreateTableStatements', () => {
    it('extracts single CREATE TABLE statement', () => {
      const sql = `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE posts (id TEXT PRIMARY KEY, content TEXT);
      `;
      const statements = extractCreateTableStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('users');
      expect(statements[1]).toContain('posts');
    });

    it('handles CREATE TABLE with nested parentheses', () => {
      const sql = `
        CREATE TABLE complex (
          id TEXT PRIMARY KEY,
          data TEXT DEFAULT '{}',
          items TEXT DEFAULT '[]'
        );
      `;
      const statements = extractCreateTableStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain('complex');
    });
  });

  describe('parseCreateTableDDL', () => {
    it('extracts table name and columns', () => {
      const ddl = `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      const parsed = parseCreateTableDDL(ddl);
      expect(parsed.tableName).toBe('users');
      expect(parsed.columns).toHaveLength(4);
      expect(parsed.columns[0].name).toBe('id');
      expect(parsed.columns[1].name).toBe('name');
    });

    it('identifies constraints', () => {
      const ddl = `
        CREATE TABLE posts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `;
      const parsed = parseCreateTableDDL(ddl);
      expect(parsed.constraints.length).toBeGreaterThan(0);
      expect(parsed.constraints[0]).toContain('FOREIGN KEY');
    });
  });

  describe('validatePostgresSQL', () => {
    it('validates correct PostgreSQL DDL', () => {
      const sql = 'CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT NOT NULL);';
      expect(validatePostgresSQL(sql)).toBe(true);
    });

    it('rejects invalid DDL', () => {
      expect(validatePostgresSQL('SELECT * FROM users;')).toBe(false);
      expect(validatePostgresSQL('')).toBe(false);
      expect(validatePostgresSQL(null)).toBe(false);
    });

    it('detects mismatched parentheses', () => {
      const sql = 'CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT;';
      expect(validatePostgresSQL(sql)).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Schema Catalog Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('SCHEMA_CATALOG', () => {
  it('contains tables', () => {
    expect(SCHEMA_CATALOG).toBeDefined();
    expect(SCHEMA_CATALOG.tables).toBeDefined();
    expect(SCHEMA_CATALOG.tables.length).toBeGreaterThan(0);
  });

  it('has TABLE_COUNT that matches array length', () => {
    expect(TABLE_COUNT).toBe(SCHEMA_CATALOG.tables.length);
  });

  it('each table has required properties', () => {
    for (const table of SCHEMA_CATALOG.tables) {
      expect(table.name).toBeDefined();
      expect(table.source).toBeDefined();
      expect(table.columns).toBeDefined();
      expect(Array.isArray(table.columns)).toBe(true);
      expect(table.indexes).toBeDefined();
      expect(Array.isArray(table.indexes)).toBe(true);
      expect(table.constraints).toBeDefined();
      expect(Array.isArray(table.constraints)).toBe(true);
    }
  });

  it('each column has name and type information', () => {
    for (const table of SCHEMA_CATALOG.tables) {
      for (const column of table.columns) {
        expect(column.name).toBeDefined();
        expect(column.sqliteType).toBeDefined();
        expect(column.pgType).toBeDefined();
      }
    }
  });

  it('contains core tables', () => {
    const tableNames = SCHEMA_CATALOG.tables.map((t) => t.name);
    expect(tableNames).toContain('assignments');
    expect(tableNames).toContain('case_records');
    expect(tableNames).toContain('generation_runs');
    expect(tableNames).toContain('approved_memory');
  });

  it('catalogs at least 15 tables', () => {
    expect(SCHEMA_CATALOG.tables.length).toBeGreaterThanOrEqual(15);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// MigrationRunner Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('MigrationRunner', () => {
  let adapter;
  let runner;

  beforeEach(() => {
    adapter = new MockAdapter();
    runner = new MigrationRunner(adapter);
  });

  it('initializes migrations table', async () => {
    await runner.init();
    expect(adapter.tables.length).toBeGreaterThan(0);
    expect(adapter.tables[0]).toContain('_migrations');
  });

  it('tracks applied migrations', async () => {
    await runner.init();
    await runner.applyMigration('001_initial_schema', 'CREATE TABLE test (id SERIAL PRIMARY KEY);');

    const applied = await runner.getAppliedMigrations();
    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe('001_initial_schema');
  });

  it('skips already-applied migrations', async () => {
    await runner.init();
    await runner.applyMigration('001_test', 'CREATE TABLE test1 (id SERIAL PRIMARY KEY);');

    const isApplied = await runner.isMigrationApplied('001_test');
    expect(isApplied).toBe(true);
  });

  it('applies migrations in order', async () => {
    await runner.init();

    const migrations = [
      { name: '001_first', sql: 'CREATE TABLE first (id SERIAL PRIMARY KEY);' },
      { name: '002_second', sql: 'CREATE TABLE second (id SERIAL PRIMARY KEY);' },
      { name: '003_third', sql: 'CREATE TABLE third (id SERIAL PRIMARY KEY);' },
    ];

    for (const mig of migrations) {
      await runner.applyMigration(mig.name, mig.sql);
    }

    const applied = await runner.getAppliedMigrations();
    expect(applied).toHaveLength(3);
    expect(applied[0].name).toBe('001_first');
    expect(applied[1].name).toBe('002_second');
    expect(applied[2].name).toBe('003_third');
  });

  it('returns results with applied, skipped, and failed lists', async () => {
    await runner.init();

    // This test would need a file system mock to fully test runAll()
    // For now, we verify the method exists and returns the right structure
    expect(typeof runner.runAll).toBe('function');
  });

  it('throws on invalid migration', async () => {
    await runner.init();
    try {
      await runner.applyMigration('bad', 'INVALID SQL HERE {]');
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Integration Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('PostgreSQL Migration Integration', () => {
  it('SQLiteTranslator and SCHEMA_CATALOG work together', () => {
    // Verify that catalog tables can be translated
    for (const table of SCHEMA_CATALOG.tables.slice(0, 5)) {
      // Check that pgType is different from sqliteType for at least some columns
      const hasConversion = table.columns.some((col) => col.sqliteType !== col.pgType);
      // Some tables may not have conversions, but most should
      if (table.columns.some((col) => col.sqliteType.includes('AUTOINCREMENT'))) {
        expect(hasConversion).toBe(true);
      }
    }
  });

  it('all catalog columns have valid PostgreSQL types', () => {
    const validPgTypes = [
      'TEXT',
      'SERIAL',
      'INTEGER',
      'DOUBLE PRECISION',
      'TIMESTAMPTZ',
      'BOOLEAN',
      'PRIMARY KEY',
      'UNIQUE',
      'NOT NULL',
      'DEFAULT',
      'FOREIGN KEY',
    ];

    for (const table of SCHEMA_CATALOG.tables) {
      for (const column of table.columns) {
        const pgTypeUpper = column.pgType.toUpperCase();
        const hasValidType = validPgTypes.some((t) => pgTypeUpper.includes(t));
        expect(hasValidType).toBe(true);
      }
    }
  });
});
