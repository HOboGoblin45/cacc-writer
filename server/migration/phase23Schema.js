/**
 * server/migration/phase23Schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 23 — Wave 2 Commercial Billing Features
 *
 * New tables:
 *   - founding_members: Track first 100 subscribers with 40% lifetime discount
 *   - trial_subscriptions: 14-day free trial tracking and conversion
 *   - usage_overages: Track metered usage beyond tier limits
 *   - subscription_changes: Audit log of subscription tier changes
 *   - promo_codes: Promotional code repository with usage limits
 *
 * All tables track timestamps for audit and analytics.
 */

import log from '../logger.js';

export function initPhase23Schema(db) {
  try {
    // ────────────────────────────────────────────────────────────────────────────
    // founding_members — Track founding member discount eligibility
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS founding_members (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id           TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        enrolled_at       TEXT NOT NULL DEFAULT (datetime('now')),
        stripe_coupon_id  TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_founding_members_user_id
        ON founding_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_founding_members_enrolled
        ON founding_members(enrolled_at);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // trial_subscriptions — 14-day free trial lifecycle tracking
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS trial_subscriptions (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id           TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        started_at        TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at        TEXT NOT NULL,
        converted_at      TEXT,
        status            TEXT NOT NULL DEFAULT 'active',
        -- status: active | expired | converted | cancelled
        converted_plan    TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_trial_subscriptions_user_id
        ON trial_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_trial_subscriptions_expires
        ON trial_subscriptions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_trial_subscriptions_status
        ON trial_subscriptions(status);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // usage_overages — Track metered AI usage beyond tier limits
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_overages (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        billing_period    TEXT NOT NULL,
        -- billing_period: YYYY-MM
        overage_count     INTEGER NOT NULL DEFAULT 0,
        -- number of reports beyond tier limit
        amount_cents      INTEGER NOT NULL DEFAULT 0,
        -- cost in cents: overage_count * 300 (for $3 per report)
        stripe_invoice_id TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, billing_period)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_overages_user_id
        ON usage_overages(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_overages_billing_period
        ON usage_overages(billing_period);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // subscription_changes — Audit log of subscription tier changes and events
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_changes (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_tier         TEXT,
        -- from_tier: free | starter | pro | enterprise | null if new subscriber
        to_tier           TEXT NOT NULL,
        -- to_tier: free | starter | pro | enterprise
        change_type       TEXT NOT NULL,
        -- change_type: signup | upgrade | downgrade | cancel | reactivate
        reason            TEXT,
        metadata_json     TEXT DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_subscription_changes_user_id
        ON subscription_changes(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscription_changes_change_type
        ON subscription_changes(change_type);
      CREATE INDEX IF NOT EXISTS idx_subscription_changes_created
        ON subscription_changes(created_at DESC);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // promo_codes — Promotional code repository with usage tracking
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        code              TEXT NOT NULL UNIQUE COLLATE NOCASE,
        -- code: uppercase alphanumeric, e.g. "LAUNCH50", "BETA30"
        discount_percent  REAL NOT NULL,
        -- discount_percent: 0-100
        max_uses          INTEGER,
        -- max_uses: null = unlimited
        current_uses      INTEGER NOT NULL DEFAULT 0,
        valid_from        TEXT,
        -- valid_from: ISO date string or null for immediate
        valid_until       TEXT,
        -- valid_until: ISO date string or null for no expiration
        created_by        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_promo_codes_code
        ON promo_codes(code);
      CREATE INDEX IF NOT EXISTS idx_promo_codes_valid
        ON promo_codes(valid_from, valid_until);
      CREATE INDEX IF NOT EXISTS idx_promo_codes_created
        ON promo_codes(created_at DESC);
    `);

    log.info('migration:phase23-complete', {
      tablesCreated: [
        'founding_members',
        'trial_subscriptions',
        'usage_overages',
        'subscription_changes',
        'promo_codes',
      ],
    });
  } catch (err) {
    log.error('migration:phase23-failed', {
      error: err.message,
    });
    throw err;
  }
}
