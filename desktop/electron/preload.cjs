/**
 * desktop/electron/preload.cjs
 * -----------------------------
 * Appraisal Agent — Electron Preload Script
 *
 * Runs in the renderer process with Node.js access BEFORE the page loads.
 * Uses contextBridge to safely expose a minimal API to the renderer (app.js).
 *
 * Exposed as: window.electronAPI
 *
 * NOTE: .cjs extension required — package.json has "type":"module".
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Read version from package.json at preload time (synchronous, safe here)
let appVersion = '2.0.0';
try {
  const path = require('path');
  const fs   = require('fs');
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  appVersion    = pkg.version || appVersion;
} catch {}

contextBridge.exposeInMainWorld('electronAPI', {
  /** App version string from package.json (e.g. "2.0.0") */
  version: appVersion,

  /** Current platform: "win32" | "darwin" | "linux" */
  platform: process.platform,

  /** Open a URL in the system default browser */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /** Get app version from main process (async, authoritative) */
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  /** True when running inside Electron (vs plain browser) */
  isElectron: true,
});
