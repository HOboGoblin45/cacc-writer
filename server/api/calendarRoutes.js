/**
 * server/api/calendarRoutes.js
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { generateIcsEvent, generateDayScheduleIcs, getDailyBrief } from '../integrations/calendarSync.js';
import { generateExecutiveSummary, generateTransmittalLetter, generateRiskAssessment } from '../ai/reportSummarizer.js';
import { getDb } from '../db/database.js';

const router = Router();

// Zod schemas
const dateParamsSchema = z.object({
  date: z.string().min(1),
});

const inspectionIdSchema = z.object({
  id: z.string().min(1),
});

// GET /schedule/:date/ics — download day schedule as .ics
router.get('/schedule/:date/ics', authMiddleware, validateParams(dateParamsSchema), (req, res) => {
  const ics = generateDayScheduleIcs(req.user.userId, req.validatedParams.date);
  if (!ics) return res.status(404).json({ ok: false, error: 'No inspections for this date' });
  res.type('text/calendar').set('Content-Disposition', `attachment; filename="schedule-${req.validatedParams.date}.ics"`).send(ics);
});

// GET /schedule/:date/brief — daily schedule summary
router.get('/schedule/:date/brief', authMiddleware, validateParams(dateParamsSchema), (req, res) => {
  const brief = getDailyBrief(req.user.userId, req.validatedParams.date);
  res.json({ ok: true, ...brief });
});

// GET /inspections/:id/ics — download single inspection as .ics
router.get('/inspections/:id/ics', authMiddleware, validateParams(inspectionIdSchema), (req, res) => {
  const db = getDb();
  const insp = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.validatedParams.id);
  if (!insp) return res.status(404).json({ ok: false, error: 'Inspection not found' });
  const ics = generateIcsEvent(insp);
  res.type('text/calendar').set('Content-Disposition', `attachment; filename="inspection-${req.validatedParams.id}.ics"`).send(ics);
});

// POST /cases/:caseId/executive-summary — generate executive summary
router.post('/cases/:caseId/executive-summary', authMiddleware, validateParams(CommonSchemas.caseId), async (req, res) => {
  try {
    const summary = await generateExecutiveSummary(req.validatedParams.caseId);
    res.json({ ok: true, summary });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /cases/:caseId/transmittal — generate transmittal letter
router.post('/cases/:caseId/transmittal', authMiddleware, validateParams(CommonSchemas.caseId), async (req, res) => {
  try {
    const letter = await generateTransmittalLetter(req.validatedParams.caseId);
    res.json({ ok: true, letter });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /cases/:caseId/risk-assessment — generate risk assessment
router.post('/cases/:caseId/risk-assessment', authMiddleware, validateParams(CommonSchemas.caseId), async (req, res) => {
  try {
    const assessment = await generateRiskAssessment(req.validatedParams.caseId);
    res.json({ ok: true, ...assessment });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
