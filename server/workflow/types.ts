/**
 * server/workflow/types.ts
 * -------------------------
 * NEW ARCHITECTURE — Shared type definitions for the LangGraph workflow system.
 *
 * All workflow nodes, agents, and tools import their shared types from here.
 * This avoids circular dependency issues between the workflow and its nodes.
 */

// ── Pipeline stages ───────────────────────────────────────────────────────────

export type PipelineStage =
  | 'create_case'
  | 'parse_documents'
  | 'extract_facts'
  | 'retrieve_examples'
  | 'draft_section'
  | 'review_section'
  | 'insert_section'
  | 'verify_insert'
  | 'save_output'
  | 'complete'
  | 'failed';

// ── Form types ────────────────────────────────────────────────────────────────

export type FormType = '1004' | '1025' | '1073' | '1004c' | 'commercial';

// ── Workflow state ────────────────────────────────────────────────────────────

/**
 * WorkflowState — the state object passed between LangGraph nodes.
 *
 * Each node reads from and writes to this state.
 * LangGraph merges state updates using the channel reducers defined in the graph.
 */
export interface WorkflowState {
  // ── Case identity ─────────────────────────────────────────────────────────
  caseId:    string;
  formType:  FormType;
  fieldId:   string;

  // ── Input data ────────────────────────────────────────────────────────────
  facts:           Record<string, unknown>;
  documents?:      ParsedDocumentRef[];
  locationContext?: string | null;

  // ── Retrieval ─────────────────────────────────────────────────────────────
  examples?:       ExampleRef[];

  // ── Generation ────────────────────────────────────────────────────────────
  draftText?:      string;
  reviewedText?:   string;
  finalText?:      string;

  // ── Insertion ─────────────────────────────────────────────────────────────
  insertionResult?:     InsertionResult;
  verificationResult?:  VerificationResult;
  retryCount?:          number;

  // ── Workflow control ──────────────────────────────────────────────────────
  currentStage:    PipelineStage;
  errors:          string[];
  warnings:        string[];
  startedAt:       string;
  completedAt?:    string;
  durationMs?:     number;

  // ── Metadata ──────────────────────────────────────────────────────────────
  runId?:          string | null;
  traceUrl?:       string | null;
}

// ── Supporting types ──────────────────────────────────────────────────────────

export interface ParsedDocumentRef {
  id:        string;
  filename:  string;
  fieldId:   string;
  text:      string;
  wordCount: number;
}

export interface ExampleRef {
  id:           string;
  fieldId:      string;
  formType:     string;
  text:         string;
  qualityScore: number;
  sourceType:   'approved_edit' | 'curated' | 'imported';
  score:        number;
}

export interface InsertionResult {
  success:    boolean;
  method:     string;
  verified:   boolean;
  fieldId:    string;
  fieldLabel: string;
  software:   'aci' | 'real_quantum';
  attempts:   number;
  error?:     string;
  screenshot?: string;
}

export interface VerificationResult {
  passed:         boolean;
  method:         string;
  actual_preview?: string;
  expected_preview?: string;
  error?:         string;
}

// ── Review types ──────────────────────────────────────────────────────────────

export interface ReviewIssue {
  type:        'unsupported_claim' | 'missing_fact' | 'tone' | 'uspap' | 'contradiction' | 'parse_error';
  description: string;
  severity:    'critical' | 'major' | 'minor';
}

export interface ReviewOutput {
  revisedText:  string;
  issues:       ReviewIssue[];
  confidence:   'high' | 'medium' | 'low';
  changesMade:  boolean;
}

// ── Batch workflow types ──────────────────────────────────────────────────────

export interface BatchWorkflowInput {
  caseId:    string;
  formType:  FormType;
  fieldIds:  string[];
  twoPass?:  boolean;
  facts?:    Record<string, unknown>;
}

export interface BatchWorkflowResult {
  caseId:    string;
  formType:  FormType;
  results:   Record<string, WorkflowFieldResult>;
  errors:    Record<string, string>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface WorkflowFieldResult {
  fieldId:      string;
  finalText:    string;
  draftText?:   string;
  reviewedText?: string;
  inserted:     boolean;
  verified:     boolean;
  examplesUsed: number;
  durationMs:   number;
  stage:        PipelineStage;
  error?:       string;
}

// ── Tool call types ───────────────────────────────────────────────────────────

export interface ACIInsertParams {
  fieldId:  string;
  text:     string;
  formType: FormType;
}

export interface RQInsertParams {
  fieldId:  string;
  text:     string;
  formType: FormType;
}
