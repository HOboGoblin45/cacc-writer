/**
 * server/billing/pricingEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Commercial Pricing Configuration & Feature Gate Engine
 *
 * Three subscription tiers with CODEX pricing:
 *   - Starter: $79/month ($790/year) — 30 reports/month
 *   - Professional: $149/month ($1,490/year) — Unlimited reports
 *   - Enterprise: $249/month/seat (custom annual) — Teams, white-label, API
 *
 * Founding member discount: First 100 subscribers get 40% off for life.
 * 14-day free trial: No credit card required.
 * Usage-based overlay: $3 per report beyond tier limits.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

// ── Subscription Tiers ─────────────────────────────────────────────────────────

export const PRICING_TIERS = {
  starter: {
    name: 'Starter',
    monthlyPrice: 7900, // $79 in cents
    yearlyPrice: 79000, // $790 in cents
    monthlyPriceDisplay: '$79/month',
    yearlyPriceDisplay: '$790/year',
    reportsPerMonth: 30,
    features: ['voice_training', 'pdf_export', 'form_1004', 'form_1025'],
  },
  pro: {
    name: 'Professional',
    monthlyPrice: 14900, // $149 in cents
    yearlyPrice: 149000, // $1,490 in cents
    monthlyPriceDisplay: '$149/month',
    yearlyPriceDisplay: '$1,490/year',
    reportsPerMonth: Infinity,
    features: [
      'voice_training',
      'advanced_voice_engine',
      'pdf_export',
      'docx_export',
      'aci_insertion',
      'rq_insertion',
      'qc_engine',
      'comp_intelligence',
      'form_1004',
      'form_1025',
      'form_1073',
      'form_uad36',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    monthlyPrice: 24900, // $249/month per seat
    yearlyPrice: null, // Custom annual pricing
    monthlyPriceDisplay: '$249/month per seat',
    yearlyPriceDisplay: 'Custom',
    reportsPerMonth: Infinity,
    features: [
      'voice_training',
      'advanced_voice_engine',
      'pdf_export',
      'docx_export',
      'aci_insertion',
      'rq_insertion',
      'qc_engine',
      'comp_intelligence',
      'api_access',
      'white_label',
      'team_management',
      'automation',
      'dedicated_support',
      'form_1004',
      'form_1025',
      'form_1073',
      'form_uad36',
    ],
  },
};

// ── Founding Member Prices (40% off) ────────────────────────────────────────────

export const FOUNDING_MEMBER_PRICES = {
  starter: {
    monthlyPrice: 4740, // $47.40 in cents (40% off $79)
    yearlyPrice: 47400, // $474 in cents (40% off $790)
    monthlyPriceDisplay: '$47.40/month',
    yearlyPriceDisplay: '$474/year',
  },
  pro: {
    monthlyPrice: 8940, // $89.40 in cents (40% off $149)
    yearlyPrice: 89400, // $894 in cents (40% off $1,490)
    monthlyPriceDisplay: '$89.40/month',
    yearlyPriceDisplay: '$894/year',
  },
  enterprise: {
    monthlyPrice: 14940, // $149.40 in cents (40% off $249)
    yearlyPrice: null,
    monthlyPriceDisplay: '$149.40/month per seat',
    yearlyPriceDisplay: 'Custom',
  },
};

// ── Stripe Product & Price Mapping ─────────────────────────────────────────────

export const STRIPE_PRODUCTS = {
  // Standard pricing
  'cacc-starter-monthly': process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
  'cacc-starter-annual': process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
  'cacc-pro-monthly': process.env.STRIPE_PRICE_PRO_MONTHLY || '',
  'cacc-pro-annual': process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  'cacc-enterprise-monthly': process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || '',
  'cacc-enterprise-annual': process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL || '',

  // Founding member pricing
  'cacc-founder-starter-monthly': process.env.STRIPE_PRICE_FOUNDER_STARTER_MONTHLY || '',
  'cacc-founder-starter-annual': process.env.STRIPE_PRICE_FOUNDER_STARTER_ANNUAL || '',
  'cacc-founder-pro-monthly': process.env.STRIPE_PRICE_FOUNDER_PRO_MONTHLY || '',
  'cacc-founder-pro-annual': process.env.STRIPE_PRICE_FOUNDER_PRO_ANNUAL || '',
  'cacc-founder-enterprise-monthly': process.env.STRIPE_PRICE_FOUNDER_ENTERPRISE_MONTHLY || '',
  'cacc-founder-enterprise-annual': process.env.STRIPE_PRICE_FOUNDER_ENTERPRISE_ANNUAL || '',

  // Metered usage
  'cacc-ai-usage': process.env.STRIPE_PRODUCT_AI_USAGE || '',
};

// ── Feature Matrix ─────────────────────────────────────────────────────────────

export const FEATURE_MATRIX = {
  voice_training: { starter: true, pro: true, enterprise: true },
  advanced_voice_engine: { starter: false, pro: true, enterprise: true },
  pdf_export: { starter: true, pro: true, enterprise: true },
  docx_export: { starter: false, pro: true, enterprise: true },
  aci_insertion: { starter: false, pro: true, enterprise: true },
  rq_insertion: { starter: false, pro: true, enterprise: true },
  qc_engine: { starter: false, pro: true, enterprise: true },
  comp_intelligence: { starter: false, pro: true, enterprise: true },
  api_access: { starter: false, pro: false, enterprise: true },
  white_label: { starter: false, pro: false, enterprise: true },
  team_management: { starter: false, pro: false, enterprise: true },
  automation: { starter: false, pro: false, enterprise: true },
  dedicated_support: { starter: false, pro: false, enterprise: true },
  priority_ai_models: { starter: false, pro: true, enterprise: true },
  form_1004: { starter: true, pro: true, enterprise: true },
  form_1025: { starter: true, pro: true, enterprise: true },
  form_1073: { starter: false, pro: true, enterprise: true },
  form_uad36: { starter: false, pro: true, enterprise: true },
};

// ── Constants ──────────────────────────────────────────────────────────────────

const FOUNDING_MEMBER_LIMIT = 100;
const FREE_TRIAL_DAYS = 14;
const GRACE_PERIOD_DAYS = 3;
const OVERAGE_PRICE_CENTS = 300; // $3 per report
const FOUNDING_DISCOUNT_PERCENT = 40;

// ── Founding Member Management ─────────────────────────────────────────────────

/**
 * Check if founding member slots are still available.
 * Returns true if fewer than 100 members have enrolled.
 */
