/**
 * tests/vitest/imports.test.mjs — Module Import Validation (Vitest)
 * Validates that critical server modules can be imported without crashing.
 * Catches circular deps, missing exports, and runtime init errors.
 */

import { describe, it, expect } from 'vitest';

const CRITICAL_MODULES = [
  ['server/auth/authService.js', ['registerUser', 'loginUser', 'verifyToken']],
  ['server/middleware/authMiddleware.js', ['requireAuth', 'requireRole']],
  ['server/db/repositories/brainRepo.js', ['getActiveModel', 'getFullGraph', 'saveChatMessage']],
  ['server/migration/brainSchema.js', ['initBrainSchema']],
  ['server/security/encryptionService.js', ['encrypt', 'decrypt']],
  ['server/promptBuilder.js', ['buildMessages']],
  ['server/logger.js', ['default']],
];

describe('Critical Module Imports', () => {
  for (const [modulePath, expectedExports] of CRITICAL_MODULES) {
    it(`imports ${modulePath} without error`, async () => {
      const mod = await import(`../../${modulePath}`);
      expect(mod).toBeDefined();
      for (const exp of expectedExports) {
        expect(mod[exp], `Missing export '${exp}' from ${modulePath}`).toBeDefined();
      }
    });
  }
});
