/**
 * server/api/agentHealth.js
 * -------------------------
 * Readiness probes for destination automation agents.
 *
 * "Reachable" means the localhost process answered HTTP.
 * "Ready" means the downstream application session is usable for live insertion.
 */

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function fetchJson(url, timeoutMs = 2500, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: timeoutSignal(timeoutMs) });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error,
    };
  }
}

export function detectAciWindow(windows = []) {
  return windows.some(window => {
    const title = String(window?.title || '');
    const className = String(window?.class || '');
    return /aci/i.test(title) || /aci/i.test(className);
  });
}

export async function probeAciAgent(baseUrl, fetchImpl = fetch) {
  const health = await fetchJson(`${baseUrl}/health`, 2500, fetchImpl);
  if (!health.ok) {
    return {
      reachable: false,
      ready: false,
      reason: 'ACI agent is not reachable',
      health: null,
      windows: null,
    };
  }

  const windows = await fetchJson(`${baseUrl}/list-windows`, 4000, fetchImpl);
  const detected = detectAciWindow(windows.body?.windows || []);

  return {
    reachable: true,
    ready: detected,
    reason: detected ? null : 'ACI desktop window not detected',
    health: health.body,
    windows: windows.body || null,
  };
}

export async function probeRqAgent(baseUrl, fetchImpl = fetch) {
  const health = await fetchJson(`${baseUrl}/health`, 4000, fetchImpl);
  if (!health.ok) {
    return {
      reachable: false,
      ready: false,
      connected: false,
      reason: 'Real Quantum agent is not reachable',
      health: null,
    };
  }

  const connected = health.body?.connected === true;
  return {
    reachable: true,
    ready: connected,
    connected,
    reason: connected ? null : 'Chrome CDP / Real Quantum report session not connected',
    health: health.body,
  };
}
