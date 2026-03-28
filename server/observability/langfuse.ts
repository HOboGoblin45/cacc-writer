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
import logger from '../logger.js';

// ── Environment ───────────────────────────────────────────────────────────────

const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY || '';
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY || '';
const LANGFUSE_HOST       = process.env.LANGFUSE_HOST       || 'https://cloud.langfuse.com';
const LANGFUSE_ENABLED    = Boolean(LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowRunLog {
  caseId:      string;
  formType:    string;
  fieldId:     string;
  stage:       string;
  input?:      Record<string, unknown>;
  output?:     Record<string, unknown>;
  durationMs?: number;
  success:     boolean;
  error?:      string;
}

export interface PromptLog {
  caseId:         string;
  fieldId:        string;
  formType:       string;
  promptMessages: Array<{ role: string; content: string }>;
  response:       string;
  model:          string;
  durationMs:     number;
  examplesUsed?:  number;
}

export interface RetrievalLog {
  caseId:       string;
  fieldId:      string;
  formType:     string;
  queryText:    string;
  resultsCount: number;
  topScore?:    number;
  source:       'pinecone' | 'local_kb' | 'fallback';
  durationMs:   number;
}

export interface AutomationLog {
  caseId:     string;
  fieldId:    string;
  formType?:  string;
  software:   'aci' | 'real_quantum';
  action?:    'insert' | 'verify' | 'read' | 'navigate';
  attempt?:   number;
  success:    boolean;
  method?:    string;
  verified?:  boolean;
  error?:     string;
  durationMs: number;
}

// ── Lazy Langfuse client ──────────────────────────────────────────────────────

let _langfuseClient: any = null;

async function getLangfuseClient(): Promise<any | null> {
  if (!LANGFUSE_ENABLED) return null;
  if (_langfuseClient) return _langfuseClient;
  try {
    const { Langfuse } = await import('langfuse');
    _langfuseClient = new Langfuse({
      publicKey: LANGFUSE_PUBLIC_KEY,
      secretKey: LANGFUSE_SECRET_KEY,
      baseUrl:   LANGFUSE_HOST,
    });
    logger.info('langfuse:init', { detail: 'Observability ENABLED', host: LANGFUSE_HOST });
    return _langfuseClient;
  } catch (err: any) {
    logger.warn('langfuse:init', { error: err.message, detail: 'Failed to initialize (non-fatal)' });
    return null;
  }
}

// ── logWorkflowRun ────────────────────────────────────────────────────────────

/**
 * logWorkflowRun — logs a workflow stage execution.
 * Falls back to structured console logging if Langfuse is not configured.
 */
export async function logWorkflowRun(log: WorkflowRunLog): Promise<void> {
  const ts = new Date().toISOString();

  // Always log structured output
  const status = log.success ? '✓' : '✗';
  logger.info('workflow:run', { status, stage: log.stage, caseId: log.caseId, fieldId: log.fieldId, durationMs: log.durationMs, error: log.error });

  const lf = await getLangfuseClient();
  if (!lf) return;

  try {
    const trace = lf.trace({
      name:     `${log.stage}:${log.fieldId}`,
      userId:   log.caseId,
      metadata: {
        formType:  log.formType,
        fieldId:   log.fieldId,
        stage:     log.stage,
        timestamp: ts,
      },
    });

    trace.span({
      name:      log.stage,
      input:     log.input  || {},
      output:    log.output || {},
      metadata:  { durationMs: log.durationMs, success: log.success, error: log.error },
      startTime: new Date(Date.now() - (log.durationMs || 0)),
      endTime:   new Date(),
    });

    await lf.flushAsync();
  } catch (err: any) {
    logger.warn('langfuse:logWorkflowRun', { error: err.message, detail: 'non-fatal' });
  }
}

// ── logPrompt ─────────────────────────────────────────────────────────────────

/**
 * logPrompt — logs a prompt + response pair to Langfuse.
 * Captures the full prompt, model, response, and timing for eval datasets.
 */
export async function logPrompt(params: PromptLog): Promise<void> {
  const lf = await getLangfuseClient();
  if (!lf) return;

  try {
    const trace = lf.trace({
      name:   `generation:${params.fieldId}`,
      userId: params.caseId,
      metadata: { formType: params.formType, fieldId: params.fieldId },
    });

    trace.generation({
      name:      'openai_completion',
      model:     params.model,
      input:     params.promptMessages,
      output:    params.response,
      metadata:  {
        durationMs:    params.durationMs,
        examplesUsed:  params.examplesUsed,
      },
    });

    await lf.flushAsync();
  } catch (err: any) {
    logger.warn('langfuse:logPrompt', { error: err.message, detail: 'non-fatal' });
  }
}

// ── logRetrieval ──────────────────────────────────────────────────────────────

/**
 * logRetrieval — logs a retrieval query and its results.
 */
export async function logRetrieval(params: RetrievalLog): Promise<void> {
  const lf = await getLangfuseClient();
  if (!lf) return;

  try {
    const trace = lf.trace({
      name:   `retrieval:${params.fieldId}`,
      userId: params.caseId,
    });

    trace.span({
      name:   'vector_retrieval',
      input:  { query: params.queryText, fieldId: params.fieldId, formType: params.formType },
      output: { resultsCount: params.resultsCount, topScore: params.topScore, source: params.source },
      metadata: { durationMs: params.durationMs },
    });

    await lf.flushAsync();
  } catch (err: any) {
    logger.warn('langfuse:logRetrieval', { error: err.message, detail: 'non-fatal' });
  }
}

// ── logAutomation ─────────────────────────────────────────────────────────────

/**
 * logAutomation — logs an ACI or Real Quantum insertion attempt.
 */
export async function logAutomation(params: AutomationLog): Promise<void> {
  const status = params.success ? '✓' : '✗';
  logger.info('automation:attempt', { status, software: params.software, fieldId: params.fieldId, attempt: params.attempt, method: params.method || 'unknown', verified: params.verified });

  const lf = await getLangfuseClient();
  if (!lf) return;

  try {
    const trace = lf.trace({
      name:   `automation:${params.fieldId}`,
      userId: params.caseId,
    });

    trace.span({
      name:   `${params.software}_insert`,
      input:  { fieldId: params.fieldId, attempt: params.attempt },
      output: { success: params.success, method: params.method, verified: params.verified },
      metadata: { durationMs: params.durationMs, error: params.error },
    });

    await lf.flushAsync();
  } catch (err: any) {
    logger.warn('langfuse:logAutomation', { error: err.message, detail: 'non-fatal' });
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { LANGFUSE_ENABLED };
