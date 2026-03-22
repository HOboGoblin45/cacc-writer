/**
 * server/api/schedulingRoutes.js
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  scheduleInspection, getDaySchedule, getUpcomingInspections,
  suggestInspectionGroups, completeInspection,
} from '../scheduling/inspectionScheduler.js';

const router = Router();

// GET /schedule/today — today's inspections
router.get('/schedule/today', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const schedule = getDaySchedule(req.user.userId, today);
  res.json({ ok: true, date: today, inspections: schedule });
});

// GET /schedule/date/:date — inspections for specific date
router.get('/schedule/date/:date', authMiddleware, (req, res) => {
  const schedule = getDaySchedule(req.user.userId, req.params.date);
  res.json({ ok: true, date: req.params.date, inspections: schedule });
});

// GET /schedule/upcoming — next 7 days
router.get('/schedule/upcoming', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days || '7');
  const inspections = getUpcomingInspections(req.user.userId, days);
  res.json({ ok: true, inspections });
});

// POST /cases/:caseId/schedule — schedule inspection
router.post('/cases/:caseId/schedule', authMiddleware, (req, res) => {
  try {
    const result = scheduleInspection(req.user.userId, req.params.caseId, req.body);
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
router.post('/inspections/:id/complete', authMiddleware, (req, res) => {
  try {
    const result = completeInspection(req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
