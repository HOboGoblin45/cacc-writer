/**
 * tests/vitest/rateLimiter.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the per-user rate limiter — bucket logic, tier limits,
 * middleware behavior, login brute-force protection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database (rateLimiter imports getDb for tier lookup)
vi.mock('../../server/db/database.js', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => null }),
  }),
}));

import {
  checkRateLimit,
  rateLimitMiddleware,
  checkLoginRateLimit,
  TIER_LIMITS,
} from '../../server/security/rateLimiter.js';

// ── TIER_LIMITS ──────────────────────────────────────────────────────────────

describe('TIER_LIMITS', () => {
  it('should define limits for all subscription tiers', () => {
    expect(TIER_LIMITS).toHaveProperty('free');
    expect(TIER_LIMITS).toHaveProperty('starter');
    expect(TIER_LIMITS).toHaveProperty('professional');
    expect(TIER_LIMITS).toHaveProperty('enterprise');
  });

  it('should increase limits with higher tiers', () => {
    expect(TIER_LIMITS.starter.aiCallsPerHour).toBeGreaterThan(TIER_LIMITS.free.aiCallsPerHour);
    expect(TIER_LIMITS.professional.aiCallsPerHour).toBeGreaterThan(TIER_LIMITS.starter.aiCallsPerHour);
    expect(TIER_LIMITS.enterprise.aiCallsPerHour).toBeGreaterThan(TIER_LIMITS.professional.aiCallsPerHour);
  });
});

// ── checkRateLimit ───────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  it('should allow first request', () => {
    const result = checkRateLimit('user-fresh-1', 'request', 'free');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThan(TIER_LIMITS.free.requestsPerMinute);
  });

  it('should return limit and resetIn', () => {
    const result = checkRateLimit('user-fresh-2', 'request', 'starter');
    expect(result.limit).toBe(TIER_LIMITS.starter.requestsPerMinute);
    expect(result.resetIn).toBeGreaterThan(0);
  });

  it('should block after exceeding the limit', () => {
    const userId = 'user-exceed-test';
    const limit = TIER_LIMITS.free.requestsPerMinute;

    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      checkRateLimit(userId, 'request', 'free');
    }

    // Next request should be blocked
    const result = checkRateLimit(userId, 'request', 'free');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track AI calls with hour-long window', () => {
    const result = checkRateLimit('user-ai-1', 'ai', 'professional');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(TIER_LIMITS.professional.aiCallsPerHour);
  });

  it('should track upload calls separately', () => {
    const result = checkRateLimit('user-upload-1', 'upload', 'free');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(TIER_LIMITS.free.uploadsPerHour);
  });

  it('should handle unknown tier by falling back to default', () => {
    const result = checkRateLimit('user-unknown-tier', 'request', 'nonexistent');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(TIER_LIMITS.default.requestsPerMinute);
  });
});

// ── rateLimitMiddleware ──────────────────────────────────────────────────────

describe('rateLimitMiddleware', () => {
  function mockReq(overrides = {}) {
    return { user: null, ip: '127.0.0.1', ...overrides };
  }
  function mockRes() {
    const res = {
      statusCode: 200,
      headers: {},
      jsonBody: null,
      setHeader(name, val) { res.headers[name] = val; },
      status(code) { res.statusCode = code; return res; },
      json(body) { res.jsonBody = body; return res; },
    };
    return res;
  }

  it('should call next() for allowed requests', () => {
    const middleware = rateLimitMiddleware('request');
    const req = mockReq({ ip: '10.0.0.1' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.headers['X-RateLimit-Limit']).toBeDefined();
    expect(res.headers['X-RateLimit-Remaining']).toBeDefined();
  });

  it('should return 429 when rate limit exceeded', () => {
    const middleware = rateLimitMiddleware('request');
    const ip = '10.0.0.99';

    // Exhaust limit
    const limit = TIER_LIMITS.free.requestsPerMinute;
    for (let i = 0; i < limit + 1; i++) {
      const req = mockReq({ ip });
      const res = mockRes();
      middleware(req, res, vi.fn());
    }

    // Next one should be 429
    const req = mockReq({ ip });
    const res = mockRes();
    const next = vi.fn();
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.jsonBody.error).toContain('Rate limit exceeded');
  });

  it('should set standard rate limit headers', () => {
    const middleware = rateLimitMiddleware('ai');
    const req = mockReq({ user: { userId: 'user-headers-test' }, ip: '10.0.0.2' });
    const res = mockRes();

    middleware(req, res, vi.fn());

    expect(res.headers['X-RateLimit-Limit']).toBeDefined();
    expect(res.headers['X-RateLimit-Remaining']).toBeDefined();
    expect(res.headers['X-RateLimit-Reset']).toBeDefined();
  });
});

// ── checkLoginRateLimit ──────────────────────────────────────────────────────

describe('checkLoginRateLimit', () => {
  it('should allow initial login attempts', () => {
    const result = checkLoginRateLimit('login-test-fresh');
    expect(result.allowed).toBe(true);
    expect(result.attemptsRemaining).toBeGreaterThan(0);
  });

  it('should block after too many failed attempts', () => {
    const identifier = 'login-test-brute';

    // Exhaust 10 attempts
    for (let i = 0; i < 10; i++) {
      checkLoginRateLimit(identifier);
    }

    // 11th should be blocked
    const result = checkLoginRateLimit(identifier);
    expect(result.allowed).toBe(false);
    expect(result.attemptsRemaining).toBe(0);
    expect(result.resetIn).toBeGreaterThan(0);
  });

  it('should decrement remaining attempts on each call', () => {
    const r1 = checkLoginRateLimit('login-test-decrement');
    const r2 = checkLoginRateLimit('login-test-decrement');
    expect(r2.attemptsRemaining).toBeLessThan(r1.attemptsRemaining);
  });
});
