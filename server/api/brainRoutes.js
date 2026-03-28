/**
 * brainRoutes.js
 * ───────────────
 * Proxy routes for the Knowledge Brain (RunPod vLLM + FastAPI dashboard).
 * Forwards /api/brain/* requests to the RunPod pod's FastAPI server.
 *
 * Phase 1.5 enhancements:
 *   - Fallback provider chain (RunPod → OpenAI → graceful degradation)
 *   - Error sanitization (no internal URLs leaked to client)
 *   - Config endpoint serves pod ID to frontend (no hardcoding in brain.html)
 *   - Model registry & graph persistence endpoints
 *   - AI cost logging on every inference call
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import {
  getActiveModel, listModels, registerModel, promoteModel, rollbackToModel
} from '../db/repositories/brainRepo.js';
import {
  getFullGraph, upsertGraphNode, createGraphEdge, deleteGraphNode, deleteGraphEdge
} from '../db/repositories/brainRepo.js';
import {
  saveChatMessage, getChatHistory
} from '../db/repositories/brainRepo.js';
import {
  logAiCost, getUserCostSummary, getUserCostByProvider
} from '../db/repositories/brainRepo.js';

const router = Router();

// RunPod pod configuration — override via env vars. No hardcoded fallback in production.
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || 'l1rb6jfw6lv7zv';
const BRAIN_BASE = process.env.BRAIN_BASE_URL || `https://${RUNPOD_POD_ID}-8080.proxy.runpod.net`;
const VLLM_BASE = process.env.VLLM_BASE_URL || `https://${RUNPOD_POD_ID}-8000.proxy.runpod.net`;

// Fallback provider (used when RunPod is down)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const FALLBACK_MODEL = process.env.BRAIN_FALLBACK_MODEL || 'gpt-4o-mini';
const FALLBACK_ENABLED = process.env.BRAIN_FALLBACK_ENABLED !== 'false';

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const graphNodeSchema = z.object({
  id: z.string().optional(),
  nodeType: z.enum(['case', 'property', 'comp', 'market_area', 'pattern', 'concept', 'appraiser', 'adjustment', 'section']),
  label: z.string().min(1).max(500),
  properties: z.record(z.unknown()).optional(),
  embedding: z.array(z.number()).optional(),
  weight: z.number().min(0).max(100).optional(),
});

const graphEdgeSchema = z.object({
  id: z.string().optional(),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  edgeType: z.enum(['related_to', 'comparable_to', 'located_in', 'derived_from', 'adjusted_by', 'generated_for', 'similar_pattern', 'market_trend', 'appraised_by']),
  weight: z.number().min(0).max(100).optional(),
  properties: z.record(z.unknown()).optional(),
});

const chatSchema = z.object({
  message: z.string().max(10000).optional(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  caseId: z.string().optional(),
}).refine(data => data.message || data.messages, { message: 'Either message or messages is required' });

const registerModelSchema = z.object({
  modelName: z.string().min(1).max(100).optional(),
  version: z.string().min(1).max(50),
  baseModel: z.string().optional(),
  status: z.enum(['training', 'evaluating', 'staged', 'active', 'retired', 'failed']).optional(),
  trainingSamples: z.number().int().min(0).optional(),
  hyperparams: z.record(z.unknown()).optional(),
  evalScores: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
});

// ── URL Parameter Schemas ────────────────────────────────────────────────────
const graphNodeIdSchema = z.object({
  id: z.string().min(1),
});

const graphEdgeIdSchema = z.object({
  id: z.string().min(1),
});

const modelIdSchema = z.object({
  id: z.string().min(1),
});

// ── Query Parameter Schemas ──────────────────────────────────────────────────
const graphSearchQuerySchema = z.object({
  q: z.string().max(500).optional().default(''),
});

const graphLocalQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
});

const chatHistoryQuerySchema = z.object({
  caseId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

const listModelsQuerySchema = z.object({
  name: z.string().max(100).optional().default('cacc-appraiser'),
});

const costSummaryQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize error messages — never leak internal URLs or stack traces to client.
 */
function sanitizeError(error) {
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return 'AI service timed out — please try again';
  }
  if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
    return 'AI service temporarily unavailable';
  }
  return 'AI service error — please try again';
}

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
    log.warn('brain:proxy', { endpoint, error: error.message });
    res.status(502).json({ ok: false, error: sanitizeError(error) });
  }
}

