/**
 * server/api/oauthRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OAuth & Enhanced Auth Routes
 *
 * Endpoints:
 *   GET    /api/auth/google                  - Redirect to Google OAuth
 *   GET    /api/auth/google/callback         - Handle Google OAuth callback
 *   POST   /api/auth/refresh                 - Refresh access token
 *   POST   /api/auth/logout                  - Revoke refresh token
 *   POST   /api/auth/password/reset-request  - Request password reset
 *   POST   /api/auth/password/reset          - Reset password with token
 *   POST   /api/auth/password/change         - Change password (authenticated)
 *   GET    /api/auth/sessions                - List active sessions
 *   DELETE /api/auth/sessions/:sessionId     - Revoke specific session
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  generateTokenPair,
  refreshAccessToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  requestPasswordReset,
  validateResetToken,
  resetPassword,
  changePassword,
} from '../auth/oauthService.js';
import { validateBody } from '../middleware/validateRequest.js';
import { authMiddleware } from './authMiddleware.js';
import log from '../logger.js';

const router = Router();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const googleCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code required'),
  state: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
});

const passwordResetRequestSchema = z.object({
  email: z.string().email('Valid email required'),
});

const passwordResetSchema = z.object({
  token: z.string().min(1, 'Reset token required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
});

// ── GET /api/auth/google ─ Redirect to Google OAuth ─────────────────────────

router.get('/auth/google', (req, res) => {
  try {
    const state = req.query.state || undefined;
    const authUrl = getGoogleAuthUrl(state);
    res.json({ ok: true, authUrl });
  } catch (err) {
    log.error('oauth:google-url-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── GET /api/auth/google/callback ─ Handle Google OAuth callback ────────────

router.get('/auth/google/callback', validateBody(googleCallbackSchema), async (req, res) => {
  try {
    const code = req.query.code || req.body?.code;
    if (!code) throw new Error('Authorization code required');

    const result = await handleGoogleCallback(code);

    res.json({
      ok: true,
      ...result,
    });

    log.info('oauth:google-callback-success', { userId: result.userId });
  } catch (err) {
    log.error('oauth:google-callback-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/auth/refresh ─ Refresh access token ────────────────────────────

router.post('/auth/refresh', validateBody(refreshSchema), (req, res) => {
  try {
    const { refreshToken } = req.validated;
    const result = refreshAccessToken(refreshToken);

    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    log.error('oauth:refresh-error', { error: err.message });
    res.status(401).json({ ok: false, error: err.message });
  }
});

// ── POST /api/auth/logout ─ Revoke current refresh token ──────────────────────

router.post('/auth/logout', authMiddleware, (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;

    if (refreshToken) {
      // Logout from specific device
      revokeRefreshToken(refreshToken);
    } else {
      // Logout from all devices
      revokeAllUserTokens(req.user.userId);
    }

    res.json({ ok: true, message: 'Logged out successfully' });
    log.info('oauth:logout', { userId: req.user.userId });
  } catch (err) {
    log.error('oauth:logout-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/auth/password/reset-request ─ Request password reset ────────────

router.post('/auth/password/reset-request', validateBody(passwordResetRequestSchema), (req, res) => {
  try {
    const { email } = req.validated;

    // Rate limit password reset requests per IP
    const resetKey = `reset:${req.ip}`;
    // TODO: Implement rate limiting
    // const rateCheck = checkLoginRateLimit(resetKey);
    // if (!rateCheck.allowed) {
    //   return res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
    // }

    const result = requestPasswordReset(email);

    // Always return success to prevent email enumeration
    if (result && process.env.NODE_ENV !== 'production') {
      console.log(`[auth] Password reset token for ${email}: ${result.token}`);
    }

    res.json({
      ok: true,
      message: 'If that email is registered, a password reset link has been sent.',
    });

    log.info('oauth:password-reset-requested', { email: email ? email.split('@')[0] : 'unknown' });
  } catch (err) {
    log.error('oauth:password-reset-request-error', { error: err.message });
    res.status(500).json({ ok: false, error: 'Failed to process reset request' });
  }
});

// ── POST /api/auth/password/reset ─ Reset password with token ─────────────────

router.post('/auth/password/reset', validateBody(passwordResetSchema), async (req, res) => {
  try {
    const { token, newPassword } = req.validated;

    // Validate token first
    const validation = validateResetToken(token);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.reason });
    }

    // Reset password
    const result = await resetPassword(token, newPassword);

    res.json({
      ok: true,
      message: 'Password reset successfully. Please log in with your new password.',
      userId: result.userId,
    });

    log.info('oauth:password-reset-completed');
  } catch (err) {
    log.error('oauth:password-reset-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/auth/password/change ─ Change password (authenticated) ──────────

router.post('/auth/password/change', authMiddleware, validateBody(changePasswordSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.validated;

    await changePassword(userId, currentPassword, newPassword);

    res.json({
      ok: true,
      message: 'Password changed successfully. Please log in with your new password.',
    });

    log.info('oauth:password-changed', { userId });
  } catch (err) {
    log.error('oauth:change-password-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── GET /api/auth/sessions ─ List active sessions for user ──────────────────────

router.get('/auth/sessions', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;

    const sessions = db.prepare(`
      SELECT id, device_info, ip_address, issued_at, expires_at
      FROM refresh_tokens
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY issued_at DESC
    `).all(userId);

    res.json({
      ok: true,
      sessions: sessions.map(s => ({
        id: s.id,
        device: s.device_info || 'Unknown device',
        ip: s.ip_address || 'Unknown IP',
        issuedAt: s.issued_at,
        expiresAt: s.expires_at,
      })),
      total: sessions.length,
    });

    log.info('oauth:list-sessions', { userId, count: sessions.length });
  } catch (err) {
    log.error('oauth:list-sessions-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/auth/sessions/:sessionId ─ Revoke specific session ──────────────

router.delete('/auth/sessions/:sessionId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;
    const { sessionId } = req.params;

    // Verify ownership
    const session = db.prepare(`
      SELECT * FROM refresh_tokens WHERE id = ? AND user_id = ?
    `).get(sessionId, userId);

    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // Revoke session
    const now = new Date().toISOString();
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(now, sessionId);

    res.json({ ok: true, message: 'Session revoked' });
    log.info('oauth:session-revoked', { userId, sessionId });
  } catch (err) {
    log.error('oauth:revoke-session-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
