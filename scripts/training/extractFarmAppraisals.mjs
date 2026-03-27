/**
 * Extract training data from ClickFORMS (.AX7) farm/commercial appraisals
 * and submission PDF files.
 *
 * AX7 files are ClickFORMS format used for farm appraisals.
 * This script extracts readable text strings from the binary format
 * and parses them into training examples.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACC_DIR = path.join(__dirname, '../../..', 'CACC Appraisals');
const ALT_CACC = 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals';
const OUT_FILE = path.join(__dirname, '../../training_output/expert_reasoning_data.jsonl');

const SYS = 'You are Charles Cresci, an expert real estate appraiser for Cresci Appraisal & Consulting Company (CACC). You specialize in residential, commercial, and agricultural/farm appraisals in central Illinois. You write USPAP-compliant reports in a professional, concise, data-driven style.';

function example(type, question, answer) {
  return JSON.stringify({
    type, questionId: `auto_farm_${type}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: question },
      { role: 'assistant', content: answer }
    ],
    answeredAt: new Date().toISOString(), source: 'farm_extraction'
  });
}

// Extract readable strings from binary AX7 file
function extractAX7Strings(filePath) {
  const data = fs.readFileSync(filePath);
  const strings = [];
  const ascii = data.toString('latin1');

  // Extract all readable strings of 10+ chars
  const regex = /[\x20-\x7E]{10,}/g;
  let match;
  while ((match = regex.exec(ascii)) !== null) {
    strings.push(match[0].trim());
  }

  return strings;
}

function parseAX7(filePath) {
  const strings = extractAX7Strings(filePath);
  const fileName = path.basename(filePath);
  const dirName = path.basename(path.dirname(filePath));

  const info = {
    file: fileName,
    folder: dirName,
    type: 'farm',
    strings: strings,
    // Try to find key data points
    address: null,
    acres: null,
    value: null,
    narratives: [],
  };

  for (const s of strings) {
    // Look for addresses
    if (!info.address && (s.match(/\d+\s+\w+\s+(St|Rd|Ave|Ln|Dr|Ct|Blvd|Hwy|Road|Street|Route)/i))) {
      info.address = s;
    }
    // Look for acreage
    const acreMatch = s.match(/(\d+\.?\d*)\s*(acres?|ac\.?)/i);
    if (acreMatch) info.acres = parseFloat(acreMatch[1]);

    // Look for dollar values
    const valMatch = s.match(/\$\s*([\d,]+)/);
    if (valMatch && !info.value) {
      const val = parseInt(valMatch[1].replace(/,/g, ''));
      if (val > 10000) info.value = val;
    }

    // Look for narrative-length text (sentences)
    if (s.length > 100 && s.includes(' ') && !s.match(/^[A-Z_]+$/) && !s.includes('http')) {
      info.narratives.push(s);
    }
  }

  return info;
}

// ── MAIN ──
console.log('Scanning for farm appraisal files...');

// Find the CACC directory
let caccDir = null;
if (fs.existsSync(CACC_DIR)) caccDir = CACC_DIR;
else if (fs.existsSync(ALT_CACC)) caccDir = ALT_CACC;
else {
  // Try mounted path
  const mounted = '/sessions/wonderful-vibrant-einstein/mnt/CACC Appraisals';
  if (fs.existsSync(mounted)) caccDir = mounted;
}

if (!caccDir) {
  console.error('Cannot find CACC Appraisals directory');
  process.exit(1);
}

console.log('Using directory:', caccDir);

// Find all AX7 files
const ax7Files = [];
function walk(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.AX7') || e.name.endsWith('.ax7')) ax7Files.push(fp);
    }
  } catch {}
}
walk(caccDir);
console.log(`Found ${ax7Files.length} AX7 files`);

const examples = [];
let parsed = 0;
let withNarratives = 0;

for (const f of ax7Files) {
  try {
    const info = parseAX7(f);
    parsed++;

    const addr = info.address || info.folder;
    const acres = info.acres ? `${info.acres} acres` : 'unknown acreage';
    const value = info.value ? `$${info.value.toLocaleString()}` : 'unknown value';

    // Generate training examples from narratives
    for (const narr of info.narratives) {
      withNarratives++;
      examples.push(example(
        'narrative_writing',
        `Write the following section for a farm/agricultural appraisal of ${addr} (${acres}, ${value}):`,
        narr
      ));
    }

    // Generate farm-specific methodology example
    if (info.acres) {
      examples.push(example(
        'farm_appraisal',
        `How do you approach appraising a ${acres} farm property in ${info.folder.includes('Sherrard') ? 'Rock Island County' : info.folder.includes('Tazewell') ? 'Tazewell County' : 'McLean County'} Illinois?`,
        `For a ${acres} farm property, I evaluate: (1) Soil productivity index (PI) ratings from the county soil survey — Illinois farmland value is heavily driven by soil quality, (2) Comparable farm sales per acre in the same county and soil rating range, (3) Cash rent per acre to support an income approach using a capitalization rate derived from market sales, (4) Improvements including the homesite, outbuildings, drainage tile, and any CRP contracts, (5) Location factors including road frontage, access, proximity to grain elevators, and development potential. The sales comparison approach is primary, using $/acre adjusted for soil quality differences, with the income approach as support.`
      ));
    }

  } catch (err) {
    // Skip files we can't parse
  }
}

// Add general farm appraisal methodology
examples.push(example(
  'farm_methodology',
  'Explain your approach to farm/agricultural appraisals in central Illinois.',
  'Farm appraisals in central Illinois require specialized knowledge of agricultural land markets. Key factors include: soil productivity index (PI) ratings — Illinois farmland is priced primarily by soil quality with PI ratings from 100-147 for McLean County prime farmland. I use $/acre as the primary unit of comparison, adjusted for soil quality, drainage tile condition, improvements, and location. The income approach using cash rent capitalization is an important support. I verify comparable sales through the Illinois Society of Farm Managers and Rural Appraisers, county recorder records, and my own database. CRP contracts, conservation easements, and government program payments are analyzed separately. Homesite values are segregated from agricultural land values when applicable.'
));

examples.push(example(
  'farm_methodology',
  'How do you determine farmland value per acre in your market?',
  'Farmland value per acre is primarily driven by soil productivity. In McLean County, prime farmland with PI ratings of 130+ sells for $12,000-$16,000/acre depending on location and improvements. Lower PI soils (100-130) sell for $8,000-$12,000/acre. I analyze comparable farm sales within the same county and adjust for soil quality differences using the PI index. Cash rent rates ($250-$350/acre for prime ground) provide income approach support. I also consider: tile drainage (adds $500-$1,500/acre), road frontage, development potential, and any deed restrictions or easements.'
));

examples.push(example(
  'farm_methodology',
  'What is the difference between appraising a farm with a homestead vs bare farmland?',
  'A farm with a homestead requires two separate valuations: (1) the agricultural land valued at $/acre based on soil productivity and comparable farm sales, and (2) the homesite including the dwelling, outbuildings, yard area, and any non-agricultural improvements valued using residential comparable sales or cost approach. The homesite typically includes 1-5 acres. I allocate the total acreage between homesite and productive farmland, value each component separately, and reconcile to a total. The key challenge is finding comparable sales that have similar homesite/farmland ratios.'
));

// ── WRITE ──
if (examples.length > 0) {
  fs.appendFileSync(OUT_FILE, examples.join('\n') + '\n');
  console.log(`\nGenerated ${examples.length} training examples`);
  console.log(`  Parsed ${parsed} AX7 files`);
  console.log(`  Found ${withNarratives} narrative segments`);
  console.log(`  Added farm methodology examples`);
  console.log(`Appended to ${OUT_FILE}`);
} else {
  console.log('No examples generated — AX7 files may not be accessible from this environment');
}

console.log('DONE');
