/**
 * fileLogger.js
 * -------------
 * Writes structured log entries to disk in addition to stdout/stderr.
 *
 * Log files are stored in logs/ at the project root.
 * One file per day: logs/cacc-YYYY-MM-DD.log
 * Each line is a JSON object (same format as logger.js stdout output).
 *
 * Usage:
 *   import { initFileLogger, writeLogEntry } from './server/fileLogger.js';
 *   initFileLogger();   // call once at server startup
 *   writeLogEntry({ ts, level, msg, ...meta });
 *
 * The logger.js module calls writeLogEntry() automatically after initFileLogger().
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');

let _initialized = false;
let _currentLogPath = null;
let _currentDate = null;

// ── Internal helpers ──────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getLogPath(dateStr) {
  return path.join(LOGS_DIR, `cacc-${dateStr}.log`);
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function rotateDateIfNeeded() {
  const today = todayStr();
  if (today !== _currentDate) {
    _currentDate = today;
    _currentLogPath = getLogPath(today);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * initFileLogger()
 * Call once at server startup. Creates logs/ directory if needed.
 * Patches the global logger to also write to disk.
 */
export function initFileLogger() {
  if (_initialized) return;
  try {
    ensureLogsDir();
    rotateDateIfNeeded();
    _initialized = true;

    // Write startup marker
    writeLogEntry({
      ts:    new Date().toISOString(),
      level: 'info',
      msg:   'file-logger:init',
      logFile: _currentLogPath,
    });
  } catch (err) {
    // File logger failure is non-fatal — server continues without disk logging
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'fileLogger:init', error: err.message, detail: 'non-fatal' }) + '\n');
  }
}

/**
 * writeLogEntry(entry)
 * Appends a single JSON log line to today's log file.
 * Silently swallows errors (disk logging is non-fatal).
 *
 * @param {object} entry - Log entry object (ts, level, msg, ...meta)
 */
export function writeLogEntry(entry) {
  if (!_initialized) return;
  try {
    rotateDateIfNeeded();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(_currentLogPath, line, 'utf8');
  } catch {
    // Non-fatal — do not crash server on log write failure
  }
}

/**
 * getLogFiles()
 * Returns list of log files in logs/ sorted newest first.
 *
 * @returns {Array<{name, path, sizeBytes, date}>}
 */
export function getLogFiles() {
  try {
    ensureLogsDir();
    return fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('cacc-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .map(name => {
        const filePath = path.join(LOGS_DIR, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          path:      filePath,
          sizeBytes: stat.size,
          date:      name.replace('cacc-', '').replace('.log', ''),
        };
      });
  } catch {
    return [];
  }
}

/**
 * readLogFile(dateStr)
 * Reads a specific log file and returns its lines as parsed JSON objects.
 * Falls back to raw strings for unparseable lines.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Array<object|string>}
 */
export function readLogFile(dateStr) {
  try {
    const filePath = getLogPath(dateStr);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return line; }
      });
  } catch {
    return [];
  }
}

/**
 * getCurrentLogPath()
 * Returns the path to today's log file.
 *
 * @returns {string|null}
 */
export function getCurrentLogPath() {
  rotateDateIfNeeded();
  return _currentLogPath;
}

/**
 * getLogsDir()
 * Returns the logs directory path.
 *
 * @returns {string}
 */
export function getLogsDir() {
  return LOGS_DIR;
}

export default {
  initFileLogger,
  writeLogEntry,
  getLogFiles,
  readLogFile,
  getCurrentLogPath,
  getLogsDir,
};
