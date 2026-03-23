/**
 * tests/syntax.test.mjs — Syntax Validation
 * Finds all .js files in server/ recursively and validates them with `node -c`
 * Also checks app.js and cacc-writer-server.js at root
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

/** Recursively find all .js files under a directory */
function findJsFiles(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      findJsFiles(full, files);
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/** Run `node --check` on a file and return { ok, error } */
function checkSyntax(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { timeout: 10_000, stdio: 'pipe' });
    return { ok: true, error: null };
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    return { ok: false, error: stderr || err.message };
  }
}

// ─── Server directory ─────────────────────────────────────────────────────────

describe('Syntax Validation — server/ directory', () => {
  const serverDir = join(PROJECT_ROOT, 'server');
  const serverFiles = findJsFiles(serverDir);

  if (serverFiles.length === 0) {
    it('server/ — has .js files to check', () => {
      assert.fail('No .js files found in server/ directory');
    });
  } else {
    for (const filePath of serverFiles) {
      const relPath = filePath.replace(PROJECT_ROOT + '\\', '').replace(PROJECT_ROOT + '/', '');
      it(`syntax OK — ${relPath}`, () => {
        const { ok, error } = checkSyntax(filePath);
        assert.ok(ok, `Syntax error in ${relPath}:\n${error}`);
      });
    }
  }
});

// ─── Root files ───────────────────────────────────────────────────────────────

describe('Syntax Validation — root JS files', () => {
  const rootFiles = [
    join(PROJECT_ROOT, 'app.js'),
    join(PROJECT_ROOT, 'cacc-writer-server.js'),
  ];

  for (const filePath of rootFiles) {
    const relPath = filePath.replace(PROJECT_ROOT + '\\', '').replace(PROJECT_ROOT + '/', '');
    it(`syntax OK — ${relPath}`, () => {
      const { ok, error } = checkSyntax(filePath);
      assert.ok(ok, `Syntax error in ${relPath}:\n${error}`);
    });
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

describe('Syntax Validation — summary', () => {
  it('zero syntax errors across all checked files', () => {
    const serverDir = join(PROJECT_ROOT, 'server');
    const allFiles = [
      ...findJsFiles(serverDir),
      join(PROJECT_ROOT, 'app.js'),
      join(PROJECT_ROOT, 'cacc-writer-server.js'),
    ];

    const failures = [];
    for (const filePath of allFiles) {
      const { ok, error } = checkSyntax(filePath);
      if (!ok) {
        const relPath = filePath.replace(PROJECT_ROOT + '\\', '').replace(PROJECT_ROOT + '/', '');
        failures.push({ file: relPath, error });
      }
    }

    if (failures.length > 0) {
      const report = failures
        .map((f) => `  • ${f.file}: ${f.error?.split('\n')[0] ?? 'syntax error'}`)
        .join('\n');
      assert.fail(`${failures.length} file(s) have syntax errors:\n${report}`);
    }
  });
});
