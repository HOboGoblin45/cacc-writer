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
declare const MODEL: string;
declare const EMBEDDING_MODEL: string;
declare const TEMPERATURE: number;
export declare const chatModel: ChatOpenAI<import("@langchain/openai").ChatOpenAICallOptions>;
export declare const embeddings: OpenAIEmbeddings;
export interface CompletionMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface CompletionOptions {
    model?: string;
    temperature?: number;
    timeoutMs?: number;
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
export declare function generateCompletion(messages: CompletionMessage[], options?: CompletionOptions): Promise<string>;
export { MODEL, EMBEDDING_MODEL, TEMPERATURE };
//# sourceMappingURL=openai.d.ts.map