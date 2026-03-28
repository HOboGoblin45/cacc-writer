/**
 * promptBuilder.js
 * ----------------
 * Assembles the full message array sent to the OpenAI Responses API
 * for narrative section generation and review.
 *
 * Message structure (all system-role, then one user-role):
 *
 *   [system] Appraisal Agent role + rules               â† prompts/system_cacc_writer.txt
 *   [system] Cresci writing style guide             â† prompts/style_guide_cresci.txt
 *   [system] Block 3a: Voice examples               â† approvedNarratives/ (appraiser's own reports)
 *   [system] Block 3b: Other examples               â† approved_edits / curated / imported
 *   [system] Relevant phrase bank entries           â† from knowledgeBase.getPhrases()
 *   [system] Facts context (confidence-aware)       â† from case facts.json
 *   [system] Location context (neighborhood fields) â† from neighborhoodContext.js
 *   [system] Assignment context                     â† purpose, loan program, condition mode
 *   [system] Form-specific field instructions       â† from forms/<formType>.js tpl
 *   [user]   Write the requested section            â† built from facts + fieldId
 *
 * Voice Engine (Block 3a):
 *   Voice examples are the PRIMARY style reference â€" appraiser's own completed reports.
 *   They are labeled distinctly so the AI knows to prioritize them over generic examples.
 *   Pass voiceExamples from getRelevantExamplesWithVoice() in retrieval.js.
 *
 * UPDATED (Phase 1â€"5):
 *   - Added complete FIELD_LABELS for all form types
 *   - Added complete FIELD_PHRASE_TAGS for all fields
 *   - Added Block 3.5: form-specific tpl injection from form config
 *   - Added confidence-aware facts formatting (high/medium/low)
 *   - Added buildReviewMessages() for two-pass review workflow
 *
 * UPDATED (UI Upgrade):
 *   - Added assignmentMeta parameter to buildPromptMessages()
 *   - Block 5.7: assignment context injection (purpose, loan program, condition mode)
 *   - Loan program guidance: FHA, USDA, VA, Construction
 *   - Report condition mode guidance: Subject To Completion, Subject To Repairs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatExamplesBlock, formatVoiceExamplesBlock } from './retrieval.js';
import { getPhrases, getNarrativeTemplate } from './knowledgeBase.js';
import { getFormConfig } from '../forms/index.js';
import { LOCATION_CONTEXT_FIELDS } from './neighborhoodContext.js';
import { getFieldLabel, getPhraseTags } from './fieldRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

// â"€â"€ Load static prompt files once at module load â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function loadPromptFile(filename) {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim();
  } catch {
    return '';
  }
}

const SYSTEM_CACC  = loadPromptFile('system_cacc_writer.txt');
const STYLE_CRESCI = loadPromptFile('style_guide_cresci.txt');
const REVIEW_PASS  = loadPromptFile('review_pass.txt');

// â"€â"€ Field metadata resolution â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Canonical source: server/fieldRegistry.js (getFieldLabel / getPhraseTags).

function resolveFieldLabel(formType, fieldId) {
  return getFieldLabel(formType, fieldId) || fieldId;
}

function resolvePhraseTags(formType, fieldId) {
  return getPhraseTags(formType, fieldId) || [];
}

// â"€â"€ Confidence-aware facts formatter â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

/**
 * formatFactsBlock(facts)
 * Formats the facts object into a prompt-ready string with confidence annotations.
 *
 * Confidence rules:
 *   high   â†' state as fact (no annotation)
 *   medium â†' annotate with [confidence: medium â€" use hedged language]
 *   low    â†' replace value with [INSERT] and annotate
 *   null   â†' [INSERT] regardless of confidence
 */
