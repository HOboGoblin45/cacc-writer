/**
 * server/revisions/revisionTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Revision tracking for appraisal reports.
 *
 * When a lender/AMC requests changes (stipulations), this module:
 *   1. Tracks each revision request with specific stipulations
 *   2. Links stipulations to affected sections/fields
 *   3. AI-assists in addressing each stipulation
 *   4. Tracks revision history for compliance
 *   5. Generates revision summary for resubmission
 *
 * Critical for:
 *   - UCDP resubmission workflow
 *   - Audit trail (USPAP compliance)
 *   - E&O insurance documentation
 *   - AMC communication
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureRevisionSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS revision_requests (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id         TEXT NOT NULL,
      revision_number INTEGER NOT NULL DEFAULT 1,
      requester       TEXT,
      requester_type  TEXT DEFAULT 'lender',
      received_at     TEXT DEFAULT (datetime('now')),
      due_date        TEXT,
      status          TEXT DEFAULT 'pending',
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stipulations (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      revision_id     TEXT NOT NULL REFERENCES revision_requests(id),
      case_id         TEXT NOT NULL,
      text            TEXT NOT NULL,
      category        TEXT,
      affected_section TEXT,
      status          TEXT DEFAULT 'pending',
      response_text   TEXT,
      ai_suggestion   TEXT,
      resolved_at     TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS section_history (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id         TEXT NOT NULL,
      section_id      TEXT NOT NULL,
      revision_number INTEGER DEFAULT 0,
      previous_text   TEXT,
      new_text        TEXT,
      change_reason   TEXT,
      changed_by      TEXT DEFAULT 'appraiser',
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_revision_case ON revision_requests(case_id);
    CREATE INDEX IF NOT EXISTS idx_stipulation_revision ON stipulations(revision_id);
    CREATE INDEX IF NOT EXISTS idx_section_history ON section_history(case_id, section_id);
  `);
}

/**
 * Create a new revision request for a case.
 */
