/**
 * server/marketplace/templateMarketplace.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Template Marketplace — appraisers buy/sell narrative templates.
 *
 * This is a REVENUE MULTIPLIER. Instead of just subscription fees:
 *   - Top appraisers sell their best narrative templates
 *   - New appraisers buy proven templates to jumpstart quality
 *   - Platform takes 30% commission on every sale
 *   - Creates a community + network effect
 *   - More templates → more value → more users → more templates
 *
 * Template types:
 *   - Narrative templates (neighborhood, site, improvements...)
 *   - Report configurations (form type setups)
 *   - Market-specific packs (Chicago suburbs, LA metro, etc.)
 *   - Adjustment factor packs (learned market data)
 *   - Voice profiles (writing style packages)
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureMarketplaceSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      seller_id       TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      category        TEXT NOT NULL,
      subcategory     TEXT,
      price           REAL NOT NULL,
      preview_json    TEXT,
      content_json    TEXT NOT NULL,
      tags            TEXT,
      region          TEXT,
      form_types      TEXT,
      rating          REAL DEFAULT 0,
      review_count    INTEGER DEFAULT 0,
      purchase_count  INTEGER DEFAULT 0,
      is_active       INTEGER DEFAULT 1,
      is_featured     INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_cat ON marketplace_listings(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_marketplace_seller ON marketplace_listings(seller_id);

    CREATE TABLE IF NOT EXISTS marketplace_purchases (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      listing_id      TEXT NOT NULL REFERENCES marketplace_listings(id),
      buyer_id        TEXT NOT NULL,
      seller_id       TEXT NOT NULL,
      price           REAL NOT NULL,
      platform_fee    REAL NOT NULL,
      seller_revenue  REAL NOT NULL,
      status          TEXT DEFAULT 'completed',
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON marketplace_purchases(buyer_id);

    CREATE TABLE IF NOT EXISTS marketplace_reviews (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      listing_id      TEXT NOT NULL,
      buyer_id        TEXT NOT NULL,
      rating          INTEGER NOT NULL,
      review_text     TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(listing_id, buyer_id)
    );

    CREATE TABLE IF NOT EXISTS seller_earnings (
      user_id         TEXT PRIMARY KEY,
      total_earnings  REAL DEFAULT 0,
      pending_payout  REAL DEFAULT 0,
      total_sales     INTEGER DEFAULT 0,
      last_sale_at    TEXT,
      payout_email    TEXT
    );
  `);
}

const PLATFORM_FEE_RATE = 0.30; // 30% commission

const CATEGORIES = {
  narrative_template: { label: 'Narrative Templates', description: 'Pre-written section templates' },
  report_config: { label: 'Report Configurations', description: 'Complete form type setups' },
  market_pack: { label: 'Market Data Packs', description: 'Region-specific market intelligence' },
  adjustment_pack: { label: 'Adjustment Factor Packs', description: 'Learned market adjustment values' },
  voice_profile: { label: 'Writing Style Profiles', description: 'Professional voice/tone packages' },
  template_bundle: { label: 'Template Bundles', description: 'Multiple templates at a discount' },
};

/**
 * Create a marketplace listing.
 */
