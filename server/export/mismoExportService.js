/**
 * server/export/mismoExportService.js
 * -------------------------------------
 * Priority 11 — MISMO XML Export Service
 *
 * Generates MISMO (Mortgage Industry Standards Maintenance Organization) XML
 * for UAD (Uniform Appraisal Dataset) compliance. Supports MISMO 2.6 (legacy)
 * and MISMO 3.4 (current).
 *
 * Public API:
 *   generateMismo(caseId, options)            — create export job, build MISMO XML
 *   buildMismoDocument(caseData, version)      — builds MISMO XML document structure
 *   mapFactsToMismo(facts, formType)           — maps internal facts to MISMO elements
 *   validateMismoOutput(xmlString, version)    — basic structural validation
 *   getMismoFieldMapping(formType)             — returns field mapping table
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
 * Escape XML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build an XML element string.
 * @param {string} tag
 * @param {string|null} value
 * @param {Object} [attrs]
 * @returns {string}
 */
function xmlElement(tag, value, attrs = {}) {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');

  if (value == null || value === '') {
    return `<${tag}${attrStr}/>`;
  }
  return `<${tag}${attrStr}>${escapeXml(value)}</${tag}>`;
}

/**
 * Load case data for MISMO export.
 * @param {string} caseId
 * @returns {Object}
 */
function loadCaseData(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const caseOutputs = dbGet('SELECT * FROM case_outputs WHERE case_id = ?', [caseId]);

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

  let adjustments = [];
  try {
    adjustments = dbAll(
      'SELECT * FROM adjustment_support_records WHERE case_id = ? ORDER BY grid_slot, adjustment_category',
      [caseId]
    );
  } catch {
    // Table may not exist
  }

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
    comps,
    adjustments,
    reconciliation,
  };
}

// ── MISMO Field Mappings ─────────────────────────────────────────────────────

/**
 * Returns the MISMO field mapping table for a form type.
 * Maps internal fact keys to MISMO XML element paths.
 *
 * @param {string} formType — '1004' | '1073' | '2055' | '1025'
 * @returns {Object} mapping tables by category
 */
