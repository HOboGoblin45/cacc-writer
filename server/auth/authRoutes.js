/**
 * server/auth/authRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Authentication API routes: register, login, profile, subscription status.
 */

import { Router } from 'express';
import { registerUser, loginUser, verifyToken, authMiddleware, getSubscription, checkReportQuota, PLANS } from './authService.js';
import { getUserKbStats } from '../retrieval/userScopedRetrieval.js';

const router = Router();

// ── POST /auth/register ──────────────────────────────────────────────────────

router.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body || {};
    const result = await registerUser({ username, email, password, displayName });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('already registered') ? 409 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// ── POST /auth/login ─────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await loginUser({ username, password });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// ── GET /auth/me ─────────────────────────────────────────────────────────────

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

// ── GET /auth/voice-stats ─────────────────────────────────────────────────────

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

// ── GET /auth/plans ──────────────────────────────────────────────────────────

router.get('/auth/plans', (_req, res) => {
  res.json({ ok: true, plans: PLANS });
});

export default router;
