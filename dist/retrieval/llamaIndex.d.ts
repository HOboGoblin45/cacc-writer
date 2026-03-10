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
export interface RetrievedExample {
    id: string;
    fieldId: string;
    formType: string;
    text: string;
    qualityScore: number;
    sourceType: 'approved_edit' | 'curated' | 'imported';
    score: number;
    metadata: Record<string, unknown>;
}
export interface RetrievalParams {
    fieldId: string;
    formType: string;
    propertyType?: string;
    marketType?: string;
    marketArea?: string;
    queryText?: string;
    topK?: number;
}
export interface StoreExampleParams {
    id: string;
    fieldId: string;
    formType: string;
    text: string;
    qualityScore: number;
    sourceType: 'approved_edit' | 'curated' | 'imported';
    approvedFlag?: boolean;
    humanEdits?: boolean;
    propertyType?: string;
    marketArea?: string;
    metadata?: Record<string, unknown>;
}
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
export declare function retrieveExamples(params: RetrievalParams): Promise<RetrievedExample[]>;
/**
 * storeExample — stores an approved narrative section in Pinecone.
 * Called after a section is approved and verified to enable continuous improvement.
 *
 * Also calls the legacy addExample() to keep the local KB in sync.
 */
export declare function storeExample(params: StoreExampleParams): Promise<boolean>;
/**
 * ingestLocalKBToPinecone — one-time migration of local KB examples to Pinecone.
 * Called via POST /api/kb/ingest-to-pinecone endpoint.
 * Safe to re-run — upsert is idempotent.
 */
export declare function ingestLocalKBToPinecone(): Promise<{
    total: number;
    ingested: number;
    skipped: number;
    errors: number;
}>;
//# sourceMappingURL=llamaIndex.d.ts.map