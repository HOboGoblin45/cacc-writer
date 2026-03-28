/**
 * server/api/portalRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client portal routes — both appraiser management and client view.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import {
  createPortalLink, validatePortalAccess, getPortalCaseData,
  getPortalLinks, revokePortalLink,
} from '../portal/clientPortal.js';
import { createRevisionRequest } from '../revisions/revisionTracker.js';
import { getDb } from '../db/database.js';
import log from '../logger.js';

// Zod validation schemas
const caseIdSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
});

const linkIdSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

const tokenSchema = z.object({
  token: z.string().min(1, 'token is required'),
});

const createPortalLinkSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
  recipientName: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  permissions: z.string().optional(),
  expiresInDays: z.number().optional(),
});

const revisionRequestSchema = z.object({
  stipulations: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
});

const shareEndpointSchema = z.object({
  expiresInDays: z.number().optional().default(7),
  recipientName: z.string().optional(),
  recipientEmail: z.string().optional(),
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

const router = Router();

// ── Appraiser management routes (authenticated) ─────────────────────────────

// GET /portal/links — list all portal links
router.get('/portal/links', authMiddleware, (req, res) => {
  const links = getPortalLinks(req.user.userId);
  res.json({ ok: true, links });
});

// POST /portal/links — create portal link for a case
router.post('/portal/links', authMiddleware, validateBody(createPortalLinkSchema), (req, res) => {
  try {
    const { caseId, recipientName, recipientEmail, permissions, expiresInDays } = req.validated;
    const link = createPortalLink(req.user.userId, caseId, { recipientName, recipientEmail, permissions, expiresInDays });
    res.status(201).json({ ok: true, ...link });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE /portal/links/:id — revoke a portal link
router.delete('/portal/links/:id', authMiddleware, validateParams(linkIdSchema), (req, res) => {
  revokePortalLink(req.validatedParams.id, req.user.userId);
  res.json({ ok: true });
});

// ── Client-facing routes (token-based, no login) ────────────────────────────

// GET /portal/view/:token — get case data via portal token
router.get('/portal/view/:token', validateParams(tokenSchema), (req, res) => {
  const access = validatePortalAccess(req.validatedParams.token);
  if (!access.valid) return res.status(403).json({ ok: false, error: access.error });

  const data = getPortalCaseData(access.caseId);
  if (!data) return res.status(404).json({ ok: false, error: 'Case not found' });

  res.json({ ok: true, ...data, permissions: access.permissions });
});

// POST /portal/view/:token/revision — client submits revision request
router.post('/portal/view/:token/revision', validateParams(tokenSchema), validateBody(revisionRequestSchema), (req, res) => {
  const access = validatePortalAccess(req.validatedParams.token);
  if (!access.valid) return res.status(403).json({ ok: false, error: access.error });
  if (access.permissions !== 'view_revise') {
    return res.status(403).json({ ok: false, error: 'Revision submission not permitted on this link' });
  }

  try {
    const result = createRevisionRequest(access.caseId, {
      requester: access.recipientName || 'Client',
      requesterType: 'client_portal',
      stipulations: req.validated.stipulations,
      notes: req.validated.notes,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Simplified share endpoint ─────────────────────────────────────────────────

// POST /cases/:caseId/share — generate a secure sharing link (7-day default)
router.post('/cases/:caseId/share', authMiddleware, validateParams(caseIdSchema), validateBody(shareEndpointSchema), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const { expiresInDays, recipientName, recipientEmail } = req.validated;
    const userId = req.user?.userId || 'default';

    const link = createPortalLink(userId, caseId, {
      recipientName: recipientName || null,
      recipientEmail: recipientEmail || null,
      permissions: 'view',
      expiresInDays,
    });

    const baseUrl = process.env.PUBLIC_URL || 'https://appraisal-agent.com';
    const url = `${baseUrl}/shared/${link.token}`;

    log.info('portal:share-created', { caseId, expiresInDays, url });
    res.status(201).json({
      ok: true,
      url,
      token: link.token,
      expiresAt: link.expiresAt,
    });
  } catch (err) {
    log.error('portal:share-failed', { caseId: req.validatedParams?.caseId, error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /shared/:token — public endpoint to view shared report (no auth required)
router.get('/shared/:token', validateParams(tokenSchema), (req, res) => {
  try {
    const access = validatePortalAccess(req.validatedParams.token);
    if (!access.valid) return res.status(403).json({ ok: false, error: access.error });

    // Increment view count
    try {
      const db = getDb();
      db.prepare(`
        UPDATE portal_links SET view_count = view_count + 1, last_viewed_at = datetime('now')
        WHERE token = ?
      `).run(req.validatedParams.token);
    } catch { /* non-fatal */ }

    const data = getPortalCaseData(access.caseId);
    if (!data) return res.status(404).json({ ok: false, error: 'Case not found' });

    // Return only safe read-only data — no raw facts
    const safeResponse = {
      ok: true,
      caseId: access.caseId,
      address: data.address || data.subject?.address || null,
      formType: data.formType || data.caseRecord?.form_type || null,
      sections: data.sections || {},
      comps: data.comps || [],
      status: data.status || null,
      generatedAt: data.generatedAt || null,
    };

    res.json(safeResponse);
  } catch (err) {
    log.error('portal:shared-view-failed', { token: req.validatedParams?.token, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
