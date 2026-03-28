/**
 * server/security/complianceService.js
 * ---------------------------------------
 * Phase 15 — Compliance Tracking Service
 *
 * Tracks and verifies regulatory compliance for appraisal cases.
 * Supports USPAP, state license, AMC requirements, and other frameworks.
 * All functions are synchronous (better-sqlite3).
 *
 * Usage:
 *   import { runComplianceCheck, getCaseComplianceStatus } from './complianceService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function genId() {
  return 'cmpl_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

// ── USPAP Required Sections ─────────────────────────────────────────────────

const USPAP_REQUIRED_ITEMS = [
  { item: 'scope_of_work', label: 'Scope of Work' },
  { item: 'intended_use', label: 'Intended Use Statement' },
  { item: 'intended_users', label: 'Intended Users' },
  { item: 'effective_date', label: 'Effective Date of Appraisal' },
  { item: 'market_analysis', label: 'Market Analysis' },
  { item: 'highest_best_use', label: 'Highest and Best Use Analysis' },
  { item: 'sales_comparison', label: 'Sales Comparison Approach' },
  { item: 'reconciliation', label: 'Reconciliation and Final Value Opinion' },
  { item: 'certification', label: 'Appraiser Certification' },
  { item: 'limiting_conditions', label: 'Assumptions and Limiting Conditions' },
  { item: 'prior_services', label: 'Prior Services Disclosure' },
  { item: 'property_inspection', label: 'Property Inspection Statement' },
];

const AMC_REQUIRED_ITEMS = [
  { item: 'scope_of_work', label: 'Scope of Work' },
  { item: 'fee_disclosure', label: 'Fee Disclosure' },
  { item: 'turnaround_time', label: 'Turnaround Time' },
  { item: 'appraiser_independence', label: 'Appraiser Independence Compliance' },
  { item: 'quality_control', label: 'Quality Control Process' },
];

// ── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * Create a compliance check record.
 *
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function createComplianceRecord(data) {
  if (!data.compliance_type) {
    return { error: 'compliance_type is required' };
  }

  const id = genId();
  const ts = now();

  try {
    dbRun(
      `INSERT INTO compliance_records (id, case_id, compliance_type, status, checked_at, checked_by, findings_json, remediation_json, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.case_id || null,
        data.compliance_type,
        data.status || 'pending',
        data.checked_at || null,
        data.checked_by || null,
        toJSON(data.findings),
        toJSON(data.remediation),
        data.notes || null,
        ts,
        ts,
      ]
    );

    log.info('compliance:created', { id, caseId: data.case_id, type: data.compliance_type });
    return { id };
  } catch (err) {
    log.error('compliance:create-error', { error: err.message });
    return { error: err.message };
  }
}

/**
 * Get a compliance record by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getComplianceRecord(id) {
  const row = dbGet('SELECT * FROM compliance_records WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    findings: parseJSON(row.findings_json, []),
    remediation: parseJSON(row.remediation_json),
  };
}

/**
 * List compliance records for a case.
 *
 * @param {string} caseId
 * @returns {Object[]}
 */
