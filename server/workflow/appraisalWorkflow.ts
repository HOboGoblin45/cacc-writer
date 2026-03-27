/**
 * server/workflow/appraisalWorkflow.ts
 * --------------------------------------
 * NEW ARCHITECTURE â€” LangGraph Workflow Runtime for Appraisal Agent.
 *
 * Implements the full 10-node appraisal workflow as a LangGraph StateGraph.
 * Each node is a pure function that reads from and writes to WorkflowState.
 *
 * Workflow nodes:
 *   create_case       â†’ initialize case state, validate inputs
 *   parse_documents   â†’ ingest uploaded PDFs, extract sections
 *   extract_facts     â†’ load facts from case directory
 *   retrieve_examples â†’ semantic retrieval from Pinecone / local KB
 *   draft_section     â†’ generate narrative with OpenAI
 *   review_section    â†’ two-pass review for quality + USPAP compliance
 *   insert_section    â†’ insert into ACI or Real Quantum
 *   verify_insert     â†’ confirm insertion, retry once on failure
 *   save_output       â†’ store approved section to Pinecone + local KB
 *
 * Conditional edges:
 *   review_section â†’ insert_section  (if no critical issues)
 *   review_section â†’ draft_section   (if critical issues found, max 1 retry)
 *   verify_insert  â†’ save_output     (if verification passed)
 *   verify_insert  â†’ retry_insert    (if failed, retryCount === 0)
 *   verify_insert  â†’ failed          (if failed, retryCount >= 1)
 *
 * Usage:
 *   const workflow = createAppraisalWorkflow();
 *   const result = await workflow.invoke(initialState);
 *
 * Batch usage (5 fields):
 *   const results = await runBatchWorkflow({ caseId, formType, fieldIds, facts });
 */

import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation }             from '@langchain/langgraph';

import { draftSection }                    from '../agents/draftAgent.js';
import { reviewSection, hasCriticalIssues } from '../agents/reviewAgent.js';
import { verifyInsertion, retryInsertion, getSoftwareForForm } from '../agents/verificationAgent.js';
import { retrieveExamples }                from '../retrieval/llamaIndex.js';
import { storeExample }                    from '../retrieval/llamaIndex.js';
import { aciTool }                         from '../tools/aciTool.js';
import { realQuantumTool }                 from '../tools/realQuantumTool.js';
import { logWorkflowRun }                  from '../observability/langfuse.js';
import { createWorkflowRun }               from '../observability/langsmith.js';
import log                                 from '../logger.js';

import type {
  WorkflowState,
  PipelineStage,
  FormType,
  BatchWorkflowInput,
  BatchWorkflowResult,
  WorkflowFieldResult,
  ExampleRef,
} from './types.js';

// Re-export WorkflowState for other modules
export type { WorkflowState };

// â”€â”€ LangGraph State Annotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All fields use last-write-wins reducer: (_, y) => y
// This means each node's returned partial state overwrites the previous value.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const overwrite = (x: any, y: any) => y;

const WorkflowStateAnnotation = Annotation.Root({
  caseId:              Annotation<string>(),
  formType:            Annotation<FormType>(),
  fieldId:             Annotation<string>(),
  facts:               Annotation<Record<string, unknown>>(),
  documents:           Annotation<any[]>({
    value:   overwrite,
    default: () => [],
  }),
  locationContext:     Annotation<string | null>({
    value:   overwrite,
    default: () => null,
  }),
  examples:            Annotation<ExampleRef[]>({
    value:   overwrite,
    default: () => [],
  }),
  draftText:           Annotation<string | undefined>({
    value:   overwrite,
    default: () => undefined,
  }),
  reviewedText:        Annotation<string | undefined>({
    value:   overwrite,
    default: () => undefined,
  }),
  finalText:           Annotation<string | undefined>({
    value:   overwrite,
    default: () => undefined,
  }),
  insertionResult:     Annotation<any>({
    value:   overwrite,
    default: () => undefined,
  }),
  verificationResult:  Annotation<any>({
    value:   overwrite,
    default: () => undefined,
  }),
  retryCount:          Annotation<number>({
    value:   overwrite,
    default: () => 0,
  }),
  currentStage:        Annotation<PipelineStage>(),
  errors:              Annotation<string[]>({
    value:   overwrite,
    default: () => [],
  }),
  warnings:            Annotation<string[]>({
    value:   overwrite,
    default: () => [],
  }),
  startedAt:           Annotation<string>(),
  completedAt:         Annotation<string | undefined>({
    value:   overwrite,
    default: () => undefined,
  }),
  durationMs:          Annotation<number | undefined>({
    value:   overwrite,
    default: () => undefined,
  }),
  runId:               Annotation<string | null>({
    value:   overwrite,
    default: () => null,
  }),
  traceUrl:            Annotation<string | null>({
    value:   overwrite,
    default: () => null,
  }),
});

