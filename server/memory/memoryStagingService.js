/**
 * server/memory/memoryStagingService.js
 * ----------------------------------------
 * Phase 6 — Memory Staging & Promotion Service
 *
 * Handles the workflow that promotes material into trusted memory:
 *   - Stage candidates from various sources
 *   - Review / approve / reject / edit candidates
 *   - Promote approved candidates into the correct memory bucket
 *   - Prevent raw/unreviewed material from entering approved memory
 *
 * Sources:
 *   - extracted narrative sections from prior reports (Phase 5)
 *   - approved generated sections from recent runs
 *   - edited final sections that the appraiser corrected
 *   - phrase candidates
 *   - comparable commentary candidates
 *   - voice exemplar candidates
 */

import {
  createStagingCandidate,
  getStagingCandidateById,
  updateStagingCandidate,
  listStagingCandidates,
  countStagingCandidates,
  stagingHashExists,
  textHash,
  createApprovedMemory,
  approvedMemoryHashExists,
  createCompCommentary,
} from '../db/repositories/memoryRepo.js';

// ── Stage Candidates ────────────────────────────────────────────────────────

/**
 * Stage a narrative section extracted from a prior report (Phase 5 output).
 *
 * @param {Object} params
 * @param {string} params.text — the narrative text
 * @param {string} params.sectionType — canonical field ID or legacy section ID
 * @param {string} [params.formType]
 * @param {string} [params.caseId]
 * @param {string} [params.sourceDocumentId]
 * @param {string} [params.extractionId]
 * @param {number} [params.qualityScore]
 * @returns {{ id: string, status: string } | { skipped: true, reason: string }}
 */
export function stageExtractedNarrative(params) {
  const { text, sectionType, formType, caseId, sourceDocumentId, extractionId, qualityScore } = params;

  if (!text || text.trim().length < 20) {
    return { skipped: true, reason: 'text too short (< 20 chars)' };
  }

  const hash = textHash(text);

  // Dedup: skip if already staged or already in approved memory
  if (stagingHashExists(hash)) {
    return { skipped: true, reason: 'duplicate: already staged' };
  }
  if (approvedMemoryHashExists(hash)) {
    return { skipped: true, reason: 'duplicate: already in approved memory' };
  }

  const id = createStagingCandidate({
    candidateSource: 'extracted_narrative',
    text: text.trim(),
    textHash: hash,
    targetBucket: 'narrative_section',
    canonicalFieldId: sectionType,
    formType,
    caseId,
    sourceDocumentId,
    sourceSectionId: extractionId || null,
    qualityScore: qualityScore ?? 50,
  });

  return { id, status: 'staged' };
}

/**
 * Stage an approved/edited generated section from a recent run.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.sectionId — canonical field ID
 * @param {string} params.runId
 * @param {string} params.caseId
 * @param {string} [params.formType]
 * @param {string} [params.reportFamily]
 * @param {number} [params.qualityScore]
 * @returns {{ id: string, status: string } | { skipped: true, reason: string }}
 */
export function stageGeneratedSection(params) {
  const { text, sectionId, runId, caseId, formType, reportFamily, qualityScore } = params;

  if (!text || text.trim().length < 20) {
    return { skipped: true, reason: 'text too short' };
  }

  const hash = textHash(text);
  if (stagingHashExists(hash)) return { skipped: true, reason: 'duplicate: already staged' };
  if (approvedMemoryHashExists(hash)) return { skipped: true, reason: 'duplicate: already approved' };

  const id = createStagingCandidate({
    candidateSource: 'generated_section',
    text: text.trim(),
    textHash: hash,
    targetBucket: 'narrative_section',
    canonicalFieldId: sectionId,
    formType,
    reportFamily,
    caseId,
    sourceRunId: runId,
    qualityScore: qualityScore ?? 65,
  });

  return { id, status: 'staged' };
}

/**
 * Stage a phrase bank candidate.
 */
export function stagePhrase(params) {
  const { text, canonicalFieldId, formType, reportFamily, qualityScore } = params;

  if (!text || text.trim().length < 5) {
    return { skipped: true, reason: 'phrase too short' };
  }

  const hash = textHash(text);
  if (stagingHashExists(hash)) return { skipped: true, reason: 'duplicate' };
  if (approvedMemoryHashExists(hash)) return { skipped: true, reason: 'already approved' };

  const id = createStagingCandidate({
    candidateSource: 'phrase_candidate',
    text: text.trim(),
    textHash: hash,
    targetBucket: 'phrase_bank',
    canonicalFieldId,
    formType,
    reportFamily,
    qualityScore: qualityScore ?? 60,
  });

  return { id, status: 'staged' };
}

