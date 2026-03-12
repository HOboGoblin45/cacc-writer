/**
 * server/contradictionGraph/contradictionGraphService.js
 * ------------------------------------------------------
 * Builds a unified case-level contradiction graph by combining:
 * - deterministic fact conflicts
 * - cross-workspace consistency checks
 * - comparable intelligence contradiction flags
 *
 * The graph is explainable and auditable. It does not resolve conflicts.
 * It only surfaces them in a stable structure for the workspace and QC.
 */

import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import { buildComparableIntelligence } from '../comparableIntelligence/comparableIntelligenceService.js';
import { detectFactConflicts } from '../factIntegrity/factConflictEngine.js';
import { getNestedValue } from '../workspace/workspaceService.js';

const SEVERITY_RANK = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
  advisory: 0,
};

const CATEGORY_LABELS = {
  dates: 'Dates',
  values: 'Values',
  entities: 'Entities',
  zoning: 'Zoning',
  flood_status: 'Flood Status',
  occupancy: 'Occupancy',
  site_size: 'Site Size',
  gla: 'GLA',
  comp_adjustments: 'Comp Adjustments',
  prior_sale_history: 'Prior Sale History',
};

const CATEGORY_META = {
  dates: {
    sectionIds: ['assignment', 'contract', 'reconciliation', 'uspap_addendum'],
    canonicalFieldIds: ['assignment_effective_date', 'contract_date', 'reconciliation_effective_date'],
  },
  values: {
    sectionIds: ['contract', 'sales_comparison', 'reconciliation'],
    canonicalFieldIds: ['contract_price', 'sales_comp_grid'],
  },
  entities: {
    sectionIds: ['subject', 'assignment'],
    canonicalFieldIds: ['subject_property_address', 'subject_apn'],
  },
  zoning: {
    sectionIds: ['site', 'qc_review'],
    canonicalFieldIds: ['site_zoning_classification'],
  },
  flood_status: {
    sectionIds: ['site', 'qc_review'],
    canonicalFieldIds: ['site_flood_hazard_area', 'site_flood_zone'],
  },
  occupancy: {
    sectionIds: ['subject', 'qc_review'],
    canonicalFieldIds: ['subject_occupant'],
  },
  site_size: {
    sectionIds: ['site', 'qc_review'],
    canonicalFieldIds: ['site_area'],
  },
  gla: {
    sectionIds: ['improvements', 'dimension_addendum', 'sales_comparison', 'qc_review'],
    canonicalFieldIds: ['improvements_gla', 'dimension_area_summary', 'sales_comp_grid'],
  },
  comp_adjustments: {
    sectionIds: ['sales_comparison', 'reconciliation', 'qc_review'],
    canonicalFieldIds: ['sales_comp_grid'],
  },
  prior_sale_history: {
    sectionIds: ['prior_sales', 'sales_comparison', 'qc_review'],
    canonicalFieldIds: ['prior_sales_grid'],
  },
};

function asText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeText(value) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ');
}

function asNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).replace(/[^0-9.\-]/g, '');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(value) {
  const text = asText(value);
  if (!text) return '';
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return normalizeText(text);
  return new Date(ts).toISOString().slice(0, 10);
}

function readPathValue(facts, path) {
  const raw = getNestedValue(facts || {}, path);
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value;
  }
  return raw;
}

function normalizeValueForPath(path, value) {
  const lowerPath = normalizeText(path);
  if (!asText(value)) return '';
  if (/date|effective/i.test(lowerPath)) return normalizeDate(value);
  if (/price|value|gla|size|lot|area|amount|percent|sf|sq/i.test(lowerPath)) {
    const num = asNumber(value);
    return num == null ? normalizeText(value) : String(num);
  }
  return normalizeText(value);
}

