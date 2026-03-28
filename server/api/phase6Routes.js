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
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';

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

// ── Parameter schemas ─────────────────────────────────────────────────────────
const idParamSchema = z.object({
  id: z.string().min(1),
});

const ruleIdParamSchema = z.object({
  ruleId: z.string().min(1),
});

// ── Query schemas ─────────────────────────────────────────────────────────────
const approvedListQuerySchema = z.object({
  bucket: z.string().max(80).optional(),
  formType: z.string().max(40).optional(),
  reportFamily: z.string().max(60).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  sourceType: z.string().max(60).optional(),
  propertyType: z.string().max(80).optional(),
  approvalStatus: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: z.enum(['true', 'false']).optional(),
}).passthrough();

const stagingListQuerySchema = z.object({
  reviewStatus: z.string().max(40).default('pending'),
  candidateSource: z.string().max(60).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  formType: z.string().max(40).optional(),
  caseId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).passthrough();

const voiceProfilesListQuerySchema = z.object({
  scope: z.string().max(80).optional(),
  reportFamily: z.string().max(60).optional(),
  canonicalFieldId: z.string().max(120).optional(),
}).passthrough();

const voiceResolveQuerySchema = z.object({
  canonicalFieldId: z.string().max(120).optional(),
  reportFamily: z.string().max(60).optional(),
}).passthrough();

const voiceRulesListQuerySchema = z.object({
  ruleType: z.string().max(80).optional(),
  canonicalFieldId: z.string().max(120).optional(),
}).passthrough();

const compCommentaryListQuerySchema = z.object({
  commentaryType: z.string().max(80).optional(),
  reportFamily: z.string().max(60).optional(),
  formType: z.string().max(40).optional(),
  canonicalFieldId: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
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
router.get('/approved', validateQuery(approvedListQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const filters = {
      bucket: q.bucket,
      formType: q.formType,
      reportFamily: q.reportFamily,
      canonicalFieldId: q.canonicalFieldId,
      sourceType: q.sourceType,
      propertyType: q.propertyType,
      approvalStatus: q.approvalStatus,
      limit: q.limit,
      offset: q.offset,
      includeInactive: q.includeInactive === 'true',
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
router.get('/approved/:id', validateParams(idParamSchema), (req, res) => {
  try {
    const item = getApprovedMemoryById(req.validatedParams.id);
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
router.post('/approved', validateBody(approvedCreateSchema), (req, res) => {
  try {
    const { text, bucket, canonicalFieldId, formType, reportFamily, propertyType,
            assignmentType, styleTags, issueTags, qualityScore, notes } = req.validated;

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
router.patch('/approved/:id', validateParams(idParamSchema), validateBody(objectMutationSchema), (req, res) => {
  try {
    const id = req.validatedParams.id;
    const item = getApprovedMemoryById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });

    updateApprovedMemory(id, req.validated);
    const updated = getApprovedMemoryById(id);
    res.json({ ok: true, item: updated });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/approved/:id
 * Soft-delete (deactivate) an approved memory item.
 */
router.delete('/approved/:id', validateParams(idParamSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    deactivateApprovedMemory(req.validatedParams.id);
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
router.get('/staging', validateQuery(stagingListQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const filters = {
      reviewStatus: q.reviewStatus,
      candidateSource: q.candidateSource,
      canonicalFieldId: q.canonicalFieldId,
      formType: q.formType,
      caseId: q.caseId,
      limit: q.limit,
      offset: q.offset,
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
router.get('/staging/:id', validateParams(idParamSchema), (req, res) => {
  try {
    const item = getStagingCandidateById(req.validatedParams.id);
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
router.post('/staging', validateBody(stagingCreateSchema), (req, res) => {
  try {
    const { text, candidateSource, canonicalFieldId, formType, reportFamily,
            caseId, sourceDocumentId, sourceRunId, qualityScore, commentaryType } = req.validated;

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
router.post('/staging/:id/approve', validateParams(idParamSchema), validateBody(objectMutationSchema), (req, res) => {
  try {
    const overrides = req.validated;
    const result = approveCandidate(req.validatedParams.id, overrides);

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
router.post('/staging/:id/reject', validateParams(idParamSchema), validateBody(stagingRejectSchema), (req, res) => {
  try {
    const result = rejectCandidate(req.validatedParams.id, {
      reason: req.validated.reason,
      reviewedBy: req.validated.reviewedBy,
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
router.post('/staging/batch-approve', validateBody(batchApproveSchema), (req, res) => {
  try {
    const { ids, overrides } = req.validated;

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
router.post('/staging/batch-reject', validateBody(batchRejectSchema), (req, res) => {
  try {
    const { ids, reason, reviewedBy } = req.validated;

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
router.get('/voice/profiles', validateQuery(voiceProfilesListQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const filters = {
      scope: q.scope,
      reportFamily: q.reportFamily,
      canonicalFieldId: q.canonicalFieldId,
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
router.get('/voice/profiles/:id', validateParams(idParamSchema), (req, res) => {
  try {
    const profile = getVoiceProfileById(req.validatedParams.id);
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
router.post('/voice/profiles', validateBody(objectMutationSchema), (req, res) => {
  try {
    const id = createVoiceProfile(req.validated);
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
router.patch('/voice/profiles/:id', validateParams(idParamSchema), validateBody(objectMutationSchema), (req, res) => {
  try {
    const id = req.validatedParams.id;
    const existing = getVoiceProfileById(id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(id, req.validated);
    const updated = getVoiceProfileById(id);
    res.json({ ok: true, profile: updated });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/voice/profiles/:id
 * Soft-delete (deactivate) a voice profile.
 */
router.delete('/voice/profiles/:id', validateParams(idParamSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    const id = req.validatedParams.id;
    const existing = getVoiceProfileById(id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    updateVoiceProfile(id, { active: false });
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
router.get('/voice/resolve', validateQuery(voiceResolveQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const profile = resolveVoiceProfile({
      canonicalFieldId: q.canonicalFieldId || null,
      reportFamily: q.reportFamily || null,
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
router.get('/voice/profiles/:id/rules', validateParams(idParamSchema), validateQuery(voiceRulesListQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const rules = listVoiceRules(req.validatedParams.id, {
      ruleType: q.ruleType,
      canonicalFieldId: q.canonicalFieldId,
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
router.post('/voice/profiles/:id/rules', validateParams(idParamSchema), validateBody(objectMutationSchema), (req, res) => {
  try {
    const ruleId = createVoiceRule({
      profileId: req.validatedParams.id,
      ...req.validated,
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
router.delete('/voice/rules/:ruleId', validateParams(ruleIdParamSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    deleteVoiceRule(req.validatedParams.ruleId);
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
router.get('/comp-commentary', validateQuery(compCommentaryListQuerySchema), (req, res) => {
  try {
    const q = req.validatedQuery;
    const filters = {
      commentaryType: q.commentaryType,
      reportFamily: q.reportFamily,
      formType: q.formType,
      canonicalFieldId: q.canonicalFieldId,
      limit: q.limit,
      offset: q.offset,
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
router.post('/comp-commentary', validateBody(compCommentaryCreateSchema), (req, res) => {
  try {
    const { text, commentaryType, canonicalFieldId, formType, reportFamily,
            subjectPropertyType, compPropertyType, marketDensity, urbanSuburbanRural,
            issueTags, adjustmentCategories, qualityScore } = req.validated;

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
router.patch('/comp-commentary/:id', validateParams(idParamSchema), validateBody(objectMutationSchema), (req, res) => {
  try {
    updateCompCommentary(req.validatedParams.id, req.validated);
    res.json({ ok: true });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * DELETE /api/memory/comp-commentary/:id
 * Deactivate a comp commentary item.
 */
router.delete('/comp-commentary/:id', validateParams(idParamSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    deactivateCompCommentary(req.validatedParams.id);
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
router.post('/retrieval/preview', validateBody(retrievalPreviewSchema), (req, res) => {
  try {
    const { assignmentContext, canonicalFieldId, reportFamily, formType, options } = req.validated;

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
router.post('/retrieval/rank', validateBody(retrievalRankSchema), (req, res) => {
  try {
    const result = rankApprovedMemory(req.validated);
    res.json({ ok: true, ...result });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

/**
 * POST /api/memory/retrieval/rank-comp
 * Preview retrieval ranking for comp commentary.
 */
router.post('/retrieval/rank-comp', validateBody(objectMutationSchema), (req, res) => {
  try {
    const result = rankCompCommentary(req.validated);
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
