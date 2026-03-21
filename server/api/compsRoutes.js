/**
 * server/api/compsRoutes.js
 * ---------------------------
 * Routes for comp import, photo scanning, MRED OAuth, and comp guidance.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   GET  /api/cases/:caseId/photos          — scan Dropbox for property photos
 *   POST /api/cases/:caseId/import-comps    — import MRED CSV comps into case
 *   GET  /api/cases/:caseId/comp-guidance   — comp selection guidance from learned patterns
 *   POST /api/cases/:caseId/mred-search     — live MRED API comp search
 *   GET  /api/mred/status                   — MRED connection status
 *   GET  /api/mred/connect                  — start OAuth flow (redirect to MRED)
 *   GET  /api/mred/callback                 — OAuth callback (exchange code for token)
 *   POST /api/mred/disconnect               — clear saved token
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';

import { casePath } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { scanDropboxForPhotos } from '../integrations/photoScanner.js';
import { parseMredCsv, formatCompForDisplay } from '../comparables/mredCsvParser.js';
import { extractCompPatterns, saveCompPatterns, getCompGuidance } from '../comparables/compPatternLearner.js';
import {
  isConnected,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  clearToken,
  searchComps as mredSearchComps,
  MRED_REDIRECT_URI,
} from '../integrations/mredApi.js';
import { geocodeAddress, distanceMiles, cardinalDirection } from '../geocoder.js';
import log from '../logger.js';
import { sendErrorResponse } from '../utils/errorResponse.js';

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function getSubjectGla(projection) {
  const facts = projection?.facts || {};
  return parseFloat(
    facts?.subject?.gla?.value ||
    facts?.gla ||
    0
  ) || 0;
}

function getSubjectCoords(caseId) {
  const cd = casePath(caseId);
  const geo = readJSON(path.join(cd, 'geocode.json'), null);
  return geo?.subject?.result || null;
}

// ── Photos ────────────────────────────────────────────────────────────────────

/**
 * GET /api/cases/:caseId/photos
 * Scan Dropbox for photos matching this case's borrower/address.
 */
