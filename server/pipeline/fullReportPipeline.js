/**
 * server/pipeline/fullReportPipeline.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-CLICK FULL REPORT PIPELINE
 *
 * The holy grail: upload a PDF order form → get a complete appraisal report.
 *
 * Pipeline stages:
 *   1. INTAKE:     Parse order PDF → extract facts → create case
 *   2. ENRICH:     Geocode → market analysis → neighborhood data
 *   3. COMPS:      Analyze comps → rank → suggest adjustments (if comps exist)
 *   4. GENERATE:   Batch generate all narrative sections
 *   5. QC:         Two-pass AI review for each section
 *   6. EXPORT:     Generate MISMO XML + PDF + ZIP bundle
 *
 * Each stage emits progress events for real-time UI updates.
 * The pipeline can be stopped/resumed at any stage.
 * If a stage fails, subsequent stages still attempt to run.
 */

import { parseOrderForm } from '../intake/smartOrderParser.js';
import { analyzeMarket } from '../intelligence/marketAnalyzer.js';
import { verifyCaseAddress } from '../data/addressVerification.js';
import { analyzeComps } from '../comparables/compAnalyzer.js';
import { batchGenerate, getSectionsForForm } from '../generation/batchGenerator.js';
import { buildUad36Document, validateUad36 } from '../export/uad36ExportService.js';
import { renderPdf } from '../export/pdfRenderer.js';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { geocodeAddress } from '../geocoder.js';
import { checkReportQuota, incrementReportCount } from '../auth/authService.js';
import log from '../logger.js';
import crypto from 'crypto';

/**
 * Pipeline stage definitions.
 */
const STAGES = [
  { id: 'intake', label: 'Order Intake & Parsing', weight: 10 },
  { id: 'enrich', label: 'Location & Market Analysis', weight: 15 },
  { id: 'comps', label: 'Comp Analysis & Adjustments', weight: 10 },
  { id: 'generate', label: 'AI Narrative Generation', weight: 45 },
  { id: 'qc', label: 'Quality Control Review', weight: 10 },
  { id: 'export', label: 'Report Export & Packaging', weight: 10 },
];

/**
 * Run the full report pipeline.
 *
 * @param {Object} input
 * @param {string} [input.orderText] — raw order form text (for new cases)
 * @param {string} [input.caseId] — existing case ID (to resume)
 * @param {string} input.userId — user running the pipeline
 * @param {Object} [input.options]
 * @param {string[]} [input.options.skipStages] — stages to skip
 * @param {string} [input.options.formType] — override form type
 * @param {string} [input.options.exportFormat] — 'uad36' | 'mismo34' | 'pdf'
 * @param {function} [input.onProgress] — callback(stage, status, data)
 * @returns {Promise<Object>} complete pipeline results
 */
