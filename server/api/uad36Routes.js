/**
 * server/api/uad36Routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * UAD 3.6 / Redesigned URAR API Routes
 *
 * Mounted at /api in cacc-writer-server.js
 *
 * Endpoints:
 *   GET  /cases/:caseId/uad36-status           — UAD 3.6 completion & compliance check
 *   POST /cases/:caseId/convert-to-uad36        — Map legacy outputs → UAD 3.6 sections
 *   POST /cases/:caseId/generate-uad36          — Generate all UAD 3.6 narrative sections
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { resolveCaseDir } from '../utils/caseUtils.js';
import { readJSON } from '../utils/fileUtils.js';
import { callAI } from '../openaiClient.js';
import { buildPromptMessages } from '../promptBuilder.js';
import log from '../logger.js';
import {
  UAD36_SECTIONS,
  UAD36_NARRATIVE_SECTIONS,
  UAD36_NEW_SECTIONS,
  UAD36_REQUIRED_NARRATIVE_SECTIONS,
  LEGACY_TO_UAD36_MAP,
  getUad36Section,
} from '../config/uad36FormConfig.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load case data from disk.
 */
function loadCase(caseDir, dbCaseId) {
  const facts   = readJSON(path.join(caseDir, 'facts.json'), {});
  const meta    = readJSON(path.join(caseDir, 'meta.json'), {});
  let outputs = readJSON(path.join(caseDir, 'outputs.json'), {});
  // Also check DB for outputs (generate-all saves to DB, not always to file)
  if (dbCaseId && Object.keys(outputs).filter(k => k !== 'updatedAt').length === 0) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT outputs FROM case_records WHERE caseId = ?').get(dbCaseId);
      if (row?.outputs) {
        const dbOut = typeof row.outputs === 'string' ? JSON.parse(row.outputs) : row.outputs;
        outputs = { ...outputs, ...dbOut };
      }
    } catch { /* ok */ }
  }
  // Also map legacy section IDs to UAD 3.6 IDs in the outputs
  for (const [legacyId, uad36Id] of Object.entries(LEGACY_TO_UAD36_MAP)) {
    if (outputs[legacyId] && !outputs[uad36Id]) {
      const val = outputs[legacyId];
      outputs[uad36Id] = typeof val === 'string' ? val : val?.text || val;
    }
  }
  return { facts, meta, outputs };
}

/**
 * Save outputs.json atomically.
 */
function saveOutputs(caseDir, outputs) {
  const filePath = path.join(caseDir, 'outputs.json');
  fs.writeFileSync(filePath, JSON.stringify(outputs, null, 2), 'utf8');
}

/**
 * Determine if a UAD 3.6 section has usable content in the outputs map.
 */
function sectionHasContent(outputs, sectionId) {
  const entry = outputs[sectionId];
  if (!entry) return false;
  const text = entry.text || entry.final_text || entry.reviewed_text || entry.draft_text || '';
  return text.trim().length > 20;
}

/**
 * Build a concise property context string for prompts.
 */
function buildPropertyContext(facts) {
  const s = facts.subject || facts.property || {};
  const i = facts.improvements || {};
  const site = facts.site || {};
  const parts = [];
  if (s.address || s.streetAddress) parts.push(`Address: ${s.address || s.streetAddress}`);
  if (s.city) parts.push(`City: ${s.city}, ${s.state || ''} ${s.zip || ''}`);
  if (i.yearBuilt) parts.push(`Year Built: ${i.yearBuilt}`);
  if (i.gla) parts.push(`GLA: ${i.gla} SF`);
  if (i.bedrooms) parts.push(`Bedrooms: ${i.bedrooms}`);
  if (i.bathrooms) parts.push(`Bathrooms: ${i.bathrooms}`);
  if (i.condition) parts.push(`Condition: ${i.condition}`);
  if (i.quality) parts.push(`Quality: ${i.quality}`);
  if (site.zoning) parts.push(`Zoning: ${site.zoning}`);
  return parts.join(' | ') || 'Residential property';
}

