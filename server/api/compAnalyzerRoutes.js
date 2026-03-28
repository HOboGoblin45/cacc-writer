/**
 * server/api/compAnalyzerRoutes.js
 * ---------------------------------
 * Smart Comp Analyzer — AI-powered comp scoring, adjustment suggestions,
 * and narrative generation.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST /api/cases/:caseId/analyze-comps  — AI-score comps, suggest adjustments, generate narrative
 *   POST /api/cases/:caseId/comps          — CRUD: save manually entered comps to case
 *   GET  /api/cases/:caseId/comps          — retrieve saved comps for case
 */

import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

import { casePath } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';
import { validateParams, validateBody, CommonSchemas } from '../middleware/validateRequest.js';

const router = Router();

/**
 * Zod schemas for request validation
 */
const CompSchema = z.record(z.any());
const AnalyzeCompsBody = z.object({
  comps: z.array(CompSchema).min(1),
});
const SaveCompsBody = z.object({
  comps: z.array(CompSchema).min(1),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureCaseDir(caseId) {
  const cd = casePath(caseId);
  fs.mkdirSync(cd, { recursive: true });
  return cd;
}

function getSubjectFacts(projection) {
  const facts = projection?.facts || {};
  return facts?.subject || facts || {};
}

/**
 * Parse a dollar amount from any value (number, string with $, commas, etc.)
 */
function parseDollar(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[$,\s]/g, '')) || 0;
}

/**
 * Parse a numeric value from various formats
 */
function parseNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

// ── POST /cases/:caseId/analyze-comps ─────────────────────────────────────────

/**
 * AI-powered comp analyzer.
 * Scores each comp 0-100 on similarity to subject, suggests dollar adjustments,
 * calculates adjusted prices, and generates a URAR sales comparison narrative.
 */
