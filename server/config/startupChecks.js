/**
 * server/config/startupChecks.js
 * -------------------------------
 * Phase A (OS-A5): startup config guardrails.
 *
 * Validates required environment variables and runtime configuration at
 * startup. Fails fast with actionable diagnostics on invalid config.
 */

import fs from 'fs';
import path from 'path';

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Run all startup validation checks.
 * Throws on fatal errors; logs warnings for non-critical issues.
 *
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} opts.casesDir
 * @param {string} opts.openAiApiKey
 * @param {Object} [opts.logger]
 */
export function runStartupChecks({
  port,
  casesDir,
  openAiApiKey,
  logger = console,
}) {
  const errors = [];
  const warnings = [];

  // ── Port ────────────────────────────────────────────────────────────────
  if (!isValidPort(port)) {
    errors.push(`Invalid PORT "${String(port)}" (must be 1-65535).`);
  }

  // ── Cases directory ─────────────────────────────────────────────────────
  if (!casesDir || typeof casesDir !== 'string') {
    errors.push('CASES_DIR is missing or invalid.');
  } else {
    try {
      fs.mkdirSync(casesDir, { recursive: true });
      fs.accessSync(casesDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      errors.push(`CASES_DIR is not writable: ${err.message}`);
    }
  }

  // ── OpenAI API key ──────────────────────────────────────────────────────
  if (!String(openAiApiKey || '').trim()) {
    warnings.push('OPENAI_API_KEY is missing; AI endpoints will return 503.');
  }

  // ── Database path ───────────────────────────────────────────────────────
  const dbPath = process.env.CACC_DB_PATH;
  if (dbPath) {
    const dbDir = path.dirname(dbPath);
    try {
      fs.mkdirSync(dbDir, { recursive: true });
      fs.accessSync(dbDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      errors.push(`CACC_DB_PATH directory is not writable: ${err.message}`);
    }
  }

  // ── Node.js version ─────────────────────────────────────────────────────
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeVersion < 18) {
    errors.push(`Node.js 18+ is required (found ${process.versions.node}).`);
  }

  // ── Environment sanity ──────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    if (!String(openAiApiKey || '').trim()) {
      errors.push('OPENAI_API_KEY is required in production mode.');
    }
  }

  // ── Logs directory ──────────────────────────────────────────────────────
  const logsDir = process.env.CACC_LOGS_DIR;
  if (logsDir) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      fs.accessSync(logsDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      warnings.push(`CACC_LOGS_DIR is not writable: ${err.message}`);
    }
  }

  // ── Report results ──────────────────────────────────────────────────────
  if (errors.length) {
    for (const e of errors) logger.error(`[startup] ${e}`);
    throw new Error(`Startup checks failed: ${errors.length} error(s)`);
  }

  for (const w of warnings) logger.warn(`[startup] ${w}`);
}
