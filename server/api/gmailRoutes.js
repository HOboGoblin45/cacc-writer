/**
 * server/api/gmailRoutes.js
 * ---------------------------
 * Gmail OAuth + send routes.
 *
 * Routes:
 *   GET  /api/gmail/status         - connection status
 *   GET  /api/gmail/connect        - redirect to Google OAuth consent
 *   GET  /api/gmail/callback       - OAuth callback, save token
 *   POST /api/gmail/disconnect     - delete saved token
 *   POST /api/gmail/send           - send email { to, subject, body, cc? }
 *   POST /api/gmail/send-template  - send using named template { template, params, to? }
 */

import express from 'express';
import {
  getAuthUrl,
  handleCallback,
  sendEmail,
  isConnected,
  disconnect,
} from '../integrations/gmail.js';
import { renderTemplate, TEMPLATE_NAMES } from '../integrations/emailTemplates.js';
import log from '../logger.js';

const router = express.Router();

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * GET /api/gmail/status
 * Returns whether Gmail OAuth token exists.
 */
router.get('/gmail/status', (req, res) => {
  res.json({
    ok: true,
    connected: isConnected(),
    account: isConnected() ? 'crescicharles@gmail.com' : null,
  });
});

// ── OAuth Connect ─────────────────────────────────────────────────────────

/**
 * GET /api/gmail/connect
 * Redirects browser to Google OAuth consent screen.
 * Requires GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in env.
 */
router.get('/gmail/connect', (req, res) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return res.status(503).send([
      '<h2>Gmail Not Configured</h2>',
      '<p>GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are not set in .env</p>',
      '<p>See <strong>docs/GMAIL_SETUP.md</strong> for setup instructions.</p>',
      '<p><a href="/">Back to app</a></p>',
    ].join(''));
  }
  const url = getAuthUrl();
  res.redirect(url);
});

/**
 * GET /api/gmail/callback
 * Handles OAuth callback from Google. Saves token and shows success page.
 */
router.get('/gmail/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    log.warn('gmail:oauth-error', { error });
    return res.status(400).send([
      '<h2>Gmail Authorization Failed</h2>',
      `<p>Error: ${error}</p>`,
      '<p><a href="/">Back to app</a></p>',
    ].join(''));
  }

  if (!code) {
    return res.status(400).send('<h2>Missing authorization code</h2><p><a href="/">Back to app</a></p>');
  }

  try {
    await handleCallback(code);
    res.send([
      '<html><head><title>Gmail Connected</title>',
      '<style>body{font-family:system-ui;background:#0b1020;color:#e9edf7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}',
      '.box{background:#131929;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:40px;text-align:center;max-width:400px;}',
      'h2{color:#55d18f;margin-top:0;} a{color:#d7b35a;}</style></head>',
      '<body><div class="box">',
      '<h2>✅ Gmail Connected!</h2>',
      '<p>crescicharles@gmail.com is now authorized to send emails.</p>',
      '<p>You can close this tab and return to the app.</p>',
      '<p><a href="/">Back to CACC Writer</a></p>',
      '</div></body></html>',
    ].join(''));
  } catch (e) {
    log.warn('gmail:callback-failed', { error: e.message });
    res.status(500).send([
      '<h2>Gmail Authorization Error</h2>',
      `<p>${e.message}</p>`,
      '<p><a href="/">Back to app</a></p>',
    ].join(''));
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────

/**
 * POST /api/gmail/disconnect
 * Removes saved token file.
 */
router.post('/gmail/disconnect', (req, res) => {
  const removed = disconnect();
  res.json({ ok: true, disconnected: removed });
});

// ── Send Email ────────────────────────────────────────────────────────────

/**
 * POST /api/gmail/send
 * Body: { to, subject, body, cc? }
 */
router.post('/gmail/send', async (req, res) => {
  const { to, subject, body, cc } = req.body || {};

  if (!to || !subject || !body) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: to, subject, body' });
  }

  const result = await sendEmail({ to, subject, body, cc });
  if (!result.ok) {
    return res.status(result.error?.includes('not connected') ? 503 : 500).json(result);
  }
  res.json(result);
});

// ── Send Template ─────────────────────────────────────────────────────────

/**
 * POST /api/gmail/send-template
 * Body: { template, params?, to?, cc? }
 *
 * template - name of template (inspectionRequest, reportDelivery, mredApiRequest, etc.)
 * params   - array of positional args for the template function
 * to       - override recipient (some templates have a default)
 * cc       - optional CC
 */
router.post('/gmail/send-template', async (req, res) => {
  const { template, params = [], to: toOverride, cc } = req.body || {};

  if (!template) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required field: template',
      available: TEMPLATE_NAMES,
    });
  }

  let rendered;
  try {
    rendered = renderTemplate(template, params);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message, available: TEMPLATE_NAMES });
  }

  const to = toOverride || rendered.to;
  if (!to) {
    return res.status(400).json({
      ok: false,
      error: `Template "${template}" has no default recipient. Provide "to" in request body.`,
    });
  }

  const result = await sendEmail({ to, subject: rendered.subject, body: rendered.body, cc });
  if (!result.ok) {
    return res.status(result.error?.includes('not connected') ? 503 : 500).json(result);
  }

  log.info('gmail:template-sent', { template, to });
  res.json({ ok: true, template, to, subject: rendered.subject });
});

/**
 * GET /api/gmail/templates
 * List available template names.
 */
router.get('/gmail/templates', (req, res) => {
  res.json({ ok: true, templates: TEMPLATE_NAMES });
});

export default router;
