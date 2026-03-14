import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { ensureServerRunning } from '../tests/helpers/serverHarness.mjs';
import { buildSimplePdf } from '../tests/helpers/simplePdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FIXTURES = [
  path.join(PROJECT_ROOT, 'fixtures', 'golden', '1004-case'),
  path.join(PROJECT_ROOT, 'fixtures', 'golden', 'commercial-case'),
];

function parseArgs(argv) {
  const options = {
    fixtures: [],
    allowDryRunInsertion: false,
    cleanup: false,
    baseUrl: process.env.GOLDEN_BASE_URL || `http://localhost:${process.env.PORT || 5178}`,
    autoStart: process.env.GOLDEN_AUTO_START !== '0',
    reportPath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixture') {
      options.fixtures.push(path.resolve(argv[++i]));
      continue;
    }
    if (arg === '--allow-dry-run-insertion') {
      options.allowDryRunInsertion = true;
      continue;
    }
    if (arg === '--cleanup') {
      options.cleanup = true;
      continue;
    }
    if (arg === '--base-url') {
      options.baseUrl = argv[++i];
      continue;
    }
    if (arg === '--no-auto-start') {
      options.autoStart = false;
      continue;
    }
    if (arg === '--report') {
      options.reportPath = path.resolve(argv[++i]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.fixtures.length) {
    options.fixtures = DEFAULT_FIXTURES;
  }

  return options;
}

function deepMerge(target, source) {
  if (Array.isArray(source)) {
    return source.map(item => (typeof item === 'object' && item !== null ? deepMerge({}, item) : item));
  }
  if (!source || typeof source !== 'object') return source;

  const base = target && typeof target === 'object' && !Array.isArray(target)
    ? { ...target }
    : {};

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      base[key] = value.map(item => (typeof item === 'object' && item !== null ? deepMerge({}, item) : item));
      continue;
    }
    if (value && typeof value === 'object') {
      base[key] = deepMerge(base[key], value);
      continue;
    }
    base[key] = value;
  }

  return base;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.slice(0, 110));
}

function matchesPattern(patterns, value) {
  return (patterns || []).some(pattern => {
    if (!pattern) return false;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1);
      return value.startsWith(prefix);
    }
    return value === pattern;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiJson(baseUrl, method, route, body = null, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, body: data };
  } finally {
    clearTimeout(timer);
  }
}

async function apiForm(baseUrl, route, formData, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + route, {
      method: 'POST',
      body: formData,
      signal: ctrl.signal,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, body: data };
  } finally {
    clearTimeout(timer);
  }
}

function failStep(step, message, payload = null) {
  const err = new Error(message);
  err.step = step;
  err.payload = payload;
  throw err;
}

