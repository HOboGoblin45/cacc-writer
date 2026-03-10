/**
 * server/config/pinecone.ts
 * -------------------------
 * NEW ARCHITECTURE — Pinecone vector database configuration.
 *
 * Pinecone stores embedded appraisal narrative examples for semantic retrieval.
 * The index replaces the local JSON knowledge base for production-scale retrieval.
 *
 * Index schema (each vector record):
 *   id:       string  — unique example ID (matches local KB id)
 *   values:   float[] — 1536-dim embedding (text-embedding-3-small)
 *   metadata: {
 *     fieldId:      string  — e.g. 'neighborhood_description'
 *     formType:     string  — e.g. '1004'
 *     text:         string  — narrative text (truncated to 1000 chars for metadata)
 *     qualityScore: number  — 70–90
 *     sourceType:   string  — 'approved_edit' | 'curated' | 'imported'
 *     approvedFlag: boolean
 *     propertyType: string
 *     marketArea:   string
 *     storedAt:     string  — ISO timestamp
 *   }
 *
 * Falls back gracefully to local JSON KB if PINECONE_API_KEY is not set.
 */
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
declare const PINECONE_INDEX: string;
declare const PINECONE_ENABLED: boolean;
export declare function getPineconeClient(): Pinecone | null;
/**
 * getPineconeIndex — returns the Pinecone index handle.
 * Returns null if Pinecone is not configured.
 */
export declare function getPineconeIndex(): import("@pinecone-database/pinecone").Index<import("@pinecone-database/pinecone").RecordMetadata> | null;
/**
 * ensurePineconeIndex — creates the Pinecone index if it does not exist.
 * Safe to call multiple times — uses suppressConflicts to avoid errors on re-runs.
 * Dimension 1536 matches text-embedding-3-small output.
 */
export declare function ensurePineconeIndex(): Promise<boolean>;
export interface PineconeExampleMetadata {
    fieldId: string;
    formType: string;
    text: string;
    qualityScore: number;
    sourceType: 'approved_edit' | 'curated' | 'imported';
    approvedFlag: boolean;
    propertyType?: string;
    marketArea?: string;
    humanEdits?: boolean;
    storedAt: string;
}
export interface PineconeUpsertRecord {
    id: string;
    values: number[];
    metadata: PineconeExampleMetadata;
}
export { PINECONE_INDEX, PINECONE_ENABLED };
//# sourceMappingURL=pinecone.d.ts.map