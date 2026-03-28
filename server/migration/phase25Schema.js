/**
 * server/migration/phase25Schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 25 — Wave 2 Integration & Auth Hardening
 *
 * New tables:
 *   - refresh_tokens: JWT refresh token storage with device/IP tracking
 *   - oauth_accounts: OAuth provider linkage (Google, etc.)
 *   - password_reset_tokens: Password reset token lifecycle
 *   - mercury_credentials: Encrypted Mercury Network API credentials
 *   - mercury_orders: Mercury order tracking and status sync
 *
 * All auth tokens are stored hashed for security. Credentials encrypted.
 */

import log from '../logger.js';

export function initPhase25Schema(db) {
  try {
    // ────────────────────────────────────────────────────────────────────────────
    // refresh_tokens — JWT refresh token storage (enhanced session tracking)
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash      TEXT NOT NULL UNIQUE,
        device_info     TEXT,
        -- device_info: User-Agent or device identifier
        ip_address      TEXT,
        -- ip_address: Client IP for session tracking
        issued_at       TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at      TEXT NOT NULL,
        revoked_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
        ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
        ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
        ON refresh_tokens(expires_at);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // oauth_accounts — OAuth provider linkage (Google, Apple, etc.)
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL,
        -- provider: google, apple, microsoft, etc.
        provider_user_id TEXT NOT NULL,
        -- provider_user_id: unique ID from OAuth provider
        email           TEXT,
        display_name    TEXT,
        profile_picture_url TEXT,
        linked_at       TEXT NOT NULL DEFAULT (datetime('now')),
        last_auth_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, provider_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id
        ON oauth_accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider
        ON oauth_accounts(provider, provider_user_id);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // password_reset_tokens — Password reset token lifecycle
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash      TEXT NOT NULL UNIQUE,
        expires_at      TEXT NOT NULL,
        used_at         TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
        ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
        ON password_reset_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
        ON password_reset_tokens(expires_at);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // mercury_credentials — Encrypted Mercury Network API credentials
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS mercury_credentials (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        api_key_encrypted TEXT NOT NULL,
        -- api_key_encrypted: AES-256-GCM encrypted Mercury API key
        vendor_id       TEXT NOT NULL,
        -- vendor_id: Merchant ID assigned by Mercury
        environment     TEXT NOT NULL DEFAULT 'sandbox',
        -- environment: sandbox | production
        is_active       INTEGER NOT NULL DEFAULT 1,
        configured_at   TEXT NOT NULL DEFAULT (datetime('now')),
        tested_at       TEXT,
        -- tested_at: Last successful health check
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, vendor_id)
      );

      CREATE INDEX IF NOT EXISTS idx_mercury_credentials_user_id
        ON mercury_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_mercury_credentials_is_active
        ON mercury_credentials(is_active);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // mercury_orders — Mercury order tracking and status sync
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS mercury_orders (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mercury_order_id TEXT NOT NULL,
        -- mercury_order_id: Order ID from Mercury Network
        case_id         TEXT REFERENCES case_records(case_id),
        -- case_id: Linked case in Real Brain
        status          TEXT NOT NULL DEFAULT 'received',
        -- status: received | accepted | in_progress | on_hold | completed | revision_requested | cancelled
        order_xml       TEXT,
        -- order_xml: Original MISMO order XML
        received_at     TEXT NOT NULL DEFAULT (datetime('now')),
        accepted_at     TEXT,
        delivered_at    TEXT,
        revised_at      TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_mercury_orders_user_id
        ON mercury_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_mercury_orders_case_id
        ON mercury_orders(case_id);
      CREATE INDEX IF NOT EXISTS idx_mercury_orders_mercury_order_id
        ON mercury_orders(mercury_order_id);
      CREATE INDEX IF NOT EXISTS idx_mercury_orders_status
        ON mercury_orders(status);
      CREATE INDEX IF NOT EXISTS idx_mercury_orders_received_at
        ON mercury_orders(received_at DESC);
    `);

    log.info('migration:phase25-complete', {
      tablesCreated: [
        'refresh_tokens',
        'oauth_accounts',
        'password_reset_tokens',
        'mercury_credentials',
        'mercury_orders',
      ],
    });
  } catch (err) {
    log.error('migration:phase25-failed', {
      error: err.message,
    });
    throw err;
  }
}