function formatFactsBlock(facts) {
  if (!facts || !Object.keys(facts).length) return '';

  const lines = ['SUBJECT PROPERTY FACTS (use these; write [INSERT] where null or low-confidence):'];

  for (const [section, data] of Object.entries(facts)) {
    if (!data || typeof data !== 'object') continue;
    if (section === 'extractedAt' || section === 'updatedAt') continue;

    if (Array.isArray(data)) {
      const hasData = data.some(item =>
        Object.entries(item).some(([k, fobj]) => {
          if (k === 'number') return false;
          const v = fobj?.value ?? fobj;
          return v != null && v !== '';
        })
      );
      if (!hasData) continue;

      lines.push(`\n${section.toUpperCase()}:`);
      data.forEach((item, i) => {
        lines.push(`  Item ${i + 1}:`);
        Object.entries(item).forEach(([k, fobj]) => {
          if (k === 'number') return;
          const v = fobj?.value ?? fobj;
          const conf = fobj?.confidence || (typeof fobj === 'string' || typeof fobj === 'number' ? 'high' : 'low');
          if (v == null || v === '') return;
          if (conf === 'high') {
            lines.push(`    ${k}: ${v}`);
          } else if (conf === 'medium') {
            lines.push(`    ${k}: ${v} [confidence: medium â€" use hedged language]`);
          } else {
            lines.push(`    ${k}: [INSERT] [confidence: low â€" do not state as fact]`);
          }
        });
      });
    } else {
      const vals = Object.entries(data).filter(([, fobj]) => {
        const v = fobj?.value ?? fobj;
        return v != null && v !== '';
      });
      if (!vals.length) continue;

      lines.push(`\n${section.toUpperCase()}:`);
      vals.forEach(([k, fobj]) => {
        const v = fobj?.value ?? fobj;
        // If no confidence annotation, trust the value (default high)
        const conf = fobj?.confidence || (typeof fobj === 'string' || typeof fobj === 'number' ? 'high' : 'low');
        if (conf === 'high') {
          lines.push(`  ${k}: ${v}`);
        } else if (conf === 'medium') {
          lines.push(`  ${k}: ${v} [confidence: medium â€" use hedged language]`);
        } else {
          lines.push(`  ${k}: [INSERT] [confidence: low â€" do not state as fact]`);
        }
      });
    }
  }

  return lines.join('\n');
}

// â"€â"€ buildAssignmentContextBlock â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
/**
 * buildAssignmentContextBlock(assignmentMeta)
 *
 * Builds a system prompt block from assignment metadata.
 * Includes loan-program-specific and condition-mode-specific guidance
 * that affects compliance language and narrative framing.
 *
 * @param {object} assignmentMeta â€" compact meta object from buildAssignmentMetaBlock()
 * @returns {string|null} â€" formatted system block, or null if nothing useful
 */
