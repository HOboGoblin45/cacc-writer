/**
 * server/api/formDataRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 1004 URAR Form Data Management
 *
 * Mounted at: /api (cacc-writer-server.js)
 *
 * Routes:
 *   GET    /cases/:caseId/form-data               — Get form data + completeness
 *   POST   /cases/:caseId/form-data               — Save form data
 *   POST   /cases/:caseId/form-data/completeness  — Check completeness only
 *   POST   /cases/:caseId/auto-populate           — AI auto-fill from facts
 */

import { Router } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { CASES_DIR } from '../utils/caseUtils.js';
import { FORM_1004_FIELDS, checkFormCompleteness, getBlankFormData } from '../config/form1004Fields.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Zod Validation Schemas ───────────────────────────────────────────────────

const paramsSchemaWithCaseId = z.object({
  caseId: z.string().min(1, 'caseId must be a non-empty string'),
});

const formDataBodySchema = z.object({}).passthrough(); // Allow any object for partial updates

const autoPopulateBodySchema = z.object({
  merge: z.boolean().optional().default(true),
}).passthrough(); // Allow additional fields

// ── Helpers ──────────────────────────────────────────────────────────────────

function caseDir(caseId) {
  return path.join(CASES_DIR, caseId);
}

function formDataPath(caseId) {
  return path.join(caseDir(caseId), 'form_data.json');
}

