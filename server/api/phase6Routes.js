/**
 * server/api/phase6Routes.js
 * ----------------------------
 * Phase 6 — Memory, Voice, and Proprietary Writing Engine API Routes
 *
 * Mounted at: /api/memory (in cacc-writer-server.js)
 *
 * Route groups:
 *   /approved          — approved memory CRUD
 *   /staging           — staging candidate review workflow
 *   /voice             — voice profile management
 *   /comp-commentary   — comparable commentary memory
 *   /retrieval         — retrieval pack preview / explainability
 *   /summary           — memory system status
 */

import { Router } from 'express';

// ── Repository layer ──────────────────────────────────────────────────────────
import {
  listApprovedMemory,
  getApprovedMemoryById,
  createApprovedMemory,
  updateApprovedMemory,
  deactivateApprovedMemory,
  countApprovedMemory,
  listVoiceProfiles,
  getVoiceProfileById,
  createVoiceProfile,
  updateVoiceProfile,
  resolveVoiceProfile,
  listVoiceRules,
  createVoiceRule,
  deleteVoiceRule,
  listCompCommentary,
  createCompCommentary,
  updateCompCommentary,
  deactivateCompCommentary,
  listStagingCandidates,
  getStagingCandidateById,
  countStagingCandidates,
  getMemorySummary,
} from '../db/repositories/memoryRepo.js';

// ── Service layer ─────────────────────────────────────────────────────────────
import {
  stageExtractedNarrative,
  stageGeneratedSection,
  stagePhrase,
  stageVoiceExemplar,
  stageCompCommentary as stageCompCommentaryCandidate,
  approveCandidate,
  rejectCandidate,
  batchApprove,
  batchReject,
  getStagingSummary,
} from '../memory/memoryStagingService.js';

// ── Retrieval layer ───────────────────────────────────────────────────────────
import { buildRetrievalPack } from '../memory/retrievalPackBuilder.js';
import { rankApprovedMemory, rankCompCommentary } from '../memory/retrievalRankingEngine.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// APPROVED MEMORY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/memory/approved
 * List approved memory items with optional filters.
 * Query params: bucket, formType, reportFamily, canonicalFieldId, sourceType,
 *               propertyType, approvalStatus, limit, offset, includeInactive
 */
