/**
 * server/comparableIntelligence/incomeApproachService.js
 * -------------------------------------------------------
 * Income Approach Service — manages rent comps, GRM calculation,
 * expense worksheet, NOI, and income-indicated value.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function ensureRecord(caseId) {
  const existing = dbGet(`SELECT id FROM income_approach_data WHERE case_id = ?`, [caseId]);
  if (!existing) {
    dbRun(`
      INSERT INTO income_approach_data (id, case_id)
      VALUES (?, ?)
    `, [uuidv4(), caseId]);
  }
}

// ── getIncomeAnalysis ────────────────────────────────────────────────────────

/**
 * Get the full income approach workspace data for a case.
 */
export function getIncomeAnalysis(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT * FROM income_approach_data WHERE case_id = ?`, [caseId]);

  return {
    id: row.id,
    caseId: row.case_id,
    rentComps: safeParseJSON(row.rent_comps_json, []),
    monthlyMarketRent: row.monthly_market_rent,
    grm: row.grm,
    expenses: safeParseJSON(row.expenses_json, {}),
    grossIncome: row.gross_income,
    netIncome: row.net_income,
    indicatedValue: row.indicated_value,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── saveRentComps ────────────────────────────────────────────────────────────

/**
 * Save rent comparable array.
 * Each entry: { address, monthlyRent, gla, rentPerSqft, bedrooms, bathrooms, proximity, adjustedRent }
 */
export function saveRentComps(caseId, rentComps) {
  if (!caseId) throw new Error('caseId is required');
  if (!Array.isArray(rentComps)) throw new Error('rentComps must be an array');
  ensureRecord(caseId);

  const now = new Date().toISOString();
  const json = JSON.stringify(rentComps);

  // Derive monthly market rent from average of adjustedRent (or monthlyRent if no adjusted)
  const rents = rentComps
    .map(rc => rc.adjustedRent ?? rc.monthlyRent)
    .filter(r => r != null && !isNaN(r));
  const monthlyMarketRent = rents.length > 0
    ? Math.round(rents.reduce((a, b) => a + b, 0) / rents.length)
    : null;

  dbRun(`
    UPDATE income_approach_data
       SET rent_comps_json = ?,
           monthly_market_rent = ?,
           updated_at = ?
     WHERE case_id = ?
  `, [json, monthlyMarketRent, now, caseId]);

  log.info('income:saveRentComps', { caseId, count: rentComps.length, monthlyMarketRent });
  return { success: true, caseId, rentCompCount: rentComps.length, monthlyMarketRent };
}

// ── calculateGRM ─────────────────────────────────────────────────────────────

/**
 * Calculate GRM from the rent comps.
 * GRM = sale price / monthly rent (averaged across comps that have both values).
 */
export function calculateGRM(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT rent_comps_json FROM income_approach_data WHERE case_id = ?`, [caseId]);
  const rentComps = safeParseJSON(row?.rent_comps_json, []);

  const grms = rentComps
    .filter(rc => rc.salePrice > 0 && rc.monthlyRent > 0)
    .map(rc => rc.salePrice / rc.monthlyRent);

  const grm = grms.length > 0
    ? Math.round((grms.reduce((a, b) => a + b, 0) / grms.length) * 100) / 100
    : null;

  const now = new Date().toISOString();
  dbRun(`
    UPDATE income_approach_data
       SET grm = ?, updated_at = ?
     WHERE case_id = ?
  `, [grm, now, caseId]);

  log.info('income:calculateGRM', { caseId, grm, sampleSize: grms.length });
  return { caseId, grm, sampleSize: grms.length };
}

// ── saveExpenseWorksheet ─────────────────────────────────────────────────────

/**
 * Save operating expenses.
 * { taxes, insurance, maintenance, utilities, management, vacancy, reserves, other }
 */
export function saveExpenseWorksheet(caseId, expenses) {
  if (!caseId) throw new Error('caseId is required');
  if (!expenses || typeof expenses !== 'object') throw new Error('expenses must be an object');
  ensureRecord(caseId);

  const now = new Date().toISOString();
  const json = JSON.stringify(expenses);

  dbRun(`
    UPDATE income_approach_data
       SET expenses_json = ?, updated_at = ?
     WHERE case_id = ?
  `, [json, now, caseId]);

  log.info('income:saveExpenses', { caseId });
  return { success: true, caseId };
}

// ── calculateNetIncome ───────────────────────────────────────────────────────

/**
 * Calculate NOI from gross rent minus expenses.
 */
export function calculateNetIncome(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT monthly_market_rent, expenses_json FROM income_approach_data WHERE case_id = ?`, [caseId]);
  const monthlyRent = row?.monthly_market_rent ?? 0;
  const grossIncome = monthlyRent * 12;
  const expenses = safeParseJSON(row?.expenses_json, {});

  const totalExpenses = Object.values(expenses)
    .filter(v => typeof v === 'number' && !isNaN(v))
    .reduce((a, b) => a + b, 0);

  const netIncome = grossIncome - totalExpenses;

  const now = new Date().toISOString();
  dbRun(`
    UPDATE income_approach_data
       SET gross_income = ?, net_income = ?, updated_at = ?
     WHERE case_id = ?
  `, [grossIncome, netIncome, now, caseId]);

  log.info('income:calculateNetIncome', { caseId, grossIncome, totalExpenses, netIncome });
  return { caseId, grossIncome, totalExpenses, netIncome };
}

// ── getIncomeIndicatedValue ──────────────────────────────────────────────────

/**
 * Calculate indicated value via income approach: GRM * monthly market rent.
 */
export function getIncomeIndicatedValue(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT grm, monthly_market_rent FROM income_approach_data WHERE case_id = ?`, [caseId]);
  const grm = row?.grm;
  const monthlyRent = row?.monthly_market_rent;

  const indicatedValue = (grm != null && monthlyRent != null)
    ? Math.round(grm * monthlyRent)
    : null;

  const now = new Date().toISOString();
  dbRun(`
    UPDATE income_approach_data
       SET indicated_value = ?, updated_at = ?
     WHERE case_id = ?
  `, [indicatedValue, now, caseId]);

  log.info('income:indicatedValue', { caseId, grm, monthlyRent, indicatedValue });
  return { caseId, grm, monthlyRent, indicatedValue };
}

// ── Default export ───────────────────────────────────────────────────────────

export default {
  getIncomeAnalysis,
  saveRentComps,
  calculateGRM,
  saveExpenseWorksheet,
  calculateNetIncome,
  getIncomeIndicatedValue,
};
