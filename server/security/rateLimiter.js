/**
 * server/security/rateLimiter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-user intelligent rate limiting.
 *
 * Different limits for different tiers and endpoint types:
 *   - Free: 10 AI calls/hour, 5 reports/month
 *   - Starter: 60 AI calls/hour, 30 reports/month
 *   - Professional: 200 AI calls/hour, 100 reports/month
 *   - Enterprise: 1000 AI calls/hour, unlimited
 *
 * Also protects against:
 *   - API abuse (public endpoints)
 *   - Brute force login attempts
 *   - Webhook flood attacks
 *   - File upload abuse
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

// In-memory rate limit store (resets on server restart)
const rateLimitStore = new Map();

const TIER_LIMITS = {
  free:         { aiCallsPerHour: 10,  uploadsPerHour: 5,   requestsPerMinute: 30 },
  starter:      { aiCallsPerHour: 60,  uploadsPerHour: 20,  requestsPerMinute: 120 },
  professional: { aiCallsPerHour: 200, uploadsPerHour: 50,  requestsPerMinute: 300 },
  enterprise:   { aiCallsPerHour: 1000, uploadsPerHour: 200, requestsPerMinute: 600 },
  default:      { aiCallsPerHour: 10,  uploadsPerHour: 5,   requestsPerMinute: 30 },
};

/**
 * Check if a request should be rate limited.
 *
 * @param {string} userId
 * @param {string} limitType — 'ai' | 'upload' | 'request'
 * @param {string} [tier] — subscription tier
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export function checkRateLimit(userId, limitType = 'request', tier = 'free') {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.default;
  const key = `${userId}:${limitType}`;
  const now = Date.now();

  let bucket = rateLimitStore.get(key);
  if (!bucket || now > bucket.resetAt) {
    const window = limitType === 'request' ? 60000 : 3600000; // 1 min for requests, 1 hr for AI/uploads
    bucket = { count: 0, resetAt: now + window };
    rateLimitStore.set(key, bucket);
  }

  const maxKey = limitType === 'ai' ? 'aiCallsPerHour' : limitType === 'upload' ? 'uploadsPerHour' : 'requestsPerMinute';
  const max = limits[maxKey];

  bucket.count++;
  const allowed = bucket.count <= max;
  const remaining = Math.max(0, max - bucket.count);
  const resetIn = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));

  if (!allowed) {
    log.warn('rate-limit:exceeded', { userId, limitType, tier, count: bucket.count, max });
  }

  return { allowed, remaining, resetIn, limit: max };
}

/**
 * Express middleware for rate limiting.
 */
export function rateLimitMiddleware(limitType = 'request') {
  return (req, res, next) => {
    const userId = req.user?.userId || req.ip;
    const tier = req.user?.tier || 'free';

    // Look up tier from subscription if not on user object
    let actualTier = tier;
    if (userId !== req.ip && tier === 'free') {
      try {
        const db = getDb();
        const sub = db.prepare('SELECT plan FROM subscriptions WHERE user_id = ?').get(userId);
        if (sub) actualTier = sub.plan;
      } catch { /* ok */ }
    }

    const result = checkRateLimit(userId, limitType, actualTier);

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetIn);

    if (!result.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded',
        limit: result.limit,
        remaining: 0,
        resetIn: result.resetIn,
        upgrade: actualTier === 'free' ? 'Upgrade to Starter ($49/mo) for higher limits' : null,
      });
    }

    next();
  };
}

/**
 * Login-specific rate limiter (prevent brute force).
 */
const loginAttempts = new Map();

export function checkLoginRateLimit(identifier) {
  const now = Date.now();
  let attempts = loginAttempts.get(identifier);

  if (!attempts || now > attempts.resetAt) {
    attempts = { count: 0, resetAt: now + 900000 }; // 15 min window
    loginAttempts.set(identifier, attempts);
  }

  attempts.count++;
  const maxAttempts = 10;

  if (attempts.count > maxAttempts) {
    log.warn('login:rate-limited', { identifier, attempts: attempts.count });
    return { allowed: false, attemptsRemaining: 0, resetIn: Math.ceil((attempts.resetAt - now) / 1000) };
  }

  return { allowed: true, attemptsRemaining: maxAttempts - attempts.count };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitStore) {
    if (now > bucket.resetAt) rateLimitStore.delete(key);
  }
  for (const [key, bucket] of loginAttempts) {
    if (now > bucket.resetAt) loginAttempts.delete(key);
  }
}, 600000);

export { TIER_LIMITS };
export default { checkRateLimit, rateLimitMiddleware, checkLoginRateLimit, TIER_LIMITS };
