/**
 * server/tools/realQuantumTool.ts
 * --------------------------------
 * NEW ARCHITECTURE — Real Quantum Browser Automation Tool.
 *
 * Wraps the existing real_quantum_agent/agent.py (Flask HTTP server on port 5181)
 * as a deterministic, typed tool callable by the LangGraph workflow.
 *
 * Uses BrowserBase + Playwright via the existing Python agent.
 * The workflow calls these methods directly — no autonomous agent behavior.
 *
 * Tool methods:
 *   navigateSection(sectionUrl)         — navigate to a named section
 *   resolveEditor(selector)             — check if a TinyMCE editor is ready
 *   insertText(selector, text)          — insert text into a TinyMCE field
 *   readText(selector)                  — read current text from a field
 *   verifyText(selector, text)          — verify inserted text matches expected
 *   health()                            — check agent availability
 *
 * Error handling mirrors aciTool.ts — all methods are safe to call
 * even if the agent is not running.
 */
import 'dotenv/config';
import type { RQInsertParams, InsertionResult } from '../workflow/types.js';
export interface RQToolResult {
    ok: boolean;
    agentDown?: boolean;
    timeout?: boolean;
    error?: string;
    data?: Record<string, unknown>;
}
export interface RQHealthResult extends RQToolResult {
    version?: string;
    playwright?: boolean;
    connected?: boolean;
}
export interface RQInsertResult extends RQToolResult {
    inserted?: boolean;
    verified?: boolean;
    fieldId?: string;
    selector?: string;
    screenshot?: string;
}
export interface RQReadResult extends RQToolResult {
    text?: string;
    selector?: string;
}
export interface RQVerifyResult extends RQToolResult {
    passed?: boolean;
    actual_preview?: string;
    expected_preview?: string;
}
export declare class RealQuantumTool {
    private baseUrl;
    private timeoutMs;
    constructor(baseUrl?: string, timeoutMs?: number);
    /**
     * health — check if the Real Quantum agent is running and ready.
     */
    health(): Promise<RQHealthResult>;
    /**
     * navigateSection — navigate to a named section in Real Quantum.
     * @param sectionName  Section name (e.g. 'property_data', 'reconciliation')
     */
    navigateSection(sectionName: string): Promise<RQToolResult>;
    /**
     * resolveEditor — check if a TinyMCE editor is ready for a given selector.
     * Dry-run: does not modify any field.
     */
    resolveEditor(selector: string): Promise<RQToolResult>;
    /**
     * insertText — insert text into a Real Quantum TinyMCE field.
     *
     * @param fieldId   Field identifier (e.g. 'neighborhood_description')
     * @param text      Text to insert
     * @param formType  Form type (e.g. 'commercial')
     */
    insertText(fieldId: string, text: string, formType?: string): Promise<RQInsertResult>;
    /**
     * readText — read the current text from a Real Quantum field.
     */
    readText(fieldId: string, formType?: string): Promise<RQReadResult>;
    /**
     * verifyText — verify that the text in a Real Quantum field matches expected.
     */
    verifyText(fieldId: string, expected: string, formType?: string): Promise<RQVerifyResult>;
    /**
     * insertAndVerify — convenience method: insert then immediately verify.
     * Returns a full InsertionResult for the workflow state.
     */
    insertAndVerify(params: RQInsertParams): Promise<InsertionResult>;
    private _fetch;
    private _handleError;
}
export declare const realQuantumTool: RealQuantumTool;
//# sourceMappingURL=realQuantumTool.d.ts.map