function dedupeList(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function categoryMeta(category) {
  return CATEGORY_META[category] || { sectionIds: ['qc_review'], canonicalFieldIds: [] };
}

function createContradiction({
  id,
  source,
  code,
  category,
  severity = 'medium',
  message,
  detailMessage,
  factPaths = [],
  sectionIds,
  canonicalFieldIds,
  values = [],
  expectedValue = null,
  actualValue = null,
}) {
  const meta = categoryMeta(category);
  return {
    id,
    source,
    code,
    category,
    categoryLabel: CATEGORY_LABELS[category] || category,
    severity,
    message,
    detailMessage: detailMessage || message,
    factPaths: dedupeList(factPaths),
    sectionIds: dedupeList(sectionIds || meta.sectionIds),
    canonicalFieldIds: dedupeList(canonicalFieldIds || meta.canonicalFieldIds),
    values,
    expectedValue,
    actualValue,
  };
}

function categoryFromFactPath(factPath) {
  const path = normalizeText(factPath);
  if (path.includes('priorsale') || path.includes('prior_sale') || path.includes('transfer')) return 'prior_sale_history';
  if (path.includes('flood')) return 'flood_status';
  if (path.includes('zoning')) return 'zoning';
  if (path.includes('occup')) return 'occupancy';
  if (path.includes('gla')) return 'gla';
  if (path.includes('sitesize') || path.includes('lotsize') || path.endsWith('.area')) return 'site_size';
  if (path.includes('date')) return 'dates';
  if (path.includes('address') || path.includes('parcel') || path.includes('apn') || path.includes('entity')) return 'entities';
  if (path.includes('price') || path.includes('value') || path.includes('adjustment') || path.includes('concession')) return 'values';
  return 'values';
}

function mapFactConflicts(factConflictReport) {
  const conflicts = Array.isArray(factConflictReport?.conflicts) ? factConflictReport.conflicts : [];
  return conflicts.map((conflict) => {
    const category = categoryFromFactPath(conflict.factPath);
    return createContradiction({
      id: `fact:${conflict.factPath}`,
      source: 'fact_conflict',
      code: 'fact_value_conflict',
      category,
      severity: conflict.severity || 'medium',
      message: `${CATEGORY_LABELS[category] || 'Field'} values conflict at ${conflict.factPath}.`,
      detailMessage: `Multiple supported values were found for ${conflict.factPath}. Resolve the conflict before final drafting or QC approval.`,
      factPaths: [conflict.factPath],
      values: (conflict.values || []).map((entry) => ({
        path: conflict.factPath,
        displayValue: entry.displayValue,
        normalizedValue: entry.normalizedValue || normalizeValueForPath(conflict.factPath, entry.displayValue),
        sourceCount: entry.sourceCount || 0,
        confidence: entry.maxConfidence || null,
      })),
    });
  });
}

function comparableCategoryForCode(code) {
  const normalized = normalizeText(code).replace(/\s+/g, '_');
  if (normalized.includes('sale_date')) return 'dates';
  if (normalized.includes('sale_price')) return 'values';
  if (normalized.includes('gla')) return 'gla';
  if (normalized.includes('prior_sale')) return 'prior_sale_history';
  if (normalized.includes('adjustment') || normalized.includes('concession') || normalized.includes('stability')) return 'comp_adjustments';
  if (normalized.includes('address') || normalized.includes('verification')) return 'entities';
  return 'comp_adjustments';
}

function mapComparableContradictions(comparableIntelligence) {
  const contradictions = Array.isArray(comparableIntelligence?.contradictions)
    ? comparableIntelligence.contradictions
    : [];

  return contradictions.map((entry, index) => {
    const category = comparableCategoryForCode(entry.code);
    return createContradiction({
      id: `comp:${entry.gridSlot || 'slot'}:${entry.code || index}`,
      source: 'comparable_intelligence',
      code: entry.code || 'comparable_contradiction',
      category,
      severity: entry.severity || 'medium',
      message: entry.message || 'Comparable contradiction detected.',
      detailMessage: `Comparable intelligence flagged ${entry.code || 'a contradiction'} for ${entry.gridSlot || 'an accepted comparable'}.`,
      sectionIds: ['sales_comparison', 'reconciliation', 'qc_review'],
      canonicalFieldIds: ['sales_comp_grid'],
      expectedValue: entry.expectedValue ?? null,
      actualValue: entry.actualValue ?? null,
      values: [{
        path: entry.gridSlot || 'sales_comparison',
        displayValue: entry.actualValue ?? entry.message ?? '',
        normalizedValue: normalizeText(entry.actualValue ?? entry.message ?? ''),
      }],
    });
  });
}

function comparePathGroup({ id, category, label, severity = 'medium', facts, paths }) {
  const values = paths
    .map((path) => {
      const value = readPathValue(facts, path);
      const text = asText(value);
      if (!text) return null;
      return {
        path,
        value,
        displayValue: text,
        normalizedValue: normalizeValueForPath(path, value),
      };
    })
    .filter(Boolean);

  const distinct = dedupeList(values.map((entry) => entry.normalizedValue));
  if (distinct.length <= 1) return null;

  return createContradiction({
    id: `workspace:${id}`,
    source: 'workspace_alignment',
    code: `${id}_mismatch`,
    category,
    severity,
    message: `${label} differs across synchronized workspace sections.`,
    detailMessage: `${label} should remain aligned across the case record and repeated 1004 sections, but different values are currently stored.`,
    factPaths: values.map((entry) => entry.path),
    values,
  });
}

function normalizeOccupancy(value) {
  const text = normalizeText(value).replace(/[_-]/g, ' ');
  if (!text) return '';
  if (text.includes('owner')) return 'owner';
  if (text.includes('tenant') || text.includes('rental') || text.includes('non owner')) return 'tenant';
  if (text.includes('vacant')) return 'vacant';
  return text;
}

function checkOccupancyConsistency(projection) {
  const facts = projection?.facts || {};
  const meta = projection?.meta || {};
  const workspaceOccupant = normalizeOccupancy(readPathValue(facts, 'workspace1004.subject.occupant'));
  const metaOccupancy = normalizeOccupancy(meta.occupancyType || readPathValue(facts, 'subject.occupancyType'));
  if (!workspaceOccupant || !metaOccupancy || workspaceOccupant === metaOccupancy) return null;

  return createContradiction({
    id: 'workspace:occupancy_mismatch',
    source: 'workspace_alignment',
    code: 'occupancy_mismatch',
    category: 'occupancy',
    severity: 'medium',
    message: 'Subject occupancy differs between assignment context and the 1004 workspace.',
    detailMessage: 'The occupancy stored in case metadata does not match the occupant selected in the subject section.',
    factPaths: ['workspace1004.subject.occupant'],
    values: [
      { path: 'meta.occupancyType', displayValue: meta.occupancyType || '', normalizedValue: metaOccupancy },
      { path: 'workspace1004.subject.occupant', displayValue: readPathValue(facts, 'workspace1004.subject.occupant') || '', normalizedValue: workspaceOccupant },
    ],
    expectedValue: meta.occupancyType || null,
    actualValue: readPathValue(facts, 'workspace1004.subject.occupant') || null,
  });
}

function normalizeYesNo(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text === 'yes' || text === 'y' || text === 'true') return 'yes';
  if (text === 'no' || text === 'n' || text === 'false') return 'no';
  return text;
}

