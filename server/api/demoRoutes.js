/**
 * server/api/demoRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-click demo flow: Upload PDF order → parse → create case → generate
 * all narratives → return results with export links.
 *
 * This is the "jaw-drop" endpoint for sales demos.
 *
 * Routes:
 *   POST /api/demo/full-pipeline  — multipart upload, returns generated report
 *   POST /api/demo/quick-generate — generate narratives from minimal JSON input
 */

import { Router } from 'express';
import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { parseOrderText, buildFactsFromOrder } from '../intake/orderParser.js';
import { parseAciXml, buildFactsFromXml } from '../intake/xmlParser.js';
import { casePath, normalizeFormType } from '../utils/caseUtils.js';
import { applyMetaDefaults, extractMetaFields } from '../caseMetadata.js';
import { saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { callAI, MODEL } from '../openaiClient.js';
import { getRelevantExamplesWithVoice } from '../retrieval.js';
import { buildPromptMessages } from '../promptBuilder.js';
import { CORE_SECTIONS } from '../config/coreSections.js';
import { getDb } from '../db/database.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { buildUad36Document } from '../export/uad36ExportService.js';
import { buildMismoDocument } from '../export/mismoExportService.js';
import log from '../logger.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const router = Router();

/**
 * POST /api/demo/full-pipeline
 * Upload a PDF order sheet → auto-create case → generate all sections → return results.
 * 
 * Body (multipart): file (PDF) + optional formType, provider
 * Returns: { caseId, address, sections: {...}, exportLinks: {...} }
 */
router.post('/demo/full-pipeline', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const steps = [];

  try {
    // Step 1: Extract text from uploaded PDF
    steps.push('Extracting text from PDF...');
    const fileBuffer = readUploadedFile(req.file);
    const pdfText = await extractPdfText(fileBuffer);
    steps.push(`Extracted ${pdfText.length} characters`);

    // Step 2: Parse order details using AI
    steps.push('Parsing order details...');
    const orderData = await parseOrderText(pdfText);
    steps.push(`Parsed: ${orderData.address || 'unknown address'}`);

    // Step 3: Create case
    const caseId = randomUUID().slice(0, 8);
    const formType = normalizeFormType(req.body?.formType || orderData.formType || '1004');
    const facts = buildFactsFromOrder(orderData);
    const meta = extractMetaFields(orderData);

    const db = getDb();
    db.prepare(`
      INSERT INTO case_records (caseId, address, borrower, formType, status, pipelineStage, notes, createdAt, updatedAt,
        lenderName, loanProgram, county, city, state)
      VALUES (?, ?, ?, ?, 'active', 'generating', ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?)
    `).run(
      caseId,
      orderData.address || '',
      orderData.borrower || '',
      formType,
      `Demo pipeline - ${new Date().toISOString()}`,
      orderData.lender || '',
      orderData.loanProgram || '',
      orderData.county || '',
      orderData.city || '',
      orderData.state || 'IL'
    );
    steps.push(`Created case: ${caseId}`);

    // Save facts
    const caseDir = casePath(caseId);
    fs.mkdirSync(caseDir, { recursive: true });
    writeJSON(path.join(caseDir, 'facts.json'), facts);
    steps.push('Saved case facts');

    // Step 4: Generate all narrative sections
    steps.push('Generating narratives...');
    const sectionsToGenerate = [
      'neighborhood_description',
      'site_description',
      'improvements_description',
      'highest_best_use',
      'sales_comparison',
      'reconciliation_narrative',
      'scope_of_work',
    ];

    const generatedSections = {};
    for (const sectionId of sectionsToGenerate) {
      try {
        const examples = await getRelevantExamplesWithVoice(sectionId, facts, caseId);
        const messages = buildPromptMessages(sectionId, facts, examples, { formType });
        const result = await callAI(messages, { temperature: 0.3, max_tokens: 1500 });
        const text = result?.trim() || '';
        
        if (text) {
          generatedSections[sectionId] = text;
          
          // Save to DB
          db.prepare(`
            INSERT OR REPLACE INTO generated_sections (id, case_id, section_id, draft_text, status, created_at)
            VALUES (?, ?, ?, ?, 'draft', datetime('now'))
          `).run(`${caseId}-${sectionId}`, caseId, sectionId, text);
        }
        steps.push(`Generated: ${sectionId} (${text.length} chars)`);
      } catch (err) {
        steps.push(`Failed: ${sectionId} - ${err.message}`);
      }
    }

    // Step 5: Build export data
    const caseData = {
      facts,
      comps: [],
      adjustments: [],
      reconciliation: {},
      sections: Object.fromEntries(
        Object.entries(generatedSections).map(([k, v]) => [k, { draft_text: v }])
      ),
      caseRecord: { caseId, formType, address: orderData.address },
    };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      ok: true,
      caseId,
      address: orderData.address,
      borrower: orderData.borrower,
      formType,
      elapsed: `${elapsed}s`,
      sectionsGenerated: Object.keys(generatedSections).length,
      sections: generatedSections,
      exportLinks: {
        mismo: `/api/cases/${caseId}/export/mismo`,
        uad36: `/api/cases/${caseId}/export/uad36`,
        pdf: `/api/cases/${caseId}/export/pdf`,
        bundle: `/api/cases/${caseId}/export/bundle`,
      },
      steps,
    });

    log.info('demo:pipeline-complete', { caseId, elapsed, sections: Object.keys(generatedSections).length });

  } catch (err) {
    log.error('demo:pipeline-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message, steps });
  } finally {
    if (req.file) cleanupUploadedFile(req.file);
  }
});

/**
 * POST /api/demo/quick-generate
 * Generate narratives from minimal JSON input (no file upload needed).
 * Great for API demos and testing.
 *
 * Body: { address, city, state, yearBuilt, gla, bedrooms, bathrooms, ... }
 * Returns: { sections: { neighborhood_description: "...", ... } }
 */
router.post('/demo/quick-generate', async (req, res) => {
  const startTime = Date.now();

  try {
    const input = req.body || {};
    const facts = {
      subject: {
        address: input.address || '',
        city: input.city || '',
        state: input.state || 'IL',
        county: input.county || '',
        neighborhood: input.neighborhood || '',
      },
      improvements: {
        yearBuilt: input.yearBuilt || '',
        gla: input.gla || '',
        bedrooms: input.bedrooms || '',
        bathrooms: input.bathrooms || '',
        condition: input.condition || 'C3',
        quality: input.quality || 'Q3',
        design: input.design || '',
        stories: input.stories || '',
      },
      site: {
        lotSize: input.lotSize || '',
        zoning: input.zoning || '',
      },
    };

    const sections = {};
    const sectionIds = input.sections || [
      'neighborhood_description',
      'improvements_description',
      'highest_best_use',
    ];

    for (const sectionId of sectionIds) {
      try {
        const examples = await getRelevantExamplesWithVoice(sectionId, facts);
        const messages = buildPromptMessages(sectionId, facts, examples, { formType: '1004' });
        const result = await callAI(messages, { temperature: 0.3, max_tokens: 1500 });
        sections[sectionId] = result?.trim() || '';
      } catch (err) {
        sections[sectionId] = `[Error: ${err.message}]`;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      ok: true,
      elapsed: `${elapsed}s`,
      model: MODEL,
      sections,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
