/**
 * server/export/pdfRenderer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders actual PDF bytes for appraisal reports using PDFKit.
 * Produces a professional, print-ready PDF from case data + generated sections.
 */

import PDFDocument from 'pdfkit';
import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';

// ── Styling constants ────────────────────────────────────────────────────────

const COLORS = {
  black: '#111111',
  darkGray: '#333333',
  gray: '#666666',
  lightGray: '#999999',
  accent: '#1a5276',
  line: '#cccccc',
  bg: '#f8f9fa',
};

const FONTS = {
  title: 'Helvetica-Bold',
  heading: 'Helvetica-Bold',
  body: 'Helvetica',
  label: 'Helvetica-Bold',
  mono: 'Courier',
};

const MARGIN = { top: 60, bottom: 60, left: 55, right: 55 };

/**
 * Load case data for PDF rendering.
 */
function loadCaseData(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
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
    if (!sectionMap[s.section_id]) {
      sectionMap[s.section_id] = s;
    }
  }

  let comps = [];
  try {
    comps = dbAll(
      `SELECT cc.* FROM comp_candidates cc WHERE cc.case_id = ? AND cc.is_active = 1
       ORDER BY cc.created_at LIMIT 6`,
      [caseId]
    );
  } catch { /* table may not exist */ }

  let photos = [];
  try {
    photos = dbAll('SELECT * FROM inspection_photos WHERE case_id = ? ORDER BY sort_order', [caseId]);
  } catch { /* table may not exist */ }

  return { caseRecord, facts, sections: sectionMap, comps, photos };
}