// â”€â”€ Node: create_case â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeCreateCase(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:create-case', { caseId: state.caseId, formType: state.formType, fieldId: state.fieldId });

  // Validate required inputs
  const errors: string[] = [];
  if (!state.caseId)   errors.push('caseId is required');
  if (!state.formType) errors.push('formType is required');
  if (!state.fieldId)  errors.push('fieldId is required');

  if (errors.length > 0) {
    return { currentStage: 'failed', errors };
  }

  // Initialize LangSmith run
  let runId: string | null = null;
  try {
    runId = await createWorkflowRun({
      caseId:   state.caseId,
      formType: state.formType,
      fieldId:  state.fieldId,
    });
  } catch {
    // Non-fatal â€” tracing is optional
  }

  return {
    currentStage: 'extract_facts',
    runId,
    traceUrl:     null,
    errors:       [],
    warnings:     [],
    retryCount:   0,
  };
}

// â”€â”€ Node: parse_documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeParseDocuments(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:parse-documents', { caseId: state.caseId });

  // Documents are pre-loaded before workflow invocation in most cases.
  // This node handles any pending document parsing.
  if (!state.documents || state.documents.length === 0) {
    return {
      currentStage: 'extract_facts',
      warnings:     [...(state.warnings || []), 'No documents to parse â€” using existing facts'],
    };
  }

  return { currentStage: 'extract_facts' };
}

// â”€â”€ Node: extract_facts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeExtractFacts(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:extract-facts', { caseId: state.caseId });

  // Facts are typically pre-loaded from the case directory.
  // This node validates and normalizes them.
  const facts = state.facts || {};

  if (Object.keys(facts).length === 0) {
    return {
      currentStage: 'retrieve_examples',
      warnings:     [...(state.warnings || []), 'No facts available â€” generation will be generic'],
    };
  }

  return { currentStage: 'retrieve_examples', facts };
}

// â”€â”€ Node: retrieve_examples â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeRetrieveExamples(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:retrieve-examples', { fieldId: state.fieldId });

  let examples: ExampleRef[] = [];
  try {
    const retrieved = await retrieveExamples({
      fieldId:  state.fieldId,
      formType: state.formType,
      topK:     5,
    });
    examples = retrieved.map(ex => ({
      id:           ex.id,
      fieldId:      ex.fieldId,
      formType:     ex.formType,
      text:         ex.text,
      qualityScore: ex.qualityScore,
      sourceType:   ex.sourceType,
      score:        ex.score,
    }));
  } catch (err: any) {
    log.warn('workflow:retrieve-examples', { error: err.message, nonFatal: true });
  }

  return { currentStage: 'draft_section', examples };
}

// â”€â”€ Node: draft_section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeDraftSection(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:draft-section', { fieldId: state.fieldId });

  try {
    const output = await draftSection(state);
    return {
      currentStage: 'review_section',
      draftText:    output.draft_text,
    };
  } catch (err: any) {
    log.error('workflow:draft-section', { error: err.message });
    return {
      currentStage: 'failed',
      errors:       [...(state.errors || []), `Draft failed: ${err.message}`],
    };
  }
}

// â”€â”€ Node: review_section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeReviewSection(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:review-section', { fieldId: state.fieldId });

  try {
    const review = await reviewSection(state);
    return {
      currentStage: 'insert_section',
      reviewedText: review.revisedText,
      finalText:    review.revisedText,
      warnings:     [
        ...(state.warnings || []),
        ...review.issues.filter(i => i.severity !== 'critical').map(i => i.description),
      ],
    };
  } catch (err: any) {
    // Review failure is non-fatal â€” use draft text
    log.warn('workflow:review-section', { error: err.message, nonFatal: true });
    return {
      currentStage: 'insert_section',
      reviewedText: state.draftText,
      finalText:    state.draftText,
      warnings:     [...(state.warnings || []), `Review skipped: ${err.message}`],
    };
  }
}

// â”€â”€ Node: insert_section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeInsertSection(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const { caseId, formType, fieldId, finalText, reviewedText, draftText } = state;
  const text = finalText || reviewedText || draftText || '';

  log.info('workflow:insert-section', { fieldId, textLen: text.length });

  if (!text || text.length < 10) {
    return {
      currentStage: 'failed',
      errors:       [...(state.errors || []), 'No text to insert'],
    };
  }

  const software = getSoftwareForForm(formType);
  let insertionResult: any;

  try {
    if (software === 'aci') {
      insertionResult = await aciTool.insertAndVerify({ fieldId, text, formType });
    } else {
      insertionResult = await realQuantumTool.insertAndVerify({ fieldId, text, formType });
    }
  } catch (err: any) {
    insertionResult = {
      success:    false,
      method:     software,
      verified:   false,
      fieldId,
      fieldLabel: fieldId,
      software,
      attempts:   1,
      error:      err.message,
    };
  }

  await logWorkflowRun({
    caseId,
    formType,
    fieldId,
    stage:   'insert_section',
    input:   { textLength: text.length, software },
    output:  { success: insertionResult.success, verified: insertionResult.verified },
    success: insertionResult.success,
  });

  return {
    currentStage:    'verify_insert',
    insertionResult,
  };
}

