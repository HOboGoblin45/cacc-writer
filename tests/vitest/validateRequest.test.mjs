/**
 * tests/vitest/validateRequest.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the Zod validation middleware — body, params, query.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  validateBody,
  validateParams,
  validateQuery,
  CommonSchemas,
} from '../../server/middleware/validateRequest.js';

// ── Mock Express objects ─────────────────────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.jsonBody = body; return res; },
  };
  return res;
}

function mockNext() {
  const fn = vi.fn();
  return fn;
}

// ── validateBody ─────────────────────────────────────────────────────────────

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  });

  it('should call next() and set req.validated on valid body', () => {
    const req = mockReq({ body: { name: 'Alice', age: 30 } });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.validated).toEqual({ name: 'Alice', age: 30 });
  });

  it('should return 400 on invalid body', () => {
    const req = mockReq({ body: { name: '', age: -5 } });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.ok).toBe(false);
    expect(res.jsonBody.error).toBe('Validation failed');
    expect(res.jsonBody.details.length).toBeGreaterThan(0);
  });

  it('should include path info in validation errors', () => {
    const req = mockReq({ body: { name: 123 } });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next);

    const detail = res.jsonBody.details.find(d => d.path === 'name');
    expect(detail).toBeTruthy();
    expect(detail.message).toBeTruthy();
  });

  it('should handle missing body gracefully', () => {
    const req = mockReq({ body: undefined });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

// ── validateParams ───────────────────────────────────────────────────────────

describe('validateParams', () => {
  const schema = z.object({ caseId: z.string().min(1) });

  it('should call next() and set req.validatedParams on valid params', () => {
    const req = mockReq({ params: { caseId: 'case-123' } });
    const res = mockRes();
    const next = mockNext();

    validateParams(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.validatedParams).toEqual({ caseId: 'case-123' });
  });

  it('should return 400 on empty caseId', () => {
    const req = mockReq({ params: { caseId: '' } });
    const res = mockRes();
    const next = mockNext();

    validateParams(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe('Invalid URL parameters');
  });
});

// ── validateQuery ────────────────────────────────────────────────────────────

describe('validateQuery', () => {
  it('should validate and coerce pagination params', () => {
    const req = mockReq({ query: { page: '2', limit: '50' } });
    const res = mockRes();
    const next = mockNext();

    validateQuery(CommonSchemas.pagination)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.validatedQuery.page).toBe(2);
    expect(req.validatedQuery.limit).toBe(50);
  });

  it('should apply defaults for missing pagination params', () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    validateQuery(CommonSchemas.pagination)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.validatedQuery.page).toBe(1);
    expect(req.validatedQuery.limit).toBe(20);
  });

  it('should reject out-of-range pagination params', () => {
    const req = mockReq({ query: { page: '0', limit: '200' } });
    const res = mockRes();
    const next = mockNext();

    validateQuery(CommonSchemas.pagination)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

// ── CommonSchemas ────────────────────────────────────────────────────────────

describe('CommonSchemas', () => {
  it('caseId schema should require non-empty string', () => {
    expect(CommonSchemas.caseId.safeParse({ caseId: 'abc' }).success).toBe(true);
    expect(CommonSchemas.caseId.safeParse({ caseId: '' }).success).toBe(false);
    expect(CommonSchemas.caseId.safeParse({}).success).toBe(false);
  });

  it('id schema should require non-empty string', () => {
    expect(CommonSchemas.id.safeParse({ id: 'xyz' }).success).toBe(true);
    expect(CommonSchemas.id.safeParse({ id: '' }).success).toBe(false);
  });

  it('pagination schema should coerce string numbers', () => {
    const result = CommonSchemas.pagination.safeParse({ page: '3', limit: '25' });
    expect(result.success).toBe(true);
    expect(result.data.page).toBe(3);
    expect(result.data.limit).toBe(25);
  });
});