async function runFixture(baseUrl, fixtureDir, options, capabilities) {
  const manifest = readJson(path.join(fixtureDir, 'manifest.json'));
  const fixtureLabel = manifest.name || path.basename(fixtureDir);
  const report = {
    fixture: fixtureLabel,
    fixtureDir,
    formType: manifest.formType,
    mode: options.allowDryRunInsertion ? 'preflight' : 'strict',
    status: 'running',
    caseId: null,
    generationRunId: null,
    qcRunId: null,
    insertionRunId: null,
    steps: [],
  };

  function recordStep(name, status, detail, extra = {}) {
    report.steps.push({
      name,
      status,
      detail,
      ...extra,
    });
  }

  let caseId = null;

  try {
    const createRes = await apiJson(baseUrl, 'POST', '/api/cases/create', manifest.createCase);
    if (createRes.status !== 200 || createRes.body?.ok !== true) {
      failStep('case_creation', 'Case creation failed', createRes.body);
    }
    caseId = createRes.body.caseId;
    report.caseId = caseId;
    recordStep('case_creation', 'passed', `Created case ${caseId}`);

    if (manifest.casePatch) {
      const patchRes = await apiJson(baseUrl, 'PATCH', `/api/cases/${caseId}`, manifest.casePatch);
      if (patchRes.status !== 200 || patchRes.body?.ok !== true) {
        failStep('case_patch', 'Case metadata patch failed', patchRes.body);
      }
      recordStep('case_patch', 'passed', 'Applied fixture assignment metadata');
    }

    const extractingRes = await apiJson(baseUrl, 'PATCH', `/api/cases/${caseId}/pipeline`, { stage: 'extracting' });
    if (extractingRes.status !== 200 || extractingRes.body?.ok !== true) {
      failStep('pipeline_extracting', 'Failed to advance pipeline to extracting', extractingRes.body);
    }
    recordStep('pipeline_extracting', 'passed', 'Pipeline moved to extracting');

    for (const document of (manifest.documents || [])) {
      const contentPath = path.join(fixtureDir, document.contentFile);
      const content = fs.readFileSync(contentPath, 'utf8');
      const pdf = buildSimplePdf(toLines(content));
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), document.filename);
      if (document.docTypeHint) form.append('docType', document.docTypeHint);

      const uploadRes = await apiForm(baseUrl, `/api/cases/${caseId}/documents/upload`, form, 45000);
      if (uploadRes.status !== 200 || uploadRes.body?.ok !== true) {
        failStep('document_upload', `Upload failed for ${document.filename}`, uploadRes.body);
      }
      recordStep('document_upload', 'passed', `${document.filename} -> ${uploadRes.body.docType}`);
    }

    const extractionSummary = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}/extraction-summary`);
    if (extractionSummary.status !== 200 || extractionSummary.body?.ok !== true) {
      failStep('extraction_summary', 'Failed to fetch extraction summary', extractionSummary.body);
    }
    recordStep('extraction_summary', 'passed', 'Loaded extraction summary');

    const extractedFactsRes = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}/extracted-facts`);
    if (extractedFactsRes.status !== 200 || extractedFactsRes.body?.ok !== true) {
      failStep('extracted_facts_load', 'Failed to load extracted facts', extractedFactsRes.body);
    }
    const extractedFacts = extractedFactsRes.body.facts || [];
    if (extractedFacts.length < (manifest.review?.minExtractedFacts || 1)) {
      failStep(
        'extracted_facts_load',
        `Expected at least ${manifest.review?.minExtractedFacts || 1} extracted fact(s), got ${extractedFacts.length}`,
        extractedFactsRes.body,
      );
    }

    const acceptedFacts = [];
    for (const fact of extractedFacts) {
      const action = matchesPattern(manifest.review?.acceptPaths || [], fact.fact_path) ? 'accepted' : 'rejected';
      const reviewRes = await apiJson(baseUrl, 'POST', `/api/cases/${caseId}/extracted-facts/review`, {
        factId: fact.id,
        action,
      });
      if (reviewRes.status !== 200 || reviewRes.body?.ok !== true) {
        failStep('fact_review', `Failed to ${action} fact ${fact.id}`, reviewRes.body);
      }
      if (action === 'accepted') acceptedFacts.push(fact);
    }

    if (acceptedFacts.length < (manifest.review?.minAcceptedFacts || 1)) {
      failStep(
        'fact_review',
        `Expected at least ${manifest.review?.minAcceptedFacts || 1} accepted fact(s), got ${acceptedFacts.length}`,
        { acceptedFacts: acceptedFacts.map(f => f.fact_path) },
      );
    }
    recordStep('fact_review', 'passed', `Accepted ${acceptedFacts.length} fact(s), rejected ${extractedFacts.length - acceptedFacts.length}`);

    const mergeRes = await apiJson(baseUrl, 'POST', `/api/cases/${caseId}/extracted-facts/merge`, {
      factIds: acceptedFacts.map(f => f.id),
    });
    if (mergeRes.status !== 200 || mergeRes.body?.ok !== true) {
      failStep('fact_merge', 'Failed to merge accepted facts', mergeRes.body);
    }
    recordStep('fact_merge', 'passed', `Merged ${mergeRes.body.merged || 0} fact(s)`);

    const extractedSources = {};
    for (const fact of acceptedFacts) {
      extractedSources[fact.fact_path] = {
        sourceType: 'document',
        sourceId: fact.original_filename || fact.document_id || 'fixture-document',
        docType: fact.doc_type || null,
        confidence: fact.confidence || 'medium',
        quote: fact.source_text || fact.sourceText || fact.fact_value || '',
        note: 'Golden-path accepted extracted fact',
      };
    }
    if (Object.keys(extractedSources).length) {
      const sourceRes = await apiJson(baseUrl, 'PUT', `/api/cases/${caseId}/fact-sources`, {
        sources: extractedSources,
      });
      if (sourceRes.status !== 200 || sourceRes.body?.ok !== true) {
        failStep('fact_provenance_extracted', 'Failed to save extracted fact provenance', sourceRes.body);
      }
    }
    recordStep('fact_provenance_extracted', 'passed', `Recorded provenance for ${Object.keys(extractedSources).length} extracted fact(s)`);

    const extractedSectionsRes = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}/extracted-sections`);
    if (extractedSectionsRes.status === 200 && extractedSectionsRes.body?.ok === true) {
      const sections = extractedSectionsRes.body.sections || [];
      for (const section of sections) {
        if (section.review_status === 'pending' && manifest.review?.rejectPendingSections !== false) {
          const rejectRes = await apiJson(baseUrl, 'POST', `/api/cases/${caseId}/extracted-sections/${section.id}/reject`, {});
          if (rejectRes.status !== 200 || rejectRes.body?.ok !== true) {
            failStep('section_review', `Failed to reject extracted section ${section.id}`, rejectRes.body);
          }
        }
      }
      recordStep('section_review', 'passed', `Reviewed ${sections.length} extracted section candidate(s)`);
    }

    const beforeManual = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}`);
    if (beforeManual.status !== 200 || beforeManual.body?.ok !== true) {
      failStep('workspace_load_initial', 'Failed to load case workspace', beforeManual.body);
    }
    recordStep('workspace_load_initial', 'passed', 'Loaded canonical case projection');

    if (manifest.manualFacts) {
      const mergedFacts = deepMerge(beforeManual.body.facts || {}, manifest.manualFacts);
      const saveFactsRes = await apiJson(baseUrl, 'PUT', `/api/cases/${caseId}/facts`, mergedFacts);
      if (saveFactsRes.status !== 200 || saveFactsRes.body?.ok !== true) {
        failStep('manual_facts', 'Failed to save fixture operator facts', saveFactsRes.body);
      }
      recordStep('manual_facts', 'passed', 'Applied explicit operator-entered fixture facts');
    }

    if (manifest.manualFactSources && Object.keys(manifest.manualFactSources).length) {
      const manualSourcesRes = await apiJson(baseUrl, 'PUT', `/api/cases/${caseId}/fact-sources`, {
        sources: manifest.manualFactSources,
      });
      if (manualSourcesRes.status !== 200 || manualSourcesRes.body?.ok !== true) {
        failStep('manual_fact_sources', 'Failed to save fixture operator provenance', manualSourcesRes.body);
      }
      recordStep('manual_fact_sources', 'passed', `Added ${Object.keys(manifest.manualFactSources).length} operator provenance link(s)`);
    }

    const generatingRes = await apiJson(baseUrl, 'PATCH', `/api/cases/${caseId}/pipeline`, { stage: 'generating' });
    if (generatingRes.status !== 200 || generatingRes.body?.ok !== true) {
      failStep('pipeline_generating', 'Failed to advance pipeline to generating', generatingRes.body);
    }
    recordStep('pipeline_generating', 'passed', 'Pipeline moved to generating');

    const gateRes = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}/pre-draft-check?formType=${encodeURIComponent(manifest.formType)}`);
    if (gateRes.status !== 200 || gateRes.body?.ok !== true) {
      failStep('pre_draft_gate', 'Failed to evaluate pre-draft gate', gateRes.body);
    }
    if (!gateRes.body.gate?.ok) {
      failStep('pre_draft_gate', 'Pre-draft gate blocked generation', gateRes.body.gate);
    }
    recordStep('pre_draft_gate', 'passed', 'Case is ready to generate with no blockers');

    const generationStart = await apiJson(baseUrl, 'POST', `/api/cases/${caseId}/generate-full-draft`, {
      formType: manifest.formType,
      options: manifest.generation?.options || {},
    }, 30000);
    if (generationStart.status !== 200 || generationStart.body?.ok !== true || !generationStart.body?.runId) {
      failStep('generation_start', 'Failed to start full-draft generation', generationStart.body);
    }
    const generationRunId = generationStart.body.runId;
    report.generationRunId = generationRunId;
    recordStep('generation_start', 'passed', `Started generation run ${generationRunId}`);

    const generationDeadline = Date.now() + (manifest.generation?.timeoutMs || 180000);
    let generationStatus = null;
    while (Date.now() < generationDeadline) {
      const statusRes = await apiJson(baseUrl, 'GET', `/api/generation/runs/${generationRunId}/status`, null, 15000);
      if (statusRes.status !== 200 || statusRes.body?.ok !== true) {
        failStep('generation_status', 'Failed to poll generation status', statusRes.body);
      }
      generationStatus = statusRes.body;
      if (['complete', 'partial_complete', 'failed'].includes(generationStatus.status)) break;
      await sleep(1500);
    }
    if (!generationStatus || !['complete', 'partial_complete'].includes(generationStatus.status)) {
      failStep('generation_status', `Generation did not complete successfully (status=${generationStatus?.status || 'timeout'})`, generationStatus);
    }

    const generationResult = await apiJson(baseUrl, 'GET', `/api/generation/runs/${generationRunId}/result`, null, 20000);
    if (generationResult.status !== 200 || generationResult.body?.ok !== true) {
      failStep('generation_result', 'Failed to load generation result', generationResult.body);
    }

    if (manifest.reviewedSections && Object.keys(manifest.reviewedSections).length) {
      for (const [sectionId, review] of Object.entries(manifest.reviewedSections)) {
        const reviewText = typeof review === 'string' ? review : review?.text;
        const sectionStatus = typeof review === 'object' && review?.sectionStatus
          ? review.sectionStatus
          : 'reviewed';
        const patchRes = await apiJson(baseUrl, 'PATCH', `/api/generation/runs/${generationRunId}/sections/${encodeURIComponent(sectionId)}`, {
          text: reviewText,
          sectionStatus,
        });
        if (patchRes.status !== 200 || patchRes.body?.ok !== true) {
          failStep('reviewed_sections', `Failed to persist reviewed section ${sectionId}`, patchRes.body);
        }
      }
      recordStep('reviewed_sections', 'passed', `Applied operator-reviewed text to ${Object.keys(manifest.reviewedSections).length} section(s)`);
    }

    const finalGenerationResult = manifest.reviewedSections && Object.keys(manifest.reviewedSections).length
      ? await apiJson(baseUrl, 'GET', `/api/generation/runs/${generationRunId}/result`, null, 20000)
      : generationResult;
    if (finalGenerationResult.status !== 200 || finalGenerationResult.body?.ok !== true) {
      failStep('generation_result', 'Failed to reload generation result after reviewed section updates', finalGenerationResult.body);
    }

    const sections = finalGenerationResult.body.sections || finalGenerationResult.body.draftPackage?.sections || {};
    const expectedSections = manifest.expectedSections || [];
    const missingSections = expectedSections.filter(sectionId => {
      const section = sections[sectionId];
      if (!section) return true;
      const text = typeof section === 'string' ? section : section.text;
      return !text || String(text).trim().length < 40;
    });
    if (missingSections.length) {
      failStep('generation_result', `Missing or thin generated sections: ${missingSections.join(', ')}`, {
        expectedSections,
        availableSections: Object.keys(sections),
      });
    }
    recordStep('generation_result', 'passed', `Generated ${Object.keys(sections).length} section(s)`);

    const reviewRes = await apiJson(baseUrl, 'PATCH', `/api/cases/${caseId}/pipeline`, { stage: 'review' });
    if (reviewRes.status !== 200 || reviewRes.body?.ok !== true) {
      failStep('pipeline_review', 'Failed to advance pipeline to review', reviewRes.body);
    }
    recordStep('pipeline_review', 'passed', 'Pipeline moved to review');

    const qcStart = await apiJson(baseUrl, 'POST', '/api/qc/run', {
      caseId,
      generationRunId,
    }, 60000);
    if (qcStart.status !== 200 || qcStart.body?.ok !== true || !qcStart.body?.qcRunId) {
      failStep('qc_run', 'QC run failed to start/complete', qcStart.body);
    }
    report.qcRunId = qcStart.body.qcRunId;
    const qcSummaryRes = await apiJson(baseUrl, 'GET', `/api/qc/runs/${qcStart.body.qcRunId}/summary`);
    if (qcSummaryRes.status !== 200 || qcSummaryRes.body?.ok !== true) {
      failStep('qc_summary', 'Failed to load QC summary', qcSummaryRes.body);
    }
    const blockerCount = qcSummaryRes.body.severityCounts?.blocker || 0;
    if (blockerCount > 0) {
      failStep('qc_summary', `QC produced ${blockerCount} blocker finding(s)`, qcSummaryRes.body);
    }
    recordStep('qc_summary', 'passed', `QC readiness=${qcSummaryRes.body.draftReadiness} high=${qcSummaryRes.body.severityCounts?.high || 0}`);

    const insertionConfig = {
      ...(manifest.insertion?.config || {}),
      dryRun: options.allowDryRunInsertion,
      skipQcBlockers: false,
    };
    const targetAgentKey = manifest.insertion?.targetSoftware === 'real_quantum' ? 'rq' : 'aci';
    const agentAvailable = capabilities.agents?.[targetAgentKey] === true;
    if (!options.allowDryRunInsertion && !agentAvailable) {
      failStep(
        'insertion_status',
        `Live insertion could not be validated because the ${targetAgentKey.toUpperCase()} agent is offline`,
        { agentAvailable, targetAgentKey },
      );
    }

    const insertionStart = await apiJson(baseUrl, 'POST', '/api/insertion/run', {
      caseId,
      formType: manifest.formType,
      targetSoftware: manifest.insertion?.targetSoftware,
      generationRunId,
      config: insertionConfig,
    }, 30000);
    if (insertionStart.status !== 200 || (!insertionStart.body?.runId && !insertionStart.body?.run?.id)) {
      failStep('insertion_start', 'Failed to start insertion run', insertionStart.body);
    }
    const insertionRunId = insertionStart.body.runId || insertionStart.body.run?.id;
    report.insertionRunId = insertionRunId;

    const insertionDeadline = Date.now() + (manifest.insertion?.timeoutMs || 120000);
    let insertionStatus = null;
    while (Date.now() < insertionDeadline) {
      const runRes = await apiJson(baseUrl, 'GET', `/api/insertion/run/${insertionRunId}`, null, 15000);
      if (runRes.status !== 200 || !runRes.body?.run) {
        failStep('insertion_status', 'Failed to poll insertion run', runRes.body);
      }
      insertionStatus = runRes.body.run;
      if (['completed', 'partial', 'failed', 'cancelled'].includes(insertionStatus.status)) break;
      await sleep(1200);
    }
    if (!insertionStatus || ['queued', 'preparing', 'running'].includes(insertionStatus.status)) {
      failStep('insertion_status', 'Insertion run timed out', insertionStatus);
    }

    if (!options.allowDryRunInsertion) {
      if (insertionStatus.status !== 'completed') {
        failStep('insertion_status', `Insertion did not complete cleanly (status=${insertionStatus.status})`, insertionStatus);
      }
      if ((insertionStatus.totalFields || 0) < 1) {
        failStep('insertion_status', 'Insertion completed with zero mapped fields; live validation is not credible', insertionStatus);
      }
      if ((insertionStatus.verifiedFields || 0) < 1) {
        failStep('insertion_status', 'Insertion completed with zero verified fields; live validation is not credible', insertionStatus);
      }
      recordStep('insertion_status', 'passed', `Live insertion completed with ${insertionStatus.verifiedFields || 0} verified field(s)`);
    } else {
      recordStep(
        'insertion_status',
        'passed',
        `Dry-run insertion completed with status=${insertionStatus.status}; live agent validation skipped by flag`,
        { dryRun: true, agentAvailable },
      );
    }

    const exportManifest = await apiJson(baseUrl, 'GET', `/api/operations/export/${caseId}`, null, 45000);
    if (exportManifest.status !== 200 || exportManifest.body?.caseId !== caseId) {
      failStep('export_manifest', 'Failed to build export manifest', exportManifest.body);
    }
    const exportDownload = await apiJson(baseUrl, 'GET', `/api/operations/export/${caseId}/download`, null, 45000);
    if (exportDownload.status !== 200 || exportDownload.body?.ok !== true || !exportDownload.body?.path) {
      failStep('export_download', 'Failed to write export manifest to disk', exportDownload.body);
    }
    if (!fs.existsSync(exportDownload.body.path)) {
      failStep('export_download', `Export file missing on disk: ${exportDownload.body.path}`, exportDownload.body);
    }
    recordStep('export_download', 'passed', path.basename(exportDownload.body.path));

    const archiveRes = await apiJson(baseUrl, 'POST', `/api/operations/archive/${caseId}`, {}, 30000);
    if (archiveRes.status !== 200 || archiveRes.body?.success !== true) {
      failStep('archive_case', 'Failed to archive case', archiveRes.body);
    }
    const archivedCase = await apiJson(baseUrl, 'GET', `/api/cases/${caseId}`);
    if (archivedCase.status !== 200 || archivedCase.body?.meta?.status !== 'archived') {
      failStep('archive_case', 'Case did not remain archived after archive call', archivedCase.body);
    }
    recordStep('archive_case', 'passed', 'Case archived successfully');

    report.status = 'passed';
    return report;
  } catch (err) {
    report.status = 'failed';
    report.error = {
      step: err.step || 'unknown',
      message: err.message,
      payload: err.payload || null,
    };
    recordStep(err.step || 'unknown', 'failed', err.message, { payload: err.payload || null });
    return report;
  } finally {
    if (options.cleanup && caseId) {
      await apiJson(baseUrl, 'DELETE', `/api/cases/${caseId}`).catch(() => null);
    }
  }
}

function printReport(report) {
  console.log(`\n[${report.formType}] ${report.fixture}`);
  console.log(`  status: ${report.status}`);
  if (report.caseId) console.log(`  caseId: ${report.caseId}`);
  if (report.generationRunId) console.log(`  generationRunId: ${report.generationRunId}`);
  if (report.qcRunId) console.log(`  qcRunId: ${report.qcRunId}`);
  if (report.insertionRunId) console.log(`  insertionRunId: ${report.insertionRunId}`);
  for (const step of report.steps) {
    const marker = step.status === 'passed' ? 'OK ' : 'ERR';
    console.log(`  ${marker} ${step.name}: ${step.detail}`);
  }
  if (report.error) {
    console.log(`  error: ${report.error.message}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const runId = crypto.randomUUID().slice(0, 8);
