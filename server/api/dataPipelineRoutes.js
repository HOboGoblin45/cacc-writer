/**
 * server/api/dataPipelineRoutes.js
 * ----------------------------------------
 * Express Router for Cloudflare Browser Rendering data pipeline endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST   /data-pipeline/test-connection              — Test Cloudflare credentials
 *   POST   /data-pipeline/crawl/start                  — Start an async crawl job
 *   GET    /data-pipeline/crawl/:jobId/status           — Poll crawl job status
 *   GET    /data-pipeline/crawl/:jobId/results          — Get crawl results (with pagination)
 *   DELETE /data-pipeline/crawl/:jobId                  — Cancel a crawl job
 *   POST   /data-pipeline/crawl-and-wait                — Start crawl and wait for completion
 *   POST   /data-pipeline/extract-json                  — Single-page JSON extraction (/json endpoint)
 *   POST   /data-pipeline/map-to-adm                   — Map extracted data to ADM format
 *   POST   /data-pipeline/detect-conflicts              — Detect conflicts between sources
 *   POST   /data-pipeline/analyze-comps                 — Run CompAnalyzer on subject + comps
 *   GET    /data-pipeline/presets                        — Get available crawl presets
 *   PUT    /data-pipeline/presets/:presetId              — Create/update a custom preset
 *   DELETE /data-pipeline/presets/:presetId              — Delete a custom preset
 *   GET    /data-pipeline/usage                          — Get session usage statistics
 *   GET    /data-pipeline/cache/stats                    — Get cache statistics
 *   DELETE /data-pipeline/cache                          — Clear cache
 *   POST   /data-pipeline/push-to-case/:caseId           — Push extracted + mapped data to case facts
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';

import { CloudflareCrawler, SCHEMAS, EXTRACTION_PROMPTS, CRAWL_PRESETS } from '../dataPipeline/cloudflareCrawler.js';
import { ADMMapper } from '../dataPipeline/admMapper.js';
import { CompAnalyzer } from '../dataPipeline/compAnalyzer.js';
import { CrawlCache } from '../dataPipeline/crawlCache.js';

import {
  getCaseProjection,
  saveCaseProjection,
} from '../caseRecord/caseRecordService.js';
import {
  detectChangedFactPaths,
  onFactsChanged,
} from '../services/sectionFreshnessService.js';

const router = Router();

// ── Singleton cache instance ─────────────────────────────────────────────────
const crawlCache = new CrawlCache();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const credentialsSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  apiToken: z.string().min(1, 'apiToken is required'),
});

const crawlStartSchema = credentialsSchema.extend({
  urls: z.array(z.string().url()).min(1, 'At least one URL is required'),
  preset: z.string().optional(),
  options: z.object({}).passthrough().optional(),
});

const crawlAndWaitSchema = crawlStartSchema.extend({
  timeoutMs: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
});

const extractJsonSchema = credentialsSchema.extend({
  url: z.string().url('A valid URL is required'),
  schema: z.object({}).passthrough().optional(),
  prompt: z.string().optional(),
});

const mapToAdmSchema = z.object({
  extracted: z.object({}).passthrough(),
  sourceUrl: z.string().optional(),
  mappingProfile: z.string().optional(),
});

const detectConflictsSchema = z.object({
  sources: z.array(z.object({}).passthrough()).min(2, 'At least two sources are required'),
});

const analyzeCompsSchema = z.object({
  subject: z.object({}).passthrough(),
  comps: z.array(z.object({}).passthrough()).min(1, 'At least one comp is required'),
  options: z.object({}).passthrough().optional(),
});

const presetSchema = z.object({
  name: z.string().min(1, 'Preset name is required'),
  config: z.object({}).passthrough(),
});

const pushToCaseSchema = z.object({
  facts: z.object({}).passthrough(),
  source: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    error: parsed.error.issues.map((i) => i.message).join('; '),
  });
  return null;
}

/**
 * Build a CloudflareCrawler from per-request credentials.
 * Returns null and sends 400 if credentials are missing.
 */
function buildCrawler(body, res) {
  const creds = parsePayload(credentialsSchema, body, res);
  if (!creds) return null;
  return new CloudflareCrawler(creds.accountId, creds.apiToken);
}

