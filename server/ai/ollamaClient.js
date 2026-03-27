/**
 * server/ai/ollamaClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart Ollama client for the fine-tuned CACC Appraiser model.
 *
 * Uses Ollama's native /api/chat endpoint (not the OpenAI-compat shim) so we
 * get full access to Ollama model options (num_ctx, repeat_penalty, etc.).
 *
 * Exports:
 *   callOllama(messages, options)      — raw /api/chat call
 *   isOllamaAvailable()               — fast health check, cached 30 s
 *   callModel(messages, taskType)     — routes to Ollama or throws for OpenAI
 */

import { LLAMA_CONFIG, OLLAMA_CONFIG, TASK_MODELS, SYSTEM_PROMPT } from '../config/llamaConfig.js';
import log from '../logger.js';

const BASE_URL   = LLAMA_CONFIG.ollamaUrl;
const TIMEOUT_MS = LLAMA_CONFIG.timeout;

// ── Availability cache (30 s TTL) ─────────────────────────────────────────────
let _availCache = null; // { available: bool, models: string[], at: number }
const AVAIL_TTL_MS = 30_000;

/**
 * isOllamaAvailable()
 *
 * Returns true if Ollama is running and the cacc-appraiser model is loaded.
 * Result is cached for 30 seconds to avoid hammering /api/tags on every call.
 *
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  const now = Date.now();
  if (_availCache && (now - _availCache.at) < AVAIL_TTL_MS) {
    return _availCache.available;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      _availCache = { available: false, models: [], at: now };
      return false;
    }

    const data  = await res.json();
    const models = (data.models || []).map(m => m.name || m.model || '');
    const prefix = LLAMA_CONFIG.modelName.split(':')[0];
    const hasCacc = models.some(m => m.startsWith(prefix));

    _availCache = { available: hasCacc, models, at: now };
    return hasCacc;
  } catch {
    _availCache = { available: false, models: [], at: now };
    return false;
  }
}

// ── Message normalization ──────────────────────────────────────────────────────
/**
 * Convert from callAI() input formats to Ollama /api/chat messages array.
 * Handles: plain string, [{role, content}], Responses API nested content blocks.
 *
 * @param {string|Array} input
 * @returns {Array<{role: string, content: string}>}
 */
function normalizeMessages(input) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input))    return [{ role: 'user', content: String(input) }];

  return input.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role || 'user', content: msg.content };
    }
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter(b => b.type === 'text' || typeof b === 'string')
        .map(b => (typeof b === 'string' ? b : b.text || ''))
        .join('\n');
      return { role: msg.role || 'user', content: text };
    }
    return { role: msg.role || 'user', content: String(msg.content || '') };
  });
}

// ── Raw Ollama call ────────────────────────────────────────────────────────────
/**
 * callOllama(messages, options)
 *
 * Direct call to Ollama's native /api/chat endpoint.
 * Automatically prepends the CACC system prompt if no system message is present.
 *
 * @param {string|Array} messages
 * @param {object}  options
 *   @param {string}  [options.model]          Model name (default: LLAMA_CONFIG.modelName)
 *   @param {number}  [options.temperature]    Sampling temperature
 *   @param {number}  [options.maxTokens]      Maps to num_predict
 *   @param {number}  [options.timeout]        Request timeout in ms
 *   @param {object}  [options.ollamaOptions]  Raw Ollama options object (merged last)
 * @returns {Promise<string>} Generated text
 */
export async function callOllama(messages, options = {}) {
  const model   = options.model   || LLAMA_CONFIG.modelName;
  const timeout = options.timeout || TIMEOUT_MS;

  const normalized  = normalizeMessages(messages);
  const hasSystem   = normalized.some(m => m.role === 'system');
  const finalMsgs   = hasSystem
    ? normalized
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...normalized];

  // Build Ollama options — task params first, then explicit overrides
  const ollamaOpts = { ...(options.ollamaOptions || {}) };
  if (options.temperature != null) ollamaOpts.temperature = options.temperature;
  if (options.maxTokens   != null) ollamaOpts.num_predict  = options.maxTokens;

  const body = {
    model,
    messages:   finalMsgs,
    stream:     false,
    options:    ollamaOpts,
    keep_alive: OLLAMA_CONFIG.keepAlive,
  };

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const startMs = Date.now();
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama /api/chat returned ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data       = await res.json();
    const text       = data.message?.content || '';
    const durationMs = Date.now() - startMs;
    const evalCount  = data.eval_count || Math.ceil(text.length / 4);

    log.info('ollama:chat', {
      model,
      durationMs,
      tokens:    evalCount,
      tokPerSec: Math.round(evalCount / (durationMs / 1000)),
    });

    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${timeout / 1000}s (model: ${model})`);
    }
    log.error('ollama:chat-error', { model, error: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Smart routing ──────────────────────────────────────────────────────────────
/**
 * callModel(messages, taskType, options)
 *
 * Routes to the fine-tuned model based on LLAMA_CONFIG.taskRouting.
 * Throws if:
 *   - USE_FINETUNED=false
 *   - The task is routed to OpenAI (caller should use callAI() instead)
 *   - Ollama / cacc-appraiser is not available
 *
 * Callers should catch errors and fall back to callAI() for OpenAI.
 *
 * @param {string|Array} messages
 * @param {string}  [taskType='narrative_writing']
 * @param {object}  [options]  Forwarded to callOllama()
 * @returns {Promise<string>}
 */
export async function callModel(messages, taskType = 'narrative_writing', options = {}) {
  if (!LLAMA_CONFIG.useFinetuned) {
    throw new Error('Fine-tuned model disabled (USE_FINETUNED=false)');
  }

  const routedModel = LLAMA_CONFIG.taskRouting[taskType] || LLAMA_CONFIG.modelName;

  // If the task is routed to OpenAI, signal caller to use callAI() instead
  const needsOpenAI = routedModel === LLAMA_CONFIG.fallbackModel || routedModel.startsWith('gpt-');
  if (needsOpenAI) {
    throw new Error(`Task "${taskType}" is routed to OpenAI (${routedModel})`);
  }

  const available = await isOllamaAvailable();
  if (!available) {
    log.warn('ollama:unavailable', { taskType, fallback: LLAMA_CONFIG.fallbackModel });
    throw new Error(`cacc-appraiser not available in Ollama for task "${taskType}"`);
  }

  // Merge task-specific generation params from the full TASK_MODELS config
  const taskConfig = TASK_MODELS[taskType] || TASK_MODELS.default;
  const mergedOptions = {
    model:         routedModel,
    ollamaOptions: { ...taskConfig.params },
    ...options,
  };

  return callOllama(messages, mergedOptions);
}
