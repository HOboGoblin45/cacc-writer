/**
 * server/migration/phase26Schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 2 Marketing Infrastructure — Email Campaigns, Content Assets, Lead Capture
 *
 * Tables:
 *   email_campaigns       — Drip campaigns, transactional emails, one-off broadcasts
 *   campaign_subscribers  — Enrollment + progress tracking per subscriber
 *   email_sends          — Detailed email send history + engagement metrics
 *   content_assets       — Marketing content registry (PDFs, videos, templates)
 *   lead_captures        — Lead magnet conversions
 */

import log from '../logger.js';

export function initPhase26Schema(db) {
  try {
    // Email campaigns table
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        name        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'drip',
        status      TEXT NOT NULL DEFAULT 'active',
        description TEXT,
        emails_json TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_campaigns_type ON email_campaigns(type);
    `);

    // Campaign subscribers
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_subscribers (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        campaign_id     TEXT NOT NULL,
        email           TEXT NOT NULL,
        user_id         TEXT,
        metadata_json   TEXT,
        enrolled_at     TEXT DEFAULT (datetime('now')),
        current_index   INTEGER DEFAULT 0,
        last_sent_at    TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
        UNIQUE(campaign_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_subs_campaign ON campaign_subscribers(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_subs_email ON campaign_subscribers(email);
      CREATE INDEX IF NOT EXISTS idx_subs_status ON campaign_subscribers(status);
      CREATE INDEX IF NOT EXISTS idx_subs_user ON campaign_subscribers(user_id);
    `);

    // Email sends — detailed engagement tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_sends (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        campaign_id       TEXT NOT NULL,
        subscriber_id     TEXT NOT NULL,
        email_index       INTEGER NOT NULL,
        subject           TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        sent_at           TEXT,
        opened_at         TEXT,
        clicked_at        TEXT,
        bounced_at        TEXT,
        unsubscribed_at   TEXT,
        message_id        TEXT,
        created_at        TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
        FOREIGN KEY (subscriber_id) REFERENCES campaign_subscribers(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sends_campaign ON email_sends(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_sends_subscriber ON email_sends(subscriber_id);
      CREATE INDEX IF NOT EXISTS idx_sends_status ON email_sends(status);
      CREATE INDEX IF NOT EXISTS idx_sends_created ON email_sends(created_at);
    `);

    // Content assets registry
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_assets (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        slug            TEXT UNIQUE NOT NULL,
        title           TEXT NOT NULL,
        type            TEXT NOT NULL,
        description     TEXT,
        file_path       TEXT,
        url             TEXT,
        gated           INTEGER DEFAULT 0,
        download_count  INTEGER DEFAULT 0,
        lead_magnet_id  TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_assets_type ON content_assets(type);
      CREATE INDEX IF NOT EXISTS idx_assets_gated ON content_assets(gated);
      CREATE INDEX IF NOT EXISTS idx_assets_slug ON content_assets(slug);
    `);

    // Lead captures — track conversions through funnel
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_captures (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        asset_id        TEXT NOT NULL,
        email           TEXT NOT NULL,
        name            TEXT,
        company         TEXT,
        metadata_json   TEXT,
        captured_at     TEXT DEFAULT (datetime('now')),
        converted_at    TEXT,
        enrolled_campaign_id TEXT,
        FOREIGN KEY (asset_id) REFERENCES content_assets(id)
      );
      CREATE INDEX IF NOT EXISTS idx_captures_asset ON lead_captures(asset_id);
      CREATE INDEX IF NOT EXISTS idx_captures_email ON lead_captures(email);
      CREATE INDEX IF NOT EXISTS idx_captures_campaign ON lead_captures(enrolled_campaign_id);
    `);

    log.info('phase26:schema-init', 'Marketing tables created');
  } catch (err) {
    log.error('phase26:schema-error', { error: err.message });
    throw err;
  }
}

export default { initPhase26Schema };
