#!/usr/bin/env node
/**
 * scripts/training/run_pipeline.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Master pipeline script. Runs end-to-end:
 *   1. fullDecisionPipeline — extracts training examples from 395 XMLs
 *   2. validate_data — checks quality and distribution
 *   3. Outputs RunPod upload instructions
 *
 * Usage:
 *   node scripts/training/run_pipeline.mjs
 *   node scripts/training/run_pipeline.mjs --skip-validate
 *   node scripts/training/run_pipeline.mjs --xml-dir /path/to/xmls
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: 2 levels up from scripts/training/
const PROJECT_ROOT = path.resolve(__dirname, '../../');

// ── Path detection ─────────────────────────────────────────────────────────────
function findDir(name, startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findXmlDir(startDir) {
  return findDir(path.join('training_output', 'xml_exports'), startDir);
}

function findOutputDir(startDir) {
  return findDir('training_output', startDir);
}

// ── Args ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let skipValidate = args.includes('--skip-validate');
let xmlDir = null;
let outputDir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--xml-dir') xmlDir = path.resolve(args[++i]);
  if (args[i] === '--output-dir') outputDir = path.resolve(args[++i]);
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function banner(title) {
  const line = '═'.repeat(60);
  console.log(`\n╔${line}╗`);
  console.log(`║  ${title.padEnd(58)}║`);
  console.log(`╚${line}╝\n`);
}

function step(num, total, label) {
  console.log(`\n[${num}/${total}] ${label}`);
  console.log('─'.repeat(50));
}

function success(msg) {
  console.log(`  ✓ ${msg}`);
}

function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
}

// ── Step 1: Run fullDecisionPipeline ──────────────────────────────────────────
async function runExtractionStep(xmlDir, outputDir) {
  step(1, 3, 'Extracting training data from XML files');

  // Dynamically import the pipeline
  const pipelinePath = path.resolve(PROJECT_ROOT, 'server/training/fullDecisionPipeline.js');
  if (!fs.existsSync(pipelinePath)) {
    fail(`Pipeline not found: ${pipelinePath}`);
    process.exit(1);
  }

  const { runFullDecisionPipeline } = await import(pathToFileURL(pipelinePath).href);

  const startTime = Date.now();
  const result = await runFullDecisionPipeline(xmlDir, outputDir);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  success(`Processed ${result.stats.filesProcessed} XML files in ${elapsed}s`);
  success(`Generated ${result.stats.totalExamples} training examples`);
  success(`Output: ${result.outputPath}`);

  if (result.stats.filesErrored > 0) {
    warn(`${result.stats.filesErrored} files had errors`);
  }

  return result;
}

// ── Step 2: Validate training data ────────────────────────────────────────────
function runValidationStep(dataPath) {
  step(2, 3, 'Validating training data quality');

  const validatorPath = path.resolve(__dirname, 'validate_data.mjs');
  if (!fs.existsSync(validatorPath)) {
    warn('Validator not found, skipping validation');
    return null;
  }

  const result = spawnSync(
    process.execPath,
    [validatorPath, '--file', dataPath],
    { stdio: 'inherit', encoding: 'utf-8' }
  );

  if (result.status !== 0) {
    fail('Validation found errors — check output above');
    return { passed: false };
  }

  success('Validation passed');
  return { passed: true };
}

// ── Step 3: Print RunPod instructions ─────────────────────────────────────────
function printRunPodInstructions(dataPath, outputDir) {
  step(3, 3, 'RunPod training instructions');

  const dataSize = fs.existsSync(dataPath)
    ? Math.round(fs.statSync(dataPath).size / 1024 / 1024 * 10) / 10
    : '?';

  console.log(`
Training data ready: ${dataPath} (${dataSize} MB)

┌─────────────────────────────────────────────────────────┐
│  STEP A: Create RunPod instance                         │
└─────────────────────────────────────────────────────────┘
  1. Go to https://runpod.io/console/pods
  2. Click "Deploy" → GPU pod
  3. Select GPU: A100 SXM 40GB ($2.39/hr) or RTX 4090 ($0.79/hr)
  4. Template: RunPod Pytorch 2.4.0 (CUDA 12.4)
  5. Disk: 50 GB container + 50 GB volume

┌─────────────────────────────────────────────────────────┐
│  STEP B: Upload data and scripts                        │
└─────────────────────────────────────────────────────────┘
  # Set your pod SSH endpoint (from RunPod dashboard):
  export RUNPOD_SSH=root@YOUR_POD_IP -p YOUR_PORT

  # Upload training data (~${dataSize} MB):
  scp ${dataPath} $RUNPOD_SSH:/workspace/llama_training_data.jsonl

  # Upload training script:
  scp ${path.resolve(__dirname, 'train_llama.py')} $RUNPOD_SSH:/workspace/

  # Upload setup script:
  scp ${path.resolve(__dirname, 'setup_runpod.sh')} $RUNPOD_SSH:/workspace/

┌─────────────────────────────────────────────────────────┐
│  STEP C: Run setup on pod                               │
└─────────────────────────────────────────────────────────┘
  ssh $RUNPOD_SSH

  # Accept Llama 3.1 license first at:
  # https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct

  export HF_TOKEN=hf_YOUR_TOKEN_HERE
  bash /workspace/setup_runpod.sh --local

┌─────────────────────────────────────────────────────────┐
│  STEP D: Start training                                 │
└─────────────────────────────────────────────────────────┘
  cd /workspace/cacc-training

  python train_llama.py \\
    --data ../llama_training_data.jsonl \\
    --output output/cacc-appraiser-lora \\
    --epochs 3

  # Monitor GPU usage in another terminal:
  # watch -n 2 nvidia-smi

  Estimated time:
    A100 (40GB):  ~2-3 hours
    RTX 4090:     ~4-5 hours

┌─────────────────────────────────────────────────────────┐
│  STEP E: Export adapter back to Ollama                  │
└─────────────────────────────────────────────────────────┘
  # Download adapter from pod:
  rsync -avz $RUNPOD_SSH:/workspace/cacc-training/output/ \\
    ./output/cacc-appraiser/

  # Export and register with local Ollama:
  python scripts/training/export_to_ollama.py \\
    --adapter ./output/cacc-appraiser/cacc-appraiser-lora

  # Test the model:
  ollama run cacc-appraiser "Write the neighborhood conditions for a 1004 appraisal"

┌─────────────────────────────────────────────────────────┐
│  Files created                                          │
└─────────────────────────────────────────────────────────┘
  ${dataPath}
  ${path.join(outputDir, 'training_stats.json')}
  scripts/training/train_llama.py
  scripts/training/setup_runpod.sh
  scripts/training/export_to_ollama.py
  scripts/training/validate_data.mjs
  server/config/llamaConfig.js
`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  banner('CACC Appraiser — Llama Fine-tuning Pipeline');

  // Resolve paths
  const resolvedXmlDir = xmlDir || findXmlDir(PROJECT_ROOT) || findXmlDir(path.resolve(PROJECT_ROOT, '../../..'));
  const resolvedOutputDir = outputDir || findOutputDir(PROJECT_ROOT) || findOutputDir(path.resolve(PROJECT_ROOT, '../../..')) || path.join(PROJECT_ROOT, 'training_output');

  if (!resolvedXmlDir) {
    console.error(`
ERROR: Cannot find training_output/xml_exports/

The XML directory wasn't found relative to:
  ${PROJECT_ROOT}

Options:
  1. Run from the main repo (not a git worktree)
  2. Pass: --xml-dir /absolute/path/to/xml_exports
  3. Check that training_output/xml_exports/ exists
`);
    process.exit(1);
  }

  const xmlCount = fs.readdirSync(resolvedXmlDir).filter(f => f.toLowerCase().endsWith('.xml')).length;
  console.log(`XML directory:  ${resolvedXmlDir} (${xmlCount} files)`);
  console.log(`Output directory: ${resolvedOutputDir}`);

  if (xmlCount === 0) {
    console.error('ERROR: No XML files found in the xml_exports directory');
    process.exit(1);
  }

  // Step 1: Extract
  let extractResult;
  try {
    extractResult = await runExtractionStep(resolvedXmlDir, resolvedOutputDir);
  } catch (err) {
    fail(`Extraction failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }

  const dataPath = extractResult.outputPath;

  // Step 2: Validate
  if (!skipValidate) {
    const validationResult = runValidationStep(dataPath);
    if (validationResult && !validationResult.passed) {
      warn('Validation failed — training data has errors. Continuing anyway.');
    }
  } else {
    console.log('\n[2/3] Validation skipped (--skip-validate)');
  }

  // Step 3: Instructions
  printRunPodInstructions(dataPath, resolvedOutputDir);

  banner('Pipeline Complete!');
  console.log(`  Total examples: ${extractResult.stats.totalExamples}`);
  console.log(`  Output file:    ${dataPath}`);
  console.log(`  Stats file:     ${extractResult.statsPath}`);
  console.log('');
}

main().catch(err => {
  console.error('\nPipeline failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
