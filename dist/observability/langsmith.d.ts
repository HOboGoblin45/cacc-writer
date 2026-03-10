/**
 * server/observability/langsmith.ts
 * ----------------------------------
 * NEW ARCHITECTURE — LangSmith tracing for workflow observability.
 *
 * Wraps every workflow node and agent call in a LangSmith trace so every
 * generation, retrieval, and insertion attempt is visible in the dashboard.
 *
 * Setup:
 *   LANGCHAIN_TRACING_V2=true
 *   LANGCHAIN_API_KEY=ls__...
 *   LANGCHAIN_PROJECT=cacc-writer   (optional — groups traces by project)
 *
 * Gracefully degrades to no-op if not configured.
 * The existing server still works without any LangSmith keys set.
 */
import 'dotenv/config';
declare const TRACING_ENABLED: boolean;
declare const LANGSMITH_PROJECT: string;
export interface TraceMetadata {
    caseId?: string;
    formType?: string;
    fieldId?: string;
    stage?: string;
    runId?: string;
    [key: string]: unknown;
}
export interface TracedRunResult<T> {
    result: T;
    runId: string | null;
    durationMs: number;
}
/**
 * wrapWithTrace — wraps an async function in a named LangSmith trace span.
 *
 * When tracing is disabled this is a zero-overhead pass-through.
 * When enabled, the function's inputs/outputs are recorded in LangSmith.
 *
 * Usage:
 *   const result = await wrapWithTrace(
 *     () => draftAgent.run(state),
 *     'draft_section',
 *     { caseId: state.caseId, fieldId: state.fieldId }
 *   );
 */
export declare function wrapWithTrace<T>(fn: () => Promise<T>, name: string, metadata?: TraceMetadata): Promise<TracedRunResult<T>>;
/**
 * createWorkflowRun — creates a top-level LangSmith run for a full workflow execution.
 * Returns a run ID string that child traces can reference.
 */
export declare function createWorkflowRun(params: {
    caseId: string;
    formType: string;
    fieldId: string;
}): Promise<string | null>;
export { TRACING_ENABLED, LANGSMITH_PROJECT };
//# sourceMappingURL=langsmith.d.ts.map