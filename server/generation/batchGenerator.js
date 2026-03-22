/**
 * server/generation/batchGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch generation: generate ALL narrative sections for a case in one click.
 * 
 * Instead of clicking "Generate" 8 times, the user clicks once and
 * all sections draft in parallel (respecting concurrency limits).
 * 
 * SSE progress events are emitted so the UI shows real-time progress.
 */

import { dbGet, dbRun, dbAll } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import { getRelevantExamplesWithVoice, formatVoiceExamplesBlock, formatExamplesBlock } from '../retrieval.js';
import { getUserApprovedExamples } from '../retrieval/userScopedRetrieval.js';
import { buildPromptMessages } from '../promptBuilder.js';
import { checkReportQuota, incrementReportCount } from '../auth/authService.js';
import log from '../logger.js';

const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL_SECTIONS || '4', 10);

// ── Section definitions per form type ────────────────────────────────────────

const FORM_SECTIONS = {
  '1004': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'highest_best_use', title: 'Highest and Best Use' },
    { id: 'cost_approach', title: 'Cost Approach' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation_narrative', title: 'Reconciliation' },
    { id: 'scope_of_work', title: 'Scope of Work' },
  ],
  '1025': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'highest_best_use', title: 'Highest and Best Use' },
    { id: 'income_approach', title: 'Income Approach' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation_narrative', title: 'Reconciliation' },
    { id: 'scope_of_work', title: 'Scope of Work' },
  ],
  '1073': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'condo_analysis', title: 'Condominium Analysis' },
    { id: 'highest_best_use', title: 'Highest and Best Use' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation_narrative', title: 'Reconciliation' },
    { id: 'scope_of_work', title: 'Scope of Work' },
  ],
  'commercial': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'highest_best_use', title: 'Highest and Best Use' },
    { id: 'income_approach', title: 'Income Approach' },
    { id: 'cost_approach', title: 'Cost Approach' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation_narrative', title: 'Reconciliation' },
  ],
  '1004c': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_description', title: 'Description of Improvements' },
    { id: 'highest_best_use', title: 'Highest and Best Use' },
    { id: 'sales_comparison', title: 'Sales Comparison Approach' },
    { id: 'reconciliation_narrative', title: 'Reconciliation' },
  ],
};

/**
 * Get the section list for a form type.
 */
export function getSectionsForForm(formType) {
  return FORM_SECTIONS[formType] || FORM_SECTIONS['1004'];
}

/**
 * Run batch generation for all sections of a case.
 *
 * @param {string} caseId
 * @param {Object} options
 * @param {string} options.userId — for per-user KB retrieval
 * @param {string} [options.formType] — override form type
 * @param {boolean} [options.skipExisting] — skip sections that already have text
 * @param {function} [options.onProgress] — callback(sectionId, status, text)
 * @returns {Promise<Object>} results summary
 */
export async function batchGenerate(caseId, options = {}) {
  const startTime = Date.now();
  const userId = options.userId || 'default';

  // Load case
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) throw new Error(`Case not found: ${caseId}`);

  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const formType = options.formType || caseRecord.form_type || '1004';
  const sections = getSectionsForForm(formType);

  // Check quota
  if (userId !== 'default') {
    const quota = checkReportQuota(userId);
    if (!quota.allowed) {
      throw new Error(`Report limit reached: ${quota.reason}`);
    }
  }

  // Check which sections already have text (if skipExisting)
  let existingSections = {};
  if (options.skipExisting) {
    const existing = dbAll(
      `SELECT section_id, draft_text, reviewed_text, final_text FROM generated_sections
       WHERE case_id = ? ORDER BY created_at DESC`,
      [caseId]
    );
    for (const s of existing) {
      if (!existingSections[s.section_id]) {
        const hasText = s.final_text || s.reviewed_text || s.draft_text;
        if (hasText) existingSections[s.section_id] = true;
      }
    }
  }

  const toGenerate = sections.filter(s => !existingSections[s.id]);

  log.info('batch:start', { caseId, formType, total: sections.length, generating: toGenerate.length, skipping: sections.length - toGenerate.length });

  if (options.onProgress) options.onProgress('_batch', 'started', { total: toGenerate.length, formType });

  // Generate in parallel batches
  const results = {};
  let completed = 0;
  let failed = 0;

  async function generateSection(section) {
    const sectionStart = Date.now();
    if (options.onProgress) options.onProgress(section.id, 'generating', null);

    try {
      // Retrieve examples (user-specific + global)
      const userExamples = getUserApprovedExamples(userId, {
        fieldId: section.id,
        formType,
        limit: 3,
      });

      const globalExamples = getRelevantExamplesWithVoice({
        formType,
        fieldId: section.id,
        propertyType: facts.subject?.propertyType,
        marketType: facts.site?.marketType,
        county: facts.subject?.county,
        city: facts.subject?.city,
      });

      // Build prompt messages
      const messages = buildPromptMessages({
        formType,
        fieldId: section.id,
        facts,
        voiceExamples: [...userExamples.map(e => ({ text: e.text, source: 'user_approved' })), ...(globalExamples.voiceExamples || [])],
        otherExamples: globalExamples.otherExamples || [],
      });

      // Call AI
      const text = await callAI(messages, { maxTokens: 1500, temperature: 0.3 });

      // Save to generated_sections
      const now = new Date().toISOString();
      dbRun(
        `INSERT INTO generated_sections (case_id, section_id, draft_text, model_used, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [caseId, section.id, text, process.env.AI_PROVIDER === 'ollama' ? (process.env.OLLAMA_MODEL || 'mistral') : (process.env.OPENAI_MODEL || 'gpt-4.1'), now]
      );

      const durationMs = Date.now() - sectionStart;
      completed++;
      results[section.id] = { ok: true, chars: text.length, durationMs };

      log.info('batch:section-done', { caseId, sectionId: section.id, chars: text.length, durationMs });
      if (options.onProgress) options.onProgress(section.id, 'complete', { text: text.slice(0, 200), chars: text.length, durationMs });

    } catch (err) {
      failed++;
      results[section.id] = { ok: false, error: err.message };
      log.error('batch:section-failed', { caseId, sectionId: section.id, error: err.message });
      if (options.onProgress) options.onProgress(section.id, 'failed', { error: err.message });
    }
  }

  // Process in parallel batches
  for (let i = 0; i < toGenerate.length; i += MAX_PARALLEL) {
    const batch = toGenerate.slice(i, i + MAX_PARALLEL);
    await Promise.all(batch.map(generateSection));
  }

  // Increment report count
  if (userId !== 'default' && completed > 0) {
    try { incrementReportCount(userId); } catch { /* ok */ }
  }

  const totalDuration = Date.now() - startTime;

  log.info('batch:complete', { caseId, completed, failed, totalDuration });
  if (options.onProgress) options.onProgress('_batch', 'complete', { completed, failed, totalDuration });

  return {
    caseId,
    formType,
    totalSections: sections.length,
    generated: completed,
    failed,
    skipped: sections.length - toGenerate.length,
    durationMs: totalDuration,
    results,
  };
}

export default { batchGenerate, getSectionsForForm, FORM_SECTIONS };