process.env.CACC_DB_PATH = process.env.CACC_DB_PATH || path.join(os.tmpdir(), `cacc-golden-${runId}.db`);
process.env.CACC_QUEUE_STATE_FILE = process.env.CACC_QUEUE_STATE_FILE || path.join(os.tmpdir(), `cacc-golden-${runId}-queue.json`);
process.env.CACC_LOGS_DIR = process.env.CACC_LOGS_DIR || path.join(os.tmpdir(), `cacc-golden-${runId}-logs`);
process.env.CACC_DISABLE_FILE_LOGGER = process.env.CACC_DISABLE_FILE_LOGGER || '1';
process.env.CACC_DISABLE_KB_WRITES = process.env.CACC_DISABLE_KB_WRITES || '1';

const serverHarness = await ensureServerRunning({
  baseUrl: options.baseUrl,
  autoStart: options.autoStart,
  cwd: PROJECT_ROOT,
  startupTimeoutMs: 45000,
  pollIntervalMs: 750,
});

const healthDetailed = await apiJson(serverHarness.baseUrl, 'GET', '/api/health/detailed');
const healthServices = await apiJson(serverHarness.baseUrl, 'GET', '/api/health/services');

if (healthDetailed.status !== 200 || healthDetailed.body?.ok !== true) {
  console.error('Golden path preflight failed: /api/health/detailed unavailable');
  await serverHarness.stop();
  process.exit(1);
}
if (healthServices.status !== 200 || healthServices.body?.ok !== true) {
  console.error('Golden path preflight failed: /api/health/services unavailable');
  await serverHarness.stop();
  process.exit(1);
}