/**
 * Stage a voice exemplar candidate.
 */
export function stageVoiceExemplar(params) {
  const { text, canonicalFieldId, formType, reportFamily, sourceDocumentId, qualityScore } = params;

  if (!text || text.trim().length < 30) {
    return { skipped: true, reason: 'exemplar too short' };
  }

  const hash = textHash(text);
  if (stagingHashExists(hash)) return { skipped: true, reason: 'duplicate' };
  if (approvedMemoryHashExists(hash)) return { skipped: true, reason: 'already approved' };

  const id = createStagingCandidate({
    candidateSource: 'voice_exemplar',
    text: text.trim(),
    textHash: hash,
    targetBucket: 'voice_exemplar',
    canonicalFieldId,
    formType,
    reportFamily,
    sourceDocumentId,
    qualityScore: qualityScore ?? 70,
  });

  return { id, status: 'staged' };
}

/**
 * Stage a comparable commentary candidate.
 */
export function stageCompCommentary(params) {
  const { text, commentaryType, canonicalFieldId, formType, reportFamily, qualityScore } = params;

  if (!text || text.trim().length < 20) {
    return { skipped: true, reason: 'commentary too short' };
  }

  const hash = textHash(text);
  if (stagingHashExists(hash)) return { skipped: true, reason: 'duplicate' };

  const id = createStagingCandidate({
    candidateSource: 'comp_commentary',
    text: text.trim(),
    textHash: hash,
    targetBucket: 'comp_commentary',
    canonicalFieldId,
    formType,
    reportFamily,
    qualityScore: qualityScore ?? 60,
    issueTags: commentaryType ? [commentaryType] : [],
  });

  return { id, status: 'staged' };
}

// ── Review Actions ──────────────────────────────────────────────────────────

/**
 * Approve a staging candidate and promote it into the correct memory bucket.
 *
 * @param {string} candidateId
 * @param {Object} [overrides] — optional metadata overrides before promotion
 * @param {string} [overrides.text] — edited text
 * @param {string} [overrides.canonicalFieldId]
 * @param {string} [overrides.reportFamily]
 * @param {string} [overrides.formType]
 * @param {string} [overrides.propertyType]
 * @param {number} [overrides.qualityScore]
 * @param {string[]} [overrides.styleTags]
 * @param {string[]} [overrides.issueTags]
 * @param {string} [overrides.approvedBy]
 * @returns {{ promotedId: string, bucket: string } | { error: string }}
 */
export function approveCandidate(candidateId, overrides = {}) {
  const candidate = getStagingCandidateById(candidateId);
  if (!candidate) return { error: 'Candidate not found' };
  if (candidate.reviewStatus !== 'pending') {
    return { error: `Candidate already ${candidate.reviewStatus}` };
  }

  // Apply overrides
  const finalText = (overrides.text || candidate.text).trim();
  const finalHash = textHash(finalText);

  // Check for duplicates in approved memory
  if (approvedMemoryHashExists(finalHash)) {
    // Mark as rejected with reason
    updateStagingCandidate(candidateId, {
      reviewStatus: 'rejected',
      reviewNotes: 'Duplicate: text already exists in approved memory',
      reviewedBy: overrides.approvedBy || null,
    });
    return { error: 'Duplicate: text already exists in approved memory' };
  }

  const bucket = overrides.targetBucket || candidate.targetBucket || 'narrative_section';
  let promotedId;

  // Route to correct memory store based on bucket
  if (bucket === 'comp_commentary') {
    promotedId = createCompCommentary({
      text: finalText,
      textHash: finalHash,
      commentaryType: (candidate.issueTags || [])[0] || 'general',
      canonicalFieldId: overrides.canonicalFieldId || candidate.canonicalFieldId,
      reportFamily: overrides.reportFamily || candidate.reportFamily,
      formType: overrides.formType || candidate.formType,
      qualityScore: overrides.qualityScore ?? candidate.qualityScore ?? 75,
      approvedBy: overrides.approvedBy || null,
      sourceDocumentId: candidate.sourceDocumentId,
      sourceRunId: candidate.sourceRunId,
      caseId: candidate.caseId,
      provenanceNote: `Promoted from staging candidate ${candidateId}`,
    });
  } else {
    // All other buckets go to approved_memory
    promotedId = createApprovedMemory({
      bucket,
      sourceType: mapCandidateSourceToMemorySource(candidate.candidateSource),
      text: finalText,
      textHash: finalHash,
      sourceDocumentId: candidate.sourceDocumentId,
      sourceRunId: candidate.sourceRunId,
      sourceSectionId: candidate.sourceSectionId,
      caseId: candidate.caseId,
      reportFamily: overrides.reportFamily || candidate.reportFamily,
      formType: overrides.formType || candidate.formType,
      propertyType: overrides.propertyType || candidate.propertyType,
      canonicalFieldId: overrides.canonicalFieldId || candidate.canonicalFieldId,
      styleTags: overrides.styleTags || candidate.styleTags || [],
      issueTags: overrides.issueTags || candidate.issueTags || [],
      qualityScore: overrides.qualityScore ?? candidate.qualityScore ?? 75,
      approvedBy: overrides.approvedBy || null,
      provenanceNote: `Promoted from staging candidate ${candidateId} (source: ${candidate.candidateSource})`,
    });
  }

  // Update the staging candidate
  updateStagingCandidate(candidateId, {
    reviewStatus: 'approved',
    reviewedBy: overrides.approvedBy || null,
    promotedMemoryId: promotedId,
    promotedAt: new Date().toISOString(),
    text: overrides.text ? finalText : undefined,
    canonicalFieldId: overrides.canonicalFieldId,
    reportFamily: overrides.reportFamily,
    formType: overrides.formType,
    propertyType: overrides.propertyType,
    qualityScore: overrides.qualityScore,
    styleTags: overrides.styleTags,
    issueTags: overrides.issueTags,
  });

  return { promotedId, bucket };
}

