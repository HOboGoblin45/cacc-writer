/**
 * server/api/marketplaceRoutes.js
 * Template marketplace CRUD + purchasing + reviews.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { createListing, browseListings, purchaseListing, getSellerEarnings, getPurchasedTemplates, leaveReview, CATEGORIES } from '../marketplace/templateMarketplace.js';

const router = Router();

// GET /marketplace/categories
router.get('/marketplace/categories', (_req, res) => {
  res.json({ ok: true, categories: Object.entries(CATEGORIES).map(([k, v]) => ({ id: k, ...v })) });
});

// GET /marketplace/browse — browse listings
router.get('/marketplace/browse', (req, res) => {
  const listings = browseListings(req.query);
  res.json({ ok: true, listings, count: listings.length });
});

// POST /marketplace/listings — create a listing (seller)
router.post('/marketplace/listings', authMiddleware, (req, res) => {
  try {
    const result = createListing(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /marketplace/purchase/:listingId — buy a template
router.post('/marketplace/purchase/:listingId', authMiddleware, (req, res) => {
  try {
    const result = purchaseListing(req.user.userId, req.params.listingId);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /marketplace/my-purchases — buyer's purchased templates
router.get('/marketplace/my-purchases', authMiddleware, (req, res) => {
  const purchases = getPurchasedTemplates(req.user.userId);
  res.json({ ok: true, purchases });
});

// GET /marketplace/my-earnings — seller dashboard
router.get('/marketplace/my-earnings', authMiddleware, (req, res) => {
  const earnings = getSellerEarnings(req.user.userId);
  res.json({ ok: true, ...earnings });
});

// POST /marketplace/reviews/:listingId — leave a review
router.post('/marketplace/reviews/:listingId', authMiddleware, (req, res) => {
  try {
    leaveReview(req.user.userId, req.params.listingId, req.body);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
