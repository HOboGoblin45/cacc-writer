/**
 * server/utils/fileUtils.js
 * --------------------------
 * File I/O utilities for JSON read/write and async mutex helpers.
 *
 * Narrow purpose: safe JSON file operations and concurrency helpers.
 * No business logic — no AI calls, no appraisal decisions.
 */

import fs from 'fs';

// ── JSON helpers ──────────────────────────────────────────────────────────────

/**
 * readJSON(p, fallback)
 * Reads and parses a JSON file. Returns fallback on any error.
 *
 * @param {string} p        — absolute file path
 * @param {*}      fallback — value to return if file is missing or unparseable
 * @returns {*}
 */
export function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback !== undefined ? fallback : {};
  }
}

/**
 * writeJSON(p, data)
 * Atomically writes data as formatted JSON using a .tmp rename strategy.
 * Prevents partial writes from corrupting the target file.
 *
 * @param {string} p    — absolute file path
 * @param {*}      data — value to serialize
 */
export function writeJSON(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// ── Async mutex ───────────────────────────────────────────────────────────────

/**
 * withVoiceLock(fn)
 * Simple async mutex for voice_training.json to prevent concurrent write races.
 * All callers share the same promise chain — each fn() runs after the previous one.
 *
 * Usage:
 *   await withVoiceLock(() => { writeJSON(VOICE_FILE, data); });
 *
 * @param {() => any} fn — synchronous or async function to run exclusively
 * @returns {Promise<any>}
 */
let _voiceLock = Promise.resolve();

export function withVoiceLock(fn) {
  const next = _voiceLock.catch(() => {}).then(fn);
  _voiceLock = next.catch(() => {});
  return next;
}

// ── Per-case mutex ────────────────────────────────────────────────────────────

/**
 * withCaseLock(caseId, fn)
 * Per-case async mutex to prevent concurrent read-modify-write races on
 * case files (meta.json, facts.json, outputs.json, etc.).
 * Each caseId gets its own serialized promise chain.
 *
 * Usage:
 *   await withCaseLock(caseId, () => {
 *     const meta = readJSON(metaPath);
 *     meta.status = 'active';
 *     writeJSON(metaPath, meta);
 *   });
 *
 * @param {string} caseId — case identifier (used as lock key)
 * @param {() => any} fn  — synchronous or async function to run exclusively
 * @returns {Promise<any>}
 */
const _caseLocks = new Map();

export function withCaseLock(caseId, fn) {
  const prev = _caseLocks.get(caseId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const settled = next.catch(() => {});
  _caseLocks.set(caseId, settled);
  // Clean up lock entry when chain settles to avoid unbounded growth
  settled.then(() => {
    if (_caseLocks.get(caseId) === settled) _caseLocks.delete(caseId);
  });
  return next;
}
