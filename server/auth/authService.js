/**
 * server/auth/authService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Authentication service: register, login, JWT tokens, password hashing.
 * Multi-tenant user management for Appraisal Agent SaaS.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db/database.js';
import log from '../logger.js';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;

// ── Schema migration ─────────────────────────────────────────────────────────

export function ensureAuthSchema() {
  const db = getDb();

  db.exec(`
    -- Add password_hash column if missing
    CREATE TABLE IF NOT EXISTS auth_credentials (
      user_id       TEXT PRIMARY KEY REFERENCES users(id),
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- Subscription / billing info
    CREATE TABLE IF NOT EXISTS subscriptions (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id         TEXT NOT NULL REFERENCES users(id),
      plan            TEXT NOT NULL DEFAULT 'free',
      status          TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id    TEXT,
      stripe_subscription_id TEXT,
      reports_this_month    INTEGER DEFAULT 0,
      reports_limit         INTEGER DEFAULT 5,
      current_period_start  TEXT,
      current_period_end    TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- Per-user KB isolation tracking
    CREATE TABLE IF NOT EXISTS user_kb_config (
      user_id         TEXT PRIMARY KEY REFERENCES users(id),
      kb_directory    TEXT NOT NULL,
      voice_model     TEXT,
      lora_adapter    TEXT,
      examples_count  INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);

  log.info('auth:schema', { status: 'ready' });
}

// ── User Registration ────────────────────────────────────────────────────────

export async function registerUser({ username, email, password, displayName }) {
  const db = getDb();

  // Validate
  if (!username || username.length < 3) throw new Error('Username must be at least 3 characters');
  if (!email || !email.includes('@')) throw new Error('Valid email required');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');

  // Check uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) throw new Error('Username or email already registered');

  // Create user
  const userId = crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  db.prepare(`
    INSERT INTO users (id, username, display_name, email, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'appraiser', 'active', ?, ?)
  `).run(userId, username, displayName || username, email, now, now);

  db.prepare(`
    INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, passwordHash, now, now);

  // Create per-user KB directory
  const kbDir = `knowledge_base/users/${userId}`;
  db.prepare(`
    INSERT INTO user_kb_config (user_id, kb_directory, created_at)
    VALUES (?, ?, ?)
  `).run(userId, kbDir, now);

  // Create default subscription (free tier)
  db.prepare(`
    INSERT INTO subscriptions (user_id, plan, status, reports_limit, created_at, updated_at)
    VALUES (?, 'free', 'active', 5, ?, ?)
  `).run(userId, now, now);

  log.info('auth:register', { userId, username, email });

  return { userId, username, email, displayName: displayName || username };
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginUser({ username, password }) {
  const db = getDb();

  const user = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.role, u.status,
           ac.password_hash
    FROM users u
    JOIN auth_credentials ac ON ac.user_id = u.id
    WHERE u.username = ? OR u.email = ?
  `).get(username, username);

  if (!user) throw new Error('Invalid credentials');
  if (user.status !== 'active') throw new Error('Account is not active');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('Invalid credentials');

  // Update login stats
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, login_count = COALESCE(login_count, 0) + 1, updated_at = ? WHERE id = ?')
    .run(now, now, user.id);

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  log.info('auth:login', { userId: user.id, username: user.username });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      role: user.role,
    }
  };
}

// ── JWT Verification ─────────────────────────────────────────────────────────

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

export function authMiddleware(req, res, next) {
  // When auth is disabled, still try to parse JWT if present (needed for billing/user-specific features)
  if (process.env.CACC_AUTH_ENABLED === 'false' || process.env.CACC_AUTH_ENABLED === '0') {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = verifyToken(authHeader.slice(7));
      if (decoded) {
        req.user = { userId: decoded.userId || decoded.sub, username: decoded.username, role: decoded.role || 'user' };
        return next();
      }
    }
    req.user = { userId: 'default', username: 'admin', role: 'admin' };
    return next();
  }

  // Check API key first (backward compat)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.CACC_API_KEY) {
    req.user = { userId: 'default', username: 'admin', role: 'admin' };
    return next();
  }

  // Check JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

// ── Subscription Check ───────────────────────────────────────────────────────

export function getSubscription(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
}

export function checkReportQuota(userId) {
  const sub = getSubscription(userId);
  if (!sub) return { allowed: false, reason: 'No subscription found' };
  if (sub.status !== 'active') return { allowed: false, reason: 'Subscription inactive' };
  if (sub.plan === 'unlimited' || sub.plan === 'enterprise') return { allowed: true, remaining: Infinity };
  if (sub.reports_this_month >= sub.reports_limit) {
    return { allowed: false, reason: `Monthly limit reached (${sub.reports_limit} reports)`, plan: sub.plan };
  }
  return { allowed: true, remaining: sub.reports_limit - sub.reports_this_month, plan: sub.plan };
}

export function incrementReportCount(userId) {
  const db = getDb();
  db.prepare('UPDATE subscriptions SET reports_this_month = reports_this_month + 1, updated_at = datetime("now") WHERE user_id = ?')
    .run(userId);
}

// ── Subscription Plans ───────────────────────────────────────────────────────

export const PLANS = {
  free: { label: 'Free', reports: 5, price: 0, features: ['5 reports/month', 'Basic AI generation', 'Single form type'] },
  starter: { label: 'Starter', reports: 30, price: 49, features: ['30 reports/month', 'All form types', 'Voice training', 'Priority generation'] },
  professional: { label: 'Professional', reports: 100, price: 149, features: ['100 reports/month', 'All form types', 'Custom voice model', 'ACI + RQ insertion', 'Priority support'] },
  enterprise: { label: 'Enterprise', reports: Infinity, price: 299, features: ['Unlimited reports', 'All features', 'Custom fine-tuned model', 'API access', 'White-label option', 'Dedicated support'] },
};

export { JWT_SECRET };
