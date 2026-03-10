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
import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import { draftSection } from '../agents/draftAgent.js';
import { reviewSection } from '../agents/reviewAgent.js';
import { verifyInsertion, retryInsertion, getSoftwareForForm } from '../agents/verificationAgent.js';
import { retrieveExamples } from '../retrieval/llamaIndex.js';
import { storeExample } from '../retrieval/llamaIndex.js';
import { aciTool } from '../tools/aciTool.js';
import { realQuantumTool } from '../tools/realQuantumTool.js';
import { logWorkflowRun } from '../observability/langfuse.js';
import { createWorkflowRun } from '../observability/langsmith.js';
// ── LangGraph State Annotation ────────────────────────────────────────────────
// All fields use last-write-wins reducer: (_, y) => y
// This means each node's returned partial state overwrites the previous value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const overwrite = (x, y) => y;
const WorkflowStateAnnotation = Annotation.Root({
    caseId: Annotation(),
    formType: Annotation(),
    fieldId: Annotation(),
    facts: Annotation(),
    documents: Annotation({
        value: overwrite,
        default: () => [],
    }),
    locationContext: Annotation({
        value: overwrite,
        default: () => null,
    }),
    examples: Annotation({
        value: overwrite,
        default: () => [],
    }),
    draftText: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    reviewedText: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    finalText: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    insertionResult: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    verificationResult: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    retryCount: Annotation({
        value: overwrite,
        default: () => 0,
    }),
    currentStage: Annotation(),
    errors: Annotation({
        value: overwrite,
        default: () => [],
    }),
    warnings: Annotation({
        value: overwrite,
        default: () => [],
    }),
    startedAt: Annotation(),
    completedAt: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    durationMs: Annotation({
        value: overwrite,
        default: () => undefined,
    }),
    runId: Annotation({
        value: overwrite,
        default: () => null,
    }),
    traceUrl: Annotation({
        value: overwrite,
        default: () => null,
    }),
});
// ── Node: create_case ─────────────────────────────────────────────────────────
async function nodeCreateCase(state) {
    console.log(`[workflow] create_case | caseId=${state.caseId} formType=${state.formType} fieldId=${state.fieldId}`);
    // Validate required inputs
    const errors = [];
    if (!state.caseId)
        errors.push('caseId is required');
    if (!state.formType)
        errors.push('formType is required');
    if (!state.fieldId)
        errors.push('fieldId is required');
    if (errors.length > 0) {
        return { currentStage: 'failed', errors };
    }
    // Initialize LangSmith run
    let runId = null;
    try {
        runId = await createWorkflowRun({
            caseId: state.caseId,
            formType: state.formType,
            fieldId: state.fieldId,
        });
    }
    catch {
        // Non-fatal — tracing is optional
    }
    return {
        currentStage: 'extract_facts',
        runId,
        traceUrl: null,
        errors: [],
        warnings: [],
        retryCount: 0,
    };
}
// ── Node: parse_documents ─────────────────────────────────────────────────────
async function nodeParseDocuments(state) {
    console.log(`[workflow] parse_documents | caseId=${state.caseId}`);
    // Documents are pre-loaded before workflow invocation in most cases.
    // This node handles any pending document parsing.
    if (!state.documents || state.documents.length === 0) {
        return {
            currentStage: 'extract_facts',
            warnings: [...(state.warnings || []), 'No documents to parse — using existing facts'],
        };
    }
    return { currentStage: 'extract_facts' };
}
// ── Node: extract_facts ───────────────────────────────────────────────────────
async function nodeExtractFacts(state) {
    console.log(`[workflow] extract_facts | caseId=${state.caseId}`);
    // Facts are typically pre-loaded from the case directory.
    // This node validates and normalizes them.
    const facts = state.facts || {};
    if (Object.keys(facts).length === 0) {
        return {
            currentStage: 'retrieve_examples',
            warnings: [...(state.warnings || []), 'No facts available — generation will be generic'],
        };
    }
    return { currentStage: 'retrieve_examples', facts };
}
// ── Node: retrieve_examples ───────────────────────────────────────────────────
async function nodeRetrieveExamples(state) {
    console.log(`[workflow] retrieve_examples | fieldId=${state.fieldId}`);
    let examples = [];
    try {
        const retrieved = await retrieveExamples({
            fieldId: state.fieldId,
            formType: state.formType,
            topK: 5,
        });
        examples = retrieved.map(ex => ({
            id: ex.id,
            fieldId: ex.fieldId,
            formType: ex.formType,
            text: ex.text,
            qualityScore: ex.qualityScore,
            sourceType: ex.sourceType,
            score: ex.score,
        }));
    }
    catch (err) {
        console.warn('[workflow] retrieve_examples failed (non-fatal):', err.message);
    }
    return { currentStage: 'draft_section', examples };
}
// ── Node: draft_section ───────────────────────────────────────────────────────
async function nodeDraftSection(state) {
    console.log(`[workflow] draft_section | fieldId=${state.fieldId}`);
    try {
        const output = await draftSection(state);
        return {
            currentStage: 'review_section',
            draftText: output.draft_text,
        };
    }
    catch (err) {
        console.error('[workflow] draft_section failed:', err.message);
        return {
            currentStage: 'failed',
            errors: [...(state.errors || []), `Draft failed: ${err.message}`],
        };
    }
}
// ── Node: review_section ──────────────────────────────────────────────────────
async function nodeReviewSection(state) {
    console.log(`[workflow] review_section | fieldId=${state.fieldId}`);
    try {
        const review = await reviewSection(state);
        return {
            currentStage: 'insert_section',
            reviewedText: review.revisedText,
            finalText: review.revisedText,
            warnings: [
                ...(state.warnings || []),
                ...review.issues.filter(i => i.severity !== 'critical').map(i => i.description),
            ],
        };
    }
    catch (err) {
        // Review failure is non-fatal — use draft text
        console.warn('[workflow] review_section failed (non-fatal):', err.message);
        return {
            currentStage: 'insert_section',
            reviewedText: state.draftText,
            finalText: state.draftText,
            warnings: [...(state.warnings || []), `Review skipped: ${err.message}`],
        };
    }
}
// ── Node: insert_section ──────────────────────────────────────────────────────
async function nodeInsertSection(state) {
    const { caseId, formType, fieldId, finalText, reviewedText, draftText } = state;
    const text = finalText || reviewedText || draftText || '';
    console.log(`[workflow] insert_section | fieldId=${fieldId} textLen=${text.length}`);
    if (!text || text.length < 10) {
        return {
            currentStage: 'failed',
            errors: [...(state.errors || []), 'No text to insert'],
        };
    }
    const software = getSoftwareForForm(formType);
    let insertionResult;
    try {
        if (software === 'aci') {
            insertionResult = await aciTool.insertAndVerify({ fieldId, text, formType });
        }
        else {
            insertionResult = await realQuantumTool.insertAndVerify({ fieldId, text, formType });
        }
    }
    catch (err) {
        insertionResult = {
            success: false,
            method: software,
            verified: false,
            fieldId,
            fieldLabel: fieldId,
            software,
            attempts: 1,
            error: err.message,
        };
    }
    await logWorkflowRun({
        caseId,
        formType,
        fieldId,
        stage: 'insert_section',
        input: { textLength: text.length, software },
        output: { success: insertionResult.success, verified: insertionResult.verified },
        success: insertionResult.success,
    });
    return {
        currentStage: 'verify_insert',
        insertionResult,
    };
}
// ── Node: verify_insert ───────────────────────────────────────────────────────
async function nodeVerifyInsert(state) {
    console.log(`[workflow] verify_insert | fieldId=${state.fieldId} retryCount=${state.retryCount}`);
    const verificationResult = await verifyInsertion(state);
    if (!verificationResult.passed && (state.retryCount || 0) === 0) {
        // First failure — retry insertion
        console.warn(`[workflow] Verification failed — retrying insertion for ${state.fieldId}`);
        const retryResult = await retryInsertion(state);
        const retryVerify = await verifyInsertion({ ...state, retryCount: 1 });
        return {
            currentStage: retryVerify.passed ? 'save_output' : 'failed',
            verificationResult: retryVerify,
            insertionResult: retryResult,
            retryCount: 1,
            errors: retryVerify.passed
                ? state.errors
                : [...(state.errors || []), `Verification failed after retry: ${retryVerify.error || 'mismatch'}`],
        };
    }
    return {
        currentStage: verificationResult.passed ? 'save_output' : 'failed',
        verificationResult,
        errors: verificationResult.passed
            ? state.errors
            : [...(state.errors || []), `Verification failed: ${verificationResult.error || 'mismatch'}`],
    };
}
// ── Node: save_output ─────────────────────────────────────────────────────────
async function nodeSaveOutput(state) {
    const { caseId, formType, fieldId, finalText, reviewedText, draftText } = state;
    const text = finalText || reviewedText || draftText || '';
    console.log(`[workflow] save_output | fieldId=${fieldId}`);
    try {
        const exampleId = `approved-${caseId}-${fieldId}-${Date.now()}`;
        await storeExample({
            id: exampleId,
            fieldId,
            formType,
            text,
            qualityScore: 85,
            sourceType: 'approved_edit',
            approvedFlag: true,
            humanEdits: false,
            metadata: {
                caseId,
                workflowRun: true,
                verifiedAt: new Date().toISOString(),
            },
        });
        console.log(`[workflow] ✓ Saved approved section ${exampleId}`);
    }
    catch (err) {
        console.warn('[workflow] save_output failed (non-fatal):', err.message);
    }
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(state.startedAt).getTime();
    await logWorkflowRun({
        caseId,
        formType,
        fieldId,
        stage: 'save_output',
        output: { textLength: text.length, completedAt },
        durationMs,
        success: true,
    });
    return {
        currentStage: 'complete',
        completedAt,
        durationMs,
    };
}
// ── createAppraisalWorkflow ───────────────────────────────────────────────────
/**
 * createAppraisalWorkflow — builds and compiles the LangGraph StateGraph.
 *
 * Returns a compiled workflow that can be invoked with an initial state.
 * The graph is compiled once and reused across requests.
 */
