/**
 * scripts/daily-backup.mjs
 * -------------------------
 * Daily backup: copies cases/ and knowledge_base/ to backups/YYYY-MM-DD/.
 * Keeps only the 7 most recent backups.
 * Logs all activity to backups/backup.log.
 *
 * Usage:
 *   node scripts/daily-backup.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const BACKUPS_DIR = path.join(PROJECT_ROOT, 'backups');
const LOG_FILE = path.join(BACKUPS_DIR, 'backup.log');
const KEEP_DAYS = 7;

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {
    console.error('  [log write error]', e.message);
  }
}

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });

  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Keep only the KEEP_DAYS most recent daily backup folders.
 */
function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
  // Backup folders look like YYYY-MM-DD
  const dateFolders = entries
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map(e => e.name)
    .sort(); // ascending â€” oldest first

  const toDelete = dateFolders.slice(0, Math.max(0, dateFolders.length - KEEP_DAYS));
  for (const folder of toDelete) {
    const fullPath = path.join(BACKUPS_DIR, folder);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      log(`Pruned old backup: ${folder}`);
    } catch (e) {
      log(`  Warning: could not prune ${folder}: ${e.message}`);
    }
  }
}

async function main() {
  const dateStr = today();
  const destBase = path.join(BACKUPS_DIR, dateStr);

  log(`=== Appraisal Agent daily backup starting (${dateStr}) ===`);

  const sources = [
    { name: 'cases', src: path.join(PROJECT_ROOT, 'cases') },
    { name: 'knowledge_base', src: path.join(PROJECT_ROOT, 'knowledge_base') },
  ];

  let anyError = false;

  for (const { name, src } of sources) {
    const dest = path.join(destBase, name);
    if (!fs.existsSync(src)) {
      log(`  Skipping ${name}/ â€” not found at ${src}`);
      continue;
    }
    try {
      log(`  Backing up ${name}/ ...`);
      const count = copyDirSync(src, dest);
      log(`  âœ“ ${name}/: ${count} files copied â†’ ${path.relative(PROJECT_ROOT, dest)}`);
    } catch (e) {
      log(`  ERROR backing up ${name}/: ${e.message}`);
      anyError = true;
    }
  }

  // Prune old backups
  try {
    pruneOldBackups();
  } catch (e) {
    log(`  Warning: prune failed: ${e.message}`);
  }

  log(`=== Backup complete (errors: ${anyError ? 'yes' : 'none'}) ===\n`);

  if (anyError) {
    process.exit(1);
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});