export function isFoundingMemberAvailable() {
  const count = getFoundingMemberCount();
  return count < FOUNDING_MEMBER_LIMIT;
}

/**
 * Get current count of enrolled founding members.
 */
export function getFoundingMemberCount() {
  const db = getDb();
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM founding_members').get();
    return result?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a user is a founding member.
 */
export function isFoundingMember(userId) {
  const db = getDb();
  try {
    const member = db.prepare('SELECT id FROM founding_members WHERE user_id = ?').get(userId);
    return Boolean(member);
  } catch {
    return false;
  }
}

/**
 * Enroll a user as a founding member (if slots available).
 * Returns founding member record or null if limit exceeded.
 */
export function enrollFoundingMember(userId, stripeCouponId = null) {
  if (!isFoundingMemberAvailable()) {
    log.warn('billing:founding-member-limit-reached', { userId });
    return null;
  }

  const db = getDb();
  try {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO founding_members (id, user_id, stripe_coupon_id)
      VALUES (?, ?, ?)
    `).run(id, userId, stripeCouponId);

    log.info('billing:founding-member-enrolled', { userId, stripeCouponId });
    return { id, userId, stripeCouponId };
  } catch (err) {
    log.error('billing:founding-member-enroll-failed', { userId, error: err.message });
    return null;
  }
}

// ── Pricing Calculation ────────────────────────────────────────────────────────

/**
 * Calculate final price for a plan and billing cycle.
 * Applies founding member discount if applicable.
 *
 * @param {string} tier - 'starter', 'pro', or 'enterprise'
 * @param {string} billingCycle - 'monthly' or 'annual'
 * @param {string} userId - Optional, to check founding member status
 * @returns {object} { priceCents, priceDisplay, isFoundingMember }
 */
export function calculatePrice(tier, billingCycle = 'monthly', userId = null) {
  const tierConfig = PRICING_TIERS[tier];
  if (!tierConfig) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  const isFounder = userId && isFoundingMember(userId);
  const prices = isFounder ? FOUNDING_MEMBER_PRICES[tier] : tierConfig;

  const key = billingCycle === 'annual' ? 'yearlyPrice' : 'monthlyPrice';
  const displayKey = billingCycle === 'annual' ? 'yearlyPriceDisplay' : 'monthlyPriceDisplay';

  return {
    priceCents: prices[key],
    priceDisplay: prices[displayKey],
    isFoundingMember: isFounder,
    discountPercent: isFounder ? FOUNDING_DISCOUNT_PERCENT : 0,
  };
}

// ── Trial Subscriptions ────────────────────────────────────────────────────────

/**
 * Create a 14-day free trial subscription for a new user.
 * Returns trial record on success, null on failure.
 */
export function createTrialSubscription(userId) {
  const db = getDb();
  try {
    const expiresAt = new Date(Date.now() + FREE_TRIAL_DAYS * 86400000).toISOString();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO trial_subscriptions (id, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(id, userId, expiresAt);

    log.info('billing:trial-subscription-created', { userId, expiresAt });
    return { id, userId, expiresAt, status: 'active' };
  } catch (err) {
    log.error('billing:trial-subscription-create-failed', { userId, error: err.message });
    return null;
  }
}

/**
 * Get trial subscription status for a user.
 * Returns { status, expiresAt, daysRemaining, isExpired } or null if no trial.
 */
export function getTrialStatus(userId) {
  const db = getDb();
  try {
    const trial = db.prepare(`
      SELECT * FROM trial_subscriptions
      WHERE user_id = ?
    `).get(userId);

    if (!trial) return null;

    const expiresAt = new Date(trial.expires_at);
    const now = new Date();
    const daysRemaining = Math.ceil((expiresAt - now) / 86400000);
    const isExpired = daysRemaining <= 0;

    return {
      status: trial.status,
      expiresAt: trial.expires_at,
      daysRemaining: Math.max(0, daysRemaining),
      isExpired,
      convertedAt: trial.converted_at,
      convertedPlan: trial.converted_plan,
    };
  } catch {
    return null;
  }
}

/**
 * Convert trial subscription to paid plan.
 * Called when trial user completes checkout.
 */
export function convertTrialSubscription(userId, plan) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE trial_subscriptions
      SET status = 'converted',
          converted_at = datetime('now'),
          converted_plan = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(plan, userId);

    log.info('billing:trial-converted', { userId, plan });
    return true;
  } catch (err) {
    log.error('billing:trial-conversion-failed', { userId, error: err.message });
    return false;
  }
}

/**
 * Mark trial as expired (called on background job or at checkout).
 */
export function expireTrialSubscription(userId) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE trial_subscriptions
      SET status = 'expired',
          updated_at = datetime('now')
      WHERE user_id = ? AND status = 'active'
    `).run(userId);

    log.info('billing:trial-expired', { userId });
    return true;
  } catch (err) {
    log.error('billing:trial-expiration-failed', { userId, error: err.message });
    return false;
  }
}