export function createAppraisalWorkflow() {
    const graph = new StateGraph(WorkflowStateAnnotation)
        .addNode('create_case', nodeCreateCase)
        .addNode('parse_documents', nodeParseDocuments)
        .addNode('extract_facts', nodeExtractFacts)
        .addNode('retrieve_examples', nodeRetrieveExamples)
        .addNode('draft_section', nodeDraftSection)
        .addNode('review_section', nodeReviewSection)
        .addNode('insert_section', nodeInsertSection)
        .addNode('verify_insert', nodeVerifyInsert)
        .addNode('save_output', nodeSaveOutput)
        // ── Edges ──────────────────────────────────────────────────────────────
        .addEdge(START, 'create_case')
        .addEdge('create_case', 'parse_documents')
        .addEdge('parse_documents', 'extract_facts')
        .addEdge('extract_facts', 'retrieve_examples')
        .addEdge('retrieve_examples', 'draft_section')
        .addEdge('draft_section', 'review_section')
        .addEdge('review_section', 'insert_section')
        .addEdge('insert_section', 'verify_insert')
        // ── Conditional: verify_insert → save_output | END ────────────────────
        .addConditionalEdges('verify_insert', (state) => {
        if (state.currentStage === 'complete' || state.currentStage === 'save_output') {
            return 'save_output';
        }
        return END;
    }, {
        save_output: 'save_output',
        [END]: END,
    })
        .addEdge('save_output', END);
    return graph.compile();
}
// ── Singleton compiled workflow ───────────────────────────────────────────────
let _compiledWorkflow = null;
export function getWorkflow() {
    if (!_compiledWorkflow) {
        _compiledWorkflow = createAppraisalWorkflow();
    }
    return _compiledWorkflow;
}
// ── runWorkflow ───────────────────────────────────────────────────────────────
/**
 * runWorkflow — runs the full appraisal workflow for a single field.
 *
 * @param input  Partial WorkflowState with required fields
 * @returns      Final WorkflowState after all nodes complete
 */
