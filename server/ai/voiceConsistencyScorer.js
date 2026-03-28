/**
 * server/ai/voiceConsistencyScorer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice Consistency Scorer — ensures generated text matches the appraiser's
 * established voice and narrative style using embedding similarity.
 *
 * Uses OpenAI text-embedding-3-small (1536 dimensions) with cosine similarity
 * to compare generated sections against reference embeddings. Falls back to
 * local JSON storage if Pinecone is not configured.
 *
 * Scoring thresholds:
 *   > 0.85 = "pass"  (strong match, minimal editing needed)
 *   0.70-0.85 = "revise" (acceptable, may need voice tweaks)
 *   < 0.70 = "fail" (significant voice drift, recommend rewrite)
 */

import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import log from '../logger.js';
import { getPineconeIndex, PINECONE_ENABLED } from '../config/pinecone.ts';

// ── Configuration ─────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;

// Get API key at runtime (allows tests to override env vars)
function getOpenAIKey() {
  return process.env.OPENAI_API_KEY || '';
}

// Similarity score thresholds (0-1 scale)
const SCORE_THRESHOLDS = {
  pass: 0.85,    // Strong match
  revise: 0.70,  // Acceptable but may need adjustments
  fail: 0.70,    // Below acceptable (fail)
};

// Local fallback storage directory (if Pinecone disabled)
const VOICE_EMBEDDINGS_DIR = path.join(process.cwd(), 'data', 'voice_embeddings');

// ── In-memory cache for reference embeddings (per userId + formType) ──────────
const _referenceCache = new Map(); // key: "${userId}:${formType}" → { embeddings: [], count: int }

// ── OpenAI client ─────────────────────────────────────────────────────────────

let _openaiClient = null;

function getOpenAIClient() {
  const apiKey = getOpenAIKey();
  if (!_openaiClient && apiKey) {
    _openaiClient = new OpenAI({ apiKey });
  }
  return _openaiClient;
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1 (typically 0-1 for embeddings).
 *
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Cosine similarity score
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  if (vecA.length === 0 || vecB.length === 0) return 0;
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Average (centroid) of multiple embeddings.
 * Useful for computing a "reference voice" from multiple examples.
 *
 * @param {number[][]} embeddings - Array of embedding vectors
 * @returns {number[]} Average embedding
 */
export function averageEmbedding(embeddings) {
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    return new Array(EMBEDDING_DIMENSION).fill(0);
  }

  const sum = new Array(EMBEDDING_DIMENSION).fill(0);

  embeddings.forEach(embedding => {
    if (!Array.isArray(embedding)) return;
    for (let i = 0; i < Math.min(embedding.length, EMBEDDING_DIMENSION); i++) {
      sum[i] += embedding[i];
    }
  });

  return sum.map(val => val / embeddings.length);
}

// ── Embedding generation ──────────────────────────────────────────────────────

/**
 * Generate a single embedding for text using OpenAI text-embedding-3-small.
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} 1536-dimensional embedding
 * @throws {Error} If OpenAI API key is not configured or request fails
 */
export async function generateEmbedding(text) {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    log.warn('voice:embedding', { detail: 'OPENAI_API_KEY not configured, cannot generate embedding' });
    throw new Error('OPENAI_API_KEY not configured');
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text to embed must be a non-empty string');
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI client could not be initialized');
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.trim(),
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Empty embedding response from OpenAI');
    }

    return response.data[0].embedding;
  } catch (err) {
    log.error('voice:embedding_failed', {
      detail: `Failed to generate embedding: ${err.message}`,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Batch generate embeddings for multiple texts.
 *
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} Array of embeddings
 */
export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    log.warn('voice:embeddings', { detail: 'OPENAI_API_KEY not configured' });
    throw new Error('OPENAI_API_KEY not configured');
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI client could not be initialized');
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.map(t => (typeof t === 'string' ? t.trim() : '')).filter(t => t.length > 0),
    });

    if (!response.data) {
      throw new Error('Invalid embedding response from OpenAI');
    }

    return response.data.map(item => item.embedding);
  } catch (err) {
    log.error('voice:embeddings_batch_failed', {
      detail: `Failed to generate batch embeddings: ${err.message}`,
      count: texts.length,
    });
    throw err;
  }
}

// ── Pinecone storage ──────────────────────────────────────────────────────────

/**
 * Store a reference embedding in Pinecone or local fallback.
 *
 * @param {string} userId - User ID
 * @param {string} formType - Form type (1004, 1025, etc.)
 * @param {string} sectionId - Section identifier
 * @param {string} text - Original narrative text
 * @param {number[]} embedding - The embedding vector
 * @returns {Promise<boolean>} Success flag
 */
