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
import { z } from 'zod';

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

import { sendErrorResponse } from '../utils/errorResponse.js';
const router = Router();
const objectMutationSchema = z.object({}).passthrough();
const emptyMutationSchema = z.object({}).strict();
const approvedCreateSchema = z.object({
  text: z.string().min(10).max(50000),
  bucket: z.string().max(80).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  formType: z.string().max(40).optional(),
  reportFamily: z.string().max(60).optional(),
  propertyType: z.string().max(80).optional(),
  assignmentType: z.string().max(80).optional(),
  styleTags: z.array(z.string().max(80)).max(200).optional(),
  issueTags: z.array(z.string().max(80)).max(200).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
}).passthrough();
const stagingCreateSchema = z.object({
  text: z.string().min(10).max(50000),
  candidateSource: z.string().max(60).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  formType: z.string().max(40).optional(),
  reportFamily: z.string().max(60).optional(),
  caseId: z.string().max(80).optional(),
  sourceDocumentId: z.string().max(80).optional(),
  sourceRunId: z.string().max(80).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  commentaryType: z.string().max(80).optional(),
}).passthrough();
const stagingRejectSchema = z.object({
  reason: z.string().max(500).optional(),
  reviewedBy: z.string().max(120).optional(),
}).passthrough();
const batchApproveSchema = z.object({
  ids: z.array(z.string().max(80)).min(1).max(500),
  overrides: objectMutationSchema.optional(),
}).passthrough();
const batchRejectSchema = z.object({
  ids: z.array(z.string().max(80)).min(1).max(500),
  reason: z.string().max(500).optional(),
  reviewedBy: z.string().max(120).optional(),
}).passthrough();
const compCommentaryCreateSchema = z.object({
  text: z.string().min(10).max(50000),
  commentaryType: z.string().max(80).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  formType: z.string().max(40).optional(),
  reportFamily: z.string().max(60).optional(),
  subjectPropertyType: z.string().max(80).optional(),
  compPropertyType: z.string().max(80).optional(),
  marketDensity: z.string().max(80).optional(),
  urbanSuburbanRural: z.string().max(80).optional(),
  issueTags: z.array(z.string().max(80)).max(200).optional(),
  adjustmentCategories: z.array(z.string().max(80)).max(200).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
}).passthrough();
const retrievalPreviewSchema = z.object({
  assignmentContext: z.record(z.any()).optional(),
  canonicalFieldId: z.string().max(120),
  reportFamily: z.string().max(60).optional(),
  formType: z.string().max(40).optional(),
  options: z.record(z.any()).optional(),
}).passthrough();
const retrievalRankSchema = z.object({
  canonicalFieldId: z.string().max(120),
}).passthrough();

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

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
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/approved
 * Create a new approved memory item directly (manual curation).
 */
router.post('/approved', (req, res) => {
  const body = parsePayload(approvedCreateSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { text, bucket, canonicalFieldId, formType, reportFamily, propertyType,
            assignmentType, styleTags, issueTags, qualityScore, notes } = body;

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
    return sendErrorResponse(res, err);
  }
});

/**
 * PATCH /api/memory/approved/:id
 * Update an approved memory item.
 */
