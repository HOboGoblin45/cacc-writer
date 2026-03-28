/**
 * server/api/agentsRoutes.js
 * ---------------------------
 * Express Router for agent management and insertion endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes:
 *   GET   /agents/status       — check ACI + RQ reachability
 *   POST  /agents/aci/start    — spawn desktop_agent/agent.py
 *   POST  /agents/aci/stop     — kill ACI agent process
 *   POST  /agents/rq/start     — spawn real_quantum_agent/agent.py
 *   POST  /agents/rq/stop      — kill RQ agent process
 *   POST  /insert-aci          — forward text to ACI agent /insert
 *   POST  /insert-rq           — forward text to RQ agent /insert
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Agent URLs (from env or defaults) ────────────────────────────────────────
const ACI_AGENT_URL = process.env.ACI_AGENT_URL || 'http://localhost:5180';
const RQ_AGENT_URL  = process.env.RQ_AGENT_URL  || 'http://localhost:5181';

// ── Project root (two levels up from server/api/) ────────────────────────────
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ── In-memory agent process tracking ─────────────────────────────────────────
// Tracks spawned Python agent processes so they can be stopped from the UI.
const _agentProcs = { aci: null, rq: null };

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();
const insertPayloadSchema = z.object({
  fieldId: z.string().min(1).max(80),
  text: z.string().min(1).max(50000),
  formType: z.string().max(40).optional(),
}).passthrough();

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

// ── Ping helper ───────────────────────────────────────────────────────────────
async function pingAgent(url) {
  try {
    const r = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// ── GET /agents/status ────────────────────────────────────────────────────────
router.get('/agents/status', async (_req, res) => {
  const [aci, rq] = await Promise.all([pingAgent(ACI_AGENT_URL), pingAgent(RQ_AGENT_URL)]);
  res.json({ ok: true, aci, rq });
});

// ── POST /agents/aci/start ────────────────────────────────────────────────────
router.post('/agents/aci/start', (_req, res) => {
  if (_agentProcs.aci && !_agentProcs.aci.killed) {
    return res.json({ ok: true, message: 'ACI agent already running' });
  }
  const script = path.join(PROJECT_ROOT, 'desktop_agent', 'agent.py');
  const proc   = spawn('python', [script], { stdio: 'pipe' });
  _agentProcs.aci = proc;
  proc.on('exit', () => { _agentProcs.aci = null; });
  proc.stderr?.on('data', d => log.warn('aci-agent:stderr', { output: d.toString().trim() }));
  res.json({ ok: true, message: 'ACI agent starting…' });
});

// ── POST /agents/aci/stop ─────────────────────────────────────────────────────
router.post('/agents/aci/stop', (_req, res) => {
  if (_agentProcs.aci && !_agentProcs.aci.killed) {
    _agentProcs.aci.kill();
    _agentProcs.aci = null;
    return res.json({ ok: true, message: 'ACI agent stopped' });
  }
  res.json({ ok: true, message: 'ACI agent was not running' });
});

// ── POST /agents/rq/start ─────────────────────────────────────────────────────
router.post('/agents/rq/start', (_req, res) => {
  if (_agentProcs.rq && !_agentProcs.rq.killed) {
    return res.json({ ok: true, message: 'RQ agent already running' });
  }
  const script = path.join(PROJECT_ROOT, 'real_quantum_agent', 'agent.py');
  const proc   = spawn('python', [script], { stdio: 'pipe' });
  _agentProcs.rq = proc;
  proc.on('exit', () => { _agentProcs.rq = null; });
  proc.stderr?.on('data', d => log.warn('rq-agent:stderr', { output: d.toString().trim() }));
  res.json({ ok: true, message: 'RQ agent starting…' });
});

// ── POST /agents/rq/stop ──────────────────────────────────────────────────────
router.post('/agents/rq/stop', (_req, res) => {
  if (_agentProcs.rq && !_agentProcs.rq.killed) {
    _agentProcs.rq.kill();
    _agentProcs.rq = null;
    return res.json({ ok: true, message: 'RQ agent stopped' });
  }
  res.json({ ok: true, message: 'RQ agent was not running' });
});

// ── POST /insert-aci ──────────────────────────────────────────────────────────
/**
 * Forward generated text to the ACI desktop automation agent (residential).
 * The ACI agent (desktop_agent/agent.py) must be running on port 5180.
 */
router.post('/insert-aci', async (req, res) => {
  try {
    const body = parsePayload(insertPayloadSchema, req.body || {}, res);
    if (!body) return;
    const { fieldId, text, formType = '1004' } = body;

    const agentRes = await fetch(`${ACI_AGENT_URL}/insert`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fieldId, text, formType }),
      signal:  AbortSignal.timeout(15_000),
    });

    if (!agentRes.ok) {
      const errBody = await agentRes.text().catch(() => '');
      return res.status(502).json({
        ok:    false,
        error: `ACI agent returned ${agentRes.status}: ${errBody}`,
      });
    }

    const agentData = await agentRes.json().catch(() => ({}));
    res.json({ ok: true, inserted: true, agent: agentData });
  } catch (err) {
    const connRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    const timedOut    = err.name === 'TimeoutError'  || err.cause?.name === 'TimeoutError';
    if (connRefused || timedOut) {
      return res.status(503).json({
        ok:    false,
        error: 'ACI automation agent is not running. Start desktop_agent/agent.py first.',
      });
    }
    log.error('api:insert-aci', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /insert-rq ───────────────────────────────────────────────────────────
/**
 * Forward generated text to the Real Quantum browser automation agent (commercial).
 * The RQ agent (real_quantum_agent/agent.py) must be running on port 5181.
 * Chrome must be open with --remote-debugging-port=9222 and Real Quantum loaded.
 */
router.post('/insert-rq', async (req, res) => {
  try {
    const body = parsePayload(insertPayloadSchema, req.body || {}, res);
    if (!body) return;
    const { fieldId, text, formType = 'commercial' } = body;

    const agentRes = await fetch(`${RQ_AGENT_URL}/insert`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fieldId, text, formType }),
      signal:  AbortSignal.timeout(20_000),
    });

    if (!agentRes.ok) {
      const errBody = await agentRes.text().catch(() => '');
      return res.status(502).json({
        ok:    false,
        error: `Real Quantum agent returned ${agentRes.status}: ${errBody}`,
      });
    }

    const agentData = await agentRes.json().catch(() => ({}));
    res.json({ ok: true, inserted: true, agent: agentData });
  } catch (err) {
    const connRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    const timedOut    = err.name === 'TimeoutError'  || err.cause?.name === 'TimeoutError';
    if (connRefused || timedOut) {
      return res.status(503).json({
        ok:    false,
        error: 'Real Quantum agent is not running. Start real_quantum_agent/agent.py first.',
      });
    }
    log.error('api:insert-rq', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
