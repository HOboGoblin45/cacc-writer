/**
 * tests/helpers/serverHarness.mjs
 * --------------------------------
 * Shared test helper to ensure the API server is reachable.
 *
 * Behavior:
 * - If a server is already running at baseUrl, reuse it.
 * - If not running and autoStart=true, start cacc-writer-server.js on that port.
 * - If server startup binds a different port, follow the actual bound port from logs.
 * - Return a stop() function that only stops the process this helper started.
 */

import { spawn } from 'child_process';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readPort(baseUrl) {
  const u = new URL(baseUrl);
  return u.port || (u.protocol === 'https:' ? '443' : '80');
}

async function isHealthy(baseUrl, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureServerRunning({
  baseUrl = 'http://localhost:5178',
  autoStart = false,
  cwd = process.cwd(),
  startupTimeoutMs = 30000,
  pollIntervalMs = 500,
} = {}) {
  if (await isHealthy(baseUrl)) {
    return {
      baseUrl,
      started: false,
      stop: async () => {},
    };
  }

  if (!autoStart) {
    throw new Error(`Server is not reachable at ${baseUrl}`);
  }

  const port = readPort(baseUrl);
  const child = spawn(process.execPath, ['cacc-writer-server.js'], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let outTail = '';
  let errTail = '';
  let detectedBaseUrl = null;
  const appendTail = (tail, chunk) => (tail + chunk.toString()).slice(-4000);
  const detectBoundPort = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/Appraisal Agent server running on port (\d+)/);
    if (!match) return;
    const actualPort = match[1];
    const currentUrl = new URL(baseUrl);
    currentUrl.port = actualPort;
    detectedBaseUrl = currentUrl.toString().replace(/\/$/, '');
  };
  child.stdout?.on('data', chunk => {
    outTail = appendTail(outTail, chunk);
    detectBoundPort(chunk);
  });
  child.stderr?.on('data', chunk => {
    errTail = appendTail(errTail, chunk);
    detectBoundPort(chunk);
  });

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < 2000) {
      await sleep(50);
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  };

  process.once('exit', () => {
    if (child.exitCode === null) child.kill();
  });

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl, pollIntervalMs)) {
      return { baseUrl, started: true, stop };
    }
    if (detectedBaseUrl && detectedBaseUrl !== baseUrl && await isHealthy(detectedBaseUrl, pollIntervalMs)) {
      return { baseUrl: detectedBaseUrl, started: true, stop };
    }
    if (child.exitCode !== null) break;
    await sleep(pollIntervalMs);
  }

  await stop();
  const logs = [outTail, errTail].filter(Boolean).join('\n').trim();
  const suffix = logs ? `\nLast server logs:\n${logs}` : '';
  throw new Error(`Failed to start server at ${baseUrl} within ${startupTimeoutMs}ms.${suffix}`);
}