router.get('/approved', (req, res) => {
  try {
    const filters = {
      bucket: req.query.bucket || undefined,
      formType: req.query.formType || undefined,
      reportFamily: req.query.reportFamily || undefined,
      canonicalFieldId: req.query.canonicalFieldId || undefined,
      sourceType: req.query.sourceType || undefined,
      propertyType: req.query.propertyType || undefined,
      approvalStatus: req.query.approvalStatus || undefined,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
      includeInactive: req.query.includeInactive === 'true',
    };

    const items = listApprovedMemory(filters);
    const total = countApprovedMemory(filters);

    res.json({ ok: true, items, total, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/approved/:id
 * Get a single approved memory item.
 */
router.get('/approved/:id', (req, res) => {
  try {
    const item = getApprovedMemoryById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/approved
 * Create a new approved memory item directly (manual curation).
 */
router.post('/approved', (req, res) => {
  try {
    const { text, bucket, canonicalFieldId, formType, reportFamily, propertyType,
            assignmentType, styleTags, issueTags, qualityScore, notes } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ ok: false, error: 'Text is required (min 10 chars)' });
    }

    const id = createApprovedMemory({
      text: text.trim(),
      bucket: bucket || 'narrative_section',
      sourceType: 'curated',
      canonicalFieldId,
      formType,
      reportFamily,
      propertyType,
      assignmentType,
      styleTags: styleTags || [],
      issueTags: issueTags || [],
      qualityScore: qualityScore ?? 80,
      approvedBy: 'manual',
      notes,
      provenanceNote: 'Manually curated via UI',
    });

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/memory/approved/:id
 * Update an approved memory item.
 */
router.patch('/approved/:id', (req, res) => {
  try {
    const item = getApprovedMemoryById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

    updateApprovedMemory(req.params.id, req.body);
    const updated = getApprovedMemoryById(req.params.id);
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/memory/approved/:id
 * Soft-delete (deactivate) an approved memory item.
 */
router.delete('/approved/:id', (req, res) => {
  try {
    deactivateApprovedMemory(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGING CANDIDATES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/memory/staging
 * List staging candidates with filters.
 * Query params: reviewStatus, candidateSource, canonicalFieldId, formType, caseId, limit, offset
 */
router.get('/staging', (req, res) => {
  try {
    const filters = {
      reviewStatus: req.query.reviewStatus || 'pending',
      candidateSource: req.query.candidateSource || undefined,
      canonicalFieldId: req.query.canonicalFieldId || undefined,
      formType: req.query.formType || undefined,
      caseId: req.query.caseId || undefined,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    };

    const items = listStagingCandidates(filters);
    const total = countStagingCandidates({ reviewStatus: filters.reviewStatus });

    res.json({ ok: true, items, total, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/staging/summary
 * Get staging queue summary.
 */
router.get('/staging/summary', (_req, res) => {
  try {
    const summary = getStagingSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/staging/:id
 * Get a single staging candidate.
 */
router.get('/staging/:id', (req, res) => {
  try {
    const item = getStagingCandidateById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/staging
 * Stage a new candidate. Body must include: text, candidateSource, and metadata.
 */
router.post('/staging', (req, res) => {
  try {
    const { text, candidateSource, canonicalFieldId, formType, reportFamily,
            caseId, sourceDocumentId, sourceRunId, qualityScore, commentaryType } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ ok: false, error: 'Text is required (min 10 chars)' });
    }

    let result;
    switch (candidateSource) {
      case 'extracted_narrative':
        result = stageExtractedNarrative({ text, sectionType: canonicalFieldId, formType, caseId, sourceDocumentId, qualityScore });
        break;
      case 'generated_section':
        result = stageGeneratedSection({ text, sectionId: canonicalFieldId, runId: sourceRunId, caseId, formType, reportFamily, qualityScore });
        break;
      case 'phrase_candidate':
        result = stagePhrase({ text, canonicalFieldId, formType, reportFamily, qualityScore });
        break;
      case 'voice_exemplar':
        result = stageVoiceExemplar({ text, canonicalFieldId, formType, reportFamily, sourceDocumentId, qualityScore });
        break;
      case 'comp_commentary':
        result = stageCompCommentaryCandidate({ text, commentaryType, canonicalFieldId, formType, reportFamily, qualityScore });
        break;
      default:
        result = stageExtractedNarrative({ text, sectionType: canonicalFieldId, formType, caseId, sourceDocumentId, qualityScore });
    }

    if (result.skipped) {
      return res.json({ ok: true, skipped: true, reason: result.reason });
    }

    res.json({ ok: true, id: result.id, status: result.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/staging/:id/approve
 * Approve a staging candidate and promote to approved memory.
 */
router.post('/staging/:id/approve', (req, res) => {
  try {
    const overrides = req.body || {};
    const result = approveCandidate(req.params.id, overrides);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true, promotedId: result.promotedId, bucket: result.bucket });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/staging/:id/reject
 * Reject a staging candidate.
 */
router.post('/staging/:id/reject', (req, res) => {
  try {
    const result = rejectCandidate(req.params.id, {
      reason: req.body?.reason,
      reviewedBy: req.body?.reviewedBy,
    });

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true, status: 'rejected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/staging/batch-approve
 * Batch approve multiple candidates.
 */
router.post('/staging/batch-approve', (req, res) => {
  try {
    const { ids, overrides } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'ids array is required' });
    }

    const result = batchApprove(ids, overrides || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/staging/batch-reject
 * Batch reject multiple candidates.
 */
router.post('/staging/batch-reject', (req, res) => {
  try {
    const { ids, reason, reviewedBy } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'ids array is required' });
    }

    const result = batchReject(ids, { reason, reviewedBy });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// VOICE PROFILES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/memory/voice/profiles
 * List voice profiles.
 */
router.get('/voice/profiles', (req, res) => {
  try {
    const filters = {
      scope: req.query.scope || undefined,
      reportFamily: req.query.reportFamily || undefined,
      canonicalFieldId: req.query.canonicalFieldId || undefined,
    };
    const profiles = listVoiceProfiles(filters);
    res.json({ ok: true, profiles });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/voice/profiles/:id
 * Get a single voice profile.
 */
router.get('/voice/profiles/:id', (req, res) => {
  try {
    const profile = getVoiceProfileById(req.params.id);
    if (!profile) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/voice/profiles
 * Create a new voice profile.
 */
router.post('/voice/profiles', (req, res) => {
  try {
    const id = createVoiceProfile(req.body);
    const profile = getVoiceProfileById(id);
    res.json({ ok: true, id, profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/memory/voice/profiles/:id
 * Update a voice profile.
 */
router.patch('/voice/profiles/:id', (req, res) => {
  try {
    const existing = getVoiceProfileById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(req.params.id, req.body);
    const updated = getVoiceProfileById(req.params.id);
    res.json({ ok: true, profile: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/memory/voice/profiles/:id
 * Soft-delete (deactivate) a voice profile.
 */
router.delete('/voice/profiles/:id', (req, res) => {
  try {
    const existing = getVoiceProfileById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(req.params.id, { active: false });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/voice/resolve
 * Resolve the effective voice profile for a given context.
 * Query params: canonicalFieldId, reportFamily
 */
router.get('/voice/resolve', (req, res) => {
  try {
    const profile = resolveVoiceProfile({
      canonicalFieldId: req.query.canonicalFieldId || null,
      reportFamily: req.query.reportFamily || null,
    });

    if (!profile) {
      return res.json({ ok: true, profile: null, message: 'No voice profiles configured' });
    }

    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/memory/voice/profiles/:id/rules
 * List voice rules for a profile.
 */
router.get('/voice/profiles/:id/rules', (req, res) => {
  try {
    const rules = listVoiceRules(req.params.id, {
      ruleType: req.query.ruleType || undefined,
      canonicalFieldId: req.query.canonicalFieldId || undefined,
    });
    res.json({ ok: true, rules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/voice/profiles/:id/rules
 * Create a voice rule for a profile.
 */
router.post('/voice/profiles/:id/rules', (req, res) => {
  try {
    const ruleId = createVoiceRule({
      profileId: req.params.id,
      ...req.body,
    });
    res.json({ ok: true, id: ruleId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/memory/voice/rules/:ruleId
 * Delete (deactivate) a voice rule.
 */
router.delete('/voice/rules/:ruleId', (req, res) => {
  try {
    deleteVoiceRule(req.params.ruleId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// COMPARABLE COMMENTARY MEMORY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/memory/comp-commentary
 * List comp commentary items.
 */
router.get('/comp-commentary', (req, res) => {
  try {
    const filters = {
      commentaryType: req.query.commentaryType || undefined,
      reportFamily: req.query.reportFamily || undefined,
      formType: req.query.formType || undefined,
      canonicalFieldId: req.query.canonicalFieldId || undefined,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    };
    const items = listCompCommentary(filters);
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/comp-commentary
 * Create a comp commentary item directly.
 */
router.post('/comp-commentary', (req, res) => {
  try {
    const { text, commentaryType, canonicalFieldId, formType, reportFamily,
            subjectPropertyType, compPropertyType, marketDensity, urbanSuburbanRural,
            issueTags, adjustmentCategories, qualityScore } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ ok: false, error: 'Text is required (min 10 chars)' });
    }

    const id = createCompCommentary({
      text: text.trim(),
      commentaryType: commentaryType || 'general',
      canonicalFieldId,
      formType,
      reportFamily,
      subjectPropertyType,
      compPropertyType,
      marketDensity,
      urbanSuburbanRural,
      issueTags: issueTags || [],
      adjustmentCategories: adjustmentCategories || [],
      qualityScore: qualityScore ?? 75,
      approvedBy: 'manual',
      provenanceNote: 'Manually curated via UI',
    });

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/memory/comp-commentary/:id
 * Update a comp commentary item.
 */
router.patch('/comp-commentary/:id', (req, res) => {
  try {
    updateCompCommentary(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/memory/comp-commentary/:id
 * Deactivate a comp commentary item.
 */
router.delete('/comp-commentary/:id', (req, res) => {
  try {
    deactivateCompCommentary(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// RETRIEVAL PREVIEW / EXPLAINABILITY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/memory/retrieval/preview
 * Preview a retrieval pack for a given section and assignment context.
 * Useful for debugging and understanding what memory will be used.
 */
router.post('/retrieval/preview', (req, res) => {
  try {
    const { assignmentContext, canonicalFieldId, reportFamily, formType, options } = req.body;

    if (!canonicalFieldId) {
      return res.status(400).json({ ok: false, error: 'canonicalFieldId is required' });
    }

    const pack = buildRetrievalPack({
      assignmentContext: assignmentContext || {},
      canonicalFieldId,
      reportFamily,
      formType,
      options,
    });

    res.json({ ok: true, pack });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/retrieval/rank
 * Preview retrieval ranking for approved memory.
 * Returns scored candidates with full breakdowns.
 */
router.post('/retrieval/rank', (req, res) => {
  try {
    const query = req.body;
    if (!query.canonicalFieldId) {
      return res.status(400).json({ ok: false, error: 'canonicalFieldId is required' });
    }

    const result = rankApprovedMemory(query);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/memory/retrieval/rank-comp
 * Preview retrieval ranking for comp commentary.
 */
router.post('/retrieval/rank-comp', (req, res) => {
  try {
    const result = rankCompCommentary(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SYSTEM SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/memory/summary
 * Get overall memory system status.
 */
router.get('/summary', (_req, res) => {
  try {
    const summary = getMemorySummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