// ── Usage Overages ─────────────────────────────────────────────────────────────

/**
 * Record usage overage for a billing period.
 * Called when user exceeds tier-specific report limits.
 *
 * @param {string} userId
 * @param {number} overageCount - number of extra reports
 * @returns {object} { overageCount, amountCents } or null on error
 */
export function recordUsageOverage(userId, overageCount = 1) {
  const db = getDb();
  const now = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const existing = db.prepare(`
      SELECT id, overage_count FROM usage_overages
      WHERE user_id = ? AND billing_period = ?
    `).get(userId, billingPeriod);

    const newCount = (existing?.overage_count || 0) + overageCount;
    const amountCents = newCount * OVERAGE_PRICE_CENTS;

    if (existing) {
      db.prepare(`
        UPDATE usage_overages
        SET overage_count = ?,
            amount_cents = ?,
            updated_at = datetime('now')
        WHERE user_id = ? AND billing_period = ?
      `).run(newCount, amountCents, userId, billingPeriod);
    } else {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO usage_overages (id, user_id, billing_period, overage_count, amount_cents)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, userId, billingPeriod, overageCount, OVERAGE_PRICE_CENTS * overageCount);
    }

    log.info('billing:usage-overage-recorded', { userId, billingPeriod, overageCount, amountCents });
    return { overageCount: newCount, amountCents };
  } catch (err) {
    log.error('billing:usage-overage-failed', { userId, error: err.message });
    return null;
  }
}

