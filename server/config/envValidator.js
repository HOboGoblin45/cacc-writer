/**
 * server/config/envValidator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Environment configuration validator.
 *
 * Validates required and optional environment variables at startup.
 * Catches misconfiguration early rather than at runtime when a user
 * hits a broken feature.
 *
 * Usage:
 *   import { validateEnv } from './config/envValidator.js';
 *   const issues = validateEnv();
 *   if (issues.errors.length) process.exit(1);
 */

import log from '../logger.js';

/**
 * @typedef {Object} EnvVar
 * @property {string} name — environment variable name
 * @property {boolean} required — is it required for the given environment?
 * @property {string} description — human-readable description
 * @property {function} [validate] — custom validation function
 * @property {string} [environments] — which NODE_ENV values require this (default: all)
 */

/** @type {EnvVar[]} */
export const ENV_SCHEMA = [
  // ── Authentication ──────────────────────────────────────────────────────────
  {
    name: 'JWT_SECRET',
    required: true,
    description: 'JWT signing secret (required in production)',
    environments: ['production'],
    validate: (v) => v.length >= 32 || 'JWT_SECRET should be at least 32 characters',
  },
  {
    name: 'CACC_ENCRYPTION_KEY',
    required: true,
    description: 'Field-level encryption key (required in production)',
    environments: ['production'],
    validate: (v) => v.length >= 32 || 'CACC_ENCRYPTION_KEY should be at least 32 characters',
  },

  // ── AI Providers ────────────────────────────────────────────────────────────
  {
    name: 'OPENAI_API_KEY',
    required: false,
    description: 'OpenAI API key for narrative generation',
    validate: (v) => v.startsWith('sk-') || 'OPENAI_API_KEY should start with "sk-"',
  },
  {
    name: 'GEMINI_API_KEY',
    required: false,
    description: 'Google Gemini API key',
  },
  {
    name: 'AI_PROVIDER',
    required: false,
    description: 'AI provider selection (openai, gemini, ollama)',
    validate: (v) => ['openai', 'gemini', 'ollama'].includes(v.toLowerCase()) || 'AI_PROVIDER must be openai, gemini, or ollama',
  },

  // ── Billing ─────────────────────────────────────────────────────────────────
  {
    name: 'STRIPE_SECRET_KEY',
    required: false,
    description: 'Stripe secret key for billing',
    validate: (v) => v.startsWith('sk_') || 'STRIPE_SECRET_KEY should start with "sk_"',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    required: false,
    description: 'Stripe webhook signing secret',
    validate: (v) => v.startsWith('whsec_') || 'STRIPE_WEBHOOK_SECRET should start with "whsec_"',
  },

  // ── Server ──────────────────────────────────────────────────────────────────
  {
    name: 'PORT',
    required: false,
    description: 'Server port (default: 5178)',
    validate: (v) => {
      const port = parseInt(v, 10);
      return (port > 0 && port < 65536) || 'PORT must be between 1 and 65535';
    },
  },
  {
    name: 'NODE_ENV',
    required: false,
    description: 'Environment mode',
    validate: (v) => ['development', 'production', 'test'].includes(v) || 'NODE_ENV should be development, production, or test',
  },
];

/**
 * Validate all environment variables against the schema.
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEnv() {
  const env = process.env.NODE_ENV || 'development';
  const errors = [];
  const warnings = [];

  for (const spec of ENV_SCHEMA) {
    const value = process.env[spec.name];
    const isPresent = value !== undefined && value !== '';

    // Check if required for this environment
    const requiredEnvs = spec.environments || (spec.required ? [env] : []);
    const isRequired = spec.required && (!spec.environments || spec.environments.includes(env));

    if (isRequired && !isPresent) {
      errors.push(`Missing required env var: ${spec.name} — ${spec.description}`);
      continue;
    }

    if (!isPresent) continue;

    // Run custom validation
    if (spec.validate) {
      const result = spec.validate(value);
      if (result !== true && typeof result === 'string') {
        if (isRequired) {
          errors.push(`Invalid ${spec.name}: ${result}`);
        } else {
          warnings.push(`${spec.name}: ${result}`);
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Run validation and log results.
 * In production, exits the process on fatal errors.
 *
 * @returns {boolean} true if valid
 */
export function validateEnvAndLog() {
  const { errors, warnings } = validateEnv();

  for (const w of warnings) {
    log.warn('env:warning', { message: w });
  }

  if (errors.length === 0) {
    log.info('env:validated', { warnings: warnings.length });
    return true;
  }

  for (const e of errors) {
    log.error('env:error', { message: e });
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(`[FATAL] ${errors.length} environment configuration error(s). Fix and restart.`);
    process.exit(1);
  }

  return false;
}

export default { validateEnv, validateEnvAndLog, ENV_SCHEMA };
