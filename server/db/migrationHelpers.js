/**
 * server/db/migrationHelpers.js
 * ============================
 * Utility functions for the sync → async database migration.
 *
 * During the conversion from synchronous better-sqlite3 to async-ready patterns,
 * these helpers detect source types, create flexible query functions, and
 * manage backward compatibility.
 *
 * Key responsibilities:
 *   1. Detect whether an object is a sync db or async adapter
 *   2. Create query functions that work with both types
 *   3. Provide dual-mode repository functions for gradual conversion
 *
 * @module migrationHelpers
 */

import log from '../logger.js';

/**
 * Detect whether a db-like object is a sync better-sqlite3 instance
 * or an async adapter (has getDialect method).
 *
 * @param {Object} obj - The object to check
 * @returns {boolean} True if obj is an async adapter, false if sync
 *
 * @example
 *   import { getDb } from './database.js';
 *   const db = getDb();
 *   console.log(isAsyncAdapter(db)); // false (sync)
 *
 *   import { SQLiteAdapter } from './adapters/SQLiteAdapter.js';
 *   const adapter = new SQLiteAdapter();
 *   console.log(isAsyncAdapter(adapter)); // true
 */
export function isAsyncAdapter(obj) {
  return typeof obj?.getDialect === 'function';
}

/**
 * Detect if an object is a sync better-sqlite3 database.
 * Inverse of isAsyncAdapter.
 *
 * @param {Object} obj - The object to check
 * @returns {boolean} True if obj is a sync database
 */
export function isSyncDb(obj) {
  return !isAsyncAdapter(obj) && typeof obj?.prepare === 'function';
}

/**
 * Create a query function that works with both sync and async sources.
 * Returns a promise-based function that can be used with await.
 *
 * For sync databases, wraps the result in Promise.resolve().
 * For async adapters, returns the adapter's promise directly.
 *
 * @param {Object} dbOrAdapter - Either a better-sqlite3 database or a DatabaseAdapter
 * @param {string} sql - SQL query
 * @param {Array<any>} [params=[]] - Query parameters
 * @returns {Promise<Array<Object>>} Promise resolving to query results
 *
 * @example
 *   const db = getDb();
 *   const rows = await makeAsyncQuery(db, 'SELECT * FROM cases WHERE status = ?', ['active']);
 *
 *   const adapter = new SQLiteAdapter();
 *   const rows = await makeAsyncQuery(adapter, 'SELECT * FROM cases WHERE status = ?', ['active']);
 */
export function makeAsyncQuery(dbOrAdapter, sql, params = []) {
  if (isAsyncAdapter(dbOrAdapter)) {
    return dbOrAdapter.all(sql, params);
  }
  // Sync database path — wrap in promise
  try {
    const result = dbOrAdapter.prepare(sql).all(...params);
    return Promise.resolve(result);
  } catch (err) {
    log.error('makeAsyncQuery:error', {
      sql: sql.substring(0, 100),
      error: err.message,
    });
    return Promise.reject(err);
  }
}

/**
 * Create a single-row query function that works with both sync and async sources.
 * Returns null or the first matching row.
 *
 * @param {Object} dbOrAdapter - Either a better-sqlite3 database or a DatabaseAdapter
 * @param {string} sql - SQL query
 * @param {Array<any>} [params=[]] - Query parameters
 * @returns {Promise<Object|null|undefined>}
 *
 * @example
 *   const row = await makeAsyncGet(db, 'SELECT * FROM cases WHERE id = ?', [caseId]);
 */
export function makeAsyncGet(dbOrAdapter, sql, params = []) {
  if (isAsyncAdapter(dbOrAdapter)) {
    return dbOrAdapter.get(sql, params);
  }
  try {
    const result = dbOrAdapter.prepare(sql).get(...params);
    return Promise.resolve(result);
  } catch (err) {
    log.error('makeAsyncGet:error', {
      sql: sql.substring(0, 100),
      error: err.message,
    });
    return Promise.reject(err);
  }
}

