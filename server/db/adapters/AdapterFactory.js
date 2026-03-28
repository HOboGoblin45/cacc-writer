/**
 * server/db/adapters/AdapterFactory.js
 * ===================================
 * Factory for creating database adapters.
 *
 * Selects the appropriate adapter (SQLite or PostgreSQL) based on configuration
 * and environment variables. Uses a simple strategy:
 *   1. Check DB_DRIVER env var (sqlite, postgresql, postgres)
 *   2. Check config.driver parameter
 *   3. Default to SQLite for backward compatibility
 *
 * Usage:
 *   import { createAdapter } from './adapters/AdapterFactory.js';
 *
 *   // Auto-detect from environment
 *   const adapter = createAdapter();
 *   await adapter.connect();
 *
 *   // Or specify explicitly
 *   const pgAdapter = createAdapter({ driver: 'postgresql' });
 *   await pgAdapter.connect({ host: 'db.example.com', database: 'prod' });
 */

import log from '../../logger.js';
import { SQLiteAdapter } from './SQLiteAdapter.js';
import { PostgreSQLAdapter } from './PostgreSQLAdapter.js';

/**
 * Create a database adapter based on configuration.
 * Automatically detects the driver from environment or config.
 *
 * Priority:
 *   1. config.driver (if provided)
 *   2. process.env.DB_DRIVER
 *   3. Default to SQLite
 *
 * @param {Object} [config={}] - Configuration object
 * @param {string} [config.driver] - 'sqlite' or 'postgresql' (case-insensitive)
 * @param {string} [config.filename] - For SQLite: database file path
 * @param {string} [config.host] - For PostgreSQL: database host
 * @param {number} [config.port] - For PostgreSQL: database port
 * @param {string} [config.database] - For PostgreSQL: database name
 * @param {string} [config.user] - For PostgreSQL: username
 * @param {string} [config.password] - For PostgreSQL: password
 * @returns {DatabaseAdapter} An instance of SQLiteAdapter or PostgreSQLAdapter
 *
 * @example
 *   // Auto-detect from environment
 *   const adapter = createAdapter();
 *   // If DB_DRIVER=postgresql, creates PostgreSQLAdapter
 *   // Otherwise, creates SQLiteAdapter
 *
 *   // Explicit configuration
 *   const pgAdapter = createAdapter({ driver: 'postgresql', host: 'localhost' });
 */
export function createAdapter(config = {}) {
  // Determine driver
  const driver = (
    config.driver ||
    process.env.DB_DRIVER ||
    'sqlite'
  ).toLowerCase();

  log.debug('Creating database adapter', { driver });

  switch (driver) {
    case 'postgresql':
    case 'postgres':
    case 'pg':
      return new PostgreSQLAdapter();

    case 'sqlite':
    case 'sqlite3':
      return new SQLiteAdapter();

    default:
      log.warn('Unknown DB driver; defaulting to SQLite', { driver });
      return new SQLiteAdapter();
  }
}

/**
 * Create an adapter for per-user database isolation.
 *
 * For SQLite: each user gets a separate database file at data/users/{userId}/cacc.db
 * For PostgreSQL: currently uses a shared database (RLS planned for Phase 4)
 *
 * @param {string} userId - User ID (required)
 * @param {Object} [config={}] - Configuration object (same as createAdapter)
 * @returns {DatabaseAdapter}
 *
 * @example
 *   const userAdapter = createUserAdapter('user_123');
 *   await userAdapter.connect({
 *     filename: './data/users/user_123/cacc.db' // SQLite only
 *   });
 */
export function createUserAdapter(userId, config = {}) {
  if (!userId) {
    throw new Error('userId is required for user database isolation');
  }

  const driver = (
    config.driver ||
    process.env.DB_DRIVER ||
    'sqlite'
  ).toLowerCase();

  log.debug('Creating user database adapter', { userId, driver });

  switch (driver) {
    case 'postgresql':
    case 'postgres':
    case 'pg':
      // PostgreSQL: shared database, RLS or schema isolation planned
      return new PostgreSQLAdapter();

    case 'sqlite':
    case 'sqlite3':
      // SQLite: separate file per user
      const userDbPath = `./data/users/${userId}/cacc.db`;
      return new SQLiteAdapter();

    default:
      log.warn('Unknown DB driver; defaulting to SQLite', { driver });
      return new SQLiteAdapter();
  }
}

/**
 * Get the current database dialect from the adapter.
 * Useful for runtime SQL dialect checks.
 *
 * @param {DatabaseAdapter} adapter
 * @returns {string} 'sqlite' or 'postgresql'
 */
export function getDialect(adapter) {
  return adapter.getDialect();
}

/**
 * Check if using SQLite.
 *
 * @param {DatabaseAdapter} adapter
 * @returns {boolean}
 */
export function isSQLite(adapter) {
  return adapter.getDialect() === 'sqlite';
}

/**
 * Check if using PostgreSQL.
 *
 * @param {DatabaseAdapter} adapter
 * @returns {boolean}
 */
export function isPostgreSQL(adapter) {
  return adapter.getDialect() === 'postgresql';
}
