/**
 * server/api/exportRoutes.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Export API routes: MISMO XML, UAD 3.6, PDF, ZIP bundle.
 * 
 * Routes:
 *   POST /cases/:caseId/export/mismo    â€” MISMO 2.6/3.4 XML export
 *   POST /cases/:caseId/export/uad36    â€” UAD 3.6 / MISMO 3.6 XML export
 *   POST /cases/:caseId/export/pdf      â€” PDF export
 *   POST /cases/:caseId/export/bundle   â€” ZIP bundle (XML + PDF + photos)
 *   GET  /cases/:caseId/export/preview  â€” Preview export metadata
 */

import { Router } from 'express';
import { generateMismo, validateMismoOutput } from '../export/mismoExportService.js';
import { buildUad36Document, validateUad36 } from '../export/uad36ExportService.js';
import { renderPdf } from '../export/pdfRenderer.js';
import { fillForm1004 } from '../export/pdfFormFiller.js';
import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CASES_DIR } from '../utils/caseUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

/**
 * Helper to load case facts.
 */
function loadCaseForExport(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) return null;

  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const sections = dbAll(
    `SELECT * FROM generated_sections
     WHERE case_id = ? AND (final_text IS NOT NULL OR reviewed_text IS NOT NULL OR draft_text IS NOT NULL)
     ORDER BY section_id, created_at DESC`,
    [caseId]
  );
  const sectionMap = {};
  for (const s of sections) {
    if (!sectionMap[s.section_id]) sectionMap[s.section_id] = s;
  }

  let comps = [];
  try {
    comps = dbAll(
      'SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1 ORDER BY created_at LIMIT 6',
      [caseId]
    );
  } catch { /* ok */ }

  let adjustments = [];
  try {
    adjustments = dbAll('SELECT * FROM adjustment_support_records WHERE case_id = ?', [caseId]);
  } catch { /* ok */ }

  let reconciliation = null;
  try {
    reconciliation = dbGet('SELECT * FROM reconciliation_support_records WHERE case_id = ?', [caseId]);
  } catch { /* ok */ }

  return { caseRecord, facts, sections: sectionMap, comps, adjustments, reconciliation };
}

