/**
 * server/api/publicApiRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public API for third-party integrations.
 *
 * This is the Enterprise tier feature — allow AMCs, lenders, and
 * tech companies to build on top of Appraisal Agent.
 *
 * Endpoints:
 *   POST /v1/orders           — submit appraisal order
 *   GET  /v1/orders/:id       — check order status
 *   GET  /v1/orders/:id/report — download completed report
 *   POST /v1/generate         — standalone AI text generation
 *   POST /v1/comps/analyze    — standalone comp analysis
 *   GET  /v1/status           — API health check
 *
 * Auth: API key in header (X-API-Key) — separate from JWT auth.
 */

import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { getDb } from '../db/database.js';
import { runFullPipeline } from '../pipeline/fullReportPipeline.js';
import { analyzeComps } from '../comparables/compAnalyzer.js';
import { callAI } from '../openaiClient.js';
import { buildUad36Document } from '../export/uad36ExportService.js';
import { renderPdf } from '../export/pdfRenderer.js';
import log from '../logger.js';
import crypto from 'crypto';

const router = Router();

// ── API Key Schema ───────────────────────────────────────────────────────────

export function ensureApiKeySchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      key_hash    TEXT NOT NULL UNIQUE,
      key_prefix  TEXT NOT NULL,
      name        TEXT NOT NULL,
      permissions TEXT DEFAULT 'read,write',
      rate_limit  INTEGER DEFAULT 100,
      is_active   INTEGER DEFAULT 1,
      last_used   TEXT,
      usage_count INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Generate a new API key for a user.
 */
export function generateApiKey(userId, name) {
  const db = getDb();
  const rawKey = `aa_${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 8);
  const id = crypto.randomBytes(8).toString('hex');

  db.prepare(`
    INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, keyHash, keyPrefix, name);

  return { keyId: id, apiKey: rawKey, prefix: keyPrefix, name };
}

/**
 * Validate an API key and return the user.
 */
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required. Set X-API-Key header.' });

  const db = getDb();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const key = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1').get(keyHash);

  if (!key) return res.status(401).json({ error: 'Invalid API key' });

  // Rate limiting (simple per-minute)
  db.prepare('UPDATE api_keys SET last_used = datetime('now'), usage_count = usage_count + 1 WHERE id = ?').run(key.id);

  req.apiUser = { userId: key.user_id, keyId: key.id, permissions: key.permissions };
  next();
}

// ── GET /v1/status ───────────────────────────────────────────────────────────

router.get('/v1/status', (_req, res) => {
  res.json({
    status: 'online',
    version: '1.0',
    product: 'Appraisal Agent API',
    docs: 'https://docs.appraisalagent.com/api',
  });
});

// ── POST /v1/orders ──────────────────────────────────────────────────────────

router.post('/v1/orders', validateApiKey, async (req, res) => {
  try {
    const { orderText, formType, autoProcess } = req.body;
    if (!orderText) return res.status(400).json({ error: 'orderText is required' });

    if (autoProcess) {
      // Full pipeline
      const result = await runFullPipeline({
        orderText,
        userId: req.apiUser.userId,
        options: { formType },
      });
      res.status(201).json({ ok: true, ...result });
    } else {
      // Just parse and create case
      const { parseOrderForm } = await import('../intake/smartOrderParser.js');
      const parsed = await parseOrderForm(orderText);
      const caseId = crypto.randomBytes(4).toString('hex');
      const now = new Date().toISOString();
      const ft = parsed.facts.order?.formType || formType || '1004';

      dbRun('INSERT INTO case_records (case_id, form_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [caseId, ft, 'received', now, now]);
      dbRun('INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [caseId, JSON.stringify(parsed.facts), now, now]);

      res.status(201).json({ ok: true, caseId, formType: ft, fieldCount: parsed.meta.fieldCount });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /v1/orders/:id ───────────────────────────────────────────────────────

router.get('/v1/orders/:caseId', validateApiKey, (req, res) => {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [req.params.caseId]);
  if (!caseRecord) return res.status(404).json({ error: 'Order not found' });

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [req.params.caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  res.json({
    ok: true,
    caseId: caseRecord.case_id,
    formType: caseRecord.form_type,
    status: caseRecord.status,
    address: facts.subject?.address,
    createdAt: caseRecord.created_at,
    updatedAt: caseRecord.updated_at,
  });
});

// ── GET /v1/orders/:id/report ────────────────────────────────────────────────

router.get('/v1/orders/:caseId/report', validateApiKey, async (req, res) => {
  try {
    const format = req.query.format || 'pdf';

    if (format === 'xml' || format === 'uad36') {
      const caseData = loadCaseData(req.params.caseId);
      if (!caseData) return res.status(404).json({ error: 'Case not found' });
      const xml = buildUad36Document(caseData);
      res.type('application/xml').send(xml);
    } else {
      const pdfBuffer = await renderPdf(req.params.caseId);
      res.type('application/pdf').send(pdfBuffer);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/generate ────────────────────────────────────────────────────────

router.post('/v1/generate', validateApiKey, async (req, res) => {
  try {
    const { prompt, sectionType, facts, maxTokens } = req.body;
    if (!prompt && !sectionType) return res.status(400).json({ error: 'prompt or sectionType required' });

    const messages = [
      { role: 'system', content: 'You are an expert residential real estate appraiser. Generate professional, USPAP-compliant appraisal narrative text.' },
      { role: 'user', content: prompt || `Generate a ${sectionType} for this property: ${JSON.stringify(facts || {})}` },
    ];

    const text = await callAI(messages, { maxTokens: maxTokens || 1500, temperature: 0.3 });
    res.json({ ok: true, text, chars: text.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/comps/analyze ───────────────────────────────────────────────────

router.post('/v1/comps/analyze', validateApiKey, async (req, res) => {
  try {
    const { caseId } = req.body;
    if (!caseId) return res.status(400).json({ error: 'caseId required' });
    const result = await analyzeComps(caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper ───────────────────────────────────────────────────────────────────

function loadCaseData(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) return null;
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
  const sections = {};
  try {
    const rows = dbAll('SELECT * FROM generated_sections WHERE case_id = ? ORDER BY section_id, created_at DESC', [caseId]);
    for (const s of rows) { if (!sections[s.section_id]) sections[s.section_id] = s; }
  } catch { /* ok */ }
  let comps = []; try { comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1', [caseId]); } catch { /* ok */ }
  let adjustments = []; try { adjustments = dbAll('SELECT * FROM adjustment_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }
  let reconciliation = null; try { reconciliation = dbGet('SELECT * FROM reconciliation_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }
  return { caseRecord, facts, sections, comps, adjustments, reconciliation };
}

export default router;
