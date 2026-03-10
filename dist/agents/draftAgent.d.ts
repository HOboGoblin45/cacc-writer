/**
 * server/agents/draftAgent.ts
 * ----------------------------
 * NEW ARCHITECTURE — Draft Agent for the LangGraph workflow.
 *
 * Responsibilities:
 *   1. Retrieve similar prior appraisal examples from Pinecone / local KB
 *   2. Construct the full 6-block prompt with facts + examples
 *   3. Call OpenAI to generate the narrative section
 *   4. Return structured output with draft text + provenance
 *
 * This agent replaces the inline generation logic in cacc-writer-server.js.
 * It uses the existing buildPromptMessages() from server/promptBuilder.js
 * so prompt quality is preserved while adding observability + tracing.
 *
 * Output:
 *   draft_text:     string   — generated narrative
 *   examples_used:  array    — examples that were injected into the prompt
 *   facts_used:     object   — facts that were available during generation
 *   model_used:     string   — OpenAI model name
 *   tokens_estimate: number  — rough token estimate
 *   duration_ms:    number   — generation time
 */
import 'dotenv/config';
import { type RetrievedExample } from '../retrieval/llamaIndex.js';
import type { WorkflowState } from '../workflow/types.js';
export interface DraftOutput {
    draft_text: string;
    examples_used: RetrievedExample[];
    facts_used: Record<string, unknown>;
    model_used: string;
    tokens_estimate: number;
    duration_ms: number;
    field_id: string;
    form_type: string;
}
/**
 * draftSection — generates a narrative section draft for a given workflow state.
 *
 * Uses the existing buildPromptMessages() pipeline to ensure prompt quality
 * is identical to the legacy system while adding:
 *   - Pinecone-based semantic example retrieval
 *   - LangSmith tracing
 *   - Langfuse prompt logging
 *   - Structured output with provenance
 */
export declare function draftSection(state: WorkflowState): Promise<DraftOutput>;
//# sourceMappingURL=draftAgent.d.ts.map