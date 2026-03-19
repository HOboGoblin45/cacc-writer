/**
 * server/integrations/mredApi.js
 * --------------------------------
 * MRED RESO Web API Client
 * Docs: MRED Web API Technical Documentation V1.0
 * Auth: OpenID Connect / OAuth 2.0
 * Queries: OData protocol
 *
 * Setup: see docs/MRED_API_SETUP.md
 *
 * Env vars required:
 *   MRED_CLIENT_ID      — from retssupport@mredllc.com
 *   MRED_CLIENT_SECRET  — from retssupport@mredllc.com
 *   MRED_ACCESS_TOKEN   — set automatically after OAuth callback
 *   MRED_REFRESH_TOKEN  — set automatically after OAuth callback
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const TOKEN_FILE = path.join(PROJECT_ROOT, 'data', 'mred-token.json');

// ── MRED API constants ────────────────────────────────────────────────────────

const MRED_BASE     = 'https://connectmls-api.mredllc.com/reso/odata';
const MRED_AUTH     = 'https://connectmls-api.mredllc.com/oid/authorize';
const MRED_TOKEN    = 'https://connectmls-api.mredllc.com/oid/token';
const MRED_USERINFO = 'https://connectmls-api.mredllc.com/oid/userinfo';

// The redirect URI registered with MRED (must match what was emailed to them)
export const MRED_REDIRECT_URI = 'http://localhost:5178/api/mred/callback';

// ── Token management ──────────────────────────────────────────────────────────

export function loadToken() {
  // Prefer env var (set at startup), fall back to token file
  if (process.env.MRED_ACCESS_TOKEN) {
    return {
      access_token:  process.env.MRED_ACCESS_TOKEN,
      refresh_token: process.env.MRED_REFRESH_TOKEN || null,
    };
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function saveToken(tokenData) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), 'utf8');
  // Also update in-process env so getToken() works without restart
  process.env.MRED_ACCESS_TOKEN  = tokenData.access_token;
  if (tokenData.refresh_token) process.env.MRED_REFRESH_TOKEN = tokenData.refresh_token;
  log.info('mred:token-saved', { expires_in: tokenData.expires_in });
}

export function clearToken() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
  delete process.env.MRED_ACCESS_TOKEN;
  delete process.env.MRED_REFRESH_TOKEN;
}

export function isConnected() {
  return !!loadToken()?.access_token;
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

/**
 * Build the OAuth authorize URL to open in the browser.
 * Charles clicks "Connect MRED" → this URL opens → he logs in →
 * MRED redirects to /api/mred/callback with ?code=...
 */
export function buildAuthorizeUrl(state = 'cacc') {
  const clientId = process.env.MRED_CLIENT_ID;
  if (!clientId) return null;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  MRED_REDIRECT_URI,
    scope:         'openid profile email',
    state,
  });
  return `${MRED_AUTH}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called by the /api/mred/callback route.
 */
export async function exchangeCodeForToken(code) {
  const clientId     = process.env.MRED_CLIENT_ID;
  const clientSecret = process.env.MRED_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { ok: false, error: 'MRED_CLIENT_ID or MRED_CLIENT_SECRET not configured' };
  }

  try {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  MRED_REDIRECT_URI,
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const res = await fetch(MRED_TOKEN, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Token exchange failed: ${res.status} — ${text}` };
    }

    const tokenData = await res.json();
    tokenData.saved_at = new Date().toISOString();
    saveToken(tokenData);
    return { ok: true, tokenData };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── RESO OData queries ────────────────────────────────────────────────────────

/**
 * Search for closed comparable sales via MRED RESO API.
 *
 * @param {Object} params
 * @param {number} [params.minPrice]
 * @param {number} [params.maxPrice]
 * @param {number} [params.minGla]
 * @param {number} [params.maxGla]
 * @param {number} [params.minBeds]
 * @param {string} [params.city]
 * @param {string} [params.state]
 * @param {number} [params.maxDaysOld=365]
 * @param {number} [params.top=20]
 */
