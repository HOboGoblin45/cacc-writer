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
import { logAutomation } from '../observability/langfuse.js';
// ── Config ────────────────────────────────────────────────────────────────────
const ACI_AGENT_URL = process.env.ACI_AGENT_URL || 'http://localhost:5180';
const ACI_TIMEOUT_MS = Number(process.env.ACI_TIMEOUT_MS) || 20_000;
// ── ACITool class ─────────────────────────────────────────────────────────────
export class ACITool {
    baseUrl;
    timeoutMs;
    constructor(baseUrl = ACI_AGENT_URL, timeoutMs = ACI_TIMEOUT_MS) {
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
    }
    // ── health ──────────────────────────────────────────────────────────────────
    /**
     * health — check if the ACI agent is running and ready.
     * Safe to call at any time; returns agentDown: true if not running.
     */
    async health() {
        try {
            const res = await this._fetch('/health', 'GET');
            return {
                ok: true,
                version: String(res.version || ''),
                pywinauto: Boolean(res.pywinauto),
                learnedTargets: Number(res.learned_targets || 0),
                data: res,
            };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── openTab ─────────────────────────────────────────────────────────────────
    /**
     * openTab — navigate to a named tab in ACI (e.g. 'Subject', 'Sales Comparison').
     */
    async openTab(tabName) {
        try {
            const res = await this._fetch('/navigate-tab', 'POST', { tabName });
            return { ok: Boolean(res.ok), data: res };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── findField ───────────────────────────────────────────────────────────────
    /**
     * findField — check if a field is locatable by the agent.
     * Dry-run: does not modify any field.
     */
    async findField(label, formType = '1004') {
        try {
            const res = await this._fetch('/test-field', 'POST', { label, formType });
            return { ok: Boolean(res.ok), data: res };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── insertText ──────────────────────────────────────────────────────────────
    /**
     * insertText — insert text into a named field in ACI.
     * This is the primary automation action called by the workflow.
     *
     * @param fieldId   Field identifier (e.g. 'neighborhood_description')
     * @param text      Text to insert
     * @param formType  Form type (e.g. '1004')
     */
    async insertText(fieldId, text, formType = '1004') {
        const start = Date.now();
        try {
            const res = await this._fetch('/insert', 'POST', { fieldId, text, formType });
            const result = {
                ok: Boolean(res.ok),
                inserted: Boolean(res.inserted || res.ok),
                verified: Boolean(res.verified),
                fieldId,
                method: String(res.method || 'aci'),
                screenshot: String(res.screenshot || ''),
                data: res,
            };
            await logAutomation({
                caseId: 'workflow',
                fieldId,
                formType,
                software: 'aci',
                action: 'insert',
                success: result.ok,
                durationMs: Date.now() - start,
                error: result.error,
            });
            return result;
        }
        catch (err) {
            const result = this._handleError(err);
            await logAutomation({
                caseId: 'workflow',
                fieldId,
                formType,
                software: 'aci',
                action: 'insert',
                success: false,
                durationMs: Date.now() - start,
                error: result.error,
            });
            return result;
        }
    }
    // ── readText ────────────────────────────────────────────────────────────────
    /**
     * readText — read the current text from a field in ACI.
     * Used by the verification step to confirm insertion.
     */
    async readText(fieldId, formType = '1004') {
        try {
            const res = await this._fetch('/read-field', 'POST', { fieldId, formType });
            return {
                ok: Boolean(res.ok),
                text: String(res.text || ''),
                fieldId,
                data: res,
            };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── verifyText ──────────────────────────────────────────────────────────────
    /**
     * verifyText — verify that the text in a field matches the expected value.
     * Returns passed: true if the field contains the expected text (substring match).
     */
    async verifyText(fieldId, expected, formType = '1004') {
        const start = Date.now();
        try {
            const readResult = await this.readText(fieldId, formType);
            if (!readResult.ok) {
                return {
                    ok: false,
                    passed: false,
                    error: readResult.error || 'Could not read field',
                };
            }
            const actual = String(readResult.text || '').trim();
            const exp = expected.trim();
            const passed = actual.length > 0 && (actual.includes(exp.slice(0, 100)) ||
                exp.includes(actual.slice(0, 100)) ||
                similarity(actual, exp) > 0.85);
            await logAutomation({
                caseId: 'workflow',
                fieldId,
                formType,
                software: 'aci',
                action: 'verify',
                success: passed,
                durationMs: Date.now() - start,
            });
            return {
                ok: true,
                passed,
                actual_preview: actual.slice(0, 200),
                expected_preview: exp.slice(0, 200),
            };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── insertAndVerify ─────────────────────────────────────────────────────────
    /**
     * insertAndVerify — convenience method: insert then immediately verify.
     * Returns a full InsertionResult for the workflow state.
     */
    async insertAndVerify(params) {
        const { fieldId, text, formType } = params;
        const insertResult = await this.insertText(fieldId, text, formType);
        if (!insertResult.ok) {
            return {
                success: false,
                method: 'aci',
                verified: false,
                fieldId,
                fieldLabel: fieldId,
                software: 'aci',
                attempts: 1,
                error: insertResult.error || 'Insert failed',
            };
        }
        const verifyResult = await this.verifyText(fieldId, text, formType);
        return {
            success: insertResult.ok,
            method: insertResult.method || 'aci',
            verified: verifyResult.passed || false,
            fieldId,
            fieldLabel: fieldId,
            software: 'aci',
            attempts: 1,
            screenshot: insertResult.screenshot,
        };
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    async _fetch(path, method, body) {
        const url = `${this.baseUrl}${path}`;
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
        };
        if (body && method === 'POST') {
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`ACI agent returned ${res.status}: ${text}`);
        }
        return res.json();
    }
    _handleError(err) {
        if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
            return {
                ok: false,
                agentDown: true,
                error: 'ACI agent is not running. Start desktop_agent/agent.py first.',
            };
        }
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            return {
                ok: false,
                timeout: true,
                error: `ACI agent timed out after ${this.timeoutMs / 1000}s`,
            };
        }
        return {
            ok: false,
            error: err.message || 'Unknown ACI tool error',
        };
    }
}
// ── Singleton export ──────────────────────────────────────────────────────────
export const aciTool = new ACITool();
// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * similarity — rough text similarity score (0–1) using character overlap.
 * Used for fuzzy verification when exact match is not possible.
 */
function similarity(a, b) {
    if (!a || !b)
        return 0;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.length === 0)
        return 1;
    const matchLen = [...shorter].filter((c, i) => longer[i] === c).length;
    return matchLen / longer.length;
}
//# sourceMappingURL=aciTool.js.map