// ── GET /cases/:caseId/uad36-status ──────────────────────────────────────────

router.get('/cases/:caseId/uad36-status', (req, res) => {
  const caseDir = resolveCaseDir(req.params.caseId);
  if (!caseDir) {
    return res.status(400).json({ error: 'Invalid case ID' });
  }

  try {
    const { facts, meta, outputs } = loadCase(caseDir, req.params.caseId);

    // Check each UAD 3.6 section
    const sectionStatus = {};
    const completedSections = [];
    const missingSections = [];
    const complianceIssues = [];

    for (const section of UAD36_SECTIONS) {
      // Non-narrative/non-data_narrative sections (pure data, grid, photos) are
      // not tracked in outputs.json — mark as N/A for narrative tracking
      if (section.type === 'data' || section.type === 'grid' || section.type === 'photos') {
        sectionStatus[section.id] = { status: 'not_tracked', type: section.type };
        continue;
      }

      const hasContent = sectionHasContent(outputs, section.id);
      const entry = outputs[section.id] || {};
      const approved = entry.approved || false;

      sectionStatus[section.id] = {
        status: hasContent ? (approved ? 'approved' : 'draft') : 'missing',
        type: section.type,
        required: section.required,
        hasContent,
        approved,
        isNew: section.legacyId === null,
      };

      if (hasContent) {
        completedSections.push(section.id);
      } else {
        missingSections.push(section.id);
        if (section.required) {
          complianceIssues.push({
            sectionId: section.id,
            title: section.title,
            severity: 'error',
            message: `Required section "${section.title}" has no content`,
          });
        }
      }
    }

    const narrativeSections = UAD36_NARRATIVE_SECTIONS.map(s => s.id);
    const completedNarrative = completedSections.filter(id => narrativeSections.includes(id));
    const coveragePct = narrativeSections.length > 0
      ? Math.round((completedNarrative.length / narrativeSections.length) * 100)
      : 0;

    // New UAD 3.6 sections that have no legacy content
    const newSectionsStatus = UAD36_NEW_SECTIONS.map(s => ({
      id: s.id,
      title: s.title,
      type: s.type,
      hasContent: sectionHasContent(outputs, s.id),
    }));

    return res.json({
      caseId: req.params.caseId,
      formType: meta.formType || '1004',
      uad36Coverage: `${coveragePct}%`,
      coveragePct,
      totalNarrativeSections: narrativeSections.length,
      completedNarrativeSections: completedNarrative.length,
      missingSections,
      complianceIssues,
      sectionStatus,
      newSectionsStatus,
      compliant: complianceIssues.length === 0,
      readyForMandatoryDate: coveragePct === 100 && complianceIssues.length === 0,
      mandatoryDate: '2026-11-02',
    });
  } catch (err) {
    log.error('[uad36Routes] uad36-status error', { caseId: req.params.caseId, err: err.message });
    return res.status(500).json({ error: 'Failed to check UAD 3.6 status', details: err.message });
  }
});

// ── POST /cases/:caseId/convert-to-uad36 ─────────────────────────────────────

