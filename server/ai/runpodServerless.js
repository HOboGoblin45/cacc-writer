/**
 * server/ai/runpodServerless.js
 * ─────────────────────────────
 * RunPod Serverless adapter for vLLM inference.
 *
 * Replaces always-on pod proxy with serverless endpoints that scale to zero.
 * The fine-tuned model (cacc-appraiser-v6) runs identically — same vLLM,
 * same weights, same OpenAI-compatible API — but only bills when active.
 *
 * Supports two modes via RUNPOD_MODE env var:
 *   - 'serverless' (default) → RunPod Serverless endpoint
 *   - 'pod'                  → Legacy always-on pod (original behavior)
 *
 * Serverless endpoint URL format:
 *   https://api.runpod.ai/v2/{ENDPOINT_ID}/openai/v1/chat/completions
 *
 * The vLLM worker on RunPod Serverless exposes the same /v1/chat/completions
 * OpenAI-compatible API, so the request/response format is identical.
 */

import log from '../logger.js';

// ── Configuration ────────────────────────────────────────────────────────────

const RUNPOD_MODE = process.env.RUNPOD_MODE || 'serverless';
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || '';

// Serverless config
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || '';
const RUNPOD_SERVERLESS_BASE = process.env.RUNPOD_SERVERLESS_BASE
  || `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

// Legacy pod config (kept for backward compatibility)
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || '';
const VLLM_POD_BASE = process.env.VLLM_BASE_URL
  || (RUNPOD_POD_ID ? `https://${RUNPOD_POD_ID}-8000.proxy.runpod.net` : '');
const BRAIN_POD_BASE = process.env.BRAIN_BASE_URL
  || (RUNPOD_POD_ID ? `https://${RUNPOD_POD_ID}-8080.proxy.runpod.net` : '');

// Timeouts
const SERVERLESS_TIMEOUT = parseInt(process.env.RUNPOD_SERVERLESS_TIMEOUT || '90000', 10);
const POD_TIMEOUT = parseInt(process.env.RUNPOD_POD_TIMEOUT || '60000', 10);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current RunPod operating mode.
 */
export function getRunPodMode() {
  return RUNPOD_MODE;
}

/**
 * Check if RunPod is configured (either mode).
 */
export function isRunPodConfigured() {
  if (RUNPOD_MODE === 'serverless') {
    return !!(RUNPOD_ENDPOINT_ID && RUNPOD_API_KEY);
  }
  return !!RUNPOD_POD_ID;
}

/**
 * Get the vLLM-compatible chat completions URL for the current mode.
 */
export function getVllmCompletionsUrl() {
  if (RUNPOD_MODE === 'serverless') {
    return `${RUNPOD_SERVERLESS_BASE}/openai/v1/chat/completions`;
  }
  return `${VLLM_POD_BASE}/v1/chat/completions`;
}

/**
 * Get the vLLM models URL for the current mode.
 */
export function getVllmModelsUrl() {
  if (RUNPOD_MODE === 'serverless') {
    return `${RUNPOD_SERVERLESS_BASE}/openai/v1/models`;
  }
  return `${VLLM_POD_BASE}/v1/models`;
}

/**
 * Get the vLLM health URL for the current mode.
 */
export function getVllmHealthUrl() {
  if (RUNPOD_MODE === 'serverless') {
    return `${RUNPOD_SERVERLESS_BASE}/health`;
  }
  return `${VLLM_POD_BASE}/health`;
}

/**
 * Get the Brain FastAPI base URL.
 * In serverless mode, the dashboard may still run on a separate light pod,
 * or be served alongside the serverless worker if packaged together.
 */
export function getBrainBaseUrl() {
  return process.env.BRAIN_BASE_URL || BRAIN_POD_BASE;
}

/**
 * Build fetch headers for the current mode.
 * Serverless requires Bearer auth; pod mode may not.
 */
