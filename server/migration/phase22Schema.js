/**
 * server/migration/phase22Schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 22 — Wave 1 Go-To-Market Infrastructure
 *
 * New tables:
 *   - waitlist: Pre-launch waitlist for UAD 3.6 mandate awareness
 *   - beta_feedback: Structured feedback collection from beta users
 *   - referral_codes: Unique referral codes per user
 *   - referral_tracking: Referral attribution and conversion tracking
 *
 * All tables track timestamps for audit and analytics.
 */

import log from '../logger.js';

export function initPhase22Schema(db) {
  try {
    // ────────────────────────────────────────────────────────────────────────────
    // waitlist — Pre-launch UAD 3.6 waitlist
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        email             TEXT NOT NULL UNIQUE,
        name              TEXT,
        state             TEXT,
        license_type      TEXT,
        -- license_type: certified | trainee | other
        current_software  TEXT,
        -- current_software: ACI | TOTAL | Real Quantum | Other
        referral_source   TEXT,
        -- referral_source: search | social | email | referral | other
        beta_invited_at   TEXT,
        converted_at      TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_waitlist_email
        ON waitlist(email);
      CREATE INDEX IF NOT EXISTS idx_waitlist_state
        ON waitlist(state);
      CREATE INDEX IF NOT EXISTS idx_waitlist_created
        ON waitlist(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_waitlist_converted
        ON waitlist(converted_at);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // beta_feedback — Structured feedback from beta appraisers
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS beta_feedback (
        id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        case_id               TEXT,
        section_id            TEXT,
        -- quality_rating: 1=poor, 5=excellent
        quality_rating        INTEGER,
        -- accuracy_rating: 1=inaccurate, 5=highly accurate
        accuracy_rating       INTEGER,
        -- voice_match_rating: 1=doesn't match, 5=perfect match
        voice_match_rating    INTEGER,
        comments              TEXT,
        generated_text        TEXT,
        final_approved_text   TEXT,
        diff_metrics_json     TEXT DEFAULT '{}',
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_beta_feedback_user_id
        ON beta_feedback(user_id);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_case_id
        ON beta_feedback(case_id);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_section_id
        ON beta_feedback(section_id);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_created
        ON beta_feedback(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_quality
        ON beta_feedback(quality_rating);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // referral_codes — Unique referral codes per user
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code            TEXT NOT NULL UNIQUE,
        -- code format: RB-{userId_short}-{random6}
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id
        ON referral_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_referral_codes_code
        ON referral_codes(code);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // referral_tracking — Referral click and conversion tracking
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS referral_tracking (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        referral_code_id  TEXT NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
        referee_email     TEXT,
        clicked_at        TEXT,
        converted_at      TEXT,
        reward_applied    BOOLEAN DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_referral_tracking_code_id
        ON referral_tracking(referral_code_id);
      CREATE INDEX IF NOT EXISTS idx_referral_tracking_referee_email
        ON referral_tracking(referee_email);
      CREATE INDEX IF NOT EXISTS idx_referral_tracking_converted
        ON referral_tracking(converted_at);
      CREATE INDEX IF NOT EXISTS idx_referral_tracking_created
        ON referral_tracking(created_at DESC);
    `);

    log.info('migration:phase22-complete', {
      tablesCreated: ['waitlist', 'beta_feedback', 'referral_codes', 'referral_tracking'],
    });
  } catch (err) {
    log.error('migration:phase22-failed', {
      error: err.message,
    });
    throw err;
  }
}
