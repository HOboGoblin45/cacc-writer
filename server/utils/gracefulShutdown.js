/**
 * server/utils/gracefulShutdown.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Graceful shutdown handler for the CACC Writer server.
 *
 * Handles SIGTERM, SIGINT, and uncaught exceptions/rejections.
 * Ensures database connections are closed and in-flight requests complete
 * before the process exits.
 *
 * Usage:
 *   import { registerShutdownHandlers } from './utils/gracefulShutdown.js';
 *   const server = app.listen(PORT);
 *   registerShutdownHandlers(server);
 */

import log from '../logger.js';
import { closeDb, closeAllUserDbs } from '../db/database.js';

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

let _shuttingDown = false;

/**
 * Check if the server is currently shutting down.
 * Useful for health probes that should return 503 during shutdown.
 *
 * @returns {boolean}
 */
export function isShuttingDown() {
  return _shuttingDown;
}

/**
 * Perform a graceful shutdown.
 *
 * 1. Mark the server as shutting down (health probes return 503).
 * 2. Stop accepting new connections.
 * 3. Wait for in-flight requests to complete (up to SHUTDOWN_TIMEOUT_MS).
 * 4. Close database connections.
 * 5. Exit.
 *
 * @param {import('http').Server} server — the HTTP server instance
 * @param {string} signal — the signal or reason for shutdown
 */
async function shutdown(server, signal) {
  if (_shuttingDown) return; // Prevent double-shutdown
  _shuttingDown = true;

  log.info('shutdown:start', { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS });

  // Force exit after timeout to prevent hanging
  const forceTimer = setTimeout(() => {
    log.error('shutdown:forced', { reason: 'timeout', timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref(); // Don't keep the process alive for the timer

  try {
    // 1. Stop accepting new connections, wait for in-flight requests
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          log.warn('shutdown:server-close-error', { error: err.message });
        }
        resolve();
      });
    });

    log.info('shutdown:connections-drained');

    // 2. Close all user databases
    try {
      closeAllUserDbs();
      log.info('shutdown:user-dbs-closed');
    } catch (err) {
      log.warn('shutdown:user-dbs-error', { error: err.message });
    }

    // 3. Close the main database
    try {
      closeDb();
      log.info('shutdown:main-db-closed');
    } catch (err) {
      log.warn('shutdown:main-db-error', { error: err.message });
    }

    log.info('shutdown:complete', { signal });
    process.exit(0);
  } catch (err) {
    log.error('shutdown:error', { error: err.message });
    process.exit(1);
  }
}

/**
 * Register process signal handlers for graceful shutdown.
 *
 * @param {import('http').Server} server — the HTTP server instance
 */
export function registerShutdownHandlers(server) {
  // Standard termination signals
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));

  // Uncaught exceptions — log and exit
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { error: err.message, stack: err.stack });
    shutdown(server, 'uncaughtException');
  });

  // Unhandled promise rejections — log and exit
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    log.error('unhandledRejection', { error: message, stack });
    shutdown(server, 'unhandledRejection');
  });

  log.info('shutdown:handlers-registered', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
}

export default { registerShutdownHandlers, isShuttingDown };
