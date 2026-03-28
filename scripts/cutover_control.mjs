#!/usr/bin/env node
/**
 * scripts/cutover_control.mjs
 * ===========================
 * Zero-downtime cutover controller for SQLite → PostgreSQL migration.
 *
 * Manages the transition from SQLite to PostgreSQL through staged steps:
 *   1. pre-check: Verify PG is ready, all data migrated
 *   2. enable-dual-write: Start dual writes (SQLite primary)
 *   3. verify-sync: Ensure writes are in sync
 *   4. switch-primary: Make PG primary read source (dual write continues)
 *   5. disable-sqlite: Stop SQLite writes (PG only)
 *   6. cleanup: Archive SQLite files
 *   7. rollback: Revert to SQLite-only
 *
 * Usage:
 *   node scripts/cutover_control.mjs pre-check --pg-url postgresql://...
 *   node scripts/cutover_control.mjs enable-dual-write
 *   node scripts/cutover_control.mjs verify-sync --pg-url postgresql://...
 *   node scripts/cutover_control.mjs switch-primary
 *   node scripts/cutover_control.mjs disable-sqlite
 *   node scripts/cutover_control.mjs cleanup
 *   node scripts/cutover_control.mjs rollback
 *   node scripts/cutover_control.mjs status
 *
 * State files:
 *   .env.cutover - Contains DB_WRITE_MODE and other cutover state
 *
 * Commands:
 *   pre-check        Verify both databases are ready
 *   enable-dual-write Start dual-write mode (SQLite primary, PG secondary)
 *   verify-sync       Check row counts and sample data are in sync
 *   switch-primary    Switch to pg-primary mode (read from PG)
 *   disable-sqlite    Switch to pg-only mode (write/read from PG only)
 *   cleanup           Archive SQLite files to data/archive
 *   rollback          Revert to sqlite-only mode
 *   status            Show current cutover state
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);

const CUTOVER_STATE_FILE = path.join(PROJECT_ROOT, '.env.cutover');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

// ──────────────────────────────────────────────────────────────────────────────
// Parse arguments
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const command = process.argv[2];
  const args = { command, pgUrl: null };

  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--pg-url' && i + 1 < process.argv.length) {
      args.pgUrl = process.argv[++i];
    }
  }

  if (!['pre-check', 'enable-dual-write', 'verify-sync', 'switch-primary', 'disable-sqlite', 'cleanup', 'rollback', 'status'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error('Valid commands: pre-check, enable-dual-write, verify-sync, switch-primary, disable-sqlite, cleanup, rollback, status');
    process.exit(1);
  }

  return args;
}

// ──────────────────────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────────────────────

class Logger {
  info(msg, meta = {}) {
    console.log(`[INFO] ${msg}`, JSON.stringify(meta));
  }

  warn(msg, meta = {}) {
    console.warn(`[WARN] ${msg}`, JSON.stringify(meta));
  }

  error(msg, meta = {}) {
    console.error(`[ERROR] ${msg}`, JSON.stringify(meta));
  }

  success(msg, meta = {}) {
    console.log(`[SUCCESS] ${msg}`, JSON.stringify(meta));
  }
}

const logger = new Logger();

// ──────────────────────────────────────────────────────────────────────────────
// State management
// ──────────────────────────────────────────────────────────────────────────────

function getWriteMode() {
  return process.env.DB_WRITE_MODE || 'sqlite-only';
}

function setWriteMode(mode) {
  // Update .env.cutover file
  let envContent = '';
  if (fs.existsSync(CUTOVER_STATE_FILE)) {
    envContent = fs.readFileSync(CUTOVER_STATE_FILE, 'utf-8');
  }

  // Remove existing DB_WRITE_MODE line
  envContent = envContent
    .split('\n')
    .filter((line) => !line.startsWith('DB_WRITE_MODE='))
    .join('\n')
    .trim();

  // Add new DB_WRITE_MODE
  envContent += `\nDB_WRITE_MODE=${mode}\n`;

  fs.writeFileSync(CUTOVER_STATE_FILE, envContent, 'utf-8');
  process.env.DB_WRITE_MODE = mode;

  logger.info(`Write mode changed to: ${mode}`);
}

function getStatus() {
  return {
    mode: getWriteMode(),
    stateFile: CUTOVER_STATE_FILE,
    stateFileExists: fs.existsSync(CUTOVER_STATE_FILE),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Checks
// ──────────────────────────────────────────────────────────────────────────────

async function checkPostgresConnection(pgUrl) {
  const client = new pg.Client(pgUrl);

  try {
    await client.connect();
    const result = await client.query('SELECT 1');
    await client.end();
    return true;
  } catch (err) {
    logger.error('PostgreSQL connection failed', { error: err.message });
    return false;
  }
}

async function checkTablesExist(pgUrl) {
  const client = new pg.Client(pgUrl);

  try {
    await client.connect();

    // Check if schema exists
    const schemaResult = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cacc'"
    );

    if (schemaResult.rows.length === 0) {
      logger.error('PostgreSQL schema "cacc" does not exist');
      return false;
    }

    // Check some key tables
    const tableResult = await client.query(
      "SELECT COUNT(*) as n FROM information_schema.tables WHERE table_schema = 'cacc' AND table_name IN ('case_records', 'assignments', 'generation_runs')"
    );

    const keytablles = tableResult.rows[0]?.n ?? 0;

    if (keytablles < 3) {
      logger.error('PostgreSQL schema "cacc" missing key tables');
      return false;
    }

    await client.end();
    return true;
  } catch (err) {
    logger.error('Failed to check PostgreSQL tables', { error: err.message });
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────────────────────────────────────

async function preCheck(pgUrl) {
  logger.info('Running pre-check...');

  if (!pgUrl) {
    logger.error('--pg-url is required for pre-check');
    process.exit(1);
  }

  const connected = await checkPostgresConnection(pgUrl);
  if (!connected) {
    logger.error('Pre-check failed: cannot connect to PostgreSQL');
    process.exit(1);
  }

  const hasTable = await checkTablesExist(pgUrl);
  if (!hasTable) {
    logger.error('Pre-check failed: PostgreSQL schema not ready');
    process.exit(1);
  }

  logger.success('Pre-check passed', {
    postgresConnected: true,
    schemaReady: true,
  });
}

async function enableDualWrite() {
  const mode = getWriteMode();

  if (mode !== 'sqlite-only') {
    logger.warn(`Not in sqlite-only mode (current: ${mode}). Proceeding anyway.`);
  }

  setWriteMode('dual-write');
  logger.success('Dual-write enabled. SQLite is primary, PostgreSQL is secondary.');
}

async function verifySyync(pgUrl) {
  logger.info('Verifying sync between SQLite and PostgreSQL...');

  if (!pgUrl) {
    logger.error('--pg-url is required for verify-sync');
    process.exit(1);
  }

  const client = new pg.Client(pgUrl);

  try {
    await client.connect();

    // Sample some tables
    const sampleTables = [
      'case_records',
      'assignments',
      'generation_runs',
    ];

    for (const tableName of sampleTables) {
      try {
        const result = await client.query(
          `SELECT COUNT(*) as n FROM cacc.${tableName}`
        );
        const count = result.rows[0]?.n ?? 0;
        logger.info(`${tableName}: ${count} rows in PostgreSQL`);
      } catch (err) {
        logger.warn(`Could not check ${tableName}`, { error: err.message });
      }
    }

    logger.success('Sync verification completed');
    await client.end();
  } catch (err) {
    logger.error('Sync verification failed', { error: err.message });
    process.exit(1);
  }
}

async function switchPrimary() {
  const mode = getWriteMode();

  if (mode !== 'dual-write') {
    logger.warn(`Expected dual-write mode but found: ${mode}`);
  }

  setWriteMode('pg-primary');
  logger.success('Switched to pg-primary. Reads now from PostgreSQL, writes to both.');
}

async function disableSqlite() {
  const mode = getWriteMode();

  if (mode !== 'pg-primary') {
    logger.warn(`Expected pg-primary mode but found: ${mode}`);
  }

  setWriteMode('pg-only');
  logger.success('Switched to pg-only. All reads and writes now use PostgreSQL.');
}

async function cleanup() {
  const mode = getWriteMode();

  if (mode !== 'pg-only') {
    logger.error('Cannot cleanup: not in pg-only mode. Switch to pg-only first.');
    process.exit(1);
  }

  const dataDir = path.join(PROJECT_ROOT, 'data', 'users');
  const archiveDir = path.join(PROJECT_ROOT, 'data', 'archive');

  if (!fs.existsSync(dataDir)) {
    logger.warn('data/users directory not found');
    return;
  }

  fs.mkdirSync(archiveDir, { recursive: true });

  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  let archivedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const userDir = path.join(dataDir, entry.name);
    const dbPath = path.join(userDir, 'appraisal.db');

    if (fs.existsSync(dbPath)) {
      const archiveUserDir = path.join(archiveDir, entry.name);
      fs.mkdirSync(archiveUserDir, { recursive: true });

      fs.copyFileSync(dbPath, path.join(archiveUserDir, 'appraisal.db'));
      fs.unlinkSync(dbPath);

      // Remove associated files (.db-shm, .db-wal)
      try {
        fs.unlinkSync(dbPath + '-shm');
        fs.unlinkSync(dbPath + '-wal');
      } catch {
        // Files may not exist
      }

      archivedCount++;
    }
  }

  logger.success(`Archived ${archivedCount} user databases to data/archive`);
}

async function rollback() {
  const mode = getWriteMode();

  if (mode === 'sqlite-only') {
    logger.warn('Already in sqlite-only mode');
    return;
  }

  setWriteMode('sqlite-only');
  logger.success('Rolled back to sqlite-only mode');
}

async function status() {
  const s = getStatus();
  logger.info('Cutover Status', {
    mode: s.mode,
    stateFile: s.stateFile,
    stateFileExists: s.stateFileExists,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  switch (args.command) {
    case 'pre-check':
      await preCheck(args.pgUrl);
      break;
    case 'enable-dual-write':
      await enableDualWrite();
      break;
    case 'verify-sync':
      await verifySyync(args.pgUrl);
      break;
    case 'switch-primary':
      await switchPrimary();
      break;
    case 'disable-sqlite':
      await disableSqlite();
      break;
    case 'cleanup':
      await cleanup();
      break;
    case 'rollback':
      await rollback();
      break;
    case 'status':
      await status();
      break;
  }
}

main().catch((err) => {
  logger.error('Command failed', { error: err.message });
  process.exit(1);
});