export async function storeReferenceVoice(userId, formType, sectionId, text, embedding) {
  if (!userId || !formType || !sectionId) {
    log.warn('voice:store_reference', { detail: 'Missing required parameters (userId, formType, sectionId)' });
    return false;
  }

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
    log.warn('voice:store_reference', {
      detail: `Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding?.length}`,
    });
    return false;
  }

  const recordId = `${userId}:${formType}:${sectionId}:${Date.now()}`;
  const metadata = {
    userId,
    formType,
    sectionId,
    text: text ? text.substring(0, 1000) : '',
    storedAt: new Date().toISOString(),
  };

  // Try Pinecone first
  if (PINECONE_ENABLED) {
    try {
      const index = getPineconeIndex();
      if (index) {
        await index.upsert([
          {
            id: recordId,
            values: embedding,
            metadata,
          },
        ]);
        log.info('voice:pinecone_stored', { userId, formType, sectionId });
        return true;
      }
    } catch (err) {
      log.warn('voice:pinecone_store_failed', { detail: err.message, falling_back_to_local: true });
    }
  }

  // Fallback to local JSON storage
  try {
    await storeReferenceVoiceLocal(userId, formType, sectionId, text, embedding);
    log.info('voice:local_stored', { userId, formType, sectionId });
    return true;
  } catch (err) {
    log.error('voice:store_failed', { detail: err.message, userId, formType });
    return false;
  }
}

/**
 * Store reference voice to local JSON file (fallback when Pinecone unavailable).
 *
 * @private
 */
async function storeReferenceVoiceLocal(userId, formType, sectionId, text, embedding) {
  await ensureVoiceEmbeddingsDir();

  const filePath = path.join(VOICE_EMBEDDINGS_DIR, `${userId}_${formType}.json`);

  let existing = {};
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    existing = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid JSON, start fresh
  }

  if (!Array.isArray(existing.embeddings)) {
    existing.embeddings = [];
  }

  existing.embeddings.push({
    sectionId,
    text: text ? text.substring(0, 1000) : '',
    embedding,
    storedAt: new Date().toISOString(),
  });

  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
}

/**
 * Ensure voice embeddings directory exists.
 *
 * @private
 */
async function ensureVoiceEmbeddingsDir() {
  try {
    await fs.mkdir(VOICE_EMBEDDINGS_DIR, { recursive: true });
  } catch (err) {
    log.warn('voice:mkdir_failed', { detail: err.message });
    throw err;
  }
}

// ── Reference voice loading ───────────────────────────────────────────────────

/**
 * Load reference embeddings for a user + formType from Pinecone or local storage.
 *
 * @param {string} userId - User ID
 * @param {string} formType - Form type
 * @returns {Promise<number[][]>} Array of reference embeddings
 */
export async function loadReferenceVoice(userId, formType) {
  const cacheKey = `${userId}:${formType}`;

  // Check in-memory cache first
  if (_referenceCache.has(cacheKey)) {
    const cached = _referenceCache.get(cacheKey);
    log.debug('voice:cache_hit', { userId, formType, count: cached.count });
    return cached.embeddings;
  }

  let embeddings = [];

  // Try Pinecone first
  if (PINECONE_ENABLED) {
    try {
      embeddings = await loadReferenceVoicePinecone(userId, formType);
      if (embeddings.length > 0) {
        _referenceCache.set(cacheKey, { embeddings, count: embeddings.length });
        return embeddings;
      }
    } catch (err) {
      log.warn('voice:pinecone_load_failed', { detail: err.message, falling_back_to_local: true });
    }
  }

  // Fallback to local storage
  try {
    embeddings = await loadReferenceVoiceLocal(userId, formType);
    if (embeddings.length > 0) {
      _referenceCache.set(cacheKey, { embeddings, count: embeddings.length });
    }
  } catch (err) {
    log.warn('voice:local_load_failed', { detail: err.message, userId, formType });
  }

  return embeddings;
}

/**
 * Load reference embeddings from Pinecone.
 *
 * @private
 */
async function loadReferenceVoicePinecone(userId, formType) {
  const index = getPineconeIndex();
  if (!index) return [];

  try {
    // Query Pinecone for all vectors with matching userId and formType metadata
    // Note: Pinecone query with sparse filters requires specific setup; this is a basic approach
    // that would fetch vectors matching the criteria from metadata
    // For a production implementation, consider using a dedicated query or collection-based approach
    const response = await index.query({
      vector: new Array(EMBEDDING_DIMENSION).fill(0),
      topK: 100,
      includeMetadata: true,
      filter: {
        userId: { $eq: userId },
        formType: { $eq: formType },
      },
    });

    return (response?.matches || [])
      .filter(match => Array.isArray(match.values) && match.values.length === EMBEDDING_DIMENSION)
      .map(match => match.values);
  } catch (err) {
    log.warn('voice:pinecone_query_failed', { detail: err.message });
    return [];
  }
}

/**
 * Load reference embeddings from local JSON file.
 *
 * @private
 */
