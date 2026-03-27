#!/usr/bin/env node
/**
 * scripts/training/importToOllama.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Register the fine-tuned CACC Appraiser model with Ollama.
 *
 * Usage:
 *   node scripts/training/importToOllama.mjs [options]
 *
 * Options:
 *   --base  <model>   Qwen base model in Ollama (default: qwen2.5:7b)
 *   --lora  <path>    Path to LoRA adapter directory or GGUF file
 *   --name  <name>    Ollama model name to register (default: cacc-appraiser)
 *
 * Environment variables (override defaults):
 *   QWEN_BASE_MODEL   Base model name (default: qwen2.5:7b)
 *   LORA_ADAPTER_PATH Path to LoRA adapter
 *   CACC_MODEL        Target model name (default: cacc-appraiser)
 *   OLLAMA_URL        Ollama API URL (default: http://localhost:11434)
 *
 * What it does:
 *   1. Writes an Ollama Modelfile referencing the Qwen base + optional LoRA
 *   2. Runs `ollama create cacc-appraiser -f Modelfile`
 *   3. Tests the model with a sample appraisal prompt
 *   4. Reports success or failure with actionable hints
 */

import { execSync }                          from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname }                  from 'path';
import { fileURLToPath }                     from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ───────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const BASE_MODEL     = getArg('--base', process.env.QWEN_BASE_MODEL   || 'qwen2.5:7b');
const LORA_PATH      = getArg('--lora', process.env.LORA_ADAPTER_PATH || '');
const MODEL_NAME     = getArg('--name', process.env.CACC_MODEL        || 'cacc-appraiser');
const OLLAMA_URL     = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODELFILE_PATH = resolve(__dir, 'Modelfile.tmp');

// ── System prompt (mirrors server/config/llamaConfig.js SYSTEM_PROMPT) ────────
const SYSTEM_PROMPT = `You are an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC), based in Illinois. You write USPAP-compliant appraisal reports in a professional, concise, data-driven style.

Writing style:
- Every sentence adds value — no filler
- Reference specific comparables by number
- Include specific data: prices, GLA, year built, condition ratings
- Use standard appraisal terminology (USPAP, FNMA, GLA, HBU, etc.)
- Condition: C1-C6 scale | Quality: Q1-Q6 scale`;

// ── Step 1: Build Modelfile ────────────────────────────────────────────────────
function buildModelfile() {
  const lines = [`FROM ${BASE_MODEL}`];

  if (LORA_PATH) {
    const absPath = resolve(process.cwd(), LORA_PATH);
    if (!existsSync(absPath)) {
      console.error(`[error] LoRA adapter not found: ${absPath}`);
      console.error(`        Pass --lora <path> or set LORA_ADAPTER_PATH`);
      process.exit(1);
    }
    lines.push(`ADAPTER "${absPath}"`);
    console.log(`[modelfile] Using LoRA adapter: ${absPath}`);
  } else {
    console.log(`[modelfile] No LoRA adapter specified — using base model with system prompt only`);
  }

  lines.push(
    ``,
    `SYSTEM """`,
    SYSTEM_PROMPT,
    `"""`,
    ``,
    `# Generation defaults (can be overridden per-request)`,
    `PARAMETER temperature 0.25`,
    `PARAMETER top_p 0.9`,
    `PARAMETER repeat_penalty 1.15`,
    `PARAMETER num_ctx 4096`,
    `PARAMETER stop "<|end|>"`,
    `PARAMETER stop "<|endoftext|>"`,
    `PARAMETER stop "<|im_end|>"`,
  );

  return lines.join('\n');
}

// ── Step 2: Create model in Ollama ────────────────────────────────────────────
function createModel(modelfileContent) {
  writeFileSync(MODELFILE_PATH, modelfileContent, 'utf8');

  console.log(`\n[modelfile]\n${'─'.repeat(60)}\n${modelfileContent}\n${'─'.repeat(60)}\n`);
  console.log(`[create] Running: ollama create ${MODEL_NAME} -f ${MODELFILE_PATH}`);

  try {
    const output = execSync(`ollama create "${MODEL_NAME}" -f "${MODELFILE_PATH}"`, {
      stdio:   'pipe',
      timeout: 300_000, // 5 min — first run pulls layers
    }).toString();
    console.log(`[create] ${output.trim()}`);
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    console.error(`[create] Failed: ${err.message}`);
    if (stdout) console.error(`stdout: ${stdout}`);
    if (stderr) console.error(`stderr: ${stderr}`);
    console.error(`\n[hint] Make sure Ollama is running: ollama serve`);
    console.error(`[hint] Make sure the base model is pulled: ollama pull ${BASE_MODEL}`);
    process.exit(1);
  } finally {
    try { unlinkSync(MODELFILE_PATH); } catch { /* best-effort cleanup */ }
  }
}

// ── Step 3: Smoke-test the registered model ────────────────────────────────────
async function testModel() {
  const testPrompt = `Write a 2-sentence neighborhood description for a property in Bloomington, IL.
Subject is a 1,850 sq ft ranch on a 0.25-acre lot in a residential neighborhood with primarily C3 condition homes built 1975-2000.`;

  console.log(`\n[test] Sending sample prompt to ${MODEL_NAME} at ${OLLAMA_URL}...`);

  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    MODEL_NAME,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: testPrompt },
        ],
        stream:  false,
        options: { temperature: 0.25, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    console.error(`[test] Could not reach Ollama: ${err.message}`);
    console.error(`[hint] Is Ollama running? Start with: ollama serve`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[test] Ollama returned ${res.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const data = await res.json();
  const text = data.message?.content || '(empty response)';

  console.log(`\n[test] Model response:\n${'─'.repeat(60)}\n${text}\n${'─'.repeat(60)}`);
  console.log(`\n[ok] Model "${MODEL_NAME}" registered and responding correctly.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set USE_FINETUNED=true in .env`);
  console.log(`  2. Optionally set AI_PROVIDER=ollama to use exclusively`);
  console.log(`  3. Restart the server: node cacc-writer-server.js`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\nCACC Appraiser — Ollama Model Import`);
console.log(`${'═'.repeat(45)}`);
console.log(`  Base model : ${BASE_MODEL}`);
console.log(`  LoRA path  : ${LORA_PATH || '(none)'}`);
console.log(`  Model name : ${MODEL_NAME}`);
console.log(`  Ollama URL : ${OLLAMA_URL}`);

const modelfileContent = buildModelfile();
createModel(modelfileContent);
await testModel();
