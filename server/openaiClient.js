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
dotenv.config({ override: true }); // always prefer .env over system env vars
import OpenAI from 'openai';

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

if (!OPENAI_API_KEY) {
  console.warn('[openaiClient] WARNING: OPENAI_API_KEY is not set. AI calls will fail.');
}

// Single shared client instance
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/**
 * callAI(inputMessages, options)
 *
 * Wraps client.responses.create() with:
 *   - Consistent model selection
 *   - Timeout enforcement
 *   - Structured error logging
 *
 * @param {string|Array} inputMessages
 *   Either a plain string (treated as a user message) or an array of
 *   { role: 'system'|'user'|'assistant', content: string } objects.
 *
 * @param {object} options
 *   @param {string}  [options.model]    Override the default model.
 *   @param {number}  [options.timeout]  Request timeout in ms (default 120s).
 *
 * @returns {Promise<string>} The generated text.
 */
export async function callAI(inputMessages, options = {}) {
  if (!client) throw new Error('OpenAI client is not initialized. Set OPENAI_API_KEY in .env');

  const model = options.model || MODEL;
  const timeout = options.timeout || 120_000;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const response = await client.responses.create({
      model,
      input: inputMessages,
    }, { signal: ctrl.signal });

    // Extract text from the Responses API output shape
    return response.output_text
      || response.output?.[0]?.content?.[0]?.text
      || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${timeout / 1000}s`);
    }
    console.error('[openaiClient] callAI error:', err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { MODEL, client };