function inferFloodHazardFromZone(zone) {
  const text = normalizeText(zone).toUpperCase();
  if (!text) return '';
  if (/^(X|X500|NONE|NO FLOOD ZONE|OUTSIDE)$/i.test(text)) return 'no';
  if (/^(A|AE|AH|AO|AR|V|VE|D)\b/i.test(text)) return 'yes';
  return '';
}

function checkFloodConsistency(projection) {
  const facts = projection?.facts || {};
  const hazardArea = normalizeYesNo(readPathValue(facts, 'workspace1004.site.femaSpecialFloodHazardArea'));
  const floodZone = asText(readPathValue(facts, 'workspace1004.site.femaFloodZone') || readPathValue(facts, 'subject.floodZone'));
  const inferredHazard = inferFloodHazardFromZone(floodZone);
  if (!hazardArea || !inferredHazard || hazardArea === inferredHazard) return null;

  return createContradiction({
    id: 'workspace:flood_status_mismatch',
    source: 'workspace_alignment',
    code: 'flood_status_mismatch',
    category: 'flood_status',
    severity: 'high',
    message: 'Flood hazard answer does not match the recorded FEMA flood zone.',
    detailMessage: 'The site section flood-hazard yes/no answer contradicts the FEMA flood zone currently stored for the case.',
    factPaths: ['workspace1004.site.femaSpecialFloodHazardArea', 'workspace1004.site.femaFloodZone', 'subject.floodZone'],
    values: [
      { path: 'workspace1004.site.femaSpecialFloodHazardArea', displayValue: readPathValue(facts, 'workspace1004.site.femaSpecialFloodHazardArea') || '', normalizedValue: hazardArea },
      { path: 'workspace1004.site.femaFloodZone', displayValue: floodZone, normalizedValue: normalizeText(floodZone) },
    ],
    expectedValue: inferredHazard,
    actualValue: hazardArea,
  });
}

