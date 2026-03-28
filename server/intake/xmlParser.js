/**
 * server/intake/xmlParser.js
 * ---------------------------
 * Parse ACI VALUATION_RESPONSE XML (MISMO v2.6 / UCDP format).
 *
 * Extracts:
 *  - Property address, city, state, zip, county, lat/lng
 *  - Borrower name, lender name, appraiser file ID
 *  - Structure: GLA, beds, baths, year built, stories, style, condition
 *  - Comps: address, sale price, adjusted price, GLA, proximity, date, adjustments
 *  - Addendum text (narratives) from AppraisalAddendumText attribute
 *  - Embedded base64 PDF (DOCUMENT tag) — decoded and saved for voice training
 *
 * Returns the same shape as orderParser.js plus comps and narratives.
 */

import fs from 'fs';
import path from 'path';
import log from '../logger.js';

// ── XML attribute helpers ─────────────────────────────────────────────────────

/**
 * Extract a named XML attribute value from a tag string.
 * Handles both single and double quotes.
 */
function attr(tagStr, attrName) {
  // Match attrName="value" or attrName='value'
  const re = new RegExp(`${attrName}=["']([^"']*)["']`);
  const m = tagStr.match(re);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
}

/**
 * Find the first occurrence of a tag opening (possibly multiline) by tag name.
 * Returns the full opening tag string (everything up to '>') or null.
 */
function findTag(xml, tagName) {
  const re = new RegExp(`<${tagName}[\\s>][^>]*>|<${tagName}/>`, 's');
  const m = xml.match(re);
  return m ? m[0] : null;
}

/**
 * Find all occurrences of a tag.
 */
function findAllTags(xml, tagName) {
  const re = new RegExp(`<${tagName}[\\s>][^>]*>|<${tagName}/>`, 'sg');
  return [...xml.matchAll(re)].map(m => m[0]);
}

/**
 * Get text content between opening and closing tags.
 */
function tagContent(xml, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 's');
  const m = xml.match(re);
  return m ? m[1] : null;
}

// ── Form type detection ───────────────────────────────────────────────────────

const FORM_TYPE_MAP = {
  FNM1004: '1004',
  FNM1004C: '1004c',
  FNM1073: '1073',
  FNM1025: '1025',
  FNM1004D: '1004',
  COMMERCIAL: 'commercial',
};

