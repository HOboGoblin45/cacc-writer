/**
 * server/integrations/gmail.js
 * --------------------------------
 * Gmail integration via Google Gmail API (OAuth 2.0)
 * Scope: gmail.send only (minimal permissions)
 *
 * Setup: see docs/GMAIL_SETUP.md
 *
 * Env vars required:
 *   GMAIL_CLIENT_ID     — from Google Cloud Console
 *   GMAIL_CLIENT_SECRET — from Google Cloud Console
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:5178/api/gmail/callback';
const TOKEN_FILE = path.join(PROJECT_ROOT, 'credentials', 'gmail-token.json');

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token issuance every time
    scope: ['https://www.googleapis.com/auth/gmail.send'],
  });
}

export async function handleCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  log.info('gmail:authorized', { expiry: tokens.expiry_date });
  return tokens;
}

async function getAuthenticatedClient() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const client = getOAuth2Client();
  client.setCredentials(tokens);

  // Auto-refresh if expired
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    try {
      const { credentials } = await client.refreshAccessToken();
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(credentials, null, 2));
      client.setCredentials(credentials);
      log.info('gmail:token-refreshed');
    } catch (e) {
      log.warn('gmail:refresh-failed', { error: e.message });
      return null;
    }
  }
  return client;
}

/**
 * Send an email via Gmail API.
 * @param {object} opts
 * @param {string} opts.to       - Recipient email address
 * @param {string} opts.subject  - Email subject
 * @param {string} opts.body     - Plain text body
 * @param {string} [opts.cc]     - CC addresses (optional)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function sendEmail({ to, subject, body, cc = '' }) {
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return {
      ok: false,
      error: 'Gmail not connected. Use /api/gmail/connect to authorize.',
    };
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth });

    const headers = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].filter(Boolean);

    const message = [...headers, '', body].join('\r\n');
    const encoded = Buffer.from(message).toString('base64url');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    log.info('gmail:sent', { to, subject });
    return { ok: true };
  } catch (e) {
    log.warn('gmail:send-failed', { error: e.message });
    return { ok: false, error: e.message };
  }
}

export function isConnected() {
  return fs.existsSync(TOKEN_FILE);
}

export function disconnect() {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
    log.info('gmail:disconnected');
    return true;
  }
  return false;
}