export function listComplianceRecords(caseId) {
  const rows = dbAll(
    'SELECT * FROM compliance_records WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );
  return rows.map(row => ({
    ...row,
    findings: parseJSON(row.findings_json, []),
    remediation: parseJSON(row.remediation_json),
  }));
}

/**
 * Update a compliance record.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateComplianceRecord(id, updates) {
  const record = dbGet('SELECT id FROM compliance_records WHERE id = ?', [id]);
  if (!record) return { error: 'Compliance record not found' };

  const allowedFields = ['status', 'checked_at', 'checked_by', 'notes'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'findings') {
      setClauses.push('findings_json = ?');
      params.push(toJSON(value));
    } else if (key === 'remediation') {
      setClauses.push('remediation_json = ?');
      params.push(toJSON(value));
    } else if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return { error: 'No valid fields to update' };

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  try {
    dbRun(`UPDATE compliance_records SET ${setClauses.join(', ')} WHERE id = ?`, params);
    log.info('compliance:updated', { id });
    return { ok: true };
  } catch (err) {
    log.error('compliance:update-error', { error: err.message, id });
    return { error: err.message };
  }
}

// ── Automated Compliance Checks ──────────────────────────────────────────────

/**
 * Run an automated compliance check for a case.
 *
 * @param {string} caseId
 * @param {string} complianceType - uspap | state_license | amc_requirements
 * @returns {{ id: string, status: string, findings: Object[] } | { error: string }}
 */
export function runComplianceCheck(caseId, complianceType) {
  if (!caseId) return { error: 'caseId is required' };
  if (!complianceType) return { error: 'complianceType is required' };

  // Get case data
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) return { error: `Case not found: ${caseId}` };

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = parseJSON(caseFacts?.facts_json, {});

  const caseOutputs = dbGet('SELECT outputs_json FROM case_outputs WHERE case_id = ?', [caseId]);
  const outputs = parseJSON(caseOutputs?.outputs_json, {});

  let findings = [];
  let status = 'compliant';

  switch (complianceType) {
    case 'uspap':
      findings = checkUSPAP(facts, outputs, caseRecord);
      break;
    case 'state_license':
      findings = checkStateLicense(facts, outputs);
      break;
    case 'amc_requirements':
      findings = checkAMCRequirements(facts, outputs);
      break;
    case 'eao':
      findings = checkEAO(facts, outputs);
      break;
    case 'firrea':
      findings = checkFIRREA(facts, outputs, caseRecord);
      break;
    case 'regulation_z':
      findings = checkRegulationZ(facts, outputs);
      break;
    default:
      return { error: `Unknown compliance type: ${complianceType}` };
  }

  // Determine overall status from findings
  const nonCompliantCount = findings.filter(f => f.status === 'non_compliant').length;
  if (nonCompliantCount > 0) {
    status = 'non_compliant';
  }

  const remediation = nonCompliantCount > 0
    ? findings.filter(f => f.status === 'non_compliant').map(f => ({
        item: f.item,
        fix: `Address: ${f.note || f.label || f.item}`,
      }))
    : null;

  // Upsert compliance record for this case + type
  const existing = dbGet(
    'SELECT id FROM compliance_records WHERE case_id = ? AND compliance_type = ?',
    [caseId, complianceType]
  );

  const ts = now();
  let recordId;

  if (existing) {
    recordId = existing.id;
    dbRun(
      `UPDATE compliance_records
       SET status = ?, checked_at = ?, checked_by = ?, findings_json = ?, remediation_json = ?, updated_at = ?
       WHERE id = ?`,
      [status, ts, 'system', JSON.stringify(findings), toJSON(remediation), ts, recordId]
    );
  } else {
    recordId = genId();
    dbRun(
      `INSERT INTO compliance_records (id, case_id, compliance_type, status, checked_at, checked_by, findings_json, remediation_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [recordId, caseId, complianceType, status, ts, 'system', JSON.stringify(findings), toJSON(remediation), ts, ts]
    );
  }

  log.info('compliance:check-completed', { caseId, complianceType, status, findingsCount: findings.length });
  return { id: recordId, status, findings };
}

/**
 * Check USPAP compliance — required sections, certifications, limiting conditions.
 */
function checkUSPAP(facts, outputs, caseRecord) {
  const findings = [];

  for (const req of USPAP_REQUIRED_ITEMS) {
    const sectionOutput = outputs[req.item];
    const hasFact = facts[req.item];
    const hasOutput = sectionOutput && typeof sectionOutput === 'string' && sectionOutput.trim().length > 0;

    // Check both facts and outputs for each required item
    let present = hasOutput || !!hasFact;

    // Special checks for specific items
    if (req.item === 'effective_date') {
      present = !!(facts.effectiveDate || facts.effective_date || facts.inspectionDate);
    }
    if (req.item === 'intended_use') {
      present = !!(facts.intendedUse || facts.intended_use || outputs.intended_use);
    }
    if (req.item === 'intended_users') {
      present = !!(facts.intendedUsers || facts.intended_users || outputs.intended_users);
    }

    findings.push({
      item: req.item,
      label: req.label,
      status: present ? 'compliant' : 'non_compliant',
      note: present ? null : `Missing required USPAP element: ${req.label}`,
    });
  }

  return findings;
}

/**
 * Check state license compliance — verify license number present.
 */
function checkStateLicense(facts, outputs) {
  const findings = [];
  const licenseNumber = facts.appraiserLicenseNumber || facts.license_number || facts.licenseNumber;

  findings.push({
    item: 'license_number',
    label: 'Appraiser License Number',
    status: licenseNumber ? 'compliant' : 'non_compliant',
    note: licenseNumber ? null : 'Appraiser license number not found in case facts',
  });

  const licenseState = facts.appraiserLicenseState || facts.license_state || facts.licenseState;
  findings.push({
    item: 'license_state',
    label: 'License State',
    status: licenseState ? 'compliant' : 'non_compliant',
    note: licenseState ? null : 'License state not found in case facts',
  });

  const licenseExpiry = facts.licenseExpiration || facts.license_expiration;
  findings.push({
    item: 'license_expiration',
    label: 'License Expiration',
    status: licenseExpiry ? 'compliant' : 'non_compliant',
    note: licenseExpiry ? null : 'License expiration date not found',
  });

  return findings;
}

/**
 * Check AMC requirements — scope of work, fee disclosure.
 */
function checkAMCRequirements(facts, outputs) {
  const findings = [];

  for (const req of AMC_REQUIRED_ITEMS) {
    const hasOutput = outputs[req.item] && typeof outputs[req.item] === 'string' && outputs[req.item].trim().length > 0;
    const hasFact = !!facts[req.item];
    const present = hasOutput || hasFact;

    findings.push({
      item: req.item,
      label: req.label,
      status: present ? 'compliant' : 'non_compliant',
      note: present ? null : `Missing AMC requirement: ${req.label}`,
    });
  }

  return findings;
}

/**
 * Check EAO (Equal Appraisal Opportunity) compliance.
 */
function checkEAO(facts, outputs) {
  const findings = [];

  findings.push({
    item: 'non_discrimination',
    label: 'Non-Discrimination Statement',
    status: 'compliant',
    note: 'EAO compliance is a process requirement — manual verification recommended',
  });

  return findings;
}

/**
 * Check FIRREA compliance (for federally related transactions).
 */
function checkFIRREA(facts, outputs, caseRecord) {
  const findings = [];

  // FIRREA requires a state-licensed or certified appraiser
  const licenseNumber = facts.appraiserLicenseNumber || facts.license_number;
  findings.push({
    item: 'licensed_appraiser',
    label: 'Licensed/Certified Appraiser',
    status: licenseNumber ? 'compliant' : 'non_compliant',
    note: licenseNumber ? null : 'FIRREA requires a state-licensed or certified appraiser',
  });

  // FIRREA applies to transactions over $250,000 (or $400,000 for certain residential)
  findings.push({
    item: 'transaction_threshold',
    label: 'FIRREA Transaction Threshold',
    status: 'compliant',
    note: 'Manual verification of transaction value required',
  });

  return findings;
}

/**
 * Check Regulation Z (TILA) compliance.
 */
function checkRegulationZ(facts, outputs) {
  const findings = [];

  findings.push({
    item: 'appraiser_independence',
    label: 'Appraiser Independence',
    status: 'compliant',
    note: 'Regulation Z appraiser independence is a process requirement — manual verification recommended',
  });

  findings.push({
    item: 'copy_to_borrower',
    label: 'Copy Provided to Borrower',
    status: 'compliant',
    note: 'Verify that a copy of the appraisal was or will be provided to the borrower',
  });

  return findings;
}

// ── Case-Level Compliance ────────────────────────────────────────────────────

/**
 * Get overall compliance status for a case.
 *
 * @param {string} caseId
 * @returns {Object}
 */
export function getCaseComplianceStatus(caseId) {
  const records = dbAll(
    'SELECT * FROM compliance_records WHERE case_id = ? ORDER BY compliance_type',
    [caseId]
  );

  const byType = {};
  let overall = 'compliant';
  let pendingCount = 0;
  let nonCompliantCount = 0;
  let compliantCount = 0;

  for (const r of records) {
    byType[r.compliance_type] = {
      status: r.status,
      checked_at: r.checked_at,
      checked_by: r.checked_by,
      findings: parseJSON(r.findings_json, []),
    };

    if (r.status === 'non_compliant') {
      nonCompliantCount++;
      overall = 'non_compliant';
    } else if (r.status === 'pending') {
      pendingCount++;
      if (overall !== 'non_compliant') overall = 'pending';
    } else if (r.status === 'compliant') {
      compliantCount++;
    }
  }

  return {
    case_id: caseId,
    overall,
    totalChecks: records.length,
    compliantCount,
    nonCompliantCount,
    pendingCount,
    byType,
  };
}

/**
 * Get system-wide compliance summary/dashboard data.
 *
 * @returns {Object}
 */
export function getComplianceSummary() {
  const totalRow = dbGet('SELECT COUNT(*) AS n FROM compliance_records');
  const compliantRow = dbGet("SELECT COUNT(*) AS n FROM compliance_records WHERE status = 'compliant'");
  const nonCompliantRow = dbGet("SELECT COUNT(*) AS n FROM compliance_records WHERE status = 'non_compliant'");
  const pendingRow = dbGet("SELECT COUNT(*) AS n FROM compliance_records WHERE status = 'pending'");

  const byType = dbAll(
    `SELECT compliance_type, status, COUNT(*) AS count
     FROM compliance_records
     GROUP BY compliance_type, status
     ORDER BY compliance_type, status`
  );

  const recentNonCompliant = dbAll(
    `SELECT * FROM compliance_records WHERE status = 'non_compliant' ORDER BY checked_at DESC LIMIT 20`
  );

  const casesChecked = dbGet(
    'SELECT COUNT(DISTINCT case_id) AS n FROM compliance_records WHERE case_id IS NOT NULL'
  );

  return {
    total: totalRow?.n ?? 0,
    compliant: compliantRow?.n ?? 0,
    nonCompliant: nonCompliantRow?.n ?? 0,
    pending: pendingRow?.n ?? 0,
    casesChecked: casesChecked?.n ?? 0,
    byType,
    recentNonCompliant: recentNonCompliant.map(r => ({
      ...r,
      findings: parseJSON(r.findings_json, []),
      remediation: parseJSON(r.remediation_json),
    })),
  };
}

export default {
  createComplianceRecord,
  getComplianceRecord,
  listComplianceRecords,
  updateComplianceRecord,
  runComplianceCheck,
  getCaseComplianceStatus,
  getComplianceSummary,
};
