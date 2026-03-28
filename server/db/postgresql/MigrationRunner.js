/**
 * server/db/postgresql/MigrationRunner.js
 * ========================================
 * PostgreSQL migration runner for CACC Writer.
 * Tracks applied migrations and executes SQL migration files in order.
 */

import log from '../../logger.js';

export class MigrationRunner {
  /**
   * @param {DatabaseAdapter} adapter - Database adapter (Postgres or SQLite)
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Initialize migrations tracking table.
   * Creates the _migrations table if it doesn't exist.
   */
  async init() {
    try {
      await this.adapter.run(`
        CREATE TABLE IF NOT EXISTS cacc._migrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      log.info('migration:init', 'Migrations table initialized');
    } catch (err) {
      log.error('migration:init-error', { error: err.message });
      throw err;
    }
  }

  /**
   * Get all applied migrations.
   * @returns {Promise<Array>} Array of { name, applied_at }
   */
  async getAppliedMigrations() {
    try {
      const rows = await this.adapter.all(
        'SELECT name, applied_at FROM cacc._migrations ORDER BY applied_at ASC',
        []
      );
      return rows || [];
    } catch (err) {
      log.error('migration:get-applied-error', { error: err.message });
      throw err;
    }
  }

  /**
   * Check if a migration has been applied.
   * @param {string} name - Migration name
   * @returns {Promise<boolean>}
   */
  async isMigrationApplied(name) {
    try {
      const row = await this.adapter.get(
        'SELECT 1 FROM cacc._migrations WHERE name = ?',
        [name]
      );
      return !!row;
    } catch (err) {
      log.error('migration:is-applied-error', { name, error: err.message });
      throw err;
    }
  }

  /**
   * Apply a migration.
   * Executes the SQL and records it in _migrations table.
   *
   * @param {string} name - Migration name (e.g., '001_initial_schema')
   * @param {string} sql - SQL to execute
   * @returns {Promise<void>}
   */
  async applyMigration(name, sql) {
    try {
      // Execute the migration SQL
      await this.adapter.run(sql, []);

      // Record in migrations table
      await this.adapter.run(
        'INSERT INTO cacc._migrations (name, applied_at) VALUES (?, ?)',
        [name, new Date().toISOString()]
      );

      log.info('migration:applied', { name });
    } catch (err) {
      log.error('migration:apply-error', { name, error: err.message });
      throw err;
    }
  }

  /**
   * Run all migrations from a directory.
   * Reads .sql files in order, skips already-applied ones.
   *
   * @param {string} migrationsDir - Directory path with migration files
   * @param {import('fs')} fs - Node.js fs module
   * @returns {Promise<{applied: Array, skipped: Array, failed: Array}>}
   */
  async runAll(migrationsDir, fs) {
    const results = {
      applied: [],
      skipped: [],
      failed: [],
    };

    try {
      // Read migration files from directory
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      log.info('migration:runall-start', { count: files.length });

      // Get already-applied migrations
      const applied = await this.getAppliedMigrations();
      const appliedNames = new Set(applied.map((m) => m.name));

      // Process each migration file
      for (const file of files) {
        const migrationName = file.replace(/\.sql$/, '');

        if (appliedNames.has(migrationName)) {
          results.skipped.push(migrationName);
          log.info('migration:skipped', { name: migrationName });
          continue;
        }

        try {
          const sql = fs.readFileSync(`${migrationsDir}/${file}`, 'utf-8');
          await this.applyMigration(migrationName, sql);
          results.applied.push(migrationName);
        } catch (err) {
          results.failed.push({ name: migrationName, error: err.message });
          log.error('migration:failed', { name: migrationName, error: err.message });
        }
      }

      log.info('migration:runall-complete', results);
      return results;
    } catch (err) {
      log.error('migration:runall-error', { error: err.message });
      throw err;
    }
  }

  /**
   * Rollback a migration (future use).
   * Currently a stub for infrastructure planning.
   *
   * @param {string} name - Migration name to rollback
   * @returns {Promise<void>}
   */
  async rollback(name) {
    log.warn('migration:rollback-not-implemented', { name });
    throw new Error('Rollback not yet implemented');
  }
}

export default { MigrationRunner };
