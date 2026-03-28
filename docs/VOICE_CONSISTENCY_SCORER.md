# Voice Consistency Scorer — Integration Guide

## Overview

The Voice Consistency Scorer (`server/ai/voiceConsistencyScorer.js`) uses embedding similarity to ensure generated narrative text matches an appraiser's established voice and style. It's part of the Phase 3 Narrative Intelligence Pipeline.

## Architecture

```
Text Input
    ↓
[Generate Embedding via OpenAI text-embedding-3-small]
    ↓
[Load Reference Voice Embeddings from Pinecone/Local]
    ↓
[Compute Cosine Similarity vs. Average Reference]
    ↓
Score: 0-1 | Verdict: "pass" | "revise" | "fail" | "skip"
```

## Scoring Thresholds

| Score | Verdict | Interpretation | Action |
|-------|---------|-----------------|--------|
| ≥ 0.85 | **pass** | Strong voice match | Accept as-is or minimal edit |
| 0.70–0.85 | **revise** | Acceptable but needs voice tweaks | Consider rewrite |
| < 0.70 | **fail** | Significant voice drift | Recommend full rewrite |
| N/A | **skip** | No reference voice or error | Establish baseline first |

## Integration Points

### 1. Scoring Pipeline (scoreSectionOutput Enhancement)

The voice scorer can be integrated into `server/sectionFactory/sectionPolicyService.js`'s `scoreSectionOutput()` function:

```javascript
// In scoreVoiceConsistency() - optional voice dimension
import { scoreVoiceConsistency } from '../ai/voiceConsistencyScorer.js';

export async function scoreSectionOutput({
  sectionPolicy,
  text,
  warningsCount = 0,
  dependencySnapshot = null,
  analysisContextUsed = false,
  priorSectionsContextUsed = false,
  retrievalSourceIds = [],
  userId, // NEW: for voice consistency
  formType, // NEW: for voice consistency
}) {
  // ... existing scoring logic ...

  // NEW: Voice consistency dimension
  let voiceScore = null;
  try {
    const voiceResult = await scoreVoiceConsistency(text, userId, formType);
    if (voiceResult.verdict !== 'skip') {
      voiceScore = voiceResult.score;
      penalties.push({
        code: 'voice_consistency',
        amount: Math.max(0, (SCORE_THRESHOLDS.revise - voiceResult.score) * 0.2),
        detail: `Voice score ${voiceResult.score}: ${voiceResult.verdict}`,
      });
      score -= penalties[penalties.length - 1].amount;
    }
  } catch (err) {
    log.warn('voice:scoring_failed', { error: err.message });
    // Fall through - voice scoring is optional
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    score: boundedScore,
    metadata: {
      // ... existing metadata ...
      voiceScore, // NEW
      penalties,
    },
  };
}
```

### 2. Section Job Runner Integration

In `server/orchestrator/sectionJobRunner.js`, after `scoreSectionOutput()` call:

```javascript
const quality = scoreSectionOutput({
  sectionPolicy,
  text: outputText,
  warningsCount,
  dependencySnapshot,
  analysisContextUsed,
  priorSectionsContextUsed,
  retrievalSourceIds: sourceIds,
  userId: caseId.split(':')[0], // Extract userId from caseId or pass separately
  formType: resolvedFormType,
});

// Voice consistency is now part of quality.metadata.voiceScore
log.info('section:scored', {
  sectionId,
  qualityScore: quality.score,
  voiceScore: quality.metadata.voiceScore,
});
```

### 3. Reference Voice Establishment

Before voice consistency scoring can be useful, reference embeddings must be established:

#### Option A: Precompute from Knowledge Base

```bash
# Establish default reference voice for 1004 form
node scripts/precompute_reference_embeddings.mjs --formType 1004 --userId default

# Establish per-user reference voice
node scripts/precompute_reference_embeddings.mjs --formType 1004 --userId appraiser_john_123
```

#### Option B: Inline During Approval

When an appraiser approves a section, store it as reference voice:

```javascript
import { storeReferenceVoice } from './server/ai/voiceConsistencyScorer.js';
import { generateEmbedding } from './server/ai/voiceConsistencyScorer.js';

async function approveSectionAsReference(userId, formType, sectionId, approvedText) {
  try {
    const embedding = await generateEmbedding(approvedText);
    const success = await storeReferenceVoice(
      userId,
      formType,
      `approved_${sectionId}`,
      approvedText,
      embedding
    );
    if (success) {
      // Clear cache to pick up new reference
      clearReferenceCache(userId, formType);
      log.info('reference:stored', { userId, formType, sectionId });
    }
  } catch (err) {
    log.error('reference:store_failed', { error: err.message });
  }
}
```

## API Reference

### generateEmbedding(text)

Generate a single embedding using OpenAI text-embedding-3-small.

```javascript
const embedding = await generateEmbedding('A well-maintained residential property...');
// Returns: number[] (1536 dimensions)
```

**Throws**: If OPENAI_API_KEY is not configured or text is empty.

### generateEmbeddings(texts)

Batch generate embeddings for multiple texts.

```javascript
const embeddings = await generateEmbeddings([
  'Text one...',
  'Text two...',
]);
// Returns: number[][] (array of 1536-dimensional vectors)
```

### scoreVoiceConsistency(text, userId, formType)

Score generated text for voice consistency against user's reference voice.

