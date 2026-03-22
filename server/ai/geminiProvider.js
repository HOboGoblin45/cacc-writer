/**
 * server/ai/geminiProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Gemini API provider for Appraisal Agent.
 *
 * Adds Gemini as a third AI provider alongside OpenAI and Ollama.
 * Gemini excels at:
 *   - Multimodal (photo + text) — analyze inspection photos
 *   - Document processing — native PDF understanding
 *   - Structured output — guaranteed JSON schema responses
 *   - Long context — up to 1M+ tokens for large reports
 *   - Cost — significantly cheaper than GPT-4 class models
 *
 * Set AI_PROVIDER=gemini + GEMINI_API_KEY in .env to use.
 */

import log from '../logger.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Check if Gemini is configured.
 */
export function isGeminiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

/**
 * Call Gemini API for text generation.
 * Compatible with our callAI() interface.
 *
 * @param {Array} messages — [{role, content}]
 * @param {Object} options
 * @returns {Promise<string>} generated text
 */
export async function callGemini(messages, options = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const model = options.model || GEMINI_MODEL;
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  // Convert OpenAI message format to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system')?.content;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens || 1500,
      topP: 0.95,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // Structured output (JSON schema)
  if (options.responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.responseSchema;
  }

  const startTime = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 60000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const durationMs = Date.now() - startTime;

  const usage = data.usageMetadata || {};
  log.info('gemini:response', {
    model,
    durationMs,
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  });

  return text;
}

/**
 * Analyze an image with Gemini multimodal.
 * This is the killer feature — send inspection photos and get structured analysis.
 *
 * @param {Buffer|string} imageData — base64 string or Buffer
 * @param {string} prompt — what to analyze
 * @param {Object} [options]
 * @returns {Promise<string>} analysis text
 */
export async function analyzeImage(imageData, prompt, options = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const model = options.model || 'gemini-2.5-flash';
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const base64 = Buffer.isBuffer(imageData) ? imageData.toString('base64') : imageData;
  const mimeType = options.mimeType || 'image/jpeg';

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxTokens || 1000,
    },
  };

  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  if (options.responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.responseSchema;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 60000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini vision error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Process a PDF document with Gemini.
 * Gemini natively understands PDFs — no OCR needed.
 *
 * @param {Buffer} pdfBuffer
 * @param {string} prompt
 * @param {Object} [options]
 * @returns {Promise<string>}
 */
export async function processPdf(pdfBuffer, prompt, options = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const model = options.model || 'gemini-2.5-flash';
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const base64 = pdfBuffer.toString('base64');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: options.maxTokens || 4000,
    },
  };

  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  if (options.responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.responseSchema;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 120000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini PDF error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Probe Gemini API health.
 */
export async function probeGemini() {
  if (!GEMINI_API_KEY) return { configured: false, ready: false, reason: 'GEMINI_API_KEY not set' };

  try {
    const url = `${GEMINI_BASE_URL}/models?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return { configured: true, ready: true, model: GEMINI_MODEL };
    return { configured: true, ready: false, reason: `API returned ${res.status}` };
  } catch (e) {
    return { configured: true, ready: false, reason: e.message };
  }
}

export default { callGemini, analyzeImage, processPdf, probeGemini, isGeminiConfigured };