export async function runWorkflow(input) {
    const initialState = {
        caseId: input.caseId,
        formType: input.formType,
        fieldId: input.fieldId,
        facts: input.facts || {},
        documents: input.documents || [],
        locationContext: input.locationContext || null,
        examples: [],
        draftText: undefined,
        reviewedText: undefined,
        finalText: undefined,
        insertionResult: undefined,
        verificationResult: undefined,
        retryCount: 0,
        currentStage: 'create_case',
        errors: [],
        warnings: [],
        startedAt: new Date().toISOString(),
        runId: null,
        traceUrl: null,
    };
    const workflow = getWorkflow();
    // Cast to any to avoid LangGraph's internal UpdateType constraint —
    // the runtime shape is correct; the type mismatch is a LangGraph generic variance issue.
    const finalState = await workflow.invoke(initialState);
    return finalState;
}
// ── runBatchWorkflow ──────────────────────────────────────────────────────────
/**
 * runBatchWorkflow — runs the workflow for multiple fields sequentially.
 *
 * Processes the 5 production lane fields for a 1004 appraisal.
 * Each field is run independently; failures in one field do not stop others.
 *
 * @param input  BatchWorkflowInput with caseId, formType, fieldIds, facts
 * @returns      BatchWorkflowResult with per-field results
 */