function detectFormType(reportTag, formTags) {
  // Try AppraisalFormType on REPORT tag
  if (reportTag) {
    const ft = attr(reportTag, 'AppraisalFormType');
    if (ft) {
      const upper = ft.toUpperCase().replace(/[-_\s]/g, '');
      for (const [key, val] of Object.entries(FORM_TYPE_MAP)) {
        if (upper.includes(key)) return val;
      }
      // Raw code fallback
      if (/1004C/i.test(ft)) return '1004c';
      if (/1073/i.test(ft)) return '1073';
      if (/1025/i.test(ft)) return '1025';
      if (/1004/i.test(ft)) return '1004';
      if (/commercial/i.test(ft)) return 'commercial';
    }
    // AppraisalFormTypeOtherDescription
    const ftOther = attr(reportTag, 'AppraisalFormTypeOtherDescription');
    if (ftOther && /1004C/i.test(ftOther)) return '1004c';
  }

  // Try FORM tags
  for (const formTag of formTags || []) {
    const id = attr(formTag, 'AppraisalReportContentIdentifier') || '';
    if (/FNM1004C|1004C/i.test(id)) return '1004c';
    if (/FNM1073|1073/i.test(id)) return '1073';
    if (/FNM1025|1025/i.test(id)) return '1025';
    if (/FNM1004/i.test(id)) return '1004';
    if (/commercial/i.test(id)) return 'commercial';
  }

  return '1004'; // default
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * parseAciXml(xmlContent)
 * Parse a VALUATION_RESPONSE XML string into a structured facts object.
 *
 * @param {string} xmlContent  Raw XML string
 * @returns {{ extracted, comps, narratives, hasPdf, pdfBase64 }}
 */
export function parseAciXml(xmlContent) {
  const extracted = {};
  const comps = [];
  const narratives = {};
  let pdfBase64 = null;

  try {
    // ── REPORT tag ───────────────────────────────────────────────────────────
    const reportTag = findTag(xmlContent, 'REPORT');
    const formTags = findAllTags(xmlContent, 'FORM');
    extracted.formTypeCode = detectFormType(reportTag, formTags);

    if (reportTag) {
      extracted.appraiserFileId = attr(reportTag, 'AppraiserFileIdentifier') || null;
      extracted.signedDate = attr(reportTag, 'AppraiserReportSignedDate') || null;
      extracted.purposeType = attr(reportTag, 'AppraisalPurposeType') || null;
    }

    // ── Addendum text (narratives) ────────────────────────────────────────────
    // AppraisalAddendumText on FORM tags contains section markers like -:MARKET CONDITIONS:-
    for (const formTag of formTags) {
      const addendum = attr(formTag, 'AppraisalAddendumText');
      if (!addendum) continue;

      // Parse section markers: -:SECTION NAME:-  text  -:NEXT SECTION:-
      const sections = addendum.split(/-:-\s*|-::/);
      let currentSection = null;
      for (const seg of sections) {
        const stripped = seg.trim();
        if (!stripped) continue;
        // Check if it looks like a section header: "MARKET CONDITIONS"
        if (/^[A-Z][A-Z\s&]+$/.test(stripped) && stripped.length < 80) {
          currentSection = stripped.trim();
          narratives[currentSection] = narratives[currentSection] || '';
        } else if (currentSection) {
          narratives[currentSection] += (narratives[currentSection] ? ' ' : '') + stripped;
        } else {
          // Unheaded text
          narratives['GENERAL'] = (narratives['GENERAL'] || '') + ' ' + stripped;
        }
      }
    }

    // ── Embedded PDF ──────────────────────────────────────────────────────────
    const docContent = tagContent(xmlContent, 'DOCUMENT');
    if (docContent) {
      // Remove whitespace/newlines from base64
      pdfBase64 = docContent.replace(/\s+/g, '');
    }

    // ── PARTIES ───────────────────────────────────────────────────────────────
    const borrowerTag = findTag(xmlContent, 'BORROWER');
    if (borrowerTag) {
      extracted.borrowerName = attr(borrowerTag, '_UnparsedName') || null;
    }

    const lenderTag = findTag(xmlContent, 'LENDER');
    if (lenderTag) {
      extracted.lenderName = attr(lenderTag, '_UnparsedName') || null;
      const lAddr1 = attr(lenderTag, '_StreetAddress') || '';
      const lAddr2 = attr(lenderTag, '_StreetAddress2') || '';
      if (lAddr1) extracted.lenderAddress = lAddr2 ? `${lAddr1}, ${lAddr2}` : lAddr1;
    }

    // ── PROPERTY ──────────────────────────────────────────────────────────────
    const propertyTag = findTag(xmlContent, 'PROPERTY');
    if (propertyTag) {
      extracted.streetAddress = attr(propertyTag, '_StreetAddress') || null;
      extracted.city = attr(propertyTag, '_City') || null;
      extracted.state = attr(propertyTag, '_State') || null;
      extracted.zip = (attr(propertyTag, '_PostalCode') || '').split('-')[0] || null;
      extracted.county = attr(propertyTag, '_County') || null;
      extracted.rightsType = attr(propertyTag, '_RightsType') || null;
      extracted.occupancy = attr(propertyTag, '_CurrentOccupancyType') || null;

      // Build full address
      if (extracted.streetAddress) {
        let addr = extracted.streetAddress;
        if (extracted.city) addr += `, ${extracted.city}`;
        if (extracted.state) addr += `, ${extracted.state}`;
        if (extracted.zip) addr += ` ${extracted.zip}`;
        extracted.address = addr;
      }
    }

    // Lat/Long from _IDENTIFICATION
    const identTag = findTag(xmlContent, '_IDENTIFICATION');
    if (identTag) {
      extracted.parcelId = attr(identTag, 'AssessorsParcelIdentifier') || null;
      const mapRef = attr(identTag, 'MapReferenceIdentifier') || '';
      const llMatch = mapRef.match(/^([-+]?\d+\.?\d*)\/?([-+]?\d+\.?\d*)$/);
      if (llMatch) {
        extracted.lat = parseFloat(llMatch[1]);
        extracted.lng = parseFloat(llMatch[2]);
      }
      extracted.censusTract = attr(identTag, 'CensusTractIdentifier') || null;
    }

    // ── STRUCTURE ─────────────────────────────────────────────────────────────
    const structureTag = findTag(xmlContent, 'STRUCTURE');
    if (structureTag) {
      extracted.gla = attr(structureTag, 'GrossLivingAreaSquareFeetCount') || null;
      extracted.bedrooms = attr(structureTag, 'TotalBedroomCount') || null;
      extracted.bathrooms = attr(structureTag, 'TotalBathroomCount') || null;
      extracted.yearBuilt = attr(structureTag, 'PropertyStructureBuiltYear') || null;
      extracted.stories = attr(structureTag, 'StoriesCount') || null;
      extracted.style = attr(structureTag, '_DesignDescription') || null;
      extracted.rooms = attr(structureTag, 'TotalRoomCount') || null;
      extracted.attachmentType = attr(structureTag, 'AttachmentType') || null;
    }

    // Condition from _QUALITY
    const qualityTag = findTag(xmlContent, '_QUALITY');
    if (qualityTag) {
      extracted.condition = attr(qualityTag, 'RatingConditionType') || null;
    }

    // Site
    const siteTag = findTag(xmlContent, 'SITE');
    if (siteTag) {
      extracted.siteArea = attr(siteTag, 'SiteAreaSquareFeetCount') || null;
      extracted.siteShape = attr(siteTag, '_SiteShape') || null;
      extracted.zoning = attr(siteTag, 'PropertyZoningComplianceType') || null;
      extracted.utilities = attr(siteTag, '_UtilitiesDescription') || null;
    }

    // ── SALES COMPARISON ──────────────────────────────────────────────────────
    const salesCompTag = findTag(xmlContent, 'SALES_COMPARISON');
    if (salesCompTag) {
      extracted.indicatedValue = attr(salesCompTag, 'ValueIndicatedBySalesComparisonApproachAmount') || null;
      extracted.currentSalesComment = attr(salesCompTag, '_CurrentSalesAgreementAnalysisComment') || null;
    }

    // ── COMPARABLE SALES ──────────────────────────────────────────────────────
    const compableTags = findAllTags(xmlContent, 'COMPARABLE_SALE');
    for (const compTag of compableTags) {
      const seqId = parseInt(attr(compTag, 'PropertySequenceIdentifier') || '0', 10);
      if (seqId === 0) continue; // seq 0 = subject

      const comp = {
        sequenceId: seqId,
        salePrice: attr(compTag, 'PropertySalesAmount') || null,
        adjustedPrice: attr(compTag, 'AdjustedSalesPriceAmount') || null,
        netAdjPct: attr(compTag, 'SalePriceTotalAdjustmentNetPercent') || null,
        grossAdjPct: attr(compTag, 'SalesPriceTotalAdjustmentGrossPercent') || null,
        pricePerSqFt: attr(compTag, 'SalesPricePerGrossLivingAreaAmount') || null,
        dataSource: attr(compTag, 'DataSourceDescription') || null,
      };

      // Location sub-tag
      const locIdx = xmlContent.indexOf(compTag);
      // Find LOCATION within this COMPARABLE_SALE block
      const compBlock = xmlContent.substring(locIdx, xmlContent.indexOf('</COMPARABLE_SALE>', locIdx) + 20);
      const locTag = findTag(compBlock, 'LOCATION');
      if (locTag) {
        comp.address = attr(locTag, 'PropertyStreetAddress') || null;
        comp.cityStateZip = attr(locTag, 'PropertyStreetAddress2') || null;
        comp.proximity = attr(locTag, 'ProximityToSubjectDescription') || null;
        comp.lat = attr(locTag, 'LatitudeNumber') || null;
        comp.lng = attr(locTag, 'LongitudeNumber') || null;
      }

      // ROOM_ADJUSTMENT
      const roomAdj = findTag(compBlock, 'ROOM_ADJUSTMENT');
      if (roomAdj) {
        comp.beds = attr(roomAdj, 'TotalBedroomCount') || null;
        comp.baths = attr(roomAdj, 'TotalBathroomCount') || null;
      }

      // Key adjustments by type
      const adjTags = findAllTags(compBlock, 'SALE_PRICE_ADJUSTMENT');
      const adjMap = {};
      for (const adjTag of adjTags) {
        const type = attr(adjTag, '_Type');
        const desc = attr(adjTag, '_Description');
        const amount = attr(adjTag, '_Amount');
        if (type) {
          adjMap[type] = { desc: desc || '', amount: amount ? parseInt(amount, 10) : null };
        }
      }

      // Extract key fields from adjustments
      comp.gla = adjMap['GrossLivingArea']?.desc || null;
      comp.saleDate = adjMap['DateOfSale']?.desc || null;
      comp.location = adjMap['Location']?.desc || null;
      comp.condition = adjMap['Condition']?.desc || null;
      comp.age = adjMap['Age']?.desc || null;
      comp.siteArea = adjMap['SiteArea']?.desc || null;
      comp.garage = adjMap['CarStorage']?.desc || null;
      comp.saleConcessionsAdj = adjMap['SalesConcessions']?.amount ?? null;
      comp.dateOfSaleAdj = adjMap['DateOfSale']?.amount ?? null;
      comp.locationAdj = adjMap['Location']?.amount ?? null;
      comp.glaAdj = adjMap['GrossLivingArea']?.amount ?? null;
      comp.allAdjustments = adjMap;

      comps.push(comp);
    }

    // ── APPRAISAL_INFORMATION (value, approaches) ─────────────────────────────
    const appraisalInfoTag = findTag(xmlContent, 'APPRAISAL_INFORMATION');
    if (appraisalInfoTag) {
      extracted.estimatedValue = attr(appraisalInfoTag, 'AppraisalAmount') || null;
      extracted.effectiveDate = attr(appraisalInfoTag, 'EffectiveDate') || null;
    }

  } catch (err) {
    log.warn('xmlParser:parse-error', { error: err.message });
    extracted._parseError = err.message;
  }

  return {
    extracted,
    comps,
    narratives,
    hasPdf: !!pdfBase64,
    pdfBase64,
  };
}

/**
 * extractAndSavePdf(pdfBase64, destDir, filename)
 * Decode base64 PDF and save to disk.
 *
 * @param {string} pdfBase64  Base64-encoded PDF string (whitespace stripped)
 * @param {string} destDir    Directory to write PDF to
 * @param {string} filename   Filename (without extension)
 * @returns {string|null}     Absolute path to saved PDF, or null on error
 */
export function extractAndSavePdf(pdfBase64, destDir, filename) {
  try {
    const buf = Buffer.from(pdfBase64, 'base64');
    // Validate it's actually a PDF
    if (!buf.slice(0, 5).toString('ascii').startsWith('%PDF')) {
      log.warn('xmlParser:pdf-invalid', { filename, headerBytes: buf.slice(0, 8).toString('hex') });
      return null;
    }
    const safeDestDir = path.resolve(String(destDir || ''));
    const safeFilename = String(filename || 'document')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'document';

    fs.mkdirSync(safeDestDir, { recursive: true });

    const pdfPath = path.resolve(safeDestDir, `${safeFilename}.pdf`);
    const relative = path.relative(safeDestDir, pdfPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Resolved PDF path escaped destination directory');
    }

    fs.writeFileSync(pdfPath, buf);
    log.info('xmlParser:pdf-saved', { pdfPath, sizeBytes: buf.length });
    return pdfPath;
  } catch (err) {
    log.warn('xmlParser:pdf-save-error', { error: err.message });
    return null;
  }
}

/**
 * buildFactsFromXml(extracted, comps)
 * Map XML-extracted fields to cacc-writer facts schema.
 *
 * @param {Object} extracted
 * @param {Array}  comps
 * @returns {Object} facts
 */
export function buildFactsFromXml(extracted, comps) {
  const facts = {};

  // Subject property
  if (extracted.address || extracted.streetAddress) {
    facts.subject = facts.subject || {};
    facts.subject.address = { value: extracted.address || extracted.streetAddress, confidence: 'high' };
  }
  if (extracted.city) { facts.subject = facts.subject || {}; facts.subject.city = { value: extracted.city, confidence: 'high' }; }
  if (extracted.state) { facts.subject = facts.subject || {}; facts.subject.state = { value: extracted.state, confidence: 'high' }; }
  if (extracted.zip) { facts.subject = facts.subject || {}; facts.subject.zip = { value: extracted.zip, confidence: 'high' }; }
  if (extracted.county) { facts.subject = facts.subject || {}; facts.subject.county = { value: extracted.county, confidence: 'high' }; }
  if (extracted.lat) { facts.subject = facts.subject || {}; facts.subject.lat = { value: extracted.lat, confidence: 'high' }; }
  if (extracted.lng) { facts.subject = facts.subject || {}; facts.subject.lng = { value: extracted.lng, confidence: 'high' }; }

  // Property details
  if (extracted.gla) { facts.subject = facts.subject || {}; facts.subject.gla = { value: parseFloat(extracted.gla), confidence: 'high' }; }
  if (extracted.bedrooms) { facts.subject = facts.subject || {}; facts.subject.bedrooms = { value: parseFloat(extracted.bedrooms), confidence: 'high' }; }
  if (extracted.bathrooms) { facts.subject = facts.subject || {}; facts.subject.bathrooms = { value: parseFloat(extracted.bathrooms), confidence: 'high' }; }
  if (extracted.yearBuilt) { facts.subject = facts.subject || {}; facts.subject.yearBuilt = { value: parseInt(extracted.yearBuilt, 10), confidence: 'high' }; }
  if (extracted.stories) { facts.subject = facts.subject || {}; facts.subject.stories = { value: parseFloat(extracted.stories), confidence: 'high' }; }
  if (extracted.style) { facts.subject = facts.subject || {}; facts.subject.style = { value: extracted.style, confidence: 'high' }; }
  if (extracted.condition) { facts.subject = facts.subject || {}; facts.subject.condition = { value: extracted.condition, confidence: 'high' }; }
  if (extracted.siteArea) { facts.subject = facts.subject || {}; facts.subject.siteArea = { value: extracted.siteArea, confidence: 'high' }; }
  if (extracted.parcelId) { facts.subject = facts.subject || {}; facts.subject.parcelId = { value: extracted.parcelId, confidence: 'high' }; }
  if (extracted.rightsType) { facts.subject = facts.subject || {}; facts.subject.rightsType = { value: extracted.rightsType, confidence: 'high' }; }
  if (extracted.zoning) { facts.subject = facts.subject || {}; facts.subject.zoning = { value: extracted.zoning, confidence: 'high' }; }

  // Borrower
  if (extracted.borrowerName) {
    facts.borrower = facts.borrower || {};
    facts.borrower.name = { value: extracted.borrowerName, confidence: 'high' };
  }

  // Lender
  if (extracted.lenderName) {
    facts.lender = facts.lender || {};
    facts.lender.name = { value: extracted.lenderName, confidence: 'high' };
  }
  if (extracted.lenderAddress) {
    facts.lender = facts.lender || {};
    facts.lender.address = { value: extracted.lenderAddress, confidence: 'high' };
  }

  // Assignment
  if (extracted.formTypeCode) {
    facts.assignment = facts.assignment || {};
    facts.assignment.formType = { value: extracted.formTypeCode, confidence: 'high' };
  }
  if (extracted.signedDate) {
    facts.assignment = facts.assignment || {};
    facts.assignment.reportDate = { value: extracted.signedDate, confidence: 'high' };
  }
  if (extracted.estimatedValue) {
    facts.assignment = facts.assignment || {};
    facts.assignment.opinedValue = { value: parseInt(extracted.estimatedValue, 10), confidence: 'high' };
  }
  if (extracted.purposeType) {
    facts.assignment = facts.assignment || {};
    facts.assignment.purposeType = { value: extracted.purposeType, confidence: 'high' };
  }
  if (extracted.effectiveDate) {
    facts.assignment = facts.assignment || {};
    facts.assignment.effectiveDate = { value: extracted.effectiveDate, confidence: 'high' };
  }

  // Comps (store summary)
  if (comps.length > 0) {
    facts.comps = comps.map(c => ({
      sequenceId: c.sequenceId,
      address: c.address,
      cityStateZip: c.cityStateZip,
      salePrice: c.salePrice ? parseInt(c.salePrice, 10) : null,
      adjustedPrice: c.adjustedPrice ? parseInt(c.adjustedPrice, 10) : null,
      gla: c.gla,
      saleDate: c.saleDate,
      proximity: c.proximity,
      beds: c.beds,
      baths: c.baths,
      location: c.location,
      condition: c.condition,
      age: c.age,
      netAdjPct: c.netAdjPct,
      grossAdjPct: c.grossAdjPct,
    }));
  }

  return facts;
}
