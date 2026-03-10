/**
 * server/retrieval/llamaIndex.ts
 * --------------------------------
 * NEW ARCHITECTURE — Semantic retrieval layer using Pinecone + OpenAI embeddings.
 *
 * Replaces the local JSON-based getRelevantExamples() with vector similarity search.
 * Falls back to the existing local KB retrieval if Pinecone is not configured.
 *
 * Responsibilities:
 *   - Embed query text using OpenAI text-embedding-3-small
 *   - Query Pinecone for top-k similar appraisal narrative examples
 *   - Filter by formType + fieldId metadata
 *   - Store new approved sections back to Pinecone
 *   - Ingest existing local KB examples into Pinecone (one-time migration)
 *
 * Fallback chain:
 *   Pinecone (if configured) → local KB getRelevantExamples() → empty array
 */
import 'dotenv/config';
import path from 'path';
import { pathToFileURL } from 'url';
import { getPineconeIndex, PINECONE_ENABLED, ensurePineconeIndex } from '../config/pinecone.js';
import { embeddings } from '../config/openai.js';
import { logRetrieval } from '../observability/langfuse.js';
// Resolve the server/ directory at runtime regardless of whether we're running
// from server/ (dev via tsx) or dist/ (prod via tsc).  The project root is
// always process.cwd() because cacc-writer-server.js is the entry point.
const SERVER_DIR = path.join(process.cwd(), 'server');
function serverModuleURL(filename) {
    return pathToFileURL(path.join(SERVER_DIR, filename)).href;
}
// ── retrieveExamples ──────────────────────────────────────────────────────────
/**
 * retrieveExamples — semantic retrieval of similar appraisal narrative examples.
 *
 * Query strategy:
 *   1. Build semantic query string from fieldId + formType + optional facts
 *   2. Embed query using OpenAI text-embedding-3-small
 *   3. Query Pinecone for top-k similar vectors filtered by fieldId + formType
 *   4. Return ranked examples sorted by quality score × similarity
 *
 * Falls back to local KB if Pinecone is not configured.
 */
export async function retrieveExamples(params) {
    const { fieldId, formType, propertyType, marketType, marketArea, queryText, topK = 5, } = params;
    const start = Date.now();
    // ── Pinecone path ─────────────────────────────────────────────────────────
    if (PINECONE_ENABLED) {
        try {
            const pineconeIndex = getPineconeIndex();
            if (!pineconeIndex)
                throw new Error('Pinecone index unavailable');
            const query = buildQueryString({ fieldId, formType, propertyType, marketType, marketArea, queryText });
            const queryVector = await embeddings.embedQuery(query);
            const response = await pineconeIndex.query({
                vector: queryVector,
                topK: topK * 3, // over-fetch to allow quality filtering
                includeMetadata: true,
                filter: {
                    fieldId: { $eq: fieldId },
                    formType: { $eq: formType },
                },
            });
            const examples = (response.matches || [])
                .filter(m => (m.score || 0) > 0.4)
                .map(m => ({
                id: m.id,
                fieldId: String(m.metadata?.fieldId || fieldId),
                formType: String(m.metadata?.formType || formType),
                text: String(m.metadata?.text || ''),
                qualityScore: Number(m.metadata?.qualityScore || 70),
                sourceType: m.metadata?.sourceType || 'imported',
                score: m.score || 0,
                metadata: m.metadata || {},
            }))
                .filter(ex => ex.text.length > 20)
                // Sort: approved_edit > curated > imported, then by quality × similarity
                .sort((a, b) => {
                const weightA = sourceWeight(a.sourceType) * a.qualityScore * a.score;
                const weightB = sourceWeight(b.sourceType) * b.qualityScore * b.score;
                return weightB - weightA;
            })
                .slice(0, topK);
            await logRetrieval({
                caseId: 'system',
                fieldId,
                formType,
                queryText: query,
                resultsCount: examples.length,
                topScore: examples[0]?.score,
                source: 'pinecone',
                durationMs: Date.now() - start,
            });
            console.log(`[retrieval] Pinecone: ${examples.length} examples for ${formType}/${fieldId}`);
            return examples;
        }
        catch (err) {
            console.warn('[retrieval] Pinecone query failed, falling back to local KB:', err.message);
        }
    }
    // ── Local KB fallback ─────────────────────────────────────────────────────
    return retrieveFromLocalKB(params, start);
}
// ── retrieveFromLocalKB ───────────────────────────────────────────────────────
/**
 * retrieveFromLocalKB — fallback retrieval using the existing local JSON KB.
 * Calls the legacy getRelevantExamples() function from server/retrieval.js.
 */
async function retrieveFromLocalKB(params, startTime) {
    const start = startTime || Date.now();
    try {
        // Dynamic import of legacy JS module using absolute path (works from both
        // server/ dev context and dist/ prod context after tsc compilation).
        const { getRelevantExamples } = await import(serverModuleURL('retrieval.js'));
        const raw = getRelevantExamples({
            formType: params.formType,
            fieldId: params.fieldId,
            propertyType: params.propertyType,
            marketType: params.marketType,
        });
        const examples = (raw || []).map((ex, i) => ({
            id: ex.id || `local-${i}`,
            fieldId: ex.fieldId || params.fieldId,
            formType: ex.formType || params.formType,
            text: ex.text || '',
            qualityScore: ex.qualityScore || 70,
            sourceType: ex.sourceType || 'imported',
            score: 0.8 - (i * 0.05), // synthetic score based on retrieval rank
            metadata: ex,
        }));
        await logRetrieval({
            caseId: 'system',
            fieldId: params.fieldId,
            formType: params.formType,
            queryText: `${params.fieldId} ${params.formType}`,
            resultsCount: examples.length,
            source: 'local_kb',
            durationMs: Date.now() - start,
        });
        console.log(`[retrieval] Local KB: ${examples.length} examples for ${params.formType}/${params.fieldId}`);
        return examples;
    }
    catch (err) {
        console.warn('[retrieval] Local KB fallback failed:', err.message);
        return [];
    }
}
// ── storeExample ──────────────────────────────────────────────────────────────
/**
 * storeExample — stores an approved narrative section in Pinecone.
 * Called after a section is approved and verified to enable continuous improvement.
 *
 * Also calls the legacy addExample() to keep the local KB in sync.
 */
