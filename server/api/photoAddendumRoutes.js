/**
 * server/api/photoAddendumRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Photo Addendum Generator — produces URAR-standard photo pages as HTML
 * (print-ready / PDF-ready via browser print or puppeteer).
 *
 * Mounted at: /api (cacc-writer-server.js)
 *
 * Routes:
 *   POST /cases/:caseId/photo-addendum  — Generate / regenerate addendum
 *   GET  /cases/:caseId/photo-addendum  — Retrieve generated addendum HTML
 */

import { Router } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { CASES_DIR } from '../utils/caseUtils.js';
import { getCasePhotos } from '../photos/photoManager.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Validation Schemas ───────────────────────────────────────────────────────
const paramsSchema = CommonSchemas.caseId;
const getQuerySchema = z.object({
  format: z.enum(['json', 'html']).default('json'),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function caseDir(caseId) {
  return path.join(CASES_DIR, caseId);
}

function addendumPath(caseId) {
  return path.join(caseDir(caseId), 'exports', 'photo_addendum.html');
}

async function loadCaseMeta(caseId) {
  try {
    const p = path.join(caseDir(caseId), 'case.json');
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
}

async function loadFormData(caseId) {
  try {
    const p = path.join(caseDir(caseId), 'form_data.json');
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
}

// ── Photo category ordering (URAR-standard) ───────────────────────────────────
// Subject photos first, then comps, then interior, then additional
const CATEGORY_ORDER = [
  // Subject exterior (required — page 1)
  { key: 'front',         label: 'Subject Front',       page: 1 },
  { key: 'rear',          label: 'Subject Rear',         page: 1 },
  { key: 'street',        label: 'Subject Street Scene', page: 1 },
  // Subject interior (page 1 continued / page 2)
  { key: 'kitchen',       label: 'Kitchen',              page: 1 },
  { key: 'living',        label: 'Living Room',          page: 1 },
  { key: 'bathroom',      label: 'Main Bathroom',        page: 1 },
  { key: 'bedroom1',      label: 'Bedroom 1',            page: 2 },
  { key: 'bedroom2',      label: 'Bedroom 2',            page: 2 },
  { key: 'bedroom3',      label: 'Bedroom 3',            page: 2 },
  { key: 'basement',      label: 'Basement',             page: 2 },
  { key: 'garage',        label: 'Garage',               page: 2 },
  { key: 'additional',    label: 'Additional Photo',     page: 2 },
  // Comp photos (page 3)
  { key: 'comp1_front',   label: 'Comparable Sale 1 Front', page: 3 },
  { key: 'comp2_front',   label: 'Comparable Sale 2 Front', page: 3 },
  { key: 'comp3_front',   label: 'Comparable Sale 3 Front', page: 3 },
  { key: 'comp4_front',   label: 'Comparable Sale 4 Front', page: 3 },
  { key: 'comp5_front',   label: 'Comparable Sale 5 Front', page: 3 },
  { key: 'comp6_front',   label: 'Comparable Sale 6 Front', page: 3 },
];

const CATEGORY_LABEL_MAP = Object.fromEntries(CATEGORY_ORDER.map(c => [c.key, c.label]));

/**
 * Sort photos into the standard URAR order.
 * Photos with recognized categories come first (in CATEGORY_ORDER sequence),
 * followed by any 'other' photos.
 */
function sortPhotos(photos) {
  const ordered = [];
  const byCategory = {};

  for (const photo of photos) {
    const cat = photo.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(photo);
  }

  // Add in URAR order
  for (const catDef of CATEGORY_ORDER) {
    const catPhotos = byCategory[catDef.key] || [];
    for (const p of catPhotos) {
      ordered.push({ ...p, displayLabel: p.label || catDef.label });
    }
    delete byCategory[catDef.key];
  }

  // Add remaining (other categories) at end
  for (const [cat, catPhotos] of Object.entries(byCategory)) {
    for (const p of catPhotos) {
      ordered.push({ ...p, displayLabel: p.label || cat });
    }
  }

  return ordered;
}

/**
 * Convert a file path to a data URI for embedding in the HTML.
 * Falls back to a placeholder if the file can't be read.
 */
async function toDataUri(filePath) {
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
               : ext === 'png' ? 'image/png'
               : ext === 'webp' ? 'image/webp'
               : ext === 'gif' ? 'image/gif'
               : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    // Return SVG placeholder
    return `data:image/svg+xml;base64,${Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="200" viewBox="0 0 280 200">
        <rect width="280" height="200" fill="#e5e7eb"/>
        <text x="140" y="100" text-anchor="middle" font-family="Arial" font-size="14" fill="#9ca3af">Photo Not Available</text>
       </svg>`
    ).toString('base64')}`;
  }
}

/**
 * Build one photo cell (3.5" × 2.5" on URAR).
 */
function photoCell(src, label, caption) {
  return `
    <div class="photo-cell">
      <div class="photo-img-wrap">
        <img src="${src}" alt="${escHtml(label)}" />
      </div>
      <div class="photo-label">${escHtml(label)}</div>
      ${caption ? `<div class="photo-caption">${escHtml(caption)}</div>` : ''}
    </div>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate the full HTML for the photo addendum.
 */
async function generatePhotoAddendumHtml(caseId, photos, meta, formData) {
  const address = formData?.subject?.propertyAddress
    || meta?.address
    || 'Subject Property';
  const cityStateZip = [
    formData?.subject?.city || meta?.city || '',
    formData?.subject?.state || meta?.state || '',
    formData?.subject?.zipCode || meta?.zip || '',
  ].filter(Boolean).join(', ');
  const fullAddress = cityStateZip ? `${address}, ${cityStateZip}` : address;
  const borrower = formData?.subject?.borrowerName || meta?.borrower || '';
  const lender = formData?.subject?.lenderClient || meta?.lender || '';
  const fileNo = formData?.subject?.appraisalFileNumber || meta?.fileNumber || caseId;
  const effectiveDate = formData?.reconciliation?.effectiveDate || meta?.effectiveDate || '';
  const today = new Date().toLocaleDateString('en-US');

  // Sort and load photo data URIs
  const sortedPhotos = sortPhotos(photos);

  // Load images (or placeholders)
  const photosWithData = await Promise.all(
    sortedPhotos.map(async (p) => ({
      ...p,
      dataUri: await toDataUri(p.file_path),
    }))
  );

  // Chunk into pages of 6 (2 rows × 3 cols)
  const PHOTOS_PER_PAGE = 6;
  const pages = [];
  for (let i = 0; i < photosWithData.length; i += PHOTOS_PER_PAGE) {
    pages.push(photosWithData.slice(i, i + PHOTOS_PER_PAGE));
  }

  // If no photos at all, add one empty page
  if (pages.length === 0) pages.push([]);

  // Build page HTML
  const pageHtmlArr = pages.map((pagePhotos, pageIdx) => {
    // Pad to 6 cells
    while (pagePhotos.length < PHOTOS_PER_PAGE) {
      pagePhotos.push(null);
    }

    const cells = pagePhotos.map((p, cellIdx) => {
      if (!p) {
        // Empty placeholder cell
        return `<div class="photo-cell photo-cell--empty"><div class="photo-img-wrap photo-img-wrap--empty"></div><div class="photo-label">&nbsp;</div></div>`;
      }
      return photoCell(p.dataUri, p.displayLabel, p.ai_description || p.description || '');
    }).join('');

    return `
    <div class="addendum-page">
      <div class="page-header">
        <div class="page-header-left">
          <div class="report-title">PHOTOGRAPH ADDENDUM</div>
          <div class="property-address">${escHtml(fullAddress)}</div>
        </div>
        <div class="page-header-right">
          <table class="header-table">
            <tr><td class="header-label">Borrower:</td><td>${escHtml(borrower)}</td></tr>
            <tr><td class="header-label">Lender/Client:</td><td>${escHtml(lender)}</td></tr>
            <tr><td class="header-label">File #:</td><td>${escHtml(fileNo)}</td></tr>
            <tr><td class="header-label">Effective Date:</td><td>${escHtml(effectiveDate)}</td></tr>
          </table>
        </div>
      </div>

      <div class="photo-grid">
        ${cells}
      </div>

      <div class="page-footer">
        <span>Page ${pageIdx + 1} of ${pages.length}</span>
        <span>Prepared: ${today}</span>
        <span>${escHtml(fullAddress)}</span>
      </div>
    </div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Photo Addendum — ${escHtml(fullAddress)}</title>
  <style>
    /* Base reset */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      background: #f0f0f0;
      color: #111;
    }

    /* ── Page ── */
    .addendum-page {
      width: 8.5in;
      min-height: 11in;
      background: #fff;
      margin: 0.25in auto;
      padding: 0.4in 0.5in 0.35in;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      border: 1px solid #ccc;
    }

    @media print {
      body { background: white; }
      .addendum-page {
        margin: 0;
        border: none;
        page-break-after: always;
        width: 100%;
        min-height: auto;
      }
    }

    /* ── Header ── */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1a3c6e;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .report-title {
      font-size: 14pt;
      font-weight: bold;
      color: #1a3c6e;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .property-address {
      font-size: 11pt;
      color: #333;
      margin-top: 2px;
    }
    .header-table {
      font-size: 9pt;
      border-collapse: collapse;
    }
    .header-table td {
      padding: 1px 4px;
    }
    .header-label {
      font-weight: bold;
      color: #555;
      white-space: nowrap;
    }

    /* ── Photo Grid (3 cols × 2 rows) ── */
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(2, auto);
      gap: 12px;
      flex: 1;
      align-content: start;
    }

    .photo-cell {
      display: flex;
      flex-direction: column;
      border: 1px solid #aaa;
      background: #fafafa;
      border-radius: 2px;
      overflow: hidden;
    }

    .photo-cell--empty {
      border: 1px dashed #ccc;
      background: #f9f9f9;
    }

    .photo-img-wrap {
      width: 100%;
      height: 200px;
      overflow: hidden;
      background: #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .photo-img-wrap--empty {
      background: #f3f4f6;
    }

    .photo-img-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .photo-label {
      font-size: 9pt;
      font-weight: bold;
      color: #1a3c6e;
      padding: 4px 6px 2px;
      background: #eef2f9;
      border-top: 1px solid #aaa;
      min-height: 20px;
    }

    .photo-caption {
      font-size: 8pt;
      color: #555;
      padding: 2px 6px 4px;
      min-height: 16px;
      font-style: italic;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Footer ── */
    .page-footer {
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #777;
      border-top: 1px solid #ccc;
      padding-top: 6px;
      margin-top: 12px;
    }
  </style>
</head>
<body>
${pageHtmlArr.join('\n')}
</body>
</html>`;
}

// ── POST /cases/:caseId/photo-addendum ───────────────────────────────────────
router.post('/cases/:caseId/photo-addendum', validateParams(paramsSchema), async (req, res) => {
  const { caseId } = req.validatedParams;

  try {
    // Load photos from DB
    const photos = getCasePhotos(caseId);

    // Load case meta and form data for header info
    const [meta, formData] = await Promise.all([
      loadCaseMeta(caseId),
      loadFormData(caseId),
    ]);

    // Generate HTML
    const html = await generatePhotoAddendumHtml(caseId, photos, meta, formData);

    // Save to exports dir
    const exportsDir = path.join(caseDir(caseId), 'exports');
    await fs.mkdir(exportsDir, { recursive: true });
    await fs.writeFile(addendumPath(caseId), html, 'utf8');

    log.info('photo-addendum:generated', { caseId, photoCount: photos.length });

    res.json({
      ok: true,
      photoCount: photos.length,
      pageCount: Math.max(1, Math.ceil(photos.length / 6)),
      html,
      path: `exports/photo_addendum.html`,
    });
  } catch (err) {
    log.error('photo-addendum:post:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/photo-addendum ────────────────────────────────────────
router.get('/cases/:caseId/photo-addendum', validateParams(paramsSchema), validateQuery(getQuerySchema), async (req, res) => {
  const { caseId } = req.validatedParams;
  const { format } = req.validatedQuery;

  try {
    const p = addendumPath(caseId);
    let html;
    try {
      html = await fs.readFile(p, 'utf8');
    } catch {
      return res.status(404).json({ ok: false, error: 'Photo addendum not yet generated. POST to generate it first.' });
    }

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    // Count photos for metadata
    const photos = getCasePhotos(caseId);
    res.json({
      ok: true,
      photoCount: photos.length,
      pageCount: Math.max(1, Math.ceil(photos.length / 6)),
      html,
    });
  } catch (err) {
    log.error('photo-addendum:get:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
