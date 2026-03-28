/**
 * server/db/adapters/index.js
 * ==========================
 * Barrel export for all adapter components.
 *
 * Usage:
 *   import {
 *     DatabaseAdapter,
 *     SQLiteAdapter,
 *     PostgreSQLAdapter,
 *     createAdapter,
 *     createUserAdapter,
 *     translateToPostgres,
 *     translateToSQLite,
 *   } from './adapters/index.js';
 */

export { DatabaseAdapter } from './DatabaseAdapter.js';
export { SQLiteAdapter } from './SQLiteAdapter.js';
export { PostgreSQLAdapter } from './PostgreSQLAdapter.js';
export {
  createAdapter,
  createUserAdapter,
  getDialect,
  isSQLite,
  isPostgreSQL,
} from './AdapterFactory.js';
export {
  translateToPostgres,
  translateToSQLite,
  findSqliteIssues,
  hasOnlyValidPlaceholders,
  countPlaceholders,
} from './QueryTranslator.js';
