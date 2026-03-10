/**
 * server/agents/verificationAgent.ts
 * ------------------------------------
 * NEW ARCHITECTURE — Verification Agent for the LangGraph workflow.
 *
 * Responsibilities:
 *   - Confirm inserted text matches expected output in ACI or Real Quantum
 *   - On mismatch: retry insertion once
 *   - On second failure: log failure and stop workflow for that field
 *   - Return structured VerificationResult
 *
 * Verification strategy:
 *   1. Read the field text back from the software
 *   2. Compare against the expected text (fuzzy match, 85% similarity)
 *   3. If mismatch and retryCount < 1: trigger re-insertion
 *   4. If mismatch and retryCount >= 1: mark as failed, log, stop
 *
 * The workflow uses the result to decide:
 *   passed  → save_output node
 *   failed  → log failure, mark field as incomplete
 */
import 'dotenv/config';
import type { WorkflowState, VerificationResult, InsertionResult } from '../workflow/types.js';
/**
 * verifyInsertion — verifies that the inserted text matches the expected text.
 *
 * Determines which tool to use based on formType:
 *   - 1004, 1025, 1073, 1004c → ACI tool
 *   - commercial               → Real Quantum tool
 *
 * Returns VerificationResult with passed/failed status.
 */
export declare function verifyInsertion(state: WorkflowState): Promise<VerificationResult>;
/**
 * retryInsertion — re-inserts text after a verification failure.
 * Called by the workflow when verifyInsertion returns passed: false and retryCount === 0.
 */
export declare function retryInsertion(state: WorkflowState): Promise<InsertionResult>;
/**
 * getSoftwareForForm — determines which automation software to use for a form type.
 * ACI handles all residential forms; Real Quantum handles commercial.
 */
export declare function getSoftwareForForm(formType: string): 'aci' | 'real_quantum';
//# sourceMappingURL=verificationAgent.d.ts.map