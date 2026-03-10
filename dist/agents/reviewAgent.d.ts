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
import type { WorkflowState, ReviewOutput } from '../workflow/types.js';
/**
 * reviewSection — runs the two-pass review on a draft narrative.
 *
 * Returns ReviewOutput with:
 *   revisedText:  corrected narrative (or original if no changes needed)
 *   issues:       list of issues found (unsupported claims, tone, USPAP, etc.)
 *   confidence:   'high' | 'medium' | 'low'
 *   changesMade:  whether the text was modified
 */
export declare function reviewSection(state: WorkflowState): Promise<ReviewOutput>;
/**
 * hasCriticalIssues — returns true if the review found critical issues.
 * Used by the workflow to decide whether to re-draft or proceed.
 */
export declare function hasCriticalIssues(review: ReviewOutput): boolean;
/**
 * getIssueSummary — returns a human-readable summary of review issues.
 */
export declare function getIssueSummary(review: ReviewOutput): string;
//# sourceMappingURL=reviewAgent.d.ts.map