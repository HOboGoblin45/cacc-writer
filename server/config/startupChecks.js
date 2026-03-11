/**
 * server/config/startupChecks.js
 * -------------------------------
 * Phase A: startup config guardrails.
 */

import fs from 'fs';

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function runStartupChecks({
  port,
  casesDir,
  openAiApiKey,
  logger = console,
}) {
  const errors = [];
  const warnings = [];

  if (!isValidPort(port)) {
    errors.push(`Invalid PORT "${String(port)}" (must be 1-65535).`);
  }

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

  if (!String(openAiApiKey || '').trim()) {
    warnings.push('OPENAI_API_KEY is missing; AI endpoints will return 503.');
  }

  if (errors.length) {
    for (const e of errors) logger.error(`[startup] ${e}`);
    throw new Error('Startup checks failed');
  }

  for (const w of warnings) logger.warn(`[startup] ${w}`);
}
