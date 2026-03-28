/**
 * server/auth/authRoutes.js
 * ---------------------------------------------------------------------------
 * Authentication API routes: register, login, profile, refresh, reset, logout.
 */

import { Router } from 'express';
import {
  registerUser, loginUser, verifyToken, authMiddleware,
  getSubscription, checkReportQuota, PLANS,
  refreshAccessToken, revokeAllTokens,
  createPasswordResetToken, resetPassword,
} from './authService.js';
import { getUserKbStats } from '../retrieval/userScopedRetrieval.js';

const router = Router();

// -- POST /auth/register --------------------------------------------------

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name, displayName: dn } = req.body || {};
    // Accept either username or derive it from email's local part
    const username = req.body.username || (email ? email.split('@')[0].replace(/[^a-z0-9_]/gi, '_') : undefined);
    const displayName = dn || name;
    const result = await registerUser({ username, email, password, displayName });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('already registered') ? 409 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// -- POST /auth/login -----------------------------------------------------

router.post('/auth/login', async (req, res) => {
  try {
    // Accept username or email as the login identifier
    const { password } = req.body || {};
    const username = req.body.username || req.body.email;
    const result = await loginUser({ username, password });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// -- POST /auth/refresh ---------------------------------------------------

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ ok: false, error: 'refreshToken required' });
    const result = await refreshAccessToken(refreshToken);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// -- POST /auth/logout ----------------------------------------------------

router.post('/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = verifyToken(authHeader.slice(7));
      if (decoded && decoded.userId) {
        revokeAllTokens(decoded.userId);
      }
    }
    res.json({ ok: true, message: 'Logged out' });
  } catch (_err) {
    // Logout should always succeed from client perspective
    res.json({ ok: true, message: 'Logged out' });
  }
});

// -- POST /auth/forgot-password -------------------------------------------

router.post('/auth/forgot-password', (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

    const result = createPasswordResetToken(email);
    // Always return success to prevent email enumeration attacks
    if (result && process.env.NODE_ENV !== 'production') {
      console.log(`[auth] Password reset token for ${email}: ${result.token}`);
    }
    // TODO: integrate email service (SendGrid/SES) to send reset link
    res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (_err) {
    res.status(500).json({ ok: false, error: 'Failed to process reset request' });
  }
});

// -- POST /auth/reset-password --------------------------------------------

router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ ok: false, error: 'token and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }
    await resetPassword(token, newPassword);
    res.json({ ok: true, message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// -- GET /auth/me ---------------------------------------------------------

router.get('/auth/me', (req, res) => {
  // Always use JWT for /auth/me (even if CACC_AUTH_ENABLED=false)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token required' });
  }
  const decoded = verifyToken(authHeader.slice(7));
  if (!decoded) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const sub = getSubscription(decoded.userId);
  const quota = checkReportQuota(decoded.userId);
  res.json({
    ok: true,
    user: decoded,
    subscription: sub ? {
      plan: sub.plan,
      status: sub.status,
      reportsUsed: sub.reports_this_month,
      reportsLimit: sub.reports_limit,
      ...quota,
    } : null,
  });
});

// -- GET /auth/voice-stats ------------------------------------------------

router.get('/auth/voice-stats', authMiddleware, (req, res) => {
  const stats = getUserKbStats(req.user.userId);
  const readiness = stats.totalExamples >= 50 ? 'excellent'
    : stats.totalExamples >= 20 ? 'good'
    : stats.totalExamples >= 10 ? 'learning'
    : 'starting';
  res.json({
    ok: true,
    ...stats,
    readiness,
    message: readiness === 'excellent'
      ? 'Your AI voice model is well-trained. Generation quality should closely match your writing style.'
      : readiness === 'good'
      ? 'Your voice model is building nicely. Keep approving sections to improve it further.'
      : readiness === 'learning'
      ? `${stats.totalExamples} approved sections so far. Aim for 20+ per form type for best results.`
      : 'Your voice model is just getting started. Approve generated sections to teach the AI your style.',
  });
});

// -- GET /auth/plans ------------------------------------------------------

router.get('/auth/plans', (_req, res) => {
  res.json({ ok: true, plans: PLANS });
});

export default router;
