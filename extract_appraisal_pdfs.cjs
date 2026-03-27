// extract_appraisal_pdfs.cjs
// Recursively scan CACC Appraisals, extract ALL PDF types, generate training examples.
// Run: node extract_appraisal_pdfs.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

// ── Config ────────────────────────────────────────────────────────────────────

const APPRAISALS_DIR = 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals';
const OUT_FILE = path.join(__dirname, 'training_output', 'expert_reasoning_data.jsonl');
const MIN_TEXT_LENGTH = 500;

const SYSTEM_PROMPT =
  'You are Charles Cresci, an expert residential real estate appraiser for ' +
  'Cresci Appraisal & Consulting Company (CACC). You write USPAP-compliant ' +
  'appraisal reports in a professional, concise, data-driven style.';

// ── PDF extraction ────────────────────────────────────────────────────────────

async function extractText(filePath) {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  const raw = result.text || '';
  return raw.replace(/\s+/g, ' ').trim();
}

// ── File finder ───────────────────────────────────────────────────────────────

function walkPDFs(dir, depth) {
  if (!depth) depth = 0;
  if (depth > 8) return [];
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkPDFs(fp, depth + 1));
    } else if (/\.pdf$/i.test(entry.name)) {
      results.push(fp);
    }
  }
  return results;
}

// ── Classifier ────────────────────────────────────────────────────────────────

function classify(text, fileName) {
  const f = fileName.toLowerCase();
  const t = (text || '').toLowerCase();

  // Filename hints (fast path)
  if (/assignment.sheet|appraisal.order|order.sheet|engagement.letter/.test(f)) return 'order';
  if (/contract|purchase.agr|purchase.agreement|sales.contract|\bpa\.pdf/.test(f)) return 'contract';
  if (/invoice/.test(f)) return 'invoice';

  // Content
  if (/appraisal order|order form|engagement letter|assignment sheet|ordered by/.test(t)) return 'order';
  if (/purchase agreement|purchase contract|sales contract|real estate contract|contract of sale/.test(t)) return 'contract';
  if (/invoice|amount due|payment due|bill to/.test(t)) return 'invoice';
  if (/uspap|uniform residential|comparable sale|sales comparison|reconciliation/.test(t)) return 'report';

  return 'other';
}

// ── Field extractors ──────────────────────────────────────────────────────────

