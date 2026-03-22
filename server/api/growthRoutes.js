/**
 * server/api/growthRoutes.js
 * Marketplace + referrals + growth routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getReferralCode, recordClick, recordReferralSignup, getReferralDashboard, getLeaderboard } from '../growth/referralSystem.js';

const router = Router();

// GET /referral/code — get your referral code
router.get('/referral/code', authMiddleware, (req, res) => {
  const code = getReferralCode(req.user.userId);
  res.json({ ok: true, ...code, link: `/signup?ref=${code.code}` });
});

// GET /referral/dashboard — referral stats + earnings
router.get('/referral/dashboard', authMiddleware, (req, res) => {
  const dashboard = getReferralDashboard(req.user.userId);
  res.json({ ok: true, ...dashboard });
});

// POST /referral/click/:code — record a referral link click (public)
router.post('/referral/click/:code', (req, res) => {
  recordClick(req.params.code);
  res.json({ ok: true });
});

// POST /referral/signup — record referral on signup (called during registration)
router.post('/referral/signup', authMiddleware, (req, res) => {
  try {
    const result = recordReferralSignup(req.user.userId, req.body.referralCode);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /referral/leaderboard — top referrers
router.get('/referral/leaderboard', (_req, res) => {
  const board = getLeaderboard();
  res.json({ ok: true, leaderboard: board });
});

export default router;
