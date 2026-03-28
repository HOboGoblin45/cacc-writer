/**
 * server/db/MigrationCheckpoint.js
 * ================================
 * Checkpoint tracking for resumable SQLite → PostgreSQL data migrations.
 *
 * Persists migration progress to a JSON file so large migrations can resume
 * after interruption without re-processing completed tables and rows.
 *
 * Checkpoint structure:
 * {
 *   "version": 1,
 *   "startedAt": "2026-03-28T14:30:00Z",
 *   "completedAt": null,
 *   "users": {
 *     "user-123": {
 *       "status": "in_progress",
 *       "startedAt": "2026-03-28T14:30:05Z",
 *       "tables": {
 *         "case_records": { "status": "done", "rowsMigrated": 45 },
 *         "assignments": { "status": "pending", "rowsMigrated": 0 }
 *       }
 *     }
 *   }
 * }
 *
 * Usage:
 *   import { MigrationCheckpoint } from './MigrationCheckpoint.js';
 *   const checkpoint = new MigrationCheckpoint('./data/migration_checkpoint.json');
 *   checkpoint.load();
 *   checkpoint.markTableDone('user-123', 'cases', 45);
 *   checkpoint.save();
 */

import fs from 'fs';
import log from '../logger.js';

export class MigrationCheckpoint {
  /**
   * Create a new checkpoint tracker.
   *
   * @param {string} filePath - Path to checkpoint JSON file
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      version: 1,
      startedAt: null,
      completedAt: null,
      users: {},
    };
  }

  /**
   * Load checkpoint from disk.
   * If file doesn't exist, initializes empty checkpoint.
   */
  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const contents = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(contents);
        log.info('migration:checkpoint-loaded', {
          file: this.filePath,
          users: Object.keys(this.data.users || {}).length,
        });
      } catch (err) {
        log.warn('migration:checkpoint-load-error', {
          file: this.filePath,
          error: err.message,
        });
        this.reset();
      }
    } else {
      this.reset();
    }
  }

  /**
   * Save checkpoint to disk.
   */
  save() {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
      log.debug('migration:checkpoint-saved', { file: this.filePath });
    } catch (err) {
      log.error('migration:checkpoint-save-error', {
        file: this.filePath,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Reset checkpoint to empty state.
   */
  reset() {
    this.data = {
      version: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      users: {},
    };
  }

  /**
   * Mark the entire migration as started.
   */
  markStarted() {
    this.data.startedAt = new Date().toISOString();
    this.data.completedAt = null;
  }

  /**
   * Mark the entire migration as completed.
   */
  markCompleted() {
    this.data.completedAt = new Date().toISOString();
  }

  /**
   * Ensure a user entry exists in the checkpoint.
   *
   * @param {string} userId
   */
  _ensureUser(userId) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        tables: {},
      };
    }
  }

  /**
   * Ensure a table entry exists for a user.
   *
   * @param {string} userId
   * @param {string} tableName
   */
  _ensureTable(userId, tableName) {
    this._ensureUser(userId);
    if (!this.data.users[userId].tables[tableName]) {
      this.data.users[userId].tables[tableName] = {
        status: 'pending',
        rowsMigrated: 0,
      };
    }
  }

  /**
   * Mark a table as done for a user.
   *
   * @param {string} userId
   * @param {string} tableName
   * @param {number} rowCount - Total rows migrated
   */
  markTableDone(userId, tableName, rowCount) {
    this._ensureTable(userId, tableName);
    this.data.users[userId].tables[tableName] = {
      status: 'done',
      rowsMigrated: rowCount,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if a table is done for a user.
   *
   * @param {string} userId
   * @param {string} tableName
   * @returns {boolean}
   */
  isTableDone(userId, tableName) {
    this._ensureTable(userId, tableName);
    return this.data.users[userId].tables[tableName].status === 'done';
  }

  /**
   * Mark a user as done.
   *
   * @param {string} userId
   */
  markUserDone(userId) {
    this._ensureUser(userId);
    this.data.users[userId].status = 'done';
    this.data.users[userId].completedAt = new Date().toISOString();
  }

  /**
   * Check if a user's migration is done.
   *
   * @param {string} userId
   * @returns {boolean}
   */
  isUserDone(userId) {
    return this.data.users[userId]?.status === 'done';
  }

  /**
   * Get migration progress summary.
   *
   * @returns {Object} { usersCompleted, usersTotal, tablesCompleted, rowsMigrated }
   */
  getProgress() {
    const users = Object.entries(this.data.users || {});
    const usersCompleted = users.filter(([, u]) => u.status === 'done').length;
    const usersTotal = users.length;

    let tablesCompleted = 0;
    let rowsMigrated = 0;

    for (const [, user] of users) {
      for (const [, table] of Object.entries(user.tables || {})) {
        if (table.status === 'done') {
          tablesCompleted++;
          rowsMigrated += table.rowsMigrated || 0;
        }
      }
    }

    return {
      usersCompleted,
      usersTotal,
      tablesCompleted,
      rowsMigrated,
    };
  }

  /**
   * Get the list of users that need processing (not done).
   *
   * @returns {Array<string>}
   */
  getPendingUsers() {
    return Object.entries(this.data.users || {})
      .filter(([, u]) => u.status !== 'done')
      .map(([userId]) => userId);
  }

  /**
   * Get tables for a user that need processing (not done).
   *
   * @param {string} userId
   * @returns {Array<string>}
   */
  getPendingTables(userId) {
    if (!this.data.users[userId]) return [];
    return Object.entries(this.data.users[userId].tables || {})
      .filter(([, t]) => t.status !== 'done')
      .map(([tableName]) => tableName);
  }

  /**
   * Get current data structure (for testing or inspection).
   *
   * @returns {Object}
   */
  getData() {
    return this.data;
  }
}
