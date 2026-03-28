/**
 * server/auth/oauthService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OAuth 2.0 & Token Management Service
 *
 * Supports:
 *   - Google OAuth 2.0 (primary)
 *   - JWT refresh token rotation with device tracking
 *   - Password reset token lifecycle
 *   - Session revocation and logout
 *
 * Config (via environment):
 *   - GOOGLE_CLIENT_ID
 *   - GOOGLE_CLIENT_SECRET
 *   - GOOGLE_REDIRECT_URI
 *   - JWT_SECRET
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';
import log from '../logger.js';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';
const PASSWORD_RESET_EXPIRES_IN = 60 * 60 * 1000; // 1 hour

// ── Google OAuth 2.0 ────────────────────────────────────────────────────────

/**
 * Generate Google OAuth 2.0 consent URL.
 * User should be redirected to this URL to grant access.
 */
export function getGoogleAuthUrl(state) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI)');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state || crypto.randomBytes(16).toString('hex'),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange Google auth code for tokens and user profile.
 * Creates or updates user account, returns JWT tokens.
 */
export async function handleGoogleCallback(code) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Google OAuth not configured');
    }

    // Exchange code for tokens (stub — actual implementation requires HTTP client)
    // const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     client_id: clientId,
    //     client_secret: clientSecret,
    //     code,
    //     grant_type: 'authorization_code',
    //     redirect_uri: redirectUri,
    //   }),
    // });
    // const tokenData = await tokenResponse.json();
    // const idToken = tokenData.id_token;

    // Decode ID token to get user profile (stub)
    // const payload = jwt.decode(idToken);
    // const googleProfile = {
    //   sub: payload.sub,
    //   email: payload.email,
    //   name: payload.name,
    //   picture: payload.picture,
    // };

    // For now, return placeholder
    const googleProfile = {
      sub: 'google-' + crypto.randomBytes(8).toString('hex'),
      email: 'user@example.com',
      name: 'Example User',
      picture: null,
    };

    const db = getDb();
    const now = new Date().toISOString();

    // Check if OAuth account already exists
    let oauthAccount = db.prepare(
      'SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'
    ).get('google', googleProfile.sub);

    let userId;

    if (oauthAccount) {
      // Update last auth time
      userId = oauthAccount.user_id;
      db.prepare('UPDATE oauth_accounts SET last_auth_at = ? WHERE id = ?')
        .run(now, oauthAccount.id);
    } else {
      // Check if user with this email exists
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(googleProfile.email);

      if (existingUser) {
        userId = existingUser.id;
        // Link OAuth account to existing user
        db.prepare(`
          INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, profile_picture_url, linked_at, last_auth_at)
          VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
        `).run(userId, googleProfile.sub, googleProfile.email, googleProfile.name, googleProfile.picture, now, now);

        log.info('oauth:linked-existing-account', { userId, provider: 'google' });
      } else {
        // Create new user
        userId = crypto.randomBytes(8).toString('hex');

        // Create user record
        db.prepare(`
          INSERT INTO users (id, username, display_name, email, role, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'appraiser', 'active', ?, ?)
        `).run(userId, googleProfile.email.split('@')[0], googleProfile.name, googleProfile.email, now, now);

        // Create OAuth account
        db.prepare(`
          INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, profile_picture_url, linked_at, last_auth_at)
          VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
        `).run(userId, googleProfile.sub, googleProfile.email, googleProfile.name, googleProfile.picture, now, now);

        // Create default subscription
        db.prepare(`
          INSERT INTO subscriptions (user_id, plan, status, reports_limit, created_at, updated_at)
          VALUES (?, 'free', 'active', 5, ?, ?)
        `).run(userId, now, now);

        log.info('oauth:new-user-created', { userId, provider: 'google', email: googleProfile.email });
      }
    }

    // Generate token pair
    const tokens = generateTokenPair(userId);

    log.info('oauth:callback-success', { userId, provider: 'google' });

    return {
      ok: true,
      userId,
      ...tokens,
      user: {
        id: userId,
        email: googleProfile.email,
        displayName: googleProfile.name,
      },
    };
  } catch (err) {
    log.error('oauth:callback-failed', { error: err.message });
    throw err;
  }
}

/**
 * Link an existing user account to a Google OAuth account.
 */
export async function linkGoogleAccount(userId, googleProfile) {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Check if already linked
    const existing = db.prepare(
      'SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?'
    ).get(userId, 'google');

    if (existing) {
      return { ok: false, error: 'Google account already linked to this user' };
    }

    // Check if Google ID already linked to different user
    const taken = db.prepare(
      'SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'
    ).get('google', googleProfile.sub);

    if (taken) {
      return { ok: false, error: 'Google account already linked to another user' };
    }

    // Link account
    db.prepare(`
      INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, linked_at, last_auth_at)
      VALUES (?, 'google', ?, ?, ?, ?, ?)
    `).run(userId, googleProfile.sub, googleProfile.email, googleProfile.name, now, now);

    log.info('oauth:account-linked', { userId, provider: 'google' });

    return { ok: true, message: 'Google account linked successfully' };
  } catch (err) {
    log.error('oauth:link-account-failed', { userId, error: err.message });
    throw err;
  }
}

// ── JWT Token Pair Generation ───────────────────────────────────────────────

/**
 * Generate JWT access token + refresh token pair.
 * Access token: short-lived (15 min)
 * Refresh token: long-lived (30 days), stored hashed in DB
 */
