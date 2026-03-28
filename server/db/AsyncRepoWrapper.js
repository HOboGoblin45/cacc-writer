/**
 * server/db/AsyncRepoWrapper.js
 * ============================
 * Higher-order function to convert sync repository modules to async.
 *
 * This module provides utilities for wrapping synchronous repository functions
 * to make them awaitable during the migration phase. Both the sync and async
 * versions can coexist in the codebase.
 *
 * Usage:
 *   import * as syncRepo from './repositories/caseRecordRepo.js';
 *   const asyncRepo = wrapRepoAsync(syncRepo);
 *   const row = await asyncRepo.getCaseById(caseId);
 *
 * The wrapper:
 *   - Detects all exported functions
 *   - Wraps them in async functions (making them awaitable)
 *   - Preserves non-function exports as-is
 *   - Maintains error handling through try/catch
 *   - Works transparently with the sync source
 *
 * @module AsyncRepoWrapper
 */

import log from '../logger.js';

/**
 * Wraps all functions in a sync repository module to make them async.
 *
 * During migration, this allows code to call repository functions with await
 * even though they're internally synchronous. This enables a gradual migration
 * path where:
 *
 *   Phase 1: Wrap sync repos with wrapRepoAsync
 *   Phase 2: Update callers to await wrapped functions
 *   Phase 3: Replace wrapped repos with true async implementations
 *   Phase 4: Remove wrapper
 *
 * @param {Object} syncModule - A module with exported sync functions and constants
 * @returns {Object} Wrapped module with all functions converted to async
 *
 * @example
 *   import * as caseRepo from './repositories/caseRecordRepo.js';
 *   const asyncCaseRepo = wrapRepoAsync(caseRepo);
 *
 *   // Callers can now await
 *   const caseRecord = await asyncCaseRepo.getCaseById(db, caseId);
 *   const updated = await asyncCaseRepo.updateCaseStatus(db, caseId, newStatus);
 *   const results = await asyncCaseRepo.searchCases(db, query);
 *
 *   // Non-function exports are preserved
 *   console.log(asyncCaseRepo.CASE_STATUS); // Still available
 */
export function wrapRepoAsync(syncModule) {
  const wrapped = {};

  for (const [key, value] of Object.entries(syncModule)) {
    if (typeof value === 'function') {
      // Wrap the function to make it async
      wrapped[key] = async function (...args) {
        try {
          return value(...args);
        } catch (err) {
          log.error(`AsyncRepoWrapper:${key}`, {
            error: err.message,
            stack: err.stack,
          });
          throw err;
        }
      };
    } else {
      // Preserve non-function exports (constants, objects, etc.)
      wrapped[key] = value;
    }
  }

  return wrapped;
}

/**
 * Wraps a single sync function to make it async.
 * Useful for wrapping individual functions rather than entire modules.
 *
 * @param {Function} syncFn - Synchronous function to wrap
 * @param {string} [fnName='unknown'] - Function name for logging
 * @returns {Function} Async wrapper function
 *
 * @example
 *   import { getCaseById } from './repositories/caseRecordRepo.js';
 *   const asyncGetCaseById = wrapFunctionAsync(getCaseById, 'getCaseById');
 *   const caseRecord = await asyncGetCaseById(db, caseId);
 */
export function wrapFunctionAsync(syncFn, fnName = 'unknown') {
  return async function wrappedAsyncFn(...args) {
    try {
      return syncFn(...args);
    } catch (err) {
      log.error(`AsyncRepoWrapper:${fnName}`, {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  };
}

/**
 * Conditionally wrap a module based on a flag.
 * Useful for feature-flagging the async conversion.
 *
 * @param {Object} syncModule - The sync repository module
 * @param {boolean} [enableAsync=false] - Whether to wrap as async
 * @returns {Object} Either the original module or wrapped version
 *
 * @example
 *   import * as caseRepo from './repositories/caseRecordRepo.js';
 *   const repo = wrapRepoConditional(caseRepo, process.env.USE_ASYNC_REPOS === 'true');
 *   // If enabled: callers must await; if disabled: callers call sync
 */
export function wrapRepoConditional(syncModule, enableAsync = false) {
  if (enableAsync) {
    return wrapRepoAsync(syncModule);
  }
  return syncModule;
}
