/**
 * server/api/aiQcRoutes.js
 * -------------------------
 * AI-powered Quality Control Reviewer for appraisal reports.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST /api/cases/:caseId/qc-review        — full AI QC review of all case outputs
 *   GET  /api/cases/:caseId/qc-review/latest — retrieve last QC review result
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
import { validateParams, CommonSchemas } from '../middleware/validateRequest.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureCaseDir(caseId) {
  const cd = casePath(caseId);
  fs.mkdirSync(cd, { recursive: true });
  return cd;
}

/**
 * Collect all generated outputs for a case from the case directory and projection.
 * Returns a structured object of all available report sections and data.
 */
function collectCaseOutputs(caseId, projection) {
  const cd = casePath(caseId);
  const outputs = {};

  // Read from projection outputs
  const projOutputs = projection?.outputs || {};
  Object.assign(outputs, projOutputs);

  // Try to read any additional output files from the case directory
  const outputFiles = [
    'outputs.json',
    'comp_analysis.json',
    'comps.json',
    'qc_review.json',
    'geocode.json',
    'records.json',
  ];

  for (const fname of outputFiles) {
    const fp = path.join(cd, fname);
    const data = readJSON(fp, null);
    if (data) {
      const key = fname.replace('.json', '');
      if (key !== 'outputs') {
        outputs[`_file_${key}`] = data;
      }
    }
  }

  // Read outputs directory if present
  const outputsDir = path.join(cd, 'outputs');
  if (fs.existsSync(outputsDir)) {
    try {
      const files = fs.readdirSync(outputsDir).filter(f => f.endsWith('.json') || f.endsWith('.txt'));
      for (const f of files.slice(0, 20)) { // cap at 20 files
        try {
          const fp = path.join(outputsDir, f);
          const content = fs.readFileSync(fp, 'utf8');
          const key = f.replace(/\.(json|txt)$/, '');
          try {
            outputs[key] = JSON.parse(content);
          } catch {
            outputs[key] = content.slice(0, 3000); // truncate large text files
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip if directory read fails */ }
  }

  return outputs;
}

/**
 * Truncate the outputs payload to avoid hitting token limits.
 * Keeps the most important sections and truncates long strings.
 */
function truncateForPrompt(obj, maxChars = 12000) {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxChars) return str;
  // If too long, truncate each string value to 500 chars
  const truncated = JSON.parse(str, (key, value) => {
    if (typeof value === 'string' && value.length > 500) {
      return value.slice(0, 500) + '... [truncated]';
    }
    return value;
  });
  return JSON.stringify(truncated, null, 2).slice(0, maxChars) + '\n... [additional content truncated]';
}

// ── POST /cases/:caseId/qc-review ─────────────────────────────────────────────

/**
 * Full AI QC review of all case outputs.
 * Checks USPAP compliance, internal consistency, data accuracy, UAD compliance,
 * logical flow, missing elements, and lender flags.
 */
router.post('/cases/:caseId/qc-review', validateParams(CommonSchemas.caseId), async (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const facts = projection?.facts || {};
    const meta = projection?.meta || {};
    const outputs = collectCaseOutputs(caseId, projection);

    const hasOutputs = Object.keys(outputs).length > 0;
    const hasFacts = Object.keys(facts).length > 0;

    if (!hasOutputs && !hasFacts) {
      return res.status(400).json({
        ok: false,
        error: 'No case data found to review. Generate report sections first.',
      });
    }

    const systemPrompt = `You are a senior appraisal reviewer with 25+ years of experience conducting quality control on residential appraisal reports for lenders, AMCs, and GSEs (Fannie Mae, Freddie Mac).
You are expert in USPAP, UAD guidelines, Fannie Mae Selling Guide, and FHA appraisal requirements.
Always respond with valid JSON only — no markdown, no prose outside the JSON structure.`;

    const userPrompt = `You are conducting a quality control review on a residential appraisal report. Review ALL sections provided for completeness, accuracy, and compliance.

CASE METADATA:
${JSON.stringify(meta, null, 2)}

CASE FACTS / SUBJECT DATA:
${truncateForPrompt(facts, 4000)}

REPORT OUTPUTS / GENERATED SECTIONS:
${truncateForPrompt(outputs, 8000)}

Review this appraisal report for:

1. USPAP COMPLIANCE — Are there any USPAP violations? Missing required disclosures (scope of work, limiting conditions, certifications)? Competency provisions met?

2. INTERNAL CONSISTENCY — Do sections contradict each other? Does the reconciliation match the approaches used? Are value conclusions logically supported? Does the final value match the reconciliation?

3. DATA ACCURACY — Are facts used consistently across all sections? Any mismatched addresses, dates, values, square footage, bedroom/bathroom counts? Does the subject description match throughout?

4. UAD COMPLIANCE — Do condition (C1-C6) and quality (Q1-Q6) ratings match descriptions? Are UAD abbreviations used correctly? Are dates in correct format (MM/DD/YYYY)?

5. LOGICAL FLOW — Does the highest & best use conclusion support the valuation approach? Does the neighborhood description support market conditions conclusions? Does the site description support improvement analysis?

6. MISSING ELEMENTS — Are any critical sections empty or inadequate? Missing neighborhood data? No comp adjustments? Empty cost approach when required? No reconciliation?

7. LENDER FLAGS — What would an underwriter at Fannie Mae, FHA, or a major lender likely flag for revision? What would trigger a desk review or field review?

Return ONLY this JSON structure (no other text):
{
  "grade": "A",
  "score": 85,
  "issues": [
    {
      "severity": "critical",
      "section": "section_name",
      "issue": "description of the issue",
      "suggestion": "specific corrective action"
    }
  ],
  "summary": "2-3 sentence overall assessment of the report quality and readiness",
  "readyToSubmit": false,
  "highlights": ["positive aspect 1", "positive aspect 2"],
  "criticalCount": 0,
  "warningCount": 0,
  "infoCount": 0
}

Grade scale: A=90-100 (excellent), B=80-89 (good, minor issues), C=70-79 (fair, needs work), D=60-69 (poor, significant issues), F=below 60 (unacceptable, do not submit).
readyToSubmit should be true only if grade is A or B with no critical issues.`;

    log.info('ai-qc:review-start', { caseId, hasOutputs, hasFacts });

    const rawResponse = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.2, maxTokens: 3000, timeout: 120000 });

    // Parse AI response
    let review;
    try {
      const cleaned = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      review = JSON.parse(cleaned);
    } catch (parseErr) {
      log.error('ai-qc:parse-error', { error: parseErr.message, raw: rawResponse.slice(0, 500) });
      return res.status(500).json({
        ok: false,
        error: 'AI returned malformed JSON. Try again.',
        detail: parseErr.message,
      });
    }

    // Enrich review with metadata
    const result = {
      ...review,
      caseId,
      reviewedAt: new Date().toISOString(),
      sectionsReviewed: Object.keys(outputs).length,
      // Count issues by severity from the array
      criticalCount: (review.issues || []).filter(i => i.severity === 'critical').length,
      warningCount: (review.issues || []).filter(i => i.severity === 'warning').length,
      infoCount: (review.issues || []).filter(i => i.severity === 'info').length,
    };

    // Save QC results to case
    const cd = ensureCaseDir(caseId);
    writeJSON(path.join(cd, 'qc_review.json'), result);

    // Update case metadata with QC status
    try {
      const updatedMeta = { ...meta };
      updatedMeta.qcReview = {
        grade: result.grade,
        score: result.score,
        readyToSubmit: result.readyToSubmit,
        reviewedAt: result.reviewedAt,
        issueCount: (result.issues || []).length,
      };
      saveCaseProjection({ ...projection, meta: updatedMeta });
    } catch (saveErr) {
      log.warn('ai-qc:save-projection-warning', { error: saveErr.message });
    }

    log.info('ai-qc:review-complete', {
      caseId,
      grade: result.grade,
      score: result.score,
      readyToSubmit: result.readyToSubmit,
      issueCount: (result.issues || []).length,
    });

    res.json({ ok: true, review: result });
  } catch (err) {
    log.error('ai-qc:error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/qc-review/latest ──────────────────────────────────────

/**
 * Retrieve the last QC review result for a case.
 */
router.get('/cases/:caseId/qc-review/latest', validateParams(CommonSchemas.caseId), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const cd = casePath(caseId);
    const review = readJSON(path.join(cd, 'qc_review.json'), null);

    if (!review) {
      return res.status(404).json({
        ok: false,
        error: 'No QC review found for this case. Run POST /api/cases/:caseId/qc-review first.',
      });
    }

    res.json({ ok: true, review });
  } catch (err) {
    log.error('ai-qc:get-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
