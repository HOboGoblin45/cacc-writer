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

// ── Environment ───────────────────────────────────────────────────────────────

const PINECONE_API_KEY = process.env.PINECONE_API_KEY || '';
// Support both PINECONE_INDEX_NAME (preferred) and legacy PINECONE_INDEX
const PINECONE_INDEX   = process.env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX || 'cacc-writer';
const PINECONE_ENABLED = Boolean(PINECONE_API_KEY);

if (!PINECONE_ENABLED) {
  console.log('[config/pinecone] PINECONE_API_KEY not set. Vector retrieval will use local KB fallback.');
} else {
  console.log(`[config/pinecone] Pinecone enabled. Index: ${PINECONE_INDEX}`);
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _pineconeClient: Pinecone | null = null;

export function getPineconeClient(): Pinecone | null {
  if (!PINECONE_ENABLED) return null;
  if (!_pineconeClient) {
    _pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY });
  }
  return _pineconeClient;
}

/**
 * getPineconeIndex — returns the Pinecone index handle.
 * Returns null if Pinecone is not configured.
 */
export function getPineconeIndex() {
  const client = getPineconeClient();
  if (!client) return null;
  return client.index(PINECONE_INDEX);
}

/**
 * ensurePineconeIndex — creates the Pinecone index if it does not exist.
 * Safe to call multiple times — uses suppressConflicts to avoid errors on re-runs.
 * Dimension 1536 matches text-embedding-3-small output.
 */
export async function ensurePineconeIndex(): Promise<boolean> {
  if (!PINECONE_ENABLED) return false;
  const client = getPineconeClient();
  if (!client) return false;

  try {
    // Check if index already exists
    const { indexes } = await client.listIndexes();
    const exists = (indexes || []).some((idx: any) => idx.name === PINECONE_INDEX);

    if (exists) {
      console.log(`[config/pinecone] Index '${PINECONE_INDEX}' already exists.`);
      return true;
    }

    console.log(`[config/pinecone] Creating index '${PINECONE_INDEX}' (dim=1536, metric=cosine)...`);
    await client.createIndex({
      name:      PINECONE_INDEX,
      dimension: 1536,
      metric:    'cosine',
      spec: {
        serverless: {
          cloud:  'aws',
          region: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
        },
      },
      waitUntilReady:    true,
      suppressConflicts: true,
    });
    console.log(`[config/pinecone] ✓ Index '${PINECONE_INDEX}' created and ready.`);
    return true;
  } catch (err: any) {
    console.error('[config/pinecone] ensurePineconeIndex failed:', err.message);
    return false;
  }
}

// ── Index metadata type ───────────────────────────────────────────────────────

export interface PineconeExampleMetadata {
  fieldId:      string;
  formType:     string;
  text:         string;
  qualityScore: number;
  sourceType:   'approved_edit' | 'curated' | 'imported';
  approvedFlag: boolean;
  propertyType?: string;
  marketArea?:   string;
  humanEdits?:   boolean;
  storedAt:      string;
}

export interface PineconeUpsertRecord {
  id:       string;
  values:   number[];
  metadata: PineconeExampleMetadata;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { PINECONE_INDEX, PINECONE_ENABLED };
