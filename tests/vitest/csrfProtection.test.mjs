/**
 * tests/vitest/csrfProtection.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for CSRF protection middleware.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  generateCsrfToken,
  csrfProtection,
  csrfTokenEndpoint,
} from '../../server/middleware/csrfProtection.js';

function mockReq(overrides = {}) {
  return {
    method: 'POST',
    path: '/api/cases',
    headers: {},
    cookies: {},
    id: 'req-csrf-test',
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    jsonBody: null,
    cookies: {},
    status(code) { res.statusCode = code; return res; },
    json(body) { res.jsonBody = body; return res; },
    cookie(name, value, opts) { res.cookies[name] = { value, opts }; },
  };
  return res;
}

describe('generateCsrfToken', () => {
  it('should return a 64-character hex string', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should generate unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('csrfProtection', () => {
  it('should skip safe methods (GET)', () => {
    const mw = csrfProtection();
    const next = vi.fn();
    mw(mockReq({ method: 'GET' }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should skip safe methods (HEAD)', () => {
    const mw = csrfProtection();
    const next = vi.fn();
    mw(mockReq({ method: 'HEAD' }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should skip safe methods (OPTIONS)', () => {
    const mw = csrfProtection();
    const next = vi.fn();
    mw(mockReq({ method: 'OPTIONS' }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should skip whitelisted paths', () => {
    const mw = csrfProtection();
    const next = vi.fn();
    mw(mockReq({ path: '/api/billing/webhook' }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should skip API key authenticated requests', () => {
    const mw = csrfProtection();
    const next = vi.fn();
    mw(mockReq({ headers: { 'x-api-key': 'abc123' } }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should reject when cookie and header are missing', () => {
    const mw = csrfProtection();
    const res = mockRes();
    mw(mockReq(), res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(res.jsonBody.error.type).toBe('csrf_validation_failed');
  });

  it('should reject when header is missing', () => {
    const mw = csrfProtection();
    const res = mockRes();
    mw(mockReq({ cookies: { csrfToken: 'abc' } }), res, vi.fn());
    expect(res.statusCode).toBe(403);
  });

  it('should reject when cookie and header mismatch', () => {
    const mw = csrfProtection();
    const res = mockRes();
    mw(
      mockReq({
        cookies: { csrfToken: 'abc123' },
        headers: { 'x-csrf-token': 'different-token' },
      }),
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(403);
  });

  it('should pass when cookie and header match', () => {
    const token = generateCsrfToken();
    const mw = csrfProtection();
    const next = vi.fn();
    mw(
      mockReq({
        cookies: { csrfToken: token },
        headers: { 'x-csrf-token': token },
      }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('should be disabled when enabled=false', () => {
    const mw = csrfProtection({ enabled: false });
    const next = vi.fn();
    mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should set cookie when not present on GET', () => {
    const mw = csrfProtection();
    const res = mockRes();
    const next = vi.fn();
    mw(mockReq({ method: 'GET', cookies: {} }), res, next);
    expect(res.cookies.csrfToken).toBeDefined();
    expect(res.cookies.csrfToken.value.length).toBe(64);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('csrfTokenEndpoint', () => {
  it('should return a token and set cookie', () => {
    const res = mockRes();
    csrfTokenEndpoint(mockReq(), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.csrfToken.length).toBe(64);
    expect(res.cookies.csrfToken.value).toBe(res.jsonBody.csrfToken);
  });
});