router.post('/cases/:caseId/convert-to-uad36', (req, res) => {
  const caseDir = resolveCaseDir(req.params.caseId);
  if (!caseDir) {
    return res.status(400).json({ error: 'Invalid case ID' });
  }

  try {
    const { facts, meta, outputs } = loadCase(caseDir, req.params.caseId);

    const converted = {};    // sectionId → carried-over text
    const alreadyPresent = []; // sectionIds that already have UAD 3.6 content
    const missing = [];      // UAD 3.6 sections with no content after conversion

    // Step 1: Carry over legacy content using the mapping
    for (const [legacyId, uad36Id] of Object.entries(LEGACY_TO_UAD36_MAP)) {
      const legacyEntry = outputs[legacyId];
      if (!legacyEntry) continue;

      const text = legacyEntry.text || legacyEntry.final_text || legacyEntry.reviewed_text || '';
      if (!text.trim()) continue;

      // If the UAD 3.6 section already has content from a direct match, skip merge
      if (converted[uad36Id]) {
        // Append additional content if from a different legacy section
        if (legacyId !== uad36Id) {
          converted[uad36Id] += '\n\n' + text.trim();
        }
      } else {
        converted[uad36Id] = text.trim();
      }
    }

    // Step 2: Also check if any outputs already use UAD 3.6 section IDs directly
    for (const section of UAD36_NARRATIVE_SECTIONS) {
      if (sectionHasContent(outputs, section.id)) {
        alreadyPresent.push(section.id);
      }
    }

    // Step 3: Write converted content into outputs.json for UAD 3.6 sections
    const updatedOutputs = { ...outputs };
    const now = new Date().toISOString();

    for (const [uad36Id, text] of Object.entries(converted)) {
      if (!alreadyPresent.includes(uad36Id)) {
        updatedOutputs[uad36Id] = {
          text,
          title: getUad36Section(uad36Id)?.title || uad36Id,
          sectionStatus: 'converted_from_legacy',
          uad36: true,
          generatedAt: now,
          approved: false,
        };
      }
    }
    updatedOutputs.updatedAt = now;
    saveOutputs(caseDir, updatedOutputs);

    // Step 4: Identify which UAD 3.6 narrative sections still have no content
    for (const section of UAD36_NARRATIVE_SECTIONS) {
      const inConverted = section.id in converted;
      const inAlreadyPresent = alreadyPresent.includes(section.id);
      if (!inConverted && !inAlreadyPresent) {
        missing.push(section.id);
      }
    }

    const totalNarrative = UAD36_NARRATIVE_SECTIONS.length;
    const coveredCount = Object.keys(converted).length + alreadyPresent.filter(id => !converted[id]).length;
    const coveragePct = Math.round((coveredCount / totalNarrative) * 100);

    log.info('[uad36Routes] convert-to-uad36 complete', {
      caseId: req.params.caseId,
      converted: Object.keys(converted).length,
      alreadyPresent: alreadyPresent.length,
      missing: missing.length,
    });

    return res.json({
      success: true,
      caseId: req.params.caseId,
      converted,
      alreadyPresent,
      missing,
      coverage: `${coveragePct}%`,
      coveragePct,
      message: `Converted ${Object.keys(converted).length} legacy sections to UAD 3.6. ${missing.length} new sections require generation.`,
      newSectionsRequiringGeneration: UAD36_NEW_SECTIONS
        .filter(s => missing.includes(s.id))
        .map(s => ({ id: s.id, title: s.title, type: s.type })),
    });
  } catch (err) {
    log.error('[uad36Routes] convert-to-uad36 error', { caseId: req.params.caseId, err: err.message });
    return res.status(500).json({ error: 'Conversion failed', details: err.message });
  }
});

// ── POST /cases/:caseId/generate-uad36 ───────────────────────────────────────

