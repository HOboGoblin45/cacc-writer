/**
 * logger.js
 * ---------
 * Structured logger for CACC Writer server.
 *
 * Outputs JSON-formatted log lines to stdout/stderr so they can be
 * parsed by log aggregators or grepped easily in the terminal.
 *
 * Usage:
 *   import log from './server/logger.js';
 *   log.info('Server started', { port: 5178 });
 *   log.warn('KB save failed', { fieldId: 'reconciliation', error: err.message });
 *   log.error('AI call failed', { model: 'gpt-4.1', error: err.message });
 *
 * Log levels: debug < info < warn < error
 * Set LOG_LEVEL env var to control minimum level (default: info).
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;

// ── File logger fan-out (optional, initialized by initFileLogger()) ───────────
// Imported lazily to avoid circular deps at module load time.
let _fileLoggerWrite = null;

/**
 * setFileLogWriter(fn)
 * Called by fileLogger.js after init to wire disk fan-out.
 * @param {function} fn - writeLogEntry function from fileLogger.js
 */
export function setFileLogWriter(fn) {
  _fileLoggerWrite = fn;
}

function emit(level, message, meta = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry = {
    ts:      new Date().toISOString(),
    level,
    msg:     String(message),
    ...meta,
  };

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  // Fan-out to disk logger if wired
  if (_fileLoggerWrite) {
    try { _fileLoggerWrite(entry); } catch { /* non-fatal */ }
  }
}

const log = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info:  (msg, meta) => emit('info',  msg, meta),
  warn:  (msg, meta) => emit('warn',  msg, meta),
  error: (msg, meta) => emit('error', msg, meta),

  /**
   * log.request(req, durationMs)
   * Log an HTTP request with method, path, status, and duration.
   * Use as Express middleware or call manually after res.send().
   */
  request: (method, path, status, durationMs) => emit('info', 'http', {
    method: String(method).toUpperCase(),
    path:   String(path),
    status: Number(status),
    ms:     Number(durationMs),
  }),

  /**
   * log.ai(action, meta)
   * Log an AI call with model, field, and token/timing info.
   */
  ai: (action, meta = {}) => emit('info', 'ai:' + action, meta),

  /**
   * log.kb(action, meta)
   * Log a knowledge base operation.
   */
  kb: (action, meta = {}) => emit('info', 'kb:' + action, meta),
};

export default log;
