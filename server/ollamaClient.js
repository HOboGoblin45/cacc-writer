/**
 * ollamaClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Local LLM client using Ollama's OpenAI-compatible API.
 *
 * Drop-in replacement for callAI() when AI_PROVIDER=ollama is set.
 * Ollama exposes /v1/chat/completions on localhost:11434.
 *
 * Supports:
 *   - Any model pulled via `ollama pull <model>`
 *   - Streaming (future)
 *   - Custom temperature, max tokens
 *   - Concurrency limiting (local GPU is single-threaded for inference)
 */

import log from './logger.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_K_M';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 180_000; // 3 min default (local is slower)

// Local GPU = one inference at a time is optimal. Queue requests.
let _active = 0;
const _queue = [];
const MAX_CONCURRENT = 1; // GPU processes one request at a time

function acquireSlot() {
  if (_active < MAX_CONCURRENT) { _active++; return Promise.resolve(); }
  return new Promise(resolve => _queue.push(resolve));
}

function releaseSlot() {
  if (_queue.length > 0) { _queue.shift()(); }
  else { _active--; }
}

/**
 * Convert from the OpenAI "input" format (Responses API) to standard
 * chat completions messages format that Ollama expects.
 *
 * callAI passes either:
 *   - A string (user message)
 *   - An array of { role, content } objects (standard chat format)
 *   - Responses API "input" array with nested content blocks
 *
 * @param {string|Array} input
 * @returns {Array<{role: string, content: string}>}
 */
function normalizeMessages(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  if (!Array.isArray(input)) {
    return [{ role: 'user', content: String(input) }];
  }

  return input.map(msg => {
    // Standard { role, content } format
    if (typeof msg.content === 'string') {
      return { role: msg.role || 'user', content: msg.content };
    }

    // Responses API nested content blocks
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter(block => block.type === 'text' || typeof block === 'string')
        .map(block => typeof block === 'string' ? block : block.text || '')
        .join('\n');
      return { role: msg.role || 'user', content: text };
    }

    // Fallback
    return { role: msg.role || 'user', content: String(msg.content || '') };
  });
}

/**
 * callOllama(inputMessages, options)
 *
 * Same signature as callAI() — drop-in replacement.
 *
 * @param {string|Array} inputMessages
 * @param {object} options
 * @returns {Promise<string>} Generated text
 */
export async function callOllama(inputMessages, options = {}) {
  const model = options.model || OLLAMA_MODEL;
  const timeout = options.timeout || OLLAMA_TIMEOUT_MS;
  const messages = normalizeMessages(inputMessages);

  const body = {
    model,
    messages,
    stream: false,
    options: {},
  };

  if (options.temperature != null) body.options.temperature = options.temperature;
  if (options.maxTokens != null) body.options.num_predict = options.maxTokens;

  await acquireSlot();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const startMs = Date.now();

    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama returned ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const durationMs = Date.now() - startMs;
    const tokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);

    log.info('ollama:response', {
      model,
      durationMs,
      tokens,
      tokPerSec: Math.round(tokens / (durationMs / 1000)),
      chars: text.length,
    });

    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${timeout / 1000}s`);
    }
    log.error('ollama:error', { model, error: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
    releaseSlot();
  }
}

/**
 * Check if Ollama is running and the model is available.
 */
export async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ready: false, reason: `Ollama returned ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model);
    const hasModel = models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]));
    return {
      ready: true,
      models,
      activeModel: OLLAMA_MODEL,
      modelAvailable: hasModel,
    };
  } catch (err) {
    return { ready: false, reason: err.message };
  }
}

export { OLLAMA_MODEL, OLLAMA_BASE_URL };