router.post('/cases/:caseId/generate-uad36', async (req, res) => {
  const caseDir = resolveCaseDir(req.params.caseId);
  if (!caseDir) {
    return res.status(400).json({ error: 'Invalid case ID' });
  }

  const {
    sectionsToGenerate = null, // null = generate all missing; or array of section IDs
    forceRegenerate = false,   // if true, regenerate even if content exists
    streamProgress = false,    // future: SSE streaming
  } = req.body || {};

  try {
    const { facts, meta, outputs } = loadCase(caseDir, req.params.caseId);
    const propertyContext = buildPropertyContext(facts);
    const now = new Date().toISOString();

    // Determine which sections to generate
    let sectionsToProcess;
    if (sectionsToGenerate && Array.isArray(sectionsToGenerate)) {
      sectionsToProcess = UAD36_NARRATIVE_SECTIONS.filter(s => sectionsToGenerate.includes(s.id));
    } else {
      // Default: generate all that are missing (or all if forceRegenerate)
      sectionsToProcess = UAD36_NARRATIVE_SECTIONS.filter(s => {
        if (forceRegenerate) return true;
        return !sectionHasContent(outputs, s.id);
      });
    }

    if (sectionsToProcess.length === 0) {
      return res.json({
        success: true,
        message: 'All UAD 3.6 sections already have content. Use forceRegenerate: true to regenerate.',
        generated: {},
        skipped: UAD36_NARRATIVE_SECTIONS.map(s => s.id),
      });
    }

    log.info('[uad36Routes] generate-uad36 starting', {
      caseId: req.params.caseId,
      sectionsCount: sectionsToProcess.length,
    });

    const generated = {};
    const errors = {};
    const updatedOutputs = { ...outputs };

    for (const section of sectionsToProcess) {
      try {
        const prompt = buildUad36SectionPrompt(section, facts, propertyContext, outputs);
        const messages = [
          {
            role: 'system',
            content:
              'You are an expert real estate appraiser completing a UAD 3.6 Redesigned URAR ' +
              'appraisal report. Write professional, specific, compliant appraisal narrative ' +
              'text. Be factual, concise, and avoid generic boilerplate. ' +
              'UAD 3.6 is the new Fannie Mae/Freddie Mac universal residential appraisal form ' +
              'replacing legacy 1004/1025/1073 forms, effective November 2026.',
          },
          { role: 'user', content: prompt },
        ];

        const text = await callAI(messages, { temperature: 0.3, max_tokens: 800 });

        generated[section.id] = text;
        updatedOutputs[section.id] = {
          text,
          title: section.title,
          sectionStatus: 'generated',
          uad36: true,
          generatedAt: now,
          approved: false,
        };
      } catch (sectionErr) {
        log.warn('[uad36Routes] section generation failed', {
          sectionId: section.id,
          err: sectionErr.message,
        });
        errors[section.id] = sectionErr.message;
      }
    }

    updatedOutputs.updatedAt = now;
    saveOutputs(caseDir, updatedOutputs);

    // Final status check
    const totalNarrative = UAD36_NARRATIVE_SECTIONS.length;
    const nowComplete = UAD36_NARRATIVE_SECTIONS.filter(s => sectionHasContent(updatedOutputs, s.id)).length;
    const coveragePct = Math.round((nowComplete / totalNarrative) * 100);

    log.info('[uad36Routes] generate-uad36 complete', {
      caseId: req.params.caseId,
      generated: Object.keys(generated).length,
      errors: Object.keys(errors).length,
      coverage: `${coveragePct}%`,
    });

    return res.json({
      success: true,
      caseId: req.params.caseId,
      generated,
      errors,
      coverage: `${coveragePct}%`,
      coveragePct,
      completedSections: nowComplete,
      totalNarrativeSections: totalNarrative,
      message: `Generated ${Object.keys(generated).length} UAD 3.6 sections. Coverage: ${coveragePct}%.`,
    });
  } catch (err) {
    log.error('[uad36Routes] generate-uad36 error', { caseId: req.params.caseId, err: err.message });
    return res.status(500).json({ error: 'Generation failed', details: err.message });
  }
});

// ── Prompt Builder for UAD 3.6 Sections ──────────────────────────────────────

/**
 * Build a context-rich prompt for generating a specific UAD 3.6 section.
 */