function buildAssignmentContextBlock(assignmentMeta) {
  if (!assignmentMeta || typeof assignmentMeta !== 'object') return null;

  const lines = ['ASSIGNMENT CONTEXT (use this to frame the narrative appropriately):'];

  if (assignmentMeta.assignmentPurpose) lines.push(`Assignment Purpose: ${assignmentMeta.assignmentPurpose}`);
  if (assignmentMeta.loanProgram)       lines.push(`Loan Program: ${assignmentMeta.loanProgram}`);
  if (assignmentMeta.propertyType)      lines.push(`Property Type: ${assignmentMeta.propertyType}`);
  if (assignmentMeta.occupancyType)     lines.push(`Occupancy: ${assignmentMeta.occupancyType}`);
  if (assignmentMeta.reportConditionMode) lines.push(`Report Condition: ${assignmentMeta.reportConditionMode}`);
  if (assignmentMeta.county)            lines.push(`County: ${assignmentMeta.county}`);
  if (assignmentMeta.marketArea)        lines.push(`Market Area: ${assignmentMeta.marketArea}`);
  if (assignmentMeta.state)             lines.push(`State: ${assignmentMeta.state}`);
  if (assignmentMeta.clientName)        lines.push(`Client: ${assignmentMeta.clientName}`);
  if (assignmentMeta.lenderName)        lines.push(`Lender: ${assignmentMeta.lenderName}`);

  // Only add the header if we have at least one field
  if (lines.length === 1) return null;

  // â"€â"€ Loan program guidance â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const guidance = [];

  switch (assignmentMeta.loanProgram) {
    case 'FHA':
      guidance.push('FHA LOAN: Be aware of FHA minimum property standards (MPS). Note any conditions that may affect habitability, safety, or soundness. Avoid language that implies the property fails MPS unless explicitly supported by facts.');
      guidance.push('FHA LOAN: For site comments, note well/septic status if applicable. For improvements, note any deferred maintenance or health/safety items if present in facts.');
      break;
    case 'USDA':
      guidance.push('USDA LOAN: This is a rural/suburban property. Emphasize location characteristics consistent with USDA rural eligibility. Avoid urban-centric language.');
      guidance.push('USDA LOAN: Note utility availability and rural service characteristics where relevant.');
      break;
    case 'VA':
      guidance.push('VA LOAN: Be aware of VA Minimum Property Requirements (MPRs). Note any conditions affecting safety, structural soundness, or sanitation if present in facts.');
      guidance.push('VA LOAN: Avoid speculative language about property condition. Use only supported facts.');
      break;
    case 'Construction':
      guidance.push('CONSTRUCTION LOAN: This is a new construction or proposed improvement assignment. Use future-tense or hypothetical framing where appropriate.');
      guidance.push('CONSTRUCTION LOAN: Reference plans and specifications as the basis for the subject description where applicable.');
      break;
  }

  // â"€â"€ Report condition mode guidance â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  switch (assignmentMeta.reportConditionMode) {
    case 'Subject To Completion':
      guidance.push('SUBJECT TO COMPLETION: This appraisal is made subject to completion per plans and specifications. Frame improvements description in proposed/future tense. Note the hypothetical condition that the improvements are complete as of the effective date.');
      break;
    case 'Subject To Repairs':
      guidance.push('SUBJECT TO REPAIRS: This appraisal is made subject to specific repairs or alterations. Note the extraordinary assumption or hypothetical condition that the repairs are complete. Do not describe the property as if repairs are already done unless explicitly stated in facts.');
      break;
    case 'Subject As Complete per Plans/Specs':
      guidance.push('SUBJECT AS COMPLETE: Appraise as if complete per plans and specifications. Use proposed improvement language. Reference the hypothetical condition.');
      break;
  }

  // â"€â"€ Assignment purpose guidance â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (assignmentMeta.assignmentPurpose === 'Refinance') {
    guidance.push('REFINANCE: Avoid sale-centric commentary. Do not reference a purchase contract or buyer/seller dynamics unless explicitly in the facts. Focus on current market value support.');
  }

  // â"€â"€ Subject condition guidance (UAD C1â€"C6) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Primary: load from 1004Narratives.json UAD templates.
  // Fallback: inline guidance if template file not available.
  if (assignmentMeta.subjectCondition) {
    const condKey = String(assignmentMeta.subjectCondition).toUpperCase().trim();
    const tpl = getNarrativeTemplate('1004', 'condition', condKey);
    if (tpl?.promptInstruction) {
      guidance.push(`SUBJECT CONDITION ${condKey} (UAD): ${tpl.promptInstruction}`);
    } else {
      // Inline fallback for all UAD condition ratings
      const CONDITION_FALLBACK = {
        C1: 'SUBJECT CONDITION C1: The subject is newly constructed with no prior occupancy. All components are new. No physical depreciation. Use new construction language throughout.',
        C2: 'SUBJECT CONDITION C2: The subject is near-new or recently fully renovated. No deferred maintenance. All components updated to current standards. Minimal physical depreciation.',
        C3: 'SUBJECT CONDITION C3: The subject is well maintained with limited physical depreciation from normal wear and tear. Some components may be updated. Do not overstate condition issues â€" this is average-to-good condition.',
        C4: 'SUBJECT CONDITION C4: The subject has some deferred maintenance and physical deterioration from normal wear and tear. Adequately maintained. Minimal repairs needed. All major components are functionally adequate. Use measured, factual language.',
        C5: 'SUBJECT CONDITION C5: The subject has obvious deferred maintenance requiring significant repairs. Some building components need repair, rehabilitation, or updating. Functional utility is somewhat diminished but the dwelling remains useable.',
        C6: 'SUBJECT CONDITION C6: The subject has substantial damage or deferred maintenance affecting safety, soundness, or structural integrity. Substantial repairs and rehabilitation needed. Use careful, factual language â€" do not speculate beyond the facts.',
      };
      if (CONDITION_FALLBACK[condKey]) {
        guidance.push(CONDITION_FALLBACK[condKey]);
      }
    }
  }

  if (guidance.length > 0) {
    lines.push('');
    lines.push('GENERATION GUIDANCE:');
    guidance.forEach(g => lines.push('- ' + g));
  }

  return lines.join('\n');
}

// â"€â"€ Main export: buildPromptMessages â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

