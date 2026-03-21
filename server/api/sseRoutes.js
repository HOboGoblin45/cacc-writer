/**
 * server/api/sseRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-Sent Events endpoint for real-time generation progress.
 *
 * GET /api/events/:caseId — SSE stream for a specific case
 *
 * The generation routes emit events via the shared bus, and connected
 * clients receive them in real time.
 */

import { Router } from 'express';
import { EventEmitter } from 'events';

const router = Router();

// ── Shared event bus ─────────────────────────────────────────────────────────
// Single instance — generation routes import and emit on this.
export const generationBus = new EventEmitter();
generationBus.setMaxListeners(50);

// ── SSE endpoint ─────────────────────────────────────────────────────────────

router.get('/events/:caseId', (req, res) => {
  const caseId = req.params.caseId;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', caseId })}\n\n`);

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // Listen for generation events for this case
  const handler = (event) => {
    if (event.caseId !== caseId) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  generationBus.on('generation', handler);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    generationBus.off('generation', handler);
  });
});

export default router;
