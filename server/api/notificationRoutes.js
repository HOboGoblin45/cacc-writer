/**
 * server/api/notificationRoutes.js
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { getNotifications, markRead, markAllRead, checkDueDateAlerts } from '../notifications/notificationService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const notificationQuerySchema = z.object({
  limit: z.string().optional().default('20').transform(v => parseInt(v, 10)),
  includeRead: z.string().optional().default('false'),
});

const notificationParamsSchema = z.object({
  id: z.string().min(1, 'Notification ID required'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation Middleware
// ─────────────────────────────────────────────────────────────────────────────

const validateNotificationQuery = (req, res, next) => {
  try {
    req.validatedQuery = notificationQuerySchema.parse(req.query);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Query validation failed: ${err.message}` });
  }
};

const validateNotificationParams = (req, res, next) => {
  try {
    req.validatedParams = notificationParamsSchema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Params validation failed: ${err.message}` });
  }
};

const router = Router();

router.get('/notifications', authMiddleware, validateNotificationQuery, (req, res) => {
  const notifications = getNotifications(req.user.userId, {
    limit: req.validatedQuery.limit,
    includeRead: req.validatedQuery.includeRead === 'true',
  });
  res.json({ ok: true, notifications, unread: notifications.filter(n => !n.is_read).length });
});

router.post('/notifications/:id/read', authMiddleware, validateNotificationParams, (req, res) => {
  markRead(req.validatedParams.id);
  res.json({ ok: true });
});

router.post('/notifications/read-all', authMiddleware, (req, res) => {
  markAllRead(req.user.userId);
  res.json({ ok: true });
});

router.post('/notifications/check-alerts', authMiddleware, (req, res) => {
  const alerts = checkDueDateAlerts(req.user.userId);
  res.json({ ok: true, newAlerts: alerts.length });
});

export default router;
