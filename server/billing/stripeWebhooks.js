/**
 * server/billing/stripeWebhooks.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe Webhook Event Handlers
 *
 * Processes subscription lifecycle events:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_succeeded
 *   - invoice.payment_failed
 *   - customer.subscription.trial_will_end
 *
 * Each handler updates subscriptions table and audit log.
 */

import { getDb } from '../db/database.js';
import { resetMonthlyQuota } from './subscriptionEnforcer.js';
import { logSecurityEvent } from '../security/auditLog.js';
import log from '../logger.js';

// ── Subscription Created ───────────────────────────────────────────────────────

/**
 * Handle customer.subscription.created event.
 * Activates subscription when user completes checkout.
 */
export function handleSubscriptionCreated(subscription) {
  const db = getDb();
  const customerId = subscription.customer;
  const plan = mapStripePlanToTier(subscription);

  const user = db.prepare(`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'subscription.created' });
    return;
  }

  const userId = user.user_id;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?,
        status = 'active',
        stripe_subscription_id = ?,
        reports_this_month = 0,
        reports_limit = ?,
        current_period_start = ?,
        current_period_end = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(
    plan,
    subscription.id,
    getPlanReportLimit(plan),
    new Date(subscription.current_period_start * 1000).toISOString(),
    new Date(subscription.current_period_end * 1000).toISOString(),
    now,
    userId
  );

  logSecurityEvent({
    userId,
    eventType: 'subscription_change',
    resource: 'subscription',
    action: 'subscription_created',
    details: { plan, stripeSubscriptionId: subscription.id },
  });

  log.info('stripe:subscription-created', { userId, plan, stripeId: subscription.id });
}

// ── Subscription Updated ───────────────────────────────────────────────────────

/**
 * Handle customer.subscription.updated event.
 * Handles plan changes, status changes (e.g., past_due).
 */
export function handleSubscriptionUpdated(subscription) {
  const db = getDb();
  const customerId = subscription.customer;

  const user = db.prepare(`
    SELECT user_id, plan FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'subscription.updated' });
    return;
  }

  const userId = user.user_id;
  const oldPlan = user.plan;
  const newPlan = mapStripePlanToTier(subscription);
  const newStatus = subscription.status === 'active' ? 'active' : 'past_due';

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?,
        status = ?,
        reports_limit = ?,
        current_period_start = ?,
        current_period_end = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(
    newPlan,
    newStatus,
    getPlanReportLimit(newPlan),
    new Date(subscription.current_period_start * 1000).toISOString(),
    new Date(subscription.current_period_end * 1000).toISOString(),
    now,
    userId
  );

  if (oldPlan !== newPlan) {
    logSecurityEvent({
      userId,
      eventType: 'subscription_change',
      resource: 'subscription',
      action: 'plan_changed',
      details: { oldPlan, newPlan, stripeSubscriptionId: subscription.id },
    });
  }

  if (newStatus === 'past_due') {
    logSecurityEvent({
      userId,
      eventType: 'subscription_change',
      resource: 'subscription',
      action: 'payment_failed',
      details: { plan: newPlan },
    });
  }

  log.info('stripe:subscription-updated', { userId, oldPlan, newPlan, status: newStatus });
}

// ── Subscription Deleted ───────────────────────────────────────────────────────

/**
 * Handle customer.subscription.deleted event.
 * Cancels subscription and downgrades user to free tier.
 */
export function handleSubscriptionDeleted(subscription) {
  const db = getDb();
  const customerId = subscription.customer;

  const user = db.prepare(`
    SELECT user_id, plan FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'subscription.deleted' });
    return;
  }

  const userId = user.user_id;
  const oldPlan = user.plan;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE subscriptions
    SET plan = 'free',
        status = 'active',
        stripe_subscription_id = NULL,
        reports_limit = 5,
        reports_this_month = 0,
        updated_at = ?
    WHERE user_id = ?
  `).run(now, userId);

  logSecurityEvent({
    userId,
    eventType: 'subscription_change',
    resource: 'subscription',
    action: 'subscription_cancelled',
    details: { formerPlan: oldPlan, stripeSubscriptionId: subscription.id },
  });

  log.info('stripe:subscription-deleted', { userId, formerPlan: oldPlan });
}

