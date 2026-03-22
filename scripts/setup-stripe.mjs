#!/usr/bin/env node
/**
 * scripts/setup-stripe.mjs
 * One-time setup: creates Stripe products + prices for CACC Writer tiers.
 * 
 * Usage: 
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe.mjs
 * 
 * Creates:
 *   - Starter    ($49/mo)  — 25 reports/mo, basic AI
 *   - Professional ($149/mo) — unlimited reports, local AI, all features  
 *   - Enterprise  ($299/mo) — white-label, API access, priority support
 * 
 * Outputs the price IDs to paste into .env
 */

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY environment variable first');
  console.error('Usage: STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe.mjs');
  process.exit(1);
}

const stripe = new Stripe(key);

async function main() {
  console.log('Creating CACC Writer Stripe products...\n');

  // Product
  const product = await stripe.products.create({
    name: 'CACC Writer',
    description: 'AI-powered appraisal report writer. Learns your voice, writes your narratives.',
    metadata: { app: 'cacc-writer' },
  });
  console.log(`Product: ${product.id} (${product.name})`);

  // Starter - $49/mo
  const starterPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 4900,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'starter', tier: 'starter' },
    lookup_key: 'cacc_starter_monthly',
  });
  console.log(`Starter:      ${starterPrice.id} ($49/mo)`);

  // Professional - $149/mo
  const proPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 14900,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'professional', tier: 'professional' },
    lookup_key: 'cacc_professional_monthly',
  });
  console.log(`Professional: ${proPrice.id} ($149/mo)`);

  // Enterprise - $299/mo
  const entPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 29900,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'enterprise', tier: 'enterprise' },
    lookup_key: 'cacc_enterprise_monthly',
  });
  console.log(`Enterprise:   ${entPrice.id} ($299/mo)`);

  console.log('\n=== Add these to your .env ===\n');
  console.log(`STRIPE_SECRET_KEY=${key}`);
  console.log(`STRIPE_PRICE_STARTER=${starterPrice.id}`);
  console.log(`STRIPE_PRICE_PROFESSIONAL=${proPrice.id}`);
  console.log(`STRIPE_PRICE_ENTERPRISE=${entPrice.id}`);
  console.log(`APP_URL=https://your-domain.com`);
  console.log('\nDon\'t forget STRIPE_WEBHOOK_SECRET after setting up the webhook endpoint!');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
