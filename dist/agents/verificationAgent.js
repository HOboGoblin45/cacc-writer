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
import { logAutomation, logWorkflowRun } from '../observability/langfuse.js';
import { aciTool } from '../tools/aciTool.js';
import { realQuantumTool } from '../tools/realQuantumTool.js';
// ── verifyInsertion ───────────────────────────────────────────────────────────
/**
 * verifyInsertion — verifies that the inserted text matches the expected text.
 *
 * Determines which tool to use based on formType:
 *   - 1004, 1025, 1073, 1004c → ACI tool
 *   - commercial               → Real Quantum tool
 *
 * Returns VerificationResult with passed/failed status.
 */
export async function verifyInsertion(state) {
    const start = Date.now();
    const { caseId, formType, fieldId, finalText, reviewedText, draftText, retryCount = 0 } = state;
    const expectedText = finalText || reviewedText || draftText || '';
    if (!expectedText || expectedText.length < 10) {
        return {
            passed: false,
            method: 'skipped',
            error: 'No text to verify — draft/review/final text is empty',
        };
    }
    const software = getSoftwareForForm(formType);
    let result;
    try {
        if (software === 'aci') {
            result = await verifyWithACI(fieldId, expectedText, formType);
        }
        else {
            result = await verifyWithRQ(fieldId, expectedText, formType);
        }
    }
    catch (err) {
        result = {
            passed: false,
            method: software,
            error: err.message || 'Verification threw an exception',
        };
    }
    // Log to Langfuse
    await logAutomation({
        caseId,
        fieldId,
        formType,
        software,
        action: 'verify',
        attempt: retryCount + 1,
        success: result.passed,
        verified: result.passed,
        durationMs: Date.now() - start,
        error: result.error,
    });
    await logWorkflowRun({
        caseId,
        formType,
        fieldId,
        stage: 'verify_insert',
        input: { expectedLength: expectedText.length, retryCount, software },
        output: {
            passed: result.passed,
            actualPreview: result.actual_preview,
            expectedPreview: result.expected_preview,
        },
        durationMs: Date.now() - start,
        success: result.passed,
        error: result.error,
    });
    if (!result.passed) {
        if (retryCount === 0) {
            console.warn(`[verificationAgent] Verification FAILED for ${fieldId} — will retry insertion (attempt 1)`);
        }
        else {
            console.error(`[verificationAgent] Verification FAILED for ${fieldId} after retry — stopping workflow for this field`);
        }
    }
    else {
        console.log(`[verificationAgent] ✓ Verification PASSED for ${fieldId}`);
    }
    return result;
}
// ── retryInsertion ────────────────────────────────────────────────────────────
/**
 * retryInsertion — re-inserts text after a verification failure.
 * Called by the workflow when verifyInsertion returns passed: false and retryCount === 0.
 */
export async function retryInsertion(state) {
    const { caseId, formType, fieldId, finalText, reviewedText, draftText } = state;
    const text = finalText || reviewedText || draftText || '';
    if (!text) {
        return {
            success: false,
            method: 'retry',
            verified: false,
            fieldId,
            fieldLabel: fieldId,
            software: getSoftwareForForm(formType),
            attempts: 2,
            error: 'No text available for retry',
        };
    }
    const software = getSoftwareForForm(formType);
    console.log(`[verificationAgent] Retrying insertion for ${fieldId} (attempt 2)`);
    try {
        if (software === 'aci') {
            const result = await aciTool.insertAndVerify({ fieldId, text, formType });
            return { ...result, attempts: 2 };
        }
        else {
            const result = await realQuantumTool.insertAndVerify({ fieldId, text, formType });
            return { ...result, attempts: 2 };
        }
    }
    catch (err) {
        return {
            success: false,
            method: `${software}_retry`,
            verified: false,
            fieldId,
            fieldLabel: fieldId,
            software,
            attempts: 2,
            error: err.message || 'Retry insertion failed',
        };
    }
}
// ── Private helpers ───────────────────────────────────────────────────────────
async function verifyWithACI(fieldId, expected, formType) {
    const result = await aciTool.verifyText(fieldId, expected, formType);
    return {
        passed: result.passed || false,
        method: 'aci_read_verify',
        actual_preview: result.actual_preview,
        expected_preview: result.expected_preview,
        error: result.error,
    };
}
async function verifyWithRQ(fieldId, expected, formType) {
    const result = await realQuantumTool.verifyText(fieldId, expected, formType);
    return {
        passed: result.passed || false,
        method: 'rq_read_verify',
        actual_preview: result.actual_preview,
        expected_preview: result.expected_preview,
        error: result.error,
    };
}
/**
 * getSoftwareForForm — determines which automation software to use for a form type.
 * ACI handles all residential forms; Real Quantum handles commercial.
 */
export function getSoftwareForForm(formType) {
    return formType === 'commercial' ? 'real_quantum' : 'aci';
}
//# sourceMappingURL=verificationAgent.js.map