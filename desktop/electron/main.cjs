/**
 * desktop/electron/main.cjs
 * --------------------------
 * Appraisal Agent â€” Electron Main Process
 *
 * Responsibilities:
 *   - Single-instance lock (prevent duplicate windows)
 *   - Spawn cacc-writer-server.js as a child process
 *   - Wait for server to be ready before loading the UI
 *   - Window state persistence (save/restore size + position)
 *   - Off-screen guard (reopen centered if saved position is invalid)
 *   - Clean shutdown (kill server on quit)
 *
 * NOTE: This file uses .cjs extension because package.json has "type":"module".
 * Electron's main process requires CommonJS. The .cjs extension forces CJS
 * regardless of the package type field.
 */

'use strict';

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { spawn } = require('child_process');

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_NAME    = 'Appraisal Agent';
const PORT        = 5178;
const APP_URL     = `http://localhost:${PORT}`;
const ROOT_DIR    = path.join(__dirname, '..', '..');
const STATE_FILE  = path.join(app.getPath('userData'), 'window-state.json');

const DEFAULT_WIDTH  = 1280;
const DEFAULT_HEIGHT = 820;

// â”€â”€ Single-instance lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[electron] Another instance is already running. Exiting.');
  app.quit();
  process.exit(0);
}

// â”€â”€ Window state persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Load saved window bounds from userData.
 * Returns safe defaults if the file is missing, corrupt, or off-screen.
 */
function loadWindowState() {
  try {
    const raw   = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw);

    if (
      typeof state.width  !== 'number' || state.width  < 800  ||
      typeof state.height !== 'number' || state.height < 600
    ) {
      return null; // invalid â€” use defaults
    }

    // Guard: ensure the window is on at least one display
    const displays = screen.getAllDisplays();
    const onScreen = displays.some(d => {
      const b = d.bounds;
      return (
        state.x >= b.x &&
        state.y >= b.y &&
        state.x + state.width  <= b.x + b.width  + 100 && // 100px tolerance
        state.y + state.height <= b.y + b.height + 100
      );
    });

    if (!onScreen) {
      console.log('[electron] Saved window position is off-screen â€” using centered default.');
      return null;
    }

    return state;
  } catch {
    return null; // file missing or corrupt â€” use defaults
  }
}

/**
 * Save current window bounds to userData.
 * Skips save when maximized or minimized (restore those states separately).
 */
function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
  try {
    const bounds = win.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify(bounds, null, 2), 'utf8');
  } catch (e) {
    console.warn('[electron] Could not save window state:', e.message);
  }
}

// â”€â”€ Server process management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let serverProcess = null;

function startServer() {
  const serverScript = path.join(ROOT_DIR, 'cacc-writer-server.js');

  if (!fs.existsSync(serverScript)) {
    console.error('[electron] cacc-writer-server.js not found at:', serverScript);
    return;
  }

  console.log('[electron] Starting Appraisal Agent server...');

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd:   ROOT_DIR,
    env:   { ...process.env, ELECTRON: '1' },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line) console.log('[server]', line);
  });

  serverProcess.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) console.error('[server:err]', line);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[server] Exited â€” code=${code} signal=${signal}`);
    serverProcess = null;
  });

  serverProcess.on('error', err => {
    console.error('[server] Failed to start:', err.message);
  });
}

function stopServer() {
  if (serverProcess) {
    console.log('[electron] Stopping server...');
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
    serverProcess = null;
  }
}

// â”€â”€ Wait for server to be ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Poll the server health endpoint until it responds OK.
 * Returns true when ready, false after maxAttempts.
 */
async function waitForServer(maxAttempts = 40, delayMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (res.ok) {
        console.log(`[electron] Server ready after ${i + 1} attempt(s).`);
        return true;
      }
    } catch {
      // server not up yet â€” keep polling
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  console.warn('[electron] Server did not become ready in time. Loading anyway.');
  return false;
}

// â”€â”€ Main window â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let mainWindow = null;

function createWindow() {
  const savedState = loadWindowState();

  const winOptions = {
    width:           savedState?.width  ?? DEFAULT_WIDTH,
    height:          savedState?.height ?? DEFAULT_HEIGHT,
    title:           APP_NAME,
    backgroundColor: '#0b1020',
    show:            false, // show after ready-to-show to avoid flash
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  };

  // Only set position if we have a valid saved state
  if (savedState?.x !== undefined && savedState?.y !== undefined) {
    winOptions.x = savedState.x;
    winOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(winOptions);

  // â”€â”€ Window state save hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let saveTimer = null;
  const debouncedSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };

  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move',   debouncedSave);
  mainWindow.on('close',  () => {
    clearTimeout(saveTimer);
    saveWindowState(mainWindow);
  });

  // â”€â”€ Show window when content is ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // â”€â”€ Open external links in system browser, not Electron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // â”€â”€ Load the app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  waitForServer().then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(APP_URL);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// â”€â”€ IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// â”€â”€ App lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.setName(APP_NAME);

// Windows taskbar pinning â€” must be set before app.whenReady()
// Without this, the app may not pin correctly to the Windows taskbar.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.cacc.writer');
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Focus existing window if a second instance is launched
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Quit when all windows are closed (Windows / Linux behavior)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

app.on('will-quit', () => {
  stopServer();
});

