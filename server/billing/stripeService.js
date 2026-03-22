/**
 * server/billing/stripeService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe integration for subscription billing.
 * 
 * Handles: checkout session creation, webhook processing, plan changes.
 * Stripe keys come from environment — if not set, billing is disabled.
 */

import Stripe from 'stripe';
import { getDb } from '../db/database.js';
import { PLANS } from '../auth/authService.js';
import log from '../logger.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:5178';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export function isStripeConfigured() {
  return Boolean(stripe);
}

// ── Price IDs (set these in .env or Stripe dashboard) ────────────────────────
const PRICE_IDS = {
  starter:      process.env.STRIPE_PRICE_STARTER || '',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL || '',
  enterprise:   process.env.STRIPE_PRICE_ENTERPRISE || '',
};

// ── Create Checkout Session ──────────────────────────────────────────────────

export async function createCheckoutSession(userId, plan) {
  if (!stripe) throw new Error('Stripe is not configured');
  if (!PRICE_IDS[plan]) throw new Error(`No Stripe price configured for plan: ${plan}`);

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

  // Get or create Stripe customer
  let sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  let customerId = sub?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.display_name || user.username,
      metadata: { userId, username: user.username },
    });
    customerId = customer.id;
    db.prepare(`UPDATE subscriptions SET stripe_customer_id = ?, updated_at = datetime("now") WHERE user_id = ?`)
      .run(customerId, userId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    success_url: `${APP_URL}/?checkout=success&plan=${plan}`,
    cancel_url: `${APP_URL}/?checkout=cancelled`,
    metadata: { userId, plan },
  });

  log.info('stripe:checkout-created', { userId, plan, sessionId: session.id });
  return { url: session.url, sessionId: session.id };
}

// ── Create Customer Portal Session ───────────────────────────────────────────

export async function createPortalSession(userId) {
  if (!stripe) throw new Error('Stripe is not configured');

  const db = getDb();
  const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId);
  if (!sub?.stripe_customer_id) throw new Error('No Stripe customer found');

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${APP_URL}/`,
  });

  return { url: session.url };
}

// ── Webhook Handler ──────────────────────────────────────────────────────────

export async function handleWebhook(rawBody, signature) {
  if (!stripe) throw new Error('Stripe is not configured');

  const event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      if (userId && plan) {
        activateSubscription(userId, plan, session.subscription);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      updateSubscriptionStatus(subscription);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      cancelSubscription(subscription);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      resetMonthlyQuota(invoice.customer);
      break;
    }

    default:
      log.info('stripe:webhook-unhandled', { type: event.type });
  }

  return { received: true };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function activateSubscription(userId, plan, stripeSubscriptionId) {
  const db = getDb();
  const planConfig = PLANS[plan];
  if (!planConfig) return;

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?, status = 'active', stripe_subscription_id = ?,
        reports_limit = ?, reports_this_month = 0,
        current_period_start = datetime("now"),
        current_period_end = datetime('now', '+30 days'),
        updated_at = datetime("now")
    WHERE user_id = ?
  `).run(plan, stripeSubscriptionId, planConfig.reports === Infinity ? 999999 : planConfig.reports, userId);

  log.info('stripe:subscription-activated', { userId, plan });
}

function updateSubscriptionStatus(subscription) {
  const db = getDb();
  db.prepare(`
    UPDATE subscriptions
    SET status = ?, updated_at = datetime("now")
    WHERE stripe_subscription_id = ?
  `).run(subscription.status === 'active' ? 'active' : 'past_due', subscription.id);
}

function cancelSubscription(subscription) {
  const db = getDb();
  db.prepare(`
    UPDATE subscriptions
    SET plan = 'free', status = 'active', stripe_subscription_id = NULL,
        reports_limit = 5, updated_at = datetime("now")
    WHERE stripe_subscription_id = ?
  `).run(subscription.id);

  log.info('stripe:subscription-cancelled', { subscriptionId: subscription.id });
}

function resetMonthlyQuota(stripeCustomerId) {
  const db = getDb();
  db.prepare(`
    UPDATE subscriptions
    SET reports_this_month = 0,
        current_period_start = datetime("now"),
        current_period_end = datetime('now', '+30 days'),
        updated_at = datetime("now")
    WHERE stripe_customer_id = ?
  `).run(stripeCustomerId);
}
