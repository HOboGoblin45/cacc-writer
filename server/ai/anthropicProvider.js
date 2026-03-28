/**
 * server/ai/anthropicProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Anthropic Claude Integration for CACC Writer
 *
 * Supports Claude Sonnet (cost-efficient) and Claude Opus (high quality).
 * Features:
 *   - 200K context window for large fact blocks
 *   - Streaming response support
 *   - Retry logic with exponential backoff
 *   - Rate limiting awareness
 *   - Token usage tracking and cost estimation
 *
 * Set ANTHROPIC_API_KEY in .env to enable. Models:
 *   - claude-sonnet-4-20250514 (default, $3/$15 per 1M tokens)
 *   - claude-opus-4-0-20250115 (higher quality, $15/$75 per 1M tokens)
 */

import log from '../logger.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

const SUPPORTED_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-0-20250115',
];

// Pricing per 1M tokens (input/output)
const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-0-20250115': { input: 15, output: 75 },
};

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Check if Anthropic is configured.
 */
export function isAnthropicConfigured() {
  return Boolean(ANTHROPIC_API_KEY);
}

/**
 * Calculate cost for a given model and token counts.
 * @param {string} model
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @returns {number} cost in dollars
 */
function calculateCost(model, promptTokens, completionTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-20250514'];
  const inputCost = (promptTokens || 0) * (pricing.input / 1000000);
  const outputCost = (completionTokens || 0) * (pricing.output / 1000000);
  return inputCost + outputCost;
}

/**
 * Check if error is retryable.
 */
function isRetryableError(error) {
  const status = error.status || error.statusCode;
  if (!status) return false;
  // 429 = rate limit, 500s = server errors (retryable)
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Generate narrative text using Anthropic Claude.
 * Standard interface matching other providers.
 *
 * @param {string} prompt - The prompt/instruction for Claude
 * @param {object} options - Generation options
 *   @param {string} [options.model] - Model ID (default: ANTHROPIC_MODEL)
 *   @param {number} [options.temperature] - Sampling temperature (0-1)
 *   @param {number} [options.maxTokens] - Max output tokens (default: 4000)
 *   @param {number} [options.timeout] - Request timeout in ms (default: 120000)
 * @returns {Promise<object>} { text, usage, model, provider, latencyMs, cost }
 */
export async function generateNarrative(prompt, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const model = options.model || ANTHROPIC_MODEL;
  if (!SUPPORTED_MODELS.includes(model)) {
    throw new Error(`Unsupported Anthropic model: ${model}. Supported: ${SUPPORTED_MODELS.join(', ')}`);
  }

  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens || 4000;
  const timeout = options.timeout || 120000;

  const startTime = Date.now();
  let lastError = null;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      log.warn('anthropic:retry', {
        attempt,
        delay,
        model,
        error: lastError?.message,
      });
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${ANTHROPIC_API_URL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(`Anthropic API error ${response.status}`);
          error.status = response.status;

          let details = {};
          try {
            details = await response.json();
          } catch {
            // Can't parse error response
          }

          if (details.error?.message) {
            error.message += `: ${details.error.message}`;
          }

          throw error;
        }

        const data = await response.json();
        const latencyMs = Date.now() - startTime;

        // Extract text from response
        const text = data.content?.[0]?.type === 'text'
          ? data.content[0].text
          : '';

        if (!text) {
          throw new Error('Empty response from Anthropic API');
        }

        // Extract usage
        const usage = data.usage || {};
        const promptTokens = usage.input_tokens || 0;
        const completionTokens = usage.output_tokens || 0;
        const cost = calculateCost(model, promptTokens, completionTokens);

        log.info('anthropic:response', {
          model,
          latencyMs,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost: cost.toFixed(6),
        });

        return {
          text,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          model,
          provider: 'anthropic',
          latencyMs,
          cost,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;

      if (err.name === 'AbortError') {
        lastError = new Error(`Anthropic request timed out after ${timeout / 1000}s`);
      }

      // Check if retryable
      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        log.debug('anthropic:retrying', {
          attempt,
          status: err.status,
          error: err.message,
        });
        continue;
      }

      // Non-retryable error or max retries reached
      log.error('anthropic:call-error', {
        model,
        error: err.message,
        status: err.status,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES + 1,
      });

      throw lastError;
    }
  }

  // Should not reach here
  throw lastError || new Error('Unknown error in Anthropic API call');
}

/**
 * Generate narrative with streaming support.
 * Yields chunks of text as they arrive.
 *
 * @param {string} prompt
 * @param {object} options - Same as generateNarrative
 * @returns {AsyncGenerator<string>} Stream of text chunks
 */
export async function* generateNarrativeStream(prompt, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const model = options.model || ANTHROPIC_MODEL;
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens || 4000;
  const timeout = options.timeout || 120000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${ANTHROPIC_API_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic streaming error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') break;

        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta' && delta.text) {
              yield delta.text;
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check Anthropic API health.
 * Performs a lightweight probe to verify connectivity and authentication.
 *
 * @returns {Promise<object>} { configured, ready, reason? }
 */
export async function checkHealth() {
  if (!ANTHROPIC_API_KEY) {
    return {
      configured: false,
      ready: false,
      reason: 'ANTHROPIC_API_KEY not set',
    };
  }

  try {
    const response = await fetch(`${ANTHROPIC_API_URL}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      return {
        configured: true,
        ready: true,
        model: ANTHROPIC_MODEL,
      };
    }

    return {
      configured: true,
      ready: false,
      reason: `API returned ${response.status}`,
    };
  } catch (err) {
    return {
      configured: true,
      ready: false,
      reason: err.message,
    };
  }
}

export {
  SUPPORTED_MODELS,
  ANTHROPIC_MODEL,
};

export default {
  generateNarrative,
  generateNarrativeStream,
  checkHealth,
  isAnthropicConfigured,
  SUPPORTED_MODELS,
};
