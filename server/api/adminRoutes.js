/**
 * server/api/adminRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin API routes: user management, system stats, subscription overrides.
 * Protected by admin role check.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getDb } from '../db/database.js';
import log from '../logger.js';

const router = Router();

/**
 * Admin guard — only admin or appraiser (owner) can access.
 * In single-user mode (CACC_AUTH_ENABLED=false), userId is 'default' which passes.
 */
function adminGuard(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.userId === 'default') {
    return next();
  }
  return res.status(403).json({ ok: false, error: 'Admin access required' });
}

// ── GET /admin/users ─────────────────────────────────────────────────────────

router.get('/admin/users', authMiddleware, adminGuard, (req, res) => {
  const db = getDb();
  try {
    const users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.email, u.role, u.status,
             u.created_at, u.last_login_at, u.login_count,
             s.plan, s.status as sub_status, s.reports_this_month, s.reports_limit,
             s.stripe_customer_id,
             k.examples_count
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      LEFT JOIN user_kb_config k ON k.user_id = u.id
      ORDER BY u.created_at DESC
    `).all();

    res.json({ ok: true, users, total: users.length });
  } catch (err) {
    res.json({ ok: true, users: [], total: 0, note: err.message });
  }
});

// ── GET /admin/stats ─────────────────────────────────────────────────────────

router.get('/admin/stats', authMiddleware, adminGuard, (req, res) => {
  const db = getDb();
  try {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;

    let subBreakdown = {};
    try {
      const subs = db.prepare('SELECT plan, COUNT(*) as c FROM subscriptions GROUP BY plan').all();
      subBreakdown = Object.fromEntries(subs.map(s => [s.plan, s.c]));
    } catch { /* ok */ }

    let caseCount = 0;
    try {
      caseCount = db.prepare('SELECT COUNT(*) as c FROM case_records').get()?.c || 0;
    } catch { /* ok */ }

    let sectionCount = 0;
    try {
      sectionCount = db.prepare('SELECT COUNT(*) as c FROM generated_sections').get()?.c || 0;
    } catch { /* ok */ }

    let kbTotal = 0;
    try {
      kbTotal = db.prepare("SELECT COUNT(*) as c FROM user_approved_sections").get()?.c || 0;
    } catch { /* ok */ }

    let exportCount = 0;
    try {
      exportCount = db.prepare('SELECT COUNT(*) as c FROM export_jobs').get()?.c || 0;
    } catch { /* ok */ }

    res.json({
      ok: true,
      users: userCount,
      subscriptions: subBreakdown,
      cases: caseCount,
      generatedSections: sectionCount,
      kbExamples: kbTotal,
      exports: exportCount,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /admin/users/:userId/plan ──────────────────────────────────────────

router.patch('/admin/users/:userId/plan', authMiddleware, adminGuard, (req, res) => {
  const db = getDb();
  const { plan, reportsLimit } = req.body || {};

  const VALID_PLANS = ['free', 'starter', 'professional', 'enterprise'];
  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ ok: false, error: `Invalid plan. Must be: ${VALID_PLANS.join(', ')}` });
  }

  const limits = { free: 5, starter: 30, professional: 100, enterprise: 999999 };
  const limit = reportsLimit || limits[plan];

  try {
    db.prepare(`
      UPDATE subscriptions SET plan = ?, reports_limit = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(plan, limit, req.params.userId);

    log.info('admin:plan-changed', { userId: req.params.userId, plan, limit });
    res.json({ ok: true, userId: req.params.userId, plan, reportsLimit: limit });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /admin/users/:userId ──────────────────────────────────────────────

router.delete('/admin/users/:userId', authMiddleware, adminGuard, (req, res) => {
  const db = getDb();
  const userId = req.params.userId;

  try {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('disabled', userId);
    log.info('admin:user-disabled', { userId });
    res.json({ ok: true, userId, status: 'disabled' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