/**
 * buildPromptMessages(params)
 *
 * Builds the full messages array for a single section generation call.
 *
 * @param {object} params
 *   @param {string}   params.formType         e.g. '1004'
 *   @param {string}   params.fieldId          e.g. 'neighborhood_description'
 *   @param {string}   [params.propertyType]   e.g. 'residential'
 *   @param {string}   [params.marketType]     e.g. 'suburban'
 *   @param {string}   [params.marketArea]     e.g. 'Bloomington-Normal, IL'
 *   @param {object}   [params.facts]          Extracted property facts object
 *   @param {object[]} [params.voiceExamples]  Appraiser's own approved narratives (Block 3a)
 *                                             From getRelevantExamplesWithVoice().voiceExamples
 *   @param {object[]} [params.examples]       Other examples: approved_edits/curated/imported (Block 3b)
 *                                             From getRelevantExamplesWithVoice().otherExamples
 *                                             Also accepts flat array from getRelevantExamples() (backward compat)
 *   @param {string}   [params.locationContext] Pre-formatted location context string
 *   @param {object}   [params.assignmentMeta]  Assignment context object
 *   @param {string}   [params.systemHint]      Additional system instruction from generator profile
 *   @param {string}   [params.extraContext]    Pre-computed analysis context (artifacts + prior sections)
 *
 * @returns {Array<{role: string, content: string}>}
 */