async function loadFormData(caseId) {
  try {
    const raw = await fs.readFile(formDataPath(caseId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return getBlankFormData();
  }
}

async function saveFormData(caseId, data) {
  const dir = caseDir(caseId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(formDataPath(caseId), JSON.stringify(data, null, 2), 'utf8');
}

async function loadFacts(caseId) {
  try {
    const p = path.join(caseDir(caseId), 'facts.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function loadCaseMeta(caseId) {
  try {
    const p = path.join(caseDir(caseId), 'case.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── GET /cases/:caseId/form-data ─────────────────────────────────────────────
router.get('/cases/:caseId/form-data', validateParams(paramsSchemaWithCaseId), async (req, res) => {
  const { caseId } = req.validatedParams;
  try {
    const formData = await loadFormData(caseId);
    const completeness = checkFormCompleteness(formData);
    res.json({ ok: true, formData, completeness });
  } catch (err) {
    log.error('form-data:get:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/form-data ────────────────────────────────────────────
router.post('/cases/:caseId/form-data', validateParams(paramsSchemaWithCaseId), validateBody(formDataBodySchema), async (req, res) => {
  const { caseId } = req.validatedParams;
  try {
    const incoming = req.validated;

    // Merge with existing to allow partial saves
    const existing = await loadFormData(caseId);
    const merged = deepMerge(existing, incoming);

    await saveFormData(caseId, merged);

    const completeness = checkFormCompleteness(merged);
    log.info('form-data:saved', { caseId, completeness: completeness.percentage });

    res.json({ ok: true, completeness, message: 'Form data saved' });
  } catch (err) {
    log.error('form-data:post:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/form-data/completeness ───────────────────────────────
router.post('/cases/:caseId/form-data/completeness', validateParams(paramsSchemaWithCaseId), async (req, res) => {
  const { caseId } = req.validatedParams;
  try {
    const formData = await loadFormData(caseId);
    const completeness = checkFormCompleteness(formData);
    res.json({ ok: true, ...completeness });
  } catch (err) {
    log.error('form-data:completeness:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/auto-populate ────────────────────────────────────────
// AI-powered: reads facts.json + case metadata, maps to form fields
router.post('/cases/:caseId/auto-populate', validateParams(paramsSchemaWithCaseId), validateBody(autoPopulateBodySchema), async (req, res) => {
  const { caseId } = req.validatedParams;
  const { merge = true } = req.validated ?? {};

  try {
    const [facts, meta, existingFormData] = await Promise.all([
      loadFacts(caseId),
      loadCaseMeta(caseId),
      loadFormData(caseId),
    ]);

    // ── Step 1: Direct mapping from facts/meta to form fields ──────────────
    const mapped = {};

    // Subject section
    mapped.subject = {
      propertyAddress:         firstOf(facts.address, facts.propertyAddress, meta.address),
      city:                    firstOf(facts.city, meta.city),
      state:                   firstOf(facts.state, meta.state),
      zipCode:                 firstOf(facts.zip, facts.zipCode, meta.zip),
      county:                  firstOf(facts.county, meta.county),
      legalDescription:        firstOf(facts.legalDescription, facts.legal_description),
      assessorsParcelNumber:   firstOf(facts.parcelNumber, facts.apn, facts.parcel),
      taxYear:                 firstOf(facts.taxYear, facts.tax_year),
      realEstateTaxes:         toNumber(firstOf(facts.annualTaxes, facts.realEstateTaxes, facts.taxes)),
      specialAssessments:      toNumber(firstOf(facts.specialAssessments)),
      borrowerName:            firstOf(facts.borrower, facts.borrowerName, meta.borrower),
      ownerOfPublicRecord:     firstOf(facts.owner, facts.ownerOfRecord),
      occupant:                normalizeOccupant(firstOf(facts.occupancy, facts.occupant)),
      propertyRightsAppraised: firstOf(facts.propertyRights, facts.rights) || 'Fee Simple',
      assignmentType:          normalizeAssignmentType(firstOf(facts.assignmentType, facts.loanType, meta.loanPurpose)),
      lenderClient:            firstOf(facts.lender, facts.lenderName, meta.lender),
      lenderAddress:           firstOf(facts.lenderAddress, facts.lender_address),
      appraisalFileNumber:     firstOf(facts.fileNumber, facts.fileNo, meta.fileNumber, meta.caseId),
    };

    // Contract section
    mapped.contract = {
      contractPrice:                 toNumber(firstOf(facts.contractPrice, facts.purchasePrice, facts.salePrice)),
      contractDate:                  firstOf(facts.contractDate, facts.contract_date),
      isPropertySellerOwnerOfRecord: facts.sellerIsOwner !== undefined ? toBool(facts.sellerIsOwner) : null,
      sellerConcessions:             firstOf(facts.sellerConcessions, facts.concessions),
      dataSource:                    firstOf(facts.dataSource, facts.mls),
      personalProperty:              firstOf(facts.personalProperty),
    };

    // Neighborhood section
    mapped.neighborhood = {
      builtUp:              normalizeBuiltUp(facts.builtUp),
      growth:               normalizeGrowth(facts.growth, facts.marketTrend),
      propertyValues:       normalizePropertyValues(facts.propertyValues, facts.trend),
      demandSupply:         normalizeDemandSupply(facts.demandSupply, facts.supply),
      marketingTime:        normalizeMarketingTime(facts.marketingTime, facts.dom, facts.averageDom),
      predominantOccupancy: normalizeOccupant(firstOf(facts.predominantOccupancy, facts.neighborhoodOccupancy)) || 'Owner',
      singleFamilyPriceRange_Low:  toNumber(firstOf(facts.priceRangeLow, facts.minPrice)),
      singleFamilyPriceRange_High: toNumber(firstOf(facts.priceRangeHigh, facts.maxPrice)),
      singleFamilyPredominant:     toNumber(firstOf(facts.predominantPrice, facts.medianPrice)),
      singleFamilyAgeRange_Low:    toNumber(firstOf(facts.ageRangeLow, facts.minAge)),
      singleFamilyAgeRange_High:   toNumber(firstOf(facts.ageRangeHigh, facts.maxAge)),
      singleFamilyPredominantAge:  toNumber(firstOf(facts.predominantAge, facts.medianAge)),
      landUseOneFamily:    toNumber(firstOf(facts.landUseOneFamily, facts.oneFamily)),
      landUseTwoToFour:    toNumber(firstOf(facts.landUseTwoToFour)),
      landUseMultiFamily:  toNumber(firstOf(facts.landUseMultiFamily)),
      landUseCommercial:   toNumber(firstOf(facts.landUseCommercial)),
      landUseOther:        toNumber(firstOf(facts.landUseOther)),
      changeInLandUse:     firstOf(facts.changeInLandUse) || 'Not Likely',
    };

    // Site section
    mapped.site = {
      lotDimensions:              firstOf(facts.lotDimensions, facts.dimensions),
      lotArea:                    firstOf(facts.lotSize, facts.lotArea, facts.siteArea),
      shape:                      firstOf(facts.lotShape, facts.shape),
      view:                       firstOf(facts.view, facts.viewDescription),
      zoningClassification:       firstOf(facts.zoning, facts.zoningClass),
      zoningDescription:          firstOf(facts.zoningDescription),
      zoningCompliance:           normalizeZoningCompliance(firstOf(facts.zoningCompliance)),
      highestAndBestUseAsImproved:firstOf(facts.hbu, facts.highestBestUse) || 'Present use',
      utilities_electric:         normalizeUtility(firstOf(facts.electric, facts.utilities_electric)) || 'Public',
      utilities_gas:              normalizeUtility(firstOf(facts.gas, facts.utilities_gas)),
      utilities_water:            normalizeUtility(firstOf(facts.water, facts.utilities_water)) || 'Public',
      utilities_sewer:            normalizeUtility(firstOf(facts.sewer, facts.utilities_sewer)) || 'Public',
      offSiteImprovements_street: firstOf(facts.streetType) || 'Public',
      offSiteImprovements_surface:firstOf(facts.streetSurface, facts.paving),
      offSiteImprovements_alley:  firstOf(facts.alley) || 'None',
      isInFloodHazardArea:        toBoolNullable(firstOf(facts.floodHazard, facts.floodZone)),
      femaFloodZone:              firstOf(facts.floodZone, facts.femaFloodZone),
      femaMapNumber:              firstOf(facts.femaMapNumber, facts.floodMapNo),
      femaMapDate:                firstOf(facts.femaMapDate, facts.floodMapDate),
      isPUD:                      toBoolNullable(firstOf(facts.isPUD, facts.pud)),
      isHOA:                      toBoolNullable(firstOf(facts.hasHOA, facts.hoa)),
      hoaDues:                    toNumber(firstOf(facts.hoaDues, facts.hoa_dues)),
    };

    // Improvements section
    mapped.improvements = {
      generalDescription_units:            firstOf(facts.units) || 'One',
      generalDescription_stories:          toNumber(firstOf(facts.stories, facts.numStories)),
      generalDescription_design:           firstOf(facts.style, facts.design, facts.archStyle),
      generalDescription_existingProposed: normalizeExistingProposed(firstOf(facts.existingProposed, facts.status)),
      yearBuilt:                           toNumber(firstOf(facts.yearBuilt, facts.year_built)),
      effectiveAge:                        toNumber(firstOf(facts.effectiveAge, facts.effective_age)),
      foundationType:                      normalizeFoundation(facts),
      basementArea:                        toNumber(firstOf(facts.basementArea, facts.basement_sqft)),
      basementFinishPercent:               toNumber(firstOf(facts.basementFinish, facts.basement_finish_pct)),
      exteriorWalls:                       firstOf(facts.exteriorWalls, facts.exterior, facts.siding),
      roofSurface:                         firstOf(facts.roofSurface, facts.roofMaterial, facts.roof),
      heating_type:                        firstOf(facts.heatingType, facts.heating),
      heating_fuel:                        firstOf(facts.heatingFuel, facts.fuel),
      cooling_type:                        firstOf(facts.coolingType, facts.cooling, facts.ac),
      roomCount:                           toNumber(firstOf(facts.totalRooms, facts.roomCount, facts.rooms)),
      bedroomCount:                        toNumber(firstOf(facts.bedrooms, facts.bedroomCount, facts.beds)),
      bathroomCount:                       toNumber(firstOf(facts.bathrooms, facts.bathroomCount, facts.baths)),
      grossLivingArea:                     toNumber(firstOf(facts.gla, facts.grossLivingArea, facts.sqft, facts.squareFeet)),
      amenities_fireplace:                 firstOf(facts.fireplaces, facts.fireplace),
      amenities_pool:                      firstOf(facts.pool),
      amenities_porch:                     firstOf(facts.porch),
      amenities_patioDeck:                 firstOf(facts.patioDeck, facts.deck, facts.patio),
      amenities_fence:                     firstOf(facts.fence),
      carStorage:                          normalizeCarStorage(facts),
      carStorageCount:                     toNumber(firstOf(facts.garageSpaces, facts.carport, facts.carStorageCount)),
      appliances:                          normalizeAppliances(facts),
      conditionOverall:                    normalizeCondition(firstOf(facts.condition, facts.overallCondition)),
      qualityOverall:                      normalizeQuality(firstOf(facts.quality, facts.qualityRating)),
    };

    // Reconciliation
    mapped.reconciliation = {
      indicatedValueBySalesComparison: toNumber(firstOf(facts.indicatedValue, facts.salesCompValue)),
      finalOpinionOfValue:             toNumber(firstOf(facts.marketValue, facts.opinionOfValue, facts.value)),
      effectiveDate:                   firstOf(facts.effectiveDate, facts.inspectionDate, meta.inspectionDate),
      appraisalDate:                   firstOf(facts.appraisalDate, facts.reportDate),
    };

    // Appraiser
    mapped.appraiser = {
      appraiserName:          firstOf(facts.appraiserName, meta.appraiserName),
      appraiserLicenseNumber: firstOf(facts.appraiserLicense, meta.appraiserLicense),
      appraiserLicenseState:  firstOf(facts.appraiserLicenseState, meta.appraiserLicenseState, mapped.subject.state),
      inspectionDate:         firstOf(facts.inspectionDate, meta.inspectionDate),
      didInspectInterior:     true,
      didInspectExterior:     true,
    };

    // ── Step 2: AI inference for fields that need reasoning ─────────────────
    const aiPopulated = {};
    const fieldsNeedingAI = identifyAIFields(mapped, facts);

    if (fieldsNeedingAI.length > 0) {
      try {
        const aiResult = await aiInferFields(facts, meta, fieldsNeedingAI);
        Object.assign(aiPopulated, aiResult);

        // Merge AI results into mapped data
        for (const [section, fields] of Object.entries(aiResult)) {
          if (!mapped[section]) mapped[section] = {};
          for (const [field, value] of Object.entries(fields)) {
            if (mapped[section][field] === null || mapped[section][field] === undefined) {
              mapped[section][field] = value;
            }
          }
        }
      } catch (aiErr) {
        log.warn('form-data:auto-populate:ai-inference-failed', { caseId, error: aiErr.message });
        // Continue without AI — direct mapping is still useful
      }
    }

    // ── Step 3: Strip nulls for a clean result ──────────────────────────────
    const populated = stripNulls(mapped);

    // ── Step 4: Merge with existing or replace ──────────────────────────────
    const finalData = merge
      ? deepMergePreferNew(existingFormData, populated)
      : populated;

    await saveFormData(caseId, finalData);

    const completeness = checkFormCompleteness(finalData);
    const autoFilledCount = countNonNull(populated);

    log.info('form-data:auto-populated', {
      caseId,
      autoFilledCount,
      completeness: completeness.percentage,
      aiFieldsInferred: fieldsNeedingAI.length,
    });

    res.json({
      ok: true,
      formData: finalData,
      completeness,
      autoFilled: {
        count: autoFilledCount,
        aiInferred: Object.keys(aiPopulated).length > 0 ? aiPopulated : null,
      },
    });
  } catch (err) {
    log.error('form-data:auto-populate:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── AI inference helper ───────────────────────────────────────────────────────

function identifyAIFields(mapped, facts) {
  const needed = [];

  if (!mapped.neighborhood?.builtUp && facts.neighborhoodDescription) {
    needed.push({ section: 'neighborhood', field: 'builtUp', hint: 'Infer from neighborhood description' });
  }
  if (!mapped.neighborhood?.growth && (facts.neighborhoodDescription || facts.marketConditions)) {
    needed.push({ section: 'neighborhood', field: 'growth', hint: 'Infer from market data' });
  }
  if (!mapped.neighborhood?.propertyValues && (facts.trend || facts.marketConditions)) {
    needed.push({ section: 'neighborhood', field: 'propertyValues', hint: 'Infer from trend data' });
  }
  if (!mapped.site?.view && (facts.description || facts.neighborhoodDescription)) {
    needed.push({ section: 'site', field: 'view', hint: 'Infer typical view from neighborhood' });
  }
  if (!mapped.improvements?.conditionOverall && facts.condition) {
    needed.push({ section: 'improvements', field: 'conditionOverall', hint: 'Map condition text to C1-C6' });
  }

  return needed;
}

async function aiInferFields(facts, meta, fieldsToInfer) {
  const prompt = `You are a real estate appraisal assistant. Based on the property facts below, infer the missing form field values for a 1004 URAR appraisal form.

Property Facts:
${JSON.stringify(facts, null, 2)}

Case Meta:
${JSON.stringify(meta, null, 2)}

Fields to infer (return ONLY these fields):
${fieldsToInfer.map(f => `- ${f.section}.${f.field} (${f.hint})`).join('\n')}

Return a JSON object with section keys and field values. Use the exact option values from the URAR form:
- builtUp: "Over 75%" | "25-75%" | "Under 25%"
- growth: "Rapid" | "Stable" | "Slow"
- propertyValues: "Increasing" | "Stable" | "Declining"
- demandSupply: "Shortage" | "In Balance" | "Over Supply"
- marketingTime: "Under 3 Months" | "3-6 Months" | "Over 6 Months"
- conditionOverall: "C1" | "C2" | "C3" | "C4" | "C5" | "C6"
- view: short description like "Residential", "Golf Course", "Water", "Wooded", etc.

Return ONLY valid JSON, no explanation.`;

  const response = await callAI([
    { role: 'system', content: 'You are a real estate appraisal AI. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.2, maxTokens: 500 });

  // Parse AI response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function firstOf(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

function toBool(v) {
  if (v === true || v === 1 || String(v).toLowerCase() === 'yes') return true;
  if (v === false || v === 0 || String(v).toLowerCase() === 'no') return false;
  return null;
}

function toBoolNullable(v) {
  if (v === null || v === undefined || v === '') return null;
  return toBool(v);
}

function normalizeOccupant(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('owner')) return 'Owner';
  if (s.includes('tenant') || s.includes('renter')) return 'Tenant';
  if (s.includes('vacant')) return 'Vacant';
  return null;
}

function normalizeAssignmentType(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('purchase') || s.includes('buy')) return 'Purchase Transaction';
  if (s.includes('refi') || s.includes('refinance')) return 'Refinance Transaction';
  return null;
}

function normalizeBuiltUp(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('over') || s.includes('>75') || s.includes('75+')) return 'Over 75%';
  if (s.includes('under') || s.includes('<25') || s.includes('25%')) return 'Under 25%';
  if (s.includes('25') || s.includes('75')) return '25-75%';
  return null;
}

function normalizeGrowth(growth, marketTrend) {
  const v = firstOf(growth, marketTrend);
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('rapid') || s.includes('fast') || s.includes('strong')) return 'Rapid';
  if (s.includes('slow') || s.includes('declin')) return 'Slow';
  if (s.includes('stable') || s.includes('moderate')) return 'Stable';
  return 'Stable';
}

function normalizePropertyValues(propertyValues, trend) {
  const v = firstOf(propertyValues, trend);
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('increas') || s.includes('appreciat') || s.includes('rising')) return 'Increasing';
  if (s.includes('declin') || s.includes('depreciat') || s.includes('fall')) return 'Declining';
  return 'Stable';
}

function normalizeDemandSupply(demandSupply, supply) {
  const v = firstOf(demandSupply, supply);
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('short') || s.includes('under') || s.includes('low')) return 'Shortage';
  if (s.includes('over') || s.includes('excess')) return 'Over Supply';
  return 'In Balance';
}

function normalizeMarketingTime(marketingTime, dom, avgDom) {
  // Try DOM (days on market) first
  const domVal = toNumber(firstOf(dom, avgDom));
  if (domVal !== null) {
    if (domVal < 90) return 'Under 3 Months';
    if (domVal <= 180) return '3-6 Months';
    return 'Over 6 Months';
  }
  const v = firstOf(marketingTime);
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('under 3') || s.includes('< 3') || s.includes('1 month') || s.includes('2 month')) return 'Under 3 Months';
  if (s.includes('over 6') || s.includes('> 6') || s.includes('6+')) return 'Over 6 Months';
  return '3-6 Months';
}

function normalizeZoningCompliance(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('nonconform') || s.includes('non-conform') || s.includes('legal non')) return 'Legal Nonconforming';
  if (s.includes('no zoning') || s.includes('unzoned')) return 'No Zoning';
  if (s.includes('illegal')) return 'Illegal';
  if (s.includes('legal')) return 'Legal';
  return null;
}

function normalizeUtility(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('public')) return 'Public';
  if (s.includes('private') || s.includes('well') || s.includes('septic')) return 'Private';
  if (s.includes('other')) return 'Other';
  return null;
}

function normalizeFoundation(facts) {
  const types = [];
  const v = String(firstOf(facts.foundation, facts.foundationType, '') || '').toLowerCase();
  if (v.includes('slab') || v.includes('concrete slab')) types.push('Concrete Slab');
  if (v.includes('crawl')) types.push('Crawl Space');
  if (v.includes('full basement') || v.includes('full')) types.push('Full Basement');
  if (v.includes('partial')) types.push('Partial Basement');
  return types.length > 0 ? types : null;
}

function normalizeCarStorage(facts) {
  const types = [];
  const v = String(firstOf(facts.garage, facts.carStorage, facts.parking, '') || '').toLowerCase();
  if (v.includes('none') || v.includes('no garage')) return ['None'];
  if (v.includes('garage')) types.push('Garage');
  if (v.includes('carport')) types.push('Carport');
  if (v.includes('driveway')) types.push('Driveway');
  if (v.includes('attach') || v.includes('att')) types.push('Att.');
  if (v.includes('detach') || v.includes('det')) types.push('Det.');
  if (v.includes('built')) types.push('Built-in');
  if (facts.garageAttached === true || facts.garageAttached === 'yes') {
    if (!types.includes('Garage')) types.push('Garage');
    if (!types.includes('Att.')) types.push('Att.');
  }
  return types.length > 0 ? types : null;
}

function normalizeAppliances(facts) {
  const appliances = [];
  const v = String(firstOf(facts.appliances, '') || '').toLowerCase();
  if (v.includes('refrigerator') || v.includes('fridge') || facts.hasRefrigerator) appliances.push('Refrigerator');
  if (v.includes('range') || v.includes('oven') || facts.hasRange) appliances.push('Range/Oven');
  if (v.includes('dishwasher') || facts.hasDishwasher) appliances.push('Dishwasher');
  if (v.includes('disposal') || facts.hasDisposal) appliances.push('Disposal');
  if (v.includes('microwave') || facts.hasMicrowave) appliances.push('Microwave');
  if (v.includes('washer') || v.includes('dryer') || facts.hasWasherDryer) appliances.push('Washer/Dryer');
  return appliances.length > 0 ? appliances : null;
}

function normalizeExistingProposed(v) {
  if (!v) return 'Existing';
  const s = String(v).toLowerCase();
  if (s.includes('under') || s.includes('construction')) return 'Under Construction';
  if (s.includes('proposed') || s.includes('new')) return 'Proposed';
  return 'Existing';
}

function normalizeCondition(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  // Direct C-rating
  if (/^c[1-6]$/i.test(s.trim())) return s.trim().toUpperCase();
  // Text descriptions
  if (s.includes('excel') || s.includes('new') || s.includes('like new')) return 'C1';
  if (s.includes('very good') || s.includes('updated')) return 'C2';
  if (s.includes('good') || s.includes('average')) return 'C3';
  if (s.includes('fair') || s.includes('below avg') || s.includes('defered')) return 'C4';
  if (s.includes('poor') || s.includes('bad') || s.includes('deteriorat')) return 'C5';
  if (s.includes('very poor') || s.includes('neglect') || s.includes('abandon')) return 'C6';
  return 'C3'; // Default to average
}

function normalizeQuality(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  // Direct Q-rating
  if (/^q[1-6]$/i.test(s.trim())) return s.trim().toUpperCase();
  // Text descriptions
  if (s.includes('luxury') || s.includes('exceptional') || s.includes('custom')) return 'Q1';
  if (s.includes('superior') || s.includes('high-end') || s.includes('high end')) return 'Q2';
  if (s.includes('good') || s.includes('above avg') || s.includes('above average')) return 'Q3';
  if (s.includes('average') || s.includes('standard') || s.includes('typical')) return 'Q4';
  if (s.includes('fair') || s.includes('below avg') || s.includes('economy')) return 'Q5';
  if (s.includes('poor') || s.includes('minimum') || s.includes('minimal')) return 'Q6';
  return 'Q4'; // Default to average
}

// ── Deep merge helpers ────────────────────────────────────────────────────────

function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(target[key] || {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Like deepMerge but source (new) wins for non-null values
function deepMergePreferNew(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMergePreferNew(target[key] || {}, value);
    } else if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function stripNulls(obj) {
  if (Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const sub = stripNulls(value);
      if (Object.keys(sub).length > 0) result[key] = sub;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function countNonNull(obj, depth = 0) {
  if (depth > 3) return 0;
  let count = 0;
  for (const value of Object.values(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      count += countNonNull(value, depth + 1);
    } else {
      count++;
    }
  }
  return count;
}

export default router;
