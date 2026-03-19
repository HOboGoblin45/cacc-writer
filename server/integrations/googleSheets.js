/**
 * server/integrations/googleSheets.js
 * -------------------------------------
 * Google Sheets integration for logging new appraisal jobs.
 *
 * Current state: CSV fallback only. The TODO below marks where the real
 * Google Sheets API call would go once credentials are configured.
 *
 * CSV file: data/job-log.csv
 * Columns: date, orderID, borrower, address, formType, fee, lender,
 *           transactionType, deliveryDate
 *
 * To enable real Google Sheets integration:
 * 1. Install: npm install googleapis
 * 2. Create a service account at console.cloud.google.com
 * 3. Share the target Google Sheet with the service account email
 * 4. Set env vars: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY_FILE
 * 5. Implement the TODO section below
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CSV_PATH = path.join(PROJECT_ROOT, 'data', 'job-log.csv');

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
];

/**
 * Escape a value for CSV output (handles commas, quotes, newlines).
 */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Ensure the CSV file exists with headers.
 */
function ensureCsvFile() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
    fs.writeFileSync(CSV_PATH, CSV_HEADERS.join(',') + '\n', 'utf8');
  }
}

/**
 * Append a row to the CSV fallback log.
 */
function appendToCsv(row) {
  ensureCsvFile();
  const line = CSV_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n';
  fs.appendFileSync(CSV_PATH, line, 'utf8');
}

/**
 * Log a new appraisal job.
 *
 * @param {Object} extracted - The parsed order data from orderParser / intake route.
 *   Expected fields: orderID, borrowerName, address, formTypeCode, fee,
 *                    lenderName, loanType (transaction type), deliveryDate.
 */
export async function logNewJob(extracted = {}) {
  const row = {
    date: new Date().toISOString().slice(0, 10),
    orderID: extracted.orderID || '',
    borrower: extracted.borrowerName || '',
    address: extracted.address || '',
    formType: extracted.formTypeCode || extracted.formType || '1004',
    fee: extracted.fee || '',
    lender: extracted.lenderName || '',
    transactionType: extracted.loanType || extracted.transactionType || '',
    deliveryDate: extracted.deliveryDate || extracted.dueDate || '',
  };

  // Console log for visibility
  console.log('[googleSheets] Logging new job:', row);

  // CSV fallback — always runs, even without Sheets credentials
  try {
    appendToCsv(row);
    console.log(`[googleSheets] Job logged to CSV: ${CSV_PATH}`);
  } catch (err) {
    console.error('[googleSheets] Failed to write CSV:', err.message);
  }

  // TODO: Google Sheets API integration
  // Uncomment and configure when credentials are ready:
  //
  // const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
  // const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  // if (SHEET_ID && KEY_FILE) {
  //   try {
  //     const { google } = await import('googleapis');
  //     const auth = new google.auth.GoogleAuth({
  //       keyFile: KEY_FILE,
  //       scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  //     });
  //     const sheets = google.sheets({ version: 'v4', auth });
  //     await sheets.spreadsheets.values.append({
  //       spreadsheetId: SHEET_ID,
  //       range: 'Sheet1!A:I',
  //       valueInputOption: 'USER_ENTERED',
  //       resource: {
  //         values: [CSV_HEADERS.map(h => row[h] || '')],
  //       },
  //     });
  //     console.log('[googleSheets] Job logged to Google Sheets');
  //   } catch (err) {
  //     console.error('[googleSheets] Google Sheets API error:', err.message);
  //     // CSV already written above, so no data is lost
  //   }
  // }
}