export async function searchComps({
  minPrice,
  maxPrice,
  minGla,
  maxGla,
  minBeds,
  city,
  state,
  maxDaysOld = 365,
  top = 20,
} = {}) {
  const token = loadToken();
  if (!token?.access_token) {
    return { ok: false, error: 'Not connected to MRED. Click "Connect MRED" to authorize.' };
  }

  const cutoffDate = new Date(Date.now() - maxDaysOld * 86_400_000).toISOString().split('T')[0];

  const filters = [
    `MlsStatus eq 'Closed'`,
    `CloseDate ge ${cutoffDate}`,
    minPrice != null ? `ClosePrice ge ${minPrice}` : null,
    maxPrice != null ? `ClosePrice le ${maxPrice}` : null,
    minGla   != null ? `LivingArea ge ${minGla}`   : null,
    maxGla   != null ? `LivingArea le ${maxGla}`   : null,
    minBeds  != null ? `BedroomsTotal ge ${minBeds}` : null,
    city     ? `City eq '${city.replace(/'/g, "''")}'` : null,
    state    ? `StateOrProvince eq '${state.replace(/'/g, "''")}'` : null,
  ].filter(Boolean).join(' and ');

  const select = [
    'ListingId', 'UnparsedAddress', 'City', 'StateOrProvince',
    'ClosePrice', 'CloseDate', 'ListPrice',
    'BedroomsTotal', 'BathroomsTotalInteger',
    'LivingArea', 'YearBuilt', 'GarageSpaces',
    'BelowGradeFinishedArea', 'LotSizeAcres',
    'ArchitecturalStyle', 'SubdivisionName',
    'ConcessionComments', 'PublicRemarks',
  ].join(',');

  const url = `${MRED_BASE}/Property?$filter=${encodeURIComponent(filters)}&$select=${select}&$top=${top}&$orderby=CloseDate desc&$count=true`;

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (res.status === 401) {
      clearToken();
      return { ok: false, error: 'MRED token expired. Please reconnect.', needsReauth: true };
    }
    if (!res.ok) {
      return { ok: false, error: `MRED API error: ${res.status} ${res.statusText}` };
    }

    const data = await res.json();
    const comps = (data.value || []).map(normalizeResoComp);
    return { ok: true, comps, count: data['@odata.count'] || comps.length };
  } catch (e) {
    log.warn('mred:search-failed', { error: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Look up a single property by MLS listing ID.
 */
export async function getCompByMlsNumber(mlsNumber) {
  const token = loadToken();
  if (!token?.access_token) {
    return { ok: false, error: 'Not connected to MRED.' };
  }

  const url = `${MRED_BASE}/Property?$filter=ListingId eq '${mlsNumber}'`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token.access_token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `MRED API error: ${res.status}` };
    const data = await res.json();
    const items = (data.value || []).map(normalizeResoComp);
    return { ok: true, comp: items[0] || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── RESO field normalizer ─────────────────────────────────────────────────────

function normalizeResoComp(r) {
  return {
    mlsNumber:     r.ListingId || '',
    address:       [r.UnparsedAddress, r.City, r.StateOrProvince].filter(Boolean).join(', '),
    salePrice:     r.ClosePrice  || 0,
    listPrice:     r.ListPrice   || 0,
    saleDate:      r.CloseDate   || '',
    beds:          r.BedroomsTotal || 0,
    baths:         r.BathroomsTotalInteger || 0,
    gla:           r.LivingArea  || 0,
    yearBuilt:     r.YearBuilt   || 0,
    garage:        r.GarageSpaces ? `${r.GarageSpaces} car` : '',
    basement:      r.BelowGradeFinishedArea ? `${r.BelowGradeFinishedArea} sf finished` : '',
    lotSize:       r.LotSizeAcres ? `${r.LotSizeAcres} ac` : '',
    style:         r.ArchitecturalStyle || '',
    subdivision:   r.SubdivisionName || '',
    concessions:   0,
    remarks:       r.PublicRemarks || '',
    distanceMiles: null,
    cardinalDir:   '',
    proximity:     '',
    source:        'mred-api',
  };
}
