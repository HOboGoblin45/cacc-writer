/**
 * scripts/ingestVoicePdfs.mjs
 * ----------------------------
 * Voice PDF Ingestion Pipeline — Extraction + Staging Layer
 *
 * Scans voice_pdfs/<formType>/ for appraisal PDFs, extracts narrative
 * sections using OpenAI, and saves structured staged candidates to
 * knowledge_base/staging/<formType>/<filename>.json for manual review.
 *
 * Workflow:
 *   Raw PDFs → Extraction → Staging → (manual review) → promoteStaged.mjs
 *
 * CLI:
 *   node scripts/ingestVoicePdfs.mjs
 *   node scripts/ingestVoicePdfs.mjs --formType 1004
 *   node scripts/ingestVoicePdfs.mjs --formType 1004 --file Hundman.PDF
 *   node scripts/ingestVoicePdfs.mjs --dryRun
 *
 * Output:
 *   knowledge_base/staging/<formType>/<filename>.json  ← staged candidate
 *   knowledge_base/staging/manifest.json               ← processed file tracker
 *
 * After running:
 *   1. Open knowledge_base/staging/<formType>/<filename>.json
 *   2. Review each section/phrase/compExample
 *   3. Set "approved": true on entries you want to promote
 *   4. Run: node scripts/promoteStaged.mjs --formType 1004
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const getArg     = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag    = (flag) => args.includes(flag);

const FILTER_FORM = getArg('--formType');   // e.g. '1004' — null = all form types
const FILTER_FILE = getArg('--file');       // e.g. 'Hundman.PDF' — null = all files
const DRY_RUN     = hasFlag('--dryRun');    // print what would be done, don't write

// ── Paths ─────────────────────────────────────────────────────────────────────

const VOICE_PDFS_DIR = path.join(ROOT, 'voice_pdfs');
const STAGING_DIR    = path.join(ROOT, 'knowledge_base', 'staging');
const MANIFEST_FILE  = path.join(STAGING_DIR, 'manifest.json');

// ── Form type configuration ───────────────────────────────────────────────────

const FORM_TYPES = ['1004', '1025', '1073', '1004c', 'commercial'];

const SECTION_FIELDS = {
  '1004': [
    'neighborhood_description',
    'market_conditions',
    'site_description',
    'improvements_description',
    'condition_description',
    'contract_analysis',
    'concessions_analysis',
    'highest_best_use',
    'sca_summary',
    'reconciliation',
  ],
  '1025': [
    'neighborhood_description',
    'market_conditions',
    'site_description',
    'improvements_description',
    'condition_description',
    'highest_best_use',
    'sca_summary',
    'reconciliation',
  ],
  '1073': [
    'neighborhood_description',
    'market_conditions',
    'site_description',
    'improvements_description',
    'condition_description',
    'highest_best_use',
    'sca_summary',
    'reconciliation',
  ],
  '1004c': [
    'neighborhood_description',
    'market_conditions',
    'site_description',
    'improvements_description',
    'condition_description',
    'highest_best_use',
    'sca_summary',
    'reconciliation',
  ],
  'commercial': [
    'neighborhood',
    'market_overview',
    'site_description',
    'improvements_description',
    'highest_best_use',
    'income_approach',
    'sales_comparison',
    'reconciliation',
  ],
};

const PROPERTY_TYPE_MAP = {
  '1004':       'residential',
  '1025':       'residential_income',
  '1073':       'condo',
  '1004c':      'manufactured',
  'commercial': 'commercial',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^\s*Page \d+ of \d+\s*$/gim, '')
    .trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// ── PDF text extraction ───────────────────────────────────────────────────────

async function extractPdfText(pdfPath) {
  // Stage 1: pdf-parse (fast, works for digitally-created PDFs)
  try {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const buffer   = fs.readFileSync(pdfPath);
    const result   = await pdfParse(buffer);
    const text     = result.text?.trim() || '';
    if (text.length > 200) {
      return { text, method: 'pdf-parse', pages: result.numpages };
    }
  } catch (err) {
    console.warn(`  [pdf-parse] failed: ${err.message}`);
  }

  // Stage 2: pdfjs-dist (fallback for complex PDFs)
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ url: pdfPath, verbosity: 0 });
    const pdfDoc   = await loadingTask.promise;
    const pages    = pdfDoc.numPages;
    const textParts = [];
    for (let i = 1; i <= pages; i++) {
      const page    = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      textParts.push(pageText);
    }
    const text = textParts.join('\n\n').trim();
    if (text.length > 200) {
      return { text, method: 'pdfjs', pages };
    }
  } catch (err) {
    console.warn(`  [pdfjs] failed: ${err.message}`);
  }

  return { text: '', method: 'failed', pages: 0 };
}

// ── OpenAI extraction ─────────────────────────────────────────────────────────

async function extractSectionsWithAI(pdfText, formType, filename) {
  const { callAI } = await import('../server/openaiClient.js');

  const fields = SECTION_FIELDS[formType] || SECTION_FIELDS['1004'];

  // ── Section extraction ────────────────────────────────────────────────────
  const fieldList = fields
    .map(f => `  "${f}": "<extracted narrative text or null if not found>"`)
    .join(',\n');

  const sectionPrompt = [
    `You are an expert appraisal report analyst. Extract ONLY the narrative commentary text for each field from this ${formType} appraisal report.`,
    ``,
    `Rules:`,
    `- Extract ONLY the appraiser's written narrative commentary — not form checkboxes, numeric values, or boilerplate headers`,
    `- Each extracted text should be 20–500 words of genuine narrative`,
    `- Use null if a section is genuinely not present or has no narrative content`,
    `- Do NOT fabricate or paraphrase — extract verbatim or near-verbatim`,
    `- Return ONLY valid JSON with these exact keys:`,
    ``,
    `{`,
    fieldList,
    `}`,
    ``,
    `REPORT TEXT (first 28000 chars):`,
    pdfText.slice(0, 28000),
  ].join('\n');

  let sections = {};
  try {
    const raw     = await callAI([{ role: 'user', content: sectionPrompt }]);
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const start   = cleaned.indexOf('{');
    const end     = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      sections = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch (err) {
    console.warn(`  [AI sections] extraction failed: ${err.message}`);
  }

  // ── Phrase extraction ─────────────────────────────────────────────────────
  const phrasePrompt = [
    `You are an expert appraisal language analyst. From this ${formType} appraisal report, extract 3–8 SHORT, REUSABLE narrative clauses or phrases that:`,
    `- Are 15–80 words each`,
    `- Express a complete professional thought`,
    `- Could be reused in other appraisal reports of the same type`,
    `- Are NOT property-specific (no addresses, no specific dollar amounts, no specific dates)`,
    `- Replace any specific values with [PLACEHOLDER] tokens`,
    ``,
    `Return ONLY valid JSON array:`,
    `[`,
    `  { "tag": "condition|market_conditions|flood_zone|zoning|sales_comparison|reconciliation|highest_best_use|other", "context": "brief description of when to use this phrase", "text": "the reusable phrase text" }`,
    `]`,
    ``,
    `REPORT TEXT (first 15000 chars):`,
    pdfText.slice(0, 15000),
  ].join('\n');

  let phrases = [];
  try {
    const raw     = await callAI([{ role: 'user', content: phrasePrompt }]);
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const start   = cleaned.indexOf('[');
    const end     = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) phrases = parsed;
    }
  } catch (err) {
    console.warn(`  [AI phrases] extraction failed: ${err.message}`);
  }

  // ── Metadata extraction ───────────────────────────────────────────────────
  const metaPrompt = [
    `From this appraisal report text, extract the following metadata. Return ONLY valid JSON:`,
    `{`,
    `  "propertyType": "residential|commercial|condo|manufactured|residential_income",`,
    `  "subjectCondition": "C1|C2|C3|C4|C5|C6 or empty string if not found",`,
    `  "marketType": "urban|suburban|rural",`,
    `  "city": "city name or empty string",`,
    `  "county": "county name (without 'County') or empty string",`,
    `  "state": "2-letter state code or empty string",`,
    `  "assignmentPurpose": "purchase|refinance|estate|other or empty string",`,
    `  "loanProgram": "conventional|FHA|VA|USDA|other or empty string"`,
    `}`,
    ``,
    `REPORT TEXT (first 8000 chars):`,
    pdfText.slice(0, 8000),
  ].join('\n');

  let metadata = {};
  try {
    const raw     = await callAI([{ role: 'user', content: metaPrompt }]);
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const start   = cleaned.indexOf('{');
    const end     = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      metadata = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch (err) {
    console.warn(`  [AI metadata] extraction failed: ${err.message}`);
  }

  return { sections, phrases, metadata };
}

// ── Build staged candidate ────────────────────────────────────────────────────

function buildStagedCandidate(filename, formType, pdfMeta, extracted) {
  const { sections, phrases, metadata } = extracted;
  const fields = SECTION_FIELDS[formType] || SECTION_FIELDS['1004'];

  // Build section entries
  const sectionEntries = [];
  for (const fieldId of fields) {
    const raw = sections[fieldId];
    if (!raw || typeof raw !== 'string') continue;
    const text = cleanText(raw);
    if (text.length < 30) continue;
    sectionEntries.push({
      sectionType: fieldId,
      text,
      wordCount:   wordCount(text),
      approved:    null,   // user sets to true/false during review
      promotedId:  null,   // set after promotion
    });
  }

  // Build phrase entries (generate stable IDs from tag + index)
  const phraseEntries = [];
  const baseName = path.basename(filename, path.extname(filename)).toLowerCase().replace(/\s+/g, '_');
  phrases.forEach((p, i) => {
    if (!p.text || typeof p.text !== 'string' || p.text.length < 15) return;
    phraseEntries.push({
      id:       `${baseName}_${p.tag || 'phrase'}_${i + 1}`,
      tag:      p.tag      || 'other',
      context:  p.context  || '',
      text:     cleanText(p.text),
      approved: null,
    });
  });

  // Build comp example entries (sca_summary section if present)
  const compExamples = [];
  const scaSection = sectionEntries.find(s => s.sectionType === 'sca_summary' || s.sectionType === 'sales_comparison');
  if (scaSection) {
    compExamples.push({
      sectionType: scaSection.sectionType,
      text:        scaSection.text,
      wordCount:   scaSection.wordCount,
      approved:    null,
    });
  }

  return {
    sourceFile:   filename,
    formType,
    propertyType: PROPERTY_TYPE_MAP[formType] || 'residential',
    extractedAt:  new Date().toISOString(),
    status:       'staged',
    pdfMeta: {
      pages:  pdfMeta.pages,
      method: pdfMeta.method,
    },
    metadata: {
      propertyType:      metadata.propertyType      || PROPERTY_TYPE_MAP[formType] || 'residential',
      subjectCondition:  metadata.subjectCondition  || '',
      marketType:        metadata.marketType        || 'suburban',
      city:              metadata.city              || '',
      county:            metadata.county            || '',
      state:             metadata.state             || '',
      assignmentPurpose: metadata.assignmentPurpose || '',
      loanProgram:       metadata.loanProgram       || '',
    },
    sections:     sectionEntries,
    phrases:      phraseEntries,
    compExamples,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  CACC Writer — Voice PDF Ingestion Pipeline');
  console.log('══════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  [DRY RUN] — no files will be written\n');

  ensureDir(STAGING_DIR);

  // Load manifest (tracks already-staged files)
  const manifest = readJSON(MANIFEST_FILE, { version: '1.0.0', staged: [] });
  const stagedSet = new Set(manifest.staged || []);

  // Determine which form types to scan
  const formTypesToScan = FILTER_FORM
    ? (FORM_TYPES.includes(FILTER_FORM) ? [FILTER_FORM] : [])
    : FORM_TYPES;

  if (FILTER_FORM && !FORM_TYPES.includes(FILTER_FORM)) {
    console.error(`  ✗ Unknown formType: ${FILTER_FORM}. Valid: ${FORM_TYPES.join(', ')}`);
    process.exit(1);
  }

  let totalFound = 0, totalSkipped = 0, totalProcessed = 0, totalFailed = 0;
  const results = [];

  for (const formType of formTypesToScan) {
    const formDir = path.join(VOICE_PDFS_DIR, formType);
    if (!fs.existsSync(formDir)) {
      console.log(`  [${formType}] folder not found — skipping`);
      continue;
    }

    const allFiles = fs.readdirSync(formDir).filter(f => /\.pdf$/i.test(f));
    const files    = FILTER_FILE
      ? allFiles.filter(f => f.toLowerCase() === FILTER_FILE.toLowerCase())
      : allFiles;

    if (files.length === 0) {
      console.log(`  [${formType}] no PDFs found`);
      continue;
    }

    console.log(`\n  [${formType}] Found ${files.length} PDF(s)`);
    ensureDir(path.join(STAGING_DIR, formType));

    for (const filename of files) {
      totalFound++;
      const manifestKey = `${formType}/${filename}`;

      // Skip already-staged files
      if (stagedSet.has(manifestKey)) {
        console.log(`    ⊙ ${filename} — already staged, skipping`);
        totalSkipped++;
        continue;
      }

      console.log(`    ⟳ ${filename} — extracting...`);
      const pdfPath = path.join(formDir, filename);

      try {
        // Step 1: Extract PDF text
        const pdfMeta = await extractPdfText(pdfPath);
        if (!pdfMeta.text || pdfMeta.text.length < 100) {
          console.warn(`    ✗ ${filename} — insufficient text extracted (${pdfMeta.text.length} chars)`);
          totalFailed++;
          results.push({ file: manifestKey, status: 'failed', reason: 'insufficient text' });
          continue;
        }
        console.log(`      Text: ${pdfMeta.text.length} chars, ${pdfMeta.pages} pages (${pdfMeta.method})`);

        // Step 2: Extract sections + phrases + metadata via AI
        console.log(`      Calling AI for section extraction...`);
        const extracted = await extractSectionsWithAI(pdfMeta.text, formType, filename);

        // Step 3: Build staged candidate
        const candidate = buildStagedCandidate(filename, formType, pdfMeta, extracted);

        console.log(`      Sections: ${candidate.sections.length}, Phrases: ${candidate.phrases.length}, CompExamples: ${candidate.compExamples.length}`);

        // Step 4: Save to staging
        if (!DRY_RUN) {
          const stagingFile = path.join(STAGING_DIR, formType, `${filename}.json`);
          writeJSON(stagingFile, candidate);

          // Update manifest
          stagedSet.add(manifestKey);
          manifest.staged = [...stagedSet];
          manifest.lastUpdated = new Date().toISOString();
          writeJSON(MANIFEST_FILE, manifest);
        }

        totalProcessed++;
        results.push({
          file:         manifestKey,
          status:       'staged',
          sections:     candidate.sections.length,
          phrases:      candidate.phrases.length,
          compExamples: candidate.compExamples.length,
          stagingFile:  `knowledge_base/staging/${formType}/${filename}.json`,
        });
        console.log(`    ✓ ${filename} — staged`);

      } catch (err) {
        console.error(`    ✗ ${filename} — ERROR: ${err.message}`);
        totalFailed++;
        results.push({ file: manifestKey, status: 'error', reason: err.message });
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Ingestion Complete`);
  console.log(`  Found: ${totalFound}  |  Staged: ${totalProcessed}  |  Skipped: ${totalSkipped}  |  Failed: ${totalFailed}`);
  console.log('══════════════════════════════════════════════════════');

  if (totalProcessed > 0) {
    console.log('\n  Next steps:');
    console.log('  1. Open knowledge_base/staging/<formType>/<filename>.json');
    console.log('  2. Review each section, phrase, and compExample');
    console.log('  3. Set "approved": true on entries you want to promote');
    console.log('  4. Run: node scripts/promoteStaged.mjs [--formType 1004]');
  }

  if (totalFailed > 0) {
    console.log('\n  Failed files:');
    results.filter(r => r.status !== 'staged').forEach(r => {
      console.log(`    ✗ ${r.file}: ${r.reason || r.status}`);
    });
  }

  console.log('');
}

main().catch(err => {
  console.error('\n  FATAL:', err.message);
  process.exit(1);
});