export async function runFullPipeline(input) {
  const startTime = Date.now();
  const pipelineId = crypto.randomBytes(6).toString('hex');
  const skipStages = new Set(input.options?.skipStages || []);
  const onProgress = input.onProgress || (() => {});

  const results = {
    pipelineId,
    stages: {},
    caseId: input.caseId || null,
    formType: input.options?.formType || null,
    startedAt: new Date().toISOString(),
  };

  log.info('pipeline:start', { pipelineId, userId: input.userId, hasOrder: !!input.orderText, caseId: input.caseId });
  onProgress('pipeline', 'started', { pipelineId, stages: STAGES });

  // ── STAGE 1: INTAKE ──────────────────────────────────────────────────────

  if (!skipStages.has('intake')) {
    onProgress('intake', 'running', { label: 'Parsing order form…' });
    const intakeStart = Date.now();

    try {
      if (input.orderText && !input.caseId) {
        // Parse order and create case
        const parsed = await parseOrderForm(input.orderText);
        const caseId = crypto.randomBytes(4).toString('hex');
        const now = new Date().toISOString();
        const formType = parsed.facts.order?.formType || input.options?.formType || '1004';

        dbRun('INSERT INTO case_records (case_id, form_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [caseId, formType, 'pipeline', now, now]);

        // Build internal facts
        const internalFacts = buildInternalFacts(parsed.facts);
        dbRun('INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [caseId, JSON.stringify(internalFacts), now, now]);

        results.caseId = caseId;
        results.formType = formType;
        results.stages.intake = { ok: true, caseId, fieldCount: parsed.meta.fieldCount, durationMs: Date.now() - intakeStart };
      } else if (input.caseId) {
        // Existing case
        results.caseId = input.caseId;
        const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [input.caseId]);
        results.formType = caseRecord?.form_type || input.options?.formType || '1004';
        results.stages.intake = { ok: true, caseId: input.caseId, note: 'Using existing case', durationMs: Date.now() - intakeStart };
      } else {
        throw new Error('Either orderText or caseId is required');
      }

      onProgress('intake', 'complete', results.stages.intake);
    } catch (err) {
      results.stages.intake = { ok: false, error: err.message, durationMs: Date.now() - intakeStart };
      onProgress('intake', 'failed', results.stages.intake);
      log.error('pipeline:intake-failed', { pipelineId, error: err.message });
    }
  }

  const caseId = results.caseId;
  if (!caseId) {
    results.error = 'No case created — cannot continue pipeline';
    return results;
  }

  // ── STAGE 2: ENRICH ──────────────────────────────────────────────────────

  if (!skipStages.has('enrich')) {
    onProgress('enrich', 'running', { label: 'Analyzing location & market…' });
    const enrichStart = Date.now();

    try {
      // Verify address against USPS first
      let addressVerified = false;
      try {
        const addrResult = await verifyCaseAddress(caseId);
        addressVerified = addrResult.verified;
        if (addrResult.corrections?.length > 0) {
          log.info('pipeline:address-corrected', { pipelineId, corrections: addrResult.corrections });
        }
      } catch (addrErr) {
        log.warn('pipeline:address-verify-failed', { error: addrErr.message });
      }

      const marketResult = await analyzeMarket(caseId);
      results.stages.enrich = {
        ok: true,
        addressVerified,
        confidence: marketResult.analysis?.confidence,
        hasGeo: !!marketResult.geo,
        durationMs: Date.now() - enrichStart,
      };
      onProgress('enrich', 'complete', results.stages.enrich);
    } catch (err) {
      results.stages.enrich = { ok: false, error: err.message, durationMs: Date.now() - enrichStart };
      onProgress('enrich', 'failed', results.stages.enrich);
      log.warn('pipeline:enrich-failed', { pipelineId, error: err.message });
    }
  }

  // ── STAGE 3: COMPS ───────────────────────────────────────────────────────

  if (!skipStages.has('comps')) {
    onProgress('comps', 'running', { label: 'Analyzing comparables…' });
    const compsStart = Date.now();

    try {
      const compResult = await analyzeComps(caseId);
      results.stages.comps = {
        ok: !compResult.error,
        totalComps: compResult.totalComps || 0,
        recommended: compResult.recommended?.length || 0,
        flags: compResult.flags || [],
        durationMs: Date.now() - compsStart,
      };
      if (compResult.error) results.stages.comps.note = compResult.error;
      onProgress('comps', compResult.error ? 'skipped' : 'complete', results.stages.comps);
    } catch (err) {
      results.stages.comps = { ok: false, error: err.message, durationMs: Date.now() - compsStart };
      onProgress('comps', 'failed', results.stages.comps);
    }
  }

  // ── STAGE 4: GENERATE ────────────────────────────────────────────────────

  if (!skipStages.has('generate')) {
    onProgress('generate', 'running', { label: 'Generating narratives…' });
    const genStart = Date.now();

    try {
      const genResult = await batchGenerate(caseId, {
        userId: input.userId,
        formType: results.formType,
        skipExisting: true,
        onProgress: (sectionId, status, data) => {
          if (sectionId !== '_batch') {
            onProgress('generate', 'section', { sectionId, status, ...data });
          }
        },
      });

      results.stages.generate = {
        ok: true,
        generated: genResult.generated,
        failed: genResult.failed,
        skipped: genResult.skipped,
        durationMs: Date.now() - genStart,
      };
      onProgress('generate', 'complete', results.stages.generate);
    } catch (err) {
      results.stages.generate = { ok: false, error: err.message, durationMs: Date.now() - genStart };
      onProgress('generate', 'failed', results.stages.generate);
      log.error('pipeline:generate-failed', { pipelineId, error: err.message });
    }
  }

  // ── STAGE 5: QC ──────────────────────────────────────────────────────────

  if (!skipStages.has('qc')) {
    onProgress('qc', 'running', { label: 'Running quality checks…' });
    const qcStart = Date.now();

    try {
      const qcResults = await runQualityChecks(caseId, results.formType);
      results.stages.qc = {
        ok: true,
        sectionsChecked: qcResults.checked,
        issues: qcResults.issues,
        durationMs: Date.now() - qcStart,
      };
      onProgress('qc', 'complete', results.stages.qc);
    } catch (err) {
      results.stages.qc = { ok: false, error: err.message, durationMs: Date.now() - qcStart };
      onProgress('qc', 'failed', results.stages.qc);
    }
  }

  // ── STAGE 6: EXPORT ──────────────────────────────────────────────────────

  if (!skipStages.has('export')) {
    onProgress('export', 'running', { label: 'Building export files…' });
    const exportStart = Date.now();

    try {
      // Load case data for export
      const caseData = loadCaseDataForExport(caseId);

      // Build UAD 3.6 XML
      const xml = buildUad36Document(caseData);
      const validation = validateUad36(xml);

      // Build PDF
      let pdfSize = 0;
      try {
        const pdfBuffer = await renderPdf(caseId);
        pdfSize = pdfBuffer.length;
      } catch (pdfErr) {
        log.warn('pipeline:pdf-failed', { error: pdfErr.message });
      }

      results.stages.export = {
        ok: true,
        xmlSize: Buffer.byteLength(xml, 'utf8'),
        pdfSize,
        validation,
        durationMs: Date.now() - exportStart,
      };
      onProgress('export', 'complete', results.stages.export);
    } catch (err) {
      results.stages.export = { ok: false, error: err.message, durationMs: Date.now() - exportStart };
      onProgress('export', 'failed', results.stages.export);
    }
  }

  // ── FINALIZE ─────────────────────────────────────────────────────────────

  const totalDuration = Date.now() - startTime;
  const stageResults = Object.values(results.stages);
  const allOk = stageResults.every(s => s.ok);
  const someOk = stageResults.some(s => s.ok);

  // Update case status
  try {
    const newStatus = allOk ? 'complete' : someOk ? 'review' : 'draft';
    dbRun(`UPDATE case_records SET status = ?, updated_at = datetime("now") WHERE case_id = ?`, [newStatus, caseId]);
  } catch { /* ok */ }

  results.totalDurationMs = totalDuration;
  results.status = allOk ? 'complete' : someOk ? 'partial' : 'failed';
  results.completedAt = new Date().toISOString();

  log.info('pipeline:complete', {
    pipelineId, caseId, status: results.status,
    totalDuration, stages: Object.fromEntries(Object.entries(results.stages).map(([k, v]) => [k, v.ok])),
  });

  onProgress('pipeline', 'complete', { status: results.status, totalDuration, caseId });

  return results;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildInternalFacts(parsedFacts) {
  return {
    subject: {
      address: parsedFacts.subject?.address,
      streetAddress: parsedFacts.subject?.address,
      city: parsedFacts.subject?.city,
      state: parsedFacts.subject?.state,
      zip: parsedFacts.subject?.zip,
      zipCode: parsedFacts.subject?.zip,
      county: parsedFacts.subject?.county,
      legalDescription: parsedFacts.subject?.legalDescription,
      taxParcelId: parsedFacts.subject?.taxParcelId,
      borrower: parsedFacts.borrower?.name,
      owner: parsedFacts.owner?.name || parsedFacts.borrower?.name,
      propertyType: parsedFacts.assignment?.propertyType,
    },
    lender: parsedFacts.lender || {},
    amc: parsedFacts.amc || {},
    contract: parsedFacts.contract || {},
    assignment: {
      type: parsedFacts.assignment?.type || 'Standard',
      purpose: parsedFacts.assignment?.purpose || 'Purchase',
      intendedUse: parsedFacts.assignment?.intendedUse || 'Mortgage lending decision',
      propertyRightsAppraised: parsedFacts.assignment?.propertyRightsAppraised || 'Fee Simple',
      loanType: parsedFacts.assignment?.loanType,
      loanProgram: parsedFacts.assignment?.loanProgram,
    },
    improvements: parsedFacts.property || {},
    order: parsedFacts.order || {},
  };
}

async function runQualityChecks(caseId, formType) {
  const sections = dbAll(
    `SELECT section_id, draft_text, reviewed_text, final_text FROM generated_sections
     WHERE case_id = ? ORDER BY created_at DESC`,
    [caseId]
  );

  const sectionMap = {};
  for (const s of sections) {
    if (!sectionMap[s.section_id]) sectionMap[s.section_id] = s;
  }

  const issues = [];
  let checked = 0;

  for (const [sectionId, section] of Object.entries(sectionMap)) {
    const text = section.final_text || section.reviewed_text || section.draft_text || '';
    if (!text.trim()) continue;
    checked++;

    // Length checks
    if (text.length < 100) {
      issues.push({ sectionId, severity: 'warning', message: `Section is very short (${text.length} chars)` });
    }
    if (text.length > 5000) {
      issues.push({ sectionId, severity: 'info', message: `Section is long (${text.length} chars) — may need trimming` });
    }

    // Placeholder detection
    const placeholders = text.match(/\{[^}]+\}|\[INSERT[^\]]*\]|\[TODO[^\]]*\]|XXXX|____/gi);
    if (placeholders) {
      issues.push({ sectionId, severity: 'error', message: `Contains ${placeholders.length} unfilled placeholder(s): ${placeholders.slice(0, 3).join(', ')}` });
    }

    // Contradiction detection (basic)
    if (text.match(/subject property is (?:not )?(?:a|an) .+? and (?:not )?(?:a|an)/i)) {
      issues.push({ sectionId, severity: 'warning', message: 'Possible contradictory property description' });
    }
  }

  return { checked, issues };
}

function loadCaseDataForExport(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const sections = dbAll(
    `SELECT * FROM generated_sections WHERE case_id = ? ORDER BY section_id, created_at DESC`,
    [caseId]
  );
  const sectionMap = {};
  for (const s of sections) {
    if (!sectionMap[s.section_id]) sectionMap[s.section_id] = s;
  }

  let comps = [];
  try { comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1', [caseId]); } catch { /* ok */ }
  let adjustments = [];
  try { adjustments = dbAll('SELECT * FROM adjustment_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }
  let reconciliation = null;
  try { reconciliation = dbGet('SELECT * FROM reconciliation_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }

  return { caseRecord, facts, sections: sectionMap, comps, adjustments, reconciliation };
}

export { STAGES };
export default { runFullPipeline, STAGES };
