/**
 * server/export/uad36ExportService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * UAD 3.6 / MISMO 3.6 Export Service
 *
 * Generates MISMO 3.6-compliant XML for the new Uniform Residential Appraisal
 * Report (URAR) that replaces the old 1004/1025/1073 forms.
 *
 * Key differences from UAD 2.6:
 *   - Single dynamic URAR replaces all form types
 *   - MISMO 3.6 Reference Model namespace
 *   - ZIP delivery (XML + PDF + photos)
 *   - Structured data fields replace most free-form narratives
 *   - C&Q ratings with updated definitions
 *   - Green/energy features, disaster mitigation sections
 *   - Compliance API validation before submission
 *
 * Mandatory date: November 2, 2026
 * UAD 2.6 retirement: May 2027
 */

import { randomUUID } from 'crypto';
import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';

const MISMO_36_NAMESPACE = 'http://www.mismo.org/residential/2009/schemas/36';
const GSE_EXTENSION_NAMESPACE = 'http://www.fanniemae.com/loandelivery/2026/schemas';

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function el(tag, value, attrs = {}) {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  if (value == null || value === '') return `<${tag}${attrStr}/>`;
  return `<${tag}${attrStr}>${escapeXml(value)}</${tag}>`;
}

function pad(depth) { return ' '.repeat(depth); }

// ── UAD 3.6 Condition & Quality Ratings ──────────────────────────────────────

export const CQ_RATINGS_36 = {
  condition: {
    C1: 'New construction or complete renovation with no deferred maintenance',
    C2: 'No updates or deferred maintenance; all short-lived components recently updated',
    C3: 'Well-maintained; limited deferred maintenance and few minor repairs needed',
    C4: 'Adequately maintained; some deferred maintenance and minor repairs needed',
    C5: 'Not well maintained; significant deferred maintenance and repairs needed',
    C6: 'Not habitable or structurally unsound',
  },
  quality: {
    Q1: 'High-quality materials and finishes throughout; custom design and craftsmanship',
    Q2: 'High-quality materials in most areas; some custom work with quality finishes',
    Q3: 'Quality materials and finishes; well-designed and constructed',
    Q4: 'Adequate materials and finishes; competent construction and design',
    Q5: 'Economy materials and finishes; basic design',
    Q6: 'Basic quality throughout; minimal design effort',
  },
};

// ── UAD 3.6 Field Mapping ────────────────────────────────────────────────────

