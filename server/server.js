/**
 * server/server.js
 * ----------------
 * DEPRECATED AS STANDALONE SERVER.
 *
 * The modules in this directory (openaiClient.js, knowledgeBase.js,
 * retrieval.js, promptBuilder.js) are imported directly into
 * cacc-writer-server.js (the production server on port 5178).
 *
 * Do NOT run this file directly. Use: npm start (cacc-writer-server.js)
 *
 * This file is kept for reference only. The standalone app.listen() block
 * is guarded and will not run unless STANDALONE_MODULAR_SERVER=true is set.
 *
 * Original modular endpoints (now handled by cacc-writer-server.js):
 *   POST /api/generate-batch    → generate narrative sections
 *   POST /api/cases/:id/feedback → save approved edits to KB
 *   POST /api/kb/migrate-voice  → migrate voice_training.json to KB
 *   GET  /api/kb/status         → KB health check
 *   POST /api/kb/reindex        → rebuild KB index
 */

import 'dotenv/config';
import express from 'express';
import { callAI } from './openaiClient.js';
import { addExample, indexExamples } from './knowledgeBase.js';
import { getRelevantExamples } from './retrieval.js';
import { buildPromptMessages, buildApproveEditPrompt } from './promptBuilder.js';

const PORT = Number(process.env.MODULAR_PORT) || 5179;
const ACI_AGENT_URL = process.env.ACI_AGENT_URL || 'http://localhost:5180';

const app = express();
app.use(express.json({ limit: '4mb' }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function trimText(v, max = 4000) {
  return String(v ?? '').trim().slice(0, max);
}

function parseJSONSafe(text, fallback = {}) {
  try {
    const s = String(text || '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1) return fallback;
    return JSON.parse(s.slice(start, end + 1));
  } catch { return fallback; }
}

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, server: 'cacc-writer-modular', port: PORT });
});

// ── POST /generate-section ────────────────────────────────────────────────────
/**
 * Generate a single appraisal narrative section.
 *
 * Request body:
 *   {
 *     formType:     string   (e.g. '1004')
 *     fieldId:      string   (e.g. 'neighborhood_description')
 *     propertyType: string   (e.g. 'residential')
 *     marketType:   string   (e.g. 'suburban')
 *     marketArea:   string   (e.g. 'Bloomington-Normal, IL')
 *     facts:        object   (extracted property facts)
 *   }
 *
 * Response:
 *   { ok: true, text: string, fieldId: string, examplesUsed: number }
 */
app.post('/generate-section', async (req, res) => {
  try {
    const {
      formType     = '1004',
      fieldId,
      propertyType = 'residential',
      marketType   = 'suburban',
      marketArea   = '',
      facts        = {},
    } = req.body;

    if (!fieldId) {
      return res.status(400).json({ ok: false, error: 'fieldId is required' });
    }

    // Step 1: Retrieve relevant examples from knowledge base
    const examples = getRelevantExamples({ formType, fieldId, propertyType, marketType });

    // Step 2: Build the full prompt message array
    const messages = buildPromptMessages({
      formType,
      fieldId,
      propertyType,
      marketType,
      marketArea,
      facts,
      examples,
    });

    // Step 3: Call OpenAI
    const text = await callAI(messages);

    res.json({
      ok: true,
      text: trimText(text, 8000),
      fieldId,
      formType,
      examplesUsed: examples.length,
    });
  } catch (err) {
    console.error('[/generate-section]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /approve-edit ────────────────────────────────────────────────────────
/**
 * Save an appraiser-approved edit to the knowledge base.
 * Optionally uses AI to score the edit quality and extract tags.
 *
 * Request body:
 *   {
 *     fieldId:      string
 *     formType:     string
 *     propertyType: string
 *     marketType:   string
 *     marketArea:   string
 *     originalText: string
 *     editedText:   string   ← the approved version
 *     qualityScore: number   (optional; AI will estimate if omitted)
 *     tags:         string[] (optional)
 *   }
 *
 * Response:
 *   { ok: true, example: object }
 */
app.post('/approve-edit', async (req, res) => {
  try {
    const {
      fieldId,
      formType     = '1004',
      propertyType = 'residential',
      marketType   = 'suburban',
      marketArea   = '',
      originalText = '',
      editedText,
      qualityScore,
      tags         = [],
    } = req.body;

    if (!fieldId)    return res.status(400).json({ ok: false, error: 'fieldId is required' });
    if (!editedText) return res.status(400).json({ ok: false, error: 'editedText is required' });

    let resolvedScore = qualityScore;
    let resolvedTags  = tags;

    // If no quality score provided, ask AI to estimate it
    if (resolvedScore == null && originalText) {
      try {
        const scoreMessages = buildApproveEditPrompt(originalText, editedText);
        const scoreText = await callAI(scoreMessages, { timeout: 30_000 });
        const parsed = parseJSONSafe(scoreText);
        resolvedScore = Number(parsed.qualityScore) || 80;
        if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
          resolvedTags = parsed.tags;
        }
      } catch {
        resolvedScore = 80; // fallback
      }
    }

    const example = addExample({
      fieldId,
      formType,
      propertyType,
      marketType,
      marketArea,
      sourceType:   'approved_edit',
      qualityScore: resolvedScore ?? 80,
      tags:         resolvedTags,
      text:         editedText,
    });

    res.json({ ok: true, example });
  } catch (err) {
    console.error('[/approve-edit]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /insert-aci ──────────────────────────────────────────────────────────
/**
 * Forward generated text to the Python desktop automation agent for
 * insertion into ACI appraisal software.
 *
 * The desktop agent must be running at ACI_AGENT_URL (default: http://localhost:5180).
 *
 * Request body:
 *   {
 *     fieldId: string   (e.g. 'neighborhood_description')
 *     text:    string   (the narrative text to insert)
 *     formType: string  (used to look up the correct field map)
 *   }
 *
 * Response:
 *   { ok: true, inserted: true } on success
 *   { ok: false, error: string } on failure
 */
app.post('/insert-aci', async (req, res) => {
  try {
    const { fieldId, text, formType = '1004' } = req.body;
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId is required' });
    if (!text)    return res.status(400).json({ ok: false, error: 'text is required' });

    // Forward to the Python agent's HTTP endpoint
    const agentRes = await fetch(`${ACI_AGENT_URL}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId, text, formType }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!agentRes.ok) {
      const errBody = await agentRes.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `Agent returned ${agentRes.status}: ${errBody}` });
    }

    const agentData = await agentRes.json().catch(() => ({}));
    res.json({ ok: true, inserted: true, agent: agentData });
  } catch (err) {
    // Common case: agent not running
    if (err.code === 'ECONNREFUSED' || err.name === 'TimeoutError') {
      return res.status(503).json({
        ok: false,
        error: 'Desktop automation agent is not running. Start desktop_agent/agent.py first.',
      });
    }
    console.error('[/insert-aci]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /reindex ─────────────────────────────────────────────────────────────
/**
 * Rebuild the knowledge base index from disk.
 * Call this after manually adding or editing example files.
 */
app.post('/reindex', (_req, res) => {
  try {
    const index = indexExamples();
    res.json({ ok: true, counts: index.counts, total: index.examples.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Only start the server if this file is run directly (not imported as a module)
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  app.listen(PORT, () => {
    console.log(`\nCACC Writer Modular Server running at http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  POST /generate-section');
    console.log('  POST /approve-edit');
    console.log('  POST /insert-aci');
    console.log('  POST /reindex');
    console.log('  GET  /health\n');
  });
}

export default app;