// ── Invoice Payment Succeeded ──────────────────────────────────────────────────

/**
 * Handle invoice.payment_succeeded event.
 * Resets monthly quota when payment is received.
 */
export function handleInvoicePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  const db = getDb();

  const user = db.prepare(`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'invoice.payment_succeeded' });
    return;
  }

  const userId = user.user_id;

  resetMonthlyQuota(userId);

  logSecurityEvent({
    userId,
    eventType: 'billing',
    resource: 'invoice',
    action: 'payment_received',
    details: { stripeInvoiceId: invoice.id, amount: invoice.amount_paid },
  });

  log.info('stripe:payment-succeeded', { userId, invoiceId: invoice.id, amount: invoice.amount_paid });
}

// ── Invoice Payment Failed ─────────────────────────────────────────────────────

/**
 * Handle invoice.payment_failed event.
 * Sends warning, initiates grace period (3 days).
 */
export function handleInvoicePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const db = getDb();

  const user = db.prepare(`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'invoice.payment_failed' });
    return;
  }

  const userId = user.user_id;

  // Update subscription status to past_due
  db.prepare(`
    UPDATE subscriptions
    SET status = 'past_due',
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);

  logSecurityEvent({
    userId,
    eventType: 'billing',
    resource: 'invoice',
    action: 'payment_failed',
    details: {
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_due,
      nextRetryDate: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
    },
  });

  // TODO: Send email notification to user about payment failure and grace period

  log.warn('stripe:payment-failed', { userId, invoiceId: invoice.id, amount: invoice.amount_due });
}

// ── Subscription Trial Ending ──────────────────────────────────────────────────

/**
 * Handle customer.subscription.trial_will_end event.
 * Notifies user that trial is ending (sent 3 days before).
 */
export function handleSubscriptionTrialWillEnd(subscription) {
  const customerId = subscription.customer;
  const db = getDb();

  const user = db.prepare(`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ?
  `).get(customerId);

  if (!user) {
    log.warn('stripe:webhook-no-user', { customerId, event: 'customer.subscription.trial_will_end' });
    return;
  }

  const userId = user.user_id;
  const trialEndDate = new Date(subscription.trial_end * 1000).toISOString();

  logSecurityEvent({
    userId,
    eventType: 'billing',
    resource: 'subscription',
    action: 'trial_ending_notification',
    details: {
      stripeSubscriptionId: subscription.id,
      trialEndDate,
      plan: mapStripePlanToTier(subscription),
    },
  });

  // TODO: Send email notification to user about trial ending

  log.info('stripe:trial-ending', { userId, trialEndDate, plan: mapStripePlanToTier(subscription) });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Map Stripe price/plan to internal tier name.
 * Looks up price_id from subscription items.
 */
function mapStripePlanToTier(subscription) {
  if (!subscription.items || subscription.items.data.length === 0) {
    return 'free';
  }

  const priceId = subscription.items.data[0].price.id;
  const priceMap = {
    [process.env.STRIPE_PRICE_STARTER]: 'starter',
    [process.env.STRIPE_PRICE_PROFESSIONAL]: 'pro',
    [process.env.STRIPE_PRICE_ENTERPRISE]: 'enterprise',
  };

  return priceMap[priceId] || 'free';
}

/**
 * Get monthly report limit for a plan.
 */
function getPlanReportLimit(plan) {
  const limits = {
    free: 5,
    starter: 50,
    pro: 500,
    enterprise: 999999, // Unlimited
  };
  return limits[plan] || 5;
}

export default {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleSubscriptionTrialWillEnd,
};
