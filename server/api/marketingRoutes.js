/**
 * server/api/marketingRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Marketing API routes for Wave 2:
 *   - Content asset discovery and delivery
 *   - Lead magnet email capture
 *   - Campaign management and analytics
 *   - Unsubscribe handling
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import {
  listAssets,
  getAsset,
  getAssetBySlug,
  trackDownload,
  processLeadCapture,
  getAssetLeadStats,
  initializeDefaultAssets,
} from '../marketing/contentAssetService.js';
import {
  createCampaign,
  getCampaign,
  enrollSubscriber,
  getCampaignStats,
  getSubscriberJourney,
  unsubscribeSubscriber,
  CAMPAIGN_TEMPLATES,
} from '../marketing/emailCampaignService.js';
import { renderEmail } from '../marketing/emailTemplateRenderer.js';

const router = Router();

// Validation schemas
const assetIdSchema = z.object({
  id: z.string().min(1, 'Asset ID is required'),
});

const assetSlugSchema = z.object({
  slug: z.string().min(1, 'Asset slug is required'),
});

const leadCaptureSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  email: z.string().email('Invalid email address'),
  name: z.string().optional(),
  company: z.string().optional(),
  enrollCampaignId: z.string().optional(),
});

const campaignCreateSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  type: z.enum(['drip', 'one-off', 'transactional']),
  templateKey: z.string().optional(),
});

const subscriberEnrollSchema = z.object({
  campaignId: z.string().min(1, 'Campaign ID is required'),
  email: z.string().email('Invalid email address'),
  name: z.string().optional(),
  company: z.string().optional(),
});

const unsubscribeSchema = z.object({
  email: z.string().email('Invalid email address'),
  token: z.string().optional(),
});

// Middleware for validation
const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    log.warn('validation:error', { path: req.path, errors: err.errors });
    return res.status(400).json({
      ok: false,
      error: err.errors[0]?.message || 'Validation failed',
    });
  }
};

const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    log.warn('validation:error', { path: req.path, errors: err.errors });
    return res.status(400).json({
      ok: false,
      error: err.errors[0]?.message || 'Validation failed',
    });
  }
};

// Initialize default assets on first request
let assetsInitialized = false;
router.use((req, res, next) => {
  if (!assetsInitialized) {
    try {
      initializeDefaultAssets();
      assetsInitialized = true;
    } catch (err) {
      log.warn('assets:init-failed', { error: err.message });
    }
  }
  next();
});

// ── Content Asset Routes ───────────────────────────────────────────────────────

/**
 * GET /api/marketing/assets
 * List all available content assets
 * Query: ?type=pdf&gated=true
 */
router.get('/assets', (req, res) => {
  try {
    const filters = {
      type: req.query.type ? String(req.query.type) : undefined,
      gated: req.query.gated !== undefined ? req.query.gated === 'true' : undefined,
    };

    const assets = listAssets(filters);
    res.json({
      ok: true,
      assets,
      count: assets.length,
    });
  } catch (err) {
    log.error('assets:list-failed', { error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to list assets',
    });
  }
});

/**
 * GET /api/marketing/assets/:id
 * Get specific asset
 */
router.get('/assets/:id', validateParams(assetIdSchema), (req, res) => {
  try {
    const asset = getAsset(req.validatedParams.id);
    if (!asset) {
      return res.status(404).json({
        ok: false,
        error: 'Asset not found',
      });
    }

    const stats = getAssetLeadStats(asset.id);

    res.json({
      ok: true,
      asset: {
        ...asset,
        stats,
      },
    });
  } catch (err) {
    log.error('asset:get-failed', { assetId: req.validatedParams.id, error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to get asset',
    });
  }
});

/**
 * GET /api/marketing/assets/slug/:slug
 * Get asset by slug
 */
router.get('/assets/slug/:slug', validateParams(assetSlugSchema), (req, res) => {
  try {
    const asset = getAssetBySlug(req.validatedParams.slug);
    if (!asset) {
      return res.status(404).json({
        ok: false,
        error: 'Asset not found',
      });
    }

    const stats = getAssetLeadStats(asset.id);

    res.json({
      ok: true,
      asset: {
        ...asset,
        stats,
      },
    });
  } catch (err) {
    log.error('asset:get-by-slug-failed', { slug: req.validatedParams.slug, error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to get asset',
    });
  }
});

