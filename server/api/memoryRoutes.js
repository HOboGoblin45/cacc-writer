/**
 * server/api/memoryRoutes.js
 * ---------------------------
 * Express Router for KB management and voice import endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes:
 *   GET    /kb/status                        — KB health and counts
 *   POST   /kb/reindex                       — rebuild KB index from disk
 *   POST   /kb/migrate-voice                 — migrate voice_training.json → KB
 *   POST   /kb/ingest-to-pinecone            — ingest KB to Pinecone (deferred)
 *   POST   /voice/import-pdf                 — upload + import single PDF
 *   GET    /voice/examples                   — list imported voice examples
 *   DELETE /voice/examples/import/:importId  — delete import batch
 *   DELETE /voice/examples/:id               — delete single example
 *   POST   /voice/import-folder              — scan voice_pdfs/<formType>/ for new PDFs
 *   GET    /voice/folder-status              — check folder for unimported PDFs
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { normalizeFormType } from '../utils/caseUtils.js';
import { readJSON, writeJSON, withVoiceLock } from '../utils/fileUtils.js';
import { trimText, asArray, aiText, parseJSONObject } from '../utils/textUtils.js';
import { upload, ensureAI } from '../utils/middleware.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { DEFAULT_FORM_TYPE, getFormConfig } from '../../forms/index.js';
import { addExample, indexExamples } from '../knowledgeBase.js';
import { client, MODEL } from '../openaiClient.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import log from '../logger.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const VOICE_FILE   = path.join(__dirname, '..', '..', 'voice_training.json');
const VOICE_PDFS_DIR = path.join(__dirname, '..', '..', 'voice_pdfs');
const KB_DIR       = path.join(__dirname, '..', '..', 'knowledge_base');

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

// ── GET /kb/status ────────────────────────────────────────────────────────────
router.get('/kb/status', (_req, res) => {
  try {
    const index      = readJSON(path.join(KB_DIR, 'index.json'), { counts: {}, examples: [] });
    const voiceCount = readJSON(VOICE_FILE, []).length;
    res.json({
      ok:                 true,
      counts:             index.counts || {},
      totalExamples:      Array.isArray(index.examples) ? index.examples.length : 0,
      lastUpdated:        index.lastUpdated || null,
      voiceTrainingCount: voiceCount,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /kb/reindex ──────────────────────────────────────────────────────────
router.post('/kb/reindex', (_req, res) => {
  try {
    const index = indexExamples();
    res.json({
      ok:     true,
      counts: index.counts,
      total:  Array.isArray(index.examples) ? index.examples.length : 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /kb/migrate-voice ────────────────────────────────────────────────────
router.post('/kb/migrate-voice', (_req, res) => {
  try {
    const voiceEntries = readJSON(VOICE_FILE, []);
    if (!voiceEntries.length) {
      return res.json({ ok: true, migrated: 0, message: 'No voice training entries to migrate.' });
    }
    let migrated = 0, skipped = 0;
    for (const entry of voiceEntries) {
      const text = trimText(entry.editedText || entry.text || '', 8000);
      if (!text || text.length < 20) { skipped++; continue; }
      try {
        addExample({
          fieldId:     entry.fieldId || 'unknown',
          formType:    normalizeFormType(entry.formType),
          sourceType:  'imported',
          qualityScore: 70,
          tags:        [],
          text,
        });
        migrated++;
      } catch { skipped++; }
    }
    res.json({ ok: true, migrated, skipped, total: voiceEntries.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /kb/ingest-to-pinecone ───────────────────────────────────────────────
// One-time migration: ingest all local KB examples into Pinecone.
// Requires PINECONE_API_KEY and PINECONE_INDEX_NAME to be set.
router.post('/kb/ingest-to-pinecone', async (_req, res) => {
  try {
    let ingestLocalKBToPinecone;
    try {
      const mod = await import('../../dist/retrieval/llamaIndex.js').catch(() =>
        import('../retrieval/llamaIndex.js'),
      );
      ingestLocalKBToPinecone = mod.ingestLocalKBToPinecone;
    } catch {
      return res.status(503).json({
        ok:    false,
        error: 'Retrieval module not available. Run: npm run build',
      });
    }
    const result = await ingestLocalKBToPinecone();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /voice/import-pdf ────────────────────────────────────────────────────
router.post('/voice/import-pdf', ensureAI, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const isPdf = req.file.mimetype === 'application/pdf' ||
      String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });

    const requestedFormType = normalizeFormType(
      req.body?.formType || req.query?.formType || DEFAULT_FORM_TYPE,
    );
    const formConfig  = getFormConfig(requestedFormType);
    const voiceFields = asArray(formConfig.voiceFields);
    if (!voiceFields.length) {
      return res.status(400).json({ ok: false, error: 'No voice fields configured for this form type' });
    }

    const { text: pdfText, method: extractMethod, error: extractError } =
      await extractPdfText(req.file.buffer, client, MODEL);

    log.info('[voice/import-pdf]', { file: req.file.originalname, method: extractMethod, chars: pdfText.length });

    if (!pdfText || pdfText.length < 200) {
      return res.status(422).json({
        ok:    false,
        error: extractError || `Could not extract sufficient text from this PDF (method: ${extractMethod}).`,
      });
    }

    const fieldList = voiceFields.map(f => `  "${f.id}": "${f.title}"`).join(',\n');
    const prompt    = `Extract ONLY narrative text for each field. Form: ${requestedFormType}.\nReturn ONLY JSON:\n{\n${fieldList}\n}\n\nREPORT TEXT:\n${pdfText.slice(0, 28000)}`;
    const r         = await client.responses.create({ model: MODEL, input: prompt });
    const extracted = parseJSONObject(aiText(r));

    const existing   = readJSON(VOICE_FILE, []);
    const importedAt = new Date().toISOString();
    const importId   = uuidv4().replace(/-/g, '').slice(0, 8);
    const filename   = trimText(req.file.originalname || 'unknown.pdf', 180);
    const added      = [];

    for (const field of voiceFields) {
      const text = trimText(extracted[field.id] || '', 8000);
      if (!text || text.length < 20) continue;
      existing.push({
        id:         uuidv4().replace(/-/g, '').slice(0, 12),
        importId,
        filename,
        fieldId:    field.id,
        fieldTitle: field.title,
        editedText: text,
        source:     'import',
        formType:   requestedFormType,
        importedAt,
      });
      added.push(field.id);
      // Also save to KB so new imports immediately improve generation
      try {
        addExample({ fieldId: field.id, formType: requestedFormType, sourceType: 'imported', qualityScore: 70, tags: [], text });
      } catch { /* non-fatal */ }
    }

    await withVoiceLock(() => {
      const latest = readJSON(VOICE_FILE, []);
      for (const entry of added
        .map(fieldId => existing.find(e => e.importId === importId && e.fieldId === fieldId))
        .filter(Boolean)) {
        if (!latest.some(e => e.id === entry.id)) latest.push(entry);
      }
      const capped = latest.length > 500 ? latest.slice(-500) : latest;
      writeJSON(VOICE_FILE, capped);
    });

    const total = readJSON(VOICE_FILE, []).length;
    res.json({ ok: true, importId, filename, formType: requestedFormType, extracted: added, total });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /voice/examples ───────────────────────────────────────────────────────
