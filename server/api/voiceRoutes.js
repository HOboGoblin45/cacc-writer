/**
 * server/api/voiceRoutes.js
 * Voice clone training and profile management routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody } from '../middleware/validateRequest.js';
import { buildVoiceProfile, getVoiceProfile, testVoiceAccuracy } from '../ai/voiceCloneTrainer.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const testVoiceBodySchema = z.object({
  sectionType: z.string().min(1),
});

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /voice/build-profile — analyze writing and build voice profile
router.post('/voice/build-profile', authMiddleware, async (req, res) => {
  try {
    const profile = await buildVoiceProfile(req.user.userId);
    res.json({ ok: true, ...profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /voice/profile — get current voice profile
router.get('/voice/profile', authMiddleware, (req, res) => {
  const profile = getVoiceProfile(req.user.userId);
  if (!profile) return res.json({ ok: true, status: 'not_built', message: 'No voice profile yet. Approve more sections and then build your profile.' });
  res.json({ ok: true, ...profile });
});

// POST /voice/test — test voice accuracy
router.post('/voice/test', authMiddleware, validateBody(testVoiceBodySchema), async (req, res) => {
  try {
    const result = await testVoiceAccuracy(req.user.userId, req.validated.sectionType);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
