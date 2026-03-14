/**
 * openaiClient.js
 * ---------------
 * Singleton OpenAI client for the CACC Writer server module.
 *
 * Why a singleton?
 *   The OpenAI SDK initializes an HTTP connection pool on construction.
 *   Creating one instance at startup and reusing it across all requests
 *   avoids repeated TLS handshakes and keeps memory usage flat.
 *
 * How to extend:
 *   - To switch models per request, pass `model` as a parameter to callAI()
 *     rather than reading from the environment each time.
 *   - To add streaming support, replace responses.create() with
 *     responses.stream() and pipe the result to the Express response.
 */

import dotenv from 'dotenv';
dotenv.config(); // environment variables passed by runtime should take precedence
import OpenAI from 'openai';
import log from './logger.js';

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_AUTH_PROBE_TTL_MS = Number(process.env.OPENAI_AUTH_PROBE_TTL_MS) || 30_000;

// Retry configuration
const DEFAULT_MAX_RETRIES = 2;        // 1 original + 2 retries = 3 total attempts
const RETRY_BASE_DELAY_MS = 1000;     // 1s, 2s, 4s exponential backoff
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

if (!OPENAI_API_KEY) {
  log.warn('openai:init', { error: 'OPENAI_API_KEY is not set. AI calls will fail.' });
}

// Single shared client instance
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
let _openAIAuthProbeCache = null;

// ── Concurrency limiter ─────────────────────────────────────────────────────
// Prevents flooding OpenAI with too many parallel requests (avoids 429 errors)
const MAX_CONCURRENT = Number(process.env.OPENAI_MAX_CONCURRENT) || 8;
let _activeRequests = 0;
const _queue = [];

function acquireSlot() {
  if (_activeRequests < MAX_CONCURRENT) {
    _activeRequests++;
    return Promise.resolve();
  }
  return new Promise(resolve => _queue.push(resolve));
}

function releaseSlot() {
  if (_queue.length > 0) {
    const next = _queue.shift();
    next(); // hand the slot to the next waiter
  } else {
    _activeRequests--;
  }
}

function buildAuthProbeResult({ configured, ready, reason = null, checkedAt = new Date().toISOString() }) {
  return {
    configured,
    ready,
    reason,
    model: MODEL,
    checkedAt,
  };
}

async function performOpenAIAuthProbe({
  fetchImpl = fetch,
  apiKey = OPENAI_API_KEY,
  timeoutMs = 4000,
} = {}) {
  if (!apiKey) {
    return buildAuthProbeResult({
      configured: false,
      ready: false,
      reason: 'OPENAI_API_KEY is not set',
    });
  }

  const response = await fetchImpl('https://api.openai.com/v1/models?limit=1', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.ok) {
    return buildAuthProbeResult({
      configured: true,
      ready: true,
    });
  }

  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || '';
  } catch {
    detail = await response.text().catch(() => '');
  }

  let reason = `OpenAI auth probe failed with status ${response.status}`;
  if (response.status === 401) reason = 'OpenAI API key is invalid or unauthorized';
  else if (response.status === 429) reason = 'OpenAI auth probe was rate limited';
  else if (detail) reason = `${reason}: ${detail}`;

  return buildAuthProbeResult({
    configured: true,
    ready: false,
    reason,
  });
}

