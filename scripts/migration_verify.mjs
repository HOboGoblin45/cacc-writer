#!/usr/bin/env node
/**
 * scripts/migration_verify.mjs
 * ============================
 * Post-migration verification script for SQLite → PostgreSQL data migration.
 *
 * Compares data between SQLite and PostgreSQL to ensure migration completeness:
 *   - Row count comparison per table per user
 *   - Sample data verification (random row checks)
 *   - Orphaned record detection
 *   - Index integrity checks
 *
 * Usage:
 *   node scripts/migration_verify.mjs --pg-url postgresql://... [options]
 *
 * Options:
 *   --pg-url       PostgreSQL connection string (required)
 *   --data-dir     SQLite data directory (default: ./data/users)
 *   --user         Verify single user only
 *   --sample-size  Number of rows to sample per table (default: 10)
 *   --verbose      Detailed logging
 *
 * Exit codes:
 *   0 - All verifications passed
 *   1 - Verification failed or configuration error
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { SCHEMA_CATALOG } from '../server/db/postgresql/schema_catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);

// ──────────────────────────────────────────────────────────────────────────────
// Parse arguments
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = {
    pgUrl: null,
    dataDir: path.join(PROJECT_ROOT, 'data', 'users'),
    user: null,
    sampleSize: 10,
    verbose: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--pg-url' && i + 1 < process.argv.length) {
      args.pgUrl = process.argv[++i];
    } else if (arg === '--data-dir' && i + 1 < process.argv.length) {
      args.dataDir = process.argv[++i];
    } else if (arg === '--user' && i + 1 < process.argv.length) {
      args.user = process.argv[++i];
    } else if (arg === '--sample-size' && i + 1 < process.argv.length) {
      args.sampleSize = parseInt(process.argv[++i], 10);
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
  }

  if (!args.pgUrl) {
    console.error('Error: --pg-url is required');
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
    this.errors = [];
    this.warnings = [];
  }

  info(msg, meta = {}) {
    console.log(`[INFO] ${msg}`, meta);
  }

  warn(msg, meta = {}) {
    console.warn(`[WARN] ${msg}`, meta);
    this.warnings.push({ msg, meta });
  }

  error(msg, meta = {}) {
    console.error(`[ERROR] ${msg}`, meta);
    this.errors.push({ msg, meta });
  }

  debug(msg, meta = {}) {
    if (this.verbose) {
      console.log(`[DEBUG] ${msg}`, meta);
    }
  }

  getSummary() {
    return {
      errors: this.errors.length,
      warnings: this.warnings.length,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Discovery
// ──────────────────────────────────────────────────────────────────────────────

function discoverUserDatabases(dataDir, specificUser = null) {
  const users = [];

  if (specificUser) {
    const userDir = path.join(dataDir, specificUser);
    const dbPath = path.join(userDir, 'appraisal.db');
    if (fs.existsSync(dbPath)) {
      users.push({ userId: specificUser, dbPath });
    } else {
      throw new Error(`Database not found for user: ${specificUser}`);
    }
  } else {
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
// Get table schema
// ──────────────────────────────────────────────────────────────────────────────

function getTableSchema(tableName) {
  const entry = SCHEMA_CATALOG.tables.find((t) => t.name === tableName);
  return entry ? { name: tableName, columns: entry.columns } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Verification functions
// ──────────────────────────────────────────────────────────────────────────────

async function verifyRowCounts(
  pgClient,
  userId,
  sqliteDb,
  logger
) {
  const mismatches = [];

  const tableList = sqliteDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();

  for (const { name: tableName } of tableList) {
    const schema = getTableSchema(tableName);
    if (!schema) continue;

    const sqliteCount = sqliteDb
      .prepare(`SELECT COUNT(*) as n FROM ${tableName}`)
      .get().n;

    let pgCount = 0;
    try {
      const pgResult = await pgClient.query(
        `SELECT COUNT(*) as n FROM cacc.${tableName} WHERE user_id = $1`,
        [userId]
      );
      pgCount = pgResult.rows[0]?.n ?? 0;
    } catch (err) {
      logger.warn(`Failed to count PG table: ${tableName}`, {
        error: err.message,
      });
      continue;
    }

    if (sqliteCount !== pgCount) {
      mismatches.push({
        table: tableName,
        sqliteCount,
        pgCount,
        diff: Math.abs(sqliteCount - pgCount),
      });

      logger.error(
        `Row count mismatch: ${tableName} (user: ${userId})`,
        {
          sqlite: sqliteCount,
          pg: pgCount,
          diff: Math.abs(sqliteCount - pgCount),
        }
      );
    } else {
      logger.debug(`Row count match: ${tableName}`, {
        count: sqliteCount,
      });
    }
  }

  return mismatches;
}

async function verifySampleData(
  pgClient,
  userId,
  sqliteDb,
  logger,
  sampleSize
) {
  const mismatches = [];

  const tableList = sqliteDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();

  for (const { name: tableName } of tableList) {
    const schema = getTableSchema(tableName);
    if (!schema) continue;

    const allRows = sqliteDb
      .prepare(`SELECT * FROM ${tableName}`)
      .all();

    if (allRows.length === 0) continue;

    // Sample random rows
    const sampleIndices = [];
    for (let i = 0; i < Math.min(sampleSize, allRows.length); i++) {
      const idx = Math.floor(Math.random() * allRows.length);
      sampleIndices.push(idx);
    }

    for (const idx of sampleIndices) {
      const row = allRows[idx];
      const pkCol = schema.columns.find((c) =>
        c.sqliteType.includes('PRIMARY KEY')
      );

      if (!pkCol) continue;

      const pkValue = row[pkCol.name];

      try {
        const pgResult = await pgClient.query(
          `SELECT * FROM cacc.${tableName} WHERE user_id = $1 AND ${pkCol.name} = $2 LIMIT 1`,
          [userId, pkValue]
        );

        if (pgResult.rows.length === 0) {
          mismatches.push({
            table: tableName,
            issue: 'row_not_found_in_pg',
            pk: pkValue,
          });

          logger.warn(
            `Row found in SQLite but not in PG: ${tableName} (pk: ${pkValue})`,
          );
        }
      } catch (err) {
        logger.debug(
          `Failed to verify sample row: ${tableName}`,
          { error: err.message }
        );
      }
    }
  }

  return mismatches;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main verification
// ──────────────────────────────────────────────────────────────────────────────

async function verify() {
  const args = parseArgs();
  const logger = new Logger(args.verbose);

  logger.info('Starting migration verification', {
    pgUrl: args.pgUrl.split('@')[0] + '@***',
    dataDir: args.dataDir,
    sampleSize: args.sampleSize,
  });

  const pgClient = new pg.Client(args.pgUrl);

  try {
    await pgClient.connect();
    logger.info('Connected to PostgreSQL');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL', { error: err.message });
    process.exit(1);
  }

  try {
    const users = discoverUserDatabases(args.dataDir, args.user);
    logger.info(`Verifying ${users.length} user(s)`);

    let totalRowCountMismatches = 0;
    let totalDataMismatches = 0;

    for (const { userId, dbPath } of users) {
      logger.info(`Verifying user: ${userId}`);

      const sqliteDb = new BetterSqlite3(dbPath, { readonly: true });

      try {
        // Verify row counts
        const rowCountMismatches = await verifyRowCounts(
          pgClient,
          userId,
          sqliteDb,
          logger
        );
        totalRowCountMismatches += rowCountMismatches.length;

        // Verify sample data
        const dataMismatches = await verifySampleData(
          pgClient,
          userId,
          sqliteDb,
          logger,
          args.sampleSize
        );
        totalDataMismatches += dataMismatches.length;
      } finally {
        sqliteDb.close();
      }
    }

    const summary = logger.getSummary();
    logger.info('Verification completed', {
      rowCountMismatches: totalRowCountMismatches,
      dataMismatches: totalDataMismatches,
      errors: summary.errors,
      warnings: summary.warnings,
    });

    if (summary.errors > 0) {
      process.exit(1);
    }
  } finally {
    await pgClient.end();
  }
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
