/**
 * server/growth/referralSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Referral and affiliate program.
 *
 * Appraisers know appraisers. Word of mouth is the #1 growth channel.
 * This system incentivizes referrals:
 *
 *   - Each user gets a unique referral code
 *   - Referrer gets 20% of referred user's first 3 months
 *   - Referred user gets 1 month free (extended trial)
 *   - Top referrers shown on leaderboard
 *   - Tracks: clicks, signups, conversions, revenue
 *
 * Also supports affiliate partnerships:
 *   - AMCs can refer their appraisers
 *   - Training companies can embed referral links
 *   - State associations can partner for group discounts
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureReferralSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      code        TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL UNIQUE,
      clicks      INTEGER DEFAULT 0,
      signups     INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      total_earned REAL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      referrer_id     TEXT NOT NULL,
      referred_id     TEXT NOT NULL,
      referral_code   TEXT NOT NULL,
      status          TEXT DEFAULT 'signed_up',
      commission_rate REAL DEFAULT 0.20,
      months_tracked  INTEGER DEFAULT 0,
      total_commission REAL DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(referred_id)
    );

    CREATE TABLE IF NOT EXISTS referral_commissions (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      referral_id TEXT NOT NULL,
      referrer_id TEXT NOT NULL,
      amount      REAL NOT NULL,
      month       INTEGER NOT NULL,
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Get or create a user's referral code.
 */
export function getReferralCode(userId) {
  const db = getDb();
  let existing = db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').get(userId);
  if (existing) return existing;

  // Generate a memorable code
  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
  const name = (user?.username || user?.display_name || '').replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase();
  const code = name ? `${name}${crypto.randomBytes(2).toString('hex').toUpperCase()}` : crypto.randomBytes(4).toString('hex').toUpperCase();

  db.prepare('INSERT INTO referral_codes (code, user_id) VALUES (?, ?)').run(code, userId);
  return db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').get(userId);
}

/**
 * Record a referral code click.
 */
export function recordClick(code) {
  const db = getDb();
  db.prepare('UPDATE referral_codes SET clicks = clicks + 1 WHERE code = ?').run(code);
}

/**
 * Record a signup from referral.
 */
export function recordReferralSignup(referredUserId, referralCode) {
  const db = getDb();
  const codeRecord = db.prepare('SELECT * FROM referral_codes WHERE code = ?').get(referralCode);
  if (!codeRecord) return { error: 'Invalid referral code' };
  if (codeRecord.user_id === referredUserId) return { error: 'Cannot refer yourself' };

  // Check if already referred
  const existing = db.prepare('SELECT id FROM referrals WHERE referred_id = ?').get(referredUserId);
  if (existing) return { error: 'User already has a referrer' };

  const id = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO referrals (id, referrer_id, referred_id, referral_code) VALUES (?, ?, ?, ?)')
    .run(id, codeRecord.user_id, referredUserId, referralCode);

  db.prepare('UPDATE referral_codes SET signups = signups + 1 WHERE code = ?').run(referralCode);

  // Grant referred user extended trial
  try {
    db.prepare("UPDATE subscriptions SET reports_limit = reports_limit + 10, updated_at = datetime('now') WHERE user_id = ?").run(referredUserId);
  } catch { /* ok */ }

  log.info('referral:signup', { referrerId: codeRecord.user_id, referredId: referredUserId, code: referralCode });
  return { success: true, referralId: id, bonusReports: 10 };
}

/**
 * Process commission when a referred user pays.
 */
export function processCommission(referredUserId, paymentAmount) {
  const db = getDb();
  const referral = db.prepare("SELECT * FROM referrals WHERE referred_id = ? AND status != 'expired'").get(referredUserId);
  if (!referral) return null;
  if (referral.months_tracked >= 3) {
    db.prepare("UPDATE referrals SET status = 'completed' WHERE id = ?").run(referral.id);
    return null;
  }

  const commission = Math.round(paymentAmount * referral.commission_rate * 100) / 100;
  const month = referral.months_tracked + 1;

  db.prepare('INSERT INTO referral_commissions (id, referral_id, referrer_id, amount, month) VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)')
    .run(referral.id, referral.referrer_id, commission, month);

  db.prepare('UPDATE referrals SET months_tracked = ?, total_commission = total_commission + ?, status = ? WHERE id = ?')
    .run(month, commission, month >= 3 ? 'completed' : 'active', referral.id);

  db.prepare('UPDATE referral_codes SET conversions = conversions + 1, total_earned = total_earned + ? WHERE user_id = ?')
    .run(commission, referral.referrer_id);

  log.info('referral:commission', { referrerId: referral.referrer_id, amount: commission, month });
  return { commission, month };
}

/**
 * Get referral dashboard for a user.
 */
export function getReferralDashboard(userId) {
  const db = getDb();
  const code = getReferralCode(userId);
  const referrals = db.prepare(`
    SELECT r.*, u.display_name, u.username, s.plan
    FROM referrals r
    JOIN users u ON u.id = r.referred_id
    LEFT JOIN subscriptions s ON s.user_id = r.referred_id
    WHERE r.referrer_id = ?
    ORDER BY r.created_at DESC
  `).all(userId);

  const commissions = db.prepare('SELECT * FROM referral_commissions WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);
  const pendingPayout = commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + c.amount, 0);

  return {
    referralCode: code.code,
    referralLink: `/signup?ref=${code.code}`,
    stats: { clicks: code.clicks, signups: code.signups, conversions: code.conversions, totalEarned: code.total_earned },
    referrals: referrals.map(r => ({
      name: r.display_name || r.username,
      plan: r.plan || 'free',
      status: r.status,
      commission: r.total_commission,
      signedUpAt: r.created_at,
    })),
    recentCommissions: commissions,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
  };
}

/**
 * Referral leaderboard.
 */
export function getLeaderboard(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT rc.code, rc.signups, rc.conversions, rc.total_earned,
           u.display_name, u.username
    FROM referral_codes rc
    JOIN users u ON u.id = rc.user_id
    WHERE rc.conversions > 0
    ORDER BY rc.total_earned DESC
    LIMIT ?
  `).all(limit);
}

export default { ensureReferralSchema, getReferralCode, recordClick, recordReferralSignup, processCommission, getReferralDashboard, getLeaderboard };