export async function probeOpenAIAuth({
  forceRefresh = false,
  timeoutMs = 4000,
  fetchImpl = null,
} = {}) {
  const now = Date.now();
  if (!forceRefresh && !fetchImpl && _openAIAuthProbeCache && (now - _openAIAuthProbeCache.cachedAtMs) < OPENAI_AUTH_PROBE_TTL_MS) {
    return { ..._openAIAuthProbeCache.result };
  }

  let result;
  try {
    result = await performOpenAIAuthProbe({
      fetchImpl: fetchImpl || fetch,
      timeoutMs,
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    result = buildAuthProbeResult({
      configured: Boolean(OPENAI_API_KEY),
      ready: false,
      reason: timeout ? 'OpenAI auth probe timed out' : `OpenAI auth probe failed: ${err.message}`,
    });
  }

  if (!fetchImpl) {
    _openAIAuthProbeCache = {
      cachedAtMs: now,
      result,
    };
  }
  return result;
}

/**
 * callAI(inputMessages, options)
 *
 * Wraps client.responses.create() with:
 *   - Consistent model selection
 *   - Timeout enforcement
 *   - Retry with exponential backoff for transient errors (429, 5xx)
 *   - Concurrency limiting (max 5 parallel requests by default)
 *   - Structured error logging
 *
 * @param {string|Array} inputMessages
 *   Either a plain string (treated as a user message) or an array of
 *   { role: 'system'|'user'|'assistant', content: string } objects.
 *
 * @param {object} options
 *   @param {string}  [options.model]       Override the default model.
 *   @param {number}  [options.timeout]     Request timeout in ms (default 120s).
 *   @param {number}  [options.temperature] Sampling temperature (0–2, default model default).
 *   @param {number}  [options.maxTokens]   Max output tokens (maps to max_output_tokens).
 *   @param {number}  [options.maxRetries]  Max retry attempts (default 2).
 *
 * @returns {Promise<string>} The generated text.
 */
export async function callAI(inputMessages, options = {}) {
  if (!client) throw new Error('OpenAI client is not initialized. Set OPENAI_API_KEY in .env');

  const model      = options.model      || MODEL;
  const timeout    = options.timeout    || 120_000;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  // Build API call params — only include optional fields if explicitly provided
  const apiParams = { model, input: inputMessages };
  if (options.temperature != null) apiParams.temperature       = options.temperature;
  if (options.maxTokens   != null) apiParams.max_output_tokens = options.maxTokens;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log.warn('openai:retry', { attempt, delay, model, error: lastError?.message });
      await new Promise(r => setTimeout(r, delay));
    }

    // Wait for a concurrency slot
    await acquireSlot();

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const response = await client.responses.create(
        apiParams,
        { signal: ctrl.signal }
      );

      // Extract text from the Responses API output shape
      return response.output_text
        || response.output?.[0]?.content?.[0]?.text
        || '';
    } catch (err) {
      lastError = err;

      if (err.name === 'AbortError') {
        lastError = new Error(`OpenAI request timed out after ${timeout / 1000}s`);
        // Timeouts are retryable
        if (attempt < maxRetries) continue;
        throw lastError;
      }

      // Check if this is a retryable HTTP error
      const status = err.status || err.statusCode;
      if (status && RETRYABLE_STATUS_CODES.has(status) && attempt < maxRetries) {
        continue; // retry
      }

      // Non-retryable error — log and throw immediately
      log.error('openai:call-error', { model, error: err.message, status });
      throw err;
    } finally {
      clearTimeout(timer);
      releaseSlot();
    }
  }

  // All retries exhausted
  log.error('openai:retries-exhausted', { model, attempts: maxRetries + 1, error: lastError?.message });
  throw lastError;
}

/**
 * estimateTokens(messages)
 * Rough token estimate for an array of chat messages.
 * Uses ~4 chars per token heuristic, plus per-message overhead.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number} estimated token count
 */
export function estimateTokens(messages) {
  if (typeof messages === 'string') {
    return Math.ceil(messages.length / 4) + 4;
  }
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += 4; // per-message overhead (role, separators)
    total += Math.ceil((m.content || '').length / 4);
  }
  return total + 2; // reply priming
}

/**
 * getContextWindowLimit(model)
 * Returns the approximate context window size for the given model.
 *
 * @param {string} [model]
 * @returns {number} token limit
 */
export function getContextWindowLimit(model) {
  const m = (model || MODEL).toLowerCase();
  if (m.includes('gpt-4.1'))     return 1_000_000;
  if (m.includes('gpt-4o'))      return 128_000;
  if (m.includes('gpt-4-turbo')) return 128_000;
  if (m.includes('gpt-4'))       return 128_000;
  if (m.includes('gpt-3.5'))     return 16_385;
  if (m.includes('o1') || m.includes('o3') || m.includes('o4')) return 200_000;
  return 128_000; // safe default
}

export { MODEL, client };