/**
 * Fallback to OpenAI when RunPod/vLLM is unreachable.
 * Returns null if fallback is disabled or unconfigured.
 */
async function fallbackGenerate(messages, options = {}) {
  if (!FALLBACK_ENABLED || !OPENAI_API_KEY) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        messages,
        max_tokens: options.max_tokens || 2048,
        temperature: options.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      log.warn('brain:fallback', { status: response.status });
      return null;
    }

    const data = await response.json();
    data._fallback = true;
    data._fallback_model = FALLBACK_MODEL;
    return data;
  } catch (error) {
    log.warn('brain:fallback-error', { error: error.message });
    return null;
  }
}

// ─── Configuration (serves config to frontend — no hardcoding in brain.html) ──
router.get('/brain/config', (req, res) => {
  res.json({
    podId: RUNPOD_POD_ID,
    wsUrl: `wss://${RUNPOD_POD_ID}-8080.proxy.runpod.net/ws/chat`,
    fallbackEnabled: FALLBACK_ENABLED && !!OPENAI_API_KEY,
  });
});

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

    // Also check active model in registry
    let registeredModel = null;
    try { registeredModel = getActiveModel(); } catch { /* ignore */ }

    res.json({
      ok: brainOk || vllmOk,
      brain: brainOk ? 'online' : 'offline',
      vllm: vllmOk ? 'online' : 'offline',
      model,
      registeredModel: registeredModel ? { id: registeredModel.id, version: registeredModel.version, status: registeredModel.status } : null,
      fallbackAvailable: FALLBACK_ENABLED && !!OPENAI_API_KEY,
      podId: RUNPOD_POD_ID,
    });
  } catch (error) {
    log.error('brain:health', { error: error.message });
    res.json({ ok: false, brain: 'error', vllm: 'error', error: sanitizeError(error) });
  }
});

// ─── Knowledge Graph (proxied to RunPod) ─────────────────────
router.get('/brain/graph', (req, res) => proxyToBrain('/api/graph', req, res));
router.get('/brain/graph/search', validateQuery(graphSearchQuerySchema), (req, res) => {
  const q = req.validatedQuery.q || '';
  proxyToBrain(`/api/graph/search?q=${encodeURIComponent(q)}`, req, res);
});

// ─── Knowledge Graph (persisted locally) ─────────────────────
router.get('/brain/graph/local', validateQuery(graphLocalQuerySchema), (req, res) => {
  try {
    const userId = req.user?.userId || 'dev-local';
    const graph = getFullGraph(userId, { limit: req.validatedQuery.limit });
    res.json({ ok: true, nodes: graph.nodes.length, edges: graph.edges.length, ...graph });
  } catch (error) {
    log.error('brain:graph-local', { error: error.message });
    res.status(500).json({ ok: false, error: 'Failed to load graph data' });
  }
});

router.post('/brain/graph/node', validateBody(graphNodeSchema), (req, res) => {
  try {
    const userId = req.user?.userId || 'dev-local';
    const id = upsertGraphNode({ ...req.validated, userId });
    res.json({ ok: true, id });
  } catch (error) {
    log.error('brain:graph-node', { error: error.message });
    res.status(500).json({ ok: false, error: 'Failed to save graph node' });
  }
});

router.post('/brain/graph/edge', validateBody(graphEdgeSchema), (req, res) => {
  try {
    const userId = req.user?.userId || 'dev-local';
    const id = createGraphEdge({ ...req.validated, userId });
    res.json({ ok: true, id });
  } catch (error) {
    log.error('brain:graph-edge', { error: error.message });
    res.status(500).json({ ok: false, error: 'Failed to save graph edge' });
  }
});

