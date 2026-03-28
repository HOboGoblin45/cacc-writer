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
import { z } from 'zod';
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

// Validation schemas
const fullPipelineBodySchema = z.object({
  formType: z.string().optional(),
  provider: z.string().optional(),
}).passthrough();

const quickGenerateBodySchema = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  county: z.string().optional(),
  neighborhood: z.string().optional(),
  yearBuilt: z.string().optional(),
  gla: z.string().optional(),
  bedrooms: z.string().optional(),
  bathrooms: z.string().optional(),
  condition: z.string().optional(),
  quality: z.string().optional(),
  design: z.string().optional(),
  stories: z.string().optional(),
  lotSize: z.string().optional(),
  salePrice: z.string().optional(),
  sections: z.array(z.string()).optional(),
}).passthrough();

// Validation middleware
const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body || {});
    next();
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.errors[0]?.message || 'Invalid request body' });
  }
};

/**
 * POST /api/demo/full-pipeline
 * Upload a PDF order sheet → auto-create case → generate all sections → return results.
 *
 * Body (multipart): file (PDF) + optional formType, provider
 * Returns: { caseId, address, sections: {...}, exportLinks: {...} }
 */
router.post('/demo/full-pipeline', upload.single('file'), validateBody(fullPipelineBodySchema), async (req, res) => {
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
    const formType = normalizeFormType(req.validated?.formType || orderData.formType || '1004');
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
router.post('/demo/quick-generate', validateBody(quickGenerateBodySchema), async (req, res) => {
  const startTime = Date.now();

  try {
    const input = req.validated;
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

    // Build a facts summary for the direct prompt
    const factLines = [];
    if (input.address) factLines.push(`Address: ${input.address}`);
    if (input.city) factLines.push(`City: ${input.city}, ${input.state || 'IL'}`);
    if (input.county) factLines.push(`County: ${input.county}`);
    if (input.neighborhood) factLines.push(`Neighborhood: ${input.neighborhood}`);
    if (input.yearBuilt) factLines.push(`Year Built: ${input.yearBuilt}`);
    if (input.gla) factLines.push(`GLA: ${input.gla} sq ft`);
    if (input.bedrooms) factLines.push(`Bedrooms: ${input.bedrooms}`);
    if (input.bathrooms) factLines.push(`Bathrooms: ${input.bathrooms}`);
    if (input.condition) factLines.push(`Condition: ${input.condition}`);
    if (input.quality) factLines.push(`Quality: ${input.quality}`);
    if (input.design) factLines.push(`Design: ${input.design}`);
    if (input.stories) factLines.push(`Stories: ${input.stories}`);
    if (input.lotSize) factLines.push(`Lot Size: ${input.lotSize}`);
    if (input.salePrice) factLines.push(`Sale Price: $${input.salePrice}`);
    const factsBlock = factLines.join('\n');

    const sections = {};
    const sectionIds = input.sections || [
      'neighborhood_description',
      'improvements_description',
      'highest_best_use',
    ];

    // Get voice examples for style matching
    const exampleTexts = [];
    try {
      for (const sid of sectionIds.slice(0, 1)) {
        const examples = await getRelevantExamplesWithVoice(sid, facts);
        if (examples?.voice?.length) {
          exampleTexts.push(...examples.voice.slice(0, 3).map(e => e.text));
        } else if (examples?.other?.length) {
          exampleTexts.push(...examples.other.slice(0, 3).map(e => e.text));
        }
      }
    } catch { /* ok */ }

    const styleBlock = exampleTexts.length > 0
      ? `\n\nHere are examples of the appraiser's writing style:\n${exampleTexts.map((t, i) => `Example ${i+1}:\n${t}`).join('\n\n')}`
      : '';

    for (const sectionId of sectionIds) {
      const sectionLabel = sectionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      try {
        const messages = [
          {
            role: 'system',
            content: `You are an expert residential real estate appraiser writing narrative sections for URAR 1004 appraisal reports. Write in a professional, concise, data-driven style typical of Central Illinois appraisals. Every sentence should add value. Use standard appraisal terminology. Do NOT use placeholder brackets like [INSERT]. Fill in all details based on the provided facts and your knowledge of the area. If a specific detail is not provided, use reasonable professional language without placeholders.${styleBlock}`
          },
          {
            role: 'user',
            content: `Write the "${sectionLabel}" section for this appraisal:\n\n${factsBlock}\n\nWrite 2-4 sentences of professional appraisal narrative. No placeholders, no brackets.`
          }
        ];
        const result = await callAI(messages, { temperature: 0.3, max_tokens: 800 });
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
