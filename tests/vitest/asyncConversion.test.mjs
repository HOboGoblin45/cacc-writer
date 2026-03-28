/**
 * tests/vitest/asyncConversion.test.mjs
 * ====================================
 * Test suite for async conversion infrastructure.
 *
 * Tests:
 *   - AsyncQueryRunner wrapping sync databases
 *   - AsyncQueryRunner wrapping async adapters
 *   - All query methods (run, get, all, exec, transaction)
 *   - AsyncRepoWrapper function wrapping
 *   - Migration helper detection and utilities
 *   - generationRepoAsync basic operations
 *
 * Run with:
 *   npm test -- asyncConversion.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAsyncRunner, AsyncQueryRunner } from '../../server/db/AsyncQueryRunner.js';
import {
  wrapRepoAsync,
  wrapFunctionAsync,
  wrapRepoConditional,
} from '../../server/db/AsyncRepoWrapper.js';
import {
  isAsyncAdapter,
  isSyncDb,
  makeAsyncQuery,
  makeAsyncGet,
  makeAsyncRun,
  createDualModeFunction,
  detectDialect,
  validateModuleFunctions,
} from '../../server/db/migrationHelpers.js';

// ── Mock database and adapter ──────────────────────────────────────────────

/**
 * Mock sync database (like better-sqlite3)
 */
class MockSyncDb {
  constructor() {
    this._data = {};
    this._lastInsertRowid = 1;
    this._statements = {};
  }

  prepare(sql) {
    return new MockPreparedStatement(sql, this._data, this);
  }

  exec(sql) {
    // No-op for mock
  }

  transaction(fn) {
    return fn;
  }
}

/**
 * Mock prepared statement
 */
class MockPreparedStatement {
  constructor(sql, data, db) {
    this.sql = sql;
    this.data = data;
    this.db = db;
  }

  run(...params) {
    // Simple mock: increment changes
    return {
      changes: 1,
      lastInsertRowid: ++this.db._lastInsertRowid,
    };
  }

  get(...params) {
    // Return mock data
    return { id: 'test-id', value: 'test-value' };
  }

  all(...params) {
    // Return mock array
    return [{ id: 'test-id-1' }, { id: 'test-id-2' }];
  }
}

/**
 * Mock async adapter
 */
class MockAsyncAdapter {
  constructor() {
    this._data = {};
  }

  async run(sql, params = []) {
    return { changes: 1, lastInsertRowid: 123 };
  }

  async get(sql, params = []) {
    return { id: 'async-id', value: 'async-value' };
  }

  async all(sql, params = []) {
    return [{ id: 'async-id-1' }, { id: 'async-id-2' }];
  }

  async exec(sql) {
    // No-op
  }

  async transaction(fn) {
    return fn();
  }

  getDialect() {
    return 'postgresql';
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AsyncQueryRunner', () => {
  let syncDb;
  let asyncAdapter;

  beforeEach(() => {
    syncDb = new MockSyncDb();
    asyncAdapter = new MockAsyncAdapter();
  });

  describe('with sync database', () => {
    it('should wrap sync db and run queries', async () => {
      const runner = createAsyncRunner(syncDb);
      expect(runner).toBeInstanceOf(AsyncQueryRunner);
      expect(runner.isAsync()).toBe(false);
    });

    it('should execute run queries on sync db', async () => {
      const runner = createAsyncRunner(syncDb);
      const result = await runner.run('INSERT INTO test VALUES (?, ?)', ['id1', 'value1']);
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should execute get queries on sync db', async () => {
      const runner = createAsyncRunner(syncDb);
      const row = await runner.get('SELECT * FROM test WHERE id = ?', ['id1']);
      expect(row).toBeDefined();
      expect(row.id).toBe('test-id');
    });

    it('should execute all queries on sync db', async () => {
      const runner = createAsyncRunner(syncDb);
      const rows = await runner.all('SELECT * FROM test', []);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(2);
    });

    it('should execute exec on sync db', async () => {
      const runner = createAsyncRunner(syncDb);
      await expect(runner.exec('CREATE TABLE test (id TEXT)')).resolves.toBeUndefined();
    });

    it('should execute transactions on sync db', async () => {
      const runner = createAsyncRunner(syncDb);
      const result = await runner.transaction(() => 'success');
      expect(result).toBe('success');
    });

    it('should return correct dialect for sync db', () => {
      const runner = createAsyncRunner(syncDb);
      expect(runner.getDialect()).toBe('sqlite');
    });
  });

  describe('with async adapter', () => {
    it('should wrap async adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      expect(runner).toBeInstanceOf(AsyncQueryRunner);
      expect(runner.isAsync()).toBe(true);
    });

    it('should execute run queries on adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      const result = await runner.run('INSERT INTO test VALUES (?, ?)', ['id1', 'value1']);
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(123);
    });

    it('should execute get queries on adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      const row = await runner.get('SELECT * FROM test WHERE id = ?', ['id1']);
      expect(row).toBeDefined();
      expect(row.id).toBe('async-id');
    });

