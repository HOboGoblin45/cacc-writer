/**
 * tests/vitest/apiVersion.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for API versioning middleware.
 */

import { describe, it, expect } from 'vitest';

import {
  API_VERSION,
  MIN_SUPPORTED_VERSION,
  parseSemVer,
  compareSemVer,
  apiVersionMiddleware,
} from '../../server/middleware/apiVersion.js';

describe('parseSemVer', () => {
  it('should parse valid SemVer strings', () => {
    expect(parseSemVer('1.0.0')).toEqual([1, 0, 0]);
    expect(parseSemVer('3.1.0')).toEqual([3, 1, 0]);
    expect(parseSemVer('10.20.30')).toEqual([10, 20, 30]);
  });

  it('should handle SemVer with extra suffixes', () => {
    expect(parseSemVer('1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseSemVer('2.0.0-rc.1')).toEqual([2, 0, 0]);
  });

  it('should return null for invalid input', () => {
    expect(parseSemVer('')).toBeNull();
    expect(parseSemVer(null)).toBeNull();
    expect(parseSemVer(undefined)).toBeNull();
    expect(parseSemVer('abc')).toBeNull();
    expect(parseSemVer('1.2')).toBeNull();
  });
});

describe('compareSemVer', () => {
  it('should return 0 for equal versions', () => {
    expect(compareSemVer([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareSemVer([3, 1, 0], [3, 1, 0])).toBe(0);
  });

  it('should return -1 when a < b', () => {
    expect(compareSemVer([1, 0, 0], [2, 0, 0])).toBe(-1);
    expect(compareSemVer([1, 0, 0], [1, 1, 0])).toBe(-1);
    expect(compareSemVer([1, 0, 0], [1, 0, 1])).toBe(-1);
  });

  it('should return 1 when a > b', () => {
    expect(compareSemVer([2, 0, 0], [1, 0, 0])).toBe(1);
    expect(compareSemVer([1, 1, 0], [1, 0, 0])).toBe(1);
    expect(compareSemVer([1, 0, 1], [1, 0, 0])).toBe(1);
  });
});

describe('apiVersionMiddleware', () => {
  function mockReqRes(clientVersion) {
    const req = { headers: {} };
    if (clientVersion) req.headers['x-client-version'] = clientVersion;
    const headers = {};
    const res = {
      setHeader(key, value) { headers[key] = value; },
      getHeaders() { return headers; },
    };
    return { req, res, headers };
  }

  it('should set X-API-Version header', () => {
    const mw = apiVersionMiddleware();
    const { req, res, headers } = mockReqRes();
    mw(req, res, () => {});
    expect(headers['X-API-Version']).toBe(API_VERSION);
  });

  it('should use custom version when provided', () => {
    const mw = apiVersionMiddleware({ version: '99.0.0' });
    const { req, res, headers } = mockReqRes();
    mw(req, res, () => {});
    expect(headers['X-API-Version']).toBe('99.0.0');
  });

  it('should not set deprecation warning when no client version', () => {
    const mw = apiVersionMiddleware();
    const { req, res, headers } = mockReqRes();
    mw(req, res, () => {});
    expect(headers['X-Deprecation-Warning']).toBeUndefined();
  });

  it('should not set deprecation warning for current client', () => {
    const mw = apiVersionMiddleware();
    const { req, res, headers } = mockReqRes('3.0.0');
    mw(req, res, () => {});
    expect(headers['X-Deprecation-Warning']).toBeUndefined();
  });

  it('should set deprecation warning for old client version', () => {
    const mw = apiVersionMiddleware({ minVersion: '2.0.0' });
    const { req, res, headers } = mockReqRes('1.5.0');
    mw(req, res, () => {});
    expect(headers['X-Deprecation-Warning']).toContain('1.5.0');
    expect(headers['X-Deprecation-Warning']).toContain('2.0.0');
  });

  it('should expose client version on request', () => {
    const mw = apiVersionMiddleware();
    const { req, res } = mockReqRes('3.1.0');
    mw(req, res, () => {});
    expect(req.clientVersion).toBe('3.1.0');
  });

  it('should call next()', () => {
    const mw = apiVersionMiddleware();
    const { req, res } = mockReqRes();
    let called = false;
    mw(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('constants', () => {
  it('API_VERSION should be a valid SemVer', () => {
    expect(parseSemVer(API_VERSION)).not.toBeNull();
  });

  it('MIN_SUPPORTED_VERSION should be a valid SemVer', () => {
    expect(parseSemVer(MIN_SUPPORTED_VERSION)).not.toBeNull();
  });

  it('MIN_SUPPORTED_VERSION should be <= API_VERSION', () => {
    const min = parseSemVer(MIN_SUPPORTED_VERSION);
    const api = parseSemVer(API_VERSION);
    expect(compareSemVer(min, api)).toBeLessThanOrEqual(0);
  });
});
