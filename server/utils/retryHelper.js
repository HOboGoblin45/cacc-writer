/**
 * server/utils/retryHelper.js
 * ---------------------------------------------------------------------------
 * Shared retry utility with exponential backoff, jitter, and circuit breaker.
 *
 * Used by AI providers, section job runner, and orchestrator for consistent
 * retry behavior across the generation pipeline.
 */

import log from '../logger.js';

// ── Exponential Backoff with Jitter ──────────────────────────────────────────

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param {(attempt: number) => Promise<T>} fn — the async operation to retry
 * @param {object} [options]
 *   @param {number}  [options.maxRetries=2]       — max retry attempts (not counting initial)
 *   @param {number}  [options.baseDelayMs=1000]   — base delay before first retry
 *   @param {number}  [options.maxDelayMs=30000]   — cap on delay between retries
 *   @param {boolean} [options.jitter=true]         — add random jitter to prevent thundering herd
 *   @param {string}  [options.label='operation']  — label for log messages
 *   @param {(err: Error) => boolean} [options.shouldRetry] — custom retry predicate
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = true,
    label = 'operation',
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const rawDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const delay = jitter ? rawDelay * (0.5 + Math.random() * 0.5) : rawDelay;
      log.warn(`${label}:retry`, { attempt, delayMs: Math.round(delay), maxRetries });
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (!shouldRetry(err) || attempt >= maxRetries) {
        break;
      }
    }
  }

  log.error(`${label}:retries-exhausted`, {
    maxRetries,
    error: lastError?.message,
  });

  throw lastError;
}

// ── Circuit Breaker ──────────────────────────────────────────────────────────

/**
 * Simple circuit breaker to prevent cascading failures.
 *
 * States:
 *   CLOSED  — requests flow normally, failures counted
 *   OPEN    — requests immediately rejected, waiting for reset
 *   HALF_OPEN — single test request allowed to check recovery
 *
 * @param {object} options
 *   @param {number} [options.failureThreshold=5]   — failures before opening
 *   @param {number} [options.resetTimeoutMs=60000]  — time in OPEN before trying HALF_OPEN
 *   @param {number} [options.successThreshold=2]    — successes in HALF_OPEN before closing
 *   @param {string} [options.name='circuit']        — name for logging
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000;
    this.successThreshold = options.successThreshold ?? 2;
    this.name = options.name ?? 'circuit';

    this._state = 'CLOSED';
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenInFlight = false;
  }

  get state() { return this._state; }

  get stats() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      lastFailureTime: this._lastFailureTime
        ? new Date(this._lastFailureTime).toISOString()
        : null,
    };
  }

  /**
   * Execute an async function through the circuit breaker.
   *
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {Error} If circuit is OPEN
   * @template T
   */
  async exec(fn) {
    if (this._state === 'OPEN') {
      // Check if reset timeout has elapsed
      if (Date.now() - this._lastFailureTime >= this.resetTimeoutMs) {
        this._transition('HALF_OPEN');
      } else {
        const err = new Error(`Circuit breaker "${this.name}" is OPEN — rejecting request`);
        err.code = 'CIRCUIT_OPEN';
        err.resetIn = Math.ceil((this.resetTimeoutMs - (Date.now() - this._lastFailureTime)) / 1000);
        throw err;
      }
    }

    if (this._state === 'HALF_OPEN' && this._halfOpenInFlight) {
      const err = new Error(`Circuit breaker "${this.name}" is HALF_OPEN — only one test request allowed`);
      err.code = 'CIRCUIT_HALF_OPEN';
      throw err;
    }

    if (this._state === 'HALF_OPEN') {
      this._halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    } finally {
      this._halfOpenInFlight = false;
    }
  }

  _onSuccess() {
    if (this._state === 'HALF_OPEN') {
      this._successCount++;
      if (this._successCount >= this.successThreshold) {
        this._transition('CLOSED');
      }
    } else {
      // Reset failure count on success in CLOSED state
      this._failureCount = 0;
    }
  }

  _onFailure(err) {
    this._lastFailureTime = Date.now();

    if (this._state === 'HALF_OPEN') {
      // Single failure in HALF_OPEN goes back to OPEN
      this._transition('OPEN');
      return;
    }

    this._failureCount++;
    if (this._failureCount >= this.failureThreshold) {
      this._transition('OPEN');
    }
  }

  _transition(newState) {
    const oldState = this._state;
    this._state = newState;

    if (newState === 'CLOSED') {
      this._failureCount = 0;
      this._successCount = 0;
    } else if (newState === 'HALF_OPEN') {
      this._successCount = 0;
    }

    log.info(`circuit-breaker:${this.name}`, {
      transition: `${oldState} → ${newState}`,
      failureCount: this._failureCount,
    });
  }

  /** Force reset to CLOSED (for testing or manual recovery). */
  reset() {
    this._state = 'CLOSED';
    this._failureCount = 0;
    this._successCount = 0;
    this._halfOpenInFlight = false;
  }
}

// ── Retry predicate helpers ──────────────────────────────────────────────────

/** Common retryable HTTP status codes */
export const RETRYABLE_HTTP_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Returns true if the error is retryable (network/server errors, not client errors).
 */
export function isRetryableError(err) {
  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return true;
  }

  // Timeout errors
  if (err.name === 'AbortError' || err.message?.includes('timeout')) {
    return true;
  }

  // Retryable HTTP status codes
  const status = err.status || err.statusCode;
  if (status && RETRYABLE_HTTP_CODES.has(status)) {
    return true;
  }

  // OpenAI rate limit
  if (err.message?.includes('Rate limit') || err.message?.includes('429')) {
    return true;
  }

  return false;
}

export default { withRetry, CircuitBreaker, isRetryableError, RETRYABLE_HTTP_CODES };