    it('should execute all queries on adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      const rows = await runner.all('SELECT * FROM test', []);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(2);
    });

    it('should execute exec on adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      await expect(runner.exec('CREATE TABLE test (id TEXT)')).resolves.toBeUndefined();
    });

    it('should execute transactions on adapter', async () => {
      const runner = createAsyncRunner(asyncAdapter);
      const result = await runner.transaction(async () => 'success');
      expect(result).toBe('success');
    });

    it('should return correct dialect for adapter', () => {
      const runner = createAsyncRunner(asyncAdapter);
      expect(runner.getDialect()).toBe('postgresql');
    });
  });

  describe('error handling', () => {
    it('should log and throw errors from run', async () => {
      const badDb = {
        prepare: () => {
          throw new Error('SQL error');
        },
      };
      const runner = createAsyncRunner(badDb);
      await expect(runner.run('BAD SQL')).rejects.toThrow('SQL error');
    });
  });
});

describe('AsyncRepoWrapper', () => {
  it('should wrap sync functions to be async', async () => {
    const syncModule = {
      getCaseById: (db, id) => ({ id, name: 'Test Case' }),
      createCase: (db, name) => ({ id: 'new-id', name }),
      VERSION: '1.0.0',
    };

    const asyncModule = wrapRepoAsync(syncModule);

    // Functions should be async (return promises)
    expect(asyncModule.getCaseById).toBeDefined();
    expect(asyncModule.getCaseById.constructor.name).toBe('AsyncFunction');

    // Non-function exports should be preserved
    expect(asyncModule.VERSION).toBe('1.0.0');

    // Should be awaitable
    const caseRecord = await asyncModule.getCaseById(null, 'case-1');
    expect(caseRecord.id).toBe('case-1');
  });

  it('should wrap individual functions', async () => {
    const syncFn = (db, id) => ({ id, value: 'sync' });
    const asyncFn = wrapFunctionAsync(syncFn, 'testFn');

    expect(asyncFn.constructor.name).toBe('AsyncFunction');
    const result = await asyncFn(null, 'id1');
    expect(result.value).toBe('sync');
  });

  it('should conditionally wrap based on flag', () => {
    const syncModule = {
      getValue: (db) => 'value',
    };

    const wrapped = wrapRepoConditional(syncModule, true);
    expect(wrapped).not.toBe(syncModule);
    expect(typeof wrapped.getValue).toBe('function');

    const notWrapped = wrapRepoConditional(syncModule, false);
    expect(notWrapped).toBe(syncModule);
  });
});

