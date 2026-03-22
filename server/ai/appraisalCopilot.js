/**
 * server/ai/appraisalCopilot.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Appraisal Copilot — conversational AI assistant for appraisers.
 *
 * This is like GitHub Copilot but for appraisals. It:
 *   1. Answers USPAP questions in plain English
 *   2. Suggests adjustment values based on market data
 *   3. Helps write reviewer responses
 *   4. Reviews narratives for compliance issues
 *   5. Explains complex valuation concepts
 *   6. Assists with form filling decisions
 *   7. Drafts engagement letters
 *   8. Generates market condition commentary
 *
 * Context-aware: knows what case the user is working on,
 * what sections are complete, what issues exist.
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

const COPILOT_SYSTEM = `You are the Appraisal Copilot, an AI assistant embedded in Appraisal Agent software.
You help residential real estate appraisers with their daily work.

Your knowledge includes:
- USPAP (Uniform Standards of Professional Appraisal Practice) — all standards, rules, advisory opinions
- UAD (Uniform Appraisal Dataset) — field requirements, abbreviations, reporting conventions
- Fannie Mae / Freddie Mac selling guide requirements for appraisals
- FHA appraisal requirements (HUD 4000.1)
- VA appraisal requirements (VA Pamphlet 26-7)
- Common appraisal forms: 1004, 1004C, 1025, 2055, 1073, 1075, 1007, 216
- Sales comparison approach, cost approach, income approach
- Market analysis, highest and best use
- Adjustment theory and paired sales analysis
- State-specific appraisal regulations

Rules:
- Be concise and direct. Appraisers are busy.
- Cite specific USPAP standards when relevant (e.g., "SR 1-1(a)")
- If giving adjustment values, always caveat that they're estimates needing market support
- Never give a specific property value — that's the appraiser's job
- If unsure, say so. Wrong advice in appraisal = legal liability.`;

/**
 * Chat with the copilot.
 */
export async function chat(userId, caseId, message, conversationHistory = []) {
  const db = getDb();

  // Build context from case data if available
  let caseContext = '';
  if (caseId) {
    try {
      const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
      if (caseData) {
        caseContext = `\n\nCurrent case context:
- Address: ${caseData.property_address || 'N/A'}
- Property type: ${caseData.property_type || 'N/A'}
- GLA: ${caseData.gla || caseData.living_area || 'N/A'} SF
- Year built: ${caseData.year_built || 'N/A'}
- Beds/Baths: ${caseData.bedrooms || '?'}/${caseData.bathrooms || '?'}
- Form type: ${caseData.form_type || 'N/A'}
- Status: ${caseData.status || 'N/A'}`;

        // Check for existing sections
        const sections = db.prepare("SELECT section_type, status FROM report_sections WHERE case_id = ? AND status = 'approved'").all(caseId);
        if (sections.length > 0) {
          caseContext += `\n- Completed sections: ${sections.map(s => s.section_type).join(', ')}`;
        }
      }
    } catch { /* case tables may not exist yet */ }
  }

  const messages = [
    { role: 'system', content: COPILOT_SYSTEM + caseContext },
    ...conversationHistory.slice(-10), // Keep last 10 messages for context
    { role: 'user', content: message },
  ];

  const response = await callAI(messages, { maxTokens: 800, temperature: 0.3 });
  log.info('copilot:chat', { userId, caseId: caseId || 'none', msgLength: message.length });
  return response;
}

/**
 * Quick actions — pre-built prompts for common tasks.
 */
export async function quickAction(userId, caseId, actionType) {
  const actions = {
    uspap_checklist: 'Give me a quick USPAP compliance checklist for a standard 1004 residential appraisal. What must I include?',
    adjustment_help: 'What are typical adjustment ranges for GLA, age, bathrooms, garage, and basement in a suburban residential market? Give me ranges, not specifics.',
    reviewer_response: 'A lender reviewer has requested additional support for my value conclusion. Help me draft a professional response that addresses their concerns without being defensive.',
    market_conditions: 'Help me write a market conditions commentary for the neighborhood section. What data points should I address?',
    hbu_analysis: 'Walk me through a highest and best use analysis for a standard single-family residential property. What are the 4 tests?',
    scope_of_work: 'What should my scope of work include for a standard residential appraisal? Give me a template.',
    engagement_letter: 'What are the essential elements that must be in my engagement letter per USPAP?',
    comp_defense: 'How do I defend my comparable selection to a reviewer who suggests different comps?',
  };

  const prompt = actions[actionType];
  if (!prompt) throw new Error(`Unknown action. Available: ${Object.keys(actions).join(', ')}`);

  return await chat(userId, caseId, prompt);
}

/**
 * Review a narrative section for compliance issues.
 */
export async function reviewNarrative(userId, sectionType, narrativeText) {
  const prompt = `Review this ${sectionType} narrative for an appraisal report. Check for:
1. USPAP compliance issues
2. UAD format violations
3. Unsupported conclusions
4. Missing required content
5. Vague or problematic language
6. Potential reviewer flags

Narrative:
"""
${narrativeText}
"""

List issues found (if any) with specific quotes and suggestions. If the narrative is solid, say so briefly.`;

  return await chat(userId, null, prompt);
}

/**
 * Get available quick actions.
 */
export function getQuickActions() {
  return [
    { id: 'uspap_checklist', label: 'USPAP Checklist', icon: '📋', description: 'Quick compliance checklist' },
    { id: 'adjustment_help', label: 'Adjustment Ranges', icon: '📊', description: 'Typical adjustment values' },
    { id: 'reviewer_response', label: 'Reviewer Response', icon: '✉️', description: 'Draft response to stips' },
    { id: 'market_conditions', label: 'Market Commentary', icon: '📈', description: 'Help writing market conditions' },
    { id: 'hbu_analysis', label: 'HBU Analysis', icon: '🏠', description: 'Highest & best use walkthrough' },
    { id: 'scope_of_work', label: 'Scope of Work', icon: '📝', description: 'SOW template' },
    { id: 'engagement_letter', label: 'Engagement Letter', icon: '📄', description: 'Required elements' },
    { id: 'comp_defense', label: 'Comp Defense', icon: '🛡️', description: 'Defend your comp selection' },
  ];
}

export default { chat, quickAction, reviewNarrative, getQuickActions };
