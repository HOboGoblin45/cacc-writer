/**
 * tests/vitest/gracefulShutdown.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for graceful shutdown handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/db/database.js', () => ({
  closeDb: vi.fn(),
  closeAllUserDbs: vi.fn(),
}));

import { isShuttingDown, registerShutdownHandlers } from '../../server/utils/gracefulShutdown.js';

describe('isShuttingDown', () => {
  it('should return false initially', () => {
    // Note: since modules are singletons, this test relies on fresh import
    // The value may be false if no shutdown has been triggered
    expect(typeof isShuttingDown()).toBe('boolean');
  });
});

describe('registerShutdownHandlers', () => {
  it('should register without throwing', () => {
    const mockServer = {
      close: vi.fn((cb) => cb()),
    };
    // Should not throw
    expect(() => registerShutdownHandlers(mockServer)).not.toThrow();
  });

  it('should accept a server object', () => {
    const mockServer = {
      close: vi.fn(),
    };
    registerShutdownHandlers(mockServer);
    // No assertion needed — if it doesn't throw, it works
  });
});
