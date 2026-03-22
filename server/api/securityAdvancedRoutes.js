/**
 * server/api/securityAdvancedRoutes.js
 * Security audit + rate limit management routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getAuditLog, getSecuritySummary } from '../security/auditLog.js';
import { TIER_LIMITS } from '../security/rateLimiter.js';

const router = Router();

// GET /admin/security/audit — audit log (admin only)
router.get('/admin/security/audit', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && req.user.userId !== 'default') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  const auditLog = getAuditLog(req.query);
  res.json({ ok: true, events: auditLog });
});

// GET /admin/security/summary — security dashboard (admin only)
router.get('/admin/security/summary', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && req.user.userId !== 'default') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  const summary = getSecuritySummary();
  res.json({ ok: true, ...summary });
});

// GET /rate-limits — show current tier limits
router.get('/rate-limits', authMiddleware, (req, res) => {
  const tier = req.user.tier || 'free';
  try {
    const { getDb } = require('../db/database.js');
    const sub = getDb().prepare('SELECT plan FROM subscriptions WHERE user_id = ?').get(req.user.userId);
    if (sub) res.json({ ok: true, tier: sub.plan, limits: TIER_LIMITS[sub.plan] || TIER_LIMITS.free });
    else res.json({ ok: true, tier: 'free', limits: TIER_LIMITS.free });
  } catch {
    res.json({ ok: true, tier, limits: TIER_LIMITS[tier] || TIER_LIMITS.free });
  }
});

export default router;
