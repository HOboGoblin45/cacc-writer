#!/usr/bin/env node
/**
 * scripts/training/validate_data.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates JSONL training data for Llama fine-tuning.
 *
 * Checks:
 *   - Valid JSON on every line
 *   - Required "messages" array with system/user/assistant roles
 *   - Minimum content lengths (not empty, not too short)
 *   - Approximate token counts (4 chars ≈ 1 token)
 *   - Distribution of example types
 *   - Duplicate detection (exact assistant matches)
 *   - Examples that exceed max token limit (2048)
 *
 * Usage:
 *   node scripts/training/validate_data.mjs
 *   node scripts/training/validate_data.mjs --file training_output/llama_training_data.jsonl
 *   node scripts/training/validate_data.mjs --file data.jsonl --max-tokens 4096 --verbose
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_TOKENS = 2048;
const CHARS_PER_TOKEN = 4; // approximate
const MIN_ASSISTANT_CHARS = 30;
const MIN_USER_CHARS = 10;
const VALID_TYPES = [
  'narrative_writing',
  'adjustment_reasoning',
  'comp_selection',
  'reconciliation',
  'condition_quality',
  'full_appraisal',
  // legacy types from existing data
  'adjustment_reasoning',
  'reconciliation_reasoning',
  'condition_rating',
];

// ── Path detection ─────────────────────────────────────────────────────────────
function findDataFile(startDir) {
  const candidates = [
    path.join(startDir, 'training_output', 'llama_training_data.jsonl'),
    path.join(startDir, 'llama_training_data.jsonl'),
  ];

  for (let i = 0; i < 8; i++) {
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    const parent = path.dirname(startDir);
    if (parent === startDir) break;
    startDir = parent;
  }
  return null;
}

// ── Approximate token count ────────────────────────────────────────────────────
function approxTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function countMessagesTokens(messages) {
  return messages.reduce((sum, msg) => sum + approxTokens(msg.content || ''), 0);
}

// ── Validation ─────────────────────────────────────────────────────────────────
function validateExample(example, lineNum) {
  const errors = [];
  const warnings = [];

  // Must have messages array
  if (!Array.isArray(example.messages)) {
    errors.push('Missing or invalid "messages" array');
    return { errors, warnings, valid: false };
  }

  const messages = example.messages;

  if (messages.length < 2) {
    errors.push(`Too few messages: ${messages.length} (need at least 2)`);
  }

  // Check roles
  const roles = messages.map(m => m.role);
  if (!roles.includes('user')) errors.push('Missing "user" message');
  if (!roles.includes('assistant')) errors.push('Missing "assistant" message');

  // Validate each message
  for (const msg of messages) {
    if (!msg.role) errors.push('Message missing "role"');
    if (msg.content === undefined || msg.content === null) {
      errors.push(`Message with role "${msg.role}" has no "content"`);
    } else if (typeof msg.content !== 'string') {
      errors.push(`Message content must be a string, got ${typeof msg.content}`);
    }
  }

  // Content length checks
  const userMsg = messages.find(m => m.role === 'user');
  const assistantMsg = messages.find(m => m.role === 'assistant');

  if (userMsg && (userMsg.content || '').length < MIN_USER_CHARS) {
    errors.push(`User message too short: ${(userMsg.content || '').length} chars (min ${MIN_USER_CHARS})`);
  }

  if (assistantMsg && (assistantMsg.content || '').length < MIN_ASSISTANT_CHARS) {
    errors.push(`Assistant message too short: ${(assistantMsg.content || '').length} chars (min ${MIN_ASSISTANT_CHARS})`);
  }

  // Token count
  const totalTokens = countMessagesTokens(messages);
  if (totalTokens > MAX_TOKENS) {
    warnings.push(`Exceeds max tokens: ~${totalTokens} tokens (max ${MAX_TOKENS}) — will be truncated`);
  } else if (totalTokens < 20) {
    warnings.push(`Very short example: ~${totalTokens} tokens`);
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
    tokens: totalTokens,
    type: example.type,
    assistantLength: (assistantMsg?.content || '').length,
  };
}

// ── Main validator ─────────────────────────────────────────────────────────────
function validate(dataPath, options = {}) {
  const { verbose = false, maxTokens = MAX_TOKENS } = options;

  if (!fs.existsSync(dataPath)) {
    console.error(`[validate_data] File not found: ${dataPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(dataPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  console.log(`[validate_data] Validating: ${dataPath}`);
  console.log(`[validate_data] Total lines: ${lines.length}`);
  console.log('');

  const stats = {
    total: lines.length,
    valid: 0,
    invalid: 0,
    warnings: 0,
    byType: {},
    tokenDistribution: { under512: 0, '512-1024': 0, '1024-2048': 0, over2048: 0 },
    avgTokens: 0,
    totalTokens: 0,
    duplicates: 0,
    errors: [],
    warningsList: [],
  };

  const seenAssistantContent = new Set();
  const lineResults = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i].trim();

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      stats.invalid++;
      stats.errors.push({ line: lineNum, error: `JSON parse error: ${e.message}` });
      if (verbose) console.error(`  Line ${lineNum}: JSON parse error — ${e.message}`);
      continue;
    }

    const result = validateExample(parsed, lineNum);

    if (!result.valid) {
      stats.invalid++;
      for (const err of result.errors) {
        stats.errors.push({ line: lineNum, error: err });
        if (verbose) console.error(`  Line ${lineNum} [${parsed.type || '?'}]: ERROR — ${err}`);
      }
    } else {
      stats.valid++;
    }

    if (result.warnings.length > 0) {
      stats.warnings += result.warnings.length;
      for (const w of result.warnings) {
        stats.warningsList.push({ line: lineNum, warning: w });
        if (verbose) console.warn(`  Line ${lineNum} [${parsed.type || '?'}]: WARN — ${w}`);
      }
    }

    // Type distribution
    const type = parsed.type || 'unknown';
    stats.byType[type] = (stats.byType[type] || 0) + 1;

    // Token distribution
    if (result.tokens !== undefined) {
      stats.totalTokens += result.tokens;
      if (result.tokens < 512) stats.tokenDistribution.under512++;
      else if (result.tokens < 1024) stats.tokenDistribution['512-1024']++;
      else if (result.tokens < 2048) stats.tokenDistribution['1024-2048']++;
      else stats.tokenDistribution.over2048++;
    }

    // Duplicate detection
    const assistantContent = parsed.messages?.find(m => m.role === 'assistant')?.content;
    if (assistantContent) {
      const key = assistantContent.trim().substring(0, 200);
      if (seenAssistantContent.has(key)) {
        stats.duplicates++;
        if (verbose) console.warn(`  Line ${lineNum}: Possible duplicate (same assistant start)`);
      } else {
        seenAssistantContent.add(key);
      }
    }

    lineResults.push(result);
  }

  stats.avgTokens = stats.total > 0 ? Math.round(stats.totalTokens / stats.total) : 0;

  // ── Report ───────────────────────────────────────────────────────────────────
  const passRate = stats.total > 0 ? Math.round(stats.valid / stats.total * 100) : 0;
  const statusIcon = stats.invalid === 0 ? '✓' : stats.invalid < 10 ? '⚠' : '✗';

  console.log(`${statusIcon} Validation Results`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Valid:   ${stats.valid}/${stats.total} (${passRate}%)`);
  console.log(`  Invalid: ${stats.invalid}`);
  console.log(`  Warnings: ${stats.warnings}`);
  console.log(`  Duplicates: ${stats.duplicates}`);
  console.log('');

  console.log(`Distribution by Type:`);
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / stats.total * 100);
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`  ${type.padEnd(25)} ${String(count).padStart(5)}  (${String(pct).padStart(3)}%) ${bar}`);
  }

  console.log('');
  console.log(`Token Distribution (approx, max ${maxTokens}):`);
  console.log(`  <512 tokens:       ${stats.tokenDistribution.under512}`);
  console.log(`  512-1024 tokens:   ${stats.tokenDistribution['512-1024']}`);
  console.log(`  1024-2048 tokens:  ${stats.tokenDistribution['1024-2048']}`);
  console.log(`  >2048 tokens:      ${stats.tokenDistribution.over2048} ← will be truncated`);
  console.log(`  Average:           ~${stats.avgTokens} tokens`);

  if (stats.errors.length > 0) {
    console.log('');
    console.log(`Top Errors (first 10):`);
    stats.errors.slice(0, 10).forEach(e => {
      console.log(`  Line ${e.line}: ${e.error}`);
    });
  }

  if (stats.warningsList.length > 0 && !verbose) {
    console.log('');
    console.log(`Top Warnings (first 5, use --verbose for all):`);
    stats.warningsList.slice(0, 5).forEach(w => {
      console.log(`  Line ${w.line}: ${w.warning}`);
    });
  }

  // Quality assessment
  console.log('');
  console.log(`Quality Assessment:`);
  const issues = [];
  if (passRate < 95) issues.push(`Low pass rate (${passRate}%) — investigate invalid examples`);
  if (stats.duplicates > stats.total * 0.1) issues.push(`High duplicate rate (${stats.duplicates}) — deduplicate before training`);
  if (stats.tokenDistribution.over2048 > stats.total * 0.2) issues.push(`Many long examples (${stats.tokenDistribution.over2048}) will be truncated`);
  if (!stats.byType['narrative_writing']) issues.push('No narrative_writing examples found');
  if (!stats.byType['adjustment_reasoning']) issues.push('No adjustment_reasoning examples found');
  if (stats.total < 100) issues.push(`Small dataset (${stats.total} examples) — more data improves quality`);

  if (issues.length === 0) {
    console.log(`  ✓ Data looks good — ready for training!`);
    console.log(`  ✓ ${stats.total} examples, ~${stats.avgTokens} avg tokens each`);
  } else {
    issues.forEach(issue => console.log(`  ⚠ ${issue}`));
  }

  console.log('');
  console.log(`Ready for training: ${stats.invalid === 0 ? 'YES' : 'NO (fix errors first)'}`);

  return stats;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let dataPath = null;
let verbose = false;
let maxTokens = MAX_TOKENS;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' || args[i] === '-f') dataPath = args[++i];
  if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
  if (args[i] === '--max-tokens') maxTokens = parseInt(args[++i]);
}

if (!dataPath) {
  const projectRoot = path.resolve(__dirname, '../../');
  dataPath = findDataFile(projectRoot);
  if (!dataPath) {
    // try walking up for worktree context
    dataPath = findDataFile(path.resolve(projectRoot, '../../..'));
  }
  if (!dataPath) {
    console.error('[validate_data] No data file found. Use --file <path>');
    process.exit(1);
  }
}

const stats = validate(dataPath, { verbose, maxTokens });
process.exit(stats.invalid > 0 ? 1 : 0);
