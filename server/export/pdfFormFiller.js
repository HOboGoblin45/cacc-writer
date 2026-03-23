/**
 * server/export/pdfFormFiller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fills the official Fannie Mae Form 1004 (URAR) fillable PDF template with
 * case data from the CACC Writer database.
 *
 * Template: templates/Form_1004.pdf (505 fields: 429 text, 27 checkboxes,
 *           47 radio groups, 2 signatures)
 *
 * IMPORTANT: PDF field names contain typos (official form names).
 *   - "Ciy" not "City"
 *   - "Dimesions" not "Dimensions"
 *   Always use the exact field names from the PDF.
 */

import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbGet, dbAll } from '../db/database.js';
import { readJSON } from '../utils/fileUtils.js';
import { casePath } from '../utils/caseUtils.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'Form_1004.pdf');

/** Characters per line for narrative split fields */
const CHARS_PER_LINE = 110;

/**
 * Split a long string into chunks for multi-line PDF fields.
 * @param {string} text
 * @param {number} charsPerLine
 * @returns {string[]}
 */
function splitLines(text, charsPerLine = CHARS_PER_LINE) {
  if (!text) return ['', ''];
  const words = String(text).split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= charsPerLine) {
      current = (current + ' ' + word).trim();
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Get the best available text from a section object.
 * @param {Object|undefined} section
 * @returns {string}
 */
function sectionText(section) {
  if (!section) return '';
  if (typeof section === 'string') return section;
  return section.text || section.final_text || section.reviewed_text || section.draft_text || '';
}

/**
 * Load all case data needed to fill the form.
 * @param {string} caseId
 * @returns {Object}
 */
function loadCaseForForm(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE caseId = ?', [caseId])
                  || dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) throw new Error(`Case not found: ${caseId}`);

  // Try multiple sources for facts
  let facts = {};
  try {
    const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
    if (caseFacts?.facts_json) facts = JSON.parse(caseFacts.facts_json);
  } catch {}
  // Also check file system
  try {
    const cDir = casePath(caseId);
    const fileFacts = readJSON(path.join(cDir, 'facts.json'), null);
    if (fileFacts) facts = { ...facts, ...fileFacts };
  } catch {}
  // Also check case_records.facts column
  if (Object.keys(facts).length === 0 && caseRecord.facts) {
    try { facts = typeof caseRecord.facts === 'string' ? JSON.parse(caseRecord.facts) : caseRecord.facts; } catch {}
  }

  // Try multiple sources for outputs
  let outputs = {};
  try {
    const caseOutputs = dbGet('SELECT * FROM case_outputs WHERE case_id = ?', [caseId]);
    if (caseOutputs?.outputs_json) outputs = JSON.parse(caseOutputs.outputs_json);
  } catch {}
  // Also check file system
  try {
    const cDir = casePath(caseId);
    const fileOutputs = readJSON(path.join(cDir, 'outputs.json'), null);
    if (fileOutputs) outputs = { ...outputs, ...fileOutputs };
  } catch {}
  // Also check case_records.outputs column
  if (Object.keys(outputs).filter(k => k !== 'updatedAt').length === 0 && caseRecord.outputs) {
    try { outputs = typeof caseRecord.outputs === 'string' ? JSON.parse(caseRecord.outputs) : caseRecord.outputs; } catch {}
  }

  // Build sections map from outputs (our generate-all saves text directly to outputs)
  const sectionMap = {};
  for (const [key, val] of Object.entries(outputs)) {
    if (key === 'updatedAt') continue;
    const text = typeof val === 'string' ? val : (val?.text || val?.draft_text || '');
    if (text) sectionMap[key] = { section_id: key, draft_text: text, final_text: text };
  }
  // Also try generated_sections table
  try {
    const sections = dbAll(
      `SELECT * FROM generated_sections WHERE case_id = ? AND (final_text IS NOT NULL OR reviewed_text IS NOT NULL OR draft_text IS NOT NULL) ORDER BY section_id, created_at DESC`,
      [caseId]
    );
    for (const s of sections) {
      if (!sectionMap[s.section_id]) sectionMap[s.section_id] = s;
    }
  } catch {}

  // Comps (up to 6)
  let comps = [];
  try {
    comps = dbAll(
      `SELECT cc.*, cs.overall_score
       FROM comp_candidates cc
       LEFT JOIN comp_scores cs ON cs.comp_candidate_id = cc.id
       WHERE cc.case_id = ? AND cc.is_active = 1
       ORDER BY cs.overall_score DESC LIMIT 6`,
      [caseId]
    );
  } catch { /* table may not exist */ }

  // Adjustments
  let adjustments = [];
  try {
    adjustments = dbAll(
      'SELECT * FROM adjustment_support_records WHERE case_id = ? ORDER BY grid_slot, adjustment_category',
      [caseId]
    );
  } catch { /* ok */ }

  // Reconciliation
  let reconciliation = null;
  try {
    reconciliation = dbGet('SELECT * FROM reconciliation_support_records WHERE case_id = ?', [caseId]);
  } catch { /* ok */ }

  return { caseRecord, facts, outputs, sections: sectionMap, comps, adjustments, reconciliation };
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Fill the official Fannie Mae Form 1004 PDF template with case data.
 *
 * @param {string|Object} caseIdOrData — case ID string OR pre-loaded case data object
 * @returns {Promise<Buffer>} filled PDF bytes
 */
export async function fillForm1004(caseIdOrData) {
  // Accept either a caseId string or a pre-loaded data object
  const caseData = (typeof caseIdOrData === 'string')
    ? loadCaseForForm(caseIdOrData)
    : caseIdOrData;

  const { caseRecord = {}, facts = {}, outputs = {}, sections = {}, comps = [], adjustments = [], reconciliation = null, meta = {} } = caseData;

  log.info('pdf-filler:data-received', {
    hasFactsSubject: !!facts?.subject?.address,
    sectionsCount: Object.keys(sections).length,
    outputsCount: Object.keys(outputs).filter(k => k !== 'updatedAt').length,
    factKeys: Object.keys(facts),
  });

  // Load template
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();

  // ── Helpers ────────────────────────────────────────────────────────────────

  let _setCount = 0;
  /** Safely set a text field — silently skip if field not found */
  function setText(fieldName, value) {
    try {
      if (value !== null && value !== undefined && value !== '') {
        const field = form.getTextField(fieldName);
        _setCount++;
        field.setText(String(value));
      }
    } catch { /* field not found or wrong type — skip */ }
  }

  /** Safely check/uncheck a checkbox */
  function setCheck(fieldName, checked) {
    try {
      const field = form.getCheckBox(fieldName);
      if (checked) field.check();
      else field.uncheck();
    } catch { /* skip */ }
  }

  /** Safely select a radio group option */
  function setRadio(groupName, optionValue) {
    try {
      const field = form.getRadioGroup(groupName);
      if (optionValue !== undefined && optionValue !== null && optionValue !== '') {
        field.select(String(optionValue));
      }
    } catch { /* skip */ }
  }

  /**
   * Fill a multi-line narrative into sequential "Line_1", "Line_2", … fields.
   * @param {string} baseFieldName  e.g. "Neighborhood Description Line"
   * @param {string} text           full narrative text
   * @param {number} maxLines       maximum number of line fields available
   * @param {string} [sep]          separator between base name and number, default "_"
   */
  function setMultiLine(baseFieldName, text, maxLines = 5, sep = '_') {
    if (!text) return;
    const lines = splitLines(text);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      setText(`${baseFieldName}${sep}${i + 1}`, lines[i]);
    }
  }

  // ── Convenience shortcuts ─────────────────────────────────────────────────
  const subject        = facts.subject        || {};
  const neighborhood   = facts.neighborhood   || {};
  const site           = facts.site           || {};
  const improvements   = facts.improvements   || {};
  const publicRecords  = facts.publicRecords  || {};
  const caseMeta       = { ...meta, ...caseRecord };

  // Resolve comps: prefer caseData.comps (DB rows), fall back to facts.comps (structured array)
  const resolvedComps = (comps && comps.length > 0) ? comps : (facts.comps || []);

  // ── SUBJECT SECTION ───────────────────────────────────────────────────────
  setText('Property Address',      subject.address);
  setText('Ciy',                   subject.city);                       // typo in PDF
  // State might be FIPS code (17) or abbreviation (IL) — ensure we use abbreviation
  const stateVal = subject.state?.length <= 2 && /^\d+$/.test(subject.state) ? 'IL' : (subject.state || 'IL');
  setText('State',                 stateVal);
  setText('Zip Code',              subject.zipCode);
  setText('County',                subject.county);
  setText('Borrower',              subject.borrower       || caseMeta.borrower_name);
  setText('Owner of Public Record', subject.ownerOfRecord);
  setText('Legal Description',     subject.legalDescription);
  setText('Tax Year',              subject.taxYear);
  setText('R.E. Taxes',            subject.realEstateTaxes);
  setText('Assessors Parcel',      subject.assessorsParcelNumber || publicRecords.parcelNumber);
  setText('Map Reference',         subject.mapReference);
  setText('Census Tract',          subject.censusTract   || publicRecords.censusTract);
  setText('Neighborhood Name',     subject.subdivision   || subject.neighborhoodName);
  setText('Lender Client',         caseMeta.lender_name      || caseMeta.client_name);
  setText('Address',               caseMeta.lender_address   || caseMeta.client_address);
  setText('Special Assessments',   subject.specialAssessments);
  setText('Contract Price',        subject.salePrice);
  setText('Date of Contract',      subject.saleDate);

  // Effective date / inspection date
  setText('Effective Date',        caseMeta.effective_date   || caseMeta.inspection_date);

  // Property rights (Fee Simple / Leasehold)
  setText('Property Rights Appraised', subject.propertyRights || 'Fee Simple');

  // Occupancy checkboxes (named labels)
  const occupancy = (subject.occupancy || subject.occupant || '').toLowerCase();
  setCheck('Owner',               occupancy === 'owner');
  setCheck('Tenant',              occupancy === 'tenant');
  setCheck('Vacant',              occupancy === 'vacant');

  // Occupancy checkboxes (Check Box numbered variants)
  const occupantStr = subject.occupant || subject.occupancy || '';
  setCheck('Check Box1', occupantStr === 'Owner');
  setCheck('Check Box3', occupantStr === 'Tenant');
  setCheck('Check Box4', occupantStr === 'Vacant');

  // PUD — default No
  setCheck('Check Box5', false);
  setCheck('Check Box6', true);

  // Foundation checkboxes
  setCheck('Check Box7',  improvements.foundation?.includes('Slab'));
  setCheck('Check Box8',  improvements.foundation?.includes('Crawl'));
  setCheck('Check Box9',  improvements.foundation?.includes('Full Basement'));
  setCheck('Check Box10', improvements.foundation?.includes('Partial'));

  // Appliances (assume standard appliances present)
  setCheck('Check Box11', true); // Range/Oven
  setCheck('Check Box13', true); // Dishwasher
  setCheck('Check Box14', true); // Disposal

  // ── NEIGHBORHOOD SECTION ──────────────────────────────────────────────────

  // Boundaries: combine cardinal directions (check both subject and neighborhood for boundary data)
  const boundaries = [
    (subject.NORTH_BOUNDARY || neighborhood.boundaryNorth) ? `N: ${subject.NORTH_BOUNDARY || neighborhood.boundaryNorth}` : '',
    (subject.SOUTH_BOUNDARY || neighborhood.boundarySouth) ? `S: ${subject.SOUTH_BOUNDARY || neighborhood.boundarySouth}` : '',
    (subject.EAST_BOUNDARY  || neighborhood.boundaryEast)  ? `E: ${subject.EAST_BOUNDARY  || neighborhood.boundaryEast}`  : '',
    (subject.WEST_BOUNDARY  || neighborhood.boundaryWest)  ? `W: ${subject.WEST_BOUNDARY  || neighborhood.boundaryWest}`  : '',
  ].filter(Boolean).join('; ') || neighborhood.boundaries || '';
  setText('Neighborhood Boundaries', boundaries);

  // Neighborhood description narrative
  const neighborhoodDesc = sectionText(sections['neighborhood_description'])
    || outputs.neighborhood_description || '';
  setMultiLine('Neighborhood Description Line', neighborhoodDesc, 5);

  // Market conditions narrative
  const marketConditions = sectionText(sections['market_conditions'])
    || outputs.market_conditions || '';
  setMultiLine('Market Conditions including support for the above conclusions Line', marketConditions, 5);

  // Present land use percentages
  setText('Present Land Use One - Unit',    neighborhood.landUseOneFamily);
  setText('Present Land Use 2-4 Unit',      neighborhood.landUseTwoToFour);
  setText('Present Land Use Multi-Family',  neighborhood.landUseMultiFamily);
  setText('Present Land Use Commercial',    neighborhood.landUseCommercial);
  setText('Present Land Use Other',         neighborhood.landUseOther);

  // Neighborhood characteristics checkboxes
  // Urban / Suburban / Rural
  const locationType = (neighborhood.locationType || '').toLowerCase();
  setCheck('Urban',    locationType === 'urban');
  setCheck('Suburban', locationType === 'suburban' || locationType === '');
  setCheck('Rural',    locationType === 'rural');

  // Built-up
  const builtUp = (neighborhood.builtUp || '').toLowerCase();
  setCheck('Over 75%',  builtUp === 'over 75%' || builtUp === 'over75');
  setCheck('25-75%',    builtUp === '25-75%');
  setCheck('Under 25%', builtUp === 'under 25%');

  // Growth
  const growth = (neighborhood.growth || '').toLowerCase();
  setCheck('Rapid',  growth === 'rapid');
  setCheck('Stable', growth === 'stable' || growth === '');
  setCheck('Slow',   growth === 'slow');

  // Property values trend
  const valueTrend = (neighborhood.propertyValuesTrend || neighborhood.valueTrend || '').toLowerCase();
  setCheck('Increasing', valueTrend === 'increasing');
  setCheck('Stable',     valueTrend === 'stable' || (!valueTrend));
  setCheck('Declining',  valueTrend === 'declining');

  // Demand / supply
  const demandSupply = (neighborhood.demandSupply || '').toLowerCase();
  setCheck('Shortage',    demandSupply === 'shortage');
  setCheck('In Balance',  demandSupply === 'in balance' || (!demandSupply));
  setCheck('Over Supply', demandSupply === 'over supply' || demandSupply === 'oversupply');

  // Marketing time
  const mktTime = (neighborhood.marketingTime || '').toLowerCase();
  setCheck('Under 3 Months', mktTime === 'under 3 months');
  setCheck('3-6 Months',     mktTime === '3-6 months' || (!mktTime));
  setCheck('Over 6 Months',  mktTime === 'over 6 months');

  // Radio group mappings for neighborhood characteristics
  // These mirror the named checkboxes above but via radio groups (PDF may use either)
  try {
    const locationStr = neighborhood.locationType || 'Suburban';
    setRadio('Group_9', locationStr);
  } catch { /* skip */ }
  try {
    const builtUpStr = neighborhood.builtUp || 'Over 75%';
    setRadio('Group_10', builtUpStr);
  } catch { /* skip */ }
  try {
    const growthStr = neighborhood.growth || 'Stable';
    setRadio('Group_11', growthStr);
  } catch { /* skip */ }
  try {
    const valueTrendStr = neighborhood.propertyValuesTrend || neighborhood.valueTrend || 'Stable';
    setRadio('Group_12', valueTrendStr);
  } catch { /* skip */ }
  try {
    const demandStr = neighborhood.demandSupply || 'In Balance';
    setRadio('Group_13', demandStr);
  } catch { /* skip */ }
  try {
    const mktTimeStr = neighborhood.marketingTime || '3-6 Months';
    setRadio('Group_14', mktTimeStr);
  } catch { /* skip */ }

  // Price range & predominant
  setText('Price',              neighborhood.priceRangeLow);
  setText('Price_2',            neighborhood.priceRangeHigh);
  setText('Predominant',        neighborhood.predominantPrice);
  setText('Age',                neighborhood.ageRangeLow);
  setText('Age_2',              neighborhood.ageRangeHigh);
  setText('Predominant_2',      neighborhood.predominantAge);

  // ── SITE SECTION ──────────────────────────────────────────────────────────
  setText('Dimesions',                      site.lotDimensions);  // typo in PDF
  setText('Area',                           site.lotSize);
  setText('Shape',                          site.shape);
  setText('View',                           site.view);
  setText('Specific Zoning Classification', site.zoning);
  setText('Zoning Description',             site.zoningDescription);
  setText('FEMA Flood Zone',                site.floodZone       || publicRecords.floodZone);
  setText('FEMA Map',                       site.floodMapNumber  || publicRecords.floodMapNumber);
  setText('FEMA Map Date',                  site.floodMapDate    || publicRecords.floodMapDate);

  // Utilities
  setText('Electric',  site.electric  || 'Public');
  setText('Gas',       site.gas       || 'Public');
  setText('Water',     site.water     || 'Public');
  setText('Sanitary Sewer', site.sewer || 'Public');

  // Site comments
  const siteComments = sectionText(sections['site_comments'])
    || outputs.site_comments || '';
  setMultiLine('Site Comments Line', siteComments, 3);

  // ── IMPROVEMENTS SECTION ──────────────────────────────────────────────────
  setText('Of Stories',                                     improvements.stories);
  setText('Year Built',                                     improvements.yearBuilt);
  setText('Design Style',                                   improvements.design || improvements.style);
  setText('Effective Age Yrs',                              improvements.effectiveAge);
  setText('Basement Area',                                  improvements.basementArea);
  setText('Basement Finish',                                improvements.basementFinishPercent);
  setText('Exterior Description Exterior Walls',            improvements.exteriorWalls);
  setText('Exterior Description Roof Surface',              improvements.roofSurface);
  setText('Rooms',                                          improvements.rooms);
  setText('Bedrooms',                                       improvements.bedrooms);
  setText('Baths',                                          improvements.bathrooms);
  setText('Square Feet of Gross Living Area above grade',   improvements.gla);

  // Additional features / functional utility
  const additionalFeatures = improvements.specialFeatures
    || sectionText(sections['functional_utility'])
    || outputs.functional_utility || '';
  setText('Additional features', additionalFeatures);

  // Condition narrative
  const conditionText = sectionText(sections['improvements_condition'])
    || outputs.improvements_condition || '';
  setMultiLine('Describe the condition of the property Line', conditionText, 5);

  // Foundation, heating, cooling, etc.
  setText('Foundation',          improvements.foundation);
  setText('Heating',             improvements.heating);
  setText('Cooling',             improvements.cooling);
  setText('Garage Carport',      improvements.garage);
  setText('Garage Cars',         improvements.garageCars);

  // Adverse conditions narrative
  const adverseText = sectionText(sections['adverse_conditions']) || '';
  if (adverseText) {
    setMultiLine('If no Describe Line', adverseText, 3);
  }

  // Conformity narrative  
  const conformityText = sectionText(sections['functional_utility_conformity']) || '';
  if (conformityText) {
    setMultiLine('If Yes, Describe_1 Line', conformityText, 2);
  }

  // Scope of work narrative (page 4)
  const scopeText = sectionText(sections['scope_of_work']) || '';

  // Prior sales narrative
  const priorSalesText = sectionText(sections['prior_sales_subject']) || '';
  if (priorSalesText) {
    setMultiLine('Analysis of prior sale or transfer history of the subject property and comparable sales Line', priorSalesText, 5);
  }

  // Contract analysis narrative
  const contractText = sectionText(sections['contract_analysis']) || '';
  if (contractText) {
    setText('analyze the contract for sale for the subject purchase transaction. Explain the results of the analysis of the contract for sale or why the analysis was not performed', contractText);
  }

  // HBU narrative — goes in the "If no Describe_1" field (HBU as improved = present use)

  // ── SALES COMPARISON APPROACH ─────────────────────────────────────────────
  // Subject column
  setText('Subject GLA',         improvements.gla);
  setText('Subject Rooms',       improvements.rooms);
  setText('Subject Bedrooms',    improvements.bedrooms);
  setText('Subject Baths',       improvements.bathrooms);
  setText('Subject Location',    subject.address);
  setText('Subject Site',        site.lotSize);
  setText('Subject Age',         improvements.yearBuilt);
  setText('Subject Condition',   improvements.condition);
  setText('Subject Year Built',  improvements.yearBuilt);

  // Comp columns (up to 3 comps)
  for (let i = 0; i < Math.min(resolvedComps.length, 3); i++) {
    const comp = resolvedComps[i];
    const n = i + 1;
    let data = {};
    if (comp.candidate_json) {
      try { data = JSON.parse(comp.candidate_json); } catch { /* ok */ }
    } else {
      data = comp; // facts.comps are already flat objects
    }

    // Merge top-level comp row columns with parsed JSON
    const addr     = data.address     || comp.address     || '';
    const city     = data.city        || comp.city        || '';
    const state    = data.state       || comp.state       || '';
    const zip      = data.zipCode     || comp.zip_code    || '';
    const fullAddr = [addr, city, state, zip].filter(Boolean).join(', ');

    setText(`Comparable Sale ${n} Address`,               addr);
    setText(`Comparable Sale ${n} City`,                  city);
    setText(`Comparable Sale ${n} State`,                 state);
    setText(`Comparable Sale ${n} Zip`,                   zip);
    setText(`Comparable Sale ${n} Address_Full`,          fullAddr); // try both variants
    setText(`Comparable Sale ${n} Proximity to Subject`,  data.proximity     || comp.proximity     || '');
    setText(`Comparable Sale ${n} Sale Price`,            data.salePrice     || comp.sale_price    || '');
    setText(`Comparable Sale ${n} Sale Date`,             data.saleDate      || comp.sale_date     || '');
    setText(`Comparable Sale ${n} Data Source`,           data.dataSource    || comp.source        || 'MLS');
    setText(`Comparable Sale ${n} Verification Sources`,  data.dataSource    || comp.source        || 'MLS');
    setText(`Comparable Sale ${n} Location`,              data.location      || data.locationRating || '');
    setText(`Comparable Sale ${n} Site`,                  data.lotSize       || comp.lot_size      || '');
    setText(`Comparable Sale ${n} View`,                  data.view          || '');
    setText(`Comparable Sale ${n} Design Style`,          data.design        || data.style         || '');
    setText(`Comparable Sale ${n} Quality of Construction`, data.quality     || '');
    setText(`Comparable Sale ${n} Actual Age`,            data.yearBuilt     || comp.year_built    || '');
    setText(`Comparable Sale ${n} Condition`,             data.condition     || '');
    setText(`Comparable Sale ${n} Above Grade Room Count Rooms`, data.rooms  || '');
    setText(`Comparable Sale ${n} Above Grade Room Count Bedrooms`, data.bedrooms || comp.bedrooms || '');
    setText(`Comparable Sale ${n} Above Grade Room Count Baths`, data.bathrooms  || comp.bathrooms || '');
    setText(`Comparable Sale ${n} Gross Living Area`,     data.gla           || comp.gla           || '');
    setText(`Comparable Sale ${n} Basement & Finished Rooms Below Grade`, data.basementArea || '');
    setText(`Comparable Sale ${n} Functional Utility`,    data.functionalUtility || '');
    setText(`Comparable Sale ${n} Heating Cooling`,       data.heating       || '');
    setText(`Comparable Sale ${n} Energy Efficient Items`, data.energyItems  || '');
    setText(`Comparable Sale ${n} Garage Carport`,        data.garage        || '');
    setText(`Comparable Sale ${n} Porch Patio Deck`,      data.porchPatioDeck || '');

    // Net/gross adjustments and adjusted sale price
    // Look up adjustments for this comp slot
    const compAdj = adjustments.filter(a => a.grid_slot === n || a.grid_slot === String(n));
    let netAdj = 0;
    for (const adj of compAdj) {
      netAdj += Number(adj.adjustment_amount || adj.net_adjustment || 0);
    }
    if (netAdj !== 0) setText(`Comparable Sale ${n} Net Adj`,  String(netAdj));

    // Sale Price per GLA
    const sp  = parseFloat(data.salePrice  || comp.sale_price || '0');
    const gla = parseFloat(data.gla        || comp.gla        || '0');
    if (sp && gla) {
      setText(`Comparable Sale ${n} Price Per GLA`, String(Math.round(sp / gla)));
    }

    const adjSalePrice = data.adjustedSalePrice || comp.adjusted_sale_price || '';
    if (adjSalePrice) setText(`Comparable Sale ${n} Indicated Value of Subject`, adjSalePrice);
  }

  // Sales Comparison narrative comments
  const scComments = sectionText(sections['sales_comparison'])
    || sectionText(sections['comp_analysis'])
    || outputs.sales_comparison_comments || '';
  setMultiLine('Summary of Sales Comparison Approach Line', scComments, 7);

  // ── RECONCILIATION ────────────────────────────────────────────────────────
  const recon = reconciliation || {};
  const reconOutputs = outputs.reconciliation || {};

  setText('Indicated Value by Sales Comparison Approach',
    recon.indicated_value_sales || reconOutputs.indicatedValueSales || outputs.indicated_value_sales || '');
  setText('Indicated Value by Cost Approach',
    recon.indicated_value_cost  || reconOutputs.indicatedValueCost  || outputs.indicated_value_cost  || '');
  setText('Indicated Value by Income Approach',
    recon.indicated_value_income || reconOutputs.indicatedValueIncome || outputs.indicated_value_income || '');

  const finalValue = recon.final_value
    || recon.reconciled_value
    || reconOutputs.finalValue
    || outputs.final_value
    || caseMeta.opinion_of_value
    || '';
  setText('Market Value', finalValue);
  setText('Final Reconciled Value', finalValue);

  // Effective date
  const effDate = recon.effective_date
    || caseMeta.effective_date
    || caseMeta.inspection_date
    || '';
  setText('Effective Date of Appraisal', effDate);

  // Reconciliation narrative
  const reconText = sectionText(sections['reconciliation'])
    || sectionText(sections['reconciliation_narrative'])
    || outputs.reconciliation_comments || '';
  setMultiLine('Reconciliation comments Line', reconText, 5);

  // ── APPRAISER INFO ────────────────────────────────────────────────────────
  setText('Appraiser Name',       caseMeta.appraiser_name);
  setText('Company Name',         caseMeta.company_name    || 'Cresci Appraisal & Consulting Company');
  setText('Company Address',      caseMeta.company_address);
  setText('Telephone Number',     caseMeta.appraiser_phone);
  setText('Email Address',        caseMeta.appraiser_email);
  setText('State Certification',  caseMeta.license_number);
  setText('State',                caseMeta.license_state   || caseMeta.state);
  setText('Expiration Date of Certification or License', caseMeta.license_expiration);
  setText('Supervisory Appraiser Name', caseMeta.supervisory_appraiser);
  setText('Supervisory Appraiser State', caseMeta.supervisory_state);

  // ── COST APPROACH (if applicable) ─────────────────────────────────────────
  const costText = sectionText(sections['cost_approach'])
    || outputs.cost_approach_comments || '';
  if (costText) setMultiLine('Cost Approach Comments Line', costText, 3);

  setText('Estimated Site Value',         outputs.site_value      || recon?.site_value      || '');
  setText('Estimated Reproduction Cost',  outputs.reproduction_cost || '');
  setText('Depreciation',                 outputs.depreciation    || '');
  setText('Depreciated Cost of Improvements', outputs.depreciated_cost || '');
  setText('Indicated Value by Cost Approach', outputs.cost_approach_value || '');

  // ── EXACT PDF FIELD NAME ADDITIONS ──────────────────────────────────────
  // Maps to the precise field names in Form 1004, including official typos.

  // Subject — extra exact names
  setText('Date of Inspection',   caseMeta.inspection_date || caseMeta.effective_date || '');

  // Improvements — exterior material fields (missing from above)
  setText('Exterior Description Gutters & Downspouts',  improvements.guttersDownspouts || '');
  setText('Exterior Description Window Type',           improvements.windowType        || '');
  setText('Exterior Description Storm Sash Insulated',  improvements.stormSash         || '');
  setText('Exterior Description Screens',               improvements.screens           || '');
  setText('Exterior Description Foundation Walls',      improvements.foundationWalls   || improvements.foundation || '');

  // Improvements — interior material fields
  setText('Interior Floors',        improvements.floors        || '');
  setText('Interior Walls',         improvements.interiorWalls || '');
  setText('Interior Bath Floor',    improvements.bathFloor     || '');
  setText('Interior Tirm Finish',   improvements.trimFinish    || '');  // "Tirm" is the PDF typo
  setText('Interior Bath Wainscot', improvements.bathWainscot  || '');

  // Improvements — heating fuel, car storage, driveway
  setText('Foundation Fuel',    improvements.heatingFuel     || improvements.fuel           || '');
  setText('Car Storage',        improvements.carStorage      || improvements.garageType     || '');
  setText('Driveway Surface',   improvements.drivewaySurface || '');

  // Condition narrative — full 34 lines (PDF has many line fields)
  const conditionTextFull = sectionText(sections['improvements_condition'])
    || sectionText(sections['condition'])
    || outputs.improvements_condition || '';
  setMultiLine('Describe the condition of the property Line', conditionTextFull, 34);

  // Subject columns — exact field names for sales comparison grid header
  const subjSP  = subject.salePrice || caseMeta.sale_price || '';
  const subjGLA = String(improvements.gla || subject.gla || '');
  setText('Subject Sale Price', subjSP);
  if (subjSP && subjGLA) {
    const spNum2  = parseFloat(String(subjSP).replace(/[^0-9.]/g, ''));
    const glaNum2 = parseFloat(String(subjGLA).replace(/[^0-9.]/g, ''));
    if (spNum2 && glaNum2) setText('Subject Sale Price/Gross Liv.Area $', String(Math.round(spNum2 / glaNum2)));
  }
  setText('Feature and Subject', improvements.condition || subject.condition || '');

  // Above Grade Room Count — subject (exact field names)
  setText('Above Grade Room Count Gross Living Area Total',      String(improvements.rooms     || subject.rooms     || ''));
  setText('Above Grade Room Count Gross Living Area Bedrooms',   String(improvements.bedrooms  || subject.bedrooms  || ''));
  setText('Above Grade Room Count Gross Living Area Bath rooms', String(improvements.bathrooms || subject.bathrooms || ''));

  // Sales comparison — exact comp field names + above-grade counts per comp
  for (let ci = 0; ci < Math.min(resolvedComps.length, 3); ci++) {
    const comp2 = resolvedComps[ci];
    const n2    = ci + 1;   // 1, 2, 3
    let cdata   = {};
    // DB rows have candidate_json; facts.comps entries are already plain objects
    if (comp2.candidate_json) {
      try { cdata = JSON.parse(comp2.candidate_json); } catch { /* ok */ }
    } else {
      cdata = comp2; // facts.comps objects are already flat
    }

    const cAddr   = cdata.address   || comp2.address    || '';
    const cSP     = cdata.salePrice || cdata.sale_price  || comp2.sale_price  || '';
    const cGLA    = cdata.gla       || comp2.gla         || '';
    const cProx   = cdata.proximity || comp2.proximity   || '';
    const cSource = cdata.dataSource || comp2.source     || 'MLS';

    // Address field — exact PDF name (no "Address" suffix)
    setText(`Comparable Sale ${n2}`,                          cAddr);
    setText(`Comparable Sale ${n2} Proximity to Subject`,     cProx);

    // Sale price field names differ per comp due to official PDF inconsistencies
    if (n2 === 1) setText('Comparable Sale 1 Sale price $',  cSP);
    if (n2 === 2) setText('Comparable Sale 2 sale price $',  cSP); // lowercase 's'
    if (n2 === 3) setText('Comparable Sale 3 Sale Price $',  cSP); // capital S, P

    if (cSP && cGLA) {
      const sp3 = parseFloat(String(cSP).replace(/[^0-9.]/g, ''));
      const gl3 = parseFloat(String(cGLA).replace(/[^0-9.]/g, ''));
      if (sp3 && gl3) setText(`Comparable Sale ${n2} Sale Price/Gross Liv.Area $`, String(Math.round(sp3 / gl3)));
    }
    setText(`Comparable Sale ${n2} Data Sources`,         cSource);
    setText(`Comparable Sale ${n2} Verification Sources`, cSource);

    // Above Grade Room Count — comp suffixes _1, _2, _3
    setText(`Above Grade Room Count Gross Living Area Total_${n2}`,      String(cdata.rooms     || comp2.rooms     || ''));
    setText(`Above Grade Room Count Gross Living Area Bedrooms_${n2}`,   String(cdata.bedrooms  || comp2.bedrooms  || ''));
    setText(`Above Grade Room Count Gross Living Area Bath rooms_${n2}`, String(cdata.bathrooms || comp2.bathrooms || ''));

    // Also fill GLA, year built for facts.comps fields
    setText(`Comparable Sale ${n2} Gross Living Area`,  String(cGLA));
    setText(`Comparable Sale ${n2} Actual Age`,         String(cdata.yearBuilt || cdata.year_built || comp2.yearBuilt || comp2.year_built || ''));
  }

  // Adjustment grid — description columns and adjustment amount columns
  // Subject description: "Description {Category}"
  // Comp n description:  "Description {Category}_n"   (n = 1, 2, 3)
  // Comp 1 adjustment:   "Adjustment {Category}"       (no suffix)
  // Comp 2 adjustment:   "Adjustment {Category}_1"
  // Comp 3 adjustment:   "Adjustment {Category}_2"
  const gridCategories = [
    { key: 'sale_financing', base: 'Sale or Financing Concessions', subjectVal: '' },
    { key: 'date_of_sale',   base: 'Date of Sale/Time',             subjectVal: '' },
    { key: 'location',       base: 'Location',                      subjectVal: neighborhood.locationType || subject.location || '' },
    { key: 'leasehold',      base: 'Leasehold/Fee Simple',          subjectVal: subject.propertyRights || 'Fee Simple' },
    { key: 'site',           base: 'Site',                          subjectVal: String(site.lotSize || '') },
    { key: 'view',           base: 'View',                          subjectVal: site.view || '' },
    { key: 'design',         base: 'Design (style)',                subjectVal: improvements.design || improvements.style || '' },
    { key: 'quality',        base: 'Quality of Construction',       subjectVal: improvements.quality || '' },
    { key: 'age',            base: 'Actual Age',                    subjectVal: String(improvements.yearBuilt || '') },
    { key: 'condition',      base: 'Condition',                     subjectVal: improvements.condition || '' },
  ];

  for (const cat of gridCategories) {
    setText(`Description ${cat.base}`, cat.subjectVal);

    for (let ci = 0; ci < Math.min(resolvedComps.length, 3); ci++) {
      const comp3 = resolvedComps[ci];
      const n3    = ci + 1;
      let cdata3  = {};
      if (comp3.candidate_json) {
        try { cdata3 = JSON.parse(comp3.candidate_json); } catch { /* ok */ }
      } else {
        cdata3 = comp3;
      }

      const compDescVals = {
        sale_financing: '',
        date_of_sale:   '',
        location:       cdata3.locationRating || cdata3.location || '',
        leasehold:      cdata3.propertyRights || 'Fee Simple',
        site:           String(cdata3.lotSize || comp3.lot_size || ''),
        view:           cdata3.view      || '',
        design:         cdata3.design    || cdata3.style || '',
        quality:        cdata3.quality   || '',
        age:            String(cdata3.yearBuilt || comp3.year_built || ''),
        condition:      cdata3.condition || '',
      };
      setText(`Description ${cat.base}_${n3}`, compDescVals[cat.key] || '');

      // Adjustment amounts: comp1 = no suffix, comp2 = _1, comp3 = _2
      const adjSuffix3 = n3 === 1 ? '' : `_${n3 - 1}`;
      const adjRec3 = adjustments.find(a =>
        (a.grid_slot === n3 || a.grid_slot === String(n3)) &&
        (a.adjustment_category === cat.key || a.adjustment_category === cat.base)
      );
      const adjAmt3 = adjRec3?.adjustment_amount || adjRec3?.net_adjustment || '';
      if (adjAmt3) setText(`Adjustment ${cat.base}${adjSuffix3}`, String(adjAmt3));
    }
  }

  // Summary of Sales Comparison — up to 7 lines (exact field names)
  const scTextFull = sectionText(sections['sales_comparison'])
    || sectionText(sections['comp_analysis'])
    || outputs.sales_comparison_comments || '';
  setMultiLine('Summary of Sales Comparison Approach Line', scTextFull, 7);

  // Reconciliation — exact field names
  const scaIndicatedValue = recon.indicated_value_sales  || outputs.indicated_value_sales  || '';
  setText('Sales Comparison Approach',      scaIndicatedValue);
  setText('Cost Approach (if developed)',   recon.indicated_value_cost   || outputs.indicated_value_cost   || '');
  setText('Income Approach (if developed)', recon.indicated_value_income || outputs.indicated_value_income || '');
  setText('Appraised value of subject property', finalValue);
  setText('Market Value',                   finalValue);
  setText('Effective Date of Appraisal',    effDate);

  // Appraiser info — exact PDF field names
  setText('Name_1',   caseMeta.appraiser_name || 'Charles Cresci');
  setText('Company Name',
    caseMeta.company_name || 'Cresci Appraisal & Consulting Company');
  {
    const coAddr  = caseMeta.company_address || '';
    const coLines = splitLines(coAddr, CHARS_PER_LINE);
    setText('Company Address Line_1', coLines[0] || '');
    setText('Company Address Line_2', coLines[1] || '');
  }
  setText('Date of Signature and Report',
    caseMeta.signature_date || caseMeta.effective_date || '');
  setText('Expiration date of Certification or License',
    caseMeta.license_expiration || '');

  // Analysis of prior sale or transfer history — lines 1–5
  const priorSaleText = sectionText(sections['prior_sale_analysis'])
    || sectionText(sections['prior_transfers'])
    || outputs.prior_sale_analysis || '';
  {
    const psLines = splitLines(priorSaleText);
    for (let i = 0; i < Math.min(psLines.length, 5); i++) {
      setText(`Analysis of prior sale or transfer history of the subject property Line_${i + 1}`, psLines[i]);
    }
  }

  // Contract analysis narrative
  const contractAnalysisText = sectionText(sections['contract_analysis'])
    || outputs.contract_analysis || '';
  if (contractAnalysisText) {
    const caLines = splitLines(contractAnalysisText);
    // First line goes into the main field; additional lines would need Line_2 etc. if they exist
    setText('analyze the contract for sale', caLines[0] || '');
  }

  // Comments on Cost Approach — fields 1 through 7
  const costCommentFull = sectionText(sections['cost_approach'])
    || outputs.cost_approach_comments || '';
  {
    const ccLines = splitLines(costCommentFull);
    for (let i = 0; i < Math.min(ccLines.length, 7); i++) {
      setText(`Comments on Cost Approach${i + 1}`, ccLines[i]);
    }
  }

  log.info('pdf-filler:fields-set', { count: _setCount });

  // ── FINALIZE ──────────────────────────────────────────────────────────────
  // Don't flatten — keep form editable so appraiser can make adjustments
  // form.flatten();

  const filledBytes = await pdf.save();
  log.info('pdf-form-filler:filled', {
    caseId: caseMeta.case_id,
    address: subject.address,
    compsUsed: Math.min(comps.length, 3),
  });

  return Buffer.from(filledBytes);
}

export default { fillForm1004 };
