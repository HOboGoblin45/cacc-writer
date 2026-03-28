/**
 * server/api/collaborationRoutes.js
 * Real-time collaboration + firm management routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import {
  setPresence, removePresence, getCasePresence, registerSSEClient,
  createFirm, inviteToFirm, getFirmMembers,
  assignCase, getCaseAssignments, getUserCaseload, getTeamWorkload,
  getActivityFeed,
} from '../realtime/collaborationService.js';

// Zod validation schemas
const caseIdSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
});

const firmIdSchema = z.object({
  firmId: z.string().min(1, 'firmId is required'),
});

const presenceBodySchema = z.object({
  name: z.string().optional(),
  section: z.string().optional(),
});

const firmBodySchema = z.object({
  name: z.string().min(1, 'firm name is required'),
});

const inviteBodySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: z.string().optional(),
});

const assignCaseBodySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: z.string().optional(),
});

const activityQuerySchema = z.object({
  limit: z.string().transform(val => parseInt(val, 10)).optional().default('50'),
});

// Validation middleware factory
const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateQuery = (schema) => (req, res, next) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const router = Router();

// SSE stream for real-time updates
router.get('/collab/stream', authMiddleware, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('data: {"type":"connected"}\n\n');
  registerSSEClient(req.user.userId, res);
  req.on('close', () => {
    const caseId = req.query?.caseId;
    if (caseId) removePresence(caseId, req.user.userId);
  });
});

// Presence
router.post('/cases/:caseId/presence', authMiddleware, validateParams(caseIdSchema), validateBody(presenceBodySchema), (req, res) => {
  setPresence(req.validatedParams.caseId, req.user.userId, { name: req.validated.name || req.user.username, section: req.validated.section });
  res.json({ ok: true, users: getCasePresence(req.validatedParams.caseId) });
});

router.get('/cases/:caseId/presence', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  res.json({ ok: true, users: getCasePresence(req.validatedParams.caseId) });
});

// Firm management
router.post('/firm', authMiddleware, validateBody(firmBodySchema), (req, res) => {
  try {
    const firm = createFirm(req.user.userId, req.validated.name);
    res.status(201).json({ ok: true, ...firm });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/firm/:firmId/invite', authMiddleware, validateParams(firmIdSchema), validateBody(inviteBodySchema), (req, res) => {
  inviteToFirm(req.validatedParams.firmId, req.validated.userId, req.validated.role);
  res.json({ ok: true });
});

router.get('/firm/:firmId/members', authMiddleware, validateParams(firmIdSchema), (req, res) => {
  res.json({ ok: true, members: getFirmMembers(req.validatedParams.firmId) });
});

router.get('/firm/:firmId/workload', authMiddleware, validateParams(firmIdSchema), (req, res) => {
  res.json({ ok: true, workload: getTeamWorkload(req.validatedParams.firmId) });
});

router.get('/firm/:firmId/activity', authMiddleware, validateParams(firmIdSchema), validateQuery(activityQuerySchema), (req, res) => {
  res.json({ ok: true, feed: getActivityFeed(req.validatedParams.firmId, req.validatedQuery.limit) });
});

// Case assignment
router.post('/cases/:caseId/assign', authMiddleware, validateParams(caseIdSchema), validateBody(assignCaseBodySchema), (req, res) => {
  assignCase(req.validatedParams.caseId, req.validated.userId, req.user.userId, req.validated.role);
  res.json({ ok: true });
});

router.get('/cases/:caseId/assignments', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  res.json({ ok: true, assignments: getCaseAssignments(req.validatedParams.caseId) });
});

router.get('/my/caseload', authMiddleware, (req, res) => {
  res.json({ ok: true, cases: getUserCaseload(req.user.userId) });
});

export default router;