// ── POST /data-pipeline/test-connection ──────────────────────────────────────
router.post('/data-pipeline/test-connection', async (req, res) => {
  const crawler = buildCrawler(req.body, res);
  if (!crawler) return;

  try {
    const result = await crawler.testConnection();
    log.info('api:data-pipeline:test-connection', { ok: result.ok });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:data-pipeline:test-connection', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/crawl/start ──────────────────────────────────────────
router.post('/data-pipeline/crawl/start', async (req, res) => {
  const body = parsePayload(crawlStartSchema, req.body || {}, res);
  if (!body) return;

  try {
    const crawler = new CloudflareCrawler(body.accountId, body.apiToken);
    const url = Array.isArray(body.urls) ? body.urls[0] : body.urls;
    const job = await crawler.startCrawl(url, { ...body.options });
    log.info('api:data-pipeline:crawl-start', { jobId: job.jobId, urlCount: body.urls.length });
    res.json({ ok: true, ...job });
  } catch (err) {
    log.error('api:data-pipeline:crawl-start', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /data-pipeline/crawl/:jobId/status ───────────────────────────────────
router.get('/data-pipeline/crawl/:jobId/status', async (req, res) => {
  const crawler = buildCrawler(req.query, res);
  if (!crawler) return;

  try {
    const { jobId } = req.params;
    const status = await crawler.pollCrawl(jobId, { limit: 1 });
    res.json({ ok: true, jobId, ...status });
  } catch (err) {
    log.error('api:data-pipeline:crawl-status', { error: err.message, jobId: req.params.jobId });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /data-pipeline/crawl/:jobId/results ──────────────────────────────────
router.get('/data-pipeline/crawl/:jobId/results', async (req, res) => {
  const crawler = buildCrawler(req.query, res);
  if (!crawler) return;

  try {
    const { jobId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const results = await crawler.pollCrawl(jobId, { limit, status: 'completed' });
    res.json({ ok: true, jobId, page, limit, ...results });
  } catch (err) {
    log.error('api:data-pipeline:crawl-results', { error: err.message, jobId: req.params.jobId });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /data-pipeline/crawl/:jobId ───────────────────────────────────────
router.delete('/data-pipeline/crawl/:jobId', async (req, res) => {
  const crawler = buildCrawler(req.body, res);
  if (!crawler) return;

  try {
    const { jobId } = req.params;
    const result = await crawler.cancelCrawl(jobId);
    log.info('api:data-pipeline:crawl-cancel', { jobId });
    res.json({ ok: true, jobId, ...result });
  } catch (err) {
    log.error('api:data-pipeline:crawl-cancel', { error: err.message, jobId: req.params.jobId });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/crawl-and-wait ───────────────────────────────────────
router.post('/data-pipeline/crawl-and-wait', async (req, res) => {
  const body = parsePayload(crawlAndWaitSchema, req.body || {}, res);
  if (!body) return;

  try {
    const crawler = new CloudflareCrawler(body.accountId, body.apiToken);
    const url = Array.isArray(body.urls) ? body.urls[0] : body.urls;
    const result = await crawler.crawlAndWait(url, {
      ...body.options,
    });
    log.info('api:data-pipeline:crawl-and-wait', { urlCount: body.urls.length, status: result.status });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:data-pipeline:crawl-and-wait', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/extract-json ─────────────────────────────────────────
router.post('/data-pipeline/extract-json', async (req, res) => {
  const body = parsePayload(extractJsonSchema, req.body || {}, res);
  if (!body) return;

  try {
    const crawler = new CloudflareCrawler(body.accountId, body.apiToken);
    const result = await crawler.extractJSON(body.url, body.prompt || '', body.schema || {});
    log.info('api:data-pipeline:extract-json', { url: body.url });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:data-pipeline:extract-json', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/map-to-adm ──────────────────────────────────────────
router.post('/data-pipeline/map-to-adm', (req, res) => {
  const body = parsePayload(mapToAdmSchema, req.body || {}, res);
  if (!body) return;

  try {
    const mapper = new ADMMapper();
    const sourceType = body.mappingProfile || 'assessor';
    const mapped = mapper.mapPropertyToADM(body.extracted, sourceType);
    log.info('api:data-pipeline:map-to-adm', { fieldCount: Object.keys(mapped).length });
    res.json({ ok: true, mapped });
  } catch (err) {
    log.error('api:data-pipeline:map-to-adm', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/detect-conflicts ─────────────────────────────────────
router.post('/data-pipeline/detect-conflicts', (req, res) => {
  const body = parsePayload(detectConflictsSchema, req.body || {}, res);
  if (!body) return;

  try {
    const mapper = new ADMMapper();
    const allConflicts = [];
    for (let i = 0; i < body.sources.length - 1; i++) {
      for (let j = i + 1; j < body.sources.length; j++) {
        const c = mapper.detectConflicts(body.sources[i], body.sources[j]);
        allConflicts.push(...c);
      }
    }
    log.info('api:data-pipeline:detect-conflicts', { sourceCount: body.sources.length, conflictCount: allConflicts.length });
    res.json({ ok: true, conflicts: allConflicts, count: allConflicts.length });
  } catch (err) {
    log.error('api:data-pipeline:detect-conflicts', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/analyze-comps ────────────────────────────────────────
router.post('/data-pipeline/analyze-comps', (req, res) => {
  const body = parsePayload(analyzeCompsSchema, req.body || {}, res);
  if (!body) return;

  try {
    const analyzer = new CompAnalyzer(body.subject, body.comps);
    const analysis = {
      pricePerSqft: analyzer.pricePerSqftAnalysis(),
      adjustmentGrid: analyzer.generateAdjustmentGrid(),
      reconciliation: analyzer.reconciliationRange(),
      outliers: analyzer.flagOutliers(),
      marketTrend: analyzer.marketTrendAnalysis(),
      compSelectionNarrative: analyzer.generateCompSelectionNarrative(),
    };
    log.info('api:data-pipeline:analyze-comps', { compCount: body.comps.length });
    res.json({ ok: true, ...analysis });
  } catch (err) {
    log.error('api:data-pipeline:analyze-comps', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── In-memory custom presets store ───────────────────────────────────────────
const _customPresets = {};

// ── GET /data-pipeline/presets ───────────────────────────────────────────────
router.get('/data-pipeline/presets', (req, res) => {
  try {
    const builtinEntries = Object.entries(CRAWL_PRESETS).map(([id, p]) => ({ id, ...p, isBuiltin: true }));
    const customEntries = Object.entries(_customPresets).map(([id, p]) => ({ id, ...p, isBuiltin: false }));
    const presets = [...builtinEntries, ...customEntries];
    res.json({ ok: true, presets, count: presets.length });
  } catch (err) {
    log.error('api:data-pipeline:presets-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /data-pipeline/presets/:presetId ─────────────────────────────────────
router.put('/data-pipeline/presets/:presetId', (req, res) => {
  try {
    const { presetId } = req.params;
    const { name, options, schema, prompt } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    _customPresets[presetId] = { name, options: options || {}, schema: schema || null, prompt: prompt || null };
    log.info('api:data-pipeline:preset-save', { presetId });
    res.json({ ok: true, presetId, preset: _customPresets[presetId] });
  } catch (err) {
    log.error('api:data-pipeline:preset-save', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /data-pipeline/presets/:presetId ───────────────────────────────────
router.delete('/data-pipeline/presets/:presetId', (req, res) => {
  try {
    const { presetId } = req.params;
    if (CRAWL_PRESETS[presetId]) return res.status(400).json({ ok: false, error: 'Cannot delete built-in preset' });
    delete _customPresets[presetId];
    log.info('api:data-pipeline:preset-delete', { presetId });
    res.json({ ok: true, presetId });
  } catch (err) {
    log.error('api:data-pipeline:preset-delete', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /data-pipeline/usage ─────────────────────────────────────────────────
router.get('/data-pipeline/usage', (req, res) => {
  const crawler = buildCrawler(req.query, res);
  if (!crawler) return;

  try {
    const usage = crawler.getUsageStats();
    res.json({ ok: true, ...usage });
  } catch (err) {
    log.error('api:data-pipeline:usage', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /data-pipeline/cache/stats ───────────────────────────────────────────
router.get('/data-pipeline/cache/stats', (req, res) => {
  try {
    const stats = crawlCache.getStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    log.error('api:data-pipeline:cache-stats', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /data-pipeline/cache ──────────────────────────────────────────────
router.delete('/data-pipeline/cache', (req, res) => {
  try {
    crawlCache.clear();
    log.info('api:data-pipeline:cache-clear', { cleared: true });
    res.json({ ok: true, cleared: true });
  } catch (err) {
    log.error('api:data-pipeline:cache-clear', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /data-pipeline/push-to-case/:caseId ────────────────────────────────
router.post('/data-pipeline/push-to-case/:caseId', (req, res) => {
  const body = parsePayload(pushToCaseSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { caseId } = req.params;
    const projection = getCaseProjection(caseId);
    if (!projection) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }

    const oldFacts = projection.facts || {};
    const updated = {
      ...oldFacts,
      ...body.facts,
      updatedAt: new Date().toISOString(),
    };

    const meta = { ...(projection.meta || {}), updatedAt: new Date().toISOString() };

    saveCaseProjection({
      caseId,
      meta,
      facts: updated,
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });

    // Auto-invalidate sections that depend on changed facts
    const changedPaths = detectChangedFactPaths(oldFacts, updated);
    let invalidation = { affectedSections: [], invalidated: [] };
    if (changedPaths.length > 0) {
      invalidation = onFactsChanged(caseId, changedPaths);
    }

    log.info('api:data-pipeline:push-to-case', {
      caseId,
      source: body.source || 'data-pipeline',
      factsCount: Object.keys(body.facts).length,
      changedPaths: changedPaths.length,
    });

    res.json({
      ok: true,
      caseId,
      factsCount: Object.keys(body.facts).length,
      facts: updated,
      factChangeInvalidation: {
        changedPaths,
        affectedSections: invalidation.affectedSections,
        invalidatedSections: invalidation.invalidated,
      },
    });
  } catch (err) {
    log.error('api:data-pipeline:push-to-case', { error: err.message, caseId: req.params.caseId });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
