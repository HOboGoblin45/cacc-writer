/**
 * desktop/forge.config.cjs
 * -------------------------
 * Appraisal Agent — Electron Forge Configuration
 *
 * Packaging target: Windows (Squirrel installer)
 * Entry point:      desktop/electron/main.cjs
 *
 * Usage:
 *   npm run make          → build installer in out/make/
 *   npm run package:electron → package without installer (out/)
 *
 * NOTE: .cjs extension required — package.json has "type":"module".
 */

'use strict';

const path = require('path');
const pkg  = require('../package.json');

module.exports = {
  // ── Packager config ─────────────────────────────────────────────────────────
  packagerConfig: {
    name:            'Appraisal Agent',
    executableName:  'appraisal-agent',
    appVersion:      pkg.version,
    appCopyright:    `Copyright © ${new Date().getFullYear()} Cresci Appraisal & Consulting`,

    // Icon placeholder — place a real .ico file here before production release
    // icon: path.join(__dirname, 'electron', 'icon'),

    // Files/dirs to exclude from the packaged app
    ignore: [
      /^\/\.git/,
      /^\/node_modules\/\.cache/,
      /^\/cases\//,                          // user data — not bundled
      /^\/knowledge_base\/raw_imports/,      // large raw files
      /^\/desktop_agent\/screenshots/,       // debug screenshots
      /^\/real_quantum_agent\/screenshots/,  // debug screenshots
      /^\/out\//,                            // previous build output
      /^\/server_test_output\.log/,
      /^\/server_test_error\.log/,
      /\.bak\.json$/,
    ],

    // Windows-specific: embed app metadata in the .exe
    win32metadata: {
      CompanyName:      'Cresci Appraisal & Consulting',
      FileDescription:  'Appraisal Agent — Appraisal Narrative Engine',
      ProductName:      'Appraisal Agent',
      InternalName:     'appraisal-agent',
    },
  },

  // ── Rebuild config (native modules) ─────────────────────────────────────────
  rebuildConfig: {},

  // ── Makers ───────────────────────────────────────────────────────────────────
  makers: [
    // Windows: Squirrel.Windows installer (.exe)
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name:     'cacc_writer',
        setupExe: 'CACCWriterSetup.exe',
        // setupIcon: path.join(__dirname, 'electron', 'icon.ico'),
        // certificateFile: process.env.WINDOWS_CERT_FILE,
        // certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      },
    },

    // ZIP archive (portable, no installer)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],

  // ── Plugins ──────────────────────────────────────────────────────────────────
  plugins: [],
};
