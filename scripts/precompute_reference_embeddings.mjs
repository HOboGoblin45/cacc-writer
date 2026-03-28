#!/usr/bin/env node

/**
 * scripts/precompute_reference_embeddings.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Precompute reference embeddings from approved narratives.
 *
 * Reads narrative examples from knowledge_base/narratives/*.json, generates
 * embeddings using OpenAI text-embedding-3-small, and stores them as baseline
 * reference voice for voice consistency scoring.
 *
 * Usage:
 *   node scripts/precompute_reference_embeddings.mjs [--formType 1004] [--userId demo]
 *
 * Defaults:
 *   formType: 1004 (or all if not specified)
 *   userId: 'default' (shared reference voice)
 *
 * Outputs:
 *   - Stores embeddings to data/voice_embeddings/{userId}_{formType}.json
 *   - Or to Pinecone if configured
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateEmbeddings,
  storeReferenceVoice,
  EMBEDDING_DIMENSION,
} from '../server/ai/voiceConsistencyScorer.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const KNOWLEDGE_BASE_DIR = path.join(PROJECT_ROOT, 'knowledge_base');
const NARRATIVES_DIR = path.join(KNOWLEDGE_BASE_DIR, 'narratives');
const APPROVED_NARRATIVES_DIR = path.join(KNOWLEDGE_BASE_DIR, 'approvedNarratives');

// Parse command-line arguments
const args = process.argv.slice(2);
let targetFormType = null;
let targetUserId = 'default';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--formType' && args[i + 1]) {
    targetFormType = args[i + 1];
    i++;
  } else if (args[i] === '--userId' && args[i + 1]) {
    targetUserId = args[i + 1];
    i++;
  }
}

// ── Logger utility ────────────────────────────────────────────────────────────

function log(level, msg, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = { ts: timestamp, level, msg, ...meta };
  if (level === 'error' || level === 'warn') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ── Main logic ────────────────────────────────────────────────────────────────

async function main() {
  log('info', 'precompute_reference_embeddings.mjs started', {
    formType: targetFormType || 'all',
    userId: targetUserId,
  });

  // Ensure OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    log('error', 'OPENAI_API_KEY not configured. Set it in .env');
    process.exit(1);
  }

  // Load narratives
  let narratives = [];
  try {
    narratives = loadNarratives();
  } catch (err) {
    log('error', 'Failed to load narratives', { error: err.message });
    process.exit(1);
  }

  if (narratives.length === 0) {
    log('warn', 'No narratives found', {
      narrativesDir: NARRATIVES_DIR,
      approvedDir: APPROVED_NARRATIVES_DIR,
    });
    process.exit(0);
  }

  log('info', 'Loaded narratives', { count: narratives.length });

  // Filter by formType if specified
  let filtered = narratives;
  if (targetFormType) {
    filtered = narratives.filter(n => n.formType === targetFormType);
    log('info', 'Filtered narratives by formType', {
      formType: targetFormType,
      count: filtered.length,
    });
  }

  if (filtered.length === 0) {
    log('warn', 'No narratives match the filter', { formType: targetFormType });
    process.exit(0);
  }

  // Group by formType for processing
  const byFormType = new Map();
  for (const narrative of filtered) {
    const formType = narrative.formType || '1004';
    if (!byFormType.has(formType)) {
      byFormType.set(formType, []);
    }
    byFormType.get(formType).push(narrative);
  }

  // Process each formType
  for (const [formType, narrativesForForm] of byFormType.entries()) {
    log('info', 'Processing formType', { formType, count: narrativesForForm.length });

    // Extract narrative texts
    const texts = narrativesForForm.map(n => n.text || n.content || '').filter(t => t.length > 0);

    if (texts.length === 0) {
      log('warn', 'No text content found for formType', { formType });
      continue;
    }

    // Generate embeddings
    log('info', 'Generating embeddings', { formType, count: texts.length });
    let embeddings;
    try {
      embeddings = await generateEmbeddings(texts);
    } catch (err) {
      log('error', 'Failed to generate embeddings', { formType, error: err.message });
      continue;
    }

    if (embeddings.length !== texts.length) {
      log('warn', 'Embedding count mismatch', {
        formType,
        expected: texts.length,
        received: embeddings.length,
      });
    }

    // Store embeddings
    let stored = 0;
    for (let i = 0; i < texts.length && i < embeddings.length; i++) {
      const narrative = narrativesForForm[i];
      const sectionId = narrative.sectionId || `narrative_${i}`;
      const text = texts[i];
      const embedding = embeddings[i];

      try {
        const success = await storeReferenceVoice(targetUserId, formType, sectionId, text, embedding);
        if (success) {
          stored++;
        } else {
          log('warn', 'Failed to store reference voice', { formType, sectionId });
        }
      } catch (err) {
        log('error', 'Error storing reference voice', {
          formType,
          sectionId,
          error: err.message,
        });
      }
    }

    log('info', 'Stored embeddings', { formType, stored, total: texts.length });
  }

  log('info', 'precompute_reference_embeddings.mjs completed successfully');
}

// ── Load narratives from knowledge base ────────────────────────────────────────

function loadNarratives() {
  const narratives = [];

  // Try narratives directory first
  if (fs.existsSync(NARRATIVES_DIR)) {
    const files = fs.readdirSync(NARRATIVES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(NARRATIVES_DIR, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data)) {
          narratives.push(...data);
        } else if (typeof data === 'object' && data.text) {
          narratives.push(data);
        }
      } catch (err) {
        log('warn', 'Failed to load narrative file', { file, error: err.message });
      }
    }
  }

  // Also try approved narratives directory
  if (fs.existsSync(APPROVED_NARRATIVES_DIR)) {
    const files = fs.readdirSync(APPROVED_NARRATIVES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(APPROVED_NARRATIVES_DIR, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data)) {
          narratives.push(...data);
        } else if (typeof data === 'object' && data.text) {
          narratives.push(data);
        }
      } catch (err) {
        log('warn', 'Failed to load approved narrative file', { file, error: err.message });
      }
    }
  }

  return narratives;
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  log('error', 'Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
