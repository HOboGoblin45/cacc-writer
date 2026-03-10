/**
 * server/ingestion/stagingService.js
 * ------------------------------------
 * Phase 5 — Document Staging and Review Service
 *
 * Manages the full lifecycle of document ingestion:
 *   1. Register documents in case_documents table
 *   2. Run extraction and store results
 *   3. Stage extracted facts and narrative sections for review
 *   4. Promote approved items to case facts / memory bank
 *   5. Track provenance throughout
 *
 * Usage:
 *   import { registerDocument, runDocumentExtraction, ... } from '../ingestion/stagingService.js';
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';
import { classifyDocument, mapLegacyDocType } from './documentClassifier.js';
import { extractStructuredFacts, getExtractorTypes } from './documentExtractors.js';
import { extractNarrativeSections } from './narrativeExtractor.js';
import { buildMergePlan, applyMergePlan, getAutoAcceptPaths } from './contextMapper.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', '..', 'cases');

// ── Document registration ────────────────────────────────────────────────────

/**
 * Register a new document in the case_documents table.
 *
 * @param {object} params
 * @param {string} params.caseId
 * @param {string} params.originalFilename
 * @param {string} params.storedFilename
 * @param {string} [params.legacyDocType] — legacy docType from form config
 * @param {number} [params.fileSizeBytes]
 * @param {number} [params.pageCount]
 * @param {string} [params.extractedText] — for classification
 * @returns {{ documentId: string, docType: string, classification: object }}
 */