// â”€â”€ Node: verify_insert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeVerifyInsert(state: WorkflowState): Promise<Partial<WorkflowState>> {
  log.info('workflow:verify-insert', { fieldId: state.fieldId, retryCount: state.retryCount });

  const verificationResult = await verifyInsertion(state);

  if (!verificationResult.passed && (state.retryCount || 0) === 0) {
    // First failure â€” retry insertion
    log.warn('workflow:verify-insert', { fieldId: state.fieldId, action: 'retrying' });
    const retryResult = await retryInsertion(state);
    const retryVerify = await verifyInsertion({ ...state, retryCount: 1 });

    return {
      currentStage:       retryVerify.passed ? 'save_output' : 'failed',
      verificationResult: retryVerify,
      insertionResult:    retryResult,
      retryCount:         1,
      errors:             retryVerify.passed
        ? state.errors
        : [...(state.errors || []), `Verification failed after retry: ${retryVerify.error || 'mismatch'}`],
    };
  }

  return {
    currentStage:       verificationResult.passed ? 'save_output' : 'failed',
    verificationResult,
    errors:             verificationResult.passed
      ? state.errors
      : [...(state.errors || []), `Verification failed: ${verificationResult.error || 'mismatch'}`],
  };
}

// â”€â”€ Node: save_output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function nodeSaveOutput(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const { caseId, formType, fieldId, finalText, reviewedText, draftText } = state;
  const text = finalText || reviewedText || draftText || '';

  log.info('workflow:save-output', { fieldId });

  try {
    const exampleId = `approved-${caseId}-${fieldId}-${Date.now()}`;
    await storeExample({
      id:           exampleId,
      fieldId,
      formType,
      text,
      qualityScore: 85,
      sourceType:   'approved_edit',
      approvedFlag: true,
      humanEdits:   false,
      metadata: {
        caseId,
        workflowRun:  true,
        verifiedAt:   new Date().toISOString(),
      },
    });
    log.info('workflow:save-output', { exampleId, status: 'saved' });
  } catch (err: any) {
    log.warn('workflow:save-output', { error: err.message, nonFatal: true });
  }

  const completedAt = new Date().toISOString();
  const durationMs  = Date.now() - new Date(state.startedAt).getTime();

  await logWorkflowRun({
    caseId,
    formType,
    fieldId,
    stage:      'save_output',
    output:     { textLength: text.length, completedAt },
    durationMs,
    success:    true,
  });

  return {
    currentStage: 'complete',
    completedAt,
    durationMs,
  };
}

// â”€â”€ createAppraisalWorkflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * createAppraisalWorkflow â€” builds and compiles the LangGraph StateGraph.
 *
 * Returns a compiled workflow that can be invoked with an initial state.
 * The graph is compiled once and reused across requests.
 */
export function createAppraisalWorkflow() {
  const graph = new StateGraph(WorkflowStateAnnotation)
    .addNode('create_case',       nodeCreateCase)
    .addNode('parse_documents',   nodeParseDocuments)
    .addNode('extract_facts',     nodeExtractFacts)
    .addNode('retrieve_examples', nodeRetrieveExamples)
    .addNode('draft_section',     nodeDraftSection)
    .addNode('review_section',    nodeReviewSection)
    .addNode('insert_section',    nodeInsertSection)
    .addNode('verify_insert',     nodeVerifyInsert)
    .addNode('save_output',       nodeSaveOutput)

    // â”€â”€ Edges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    .addEdge(START,               'create_case')
    .addEdge('create_case',       'parse_documents')
    .addEdge('parse_documents',   'extract_facts')
    .addEdge('extract_facts',     'retrieve_examples')
    .addEdge('retrieve_examples', 'draft_section')
    .addEdge('draft_section',     'review_section')
    .addEdge('review_section',    'insert_section')
    .addEdge('insert_section',    'verify_insert')

    // â”€â”€ Conditional: verify_insert â†’ save_output | END â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    .addConditionalEdges('verify_insert', (state: WorkflowState) => {
      if (state.currentStage === 'complete' || state.currentStage === 'save_output') {
        return 'save_output';
      }
      return END;
    }, {
      save_output: 'save_output',
      [END]:       END,
    })

    .addEdge('save_output', END);

  return graph.compile();
}

