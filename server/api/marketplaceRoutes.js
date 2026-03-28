/**
 * server/api/marketplaceRoutes.js
 * Template marketplace CRUD + purchasing + reviews.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { createListing, browseListings, purchaseListing, getSellerEarnings, getPurchasedTemplates, leaveReview, CATEGORIES } from '../marketplace/templateMarketplace.js';

const router = Router();

// Zod schemas
const browseQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  sortBy: z.string().optional(),
});

const createListingSchema = z.object({
  title: z.string().min(1, 'title is required'),
  category: z.string().min(1, 'category is required'),
  description: z.string().min(1, 'description is required'),
  price: z.number().positive('price must be positive'),
  templateData: z.any(),
});

const listingIdSchema = z.object({
  listingId: z.string().min(1, 'listingId is required'),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1, 'comment is required'),
});

// Validation middleware
const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({ ok: false, errors: result.error.errors });
  }
  req.validatedQuery = result.data;
  next();
};

const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ ok: false, errors: result.error.errors });
  }
  req.validated = result.data;
  next();
};

const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    return res.status(400).json({ ok: false, errors: result.error.errors });
  }
  req.validatedParams = result.data;
  next();
};

// GET /marketplace/categories
router.get('/marketplace/categories', (_req, res) => {
  res.json({ ok: true, categories: Object.entries(CATEGORIES).map(([k, v]) => ({ id: k, ...v })) });
});

// GET /marketplace/browse — browse listings
router.get('/marketplace/browse', validateQuery(browseQuerySchema), (req, res) => {
  const listings = browseListings(req.validatedQuery);
  res.json({ ok: true, listings, count: listings.length });
});

// POST /marketplace/listings — create a listing (seller)
router.post('/marketplace/listings', authMiddleware, validateBody(createListingSchema), (req, res) => {
  try {
    const result = createListing(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /marketplace/purchase/:listingId — buy a template
router.post('/marketplace/purchase/:listingId', authMiddleware, validateParams(listingIdSchema), (req, res) => {
  try {
    const result = purchaseListing(req.user.userId, req.validatedParams.listingId);
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
router.post('/marketplace/reviews/:listingId', authMiddleware, validateParams(listingIdSchema), validateBody(reviewSchema), (req, res) => {
  try {
    leaveReview(req.user.userId, req.validatedParams.listingId, req.validated);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
