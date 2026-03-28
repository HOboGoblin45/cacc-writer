/**
 * server/billing/usageTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Track per-user usage across months and form types.
 *
 * Provides:
 *   - recordGeneration() — log a generation event
 *   - getMonthlyUsage() — current month's generation count
 *   - getUsageHistory() — historical usage (multiple months)
 *   - getUsageSummary() — combined usage + tier + remaining
 */

import { getDb } from '../db/database.js';
import { getSubscriptionStatus } from './subscriptionEnforcer.js';
import log from '../logger.js';

// ── Ensure usage tracking schema ───────────────────────────────────────────────

export function ensureUsageTrackingSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_tracking (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id         TEXT NOT NULL REFERENCES users(id),
      month           TEXT NOT NULL,
      generation_count INTEGER DEFAULT 0,
      form_type_counts TEXT NOT NULL DEFAULT '{}',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_month
      ON usage_tracking(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_usage_tracking_updated
      ON usage_tracking(updated_at);
  `);
}

// ── Record Generation ──────────────────────────────────────────────────────────

/**
 * Record a generation event for a user.
 * Increments monthly counter and tracks form type.
 */
export function recordGeneration(userId, formType, sectionCount = 1) {
  const db = getDb();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    // Get or create usage record for this month
    let usage = db.prepare(`
      SELECT * FROM usage_tracking
      WHERE user_id = ? AND month = ?
    `).get(userId, month);

    if (!usage) {
      db.prepare(`
        INSERT INTO usage_tracking (user_id, month, generation_count, form_type_counts)
        VALUES (?, ?, 1, ?)
      `).run(userId, month, JSON.stringify({ [formType]: 1 }));

      log.info('usage:first-generation', { userId, month, formType });
    } else {
      // Increment count and update form type
      let counts;
      try {
        counts = JSON.parse(usage.form_type_counts || '{}');
      } catch {
        counts = {};
      }

      counts[formType] = (counts[formType] || 0) + 1;
      const newCount = usage.generation_count + 1;

      db.prepare(`
        UPDATE usage_tracking
        SET generation_count = ?,
            form_type_counts = ?,
            updated_at = datetime('now')
        WHERE user_id = ? AND month = ?
      `).run(newCount, JSON.stringify(counts), userId, month);

      log.info('usage:generation-recorded', { userId, month, newCount, formType });
    }
  } catch (err) {
    log.error('usage:record-failed', { userId, formType, error: err.message });
  }
}

// ── Monthly Usage ──────────────────────────────────────────────────────────────

/**
 * Get current month's generation count.
 * Returns: { month, count, formTypes: { ... } }
 */
export function getMonthlyUsage(userId) {
  const db = getDb();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const usage = db.prepare(`
    SELECT generation_count, form_type_counts
    FROM usage_tracking
    WHERE user_id = ? AND month = ?
  `).get(userId, month);

  if (!usage) {
    return {
      month,
      count: 0,
      formTypes: {},
    };
  }

  let formTypes = {};
  try {
    formTypes = JSON.parse(usage.form_type_counts || '{}');
  } catch {
    // Invalid JSON, return empty
  }

  return {
    month,
    count: usage.generation_count || 0,
    formTypes,
  };
}

// ── Usage History ──────────────────────────────────────────────────────────────

/**
 * Get historical usage over multiple months.
 * Returns array of { month, count, formTypes }
 */
export function getUsageHistory(userId, months = 12) {
  const db = getDb();

  const history = db.prepare(`
    SELECT month, generation_count, form_type_counts
    FROM usage_tracking
    WHERE user_id = ?
    ORDER BY month DESC
    LIMIT ?
  `).all(userId, months);

  return history.map(row => {
    let formTypes = {};
    try {
      formTypes = JSON.parse(row.form_type_counts || '{}');
    } catch {
      // Invalid JSON
    }

    return {
      month: row.month,
      count: row.generation_count || 0,
      formTypes,
    };
  });
}

// ── Usage Summary ──────────────────────────────────────────────────────────────

/**
 * Get comprehensive usage summary for a user.
 * Combines current usage, tier, limits, and remaining quota.
 */
export function getUsageSummary(userId) {
  const subscription = getSubscriptionStatus(userId);
  const currentMonth = getMonthlyUsage(userId);
  const history = getUsageHistory(userId, 6);

  return {
    subscription: {
      tier: subscription.tier,
      plan: subscription.plan,
      status: subscription.status,
      renewalDate: subscription.renewalDate,
    },
    current: {
      month: currentMonth.month,
      used: currentMonth.count,
      limit: subscription.limit,
      remaining: subscription.remaining,
      percentUsed: subscription.limit === Infinity ? 0 : Math.round((currentMonth.count / subscription.limit) * 100),
      formTypes: currentMonth.formTypes,
    },
    history: history.slice(0, 6),
    trend: calculateTrend(history),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Calculate usage trend from history.
 * Returns: { average, peak, trend: 'increasing' | 'stable' | 'decreasing' }
 */
function calculateTrend(history) {
  if (history.length < 2) {
    return { average: 0, peak: 0, trend: 'stable' };
  }

  const counts = history.map(h => h.count);
  const average = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  const peak = Math.max(...counts);

  let trend = 'stable';
  if (counts.length >= 3) {
    const recent = counts.slice(0, 2);
    const older = counts.slice(2, 4);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    if (recentAvg > olderAvg * 1.2) trend = 'increasing';
    else if (recentAvg < olderAvg * 0.8) trend = 'decreasing';
  }

  return { average, peak, trend };
}

export default {
  ensureUsageTrackingSchema,
  recordGeneration,
  getMonthlyUsage,
  getUsageHistory,
  getUsageSummary,
};
