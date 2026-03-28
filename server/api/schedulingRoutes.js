/**
 * server/api/schedulingRoutes.js
 * ──────────────────────────────
 * Inspection scheduling routes with Zod validation.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import {
  scheduleInspection, getDaySchedule, getUpcomingInspections,
  suggestInspectionGroups, completeInspection,
} from '../scheduling/inspectionScheduler.js';

const router = Router();

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const dateParamsSchema = z.object({
  date: z.string().min(1),
}).strict();

const caseIdParamsSchema = z.object({
  caseId: z.string().min(1),
}).strict();

const inspectionIdParamsSchema = z.object({
  id: z.string().min(1),
}).strict();

const upcomingQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 7),
}).passthrough();

const scheduleInspectionBodySchema = z.object({
  date: z.string().min(1).optional(),
  time: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

const completeInspectionBodySchema = z.object({
  completedAt: z.string().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).optional(),
}).passthrough();

// ── Validation Middleware ─────────────────────────────────────────────────────

function validateParamsMiddleware(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_PARAMS',
        error: 'Invalid route parameters',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    req.validatedParams = parsed.data;
    next();
  };
}

function validateQueryMiddleware(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_QUERY',
        error: 'Invalid query parameters',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    req.validatedQuery = parsed.data;
    next();
  };
}

function validateBodyMiddleware(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_BODY',
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    req.validated = parsed.data;
    next();
  };
}

// GET /schedule/today — today's inspections
router.get('/schedule/today', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const schedule = getDaySchedule(req.user.userId, today);
  res.json({ ok: true, date: today, inspections: schedule });
});

// GET /schedule/date/:date — inspections for specific date
router.get('/schedule/date/:date', authMiddleware, validateParamsMiddleware(dateParamsSchema), (req, res) => {
  const { date } = req.validatedParams;
  const schedule = getDaySchedule(req.user.userId, date);
  res.json({ ok: true, date, inspections: schedule });
});

// GET /schedule/upcoming — next 7 days
router.get('/schedule/upcoming', authMiddleware, validateQueryMiddleware(upcomingQuerySchema), (req, res) => {
  const { days } = req.validatedQuery;
  const inspections = getUpcomingInspections(req.user.userId, days);
  res.json({ ok: true, inspections });
});

// POST /cases/:caseId/schedule — schedule inspection
router.post('/cases/:caseId/schedule', authMiddleware, validateParamsMiddleware(caseIdParamsSchema), validateBodyMiddleware(scheduleInspectionBodySchema), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const result = scheduleInspection(req.user.userId, caseId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /schedule/suggest-groups — AI route optimization
router.post('/schedule/suggest-groups', authMiddleware, async (req, res) => {
  try {
    const groups = await suggestInspectionGroups(req.user.userId);
    res.json({ ok: true, groups, totalUnscheduled: groups.reduce((s, g) => s + g.properties.length, 0) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /inspections/:id/complete — mark inspection complete
router.post('/inspections/:id/complete', authMiddleware, validateParamsMiddleware(inspectionIdParamsSchema), validateBodyMiddleware(completeInspectionBodySchema), (req, res) => {
  try {
    const { id } = req.validatedParams;
    const result = completeInspection(id, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