function buildPriorSalesRowIndex(gridRows) {
  const map = new Map();
  for (const row of Array.isArray(gridRows) ? gridRows : []) {
    const label = normalizeText(row?.item);
    if (!label) continue;
    map.set(label, row);
  }
  return map;
}

function rowHasSubjectHistory(rowIndex) {
  return ['date of prior sale / transfer', 'price of prior sale / transfer']
    .some((key) => asText(rowIndex.get(key)?.subject));
}

function rowHasComparableHistory(rowIndex) {
  return ['date of prior sale / transfer', 'price of prior sale / transfer']
    .some((key) => {
      const row = rowIndex.get(key) || {};
      return ['comp1', 'comp2', 'comp3'].some((slot) => asText(row?.[slot]));
    });
}

function checkPriorSalesConsistency(projection) {
  const facts = projection?.facts || {};
  const rowIndex = buildPriorSalesRowIndex(readPathValue(facts, 'workspace1004.priorSales.grid'));
  const subjectFound = normalizeYesNo(readPathValue(facts, 'workspace1004.priorSales.subjectHistoryFound'));
  const compFound = normalizeYesNo(readPathValue(facts, 'workspace1004.priorSales.compHistoryFound'));
  const subjectHasGridData = rowHasSubjectHistory(rowIndex);
  const compHasGridData = rowHasComparableHistory(rowIndex);
  const contradictions = [];

  if (subjectFound === 'yes' && !subjectHasGridData) {
    contradictions.push(createContradiction({
      id: 'workspace:subject_prior_sales_missing',
      source: 'workspace_alignment',
      code: 'subject_prior_sales_missing',
      category: 'prior_sale_history',
      severity: 'high',
      message: 'Subject prior-sale history is marked as found, but the prior-sales grid is blank for the subject.',
      detailMessage: 'If subject prior-sale history was found, the prior-sales grid should include the subject date and price details.',
      factPaths: ['workspace1004.priorSales.subjectHistoryFound', 'workspace1004.priorSales.grid'],
      values: [
        { path: 'workspace1004.priorSales.subjectHistoryFound', displayValue: 'yes', normalizedValue: 'yes' },
      ],
      expectedValue: 'subject prior-sale details in grid',
      actualValue: 'blank subject prior-sale cells',
    }));
  }

  if (subjectFound === 'no' && subjectHasGridData) {
    contradictions.push(createContradiction({
      id: 'workspace:subject_prior_sales_unexpected',
      source: 'workspace_alignment',
      code: 'subject_prior_sales_unexpected',
      category: 'prior_sale_history',
      severity: 'medium',
      message: 'Subject prior-sale history is marked as not found, but the prior-sales grid contains subject transfer data.',
      detailMessage: 'The yes/no research flag and the subject prior-sales grid should agree.',
      factPaths: ['workspace1004.priorSales.subjectHistoryFound', 'workspace1004.priorSales.grid'],
      expectedValue: 'no subject prior-sale entries',
      actualValue: 'subject prior-sale entries present',
    }));
  }

  if (compFound === 'yes' && !compHasGridData) {
    contradictions.push(createContradiction({
      id: 'workspace:comp_prior_sales_missing',
      source: 'workspace_alignment',
      code: 'comp_prior_sales_missing',
      category: 'prior_sale_history',
      severity: 'high',
      message: 'Comparable prior-sale history is marked as found, but the prior-sales grid is blank for the comps.',
      detailMessage: 'If comparable prior-sales were found, at least one comp column should contain prior transfer details.',
      factPaths: ['workspace1004.priorSales.compHistoryFound', 'workspace1004.priorSales.grid'],
      expectedValue: 'comp prior-sale details in grid',
      actualValue: 'blank comparable prior-sale cells',
    }));
  }

  if (compFound === 'no' && compHasGridData) {
    contradictions.push(createContradiction({
      id: 'workspace:comp_prior_sales_unexpected',
      source: 'workspace_alignment',
      code: 'comp_prior_sales_unexpected',
      category: 'prior_sale_history',
      severity: 'medium',
      message: 'Comparable prior-sale history is marked as not found, but the prior-sales grid contains comp transfer data.',
      detailMessage: 'The comparable research flag and the comparable prior-sales grid should agree.',
      factPaths: ['workspace1004.priorSales.compHistoryFound', 'workspace1004.priorSales.grid'],
      expectedValue: 'no comparable prior-sale entries',
      actualValue: 'comparable prior-sale entries present',
    }));
  }

  return contradictions;
}