export function registerDocument({
  caseId, originalFilename, storedFilename,
  legacyDocType = null, fileSizeBytes = 0, pageCount = 0,
  extractedText = '',
}) {
  const db = getDb();
  const documentId = uuidv4();

  // Classify the document
  const classification = classifyDocument(originalFilename, extractedText, legacyDocType);

  // Compute file hash if we have text
  const fileHash = extractedText
    ? crypto.createHash('sha256').update(extractedText).digest('hex').slice(0, 16)
    : null;

  db.prepare(`
    INSERT INTO case_documents (
      id, case_id, original_filename, stored_filename, doc_type,
      file_type, file_size_bytes, page_count, file_hash,
      classification_method, classification_confidence,
      extraction_status, text_length, uploaded_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    documentId, caseId, originalFilename, storedFilename,
    classification.docType,
    path.extname(originalFilename).replace('.', '') || 'pdf',
    fileSizeBytes, pageCount, fileHash,
    classification.method, classification.confidence,
    extractedText ? 'extracted' : 'pending',
    extractedText ? extractedText.length : 0,
  );

  return { documentId, docType: classification.docType, classification };
}

/**
 * Get all documents for a case.
 * @param {string} caseId
 * @returns {object[]}
 */
export function getCaseDocuments(caseId) {
  return getDb().prepare(
    'SELECT * FROM case_documents WHERE case_id = ? ORDER BY uploaded_at DESC'
  ).all(caseId);
}

/**
 * Get a single document by ID.
 * @param {string} documentId
 * @returns {object|null}
 */
export function getDocument(documentId) {
  return getDb().prepare('SELECT * FROM case_documents WHERE id = ?').get(documentId) || null;
}

/**
 * Update document classification (user override).
 * @param {string} documentId
 * @param {string} newDocType
 */
export function reclassifyDocument(documentId, newDocType) {
  getDb().prepare(`
    UPDATE case_documents
       SET doc_type = ?, classification_method = 'manual',
           classification_confidence = 1.0, updated_at = datetime('now')
     WHERE id = ?
  `).run(newDocType, documentId);
}

/**
 * Delete a document and its extractions.
 * @param {string} documentId
 */
export function deleteDocument(documentId) {
  const db = getDb();
  db.prepare('DELETE FROM extracted_facts WHERE document_id = ?').run(documentId);
  db.prepare('DELETE FROM extracted_sections WHERE document_id = ?').run(documentId);
  db.prepare('DELETE FROM document_extractions WHERE document_id = ?').run(documentId);
  db.prepare('DELETE FROM case_documents WHERE id = ?').run(documentId);
}

// ── Extraction pipeline ──────────────────────────────────────────────────────

/**
 * Run structured extraction on a document.
 *
 * @param {string} documentId — case_documents.id
 * @param {string} extractedText — raw text from PDF
 * @param {object} [options] — { aiClient, model }
 * @returns {Promise<ExtractionResult>}
 *
 * @typedef {object} ExtractionResult
 * @property {string} extractionId
 * @property {number} factsExtracted
 * @property {number} sectionsExtracted
 * @property {object[]} facts
 * @property {object[]} sections
 */
export async function runDocumentExtraction(documentId, extractedText, options = {}) {
  const db = getDb();
  const doc = getDocument(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const t0 = Date.now();
  const extractionId = uuidv4();
  const isNarrativeSource = doc.doc_type === 'prior_appraisal' || doc.doc_type === 'narrative_source';
  const extractionMethod = isNarrativeSource ? 'narrative' : 'structured';

  // Create extraction job
  db.prepare(`
    INSERT INTO document_extractions (id, document_id, case_id, doc_type, status, extraction_method, started_at, created_at)
    VALUES (?, ?, ?, ?, 'running', ?, datetime('now'), datetime('now'))
  `).run(extractionId, documentId, doc.case_id, doc.doc_type, extractionMethod);

  try {
    let factsExtracted = 0;
    let sectionsExtracted = 0;
    const allFacts = [];
    const allSections = [];

    // 1. Structured fact extraction (for non-narrative doc types)
    if (getExtractorTypes().includes(doc.doc_type)) {
      const facts = await extractStructuredFacts(doc.doc_type, extractedText, options);

      for (const f of facts) {
        const factId = uuidv4();
        db.prepare(`
          INSERT INTO extracted_facts (id, extraction_id, document_id, case_id, fact_path, fact_value, confidence, source_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(factId, extractionId, documentId, doc.case_id, f.factPath, f.value, f.confidence, f.sourceText || '');

        allFacts.push({ id: factId, ...f, documentId });
        factsExtracted++;
      }
    }

    // 2. Narrative section extraction (for prior appraisals)
    if (isNarrativeSource) {
      // Determine form type from case meta
      const metaPath = path.join(CASES_DIR, doc.case_id, 'meta.json');
      const meta = readJSON(metaPath, {});
      const formType = meta.formType || '1004';

      const sections = await extractNarrativeSections(extractedText, formType);

      for (const s of sections) {
        const sectionId = uuidv4();
        db.prepare(`
          INSERT INTO extracted_sections (
            id, extraction_id, document_id, case_id,
            section_type, section_label, text, text_hash,
            word_count, form_type, confidence, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          sectionId, extractionId, documentId, doc.case_id,
          s.fieldId, s.label, s.text, s.textHash,
          s.wordCount, formType, s.confidence,
        );

        allSections.push({ id: sectionId, ...s, documentId });
        sectionsExtracted++;
      }
    }

    // Update extraction job
    db.prepare(`
      UPDATE document_extractions
         SET status = 'completed', facts_extracted = ?, sections_extracted = ?,
             raw_text_length = ?, duration_ms = ?, completed_at = datetime('now')
       WHERE id = ?
    `).run(factsExtracted, sectionsExtracted, extractedText.length, Date.now() - t0, extractionId);

    // Update document extraction status
    db.prepare(`
      UPDATE case_documents SET extraction_status = 'extracted', updated_at = datetime('now') WHERE id = ?
    `).run(documentId);

    return { extractionId, factsExtracted, sectionsExtracted, facts: allFacts, sections: allSections };

  } catch (err) {
    db.prepare(`
      UPDATE document_extractions SET status = 'failed', error_text = ?, completed_at = datetime('now') WHERE id = ?
    `).run(err.message, extractionId);

    db.prepare(`
      UPDATE case_documents SET extraction_status = 'failed', updated_at = datetime('now') WHERE id = ?
    `).run(documentId);

    throw err;
  }
}

// ── Fact review ──────────────────────────────────────────────────────────────

/**
 * Get extracted facts for a case, optionally filtered by review status.
 * @param {string} caseId
 * @param {string} [reviewStatus] — 'pending' | 'accepted' | 'rejected' | 'merged'
 * @returns {object[]}
 */
export function getExtractedFacts(caseId, reviewStatus = null) {
  if (reviewStatus) {
    return getDb().prepare(
      'SELECT ef.*, cd.doc_type, cd.original_filename FROM extracted_facts ef JOIN case_documents cd ON ef.document_id = cd.id WHERE ef.case_id = ? AND ef.review_status = ? ORDER BY ef.created_at DESC'
    ).all(caseId, reviewStatus);
  }
  return getDb().prepare(
    'SELECT ef.*, cd.doc_type, cd.original_filename FROM extracted_facts ef JOIN case_documents cd ON ef.document_id = cd.id WHERE ef.case_id = ? ORDER BY ef.created_at DESC'
  ).all(caseId);
}

/**
 * Accept or reject an extracted fact.
 * @param {string} factId
 * @param {'accepted'|'rejected'} action
 */
export function reviewFact(factId, action) {
  getDb().prepare(
    'UPDATE extracted_facts SET review_status = ? WHERE id = ?'
  ).run(action, factId);
}

/**
 * Accept multiple facts and merge them into case facts.json.
 * @param {string} caseId
 * @param {string[]} factIds — IDs of facts to accept
 * @returns {{ merged: number }}
 */
export function acceptAndMergeFacts(caseId, factIds) {
  const db = getDb();
  const factsPath = path.join(CASES_DIR, caseId, 'facts.json');
  const facts = readJSON(factsPath, {});

  let merged = 0;
  for (const factId of factIds) {
    const fact = db.prepare('SELECT * FROM extracted_facts WHERE id = ? AND case_id = ?').get(factId, caseId);
    if (!fact) continue;

    // Parse path and set value
    const [section, field] = fact.fact_path.split('.');
    if (!section || !field) continue;

    if (!facts[section]) facts[section] = {};
    facts[section][field] = {
      value:      fact.fact_value,
      confidence: fact.confidence,
      source:     `document:${fact.document_id}`,
    };

    db.prepare(
      "UPDATE extracted_facts SET review_status = 'merged', merged_at = datetime('now') WHERE id = ?"
    ).run(factId);
    merged++;
  }

  if (merged > 0) {
    writeJSON(factsPath, facts);
  }

  return { merged };
}

// ── Section review ───────────────────────────────────────────────────────────

/**
 * Get extracted narrative sections for a case.
 * @param {string} caseId
 * @param {string} [reviewStatus]
 * @returns {object[]}
 */
export function getExtractedSections(caseId, reviewStatus = null) {
  if (reviewStatus) {
    return getDb().prepare(
      'SELECT es.*, cd.original_filename FROM extracted_sections es JOIN case_documents cd ON es.document_id = cd.id WHERE es.case_id = ? AND es.review_status = ? ORDER BY es.created_at DESC'
    ).all(caseId, reviewStatus);
  }
  return getDb().prepare(
    'SELECT es.*, cd.original_filename FROM extracted_sections es JOIN case_documents cd ON es.document_id = cd.id WHERE es.case_id = ? ORDER BY es.created_at DESC'
  ).all(caseId);
}

/**
 * Approve an extracted section and promote it to the memory bank.
 * @param {string} sectionId — extracted_sections.id
 * @returns {{ memoryItemId: string }}
 */
export function approveSection(sectionId) {
  const db = getDb();
  const section = db.prepare('SELECT * FROM extracted_sections WHERE id = ?').get(sectionId);
  if (!section) throw new Error(`Section not found: ${sectionId}`);

  const memoryItemId = uuidv4();

  // Check for duplicate text in memory
  const existing = db.prepare(
    'SELECT id FROM memory_items WHERE text_hash = ?'
  ).get(section.text_hash);

  if (existing) {
    // Already in memory — just mark as approved pointing to existing
    db.prepare(`
      UPDATE extracted_sections
         SET review_status = 'approved', promoted_memory_id = ?, reviewed_at = datetime('now')
       WHERE id = ?
    `).run(existing.id, sectionId);
    return { memoryItemId: existing.id };
  }

  // Insert into memory_items
  db.prepare(`
    INSERT INTO memory_items (
      id, section_type, form_type, text, text_hash,
      source_type, quality_score, approved, staged,
      source_file, source_report_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'imported', 75, 1, 0, ?, ?, datetime('now'), datetime('now'))
  `).run(
    memoryItemId, section.section_type, section.form_type || '1004',
    section.text, section.text_hash,
    section.document_id, section.extraction_id,
  );

  // Update extraction section
  db.prepare(`
    UPDATE extracted_sections
       SET review_status = 'approved', promoted_memory_id = ?, reviewed_at = datetime('now')
     WHERE id = ?
  `).run(memoryItemId, sectionId);

  return { memoryItemId };
}

/**
 * Reject an extracted section.
 * @param {string} sectionId
 */
export function rejectSection(sectionId) {
  getDb().prepare(`
    UPDATE extracted_sections SET review_status = 'rejected', reviewed_at = datetime('now') WHERE id = ?
  `).run(sectionId);
}

// ── Extraction summaries ─────────────────────────────────────────────────────

/**
 * Get extraction summary for a case.
 * @param {string} caseId
 * @returns {object}
 */
export function getCaseExtractionSummary(caseId) {
  const db = getDb();

  const documents = db.prepare(
    'SELECT COUNT(*) as count FROM case_documents WHERE case_id = ?'
  ).get(caseId);

  const byType = db.prepare(
    'SELECT doc_type, COUNT(*) as count FROM case_documents WHERE case_id = ? GROUP BY doc_type'
  ).all(caseId);

  const pendingFacts = db.prepare(
    "SELECT COUNT(*) as count FROM extracted_facts WHERE case_id = ? AND review_status = 'pending'"
  ).get(caseId);

  const pendingSections = db.prepare(
    "SELECT COUNT(*) as count FROM extracted_sections WHERE case_id = ? AND review_status = 'pending'"
  ).get(caseId);

  const mergedFacts = db.prepare(
    "SELECT COUNT(*) as count FROM extracted_facts WHERE case_id = ? AND review_status = 'merged'"
  ).get(caseId);

  const approvedSections = db.prepare(
    "SELECT COUNT(*) as count FROM extracted_sections WHERE case_id = ? AND review_status = 'approved'"
  ).get(caseId);

  return {
    totalDocuments:   documents.count,
    documentsByType:  Object.fromEntries(byType.map(r => [r.doc_type, r.count])),
    pendingFacts:     pendingFacts.count,
    pendingSections:  pendingSections.count,
    mergedFacts:      mergedFacts.count,
    approvedSections: approvedSections.count,
  };
}

/**
 * Get all extractions for a document.
 * @param {string} documentId
 * @returns {object[]}
 */
export function getDocumentExtractions(documentId) {
  return getDb().prepare(
    'SELECT * FROM document_extractions WHERE document_id = ? ORDER BY created_at DESC'
  ).all(documentId);
}
