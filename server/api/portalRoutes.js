/**
 * server/api/portalRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client portal routes — both appraiser management and client view.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  createPortalLink, validatePortalAccess, getPortalCaseData,
  getPortalLinks, revokePortalLink,
} from '../portal/clientPortal.js';
import { createRevisionRequest } from '../revisions/revisionTracker.js';

const router = Router();

// ── Appraiser management routes (authenticated) ─────────────────────────────

// GET /portal/links — list all portal links
router.get('/portal/links', authMiddleware, (req, res) => {
  const links = getPortalLinks(req.user.userId);
  res.json({ ok: true, links });
});

// POST /portal/links — create portal link for a case
router.post('/portal/links', authMiddleware, (req, res) => {
  try {
    const { caseId, recipientName, recipientEmail, permissions, expiresInDays } = req.body;
    const link = createPortalLink(req.user.userId, caseId, { recipientName, recipientEmail, permissions, expiresInDays });
    res.status(201).json({ ok: true, ...link });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE /portal/links/:id — revoke a portal link
router.delete('/portal/links/:id', authMiddleware, (req, res) => {
  revokePortalLink(req.params.id, req.user.userId);
  res.json({ ok: true });
});

// ── Client-facing routes (token-based, no login) ────────────────────────────

// GET /portal/view/:token — get case data via portal token
router.get('/portal/view/:token', (req, res) => {
  const access = validatePortalAccess(req.params.token);
  if (!access.valid) return res.status(403).json({ ok: false, error: access.error });

  const data = getPortalCaseData(access.caseId);
  if (!data) return res.status(404).json({ ok: false, error: 'Case not found' });

  res.json({ ok: true, ...data, permissions: access.permissions });
});

// POST /portal/view/:token/revision — client submits revision request
router.post('/portal/view/:token/revision', (req, res) => {
  const access = validatePortalAccess(req.params.token);
  if (!access.valid) return res.status(403).json({ ok: false, error: access.error });
  if (access.permissions !== 'view_revise') {
    return res.status(403).json({ ok: false, error: 'Revision submission not permitted on this link' });
  }

  try {
    const result = createRevisionRequest(access.caseId, {
      requester: access.recipientName || 'Client',
      requesterType: 'client_portal',
      stipulations: req.body.stipulations || [],
      notes: req.body.notes,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
