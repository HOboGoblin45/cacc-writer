/**
 * server/workflow/appraisalWorkflow.ts
 * --------------------------------------
 * NEW ARCHITECTURE — LangGraph Workflow Runtime for CACC Writer.
 *
 * Implements the full 10-node appraisal workflow as a LangGraph StateGraph.
 * Each node is a pure function that reads from and writes to WorkflowState.
 *
 * Workflow nodes:
 *   create_case       → initialize case state, validate inputs
 *   parse_documents   → ingest uploaded PDFs, extract sections
 *   extract_facts     → load facts from case directory
 *   retrieve_examples → semantic retrieval from Pinecone / local KB
 *   draft_section     → generate narrative with OpenAI
 *   review_section    → two-pass review for quality + USPAP compliance
 *   insert_section    → insert into ACI or Real Quantum
 *   verify_insert     → confirm insertion, retry once on failure
 *   save_output       → store approved section to Pinecone + local KB
 *
 * Conditional edges:
 *   review_section → insert_section  (if no critical issues)
 *   review_section → draft_section   (if critical issues found, max 1 retry)
 *   verify_insert  → save_output     (if verification passed)
 *   verify_insert  → retry_insert    (if failed, retryCount === 0)
 *   verify_insert  → failed          (if failed, retryCount >= 1)
 *
 * Usage:
 *   const workflow = createAppraisalWorkflow();
 *   const result = await workflow.invoke(initialState);
 *
 * Batch usage (5 fields):
 *   const results = await runBatchWorkflow({ caseId, formType, fieldIds, facts });
 */
import 'dotenv/config';
import type { WorkflowState, PipelineStage, FormType, BatchWorkflowInput, BatchWorkflowResult, ExampleRef } from './types.js';
export type { WorkflowState };
/**
 * createAppraisalWorkflow — builds and compiles the LangGraph StateGraph.
 *
 * Returns a compiled workflow that can be invoked with an initial state.
 * The graph is compiled once and reused across requests.
 */
export declare function createAppraisalWorkflow(): import("@langchain/langgraph").CompiledStateGraph<import("@langchain/langgraph").StateType<{
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}>, import("@langchain/langgraph").UpdateType<{
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}>, "create_case" | "parse_documents" | "extract_facts" | "retrieve_examples" | "draft_section" | "review_section" | "insert_section" | "verify_insert" | "save_output" | "__start__", {
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}, {
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}, import("@langchain/langgraph").StateDefinition>;
export declare function getWorkflow(): import("@langchain/langgraph").CompiledStateGraph<import("@langchain/langgraph").StateType<{
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}>, import("@langchain/langgraph").UpdateType<{
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}>, "create_case" | "parse_documents" | "extract_facts" | "retrieve_examples" | "draft_section" | "review_section" | "insert_section" | "verify_insert" | "save_output" | "__start__", {
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}, {
    caseId: import("@langchain/langgraph").LastValue<string>;
    formType: import("@langchain/langgraph").LastValue<FormType>;
    fieldId: import("@langchain/langgraph").LastValue<string>;
    facts: import("@langchain/langgraph").LastValue<Record<string, unknown>>;
    documents: import("@langchain/langgraph").BinaryOperatorAggregate<any[], any[]>;
    locationContext: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    examples: import("@langchain/langgraph").BinaryOperatorAggregate<ExampleRef[], ExampleRef[]>;
    draftText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    reviewedText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    finalText: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    insertionResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    verificationResult: import("@langchain/langgraph").BinaryOperatorAggregate<any, any>;
    retryCount: import("@langchain/langgraph").BinaryOperatorAggregate<number, number>;
    currentStage: import("@langchain/langgraph").LastValue<PipelineStage>;
    errors: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    warnings: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    startedAt: import("@langchain/langgraph").LastValue<string>;
    completedAt: import("@langchain/langgraph").BinaryOperatorAggregate<string | undefined, string | undefined>;
    durationMs: import("@langchain/langgraph").BinaryOperatorAggregate<number | undefined, number | undefined>;
    runId: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
    traceUrl: import("@langchain/langgraph").BinaryOperatorAggregate<string | null, string | null>;
}, import("@langchain/langgraph").StateDefinition>;
/**
 * runWorkflow — runs the full appraisal workflow for a single field.
 *
 * @param input  Partial WorkflowState with required fields
 * @returns      Final WorkflowState after all nodes complete
 */
export declare function runWorkflow(input: Partial<WorkflowState> & {
    caseId: string;
    formType: FormType;
    fieldId: string;
    facts?: Record<string, unknown>;
}): Promise<WorkflowState>;
/**
 * runBatchWorkflow — runs the workflow for multiple fields sequentially.
 *
 * Processes the 5 production lane fields for a 1004 appraisal.
 * Each field is run independently; failures in one field do not stop others.
 *
 * @param input  BatchWorkflowInput with caseId, formType, fieldIds, facts
 * @returns      BatchWorkflowResult with per-field results
 */
export declare function runBatchWorkflow(input: BatchWorkflowInput): Promise<BatchWorkflowResult>;
//# sourceMappingURL=appraisalWorkflow.d.ts.map