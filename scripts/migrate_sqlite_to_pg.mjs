#!/usr/bin/env node
/**
 * scripts/migrate_sqlite_to_pg.mjs
 * ===============================
 * SQLite → PostgreSQL Data Migration Script
 *
 * Migrates all per-user SQLite databases from data/users/{userId}/appraisal.db
 * to a shared PostgreSQL instance with user_id column for multi-tenancy.
 *
 * Usage:
 *   node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://user:pass@localhost/cacc [options]
 *
 * Options:
 *   --pg-url        PostgreSQL connection string (required)
 *   --data-dir      SQLite data directory (default: ./data/users)
 *   --user          Migrate single user only (e.g., --user user-123)
 *   --dry-run       Show what would be migrated without executing
 *   --batch-size    Number of rows per INSERT batch (default: 500)
 *   --resume        Resume from last checkpoint (checkpoint file auto-discovered)
 *   --verify        Verify data integrity after migration
 *   --verbose       Detailed logging
 *
 * Examples:
 *   # Migrate all users
 *   node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://localhost/cacc
 *
 *   # Dry-run, single user
 *   node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://localhost/cacc --user user-123 --dry-run
 *
 *   # Migrate with verification
 *   node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://localhost/cacc --verify
 *
 *   # Resume interrupted migration
 *   node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://localhost/cacc --resume
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { MigrationCheckpoint } from '../server/db/MigrationCheckpoint.js';
import { convertRow, buildBatchInsertSQL } from '../server/db/TypeConverter.js';
import { SCHEMA_CATALOG } from '../server/db/postgresql/schema_catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);

// ──────────────────────────────────────────────────────────────────────────────
// Parse command-line arguments
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = {
    pgUrl: null,
    dataDir: path.join(PROJECT_ROOT, 'data', 'users'),
    user: null,
    dryRun: false,
    batchSize: 500,
    resume: false,
    verify: false,
    verbose: false,
    checkpointFile: path.join(PROJECT_ROOT, 'data', 'migration_checkpoint.json'),
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--pg-url' && i + 1 < process.argv.length) {
      args.pgUrl = process.argv[++i];
    } else if (arg === '--data-dir' && i + 1 < process.argv.length) {
      args.dataDir = process.argv[++i];
    } else if (arg === '--user' && i + 1 < process.argv.length) {
      args.user = process.argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--batch-size' && i + 1 < process.argv.length) {
      args.batchSize = parseInt(process.argv[++i], 10);
    } else if (arg === '--resume') {
      args.resume = true;
    } else if (arg === '--verify') {
      args.verify = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
  }

  if (!args.pgUrl) {
    console.error('Error: --pg-url is required');
    console.error(
      'Usage: node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://...'
    );
    process.exit(1);
  }

  return args;
}

// ──────────────────────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────────────────────

class Logger {
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  info(msg, meta = {}) {
    console.log(`[INFO] ${msg}`, meta);
  }

  warn(msg, meta = {}) {
    console.warn(`[WARN] ${msg}`, meta);
  }

  error(msg, meta = {}) {
    console.error(`[ERROR] ${msg}`, meta);
  }

  debug(msg, meta = {}) {
    if (this.verbose) {
      console.log(`[DEBUG] ${msg}`, meta);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Discovery: Find all user SQLite databases
// ──────────────────────────────────────────────────────────────────────────────

function discoverUserDatabases(dataDir, specificUser = null) {
  const users = [];

  if (specificUser) {
    // Single user
    const userDir = path.join(dataDir, specificUser);
    const dbPath = path.join(userDir, 'appraisal.db');
    if (fs.existsSync(dbPath)) {
      users.push({ userId: specificUser, dbPath });
    } else {
      throw new Error(`Database not found for user: ${specificUser}`);
    }
  } else {
    // All users
    if (!fs.existsSync(dataDir)) {
      throw new Error(`Data directory not found: ${dataDir}`);
    }

    const entries = fs.readdirSync(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dbPath = path.join(dataDir, entry.name, 'appraisal.db');
      if (fs.existsSync(dbPath)) {
        users.push({ userId: entry.name, dbPath });
      }
    }
  }

  return users;
}

// ──────────────────────────────────────────────────────────────────────────────
// Get table schema from catalog
// ──────────────────────────────────────────────────────────────────────────────

function getTableSchema(tableName) {
  const entry = SCHEMA_CATALOG.tables.find((t) => t.name === tableName);
  if (!entry) {
    return null;
  }

  return {
    name: tableName,
    columns: entry.columns.map((col) => ({
      name: col.name,
      pgType: col.pgType,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Read all tables from a SQLite database
// ──────────────────────────────────────────────────────────────────────────────

function readUserDatabase(dbPath, logger) {
  const sqlite = new BetterSqlite3(dbPath, { readonly: true });
  const tables = new Map();

  try {
    // Get all tables
    const tableList = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();

    for (const { name: tableName } of tableList) {
      const schema = getTableSchema(tableName);
      if (!schema) {
        logger.debug(`Skipping table (not in catalog): ${tableName}`);
        continue;
      }

      try {
        const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
        tables.set(tableName, rows);
        logger.debug(`Read table: ${tableName}`, { rows: rows.length });
      } catch (err) {
        logger.warn(`Failed to read table: ${tableName}`, { error: err.message });
      }
    }
  } finally {
    sqlite.close();
  }

  return tables;
}

// ──────────────────────────────────────────────────────────────────────────────
// Insert rows into PostgreSQL
// ──────────────────────────────────────────────────────────────────────────────

async function insertTableIntoPg(
  pgClient,
  tableName,
  rows,
  userId,
  batchSize,
  dryRun,
  logger
) {
  if (rows.length === 0) {
    return 0;
  }

  const schema = getTableSchema(tableName);
  if (!schema) {
    logger.warn(`Table schema not found: ${tableName}`);
    return 0;
  }

  let inserted = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    // Convert rows (type conversion, add user_id)
    const convertedBatch = batch.map((row) => {
      const converted = convertRow(row, schema.columns);
      converted.user_id = userId;
      return converted;
    });

    // Build batch INSERT
    const columnNames = [
      ...schema.columns.map((c) => c.name),
      'user_id',
    ];

    const batchSql = buildBatchInsertSQL(
      tableName,
      columnNames,
      batch.length,
      'cacc'
    );

    // Flatten params: [row1.col1, row1.col2, ..., row2.col1, ...]
    const params = [];
    for (const row of convertedBatch) {
      for (const col of columnNames) {
        params.push(row[col]);
      }
    }

    if (dryRun) {
      logger.debug(`[DRY-RUN] Would insert ${batch.length} rows into ${tableName}`);
      inserted += batch.length;
    } else {
      try {
        await pgClient.query(batchSql.sql, params);
        inserted += batch.length;
        logger.debug(`Inserted batch into ${tableName}`, {
          rows: batch.length,
          total: inserted,
        });
      } catch (err) {
        logger.error(`Batch insert failed: ${tableName}`, {
          error: err.message,
          batchSize: batch.length,
        });
        throw err;
      }
    }
  }

  return inserted;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main migration logic
// ──────────────────────────────────────────────────────────────────────────────

async function migrate() {
  const args = parseArgs();
  const logger = new Logger(args.verbose);

  logger.info('Starting SQLite → PostgreSQL migration', {
    pgUrl: args.pgUrl.split('@')[0] + '@***',
    dataDir: args.dataDir,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    resume: args.resume,
  });

  // Load checkpoint
  const checkpoint = new MigrationCheckpoint(args.checkpointFile);
  if (args.resume && fs.existsSync(args.checkpointFile)) {
    checkpoint.load();
    const progress = checkpoint.getProgress();
    logger.info('Resuming migration', progress);
  } else {
    checkpoint.reset();
    checkpoint.save();
  }

  // Connect to PostgreSQL
  const pgClient = new pg.Client(args.pgUrl);
  try {
    await pgClient.connect();
    logger.info('Connected to PostgreSQL');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL', { error: err.message });
    process.exit(1);
  }

  try {
    // Discover user databases
    const users = discoverUserDatabases(args.dataDir, args.user);
    logger.info(`Found ${users.length} user database(s)`);

    // Migrate each user
    let totalRows = 0;

    for (const { userId, dbPath } of users) {
      if (checkpoint.isUserDone(userId)) {
        logger.info(`Skipping user (already migrated): ${userId}`);
        continue;
      }

      logger.info(`Migrating user: ${userId}`);

      try {
        // Read all tables from user's SQLite database
        const tables = readUserDatabase(dbPath, logger);
        logger.info(`User ${userId} has ${tables.size} tables`);

        // Insert each table into PostgreSQL
        for (const [tableName, rows] of tables) {
          if (checkpoint.isTableDone(userId, tableName)) {
            logger.debug(`Skipping table (already migrated): ${tableName}`);
            continue;
          }

          try {
            const inserted = await insertTableIntoPg(
              pgClient,
              tableName,
              rows,
              userId,
              args.batchSize,
              args.dryRun,
              logger
            );

            checkpoint.markTableDone(userId, tableName, inserted);
            totalRows += inserted;

            logger.info(`Migrated table: ${tableName}`, { rows: inserted });
          } catch (err) {
            logger.error(`Failed to migrate table: ${tableName}`, {
              userId,
              error: err.message,
            });
            // Continue with next table
          }
        }

        checkpoint.markUserDone(userId);
      } catch (err) {
        logger.error(`Failed to migrate user: ${userId}`, { error: err.message });
        // Continue with next user
      }
    }

    checkpoint.markCompleted();
    checkpoint.save();

    const progress = checkpoint.getProgress();
    logger.info('Migration completed', {
      ...progress,
      totalRows,
      dryRun: args.dryRun,
    });

    // Verification pass (if requested)
    if (args.verify && !args.dryRun) {
      logger.info('Starting verification...');
      await verifyMigration(pgClient, args.dataDir, checkpoint, logger);
    }
  } finally {
    await pgClient.end();
    logger.info('Disconnected from PostgreSQL');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Verification: Compare row counts and sample data
// ──────────────────────────────────────────────────────────────────────────────

async function verifyMigration(pgClient, dataDir, checkpoint, logger) {
  let discrepancies = 0;

  const users = discoverUserDatabases(dataDir);

  for (const { userId, dbPath } of users) {
    const sqliteDb = new BetterSqlite3(dbPath, { readonly: true });

    try {
      const tableList = sqliteDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all();

      for (const { name: tableName } of tableList) {
        const schema = getTableSchema(tableName);
        if (!schema) continue;

        const sqliteCount = sqliteDb
          .prepare(`SELECT COUNT(*) as n FROM ${tableName}`)
          .get().n;

        const pgResult = await pgClient.query(
          `SELECT COUNT(*) as n FROM cacc.${tableName} WHERE user_id = $1`,
          [userId]
        );
        const pgCount = pgResult.rows[0]?.n ?? 0;

        if (sqliteCount !== pgCount) {
          logger.error(`Row count mismatch: ${tableName} (user: ${userId})`, {
            sqliteCount,
            pgCount,
          });
          discrepancies++;
        }
      }
    } finally {
      sqliteDb.close();
    }
  }

  if (discrepancies === 0) {
    logger.info('Verification passed: all row counts match');
  } else {
    logger.warn(`Verification found ${discrepancies} discrepancies`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Run migration
// ──────────────────────────────────────────────────────────────────────────────

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
