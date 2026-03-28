/**
 * server/marketing/contentAssetService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Marketing content asset registry and lead magnet system.
 *
 * Manages:
 *   - Content asset registration (PDFs, videos, templates, infographics)
 *   - Lead magnet gating and email capture
 *   - Download/view tracking
 *   - Lead funnel conversion tracking
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, dbGet, dbRun, dbAll } from '../db/database.js';
import { enrollSubscriber } from './emailCampaignService.js';
import log from '../logger.js';

// Pre-registered content assets
export const CONTENT_ASSETS = {
  uad36_guide: {
    slug: 'uad36-complete-guide',
    title: 'The Appraiser\'s Complete Guide to UAD 3.6',
    type: 'pdf',
    description: 'Comprehensive field-by-field guide covering all UAD 3.6 changes with Real Brain examples',
    gated: true,
    leadMagnet: true,
  },
  uad36_comparison: {
    slug: 'uad36-vs-1004-comparison',
    title: 'UAD 3.6 vs Legacy 1004: Field-by-Field Comparison',
    type: 'infographic',
    description: 'Visual side-by-side comparison of all form changes',
    gated: true,
    leadMagnet: true,
  },
  ai_urar_demo: {
    slug: 'ai-handles-urar-demo',
    title: 'How AI Handles the New URAR',
    type: 'video',
    description: 'Live 10-minute demo of Real Brain generating a complete URAR appraisal',
    gated: true,
    leadMagnet: false,
  },
  market_conditions_template: {
    slug: 'uad36-market-conditions-template',
    title: 'UAD 3.6 Market Conditions Template',
    type: 'template',
    description: 'Ready-to-use Excel template for structuring market condition narratives',
    gated: true,
    leadMagnet: true,
  },
  product_demo: {
    slug: 'real-brain-product-demo',
    title: 'Real Brain Product Demo (10 min)',
    type: 'video',
    description: 'Complete walkthrough of Real Brain\'s core features',
    gated: false,
    leadMagnet: false,
  },
  voice_explainer: {
    slug: 'voice-cloning-how-it-works',
    title: 'Voice Cloning: How It Works',
    type: 'video',
    description: 'Technical explainer on Real Brain\'s proprietary voice AI',
    gated: false,
    leadMagnet: false,
  },
};

/**
 * Register a new content asset
 * @param {Object} asset - {slug, title, type, description, filePath, url, gated, leadMagnet}
 * @returns {Object} Registered asset with ID
 */
export function registerAsset(asset) {
  const id = uuidv4();
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO content_assets (
      id, slug, title, type, description, file_path, url, gated, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    asset.slug,
    asset.title,
    asset.type,
    asset.description || null,
    asset.filePath || null,
    asset.url || null,
    asset.gated ? 1 : 0,
    now,
    now,
  ]);

  log.info('asset:registered', { assetId: id, slug: asset.slug, type: asset.type });

  return {
    id,
    ...asset,
    downloadCount: 0,
  };
}

/**
 * Get asset details
 * @param {string} assetId
 * @returns {Object} Asset record
 */
export function getAsset(assetId) {
  const asset = dbGet('SELECT * FROM content_assets WHERE id = ?', [assetId]);
  if (!asset) return null;

  asset.gated = Boolean(asset.gated);
  return asset;
}

/**
 * Get asset by slug
 * @param {string} slug
 * @returns {Object} Asset record
 */
export function getAssetBySlug(slug) {
  const asset = dbGet('SELECT * FROM content_assets WHERE slug = ?', [slug]);
  if (!asset) return null;

  asset.gated = Boolean(asset.gated);
  return asset;
}

/**
 * List all assets with optional filtering
 * @param {Object} filters - {type, gated, leadMagnet}
 * @returns {Array} Asset records
 */
export function listAssets(filters = {}) {
  let sql = 'SELECT * FROM content_assets WHERE 1=1';
  const params = [];

  if (filters.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }

  if (filters.gated !== undefined) {
    sql += ' AND gated = ?';
    params.push(filters.gated ? 1 : 0);
  }

  sql += ' ORDER BY created_at DESC';

  const assets = dbAll(sql, params);
  return (assets || []).map(a => ({
    ...a,
    gated: Boolean(a.gated),
  }));
}

/**
 * Track an asset download/view
 * @param {string} assetId
 * @param {string} userId - Optional
 */