function buildUad36SectionPrompt(section, facts, propertyContext, existingOutputs) {
  const lines = [];

  lines.push(`UAD 3.6 SECTION: ${section.title}`);
  lines.push(`Property: ${propertyContext}`);
  lines.push('');

  // Include relevant existing sections as context
  const contextSections = {
    neighborhood_description: ['neighborhood_characteristics'],
    market_conditions: ['neighborhood_description'],
    condition_description: ['improvements_description', 'neighborhood_description'],
    sales_comparison_narrative: ['market_conditions', 'reconciliation'],
    reconciliation: ['sales_comparison_narrative', 'market_conditions'],
    adu_description: [],
    energy_features: [],
    extraordinary_assumptions: ['scope_of_work', 'conditions_assumptions'],
    hypothetical_conditions: ['scope_of_work', 'conditions_assumptions'],
  };

  const relatedIds = contextSections[section.id] || [];
  for (const relId of relatedIds) {
    const entry = existingOutputs[relId];
    if (entry) {
      const text = entry.text || '';
      if (text.trim()) {
        const relSection = getUad36Section(relId);
        lines.push(`Context - ${relSection?.title || relId}:`);
        lines.push(text.substring(0, 300) + (text.length > 300 ? '...' : ''));
        lines.push('');
      }
    }
  }

  // Section-specific data
  const s = facts.subject || facts.property || {};
  const i = facts.improvements || {};
  const site = facts.site || {};
  const nbhd = facts.neighborhood || {};
  const green = facts.green || facts.greenFeatures || {};
  const adu = facts.adu || {};

  if (section.id === 'energy_features') {
    lines.push('Energy/Green Data:');
    if (green.solarPanels != null) lines.push(`- Solar Panels: ${green.solarPanels ? 'Yes' : 'No'}`);
    if (green.energyRating) lines.push(`- Energy Rating: ${green.energyRating}`);
    if (green.greenCertification) lines.push(`- Green Certification: ${green.greenCertification}`);
    if (!Object.keys(green).length) lines.push('- No green/energy data provided');
    lines.push('');
    lines.push(
      'Write the UAD 3.6 Energy Efficient Features section. If no special energy features are ' +
      'present, state that the subject does not have any notable energy efficient features beyond ' +
      'typical construction for the market. If features are present, describe them and briefly ' +
      'address their market impact.',
    );
  } else if (section.id === 'adu_description') {
    lines.push('ADU Data:');
    if (adu.present || adu.hasADU) {
      lines.push(`- ADU Present: Yes`);
      if (adu.type || adu.aduType) lines.push(`- Type: ${adu.type || adu.aduType}`);
      if (adu.gla || adu.aduGla) lines.push(`- GLA: ${adu.gla || adu.aduGla} SF`);
      if (adu.bedrooms || adu.aduBedrooms) lines.push(`- Bedrooms: ${adu.bedrooms || adu.aduBedrooms}`);
      if (adu.condition || adu.aduCondition) lines.push(`- Condition: ${adu.condition || adu.aduCondition}`);
    } else {
      lines.push('- No ADU data provided');
    }
    lines.push('');
    lines.push(
      'Write the UAD 3.6 ADU section. If no ADU is present, state: "No accessory dwelling unit ' +
      'was identified on the subject property." If an ADU is present, describe its characteristics, ' +
      'condition, and whether it contributes to market value.',
    );
  } else if (section.id === 'extraordinary_assumptions') {
    lines.push(
      'Write the Extraordinary Assumptions section for this UAD 3.6 report. ' +
      'If no extraordinary assumptions apply, state: "No extraordinary assumptions were made in ' +
      'the preparation of this appraisal." If assumptions were made, list each one clearly.',
    );
  } else if (section.id === 'hypothetical_conditions') {
    lines.push(
      'Write the Hypothetical Conditions section. ' +
      'If no hypothetical conditions apply, state: "This appraisal is not based upon any ' +
      'hypothetical conditions." If conditions exist, state each clearly.',
    );
  } else {
    // General section: use the section's defined prompt
    lines.push(section.prompt || `Write the "${section.title}" section for this UAD 3.6 appraisal report.`);
  }

  lines.push('');
  lines.push('Write professional appraisal narrative text only. Do not include headings, labels, or preamble.');

  return lines.join('\n');
}

export default router;
