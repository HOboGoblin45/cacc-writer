#!/usr/bin/env node

import Stripe from 'stripe';
import process from 'process';

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('Error: STRIPE_SECRET_KEY environment variable not set');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-04-10',
});

// Define Real Brain product tiers
const products = [
  {
    name: 'Starter',
    description: 'Perfect for independent appraisers',
    monthlyPrice: 7900, // $79.00
    foundingMemberPrice: 4740, // 40% off = $47.40
    overagePrice: 300, // $3.00 per report
  },
  {
    name: 'Pro',
    description: 'For small appraisal teams',
    monthlyPrice: 14900, // $149.00
    foundingMemberPrice: 8940, // 40% off = $89.40
    overagePrice: 300, // $3.00 per report
  },
  {
    name: 'Enterprise',
    description: 'For large organizations',
    monthlyPrice: 24900, // $249.00
    foundingMemberPrice: 14940, // 40% off = $149.40
    overagePrice: 300, // $3.00 per report
  },
];

async function setupStripeProducts() {
  console.log('Setting up Real Brain Stripe products...\n');

  const results = [];

  for (const productConfig of products) {
    try {
      // Create product
      const product = await stripe.products.create({
        name: `Real Brain - ${productConfig.name}`,
        description: productConfig.description,
        metadata: {
          tier: productConfig.name.toLowerCase(),
          category: 'appraisal_saas',
        },
      });

      console.log(`✓ Created product: ${product.name} (${product.id})`);

      // Create standard monthly price
      const standardPrice = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        type: 'recurring',
        recurring: {
          interval: 'month',
          interval_count: 1,
        },
        unit_amount: productConfig.monthlyPrice,
        metadata: {
          price_type: 'standard',
          tier: productConfig.name.toLowerCase(),
        },
      });

      console.log(`  ├─ Standard price: $${(productConfig.monthlyPrice / 100).toFixed(2)}/month (${standardPrice.id})`);

      // Create founding member price (40% discount)
      const foundingPrice = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        type: 'recurring',
        recurring: {
          interval: 'month',
          interval_count: 1,
        },
        unit_amount: productConfig.foundingMemberPrice,
        metadata: {
          price_type: 'founding_member',
          discount_percent: '40',
          tier: productConfig.name.toLowerCase(),
        },
      });

      console.log(`  ├─ Founding member price (40% off): $${(productConfig.foundingMemberPrice / 100).toFixed(2)}/month (${foundingPrice.id})`);

      // Create metered usage price (per report overage)
      const overagePrice = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        type: 'recurring',
        recurring: {
          interval: 'month',
          interval_count: 1,
          usage_type: 'metered',
        },
        billing_scheme: 'per_unit',
        unit_amount: productConfig.overagePrice,
        metadata: {
          price_type: 'usage',
          usage_unit: 'report',
          tier: productConfig.name.toLowerCase(),
        },
      });

      console.log(`  └─ Overage price: $${(productConfig.overagePrice / 100).toFixed(2)}/report (${overagePrice.id})`);

      results.push({
        tier: productConfig.name,
        productId: product.id,
        standardPriceId: standardPrice.id,
        foundingMemberPriceId: foundingPrice.id,
        overagePriceId: overagePrice.id,
      });

      console.log('');
    } catch (error) {
      console.error(`✗ Failed to create ${productConfig.name} product:`, error.message);
    }
  }

  // Print summary for .env configuration
  console.log('============================================================================');
  console.log('Add these to your .env.production file:');
  console.log('============================================================================\n');

  for (const result of results) {
    console.log(`# ${result.tier} tier`);
    console.log(`STRIPE_${result.tier.toUpperCase()}_PRICE_ID=${result.standardPriceId}`);
    console.log(`STRIPE_${result.tier.toUpperCase()}_FOUNDING_PRICE_ID=${result.foundingMemberPriceId}`);
    console.log(`STRIPE_${result.tier.toUpperCase()}_OVERAGE_PRICE_ID=${result.overagePriceId}\n`);
  }

  console.log('============================================================================');
  console.log('Product Setup Complete');
  console.log('============================================================================');
  console.log(`\nCreated ${results.length} products with ${results.length * 3} price points`);
}

setupStripeProducts().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
