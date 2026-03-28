/**
 * tests/vitest/errorHandler.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the global error handler middleware, async handler wrapper,
 * and HTTP error factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../server/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  errorHandler,
  asyncHandler,
  createHttpError,
} from '../../server/middleware/errorHandler.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    path: '/api/test',
    ip: '127.0.0.1',
    headers: {},
    user: null,
    id: 'req-123',
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    jsonBody: null,
    headersSent: false,
    setHeader(name, val) { res.headers[name] = val; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.jsonBody = body; return res; },
  };
  return res;
}

// ── errorHandler ─────────────────────────────────────────────────────────────

describe('errorHandler', () => {
  let handler;

  beforeEach(() => {
    handler = errorHandler({ includeStack: false });
  });

  it('should return 500 for generic errors', () => {
    const req = mockReq();
    const res = mockRes();
    handler(new Error('Something broke'), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.ok).toBe(false);
    expect(res.jsonBody.error.type).toBe('internal_error');
    expect(res.jsonBody.requestId).toBe('req-123');
  });

  it('should use error.status for HTTP status', () => {
    const err = new Error('Not found');
    err.status = 404;

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody.error.type).toBe('not_found');
  });

  it('should use error.statusCode for HTTP status', () => {
    const err = new Error('Forbidden');
    err.statusCode = 403;

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody.error.type).toBe('forbidden');
  });

  it('should handle CIRCUIT_OPEN errors with 503 and Retry-After', () => {
    const err = new Error('Circuit open');
    err.code = 'CIRCUIT_OPEN';
    err.resetIn = 45;

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(503);
    expect(res.jsonBody.error.type).toBe('circuit_open');
    expect(res.jsonBody.error.resetIn).toBe(45);
    expect(res.headers['Retry-After']).toBe(45);
  });

  it('should handle ZodError with 400 and details', () => {
    const err = new Error('Validation failed');
    err.name = 'ZodError';
    err.errors = [{ path: ['name'], message: 'Required' }];

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error.type).toBe('validation_error');
    expect(res.jsonBody.error.details).toEqual([{ path: ['name'], message: 'Required' }]);
  });

  it('should handle 429 with Retry-After header', () => {
    const err = new Error('Rate limited');
    err.status = 429;
    err.resetIn = 30;

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe(30);
  });

  it('should sanitize 500 error messages in production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const prodHandler = errorHandler({ includeStack: false });
    const res = mockRes();
    prodHandler(new Error('Secret DB password leaked'), mockReq(), res, vi.fn());

    expect(res.jsonBody.error.message).toBe('Internal server error');
    expect(res.jsonBody.error.stack).toBeUndefined();

    process.env.NODE_ENV = origEnv;
  });

  it('should show error message for client errors', () => {
    const err = new Error('Email is required');
    err.status = 400;

    const res = mockRes();
    handler(err, mockReq(), res, vi.fn());

    expect(res.jsonBody.error.message).toBe('Email is required');
  });

  it('should not send if headers already sent', () => {
    const res = mockRes();
    res.headersSent = true;

    handler(new Error('late'), mockReq(), res, vi.fn());
    expect(res.jsonBody).toBeNull(); // json() never called
  });

  it('should include request ID from req.id', () => {
    const res = mockRes();
    handler(new Error('test'), mockReq({ id: 'abc-def' }), res, vi.fn());
    expect(res.jsonBody.requestId).toBe('abc-def');
  });

  it('should fall back to x-request-id header', () => {
    const res = mockRes();
    handler(
      new Error('test'),
      mockReq({ id: undefined, headers: { 'x-request-id': 'header-id' } }),
      res,
      vi.fn(),
    );
    expect(res.jsonBody.requestId).toBe('header-id');
  });

  it('should include stack trace when includeStack is true', () => {
    const devHandler = errorHandler({ includeStack: true });
    const res = mockRes();
    devHandler(new Error('dev error'), mockReq(), res, vi.fn());
    expect(res.jsonBody.error.stack).toBeTruthy();
  });
});

// ── asyncHandler ─────────────────────────────────────────────────────────────

describe('asyncHandler', () => {
  it('should call the wrapped function', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(fn);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await wrapped(req, res, next);
    expect(fn).toHaveBeenCalledWith(req, res, next);
  });

  it('should forward rejections to next()', async () => {
    const error = new Error('async fail');
    const fn = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(fn);
    const next = vi.fn();

    await wrapped(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('should forward sync throws to next()', async () => {
    const error = new Error('sync fail');
    const fn = vi.fn().mockImplementation(() => { throw error; });
    const wrapped = asyncHandler(fn);
    const next = vi.fn();

    await wrapped(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── createHttpError ──────────────────────────────────────────────────────────

describe('createHttpError', () => {
  it('should create an error with status', () => {
    const err = createHttpError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
  });

  it('should attach code when provided', () => {
    const err = createHttpError(400, 'Bad request', 'BAD_REQUEST');
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('should work without code', () => {
    const err = createHttpError(500, 'Server error');
    expect(err.code).toBeUndefined();
  });
});