export function getUad36FieldMapping() {
  return {
    subject: {
      'subject.address':        'PROPERTY/LOCATION/ADDRESS/AddressLineText',
      'subject.unit':           'PROPERTY/LOCATION/ADDRESS/AddressUnitIdentifier',
      'subject.city':           'PROPERTY/LOCATION/ADDRESS/CityName',
      'subject.state':          'PROPERTY/LOCATION/ADDRESS/StateCode',
      'subject.zip':            'PROPERTY/LOCATION/ADDRESS/PostalCode',
      'subject.county':         'PROPERTY/LOCATION/ADDRESS/CountyName',
      'subject.latitude':       'PROPERTY/LOCATION/GeoCoordinate/LatitudeDegreeValue',
      'subject.longitude':      'PROPERTY/LOCATION/GeoCoordinate/LongitudeDegreeValue',
      'subject.legalDescription':'PROPERTY/IDENTIFIERS/LegalDescriptionTextDescription',
      'subject.taxParcelId':    'PROPERTY/IDENTIFIERS/ParcelIdentifier',
      'subject.censusTract':    'PROPERTY/IDENTIFIERS/CensusInformation/CensusTractIdentifier',
    },
    structure: {
      'improvements.yearBuilt':     'PROPERTY/STRUCTURE/GENERAL/YearBuiltDate',
      'improvements.effectiveAge':  'PROPERTY/STRUCTURE/GENERAL/EffectiveAgeYears',
      'improvements.gla':           'PROPERTY/STRUCTURE/AREAS/GrossLivingAreaSquareFeet',
      'improvements.totalRooms':    'PROPERTY/STRUCTURE/ROOMS/TotalRoomCount',
      'improvements.bedrooms':      'PROPERTY/STRUCTURE/ROOMS/BedroomCount',
      'improvements.bathFull':      'PROPERTY/STRUCTURE/ROOMS/BathroomFullCount',
      'improvements.bathHalf':      'PROPERTY/STRUCTURE/ROOMS/BathroomHalfCount',
      'improvements.stories':       'PROPERTY/STRUCTURE/GENERAL/StoriesCount',
      'improvements.design':        'PROPERTY/STRUCTURE/GENERAL/ArchitecturalDesignType',
      'improvements.construction':  'PROPERTY/STRUCTURE/GENERAL/ConstructionMethodType',
      'improvements.foundation':    'PROPERTY/STRUCTURE/FOUNDATION/FoundationType',
      'improvements.basementArea':  'PROPERTY/STRUCTURE/BASEMENT/TotalAreaSquareFeet',
      'improvements.basementFinished':'PROPERTY/STRUCTURE/BASEMENT/FinishedAreaSquareFeet',
      'improvements.exteriorWalls': 'PROPERTY/STRUCTURE/EXTERIOR/ExteriorWallMaterialType',
      'improvements.roofSurface':   'PROPERTY/STRUCTURE/EXTERIOR/RoofCoveringMaterialType',
      'improvements.roofShape':     'PROPERTY/STRUCTURE/EXTERIOR/RoofShapeType',
      'improvements.heating':       'PROPERTY/STRUCTURE/MECHANICAL/HeatingSystemType',
      'improvements.cooling':       'PROPERTY/STRUCTURE/MECHANICAL/CoolingSystemType',
      'improvements.garageType':    'PROPERTY/STRUCTURE/PARKING/ParkingType',
      'improvements.garageCars':    'PROPERTY/STRUCTURE/PARKING/ParkingSpaceCount',
    },
    conditionQuality: {
      'improvements.conditionExterior':  'PROPERTY/RATINGS/ExteriorConditionRating',
      'improvements.conditionInterior':  'PROPERTY/RATINGS/InteriorConditionRating',
      'improvements.conditionOverall':   'PROPERTY/RATINGS/OverallConditionRating',
      'improvements.qualityExterior':    'PROPERTY/RATINGS/ExteriorQualityRating',
      'improvements.qualityInterior':    'PROPERTY/RATINGS/InteriorQualityRating',
      'improvements.qualityOverall':     'PROPERTY/RATINGS/OverallQualityRating',
    },
    site: {
      'site.area':              'PROPERTY/SITE/LotSizeSquareFeet',
      'site.acres':             'PROPERTY/SITE/LotSizeAcres',
      'site.zoning':            'PROPERTY/SITE/ZoningClassificationType',
      'site.zoningDescription': 'PROPERTY/SITE/ZoningDescription',
      'site.view':              'PROPERTY/SITE/ViewType',
      'site.viewDescription':   'PROPERTY/SITE/ViewDescription',
      'site.topography':        'PROPERTY/SITE/TopographyType',
      'site.floodZone':         'PROPERTY/SITE/FloodZoneIdentifier',
      'site.femaMapNumber':     'PROPERTY/SITE/FEMAMapPanelIdentifier',
      'site.femaMapDate':       'PROPERTY/SITE/FEMAMapEffectiveDate',
      'site.utilities':         'PROPERTY/SITE/UtilitiesDescription',
    },
    greenFeatures: {
      'green.solarPanels':       'PROPERTY/GREEN_FEATURES/SolarPanelIndicator',
      'green.solarOwnership':    'PROPERTY/GREEN_FEATURES/SolarPanelOwnershipType',
      'green.energyRating':      'PROPERTY/GREEN_FEATURES/EnergyEfficiencyRatingType',
      'green.energyScore':       'PROPERTY/GREEN_FEATURES/EnergyEfficiencyScore',
      'green.insulationQuality': 'PROPERTY/GREEN_FEATURES/InsulationQualityType',
      'green.windowPerformance': 'PROPERTY/GREEN_FEATURES/WindowPerformanceType',
    },
    disasterMitigation: {
      'disaster.mitigationType':  'PROPERTY/DISASTER_MITIGATION/MitigationType',
      'disaster.description':     'PROPERTY/DISASTER_MITIGATION/MitigationDescription',
    },
    assignment: {
      'assignment.type':          'APPRAISAL/ASSIGNMENT/AssignmentType',
      'assignment.purpose':       'APPRAISAL/ASSIGNMENT/AppraisalPurposeType',
      'assignment.intendedUse':   'APPRAISAL/ASSIGNMENT/IntendedUseType',
      'assignment.propertyRightsAppraised': 'APPRAISAL/ASSIGNMENT/PropertyRightsAppraisedType',
      'assignment.effectiveDate': 'APPRAISAL/ASSIGNMENT/EffectiveDate',
      'assignment.reportDate':    'APPRAISAL/ASSIGNMENT/ReportDate',
    },
    neighborhood: {
      'neighborhood.name':       'PROPERTY/NEIGHBORHOOD/NeighborhoodName',
      'neighborhood.builtUp':    'PROPERTY/NEIGHBORHOOD/BuiltUpType',
      'neighborhood.growth':     'PROPERTY/NEIGHBORHOOD/GrowthType',
      'neighborhood.propertyValues': 'PROPERTY/NEIGHBORHOOD/PropertyValueTrendType',
      'neighborhood.demand':     'PROPERTY/NEIGHBORHOOD/DemandSupplyType',
      'neighborhood.marketing':  'PROPERTY/NEIGHBORHOOD/MarketingTimeType',
      'neighborhood.landUse':    'PROPERTY/NEIGHBORHOOD/PredominantLandUseType',
    },
  };
}

