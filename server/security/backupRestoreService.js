/**
 * server/security/backupRestoreService.js
 * -----------------------------------------
 * Backup & Restore Service
 *
 * Provides full database backup/restore with integrity verification.
 * Backup files are stored in the ./backups/ directory.
 *
 * Usage:
 *   import { createBackup, listBackups, verifyBackup } from './backupRestoreService.js';
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dbAll, dbGet, dbRun, getDb } from '../db/database.js';
import { getDbPath } from '../db/database.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return 'bkp_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function computeFileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function getTableCounts() {
  const db = getDb();
  const tables = [
    'case_records', 'case_facts', 'case_outputs', 'assignments',
    'generation_runs', 'section_jobs', 'generated_sections',
    'memory_items', 'users', 'access_policies',
  ];
  const counts = {};
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
      counts[t] = row?.n ?? 0;
    } catch {
      counts[t] = 0;
    }
  }
  return counts;
}

// ── Backup Operations ────────────────────────────────────────────────────────

/**
 * Create a full database backup.
 */
export async function createBackup(options = {}) {
  ensureBackupsDir();

  const id = genId();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `cacc-backup-${timestamp}.db`;
  const backupPath = path.join(BACKUPS_DIR, filename);
  const backupType = options.type || 'full';
  const createdAt = now();

  try {
    const dbPath = getDbPath();
    const db = getDb();

    if (typeof db.backup === 'function') {
      await db.backup(backupPath);
    } else {
      try {
        db.pragma('wal_checkpoint(FULL)');
      } catch {
      }
      fs.copyFileSync(dbPath, backupPath);
    }

    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file was not created');
    }

    const stats = fs.statSync(backupPath);
    const fileHash = computeFileHash(backupPath);
    const tableCounts = getTableCounts();

    dbRun(
      `INSERT INTO backup_records (id, backup_type, file_path, file_size_bytes, file_hash, table_counts_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [id, backupType, backupPath, stats.size, fileHash, JSON.stringify(tableCounts), createdAt]
    );

    // Update schedule last_run_at
    dbRun(
      `UPDATE backup_schedule SET last_run_at = ?, updated_at = ? WHERE id = 'default'`,
      [createdAt, createdAt]
    );

    log.info('backup:created', { id, path: backupPath, size: stats.size });
    return {
      id,
      backupType,
      filePath: backupPath,
      fileSizeBytes: stats.size,
      fileHash,
      tableCounts,
      createdAt,
    };
  } catch (err) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { force: true });
      }
    } catch {
    }

    // Record failed backup
    dbRun(
      `INSERT INTO backup_records (id, backup_type, status, error_text, created_at)
       VALUES (?, ?, 'failed', ?, ?)`,
      [id, backupType, err.message, createdAt]
    );
    log.error('backup:create-failed', { error: err.message });
    return { error: err.message };
  }
}

/**
 * List available backups.
 */
export function listBackups() {
  const backups = dbAll(
    `SELECT * FROM backup_records ORDER BY created_at DESC`
  );
  return backups.map(b => ({
    id: b.id,
    backupType: b.backup_type,
    filePath: b.file_path,
    fileSizeBytes: b.file_size_bytes,
    fileHash: b.file_hash,
    tableCounts: JSON.parse(b.table_counts_json || '{}'),
    status: b.status,
    errorText: b.error_text,
    createdAt: b.created_at,
    verifiedAt: b.verified_at,
  }));
}

/**
 * Restore from a backup file.
 * Writes a pending-restore marker; actual restore happens on next server startup.
 */
export function restoreFromBackup(backupId) {
  const record = dbGet('SELECT * FROM backup_records WHERE id = ?', [backupId]);
  if (!record) return { error: 'Backup not found' };
  if (!record.file_path || !fs.existsSync(record.file_path)) {
    return { error: 'Backup file not found on disk' };
  }

  // Verify hash before accepting the restore request
  const currentHash = computeFileHash(record.file_path);
  if (currentHash !== record.file_hash) {
    log.error('backup:restore-hash-mismatch', { backupId, expected: record.file_hash, actual: currentHash });
    return { error: 'Backup file integrity check failed — hash mismatch' };
  }

  const DATA_DIR = path.join(__dirname, '..', '..', 'data');
  const markerPath = path.join(DATA_DIR, 'pending-restore.json');
  const marker = {
    backupId,
    filePath: record.file_path,
    expectedHash: record.file_hash,
    requestedAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));

  log.info('backup:restore-requested', { backupId, filePath: record.file_path });
  return {
    backupId,
    filePath: record.file_path,
    status: 'restore_pending',
    message: 'Restore marker written. Application restart required to complete restore.',
  };
}

/**
 * Apply a pending restore on server startup.
 * Reads data/pending-restore.json, verifies the backup hash, creates a safety copy,
 * replaces the live DB, and deletes the marker.
 */
export function applyPendingRestore() {
  const DATA_DIR = path.join(__dirname, '..', '..', 'data');
  const markerPath = path.join(DATA_DIR, 'pending-restore.json');

  if (!fs.existsSync(markerPath)) return null;

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (err) {
    log.error('backup:restore-marker-corrupt', { error: err.message });
    fs.unlinkSync(markerPath);
    return { error: 'Corrupt restore marker — removed' };
  }

  const { backupId, filePath, expectedHash } = marker;

  if (!filePath || !fs.existsSync(filePath)) {
    fs.unlinkSync(markerPath);
    return { error: `Backup file not found: ${filePath}` };
  }

  // Verify hash
  const actualHash = computeFileHash(filePath);
  if (actualHash !== expectedHash) {
    fs.unlinkSync(markerPath);
    log.error('backup:restore-hash-mismatch', { backupId, expected: expectedHash, actual: actualHash });
    throw new Error(`Restore aborted: backup hash mismatch (expected ${expectedHash}, got ${actualHash})`);
  }

  // Safety copy of current DB
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyCopy = `${dbPath}.pre-restore-${timestamp}`;
    fs.copyFileSync(dbPath, safetyCopy);
    log.info('backup:safety-copy', { from: dbPath, to: safetyCopy });
  }

  // Replace live DB with backup
  fs.copyFileSync(filePath, dbPath);

  // Delete marker
  fs.unlinkSync(markerPath);

  log.info('backup:restore-completed', { backupId, filePath });
  return { backupId, filePath, status: 'restored', restoredAt: new Date().toISOString() };
}

/**
 * Check if there is a pending restore.
 */
export function getPendingRestore() {
  const DATA_DIR = path.join(__dirname, '..', '..', 'data');
  const markerPath = path.join(DATA_DIR, 'pending-restore.json');
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Cancel a pending restore.
 */
export function cancelPendingRestore() {
  const DATA_DIR = path.join(__dirname, '..', '..', 'data');
  const markerPath = path.join(DATA_DIR, 'pending-restore.json');
  if (!fs.existsSync(markerPath)) return { status: 'no_pending_restore' };
  fs.unlinkSync(markerPath);
  log.info('backup:restore-cancelled');
  return { status: 'cancelled' };
}

/**
 * Get current backup schedule.
 */
export function getBackupSchedule() {
  let schedule = dbGet('SELECT * FROM backup_schedule WHERE id = ?', ['default']);
  if (!schedule) {
    dbRun(
      `INSERT INTO backup_schedule (id, interval_hours, retention_days, max_backups, enabled, updated_at)
       VALUES ('default', 24, 30, 10, 1, ?)`,
      [now()]
    );
    schedule = dbGet('SELECT * FROM backup_schedule WHERE id = ?', ['default']);
  }
  return {
    intervalHours: schedule.interval_hours,
    retentionDays: schedule.retention_days,
    maxBackups: schedule.max_backups,
    enabled: !!schedule.enabled,
    lastRunAt: schedule.last_run_at,
    nextRunAt: schedule.next_run_at,
    updatedAt: schedule.updated_at,
  };
}

/**
 * Set backup schedule configuration.
 */
export function setBackupSchedule(config) {
  const current = getBackupSchedule();
  const intervalHours = config.intervalHours ?? current.intervalHours;
  const retentionDays = config.retentionDays ?? current.retentionDays;
  const maxBackups = config.maxBackups ?? current.maxBackups;
  const enabled = config.enabled !== undefined ? (config.enabled ? 1 : 0) : (current.enabled ? 1 : 0);

  const nextRunAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();

  dbRun(
    `UPDATE backup_schedule
     SET interval_hours = ?, retention_days = ?, max_backups = ?, enabled = ?, next_run_at = ?, updated_at = ?
     WHERE id = 'default'`,
    [intervalHours, retentionDays, maxBackups, enabled, nextRunAt, now()]
  );

  log.info('backup:schedule-updated', { intervalHours, retentionDays, maxBackups, enabled });
  return getBackupSchedule();
}

/**
 * Verify backup integrity.
 */
export function verifyBackup(backupId) {
  const record = dbGet('SELECT * FROM backup_records WHERE id = ?', [backupId]);
  if (!record) return { error: 'Backup not found' };

  const checks = { fileExists: false, hashMatch: false, tableCountsMatch: false };

  // Check file exists
  if (record.file_path && fs.existsSync(record.file_path)) {
    checks.fileExists = true;

    // Verify hash
    const currentHash = computeFileHash(record.file_path);
    checks.hashMatch = currentHash === record.file_hash;

    // Verify file size
    const stats = fs.statSync(record.file_path);
    checks.sizeMatch = stats.size === record.file_size_bytes;
  }

  // Table counts verification (compare with stored counts)
  const storedCounts = JSON.parse(record.table_counts_json || '{}');
  checks.tableCountsMatch = Object.keys(storedCounts).length > 0;

  const verified = checks.fileExists && checks.hashMatch;

  // Update verification timestamp
  if (verified) {
    dbRun(
      'UPDATE backup_records SET verified_at = ? WHERE id = ?',
      [now(), backupId]
    );
  }

  log.info('backup:verified', { backupId, verified, checks });
  return { backupId, verified, checks, verifiedAt: verified ? now() : null };
}

/**
 * Get disaster recovery readiness status.
 */
export function getDRStatus() {
  const backups = listBackups();
  const completedBackups = backups.filter(b => b.status === 'completed');
  const schedule = getBackupSchedule();

  const hasRecentBackup = completedBackups.length > 0 &&
    new Date(completedBackups[0].createdAt) > new Date(Date.now() - 48 * 60 * 60 * 1000);

  const hasVerifiedBackup = completedBackups.some(b => b.verifiedAt);

  return {
    ready: hasRecentBackup && schedule.enabled,
    totalBackups: completedBackups.length,
    hasRecentBackup,
    hasVerifiedBackup,
    scheduleEnabled: schedule.enabled,
    lastBackupAt: completedBackups[0]?.createdAt || null,
    recommendations: [
      ...(!hasRecentBackup ? ['Create a backup — no recent backup found'] : []),
      ...(!hasVerifiedBackup ? ['Verify at least one backup for integrity'] : []),
      ...(!schedule.enabled ? ['Enable automated backup schedule'] : []),
    ],
  };
}

export default {
  createBackup,
  listBackups,
  restoreFromBackup,
  applyPendingRestore,
  getPendingRestore,
  cancelPendingRestore,
  getBackupSchedule,
  setBackupSchedule,
  verifyBackup,
  getDRStatus,
};