/**
 * Reject a staging candidate.
 *
 * @param {string} candidateId
 * @param {Object} [params]
 * @param {string} [params.reason]
 * @param {string} [params.reviewedBy]
 */
export function rejectCandidate(candidateId, params = {}) {
  const candidate = getStagingCandidateById(candidateId);
  if (!candidate) return { error: 'Candidate not found' };
  if (candidate.reviewStatus !== 'pending') {
    return { error: `Candidate already ${candidate.reviewStatus}` };
  }

  updateStagingCandidate(candidateId, {
    reviewStatus: 'rejected',
    reviewNotes: params.reason || null,
    reviewedBy: params.reviewedBy || null,
  });

  return { status: 'rejected' };
}

/**
 * Batch approve multiple candidates.
 *
 * @param {string[]} candidateIds
 * @param {Object} [overrides]
 * @returns {{ approved: number, rejected: number, errors: string[] }}
 */
export function batchApprove(candidateIds, overrides = {}) {
  let approved = 0;
  let rejected = 0;
  const errors = [];

  for (const id of candidateIds) {
    const result = approveCandidate(id, overrides);
    if (result.promotedId) {
      approved++;
    } else {
      rejected++;
      if (result.error) errors.push(`${id}: ${result.error}`);
    }
  }

  return { approved, rejected, errors };
}

/**
 * Batch reject multiple candidates.
 */
export function batchReject(candidateIds, params = {}) {
  let rejected = 0;
  const errors = [];

  for (const id of candidateIds) {
    const result = rejectCandidate(id, params);
    if (result.status === 'rejected') {
      rejected++;
    } else if (result.error) {
      errors.push(`${id}: ${result.error}`);
    }
  }

  return { rejected, errors };
}

// ── Staging Summary ─────────────────────────────────────────────────────────

/**
 * Get a summary of staging queue status.
 */
export function getStagingSummary() {
  return {
    pending: countStagingCandidates({ reviewStatus: 'pending' }),
    approved: countStagingCandidates({ reviewStatus: 'approved' }),
    rejected: countStagingCandidates({ reviewStatus: 'rejected' }),
    bySource: {
      extracted_narrative: countStagingCandidates({ reviewStatus: 'pending', candidateSource: 'extracted_narrative' }),
      generated_section: countStagingCandidates({ reviewStatus: 'pending', candidateSource: 'generated_section' }),
      phrase_candidate: countStagingCandidates({ reviewStatus: 'pending', candidateSource: 'phrase_candidate' }),
      voice_exemplar: countStagingCandidates({ reviewStatus: 'pending', candidateSource: 'voice_exemplar' }),
      comp_commentary: countStagingCandidates({ reviewStatus: 'pending', candidateSource: 'comp_commentary' }),
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map candidate source to approved memory source type.
 */
function mapCandidateSourceToMemorySource(candidateSource) {
  const map = {
    extracted_narrative: 'imported',
    generated_section: 'generated',
    phrase_candidate: 'curated',
    voice_exemplar: 'voice_exemplar',
    comp_commentary: 'curated',
    manual: 'curated',
  };
  return map[candidateSource] || 'imported';
}