/**
 * Create a write query function (INSERT/UPDATE/DELETE) that works with both sources.
 * Returns { changes, lastInsertRowid }.
 *
 * @param {Object} dbOrAdapter - Either a better-sqlite3 database or a DatabaseAdapter
 * @param {string} sql - SQL query (INSERT, UPDATE, or DELETE)
 * @param {Array<any>} [params=[]] - Query parameters
 * @returns {Promise<{changes: number, lastInsertRowid: number|bigint|null}>}
 *
 * @example
 *   const result = await makeAsyncRun(
 *     db,
 *     'INSERT INTO cases (id, status) VALUES (?, ?)',
 *     [caseId, 'active']
 *   );
 *   console.log(result.changes, result.lastInsertRowid);
 */
export function makeAsyncRun(dbOrAdapter, sql, params = []) {
  if (isAsyncAdapter(dbOrAdapter)) {
    return dbOrAdapter.run(sql, params);
  }
  try {
    const info = dbOrAdapter.prepare(sql).run(...params);
    const result = {
      changes: info.changes,
      lastInsertRowid: info.lastInsertRowid ?? null,
    };
    return Promise.resolve(result);
  } catch (err) {
    log.error('makeAsyncRun:error', {
      sql: sql.substring(0, 100),
      error: err.message,
    });
    return Promise.reject(err);
  }
}

/**
 * Create a dual-mode repository function that works with both sync and async sources.
 * Returns a function that accepts either a sync db or async adapter as first argument.
 *
 * This is useful for gradual migration: you can create a new async-friendly version
 * of a function that still supports both sync and async at call time.
 *
 * During full conversion, these dual-mode functions can be removed and replaced
 * with true async implementations.
 *
 * @param {Function} syncImpl - The synchronous implementation
 * @param {Function} asyncImpl - The asynchronous implementation (receives adapter, ...args)
 * @param {string} [fnName='unknown'] - Function name for error logging
 * @returns {Function} Dual-mode function
 *
 * @example
 *   // Old sync function
 *   function getCaseByIdSync(db, caseId) {
 *     return db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
 *   }
 *
 *   // New async implementation
 *   async function getCaseByIdAsync(adapter, caseId) {
 *     return adapter.get('SELECT * FROM cases WHERE id = ?', [caseId]);
 *   }
 *
 *   // Create dual-mode version
 *   const getCaseById = createDualModeFunction(
 *     getCaseByIdSync,
 *     getCaseByIdAsync,
 *     'getCaseById'
 *   );
 *
 *   // Call with sync database (returns sync result)
 *   const case1 = getCaseById(syncDb, caseId);
 *
 *   // Call with async adapter (returns promise)
 *   const case2 = await getCaseById(asyncAdapter, caseId);
 */
export function createDualModeFunction(syncImpl, asyncImpl, fnName = 'unknown') {
  return function dualMode(dbOrAdapter, ...args) {
    if (isAsyncAdapter(dbOrAdapter)) {
      // Async path: return promise from asyncImpl
      return asyncImpl(dbOrAdapter, ...args);
    }
    // Sync path: call syncImpl immediately
    try {
      return syncImpl(dbOrAdapter, ...args);
    } catch (err) {
      log.error(`dualMode:${fnName}:sync`, {
        error: err.message,
      });
      throw err;
    }
  };
}

/**
 * Detect the database dialect from any db or adapter object.
 *
 * @param {Object} dbOrAdapter - The source object
 * @returns {string} Either 'sqlite' or 'postgresql', or 'unknown'
 */
export function detectDialect(dbOrAdapter) {
  if (isAsyncAdapter(dbOrAdapter)) {
    return dbOrAdapter.getDialect();
  }
  if (isSyncDb(dbOrAdapter)) {
    return 'sqlite';
  }
  return 'unknown';
}

/**
 * Validate that all required functions exist in a module.
 * Useful for catching missing implementations during migration.
 *
 * @param {Object} module - The module to validate
 * @param {Array<string>} requiredFunctions - List of function names to check
 * @param {string} [moduleName='module'] - Name for error messages
 * @throws {Error} If any required function is missing
 *
 * @example
 *   import * as caseRepo from './repositories/caseRecordRepo.js';
 *   validateModuleFunctions(caseRepo, [
 *     'getCaseById',
 *     'createCase',
 *     'updateCaseStatus'
 *   ], 'caseRepo');
 */
export function validateModuleFunctions(module, requiredFunctions, moduleName = 'module') {
  const missing = [];
  for (const fnName of requiredFunctions) {
    if (typeof module[fnName] !== 'function') {
      missing.push(fnName);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${moduleName} is missing required functions: ${missing.join(', ')}`
    );
  }
}