/**
 * Render a PDF for the given case.
 *
 * @param {string} caseId
 * @param {Object} [options]
 * @param {boolean} [options.includePhotos] — include photo pages
 * @param {boolean} [options.includeComps] — include comp grid
 * @param {string} [options.formType] — override form type
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function renderPdf(caseId, options = {}) {
  const caseData = loadCaseData(caseId);
  if (!caseData.caseRecord) throw new Error(`Case not found: ${caseId}`);

  const facts = caseData.facts;
  const subject = facts.subject || {};
  const improvements = facts.improvements || {};
  const site = facts.site || {};
  const appraiser = facts.appraiser || {};
  const formType = options.formType || caseData.caseRecord.form_type || '1004';

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'letter',
      margins: MARGIN,
      info: {
        Title: `Appraisal Report - ${subject.address || caseId}`,
        Author: appraiser.name || 'Appraisal Agent',
        Subject: `Appraisal Report`,
        Creator: 'Appraisal Agent - Cresci Appraisal & Consulting',
      },
      bufferPages: true,
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Cover Page ──────────────────────────────────────────────────────
    const pageW = doc.page.width - MARGIN.left - MARGIN.right;

    doc.rect(0, 0, doc.page.width, 180).fill('#1a5276');

    doc.font(FONTS.title).fontSize(28).fillColor('#ffffff');
    doc.text('APPRAISAL REPORT', MARGIN.left, 60, { width: pageW, align: 'center' });
    doc.fontSize(14).text('Uniform Residential Appraisal Report', { align: 'center' });

    doc.moveDown(3);
    doc.fillColor(COLORS.black);

    // Subject info block
    const subjectY = 220;
    doc.font(FONTS.label).fontSize(10).fillColor(COLORS.gray).text('SUBJECT PROPERTY', MARGIN.left, subjectY);
    doc.moveTo(MARGIN.left, subjectY + 14).lineTo(MARGIN.left + pageW, subjectY + 14).strokeColor(COLORS.line).stroke();

    doc.font(FONTS.heading).fontSize(16).fillColor(COLORS.black);
    doc.text(subject.address || subject.streetAddress || 'Address not available', MARGIN.left, subjectY + 22);
    doc.font(FONTS.body).fontSize(12).fillColor(COLORS.darkGray);
    doc.text(`${subject.city || ''}, ${subject.state || ''} ${subject.zip || subject.zipCode || ''}`);
    doc.text(`${subject.county || ''} County`);

    // Key details grid
    const detailY = subjectY + 100;
    const colW = pageW / 3;
    const details = [
      ['FORM TYPE', formType === '1004' ? '1004 URAR' : formType],
      ['GLA', improvements.gla ? `${improvements.gla} SF` : 'N/A'],
      ['YEAR BUILT', improvements.yearBuilt || 'N/A'],
      ['BEDROOMS', improvements.bedrooms || 'N/A'],
      ['BATHROOMS', improvements.bathrooms || 'N/A'],
      ['LOT SIZE', site.lotSize || site.area ? `${site.lotSize || site.area} SF` : 'N/A'],
    ];

    for (let i = 0; i < details.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = MARGIN.left + col * colW;
      const y = detailY + row * 50;
      doc.font(FONTS.label).fontSize(8).fillColor(COLORS.lightGray).text(details[i][0], x, y);
      doc.font(FONTS.body).fontSize(14).fillColor(COLORS.black).text(details[i][1], x, y + 12);
    }

    // Appraiser info
    const appY = detailY + 130;
    doc.font(FONTS.label).fontSize(10).fillColor(COLORS.gray).text('APPRAISER', MARGIN.left, appY);
    doc.moveTo(MARGIN.left, appY + 14).lineTo(MARGIN.left + pageW, appY + 14).strokeColor(COLORS.line).stroke();
    doc.font(FONTS.body).fontSize(12).fillColor(COLORS.black);
    doc.text(appraiser.name || 'Not specified', MARGIN.left, appY + 20);
    doc.text(appraiser.company || appraiser.firmName || '');
    if (appraiser.licenseNumber) doc.text(`License: ${appraiser.licenseNumber} (${appraiser.licenseState || ''})`);

    // Footer on cover
    doc.font(FONTS.body).fontSize(8).fillColor(COLORS.lightGray);
    doc.text(
      `Generated by Appraisal Agent — ${new Date().toLocaleDateString()}`,
      MARGIN.left, doc.page.height - 40,
      { width: pageW, align: 'center' }
    );

    // ── Narrative Sections ──────────────────────────────────────────────
    const sectionOrder = [
      { id: 'neighborhood_description', title: 'NEIGHBORHOOD DESCRIPTION' },
      { id: 'site_description', title: 'SITE / LOCATION DESCRIPTION' },
      { id: 'improvements_description', title: 'DESCRIPTION OF IMPROVEMENTS' },
      { id: 'highest_best_use', title: 'HIGHEST AND BEST USE' },
      { id: 'cost_approach', title: 'COST APPROACH' },
      { id: 'sales_comparison', title: 'SALES COMPARISON APPROACH' },
      { id: 'income_approach', title: 'INCOME APPROACH' },
      { id: 'reconciliation_narrative', title: 'RECONCILIATION' },
      { id: 'pud_analysis', title: 'PUD ANALYSIS' },
      { id: 'condo_analysis', title: 'CONDOMINIUM ANALYSIS' },
      { id: 'scope_of_work', title: 'SCOPE OF WORK' },
    ];

    for (const { id, title } of sectionOrder) {
      const section = caseData.sections[id];
      if (!section) continue;
      const text = section.final_text || section.reviewed_text || section.draft_text || '';
      if (!text.trim()) continue;

      doc.addPage();

      // Section header
      doc.font(FONTS.heading).fontSize(14).fillColor(COLORS.accent);
      doc.text(title, MARGIN.left, MARGIN.top);
      doc.moveTo(MARGIN.left, doc.y + 4).lineTo(MARGIN.left + pageW, doc.y + 4).strokeColor(COLORS.accent).lineWidth(1.5).stroke();
      doc.moveDown(0.8);

      // Section body
      doc.font(FONTS.body).fontSize(10.5).fillColor(COLORS.black);
      doc.text(text, MARGIN.left, doc.y, {
        width: pageW,
        lineGap: 3,
        paragraphGap: 8,
        align: 'justify',
      });
    }

    // ── Comp Grid Page ──────────────────────────────────────────────────
    if (options.includeComps !== false && caseData.comps.length > 0) {
      doc.addPage();
      doc.font(FONTS.heading).fontSize(14).fillColor(COLORS.accent);
      doc.text('COMPARABLE SALES GRID', MARGIN.left, MARGIN.top);
      doc.moveTo(MARGIN.left, doc.y + 4).lineTo(MARGIN.left + pageW, doc.y + 4).strokeColor(COLORS.accent).lineWidth(1.5).stroke();
      doc.moveDown(1);

      for (let i = 0; i < Math.min(caseData.comps.length, 6); i++) {
        const comp = caseData.comps[i];
        const data = JSON.parse(comp.candidate_json || '{}');

        doc.font(FONTS.label).fontSize(10).fillColor(COLORS.accent);
        doc.text(`Comparable ${i + 1}`, MARGIN.left, doc.y + 4);
        doc.font(FONTS.body).fontSize(9.5).fillColor(COLORS.black);
        doc.text(`${data.address || comp.source_key || 'N/A'}, ${data.city || ''} ${data.state || ''}`);
        const details = [];
        if (data.salePrice) details.push(`Sale: $${Number(data.salePrice).toLocaleString()}`);
        if (data.saleDate) details.push(`Date: ${data.saleDate}`);
        if (data.gla) details.push(`GLA: ${data.gla} SF`);
        if (data.yearBuilt) details.push(`Built: ${data.yearBuilt}`);
        if (data.bedrooms) details.push(`Bed: ${data.bedrooms}`);
        if (data.bathrooms) details.push(`Bath: ${data.bathrooms}`);
        doc.text(details.join('  |  '));
        doc.moveDown(0.5);
      }
    }

    // ── Add page numbers ────────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.font(FONTS.body).fontSize(8).fillColor(COLORS.lightGray);
      doc.text(
        `Page ${i + 1} of ${pageCount}`,
        MARGIN.left, doc.page.height - 30,
        { width: pageW, align: 'right' }
      );
    }

    doc.end();
  });
}

export default { renderPdf };
