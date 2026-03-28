#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import * as selfTrainingPipeline from '../server/training/selfTrainingPipeline.js';
import * as selfTrainingAnalyzer from '../server/training/selfTrainingAnalyzer.js';
import * as selfTrainingRepo from '../server/db/repositories/selfTrainingRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  section: null,
  limit: 10,
  batchId: null,
  analyze: false,
  compare: null,
  dryRun: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--section' && args[i + 1]) {
    options.section = args[++i];
  } else if (args[i] === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[++i]);
  } else if (args[i] === '--batch-id' && args[i + 1]) {
    options.batchId = args[++i];
  } else if (args[i] === '--analyze') {
    options.analyze = true;
  } else if (args[i] === '--compare' && args[i + 1]) {
    options.compare = args[++i]; // expecting "batchId1:batchId2"
  } else if (args[i] === '--dry-run') {
    options.dryRun = true;
  }
}

// Helper to print usage
function printUsage() {
  console.log(`
Usage: node scripts/runSelfTraining.mjs [options]

Options:
  --section <type>       Filter corpus entries by section type
  --limit <n>           Max number of entries to process (default: 10)
  --batch-id <id>       Analyze specific batch instead of running new eval
  --analyze             Run gap analysis on specified batch
  --compare <id1:id2>   Compare two batches
  --dry-run             Show what would be run without executing

Examples:
  # Run batch eval on 20 subject entries
  node scripts/runSelfTraining.mjs --section subject --limit 20

  # Analyze existing batch
  node scripts/runSelfTraining.mjs --batch-id <uuid> --analyze

  # Compare two batches
  node scripts/runSelfTraining.mjs --compare <uuid1>:<uuid2>
  `);
}

async function main() {
  try {
    // Connect to default database
    const dbPath = path.join(__dirname, '../data/cacc.db');
    const db = new Database(dbPath);

    console.log('Self-Training Pipeline CLI');
    console.log('==========================\n');

    // Mode 1: Analyze existing batch
    if (options.batchId && options.analyze) {
      console.log(`Analyzing batch: ${options.batchId}`);

      if (options.dryRun) {
        console.log('[DRY RUN] Would analyze batch and generate improvement plan');
        console.log(`  - Gap analysis for ${options.batchId}`);
        console.log(`  - Generate improvement recommendations`);
        process.exit(0);
      }

      const analysis = selfTrainingAnalyzer.analyzeGaps(db, options.batchId);
      console.log('\nGap Analysis Results:');
      console.log(JSON.stringify(analysis, null, 2));

      const plan = selfTrainingAnalyzer.generateImprovementPlan(db, options.batchId);
      console.log('\nImprovement Plan:');
      console.log(JSON.stringify(plan, null, 2));

      process.exit(0);
    }

    // Mode 2: Compare batches
    if (options.compare) {
      const [batch1, batch2] = options.compare.split(':');

      if (!batch1 || !batch2) {
        console.error('Error: --compare requires format "batchId1:batchId2"');
        printUsage();
        process.exit(1);
      }

      console.log(`Comparing batches:\n  ${batch1}\n  ${batch2}`);

      if (options.dryRun) {
        console.log('[DRY RUN] Would compare two batches and calculate deltas');
        process.exit(0);
      }

      const comparison = selfTrainingAnalyzer.compareBatches(db, batch1, batch2);
      console.log('\nBatch Comparison Results:');
      console.log(JSON.stringify(comparison, null, 2));

      process.exit(0);
    }

    // Mode 3: Run new batch evaluation
    // In real usage, would load corpus entries from database or file
    const mockCorpusEntries = Array.from({ length: options.limit }).map((_, i) => ({
      id: `entry_${i}`,
      section_type: options.section || 'subject',
      original_text: `This is a sample appraisal narrative for section ${options.section || 'subject'} entry ${i}. It contains information about the property, its condition, and relevant market data.`
    }));

    console.log(`Running batch evaluation:`);
    console.log(`  - Section type: ${options.section || 'all'}`);
    console.log(`  - Entries: ${options.limit}`);
    console.log(`  - Dry run: ${options.dryRun}`);

    if (options.dryRun) {
      console.log('\n[DRY RUN] Would execute:');
      console.log(`  1. Create batch record`);
      console.log(`  2. Evaluate ${mockCorpusEntries.length} corpus entries`);
      console.log(`  3. Calculate composite scores (embedding 0.4 + ROUGE 0.3 + fact coverage 0.3)`);
      console.log(`  4. Classify results (PASS >= 0.85, CLOSE >= 0.70, WEAK >= 0.50, FAIL < 0.50)`);
      console.log(`  5. Store trends by section`);
      console.log(`  6. Generate improvement recommendations`);
      process.exit(0);
    }

    console.log('\nStarting batch evaluation...\n');

    const result = selfTrainingPipeline.runBatchEval(db, mockCorpusEntries);

    console.log('Batch Evaluation Complete');
    console.log(`  Batch ID: ${result.batchId}`);
    console.log(`  Total: ${result.completedEntries}/${result.totalEntries} entries`);
    console.log(`  PASS: ${result.passCount}`);
    console.log(`  CLOSE: ${result.closeCount}`);
    console.log(`  WEAK: ${result.weakCount}`);
    console.log(`  FAIL: ${result.failCount}`);
    console.log(`  Average Composite Score: ${result.avgCompositeScore}`);

    console.log('\nDetailed Results:');
    console.log(JSON.stringify(result.results.slice(0, 3), null, 2));

    console.log('\nScores by Section:');
    console.log(JSON.stringify(result.scoresBySection, null, 2));

    db.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// Show usage if no args or help requested
if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

main();
