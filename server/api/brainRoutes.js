/**
 * brainRoutes.js
 * ───────────────
 * Proxy routes for the Knowledge Brain (RunPod vLLM + FastAPI dashboard).
 * Forwards /api/brain/* requests to the RunPod pod's FastAPI server.
 */

import { Router } from 'express';

const router = Router();

// RunPod pod configuration — override via env vars
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || 'l1rb6jfw6lv7zv';
const BRAIN_BASE = process.env.BRAIN_BASE_URL || `https://${RUNPOD_POD_ID}-8080.proxy.runpod.net`;
const VLLM_BASE = process.env.VLLM_BASE_URL || `https://${RUNPOD_POD_ID}-8000.proxy.runpod.net`;

/**
 * Proxy helper — forwards requests to the RunPod FastAPI server.
 */
async function proxyToBrain(endpoint, req, res) {
  const url = `${BRAIN_BASE}${endpoint}`;
  try {
    const fetchOptions = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    };
    if (req.method !== 'GET' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.warn(`[brain] Proxy error for ${endpoint}:`, error.message);
    res.status(502).json({ ok: false, error: 'Brain service unreachable', detail: error.message });
  }
}

// ─── Health & Status ─────────────────────────────────────────
router.get('/brain/health', async (req, res) => {
  try {
    const [brainResp, vllmResp] = await Promise.allSettled([
      fetch(`${BRAIN_BASE}/api/health`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${VLLM_BASE}/health`, { signal: AbortSignal.timeout(5000) }),
    ]);

    const brainOk = brainResp.status === 'fulfilled' && brainResp.value.ok;
    const vllmOk = vllmResp.status === 'fulfilled' && vllmResp.value.ok;

    let model = null;
    if (vllmOk) {
      try {
        const modelsResp = await fetch(`${VLLM_BASE}/v1/models`, { signal: AbortSignal.timeout(5000) });
        const models = await modelsResp.json();
        model = models.data?.[0]?.id || 'unknown';
      } catch { /* ignore */ }
    }

    res.json({
      ok: brainOk || vllmOk,
      brain: brainOk ? 'online' : 'offline',
      vllm: vllmOk ? 'online' : 'offline',
      model,
      podId: RUNPOD_POD_ID,
      brainUrl: BRAIN_BASE,
      vllmUrl: VLLM_BASE,
    });
  } catch (error) {
    res.json({ ok: false, brain: 'error', vllm: 'error', error: error.message });
  }
});

// ─── Knowledge Graph ─────────────────────────────────────────
router.get('/brain/graph', (req, res) => proxyToBrain('/api/graph', req, res));
router.get('/brain/graph/search', (req, res) => {
  const q = req.query.q || '';
  proxyToBrain(`/api/graph/search?q=${encodeURIComponent(q)}`, req, res);
});

// ─── Chat / Workflow ─────────────────────────────────────────
router.post('/brain/chat', (req, res) => proxyToBrain('/api/chat', req, res));

// ─── Appraisal ───────────────────────────────────────────────
router.post('/brain/appraisal/new', (req, res) => proxyToBrain('/api/appraisal/new', req, res));

// ─── Comparable Sales ────────────────────────────────────────
router.get('/brain/comps', (req, res) => proxyToBrain('/api/comps', req, res));
router.post('/brain/comps', (req, res) => proxyToBrain('/api/comps', req, res));

// ─── Market Data ─────────────────────────────────────────────
router.get('/brain/market', (req, res) => proxyToBrain('/api/market', req, res));

// ─── Report ──────────────────────────────────────────────────
router.get('/brain/report/preview', (req, res) => proxyToBrain('/api/report/preview', req, res));
router.post('/brain/report/export', (req, res) => proxyToBrain('/api/report/export', req, res));

// ─── vLLM Direct (for advanced use) ─────────────────────────
router.post('/brain/v1/chat/completions', async (req, res) => {
  const url = `${VLLM_BASE}/v1/chat/completions`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(502).json({ ok: false, error: 'vLLM unreachable', detail: error.message });
  }
});

// ─── Configuration ───────────────────────────────────────────
router.get('/brain/config', (req, res) => {
  res.json({
    podId: RUNPOD_POD_ID,
    brainUrl: BRAIN_BASE,
    vllmUrl: VLLM_BASE,
    wsUrl: `wss://${RUNPOD_POD_ID}-8080.proxy.runpod.net/ws/chat`,
  });
});

export default router;