// â”€â”€ POST /cases/:caseId/export/mismo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/cases/:caseId/export/mismo', async (req, res) => {
  try {
    const { version } = req.body || {};
    const result = generateMismo(req.params.caseId, { version: version || 'mismo_3_4' });

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="${result.job.fileName}"`);
    res.send(result.xml);
  } catch (err) {
    log.error('export:mismo-failed', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ POST /cases/:caseId/export/uad36 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/cases/:caseId/export/uad36', async (req, res) => {
  try {
    const caseData = loadCaseForExport(req.params.caseId);
    if (!caseData) return res.status(404).json({ ok: false, error: 'Case not found' });

    const xml = buildUad36Document(caseData);
    const validation = validateUad36(xml);

    const fileName = `${req.params.caseId}_uad36_${Date.now()}.xml`;

    if (req.body?.validateOnly) {
      return res.json({ ok: true, validation, fileName });
    }

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(xml);
  } catch (err) {
    log.error('export:uad36-failed', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ POST /cases/:caseId/export/pdf â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/cases/:caseId/export/pdf', async (req, res) => {
  try {
    const { includePhotos, includeComps } = req.body || {};
    const pdfBuffer = await renderPdf(req.params.caseId, { includePhotos, includeComps });

    const fileName = `${req.params.caseId}_appraisal_${Date.now()}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } catch (err) {
    log.error('export:pdf-failed', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ POST /cases/:caseId/export/bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// UAD 3.6 delivery format: ZIP containing XML + PDF + photos

router.post('/cases/:caseId/export/bundle', async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const { format, includePhotos } = req.body || {};
    const isUad36 = format === 'uad36';

    const caseData = loadCaseForExport(caseId);
    if (!caseData) return res.status(404).json({ ok: false, error: 'Case not found' });

    // Generate XML
    let xml, xmlFileName;
    if (isUad36) {
      xml = buildUad36Document(caseData);
      xmlFileName = `${caseId}_uad36.xml`;
    } else {
      const result = generateMismo(caseId, { version: 'mismo_3_4' });
      xml = result.xml;
      xmlFileName = result.job.fileName;
    }

    // Generate PDF
    const pdfBuffer = await renderPdf(caseId);
    const pdfFileName = `${caseId}_appraisal.pdf`;

    // Create ZIP
    const fileName = `${caseId}_export_${Date.now()}.zip`;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Add XML
    archive.append(xml, { name: xmlFileName });

    // Add PDF
    archive.append(pdfBuffer, { name: pdfFileName });

    // Add photos if available and requested
    if (includePhotos !== false) {
      let photos = [];
      try {
        photos = dbAll('SELECT * FROM inspection_photos WHERE case_id = ? ORDER BY sort_order', [caseId]);
      } catch { /* ok */ }

      for (const photo of photos) {
        if (photo.file_path) {
          try {
            const fs = await import('fs');
            if (fs.existsSync(photo.file_path)) {
              const ext = photo.file_path.split('.').pop() || 'jpg';
              archive.file(photo.file_path, { name: `photos/${photo.label || photo.id}.${ext}` });
            }
          } catch { /* skip missing photos */ }
        }
      }
    }

    // Add validation report
    const validation = isUad36 ? validateUad36(xml) : validateMismoOutput(xml);
    archive.append(JSON.stringify(validation, null, 2), { name: 'validation_report.json' });

    await archive.finalize();

    log.info('export:bundle-completed', { caseId, format: isUad36 ? 'uad36' : 'mismo34', fileName });
  } catch (err) {
    log.error('export:bundle-failed', { caseId: req.params.caseId, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// â”€â”€ GET /cases/:caseId/export/download/:format â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Download a previously generated export or generate on the fly.
// Formats: mismo, uad36, pdf, bundle

router.get('/cases/:caseId/export/download/:format', async (req, res) => {
  const { caseId, format } = req.params;
  try {
    switch (format) {
      case 'mismo': {
        const result = generateMismo(caseId, { version: 'mismo_3_4' });
        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', `attachment; filename="${result.job.fileName}"`);
        return res.send(result.xml);
      }
      case 'uad36': {
        const caseData = loadCaseForExport(caseId);
        if (!caseData) return res.status(404).json({ ok: false, error: 'Case not found' });
        const xml = buildUad36Document(caseData);
        const fileName = `${caseId}_uad36_${Date.now()}.xml`;
        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(xml);
      }
      case 'pdf': {
        const pdfBuffer = await renderPdf(caseId);
        const fileName = `${caseId}_appraisal_${Date.now()}.pdf`;
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(pdfBuffer);
      }
      case 'bundle': {
        const caseData = loadCaseForExport(caseId);
        if (!caseData) return res.status(404).json({ ok: false, error: 'Case not found' });
        const mismoResult = generateMismo(caseId, { version: 'mismo_3_4' });
        const pdfBuffer = await renderPdf(caseId);
        const fileName = `${caseId}_export_bundle_${Date.now()}.zip`;
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        archive.append(mismoResult.xml, { name: mismoResult.job.fileName });
        archive.append(pdfBuffer, { name: `${caseId}_appraisal.pdf` });
        const validation = validateMismoOutput(mismoResult.xml);
        archive.append(JSON.stringify(validation, null, 2), { name: 'validation_report.json' });
        await archive.finalize();
        return;
      }
      default:
        return res.status(400).json({ ok: false, error: `Unknown format: ${format}. Use mismo, uad36, pdf, or bundle.` });
    }
  } catch (err) {
    log.error('export:download-failed', { caseId, format, error: err.message });
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ GET /cases/:caseId/export/pdf-form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generate a filled Fannie Mae Form 1004 PDF using the official fillable template.

router.get('/cases/:caseId/export/pdf-form', async (req, res) => {
  const { caseId } = req.params;
  try {
    // Use getCaseProjection — same as the main API, handles DB + filesystem
    const { getCaseProjection } = await import('../caseRecord/caseRecordService.js');
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const facts = projection.facts || {};
    const rawOutputs = projection.outputs || {};
    const meta = projection.meta || {};

    // Extract text from outputs (handle {text: "..."} objects and plain strings)
    const sections = {};
    for (const [k, v] of Object.entries(rawOutputs)) {
      if (k === 'updatedAt') continue;
      const text = typeof v === 'string' ? v : (v?.text || '');
      if (text) sections[k] = { section_id: k, draft_text: text, final_text: text, text };
    }

    const address = (facts.subject?.address || caseId).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);

    const pdfBuffer = await fillForm1004({ facts, outputs: rawOutputs, sections, meta, caseId });

    const fileName = `1004_report_${address}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);

    log.info('export:pdf-form-completed', { caseId, fileName, sectionsCount: Object.keys(sections).length });
  } catch (err) {
    log.error('export:pdf-form-failed', { caseId, error: err.message, stack: err.stack?.split('\n').slice(0,3).join(' | ') });
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ GET /cases/:caseId/export/preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/cases/:caseId/export/preview', async (req, res) => {
  try {
    const caseData = loadCaseForExport(req.params.caseId);
    if (!caseData) return res.status(404).json({ ok: false, error: 'Case not found' });

    const subject = caseData.facts.subject || {};
    const sectionCount = Object.keys(caseData.sections).length;
    const compCount = caseData.comps.length;

    // Check what data is available
    const readiness = {
      subject: Boolean(subject.address),
      facts: Object.keys(caseData.facts).length > 0,
      sections: sectionCount > 0,
      comps: compCount > 0,
      reconciliation: Boolean(caseData.reconciliation),
    };

    const formats = [
      { id: 'mismo_26', label: 'MISMO 2.6 (Legacy)', available: true },
      { id: 'mismo_34', label: 'MISMO 3.4 (Current)', available: true },
      { id: 'uad36', label: 'UAD 3.6 / MISMO 3.6 (New Standard)', available: true, recommended: true },
      { id: 'pdf', label: 'PDF Report', available: true },
      { id: 'bundle', label: 'ZIP Bundle (XML + PDF + Photos)', available: true },
    ];

    res.json({
      ok: true,
      caseId: req.params.caseId,
      address: subject.address || 'Not available',
      formType: caseData.caseRecord.form_type || '1004',
      sectionCount,
      compCount,
      readiness,
      formats,
      note: 'UAD 3.6 becomes mandatory November 2, 2026. UAD 2.6 retires May 2027.',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// DEBUG endpoint
router.get('/cases/:caseId/export/pdf-debug', async (req, res) => {
  const { caseId } = req.params;
  try {
    const { readJSON } = await import('../utils/fileUtils.js');
    const { casePath: getCasePath } = await import('../utils/caseUtils.js');
    const caseDir = getCasePath(caseId);
    const facts = readJSON(path.join(caseDir, 'facts.json'), {});
    let outputs = readJSON(path.join(caseDir, 'outputs.json'), {});
    const meta = readJSON(path.join(caseDir, 'meta.json'), {});
    let dbRow = null;
    try { dbRow = dbGet('SELECT * FROM case_records WHERE caseId = ?', [caseId]); } catch(e) { dbRow = {err: e.message}; }
    res.json({
      caseDir,
      factsSubject: facts?.subject?.address || 'NONE',
      fileOutputKeys: Object.keys(outputs).filter(k => k !== 'updatedAt'),
      fileOutputSample: outputs.neighborhood_description ? typeof outputs.neighborhood_description + ':' + String(outputs.neighborhood_description).substring(0,50) : 'EMPTY',
      metaBorrower: meta?.borrower,
      dbColumns: dbRow ? Object.keys(dbRow) : 'NO_ROW',
      dbOutputsType: dbRow?.outputs ? typeof dbRow.outputs : 'NONE',
      dbOutputsSample: dbRow?.outputs ? String(dbRow.outputs).substring(0,100) : 'NONE',
    });
  } catch(e) { res.status(500).json({error: e.message}); }
});
export default router;
