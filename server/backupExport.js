/**
 * backupExport.js
 * ---------------
 * Creates support bundles and project data exports for Appraisal Agent.
 *
 * Support bundle includes:
 *   - cases/ (all case data: meta, facts, outputs)
 *   - knowledge_base/approvedNarratives/ (voice engine training data)
 *   - knowledge_base/approved_edits/ (legacy KB entries)
 *   - logs/ (recent log files, last 7 days)
 *   - bundle-manifest.json (version, timestamp, file counts)
 *
 * Output: a zip file written to exports/<timestamp>-support-bundle.zip
 * or returned as a Buffer for streaming to the client.
 *
 * Uses only Node.js built-ins (no external zip library required).
 * Falls back to a tar-like directory copy if zip is unavailable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const EXPORTS_DIR  = path.join(ROOT, 'exports');
const CASES_DIR    = path.join(ROOT, 'cases');
const KB_DIR       = path.join(ROOT, 'knowledge_base');
const LOGS_DIR     = path.join(ROOT, 'logs');
const PKG_PATH     = path.join(ROOT, 'package.json');

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function safeReadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listFilesRecursive(dir, maxDepth = 5, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...listFilesRecursive(full, maxDepth, depth + 1));
    } else {
      files.push(full);
    }
  }
  return files;
}

function copyFileToBundle(src, bundleDir, relBase) {
  const rel = path.relative(relBase, src);
  const dest = path.join(bundleDir, rel);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return rel;
}

// â”€â”€ Bundle stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * getBundleStats()
 * Returns a summary of what would be included in a support bundle.
 *
 * @returns {object}
 */
export function getBundleStats() {
  const pkg = safeReadJSON(PKG_PATH) || {};

  const caseCount = fs.existsSync(CASES_DIR)
    ? fs.readdirSync(CASES_DIR).filter(f => fs.statSync(path.join(CASES_DIR, f)).isDirectory()).length
    : 0;

  const narDir = path.join(KB_DIR, 'approvedNarratives');
  const narCount = fs.existsSync(narDir)
    ? fs.readdirSync(narDir).filter(f => f.endsWith('.json') && f !== 'index.json').length
    : 0;

  const editDir = path.join(KB_DIR, 'approved_edits');
  const editCount = fs.existsSync(editDir)
    ? fs.readdirSync(editDir).filter(f => f.endsWith('.json')).length
    : 0;

  const logFiles = fs.existsSync(LOGS_DIR)
    ? fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'))
    : [];

  return {
    appVersion:          pkg.version || 'unknown',
    cases:               caseCount,
    approvedNarratives:  narCount,
    approvedEdits:       editCount,
    logFiles:            logFiles.length,
    exportDir:           EXPORTS_DIR,
  };
}

// â”€â”€ Create support bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * createSupportBundle(options)
 * Creates a support bundle directory (and optionally zips it).
 *
 * @param {object} [options]
 * @param {boolean} [options.includeAllLogs=false] - Include all logs (default: last 7 days)
 * @param {boolean} [options.zip=true]             - Attempt to zip the bundle
 * @returns {Promise<{ok, bundlePath, zipPath, manifest, error}>}
 */
