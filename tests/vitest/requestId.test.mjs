/**
 * tests/vitest/requestId.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the request ID middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware } from '../../server/middleware/requestId.js';

function mockReq(overrides = {}) {
  return { headers: {}, ...overrides };
}

function mockRes() {
  const res = {
    headers: {},
    setHeader(name, val) { res.headers[name] = val; },
  };
  return res;
}

describe('requestIdMiddleware', () => {
  it('should generate a request ID when none exists', () => {
    const mw = requestIdMiddleware();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(req.id).toBeTruthy();
    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBeGreaterThan(10);
    expect(res.headers['X-Request-ID']).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should use existing x-request-id header when trusted', () => {
    const mw = requestIdMiddleware();
    const req = mockReq({ headers: { 'x-request-id': 'upstream-123' } });
    const res = mockRes();

    mw(req, res, vi.fn());

    expect(req.id).toBe('upstream-123');
    expect(res.headers['X-Request-ID']).toBe('upstream-123');
  });

  it('should ignore upstream header when trustProxy is false', () => {
    const mw = requestIdMiddleware({ trustProxy: false });
    const req = mockReq({ headers: { 'x-request-id': 'upstream-456' } });
    const res = mockRes();

    mw(req, res, vi.fn());

    expect(req.id).not.toBe('upstream-456');
    expect(req.id.length).toBeGreaterThan(10);
  });

  it('should use custom header name', () => {
    const mw = requestIdMiddleware({ header: 'x-correlation-id' });
    const req = mockReq({ headers: { 'x-correlation-id': 'corr-789' } });
    const res = mockRes();

    mw(req, res, vi.fn());

    expect(req.id).toBe('corr-789');
  });

  it('should reject excessively long upstream IDs', () => {
    const mw = requestIdMiddleware();
    const longId = 'a'.repeat(200);
    const req = mockReq({ headers: { 'x-request-id': longId } });
    const res = mockRes();

    mw(req, res, vi.fn());

    expect(req.id).not.toBe(longId);
    expect(req.id.length).toBeLessThan(128);
  });

  it('should generate unique IDs for consecutive requests', () => {
    const mw = requestIdMiddleware();
    const ids = [];

    for (let i = 0; i < 100; i++) {
      const req = mockReq();
      mw(req, mockRes(), vi.fn());
      ids.push(req.id);
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);
  });

  it('should always call next()', () => {
    const mw = requestIdMiddleware();
    const next = vi.fn();

    mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should generate IDs with timestamp-random format', () => {
    const mw = requestIdMiddleware();
    const req = mockReq();
    mw(req, mockRes(), vi.fn());

    // Format: hex_timestamp-hex_random
    expect(req.id).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });
});