export async function storeExample(params) {
    // Always save to local KB (legacy path — ensures backward compat)
    try {
        const { addExample } = await import(serverModuleURL('knowledgeBase.js'));
        addExample({
            fieldId: params.fieldId,
            formType: params.formType,
            sourceType: params.sourceType,
            qualityScore: params.qualityScore,
            tags: [],
            text: params.text,
        });
    }
    catch (err) {
        console.warn('[retrieval] Local KB save failed (non-fatal):', err.message);
    }
    // Store in Pinecone if configured
    if (!PINECONE_ENABLED)
        return false;
    try {
        const pineconeIndex = getPineconeIndex();
        if (!pineconeIndex)
            return false;
        const vector = await embeddings.embedDocuments([params.text]);
        await pineconeIndex.upsert([{
                id: params.id,
                values: vector[0],
                metadata: {
                    fieldId: params.fieldId,
                    formType: params.formType,
                    text: params.text.slice(0, 1000), // Pinecone metadata limit
                    qualityScore: params.qualityScore,
                    sourceType: params.sourceType,
                    approvedFlag: params.approvedFlag ?? false,
                    humanEdits: params.humanEdits ?? false,
                    propertyType: params.propertyType || '',
                    marketArea: params.marketArea || '',
                    storedAt: new Date().toISOString(),
                    ...params.metadata,
                },
            }]);
        console.log(`[retrieval] Stored example ${params.id} in Pinecone (${params.fieldId}/${params.formType})`);
        return true;
    }
    catch (err) {
        console.error('[retrieval] Pinecone store failed:', err.message);
        return false;
    }
}
// ── ingestLocalKBToPinecone ───────────────────────────────────────────────────
/**
 * ingestLocalKBToPinecone — one-time migration of local KB examples to Pinecone.
 * Called via POST /api/kb/ingest-to-pinecone endpoint.
 * Safe to re-run — upsert is idempotent.
 */
export async function ingestLocalKBToPinecone() {
    if (!PINECONE_ENABLED) {
        return { total: 0, ingested: 0, skipped: 0, errors: 0 };
    }
    // Ensure the Pinecone index exists before attempting to upsert
    const indexReady = await ensurePineconeIndex();
    if (!indexReady) {
        console.error('[retrieval] Pinecone index not ready — aborting ingest');
        return { total: 0, ingested: 0, skipped: 0, errors: 0 };
    }
    const { indexExamples } = await import(serverModuleURL('knowledgeBase.js'));
    const index = indexExamples();
    const examples = index.examples || [];
    let ingested = 0, skipped = 0, errors = 0;
    const BATCH_SIZE = 50;
    for (let i = 0; i < examples.length; i += BATCH_SIZE) {
        const batch = examples.slice(i, i + BATCH_SIZE);
        const validBatch = batch.filter((ex) => ex.text && ex.text.length > 20);
        if (!validBatch.length) {
            skipped += batch.length;
            continue;
        }
        try {
            const texts = validBatch.map((ex) => ex.text);
            const vectors = await embeddings.embedDocuments(texts);
            const records = validBatch.map((ex, j) => ({
                id: ex.id || `kb-${Date.now()}-${i + j}`,
                values: vectors[j],
                metadata: {
                    fieldId: ex.fieldId || 'unknown',
                    formType: ex.formType || '1004',
                    text: ex.text.slice(0, 1000),
                    qualityScore: ex.qualityScore || 70,
                    sourceType: ex.sourceType || 'imported',
                    approvedFlag: ex.sourceType === 'approved_edit',
                    storedAt: new Date().toISOString(),
                },
            }));
            const pineconeIndex = getPineconeIndex();
            if (pineconeIndex) {
                await pineconeIndex.upsert(records);
                ingested += records.length;
            }
        }
        catch (err) {
            console.error(`[retrieval] Batch ingest failed (batch ${i}):`, err.message);
            errors += validBatch.length;
        }
        // Rate limit: avoid overwhelming OpenAI embeddings API
        if (i + BATCH_SIZE < examples.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
    console.log(`[retrieval] Ingest complete: ${ingested} ingested, ${skipped} skipped, ${errors} errors`);
    return { total: examples.length, ingested, skipped, errors };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function buildQueryString(params) {
    const parts = [
        `appraisal narrative section: ${params.fieldId || ''}`,
        `form type: ${params.formType || '1004'}`,
    ];
    if (params.propertyType)
        parts.push(`property type: ${params.propertyType}`);
    if (params.marketType)
        parts.push(`market type: ${params.marketType}`);
    if (params.marketArea)
        parts.push(`market area: ${params.marketArea}`);
    if (params.queryText)
        parts.push(params.queryText.slice(0, 500));
    return parts.join('. ');
}
function sourceWeight(sourceType) {
    switch (sourceType) {
        case 'approved_edit': return 1.5;
        case 'curated': return 1.0;
        case 'imported': return 0.7;
        default: return 0.5;
    }
}
//# sourceMappingURL=llamaIndex.js.map