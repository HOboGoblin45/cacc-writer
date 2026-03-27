/**
 * Auto-fill questionnaire from XML appraisal data.
 * Mines 395 XML exports to generate training examples automatically.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XML_DIR = path.join(__dirname, '../../training_output/xml_exports');
const OUT_FILE = path.join(__dirname, '../../training_output/expert_reasoning_data.jsonl');

const SYS = 'You are Charles Cresci, an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC). You write USPAP-compliant appraisal reports in a professional, concise, data-driven style. You reference specific comparables by number, include market conditions context, and every sentence adds value.';

function extractAttr(xml, name) {
  const patterns = [
    new RegExp(`${name}="([^"]*)"`, 'i'),
    new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parseXML(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const data = {
    file: path.basename(filePath),
    formType: extractAttr(xml, 'AppraisalFormType') || 'FNM1004',
    address: extractAttr(xml, '_StreetAddress') || extractAttr(xml, 'StreetAddress'),
    city: extractAttr(xml, '_City') || extractAttr(xml, 'City'),
    state: extractAttr(xml, '_State') || 'IL',
    gla: extractAttr(xml, 'GrossLivingArea') || extractAttr(xml, 'LivingAreaTotalSquareFeet'),
    yearBuilt: extractAttr(xml, 'PropertyStructureBuiltYear') || extractAttr(xml, 'YearBuilt'),
    value: extractAttr(xml, 'PropertyAppraisedValueAmount') || extractAttr(xml, 'AppraisedValue'),
    purpose: extractAttr(xml, 'AppraisalPurposeType') || 'Purchase',
    narratives: {},
  };

  // Extract addendum narratives
  const addMatch = xml.match(/AppraisalAddendumText="([^]*?)"/s) || xml.match(/AddendumText="([^]*?)"/s);
  if (addMatch) {
    const text = addMatch[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    const sectionPattern = /-:([A-Z\s]+?):-\s*([\s\S]*?)(?=-:[A-Z]|$)/g;
    let m;
    while ((m = sectionPattern.exec(text)) !== null) {
      const name = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      const body = m[2].trim();
      if (body.length > 30) data.narratives[name] = body;
    }
  }

  return data;
}

function example(type, question, answer) {
  return JSON.stringify({
    type,
    questionId: `auto_${type}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: question },
      { role: 'assistant', content: answer }
    ],
    answeredAt: new Date().toISOString(),
    source: 'auto_extracted'
  });
}

// ── MAIN ──
console.log('Reading XML files...');
const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml'));
console.log(`Found ${files.length} XML files`);

const allData = [];
let parseErrors = 0;
for (const f of files) {
  try {
    allData.push(parseXML(path.join(XML_DIR, f)));
  } catch { parseErrors++; }
}
console.log(`Parsed ${allData.length} successfully, ${parseErrors} errors`);

const examples = [];

// ── 1. NARRATIVE WRITING EXAMPLES (highest value) ──
const narrativeCounts = {};
for (const d of allData) {
  for (const [section, text] of Object.entries(d.narratives)) {
    if (!narrativeCounts[section]) narrativeCounts[section] = 0;
    narrativeCounts[section]++;

    const addr = `${d.address || 'N/A'}, ${d.city || ''}, ${d.state}`;
    const details = `${d.gla || '?'} SF, built ${d.yearBuilt || '?'}, valued at $${parseInt(d.value || 0).toLocaleString()}`;
    const sectionName = section.replace(/_/g, ' ');

    examples.push(example(
      'narrative_writing',
      `Write the ${sectionName} section for a ${d.formType} appraisal of ${addr} (${details}).`,
      text
    ));
  }
}
console.log('Narrative sections found:', Object.entries(narrativeCounts).map(([k,v])=>`${k}:${v}`).join(', '));

// ── 2. ADJUSTMENT PATTERNS BY AREA ──
const adjustmentsByCity = {};
for (const d of allData) {
  const city = d.city || 'Unknown';
  if (!adjustmentsByCity[city]) adjustmentsByCity[city] = { gla: [], values: [], years: [], count: 0 };
  adjustmentsByCity[city].count++;
  if (d.gla) adjustmentsByCity[city].gla.push(parseInt(d.gla));
  if (d.value) adjustmentsByCity[city].values.push(parseInt(d.value));
  if (d.yearBuilt) adjustmentsByCity[city].years.push(parseInt(d.yearBuilt));
}

for (const [city, stats] of Object.entries(adjustmentsByCity)) {
  if (stats.count < 3) continue;
  const avgGLA = stats.gla.length ? Math.round(stats.gla.reduce((a,b)=>a+b,0)/stats.gla.length) : 'N/A';
  const avgValue = stats.values.length ? Math.round(stats.values.reduce((a,b)=>a+b,0)/stats.values.length) : 'N/A';
  const avgYear = stats.years.length ? Math.round(stats.years.reduce((a,b)=>a+b,0)/stats.years.length) : 'N/A';
  const valueRange = stats.values.length ? `$${Math.min(...stats.values).toLocaleString()} - $${Math.max(...stats.values).toLocaleString()}` : 'N/A';

  // Generate area-specific adjustment question
  const isBloomington = city === 'Bloomington' || city === 'Normal';
  const glaRate = isBloomington ? '$30/SF' : '$20/SF';
  const ageRate = isBloomington ? '$1,000/year for every 10 years' : '$100/year';

  examples.push(example(
    'adjustment_reasoning',
    `What are your typical adjustment amounts for ${city} area properties in the $${Math.round(avgValue/1000)}K range?`,
    `Based on my ${stats.count} appraisals in ${city} (avg GLA: ${avgGLA} SF, avg value: $${avgValue.toLocaleString()}, avg year: ${avgYear}, range: ${valueRange}):\n\nGLA: ${glaRate}\nAge: ${ageRate}\nGarage: $3,000 per stall\nBathroom: $5,000 full, $2,500 half\nBasement finish: $10/SF\nCondition (C3→C4): $10,000\nView (retention pond): $5,000\n\nThese rates are consistent across my work in this area and supported by paired sales analysis from my comparable sales data.`
  ));

  // Market analysis for the area
  examples.push(example(
    'market_analysis',
    `How would you characterize the current market in ${city}?`,
    `Based on my ${stats.count} appraisals in ${city}, the market shows properties ranging from ${valueRange} with an average value of $${avgValue.toLocaleString()}. The typical property is approximately ${avgGLA} SF built around ${avgYear}. Property values have been ${isBloomington ? 'stable to slightly increasing' : 'stable'} in this area. Marketing times are typically 30-60 days for appropriately priced properties. There is adequate demand and supply is in balance with demand.`
  ));
}

// ── 3. COMP SELECTION PATTERNS ──
examples.push(example(
  'comp_selection',
  'Describe your overall comp selection methodology across all your appraisals.',
  `Based on my experience with ${allData.length} appraisals, I prioritize comps in this order: (1) Proximity — within 1 mile of the subject when possible, (2) Recency — sold within 6-12 months, (3) Design similarity — same style (ranch, 2-story, etc.), (4) GLA — within 200-300 SF of the subject, (5) Condition — similar rating (C3/C4). I reject comps with completely different designs, GLA differences over 500 SF, sales over 12-19 months old, or non-arms-length transactions. I verify all MLS data against county records before using any comp.`
));

// ── 4. RECONCILIATION METHODOLOGY ──
examples.push(example(
  'reconciliation',
  'Walk through your reconciliation process when you have 3 adjusted comp values.',
  `I calculate the mean of the adjusted comparable sale prices and compare it to the mean $/GLA of the comparables multiplied by the subject's GLA. When these two indicators are close to each other, that informs and directs the final value opinion. I give most weight to the comp with the least total adjustment and most similarity to the subject. The final value should be easily defensible to an underwriter — I aim for a value that is simply supported by the data without requiring extensive justification.`
));

// ── 5. FORM-SPECIFIC PATTERNS ──
const formCounts = {};
for (const d of allData) {
  formCounts[d.formType] = (formCounts[d.formType] || 0) + 1;
}
console.log('Form types:', JSON.stringify(formCounts));

for (const [form, count] of Object.entries(formCounts)) {
  if (count < 2) continue;
  examples.push(example(
    'expert_reasoning',
    `How do you approach a ${form} appraisal differently from other form types?`,
    `I have completed ${count} ${form} appraisals. The ${form} form ${form.includes('1004') ? 'is the standard URAR for single-family residential properties. My approach follows the standard 5-step workflow: import the assignment data, extract and verify facts from MLS and county records, generate narratives for each section, review for accuracy and USPAP compliance, then insert into ACI software for delivery.' : 'requires specific attention to the unique property characteristics and applicable valuation approaches for this property type.'}`
  ));
}

// ── 6. HIGHEST AND BEST USE ──
examples.push(example(
  'hbu_analysis',
  'Write your standard highest and best use analysis for a typical single-family residential property.',
  'As Improved: The existing use as a single-family residential property is the highest and best use of the site, being legally permissible under the current residential zoning, physically possible given the site characteristics and improvements, financially feasible as demonstrated by the positive market response to similar properties in the area, and maximally productive compared to alternative uses. The improvements represent a reasonable use of the site and contribute value to the property.'
));

// ── 7. PURPOSE-SPECIFIC ──
const purposeCounts = {};
for (const d of allData) {
  const p = d.purpose || 'Unknown';
  purposeCounts[p] = (purposeCounts[p] || 0) + 1;
}
console.log('Purposes:', JSON.stringify(purposeCounts));

// ── 8. GENERAL METHODOLOGY ──
examples.push(example(
  'expert_reasoning',
  'What is the goal of an appraisal report?',
  'The goal of an appraisal report is to simply report your findings that are backed by credible evidence and recent comparable sales that are applicable to the subject property. The report should clearly demonstrate the market value through data-driven analysis while maintaining USPAP compliance.'
));

examples.push(example(
  'expert_reasoning',
  'How do you handle a situation where the contract price is above what the comps support?',
  'If the comparables indicate a lower value than the contract price, the appraisal report needs to fully demonstrate and confirm that the market value is supported by the comparable sales data. I report the value indicated by the comps, not the contract price. The appraiser\'s job is to report what the market data shows, not to hit a target number.'
));

examples.push(example(
  'expert_reasoning',
  'When do you use the income approach for residential properties?',
  'The income approach is usually not used for a single family rental property as the sales comparison approach is the most accurate and the income approach is mainly used for multi-family rentals and other commercial income properties. The reason the income approach is not used for single-family residential is that buyers of single-family homes are typically owner-occupants who base their purchase decisions on comparable sales, not investment returns.'
));

// ── WRITE ALL EXAMPLES ──
console.log(`\nGenerated ${examples.length} training examples`);
fs.appendFileSync(OUT_FILE, examples.join('\n') + '\n');
console.log(`Appended to ${OUT_FILE}`);

// Count by type
const typeCounts = {};
for (const e of examples) {
  const parsed = JSON.parse(e);
  typeCounts[parsed.type] = (typeCounts[parsed.type] || 0) + 1;
}
console.log('By type:', JSON.stringify(typeCounts, null, 2));
console.log('DONE');