function checkDimensionGlaConsistency(projection) {
  const facts = projection?.facts || {};
  const formGla = asNumber(readPathValue(facts, 'workspace1004.improvements.gla') || readPathValue(facts, 'subject.gla'));
  const areaSummary = readPathValue(facts, 'workspace1004.dimensionAddendum.areaSummary');
  const livingRow = Array.isArray(areaSummary)
    ? areaSummary.find((row) => normalizeText(row?.areaLabel) === 'living')
    : null;
  const livingArea = asNumber(livingRow?.area);

  if (formGla == null || livingArea == null) return null;
  const tolerance = Math.max(25, formGla * 0.02);
  if (Math.abs(formGla - livingArea) <= tolerance) return null;

  return createContradiction({
    id: 'workspace:gla_dimension_mismatch',
    source: 'workspace_alignment',
    code: 'gla_dimension_mismatch',
    category: 'gla',
    severity: 'high',
    message: 'Improvements GLA does not match the dimension addendum living area.',
    detailMessage: 'The primary GLA field and the dimension addendum should reconcile before final QC and export.',
    factPaths: ['workspace1004.improvements.gla', 'workspace1004.dimensionAddendum.areaSummary'],
    values: [
      { path: 'workspace1004.improvements.gla', displayValue: String(formGla), normalizedValue: String(formGla) },
      { path: 'workspace1004.dimensionAddendum.areaSummary.Living', displayValue: String(livingArea), normalizedValue: String(livingArea) },
    ],
    expectedValue: String(formGla),
    actualValue: String(livingArea),
  });
}

