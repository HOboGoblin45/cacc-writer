/**
 * tests/vitest/requestTimeout.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the request timeout middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { requestTimeout, aiTimeout, apiTimeout } from '../../server/middleware/requestTimeout.js';

function mockReq(overrides = {}) {
  return {
    method: 'POST',
    originalUrl: '/api/generate',
    headers: {},
    id: 'req-test',
    user: null,
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    jsonBody: null,
    headersSent: false,
    _finishListeners: [],
    _closeListeners: [],
    setHeader(name, val) { res.headers[name] = val; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.jsonBody = body; return res; },
    send(body) { res.sendBody = body; return res; },
    on(event, fn) {
      if (event === 'finish') res._finishListeners.push(fn);
      if (event === 'close') res._closeListeners.push(fn);
    },
    _emitFinish() { res._finishListeners.forEach(fn => fn()); },
  };
  return res;
}

describe('requestTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should call next() immediately', () => {
    const mw = requestTimeout(5000);
    const next = vi.fn();
    mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('should send 504 after timeout', () => {
    const mw = requestTimeout(100);
    const res = mockRes();
    mw(mockReq(), res, vi.fn());

    vi.advanceTimersByTime(150);

    expect(res.statusCode).toBe(504);
    expect(res.jsonBody.ok).toBe(false);
    expect(res.jsonBody.error.type).toBe('gateway_timeout');
    vi.useRealTimers();
  });

  it('should not send 504 if response finishes before timeout', () => {
    const mw = requestTimeout(200);
    const res = mockRes();
    mw(mockReq(), res, vi.fn());

    // Simulate response finishing
    res._emitFinish();

    vi.advanceTimersByTime(300);

    // Should not have sent timeout response
    expect(res.jsonBody).toBeNull();
    vi.useRealTimers();
  });

  it('should skip SSE/streaming requests', () => {
    const mw = requestTimeout(100);
    const req = mockReq({ headers: { accept: 'text/event-stream' } });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);
    vi.advanceTimersByTime(200);

    expect(res.jsonBody).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('should not double-send if headers already sent', () => {
    const mw = requestTimeout(100);
    const res = mockRes();
    res.headersSent = true;
    mw(mockReq(), res, vi.fn());

    vi.advanceTimersByTime(150);

    expect(res.jsonBody).toBeNull();
    vi.useRealTimers();
  });

  it('should suppress late json() calls after timeout', () => {
    const mw = requestTimeout(100);
    const res = mockRes();
    mw(mockReq(), res, vi.fn());

    vi.advanceTimersByTime(150);
    expect(res.statusCode).toBe(504);

    // Late response should be suppressed
    const lateResult = res.json({ ok: true, data: 'late' });
    // Should return res (no-op) rather than updating jsonBody
    expect(lateResult).toBe(res);
    vi.useRealTimers();
  });

  it('should include requestId in timeout response', () => {
    const mw = requestTimeout(100);
    const res = mockRes();
    mw(mockReq({ id: 'abc-123' }), res, vi.fn());

    vi.advanceTimersByTime(150);

    expect(res.jsonBody.requestId).toBe('abc-123');
    vi.useRealTimers();
  });

  it('should use custom message', () => {
    const mw = requestTimeout(100, { message: 'Custom timeout' });
    const res = mockRes();
    mw(mockReq(), res, vi.fn());

    vi.advanceTimersByTime(150);

    expect(res.jsonBody.error.message).toBe('Custom timeout');
    vi.useRealTimers();
  });
});

describe('exported presets', () => {
  it('aiTimeout should be a function', () => {
    expect(typeof aiTimeout).toBe('function');
  });

  it('apiTimeout should be a function', () => {
    expect(typeof apiTimeout).toBe('function');
  });
});
