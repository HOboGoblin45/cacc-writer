/**
 * server/tools/aciTool.ts
 * ------------------------
 * NEW ARCHITECTURE — ACI Desktop Automation Tool.
 *
 * Wraps the existing desktop_agent/agent.py (Flask HTTP server on port 5180)
 * as a deterministic, typed tool callable by the LangGraph workflow.
 *
 * The workflow calls these methods directly — no autonomous agent behavior.
 * All decisions are made by the workflow; this tool only executes commands.
 *
 * Tool methods:
 *   openTab(tabName)              — navigate to a named tab in ACI
 *   findField(label)              — check if a field is locatable
 *   insertText(fieldId, text)     — insert text into a field
 *   readText(fieldId)             — read current text from a field
 *   verifyText(fieldId, expected) — verify inserted text matches expected
 *   health()                      — check agent availability
 *
 * Error handling:
 *   - ECONNREFUSED → agent not running (returns { ok: false, agentDown: true })
 *   - Timeout       → returns { ok: false, timeout: true }
 *   - HTTP error    → returns { ok: false, error: string }
 *
 * All methods are safe to call even if the agent is not running.
 * The workflow handles the agentDown case gracefully.
 */
import 'dotenv/config';
import type { ACIInsertParams, InsertionResult } from '../workflow/types.js';
export interface ACIToolResult {
    ok: boolean;
    agentDown?: boolean;
    timeout?: boolean;
    error?: string;
    data?: Record<string, unknown>;
}
export interface ACIHealthResult extends ACIToolResult {
    version?: string;
    pywinauto?: boolean;
    learnedTargets?: number;
}
export interface ACIInsertResult extends ACIToolResult {
    inserted?: boolean;
    verified?: boolean;
    fieldId?: string;
    method?: string;
    screenshot?: string;
}
export interface ACIReadResult extends ACIToolResult {
    text?: string;
    fieldId?: string;
}
export interface ACIVerifyResult extends ACIToolResult {
    passed?: boolean;
    actual_preview?: string;
    expected_preview?: string;
}
export declare class ACITool {
    private baseUrl;
    private timeoutMs;
    constructor(baseUrl?: string, timeoutMs?: number);
    /**
     * health — check if the ACI agent is running and ready.
     * Safe to call at any time; returns agentDown: true if not running.
     */
    health(): Promise<ACIHealthResult>;
    /**
     * openTab — navigate to a named tab in ACI (e.g. 'Subject', 'Sales Comparison').
     */
    openTab(tabName: string): Promise<ACIToolResult>;
    /**
     * findField — check if a field is locatable by the agent.
     * Dry-run: does not modify any field.
     */
    findField(label: string, formType?: string): Promise<ACIToolResult>;
    /**
     * insertText — insert text into a named field in ACI.
     * This is the primary automation action called by the workflow.
     *
     * @param fieldId   Field identifier (e.g. 'neighborhood_description')
     * @param text      Text to insert
     * @param formType  Form type (e.g. '1004')
     */
    insertText(fieldId: string, text: string, formType?: string): Promise<ACIInsertResult>;
    /**
     * readText — read the current text from a field in ACI.
     * Used by the verification step to confirm insertion.
     */
    readText(fieldId: string, formType?: string): Promise<ACIReadResult>;
    /**
     * verifyText — verify that the text in a field matches the expected value.
     * Returns passed: true if the field contains the expected text (substring match).
     */
    verifyText(fieldId: string, expected: string, formType?: string): Promise<ACIVerifyResult>;
    /**
     * insertAndVerify — convenience method: insert then immediately verify.
     * Returns a full InsertionResult for the workflow state.
     */
    insertAndVerify(params: ACIInsertParams): Promise<InsertionResult>;
    private _fetch;
    private _handleError;
}
export declare const aciTool: ACITool;
//# sourceMappingURL=aciTool.d.ts.map