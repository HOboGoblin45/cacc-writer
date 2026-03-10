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
import { logAutomation } from '../observability/langfuse.js';
// ── Config ────────────────────────────────────────────────────────────────────
const RQ_AGENT_URL = process.env.RQ_AGENT_URL || 'http://localhost:5181';
const RQ_TIMEOUT_MS = Number(process.env.RQ_TIMEOUT_MS) || 30_000;
// ── RealQuantumTool class ─────────────────────────────────────────────────────
export class RealQuantumTool {
    baseUrl;
    timeoutMs;
    constructor(baseUrl = RQ_AGENT_URL, timeoutMs = RQ_TIMEOUT_MS) {
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
    }
    // ── health ──────────────────────────────────────────────────────────────────
    /**
     * health — check if the Real Quantum agent is running and ready.
     */
    async health() {
        try {
            const res = await this._fetch('/health', 'GET');
            return {
                ok: true,
                version: String(res.version || ''),
                playwright: Boolean(res.playwright),
                connected: Boolean(res.connected || res.ok),
                data: res,
            };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── navigateSection ─────────────────────────────────────────────────────────
    /**
     * navigateSection — navigate to a named section in Real Quantum.
     * @param sectionName  Section name (e.g. 'property_data', 'reconciliation')
     */
    async navigateSection(sectionName) {
        try {
            const res = await this._fetch('/navigate', 'POST', { section: sectionName });
            return { ok: Boolean(res.ok), data: res };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── resolveEditor ───────────────────────────────────────────────────────────
    /**
     * resolveEditor — check if a TinyMCE editor is ready for a given selector.
     * Dry-run: does not modify any field.
     */
    async resolveEditor(selector) {
        try {
            const res = await this._fetch('/resolve-editor', 'POST', { selector });
            return { ok: Boolean(res.ok), data: res };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── insertText ──────────────────────────────────────────────────────────────
    /**
     * insertText — insert text into a Real Quantum TinyMCE field.
     *
     * @param fieldId   Field identifier (e.g. 'neighborhood_description')
     * @param text      Text to insert
     * @param formType  Form type (e.g. 'commercial')
     */
    async insertText(fieldId, text, formType = 'commercial') {
        const start = Date.now();
        try {
            const res = await this._fetch('/insert', 'POST', { fieldId, text, formType });
            const result = {
                ok: Boolean(res.ok),
                inserted: Boolean(res.inserted || res.ok),
                verified: Boolean(res.verified),
                fieldId,
                selector: String(res.selector || ''),
                screenshot: String(res.screenshot || ''),
                data: res,
            };
            await logAutomation({
                caseId: 'workflow',
                fieldId,
                formType,
                software: 'real_quantum',
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
                software: 'real_quantum',
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
     * readText — read the current text from a Real Quantum field.
     */
    async readText(fieldId, formType = 'commercial') {
        try {
            const res = await this._fetch('/read-field', 'POST', { fieldId, formType });
            return {
                ok: Boolean(res.ok),
                text: String(res.text || ''),
                selector: String(res.selector || ''),
                data: res,
            };
        }
        catch (err) {
            return this._handleError(err);
        }
    }
    // ── verifyText ──────────────────────────────────────────────────────────────
    /**
     * verifyText — verify that the text in a Real Quantum field matches expected.
     */
    async verifyText(fieldId, expected, formType = 'commercial') {
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
                software: 'real_quantum',
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
                method: 'real_quantum',
                verified: false,
                fieldId,
                fieldLabel: fieldId,
                software: 'real_quantum',
                attempts: 1,
                error: insertResult.error || 'Insert failed',
            };
        }
        const verifyResult = await this.verifyText(fieldId, text, formType);
        return {
            success: insertResult.ok,
            method: 'real_quantum_tinymce',
            verified: verifyResult.passed || false,
            fieldId,
            fieldLabel: fieldId,
            software: 'real_quantum',
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
            throw new Error(`RQ agent returned ${res.status}: ${text}`);
        }
        return res.json();
    }
    _handleError(err) {
        if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
            return {
                ok: false,
                agentDown: true,
                error: 'Real Quantum agent is not running. Start real_quantum_agent/agent.py first.',
            };
        }
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            return {
                ok: false,
                timeout: true,
                error: `Real Quantum agent timed out after ${this.timeoutMs / 1000}s`,
            };
        }
        return {
            ok: false,
            error: err.message || 'Unknown Real Quantum tool error',
        };
    }
}
// ── Singleton export ──────────────────────────────────────────────────────────
export const realQuantumTool = new RealQuantumTool();
// ── Helpers ───────────────────────────────────────────────────────────────────
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
//# sourceMappingURL=realQuantumTool.js.map