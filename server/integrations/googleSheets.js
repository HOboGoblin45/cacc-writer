/**
 * server/integrations/googleSheets.js
 * -------------------------------------
 * Google Sheets integration for logging new appraisal jobs.
 *
 * Setup: see docs/GOOGLE_SHEETS_SETUP.md
 *
 * CSV fallback always runs at data/job-log.csv, even without credentials.
 * Google Sheets logging is additive — if it fails, CSV already captured the row.
 *
 * Columns: date, orderID, borrower, address, formType, fee, lender,
 *           transactionType, deliveryDate, pipelineStage
 *
 * Env vars:
 *   GOOGLE_SHEET_ID                 — spreadsheet ID
 *   GOOGLE_SERVICE_ACCOUNT_PATH     — path to service account JSON key
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CSV_PATH = path.join(PROJECT_ROOT, 'data', 'job-log.csv');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDS_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
const SHEET_NAME = 'Appraisals';

const CSV_HEADERS = [
  'date',
  'orderID',
  'borrower',
  'address',
  'formType',
  'fee',
  'lender',
  'transactionType',
  'deliveryDate',
  'pipelineStage',
];

// ── Lazy sheets client ────────────────────────────────────────────────────────

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;
  if (!CREDS_PATH || !fs.existsSync(CREDS_PATH)) return null;
  try {
    const { google } = await import('googleapis');
    const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (e) {
    log.warn('google-sheets:auth-failed', { error: e.message });
    return null;
  }
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function ensureCsvFile() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
    fs.writeFileSync(CSV_PATH, CSV_HEADERS.join(',') + '\n', 'utf8');
  }
}

function logToCsv(extracted) {
  try {
    ensureCsvFile();
    const row = {
      date: new Date().toISOString().slice(0, 10),
      orderID: extracted.orderID || '',
      borrower: extracted.borrowerName || extracted.borrower1 || extracted.borrower || '',
      address: extracted.address || '',
      formType: extracted.formTypeCode || extracted.formType || '1004',
      fee: extracted.fee || '',
      lender: extracted.lenderName || '',
      transactionType: extracted.loanType || extracted.transactionType || '',
      deliveryDate: extracted.deliveryDate || extracted.dueDate || '',
      pipelineStage: 'Intake',
    };
    const line = CSV_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n';
    fs.appendFileSync(CSV_PATH, line, 'utf8');
    log.info('google-sheets:csv-logged', { address: row.address });
  } catch (err) {
    log.warn('google-sheets:csv-failed', { error: err.message });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log a new appraisal job to CSV (always) and Google Sheets (if configured).
 */
export async function logNewJob(extracted = {}) {
  // CSV fallback — always runs
  logToCsv(extracted);

  const client = await getClient();
  if (!client || !SHEET_ID) {
    log.info('google-sheets:skipped', { reason: 'not configured — logged to CSV only' });
    return false;
  }

  try {
    const row = [
      new Date().toLocaleDateString('en-US'),
      extracted.orderID || '',
      extracted.borrowerName || extracted.borrower1 || extracted.borrower || '',
      extracted.address || '',
      extracted.formTypeCode || extracted.formType || '',
      extracted.fee ? `$${extracted.fee}` : '',
      extracted.lenderName || '',
      extracted.loanType || extracted.transactionType || '',
      extracted.deliveryDate || extracted.dueDate || '',
      'Intake',
    ];

    await client.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });

    log.info('google-sheets:logged', { address: extracted.address });
    return true;
  } catch (e) {
    log.warn('google-sheets:append-failed', { error: e.message });
    return false;
  }
}

/**
 * Update the Pipeline Stage column for an existing row, matched by orderID or address.
 */
export async function updateJobStatus(caseId, status, extracted = {}) {
  const client = await getClient();
  if (!client || !SHEET_ID) return false;

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:J`,
    });
    const rows = res.data.values || [];
    const targetOrderId = String(extracted.orderID || '');
    const targetAddr = String(extracted.address || '').toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const rowOrderId = String(rows[i][1] || '');
      const rowAddr = String(rows[i][3] || '').toLowerCase();
      if (
        (targetOrderId && rowOrderId === targetOrderId) ||
        (targetAddr && rowAddr.includes(targetAddr.split(',')[0]))
      ) {
        await client.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!J${i + 1}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[status]] },
        });
        log.info('google-sheets:status-updated', { row: i + 1, status });
        return true;
      }
    }
  } catch (e) {
    log.warn('google-sheets:update-failed', { error: e.message });
  }
  return false;
}
