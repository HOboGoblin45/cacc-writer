/**
 * server/api/onboardingRoutes.js
 * ──────────────────────────────
 * Self-serve onboarding routes for 4-step workflow.
 *
 * Routes:
 *   POST   /api/onboarding/profile              — Save license profile
 *   POST   /api/onboarding/upload-reports       — Record uploaded files
 *   GET    /api/onboarding/voice-preview        — Get voice preview comparison
 *   POST   /api/onboarding/generate-sample      — Generate sample narrative
 *   GET    /api/onboarding/status               — Get progress
 *   POST   /api/onboarding/complete             — Mark complete
 *   GET    /api/onboarding/sample-property      — Get sample property data
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { getDb } from '../db/database.js';
import { validateBody, validateQuery } from '../middleware/validateRequest.js';
import {
  createOnboardingProfile,
  processUploadedReports,
  generateVoicePreview,
  generateSampleNarrative,
  getOnboardingProgress,
  completeOnboarding,
  getSamplePropertyData,
} from '../onboarding/onboardingService.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  state: z.string().min(2).max(50),
  licenseNumber: z.string().min(1).max(50),
  licenseType: z.enum(['Certified Residential', 'Licensed Residential', 'Certified General', 'Trainee/Supervisory']),
  currentSoftware: z.string().max(100).optional(),
});

const uploadReportsSchema = z.object({
  files: z.array(
    z.object({
      name: z.string().min(1),
      path: z.string().min(1),
      size: z.number().int().positive().optional(),
    })
  ).min(1),
});

const generateSampleSchema = z.object({
  sectionId: z.enum(['subject', 'location', 'improvements', 'marketAnalysis', 'conclusion']).default('subject'),
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/onboarding/profile
 * Save license profile and create onboarding progress record.
 */
router.post('/profile', validateBody(profileSchema), (req, res) => {
  try {
    const db = getDb();
    const result = createOnboardingProfile(db, req.body);

    return res.status(201).json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:profile-error', { error: err.message });
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/onboarding/upload-reports
 * Record uploaded file metadata.
 */
router.post('/upload-reports', validateBody(uploadReportsSchema), (req, res) => {
  try {
    // Extract userId from query params (frontend sends it)
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId query parameter required',
      });
    }

    const db = getDb();
    const result = processUploadedReports(db, userId, req.body.files);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:upload-reports-error', { error: err.message });
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/onboarding/voice-preview
 * Get voice preview comparison data.
 */
router.get('/voice-preview', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId query parameter required',
      });
    }

    const db = getDb();
    const result = generateVoicePreview(db, userId);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:voice-preview-error', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to generate voice preview',
    });
  }
});

/**
 * POST /api/onboarding/generate-sample
 * Generate sample narrative for a section.
 */
router.post('/generate-sample', validateBody(generateSampleSchema), (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId query parameter required',
      });
    }

    const db = getDb();
    const { sectionId } = req.body;
    const result = generateSampleNarrative(db, userId, sectionId);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:generate-sample-error', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to generate sample narrative',
    });
  }
});

/**
 * GET /api/onboarding/status
 * Get current onboarding progress.
 */
router.get('/status', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId query parameter required',
      });
    }

    const db = getDb();
    const result = getOnboardingProgress(db, userId);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:status-error', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch onboarding status',
    });
  }
});

/**
 * POST /api/onboarding/complete
 * Mark onboarding as complete.
 */
router.post('/complete', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId query parameter required',
      });
    }

    const db = getDb();
    const result = completeOnboarding(db, userId);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:complete-error', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to complete onboarding',
    });
  }
});

/**
 * GET /api/onboarding/sample-property
 * Get pre-built sample property data.
 */
router.get('/sample-property', (req, res) => {
  try {
    const result = getSamplePropertyData();

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    log.error('onboarding:sample-property-error', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch sample property',
    });
  }
});

export default router;