// ── Build UAD 3.6 XML ────────────────────────────────────────────────────────

/**
 * Build a MISMO 3.6 / UAD 3.6 compliant XML document.
 * 
 * @param {Object} caseData — loaded case data
 * @param {Object} [options]
 * @returns {string} XML string
 */
export function buildUad36Document(caseData, options = {}) {
  const { facts, comps, adjustments, reconciliation, sections, caseRecord } = caseData;
  const subject = facts.subject || {};
  const improvements = facts.improvements || {};
  const site = facts.site || {};
  const appraiser = facts.appraiser || {};
  const assignment = facts.assignment || {};

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<MESSAGE xmlns="${MISMO_36_NAMESPACE}" xmlns:gse="${GSE_EXTENSION_NAMESPACE}">`);
  lines.push('  <ABOUT_VERSIONS>');
  lines.push(`    ${el('AboutVersionIdentifier', '3.6')}`);
  lines.push(`    ${el('DataVersionIdentifier', 'UAD 3.6')}`);
  lines.push('  </ABOUT_VERSIONS>');

  lines.push('  <DEAL_SETS>');
  lines.push('    <DEAL_SET>');
  lines.push('      <DEALS>');
  lines.push('        <DEAL>');

  // ── Collaterals ──
  lines.push('          <COLLATERALS>');
  lines.push('            <COLLATERAL>');
  lines.push('              <SUBJECT_PROPERTY>');

  // Location / Address
  lines.push('                <LOCATION>');
  lines.push('                  <ADDRESS>');
  lines.push(`                    ${el('AddressLineText', subject.address || subject.streetAddress || '')}`);
  if (subject.unit) lines.push(`                    ${el('AddressUnitIdentifier', subject.unit)}`);
  lines.push(`                    ${el('CityName', subject.city || '')}`);
  lines.push(`                    ${el('StateCode', subject.state || '')}`);
  lines.push(`                    ${el('PostalCode', subject.zip || subject.zipCode || '')}`);
  lines.push(`                    ${el('CountyName', subject.county || '')}`);
  lines.push('                  </ADDRESS>');
  if (subject.latitude && subject.longitude) {
    lines.push('                  <GeoCoordinate>');
    lines.push(`                    ${el('LatitudeDegreeValue', subject.latitude)}`);
    lines.push(`                    ${el('LongitudeDegreeValue', subject.longitude)}`);
    lines.push('                  </GeoCoordinate>');
  }
  lines.push('                </LOCATION>');

  // Identifiers
  lines.push('                <IDENTIFIERS>');
  if (subject.legalDescription) lines.push(`                  ${el('LegalDescriptionTextDescription', subject.legalDescription)}`);
  if (subject.taxParcelId) lines.push(`                  ${el('ParcelIdentifier', subject.taxParcelId)}`);
  if (subject.censusTract) {
    lines.push('                  <CensusInformation>');
    lines.push(`                    ${el('CensusTractIdentifier', subject.censusTract)}`);
    lines.push('                  </CensusInformation>');
  }
  lines.push('                </IDENTIFIERS>');

  // Structure
  lines.push('                <STRUCTURE>');
  lines.push('                  <GENERAL>');
  if (improvements.yearBuilt) lines.push(`                    ${el('YearBuiltDate', improvements.yearBuilt)}`);
  if (improvements.effectiveAge) lines.push(`                    ${el('EffectiveAgeYears', improvements.effectiveAge)}`);
  if (improvements.stories) lines.push(`                    ${el('StoriesCount', improvements.stories)}`);
  if (improvements.design) lines.push(`                    ${el('ArchitecturalDesignType', improvements.design)}`);
  if (improvements.construction) lines.push(`                    ${el('ConstructionMethodType', improvements.construction || 'SiteBuilt')}`);
  lines.push('                  </GENERAL>');

  lines.push('                  <AREAS>');
  if (improvements.gla) lines.push(`                    ${el('GrossLivingAreaSquareFeet', improvements.gla)}`);
  lines.push('                  </AREAS>');

  lines.push('                  <ROOMS>');
  if (improvements.totalRooms) lines.push(`                    ${el('TotalRoomCount', improvements.totalRooms)}`);
  if (improvements.bedrooms) lines.push(`                    ${el('BedroomCount', improvements.bedrooms)}`);
  if (improvements.bathFull || improvements.bathrooms) lines.push(`                    ${el('BathroomFullCount', improvements.bathFull || improvements.bathrooms)}`);
  if (improvements.bathHalf) lines.push(`                    ${el('BathroomHalfCount', improvements.bathHalf)}`);
  lines.push('                  </ROOMS>');

  // Foundation
  if (improvements.foundation) {
    lines.push('                  <FOUNDATION>');
    lines.push(`                    ${el('FoundationType', improvements.foundation)}`);
    lines.push('                  </FOUNDATION>');
  }

  // Basement
  if (improvements.basementArea) {
    lines.push('                  <BASEMENT>');
    lines.push(`                    ${el('TotalAreaSquareFeet', improvements.basementArea)}`);
    if (improvements.basementFinished) lines.push(`                    ${el('FinishedAreaSquareFeet', improvements.basementFinished)}`);
    lines.push('                  </BASEMENT>');
  }

  // Exterior
  lines.push('                  <EXTERIOR>');
  if (improvements.exteriorWalls) lines.push(`                    ${el('ExteriorWallMaterialType', improvements.exteriorWalls)}`);
  if (improvements.roofSurface) lines.push(`                    ${el('RoofCoveringMaterialType', improvements.roofSurface)}`);
  lines.push('                  </EXTERIOR>');

  // Mechanical
  lines.push('                  <MECHANICAL>');
  if (improvements.heating) lines.push(`                    ${el('HeatingSystemType', improvements.heating)}`);
  if (improvements.cooling) lines.push(`                    ${el('CoolingSystemType', improvements.cooling)}`);
  lines.push('                  </MECHANICAL>');

  // Parking
  if (improvements.garageType || improvements.garageCars) {
    lines.push('                  <PARKING>');
    if (improvements.garageType) lines.push(`                    ${el('ParkingType', improvements.garageType)}`);
    if (improvements.garageCars) lines.push(`                    ${el('ParkingSpaceCount', improvements.garageCars)}`);
    lines.push('                  </PARKING>');
  }

  lines.push('                </STRUCTURE>');

  // Ratings (C&Q with UAD 3.6 expanded definitions)
  lines.push('                <RATINGS>');
  const condOverall = improvements.condition || improvements.conditionOverall || '';
  const qualOverall = improvements.quality || improvements.qualityOverall || '';
  if (condOverall) {
    lines.push(`                  ${el('OverallConditionRating', condOverall)}`);
    const condDesc = CQ_RATINGS_36.condition[condOverall];
    if (condDesc) lines.push(`                  ${el('OverallConditionRatingDescription', condDesc)}`);
  }
  if (improvements.conditionExterior) {
    lines.push(`                  ${el('ExteriorConditionRating', improvements.conditionExterior)}`);
    const desc = CQ_RATINGS_36.condition[improvements.conditionExterior];
    if (desc) lines.push(`                  ${el('ExteriorConditionRatingDescription', desc)}`);
  }
  if (improvements.conditionInterior) {
    lines.push(`                  ${el('InteriorConditionRating', improvements.conditionInterior)}`);
    const desc = CQ_RATINGS_36.condition[improvements.conditionInterior];
    if (desc) lines.push(`                  ${el('InteriorConditionRatingDescription', desc)}`);
  }
  if (qualOverall) {
    lines.push(`                  ${el('OverallQualityRating', qualOverall)}`);
    const qualDesc = CQ_RATINGS_36.quality[qualOverall];
    if (qualDesc) lines.push(`                  ${el('OverallQualityRatingDescription', qualDesc)}`);
  }
  if (improvements.qualityExterior) {
    lines.push(`                  ${el('ExteriorQualityRating', improvements.qualityExterior)}`);
    const desc = CQ_RATINGS_36.quality[improvements.qualityExterior];
    if (desc) lines.push(`                  ${el('ExteriorQualityRatingDescription', desc)}`);
  }
  if (improvements.qualityInterior) {
    lines.push(`                  ${el('InteriorQualityRating', improvements.qualityInterior)}`);
    const desc = CQ_RATINGS_36.quality[improvements.qualityInterior];
    if (desc) lines.push(`                  ${el('InteriorQualityRatingDescription', desc)}`);
  }
  lines.push('                </RATINGS>');

  // Site
  lines.push('                <SITE>');
  if (site.area || site.lotSize) lines.push(`                  ${el('LotSizeSquareFeet', site.area || site.lotSize)}`);
  if (site.acres || site.lotAcres) lines.push(`                  ${el('LotSizeAcres', site.acres || site.lotAcres)}`);
  if (site.zoning) lines.push(`                  ${el('ZoningClassificationType', site.zoning)}`);
  if (site.view) lines.push(`                  ${el('ViewType', site.view)}`);
  if (site.topography) lines.push(`                  ${el('TopographyType', site.topography)}`);
  if (site.floodZone) lines.push(`                  ${el('FloodZoneIdentifier', site.floodZone)}`);
  if (site.femaMapNumber) lines.push(`                  ${el('FEMAMapPanelIdentifier', site.femaMapNumber)}`);
  lines.push('                </SITE>');

  // Neighborhood
  const neighborhood = facts.neighborhood || {};
  lines.push('                <NEIGHBORHOOD>');
  if (neighborhood.name) lines.push(`                  ${el('NeighborhoodName', neighborhood.name)}`);
  if (neighborhood.builtUp) lines.push(`                  ${el('BuiltUpType', neighborhood.builtUp)}`);
  if (neighborhood.growth) lines.push(`                  ${el('GrowthType', neighborhood.growth)}`);
  if (neighborhood.propertyValues) lines.push(`                  ${el('PropertyValueTrendType', neighborhood.propertyValues)}`);
  lines.push('                </NEIGHBORHOOD>');

  // Green / Energy features (new in UAD 3.6)
  const green = facts.green || facts.greenFeatures || {};
  if (Object.keys(green).length > 0) {
    lines.push('                <GREEN_FEATURES>');
    if (green.solarPanels != null) lines.push(`                  ${el('SolarPanelIndicator', String(green.solarPanels))}`);
    if (green.solarOwnership) lines.push(`                  ${el('SolarPanelOwnershipType', green.solarOwnership)}`);
    if (green.energyRating) lines.push(`                  ${el('EnergyEfficiencyRatingType', green.energyRating)}`);
    if (green.energyScore) lines.push(`                  ${el('EnergyEfficiencyScore', green.energyScore)}`);
    lines.push('                </GREEN_FEATURES>');
  }

  // Disaster mitigation (new in UAD 3.6)
  const disaster = facts.disaster || facts.disasterMitigation || {};
  if (Object.keys(disaster).length > 0) {
    lines.push('                <DISASTER_MITIGATION>');
    if (disaster.mitigationType) lines.push(`                  ${el('MitigationType', disaster.mitigationType)}`);
    if (disaster.description) lines.push(`                  ${el('MitigationDescription', disaster.description)}`);
    lines.push('                </DISASTER_MITIGATION>');
  }

  // Accessory Dwelling Unit (ADU) — new in UAD 3.6
  const adu = facts.adu || facts.accessoryDwelling || {};
  if (adu.present || adu.type) {
    lines.push('                <ACCESSORY_DWELLING_UNIT>');
    lines.push(`                  ${el('ADUIndicator', String(adu.present ?? true))}`);
    if (adu.type) lines.push(`                  ${el('ADUType', adu.type)}`);
    if (adu.gla) lines.push(`                  ${el('ADUGrossLivingAreaSquareFeet', adu.gla)}`);
    if (adu.bedrooms) lines.push(`                  ${el('ADUBedroomCount', adu.bedrooms)}`);
    if (adu.bathrooms) lines.push(`                  ${el('ADUBathroomCount', adu.bathrooms)}`);
    if (adu.condition) lines.push(`                  ${el('ADUConditionRating', adu.condition)}`);
    if (adu.quality) lines.push(`                  ${el('ADUQualityRating', adu.quality)}`);
    if (adu.yearBuilt) lines.push(`                  ${el('ADUYearBuilt', adu.yearBuilt)}`);
    if (adu.rentAmount) lines.push(`                  ${el('ADURentAmount', adu.rentAmount)}`);
    lines.push('                </ACCESSORY_DWELLING_UNIT>');
  }

  lines.push('              </SUBJECT_PROPERTY>');
  lines.push('            </COLLATERAL>');
  lines.push('          </COLLATERALS>');

  // ── Parties ──
  lines.push('          <PARTIES>');
  // Borrower
  if (subject.borrower || subject.owner) {
    lines.push('            <PARTY>');
    lines.push(`              ${el('PartyRoleType', 'Borrower')}`);
    lines.push(`              ${el('FullName', subject.borrower || subject.owner)}`);
    lines.push('            </PARTY>');
  }
  // Appraiser
  if (appraiser.name) {
    lines.push('            <PARTY>');
    lines.push(`              ${el('PartyRoleType', 'Appraiser')}`);
    lines.push(`              ${el('FullName', appraiser.name)}`);
    if (appraiser.licenseNumber) lines.push(`              ${el('LicenseIdentifier', appraiser.licenseNumber)}`);
    if (appraiser.licenseState) lines.push(`              ${el('LicenseIssuingStateCode', appraiser.licenseState)}`);
    if (appraiser.company) lines.push(`              ${el('CompanyName', appraiser.company)}`);
    lines.push('            </PARTY>');
  }
  lines.push('          </PARTIES>');

  // ── Services / Appraisal ──
  lines.push('          <SERVICES>');
  lines.push('            <SERVICE>');
  lines.push('              <APPRAISAL>');

  // Assignment details
  lines.push('                <ASSIGNMENT>');
  lines.push(`                  ${el('AssignmentType', assignment.type || 'Standard')}`);
  lines.push(`                  ${el('AppraisalPurposeType', assignment.purpose || 'Purchase')}`);
  lines.push(`                  ${el('IntendedUseType', assignment.intendedUse || 'MortgageLending')}`);
  lines.push(`                  ${el('ReportFormType', 'URAR')}`);
  if (assignment.effectiveDate || facts.effectiveDate) {
    lines.push(`                  ${el('EffectiveDate', assignment.effectiveDate || facts.effectiveDate)}`);
  }
  lines.push('                </ASSIGNMENT>');

  // Comparable sales
  lines.push('                <COMPARABLE_SALES>');
  for (let i = 0; i < Math.min((comps || []).length, 6); i++) {
    const comp = comps[i];
    const data = JSON.parse(comp.candidate_json || '{}');
    lines.push('                  <COMPARABLE_SALE>');
    lines.push(`                    ${el('SequenceNumber', String(i + 1))}`);
    lines.push('                    <ADDRESS>');
    lines.push(`                      ${el('AddressLineText', data.address || data.streetAddress || comp.source_key || '')}`);
    lines.push(`                      ${el('CityName', data.city || '')}`);
    lines.push(`                      ${el('StateCode', data.state || '')}`);
    lines.push(`                      ${el('PostalCode', data.zip || data.zipCode || '')}`);
    lines.push('                    </ADDRESS>');
    if (data.salePrice) lines.push(`                    ${el('SalePriceAmount', data.salePrice)}`);
    if (data.saleDate) lines.push(`                    ${el('SaleDate', data.saleDate)}`);
    if (data.gla) lines.push(`                    ${el('GrossLivingAreaSquareFeet', data.gla)}`);
    if (data.lotSize) lines.push(`                    ${el('LotSizeSquareFeet', data.lotSize)}`);
    if (data.yearBuilt) lines.push(`                    ${el('YearBuiltDate', data.yearBuilt)}`);
    if (data.bedrooms) lines.push(`                    ${el('BedroomCount', data.bedrooms)}`);
    if (data.bathrooms) lines.push(`                    ${el('BathroomCount', data.bathrooms)}`);
    if (data.condition) lines.push(`                    ${el('ConditionRating', data.condition)}`);
    if (data.quality) lines.push(`                    ${el('QualityRating', data.quality)}`);
    lines.push('                  </COMPARABLE_SALE>');
  }
  lines.push('                </COMPARABLE_SALES>');

  // Reconciliation
  const recon = facts.reconciliation || {};
  lines.push('                <RECONCILIATION>');
  if (recon.indicatedValueBySalesComparison) lines.push(`                  ${el('SalesComparisonApproachValue', recon.indicatedValueBySalesComparison)}`);
  if (recon.indicatedValueByCostApproach) lines.push(`                  ${el('CostApproachValue', recon.indicatedValueByCostApproach)}`);
  if (recon.indicatedValueByIncomeApproach) lines.push(`                  ${el('IncomeApproachValue', recon.indicatedValueByIncomeApproach)}`);
  if (recon.finalOpinionOfValue) lines.push(`                  ${el('FinalAppraisedValueAmount', recon.finalOpinionOfValue)}`);
  lines.push('                </RECONCILIATION>');

  // Structured commentary sections (UAD 3.6 — all narrative section types)
  // Supports both sections map (from generationOrchestrator) and outputs map (from outputs.json)
  lines.push('                <COMMENTARY>');
  const uad36CommentarySectionIds = [
    'contract_analysis',
    'neighborhood_description',
    'market_conditions',
    'site_description',
    'improvements_description',
    'condition_description',
    'energy_features',
    'adu_description',
    'highest_best_use',
    'sales_comparison_narrative',
    'cost_approach',
    'income_approach',
    'reconciliation',
    'scope_of_work',
    'prior_sales',
    'conditions_assumptions',
    'extraordinary_assumptions',
    'hypothetical_conditions',
    // Legacy section IDs (backward compat)
    'improvements_condition',
    'sca_summary',
    'sales_comparison_commentary',
    'conditions_of_appraisal',
    'prior_sales_subject',
    'functional_utility',
    'adverse_conditions',
  ];
  const seenCommentaryIds = new Set();
  for (const sectionId of uad36CommentarySectionIds) {
    if (seenCommentaryIds.has(sectionId)) continue;
    // Try sections map first (orchestrator output), then outputs map (file-based)
    const section = sections?.[sectionId] || caseData.outputs?.[sectionId];
    if (section) {
      const text = section.final_text || section.reviewed_text || section.draft_text || section.text || '';
      if (text.trim()) {
        lines.push(`                  <SECTION SectionType="${escapeXml(sectionId)}">`);
        lines.push(`                    ${el('CommentaryText', text)}`);
        lines.push(`                  </SECTION>`);
        seenCommentaryIds.add(sectionId);
      }
    }
  }
  lines.push('                </COMMENTARY>');

  lines.push('              </APPRAISAL>');
  lines.push('            </SERVICE>');
  lines.push('          </SERVICES>');

  lines.push('        </DEAL>');
  lines.push('      </DEALS>');
  lines.push('    </DEAL_SET>');
  lines.push('  </DEAL_SETS>');
  lines.push('</MESSAGE>');

  return lines.join('\n');
}

/**
 * Validate UAD 3.6 output against MISMO 3.6 compliance rules.
 * Returns structured validation result with errors (blocking) and warnings (non-blocking).
 */
export function validateUad36(xmlString) {
  const errors = [];
  const warnings = [];

  // ── Required structural fields ────────────────────────────────────────────
  const required = [
    ['AddressLineText',            'Subject address'],
    ['CityName',                   'City'],
    ['StateCode',                  'State'],
    ['PostalCode',                 'ZIP code'],
    ['YearBuiltDate',              'Year built'],
    ['GrossLivingAreaSquareFeet',  'Gross living area'],
    ['OverallConditionRating',     'Condition rating (C1–C6)'],
    ['OverallQualityRating',       'Quality rating (Q1–Q6)'],
    ['ReportFormType',             'Report form type (URAR)'],
    ['FinalAppraisedValueAmount',  'Final appraised value'],
    ['EffectiveDate',              'Effective date of appraisal'],
  ];

  for (const [tag, label] of required) {
    if (!xmlString.includes(`<${tag}`)) {
      errors.push(`Missing required field: ${label} (${tag})`);
    }
  }

  // ── UAD 3.6 specific required elements ───────────────────────────────────
  if (!xmlString.includes('AboutVersionIdentifier')) {
    errors.push('Missing MISMO version identifier (AboutVersionIdentifier)');
  }

  // Energy features section is required in UAD 3.6 (even if "none present")
  if (!xmlString.includes('GREEN_FEATURES') && !xmlString.includes('SectionType="energy_features"')) {
    warnings.push('UAD 3.6: GREEN_FEATURES or energy_features commentary section not present');
  }

  // ADU section required (even if no ADU)
  if (!xmlString.includes('ACCESSORY_DWELLING_UNIT') && !xmlString.includes('SectionType="adu_description"')) {
    warnings.push('UAD 3.6: ADU section not present (required even if no ADU exists)');
  }

  // ── Comparable sales ──────────────────────────────────────────────────────
  if (!xmlString.includes('<COMPARABLE_SALE>')) {
    warnings.push('No comparable sales in XML');
  } else {
    // Count comparables
    const compCount = (xmlString.match(/<COMPARABLE_SALE>/g) || []).length;
    if (compCount < 3) {
      warnings.push(`Only ${compCount} comparable sale(s) — UAD 3.6 typically requires at least 3`);
    }
  }

  // ── Commentary sections ───────────────────────────────────────────────────
  if (!xmlString.includes('<COMMENTARY>')) {
    errors.push('Missing COMMENTARY section — all narrative content must be present');
  } else {
    const requiredCommentary = [
      ['neighborhood_description', 'Neighborhood Description'],
      ['market_conditions',        'Market Conditions Analysis'],
      ['site_description',         'Site Description'],
      ['improvements_description', 'Description of Improvements'],
      ['condition_description',    'Condition of Improvements'],
      ['highest_best_use',         'Highest & Best Use'],
      ['sales_comparison_narrative','Sales Comparison Analysis'],
      ['reconciliation',           'Reconciliation'],
      ['scope_of_work',            'Scope of Work'],
    ];
    for (const [sectionId, label] of requiredCommentary) {
      if (!xmlString.includes(`SectionType="${sectionId}"`)) {
        // Also check legacy IDs
        const legacyChecks = {
          condition_description: 'improvements_condition',
          sales_comparison_narrative: 'sca_summary',
        };
        const legacyId = legacyChecks[sectionId];
        if (!legacyId || !xmlString.includes(`SectionType="${legacyId}"`)) {
          warnings.push(`Missing commentary section: ${label} (${sectionId})`);
        }
      }
    }
  }

  // ── Condition & Quality rating format ────────────────────────────────────
  const conditionRatingMatch = xmlString.match(/<OverallConditionRating>([^<]+)<\/OverallConditionRating>/);
  if (conditionRatingMatch) {
    const rating = conditionRatingMatch[1].trim();
    if (!/^C[1-6]$/.test(rating)) {
      errors.push(`Invalid condition rating format: "${rating}" — must be C1 through C6`);
    }
  }

  const qualityRatingMatch = xmlString.match(/<OverallQualityRating>([^<]+)<\/OverallQualityRating>/);
  if (qualityRatingMatch) {
    const rating = qualityRatingMatch[1].trim();
    if (!/^Q[1-6]$/.test(rating)) {
      errors.push(`Invalid quality rating format: "${rating}" — must be Q1 through Q6`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: errors.length === 0
      ? `Valid UAD 3.6 document${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}`
      : `${errors.length} compliance error${errors.length > 1 ? 's' : ''}, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`,
  };
}

export default { buildUad36Document, validateUad36, getUad36FieldMapping, CQ_RATINGS_36 };
