/**
 * server/db/userDatabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-user SQLite database management for SaaS multi-tenancy.
 *
 * Each authenticated user gets an isolated database at:
 *   data/users/<userId>/appraisal.db
 *
 * Falls back to the shared DB for dev-local / missing userId.
 *
 * Usage:
 *   import { getUserDb, closeUserDb, closeAllUserDbs } from './userDatabase.js';
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initSchema } from './schema.js';
import { getDb } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_DB_DIR = path.join(__dirname, '..', '..', 'data', 'users');

const _userDbs = new Map();

/**
 * Get a per-user SQLite database for tenant isolation.
 * Creates the directory and initializes schema if this is the first access.
 * Falls back to the shared DB for dev-local or missing userId.
 *
 * @param {string} userId
 * @returns {import('better-sqlite3').Database}
 */
export function getUserDb(userId) {
  if (!userId || userId === 'dev-local' || userId === 'default') {
    return getDb();
  }
  if (_userDbs.has(userId)) return _userDbs.get(userId);

  const userDir = path.join(USERS_DB_DIR, userId);
  fs.mkdirSync(userDir, { recursive: true });

  const userDbPath = path.join(userDir, 'appraisal.db');
  const db = new BetterSqlite3(userDbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('temp_store = MEMORY');

  initSchema(db);

  _userDbs.set(userId, db);
  return db;
}

/**
 * Close a specific user's database connection.
 *
 * @param {string} userId
 */
export function closeUserDb(userId) {
  const db = _userDbs.get(userId);
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    _userDbs.delete(userId);
  }
}

/**
 * Close all open user database connections.
 * Call this on server shutdown.
 */
export function closeAllUserDbs() {
  for (const [, db] of _userDbs) {
    try { db.close(); } catch { /* ignore */ }
  }
  _userDbs.clear();
}