router.get('/voice/examples', (req, res) => {
  try {
    const requested = req.query?.formType ? normalizeFormType(req.query.formType) : null;
    const examples  = readJSON(VOICE_FILE, []).filter(
      e => !requested || normalizeFormType(e.formType) === requested,
    );

    const byImport = {};
    for (const e of examples) {
      if (!byImport[e.importId]) {
        byImport[e.importId] = {
          importId:   e.importId,
          filename:   e.filename,
          importedAt: e.importedAt,
          formType:   e.formType,
          fields:     [],
          previews:   {},
        };
      }
      byImport[e.importId].fields.push(e.fieldId);
      if (!byImport[e.importId].previews[e.fieldId]) {
        byImport[e.importId].previews[e.fieldId] = trimText(e.editedText, 400);
      }
    }

    const counts = {};
    for (const e of examples) counts[e.fieldId] = (counts[e.fieldId] || 0) + 1;

    res.json({
      ok:      true,
      total:   examples.length,
      counts,
      imports: Object.values(byImport).sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt)),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE helper ─────────────────────────────────────────────────────────────
function deleteVoiceExamplesBy(field, rawValue, res) {
  try {
    const val      = trimText(rawValue, 20);
    const examples = readJSON(VOICE_FILE, []).filter(e => e[field] !== val);
    writeJSON(VOICE_FILE, examples);
    res.json({ ok: true, total: examples.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ── DELETE /voice/examples/import/:importId ───────────────────────────────────
router.delete('/voice/examples/import/:importId', (req, res) =>
  deleteVoiceExamplesBy('importId', req.params.importId, res),
);

// ── DELETE /voice/examples/:id ────────────────────────────────────────────────
router.delete('/voice/examples/:id', (req, res) =>
  deleteVoiceExamplesBy('id', req.params.id, res),
);

// ── POST /voice/import-folder ─────────────────────────────────────────────────
router.post('/voice/import-folder', ensureAI, async (req, res) => {
  try {
    const requestedFormType = normalizeFormType(req.body?.formType || DEFAULT_FORM_TYPE);
    const formConfig        = getFormConfig(requestedFormType);
    const voiceFields       = asArray(formConfig.voiceFields);
    if (!voiceFields.length) {
      return res.status(400).json({ ok: false, error: 'No voice fields configured for this form type' });
    }

    const folderPath = path.join(VOICE_PDFS_DIR, requestedFormType);
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({
        ok:    false,
        error: `Folder not found: voice_pdfs/${requestedFormType}/. Create it and drop PDFs inside.`,
      });
    }

    const allFiles = fs.readdirSync(folderPath).filter(f => /\.pdf$/i.test(f));
    if (!allFiles.length) {
      return res.json({
        ok:       true,
        formType: requestedFormType,
        scanned:  0,
        imported: [],
        skipped:  [],
        total:    readJSON(VOICE_FILE, []).length,
      });
    }

    const existing       = readJSON(VOICE_FILE, []);
    const alreadyImported = new Set(
      existing
        .filter(e => normalizeFormType(e.formType) === requestedFormType)
        .map(e => e.filename),
    );

    const toImport = allFiles.filter(f => !alreadyImported.has(f));
    const skipped  = allFiles.filter(f => alreadyImported.has(f));

    if (!toImport.length) {
      return res.json({
        ok:       true,
        formType: requestedFormType,
        scanned:  allFiles.length,
        imported: [],
        skipped,
        message:  `All PDFs already imported. Drop new PDFs into voice_pdfs/${requestedFormType}/ to add more.`,
        total:    existing.length,
      });
    }

    const fieldList  = voiceFields.map(f => `  "${f.id}": "${f.title}"`).join(',\n');
    const importedFiles = [];
    const errors     = [];
    const importedAt = new Date().toISOString();

    for (const filename of toImport) {
      const filePath = path.join(folderPath, filename);
      try {
        const buffer = fs.readFileSync(filePath);
        const { text: pdfText, method: extractMethod, error: extractError } =
          await extractPdfText(buffer, client, MODEL);

        log.info('[voice/import-folder]', { filename, method: extractMethod, chars: pdfText.length });

        if (!pdfText || pdfText.length < 200) {
          errors.push({ filename, error: extractError || `Could not extract text (method: ${extractMethod})` });
          continue;
        }

        const prompt    = `Extract ONLY narrative text for each field. Form: ${requestedFormType}.\nReturn ONLY JSON:\n{\n${fieldList}\n}\n\nREPORT TEXT:\n${pdfText.slice(0, 28000)}`;
        const r         = await client.responses.create({ model: MODEL, input: prompt });
        const extracted = parseJSONObject(aiText(r));

        const importId = uuidv4().replace(/-/g, '').slice(0, 8);
        let addedCount = 0;

        for (const field of voiceFields) {
          const text = trimText(extracted[field.id] || '', 8000);
          if (!text || text.length < 20) continue;
          existing.push({
            id:         uuidv4().replace(/-/g, '').slice(0, 12),
            importId,
            filename,
            fieldId:    field.id,
            fieldTitle: field.title,
            editedText: text,
            source:     'folder',
            formType:   requestedFormType,
            importedAt,
          });
          addedCount++;
          try {
            addExample({ fieldId: field.id, formType: requestedFormType, sourceType: 'imported', qualityScore: 70, tags: [], text });
          } catch { /* non-fatal */ }
        }
        importedFiles.push({ filename, importId, fields: addedCount });
      } catch (err) {
        errors.push({ filename, error: err.message });
      }
    }

    await withVoiceLock(() => {
      const latest     = readJSON(VOICE_FILE, []);
      const newEntries = existing.filter(e => e.importedAt === importedAt);
      for (const entry of newEntries) {
        if (!latest.some(e => e.id === entry.id)) latest.push(entry);
      }
      const capped = latest.length > 500 ? latest.slice(-500) : latest;
      writeJSON(VOICE_FILE, capped);
    });

    const total = readJSON(VOICE_FILE, []).length;
    res.json({
      ok:       true,
      formType: requestedFormType,
      scanned:  allFiles.length,
      imported: importedFiles,
      skipped,
      errors,
      total,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /voice/folder-status ──────────────────────────────────────────────────
router.get('/voice/folder-status', (req, res) => {
  try {
    const requestedFormType = normalizeFormType(req.query?.formType || DEFAULT_FORM_TYPE);
    const folderPath        = path.join(VOICE_PDFS_DIR, requestedFormType);

    if (!fs.existsSync(folderPath)) {
      return res.json({ ok: true, formType: requestedFormType, files: [], folderExists: false });
    }

    const allFiles    = fs.readdirSync(folderPath).filter(f => /\.pdf$/i.test(f));
    const existing    = readJSON(VOICE_FILE, []);
    const importedSet = new Set(
      existing
        .filter(e => normalizeFormType(e.formType) === requestedFormType)
        .map(e => e.filename),
    );

    const files = allFiles.map(f => ({ filename: f, imported: importedSet.has(f) }));
    res.json({
      ok:           true,
      formType:     requestedFormType,
      folderExists: true,
      files,
      total:        allFiles.length,
      newCount:     files.filter(f => !f.imported).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