```javascript
const result = await scoreVoiceConsistency(
  'The subject property is a well-maintained...',
  'user123',
  '1004'
);

// Result structure:
{
  score: 0.82,                          // Similarity 0-1, or null
  cosineSimilarity: 0.82,               // Same as score
  referenceCount: 5,                    // Number of reference embeddings used
  verdict: 'revise',                    // 'pass' | 'revise' | 'fail' | 'skip'
  threshold: 0.85,                      // Threshold for 'pass'
  reason: null,                         // Error message if verdict is 'skip'
  error: null,                          // API error if failed
}
```

**Returns skip verdict if**:
- No reference voice exists for user + formType
- Text is empty or invalid
- OpenAI API call fails (graceful degradation)

### storeReferenceVoice(userId, formType, sectionId, text, embedding)

Store a reference embedding in Pinecone or local fallback.

```javascript
const success = await storeReferenceVoice(
  'user123',
  '1004',
  'neighborhood_description',
  'The neighborhood is characterized by...',
  embeddingVector
);
// Returns: boolean (success flag)
```

**Stores to**:
1. Pinecone index (if `PINECONE_API_KEY` is configured)
2. Local JSON file fallback: `data/voice_embeddings/{userId}_{formType}.json`

### loadReferenceVoice(userId, formType)

Load all reference embeddings for a user + formType. Uses in-memory cache.

```javascript
const embeddings = await loadReferenceVoice('user123', '1004');
// Returns: number[][] (array of reference embeddings)
```

**Loads from**:
1. In-memory cache (fastest)
2. Pinecone (if enabled and cached miss)
3. Local JSON file (fallback)

### clearReferenceCache([userId], [formType])

Clear the in-memory embedding cache (useful for testing).

```javascript
clearReferenceCache();              // Clear all
clearReferenceCache('user123');     // Clear one user (all forms)
clearReferenceCache('user123', '1004'); // Clear specific form
```

### Utility Functions

#### cosineSimilarity(vecA, vecB)

Compute cosine similarity between two vectors (pure math, no API calls).

```javascript
const similarity = cosineSimilarity([1, 0, 0], [1, 1, 0]);
// Returns: ~0.707 (cos(45°))
```

#### averageEmbedding(embeddings)

Compute centroid (average) of multiple embeddings.

```javascript
const reference = averageEmbedding([emb1, emb2, emb3]);
// Returns: number[] (average of the three embeddings)
```

## Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...                # OpenAI API key for embeddings

# Optional (for Pinecone storage)
PINECONE_API_KEY=...                 # Pinecone API key
PINECONE_INDEX_NAME=cacc-writer      # Pinecone index name (default: cacc-writer)
PINECONE_ENVIRONMENT=us-east-1       # Pinecone region (default: us-east-1)
```

### Fallback Behavior

- **Pinecone unavailable**: Automatically falls back to local JSON file storage in `data/voice_embeddings/`
- **OpenAI API fails**: Logs warning and returns `skip` verdict (non-blocking)
- **No reference embeddings**: Returns `skip` verdict (can establish baseline later)

## Testing

Run tests with Vitest:

```bash
npm test -- tests/vitest/voiceConsistencyScorer.test.mjs
```

Tests cover:
- Cosine similarity math (known vectors)
- Average embedding calculation
- Score interpretation thresholds
- Graceful degradation scenarios
- Cache behavior
- Edge cases (unicode, special chars, very long text)

## Performance Considerations

### Embeddings Generation

- **Single text**: ~100–200ms (network latency to OpenAI)
- **Batch (100 texts)**: ~500–1000ms (more efficient than sequential)
- **Dimension**: 1536 (text-embedding-3-small)

### Reference Loading

- **First call**: ~100–200ms (loads from Pinecone/file)
- **Subsequent calls**: ~1ms (in-memory cache hit)

### Similarity Computation

- **Per text**: ~5–10ms (cosine math only)

## Example: Full Workflow

```javascript
import {
  generateEmbedding,
  scoreVoiceConsistency,
  storeReferenceVoice,
} from './server/ai/voiceConsistencyScorer.js';

const userId = 'appraiser_123';
const formType = '1004';

// 1. Generate a narrative
const generatedText = await callAI(messages); // From existing orchestrator

// 2. Score voice consistency
const voiceResult = await scoreVoiceConsistency(
  generatedText,
  userId,
  formType
);

// 3. If approved by appraiser, store as new reference
if (userApprovesTheSection && voiceResult.verdict !== 'fail') {
  const embedding = await generateEmbedding(generatedText);
  await storeReferenceVoice(
    userId,
    formType,
    `section_${Date.now()}`,
    generatedText,
    embedding
  );
  clearReferenceCache(userId, formType); // Refresh cache
}

// 4. Log for analytics
log.info('section:voice_scored', {
  userId,
  formType,
  verdict: voiceResult.verdict,
  score: voiceResult.score,
});
```

## Phase 3 Dependencies

This scorer is designed to work within the Phase 3 pipeline:

1. **STM Output Normalizer** (upstream): Cleans AI output before voice scoring
2. **AutoTune Classifier** (parallel): Adjusts generation params based on voice feedback
3. **Voice Consistency Scorer** (this module): Measures voice match
4. **QC Engine** (downstream): Applies final approval gate
5. **Feedback Loop** (sink): Records appraiser decisions for learning

## Future Enhancements

- **Multi-section coherence**: Score voice consistency across dependent sections
- **Fine-tuned voice models**: Per-appraiser embedding projections (vs. global text-embedding-3-small)
- **Voice drift analytics**: Dashboard showing appraiser voice stability over time
- **Voice transfer**: Clone one appraiser's voice onto another's drafts
