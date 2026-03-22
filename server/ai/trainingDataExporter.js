/**
 * server/ai/trainingDataExporter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Training data exporter for fine-tuning custom models.
 *
 * When users have 500+ approved sections, they can:
 *   1. Export training data in OpenAI fine-tune JSONL format
 *   2. Export in Hugging Face dataset format
 *   3. Export for LoRA adapter training (Ollama/Mistral)
 *   4. Track training readiness metrics
 *
 * This is the path to truly personalized AI — a model that writes
 * EXACTLY like the appraiser because it was trained on THEIR work.
 */

import { getDb } from '../db/database.js';
import { dbAll } from '../db/database.js';
import log from '../logger.js';
import fs from 'fs';
import path from 'path';

/**
 * Get training data readiness stats for a user.
 */
export function getTrainingReadiness(userId) {
  const db = getDb();

  let totalApproved = 0;
  let bySection = {};
  let byFormType = {};

  try {
    const rows = db.prepare(`
      SELECT field_id, form_type, COUNT(*) as count, AVG(char_count) as avg_chars
      FROM user_approved_sections
      WHERE user_id = ?
      GROUP BY field_id, form_type
    `).all(userId);

    for (const row of rows) {
      totalApproved += row.count;
      bySection[row.field_id] = (bySection[row.field_id] || 0) + row.count;
      byFormType[row.form_type] = (byFormType[row.form_type] || 0) + row.count;
    }
  } catch { /* table may not exist */ }

  // Also count from generated_sections with final_text
  try {
    const generated = db.prepare(`
      SELECT section_id, COUNT(*) as count
      FROM generated_sections
      WHERE final_text IS NOT NULL AND final_text != ''
      GROUP BY section_id
    `).all();

    for (const row of generated) {
      totalApproved += row.count;
      bySection[row.section_id] = (bySection[row.section_id] || 0) + row.count;
    }
  } catch { /* ok */ }

  const readinessLevel = totalApproved >= 1000 ? 'production'
    : totalApproved >= 500 ? 'ready'
    : totalApproved >= 200 ? 'almost'
    : totalApproved >= 50 ? 'building'
    : 'starting';

  return {
    totalApproved,
    bySection,
    byFormType,
    readinessLevel,
    readinessMessage: {
      production: `${totalApproved} examples — excellent! Your model will produce high-quality, voice-matched output.`,
      ready: `${totalApproved} examples — ready for fine-tuning! Export your training data and create a custom model.`,
      almost: `${totalApproved} examples — almost there! ${500 - totalApproved} more to reach fine-tuning threshold.`,
      building: `${totalApproved} examples — building nicely. Keep approving sections to improve quality.`,
      starting: `${totalApproved} examples — just getting started. Approve more sections to build your voice model.`,
    }[readinessLevel],
    thresholds: {
      fineTuning: { required: 500, current: totalApproved, met: totalApproved >= 500 },
      loraAdapter: { required: 200, current: totalApproved, met: totalApproved >= 200 },
      production: { required: 1000, current: totalApproved, met: totalApproved >= 1000 },
    },
  };
}

/**
 * Export training data in OpenAI fine-tune JSONL format.
 *
 * Each line: {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
 */
export function exportOpenAIFormat(userId) {
  const examples = getTrainingExamples(userId);
  if (examples.length === 0) return { error: 'No training examples found' };

  const lines = examples.map(ex => JSON.stringify({
    messages: [
      {
        role: 'system',
        content: `You are an expert residential real estate appraiser. Generate a ${ex.field_id.replace(/_/g, ' ')} section for a ${ex.form_type} appraisal report. Match the appraiser's personal writing style.`,
      },
      {
        role: 'user',
        content: buildTrainingPrompt(ex),
      },
      {
        role: 'assistant',
        content: ex.text,
      },
    ],
  }));

  return {
    format: 'openai-jsonl',
    lines: lines.length,
    content: lines.join('\n'),
    estimatedCost: `~$${(lines.length * 0.008).toFixed(2)} for GPT-4 fine-tuning`,
  };
}

/**
 * Export in Hugging Face dataset format (JSON array).
 */
export function exportHuggingFaceFormat(userId) {
  const examples = getTrainingExamples(userId);
  if (examples.length === 0) return { error: 'No training examples found' };

  const dataset = examples.map(ex => ({
    instruction: `Write a ${ex.field_id.replace(/_/g, ' ')} section for a ${ex.form_type} appraisal report.`,
    input: buildTrainingPrompt(ex),
    output: ex.text,
    metadata: {
      field_id: ex.field_id,
      form_type: ex.form_type,
      county: ex.county,
      char_count: ex.char_count,
    },
  }));

  return {
    format: 'huggingface-json',
    count: dataset.length,
    content: JSON.stringify(dataset, null, 2),
  };
}

/**
 * Export for LoRA adapter training (alpaca format).
 */
export function exportLoraFormat(userId) {
  const examples = getTrainingExamples(userId);
  if (examples.length === 0) return { error: 'No training examples found' };

  const dataset = examples.map(ex => ({
    instruction: `Generate a professional ${ex.field_id.replace(/_/g, ' ')} for a ${ex.form_type} appraisal.`,
    input: buildTrainingPrompt(ex),
    output: ex.text,
  }));

  return {
    format: 'alpaca-lora',
    count: dataset.length,
    content: JSON.stringify(dataset, null, 2),
    note: 'Use with Unsloth, Axolotl, or LLaMA-Factory for LoRA fine-tuning',
  };
}

function getTrainingExamples(userId) {
  const db = getDb();
  const examples = [];

  try {
    const approved = db.prepare(`
      SELECT * FROM user_approved_sections
      WHERE user_id = ? AND char_count > 100
      ORDER BY created_at DESC LIMIT 2000
    `).all(userId);
    examples.push(...approved);
  } catch { /* ok */ }

  try {
    const generated = db.prepare(`
      SELECT gs.section_id as field_id, cr.form_type,
             gs.final_text as text, LENGTH(gs.final_text) as char_count,
             gs.created_at
      FROM generated_sections gs
      JOIN case_records cr ON cr.case_id = gs.case_id
      WHERE gs.final_text IS NOT NULL AND LENGTH(gs.final_text) > 100
      ORDER BY gs.created_at DESC LIMIT 2000
    `).all();
    examples.push(...generated);
  } catch { /* ok */ }

  return examples;
}

function buildTrainingPrompt(example) {
  const parts = [`Section: ${example.field_id}`, `Form: ${example.form_type}`];
  if (example.county) parts.push(`County: ${example.county}`);
  if (example.city) parts.push(`City: ${example.city}`);
  return parts.join(' | ');
}

export default { getTrainingReadiness, exportOpenAIFormat, exportHuggingFaceFormat, exportLoraFormat };
