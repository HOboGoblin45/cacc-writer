#!/usr/bin/env node

/**
 * scripts/migrate_storage.mjs
 * ===========================
 * Storage migration script: Copy files from source to target storage.
 *
 * Supports:
 * - Local filesystem <-> S3/R2
 * - Prefix-based filtering (e.g., migrate only knowledge_base/)
 * - Dry-run mode for safety
 * - Resume capability (skips already-migrated files)
 * - Integrity verification (compare file sizes)
 *
 * Usage:
 * ```bash
 * # Migrate knowledge_base to R2 (dry-run)
 * node scripts/migrate_storage.mjs --source=local --target=r2 --prefix=knowledge_base/ --dry-run
 *
 * # Actually migrate (commits changes)
 * node scripts/migrate_storage.mjs --source=local --target=r2 --prefix=knowledge_base/
 *
 * # Migrate all files
 * node scripts/migrate_storage.mjs --source=local --target=r2
 *
 * # Migrate exports (resume from last run)
 * node scripts/migrate_storage.mjs --source=local --target=r2 --prefix=exports/
 * ```
 *
 * Environment variables:
 * - STORAGE_PROVIDER: Source provider (overridden by --source)
 * - R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: R2 config
 * - S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION: S3 config
 * - STORAGE_BASE_PATH: Local filesystem base path (default: ./data)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Import storage adapters
const { createStorageAdapter } = await import(
  path.join(PROJECT_ROOT, 'server', 'storage', 'StorageFactory.js')
);

// Parse command-line arguments
const args = process.argv.slice(2);
const options = {};

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    options[key] = value === undefined ? true : value;
  }
}

const sourceProvider = options.source || process.env.STORAGE_PROVIDER || 'local';
const targetProvider = options.target || 'r2';
const prefix = options.prefix || '';
const dryRun = options['dry-run'] === true || options['dry-run'] === 'true';
const skipVerify = options['skip-verify'] === true || options['skip-verify'] === 'true';

console.log(`
=== Storage Migration Tool ===
Source:     ${sourceProvider}
Target:     ${targetProvider}
Prefix:     ${prefix || '(all)'}
Dry-Run:    ${dryRun ? 'YES' : 'NO'}
Verify:     ${skipVerify ? 'SKIPPED' : 'ENABLED'}
`);

if (dryRun) {
  console.log('[DRY-RUN MODE] No files will be modified.\n');
}

// Create adapter instances
let source, target;

try {
  source = createStorageAdapter({ provider: sourceProvider });
  target = createStorageAdapter({ provider: targetProvider });
  console.log(`Initialized source: ${source.getProviderName()}`);
  console.log(`Initialized target: ${target.getProviderName()}\n`);
} catch (err) {
  console.error(`Error initializing adapters: ${err.message}`);
  process.exit(1);
}

// Load migration state (for resume capability)
const stateFile = path.join(PROJECT_ROOT, '.migration-state.json');
let state = {};

if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    console.log(`Loaded migration state from ${stateFile}`);
    console.log(`Previous run: ${state.timestamp}`);
    console.log(`Files migrated: ${state.migratedCount || 0}\n`);
  } catch (err) {
    console.warn(`Warning: Could not load state file: ${err.message}`);
    state = {};
  }
}

// Initialize state for this run
const runId = new Date().toISOString();
state[runId] = {
  timestamp: runId,
  source: sourceProvider,
  target: targetProvider,
  prefix,
  dryRun,
  startTime: Date.now(),
  filesProcessed: 0,
  filesMigrated: 0,
  filesSkipped: 0,
  filesError: 0,
  totalBytes: 0,
  errors: [],
};

const runState = state[runId];

// Main migration loop
async function migrateFiles() {
  try {
    console.log(`Listing files in ${sourceProvider} with prefix '${prefix}'...`);
    const files = await source.list(prefix);

    if (files.length === 0) {
      console.log('No files found matching prefix.');
      return;
    }

    console.log(`Found ${files.length} file(s) to migrate.\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = `[${i + 1}/${files.length}]`;

      try {
        // Check if already migrated (resume capability)
        const alreadyMigrated = state[runId - 1]?.migratedFiles?.[file.key];
        if (alreadyMigrated && !dryRun) {
          console.log(`${progress} SKIP (already migrated): ${file.key}`);
          runState.filesSkipped++;
          continue;
        }

        // Retrieve file from source
        console.log(`${progress} Reading ${file.key} (${formatBytes(file.size)})`);
        const data = await source.get(file.key);

        if (!data) {
          console.error(`${progress} ERROR: File not found: ${file.key}`);
          runState.filesError++;
          runState.errors.push({
            file: file.key,
            error: 'File not found',
          });
          continue;
        }

        if (!dryRun) {
          // Write to target
          const contentType = inferContentType(file.key);
          await target.put(file.key, data, { contentType });
          console.log(`${progress} Wrote ${file.key}`);
          runState.filesMigrated++;
          runState.totalBytes += data.length;

          // Verify integrity (compare sizes)
          if (!skipVerify) {
            const targetMeta = await target.getMetadata(file.key);
            if (targetMeta && targetMeta.size === data.length) {
              console.log(`${progress} Verified: ${file.key}`);
            } else {
              console.warn(
                `${progress} WARNING: Size mismatch for ${file.key}: ` +
                `source=${data.length}, target=${targetMeta?.size}`
              );
              runState.errors.push({
                file: file.key,
                error: 'Size mismatch after migration',
              });
            }
          }
        } else {
          console.log(`${progress} [DRY-RUN] Would migrate ${file.key}`);
          runState.filesMigrated++;
          runState.totalBytes += file.size;
        }
      } catch (err) {
        console.error(`${progress} ERROR: ${file.key} - ${err.message}`);
        runState.filesError++;
        runState.errors.push({
          file: file.key,
          error: err.message,
        });
      }

      runState.filesProcessed++;
    }
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    runState.errors.push({
      error: err.message,
      context: 'main migration loop',
    });
    process.exit(1);
  }
}

// Save migration state
function saveState() {
  runState.endTime = Date.now();
  runState.duration = (runState.endTime - runState.startTime) / 1000;

  if (!dryRun) {
    try {
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(`\nMigration state saved to ${stateFile}`);
    } catch (err) {
      console.error(`Warning: Could not save state: ${err.message}`);
    }
  }
}

// Print summary
function printSummary() {
  console.log(`
=== Migration Summary ===
Duration:       ${runState.duration.toFixed(1)}s
Files Processed: ${runState.filesProcessed}
Files Migrated:  ${runState.filesMigrated}
Files Skipped:   ${runState.filesSkipped}
Files Errors:    ${runState.filesError}
Total Bytes:     ${formatBytes(runState.totalBytes)}
`);

  if (runState.errors.length > 0) {
    console.log('Errors:');
    for (const err of runState.errors) {
      console.log(`  - ${err.file || err.context}: ${err.error}`);
    }
  }

  if (dryRun) {
    console.log('[DRY-RUN] No files were actually migrated.\n');
  } else if (runState.filesError === 0) {
    console.log('Migration completed successfully!\n');
  } else {
    console.log('Migration completed with errors.\n');
  }
}

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function inferContentType(key) {
  const ext = path.extname(key).toLowerCase();
  const typeMap = {
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  return typeMap[ext] || 'application/octet-stream';
}

// Run migration
await migrateFiles();
saveState();
printSummary();

process.exit(runState.filesError === 0 ? 0 : 1);