export async function createSupportBundle(options = {}) {
  const { includeAllLogs = false, zip = true } = options;

  try {
    ensureDir(EXPORTS_DIR);

    // â”€â”€ Local-time timestamp: YYYY-MM-DD-HHMM (no seconds, no UTC offset) â”€â”€â”€â”€
    function localTimestamp() {
      const d   = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    }

    const bundleName = `cacc-writer-support-bundle-${localTimestamp()}`;
    const bundleDir  = path.join(EXPORTS_DIR, bundleName);
    ensureDir(bundleDir);

    const manifest = {
      createdAt:  new Date().toISOString(),
      appVersion: (safeReadJSON(PKG_PATH) || {}).version || 'unknown',
      files:      [],
      counts:     { cases: 0, approvedNarratives: 0, approvedEdits: 0, logs: 0 },
    };

    // â”€â”€ 1. Cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (fs.existsSync(CASES_DIR)) {
      const caseFiles = listFilesRecursive(CASES_DIR);
      for (const f of caseFiles) {
        const rel = copyFileToBundle(f, path.join(bundleDir, 'cases'), CASES_DIR);
        manifest.files.push('cases/' + rel);
        manifest.counts.cases++;
      }
    }

    // â”€â”€ 2. Approved Narratives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const narDir = path.join(KB_DIR, 'approvedNarratives');
    if (fs.existsSync(narDir)) {
      const narFiles = listFilesRecursive(narDir);
      for (const f of narFiles) {
        const rel = copyFileToBundle(f, path.join(bundleDir, 'approvedNarratives'), narDir);
        manifest.files.push('approvedNarratives/' + rel);
        manifest.counts.approvedNarratives++;
      }
    }

    // â”€â”€ 3. Approved Edits (legacy KB) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const editDir = path.join(KB_DIR, 'approved_edits');
    if (fs.existsSync(editDir)) {
      const editFiles = listFilesRecursive(editDir);
      for (const f of editFiles) {
        const rel = copyFileToBundle(f, path.join(bundleDir, 'approved_edits'), editDir);
        manifest.files.push('approved_edits/' + rel);
        manifest.counts.approvedEdits++;
      }
    }

    // â”€â”€ 4. Logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (fs.existsSync(LOGS_DIR)) {
      const cutoff = includeAllLogs
        ? null
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const logFiles = fs.readdirSync(LOGS_DIR)
        .filter(f => f.endsWith('.log'))
        .filter(f => {
          if (!cutoff) return true;
          const dateStr = f.replace('cacc-', '').replace('.log', '');
          return dateStr >= cutoff;
        });

      for (const f of logFiles) {
        const src  = path.join(LOGS_DIR, f);
        const dest = path.join(bundleDir, 'logs', f);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
        manifest.files.push('logs/' + f);
        manifest.counts.logs++;
      }
    }

    // â”€â”€ 5. Health snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Captures service state at the moment the bundle was created.
    // Server is always healthy here (we are running). KB/narratives probed.
    let kbProbeOk = true, narProbeOk = true;
    try {
      const probe = path.join(KB_DIR, '.health_probe');
      fs.writeFileSync(probe, '1', 'utf8');
      fs.unlinkSync(probe);
    } catch { kbProbeOk = false; }

    const narDir2 = path.join(KB_DIR, 'approvedNarratives');
    try {
      if (fs.existsSync(narDir2)) {
        const probe = path.join(narDir2, '.health_probe');
        fs.writeFileSync(probe, '1', 'utf8');
        fs.unlinkSync(probe);
      } else { narProbeOk = false; }
    } catch { narProbeOk = false; }

    const healthSnapshot = {
      capturedAt:  new Date().toISOString(),
      appVersion:  manifest.appVersion,
      note:        'Service health at time of bundle creation',
      services: {
        server:             { status: 'healthy', note: 'Server was running â€” bundle created successfully' },
        knowledgeBase:      { status: kbProbeOk  ? 'healthy' : 'degraded', cases: manifest.counts.cases, approvedNarratives: manifest.counts.approvedNarratives },
        approvedNarratives: { status: narProbeOk ? 'healthy' : 'degraded', count: manifest.counts.approvedNarratives },
        logs:               { count: manifest.counts.logs },
      },
    };
    fs.writeFileSync(
      path.join(bundleDir, 'health-snapshot.json'),
      JSON.stringify(healthSnapshot, null, 2),
      'utf8'
    );
    manifest.files.push('health-snapshot.json');

    // â”€â”€ 6. Insertion diagnostics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Collects sectionStatus from all case outputs.json files.
    // Useful for diagnosing failed insertions after a support bundle is submitted.
    const insertionDiagnostics = {
      capturedAt: new Date().toISOString(),
      note:       'Section insertion status for all cases at time of bundle creation',
      cases:      {},
    };
    if (fs.existsSync(CASES_DIR)) {
      const caseDirs = fs.readdirSync(CASES_DIR).filter(d => /^[a-f0-9]{8}$/i.test(d));
      for (const caseId of caseDirs) {
        const outputsPath = path.join(CASES_DIR, caseId, 'outputs.json');
        if (!fs.existsSync(outputsPath)) continue;
        try {
          const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
          const sections = {};
          for (const [fid, v] of Object.entries(outputs)) {
            if (fid === 'updatedAt' || !v || typeof v !== 'object') continue;
            if (v.sectionStatus || v.insertedAt || v.copiedAt) {
              sections[fid] = {
                sectionStatus:   v.sectionStatus || (v.text ? 'drafted' : 'not_started'),
                insertedAt:      v.insertedAt      || null,
                copiedAt:        v.copiedAt         || null,
                statusNote:      v.statusNote       || null,
                statusUpdatedAt: v.statusUpdatedAt  || null,
              };
            }
          }
          if (Object.keys(sections).length) {
            insertionDiagnostics.cases[caseId] = sections;
          }
        } catch { /* non-fatal â€” skip corrupt outputs.json */ }
      }
    }
    fs.writeFileSync(
      path.join(bundleDir, 'insertion-diagnostics.json'),
      JSON.stringify(insertionDiagnostics, null, 2),
      'utf8'
    );
    manifest.files.push('insertion-diagnostics.json');

    // â”€â”€ 7. Manifest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    fs.writeFileSync(
      path.join(bundleDir, 'bundle-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    // â”€â”€ 8. Zip (optional, uses system zip/PowerShell) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let zipPath = null;
    if (zip) {
      const zipFile = bundleDir + '.zip';
      try {
        // Windows: use PowerShell Compress-Archive
        execSync(
          `powershell -Command "Compress-Archive -Path '${bundleDir}' -DestinationPath '${zipFile}' -Force"`,
          { timeout: 30000 }
        );
        // Clean up unzipped bundle dir after successful zip
        fs.rmSync(bundleDir, { recursive: true, force: true });
        zipPath = zipFile;
      } catch {
        // Zip failed â€” return the unzipped directory path instead
        zipPath = null;
      }
    }

    return {
      ok:         true,
      bundlePath: zipPath || bundleDir,
      zipPath,
      isZip:      Boolean(zipPath),
      manifest,
    };

  } catch (err) {
    return {
      ok:    false,
      error: err.message,
    };
  }
}

/**
 * listExports()
 * Returns list of existing export bundles in exports/.
 *
 * @returns {Array<{name, path, sizeBytes, createdAt}>}
 */
export function listExports() {
  try {
    ensureDir(EXPORTS_DIR);
    return fs.readdirSync(EXPORTS_DIR)
      .filter(f => f.startsWith('cacc-writer-support-bundle-') || f.startsWith('support-bundle-'))
      .sort()
      .reverse()
      .map(name => {
        const filePath = path.join(EXPORTS_DIR, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          path:      filePath,
          sizeBytes: stat.size,
          isZip:     name.endsWith('.zip'),
          createdAt: stat.birthtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
}

export default {
  getBundleStats,
  createSupportBundle,
  listExports,
};

