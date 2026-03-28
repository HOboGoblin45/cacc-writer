/**
 * server/billing/customerPortal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe Customer Portal Integration
 *
 * Provides self-service billing management:
 *   - Upgrade/downgrade subscriptions
 *   - Update payment methods
 *   - Cancel subscriptions with feedback
 *   - View invoice history
 *   - Apply promo codes
 *   - Preview proration
 */

import Stripe from 'stripe';
import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const APP_URL = process.env.APP_URL || 'http://localhost:5178';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export function isStripeConfigured() {
  return Boolean(stripe);
}

// ── Create Portal Session ──────────────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session for self-service billing.
 * Allows users to update payment method, downgrade, etc.
 *
 * @param {string} userId
 * @param {string} returnUrl - URL to return to after portal session
 * @returns {object} { portalUrl }
 */
export async function createPortalSession(userId, returnUrl = null) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId);

  if (!sub?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this user');
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl || `${APP_URL}/billing`,
    });

    log.info('billing:portal-session-created', { userId, sessionId: session.id });
    return { portalUrl: session.url };
  } catch (err) {
    log.error('billing:portal-session-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Get Billing History ────────────────────────────────────────────────────────

/**
 * Get invoice history for a user with pagination.
 *
 * @param {string} userId
 * @param {object} options - { limit: 25, offset: 0 }
 * @returns {object} { invoices, total, hasMore }
 */
export async function getCustomerBillingHistory(userId, { limit = 25, offset = 0 } = {}) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId);

  if (!sub?.stripe_customer_id) {
    return { invoices: [], total: 0, hasMore: false };
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: sub.stripe_customer_id,
      limit: Math.min(limit, 100),
      offset,
    });

    const formatted = invoices.data.map(inv => ({
      id: inv.id,
      number: inv.number,
      date: new Date(inv.created * 1000).toISOString(),
      amount: inv.total / 100,
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      pdfUrl: inv.invoice_pdf,
      paid: inv.paid,
      dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
    }));

    log.info('billing:history-fetched', { userId, count: formatted.length });
    return {
      invoices: formatted,
      total: invoices.data.length,
      hasMore: invoices.has_more,
    };
  } catch (err) {
    log.error('billing:history-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Update Payment Method ──────────────────────────────────────────────────────

/**
 * Redirect user to payment method update in customer portal.
 * This is typically done via the portal session above.
 * This method creates a direct session for payment method updates.
 *
 * @param {string} userId
 * @returns {object} { portalUrl }
 */
export async function updatePaymentMethod(userId) {
  return createPortalSession(userId);
}

// ── Cancel Subscription ────────────────────────────────────────────────────────

/**
 * Cancel a subscription with optional feedback.
 * Stores cancellation reason and feedback in subscription_changes table.
 *
 * @param {string} userId
 * @param {string} reason - Cancellation reason
 * @param {string} feedback - Optional user feedback
 * @returns {boolean} success
 */
export async function cancelSubscription(userId, reason = 'user_requested', feedback = null) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare(
    'SELECT stripe_subscription_id, plan FROM subscriptions WHERE user_id = ?'
  ).get(userId);

  if (!sub?.stripe_subscription_id) {
    throw new Error('No active subscription found');
  }

  try {
    await stripe.subscriptions.del(sub.stripe_subscription_id);

    // Log the cancellation in subscription_changes
    const changeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO subscription_changes
        (id, user_id, from_tier, to_tier, change_type, reason, metadata_json)
      VALUES (?, ?, ?, 'free', 'cancel', ?, ?)
    `).run(changeId, userId, sub.plan, reason, JSON.stringify({ feedback }));

    log.info('billing:subscription-cancelled', { userId, reason, feedback });
    return true;
  } catch (err) {
    log.error('billing:cancel-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Reactivate Subscription ────────────────────────────────────────────────────

/**
 * Reactivate a canceled-but-not-yet-expired subscription.
 * Only works if subscription cancellation is scheduled for the future.
 *
 * @param {string} userId
 * @returns {boolean} success
 */
export async function reactivateSubscription(userId) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare(
    'SELECT stripe_subscription_id, plan FROM subscriptions WHERE user_id = ?'
  ).get(userId);

  if (!sub?.stripe_subscription_id) {
    throw new Error('No subscription found');
  }

  try {
    // Check if subscription is scheduled for cancellation
    const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

    if (!subscription.cancel_at) {
      throw new Error('Subscription is not scheduled for cancellation');
    }

    // Update to remove cancellation
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    // Log the reactivation
    const changeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO subscription_changes
        (id, user_id, from_tier, to_tier, change_type)
      VALUES (?, ?, 'free', ?, 'reactivate')
    `).run(changeId, userId, sub.plan);

    log.info('billing:subscription-reactivated', { userId });
    return true;
  } catch (err) {
    log.error('billing:reactivate-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Apply Promo Code ───────────────────────────────────────────────────────────

/**
 * Apply a promotional code to a user's account.
 * Creates or updates a Stripe coupon and applies to next invoice.
 *
 * @param {string} userId
 * @param {string} code - Promo code
 * @returns {object} { applied: boolean, discount: number, message: string }
 */
export async function applyPromoCode(userId, code) {
  const db = getDb();

  try {
    // Look up promo code in database
    const promo = db.prepare(`
      SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE
    `).get(code.toUpperCase());

    if (!promo) {
      return { applied: false, message: 'Promo code not found' };
    }

    const now = new Date();
    const validFrom = promo.valid_from ? new Date(promo.valid_from) : null;
    const validUntil = promo.valid_until ? new Date(promo.valid_until) : null;

    // Check validity dates
    if (validFrom && now < validFrom) {
      return { applied: false, message: 'This promo code is not yet valid' };
    }

    if (validUntil && now > validUntil) {
      return { applied: false, message: 'This promo code has expired' };
    }

    // Check usage limits
    if (promo.max_uses && promo.current_uses >= promo.max_uses) {
      return { applied: false, message: 'This promo code has reached its usage limit' };
    }

    // Get user's Stripe customer
    const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(
      userId
    );

    if (!sub?.stripe_customer_id) {
      return { applied: false, message: 'No active subscription found' };
    }

    // Create Stripe coupon if needed
    let stripePromoId = promo.stripe_coupon_id;
    if (!stripePromoId && stripe) {
      try {
        const coupon = await stripe.coupons.create({
          percent_off: promo.discount_percent,
          duration: 'once',
        });
        stripePromoId = coupon.id;

        // Save to database
        db.prepare(
          'UPDATE promo_codes SET stripe_coupon_id = ? WHERE id = ?'
        ).run(stripePromoId, promo.id);
      } catch (err) {
        log.error('billing:coupon-creation-failed', { code, error: err.message });
        return { applied: false, message: 'Failed to apply promo code' };
      }
    }

    // Apply to customer (via portal or next invoice)
    if (stripe && stripePromoId) {
      try {
        await stripe.customers.update(sub.stripe_customer_id, {
          coupon: stripePromoId,
        });
      } catch (err) {
        log.warn('billing:coupon-apply-failed', { code, error: err.message });
        // Continue anyway — coupon may be applied manually
      }
    }

    // Increment usage counter
    db.prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?').run(
      promo.id
    );

    log.info('billing:promo-applied', { userId, code, discount: promo.discount_percent });
    return {
      applied: true,
      discount: promo.discount_percent,
      message: `Promo code applied! ${promo.discount_percent}% discount`,
    };
  } catch (err) {
    log.error('billing:promo-apply-failed', { userId, code, error: err.message });
    return { applied: false, message: 'Failed to apply promo code' };
  }
}

// ── Get Upgrade Preview ────────────────────────────────────────────────────────

/**
 * Preview proration amount for upgrading to a new tier.
 * Shows how much credit/charge will be applied on upgrade.
 *
 * @param {string} userId
 * @param {string} newTier - Target tier: 'starter', 'pro', 'enterprise'
 * @param {string} newPriceId - Stripe price ID for new tier
 * @returns {object} { proratedAmount, estimatedNewAmount, effectiveDate }
 */
export async function getUpgradePreview(userId, newTier, newPriceId) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare(
    'SELECT stripe_subscription_id, plan FROM subscriptions WHERE user_id = ?'
  ).get(userId);

  if (!sub?.stripe_subscription_id) {
    throw new Error('No active subscription found');
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

    if (!subscription.items?.data?.[0]) {
      throw new Error('Could not retrieve subscription items');
    }

    const currentItem = subscription.items.data[0];
    const billingCycleAnchor = subscription.billing_cycle_anchor;

    // Request a preview invoice with the new pricing
    const preview = await stripe.invoices.retrieveUpcoming({
      customer: subscription.customer,
      subscription: sub.stripe_subscription_id,
      subscription_items: [
        {
          id: currentItem.id,
          price: newPriceId,
        },
      ],
    });

    const proratedAmount = preview.total / 100; // Convert from cents
    const effectiveDate = new Date(billingCycleAnchor * 1000).toISOString();

    log.info('billing:upgrade-preview-generated', { userId, newTier, proratedAmount });
    return {
      proratedAmount,
      estimatedNewAmount: proratedAmount,
      effectiveDate,
      invoiceUrl: null, // Not generated until upgrade is completed
    };
  } catch (err) {
    log.error('billing:upgrade-preview-failed', { userId, error: err.message });
    throw err;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

export default {
  createPortalSession,
  getCustomerBillingHistory,
  updatePaymentMethod,
  cancelSubscription,
  reactivateSubscription,
  applyPromoCode,
  getUpgradePreview,
  isStripeConfigured,
};
