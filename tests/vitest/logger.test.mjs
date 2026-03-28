/**
 * tests/vitest/logger.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the structured logger — log levels, output format, file writer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import log, { setFileLogWriter } from '../../server/logger.js';

// ── Logger tests ─────────────────────────────────────────────────────────────

describe('logger', () => {
  it('should export log level functions', () => {
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('should export request and ai logging functions', () => {
    expect(typeof log.request).toBe('function');
    expect(typeof log.ai).toBe('function');
  });

  it('should export kb logging function', () => {
    expect(typeof log.kb).toBe('function');
  });

  it('should not throw when calling log methods', () => {
    expect(() => log.info('test-message', { key: 'value' })).not.toThrow();
    expect(() => log.warn('test-warn', { detail: 'something' })).not.toThrow();
    expect(() => log.error('test-error', { err: 'oops' })).not.toThrow();
  });

  it('should not throw when calling request logger', () => {
    expect(() => log.request('GET', '/api/health', 200, 45)).not.toThrow();
  });

  it('should not throw when calling ai logger', () => {
    expect(() => log.ai('generate', { model: 'gpt-4', tokens: 500 })).not.toThrow();
  });
});

describe('setFileLogWriter', () => {
  it('should accept a function as file writer', () => {
    const writer = vi.fn();
    expect(() => setFileLogWriter(writer)).not.toThrow();
    // Clean up by resetting
    setFileLogWriter(null);
  });

  it('should accept null to clear the writer', () => {
    expect(() => setFileLogWriter(null)).not.toThrow();
  });
});
