/**
 * server/api/notificationRoutes.js
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getNotifications, markRead, markAllRead, checkDueDateAlerts } from '../notifications/notificationService.js';

const router = Router();

router.get('/notifications', authMiddleware, (req, res) => {
  const notifications = getNotifications(req.user.userId, {
    limit: parseInt(req.query.limit || '20'),
    includeRead: req.query.includeRead === 'true',
  });
  res.json({ ok: true, notifications, unread: notifications.filter(n => !n.is_read).length });
});

router.post('/notifications/:id/read', authMiddleware, (req, res) => {
  markRead(req.params.id);
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
