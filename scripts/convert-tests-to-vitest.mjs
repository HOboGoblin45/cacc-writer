/**
 * scripts/convert-tests-to-vitest.mjs
 * Convert custom assert-based test files to vitest-compatible format.
 * Run multiple times until stable.
 */

import fs from 'fs';
import path from 'path';

const TESTS_DIR = path.resolve('tests/unit');
const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.test.mjs'));

let converted = 0;
let skipped = 0;

function convertAsserts(src) {
  // All assert.* replacements
  return src
    // assert.ok(x) / assert(x)
    .replace(/assert\.ok\(([^;]+)\)/g, 'expect($1).toBeTruthy()')
    // assert.strictEqual(a, b) / assert.equal(a, b)
    .replace(/assert\.(?:strict)?[Ee]qual\(([^,]+),\s*([^,)]+)(?:,\s*[^)]+)?\)/g, 'expect($1).toBe($2)')
    // assert.deepStrictEqual(a, b) / assert.deepEqual(a, b)
    .replace(/assert\.deep(?:Strict)?[Ee]qual\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toEqual($2)')
    // assert.notEqual(a, b, ...) 
    .replace(/assert\.not[Ss]trictEqual\(([^,]+),\s*([^,)]+)(?:,\s*[^)]+)?\)/g, 'expect($1).not.toBe($2)')
    .replace(/assert\.notEqual\(([^,]+),\s*([^,)]+)(?:,\s*[^)]+)?\)/g, 'expect($1).not.toBe($2)')
    // assert.match(str, regex)
    .replace(/assert\.match\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toMatch($2)')
    // assert.throws(fn) / assert.doesNotThrow(fn)
    .replace(/assert\.throws\(([^)]+)\)/g, 'expect($1).toThrow()')
    .replace(/assert\.doesNotThrow\(([^)]+)\)/g, 'expect($1).not.toThrow()')
    // assert.rejects(promise) 
    .replace(/await assert\.rejects\(([^)]+)\)/g, 'await expect($1).rejects.toThrow()')
    // assert.fail(msg)
    .replace(/assert\.fail\(([^)]*)\)/g, 'throw new Error($1)')
    // assert(expr, msg?) — bare assert call
    .replace(/\bassert\(([^)]+)\)/g, 'expect($1).toBeTruthy()');
}

for (const file of files) {
  const filePath = path.join(TESTS_DIR, file);
  let src = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  // Check if already fully converted
  if ((src.includes("from 'vitest'") || src.includes('from "vitest"')) && 
      !src.includes('assert') && !src.includes("let passed") && !src.includes("let failed")) {
    skipped++;
    continue;
  }

  // ── Step 1: Remove assert import ───────────────────────────────────────────
  src = src.replace(/^import assert from ['"]assert(?:\/strict)?['"];?\s*\n/gm, '');

  // ── Step 2: Replace all assert.* calls ────────────────────────────────────
  src = convertAsserts(src);

  // ── Step 3: Remove passed/failed counters ─────────────────────────────────
  src = src.replace(/^let passed\s*=\s*0(?:,\s*failed\s*=\s*0)?;\s*\n/gm, '');
  src = src.replace(/^let failed\s*=\s*0;\s*\n/gm, '');
  src = src.replace(/^\s*passed\+\+;\s*\n/gm, '');
  src = src.replace(/^\s*failed\+\+;\s*\n/gm, '');
  src = src.replace(/^console\.log\(`\s*\$\{passed\}[^`]*`\);\s*\n/gm, '');
  src = src.replace(/^console\.log\([^)]*passed[^)]*\);\s*\n/gm, '');
  src = src.replace(/^if\s*\(failed\s*>[^)]+\)\s*process\.exit\(1\);\s*\n/gm, '');

  // ── Step 4: Remove custom test() function definition ─────────────────────
  // Match: [async ]function test(name[, fn]) { ... } including nested braces
  src = src.replace(/^(?:async )?function test\([^)]*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*\n/gm, '');
  // Also remove the withEnv helper if present (it's just a util, not needed in vitest)
  // Keep it as-is since tests use it

  // ── Step 5: Add vitest import if missing ──────────────────────────────────
  if (!src.includes("from 'vitest'") && !src.includes('from "vitest"')) {
    // Find position after last import
    const importMatches = [...src.matchAll(/^import .+$/gm)];
    if (importMatches.length > 0) {
      const last = importMatches[importMatches.length - 1];
      const insertAt = last.index + last[0].length;
      src = src.slice(0, insertAt) + "\nimport { describe, it, expect, vi } from 'vitest';" + src.slice(insertAt);
    } else {
      src = "import { describe, it, expect, vi } from 'vitest';\n" + src;
    }
  }

  // ── Step 6: Convert top-level await test(...) to it(...) ─────────────────
  // Replace `await test('label', async () => {` with `it('label', async () => {`
  src = src.replace(/^await test\(/gm, 'it(');
  // Also handle non-await `test(`  at top level (not inside a function)
  // Be careful not to replace test( inside describe blocks or other it() blocks
  
  // ── Step 7: Wrap everything in a describe block ───────────────────────────
  if (!src.includes('describe(')) {
    const moduleName = file.replace('.test.mjs', '');
    
    // Find the import block end
    const importMatches = [...src.matchAll(/^import .+$/gm)];
    let importEnd = 0;
    if (importMatches.length > 0) {
      const last = importMatches[importMatches.length - 1];
      importEnd = last.index + last[0].length + 1; // +1 for newline
    }
    
    const preamble = src.slice(0, importEnd);
    let body = src.slice(importEnd);
    
    // If body has it() calls, wrap them
    if (body.includes('it(') || body.trim()) {
      // Check if body has real content
      const bodyTrimmed = body.trim();
      if (bodyTrimmed) {
        // Indent body
        const indented = body.split('\n').map(l => l ? '  ' + l : l).join('\n');
        src = preamble + '\ndescribe(\'' + moduleName + '\', async () => {\n' + indented + '\n});\n';
      }
    }
  }

  // ── Step 8: Clean up whitespace ──────────────────────────────────────────
  src = src.replace(/\n{4,}/g, '\n\n\n');

  fs.writeFileSync(filePath, src);
  console.log(`CONVERTED: ${file}`);
  converted++;
}

console.log(`\nDone: ${converted} converted, ${skipped} skipped`);