router.get('/cases/:caseId/photos', (req, res) => {
  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const meta         = projection.meta || {};
    const borrowerName = meta.borrower || '';
    const address      = meta.address  || '';

    const result = scanDropboxForPhotos(borrowerName, address);

    res.json({
      ok: true,
      ...result,
      dropboxPath: process.env.DROPBOX_PATH || 'C:\\Users\\ccres\\Dropbox',
    });
  } catch (err) {
    log.error('photos:scan', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── MRED CSV Import ───────────────────────────────────────────────────────────

/**
 * POST /api/cases/:caseId/import-comps
 * Upload an MRED CSV file, parse comps, geocode distances, save to case.
 */
router.post('/cases/:caseId/import-comps', upload.single('file'), async (req, res) => {
  try {
    const { caseId } = req.params;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'CSV file required (multipart field: file)' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.csv') {
      return res.status(415).json({ ok: false, error: 'Only .csv files accepted' });
    }

    const csvText = await readUploadedFile(req.file, 'utf8');
    let comps;
    try {
      comps = parseMredCsv(csvText);
    } catch (parseErr) {
      return res.status(422).json({ ok: false, error: `CSV parse error: ${parseErr.message}` });
    }

    if (comps.length === 0) {
      return res.status(422).json({ ok: false, error: 'No comp records found in CSV. Check that the file is a valid MRED export.' });
    }

    // Get subject coordinates for distance calculation
    const subjectCoords = getSubjectCoords(caseId);
    const subjectGla    = getSubjectGla(projection);

    // Geocode comps in background and calculate distances
    const geocodedComps = [...comps];
    if (subjectCoords?.lat && subjectCoords?.lng) {
      for (let i = 0; i < geocodedComps.length; i++) {
        const comp = geocodedComps[i];
        if (!comp.address) continue;
        try {
          const result = await geocodeAddress(comp.address);
          if (result?.lat && result?.lng) {
            const dist = distanceMiles(subjectCoords.lat, subjectCoords.lng, result.lat, result.lng);
            const dir  = cardinalDirection(subjectCoords.lat, subjectCoords.lng, result.lat, result.lng);
            geocodedComps[i] = {
              ...comp,
              distanceMiles: Math.round(dist * 100) / 100,
              cardinalDir:   dir,
              proximity:     `${dist.toFixed(2)} miles ${dir}`.trim(),
              lat:           result.lat,
              lng:           result.lng,
            };
          }
        } catch { /* non-fatal — skip geocoding for this comp */ }
      }
    }

    // Save comps to case
    const cd = casePath(caseId);
    writeJSON(path.join(cd, 'mred_comps.json'), {
      importedAt: new Date().toISOString(),
      source: 'mred-csv',
      filename: req.file.originalname,
      comps: geocodedComps,
    });

    // Update facts with comp data
    const facts = projection.facts || {};
    facts.importedComps = geocodedComps.map(c => ({
      mlsNumber:   c.mlsNumber,
      address:     c.address,
      salePrice:   c.salePrice,
      saleDate:    c.saleDate,
      gla:         c.gla,
      beds:        c.beds,
      baths:       c.baths,
      yearBuilt:   c.yearBuilt,
      distanceMiles: c.distanceMiles,
      proximity:   c.proximity,
    }));
    facts.updatedAt = new Date().toISOString();

    saveCaseProjection({ ...projection, facts });

    // Learn comp patterns
    if (subjectGla > 0) {
      const formType = projection.meta?.formType || '1004';
      const patterns = extractCompPatterns(facts, geocodedComps);
      if (patterns) saveCompPatterns(formType, patterns);
    }

    // Format for display
    const displayComps = geocodedComps.map(c => formatCompForDisplay(c, subjectGla));

    log.info('comps:imported', { caseId, count: comps.length, source: 'mred-csv' });

    res.json({
      ok: true,
      count: comps.length,
      comps: displayComps,
      geocoded: geocodedComps.filter(c => c.distanceMiles !== null).length,
      filename: req.file.originalname,
    });
  } catch (err) {
    log.error('comps:import-csv', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Comp Guidance ─────────────────────────────────────────────────────────────

/**
 * GET /api/cases/:caseId/comp-guidance
 * Return learned comp selection guidance for this case's form type.
 */
router.get('/cases/:caseId/comp-guidance', (req, res) => {
  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const formType = projection.meta?.formType || '1004';
    const facts    = projection.facts || {};
    const guidance = getCompGuidance(formType, facts);

    res.json({
      ok:       true,
      formType,
      guidance,
      hasData:  !!guidance,
      message:  guidance
        ? `Based on ${guidance.basedOnReports} report(s) — ${guidance.confidence} confidence`
        : 'Not enough data yet. Import comps from a few cases to build guidance.',
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

// ── MRED Live Search ──────────────────────────────────────────────────────────

/**
 * POST /api/cases/:caseId/mred-search
 * Search MRED API for comps matching criteria.
 */
router.post('/cases/:caseId/mred-search', async (req, res) => {
  try {
    const { caseId } = req.params;
    const projection = getCaseProjection(caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    if (!isConnected()) {
      return res.status(401).json({
        ok: false,
        error: 'Not connected to MRED. Go to System tab → Connect MRED.',
        needsAuth: true,
      });
    }

    const {
      minPrice, maxPrice, minGla, maxGla,
      minBeds, city, state, maxDaysOld = 365, top = 20,
    } = req.body || {};

    const result = await mredSearchComps({ minPrice, maxPrice, minGla, maxGla, minBeds, city, state, maxDaysOld, top });
    if (!result.ok) return res.status(502).json({ ok: false, error: result.error, needsAuth: result.needsReauth });

    // Calculate distances if subject is geocoded
    const subjectCoords = getSubjectCoords(caseId);
    const subjectGla    = getSubjectGla(projection);

    const comps = result.comps.map(comp => {
      // Distance calc will be rough without geocoding each comp — skip for live search
      return formatCompForDisplay(comp, subjectGla);
    });

    log.info('comps:mred-search', { caseId, count: comps.length });
    res.json({ ok: true, comps, count: result.count });
  } catch (err) {
    log.error('comps:mred-search', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── MRED OAuth ────────────────────────────────────────────────────────────────

/**
 * GET /api/mred/status
 * Returns current MRED connection status.
 */
router.get('/mred/status', (req, res) => {
  const connected = isConnected();
  res.json({
    ok:        true,
    connected,
    configured: !!(process.env.MRED_CLIENT_ID && process.env.MRED_CLIENT_SECRET),
    redirectUri: MRED_REDIRECT_URI,
  });
});

/**
 * GET /api/mred/connect
 * Redirect the browser to MRED's OAuth authorize page.
 */
router.get('/mred/connect', (req, res) => {
  const url = buildAuthorizeUrl();
  if (!url) {
    return res.status(400).json({
      ok:    false,
      error: 'MRED_CLIENT_ID not configured. See docs/MRED_API_SETUP.md',
    });
  }
  res.redirect(url);
});

/**
 * GET /api/mred/callback
 * OAuth redirect handler. Exchanges code for token, redirects to UI.
 */
router.get('/mred/callback', async (req, res) => {
  const { code, error: oauthError, state } = req.query;

  if (oauthError) {
    log.warn('mred:oauth-error', { error: oauthError });
    return res.redirect('/?mred_error=' + encodeURIComponent(oauthError) + '#system');
  }

  if (!code) {
    return res.redirect('/?mred_error=no_code#system');
  }

  const result = await exchangeCodeForToken(code);
  if (!result.ok) {
    log.warn('mred:token-exchange-failed', { error: result.error });
    return res.redirect('/?mred_error=' + encodeURIComponent(result.error) + '#system');
  }

  log.info('mred:connected');
  // Redirect to system tab with success indicator
  res.redirect('/?mred_connected=1#system');
});

/**
 * POST /api/mred/disconnect
 * Clear the saved MRED token.
 */
router.post('/mred/disconnect', (req, res) => {
  clearToken();
  log.info('mred:disconnected');
  res.json({ ok: true, message: 'MRED disconnected' });
});

export default router;