export function getMismoFieldMapping(formType) {
  const common = {
    // Subject property
    subject: {
      'subject.address':           'PROPERTY/ADDRESS/AddressLineText',
      'subject.streetAddress':     'PROPERTY/ADDRESS/AddressLineText',
      'subject.city':              'PROPERTY/ADDRESS/CityName',
      'subject.state':             'PROPERTY/ADDRESS/StateCode',
      'subject.zip':               'PROPERTY/ADDRESS/PostalCode',
      'subject.zipCode':           'PROPERTY/ADDRESS/PostalCode',
      'subject.county':            'PROPERTY/ADDRESS/CountyName',
      'subject.legalDescription':  'PROPERTY/LEGAL_DESCRIPTIONS/LEGAL_DESCRIPTION/LegalDescriptionTextDescription',
      'subject.taxParcelId':       'PROPERTY/PARCEL_IDENTIFICATIONS/PARCEL_IDENTIFICATION/ParcelIdentifier',
      'subject.censusTract':       'PROPERTY/CENSUS_INFORMATION/CensusTractIdentifier',
      'subject.mapReference':      'PROPERTY/MAP_REFERENCE/MapReferenceIdentifier',
      'subject.borrower':          'PARTIES/PARTY/INDIVIDUAL/NAME/FullName',
      'subject.owner':             'PARTIES/PARTY/INDIVIDUAL/NAME/FullName',
    },

    // Site
    site: {
      'site.area':                 'PROPERTY/SITE/LotSizeSquareFeetCount',
      'site.lotSize':              'PROPERTY/SITE/LotSizeSquareFeetCount',
      'site.lotAcres':             'PROPERTY/SITE/LotSizeAcresCount',
      'site.zoning':               'PROPERTY/SITE/ZoningClassificationType',
      'site.zoningDescription':    'PROPERTY/SITE/ZoningClassificationDescription',
      'site.highestAndBestUse':    'PROPERTY/SITE/HighestAndBestUseCurrentUseDescription',
      'site.utilities':            'PROPERTY/SITE/UtilitiesDescription',
      'site.topography':           'PROPERTY/SITE/TopographyDescription',
      'site.floodZone':            'PROPERTY/SITE/FloodHazardAreaIndicator',
      'site.femaMapNumber':        'PROPERTY/SITE/FEMAFloodZoneIdentifier',
      'site.femaMapDate':          'PROPERTY/SITE/FEMAMapDate',
    },

    // Improvements
    improvements: {
      'improvements.yearBuilt':          'PROPERTY/STRUCTURE/YearBuiltDescription',
      'improvements.effectiveAge':       'PROPERTY/STRUCTURE/PropertyEffectiveAgeYearsCount',
      'improvements.gla':                'PROPERTY/STRUCTURE/GrossLivingAreaSquareFeetCount',
      'improvements.totalRooms':         'PROPERTY/STRUCTURE/TotalRoomCount',
      'improvements.bedrooms':           'PROPERTY/STRUCTURE/TotalBedroomCount',
      'improvements.bathrooms':          'PROPERTY/STRUCTURE/TotalBathroomCount',
      'improvements.basementArea':       'PROPERTY/STRUCTURE/BasementSquareFeetCount',
      'improvements.basementFinished':   'PROPERTY/STRUCTURE/BasementFinishedPercent',
      'improvements.garageType':         'PROPERTY/STRUCTURE/GarageType',
      'improvements.garageCars':         'PROPERTY/STRUCTURE/GarageCarCount',
      'improvements.heating':            'PROPERTY/STRUCTURE/HeatingType',
      'improvements.cooling':            'PROPERTY/STRUCTURE/CoolingType',
      'improvements.foundation':         'PROPERTY/STRUCTURE/FoundationType',
      'improvements.exteriorWalls':      'PROPERTY/STRUCTURE/ExteriorWallType',
      'improvements.roofSurface':        'PROPERTY/STRUCTURE/RoofSurfaceType',
      'improvements.condition':          'PROPERTY/STRUCTURE/PropertyConditionDescription',
      'improvements.quality':            'PROPERTY/STRUCTURE/QualityRatingType',
    },

    // Sales comparison — comps
    comps: {
      'comp.address':            'COMPARABLE/ADDRESS/AddressLineText',
      'comp.city':               'COMPARABLE/ADDRESS/CityName',
      'comp.state':              'COMPARABLE/ADDRESS/StateCode',
      'comp.zip':                'COMPARABLE/ADDRESS/PostalCode',
      'comp.salePrice':          'COMPARABLE/SalePriceAmount',
      'comp.saleDate':           'COMPARABLE/SaleDate',
      'comp.dataSource':         'COMPARABLE/DataSourceDescription',
      'comp.proximityToSubject': 'COMPARABLE/ProximityToSubjectDescription',
      'comp.gla':                'COMPARABLE/GrossLivingAreaSquareFeetCount',
      'comp.lotSize':            'COMPARABLE/LotSizeSquareFeetCount',
      'comp.yearBuilt':          'COMPARABLE/YearBuiltDescription',
      'comp.totalRooms':         'COMPARABLE/TotalRoomCount',
      'comp.bedrooms':           'COMPARABLE/TotalBedroomCount',
      'comp.bathrooms':          'COMPARABLE/TotalBathroomCount',
      'comp.basementArea':       'COMPARABLE/BasementSquareFeetCount',
      'comp.garageType':         'COMPARABLE/GarageType',
      'comp.garageCars':         'COMPARABLE/GarageCarCount',
    },

    // Adjustments
    adjustments: {
      'adjustment.saleOrFinancingConcessions': 'COMPARABLE/ADJUSTMENTS/SaleOrFinancingConcessionsAmount',
      'adjustment.dateOfSale':                  'COMPARABLE/ADJUSTMENTS/DateOfSaleTimeAdjustmentAmount',
      'adjustment.location':                    'COMPARABLE/ADJUSTMENTS/LocationAdjustmentAmount',
      'adjustment.siteArea':                    'COMPARABLE/ADJUSTMENTS/SiteAreaAdjustmentAmount',
      'adjustment.design':                      'COMPARABLE/ADJUSTMENTS/DesignAdjustmentAmount',
      'adjustment.qualityOfConstruction':       'COMPARABLE/ADJUSTMENTS/QualityOfConstructionAdjustmentAmount',
      'adjustment.age':                         'COMPARABLE/ADJUSTMENTS/AgeAdjustmentAmount',
      'adjustment.condition':                   'COMPARABLE/ADJUSTMENTS/ConditionAdjustmentAmount',
      'adjustment.gla':                         'COMPARABLE/ADJUSTMENTS/GrossLivingAreaAdjustmentAmount',
      'adjustment.basementFinishedRooms':       'COMPARABLE/ADJUSTMENTS/BasementFinishedRoomsAdjustmentAmount',
      'adjustment.functionalUtility':           'COMPARABLE/ADJUSTMENTS/FunctionalUtilityAdjustmentAmount',
      'adjustment.heatingCooling':              'COMPARABLE/ADJUSTMENTS/HeatingCoolingAdjustmentAmount',
      'adjustment.garageCarport':               'COMPARABLE/ADJUSTMENTS/GarageCarportAdjustmentAmount',
      'adjustment.porchPatioDeck':              'COMPARABLE/ADJUSTMENTS/PorchPatioDecksAdjustmentAmount',
      'adjustment.netAdjustmentTotal':          'COMPARABLE/ADJUSTMENTS/NetAdjustmentTotalAmount',
      'adjustment.adjustedSalePrice':           'COMPARABLE/ADJUSTMENTS/AdjustedSalePriceAmount',
    },

    // Cost approach
    costApproach: {
      'cost.estimatedReproductionCost':  'COST_APPROACH/EstimatedReproductionCostAmount',
      'cost.lessDepreciation':           'COST_APPROACH/LessDepreciationAmount',
      'cost.depreciatedCostOfImprovements': 'COST_APPROACH/DepreciatedCostOfImprovementsAmount',
      'cost.landValue':                  'COST_APPROACH/LandValueAmount',
      'cost.indicatedValueByCostApproach': 'COST_APPROACH/IndicatedValueByCostApproachAmount',
    },

    // Income approach
    incomeApproach: {
      'income.monthlyRent':        'INCOME_APPROACH/EstimatedMonthlyMarketRentAmount',
      'income.grossRentMultiplier': 'INCOME_APPROACH/GrossRentMultiplier',
      'income.indicatedValueByIncomeApproach': 'INCOME_APPROACH/IndicatedValueByIncomeApproachAmount',
    },

    // Reconciliation
    reconciliation: {
      'reconciliation.indicatedValueBySalesComparison': 'RECONCILIATION/IndicatedValueBySalesComparisonApproachAmount',
      'reconciliation.indicatedValueByCostApproach':    'RECONCILIATION/IndicatedValueByCostApproachAmount',
      'reconciliation.indicatedValueByIncomeApproach':  'RECONCILIATION/IndicatedValueByIncomeApproachAmount',
      'reconciliation.finalOpinionOfValue':             'RECONCILIATION/FinalReconciliationAppraisedValueAmount',
      'reconciliation.effectiveDate':                   'RECONCILIATION/AppraisalEffectiveDate',
    },

    // Appraiser certification
    appraiser: {
      'appraiser.name':            'APPRAISER/AppraiserName',
      'appraiser.licenseNumber':   'APPRAISER/LicenseIdentifier',
      'appraiser.licenseState':    'APPRAISER/LicenseIssuingStateCode',
      'appraiser.licenseExpDate':  'APPRAISER/LicenseExpirationDate',
      'appraiser.company':         'APPRAISER/CompanyName',
      'appraiser.firmName':        'APPRAISER/CompanyName',
      'appraiser.phone':           'APPRAISER/ContactPointTelephoneValue',
      'appraiser.email':           'APPRAISER/ContactPointEmailValue',
      'appraiser.signatureDate':   'APPRAISER/AppraisalSignatureDate',
    },
  };

  // Form-specific additions
  if (formType === '1073') {
    common.condo = {
      'project.name':            'PROJECT/ProjectName',
      'project.hoa':             'PROJECT/HOAAmount',
      'project.unitCount':       'PROJECT/TotalUnitCount',
      'project.yearBuilt':       'PROJECT/YearBuiltDescription',
    };
  }

  if (formType === '1025') {
    common.multiFamily = {
      'income.numberOfUnits':    'PROPERTY/STRUCTURE/TotalUnitCount',
      'income.grossMonthlyRent': 'INCOME_APPROACH/GrossMonthlyRentAmount',
      'income.operatingExpenses':'INCOME_APPROACH/OperatingExpensesAmount',
      'income.netOperatingIncome':'INCOME_APPROACH/NetOperatingIncomeAmount',
      'income.capRate':          'INCOME_APPROACH/CapitalizationRate',
    };
  }

  return common;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate MISMO XML export for a case.
 *
 * @param {string} caseId
 * @param {Object} [options]
 * @param {string} [options.version] — 'mismo_2_6' | 'mismo_3_4' (default: 'mismo_3_4')
 * @param {string} [options.formType] — override form type
 * @param {string} [options.recipientName]
 * @param {string} [options.recipientEmail]
 * @param {string} [options.deliveryMethod]
 * @returns {Object} { job, xml }
 */
export function generateMismo(caseId, options = {}) {
  const startTime = Date.now();
  const jobId = genId('expj_');
  const ts = now();
  const version = options.version || 'mismo_3_4';

  const caseData = loadCaseData(caseId);
  if (!caseData.caseRecord) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const formType = options.formType || caseData.caseRecord.form_type || '1004';
  const outputFormat = version === 'mismo_2_6' ? 'mismo_2_6' : 'mismo_3_4';

  // Create export job record
  dbRun(
    `INSERT INTO export_jobs (id, case_id, export_type, export_status, output_format,
       recipient_name, recipient_email, delivery_method, options_json, started_at, created_at)
     VALUES (?, ?, 'xml_mismo', 'processing', ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobId, caseId, outputFormat,
      options.recipientName || null, options.recipientEmail || null,
      options.deliveryMethod || null,
      JSON.stringify(options), ts, ts,
    ]
  );

  try {
    const xml = buildMismoDocument(caseData, version);

    // Validate
    const validation = validateMismoOutput(xml, version);

    const durationMs = Date.now() - startTime;
    const fileName = `${caseId}_${outputFormat}_${Date.now()}.xml`;
    const fileSize = Buffer.byteLength(xml, 'utf8');

    // Update job as completed
    dbRun(
      `UPDATE export_jobs SET export_status = 'completed', file_name = ?,
         file_size = ?, completed_at = ?, duration_ms = ?
       WHERE id = ?`,
      [fileName, fileSize, now(), durationMs, jobId]
    );

    log.info('mismo-export:completed', {
      caseId, jobId, version: outputFormat, fileSize, durationMs,
      validationErrors: validation.errors.length,
    });

    return {
      job: {
        id: jobId,
        caseId,
        exportType: 'xml_mismo',
        exportStatus: 'completed',
        outputFormat,
        fileName,
        fileSize,
        durationMs,
        validation,
      },
      xml,
    };
  } catch (err) {
    dbRun(
      `UPDATE export_jobs SET export_status = 'failed', error_message = ?,
         completed_at = ?, duration_ms = ?
       WHERE id = ?`,
      [err.message, now(), Date.now() - startTime, jobId]
    );

    log.error('mismo-export:failed', { caseId, jobId, error: err.message });
    throw err;
  }
}

/**
 * Build MISMO XML document from case data.
 *
 * @param {Object} caseData — loaded case data bundle
 * @param {string} version — 'mismo_2_6' | 'mismo_3_4'
 * @returns {string} XML string
 */
export function buildMismoDocument(caseData, version = 'mismo_3_4') {
  const { facts, comps, adjustments, reconciliation, sections, caseRecord } = caseData;
  const formType = caseRecord?.form_type || '1004';
  const mismoFacts = mapFactsToMismo(facts, formType);

  const isMismo34 = version === 'mismo_3_4';
  const namespace = isMismo34
    ? 'xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:mismo="http://www.mismo.org/residential/2009/schemas"'
    : 'xmlns="http://www.mismo.org/residential/2006-2/schemas"';

  const rootTag = isMismo34 ? 'MESSAGE' : 'MISMO_26';

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<${rootTag} ${namespace}>`);

  if (isMismo34) {
    lines.push('  <ABOUT_VERSIONS>');
    lines.push(`    ${xmlElement('AboutVersionIdentifier', '3.4')}`);
    lines.push('  </ABOUT_VERSIONS>');
  }

  // ── DEAL / APPRAISAL section ─────────────────────────────────────────
  lines.push('  <DEAL_SETS>');
  lines.push('    <DEAL_SET>');
  lines.push('      <DEALS>');
  lines.push('        <DEAL>');

  // Collateral / Property
  lines.push('          <COLLATERALS>');
  lines.push('            <COLLATERAL>');
  lines.push('              <SUBJECT_PROPERTY>');
  lines.push(...buildPropertyXml(mismoFacts, facts, 16));
  lines.push('              </SUBJECT_PROPERTY>');
  lines.push('            </COLLATERAL>');
  lines.push('          </COLLATERALS>');

  // Parties (borrower, appraiser, lender)
  lines.push('          <PARTIES>');
  lines.push(...buildPartiesXml(facts, 12));
  lines.push('          </PARTIES>');

  // Services / Appraisal
  lines.push('          <SERVICES>');
  lines.push('            <SERVICE>');
  lines.push('              <APPRAISALS>');
  lines.push('                <APPRAISAL>');

  // Form type
  lines.push(`                  ${xmlElement('AppraisalFormType', formType)}`);

  // Comparables
  lines.push('                  <COMPARABLE_SALES>');
  lines.push(...buildComparablesXml(comps, adjustments, formType, 20));
  lines.push('                  </COMPARABLE_SALES>');

  // Cost approach
  if (facts.cost || facts.costApproach) {
    lines.push('                  <COST_APPROACH>');
    lines.push(...buildCostApproachXml(facts, 20));
    lines.push('                  </COST_APPROACH>');
  }

  // Income approach
  if (facts.income || facts.incomeApproach || formType === '1025') {
    lines.push('                  <INCOME_APPROACH>');
    lines.push(...buildIncomeApproachXml(facts, 20));
    lines.push('                  </INCOME_APPROACH>');
  }

  // Reconciliation
  lines.push('                  <RECONCILIATION>');
  lines.push(...buildReconciliationXml(facts, reconciliation, 20));
  lines.push('                  </RECONCILIATION>');

  // Appraiser certification narrative sections
  lines.push('                  <APPRAISER_CERTIFICATIONS>');
  lines.push(...buildCertificationsXml(sections, 20));
  lines.push('                  </APPRAISER_CERTIFICATIONS>');

  lines.push('                </APPRAISAL>');
  lines.push('              </APPRAISALS>');
  lines.push('            </SERVICE>');
  lines.push('          </SERVICES>');

  lines.push('        </DEAL>');
  lines.push('      </DEALS>');
  lines.push('    </DEAL_SET>');
  lines.push('  </DEAL_SETS>');

  lines.push(`</${rootTag}>`);

  return lines.join('\n');
}

/**
 * Map internal fact keys to MISMO element values.
 *
 * @param {Object} facts — internal facts object
 * @param {string} formType
 * @returns {Object} flat map of MISMO element path -> value
 */
export function mapFactsToMismo(facts, formType) {
  const mapping = getMismoFieldMapping(formType);
  const result = {};

  for (const [category, fieldMap] of Object.entries(mapping)) {
    for (const [factPath, mismoPath] of Object.entries(fieldMap)) {
      const value = getNestedValue(facts, factPath);
      if (value != null && value !== '') {
        result[mismoPath] = String(value);
      }
    }
  }

  return result;
}

/**
 * Validate MISMO XML output (basic structural validation).
 * Checks for required elements per the MISMO spec.
 *
 * @param {string} xmlString
 * @param {string} version — 'mismo_2_6' | 'mismo_3_4'
 * @returns {Object} { valid, errors, warnings }
 */
export function validateMismoOutput(xmlString, version = 'mismo_3_4') {
  const errors = [];
  const warnings = [];

  if (!xmlString || typeof xmlString !== 'string') {
    errors.push('XML string is empty or not a string');
    return { valid: false, errors, warnings };
  }

  // Check XML declaration
  if (!xmlString.startsWith('<?xml')) {
    errors.push('Missing XML declaration');
  }

  // Required elements
  const requiredElements = [
    'DEAL_SETS',
    'DEAL_SET',
    'DEAL',
    'COLLATERAL',
    'SUBJECT_PROPERTY',
    'PARTIES',
    'APPRAISAL',
    'RECONCILIATION',
  ];

  for (const elem of requiredElements) {
    if (!xmlString.includes(`<${elem}`)) {
      errors.push(`Missing required element: ${elem}`);
    }
  }

  // Check for subject address
  if (!xmlString.includes('AddressLineText')) {
    warnings.push('Subject address not found');
  }

  // Check for at least one comparable
  if (!xmlString.includes('COMPARABLE_SALE>')) {
    warnings.push('No comparable sales found');
  }

  // Check for reconciliation value
  if (!xmlString.includes('FinalReconciliationAppraisedValueAmount')) {
    warnings.push('Final appraised value not found in reconciliation');
  }

  // Version-specific checks
  if (version === 'mismo_3_4') {
    if (!xmlString.includes('ABOUT_VERSIONS')) {
      warnings.push('Missing ABOUT_VERSIONS element for MISMO 3.4');
    }
  }

  // Check well-formedness (basic tag matching)
  const openTags = (xmlString.match(/<[A-Z_]+[\s>]/g) || []).length;
  const closeTags = (xmlString.match(/<\/[A-Z_]+>/g) || []).length;
  const selfClosing = (xmlString.match(/<[A-Z_]+[^>]*\/>/g) || []).length;
  if (Math.abs(openTags - closeTags - selfClosing) > 5) {
    warnings.push('Possible XML tag mismatch detected');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Internal XML builders ────────────────────────────────────────────────────

function indent(level) {
  return ' '.repeat(level);
}

function buildPropertyXml(mismoFacts, facts, depth) {
  const lines = [];
  const subject = facts.subject || {};
  const site = facts.site || {};
  const improvements = facts.improvements || {};

  // Address
  lines.push(`${indent(depth)}<ADDRESS>`);
  lines.push(`${indent(depth + 2)}${xmlElement('AddressLineText', subject.address || subject.streetAddress || '')}`);
  lines.push(`${indent(depth + 2)}${xmlElement('CityName', subject.city || '')}`);
  lines.push(`${indent(depth + 2)}${xmlElement('StateCode', subject.state || '')}`);
  lines.push(`${indent(depth + 2)}${xmlElement('PostalCode', subject.zip || subject.zipCode || '')}`);
  lines.push(`${indent(depth + 2)}${xmlElement('CountyName', subject.county || '')}`);
  lines.push(`${indent(depth)}</ADDRESS>`);

  // Legal description
  if (subject.legalDescription) {
    lines.push(`${indent(depth)}<LEGAL_DESCRIPTIONS>`);
    lines.push(`${indent(depth + 2)}<LEGAL_DESCRIPTION>`);
    lines.push(`${indent(depth + 4)}${xmlElement('LegalDescriptionTextDescription', subject.legalDescription)}`);
    lines.push(`${indent(depth + 2)}</LEGAL_DESCRIPTION>`);
    lines.push(`${indent(depth)}</LEGAL_DESCRIPTIONS>`);
  }

  // Parcel ID
  if (subject.taxParcelId) {
    lines.push(`${indent(depth)}<PARCEL_IDENTIFICATIONS>`);
    lines.push(`${indent(depth + 2)}<PARCEL_IDENTIFICATION>`);
    lines.push(`${indent(depth + 4)}${xmlElement('ParcelIdentifier', subject.taxParcelId)}`);
    lines.push(`${indent(depth + 2)}</PARCEL_IDENTIFICATION>`);
    lines.push(`${indent(depth)}</PARCEL_IDENTIFICATIONS>`);
  }

  // Site
  lines.push(`${indent(depth)}<SITE>`);
  if (site.lotSize || site.area) lines.push(`${indent(depth + 2)}${xmlElement('LotSizeSquareFeetCount', site.lotSize || site.area)}`);
  if (site.lotAcres) lines.push(`${indent(depth + 2)}${xmlElement('LotSizeAcresCount', site.lotAcres)}`);
  if (site.zoning) lines.push(`${indent(depth + 2)}${xmlElement('ZoningClassificationType', site.zoning)}`);
  if (site.topography) lines.push(`${indent(depth + 2)}${xmlElement('TopographyDescription', site.topography)}`);
  if (site.floodZone) lines.push(`${indent(depth + 2)}${xmlElement('FloodHazardAreaIndicator', site.floodZone)}`);
  lines.push(`${indent(depth)}</SITE>`);

  // Structure / Improvements
  lines.push(`${indent(depth)}<STRUCTURE>`);
  if (improvements.yearBuilt) lines.push(`${indent(depth + 2)}${xmlElement('YearBuiltDescription', improvements.yearBuilt)}`);
  if (improvements.effectiveAge) lines.push(`${indent(depth + 2)}${xmlElement('PropertyEffectiveAgeYearsCount', improvements.effectiveAge)}`);
  if (improvements.gla) lines.push(`${indent(depth + 2)}${xmlElement('GrossLivingAreaSquareFeetCount', improvements.gla)}`);
  if (improvements.totalRooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalRoomCount', improvements.totalRooms)}`);
  if (improvements.bedrooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalBedroomCount', improvements.bedrooms)}`);
  if (improvements.bathrooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalBathroomCount', improvements.bathrooms)}`);
  if (improvements.basementArea) lines.push(`${indent(depth + 2)}${xmlElement('BasementSquareFeetCount', improvements.basementArea)}`);
  if (improvements.garageType) lines.push(`${indent(depth + 2)}${xmlElement('GarageType', improvements.garageType)}`);
  if (improvements.garageCars) lines.push(`${indent(depth + 2)}${xmlElement('GarageCarCount', improvements.garageCars)}`);
  if (improvements.heating) lines.push(`${indent(depth + 2)}${xmlElement('HeatingType', improvements.heating)}`);
  if (improvements.cooling) lines.push(`${indent(depth + 2)}${xmlElement('CoolingType', improvements.cooling)}`);
  if (improvements.foundation) lines.push(`${indent(depth + 2)}${xmlElement('FoundationType', improvements.foundation)}`);
  if (improvements.exteriorWalls) lines.push(`${indent(depth + 2)}${xmlElement('ExteriorWallType', improvements.exteriorWalls)}`);
  if (improvements.roofSurface) lines.push(`${indent(depth + 2)}${xmlElement('RoofSurfaceType', improvements.roofSurface)}`);
  if (improvements.condition) lines.push(`${indent(depth + 2)}${xmlElement('PropertyConditionDescription', improvements.condition)}`);
  if (improvements.quality) lines.push(`${indent(depth + 2)}${xmlElement('QualityRatingType', improvements.quality)}`);
  lines.push(`${indent(depth)}</STRUCTURE>`);

  return lines;
}

function buildPartiesXml(facts, depth) {
  const lines = [];
  const subject = facts.subject || {};
  const appraiser = facts.appraiser || {};
  const lender = facts.lender || {};

  // Borrower / Owner
  if (subject.borrower || subject.owner) {
    lines.push(`${indent(depth)}<PARTY>`);
    lines.push(`${indent(depth + 2)}<ROLES><ROLE><ROLE_DETAIL>`);
    lines.push(`${indent(depth + 4)}${xmlElement('PartyRoleType', 'Borrower')}`);
    lines.push(`${indent(depth + 2)}</ROLE_DETAIL></ROLE></ROLES>`);
    lines.push(`${indent(depth + 2)}<INDIVIDUAL><NAME>`);
    lines.push(`${indent(depth + 4)}${xmlElement('FullName', subject.borrower || subject.owner || '')}`);
    lines.push(`${indent(depth + 2)}</NAME></INDIVIDUAL>`);
    lines.push(`${indent(depth)}</PARTY>`);
  }

  // Appraiser
  if (appraiser.name) {
    lines.push(`${indent(depth)}<PARTY>`);
    lines.push(`${indent(depth + 2)}<ROLES><ROLE><ROLE_DETAIL>`);
    lines.push(`${indent(depth + 4)}${xmlElement('PartyRoleType', 'Appraiser')}`);
    lines.push(`${indent(depth + 2)}</ROLE_DETAIL></ROLE></ROLES>`);
    lines.push(`${indent(depth + 2)}<INDIVIDUAL><NAME>`);
    lines.push(`${indent(depth + 4)}${xmlElement('FullName', appraiser.name)}`);
    lines.push(`${indent(depth + 2)}</NAME></INDIVIDUAL>`);
    if (appraiser.licenseNumber) {
      lines.push(`${indent(depth + 2)}<LICENSES><LICENSE>`);
      lines.push(`${indent(depth + 4)}${xmlElement('LicenseIdentifier', appraiser.licenseNumber)}`);
      if (appraiser.licenseState) lines.push(`${indent(depth + 4)}${xmlElement('LicenseIssuingStateCode', appraiser.licenseState)}`);
      if (appraiser.licenseExpDate) lines.push(`${indent(depth + 4)}${xmlElement('LicenseExpirationDate', appraiser.licenseExpDate)}`);
      lines.push(`${indent(depth + 2)}</LICENSE></LICENSES>`);
    }
    if (appraiser.company || appraiser.firmName) {
      lines.push(`${indent(depth + 2)}${xmlElement('CompanyName', appraiser.company || appraiser.firmName)}`);
    }
    lines.push(`${indent(depth)}</PARTY>`);
  }

  // Lender
  if (lender.name) {
    lines.push(`${indent(depth)}<PARTY>`);
    lines.push(`${indent(depth + 2)}<ROLES><ROLE><ROLE_DETAIL>`);
    lines.push(`${indent(depth + 4)}${xmlElement('PartyRoleType', 'Lender')}`);
    lines.push(`${indent(depth + 2)}</ROLE_DETAIL></ROLE></ROLES>`);
    lines.push(`${indent(depth + 2)}<INDIVIDUAL><NAME>`);
    lines.push(`${indent(depth + 4)}${xmlElement('FullName', lender.name)}`);
    lines.push(`${indent(depth + 2)}</NAME></INDIVIDUAL>`);
    lines.push(`${indent(depth)}</PARTY>`);
  }

  return lines;
}

function buildComparablesXml(comps, adjustments, formType, depth) {
  const lines = [];

  for (let i = 0; i < Math.min(comps.length, 6); i++) {
    const comp = comps[i];
    const data = JSON.parse(comp.candidate_json || '{}');
    const gridSlot = `comp_${i + 1}`;

    lines.push(`${indent(depth)}<COMPARABLE_SALE>`);
    lines.push(`${indent(depth + 2)}${xmlElement('SequenceNumber', String(i + 1))}`);

    // Address
    lines.push(`${indent(depth + 2)}<ADDRESS>`);
    lines.push(`${indent(depth + 4)}${xmlElement('AddressLineText', data.address || data.streetAddress || comp.source_key || '')}`);
    lines.push(`${indent(depth + 4)}${xmlElement('CityName', data.city || '')}`);
    lines.push(`${indent(depth + 4)}${xmlElement('StateCode', data.state || '')}`);
    lines.push(`${indent(depth + 4)}${xmlElement('PostalCode', data.zip || data.zipCode || '')}`);
    lines.push(`${indent(depth + 2)}</ADDRESS>`);

    // Sale data
    if (data.salePrice || data.sale_price) lines.push(`${indent(depth + 2)}${xmlElement('SalePriceAmount', data.salePrice || data.sale_price)}`);
    if (data.saleDate || data.sale_date) lines.push(`${indent(depth + 2)}${xmlElement('SaleDate', data.saleDate || data.sale_date)}`);
    if (data.dataSource) lines.push(`${indent(depth + 2)}${xmlElement('DataSourceDescription', data.dataSource)}`);
    if (data.proximityToSubject) lines.push(`${indent(depth + 2)}${xmlElement('ProximityToSubjectDescription', data.proximityToSubject)}`);

    // Physical characteristics
    if (data.gla) lines.push(`${indent(depth + 2)}${xmlElement('GrossLivingAreaSquareFeetCount', data.gla)}`);
    if (data.lotSize) lines.push(`${indent(depth + 2)}${xmlElement('LotSizeSquareFeetCount', data.lotSize)}`);
    if (data.yearBuilt) lines.push(`${indent(depth + 2)}${xmlElement('YearBuiltDescription', data.yearBuilt)}`);
    if (data.totalRooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalRoomCount', data.totalRooms)}`);
    if (data.bedrooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalBedroomCount', data.bedrooms)}`);
    if (data.bathrooms) lines.push(`${indent(depth + 2)}${xmlElement('TotalBathroomCount', data.bathrooms)}`);

    // Adjustments for this comp
    const compAdjustments = adjustments.filter(a => a.grid_slot === gridSlot);
    if (compAdjustments.length > 0) {
      lines.push(`${indent(depth + 2)}<ADJUSTMENTS>`);
      for (const adj of compAdjustments) {
        const category = adj.adjustment_category;
        const amount = adj.final_amount || adj.suggested_amount || 0;
        const tagName = adjustmentCategoryToMismoTag(category);
        if (tagName) {
          lines.push(`${indent(depth + 4)}${xmlElement(tagName, String(amount))}`);
        }
      }
      lines.push(`${indent(depth + 2)}</ADJUSTMENTS>`);
    }

    lines.push(`${indent(depth)}</COMPARABLE_SALE>`);
  }

  return lines;
}

function buildCostApproachXml(facts, depth) {
  const lines = [];
  const cost = facts.cost || facts.costApproach || {};

  if (cost.estimatedReproductionCost) lines.push(`${indent(depth)}${xmlElement('EstimatedReproductionCostAmount', cost.estimatedReproductionCost)}`);
  if (cost.lessDepreciation) lines.push(`${indent(depth)}${xmlElement('LessDepreciationAmount', cost.lessDepreciation)}`);
  if (cost.depreciatedCostOfImprovements) lines.push(`${indent(depth)}${xmlElement('DepreciatedCostOfImprovementsAmount', cost.depreciatedCostOfImprovements)}`);
  if (cost.landValue) lines.push(`${indent(depth)}${xmlElement('LandValueAmount', cost.landValue)}`);
  if (cost.indicatedValue) lines.push(`${indent(depth)}${xmlElement('IndicatedValueByCostApproachAmount', cost.indicatedValue)}`);

  return lines;
}

function buildIncomeApproachXml(facts, depth) {
  const lines = [];
  const income = facts.income || facts.incomeApproach || {};

  if (income.monthlyRent) lines.push(`${indent(depth)}${xmlElement('EstimatedMonthlyMarketRentAmount', income.monthlyRent)}`);
  if (income.grossRentMultiplier) lines.push(`${indent(depth)}${xmlElement('GrossRentMultiplier', income.grossRentMultiplier)}`);
  if (income.indicatedValue) lines.push(`${indent(depth)}${xmlElement('IndicatedValueByIncomeApproachAmount', income.indicatedValue)}`);
  if (income.grossMonthlyRent) lines.push(`${indent(depth)}${xmlElement('GrossMonthlyRentAmount', income.grossMonthlyRent)}`);
  if (income.operatingExpenses) lines.push(`${indent(depth)}${xmlElement('OperatingExpensesAmount', income.operatingExpenses)}`);
  if (income.netOperatingIncome) lines.push(`${indent(depth)}${xmlElement('NetOperatingIncomeAmount', income.netOperatingIncome)}`);
  if (income.capRate) lines.push(`${indent(depth)}${xmlElement('CapitalizationRate', income.capRate)}`);

  return lines;
}

function buildReconciliationXml(facts, reconciliation, depth) {
  const lines = [];
  const recon = facts.reconciliation || {};
  const reconSupport = reconciliation ? JSON.parse(reconciliation.support_json || '{}') : {};

  if (recon.indicatedValueBySalesComparison || reconSupport.salesComparisonValue) {
    lines.push(`${indent(depth)}${xmlElement('IndicatedValueBySalesComparisonApproachAmount', recon.indicatedValueBySalesComparison || reconSupport.salesComparisonValue)}`);
  }
  if (recon.indicatedValueByCostApproach || reconSupport.costApproachValue) {
    lines.push(`${indent(depth)}${xmlElement('IndicatedValueByCostApproachAmount', recon.indicatedValueByCostApproach || reconSupport.costApproachValue)}`);
  }
  if (recon.indicatedValueByIncomeApproach || reconSupport.incomeApproachValue) {
    lines.push(`${indent(depth)}${xmlElement('IndicatedValueByIncomeApproachAmount', recon.indicatedValueByIncomeApproach || reconSupport.incomeApproachValue)}`);
  }
  if (recon.finalOpinionOfValue || reconSupport.finalValue) {
    lines.push(`${indent(depth)}${xmlElement('FinalReconciliationAppraisedValueAmount', recon.finalOpinionOfValue || reconSupport.finalValue)}`);
  }
  if (recon.effectiveDate || facts.effectiveDate) {
    lines.push(`${indent(depth)}${xmlElement('AppraisalEffectiveDate', recon.effectiveDate || facts.effectiveDate)}`);
  }

  return lines;
}

function buildCertificationsXml(sections, depth) {
  const lines = [];

  // Include narrative sections that map to certifications
  const certSections = ['appraiser_certification', 'certifications', 'scope_of_work'];
  for (const sectionId of certSections) {
    const section = sections[sectionId];
    if (section) {
      const text = section.final_text || section.reviewed_text || section.draft_text || '';
      if (text.trim()) {
        lines.push(`${indent(depth)}${xmlElement('CertificationText', text)}`);
      }
    }
  }

  return lines;
}

/**
 * Map adjustment category name to MISMO XML tag.
 */
function adjustmentCategoryToMismoTag(category) {
  const map = {
    'sale_financing_concessions': 'SaleOrFinancingConcessionsAmount',
    'date_of_sale': 'DateOfSaleTimeAdjustmentAmount',
    'location': 'LocationAdjustmentAmount',
    'site_area': 'SiteAreaAdjustmentAmount',
    'design': 'DesignAdjustmentAmount',
    'quality': 'QualityOfConstructionAdjustmentAmount',
    'age': 'AgeAdjustmentAmount',
    'condition': 'ConditionAdjustmentAmount',
    'gla': 'GrossLivingAreaAdjustmentAmount',
    'basement': 'BasementFinishedRoomsAdjustmentAmount',
    'functional_utility': 'FunctionalUtilityAdjustmentAmount',
    'heating_cooling': 'HeatingCoolingAdjustmentAmount',
    'garage_carport': 'GarageCarportAdjustmentAmount',
    'porch_patio_deck': 'PorchPatioDecksAdjustmentAmount',
  };
  return map[category] || null;
}

/**
 * Get a nested value from an object using dot-separated path.
 * @param {Object} obj
 * @param {string} path
 * @returns {*}
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export default {
  generateMismo,
  buildMismoDocument,
  mapFactsToMismo,
  validateMismoOutput,
  getMismoFieldMapping,
};