export function buildPromptMessages({
  formType = '1004',
  fieldId,
  propertyType = 'residential',
  marketType = 'suburban',
  marketArea = '',
  facts = {},
  voiceExamples = [],      // Block 3a: appraiser's own approved narratives (highest priority)
  examples = [],           // Block 3b: other examples (approved_edits, curated, imported)
  locationContext = null,  // string from formatLocationContextBlock() â€" injected for neighborhood fields
  assignmentMeta = null,   // object from buildAssignmentMetaBlock() â€" assignment context
  systemHint    = null,    // string from generator profile â€" additional system instruction
  extraContext  = null,    // string â€" pre-computed analysis artifacts + prior section context
}) {
  const messages = [];

  // Pre-substitute boundary road facts so AI never sees [INSERT NORTH_BOUNDARY].
  // The AI pattern-matches [INSERT X] and outputs it even when told not to.
  // Replace placeholders with real values before the AI sees the location context.
  let resolvedLocationContext = locationContext;
  if (resolvedLocationContext && facts) {
    // Check both nested (facts.neighborhood.*) and flat top-level (facts.neighborhood_boundary_*) formats
    const nb = facts.neighborhood || {};
    const getV = (key) => { const e = nb[key]; if (!e) return null; return typeof e === 'object' ? (e.value || null) : String(e); };
    const getFlat = (key) => { const e = facts[key]; if (!e) return null; return typeof e === 'object' ? (e.value || null) : String(e); };
    const north = getV('NORTH_BOUNDARY') || getV('boundary_north') || getFlat('neighborhood_boundary_north');
    const south = getV('SOUTH_BOUNDARY') || getV('boundary_south') || getFlat('neighborhood_boundary_south');
    const east  = getV('EAST_BOUNDARY')  || getV('boundary_east')  || getFlat('neighborhood_boundary_east');
    const west  = getV('WEST_BOUNDARY')  || getV('boundary_west')  || getFlat('neighborhood_boundary_west');
    if (north) resolvedLocationContext = resolvedLocationContext.replace(/\[INSERT north road\]/gi, north);
    if (south) resolvedLocationContext = resolvedLocationContext.replace(/\[INSERT south road\]/gi, south);
    if (east)  resolvedLocationContext = resolvedLocationContext.replace(/\[INSERT east road\]/gi,  east);
    if (west)  resolvedLocationContext = resolvedLocationContext.replace(/\[INSERT west road\]/gi,  west);
    locationContext = resolvedLocationContext;
  }

  // â"€â"€ Block 1: Appraisal Agent system instructions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (SYSTEM_CACC) {
    messages.push({ role: 'system', content: SYSTEM_CACC });
  }

  // â"€â"€ Block 2: Cresci style guide â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (STYLE_CRESCI) {
    messages.push({ role: 'system', content: STYLE_CRESCI });
  }

  // â"€â"€ Block 3a: Voice examples â€" appraiser's own approved narratives â"€â"€â"€â"€â"€â"€â"€â"€
  // PRIMARY style reference. Labeled distinctly so the AI prioritizes these.
  // Source: knowledge_base/approvedNarratives/ via getRelevantExamplesWithVoice()
  const voiceBlock = formatVoiceExamplesBlock(voiceExamples);
  if (voiceBlock) {
    messages.push({ role: 'system', content: voiceBlock });
  }

  // â"€â"€ Block 3b: Other examples â€" approved_edits, curated, imported â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Supplemental style reference. Lower priority than voice examples.
  // Source: knowledge_base/approved_edits/ + curated_examples/ + imported
  const examplesBlock = formatExamplesBlock(examples);
  if (examplesBlock) {
    messages.push({ role: 'system', content: examplesBlock });
  }

  // â"€â"€ Block 4: Relevant phrase bank entries â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Registry-first: resolvePhraseTags() tries fieldRegistry.js, falls back to FIELD_PHRASE_TAGS
  const phraseTags = resolvePhraseTags(formType, fieldId);
  const relevantPhrases = phraseTags.flatMap(tag => getPhrases(tag));
  if (relevantPhrases.length > 0) {
    const phraseLines = ['APPROVED PHRASES (use these exact clauses where applicable):'];
    relevantPhrases.forEach(p => {
      phraseLines.push(`\n[${p.context}]`);
      phraseLines.push(p.text);
    });
    messages.push({ role: 'system', content: phraseLines.join('\n') });
  }

  // â"€â"€ Block 5: Facts context (confidence-aware) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const factsBlock = formatFactsBlock(facts);
  if (factsBlock) {
    messages.push({ role: 'system', content: factsBlock });
  }

  // â"€â"€ Block 5.5: Location context (neighborhood/boundary fields only) â"€â"€â"€â"€â"€â"€â"€
  // Injected when the field benefits from geographic data (roads, land use, water features).
  // locationContext is a pre-formatted string from formatLocationContextBlock().
  if (locationContext && LOCATION_CONTEXT_FIELDS.has(fieldId)) {
    messages.push({ role: 'system', content: locationContext });
  }

  // â"€â"€ Block 5.7: Assignment context (purpose, loan program, condition mode) â"€
  // Injected when assignmentMeta is provided. Affects compliance language,
  // condition mode framing, and loan-program-specific requirements.
  if (assignmentMeta && typeof assignmentMeta === 'object') {
    const block = buildAssignmentContextBlock(assignmentMeta);
    if (block) {
      messages.push({ role: 'system', content: block });
    }
  }

  // â"€â"€ Block 5.8: Generator profile system hint â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Additional system-level instruction from the generator profile.
  // Injected after assignment context so it takes precedence over generic guidance.
  if (systemHint) {
    messages.push({ role: 'system', content: `GENERATION PROFILE GUIDANCE:\n${systemHint}` });
  }

  // â"€â"€ Block 5.9: Extra context (analysis artifacts + prior sections) â"€â"€â"€â"€â"€â"€â"€â"€
  // Pre-computed analysis results and prior section text for synthesis sections.
  // Injected just before form-specific instructions so it's close to the user request.
  if (extraContext) {
    messages.push({ role: 'system', content: `ANALYSIS CONTEXT (pre-computed for this section):\n${extraContext}` });
  }

  // â"€â"€ Block 3.5: Form-specific field instructions (from form config tpl) â"€â"€â"€â"€
  // Numbered 3.5 but placed after facts so the AI sees instructions last before the request
  try {
    const formConfig = getFormConfig(formType);
    if (formConfig?.fields) {
      const fieldDef = formConfig.fields.find(f => f.id === fieldId);
      if (fieldDef?.tpl) {
        messages.push({
          role: 'system',
          content: 'FIELD-SPECIFIC INSTRUCTIONS (follow these exactly):\n' + fieldDef.tpl,
        });
      }
    }
  } catch { /* non-fatal â€" form config lookup failure should not break generation */ }

  // â"€â"€ Block 6: User request â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Registry-first: resolveFieldLabel() tries fieldRegistry.js, falls back to FIELD_LABELS
  const fieldLabel = resolveFieldLabel(formType, fieldId);
  const userLines = [
    `Write the ${fieldLabel} section for a ${formType} appraisal report.`,
  ];
  if (marketArea)   userLines.push(`Market area: ${marketArea}`);
  if (propertyType) userLines.push(`Property type: ${propertyType}`);
  if (marketType)   userLines.push(`Market type: ${marketType}`);
  userLines.push('');
  userLines.push('GENERATION REQUIREMENTS (all are mandatory):');
  userLines.push('');
  userLines.push('CONTENT:');
  userLines.push('- Use ONLY facts provided in the facts block above. Write [INSERT fieldname] for any missing data.');
  userLines.push('- Never fabricate statistics, market data, comparable sales, zoning, flood zones, or measurements.');
  userLines.push('- Prefer language from the Common Narratives library and phrase bank entries provided above.');
  userLines.push('- AI generation fills contextual connections only â€" do not invent facts or conclusions.');
  userLines.push('');
  userLines.push('TONE AND STYLE:');
  userLines.push('- Professional lender-ready tone: concise, formal, objective, analytical, neutral.');
  userLines.push('- No conversational language, speculative language, or marketing-style language.');
  userLines.push('- No first-person language ("I believe", "I found", "I think").');
  userLines.push('- Paragraph format. No bullet points unless the field specifically requires them.');
  userLines.push('- Do not include a section heading or title in your response.');
  userLines.push('');
  userLines.push('USPAP AND COMPLIANCE:');
  userLines.push('- Do not imply analyses were performed that were not actually performed.');
  userLines.push('  WRONG: "Extensive analysis confirmsâ€¦"  RIGHT: "The available data suggestsâ€¦"');
  userLines.push('- Use conditional language where support is limited: "The available market data indicatesâ€¦", "The property appears to beâ€¦", "Based on available informationâ€¦"');
  userLines.push('- Do not write engineering, environmental, or legal conclusions.');
  userLines.push('  Use: "No adverse conditions were observedâ€¦" not "The structure is sound."');
  userLines.push('- Do not write language that implies a predetermined value conclusion.');
  userLines.push('- Clearly separate facts from appraiser opinion. Use "In the appraiser\'s opinionâ€¦" for value judgments.');
  userLines.push('');
  userLines.push('QUALITY TARGET: The output must be text that could appear in a professional appraisal report submitted to a lender.');

  messages.push({ role: 'user', content: userLines.join('\n') });

  return messages;
}

