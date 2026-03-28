/**
 * server/ai/modelFallbackChain.js
 * ──────────────────────────────────────────────────────────────────────────
 * Multi-Model Fallback Chain
 *
 * Resilient AI provider chain that falls back through multiple providers on failure.
 *
 * Priority order (configurable):
 *   1. Fine-tuned Llama (RunPod) — cheapest, fastest, best voice
 *   2. OpenAI GPT-4.1 — highest quality fallback
 *   3. Google Gemini 2.5 Flash — cost-effective backup
 *   4. Local Ollama — offline emergency fallback
 *
 * Features:
 *   - Automatic failover on timeout, rate limit, or error
 *   - Per-provider health tracking with circuit breaker pattern
 *   - Cost tracking per provider
 *   - Configurable priority per section type
 */

import log from '../logger.js';
import { CircuitBreaker, isRetryableError } from '../utils/retryHelper.js';

// ─── Provider Configuration ──────────────────────────────────────────────

/**
 * ModelProvider class — represents a single AI provider.
 */
class ModelProvider {
  constructor(config) {
    this.name = config.name;                    // 'runpod', 'openai', 'gemini', 'ollama'
    this.endpoint = config.endpoint;            // API endpoint URL
    this.apiKey = config.apiKey;                // API key if required
    this.model = config.model;                  // Model identifier
    this.maxTokens = config.maxTokens ?? 4000;  // Output token limit
    this.timeout = config.timeout ?? 30000;     // Request timeout in ms
    this.priority = config.priority ?? 100;     // Lower = higher priority
    this.enabled = config.enabled !== false;    // Enabled by default

    // Circuit breaker: 3 consecutive failures → unhealthy for 60s
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60000,
      successThreshold: 1,
      name: `provider-${this.name}`,
    });

    // Cost tracking
    this.totalCalls = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCost = 0;
  }

  isHealthy() {
    return this.enabled && this.circuitBreaker.state !== 'OPEN';
  }

  recordCall(inputTokens, outputTokens, cost) {
    this.totalCalls++;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCost += cost;
  }

  getStats() {
    return {
      name: this.name,
      healthy: this.isHealthy(),
      circuitState: this.circuitBreaker.state,
      totalCalls: this.totalCalls,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCost: this.totalCost.toFixed(6),
      avgCost: this.totalCalls > 0 ? (this.totalCost / this.totalCalls).toFixed(6) : '0',
    };
  }
}

// ─── Fallback Chain ──────────────────────────────────────────────────────

/**
 * FallbackChain class — orchestrates multiple AI providers with automatic fallback.
 */
class FallbackChain {
  constructor(options = {}) {
    this.providers = [];
    this.defaultTimeout = options.defaultTimeout ?? 30000;
  }

