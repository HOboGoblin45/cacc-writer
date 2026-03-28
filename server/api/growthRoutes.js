/**
 * server/api/growthRoutes.js
 * Marketplace + referrals + growth routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { getReferralCode, recordClick, recordReferralSignup, getReferralDashboard, getLeaderboard } from '../growth/referralSystem.js';

// Zod schemas
const codeParamSchema = z.object({
  code: z.string().min(1, 'code is required'),
});

const referralSignupSchema = z.object({
  referralCode: z.string().min(1, 'referralCode is required'),
});

// Validation middleware
const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

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
router.post('/referral/click/:code', validateParams(codeParamSchema), (req, res) => {
  recordClick(req.validatedParams.code);
  res.json({ ok: true });
});

// POST /referral/signup — record referral on signup (called during registration)
router.post('/referral/signup', authMiddleware, validateBody(referralSignupSchema), (req, res) => {
  try {
    const result = recordReferralSignup(req.user.userId, req.validated.referralCode);
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
