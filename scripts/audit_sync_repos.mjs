#!/usr/bin/env node

/**
 * scripts/audit_sync_repos.mjs
 * ============================
 * Audits the codebase for synchronous database usage patterns.
 *
 * Scans server/ directory for patterns indicating sync DB calls:
 *   - db.prepare(
 *   - .prepare(
 *   - getDb(
 *   - getUserDb(
 *   - dbRun(
 *   - dbAll(
 *   - dbGet(
 *   - dbTransaction(
 *
 * Outputs a report showing:
 *   - File count by pattern type
 *   - Complexity classification (simple CRUD vs complex transactions)
 *   - Estimated migration effort
 *   - Recommended migration order (most-used first)
 *
 * Usage:
 *   npm run audit:sync-repos
 *   # or
 *   node scripts/audit_sync_repos.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const serverDir = path.join(projectRoot, 'server');

// Patterns that indicate sync database usage
const PATTERNS = {
  dbPrepare: /\.prepare\s*\(/g,
  getDb: /\bgetDb\s*\(/g,
  getUserDb: /\bgetUserDb\s*\(/g,
  dbRun: /\bdbRun\s*\(/g,
  dbAll: /\bdbAll\s*\(/g,
  dbGet: /\bdbGet\s*\(/g,
  dbTransaction: /\bdbTransaction\s*\(/g,
  prepareImport: /import.*\{.*getDb.*\}/,
  repositoryFile: /\/repositories\/.*\.js$/,
};

const COMPLEXITY_KEYWORDS = {
  simple: ['get', 'set', 'create', 'delete', 'update', 'insert'],
  complex: [
    'transaction',
    'transaction()',
    'txn',
    'batch',
    'lock',
    'prepared',
    'prepare(',
  ],
};

/**
 * Recursively read all JS files in a directory
 */
function getAllJsFiles(dir) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllJsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err.message);
  }
  return files;
}

/**
 * Count pattern matches in a file
 */
function countPatterns(content, patterns) {
  const counts = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = content.match(pattern);
    counts[key] = matches ? matches.length : 0;
  }
  return counts;
}

/**
 * Classify file complexity based on keywords
 */
function classifyComplexity(content) {
  const simpleMatches = COMPLEXITY_KEYWORDS.simple.filter(kw =>
    content.toLowerCase().includes(kw)
  );
  const complexMatches = COMPLEXITY_KEYWORDS.complex.filter(kw =>
    content.toLowerCase().includes(kw)
  );

  if (complexMatches.length > 2) return 'HIGH';
  if (complexMatches.length > 0 || simpleMatches.length > 10) return 'MEDIUM';
  return 'LOW';
}

/**
 * Estimate migration effort (1-5 scale)
 */
function estimateEffort(complexity, patternCount) {
  if (complexity === 'HIGH') return 5;
  if (complexity === 'MEDIUM' && patternCount > 10) return 4;
  if (complexity === 'MEDIUM') return 3;
  if (patternCount > 5) return 2;
  return 1;
}

/**
 * Main audit function
 */
