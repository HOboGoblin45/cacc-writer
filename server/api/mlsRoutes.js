/**
 * server/api/mlsRoutes.js
 * MLS integration + AI comp selection endpoints.
 * Includes MLS Grid API key management and comp search.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { registerMlsConnection, searchComps, importListings, getListingHistory, MLS_PROVIDERS } from '../integrations/mlsConnector.js';
import { selectComps, recordCompPreference } from '../ai/compSelectionEngine.js';
import { getDb } from '../db/database.js';
import log from '../logger.js';

const router = Router();

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const mlsConnectionSchema = z.object({
  provider: z.string().min(1).optional(),
  apiKey: z.string().min(1),
  mlsName: z.string().min(1).optional(),
});

const mlsSearchSchema = z.object({
  city: z.string().min(1).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional().default(100000),
  status: z.string().min(1).optional().default('Closed'),
  radius: z.coerce.number().nonnegative().optional(),
  address: z.string().optional(),
  filters: z.object({
    maxPrice: z.coerce.number().int().optional(),
    bedsMin: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().optional(),
  }).optional().default({}),
});

const mlsImportSchema = z.object({
  listings: z.array(z.any()).optional().default([]),
});

const compSelectionSchema = z.object({
  // AI comp selection payload
}).passthrough();

const compPreferenceSchema = z.object({
  mlsNumber: z.string().min(1),
  action: z.enum(['accept', 'reject']),
  reason: z.string().optional(),
});

const historyQuerySchema = z.object({
  address: z.string().optional().default(''),
});

const connectionIdSchema = z.object({
  connectionId: z.string().min(1),
});

const caseIdSchema = CommonSchemas.caseId;

// GET /mls/providers
router.get('/mls/providers', (_req, res) => {
  res.json({ ok: true, providers: Object.entries(MLS_PROVIDERS).map(([k, v]) => ({ id: k, ...v })) });
});

// POST /mls/connections — register MLS connection
router.post('/mls/connections', authMiddleware, validateBody(mlsConnectionSchema), (req, res) => {
  try {
    const result = registerMlsConnection(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /mls/:connectionId/search — search comps from MLS
router.post('/mls/:connectionId/search', authMiddleware, validateParams(connectionIdSchema), validateBody(mlsSearchSchema), async (req, res) => {
  try {
    const results = await searchComps(req.validatedParams.connectionId, req.validated);
    res.json({ ok: true, ...results });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /mls/:connectionId/import — bulk import listings
router.post('/mls/:connectionId/import', authMiddleware, validateParams(connectionIdSchema), validateBody(mlsImportSchema), (req, res) => {
  try {
    const result = importListings(req.validatedParams.connectionId, req.validated.listings);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /mls/:connectionId/history — listing history for an address
router.get('/mls/:connectionId/history', authMiddleware, validateParams(connectionIdSchema), validateQuery(historyQuerySchema), (req, res) => {
  const history = getListingHistory(req.validatedParams.connectionId, req.validatedQuery.address);
  res.json({ ok: true, history });
});

// POST /cases/:id/comp-selection — AI comp selection
router.post('/cases/:id/comp-selection', authMiddleware, validateParams(CommonSchemas.id), validateBody(compSelectionSchema), async (req, res) => {
  try {
    const result = await selectComps(req.validatedParams.id, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/comp-preference — record accept/reject
router.post('/cases/:id/comp-preference', authMiddleware, validateParams(CommonSchemas.id), validateBody(compPreferenceSchema), (req, res) => {
  recordCompPreference(req.user.userId, req.validatedParams.id, req.validated.mlsNumber, req.validated.action, req.validated.reason);
  res.json({ ok: true });
});

// ── MLS Grid Settings ─────────────────────────────────────────────────────────

const settingsMlsSchema = z.object({
  provider: z.string().min(1).optional().default('mlsgrid'),
  apiKey: z.string().min(1),
  mlsName: z.string().min(1).optional().default('MRED'),
});

const searchCompsSchema = z.object({
  city: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional().default(100000),
  status: z.string().optional().default('Closed'),
  radius: z.coerce.number().nonnegative().optional(),
  address: z.string().optional(),
  filters: z.object({
    maxPrice: z.coerce.number().int().optional(),
    bedsMin: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().optional(),
  }).optional().default({}),
});

// POST /settings/mls — save and validate MLS Grid API key
router.post('/settings/mls', authMiddleware, validateBody(settingsMlsSchema), async (req, res) => {
  try {
    const { provider, apiKey, mlsName } = req.validated;
    if (!apiKey) return res.status(400).json({ ok: false, error: 'apiKey is required' });

    // Validate by hitting MLS Grid
    let testResult = 'Unknown';
    let valid = false;
    try {
      const testRes = await fetch('https://api.mlsgrid.com/v2/Property?$top=1', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (testRes.ok) {
        const data = await testRes.json();
        const count = data['@odata.count'] || (data.value ? data.value.length : 0);
        testResult = `Connected — ${count > 0 ? count + ' listings available' : 'connection verified'}`;
        valid = true;
      } else if (testRes.status === 401 || testRes.status === 403) {
        testResult = 'Invalid API key — unauthorized';
      } else {
        testResult = `MLS Grid returned ${testRes.status}`;
      }
    } catch (fetchErr) {
      testResult = `Could not reach MLS Grid: ${fetchErr.message}`;
    }

    if (valid) {
      const db = getDb();
      // Store base64-encoded key in settings
      const encoded = Buffer.from(apiKey).toString('base64');
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
          key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now'))
        )`);
      } catch { /* already exists */ }
      db.prepare(`INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`)
        .run('mls_api_key', encoded);
      db.prepare(`INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`)
        .run('mls_provider', provider);
      db.prepare(`INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`)
        .run('mls_name', mlsName);
      db.prepare(`INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`)
        .run('mls_last_sync', new Date().toISOString());
      log.info('mls:key-saved', { provider, mlsName });
    }

    res.json({ ok: true, valid, mlsName, testResult });
  } catch (err) {
    log.error('mls:settings-save-failed', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /settings/mls — get MLS connection status
router.get('/settings/mls', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now'))
      )`);
    } catch { /* already exists */ }
    const getSetting = (key) => {
      const row = db.prepare('SELECT value FROM user_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    };
    const apiKeyEncoded = getSetting('mls_api_key');
    res.json({
      ok: true,
      connected: Boolean(apiKeyEncoded),
      provider: getSetting('mls_provider') || 'mlsgrid',
      mlsName: getSetting('mls_name') || null,
      lastSync: getSetting('mls_last_sync') || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/search-comps — search MLS for comparable sales
router.post('/cases/:caseId/search-comps', authMiddleware, validateParams(caseIdSchema), validateBody(searchCompsSchema), async (req, res) => {
  try {
    const { city, minPrice, status, radius, address, filters } = req.validated;

    // Get stored API key
    const db = getDb();
    let apiKey = null;
    try {
      const row = db.prepare("SELECT value FROM user_settings WHERE key = 'mls_api_key'").get();
      if (row) apiKey = Buffer.from(row.value, 'base64').toString('utf8');
    } catch { /* no key */ }

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'No MLS API key configured. Set one via POST /api/settings/mls.' });
    }

    // Build OData filter
    const filterParts = [`StandardStatus eq '${status}'`];
    if (city) filterParts.push(`City eq '${city}'`);
    if (minPrice) filterParts.push(`ClosePrice gt ${minPrice}`);
    if (filters.maxPrice) filterParts.push(`ClosePrice lt ${filters.maxPrice}`);
    if (filters.bedsMin) filterParts.push(`BedroomsTotal ge ${filters.bedsMin}`);

    const filterStr = filterParts.join(' and ');
    const url = `https://api.mlsgrid.com/v2/Property?$filter=${encodeURIComponent(filterStr)}&$top=${filters.limit || 20}`;

    const mlsRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!mlsRes.ok) {
      return res.status(mlsRes.status).json({ ok: false, error: `MLS Grid error: ${mlsRes.status}` });
    }

    const data = await mlsRes.json();
    const listings = (data.value || []).map(p => ({
      mlsNumber: p.ListingId,
      address: `${p.StreetNumber || ''} ${p.StreetName || ''} ${p.StreetSuffix || ''}`.trim(),
      city: p.City,
      state: p.StateOrProvince,
      zip: p.PostalCode,
      closePrice: p.ClosePrice,
      closeDate: p.CloseDate,
      gla: p.LivingArea,
      beds: p.BedroomsTotal,
      baths: p.BathroomsTotalInteger,
      yearBuilt: p.YearBuilt,
      propertyType: p.PropertyType,
      status: p.StandardStatus,
    }));

    log.info('mls:comp-search', { caseId: req.validatedParams.caseId, count: listings.length, filter: filterStr });
    res.json({ ok: true, count: listings.length, comps: listings, filter: filterStr });
  } catch (err) {
    log.error('mls:comp-search-failed', { caseId: req.validatedParams.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
