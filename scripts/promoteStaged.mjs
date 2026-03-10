/**
 * scripts/promoteStaged.mjs
 * --------------------------
 * Voice PDF Ingestion Pipeline — Staging Review → Promotion
 *
 * Reads staged candidate files from knowledge_base/staging/<formType>/
 * and promotes entries where "approved": true into production memory:
 *   - sections      → knowledge_base/approvedNarratives/
 *   - phrases       → knowledge_base/phrase_bank/phrases.json
 *   - compExamples  → knowledge_base/compExamples/<formType>/
 *
 * CLI:
 *   node scripts/promoteStaged.mjs
 *   node scripts/promoteStaged.mjs --formType 1004
 *   node scripts/promoteStaged.mjs --formType 1004 --file Hundman.PDF
 *   node scripts/promoteStaged.mjs --dryRun
 *   node scripts/promoteStaged.mjs --status   (show staging status only)
 *
 * Workflow:
 *   1. Run ingestVoicePdfs.mjs to extract + stage
 *   2. Open knowledge_base/staging/<formType>/<filename>.json
 *   3. Set "approved": true on sections/phrases/compExamples to promote
 *   4. Run this script to promote approved entries
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const getArg    = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag   = (flag) => args.includes(flag);

const FILTER_FORM = getArg('--formType');
const FILTER_FILE = getArg('--file');
const DRY_RUN     = hasFlag('--dryRun');
const STATUS_ONLY = hasFlag('--status');

// ── Paths ─────────────────────────────────────────────────────────────────────

const STAGING_DIR    = path.join(ROOT, 'knowledge_base', 'staging');
const PHRASE_BANK    = path.join(ROOT, 'knowledge_base', 'phrase_bank', 'phrases.json');
const COMP_EXAMPLES  = path.join(ROOT, 'knowledge_base', 'compExamples');

const FORM_TYPES = ['1004', '1025', '1073', '1004c', 'commercial'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Collect staging files ─────────────────────────────────────────────────────

function collectStagingFiles() {
  const files = [];
  const formTypesToScan = FILTER_FORM
    ? (FORM_TYPES.includes(FILTER_FORM) ? [FILTER_FORM] : [])
    : FORM_TYPES;

  for (const formType of formTypesToScan) {
    const formDir = path.join(STAGING_DIR, formType);
    if (!fs.existsSync(formDir)) continue;

    const jsonFiles = fs.readdirSync(formDir).filter(f => f.endsWith('.json'));
    for (const jsonFile of jsonFiles) {
      if (FILTER_FILE && jsonFile.toLowerCase() !== `${FILTER_FILE.toLowerCase()}.json`) continue;
      files.push({ formType, jsonFile, filePath: path.join(formDir, jsonFile) });
    }
  }
  return files;
}

// ── Status display ────────────────────────────────────────────────────────────

function showStatus(stagingFiles) {
  console.log('\n  Staging Status:');
  if (stagingFiles.length === 0) {
    console.log('  No staged files found.');
    return;
  }

  for (const { formType, jsonFile, filePath } of stagingFiles) {
    const candidate = readJSON(filePath, null);
    if (!candidate) { console.log(`  [${formType}] ${jsonFile} — unreadable`); continue; }

    const secTotal    = candidate.sections?.length     || 0;
    const secApproved = candidate.sections?.filter(s => s.approved === true).length  || 0;
    const secPending  = candidate.sections?.filter(s => s.approved === null).length  || 0;
    const phTotal     = candidate.phrases?.length      || 0;
    const phApproved  = candidate.phrases?.filter(p => p.approved === true).length   || 0;
    const ceTotal     = candidate.compExamples?.length || 0;
    const ceApproved  = candidate.compExamples?.filter(c => c.approved === true).length || 0;

    console.log(`\n  [${formType}] ${jsonFile}`);
    console.log(`    Status:       ${candidate.status}`);
    console.log(`    Sections:     ${secApproved}/${secTotal} approved (${secPending} pending)`);
    console.log(`    Phrases:      ${phApproved}/${phTotal} approved`);
    console.log(`    CompExamples: ${ceApproved}/${ceTotal} approved`);
    console.log(`    Metadata:     ${JSON.stringify(candidate.metadata)}`);
  }
}

// ── Promote sections → approvedNarratives ────────────────────────────────────

async function promoteSections(candidate, stagingFilePath) {
  const { saveApprovedNarrative } = await import('../server/storage/saveApprovedNarrative.js');

  const toPromote = (candidate.sections || []).filter(s => s.approved === true && !s.promotedId);
  if (toPromote.length === 0) return { promoted: 0, skipped: 0 };

  let promoted = 0, skipped = 0;

  for (const section of toPromote) {
    try {
      const entry = saveApprovedNarrative({
        text:              section.text,
        sectionType:       section.sectionType,
        formType:          candidate.formType,
        propertyType:      candidate.metadata.propertyType,
        subjectCondition:  candidate.metadata.subjectCondition,
        marketType:        candidate.metadata.marketType,
        city:              candidate.metadata.city,
        county:            candidate.metadata.county,
        state:             candidate.metadata.state,
        assignmentPurpose: candidate.metadata.assignmentPurpose,
        loanProgram:       candidate.metadata.loanProgram,
        sourceReportId:    candidate.sourceFile,
        qualityScore:      85,   // staged imports start at 85 (below manual approvals at 95)
        approvedBy:        'ingestion_pipeline',
        tags:              ['voice_pdf', candidate.formType, candidate.sourceFile.replace(/\.pdf$/i, '')],
        customMetadata: {
          ingestionSource: 'ingestVoicePdfs',
          stagingFile:     path.basename(stagingFilePath),
        },
      });

      // Mark as promoted in staging file
      section.promotedId = entry.id;
      promoted++;
      console.log(`      ✓ section [${section.sectionType}] → approvedNarratives/${entry.id}.json`);
    } catch (err) {
      console.error(`      ✗ section [${section.sectionType}] failed: ${err.message}`);
      skipped++;
    }
  }

  return { promoted, skipped };
}

// ── Promote phrases → phrase_bank/phrases.json ────────────────────────────────

function promotePhrases(candidate) {
  const toPromote = (candidate.phrases || []).filter(p => p.approved === true && !p.promotedAt);
  if (toPromote.length === 0) return { promoted: 0, skipped: 0 };

  const phraseBank = readJSON(PHRASE_BANK, { version: '1.0.0', phrases: [] });
  if (!Array.isArray(phraseBank.phrases)) phraseBank.phrases = [];

  const existingIds = new Set(phraseBank.phrases.map(p => p.id));
  let promoted = 0, skipped = 0;

  for (const phrase of toPromote) {
    // Deduplicate by id
    if (existingIds.has(phrase.id)) {
      console.log(`      ⊙ phrase [${phrase.id}] — already in phrase bank, skipping`);
      phrase.promotedAt = 'duplicate';
      skipped++;
      continue;
    }

    phraseBank.phrases.push({
      id:      phrase.id,
      tag:     phrase.tag,
      context: phrase.context,
      text:    phrase.text,
    });
    existingIds.add(phrase.id);
    phrase.promotedAt = new Date().toISOString();
    promoted++;
    console.log(`      ✓ phrase [${phrase.id}] → phrase_bank/phrases.json`);
  }

  if (promoted > 0) {
    writeJSON(PHRASE_BANK, phraseBank);
  }

  return { promoted, skipped };
}

// ── Promote compExamples → compExamples/<formType>/ ───────────────────────────

function promoteCompExamples(candidate) {
  const toPromote = (candidate.compExamples || []).filter(c => c.approved === true && !c.promotedId);
  if (toPromote.length === 0) return { promoted: 0 };

  const formDir = path.join(COMP_EXAMPLES, candidate.formType);
  ensureDir(formDir);

  let promoted = 0;

  for (const example of toPromote) {
    const id   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = path.join(formDir, `${id}.json`);

    const entry = {
      id,
      sectionType:  example.sectionType,
      formType:     candidate.formType,
      text:         example.text,
      wordCount:    example.wordCount,
      sourceFile:   candidate.sourceFile,
      metadata:     candidate.metadata,
      createdAt:    new Date().toISOString(),
    };

    writeJSON(file, entry);
    example.promotedId = id;
    promoted++;
    console.log(`      ✓ compExample [${example.sectionType}] → compExamples/${candidate.formType}/${id}.json`);
  }

  return { promoted };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  CACC Writer — Staging Promotion');
  console.log('══════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  [DRY RUN] — no files will be written\n');

  if (!fs.existsSync(STAGING_DIR)) {
    console.log('  No staging directory found. Run ingestVoicePdfs.mjs first.');
    process.exit(0);
  }

  const stagingFiles = collectStagingFiles();

  if (stagingFiles.length === 0) {
    console.log('  No staged files found.');
    if (FILTER_FORM) console.log(`  (filtered to formType: ${FILTER_FORM})`);
    process.exit(0);
  }

  // Status-only mode
  if (STATUS_ONLY) {
    showStatus(stagingFiles);
    console.log('');
    process.exit(0);
  }

  // Show status before promoting
  showStatus(stagingFiles);
  console.log('');

  let totalSections = 0, totalPhrases = 0, totalCompExamples = 0;

  for (const { formType, jsonFile, filePath } of stagingFiles) {
    const candidate = readJSON(filePath, null);
    if (!candidate) {
      console.warn(`  ✗ Could not read ${jsonFile}`);
      continue;
    }

    const approvedSections    = (candidate.sections     || []).filter(s => s.approved === true && !s.promotedId).length;
    const approvedPhrases     = (candidate.phrases      || []).filter(p => p.approved === true && !p.promotedAt).length;
    const approvedCompExamples = (candidate.compExamples || []).filter(c => c.approved === true && !c.promotedId).length;

    if (approvedSections + approvedPhrases + approvedCompExamples === 0) {
      console.log(`  [${formType}] ${jsonFile} — nothing approved to promote`);
      continue;
    }

    console.log(`\n  [${formType}] ${jsonFile}`);
    console.log(`    Promoting: ${approvedSections} sections, ${approvedPhrases} phrases, ${approvedCompExamples} compExamples`);

    if (!DRY_RUN) {
      // Promote sections
      if (approvedSections > 0) {
        const { promoted } = await promoteSections(candidate, filePath);
        totalSections += promoted;
      }

      // Promote phrases
      if (approvedPhrases > 0) {
        const { promoted } = promotePhrases(candidate);
        totalPhrases += promoted;
      }

      // Promote comp examples
      if (approvedCompExamples > 0) {
        const { promoted } = promoteCompExamples(candidate);
        totalCompExamples += promoted;
      }

      // Update staging file with promotedIds + status
      const allResolved = [
        ...(candidate.sections     || []),
        ...(candidate.phrases      || []),
        ...(candidate.compExamples || []),
      ].every(e => e.approved !== null);

      if (allResolved) candidate.status = 'promoted';
      candidate.lastPromotedAt = new Date().toISOString();

      writeJSON(filePath, candidate);
      console.log(`    ✓ Staging file updated`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Promotion Complete`);
  console.log(`  Sections → approvedNarratives: ${totalSections}`);
  console.log(`  Phrases  → phrase_bank:         ${totalPhrases}`);
  console.log(`  CompExamples → compExamples:    ${totalCompExamples}`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n  FATAL:', err.message);
  process.exit(1);
});
