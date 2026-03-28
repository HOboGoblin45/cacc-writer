/**
 * server/api/providerRoutes.js
 * ──────────────────────────────────────────────────────────────────────────
 * Routes for provider health monitoring and cost tracking
 *
 * Endpoints:
 *   GET /api/providers/health       — Health status of all providers
 *   GET /api/providers/costs        — Cost breakdown per provider
 *   POST /api/providers/reset/:name — Reset health for a provider
 *   POST /api/providers/reset       — Reset all providers
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { validateParams, validateQuery } from '../middleware/validateRequest.js';
import {
  getProviderHealthReport,
  getProviderCosts,
  resetProviderHealth,
  resetAllProviderHealth,
} from '../ai/providerHealth.js';

const router = Router();

// ─── Schemas ────────────────────────────────────────────────────────────

const providerNameSchema = z.object({
  name: z.string().min(1).max(50),
});

const costQuerySchema = z.object({
  provider: z.string().optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/providers/health
 * Get health status of all providers.
 */
router.get('/providers/health', (req, res) => {
  try {
    const report = getProviderHealthReport();
    res.json(report);
  } catch (error) {
    log.error('providers:health', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve provider health',
    });
  }
});

/**
 * GET /api/providers/costs
 * Get cost breakdown per provider.
 */
router.get('/providers/costs', validateQuery(costQuerySchema), (req, res) => {
  try {
    const costs = getProviderCosts();
    res.json(costs);
  } catch (error) {
    log.error('providers:costs', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve provider costs',
    });
  }
});

/**
 * POST /api/providers/reset/:name
 * Reset health for a specific provider.
 */
router.post('/providers/reset/:name', validateParams(providerNameSchema), (req, res) => {
  try {
    const { name } = req.validatedParams;
    const result = resetProviderHealth(name);
    res.json(result);
  } catch (error) {
    log.error('providers:reset', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to reset provider health',
    });
  }
});

/**
 * POST /api/providers/reset
 * Reset all provider health (circuit breakers).
 */
router.post('/providers/reset', (req, res) => {
  try {
    const result = resetAllProviderHealth();
    res.json(result);
  } catch (error) {
    log.error('providers:reset-all', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to reset all providers',
    });
  }
});

export default router;