export function createListing(sellerId, { title, description, category, subcategory, price, content, tags, region, formTypes }) {
  if (!CATEGORIES[category]) throw new Error(`Invalid category. Use: ${Object.keys(CATEGORIES).join(', ')}`);
  if (price < 0.99) throw new Error('Minimum price is $0.99');

  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');

  // Create preview (subset of content for browsing)
  const preview = typeof content === 'object' ? { type: category, fields: Object.keys(content).slice(0, 5) } : { type: category, length: String(content).length };

  db.prepare(`
    INSERT INTO marketplace_listings (id, seller_id, title, description, category, subcategory, price, preview_json, content_json, tags, region, form_types)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sellerId, title, description || '', category, subcategory || null, price, JSON.stringify(preview), JSON.stringify(content), tags || null, region || null, formTypes || null);

  // Ensure seller earnings record
  db.prepare('INSERT OR IGNORE INTO seller_earnings (user_id) VALUES (?)').run(sellerId);

  log.info('marketplace:listed', { sellerId, listingId: id, category, price });
  return { listingId: id, title, price };
}

/**
 * Browse marketplace listings.
 */
export function browseListings({ category, region, formType, search, sort, limit } = {}) {
  const db = getDb();
  let where = 'is_active = 1';
  const params = [];

  if (category) { where += ' AND category = ?'; params.push(category); }
  if (region) { where += ' AND (region = ? OR region IS NULL)'; params.push(region); }
  if (formType) { where += ' AND (form_types LIKE ? OR form_types IS NULL)'; params.push(`%${formType}%`); }
  if (search) { where += ' AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const orderBy = sort === 'popular' ? 'purchase_count DESC' : sort === 'rating' ? 'rating DESC' : sort === 'price_low' ? 'price ASC' : sort === 'price_high' ? 'price DESC' : 'created_at DESC';

  params.push(parseInt(limit || '50'));

  return db.prepare(`
    SELECT l.*, u.display_name as seller_name
    FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.seller_id
    WHERE ${where}
    ORDER BY is_featured DESC, ${orderBy}
    LIMIT ?
  `).all(...params).map(l => ({
    ...l,
    preview: JSON.parse(l.preview_json || '{}'),
    tags: l.tags ? l.tags.split(',') : [],
    is_active: Boolean(l.is_active),
    is_featured: Boolean(l.is_featured),
  }));
}

/**
 * Purchase a listing.
 */
export function purchaseListing(buyerId, listingId) {
  const db = getDb();
  const listing = db.prepare('SELECT * FROM marketplace_listings WHERE id = ? AND is_active = 1').get(listingId);
  if (!listing) throw new Error('Listing not found');
  if (listing.seller_id === buyerId) throw new Error('Cannot purchase your own listing');

  // Check if already purchased
  const existing = db.prepare('SELECT id FROM marketplace_purchases WHERE listing_id = ? AND buyer_id = ?').get(listingId, buyerId);
  if (existing) throw new Error('Already purchased');

  const platformFee = Math.round(listing.price * PLATFORM_FEE_RATE * 100) / 100;
  const sellerRevenue = Math.round((listing.price - platformFee) * 100) / 100;

  const purchaseId = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO marketplace_purchases (id, listing_id, buyer_id, seller_id, price, platform_fee, seller_revenue) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(purchaseId, listingId, buyerId, listing.seller_id, listing.price, platformFee, sellerRevenue);

  // Update listing stats
  db.prepare('UPDATE marketplace_listings SET purchase_count = purchase_count + 1, updated_at = datetime('now') WHERE id = ?').run(listingId);

  // Update seller earnings
  db.prepare(`UPDATE seller_earnings SET total_earnings = total_earnings + ?, pending_payout = pending_payout + ?,
    total_sales = total_sales + 1, last_sale_at = datetime('now') WHERE user_id = ?`)
    .run(sellerRevenue, sellerRevenue, listing.seller_id);

  log.info('marketplace:purchase', { buyerId, listingId, price: listing.price, platformFee, sellerRevenue });

  return {
    purchaseId,
    content: JSON.parse(listing.content_json),
    price: listing.price,
    platformFee,
    sellerRevenue,
  };
}

/**
 * Get seller's earnings dashboard.
 */
export function getSellerEarnings(userId) {
  const db = getDb();
  const earnings = db.prepare('SELECT * FROM seller_earnings WHERE user_id = ?').get(userId);
  const listings = db.prepare('SELECT id, title, price, purchase_count, rating FROM marketplace_listings WHERE seller_id = ? ORDER BY purchase_count DESC').all(userId);
  const recentSales = db.prepare(`
    SELECT mp.*, ml.title FROM marketplace_purchases mp
    JOIN marketplace_listings ml ON ml.id = mp.listing_id
    WHERE mp.seller_id = ? ORDER BY mp.created_at DESC LIMIT 20
  `).all(userId);

  return {
    earnings: earnings || { total_earnings: 0, pending_payout: 0, total_sales: 0 },
    listings,
    recentSales,
  };
}

/**
 * Get buyer's purchased templates.
 */
export function getPurchasedTemplates(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT mp.*, ml.title, ml.category, ml.content_json, u.display_name as seller_name
    FROM marketplace_purchases mp
    JOIN marketplace_listings ml ON ml.id = mp.listing_id
    LEFT JOIN users u ON u.id = mp.seller_id
    WHERE mp.buyer_id = ?
    ORDER BY mp.created_at DESC
  `).all(userId).map(p => ({ ...p, content: JSON.parse(p.content_json || '{}') }));
}

/**
 * Leave a review.
 */
export function leaveReview(buyerId, listingId, { rating, reviewText }) {
  const db = getDb();
  if (rating < 1 || rating > 5) throw new Error('Rating must be 1-5');

  db.prepare('INSERT OR REPLACE INTO marketplace_reviews (id, listing_id, buyer_id, rating, review_text) VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)')
    .run(listingId, buyerId, rating, reviewText || null);

  // Update listing rating
  const avg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM marketplace_reviews WHERE listing_id = ?').get(listingId);
  db.prepare('UPDATE marketplace_listings SET rating = ?, review_count = ? WHERE id = ?')
    .run(Math.round(avg.avg * 10) / 10, avg.count, listingId);
}

export { CATEGORIES, PLATFORM_FEE_RATE };
export default { ensureMarketplaceSchema, createListing, browseListings, purchaseListing, getSellerEarnings, getPurchasedTemplates, leaveReview, CATEGORIES };
