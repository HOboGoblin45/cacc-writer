/**
 * tests/vitest/responseEnvelope.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for standardized API response envelope.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  success,
  failure,
  sendSuccess,
  sendError,
  errors,
} from '../../server/utils/responseEnvelope.js';

describe('success()', () => {
  it('should wrap data in ok:true envelope', () => {
    const result = success({ id: 1, name: 'test' });
    expect(result).toEqual({ ok: true, data: { id: 1, name: 'test' } });
  });

  it('should include meta when provided', () => {
    const result = success([1, 2, 3], { page: 1, total: 100 });
    expect(result).toEqual({
      ok: true,
      data: [1, 2, 3],
      meta: { page: 1, total: 100 },
    });
  });

  it('should omit meta when empty object', () => {
    const result = success('hello', {});
    expect(result).toEqual({ ok: true, data: 'hello' });
    expect(result).not.toHaveProperty('meta');
  });

  it('should omit meta when undefined', () => {
    const result = success(null);
    expect(result).toEqual({ ok: true, data: null });
    expect(result).not.toHaveProperty('meta');
  });
});

describe('failure()', () => {
  it('should wrap error in ok:false envelope', () => {
    const result = failure('not_found', 'Case not found');
    expect(result).toEqual({
      ok: false,
      error: { type: 'not_found', message: 'Case not found' },
    });
  });

  it('should include requestId at top level', () => {
    const result = failure('bad_request', 'Invalid input', { requestId: 'req-123' });
    expect(result.requestId).toBe('req-123');
    expect(result.error.requestId).toBeUndefined();
  });

  it('should include extra fields in error object', () => {
    const result = failure('validation_error', 'Invalid', { details: [{ field: 'name' }] });
    expect(result.error.details).toEqual([{ field: 'name' }]);
  });
});

describe('sendSuccess()', () => {
  function mockRes() {
    const res = {
      statusCode: 200,
      jsonBody: null,
      status(code) { res.statusCode = code; return res; },
      json(body) { res.jsonBody = body; return res; },
    };
    return res;
  }

  it('should send 200 with success envelope', () => {
    const res = mockRes();
    sendSuccess(res, { id: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ok: true, data: { id: 1 } });
  });

  it('should support custom status code', () => {
    const res = mockRes();
    sendSuccess(res, { id: 1 }, null, 201);
    expect(res.statusCode).toBe(201);
  });
});

describe('sendError()', () => {
  function mockRes(reqId) {
    const res = {
      statusCode: 200,
      jsonBody: null,
      req: { id: reqId || null },
      status(code) { res.statusCode = code; return res; },
      json(body) { res.jsonBody = body; return res; },
    };
    return res;
  }

  it('should send error with correct status', () => {
    const res = mockRes();
    sendError(res, 404, 'not_found', 'Case not found');
    expect(res.statusCode).toBe(404);
    expect(res.jsonBody.ok).toBe(false);
    expect(res.jsonBody.error.type).toBe('not_found');
  });

  it('should auto-include requestId from req', () => {
    const res = mockRes('req-abc');
    sendError(res, 500, 'internal_error', 'Something broke');
    expect(res.jsonBody.requestId).toBe('req-abc');
  });

  it('should prefer explicit requestId over req.id', () => {
    const res = mockRes('req-abc');
    sendError(res, 400, 'bad_request', 'Bad', { requestId: 'explicit-id' });
    expect(res.jsonBody.requestId).toBe('explicit-id');
  });
});

describe('errors convenience methods', () => {
  function mockRes() {
    const res = {
      statusCode: 200,
      jsonBody: null,
      req: { id: 'req-test' },
      status(code) { res.statusCode = code; return res; },
      json(body) { res.jsonBody = body; return res; },
    };
    return res;
  }

  const testCases = [
    { method: 'badRequest', status: 400, type: 'bad_request' },
    { method: 'unauthorized', status: 401, type: 'unauthorized' },
    { method: 'forbidden', status: 403, type: 'forbidden' },
    { method: 'notFound', status: 404, type: 'not_found' },
    { method: 'conflict', status: 409, type: 'conflict' },
    { method: 'rateLimit', status: 429, type: 'rate_limit_exceeded' },
    { method: 'internal', status: 500, type: 'internal_error' },
    { method: 'serviceUnavailable', status: 503, type: 'service_unavailable' },
  ];

  for (const { method, status, type } of testCases) {
    it(`errors.${method}() should return ${status} with type "${type}"`, () => {
      const res = mockRes();
      errors[method](res);
      expect(res.statusCode).toBe(status);
      expect(res.jsonBody.ok).toBe(false);
      expect(res.jsonBody.error.type).toBe(type);
    });
  }

  it('should accept custom message', () => {
    const res = mockRes();
    errors.notFound(res, 'Case XYZ not found');
    expect(res.jsonBody.error.message).toBe('Case XYZ not found');
  });
});