// â"€â"€ buildReviewMessages â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

/**
 * buildReviewMessages(params)
 *
 * Builds the messages array for the two-pass review step.
 * The reviewer checks the draft for unsupported claims, tone issues,
 * missing placeholders, and USPAP compliance.
 *
 * @param {object} params
 *   @param {string} params.draftText       The draft narrative to review
 *   @param {object} [params.facts]         Case facts (so reviewer knows what's supported)
 *   @param {string} [params.fieldId]       Field being reviewed
 *   @param {string} [params.formType]      Form type
 *   @param {object} [params.assignmentMeta] Assignment context (loan program, condition mode)
 *   @param {string} [params.locationContext] Location context string
 *
 * @returns {Array<{role: string, content: string}>}
 */
export function buildReviewMessages({ draftText, facts = {}, fieldId = '', formType = '1004', assignmentMeta = null, locationContext = null }) {
  const messages = [];

  // Block 1: Review system prompt
  if (REVIEW_PASS) {
    messages.push({ role: 'system', content: REVIEW_PASS });
  } else {
    // Inline fallback if review_pass.txt not found â€" mirrors the full review_pass.txt checklist
    messages.push({
      role: 'system',
      content: `You are a senior appraisal reviewer for Appraisal Agent, assisting Charles Cresci of Cresci Appraisal & Consulting Company in Illinois.

Review the draft appraisal narrative for ALL of the following issues. This output will be submitted in a real lender appraisal report.

REVIEW CHECKLIST:
1. UNSUPPORTED CLAIMS (critical) â€" any fact stated as certain not in the SUPPORTED FACTS list. Replace with [INSERT fieldname].
2. CONFIDENCE VIOLATIONS (critical) â€" facts marked [confidence: low] stated as certain. Replace with [INSERT] or hedged language.
3. PLACEHOLDER COMPLETENESS (major) â€" verify [INSERT] placeholders are appropriate; flag any that should be filled from facts.
4. TONE AND STYLE (minor-major) â€" flag and correct: speculation, chatbot phrasing, first-person ("I believe/found/think"), future tense where present is appropriate, conversational language, exaggerated market claims.
5. USPAP COMPLIANCE (critical) â€" flag: unsupported conclusions stated as fact, predetermined value language, advocacy language, claims of analyses not performed. WRONG: "Extensive analysis confirmsâ€¦" RIGHT: "The available data suggestsâ€¦"
6. LANGUAGE SAFETY (critical) â€" flag and correct engineering conclusions ("The structure is sound"), environmental conclusions ("No environmental hazards exist"), legal conclusions ("The property complies with all codes"). Replace with: "No adverse conditions were observedâ€¦" or "The appraiser is not qualified to determineâ€¦"
7. ILLINOIS STANDARDS (major) â€" ensure consistency with Illinois appraisal practice and IDPFR requirements.
8. INTERNAL CONTRADICTIONS (major) â€" flag statements contradicting each other or the supported facts.
9. SECTION PURPOSE (major) â€" verify the narrative answers the intended question for this section.

QUALITY TARGET: The revisedText must pass lender underwriting review, appraisal quality control review, and peer appraisal review.

Return JSON only:
{
  "revisedText": "<the corrected narrative â€" same field, same purpose, improved accuracy and tone>",
  "issues": [{"type": "unsupported_claim|missing_fact|confidence_violation|tone|uspap|language_safety|illinois_standards|contradiction|placeholder|section_purpose", "description": "...", "severity": "critical|major|minor"}],
  "confidence": "high|medium|low",
  "changesMade": true|false
}`,
    });
  }

  // Block 2: Supported facts context (only high/medium confidence facts)
  const supportedFacts = [];
  for (const [section, data] of Object.entries(facts)) {
    if (!data || typeof data !== 'object' || section === 'extractedAt' || section === 'updatedAt') continue;
    if (Array.isArray(data)) continue;
    const vals = Object.entries(data).filter(([, fobj]) => {
      const v = fobj?.value ?? fobj;
      const conf = fobj?.confidence || (typeof fobj === 'string' || typeof fobj === 'number' ? 'high' : 'low');
      return v != null && v !== '' && conf !== 'low';
    });
    if (!vals.length) continue;
    supportedFacts.push(`${section.toUpperCase()}:`);
    vals.forEach(([k, fobj]) => {
      supportedFacts.push(`  ${k}: ${fobj?.value ?? fobj}`);
    });
  }

  if (supportedFacts.length > 0) {
    messages.push({
      role: 'system',
      content: 'SUPPORTED FACTS (only these facts are confirmed in this report â€" anything else is unsupported):\n\n' + supportedFacts.join('\n'),
    });
  }

  // Block 2.5: Assignment context (so reviewer can check compliance language)
  if (assignmentMeta && typeof assignmentMeta === 'object') {
    const block = buildAssignmentContextBlock(assignmentMeta);
    if (block) {
      messages.push({ role: 'system', content: block });
    }
  }

  // Block 2.7: Location context (so reviewer can verify geographic claims)
  if (locationContext && LOCATION_CONTEXT_FIELDS.has(fieldId)) {
    messages.push({ role: 'system', content: locationContext });
  }

  // Block 3: The draft to review
  const fieldLabel = resolveFieldLabel(formType, fieldId);
  messages.push({
    role: 'user',
    content: `Review this ${fieldLabel} draft for a ${formType} appraisal report:\n\n${draftText}\n\nReturn JSON only as specified in your instructions.`,
  });

  return messages;
}

// â"€â"€ buildApproveEditPrompt â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

/**
 * buildApproveEditPrompt(original, edited)
 *
 * Builds a prompt to score the quality of an approved edit.
 * Used when saving an approved edit to tag it with a quality score.
 *
 * @param {string} original
 * @param {string} edited
 * @returns {Array<{role, content}>}
 */
export function buildApproveEditPrompt(original, edited) {
  return [
    {
      role: 'system',
      content: 'You are a quality assessor for appraisal narrative edits. Respond with JSON only.',
    },
    {
      role: 'user',
      content: [
        'Rate the quality of this edited appraisal narrative on a scale of 0-100.',
        'Consider: accuracy, USPAP compliance, professional tone, conciseness.',
        '',
        'ORIGINAL:',
        original,
        '',
        'EDITED:',
        edited,
        '',
        'Return JSON: {"qualityScore": <number>, "tags": [<string>, ...], "summary": "<one sentence>"}',
      ].join('\n'),
    },
  ];
}

