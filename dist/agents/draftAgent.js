/**
 * server/agents/draftAgent.ts
 * ----------------------------
 * NEW ARCHITECTURE — Draft Agent for the LangGraph workflow.
 *
 * Responsibilities:
 *   1. Retrieve similar prior appraisal examples from Pinecone / local KB
 *   2. Construct the full 6-block prompt with facts + examples
 *   3. Call OpenAI to generate the narrative section
 *   4. Return structured output with draft text + provenance
 *
 * This agent replaces the inline generation logic in cacc-writer-server.js.
 * It uses the existing buildPromptMessages() from server/promptBuilder.js
 * so prompt quality is preserved while adding observability + tracing.
 *
 * Output:
 *   draft_text:     string   — generated narrative
 *   examples_used:  array    — examples that were injected into the prompt
 *   facts_used:     object   — facts that were available during generation
 *   model_used:     string   — OpenAI model name
 *   tokens_estimate: number  — rough token estimate
 *   duration_ms:    number   — generation time
 */
import 'dotenv/config';
import path from 'path';
import { pathToFileURL } from 'url';
import { wrapWithTrace } from '../observability/langsmith.js';
import { logPrompt, logWorkflowRun } from '../observability/langfuse.js';
import { retrieveExamples } from '../retrieval/llamaIndex.js';
// Resolve server/ directory at runtime regardless of whether running from
// server/ (dev via tsx) or dist/ (prod via tsc).
const SERVER_DIR = path.join(process.cwd(), 'server');
function serverModuleURL(filename) {
    return pathToFileURL(path.join(SERVER_DIR, filename)).href;
}
// ── draftSection ──────────────────────────────────────────────────────────────
/**
 * draftSection — generates a narrative section draft for a given workflow state.
 *
 * Uses the existing buildPromptMessages() pipeline to ensure prompt quality
 * is identical to the legacy system while adding:
 *   - Pinecone-based semantic example retrieval
 *   - LangSmith tracing
 *   - Langfuse prompt logging
 *   - Structured output with provenance
 */
export async function draftSection(state) {
    const start = Date.now();
    const { caseId, formType, fieldId, facts, locationContext } = state;
    const { result, durationMs } = await wrapWithTrace(() => _draftSection(state), 'draft_section', { caseId, formType, fieldId });
    await logWorkflowRun({
        caseId,
        formType,
        fieldId,
        stage: 'draft_section',
        input: { fieldId, formType, factsKeys: Object.keys(facts || {}) },
        output: { textLength: result.draft_text.length, examplesUsed: result.examples_used.length },
        durationMs: durationMs || (Date.now() - start),
        success: result.draft_text.length > 20,
    });
    return result;
}
async function _draftSection(state) {
    const start = Date.now();
    const { caseId, formType, fieldId, facts, locationContext } = state;
    // ── Step 1: Retrieve examples ─────────────────────────────────────────────
    let examples = [];
    try {
        examples = await retrieveExamples({
            fieldId,
            formType,
            queryText: buildFactsSummary(facts, fieldId),
            topK: 5,
        });
    }
    catch (err) {
        console.warn(`[draftAgent] Example retrieval failed (non-fatal): ${err.message}`);
    }
    // ── Step 2: Build prompt using existing pipeline ──────────────────────────
    // Import legacy promptBuilder to preserve prompt quality.
    // Use absolute path so this works from both server/ (dev) and dist/ (prod).
    const { buildPromptMessages } = await import(serverModuleURL('promptBuilder.js'));
    // Convert RetrievedExample[] to the format expected by buildPromptMessages
    const legacyExamples = examples.map(ex => ({
        id: ex.id,
        fieldId: ex.fieldId,
        formType: ex.formType,
        text: ex.text,
        qualityScore: ex.qualityScore,
        sourceType: ex.sourceType,
        weight: ex.score,
    }));
    const messages = buildPromptMessages({
        formType,
        fieldId,
        facts: facts || {},
        examples: legacyExamples,
        locationContext: locationContext || null,
    });
    // ── Step 3: Generate with OpenAI ──────────────────────────────────────────
    const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
    // Use absolute path so this works from both server/ (dev) and dist/ (prod).
    const { callAI } = await import(serverModuleURL('openaiClient.js'));
    const genStart = Date.now();
    const draftText = await callAI(messages, { timeout: 120_000 });
    const genDuration = Date.now() - genStart;
    // ── Step 4: Log prompt to Langfuse ────────────────────────────────────────
    await logPrompt({
        caseId,
        fieldId,
        formType,
        promptMessages: messages,
        response: draftText,
        model: MODEL,
        durationMs: genDuration,
        examplesUsed: examples.length,
    });
    const totalDuration = Date.now() - start;
    return {
        draft_text: draftText.trim(),
        examples_used: examples,
        facts_used: facts || {},
        model_used: MODEL,
        tokens_estimate: Math.round((JSON.stringify(messages).length + draftText.length) / 4),
        duration_ms: totalDuration,
        field_id: fieldId,
        form_type: formType,
    };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * buildFactsSummary — creates a short text summary of the facts for semantic retrieval.
 * This is used as the query text when searching Pinecone for similar examples.
 */
function buildFactsSummary(facts, fieldId) {
    if (!facts)
        return fieldId;
    const parts = [`field: ${fieldId}`];
    // Extract key facts for the query
    const subject = facts.subject || {};
    const market = facts.market || {};
    const neigh = facts.neighborhood || {};
    const getValue = (obj, key) => {
        const f = obj[key];
        return f ? String(f?.value ?? f ?? '') : '';
    };
    const city = getValue(subject, 'city');
    const county = getValue(subject, 'county');
    const style = getValue(subject, 'style');
    const trend = getValue(market, 'trend');
    const desc = getValue(neigh, 'description');
    if (city)
        parts.push(`city: ${city}`);
    if (county)
        parts.push(`county: ${county}`);
    if (style)
        parts.push(`style: ${style}`);
    if (trend)
        parts.push(`market trend: ${trend}`);
    if (desc)
        parts.push(desc.slice(0, 200));
    return parts.join('. ');
}
//# sourceMappingURL=draftAgent.js.map