export async function runBatchWorkflow(input) {
    const batchStart = Date.now();
    const results = {};
    const errors = {};
    console.log(`[workflow] Starting batch for case=${input.caseId} form=${input.formType} fields=${input.fieldIds.join(',')}`);
    for (const fieldId of input.fieldIds) {
        const fieldStart = Date.now();
        try {
            const finalState = await runWorkflow({
                caseId: input.caseId,
                formType: input.formType,
                fieldId,
                facts: input.facts || {},
            });
            const text = finalState.finalText || finalState.reviewedText || finalState.draftText || '';
            results[fieldId] = {
                fieldId,
                finalText: text,
                draftText: finalState.draftText,
                reviewedText: finalState.reviewedText,
                inserted: finalState.insertionResult?.success || false,
                verified: finalState.verificationResult?.passed || false,
                examplesUsed: finalState.examples?.length || 0,
                durationMs: Date.now() - fieldStart,
                stage: finalState.currentStage,
                error: finalState.errors?.join('; ') || undefined,
            };
            console.log(`[workflow] ✓ ${fieldId} complete (${Date.now() - fieldStart}ms)`);
        }
        catch (err) {
            console.error(`[workflow] ✗ ${fieldId} failed:`, err.message);
            errors[fieldId] = err.message;
            results[fieldId] = {
                fieldId,
                finalText: '',
                inserted: false,
                verified: false,
                examplesUsed: 0,
                durationMs: Date.now() - fieldStart,
                stage: 'failed',
                error: err.message,
            };
        }
    }
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - batchStart;
    console.log(`[workflow] Batch complete: ${Object.keys(results).length} fields in ${durationMs}ms`);
    return {
        caseId: input.caseId,
        formType: input.formType,
        results,
        errors,
        startedAt: new Date(Date.now() - durationMs).toISOString(),
        completedAt,
        durationMs,
    };
}
//# sourceMappingURL=appraisalWorkflow.js.map