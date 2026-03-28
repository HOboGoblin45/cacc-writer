/**
 * tests/vitest/envValidator.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for environment configuration validator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateEnv, validateEnvAndLog, ENV_SCHEMA } from '../../server/config/envValidator.js';

describe('ENV_SCHEMA', () => {
  it('should be an array of env var definitions', () => {
    expect(Array.isArray(ENV_SCHEMA)).toBe(true);
    expect(ENV_SCHEMA.length).toBeGreaterThan(0);
  });

  it('every entry should have name, required, and description', () => {
    for (const spec of ENV_SCHEMA) {
      expect(spec).toHaveProperty('name');
      expect(spec).toHaveProperty('required');
      expect(spec).toHaveProperty('description');
    }
  });
});

describe('validateEnv', () => {
  const savedEnv = {};

  beforeEach(() => {
    // Save current env values for schema vars
    for (const spec of ENV_SCHEMA) {
      savedEnv[spec.name] = process.env[spec.name];
    }
  });

  afterEach(() => {
    // Restore env
    for (const spec of ENV_SCHEMA) {
      if (savedEnv[spec.name] === undefined) {
        delete process.env[spec.name];
      } else {
        process.env[spec.name] = savedEnv[spec.name];
      }
    }
  });

  it('should return errors and warnings arrays', () => {
    const result = validateEnv();
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should pass in development with no env vars set', () => {
    // Clear all schema vars
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    const { errors } = validateEnv();
    expect(errors.length).toBe(0);
  });

  it('should error in production when JWT_SECRET is missing', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'production';
    const { errors } = validateEnv();
    const jwtError = errors.find(e => e.includes('JWT_SECRET'));
    expect(jwtError).toBeDefined();
  });

  it('should error in production when CACC_ENCRYPTION_KEY is missing', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'production';
    const { errors } = validateEnv();
    const encError = errors.find(e => e.includes('CACC_ENCRYPTION_KEY'));
    expect(encError).toBeDefined();
  });

  it('should pass in production when required vars are valid', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.CACC_ENCRYPTION_KEY = 'b'.repeat(32);
    const { errors } = validateEnv();
    expect(errors.length).toBe(0);
  });

  it('should error when JWT_SECRET is too short in production', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    process.env.CACC_ENCRYPTION_KEY = 'b'.repeat(32);
    const { errors } = validateEnv();
    const jwtError = errors.find(e => e.includes('JWT_SECRET'));
    expect(jwtError).toBeDefined();
    expect(jwtError).toContain('at least 32');
  });

  it('should warn when OPENAI_API_KEY does not start with sk-', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.OPENAI_API_KEY = 'bad-key-format';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('OPENAI_API_KEY'));
    expect(warn).toBeDefined();
  });

  it('should not warn when OPENAI_API_KEY starts with sk-', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.OPENAI_API_KEY = 'sk-abc123';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('OPENAI_API_KEY'));
    expect(warn).toBeUndefined();
  });

  it('should warn when STRIPE_SECRET_KEY does not start with sk_', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.STRIPE_SECRET_KEY = 'bad';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('STRIPE_SECRET_KEY'));
    expect(warn).toBeDefined();
  });

  it('should warn when STRIPE_WEBHOOK_SECRET does not start with whsec_', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.STRIPE_WEBHOOK_SECRET = 'bad';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('STRIPE_WEBHOOK_SECRET'));
    expect(warn).toBeDefined();
  });

  it('should warn when PORT is out of range', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.PORT = '99999';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('PORT'));
    expect(warn).toBeDefined();
  });

  it('should not warn when PORT is valid', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.PORT = '5178';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('PORT'));
    expect(warn).toBeUndefined();
  });

  it('should warn when AI_PROVIDER is invalid', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    process.env.AI_PROVIDER = 'claude';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('AI_PROVIDER'));
    expect(warn).toBeDefined();
  });

  it('should accept valid AI_PROVIDER values', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'development';
    for (const provider of ['openai', 'gemini', 'ollama']) {
      process.env.AI_PROVIDER = provider;
      const { warnings } = validateEnv();
      const warn = warnings.find(w => w.includes('AI_PROVIDER'));
      expect(warn).toBeUndefined();
    }
  });

  it('should warn when NODE_ENV is non-standard', () => {
    for (const spec of ENV_SCHEMA) {
      delete process.env[spec.name];
    }
    process.env.NODE_ENV = 'staging';
    const { warnings } = validateEnv();
    const warn = warnings.find(w => w.includes('NODE_ENV'));
    expect(warn).toBeDefined();
  });
});

describe('validateEnvAndLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when no errors', () => {
    // Development with no required vars
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    // Clear vars that might cause issues
    const saved = {};
    for (const spec of ENV_SCHEMA) {
      if (spec.name !== 'NODE_ENV') {
        saved[spec.name] = process.env[spec.name];
        delete process.env[spec.name];
      }
    }
    const result = validateEnvAndLog();
    expect(result).toBe(true);
    // Restore
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
    process.env.NODE_ENV = origEnv;
  });

  it('should return false when there are errors in non-production', () => {
    const origEnv = process.env.NODE_ENV;
    const origJwt = process.env.JWT_SECRET;
    const origEnc = process.env.CACC_ENCRYPTION_KEY;
    // Force production missing required vars
    // But we can't actually test production because it calls process.exit
    // Instead, test with a short JWT_SECRET in production env
    // Actually, validateEnvAndLog calls process.exit in production — skip that
    // Test: set NODE_ENV=production but mock process.exit
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.CACC_ENCRYPTION_KEY;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const result = validateEnvAndLog();
    expect(result).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();

    process.env.NODE_ENV = origEnv;
    if (origJwt !== undefined) process.env.JWT_SECRET = origJwt;
    if (origEnc !== undefined) process.env.CACC_ENCRYPTION_KEY = origEnc;
  });
});