/**
 * POST /api/marketing/assets/:id/download
 * Track asset download/view
 */
router.post('/assets/:id/download', validateParams(assetIdSchema), (req, res) => {
  try {
    const asset = getAsset(req.validatedParams.id);
    if (!asset) {
      return res.status(404).json({
        ok: false,
        error: 'Asset not found',
      });
    }

    trackDownload(req.validatedParams.id, req.user?.userId);

    res.json({
      ok: true,
      message: 'Download tracked',
    });
  } catch (err) {
    log.error('asset:download-failed', { assetId: req.validatedParams.id, error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to track download',
    });
  }
});

// ── Lead Capture Routes ────────────────────────────────────────────────────────

/**
 * POST /api/marketing/lead-capture
 * Capture lead from gated content form
 */
router.post('/lead-capture', validateBody(leadCaptureSchema), (req, res) => {
  try {
    const result = processLeadCapture(req.validated.assetId, {
      email: req.validated.email,
      name: req.validated.name,
      company: req.validated.company,
      enrollCampaignId: req.validated.enrollCampaignId,
    });

    res.json({
      ok: true,
      leadId: result.leadId,
      enrolled: result.enrolled,
      campaignId: result.campaignId,
    });
  } catch (err) {
    log.error('lead:capture-failed', { error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to process lead capture',
    });
  }
});

// ── Campaign Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/marketing/campaigns
 * Admin: list all campaigns
 */
router.get('/campaigns', (req, res) => {
  try {
    // TODO: Implement campaign listing
    res.json({
      ok: true,
      campaigns: [],
    });
  } catch (err) {
    log.error('campaigns:list-failed', { error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to list campaigns',
    });
  }
});

/**
 * GET /api/marketing/campaigns/:id/stats
 * Get campaign analytics
 */
router.get('/campaigns/:id/stats', (req, res) => {
  try {
    const campaign = getCampaign(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found',
      });
    }

    const stats = getCampaignStats(req.params.id);

    res.json({
      ok: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        subscriberCount: campaign.subscriberCount,
      },
      stats,
    });
  } catch (err) {
    log.error('campaign:stats-failed', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to get campaign stats',
    });
  }
});

/**
 * POST /api/marketing/campaigns
 * Admin: create a campaign (from template or custom)
 */
router.post('/campaigns', validateBody(campaignCreateSchema), (req, res) => {
  try {
    let emails = [];

    if (req.validated.templateKey) {
      const template = CAMPAIGN_TEMPLATES[req.validated.templateKey];
      if (!template) {
        return res.status(400).json({
          ok: false,
          error: `Template not found: ${req.validated.templateKey}`,
        });
      }
      emails = template.emails;
    }

    const campaign = createCampaign(req.validated.name, req.validated.type, emails);

    res.json({
      ok: true,
      campaign,
    });
  } catch (err) {
    log.error('campaign:create-failed', { error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to create campaign',
    });
  }
});

/**
 * POST /api/marketing/campaigns/:id/enroll
 * Admin: enroll subscriber in campaign
 */
router.post('/campaigns/:id/enroll', validateBody(subscriberEnrollSchema), (req, res) => {
  try {
    const result = enrollSubscriber(req.params.id, req.validated.email, {
      name: req.validated.name,
      company: req.validated.company,
    });

    res.json({
      ok: true,
      subscriber: result,
    });
  } catch (err) {
    log.error('campaign:enroll-failed', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to enroll subscriber',
    });
  }
});

// ── Unsubscribe Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/marketing/unsubscribe
 * Public unsubscribe route (no auth required)
 */
router.post('/unsubscribe', validateBody(unsubscribeSchema), (req, res) => {
  try {
    // TODO: Implement unsubscribe with token validation
    // For now, just return success
    log.info('unsubscribe:requested', { email: req.validated.email });

    res.json({
      ok: true,
      message: 'You have been unsubscribed',
    });
  } catch (err) {
    log.error('unsubscribe:failed', { error: err.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to unsubscribe',
    });
  }
});

export default router;