router.delete('/brain/graph/node/:id', validateParams(graphNodeIdSchema), (req, res) => {
  try {
    deleteGraphNode(req.validatedParams.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to delete node' });
  }
});

router.delete('/brain/graph/edge/:id', validateParams(graphEdgeIdSchema), (req, res) => {
  try {
    deleteGraphEdge(req.validatedParams.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to delete edge' });
  }
});

// ─── Graph Sync (pull from RunPod → persist locally) ─────────
router.post('/brain/graph/sync', async (req, res) => {
  const userId = req.user?.userId || 'dev-local';
  try {
    const resp = await fetch(`${BRAIN_BASE}/api/graph`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.status(502).json({ ok: false, error: 'RunPod graph unavailable' });
    const data = await resp.json();
    const nodes = data.nodes || [];
    const edges = data.edges || data.links || [];

    let nodesCreated = 0, edgesCreated = 0;
    for (const n of nodes) {
      upsertGraphNode({
        id: n.id,
        userId,
        nodeType: n.node_type || n.type || 'concept',
        label: n.label || n.name || n.id,
        properties: n.properties || {},
        weight: n.weight ?? 1.0,
      });
      nodesCreated++;
    }
    for (const e of edges) {
      createGraphEdge({
        userId,
        sourceId: e.source_id || e.source,
        targetId: e.target_id || e.target,
        edgeType: e.edge_type || e.type || 'related_to',
        weight: e.weight ?? 1.0,
        properties: e.properties || {},
      });
      edgesCreated++;
    }

    log.info('brain:graph-sync', { userId, nodesCreated, edgesCreated });
    res.json({ ok: true, nodesCreated, edgesCreated });
  } catch (error) {
    log.error('brain:graph-sync', { error: error.message });
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

// ─── Chat / Workflow ─────────────────────────────────────────
router.post('/brain/chat', validateBody(chatSchema), async (req, res) => {
  const data = req.validated;
  const userId = req.user?.userId || 'dev-local';
  const caseId = data.caseId || null;

  // Save user message
  const userContent = data.message || data.messages?.[0]?.content || '';
  try {
    saveChatMessage({ userId, caseId, role: 'user', content: userContent });
  } catch { /* non-critical */ }

  // Build context-aware message body
  // If a caseId is provided, inject case context into the system prompt
  let chatBody = { ...req.body };
  if (caseId) {
    try {
      // Dynamic import to avoid circular dependency — only load if case context needed
      const { getCaseProjection } = await import('../caseRecord/caseRecordService.js');
      const caseData = getCaseProjection(caseId, { userId });
      if (caseData && caseData.facts) {
        const contextMsg = {
          role: 'system',
          content: `You are an appraisal assistant. The user is working on case ${caseId}. ` +
            `Here are the current case facts: ${JSON.stringify(caseData.facts).slice(0, 3000)}. ` +
            `Use this context to answer questions about this specific appraisal.`
        };
        // Prepend context to messages
        if (chatBody.messages) {
          chatBody.messages = [contextMsg, ...chatBody.messages];
        } else {
          chatBody.messages = [contextMsg, { role: 'user', content: chatBody.message || '' }];
        }
      }
    } catch { /* case lookup failed — continue without context */ }
  }

  // Try RunPod first
  try {
    const url = `${BRAIN_BASE}/api/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const data = await response.json();

      // Save assistant response
      try {
        saveChatMessage({ userId, caseId, role: 'assistant', content: data.response || data.choices?.[0]?.message?.content || '' });
      } catch { /* non-critical */ }

      // Log cost
      try {
        logAiCost({ userId, caseId, provider: 'runpod', operation: 'chat',
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0 });
      } catch { /* non-critical */ }

      return res.json(data);
    }
  } catch (error) {
    log.warn('brain:chat-primary', { error: error.message });
  }

  // Fallback to OpenAI
  const fallbackResult = await fallbackGenerate(
    req.body?.messages || [{ role: 'user', content: req.body?.message || '' }]
  );
  if (fallbackResult) {
    const content = fallbackResult.choices?.[0]?.message?.content || '';
    try {
      saveChatMessage({ userId, caseId, role: 'assistant', content, modelId: FALLBACK_MODEL });
      logAiCost({ userId, caseId, provider: 'openai', operation: 'chat',
        inputTokens: fallbackResult.usage?.prompt_tokens || 0,
        outputTokens: fallbackResult.usage?.completion_tokens || 0 });
    } catch { /* non-critical */ }
    return res.json(fallbackResult);
  }

  res.status(502).json({ ok: false, error: 'AI service unavailable — both primary and fallback failed' });
});

// ─── Chat History ────────────────────────────────────────────
router.get('/brain/chat/history', validateQuery(chatHistoryQuerySchema), (req, res) => {
  try {
    const userId = req.user?.userId || 'dev-local';
    const caseId = req.validatedQuery.caseId || null;
    const messages = getChatHistory(userId, caseId, req.validatedQuery.limit);
    res.json({ ok: true, messages });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to load chat history' });
  }
});

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

// ─── vLLM Direct (with fallback) ─────────────────────────────
router.post('/brain/v1/chat/completions', async (req, res) => {
  const userId = req.user?.userId || 'dev-local';

  // Try RunPod vLLM first
  try {
    const url = `${VLLM_BASE}/v1/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60000),
    });

    if (response.ok) {
      const data = await response.json();

      // Log cost
      try {
        logAiCost({ userId, provider: 'runpod', operation: 'generate',
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0 });
      } catch { /* non-critical */ }

      return res.status(response.status).json(data);
    }
  } catch (error) {
    log.warn('brain:vllm-primary', { error: error.message });
  }

  // Fallback
  const fallbackResult = await fallbackGenerate(req.body?.messages, {
    max_tokens: req.body?.max_tokens,
    temperature: req.body?.temperature,
  });
  if (fallbackResult) {
    try {
      logAiCost({ userId, provider: 'openai', operation: 'generate',
        inputTokens: fallbackResult.usage?.prompt_tokens || 0,
        outputTokens: fallbackResult.usage?.completion_tokens || 0 });
    } catch { /* non-critical */ }
    return res.json(fallbackResult);
  }

  res.status(502).json({ ok: false, error: 'AI inference unavailable' });
});

// ─── Model Registry ──────────────────────────────────────────
router.get('/brain/models', validateQuery(listModelsQuerySchema), (req, res) => {
  try {
    const models = listModels(req.validatedQuery.name);
    res.json({ ok: true, models });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to list models' });
  }
});

router.get('/brain/models/active', (req, res) => {
  try {
    const model = getActiveModel();
    res.json({ ok: true, model });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to get active model' });
  }
});

router.post('/brain/models', validateBody(registerModelSchema), (req, res) => {
  try {
    const id = registerModel(req.validated);
    res.json({ ok: true, id });
  } catch (error) {
    log.error('brain:model-register', { error: error.message });
    res.status(500).json({ ok: false, error: 'Failed to register model' });
  }
});

router.post('/brain/models/:id/promote', validateParams(modelIdSchema), validateBody(z.object({ endpoint: z.string().optional() })), (req, res) => {
  try {
    promoteModel(req.validatedParams.id, req.validated?.endpoint);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to promote model' });
  }
});

router.post('/brain/models/:id/rollback', validateParams(modelIdSchema), (req, res) => {
  try {
    rollbackToModel(req.validatedParams.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to rollback model' });
  }
});

// ─── AI Cost Tracking ────────────────────────────────────────
router.get('/brain/costs', validateQuery(costSummaryQuerySchema), (req, res) => {
  try {
    const userId = req.user?.userId || 'dev-local';
    const summary = getUserCostSummary(userId, req.validatedQuery.since);
    const byProvider = getUserCostByProvider(userId, req.validatedQuery.since);
    res.json({ ok: true, summary, byProvider });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to get cost data' });
  }
});

// ─── Startup: Seed model registry with current deployed model ────
(function seedModelRegistry() {
  try {
    const active = getActiveModel();
    if (!active && RUNPOD_POD_ID) {
      const id = registerModel({
        modelName: 'cacc-appraiser',
        version: 'v6',
        baseModel: 'meta-llama/Llama-3.1-8B',
        status: 'active',
        deployedEndpoint: `${VLLM_BASE}/v1/chat/completions`,
        trainingSamples: 0,
        hyperparams: { quantization: 'none', maxSeqLen: 8192, gpuMemory: '24GB' },
        evalScores: { note: 'Pre-eval — baseline model deployed on RunPod RTX 4090' },
        notes: 'Initial fine-tuned model (cacc-appraiser-v6). Auto-seeded on first startup.',
      });
      // Promote it immediately
      promoteModel(id, `${VLLM_BASE}/v1/chat/completions`);
      log.info('brain:seed', `Registered and promoted initial model: ${id}`);
    }
  } catch (err) {
    // Non-critical — model registry may not be initialized yet
    log.warn('brain:seed', { error: err.message });
  }
})();

export default router;