  /**
   * Register a provider in the fallback chain.
   */
  addProvider(provider) {
    if (!provider || !provider.name) {
      throw new Error('Invalid provider: must have a name');
    }
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority); // Sort by priority
    log.info('fallback-chain:provider-added', {
      name: provider.name,
      priority: provider.priority,
      totalProviders: this.providers.length,
    });
  }

  /**
   * Get list of enabled providers sorted by priority.
   */
  getEnabledProviders() {
    return this.providers.filter(p => p.enabled);
  }

  /**
   * Call an AI provider through the fallback chain.
   * Tries providers in priority order, falling back on failure.
   *
   * @param {Array|string} messages - Chat messages
   * @param {object} options - Call options
   *   @param {string} [options.model] - Override model
   *   @param {number} [options.maxTokens] - Output token limit
   *   @param {number} [options.timeout] - Request timeout in ms
   *   @param {number} [options.temperature] - Sampling temperature
   *   @param {string} [options.sectionType] - For section-specific provider selection
   * @returns {Promise<string>} Generated text
   */
  async callWithFallback(messages, options = {}) {
    const enabled = this.getEnabledProviders();

    if (enabled.length === 0) {
      throw new Error('No AI providers available in fallback chain');
    }

    let lastError = null;
    const errors = [];

    for (const provider of enabled) {
      try {
        log.info('fallback-chain:attempt', {
          provider: provider.name,
          model: provider.model,
          healthy: provider.isHealthy(),
        });

        // Execute through circuit breaker
        const result = await provider.circuitBreaker.exec(async () => {
          return await this._callProvider(provider, messages, options);
        });

        log.info('fallback-chain:success', {
          provider: provider.name,
          model: provider.model,
        });

        return result;
      } catch (err) {
        lastError = err;
        errors.push({
          provider: provider.name,
          error: err.message,
          retryable: isRetryableError(err),
        });

        log.warn('fallback-chain:provider-failed', {
          provider: provider.name,
          error: err.message,
          circuitState: provider.circuitBreaker.state,
        });
      }
    }

    // All providers failed
    const errorMsg = `All AI providers failed. Tried: ${errors.map(e => e.provider).join(', ')}`;
    log.error('fallback-chain:all-failed', {
      attempts: errors.length,
      errors,
      lastError: lastError?.message,
    });

    const err = new Error(errorMsg);
    err.fallbackErrors = errors;
    throw err;
  }

  /**
   * Internal: Call a specific provider.
   */
  async _callProvider(provider, messages, options = {}) {
    if (provider.name === 'runpod') {
      return await this._callRunPod(provider, messages, options);
    } else if (provider.name === 'openai') {
      return await this._callOpenAI(provider, messages, options);
    } else if (provider.name === 'anthropic') {
      return await this._callAnthropic(provider, messages, options);
    } else if (provider.name === 'gemini') {
      return await this._callGemini(provider, messages, options);
    } else if (provider.name === 'ollama') {
      return await this._callOllama(provider, messages, options);
    }
    throw new Error(`Unknown provider: ${provider.name}`);
  }

  /**
   * Call RunPod vLLM endpoint.
   */
  async _callRunPod(provider, messages, options) {
    const payload = {
      model: options.model || provider.model,
      messages: Array.isArray(messages)
        ? messages
        : [{ role: 'user', content: messages }],
      max_tokens: options.maxTokens || provider.maxTokens,
      temperature: options.temperature ?? 0.7,
    };

    const controller = new AbortController();
    const timeout = options.timeout || provider.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${provider.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey && { 'Authorization': `Bearer ${provider.apiKey}` }),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`RunPod error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};

      // Record cost (vLLM pricing estimate)
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const cost = this._estimateRunPodCost(inputTokens, outputTokens);
      provider.recordCall(inputTokens, outputTokens, cost);

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Call OpenAI API.
   */
  async _callOpenAI(provider, messages, options) {
    const payload = {
      model: options.model || provider.model,
      messages: Array.isArray(messages)
        ? messages
        : [{ role: 'user', content: messages }],
      max_tokens: options.maxTokens || provider.maxTokens,
      temperature: options.temperature ?? 0.7,
    };

    const controller = new AbortController();
    const timeout = options.timeout || provider.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = new Error(`OpenAI error ${response.status}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};

      // Record cost
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const cost = this._estimateOpenAICost(provider.model, inputTokens, outputTokens);
      provider.recordCall(inputTokens, outputTokens, cost);

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Call Anthropic Claude API.
   */
  async _callAnthropic(provider, messages, options) {
    // Convert messages to Anthropic format
    const formattedMessages = Array.isArray(messages)
      ? messages
      : [{ role: 'user', content: messages }];

    const payload = {
      model: options.model || provider.model,
      max_tokens: options.maxTokens || provider.maxTokens,
      messages: formattedMessages,
      temperature: options.temperature ?? 0.7,
    };

    const controller = new AbortController();
    const timeout = options.timeout || provider.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = new Error(`Anthropic error ${response.status}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      const text = data.content?.[0]?.type === 'text'
        ? data.content[0].text
        : '';
      const usage = data.usage || {};

      // Record cost
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cost = this._estimateAnthropicCost(provider.model, inputTokens, outputTokens);
      provider.recordCall(inputTokens, outputTokens, cost);

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Call Google Gemini API.
   */
  async _callGemini(provider, messages, options) {
    // Convert messages to Gemini format
    const contents = Array.isArray(messages)
      ? messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      : [{ role: 'user', parts: [{ text: messages }] }];

    const payload = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || provider.maxTokens,
        temperature: options.temperature ?? 0.7,
      },
    };

    const controller = new AbortController();
    const timeout = options.timeout || provider.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const err = new Error(`Gemini error ${response.status}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const usage = data.usageMetadata || {};

      // Record cost
      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;
      const cost = this._estimateGeminiCost(inputTokens, outputTokens);
      provider.recordCall(inputTokens, outputTokens, cost);

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Call Ollama API (local).
   */
  async _callOllama(provider, messages, options) {
    const payload = {
      model: options.model || provider.model,
      messages: Array.isArray(messages)
        ? messages
        : [{ role: 'user', content: messages }],
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
      },
    };

    const controller = new AbortController();
    const timeout = options.timeout || provider.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${provider.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.message?.content || '';

      // Ollama doesn't provide token counts, estimate from text
      const inputTokens = Array.isArray(messages)
        ? messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0)
        : Math.ceil(messages.length / 4);
      const outputTokens = Math.ceil(text.length / 4);
      const cost = this._estimateOllamaCost(inputTokens, outputTokens);
      provider.recordCall(inputTokens, outputTokens, cost);

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Cost Estimation ─────────────────────────────────────────────────

  _estimateRunPodCost(inputTokens, outputTokens) {
    // vLLM on RunPod: ~$0.001 per 1K tokens (estimate)
    const rate = 0.001 / 1000;
    return (inputTokens + outputTokens) * rate;
  }

  _estimateOpenAICost(model, inputTokens, outputTokens) {
    // GPT-4.1 pricing
    if (model.includes('gpt-4.1') || model.includes('gpt-4o')) {
      return (inputTokens * 0.000005) + (outputTokens * 0.000015);
    }
    // GPT-4 turbo
    if (model.includes('gpt-4-turbo')) {
      return (inputTokens * 0.000010) + (outputTokens * 0.000030);
    }
    // GPT-4
    if (model.includes('gpt-4')) {
      return (inputTokens * 0.000030) + (outputTokens * 0.000060);
    }
    // GPT-3.5 turbo
    return (inputTokens * 0.0000005) + (outputTokens * 0.0000015);
  }

  _estimateAnthropicCost(model, inputTokens, outputTokens) {
    // Claude Sonnet 4: $3/M input, $15/M output
    if (model.includes('sonnet')) {
      return (inputTokens * 3 / 1000000) + (outputTokens * 15 / 1000000);
    }
    // Claude Opus 4: $15/M input, $75/M output
    if (model.includes('opus')) {
      return (inputTokens * 15 / 1000000) + (outputTokens * 75 / 1000000);
    }
    // Default to Sonnet pricing
    return (inputTokens * 3 / 1000000) + (outputTokens * 15 / 1000000);
  }

  _estimateGeminiCost(inputTokens, outputTokens) {
    // Gemini 2.5 Flash: $0.15/M input, $0.60/M output
    return (inputTokens * 0.15 / 1000000) + (outputTokens * 0.60 / 1000000);
  }

  _estimateOllamaCost(inputTokens, outputTokens) {
    // Local Ollama: free (self-hosted)
    return 0;
  }

  /**
   * Get health status of all providers.
   */
  getHealthReport() {
    return this.providers.map(p => ({
      name: p.name,
      model: p.model,
      healthy: p.isHealthy(),
      circuitState: p.circuitBreaker.state,
      stats: p.getStats(),
    }));
  }

  /**
   * Get cost summary.
   */
  getCostSummary() {
    const summary = {
      totalCost: 0,
      providers: {},
    };

    for (const provider of this.providers) {
      summary.providers[provider.name] = {
        calls: provider.totalCalls,
        inputTokens: provider.totalInputTokens,
        outputTokens: provider.totalOutputTokens,
        cost: provider.totalCost.toFixed(6),
      };
      summary.totalCost += provider.totalCost;
    }

    summary.totalCost = summary.totalCost.toFixed(6);
    return summary;
  }

  /**
   * Reset health for a specific provider.
   */
  resetProvider(name) {
    const provider = this.providers.find(p => p.name === name);
    if (provider) {
      provider.circuitBreaker.reset();
      log.info('fallback-chain:reset', { provider: name });
    }
  }

  /**
   * Reset all providers.
   */
  resetAll() {
    for (const provider of this.providers) {
      provider.circuitBreaker.reset();
    }
    log.info('fallback-chain:reset-all');
  }
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a default fallback chain from environment variables.
 */
export function createDefaultChain() {
  const chain = new FallbackChain();

  // RunPod (fine-tuned Llama)
  const runpodEnabled = process.env.RUNPOD_ENDPOINT && process.env.RUNPOD_API_KEY;
  if (runpodEnabled) {
    chain.addProvider(
      new ModelProvider({
        name: 'runpod',
        endpoint: process.env.RUNPOD_ENDPOINT,
        apiKey: process.env.RUNPOD_API_KEY,
        model: process.env.RUNPOD_MODEL || 'cacc-appraiser-v6',
        maxTokens: 4000,
        timeout: 10000,
        priority: 1, // Highest priority
        enabled: true,
      })
    );
  }

  // OpenAI
  const openaiEnabled = process.env.OPENAI_API_KEY;
  if (openaiEnabled) {
    chain.addProvider(
      new ModelProvider({
        name: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4.1',
        maxTokens: 4000,
        timeout: 30000,
        priority: 2,
        enabled: true,
      })
    );
  }

  // Anthropic Claude
  const anthropicEnabled = process.env.ANTHROPIC_API_KEY;
  if (anthropicEnabled) {
    chain.addProvider(
      new ModelProvider({
        name: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        maxTokens: 4000,
        timeout: 30000,
        priority: 3,
        enabled: true,
      })
    );
  }

  // Gemini
  const geminiEnabled = process.env.GEMINI_API_KEY;
  if (geminiEnabled) {
    chain.addProvider(
      new ModelProvider({
        name: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        maxTokens: 4000,
        timeout: 30000,
        priority: 4,
        enabled: true,
      })
    );
  }

  // Ollama (local)
  const ollamaEnabled = process.env.OLLAMA_URL;
  if (ollamaEnabled) {
    chain.addProvider(
      new ModelProvider({
        name: 'ollama',
        endpoint: process.env.OLLAMA_URL,
        model: process.env.OLLAMA_MODEL || 'llama2',
        maxTokens: 4000,
        timeout: 60000,
        priority: 5,
        enabled: true,
      })
    );
  }

  if (chain.getEnabledProviders().length === 0) {
    log.warn('fallback-chain:init', { warning: 'No AI providers configured. Set OPENAI_API_KEY or RUNPOD_ENDPOINT.' });
  }

  return chain;
}

export { FallbackChain, ModelProvider };
export default { FallbackChain, ModelProvider, createDefaultChain };