const capabilities = {
  aiKeySet: Boolean(healthDetailed.body.aiKeySet),
  ai: {
    configured: healthDetailed.body.ai?.configured === true,
    ready: healthDetailed.body.ai?.ready === true,
    reason: healthDetailed.body.ai?.reason || null,
    model: healthDetailed.body.ai?.model || null,
  },
  agents: {
    aci: healthDetailed.body.agents?.aci === true,
    rq: healthDetailed.body.agents?.rq === true,
  },
};

console.log('Golden path validation');
console.log(`  baseUrl: ${serverHarness.baseUrl}`);
console.log(`  mode: ${options.allowDryRunInsertion ? 'preflight (dry-run insertion allowed)' : 'strict (live insertion required)'}`);
console.log(`  aiKeySet: ${capabilities.aiKeySet}`);
console.log(`  aiReady: ${capabilities.ai.ready}${capabilities.ai.reason ? ` (${capabilities.ai.reason})` : ''}`);
console.log(`  agents: aci=${capabilities.agents.aci} rq=${capabilities.agents.rq}`);

if (!capabilities.ai.ready) {
  const preflightFailure = {
    runAt: new Date().toISOString(),
    baseUrl: serverHarness.baseUrl,
    options: {
      allowDryRunInsertion: options.allowDryRunInsertion,
      cleanup: options.cleanup,
    },
    capabilities,
    reports: [],
    error: {
      step: 'ai_preflight',
      message: capabilities.ai.reason || 'OpenAI is not ready for generation',
    },
  };

  if (options.reportPath) {
    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
    fs.writeFileSync(options.reportPath, JSON.stringify(preflightFailure, null, 2));
  }

  console.error(`Golden path preflight failed: ${preflightFailure.error.message}`);
  await serverHarness.stop();
  process.exit(1);
}

const reports = [];
for (const fixtureDir of options.fixtures) {
  reports.push(await runFixture(serverHarness.baseUrl, fixtureDir, options, capabilities));
}

reports.forEach(printReport);

if (options.reportPath) {
  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, JSON.stringify({
    runAt: new Date().toISOString(),
    baseUrl: serverHarness.baseUrl,
    options: {
      allowDryRunInsertion: options.allowDryRunInsertion,
      cleanup: options.cleanup,
    },
    capabilities,
    reports,
  }, null, 2));
}

await serverHarness.stop();

const failed = reports.filter(report => report.status !== 'passed');
if (failed.length > 0) {
  process.exit(1);
}
