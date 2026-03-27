// extract_pdfs.cjs - run from cacc-writer project dir with: node extract_pdfs.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function parseBuffer(buf) {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  return { text: result.text || '', numpages: result.total || 0 };
}

const EXCLUDE = /invoice|gmail|order\s*form|contract|purchase|assignment_sheet|articles|\bPA\b|disclosure|census|insurance|license|resume|certificate|payment email|statistics|plat|SanDisk|W-9|USPAP|account|AppOrder|harassment|rehab|sketch|measurements|floor plan|fact sheet|scope of work/i;

const BASE = 'C:/Users/ccres/OneDrive/Desktop/CACC Appraisals';
const OUT_DIR = path.join(__dirname, 'training_output');
const OUT_FILE = path.join(OUT_DIR, 'expert_reasoning_data.jsonl');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function walk(dir, depth) {
  if (!depth) depth = 0;
  if (depth > 7) return [];
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fp, depth + 1));
    } else if (/\.pdf$/i.test(entry.name) && !EXCLUDE.test(entry.name)) {
      const parent = path.basename(dir);
      // Include if parent folder is a dated case folder (YYYY-MM-DD...)
      if (/^20\d\d-\d\d/.test(parent)) {
        results.push(fp);
      }
    }
  }
  return results;
}

const SECTION_PATTERNS = [
  [/neighborhood description[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'neighborhood_description'],
  [/site comments[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'site_comments'],
  [/condition of the improvements[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'improvements_condition'],
  [/sales comparison.*?analysis[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'sales_comparison_analysis'],
  [/reconciliation[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'reconciliation'],
  [/market conditions[:\s\n]+([\s\S]{150,2500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'market_conditions'],
  [/adverse.*?environmental.*?conditions[:\s\n]+([\s\S]{100,1500}?)(?=\n[A-Z ]{6,}\n|\n\n\n|$)/i, 'adverse_conditions'],
];

async function run() {
  const pdfs = walk(BASE);
  console.log(`Found ${pdfs.length} candidate PDFs`);
  pdfs.slice(0, 5).forEach(p => console.log('  ' + path.basename(path.dirname(p)) + '/' + path.basename(p)));

  let extracted = 0;
  const examples = [];

  for (const pdf of pdfs) {
    try {
      const buf = fs.readFileSync(pdf);
      const data = await parseBuffer(buf);
      if (!data.text || data.text.length < 1000) {
        console.log(`-- ${path.basename(pdf)} (too short: ${data.text ? data.text.length : 0})`);
        continue;
      }
      const text = data.text;
      let matched = 0;
      for (const [pat, name] of SECTION_PATTERNS) {
        const m = text.match(pat);
        if (m && m[1] && m[1].trim().length > 120) {
          const content = m[1].trim().substring(0, 2000);
          examples.push(JSON.stringify({
            type: 'narrative_writing',
            section: name,
            questionId: `pdf_${path.basename(pdf, path.extname(pdf))}_${name}`,
            messages: [
              { role: 'system', content: 'You are Charles Cresci, an expert real estate appraiser for CACC in central Illinois.' },
              { role: 'user', content: `Write the ${name.replace(/_/g, ' ')} section for this appraisal.` },
              { role: 'assistant', content }
            ],
            source: 'pdf_extraction'
          }));
          matched++;
        }
      }
      if (matched > 0) {
        extracted++;
        console.log(`OK ${path.basename(pdf)}: ${matched} sections (${data.text.length} chars)`);
      } else {
        console.log(`-- ${path.basename(pdf)}: no sections matched (${data.text.length} chars)`);
      }
    } catch (e) {
      console.log(`ERR ${path.basename(pdf)}: ${e.message.substring(0, 80)}`);
    }
  }

  if (examples.length > 0) {
    fs.appendFileSync(OUT_FILE, examples.join('\n') + '\n');
    console.log(`\n==> ${examples.length} examples from ${extracted}/${pdfs.length} PDFs → ${OUT_FILE}`);
  } else {
    console.log(`\n==> No examples generated from ${pdfs.length} PDFs`);
  }
}

run().catch(console.error);
