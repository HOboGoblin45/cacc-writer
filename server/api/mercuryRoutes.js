/**
 * server/api/mercuryRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mercury Network Integration Routes
 *
 * Endpoints:
 *   POST   /api/mercury/webhook           - Receive Mercury webhooks (no auth)
 *   GET    /api/mercury/orders            - List Mercury orders
 *   GET    /api/mercury/orders/:orderId   - Get order details
 *   POST   /api/mercury/orders/:id/accept - Accept order
 *   POST   /api/mercury/orders/:id/deliver - Deliver report
 *   POST   /api/mercury/orders/:id/status - Update status
 *   GET    /api/mercury/health            - Check Mercury connection
 *   POST   /api/mercury/configure         - Admin: configure credentials
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import {
  receiveOrder,
  sendStatusUpdate,
  deliverReport,
  configureMercuryCredentials,
  checkConnection,
  handleWebhook,
} from '../integrations/mercuryAdapter.js';
import { validateBody } from '../middleware/validateRequest.js';
import { authMiddleware } from './authMiddleware.js';
import log from '../logger.js';

const router = Router();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const configureCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key required'),
  vendorId: z.string().min(1, 'Vendor ID required'),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
});

const statusUpdateSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'on_hold', 'completed', 'revision_requested']),
  details: z.record(z.any()).optional(),
});

const deliverReportSchema = z.object({
  xml: z.string().min(1, 'XML required'),
  pdf: z.string().min(1, 'PDF required'),
});

// ── POST /api/mercury/webhook ─ Receive Mercury webhooks (no auth) ──────────

router.post('/mercury/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-mercury-signature'] || req.headers['x-signature'];

    // TODO: Get secret from credentials store if needed
    const secret = process.env.MERCURY_WEBHOOK_SECRET || null;

    const result = await handleWebhook(payload, signature, secret);
    res.json(result);

    log.info('mercury:webhook-received', { eventType: payload.EventType || payload.event });
  } catch (err) {
    log.error('mercury:webhook-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── GET /api/mercury/orders ─ List Mercury orders ──────────────────────────

router.get('/mercury/orders', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;

    const orders = db.prepare(`
      SELECT * FROM mercury_orders
      WHERE user_id = ?
      ORDER BY received_at DESC
      LIMIT 100
    `).all(userId);

    res.json({
      ok: true,
      orders: orders.map(o => ({
        ...o,
        order_xml: o.order_xml ? o.order_xml.substring(0, 100) + '...' : null, // Summary only
      })),
      total: orders.length,
    });
  } catch (err) {
    log.error('mercury:list-orders-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/mercury/orders/:orderId ─ Get order details ─────────────────────

router.get('/mercury/orders/:orderId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { orderId } = req.params;
    const userId = req.user.userId;

    const order = db.prepare(`
      SELECT * FROM mercury_orders
      WHERE id = ? AND user_id = ?
    `).get(orderId, userId);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    res.json({ ok: true, order });
  } catch (err) {
    log.error('mercury:get-order-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/mercury/orders/:id/accept ─ Accept an order ─────────────────────

router.post('/mercury/orders/:id/accept', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const userId = req.user.userId;

    const order = db.prepare(`
      SELECT * FROM mercury_orders WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Send acceptance status to Mercury
    await sendStatusUpdate(id, 'accepted', { acceptedBy: userId });

    res.json({
      ok: true,
      message: 'Order accepted',
      status: 'accepted',
    });

    log.info('mercury:order-accepted', { orderId: id, userId });
  } catch (err) {
    log.error('mercury:accept-order-error', { orderId: req.params.id, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/mercury/orders/:id/deliver ─ Deliver report ──────────────────────

router.post('/mercury/orders/:id/deliver', authMiddleware, validateBody(deliverReportSchema), async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { xml, pdf } = req.validated;
    const userId = req.user.userId;

    const order = db.prepare(`
      SELECT * FROM mercury_orders WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Deliver report to Mercury
    await deliverReport(id, { xml, pdf });

    res.json({
      ok: true,
      message: 'Report delivered',
      status: 'completed',
    });

    log.info('mercury:report-delivered', { orderId: id, userId, size: xml.length });
  } catch (err) {
    log.error('mercury:deliver-report-error', { orderId: req.params.id, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/mercury/orders/:id/status ─ Update order status ───────────────────

router.post('/mercury/orders/:id/status', authMiddleware, validateBody(statusUpdateSchema), async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { status, details } = req.validated;
    const userId = req.user.userId;

    const order = db.prepare(`
      SELECT * FROM mercury_orders WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Send status update to Mercury
    await sendStatusUpdate(id, status, details || {});

    res.json({
      ok: true,
      message: `Status updated to ${status}`,
      status,
    });

    log.info('mercury:status-updated', { orderId: id, userId, status });
  } catch (err) {
    log.error('mercury:update-status-error', { orderId: req.params.id, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/mercury/health ─ Check Mercury connection ────────────────────────

router.get('/mercury/health', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await checkConnection(userId);
    res.json(result);
  } catch (err) {
    log.error('mercury:health-check-error', { error: err.message });
    res.status(500).json({ ok: false, status: 'error', error: err.message });
  }
});

// ── POST /api/mercury/configure ─ Admin: configure credentials ──────────────────

router.post('/mercury/configure', authMiddleware, validateBody(configureCredentialsSchema), (req, res) => {
  try {
    const userId = req.user.userId;
    const { apiKey, vendorId, environment } = req.validated;

    const result = configureMercuryCredentials(userId, { apiKey, vendorId, environment });
    res.json(result);

    log.info('mercury:credentials-configured', { userId, vendorId, environment });
  } catch (err) {
    log.error('mercury:configure-error', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