describe('migration helpers', () => {
  let syncDb;
  let asyncAdapter;

  beforeEach(() => {
    syncDb = new MockSyncDb();
    asyncAdapter = new MockAsyncAdapter();
  });

  describe('isAsyncAdapter', () => {
    it('should detect async adapter', () => {
      expect(isAsyncAdapter(asyncAdapter)).toBe(true);
    });

    it('should reject sync db as async', () => {
      expect(isAsyncAdapter(syncDb)).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(isAsyncAdapter(null)).toBe(false);
      expect(isAsyncAdapter(undefined)).toBe(false);
    });
  });

  describe('isSyncDb', () => {
    it('should detect sync database', () => {
      expect(isSyncDb(syncDb)).toBe(true);
    });

    it('should reject async adapter as sync', () => {
      expect(isSyncDb(asyncAdapter)).toBe(false);
    });
  });

  describe('detectDialect', () => {
    it('should detect sqlite for sync db', () => {
      expect(detectDialect(syncDb)).toBe('sqlite');
    });

    it('should detect postgresql for async adapter', () => {
      expect(detectDialect(asyncAdapter)).toBe('postgresql');
    });

    it('should return unknown for invalid input', () => {
      expect(detectDialect({})).toBe('unknown');
      expect(detectDialect(null)).toBe('unknown');
    });
  });

  describe('makeAsyncQuery', () => {
    it('should work with sync db', async () => {
      const rows = await makeAsyncQuery(syncDb, 'SELECT * FROM test');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(2);
    });

    it('should work with async adapter', async () => {
      const rows = await makeAsyncQuery(asyncAdapter, 'SELECT * FROM test');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(2);
    });
  });

  describe('makeAsyncGet', () => {
    it('should work with sync db', async () => {
      const row = await makeAsyncGet(syncDb, 'SELECT * FROM test WHERE id = ?', ['id1']);
      expect(row).toBeDefined();
      expect(row.id).toBe('test-id');
    });

    it('should work with async adapter', async () => {
      const row = await makeAsyncGet(asyncAdapter, 'SELECT * FROM test WHERE id = ?', ['id1']);
      expect(row).toBeDefined();
      expect(row.id).toBe('async-id');
    });
  });

  describe('makeAsyncRun', () => {
    it('should work with sync db', async () => {
      const result = await makeAsyncRun(syncDb, 'INSERT INTO test VALUES (?, ?)', ['id1', 'value1']);
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    it('should work with async adapter', async () => {
      const result = await makeAsyncRun(asyncAdapter, 'INSERT INTO test VALUES (?, ?)', ['id1', 'value1']);
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(123);
    });
  });

  describe('createDualModeFunction', () => {
    it('should call sync impl with sync db', () => {
      const syncImpl = vi.fn(() => 'sync result');
      const asyncImpl = vi.fn();

      const dualFn = createDualModeFunction(syncImpl, asyncImpl, 'testFn');
      const result = dualFn(syncDb, 'arg1', 'arg2');

      expect(syncImpl).toHaveBeenCalledWith(syncDb, 'arg1', 'arg2');
      expect(asyncImpl).not.toHaveBeenCalled();
      expect(result).toBe('sync result');
    });

    it('should call async impl with async adapter', () => {
      const syncImpl = vi.fn();
      const asyncImpl = vi.fn(() => Promise.resolve('async result'));

      const dualFn = createDualModeFunction(syncImpl, asyncImpl, 'testFn');
      const result = dualFn(asyncAdapter, 'arg1', 'arg2');

      expect(asyncImpl).toHaveBeenCalledWith(asyncAdapter, 'arg1', 'arg2');
      expect(syncImpl).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('validateModuleFunctions', () => {
    it('should pass validation when all functions exist', () => {
      const module = {
        getCaseById: () => {},
        createCase: () => {},
      };
      expect(() => {
        validateModuleFunctions(module, ['getCaseById', 'createCase'], 'testModule');
      }).not.toThrow();
    });

    it('should throw when functions are missing', () => {
      const module = {
        getCaseById: () => {},
      };
      expect(() => {
        validateModuleFunctions(module, ['getCaseById', 'updateCase'], 'testModule');
      }).toThrow('missing required functions: updateCase');
    });

    it('should throw when functions are not actually functions', () => {
      const module = {
        getCaseById: 'not a function',
      };
      expect(() => {
        validateModuleFunctions(module, ['getCaseById'], 'testModule');
      }).toThrow('missing required functions: getCaseById');
    });
  });
});

describe('integration: AsyncQueryRunner with migration helpers', () => {
  it('should seamlessly switch between sync and async', async () => {
    const syncDb = new MockSyncDb();
    const asyncAdapter = new MockAsyncAdapter();

    // Sync path
    const syncRunner = createAsyncRunner(syncDb);
    const syncResult = await syncRunner.all('SELECT * FROM test');
    expect(syncResult.length).toBe(2);
    expect(syncResult[0].id).toBe('test-id-1');

    // Async path
    const asyncRunner = createAsyncRunner(asyncAdapter);
    const asyncResult = await asyncRunner.all('SELECT * FROM test');
    expect(asyncResult.length).toBe(2);
    expect(asyncResult[0].id).toBe('async-id-1');

    // Both dialects correct
    expect(syncRunner.getDialect()).toBe('sqlite');
    expect(asyncRunner.getDialect()).toBe('postgresql');
  });
});