/**
 * Get current overage for a billing period.
 */
export function getUsageOverage(userId, billingPeriod = null) {
  const db = getDb();
  if (!billingPeriod) {
    const now = new Date();
    billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  try {
    const overage = db.prepare(`
      SELECT overage_count, amount_cents FROM usage_overages
      WHERE user_id = ? AND billing_period = ?
    `).get(userId, billingPeriod);

    return overage || { overageCount: 0, amountCents: 0 };
  } catch {
    return { overageCount: 0, amountCents: 0 };
  }
}

// ── Feature Gating ─────────────────────────────────────────────────────────────

/**
 * Check if a user can access a specific feature.
 * @param {string} userId
 * @param {string} feature - feature key from FEATURE_MATRIX
 * @returns {boolean}
 */
export function canAccessFeature(userId, feature) {
  const db = getDb();
  try {
    const sub = db.prepare(`
      SELECT plan FROM subscriptions WHERE user_id = ?
    `).get(userId);

    if (!sub) return false;

    const tier = sub.plan || 'free';
    const featureConfig = FEATURE_MATRIX[feature];
    if (!featureConfig) return false;

    return featureConfig[tier] === true;
  } catch {
    return false;
  }
}

/**
 * Get list of available features for a tier.
 * @param {string} tier - 'starter', 'pro', 'enterprise', or 'free'
 * @returns {array} feature keys enabled for this tier
 */
export function getAvailableFeatures(tier) {
  const features = [];
  for (const [feature, config] of Object.entries(FEATURE_MATRIX)) {
    if (config[tier] === true) {
      features.push(feature);
    }
  }
  return features;
}

/**
 * Get full tier information including pricing and features.
 * @param {string} tier
 * @param {string} userId - Optional, for founding member pricing
 * @returns {object} tier config with pricing
 */
export function getTierInfo(tier, userId = null) {
  const tierConfig = PRICING_TIERS[tier];
  if (!tierConfig) return null;

  const isFounder = userId && isFoundingMember(userId);
  const features = getAvailableFeatures(tier);

  return {
    tier,
    name: tierConfig.name,
    reportsPerMonth: tierConfig.reportsPerMonth,
    monthlyPrice: isFounder ? FOUNDING_MEMBER_PRICES[tier].monthlyPrice : tierConfig.monthlyPrice,
    monthlyPriceDisplay: isFounder
      ? FOUNDING_MEMBER_PRICES[tier].monthlyPriceDisplay
      : tierConfig.monthlyPriceDisplay,
    yearlyPrice: isFounder ? FOUNDING_MEMBER_PRICES[tier].yearlyPrice : tierConfig.yearlyPrice,
    yearlyPriceDisplay: isFounder
      ? FOUNDING_MEMBER_PRICES[tier].yearlyPriceDisplay
      : tierConfig.yearlyPriceDisplay,
    isFoundingMember: isFounder,
    features,
  };
}

/**
 * Log a subscription change for audit trail.
 */
export function logSubscriptionChange(userId, changeType, details = {}) {
  const db = getDb();
  try {
    const id = crypto.randomUUID();
    const { fromTier, toTier, reason } = details;

    db.prepare(`
      INSERT INTO subscription_changes (id, user_id, from_tier, to_tier, change_type, reason, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, fromTier || null, toTier, changeType, reason || null, JSON.stringify(details));

    log.info('billing:subscription-change-logged', { userId, changeType, toTier });
  } catch (err) {
    log.error('billing:subscription-change-log-failed', { userId, error: err.message });
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

export default {
  PRICING_TIERS,
  FOUNDING_MEMBER_PRICES,
  STRIPE_PRODUCTS,
  FEATURE_MATRIX,
  isFoundingMemberAvailable,
  getFoundingMemberCount,
  isFoundingMember,
  enrollFoundingMember,
  calculatePrice,
  createTrialSubscription,
  getTrialStatus,
  convertTrialSubscription,
  expireTrialSubscription,
  recordUsageOverage,
  getUsageOverage,
  canAccessFeature,
  getAvailableFeatures,
  getTierInfo,
  logSubscriptionChange,
};