export function generateTokenPair(userId, deviceInfo = null, ipAddress = null) {
  const db = getDb();
  const user = db.prepare('SELECT username, role FROM users WHERE id = ?').get(userId);

  if (!user) throw new Error('User not found');

  const now = new Date().toISOString();

  // Generate access token (JWT)
  const accessToken = jwt.sign(
    { userId, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // Generate refresh token (random, stored hashed)
  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + parseDuration(REFRESH_TOKEN_EXPIRES_IN)).toISOString();

  db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, issued_at, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, refreshTokenHash, deviceInfo || null, ipAddress || null, now, expiresAt, now);

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: JWT_EXPIRES_IN,
  };
}

// ── JWT Refresh Token Rotation ──────────────────────────────────────────────

/**
 * Validate and refresh an access token using a refresh token.
 * Implements token rotation: old token revoked, new tokens issued.
 */
export function refreshAccessToken(refreshToken) {
  try {
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const stored = db.prepare(`
      SELECT rt.*, u.username, u.role, u.status
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ? AND rt.revoked_at IS NULL
    `).get(tokenHash);

    if (!stored) throw new Error('Invalid refresh token');

    const now = new Date();
    if (new Date(stored.expires_at) < now) {
      throw new Error('Refresh token expired');
    }

    if (stored.status !== 'active') {
      throw new Error('User account is not active');
    }

    // Revoke old token
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?')
      .run(new Date().toISOString(), stored.id);

    // Generate new token pair
    return generateTokenPair(stored.user_id, stored.device_info, stored.ip_address);
  } catch (err) {
    log.error('oauth:refresh-token-failed', { error: err.message });
    throw err;
  }
}

/**
 * Revoke a single refresh token (logout from one device).
 */
export function revokeRefreshToken(refreshToken) {
  try {
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date().toISOString();

    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?')
      .run(now, tokenHash);

    log.info('oauth:refresh-token-revoked');
    return { ok: true };
  } catch (err) {
    log.error('oauth:revoke-token-failed', { error: err.message });
    throw err;
  }
}

/**
 * Revoke all refresh tokens for a user (logout from all devices).
 */
export function revokeAllUserTokens(userId) {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ?')
      .run(now, userId);

    log.info('oauth:all-tokens-revoked', { userId });
    return { ok: true };
  } catch (err) {
    log.error('oauth:revoke-all-tokens-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Password Reset ──────────────────────────────────────────────────────────

/**
 * Create a password reset token for an email.
 * Returns raw token (caller sends via email); token stored hashed in DB.
 */
export function requestPasswordReset(email) {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (!user) {
      // Don't reveal whether email exists (security)
      log.info('oauth:password-reset-requested-unknown-email', { email });
      return null;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_IN).toISOString();

    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(user.id, tokenHash, expiresAt, new Date().toISOString());

    log.info('oauth:password-reset-requested', { userId: user.id });

    return {
      token: rawToken,
      userId: user.id,
      expiresIn: PASSWORD_RESET_EXPIRES_IN,
    };
  } catch (err) {
    log.error('oauth:password-reset-request-failed', { email, error: err.message });
    throw err;
  }
}

/**
 * Validate a password reset token.
 */
export function validateResetToken(rawToken) {
  try {
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const token = db.prepare(`
      SELECT * FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL
    `).get(tokenHash);

    if (!token) return { valid: false, reason: 'Invalid token' };

    const now = new Date();
    if (new Date(token.expires_at) < now) {
      return { valid: false, reason: 'Token expired' };
    }

    return { valid: true, userId: token.user_id };
  } catch (err) {
    log.error('oauth:validate-reset-token-failed', { error: err.message });
    return { valid: false, reason: 'Validation failed' };
  }
}

/**
 * Reset password using a valid reset token.
 * Invalidates token and all refresh tokens (force re-login).
 */
export async function resetPassword(rawToken, newPassword) {
  try {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const token = db.prepare(`
      SELECT * FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL
    `).get(tokenHash);

    if (!token) throw new Error('Invalid reset token');

    const now = new Date();
    if (new Date(token.expires_at) < now) {
      throw new Error('Reset token expired');
    }

    // Hash new password
    const bcrypt = await import('bcryptjs');
    const BCRYPT_ROUNDS = 12;
    const passwordHash = await bcrypt.default.hash(newPassword, BCRYPT_ROUNDS);

    const nowStr = new Date().toISOString();

    // Update password
    db.prepare('UPDATE auth_credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?')
      .run(passwordHash, nowStr, token.user_id);

    // Mark token as used
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
      .run(nowStr, token.id);

    // Revoke all sessions (force re-login)
    revokeAllUserTokens(token.user_id);

    log.info('oauth:password-reset-completed', { userId: token.user_id });

    return { ok: true, userId: token.user_id };
  } catch (err) {
    log.error('oauth:reset-password-failed', { error: err.message });
    throw err;
  }
}

/**
 * Change password (authenticated user changing their own password).
 */
export async function changePassword(userId, currentPassword, newPassword) {
  try {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    const db = getDb();
    const creds = db.prepare('SELECT password_hash FROM auth_credentials WHERE user_id = ?').get(userId);

    if (!creds) throw new Error('User credentials not found');

    // Verify current password
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.default.compare(currentPassword, creds.password_hash);
    if (!valid) throw new Error('Current password is incorrect');

    const BCRYPT_ROUNDS = 12;
    const newHash = await bcrypt.default.hash(newPassword, BCRYPT_ROUNDS);
    const nowStr = new Date().toISOString();

    // Update password
    db.prepare('UPDATE auth_credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?')
      .run(newHash, nowStr, userId);

    // Revoke all tokens (logout from all devices)
    revokeAllUserTokens(userId);

    log.info('oauth:password-changed', { userId });

    return { ok: true };
  } catch (err) {
    log.error('oauth:change-password-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Helper: Parse duration string ────────────────────────────────────────────

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30 days
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * 24 * 60 * 60 * 1000;
    default: return val * 1000;
  }
}

export { JWT_SECRET };