async function loadReferenceVoiceLocal(userId, formType) {
  const filePath = path.join(VOICE_EMBEDDINGS_DIR, `${userId}_${formType}.json`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    if (!Array.isArray(data.embeddings)) return [];

    return data.embeddings
      .filter(item => Array.isArray(item.embedding) && item.embedding.length === EMBEDDING_DIMENSION)
      .map(item => item.embedding);
  } catch (err) {
    log.debug('voice:local_load_not_found', { userId, formType });
    return [];
  }
}

// ── Voice consistency scoring ────────────────────────────────────────────────

/**
 * Score a text for voice consistency against the user's reference voice.
 *
 * Returns a structured score object with verdict (pass/revise/fail) and metadata.
 * If no reference voice exists, returns { score: null, verdict: 'skip', reason: ... }.
 *
 * @param {string} text - Generated narrative text to score
 * @param {string} userId - User ID
 * @param {string} formType - Form type (1004, 1025, etc.)
 * @returns {Promise<Object>} Score object with structure:
 *   {
 *     score: 0-1 or null,
 *     cosineSimilarity: 0-1 or null,
 *     referenceCount: number,
 *     verdict: 'pass' | 'revise' | 'fail' | 'skip',
 *     threshold: number,
 *     reason?: string,
 *     error?: string,
 *   }
 */
export async function scoreVoiceConsistency(text, userId, formType) {
  const result = {
    score: null,
    cosineSimilarity: null,
    referenceCount: 0,
    verdict: 'skip',
    threshold: SCORE_THRESHOLDS.pass,
    reason: null,
    error: null,
  };

  // Validate inputs
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    result.reason = 'Empty or invalid text';
    return result;
  }

  if (!userId || !formType) {
    result.reason = 'Missing userId or formType';
    return result;
  }

  // Load reference embeddings
  let referenceEmbeddings = [];
  try {
    referenceEmbeddings = await loadReferenceVoice(userId, formType);
  } catch (err) {
    log.warn('voice:load_reference_failed', { detail: err.message, userId, formType });
    result.error = err.message;
    return result;
  }

  // Check if we have reference embeddings
  if (!referenceEmbeddings || referenceEmbeddings.length === 0) {
    result.reason = 'No reference voice established for this user/formType';
    result.verdict = 'skip';
    return result;
  }

  result.referenceCount = referenceEmbeddings.length;

  // Generate embedding for the text
  let textEmbedding;
  try {
    textEmbedding = await generateEmbedding(text);
  } catch (err) {
    log.warn('voice:generate_embedding_failed', { detail: err.message, userId, formType });
    result.error = err.message;
    result.reason = 'Could not generate embedding for text';
    return result;
  }

  // Compute average reference embedding (centroid of reference voice)
  const avgReferenceEmbedding = averageEmbedding(referenceEmbeddings);

  // Compute cosine similarity
  const similarity = cosineSimilarity(textEmbedding, avgReferenceEmbedding);
  result.cosineSimilarity = Number(similarity.toFixed(4));
  result.score = result.cosineSimilarity;

  // Determine verdict based on thresholds
  if (similarity >= SCORE_THRESHOLDS.pass) {
    result.verdict = 'pass';
    result.threshold = SCORE_THRESHOLDS.pass;
  } else if (similarity >= SCORE_THRESHOLDS.revise) {
    result.verdict = 'revise';
    result.threshold = SCORE_THRESHOLDS.revise;
  } else {
    result.verdict = 'fail';
    result.threshold = SCORE_THRESHOLDS.revise;
  }

  log.info('voice:scored', {
    userId,
    formType,
    verdict: result.verdict,
    score: result.score,
    referenceCount: result.referenceCount,
  });

  return result;
}

// ── Clear cache (useful for testing) ──────────────────────────────────────────

/**
 * Clear the in-memory reference embedding cache.
 * Useful for testing or forcing a fresh load from storage.
 *
 * @param {string} [userId] - If provided, only clear cache for this user (all formTypes)
 * @param {string} [formType] - If both userId and formType provided, clear only that key
 */
export function clearReferenceCache(userId, formType) {
  if (!userId && !formType) {
    _referenceCache.clear();
    log.debug('voice:cache_cleared', { detail: 'All cache cleared' });
    return;
  }

  if (userId && formType) {
    const key = `${userId}:${formType}`;
    _referenceCache.delete(key);
    log.debug('voice:cache_cleared', { userId, formType });
  } else if (userId) {
    const prefix = `${userId}:`;
    for (const key of _referenceCache.keys()) {
      if (key.startsWith(prefix)) {
        _referenceCache.delete(key);
      }
    }
    log.debug('voice:cache_cleared', { userId, detail: 'All formTypes cleared' });
  }
}

// ── Export public API ─────────────────────────────────────────────────────────

export default {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  averageEmbedding,
  loadReferenceVoice,
  storeReferenceVoice,
  scoreVoiceConsistency,
  clearReferenceCache,
  SCORE_THRESHOLDS,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
};
