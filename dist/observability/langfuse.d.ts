/**
 * server/observability/langfuse.ts
 * ---------------------------------
 * NEW ARCHITECTURE — Langfuse observability for detailed workflow logging.
 *
 * Logs every significant event in the workflow:
 *   - Prompts sent to OpenAI (with token counts)
 *   - Retrieval results from Pinecone / local KB
 *   - Automation attempts (ACI / RQ tool calls)
 *   - Verification results (pass / fail / retry)
 *   - Final approved sections stored to KB
 *
 * Setup:
 *   LANGFUSE_PUBLIC_KEY=pk-lf-...
 *   LANGFUSE_SECRET_KEY=sk-lf-...
 *   LANGFUSE_HOST=https://cloud.langfuse.com   (optional)
 *
 * Gracefully degrades to structured console logging if not configured.
 * Every workflow run produces logs regardless of Langfuse availability.
 */
import 'dotenv/config';
declare const LANGFUSE_ENABLED: boolean;
export interface WorkflowRunLog {
    caseId: string;
    formType: string;
    fieldId: string;
    stage: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    durationMs?: number;
    success: boolean;
    error?: string;
}
export interface PromptLog {
    caseId: string;
    fieldId: string;
    formType: string;
    promptMessages: Array<{
        role: string;
        content: string;
    }>;
    response: string;
    model: string;
    durationMs: number;
    examplesUsed?: number;
}
export interface RetrievalLog {
    caseId: string;
    fieldId: string;
    formType: string;
    queryText: string;
    resultsCount: number;
    topScore?: number;
    source: 'pinecone' | 'local_kb' | 'fallback';
    durationMs: number;
}
export interface AutomationLog {
    caseId: string;
    fieldId: string;
    formType?: string;
    software: 'aci' | 'real_quantum';
    action?: 'insert' | 'verify' | 'read' | 'navigate';
    attempt?: number;
    success: boolean;
    method?: string;
    verified?: boolean;
    error?: string;
    durationMs: number;
}
/**
 * logWorkflowRun — logs a workflow stage execution.
 * Falls back to structured console logging if Langfuse is not configured.
 */
export declare function logWorkflowRun(log: WorkflowRunLog): Promise<void>;
/**
 * logPrompt — logs a prompt + response pair to Langfuse.
 * Captures the full prompt, model, response, and timing for eval datasets.
 */
export declare function logPrompt(params: PromptLog): Promise<void>;
/**
 * logRetrieval — logs a retrieval query and its results.
 */
export declare function logRetrieval(params: RetrievalLog): Promise<void>;
/**
 * logAutomation — logs an ACI or Real Quantum insertion attempt.
 */
export declare function logAutomation(params: AutomationLog): Promise<void>;
export { LANGFUSE_ENABLED };
//# sourceMappingURL=langfuse.d.ts.map