export function createRevisionRequest(caseId, { requester, requesterType, dueDate, notes, stipulations }) {
  const db = getDb();

  // Get next revision number
  const lastRevision = db.prepare(
    'SELECT MAX(revision_number) as maxRev FROM revision_requests WHERE case_id = ?'
  ).get(caseId);
  const revisionNumber = (lastRevision?.maxRev || 0) + 1;

  const revId = crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO revision_requests (id, case_id, revision_number, requester, requester_type, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(revId, caseId, revisionNumber, requester || null, requesterType || 'lender', dueDate || null, notes || null);

  // Add stipulations
  const stips = [];
  for (const stip of (stipulations || [])) {
    const stipId = crypto.randomBytes(8).toString('hex');
    const category = categorizeStipulation(stip.text || stip);
    const affectedSection = mapStipulationToSection(stip.text || stip);

    db.prepare(`
      INSERT INTO stipulations (id, revision_id, case_id, text, category, affected_section)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stipId, revId, caseId, stip.text || stip, category, affectedSection);

    stips.push({ id: stipId, text: stip.text || stip, category, affectedSection, status: 'pending' });
  }

  log.info('revision:created', { caseId, revisionNumber, stipulations: stips.length });

  return { revisionId: revId, revisionNumber, stipulations: stips };
}

/**
 * AI-generate suggested responses for all pending stipulations.
 */
export async function generateStipulationResponses(caseId, revisionId) {
  const db = getDb();
  const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const pendingStips = db.prepare(
    'SELECT * FROM stipulations WHERE revision_id = ? AND status = ?'
  ).all(revisionId, 'pending');

  if (pendingStips.length === 0) return { resolved: 0 };

  const responses = [];

  for (const stip of pendingStips) {
    try {
      const messages = [
        {
          role: 'system',
          content: `You are an expert residential real estate appraiser responding to a lender's revision stipulation. 
Write a clear, professional response that addresses the stipulation directly.
If the stipulation asks for additional data or clarification, provide it.
If the stipulation asks for a correction, explain what was changed and why.
Keep responses concise but thorough. This will be included in the revised report.`,
        },
        {
          role: 'user',
          content: `Stipulation: "${stip.text}"

Property: ${facts.subject?.address || 'N/A'}, ${facts.subject?.city || ''}, ${facts.subject?.state || ''}
Form type: ${facts.assignment?.type || '1004'}

Generate a professional response addressing this stipulation.`,
        },
      ];

      const suggestion = await callAI(messages, { maxTokens: 500, temperature: 0.3 });

      db.prepare('UPDATE stipulations SET ai_suggestion = ? WHERE id = ?').run(suggestion, stip.id);
      responses.push({ stipId: stip.id, text: stip.text, suggestion });
    } catch (err) {
      log.warn('revision:ai-failed', { stipId: stip.id, error: err.message });
      responses.push({ stipId: stip.id, text: stip.text, error: err.message });
    }
  }

  return { total: pendingStips.length, responses };
}

/**
 * Resolve a stipulation (mark as addressed).
 */
export function resolveStipulation(stipId, { responseText, sectionUpdated, newSectionText }) {
  const db = getDb();
  const now = new Date().toISOString();

  const stip = db.prepare('SELECT * FROM stipulations WHERE id = ?').get(stipId);
  if (!stip) throw new Error('Stipulation not found');

  db.prepare('UPDATE stipulations SET status = ?, response_text = ?, resolved_at = ? WHERE id = ?')
    .run('resolved', responseText, now, stipId);

  // Track section change if text was updated
  if (sectionUpdated && stip.affected_section) {
    const lastRevNum = db.prepare(
      'SELECT MAX(revision_number) as maxRev FROM revision_requests WHERE case_id = ?'
    ).get(stip.case_id)?.maxRev || 1;

    db.prepare(`
      INSERT INTO section_history (case_id, section_id, revision_number, previous_text, new_text, change_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stip.case_id, stip.affected_section, lastRevNum, null, newSectionText || null, stip.text);
  }

  // Check if all stipulations for this revision are resolved
  const pending = db.prepare(
    'SELECT COUNT(*) as c FROM stipulations WHERE revision_id = ? AND status = ?'
  ).get(stip.revision_id, 'pending');

  if (pending.c === 0) {
    db.prepare('UPDATE revision_requests SET status = ? WHERE id = ?').run('complete', stip.revision_id);
  }

  return { resolved: true, allComplete: pending.c === 0 };
}

/**
 * Get revision history for a case.
 */
export function getRevisionHistory(caseId) {
  const db = getDb();
  const revisions = db.prepare('SELECT * FROM revision_requests WHERE case_id = ? ORDER BY revision_number').all(caseId);

  return revisions.map(rev => {
    const stips = db.prepare('SELECT * FROM stipulations WHERE revision_id = ? ORDER BY created_at').all(rev.id);
    return { ...rev, stipulations: stips };
  });
}

/**
 * Generate a revision summary suitable for UCDP resubmission.
 */
export function generateRevisionSummary(caseId) {
  const db = getDb();
  const revisions = getRevisionHistory(caseId);
  const changes = db.prepare('SELECT * FROM section_history WHERE case_id = ? ORDER BY revision_number, created_at').all(caseId);

  let summary = `REVISION SUMMARY\n${'='.repeat(50)}\n\n`;

  for (const rev of revisions) {
    summary += `Revision #${rev.revision_number} — Requested by: ${rev.requester || 'Lender'}\n`;
    summary += `Received: ${rev.received_at}\n`;
    summary += `Status: ${rev.status}\n\n`;

    for (const stip of rev.stipulations) {
      summary += `  Stipulation: ${stip.text}\n`;
      summary += `  Category: ${stip.category || 'General'}\n`;
      summary += `  Status: ${stip.status}\n`;
      if (stip.response_text) summary += `  Response: ${stip.response_text}\n`;
      summary += '\n';
    }
    summary += '\n';
  }

  if (changes.length > 0) {
    summary += `SECTION CHANGES\n${'='.repeat(50)}\n\n`;
    for (const change of changes) {
      summary += `  Section: ${change.section_id} (Revision #${change.revision_number})\n`;
      summary += `  Reason: ${change.change_reason}\n\n`;
    }
  }

  return summary;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categorizeStipulation(text) {
  const lower = text.toLowerCase();
  if (lower.includes('comp') || lower.includes('comparable') || lower.includes('adjustment')) return 'comparables';
  if (lower.includes('photo') || lower.includes('picture') || lower.includes('image')) return 'photos';
  if (lower.includes('condition') || lower.includes('c1') || lower.includes('c2') || lower.includes('c3')) return 'condition';
  if (lower.includes('value') || lower.includes('reconcil') || lower.includes('opinion')) return 'value';
  if (lower.includes('market') || lower.includes('trend') || lower.includes('supply')) return 'market';
  if (lower.includes('legal') || lower.includes('zoning') || lower.includes('flood')) return 'site';
  if (lower.includes('gla') || lower.includes('square') || lower.includes('room')) return 'improvements';
  return 'general';
}

function mapStipulationToSection(text) {
  const lower = text.toLowerCase();
  if (lower.includes('neighborhood') || lower.includes('market') || lower.includes('area')) return 'neighborhood_description';
  if (lower.includes('site') || lower.includes('lot') || lower.includes('zoning')) return 'site_description';
  if (lower.includes('improvement') || lower.includes('condition') || lower.includes('gla')) return 'improvements_description';
  if (lower.includes('comp') || lower.includes('adjustment') || lower.includes('sales')) return 'sales_comparison';
  if (lower.includes('reconcil') || lower.includes('value') || lower.includes('opinion')) return 'reconciliation_narrative';
  if (lower.includes('cost') || lower.includes('reproduction') || lower.includes('depreciation')) return 'cost_approach';
  if (lower.includes('income') || lower.includes('rent') || lower.includes('grm')) return 'income_approach';
  if (lower.includes('highest') || lower.includes('best use')) return 'highest_best_use';
  return null;
}

export default {
  ensureRevisionSchema, createRevisionRequest, generateStipulationResponses,
  resolveStipulation, getRevisionHistory, generateRevisionSummary,
};