function auditSyncRepos() {
  console.log('Auditing synchronous database usage patterns...\n');

  const files = getAllJsFiles(serverDir);
  const results = [];
  let totalPatterns = 0;

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(serverDir, filePath);

      const patterns = countPatterns(content, PATTERNS);
      const patternTotal = Object.values(patterns).reduce((a, b) => a + b, 0);

      if (patternTotal === 0) continue; // Skip files with no sync DB usage

      const complexity = classifyComplexity(content);
      const effort = estimateEffort(complexity, patternTotal);
      const isRepository = PATTERNS.repositoryFile.test(filePath);

      results.push({
        file: relPath,
        patternCount: patternTotal,
        patterns,
        complexity,
        effort,
        isRepository,
        linesOfCode: content.split('\n').length,
      });

      totalPatterns += patternTotal;
    } catch (err) {
      console.error(`Error processing ${filePath}:`, err.message);
    }
  }

  // Sort by pattern count (most-used first)
  results.sort((a, b) => b.patternCount - a.patternCount);

  // Generate report
  console.log(`Total files with sync DB usage: ${results.length}`);
  console.log(`Total pattern occurrences: ${totalPatterns}\n`);

  console.log('=== MIGRATION PRIORITY (by pattern density) ===\n');

  const repositories = results.filter(r => r.isRepository);
  const other = results.filter(r => !r.isRepository);

  if (repositories.length > 0) {
    console.log(`REPOSITORIES (${repositories.length} files):`);
    for (const result of repositories.slice(0, 15)) {
      const effortBar = '█'.repeat(result.effort) + '░'.repeat(5 - result.effort);
      console.log(
        `  [${effortBar}] ${result.file}`
      );
      console.log(
        `      Patterns: ${result.patternCount}, Complexity: ${result.complexity}, Lines: ${result.linesOfCode}`
      );
      console.log(
        `      Pattern breakdown: prepare=${result.patterns.dbPrepare}, getDb=${result.patterns.getDb}, dbRun=${result.patterns.dbRun}, dbAll=${result.patterns.dbAll}`
      );
    }
    if (repositories.length > 15) {
      console.log(
        `  ... and ${repositories.length - 15} more repository files`
      );
    }
    console.log();
  }

  if (other.length > 0) {
    console.log(`OTHER FILES (${other.length} files):`);
    for (const result of other.slice(0, 10)) {
      const effortBar = '█'.repeat(result.effort) + '░'.repeat(5 - result.effort);
      console.log(
        `  [${effortBar}] ${result.file}`
      );
      console.log(
        `      Patterns: ${result.patternCount}, Complexity: ${result.complexity}`
      );
    }
    if (other.length > 10) {
      console.log(`  ... and ${other.length - 10} more files`);
    }
    console.log();
  }

  // Summary statistics
  const byComplexity = {
    LOW: results.filter(r => r.complexity === 'LOW').length,
    MEDIUM: results.filter(r => r.complexity === 'MEDIUM').length,
    HIGH: results.filter(r => r.complexity === 'HIGH').length,
  };

  const byEffort = {
    1: results.filter(r => r.effort === 1).length,
    2: results.filter(r => r.effort === 2).length,
    3: results.filter(r => r.effort === 3).length,
    4: results.filter(r => r.effort === 4).length,
    5: results.filter(r => r.effort === 5).length,
  };

  console.log('=== COMPLEXITY DISTRIBUTION ===');
  console.log(`  LOW:    ${byComplexity.LOW} files`);
  console.log(`  MEDIUM: ${byComplexity.MEDIUM} files`);
  console.log(`  HIGH:   ${byComplexity.HIGH} files`);
  console.log();

  console.log('=== EFFORT DISTRIBUTION (1=trivial, 5=complex) ===');
  for (let effort = 1; effort <= 5; effort++) {
    const bar = '█'.repeat(effort) + '░'.repeat(5 - effort);
    console.log(`  [${bar}] ${byEffort[effort]} files`);
  }
  console.log();

  console.log('=== RECOMMENDATIONS ===');
  console.log(
    '1. Start with LOW complexity files (simple CRUD operations)'
  );
  console.log('2. Target repositories first for consistent conversion patterns');
  console.log(
    '3. Use AsyncQueryRunner and wrapRepoAsync for migration wrappers'
  );
  console.log(
    '4. Convert in order: repos → orchestrator → routes → other files'
  );
  console.log();

  // Estimate total effort
  const totalEffort = results.reduce((sum, r) => sum + r.effort, 0);
  const avgEffort = Math.round(totalEffort / results.length);
  console.log(
    `Estimated total effort: ${totalEffort} points (avg ${avgEffort}/file)`
  );
  console.log(`Estimated timeline: ${Math.ceil(totalEffort / 5)} weeks at 5 pts/week\n`);

  // Write JSON report
  const reportPath = path.join(projectRoot, 'audit-sync-repos.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: {
          totalFiles: results.length,
          totalPatterns,
          byComplexity,
          byEffort,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`Detailed report saved to: audit-sync-repos.json\n`);
}

// Run audit
auditSyncRepos();