function buildWorkspaceContradictions(projection) {
  const facts = projection?.facts || {};
  return [
    comparePathGroup({
      id: 'subject_address',
      category: 'entities',
      label: 'Subject address',
      severity: 'high',
      facts,
      paths: [
        'subject.address',
        'workspace1004.subject.propertyAddress',
        'workspace1004.uspap.propertyAddress',
        'workspace1004.dimensionAddendum.propertyAddress',
        'workspace1004.photoAddendum.propertyAddress',
      ],
    }),
    comparePathGroup({
      id: 'effective_date',
      category: 'dates',
      label: 'Effective date',
      severity: 'high',
      facts,
      paths: [
        'assignment.effectiveDate',
        'workspace1004.assignment.effectiveDate',
        'workspace1004.reconciliation.effectiveDate',
        'workspace1004.uspap.appraiser.effectiveDateOfAppraisal',
        'workspace1004.photoAddendum.appraisedDate',
      ],
    }),
    comparePathGroup({
      id: 'site_size',
      category: 'site_size',
      label: 'Site size',
      severity: 'high',
      facts,
      paths: [
        'subject.siteSize',
        'subject.lotSize',
        'workspace1004.site.area',
      ],
    }),
    comparePathGroup({
      id: 'zoning',
      category: 'zoning',
      label: 'Zoning classification',
      severity: 'high',
      facts,
      paths: [
        'subject.zoning',
        'workspace1004.site.zoningClassification',
      ],
    }),
    comparePathGroup({
      id: 'contract_date',
      category: 'dates',
      label: 'Contract date',
      severity: 'high',
      facts,
      paths: [
        'contract.contractDate',
        'workspace1004.contract.contractDate',
      ],
    }),
    comparePathGroup({
      id: 'contract_price',
      category: 'values',
      label: 'Contract price',
      severity: 'high',
      facts,
      paths: [
        'contract.contractPrice',
        'workspace1004.contract.contractPrice',
      ],
    }),
    checkOccupancyConsistency(projection),
    checkFloodConsistency(projection),
    checkDimensionGlaConsistency(projection),
    ...checkPriorSalesConsistency(projection),
  ].filter(Boolean);
}

function buildSummary(items) {
  const severityCounts = { blocker: 0, high: 0, medium: 0, low: 0 };
  const categoryCounts = {};
  const sourceCounts = {
    fact_conflict: 0,
    workspace_alignment: 0,
    comparable_intelligence: 0,
  };

  for (const item of items) {
    severityCounts[item.severity] = (severityCounts[item.severity] || 0) + 1;
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
  }

  return {
    totalContradictions: items.length,
    blockerCount: severityCounts.blocker || 0,
    highCount: severityCounts.high || 0,
    mediumCount: severityCounts.medium || 0,
    lowCount: severityCounts.low || 0,
    categoryCounts,
    sourceCounts,
  };
}

function sortContradictions(items) {
  return [...items].sort((left, right) => {
    const severityDelta = (SEVERITY_RANK[right.severity] || 0) - (SEVERITY_RANK[left.severity] || 0);
    if (severityDelta !== 0) return severityDelta;
    const categoryDelta = String(left.category).localeCompare(String(right.category));
    if (categoryDelta !== 0) return categoryDelta;
    return String(left.message).localeCompare(String(right.message));
  });
}

export function buildContradictionGraph(caseId, opts = {}) {
  const projection = opts.projection || getCaseProjection(caseId);
  if (!projection) return null;

  const factConflictReport = opts.factConflictReport || detectFactConflicts(caseId) || { conflicts: [] };
  const comparableIntelligence = opts.comparableIntelligence || buildComparableIntelligence(caseId) || { contradictions: [] };

  const items = sortContradictions([
    ...mapFactConflicts(factConflictReport),
    ...buildWorkspaceContradictions(projection),
    ...mapComparableContradictions(comparableIntelligence),
  ]);

  return {
    caseId,
    checkedAt: new Date().toISOString(),
    summary: buildSummary(items),
    items,
  };
}

export default { buildContradictionGraph };
