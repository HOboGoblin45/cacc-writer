/**
 * tests/vitest/syntax.test.mjs — Syntax Validation (Vitest)
 * Validates every .js file under server/ and root-level entry points.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

function findJsFiles(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) findJsFiles(full, files);
      else if (entry.endsWith('.js')) files.push(full);
    } catch { /* skip */ }
  }
  return files;
}

function checkSyntax(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { timeout: 10_000, stdio: 'pipe' });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString() ?? err.message };
  }
}

describe('Syntax Validation — server/', () => {
  const serverFiles = findJsFiles(join(PROJECT_ROOT, 'server'));
  for (const filePath of serverFiles) {
    const rel = filePath.replace(PROJECT_ROOT + '/', '');
    it(`syntax OK — ${rel}`, () => {
      const { ok, error } = checkSyntax(filePath);
      expect(ok, `Syntax error in ${rel}:\n${error}`).toBe(true);
    });
  }
});

describe('Syntax Validation — root entry points', () => {
  const rootFiles = ['app.js', 'cacc-writer-server.js'];
  for (const name of rootFiles) {
    it(`syntax OK — ${name}`, () => {
      const { ok, error } = checkSyntax(join(PROJECT_ROOT, name));
      expect(ok, `Syntax error in ${name}:\n${error}`).toBe(true);
    });
  }
});
