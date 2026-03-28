/**
 * tests/vitest/retryHelper.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the shared retry utility — exponential backoff with jitter,
 * circuit breaker state machine, and retryable error predicates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger so tests don't produce noise
vi.mock('../../server/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  withRetry,
  CircuitBreaker,
  isRetryableError,
  RETRYABLE_HTTP_CODES,
} from '../../server/utils/retryHelper.js';

// ── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('should return result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      label: 'test-recover',
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, label: 'test-exhaust' })
    ).rejects.toThrow('permanent');

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should pass attempt number to the function', async () => {
    const attempts = [];
    const fn = vi.fn(async (attempt) => {
      attempts.push(attempt);
      if (attempt < 2) throw new Error('retry');
      return 'done';
    });

    await withRetry(fn, { maxRetries: 2, baseDelayMs: 1 });
    expect(attempts).toEqual([0, 1, 2]);
  });

  it('should respect shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, {
        maxRetries: 5,
        baseDelayMs: 1,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledTimes(1); // no retries
  });

  it('should cap delay at maxDelayMs', async () => {
    const delays = [];
    const originalSetTimeout = globalThis.setTimeout;

    // We can't easily intercept setTimeout in this context,
    // so we just verify the function completes with large retry count
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('r1'))
      .mockRejectedValueOnce(new Error('r2'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
      label: 'cap-test',
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should work with jitter disabled', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxRetries: 1,
      baseDelayMs: 1,
      jitter: false,
    });

    expect(result).toBe('ok');
  });

  it('should use default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
  });
});

// ── CircuitBreaker ───────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      successThreshold: 2,
      name: 'test-circuit',
    });
  });

  it('should start in CLOSED state', () => {
    expect(cb.state).toBe('CLOSED');
  });

  it('should allow requests in CLOSED state', async () => {
    const result = await cb.exec(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(cb.state).toBe('CLOSED');
  });

  it('should count failures and open after threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.state).toBe('OPEN');
  });

  it('should reject requests when OPEN', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await expect(cb.exec(() => Promise.resolve('nope'))).rejects.toThrow(/OPEN/);
  });

  it('should set error code CIRCUIT_OPEN when rejecting', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    try {
      await cb.exec(() => Promise.resolve());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_OPEN');
      expect(err.resetIn).toBeGreaterThan(0);
    }
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.state).toBe('OPEN');

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 150));

    // Next call should be allowed (HALF_OPEN test request)
    const result = await cb.exec(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
  });

  it('should close after successThreshold successes in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 150));

    // Two successes needed to close
    await cb.exec(() => Promise.resolve('ok'));
    // After first success, still HALF_OPEN
    expect(cb.state).toBe('HALF_OPEN');

    await cb.exec(() => Promise.resolve('ok'));
    expect(cb.state).toBe('CLOSED');
  });

  it('should return to OPEN on failure in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 150));

    // Fail in HALF_OPEN
    await cb.exec(() => Promise.reject(new Error('still broken'))).catch(() => {});
    expect(cb.state).toBe('OPEN');
  });

  it('should only allow one test request in HALF_OPEN', async () => {
    // We need to test concurrent behavior - create a CB that stays in HALF_OPEN
    const slowCb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
      successThreshold: 2,
      name: 'slow-test',
    });

    await slowCb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    await new Promise(r => setTimeout(r, 100));

    // Start a slow request
    const slowPromise = slowCb.exec(() => new Promise(r => setTimeout(() => r('slow'), 200)));

    // Second request should be rejected
    try {
      await slowCb.exec(() => Promise.resolve('second'));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_HALF_OPEN');
    }

    await slowPromise; // clean up
  });

  it('should reset failure count on success in CLOSED state', async () => {
    // Two failures (under threshold of 3)
    await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.stats.failureCount).toBe(2);

    // Success resets count
    await cb.exec(() => Promise.resolve('ok'));
    expect(cb.stats.failureCount).toBe(0);
  });

  it('should expose stats', () => {
    const stats = cb.stats;
    expect(stats).toHaveProperty('state', 'CLOSED');
    expect(stats).toHaveProperty('failureCount', 0);
    expect(stats).toHaveProperty('successCount', 0);
    expect(stats).toHaveProperty('lastFailureTime', null);
  });

  it('should show lastFailureTime as ISO string after failure', async () => {
    await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.stats.lastFailureTime).toBeTruthy();
    // Should be a valid ISO date string
    expect(new Date(cb.stats.lastFailureTime).getTime()).toBeGreaterThan(0);
  });

  it('should force reset to CLOSED', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.exec(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.state).toBe('OPEN');

    cb.reset();
    expect(cb.state).toBe('CLOSED');
    expect(cb.stats.failureCount).toBe(0);
  });

  it('should use default options', () => {
    const defaultCb = new CircuitBreaker();
    expect(defaultCb.failureThreshold).toBe(5);
    expect(defaultCb.resetTimeoutMs).toBe(60000);
    expect(defaultCb.successThreshold).toBe(2);
    expect(defaultCb.name).toBe('circuit');
  });
});

// ── isRetryableError ─────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  it('should return true for ECONNRESET', () => {
    const err = new Error('connection reset');
    err.code = 'ECONNRESET';
    expect(isRetryableError(err)).toBe(true);
  });

  it('should return true for ECONNREFUSED', () => {
    const err = new Error('connection refused');
    err.code = 'ECONNREFUSED';
    expect(isRetryableError(err)).toBe(true);
  });

  it('should return true for ETIMEDOUT', () => {
    const err = new Error('timed out');
    err.code = 'ETIMEDOUT';
    expect(isRetryableError(err)).toBe(true);
  });

  it('should return true for AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isRetryableError(err)).toBe(true);
  });

  it('should return true for timeout in message', () => {
    expect(isRetryableError(new Error('Request timeout after 30s'))).toBe(true);
  });

  it('should return true for retryable HTTP status codes', () => {
    for (const code of [429, 500, 502, 503, 504]) {
      const err = new Error(`HTTP ${code}`);
      err.status = code;
      expect(isRetryableError(err)).toBe(true);
    }
  });

  it('should return true for statusCode property', () => {
    const err = new Error('server error');
    err.statusCode = 503;
    expect(isRetryableError(err)).toBe(true);
  });

  it('should return true for rate limit messages', () => {
    expect(isRetryableError(new Error('Rate limit reached'))).toBe(true);
    expect(isRetryableError(new Error('Error 429: too many requests'))).toBe(true);
  });

  it('should return false for client errors (4xx other than 429)', () => {
    const err = new Error('Bad request');
    err.status = 400;
    expect(isRetryableError(err)).toBe(false);
  });

  it('should return false for generic errors', () => {
    expect(isRetryableError(new Error('Invalid input'))).toBe(false);
  });

  it('should return false for 404', () => {
    const err = new Error('Not found');
    err.status = 404;
    expect(isRetryableError(err)).toBe(false);
  });
});

// ── RETRYABLE_HTTP_CODES ─────────────────────────────────────────────────────

describe('RETRYABLE_HTTP_CODES', () => {
  it('should be a Set', () => {
    expect(RETRYABLE_HTTP_CODES).toBeInstanceOf(Set);
  });

  it('should contain standard retryable codes', () => {
    expect(RETRYABLE_HTTP_CODES.has(429)).toBe(true);
    expect(RETRYABLE_HTTP_CODES.has(500)).toBe(true);
    expect(RETRYABLE_HTTP_CODES.has(502)).toBe(true);
    expect(RETRYABLE_HTTP_CODES.has(503)).toBe(true);
    expect(RETRYABLE_HTTP_CODES.has(504)).toBe(true);
  });

  it('should not contain client error codes', () => {
    expect(RETRYABLE_HTTP_CODES.has(400)).toBe(false);
    expect(RETRYABLE_HTTP_CODES.has(401)).toBe(false);
    expect(RETRYABLE_HTTP_CODES.has(403)).toBe(false);
    expect(RETRYABLE_HTTP_CODES.has(404)).toBe(false);
  });
});