router.patch('/approved/:id', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const item = getApprovedMemoryById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

    updateApprovedMemory(req.params.id, body);
    const updated = getApprovedMemoryById(req.params.id);
    res.json({ ok: true, item: updated });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/approved/:id
 * Soft-delete (deactivate) an approved memory item.
 */
router.delete('/approved/:id', (req, res) => {
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

  try {
    deactivateApprovedMemory(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/staging
 * Stage a new candidate. Body must include: text, candidateSource, and metadata.
 */
router.post('/staging', (req, res) => {
  const body = parsePayload(stagingCreateSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { text, candidateSource, canonicalFieldId, formType, reportFamily,
            caseId, sourceDocumentId, sourceRunId, qualityScore, commentaryType } = body;

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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/staging/:id/approve
 * Approve a staging candidate and promote to approved memory.
 */
router.post('/staging/:id/approve', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const overrides = body;
    const result = approveCandidate(req.params.id, overrides);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true, promotedId: result.promotedId, bucket: result.bucket });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/staging/:id/reject
 * Reject a staging candidate.
 */
router.post('/staging/:id/reject', (req, res) => {
  const body = parsePayload(stagingRejectSchema, req.body || {}, res);
  if (!body) return;

  try {
    const result = rejectCandidate(req.params.id, {
      reason: body.reason,
      reviewedBy: body.reviewedBy,
    });

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true, status: 'rejected' });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/staging/batch-approve
 * Batch approve multiple candidates.
 */
router.post('/staging/batch-approve', (req, res) => {
  const body = parsePayload(batchApproveSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { ids, overrides } = body;

    const result = batchApprove(ids, overrides || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/staging/batch-reject
 * Batch reject multiple candidates.
 */
router.post('/staging/batch-reject', (req, res) => {
  const body = parsePayload(batchRejectSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { ids, reason, reviewedBy } = body;

    const result = batchReject(ids, { reason, reviewedBy });
    res.json({ ok: true, ...result });
  } catch (err) {
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/voice/profiles
 * Create a new voice profile.
 */
router.post('/voice/profiles', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const id = createVoiceProfile(body);
    const profile = getVoiceProfileById(id);
    res.json({ ok: true, id, profile });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * PATCH /api/memory/voice/profiles/:id
 * Update a voice profile.
 */
router.patch('/voice/profiles/:id', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const existing = getVoiceProfileById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(req.params.id, body);
    const updated = getVoiceProfileById(req.params.id);
    res.json({ ok: true, profile: updated });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/voice/profiles/:id
 * Soft-delete (deactivate) a voice profile.
 */
router.delete('/voice/profiles/:id', (req, res) => {
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

  try {
    const existing = getVoiceProfileById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(req.params.id, { active: false });
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/voice/profiles/:id/rules
 * Create a voice rule for a profile.
 */
router.post('/voice/profiles/:id/rules', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const ruleId = createVoiceRule({
      profileId: req.params.id,
      ...body,
    });
    res.json({ ok: true, id: ruleId });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/voice/rules/:ruleId
 * Delete (deactivate) a voice rule.
 */
router.delete('/voice/rules/:ruleId', (req, res) => {
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

  try {
    deleteVoiceRule(req.params.ruleId);
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/comp-commentary
 * Create a comp commentary item directly.
 */
router.post('/comp-commentary', (req, res) => {
  const body = parsePayload(compCommentaryCreateSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { text, commentaryType, canonicalFieldId, formType, reportFamily,
            subjectPropertyType, compPropertyType, marketDensity, urbanSuburbanRural,
            issueTags, adjustmentCategories, qualityScore } = body;

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
    return sendErrorResponse(res, err);
  }
});

/**
 * PATCH /api/memory/comp-commentary/:id
 * Update a comp commentary item.
 */
router.patch('/comp-commentary/:id', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    updateCompCommentary(req.params.id, body);
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/comp-commentary/:id
 * Deactivate a comp commentary item.
 */
router.delete('/comp-commentary/:id', (req, res) => {
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

  try {
    deactivateCompCommentary(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
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
  const body = parsePayload(retrievalPreviewSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { assignmentContext, canonicalFieldId, reportFamily, formType, options } = body;

    const pack = buildRetrievalPack({
      assignmentContext: assignmentContext || {},
      canonicalFieldId,
      reportFamily,
      formType,
      options,
    });

    res.json({ ok: true, pack });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/retrieval/rank
 * Preview retrieval ranking for approved memory.
 * Returns scored candidates with full breakdowns.
 */
router.post('/retrieval/rank', (req, res) => {
  const query = parsePayload(retrievalRankSchema, req.body || {}, res);
  if (!query) return;

  try {
    const result = rankApprovedMemory(query);
    res.json({ ok: true, ...result });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/retrieval/rank-comp
 * Preview retrieval ranking for comp commentary.
 */
router.post('/retrieval/rank-comp', (req, res) => {
  const body = parsePayload(objectMutationSchema, req.body || {}, res);
  if (!body) return;

  try {
    const result = rankCompCommentary(body);
    res.json({ ok: true, ...result });
  } catch (err) {
    return sendErrorResponse(res, err);
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
    return sendErrorResponse(res, err);
  }
});

export default router;
