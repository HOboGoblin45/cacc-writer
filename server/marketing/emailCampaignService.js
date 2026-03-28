/**
 * server/marketing/emailCampaignService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Email campaign engine for drip campaigns, transactional emails, and broadcasts.
 *
 * Manages:
 *   - Campaign creation and lifecycle (active/paused/completed)
 *   - Subscriber enrollment and sequence tracking
 *   - Email queueing and delivery status
 *   - Campaign analytics (open rates, click rates)
 *   - Pre-built campaign templates (UAD 3.6, Onboarding, Win-Back)
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, dbGet, dbRun, dbAll } from '../db/database.js';
import log from '../logger.js';

// Pre-built campaign templates
export const CAMPAIGN_TEMPLATES = {
  uad36_countdown: {
    name: 'UAD 3.6 Countdown Series',
    type: 'drip',
    description: 'Weekly countdown emails before UAD 3.6 launch',
    emails: [
      {
        index: 0,
        delayDays: 0,
        subject: 'The Clock is Ticking: UAD 3.6 is Coming',
        templateName: 'countdown_intro',
      },
      {
        index: 1,
        delayDays: 7,
        subject: "What's Different: Form 1004 vs New URAR",
        templateName: 'countdown_differences',
      },
      {
        index: 2,
        delayDays: 14,
        subject: 'Condition & Quality Ratings Under UAD 3.6 (C1-C6, Q1-Q6)',
        templateName: 'countdown_ratings',
      },
      {
        index: 3,
        delayDays: 21,
        subject: 'Market Conditions: The End of Form 1004MC',
        templateName: 'countdown_market',
      },
      {
        index: 4,
        delayDays: 28,
        subject: 'Sales Comparison Grid: Per-Adjustment Narratives',
        templateName: 'countdown_grid',
      },
      {
        index: 5,
        delayDays: 35,
        subject: 'How AI Handles the New URAR',
        templateName: 'countdown_ai_demo',
      },
      {
        index: 6,
        delayDays: 42,
        subject: 'Your UAD 3.6 Checklist',
        templateName: 'countdown_checklist',
      },
      {
        index: 7,
        delayDays: 49,
        subject: 'Launch Day is Here: Real Brain Meets the New URAR',
        templateName: 'countdown_launch',
      },
    ],
  },

  onboarding: {
    name: 'Onboarding Drip',
    type: 'drip',
    description: 'First 14 days — account setup to trial conversion',
    emails: [
      {
        index: 0,
        delayDays: 0,
        subject: 'Welcome to Real Brain',
        templateName: 'onboarding_welcome',
      },
      {
        index: 1,
        delayDays: 1,
        subject: 'Upload Your Reports for Voice Training',
        templateName: 'onboarding_voice_step',
      },
      {
        index: 2,
        delayDays: 3,
        subject: 'Your AI Voice is Ready — Start Your First Case',
        templateName: 'onboarding_voice_ready',
      },
      {
        index: 3,
        delayDays: 7,
        subject: 'Advanced Features: QC Engine & Comp Intelligence',
        templateName: 'onboarding_features',
      },
      {
        index: 4,
        delayDays: 14,
        subject: 'Your Trial Ends Soon — Upgrade to Paid',
        templateName: 'onboarding_trial_ending',
      },
    ],
  },

  winback: {
    name: 'Win-Back Campaign',
    type: 'drip',
    description: 'Re-engagement for inactive users',
    emails: [
      {
        index: 0,
        delayDays: 0,
        subject: 'We Miss You — Come Back to Real Brain',
        templateName: 'winback_reengagement',
      },
      {
        index: 1,
        delayDays: 7,
        subject: "What's New in Real Brain",
        templateName: 'winback_features',
      },
      {
        index: 2,
        delayDays: 21,
        subject: 'Special Offer: Come Back for 30% Off',
        templateName: 'winback_discount',
      },
    ],
  },
};

/**
 * Create a new email campaign from a template or custom emails
 * @param {string} name - Campaign name
 * @param {string} type - 'drip', 'one-off', or 'transactional'
 * @param {Array} emails - Array of {index, delayDays, subject, templateName}
 * @returns {Object} {id, name, type, status}
 */
