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
import log from '../logger.js';

// ── Environment ───────────────────────────────────────────────────────────────

const LANGSMITH_API_KEY  = process.env.LANGCHAIN_API_KEY      || '';
const TRACING_ENABLED    = process.env.LANGCHAIN_TRACING_V2   === 'true' && Boolean(LANGSMITH_API_KEY);
const LANGSMITH_PROJECT  = process.env.LANGCHAIN_PROJECT       || 'cacc-writer';
const LANGSMITH_ENDPOINT = process.env.LANGCHAIN_ENDPOINT      || 'https://api.smith.langchain.com';

if (TRACING_ENABLED) {
  // Set env vars that LangChain SDK reads automatically
  process.env.LANGCHAIN_TRACING_V2  = 'true';
  process.env.LANGCHAIN_API_KEY     = LANGSMITH_API_KEY;
  process.env.LANGCHAIN_PROJECT     = LANGSMITH_PROJECT;
  process.env.LANGCHAIN_ENDPOINT    = LANGSMITH_ENDPOINT;
  log.info('langsmith:init', { detail: 'Tracing ENABLED', project: LANGSMITH_PROJECT });
} else {
  log.info('langsmith:init', { detail: 'Tracing disabled. Set LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY to enable.' });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TraceMetadata {
  caseId?:    string;
  formType?:  string;
  fieldId?:   string;
  stage?:     string;
  runId?:     string;
  [key: string]: unknown;
}

export interface TracedRunResult<T> {
  result:    T;
  runId:     string | null;
  durationMs: number;
}

// ── wrapWithTrace ─────────────────────────────────────────────────────────────

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
export async function wrapWithTrace<T>(
  fn: () => Promise<T>,
  name: string,
  metadata: TraceMetadata = {}
): Promise<TracedRunResult<T>> {
  const start = Date.now();

  if (!TRACING_ENABLED) {
    const result = await fn();
    return { result, runId: null, durationMs: Date.now() - start };
  }

  // When LANGCHAIN_TRACING_V2=true, LangChain SDK auto-traces all LLM calls.
  // For non-LLM spans we create a manual trace using the RunTree API.
  try {
    const { RunTree } = await import('langsmith');
    const run = new RunTree({
      name,
      run_type: 'chain',
      project_name: LANGSMITH_PROJECT,
      extra: { metadata },
    });

    await run.postRun();

    let result: T;
    let error: Error | null = null;

    try {
      result = await fn();
      await run.end({ outputs: { result: typeof result === 'string' ? result : '[object]' } });
    } catch (err: any) {
      error = err;
      await run.end({ error: err.message });
      throw err;
    } finally {
      await run.patchRun();
    }

    return { result: result!, runId: run.id || null, durationMs: Date.now() - start };
  } catch (traceErr: any) {
    // Tracing failure must never break the workflow
    if (traceErr.message?.includes('langsmith')) {
      log.warn('langsmith:trace', { error: traceErr.message, detail: 'non-fatal' });
    }
    const result = await fn();
    return { result, runId: null, durationMs: Date.now() - start };
  }
}

// ── createWorkflowRun ─────────────────────────────────────────────────────────

/**
 * createWorkflowRun — creates a top-level LangSmith run for a full workflow execution.
 * Returns a run ID string that child traces can reference.
 */
export async function createWorkflowRun(params: {
  caseId:   string;
  formType: string;
  fieldId:  string;
}): Promise<string | null> {
  if (!TRACING_ENABLED) return null;
  try {
    const { RunTree } = await import('langsmith');
    const run = new RunTree({
      name:         `workflow:${params.formType}/${params.fieldId}`,
      run_type:     'chain',
      project_name: LANGSMITH_PROJECT,
      extra: {
        metadata: {
          caseId:   params.caseId,
          formType: params.formType,
          fieldId:  params.fieldId,
        },
      },
    });
    await run.postRun();
    return run.id || null;
  } catch (err: any) {
    log.warn('langsmith:createWorkflowRun', { error: err.message, detail: 'non-fatal' });
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { TRACING_ENABLED, LANGSMITH_PROJECT };