export function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (RUNPOD_API_KEY) {
    headers['Authorization'] = `Bearer ${RUNPOD_API_KEY}`;
  }
  return headers;
}

/**
 * Get the appropriate timeout for the current mode.
 * Serverless gets a longer timeout to accommodate cold starts.
 */
export function getTimeout() {
  return RUNPOD_MODE === 'serverless' ? SERVERLESS_TIMEOUT : POD_TIMEOUT;
}

/**
 * Send a chat completion request to RunPod (serverless or pod).
 * Returns the full OpenAI-compatible response object.
 *
 * @param {object} body - OpenAI-compatible request body (model, messages, etc.)
 * @param {object} [options] - Override timeout, signal, etc.
 * @returns {Promise<object>} - Response data with choices, usage, etc.
 * @throws {Error} on network failure, timeout, or non-2xx status
 */
export async function chatCompletion(body, options = {}) {
  const url = getVllmCompletionsUrl();
  const timeout = options.timeout || getTimeout();

  log.info('runpod:request', {
    mode: RUNPOD_MODE,
    model: body.model,
    messageCount: body.messages?.length || 0,
    timeout,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal: options.signal || controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`RunPod ${RUNPOD_MODE} error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();

    log.info('runpod:response', {
      mode: RUNPOD_MODE,
      model: data.model,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
    });

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`RunPod ${RUNPOD_MODE} timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check RunPod health (serverless or pod).
 * @returns {Promise<{ok: boolean, mode: string, model?: string}>}
 */
export async function checkHealth() {
  const result = { ok: false, mode: RUNPOD_MODE, configured: isRunPodConfigured() };

  if (!isRunPodConfigured()) {
    return result;
  }

  try {
    // Check health endpoint
    const healthUrl = getVllmHealthUrl();
    const healthResp = await fetch(healthUrl, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    result.ok = healthResp.ok;

    // Try to get loaded model info
    if (result.ok) {
      try {
        const modelsUrl = getVllmModelsUrl();
        const modelsResp = await fetch(modelsUrl, {
          headers: getAuthHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        if (modelsResp.ok) {
          const models = await modelsResp.json();
          result.model = models.data?.[0]?.id || 'unknown';
        }
      } catch { /* ignore model fetch failure */ }
    }
  } catch (error) {
    log.warn('runpod:health', { mode: RUNPOD_MODE, error: error.message });
  }

  return result;
}

/**
 * Proxy a request to the Brain FastAPI dashboard.
 * This still uses the pod-based FastAPI server for Knowledge Brain features.
 *
 * @param {string} endpoint - Path on the FastAPI server (e.g., '/api/graph')
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export async function proxyToBrain(endpoint, req, res) {
  const brainBase = getBrainBaseUrl();
  if (!brainBase) {
    return res.status(503).json({ ok: false, error: 'Brain dashboard not configured' });
  }

  const url = `${brainBase}${endpoint}`;
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
    res.status(502).json({ ok: false, error: 'Brain dashboard unavailable' });
  }
}

/**
 * Get a summary of the current RunPod configuration for diagnostics/config endpoint.
 */
export function getConfigSummary() {
  const base = {
    mode: RUNPOD_MODE,
    configured: isRunPodConfigured(),
    timeout: getTimeout(),
  };

  if (RUNPOD_MODE === 'serverless') {
    return {
      ...base,
      endpointId: RUNPOD_ENDPOINT_ID || '(not set)',
      completionsUrl: RUNPOD_ENDPOINT_ID ? getVllmCompletionsUrl() : '(not configured)',
      brainUrl: getBrainBaseUrl() || '(not configured)',
      // Never expose API key
      hasApiKey: !!RUNPOD_API_KEY,
    };
  }

  return {
    ...base,
    podId: RUNPOD_POD_ID || '(not set)',
    vllmUrl: VLLM_POD_BASE || '(not configured)',
    brainUrl: BRAIN_POD_BASE || '(not configured)',
  };
}
