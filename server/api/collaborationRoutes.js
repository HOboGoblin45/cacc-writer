/**
 * server/api/collaborationRoutes.js
 * Real-time collaboration + firm management routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  setPresence, removePresence, getCasePresence, registerSSEClient,
  createFirm, inviteToFirm, getFirmMembers,
  assignCase, getCaseAssignments, getUserCaseload, getTeamWorkload,
  getActivityFeed,
} from '../realtime/collaborationService.js';

const router = Router();

// SSE stream for real-time updates
router.get('/collab/stream', authMiddleware, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('data: {"type":"connected"}\n\n');
  registerSSEClient(req.user.userId, res);
  req.on('close', () => removePresence(req.query.caseId, req.user.userId));
});

// Presence
router.post('/cases/:caseId/presence', authMiddleware, (req, res) => {
  setPresence(req.params.caseId, req.user.userId, { name: req.body.name || req.user.username, section: req.body.section });
  res.json({ ok: true, users: getCasePresence(req.params.caseId) });
});

router.get('/cases/:caseId/presence', authMiddleware, (req, res) => {
  res.json({ ok: true, users: getCasePresence(req.params.caseId) });
});

// Firm management
router.post('/firm', authMiddleware, (req, res) => {
  try {
    const firm = createFirm(req.user.userId, req.body.name);
    res.status(201).json({ ok: true, ...firm });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/firm/:firmId/invite', authMiddleware, (req, res) => {
  inviteToFirm(req.params.firmId, req.body.userId, req.body.role);
  res.json({ ok: true });
});

router.get('/firm/:firmId/members', authMiddleware, (req, res) => {
  res.json({ ok: true, members: getFirmMembers(req.params.firmId) });
});

router.get('/firm/:firmId/workload', authMiddleware, (req, res) => {
  res.json({ ok: true, workload: getTeamWorkload(req.params.firmId) });
});

router.get('/firm/:firmId/activity', authMiddleware, (req, res) => {
  res.json({ ok: true, feed: getActivityFeed(req.params.firmId, parseInt(req.query.limit || '50')) });
});

// Case assignment
router.post('/cases/:caseId/assign', authMiddleware, (req, res) => {
  assignCase(req.params.caseId, req.body.userId, req.user.userId, req.body.role);
  res.json({ ok: true });
});

router.get('/cases/:caseId/assignments', authMiddleware, (req, res) => {
  res.json({ ok: true, assignments: getCaseAssignments(req.params.caseId) });
});

router.get('/my/caseload', authMiddleware, (req, res) => {
  res.json({ ok: true, cases: getUserCaseload(req.user.userId) });
});

export default router;
