import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

// Remove BOM if present
const raw = fs.readFileSync('temp_case.json', 'utf8').replace(/^\uFEFF/, '');
const caseData = JSON.parse(raw);
const facts = caseData.facts || {};
const rawOutputs = caseData.outputs || {};
// Extract text from outputs (they may be {text: "..."} objects or plain strings)
const outputs = {};
for (const [k, v] of Object.entries(rawOutputs)) {
  outputs[k] = typeof v === 'string' ? v : (v?.text || '');
}
const meta = caseData.meta || caseData.caseRecord || {};

console.log('Subject address:', facts.subject?.address);
console.log('Outputs:', Object.keys(outputs).filter(k => k !== 'updatedAt').length, 'sections');

const templateBytes = fs.readFileSync('templates/Form_1004.pdf');
const pdf = await PDFDocument.load(templateBytes);
const form = pdf.getForm();

function setText(name, val) {
  try { if (val) form.getTextField(name).setText(String(val)); } catch (e) { /* skip */ }
}

// Subject
setText('Property Address', facts.subject?.address);
setText('Ciy', facts.subject?.city);
setText('Zip Code', facts.subject?.zipCode);
setText('County', facts.subject?.county);
setText('Borrower', meta.borrower || 'Order #49561');
setText('Census Tract', facts.publicRecords?.censusTract || facts.subject?.censusTract);
setText('Neighborhood Name', facts.subject?.subdivision);
setText('Lender Client', meta.lender || meta.lenderName);
setText('Year Built', facts.improvements?.yearBuilt);
setText('Design Style', facts.improvements?.design);
setText('Bedrooms', facts.improvements?.bedrooms);
setText('Baths', facts.improvements?.bathrooms);
setText('Of Stories', facts.improvements?.stories);
setText('Square Feet of Gross Living Area above grade', facts.improvements?.gla);

// Boundaries
const bounds = [
  facts.subject?.NORTH_BOUNDARY ? 'N: ' + facts.subject.NORTH_BOUNDARY : '',
  facts.subject?.SOUTH_BOUNDARY ? 'S: ' + facts.subject.SOUTH_BOUNDARY : '',
  facts.subject?.EAST_BOUNDARY ? 'E: ' + facts.subject.EAST_BOUNDARY : '',
  facts.subject?.WEST_BOUNDARY ? 'W: ' + facts.subject.WEST_BOUNDARY : ''
].filter(Boolean).join('; ');
setText('Neighborhood Boundaries', bounds);

// Narratives
const nd = outputs.neighborhood_description || '';
setText('Neighborhood Description Line_1', nd.substring(0, 200));
setText('Neighborhood Description Line_2', nd.substring(200, 400));

const mc = outputs.market_conditions || '';
setText('Market Conditions including support for the above conclusions Line_1', mc.substring(0, 200));
setText('Market Conditions including support for the above conclusions Line_2', mc.substring(200, 400));

const cond = outputs.improvements_condition || '';
setText('Describe the condition of the property Line_1', cond.substring(0, 200));
setText('Describe the condition of the property Line_2', cond.substring(200, 400));

const fu = outputs.functional_utility || '';
setText('Additional features', fu.substring(0, 400));

// Save
const filled = await pdf.save();
const outPath = 'C:\\Users\\ccres\\OneDrive\\Desktop\\1004_110_Raef_Rd_v2.pdf';
fs.writeFileSync(outPath, Buffer.from(filled));

// Count filled
const doc2 = await PDFDocument.load(filled);
let count = 0;
doc2.getForm().getFields().forEach(f => { try { if (f.getText?.()) count++; } catch {} });
console.log(`✅ PDF saved: ${Math.round(filled.length/1024)}KB, ${count} fields filled`);
console.log('Location:', outPath);