router.post(
  '/cases/:caseId/analyze-comps',
  validateParams(CommonSchemas.caseId),
  validateBody(AnalyzeCompsBody),
  async (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const projection = getCaseProjection(caseId);
      if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

      const { comps } = req.validated;

    const subject = getSubjectFacts(projection);
    const meta = projection.meta || {};

    // Build AI prompt
    const systemPrompt = `You are an expert residential real estate appraiser with 20+ years of experience. 
You specialize in analyzing comparable sales and producing URAR-compliant adjustment grids.
Always respond with valid JSON only — no markdown, no prose outside the JSON structure.`;

    const userPrompt = `Analyze these comparable sales against the subject property for a residential appraisal report.

SUBJECT PROPERTY:
${JSON.stringify(subject, null, 2)}

COMPARABLE SALES (${comps.length} total):
${JSON.stringify(comps, null, 2)}

For each comparable sale, provide:
1. similarityScore (0-100): How similar is this comp to the subject? Consider location (proximity, neighborhood), physical characteristics (GLA, age, condition, quality, bedrooms, bathrooms, garage, basement), and market conditions.
2. suggestedAdjustments: Dollar adjustments for each difference. Use negative values when comp is superior to subject. Common adjustment categories:
   - site: lot size difference ($/sf or lump sum)
   - age: year built difference ($500-2000/year typically)
   - condition: C1-C6 UAD condition rating differences
   - quality: Q1-Q6 UAD quality rating differences  
   - gla: gross living area difference ($50-150/sf typically)
   - bedrooms: bedroom count difference
   - bathrooms: bathroom count difference
   - garage: garage/carport differences
   - basement: basement GLA and finish differences
   - pool: pool presence/absence
   - other: any other significant differences
3. adjustedPrice: sale price after all adjustments applied
4. netAdjustment: total net dollar adjustment
5. grossAdjustment: sum of absolute values of all adjustments
6. notes: brief explanation of key adjustments

Also provide:
- narrative: A 2-3 paragraph "Comments on Sales Comparison Approach" suitable for the URAR form. Explain why these comps were selected, their relative quality, and what they indicate about value. Use professional appraisal language.
- indicatedValueRange: { low: number, high: number, midpoint: number } based on the adjusted sale prices

Respond with this exact JSON structure:
{
  "comps": [
    {
      "address": "...",
      "salePrice": number,
      "similarityScore": number,
      "suggestedAdjustments": {
        "site": number,
        "age": number,
        "condition": number,
        "quality": number,
        "gla": number,
        "bedrooms": number,
        "bathrooms": number,
        "garage": number,
        "basement": number,
        "pool": number,
        "other": number
      },
      "netAdjustment": number,
      "grossAdjustment": number,
      "adjustedPrice": number,
      "notes": "..."
    }
  ],
  "narrative": "...",
  "indicatedValueRange": { "low": number, "high": number, "midpoint": number }
}`;

    log.info('comp-analyzer:ai-call', { caseId, compCount: comps.length });

    const rawResponse = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.3, maxTokens: 4000 });

    // Parse AI response
    let analysis;
    try {
      // Strip markdown code fences if present
      const cleaned = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      log.error('comp-analyzer:parse-error', { error: parseErr.message, raw: rawResponse.slice(0, 500) });
      return res.status(500).json({
        ok: false,
        error: 'AI returned malformed JSON. Try again.',
        detail: parseErr.message,
      });
    }

    // Merge original comp data with AI analysis
    const enrichedComps = (analysis.comps || []).map((aiComp, i) => {
      const originalComp = comps[i] || {};
      return {
        ...originalComp,
        ...aiComp,
        salePrice: parseDollar(originalComp.salePrice || aiComp.salePrice),
      };
    });

    const result = {
      comps: enrichedComps,
      narrative: analysis.narrative || '',
      indicatedValueRange: analysis.indicatedValueRange || null,
      analyzedAt: new Date().toISOString(),
      compCount: enrichedComps.length,
    };

    // Save results to case
    const cd = ensureCaseDir(caseId);
    writeJSON(path.join(cd, 'comp_analysis.json'), result);

    // Update case facts with analysis summary
    try {
      const facts = projection.facts || {};
      facts.compAnalysis = {
        analyzedAt: result.analyzedAt,
        compCount: enrichedComps.length,
        indicatedValueRange: result.indicatedValueRange,
        narrative: result.narrative,
      };
      facts.updatedAt = new Date().toISOString();
      saveCaseProjection({ ...projection, facts });
    } catch (saveErr) {
      log.warn('comp-analyzer:save-projection-warning', { error: saveErr.message });
    }

    log.info('comp-analyzer:complete', { caseId, compCount: enrichedComps.length });

    res.json({ ok: true, ...result });
    } catch (err) {
      log.error('comp-analyzer:error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /cases/:caseId/comps ─────────────────────────────────────────────────

/**
 * Save manually entered or edited comps to the case.
 * Body: { comps: [...] }
 */
router.post(
  '/cases/:caseId/comps',
  validateParams(CommonSchemas.caseId),
  validateBody(SaveCompsBody),
  async (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const projection = getCaseProjection(caseId);
      if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

      const { comps } = req.validated;

    const cd = ensureCaseDir(caseId);
    const payload = {
      savedAt: new Date().toISOString(),
      source: 'manual',
      comps,
    };

    writeJSON(path.join(cd, 'comps.json'), payload);

    // Mirror into facts for quick access
    try {
      const facts = projection.facts || {};
      facts.manualComps = comps;
      facts.updatedAt = new Date().toISOString();
      saveCaseProjection({ ...projection, facts });
    } catch (saveErr) {
      log.warn('comps:save-projection-warning', { error: saveErr.message });
    }

    log.info('comps:saved', { caseId, count: comps.length });

    res.json({ ok: true, saved: comps.length, savedAt: payload.savedAt });
    } catch (err) {
      log.error('comps:save-error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /cases/:caseId/comps ──────────────────────────────────────────────────

/**
 * Retrieve saved comps for a case.
 */
router.get('/cases/:caseId/comps', validateParams(CommonSchemas.caseId), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const cd = casePath(caseId);
    const compsData = readJSON(path.join(cd, 'comps.json'), null);
    const analysisData = readJSON(path.join(cd, 'comp_analysis.json'), null);

    res.json({
      ok: true,
      comps: compsData?.comps || [],
      savedAt: compsData?.savedAt || null,
      analysis: analysisData || null,
    });
  } catch (err) {
    log.error('comps:get-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
