/**
 * server/agents/reviewAgent.ts
 * -----------------------------
 * NEW ARCHITECTURE — Review Agent for the LangGraph workflow.
 *
 * Responsibilities:
 *   - Review draft narrative for unsupported claims
 *   - Check factual mismatch against provided facts
 *   - Verify tone consistency (professional, USPAP-conscious)
 *   - Check appraisal professionalism standards
 *   - Return corrected text with issue list
 *
 * This agent wraps the existing buildReviewMessages() from promptBuilder.js
 * so review quality is preserved while adding observability + structured output.
 *
 * The review is OPTIONAL — if it fails or is skipped, the draft text is used.
 * Critical issues cause the workflow to re-draft; minor issues are logged only.
 */

import 'dotenv/config';
import log from '../logger.js';
import { wrapWithTrace } from '../observability/langsmith.js';
import { logWorkflowRun } from '../observability/langfuse.js';
import type { WorkflowState, ReviewOutput, ReviewIssue } from '../workflow/types.js';

// ── reviewSection ─────────────────────────────────────────────────────────────

/**
 * reviewSection — runs the two-pass review on a draft narrative.
 *
 * Returns ReviewOutput with:
 *   revisedText:  corrected narrative (or original if no changes needed)
 *   issues:       list of issues found (unsupported claims, tone, USPAP, etc.)
 *   confidence:   'high' | 'medium' | 'low'
 *   changesMade:  whether the text was modified
 */
export async function reviewSection(state: WorkflowState): Promise<ReviewOutput> {
  const start = Date.now();
  const { caseId, formType, fieldId, facts, draftText } = state;

  if (!draftText || draftText.length < 20) {
    return {
      revisedText:  draftText || '',
      issues:       [{ type: 'parse_error', description: 'No draft text to review', severity: 'minor' }],
      confidence:   'low',
      changesMade:  false,
    };
  }

  const { result, durationMs } = await wrapWithTrace(
    () => _reviewSection(state),
    'review_section',
    { caseId, formType, fieldId }
  );

  await logWorkflowRun({
    caseId,
    formType,
    fieldId,
    stage:      'review_section',
    input:      { draftLength: draftText.length, fieldId },
    output:     {
      revisedLength: result.revisedText.length,
      issueCount:    result.issues.length,
      confidence:    result.confidence,
      changesMade:   result.changesMade,
    },
    durationMs: durationMs || (Date.now() - start),
    success:    true,
  });

  return result;
}

async function _reviewSection(state: WorkflowState): Promise<ReviewOutput> {
  const { formType, fieldId, facts, draftText } = state;

  // ── Build review prompt using existing pipeline ───────────────────────────
  const { buildReviewMessages } = await import('../promptBuilder.js');

  // Allow up to 30k chars for review (covers even the longest narrative sections)
  const reviewMessages = buildReviewMessages({
    draftText: draftText!.slice(0, 30000),
    facts:     facts || {},
    fieldId,
    formType,
  });

  // ── Call OpenAI ───────────────────────────────────────────────────────────
  const { callAI } = await import('../openaiClient.js');
  const rawResponse = await callAI(reviewMessages, { timeout: 60_000 });

  // ── Parse JSON response ───────────────────────────────────────────────────
  return parseReviewResponse(rawResponse, draftText!);
}

// ── parseReviewResponse ───────────────────────────────────────────────────────

/**
 * parseReviewResponse — parses the JSON response from the review agent.
 * Falls back gracefully if the response is not valid JSON.
 */
function parseReviewResponse(raw: string, originalDraft: string): ReviewOutput {
  try {
    const cleaned = raw.trim()
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '');

    // Extract JSON object
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    const issues: ReviewIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: any) => ({
          type:        normalizeIssueType(issue.type),
          description: String(issue.description || '').slice(0, 500),
          severity:    normalizeSeverity(issue.severity),
        }))
      : [];

    const revisedText = String(parsed.revisedText || originalDraft).trim();
    const confidence  = normalizeConfidence(parsed.confidence);
    const changesMade = Boolean(parsed.changesMade) || (revisedText !== originalDraft.trim());

    return { revisedText, issues, confidence, changesMade };

  } catch (err: any) {
    // JSON parse failure is non-fatal — return original draft with a warning
    log.warn('reviewAgent:parse-failed', { error: err.message });
    return {
      revisedText:  originalDraft,
      issues:       [{
        type:        'parse_error',
        description: `Review response could not be parsed: ${err.message}`,
        severity:    'minor',
      }],
      confidence:   'medium',
      changesMade:  false,
    };
  }
}

// ── hasCriticalIssues ─────────────────────────────────────────────────────────

/**
 * hasCriticalIssues — returns true if the review found critical issues.
 * Used by the workflow to decide whether to re-draft or proceed.
 */
export function hasCriticalIssues(review: ReviewOutput): boolean {
  return review.issues.some(i => i.severity === 'critical');
}

/**
 * getIssueSummary — returns a human-readable summary of review issues.
 */
export function getIssueSummary(review: ReviewOutput): string {
  if (!review.issues.length) return 'No issues found';
  const critical = review.issues.filter(i => i.severity === 'critical').length;
  const major    = review.issues.filter(i => i.severity === 'major').length;
  const minor    = review.issues.filter(i => i.severity === 'minor').length;
  const parts: string[] = [];
  if (critical) parts.push(`${critical} critical`);
  if (major)    parts.push(`${major} major`);
  if (minor)    parts.push(`${minor} minor`);
  return parts.join(', ') + ' issue(s)';
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeIssueType(raw: string): ReviewIssue['type'] {
  const valid: ReviewIssue['type'][] = [
    'unsupported_claim', 'missing_fact', 'tone', 'uspap', 'contradiction', 'parse_error',
  ];
  const s = String(raw || '').toLowerCase().replace(/[^a-z_]/g, '_');
  return valid.includes(s as ReviewIssue['type']) ? (s as ReviewIssue['type']) : 'tone';
}

function normalizeSeverity(raw: string): ReviewIssue['severity'] {
  const s = String(raw || '').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'major')    return 'major';
  return 'minor';
}

function normalizeConfidence(raw: string): ReviewOutput['confidence'] {
  const s = String(raw || '').toLowerCase();
  if (s === 'high')   return 'high';
  if (s === 'low')    return 'low';
  return 'medium';
}