function extractOrderFields(text) {
  const fields = {};
  const m = (pattern) => { const r = text.match(pattern); return r ? r[1].trim() : null; };

  fields.address = m(/(?:property\s+address|subject\s+address|property\s+located)[:\s]+([^\n,]{10,80})/i);
  fields.borrower = m(/(?:borrower|property\s+owner)[:\s]+([A-Za-z][a-z]+ [A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
  fields.lender   = m(/(?:lender|client|ordered by|requested by)[:\s]+([^\n]{5,60})/i);
  fields.loan_type = m(/(?:loan type|mortgage type|loan purpose)[:\s]+([^\n]{3,40})/i);
  fields.purpose  = m(/(?:appraisal purpose|purpose of appraisal)[:\s]+([^\n]{5,60})/i);
  fields.due_date = m(/(?:due date|report due|inspection date)[:\s]+([^\n]{5,30})/i);

  // Remove nulls
  Object.keys(fields).forEach(k => { if (!fields[k]) delete fields[k]; });
  return fields;
}

function extractContractFields(text) {
  const fields = {};
  const m = (pattern) => { const r = text.match(pattern); return r ? r[1].trim() : null; };

  fields.purchase_price = m(/(?:purchase price|sales price|contract price)[:\s\$]*([\d,]+)/i);
  fields.contract_date  = m(/(?:contract date|agreement date|dated)[:\s]+([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  fields.loan_amount    = m(/(?:loan amount|mortgage amount|financing)[:\s\$]*([\d,]+)/i);
  fields.earnest_money  = m(/(?:earnest money|deposit)[:\s\$]*([\d,]+)/i);
  fields.concessions    = m(/(?:seller.{0,10}concession|closing cost|seller.{0,10}contribution)[:\s\$]*([\d,]+)/i);
  fields.closing_date   = m(/(?:closing date|close of escrow)[:\s]+([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);

  const contingencyTypes = [];
  if (/inspection contingency/i.test(text)) contingencyTypes.push('inspection');
  if (/financing contingency/i.test(text)) contingencyTypes.push('financing');
  if (/appraisal contingency/i.test(text)) contingencyTypes.push('appraisal');
  if (contingencyTypes.length) fields.contingencies = contingencyTypes.join(', ');

  Object.keys(fields).forEach(k => { if (!fields[k]) delete fields[k]; });
  return fields;
}

// ── Narrative section patterns ────────────────────────────────────────────────

const SECTION_PATTERNS = [
  [/neighborhood description[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'neighborhood_description', 'Neighborhood Description'],
  [/site comments[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'site_comments', 'Site Comments'],
  [/condition of the improvements[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'improvements_condition', 'Condition of Improvements'],
  [/sales comparison.{0,40}analysis[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'sales_comparison_analysis', 'Sales Comparison Analysis'],
  [/reconciliation[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'reconciliation', 'Reconciliation'],
  [/market conditions[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'market_conditions', 'Market Conditions'],
  [/adverse.{0,30}environmental.{0,20}conditions[:\s\n]+([\s\S]{100,1500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'adverse_conditions', 'Adverse Environmental Conditions'],
  [/functional utility[:\s\n]+([\s\S]{100,1500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'functional_utility', 'Functional Utility'],
];

function extractReportSections(text) {
  const sections = [];
  for (const [pat, id, label] of SECTION_PATTERNS) {
    const m = text.match(pat);
    if (m && m[1] && m[1].trim().length >= 120) {
      sections.push({ id, label, content: m[1].trim().slice(0, 2500) });
    }
  }
  return sections;
}

// ── Training example builders ─────────────────────────────────────────────────

function buildOrderExample(text, filePath) {
  const fields = extractOrderFields(text);
  const summaryText = Object.keys(fields).length
    ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
    : text.slice(0, 600);

  return [{
    type: 'order_extraction',
    source_file: path.basename(filePath),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: 'Given this appraisal order, what key information do you extract?\n\n' +
                 'DOCUMENT:\n' + text.slice(0, 1800),
      },
      {
        role: 'assistant',
        content: 'From this appraisal order I extract the following:\n\n' + summaryText,
      },
    ],
    generatedAt: new Date().toISOString(),
  }];
}

function buildContractExample(text, filePath) {
  const fields = extractContractFields(text);
  const summaryText = Object.keys(fields).length
    ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
    : text.slice(0, 600);

  return [{
    type: 'contract_extraction',
    source_file: path.basename(filePath),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: 'Given this purchase contract, what details are relevant to the appraisal?\n\n' +
                 'DOCUMENT:\n' + text.slice(0, 1800),
      },
      {
        role: 'assistant',
        content: 'The relevant contract details for the appraisal are:\n\n' + summaryText,
      },
    ],
    generatedAt: new Date().toISOString(),
  }];
}

function buildReportExamples(text, filePath) {
  const sections = extractReportSections(text);

  if (!sections.length) {
    // Fallback: include if text is substantive
    if (text.length < 2000) return [];
    return [{
      type: 'report_narrative_style',
      source_file: path.basename(filePath),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Write a professional appraisal narrative in the style of CACC reports.' },
        { role: 'assistant', content: text.slice(0, 2500) },
      ],
      generatedAt: new Date().toISOString(),
    }];
  }

  return sections.map(({ id, label, content }) => ({
    type: `report_section_${id}`,
    source_file: path.basename(filePath),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Write the "${label}" section for this appraisal report. ` +
                 'Use a professional, concise, USPAP-compliant style.',
      },
      { role: 'assistant', content },
    ],
    generatedAt: new Date().toISOString(),
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('Scanning:', APPRAISALS_DIR);
  const allPDFs = walkPDFs(APPRAISALS_DIR);
  console.log(`Found ${allPDFs.length} PDFs total\n`);

  const stats = { order: 0, contract: 0, report: 0, invoice: 0, other: 0, unreadable: 0 };
  const exCount  = { order: 0, contract: 0, report: 0 };
  const lines = [];

  for (let i = 0; i < allPDFs.length; i++) {
    const fp = allPDFs[i];
    const fn = path.basename(fp);

    if ((i + 1) % 100 === 0 || i === 0) {
      console.log(`  [${i + 1}/${allPDFs.length}] processing...`);
    }

    let text = '';
    try {
      text = await extractText(fp);
    } catch (err) {
      stats.unreadable++;
      console.log(`  SKIP (unreadable): ${fn} — ${err.message.slice(0, 60)}`);
      continue;
    }

    const type = classify(text, fn);
    stats[type] = (stats[type] || 0) + 1;

    if (text.length < MIN_TEXT_LENGTH) continue;
    if (type === 'other' || type === 'invoice') continue;

    let examples = [];
    if (type === 'order')    examples = buildOrderExample(text, fp);
    if (type === 'contract') examples = buildContractExample(text, fp);
    if (type === 'report')   examples = buildReportExamples(text, fp);

    for (const ex of examples) {
      lines.push(JSON.stringify(ex));
    }
    exCount[type] = (exCount[type] || 0) + examples.length;
  }

  if (lines.length > 0) {
    fs.appendFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');
  }

  const total = lines.length;
  console.log('\n═══════════════════════════════════════');
  console.log('  PDF EXTRACTION COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`  Total PDFs found:     ${allPDFs.length}`);
  console.log(`  Unreadable (skipped): ${stats.unreadable}`);
  console.log('');
  console.log('  By type:');
  console.log(`    Reports:   ${stats.report}`);
  console.log(`    Orders:    ${stats.order}`);
  console.log(`    Contracts: ${stats.contract}`);
  console.log(`    Invoices:  ${stats.invoice}`);
  console.log(`    Other:     ${stats.other}`);
  console.log('');
  console.log('  Training examples generated:');
  console.log(`    From reports:   ${exCount.report || 0}`);
  console.log(`    From orders:    ${exCount.order || 0}`);
  console.log(`    From contracts: ${exCount.contract || 0}`);
  console.log(`    TOTAL NEW:      ${total}`);
  console.log('');
  console.log(`  Appended to: ${OUT_FILE}`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
