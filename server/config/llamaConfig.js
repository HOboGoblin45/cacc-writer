/**
 * server/config/llamaConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Configuration for the fine-tuned CACC Appraiser Llama model.
 *
 * Integrates with Ollama for local inference. Includes:
 *   - Ollama connection settings
 *   - Model selection per task type
 *   - Fallback chain (fine-tuned → base Llama → OpenAI/Anthropic)
 *   - Generation parameters per task type
 *   - Token limits and timeout settings
 */

// ── Simple task-routing config (used by server/ai/ollamaClient.js) ────────────
export const LLAMA_CONFIG = {
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  modelName: process.env.CACC_MODEL || 'cacc-appraiser',
  fallbackModel: process.env.OPENAI_MODEL || 'gpt-4.1',
  useFinetuned: process.env.USE_FINETUNED !== 'false',
  timeout: 120000,
  // Fine-tuned model handles narrative tasks; route data-retrieval tasks to OpenAI
  taskRouting: {
    narrative_writing:    'cacc-appraiser',
    adjustment_reasoning: 'cacc-appraiser',
    comp_selection:       'gpt-4.1',        // needs external data access
    reconciliation:       'cacc-appraiser',
    full_appraisal:       'cacc-appraiser',
    market_analysis:      'cacc-appraiser',
  },
};

// ── Ollama connection ──────────────────────────────────────────────────────────
export const OLLAMA_CONFIG = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  timeout: parseInt(process.env.OLLAMA_TIMEOUT || '120000'), // 2 minutes
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '10m',
};

// ── Model registry ─────────────────────────────────────────────────────────────
// Fine-tuned CACC model (primary)
const CACC_APPRAISER = 'cacc-appraiser';

// Fallback models (in order of preference)
const LLAMA_31_8B = 'llama3.1:8b';
const LLAMA_31_70B = 'llama3.1:70b';  // for complex tasks if available
const MISTRAL_7B = 'mistral:7b';

// ── Task type → model mapping ──────────────────────────────────────────────────
export const TASK_MODELS = {
  /**
   * narrative_writing: Write appraisal narrative sections
   * Uses fine-tuned model for voice/style accuracy
   */
  narrative_writing: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B, MISTRAL_7B],
    params: {
      temperature: 0.25,
      top_p: 0.9,
      num_ctx: 4096,
      num_predict: 512,
      repeat_penalty: 1.15,
    },
  },

  /**
   * adjustment_reasoning: Calculate and justify sales grid adjustments
   * Low temperature for consistent, defensible numbers
   */
  adjustment_reasoning: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B],
    params: {
      temperature: 0.1,
      top_p: 0.85,
      num_ctx: 2048,
      num_predict: 256,
      repeat_penalty: 1.1,
    },
  },

  /**
   * comp_selection: Rank and select comparable sales
   */
  comp_selection: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B],
    params: {
      temperature: 0.2,
      top_p: 0.9,
      num_ctx: 4096,
      num_predict: 384,
      repeat_penalty: 1.1,
    },
  },

  /**
   * reconciliation: Reconcile approach values → final opinion
   */
  reconciliation: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B],
    params: {
      temperature: 0.1,
      top_p: 0.85,
      num_ctx: 2048,
      num_predict: 256,
      repeat_penalty: 1.1,
    },
  },

  /**
   * condition_quality: Assign FNMA C/Q ratings
   */
  condition_quality: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B, MISTRAL_7B],
    params: {
      temperature: 0.1,
      top_p: 0.85,
      num_ctx: 1024,
      num_predict: 128,
      repeat_penalty: 1.1,
    },
  },

  /**
   * full_appraisal: Complete appraisal summary/outline
   * Larger context window, longer output
   */
  full_appraisal: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_70B, LLAMA_31_8B],
    params: {
      temperature: 0.2,
      top_p: 0.9,
      num_ctx: 8192,
      num_predict: 1024,
      repeat_penalty: 1.1,
    },
  },

  /**
   * Default: catch-all for unrecognized task types
   */
  default: {
    primary: CACC_APPRAISER,
    fallback: [LLAMA_31_8B],
    params: {
      temperature: 0.3,
      top_p: 0.9,
      num_ctx: 4096,
      num_predict: 512,
      repeat_penalty: 1.1,
    },
  },
};

// ── System prompt ──────────────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC), based in Illinois. You write USPAP-compliant appraisal reports in a professional, concise, data-driven style.

Writing style:
- Every sentence adds value — no filler
- Reference specific comparables by number
- Include specific data: prices, GLA, year built, condition ratings
- Use standard appraisal terminology (USPAP, FNMA, GLA, HBU, etc.)
- Condition: C1-C6 scale | Quality: Q1-Q6 scale`;

// ── Fallback configuration ─────────────────────────────────────────────────────
export const FALLBACK_CONFIG = {
  // If Ollama is unavailable, fall back to cloud providers
  cloudFallback: process.env.ENABLE_CLOUD_FALLBACK === 'true',

  // Cloud model to use as last resort (requires appropriate API key)
  cloudModel: process.env.FALLBACK_CLOUD_MODEL || 'anthropic/claude-haiku-4-5-20251001',

  // Number of retry attempts before falling back
  maxRetries: 2,

  // Delay between retries (ms)
  retryDelay: 1000,
};

// ── Health check ───────────────────────────────────────────────────────────────
export async function checkOllamaHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return { healthy: false, error: `HTTP ${response.status}` };

    const data = await response.json();
    const models = (data.models || []).map(m => m.name);
    const hasCaccModel = models.some(m => m.startsWith(CACC_APPRAISER));

    return {
      healthy: true,
      models,
      hasCaccModel,
      ollamaUrl: OLLAMA_CONFIG.baseUrl,
    };
  } catch (err) {
    return {
      healthy: false,
      error: err.name === 'AbortError' ? 'Connection timeout' : err.message,
      ollamaUrl: OLLAMA_CONFIG.baseUrl,
    };
  }
}

/**
 * Get the model config for a given task type.
 * Returns the primary model name and generation parameters.
 */
export function getModelConfig(taskType) {
  return TASK_MODELS[taskType] || TASK_MODELS.default;
}

/**
 * Resolve which model to actually use, checking Ollama availability.
 * Falls through the fallback chain.
 */
export async function resolveModel(taskType) {
  const config = getModelConfig(taskType);

  // Check if primary model is available
  const health = await checkOllamaHealth();
  if (health.healthy) {
    const availableModels = health.models || [];

    // Check primary
    if (availableModels.some(m => m.startsWith(config.primary))) {
      return { model: config.primary, params: config.params, source: 'ollama' };
    }

    // Check fallbacks
    for (const fallback of (config.fallback || [])) {
      if (availableModels.some(m => m.startsWith(fallback))) {
        return { model: fallback, params: config.params, source: 'ollama-fallback' };
      }
    }
  }

  // Cloud fallback
  if (FALLBACK_CONFIG.cloudFallback) {
    return {
      model: FALLBACK_CONFIG.cloudModel,
      params: { temperature: 0.3, max_tokens: 1024 },
      source: 'cloud-fallback',
    };
  }

  throw new Error(
    `No available model for task "${taskType}". ` +
    `Ollama status: ${health.healthy ? 'up, no matching model' : health.error}. ` +
    `Install CACC model: ollama pull ${config.primary} or enable cloud fallback.`
  );
}

export default {
  OLLAMA_CONFIG,
  TASK_MODELS,
  SYSTEM_PROMPT,
  FALLBACK_CONFIG,
  checkOllamaHealth,
  getModelConfig,
  resolveModel,
};
