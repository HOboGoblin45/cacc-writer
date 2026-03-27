/**
 * server/export/pdfExportService.js
 * -----------------------------------
 * Priority 11 — PDF Export Service
 *
 * Structural PDF generation service. Builds a structured document model
 * from case data (facts, sections, photos, comps, adjustments, reconciliation).
 * Actual PDF byte rendering would integrate with a PDF library (e.g., pdfkit, puppeteer).
 *
 * Public API:
 *   generatePdf(caseId, options)          — create export job, build PDF structure
 *   getPdfPageManifest(caseId, formType)  — ordered page list with content mapping
 *   buildCoverPage(caseData)              — structured cover page data
 *   buildPhotoPages(caseId, options)      — structured photo page layout
 *   buildAddendaPages(caseId)             — addenda content pages
 *   estimatePageCount(caseId)             — estimate page count before generation
 */

import { randomUUID } from 'crypto';
import { dbGet, dbAll, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId(prefix) {
  return `${prefix}${randomUUID().slice(0, 12)}`;
}

function now() {
  return new Date().toISOString();
}

/**
 * Load case data needed for PDF generation.
 * @param {string} caseId
 * @returns {Object} caseData bundle
 */
function loadCaseData(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const caseOutputs = dbGet('SELECT * FROM case_outputs WHERE case_id = ?', [caseId]);

  // Generated sections — latest per section_id
  const sections = dbAll(
    `SELECT * FROM generated_sections
     WHERE case_id = ? AND (final_text IS NOT NULL OR reviewed_text IS NOT NULL OR draft_text IS NOT NULL)
     ORDER BY section_id, created_at DESC`,
    [caseId]
  );

  // Dedupe to latest per section_id
  const sectionMap = {};
  for (const s of sections) {
    if (!sectionMap[s.section_id]) {
      sectionMap[s.section_id] = s;
    }
  }

  // Photos from inspection_photos if available
  let photos = [];
  try {
    photos = dbAll(
      'SELECT * FROM inspection_photos WHERE case_id = ? ORDER BY sort_order, created_at',
      [caseId]
    );
  } catch {
    // Table may not exist
  }

  // Comps
  let comps = [];
  try {
    comps = dbAll(
      `SELECT cc.*, cs.overall_score
       FROM comp_candidates cc
       LEFT JOIN comp_scores cs ON cs.comp_candidate_id = cc.id
       WHERE cc.case_id = ? AND cc.is_active = 1
       ORDER BY cs.overall_score DESC`,
      [caseId]
    );
  } catch {
    // Table may not exist
  }

  // Adjustments
  let adjustments = [];
  try {
    adjustments = dbAll(
      'SELECT * FROM adjustment_support_records WHERE case_id = ? ORDER BY grid_slot, adjustment_category',
      [caseId]
    );
  } catch {
    // Table may not exist
  }

  // Reconciliation
  let reconciliation = null;
  try {
    reconciliation = dbGet(
      'SELECT * FROM reconciliation_support_records WHERE case_id = ?',
      [caseId]
    );
  } catch {
    // Table may not exist
  }

  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
  const outputs = caseOutputs ? JSON.parse(caseOutputs.outputs_json || '{}') : {};

  return {
    caseRecord,
    facts,
    outputs,
    sections: sectionMap,
    photos,
    comps,
    adjustments,
    reconciliation,
  };
}

// ── Form-type page templates ─────────────────────────────────────────────────

const PAGE_TEMPLATES = {
  '1004': [
    { pageId: 'cover', label: 'Cover Page', type: 'cover' },
    { pageId: 'subject', label: 'Subject - Contract - Neighborhood', type: 'form_page' },
    { pageId: 'site_improvements', label: 'Site - Improvements', type: 'form_page' },
    { pageId: 'sales_comparison', label: 'Sales Comparison Approach', type: 'form_page' },
    { pageId: 'reconciliation', label: 'Reconciliation', type: 'form_page' },
    { pageId: 'photos_subject', label: 'Subject Photos', type: 'photos' },
    { pageId: 'photos_comps', label: 'Comparable Photos', type: 'photos' },
    { pageId: 'maps', label: 'Location & Plat Maps', type: 'maps' },
    { pageId: 'sketches', label: 'Building Sketch / Floor Plan', type: 'sketches' },
    { pageId: 'addenda', label: 'Addenda', type: 'addenda' },
    { pageId: 'certifications', label: 'Appraiser Certifications', type: 'certifications' },
  ],
  '1073': [
    { pageId: 'cover', label: 'Cover Page', type: 'cover' },
    { pageId: 'subject', label: 'Subject - Contract - Project', type: 'form_page' },
    { pageId: 'unit_improvements', label: 'Unit Description - Improvements', type: 'form_page' },
    { pageId: 'sales_comparison', label: 'Sales Comparison Approach', type: 'form_page' },
    { pageId: 'reconciliation', label: 'Reconciliation', type: 'form_page' },
    { pageId: 'photos_subject', label: 'Subject Photos', type: 'photos' },
    { pageId: 'photos_comps', label: 'Comparable Photos', type: 'photos' },
    { pageId: 'maps', label: 'Location & Plat Maps', type: 'maps' },
    { pageId: 'sketches', label: 'Building Sketch / Floor Plan', type: 'sketches' },
    { pageId: 'addenda', label: 'Addenda', type: 'addenda' },
    { pageId: 'certifications', label: 'Appraiser Certifications', type: 'certifications' },
  ],
  '2055': [
    { pageId: 'cover', label: 'Cover Page', type: 'cover' },
    { pageId: 'subject', label: 'Subject', type: 'form_page' },
    { pageId: 'sales_comparison', label: 'Sales Comparison Approach', type: 'form_page' },
    { pageId: 'reconciliation', label: 'Reconciliation', type: 'form_page' },
    { pageId: 'photos_subject', label: 'Subject Photos', type: 'photos' },
    { pageId: 'photos_comps', label: 'Comparable Photos', type: 'photos' },
    { pageId: 'maps', label: 'Location Map', type: 'maps' },
    { pageId: 'addenda', label: 'Addenda', type: 'addenda' },
    { pageId: 'certifications', label: 'Appraiser Certifications', type: 'certifications' },
  ],
  '1025': [
    { pageId: 'cover', label: 'Cover Page', type: 'cover' },
    { pageId: 'subject', label: 'Subject - Neighborhood - Site', type: 'form_page' },
    { pageId: 'improvements', label: 'Improvements', type: 'form_page' },
    { pageId: 'sales_comparison', label: 'Sales Comparison Approach', type: 'form_page' },
    { pageId: 'income_approach', label: 'Income Approach', type: 'form_page' },
    { pageId: 'reconciliation', label: 'Reconciliation', type: 'form_page' },
    { pageId: 'photos_subject', label: 'Subject Photos', type: 'photos' },
    { pageId: 'photos_comps', label: 'Comparable Photos', type: 'photos' },
    { pageId: 'maps', label: 'Location & Plat Maps', type: 'maps' },
    { pageId: 'sketches', label: 'Building Sketch / Floor Plan', type: 'sketches' },
    { pageId: 'addenda', label: 'Addenda', type: 'addenda' },
    { pageId: 'certifications', label: 'Appraiser Certifications', type: 'certifications' },
  ],
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a PDF export for a case.
 * Creates an export job and builds the structured document model.
 *
 * @param {string} caseId
 * @param {Object} [options]
 * @param {string} [options.formType] — override form type (default: from case record)
 * @param {string} [options.watermark] — 'draft' | 'final' | 'review' | 'none'
 * @param {boolean} [options.includePhotos] — include photo pages (default: true)
 * @param {boolean} [options.includeAddenda] — include addenda pages (default: true)
 * @param {boolean} [options.includeMaps] — include map pages (default: true)
 * @param {boolean} [options.includeSketches] — include sketch pages (default: true)
 * @param {string} [options.recipientName]
 * @param {string} [options.recipientEmail]
 * @param {string} [options.deliveryMethod]
 * @returns {Object} { job, document }
 */
export function generatePdf(caseId, options = {}) {
  const startTime = Date.now();
  const jobId = genId('expj_');
  const ts = now();

  // Load case data
  const caseData = loadCaseData(caseId);
  if (!caseData.caseRecord) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const formType = options.formType || caseData.caseRecord.form_type || '1004';
  const outputFormat = formType === '1073' ? 'pdf_1073' : 'pdf_1004';
  const watermark = options.watermark || 'none';
  const includePhotos = options.includePhotos !== false ? 1 : 0;
  const includeAddenda = options.includeAddenda !== false ? 1 : 0;
  const includeMaps = options.includeMaps !== false ? 1 : 0;
  const includeSketches = options.includeSketches !== false ? 1 : 0;

  // Create export job record
  dbRun(
    `INSERT INTO export_jobs (id, case_id, export_type, export_status, output_format,
       include_photos, include_addenda, include_maps, include_sketches,
       watermark, recipient_name, recipient_email, delivery_method,
       options_json, started_at, created_at)
     VALUES (?, ?, 'pdf', 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobId, caseId, outputFormat,
      includePhotos, includeAddenda, includeMaps, includeSketches,
      watermark, options.recipientName || null, options.recipientEmail || null,
      options.deliveryMethod || null,
      JSON.stringify(options), ts, ts,
    ]
  );

  try {
    // Build page manifest
    const manifest = getPdfPageManifest(caseId, formType);

    // Filter pages based on options
    const filteredManifest = manifest.filter(page => {
      if (!includePhotos && page.type === 'photos') return false;
      if (!includeAddenda && page.type === 'addenda') return false;
      if (!includeMaps && page.type === 'maps') return false;
      if (!includeSketches && page.type === 'sketches') return false;
      return true;
    });

    // Build structured document
    const document = {
      formType,
      outputFormat,
      watermark,
      generatedAt: ts,
      caseId,
      pages: [],
    };

    for (const pageSpec of filteredManifest) {
      const pageData = buildPageContent(pageSpec, caseData, options);
      document.pages.push(pageData);
    }

    // Estimate page count
    const pageCount = estimatePageCountFromDocument(document, caseData);

    const durationMs = Date.now() - startTime;
    const fileName = `${caseId}_${formType}_${watermark}_${Date.now()}.pdf`;

    // Update job as completed
    dbRun(
      `UPDATE export_jobs SET export_status = 'completed', file_name = ?,
         page_count = ?, completed_at = ?, duration_ms = ?
       WHERE id = ?`,
      [fileName, pageCount, now(), durationMs, jobId]
    );

    log.info('pdf-export:completed', { caseId, jobId, formType, pageCount, durationMs });

    return {
      job: {
        id: jobId,
        caseId,
        exportType: 'pdf',
        exportStatus: 'completed',
        outputFormat,
        fileName,
        pageCount,
        durationMs,
      },
      document,
    };
  } catch (err) {
    dbRun(
      `UPDATE export_jobs SET export_status = 'failed', error_message = ?,
         completed_at = ?, duration_ms = ?
       WHERE id = ?`,
      [err.message, now(), Date.now() - startTime, jobId]
    );

    log.error('pdf-export:failed', { caseId, jobId, error: err.message });
    throw err;
  }
}

/**
 * Get ordered page manifest for a PDF export.
 *
 * @param {string} caseId
 * @param {string} [formType] — defaults to case's form type
 * @returns {Array<Object>} page manifest entries
 */
export function getPdfPageManifest(caseId, formType) {
  if (!formType) {
    const rec = dbGet('SELECT form_type FROM case_records WHERE case_id = ?', [caseId]);
    formType = rec?.form_type || '1004';
  }

  const template = PAGE_TEMPLATES[formType] || PAGE_TEMPLATES['1004'];

  // Build manifest with content availability
  const caseData = loadCaseData(caseId);

  return template.map((page, index) => {
    const hasContent = checkPageContent(page, caseData);
    return {
      ...page,
      pageNumber: index + 1,
      hasContent,
      contentSections: getPageSections(page, formType),
    };
  });
}

/**
 * Build structured cover page data.
 *
 * @param {Object} caseData — loaded case data bundle
 * @returns {Object} cover page structure
 */
export function buildCoverPage(caseData) {
  const { facts, caseRecord } = caseData;
  const subject = facts.subject || {};
  const contract = facts.contract || {};
  const appraiser = facts.appraiser || {};

  return {
    pageId: 'cover',
    type: 'cover',
    label: 'Cover Page',
    content: {
      propertyAddress: {
        street: subject.address || subject.streetAddress || '',
        city: subject.city || '',
        state: subject.state || '',
        zip: subject.zip || subject.zipCode || '',
        county: subject.county || '',
      },
      borrowerName: subject.borrower || caseRecord?.borrower || '',
      lenderName: contract?.lender || facts.lender?.name || '',
      formType: caseRecord?.form_type || '',
      effectiveDate: facts.effectiveDate || facts.inspectionDate || '',
      reportDate: new Date().toISOString().split('T')[0],
      appraiser: {
        name: appraiser.name || '',
        licenseNumber: appraiser.licenseNumber || appraiser.license || '',
        licenseState: appraiser.licenseState || appraiser.state || '',
        company: appraiser.company || appraiser.firmName || '',
      },
    },
  };
}

/**
 * Build structured photo pages (6 photos per page, with captions).
 *
 * @param {string} caseId
 * @param {Object} [options]
 * @param {number} [options.photosPerPage] — default 6
 * @returns {Array<Object>} photo page structures
 */
export function buildPhotoPages(caseId, options = {}) {
  const photosPerPage = options.photosPerPage || 6;

  let photos = [];
  try {
    photos = dbAll(
      'SELECT * FROM inspection_photos WHERE case_id = ? ORDER BY sort_order, created_at',
      [caseId]
    );
  } catch {
    // Table may not exist
  }

  if (photos.length === 0) {
    return [{
      pageId: 'photos_empty',
      type: 'photos',
      label: 'Photos',
      content: { photos: [], message: 'No photos available' },
    }];
  }

  // Split into subject and comp photos
  const subjectPhotos = photos.filter(p => p.photo_category !== 'comparable');
  const compPhotos = photos.filter(p => p.photo_category === 'comparable');

  const pages = [];

  // Subject photo pages
  for (let i = 0; i < subjectPhotos.length; i += photosPerPage) {
    const chunk = subjectPhotos.slice(i, i + photosPerPage);
    pages.push({
      pageId: `photos_subject_${Math.floor(i / photosPerPage) + 1}`,
      type: 'photos',
      label: `Subject Photos (Page ${Math.floor(i / photosPerPage) + 1})`,
      content: {
        category: 'subject',
        photos: chunk.map(p => ({
          id: p.id,
          category: p.photo_category,
          label: p.label || p.photo_category,
          filePath: p.file_path,
          fileName: p.file_name,
          caption: p.notes || p.label || p.photo_category,
        })),
        layout: { columns: 2, rows: Math.ceil(chunk.length / 2) },
      },
    });
  }

  // Comparable photo pages
  for (let i = 0; i < compPhotos.length; i += photosPerPage) {
    const chunk = compPhotos.slice(i, i + photosPerPage);
    pages.push({
      pageId: `photos_comps_${Math.floor(i / photosPerPage) + 1}`,
      type: 'photos',
      label: `Comparable Photos (Page ${Math.floor(i / photosPerPage) + 1})`,
      content: {
        category: 'comparable',
        photos: chunk.map(p => ({
          id: p.id,
          category: p.photo_category,
          label: p.label || 'Comparable',
          filePath: p.file_path,
          fileName: p.file_name,
          caption: p.notes || p.label || 'Comparable',
        })),
        layout: { columns: 2, rows: Math.ceil(chunk.length / 2) },
      },
    });
  }

  return pages;
}

/**
 * Build addenda content pages.
 *
 * @param {string} caseId
 * @returns {Array<Object>} addenda page structures
 */
export function buildAddendaPages(caseId) {
  const caseData = loadCaseData(caseId);
  const pages = [];

  // Collect all addenda-worthy content
  const addendaSections = [];

  // Check for narrative sections that are addenda
  for (const [sectionId, section] of Object.entries(caseData.sections)) {
    if (sectionId.includes('addend') || sectionId.includes('supplemental')) {
      const text = section.final_text || section.reviewed_text || section.draft_text || '';
      if (text.trim()) {
        addendaSections.push({
          sectionId,
          label: sectionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          text,
          wordCount: text.split(/\s+/).length,
        });
      }
    }
  }

  // Additional comps addendum (if more than 3 comps)
  if (caseData.comps.length > 3) {
    const extraComps = caseData.comps.slice(3);
    addendaSections.push({
      sectionId: 'additional_comps',
      label: 'Additional Comparable Sales',
      text: `${extraComps.length} additional comparable sale(s) considered in this appraisal.`,
      comps: extraComps.map(c => {
        const data = JSON.parse(c.candidate_json || '{}');
        return {
          id: c.id,
          sourceKey: c.source_key,
          address: data.address || data.streetAddress || c.source_key,
          salePrice: data.salePrice || data.sale_price,
          saleDate: data.saleDate || data.sale_date,
          score: c.overall_score,
        };
      }),
      wordCount: 50,
    });
  }

  // Market conditions addendum
  const marketSection = caseData.sections['market_conditions'] || caseData.sections['neighborhood'];
  if (marketSection) {
    const text = marketSection.final_text || marketSection.reviewed_text || marketSection.draft_text || '';
    if (text.length > 500) {
      addendaSections.push({
        sectionId: 'market_conditions_addendum',
        label: 'Market Conditions Addendum',
        text,
        wordCount: text.split(/\s+/).length,
      });
    }
  }

  if (addendaSections.length === 0) {
    return [{
      pageId: 'addenda_none',
      type: 'addenda',
      label: 'Addenda',
      content: { sections: [], message: 'No addenda required' },
    }];
  }

  // Paginate addenda (~400 words per page estimate)
  const WORDS_PER_PAGE = 400;
  let currentPage = { sections: [], totalWords: 0 };
  let pageNum = 1;

  for (const section of addendaSections) {
    if (currentPage.totalWords + section.wordCount > WORDS_PER_PAGE && currentPage.sections.length > 0) {
      pages.push({
        pageId: `addenda_${pageNum}`,
        type: 'addenda',
        label: `Addenda (Page ${pageNum})`,
        content: currentPage,
      });
      pageNum++;
      currentPage = { sections: [], totalWords: 0 };
    }
    currentPage.sections.push(section);
    currentPage.totalWords += section.wordCount;
  }

  if (currentPage.sections.length > 0) {
    pages.push({
      pageId: `addenda_${pageNum}`,
      type: 'addenda',
      label: `Addenda (Page ${pageNum})`,
      content: currentPage,
    });
  }

  return pages;
}

/**
 * Estimate page count before generation.
 *
 * @param {string} caseId
 * @returns {Object} { estimated, breakdown }
 */
export function estimatePageCount(caseId) {
  const caseData = loadCaseData(caseId);
  const caseRecord = caseData.caseRecord;
  const formType = caseRecord?.form_type || '1004';
  const template = PAGE_TEMPLATES[formType] || PAGE_TEMPLATES['1004'];

  // Base form pages
  const formPages = template.filter(p => p.type === 'form_page' || p.type === 'cover' || p.type === 'certifications').length;

  // Photo pages (6 per page)
  const photoCount = caseData.photos.length || 6; // estimate 6 if no photos yet
  const photoPages = Math.ceil(photoCount / 6);

  // Map pages
  const mapPages = 1;

  // Sketch pages
  const sketchPages = 1;

  // Addenda pages
  let addendaWords = 0;
  for (const section of Object.values(caseData.sections)) {
    const text = section.final_text || section.reviewed_text || section.draft_text || '';
    addendaWords += text.split(/\s+/).length;
  }
  const addendaPages = Math.max(1, Math.ceil(addendaWords / 400));

  const estimated = formPages + photoPages + mapPages + sketchPages + addendaPages;

  return {
    estimated,
    breakdown: {
      formPages,
      photoPages,
      mapPages,
      sketchPages,
      addendaPages,
    },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build content for a specific page spec.
 * @param {Object} pageSpec
 * @param {Object} caseData
 * @param {Object} options
 * @returns {Object}
 */
function buildPageContent(pageSpec, caseData, options) {
  switch (pageSpec.type) {
    case 'cover':
      return buildCoverPage(caseData);

    case 'form_page':
      return {
        pageId: pageSpec.pageId,
        type: 'form_page',
        label: pageSpec.label,
        content: {
          sections: getPageSections(pageSpec, caseData.caseRecord?.form_type || '1004')
            .map(sectionId => {
              const section = caseData.sections[sectionId];
              return {
                sectionId,
                text: section
                  ? (section.final_text || section.reviewed_text || section.draft_text || '')
                  : '',
                hasContent: !!section,
              };
            }),
          facts: extractPageFacts(pageSpec.pageId, caseData.facts),
        },
      };

    case 'photos':
      return {
        pageId: pageSpec.pageId,
        type: 'photos',
        label: pageSpec.label,
        content: { placeholder: true, message: 'Photo content populated by PDF renderer' },
      };

    case 'maps':
      return {
        pageId: pageSpec.pageId,
        type: 'maps',
        label: pageSpec.label,
        content: { placeholder: true, message: 'Map content populated by PDF renderer' },
      };

    case 'sketches':
      return {
        pageId: pageSpec.pageId,
        type: 'sketches',
        label: pageSpec.label,
        content: { placeholder: true, message: 'Sketch content populated by PDF renderer' },
      };

    case 'addenda':
      return {
        pageId: pageSpec.pageId,
        type: 'addenda',
        label: pageSpec.label,
        content: { placeholder: true, message: 'Addenda content built separately' },
      };

    case 'certifications':
      return {
        pageId: pageSpec.pageId,
        type: 'certifications',
        label: pageSpec.label,
        content: {
          appraiser: caseData.facts.appraiser || {},
          certificationDate: new Date().toISOString().split('T')[0],
        },
      };

    default:
      return {
        pageId: pageSpec.pageId,
        type: pageSpec.type,
        label: pageSpec.label,
        content: {},
      };
  }
}

/**
 * Check if a page spec has content available.
 */
function checkPageContent(pageSpec, caseData) {
  switch (pageSpec.type) {
    case 'cover':
      return !!caseData.caseRecord;
    case 'form_page':
      return Object.keys(caseData.sections).length > 0;
    case 'photos':
      return caseData.photos.length > 0;
    case 'maps':
      return true; // maps assumed available
    case 'sketches':
      return true; // sketches assumed available
    case 'addenda':
      return Object.keys(caseData.sections).length > 0;
    case 'certifications':
      return true;
    default:
      return false;
  }
}

/**
 * Get relevant section IDs for a page.
 */
function getPageSections(pageSpec, formType) {
  const SECTION_MAP = {
    subject: ['subject_description', 'neighborhood', 'site_description', 'contract_analysis'],
    site_improvements: ['site_description', 'improvements_description', 'interior_description'],
    unit_improvements: ['unit_description', 'project_description', 'improvements_description'],
    improvements: ['improvements_description', 'interior_description'],
    sales_comparison: ['sales_comparison', 'comp_analysis'],
    income_approach: ['income_approach'],
    reconciliation: ['reconciliation', 'final_reconciliation'],
  };

  return SECTION_MAP[pageSpec.pageId] || [];
}

/**
 * Extract relevant facts for a page.
 */
function extractPageFacts(pageId, facts) {
  const FACT_MAP = {
    cover: ['subject', 'contract', 'appraiser'],
    subject: ['subject', 'neighborhood', 'contract', 'site'],
    site_improvements: ['site', 'improvements', 'interior'],
    unit_improvements: ['unit', 'project', 'improvements'],
    improvements: ['improvements', 'interior'],
    sales_comparison: ['comps', 'adjustments'],
    income_approach: ['income'],
    reconciliation: ['reconciliation', 'finalValue'],
  };

  const keys = FACT_MAP[pageId] || [];
  const result = {};
  for (const key of keys) {
    if (facts[key]) {
      result[key] = facts[key];
    }
  }
  return result;
}

/**
 * Estimate page count from a built document.
 */
function estimatePageCountFromDocument(document, caseData) {
  let count = document.pages.length;

  // Add photo pages
  const photoPages = buildPhotoPages(caseData.caseRecord?.case_id || '', {});
  count += Math.max(0, photoPages.length - 1); // subtract placeholder already in manifest

  return count;
}

export default {
  generatePdf,
  getPdfPageManifest,
  buildCoverPage,
  buildPhotoPages,
  buildAddendaPages,
  estimatePageCount,
};