export function createCampaign(name, type, emails) {
  const id = uuidv4();
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO email_campaigns (id, name, type, status, emails_json, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `, [id, name, type, JSON.stringify(emails), now, now]);

  log.info('campaign:created', { campaignId: id, name, emailCount: emails.length });

  return {
    id,
    name,
    type,
    status: 'active',
    emailCount: emails.length,
  };
}

/**
 * Get campaign details and basic stats
 * @param {string} campaignId
 * @returns {Object} Campaign record with subscriber count
 */
export function getCampaign(campaignId) {
  const campaign = dbGet('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) return null;

  campaign.emails_json = campaign.emails_json ? JSON.parse(campaign.emails_json) : [];

  const stats = dbGet(
    'SELECT COUNT(*) as subscriber_count FROM campaign_subscribers WHERE campaign_id = ?',
    [campaignId]
  );

  return {
    ...campaign,
    subscriberCount: stats?.subscriber_count || 0,
  };
}

/**
 * Pause a campaign (stop sending new emails)
 * @param {string} campaignId
 */
export function pauseCampaign(campaignId) {
  const now = new Date().toISOString();
  dbRun('UPDATE email_campaigns SET status = ?, updated_at = ? WHERE id = ?',
    ['paused', now, campaignId]);
  log.info('campaign:paused', { campaignId });
}

/**
 * Resume a paused campaign
 * @param {string} campaignId
 */
export function resumeCampaign(campaignId) {
  const now = new Date().toISOString();
  dbRun('UPDATE email_campaigns SET status = ?, updated_at = ? WHERE id = ?',
    ['active', now, campaignId]);
  log.info('campaign:resumed', { campaignId });
}

/**
 * Delete a campaign and all its sends
 * @param {string} campaignId
 */
export function deleteCampaign(campaignId) {
  dbRun('DELETE FROM email_sends WHERE campaign_id = ?', [campaignId]);
  dbRun('DELETE FROM campaign_subscribers WHERE campaign_id = ?', [campaignId]);
  dbRun('DELETE FROM email_campaigns WHERE id = ?', [campaignId]);
  log.info('campaign:deleted', { campaignId });
}

/**
 * Enroll a subscriber in a campaign
 * @param {string} campaignId
 * @param {string} email
 * @param {Object} metadata - Optional {userId, name, company, etc}
 * @returns {Object} {subscriberId, campaignId, email}
 */
export function enrollSubscriber(campaignId, email, metadata = {}) {
  const campaign = dbGet('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const subscriberId = uuidv4();
  const now = new Date().toISOString();

  try {
    dbRun(`
      INSERT INTO campaign_subscribers (id, campaign_id, email, user_id, metadata_json, enrolled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `, [subscriberId, campaignId, email, metadata.userId || null, JSON.stringify(metadata), now]);

    log.info('subscriber:enrolled', { campaignId, email, subscriberId });

    return {
      subscriberId,
      campaignId,
      email,
      status: 'active',
    };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      // Already enrolled — return existing
      const existing = dbGet(
        'SELECT * FROM campaign_subscribers WHERE campaign_id = ? AND email = ?',
        [campaignId, email]
      );
      return {
        subscriberId: existing.id,
        campaignId,
        email,
        status: existing.status,
      };
    }
    throw err;
  }
}

/**
 * Get the next email in sequence for a subscriber
 * @param {string} subscriberId
 * @returns {Object|null} {emailIndex, subject, templateName, delayDays} or null if no more emails
 */
export function getNextEmail(subscriberId) {
  const subscriber = dbGet('SELECT * FROM campaign_subscribers WHERE id = ?', [subscriberId]);
  if (!subscriber) return null;

  const campaign = dbGet('SELECT * FROM email_campaigns WHERE id = ?', [subscriber.campaign_id]);
  if (!campaign) return null;

  const emails = JSON.parse(campaign.emails_json || '[]');
  const nextEmail = emails[subscriber.current_index];

  if (!nextEmail) return null; // Campaign complete

  // Check if delay has passed
  const enrolledAt = new Date(subscriber.enrolled_at);
  const now = new Date();
  const daysPassed = Math.floor((now - enrolledAt) / (1000 * 60 * 60 * 24));

  if (daysPassed < nextEmail.delayDays) {
    return null; // Not ready yet
  }

  return {
    emailIndex: nextEmail.index,
    subject: nextEmail.subject,
    templateName: nextEmail.templateName,
    delayDays: nextEmail.delayDays,
  };
}

/**
 * Process all pending campaign emails in the queue
 * Called by a scheduled job (e.g., every 5 minutes)
 * @returns {Object} {processed, sent, failed}
 */
export function processQueue() {
  const db = getDb();
  let processed = 0;
  let sent = 0;
  let failed = 0;

  // Get all active subscribers from active campaigns
  const subscribers = dbAll(`
    SELECT cs.* FROM campaign_subscribers cs
    JOIN email_campaigns ec ON cs.campaign_id = ec.id
    WHERE cs.status = 'active' AND ec.status = 'active'
    LIMIT 100
  `);

  for (const subscriber of subscribers) {
    const nextEmail = getNextEmail(subscriber.id);
    if (!nextEmail) continue;

    // Create send record
    const sendId = uuidv4();
    const now = new Date().toISOString();

    try {
      dbRun(`
        INSERT INTO email_sends (
          id, campaign_id, subscriber_id, email_index, subject, status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
      `, [sendId, subscriber.campaign_id, subscriber.id, nextEmail.emailIndex, nextEmail.subject]);

      // Update subscriber to next email
      dbRun(
        'UPDATE campaign_subscribers SET current_index = current_index + 1, last_sent_at = ? WHERE id = ?',
        [now, subscriber.id]
      );

      processed++;
      sent++;

      // Mark as sent (in real system, would call email service)
      recordDelivery(subscriber.id, nextEmail.emailIndex, 'sent');
    } catch (err) {
      log.error('queue:process-email-failed', { subscriberId: subscriber.id, error: err.message });
      failed++;
    }
  }

  log.info('queue:processed', { processed, sent, failed });
  return { processed, sent, failed };
}

/**
 * Record email delivery status
 * @param {string} subscriberId
 * @param {number} emailIndex
 * @param {string} status - 'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced'
 */
export function recordDelivery(subscriberId, emailIndex, status) {
  const now = new Date().toISOString();
  const updateField = {
    sent: 'sent_at',
    delivered: 'sent_at',
    opened: 'opened_at',
    clicked: 'clicked_at',
    bounced: 'bounced_at',
  }[status];

  if (updateField) {
    dbRun(
      `UPDATE email_sends SET status = ?, ${updateField} = ? WHERE subscriber_id = ? AND email_index = ?`,
      [status, now, subscriberId, emailIndex]
    );
  }

  log.info('delivery:recorded', { subscriberId, emailIndex, status });
}

/**
 * Get campaign analytics
 * @param {string} campaignId
 * @returns {Object} {totalSent, opened, clicked, unsubscribed, openRate, clickRate}
 */
export function getCampaignStats(campaignId) {
  const stats = dbGet(`
    SELECT
      COUNT(*) as total_sent,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as unsubscribed
    FROM email_sends
    WHERE campaign_id = ? AND status IN ('sent', 'delivered', 'opened', 'clicked')
  `, [campaignId]);

  if (!stats || stats.total_sent === 0) {
    return {
      totalSent: 0,
      opened: 0,
      clicked: 0,
      unsubscribed: 0,
      openRate: 0,
      clickRate: 0,
    };
  }

  return {
    totalSent: stats.total_sent || 0,
    opened: stats.opened || 0,
    clicked: stats.clicked || 0,
    unsubscribed: stats.unsubscribed || 0,
    openRate: stats.total_sent > 0 ? ((stats.opened || 0) / stats.total_sent) * 100 : 0,
    clickRate: stats.total_sent > 0 ? ((stats.clicked || 0) / stats.total_sent) * 100 : 0,
  };
}

/**
 * Get full journey for a subscriber (all emails sent)
 * @param {string} email
 * @returns {Array} Array of {campaignName, emailIndex, subject, status, sentAt, openedAt, clickedAt}
 */
export function getSubscriberJourney(email) {
  const rows = dbAll(`
    SELECT
      ec.name as campaign_name,
      es.email_index,
      es.subject,
      es.status,
      es.sent_at,
      es.opened_at,
      es.clicked_at
    FROM email_sends es
    JOIN campaign_subscribers cs ON es.subscriber_id = cs.id
    JOIN email_campaigns ec ON es.campaign_id = ec.id
    WHERE cs.email = ?
    ORDER BY es.created_at ASC
  `, [email]);

  return rows || [];
}

/**
 * Unsubscribe a subscriber from a campaign
 * @param {string} subscriberId
 */
export function unsubscribeSubscriber(subscriberId) {
  const now = new Date().toISOString();
  dbRun('UPDATE campaign_subscribers SET status = ?, updated_at = ? WHERE id = ?',
    ['unsubscribed', now, subscriberId]);
  log.info('subscriber:unsubscribed', { subscriberId });
}

export default {
  CAMPAIGN_TEMPLATES,
  createCampaign,
  getCampaign,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  enrollSubscriber,
  getNextEmail,
  processQueue,
  recordDelivery,
  getCampaignStats,
  getSubscriberJourney,
  unsubscribeSubscriber,
};