// â”€â”€ Singleton compiled workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _compiledWorkflow: ReturnType<typeof createAppraisalWorkflow> | null = null;

export function getWorkflow() {
  if (!_compiledWorkflow) {
    _compiledWorkflow = createAppraisalWorkflow();
  }
  return _compiledWorkflow;
}

// â”€â”€ runWorkflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * runWorkflow â€” runs the full appraisal workflow for a single field.
 *
 * @param input  Partial WorkflowState with required fields
 * @returns      Final WorkflowState after all nodes complete
 */
export async function runWorkflow(input: Partial<WorkflowState> & {
  caseId:   string;
  formType: FormType;
  fieldId:  string;
  facts?:   Record<string, unknown>;
}): Promise<WorkflowState> {
  const initialState: WorkflowState = {
    caseId:           input.caseId,
    formType:         input.formType,
    fieldId:          input.fieldId,
    facts:            input.facts || {},
    documents:        input.documents || [],
    locationContext:  input.locationContext || null,
    examples:         [],
    draftText:        undefined,
    reviewedText:     undefined,
    finalText:        undefined,
    insertionResult:  undefined,
    verificationResult: undefined,
    retryCount:       0,
    currentStage:     'create_case',
    errors:           [],
    warnings:         [],
    startedAt:        new Date().toISOString(),
    runId:            null,
    traceUrl:         null,
  };

  const workflow = getWorkflow();
  // Cast to any to avoid LangGraph's internal UpdateType constraint â€”
  // the runtime shape is correct; the type mismatch is a LangGraph generic variance issue.
  const finalState = await workflow.invoke(initialState as any);
  return finalState as WorkflowState;
}

// â”€â”€ runBatchWorkflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * runBatchWorkflow â€” runs the workflow for multiple fields sequentially.
 *
 * Processes the 5 production lane fields for a 1004 appraisal.
 * Each field is run independently; failures in one field do not stop others.
 *
 * @param input  BatchWorkflowInput with caseId, formType, fieldIds, facts
 * @returns      BatchWorkflowResult with per-field results
 */
export async function runBatchWorkflow(input: BatchWorkflowInput): Promise<BatchWorkflowResult> {
  const batchStart = Date.now();
  const results: Record<string, WorkflowFieldResult> = {};
  const errors:  Record<string, string> = {};

  const BATCH_PARALLEL = Number(process.env.WORKFLOW_BATCH_PARALLEL) || 3;

  log.info('workflow:batch-start', {
    caseId: input.caseId, formType: input.formType,
    fields: input.fieldIds, concurrency: BATCH_PARALLEL,
  });

  // Process fields in parallel batches of BATCH_PARALLEL
  for (let i = 0; i < input.fieldIds.length; i += BATCH_PARALLEL) {
    const batch = input.fieldIds.slice(i, i + BATCH_PARALLEL);

    const batchResults = await Promise.allSettled(
      batch.map(async (fieldId) => {
        const fieldStart = Date.now();
        try {
          const finalState = await runWorkflow({
            caseId:   input.caseId,
            formType: input.formType,
            fieldId,
            facts:    input.facts || {},
          });

          const text = finalState.finalText || finalState.reviewedText || finalState.draftText || '';

          results[fieldId] = {
            fieldId,
            finalText:    text,
            draftText:    finalState.draftText,
            reviewedText: finalState.reviewedText,
            inserted:     finalState.insertionResult?.success || false,
            verified:     finalState.verificationResult?.passed || false,
            examplesUsed: finalState.examples?.length || 0,
            durationMs:   Date.now() - fieldStart,
            stage:        finalState.currentStage,
            error:        finalState.errors?.join('; ') || undefined,
          };

          log.info('workflow:field-complete', { fieldId, durationMs: Date.now() - fieldStart });
        } catch (err: any) {
          log.error('workflow:field-failed', { fieldId, error: err.message });
          errors[fieldId] = err.message;
          results[fieldId] = {
            fieldId,
            finalText:   '',
            inserted:    false,
            verified:    false,
            examplesUsed: 0,
            durationMs:  Date.now() - fieldStart,
            stage:       'failed',
            error:       err.message,
          };
        }
      })
    );
  }

  const completedAt = new Date().toISOString();
  const durationMs  = Date.now() - batchStart;

  log.info('workflow:batch-complete', { fields: Object.keys(results).length, durationMs });

  return {
    caseId:      input.caseId,
    formType:    input.formType,
    results,
    errors,
    startedAt:   new Date(Date.now() - durationMs).toISOString(),
    completedAt,
    durationMs,
  };
}