export function trackDownload(assetId, userId = null) {
  const now = new Date().toISOString();
  dbRun(
    'UPDATE content_assets SET download_count = download_count + 1, updated_at = ? WHERE id = ?',
    [now, assetId]
  );

  if (userId) {
    log.info('asset:download', { assetId, userId, timestamp: now });
  }
}

/**
 * Create a lead magnet — gate an asset behind email capture
 * @param {string} assetId
 * @param {Object} formFields - {email, name, company, campaignIdIfEnroll}
 * @returns {string} Lead magnet ID
 */
export function createLeadMagnet(assetId, formFields = {}) {
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);

  const id = uuidv4();
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO content_assets (
      id, slug, title, type, description, file_path, url, gated, lead_magnet_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `, [
    id,
    `${asset.slug}-magnet`,
    asset.title,
    asset.type,
    asset.description,
    asset.file_path,
    asset.url,
    assetId,
    now,
  ]);

  log.info('lead-magnet:created', { leadMagnetId: id, assetId });
  return id;
}

/**
 * Process lead capture from a gated asset form
 * Captures email, adds to waitlist, optionally enrolls in campaign
 * @param {string} assetId
 * @param {Object} formData - {email, name, company, enrollCampaignId}
 * @returns {Object} {leadId, email, enrolled, campaignId}
 */
export function processLeadCapture(assetId, formData) {
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);

  const leadId = uuidv4();
  const now = new Date().toISOString();

  // Record lead capture
  dbRun(`
    INSERT INTO lead_captures (
      id, asset_id, email, name, company, metadata_json, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    leadId,
    assetId,
    formData.email,
    formData.name || null,
    formData.company || null,
    JSON.stringify({
      source: 'lead_magnet',
      assetType: asset.type,
      assetTitle: asset.title,
      capturedAt: now,
    }),
    now,
  ]);

  log.info('lead:captured', { leadId, assetId, email: formData.email });

  let enrolled = false;
  let enrolledCampaignId = null;

  // Optionally enroll in campaign
  if (formData.enrollCampaignId) {
    try {
      enrollSubscriber(formData.enrollCampaignId, formData.email, {
        name: formData.name,
        company: formData.company,
        source: 'lead_magnet',
        leadId,
      });

      dbRun(
        'UPDATE lead_captures SET enrolled_campaign_id = ?, converted_at = ? WHERE id = ?',
        [formData.enrollCampaignId, now, leadId]
      );

      enrolled = true;
      enrolledCampaignId = formData.enrollCampaignId;

      log.info('lead:converted', { leadId, campaignId: formData.enrollCampaignId });
    } catch (err) {
      log.warn('lead:conversion-failed', { leadId, error: err.message });
    }
  }

  return {
    leadId,
    email: formData.email,
    enrolled,
    campaignId: enrolledCampaignId,
  };
}

/**
 * Initialize default content assets
 * Call once on startup
 */
export function initializeDefaultAssets() {
  for (const [key, assetDef] of Object.entries(CONTENT_ASSETS)) {
    try {
      const existing = getAssetBySlug(assetDef.slug);
      if (!existing) {
        registerAsset(assetDef);
      }
    } catch (err) {
      log.warn('asset:init-failed', { slug: assetDef.slug, error: err.message });
    }
  }
}

/**
 * Get lead capture stats for an asset
 * @param {string} assetId
 * @returns {Object} {totalCaptures, conversions, conversionRate}
 */
export function getAssetLeadStats(assetId) {
  const stats = dbGet(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enrolled_campaign_id IS NOT NULL THEN 1 ELSE 0 END) as converted
    FROM lead_captures
    WHERE asset_id = ?
  `, [assetId]);

  if (!stats || stats.total === 0) {
    return {
      totalCaptures: 0,
      conversions: 0,
      conversionRate: 0,
    };
  }

  return {
    totalCaptures: stats.total || 0,
    conversions: stats.converted || 0,
    conversionRate: stats.total > 0 ? ((stats.converted || 0) / stats.total) * 100 : 0,
  };
}

export default {
  CONTENT_ASSETS,
  registerAsset,
  getAsset,
  getAssetBySlug,
  listAssets,
  trackDownload,
  createLeadMagnet,
  processLeadCapture,
  initializeDefaultAssets,
  getAssetLeadStats,
};
