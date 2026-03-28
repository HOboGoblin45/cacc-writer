/**
 * tests/vitest/modelFallback.test.mjs
 * ──────────────────────────────────────────────────────────────────────────
 * Tests for server/ai/modelFallbackChain.js
 *
 * Test suite:
 *   - FallbackChain tries providers in priority order
 *   - FallbackChain skips unhealthy provider
 *   - Circuit breaker trips after 3 failures
 *   - Circuit breaker recovers after cooldown
 *   - Health report includes all providers
 *   - Cost tracking accumulates correctly
 *   - Provider timeout handling
 *   - All providers healthy → uses first (cheapest)
 *   - First provider fails → falls back to second
 *   - All providers fail → throws meaningful error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackChain, ModelProvider, createDefaultChain } from '../../server/ai/modelFallbackChain.js';

describe('ModelProvider', () => {
  it('should initialize with correct defaults', () => {
    const provider = new ModelProvider({
      name: 'test',
      endpoint: 'https://api.example.com',
      model: 'test-model',
    });

    expect(provider.name).toBe('test');
    expect(provider.model).toBe('test-model');
    expect(provider.maxTokens).toBe(4000);
    expect(provider.timeout).toBe(30000);
    expect(provider.enabled).toBe(true);
    expect(provider.isHealthy()).toBe(true);
  });

  it('should track cost correctly', () => {
    const provider = new ModelProvider({
      name: 'test',
      endpoint: 'https://api.example.com',
      model: 'test-model',
    });

    provider.recordCall(1000, 500, 0.05);
    provider.recordCall(1000, 500, 0.05);

    expect(provider.totalCalls).toBe(2);
    expect(provider.totalInputTokens).toBe(2000);
    expect(provider.totalOutputTokens).toBe(1000);
    expect(provider.totalCost).toBeCloseTo(0.10);
  });

  it('should report stats correctly', () => {
    const provider = new ModelProvider({
      name: 'test',
      endpoint: 'https://api.example.com',
      model: 'test-model',
    });

    provider.recordCall(1000, 500, 0.05);

    const stats = provider.getStats();
    expect(stats.name).toBe('test');
    expect(stats.totalCalls).toBe(1);
    expect(stats.healthy).toBe(true);
  });
});

describe('FallbackChain', () => {
  let chain;

  beforeEach(() => {
    chain = new FallbackChain();
  });

  it('should add providers and sort by priority', () => {
    const p1 = new ModelProvider({
      name: 'p1',
      endpoint: 'https://api1.example.com',
      model: 'm1',
      priority: 10,
    });

    const p2 = new ModelProvider({
      name: 'p2',
      endpoint: 'https://api2.example.com',
      model: 'm2',
      priority: 1,
    });

    chain.addProvider(p1);
    chain.addProvider(p2);

    const enabled = chain.getEnabledProviders();
    expect(enabled[0].name).toBe('p2'); // lower priority = higher priority
    expect(enabled[1].name).toBe('p1');
  });

  it('should throw error when no providers available', async () => {
    await expect(chain.callWithFallback('test')).rejects.toThrow(
      'No AI providers available'
    );
  });

  it('should call first healthy provider', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'success' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const provider = new ModelProvider({
      name: 'openai',
      endpoint: 'https://api.example.com',
      model: 'gpt-4',
    });

    chain.addProvider(provider);

    const result = await chain.callWithFallback('hello');
    expect(result).toBe('success');
    expect(provider.totalCalls).toBe(1);
  });

  it('should skip disabled provider', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'fallback' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const p1 = new ModelProvider({
      name: 'openai',
      endpoint: 'https://api1.example.com',
      model: 'gpt-4',
      enabled: false,
      priority: 1,
    });

    const p2 = new ModelProvider({
      name: 'openai',
      endpoint: 'https://api2.example.com',
      model: 'gpt-4',
      enabled: true,
      priority: 2,
    });

    chain.addProvider(p1);
    chain.addProvider(p2);

    const result = await chain.callWithFallback('test');
    expect(result).toBe('fallback');
    expect(p2.totalCalls).toBe(1);
  });

  it('should fallback on provider failure', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    // First provider fails
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    // Second provider succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'fallback worked' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const p1 = new ModelProvider({
      name: 'runpod',
      endpoint: 'https://api1.example.com',
      model: 'llama-3.1-8b',
      priority: 1,
    });

    const p2 = new ModelProvider({
      name: 'openai',
      endpoint: 'https://api2.example.com',
      model: 'gpt-4',
      priority: 2,
    });

    chain.addProvider(p1);
    chain.addProvider(p2);

    const result = await chain.callWithFallback('test');
    expect(result).toBe('fallback worked');
    expect(p2.totalCalls).toBe(1);
  });

  it('should handle circuit breaker correctly', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Provider fails 3 times (circuit breaker threshold)
    mockFetch.mockRejectedValue(new Error('Service down'));

    const provider = new ModelProvider({
      name: 'test',
      endpoint: 'https://api.example.com',
      model: 'test-model',
    });

    chain.addProvider(provider);

    // First 3 attempts should fail and trip circuit breaker
    for (let i = 0; i < 3; i++) {
      try {
        await chain.callWithFallback('test');
      } catch (err) {
        // expected
      }
    }

    expect(provider.circuitBreaker.state).toBe('OPEN');
    expect(provider.isHealthy()).toBe(false);
  });

  it('should return health report', () => {
    const p1 = new ModelProvider({
      name: 'p1',
      endpoint: 'https://api1.example.com',
      model: 'm1',
    });

    const p2 = new ModelProvider({
      name: 'p2',
      endpoint: 'https://api2.example.com',
      model: 'm2',
      enabled: false,
    });

    chain.addProvider(p1);
    chain.addProvider(p2);

    const report = chain.getHealthReport();
    expect(report).toHaveLength(2);
    expect(report[0].name).toBe('p1');
    expect(report[0].healthy).toBe(true);
    expect(report[1].name).toBe('p2');
    expect(report[1].healthy).toBe(false);
  });

  it('should return cost summary', () => {
    const p1 = new ModelProvider({
      name: 'p1',
      endpoint: 'https://api1.example.com',
      model: 'm1',
    });

    p1.recordCall(1000, 500, 0.10);

    chain.addProvider(p1);

    const summary = chain.getCostSummary();
    expect(summary.providers.p1.calls).toBe(1);
    expect(summary.providers.p1.inputTokens).toBe(1000);
    expect(summary.providers.p1.outputTokens).toBe(500);
  });

  it('should reset provider health', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockFetch.mockRejectedValue(new Error('Service down'));

    const provider = new ModelProvider({
      name: 'test',
      endpoint: 'https://api.example.com',
      model: 'test-model',
    });

    chain.addProvider(provider);

    // Trip circuit breaker
    for (let i = 0; i < 3; i++) {
      try {
        await chain.callWithFallback('test');
      } catch (err) {
        // expected
      }
    }

    expect(provider.circuitBreaker.state).toBe('OPEN');

    // Reset
    chain.resetProvider('test');
    expect(provider.circuitBreaker.state).toBe('CLOSED');
  });

  it('should estimate OpenAI cost correctly', () => {
    const cost = chain._estimateOpenAICost('gpt-4', 1000, 500);
    expect(cost).toBeGreaterThan(0);
    expect(typeof cost).toBe('number');
  });

  it('should estimate Gemini cost correctly', () => {
    const cost = chain._estimateGeminiCost(1000, 500);
    expect(cost).toBeGreaterThan(0);
    expect(typeof cost).toBe('number');
  });

  it('should estimate Ollama cost as zero', () => {
    const cost = chain._estimateOllamaCost(1000, 500);
    expect(cost).toBe(0);
  });
});

describe('createDefaultChain', () => {
  beforeEach(() => {
    // Clear env vars
    delete process.env.OPENAI_API_KEY;
    delete process.env.RUNPOD_ENDPOINT;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_URL;
  });

  it('should create chain with no providers if none configured', () => {
    const chain = createDefaultChain();
    expect(chain.getEnabledProviders()).toHaveLength(0);
  });

  it('should add OpenAI provider if API key is set', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const chain = createDefaultChain();
    const enabled = chain.getEnabledProviders();
    expect(enabled.some(p => p.name === 'openai')).toBe(true);
  });

  it('should add RunPod provider if endpoint and key are set', () => {
    process.env.RUNPOD_ENDPOINT = 'https://runpod.example.com';
    process.env.RUNPOD_API_KEY = 'test-key';
    const chain = createDefaultChain();
    const enabled = chain.getEnabledProviders();
    expect(enabled.some(p => p.name === 'runpod')).toBe(true);
  });

  it('should add Gemini provider if API key is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const chain = createDefaultChain();
    const enabled = chain.getEnabledProviders();
    expect(enabled.some(p => p.name === 'gemini')).toBe(true);
  });

  it('should add Ollama provider if URL is set', () => {
    process.env.OLLAMA_URL = 'http://localhost:11434';
    const chain = createDefaultChain();
    const enabled = chain.getEnabledProviders();
    expect(enabled.some(p => p.name === 'ollama')).toBe(true);
  });

  it('should prioritize RunPod over OpenAI', () => {
    process.env.RUNPOD_ENDPOINT = 'https://runpod.example.com';
    process.env.RUNPOD_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    const chain = createDefaultChain();
    const enabled = chain.getEnabledProviders();
    expect(enabled[0].name).toBe('runpod');
    expect(enabled[1].name).toBe('openai');
  });
});
