/**
 * server/config/openai.ts
 * -----------------------
 * NEW ARCHITECTURE — OpenAI configuration for the LangGraph workflow system.
 *
 * Provides:
 *   - chatModel: ChatOpenAI instance for LangGraph node compatibility
 *   - embeddings: OpenAIEmbeddings for Pinecone vector storage
 *   - generateCompletion(): typed wrapper for direct completions
 *
 * The existing server/openaiClient.js (callAI) is preserved for the legacy
 * server endpoints. This module is used exclusively by the new workflow system.
 */

import 'dotenv/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import log from '../logger.js';

// ── Environment ───────────────────────────────────────────────────────────────

const OPENAI_API_KEY      = process.env.OPENAI_API_KEY      || '';
const MODEL               = process.env.OPENAI_MODEL        || 'gpt-4.1';
const EMBEDDING_MODEL     = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const TEMPERATURE         = parseFloat(process.env.OPENAI_TEMPERATURE || '0.3');

if (!OPENAI_API_KEY) {
  log.warn('config:openai', { detail: 'OPENAI_API_KEY not set. AI calls will fail.' });
}

// ── LangChain-compatible ChatOpenAI instance ──────────────────────────────────
// Used by LangGraph nodes for structured message-based completions.

export const chatModel = new ChatOpenAI({
  apiKey:      OPENAI_API_KEY,
  model:       MODEL,
  temperature: TEMPERATURE,
});

// ── OpenAI Embeddings ─────────────────────────────────────────────────────────
// Used by the retrieval layer to embed narrative examples for Pinecone storage.

export const embeddings = new OpenAIEmbeddings({
  apiKey: OPENAI_API_KEY,
  model:  EMBEDDING_MODEL,
});

// ── generateCompletion ────────────────────────────────────────────────────────

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?:       string;
  temperature?: number;
  timeoutMs?:   number;
}

/**
 * generateCompletion — typed wrapper around ChatOpenAI.invoke().
 *
 * Accepts the same message array format as the legacy callAI() function
 * so new workflow nodes can use it without changing prompt structure.
 *
 * @param messages  Array of { role, content } message objects
 * @param options   Optional model/temperature/timeout overrides
 * @returns         Generated text string
 */
export async function generateCompletion(
  messages: CompletionMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Set it in .env');
  }

  const model = options.model || MODEL;
  const temperature = options.temperature ?? TEMPERATURE;

  // Use a separate instance if model/temperature differs from default
  const llm = (model === MODEL && temperature === TEMPERATURE)
    ? chatModel
    : new ChatOpenAI({ apiKey: OPENAI_API_KEY, model, temperature });

  // Convert to LangChain message format
  const lcMessages: BaseMessage[] = messages.map(m => {
    if (m.role === 'system') return new SystemMessage(m.content);
    return new HumanMessage(m.content);
  });

  const timeoutMs = options.timeoutMs || 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await llm.invoke(lcMessages, {
      signal: controller.signal,
    });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { MODEL, EMBEDDING_MODEL, TEMPERATURE };
