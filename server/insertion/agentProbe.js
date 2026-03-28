/**
 * server/insertion/agentProbe.js
 * ------------------------------
 * Lightweight destination-agent readiness probing.
 *
 * This is stricter than process health: it verifies whether the live agent can
 * locate one or more mapped destination fields before a real insertion starts.
 */

import { inferTargetSoftware, resolveMapping } from './destinationMapper.js';
import { buildFormDraftModel } from './formDraftModel.js';
import { probeAciAgent, probeRqAgent } from '../api/agentHealth.js';

const DEFAULT_AGENT_URLS = {
  aci: process.env.ACI_AGENT_URL || 'http://localhost:5180',
  real_quantum: process.env.RQ_AGENT_URL || 'http://localhost:5181',
};

const MIN_PROBE_TIMEOUT_MS = {
  aci: 20000,
  real_quantum: 6000,
};

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function scoreProbeCandidate(field) {
  let score = 0;
  if (field.required) score += 100;
  if (field.verifyRequired) score += 50;
  if (field.calibrated) score += 25;
  if (field.supported) score += 10;
  score += Math.min(field.textLength || 0, 500) / 100;
  return score;
}

export function getAgentBaseUrl(targetSoftware) {
  return DEFAULT_AGENT_URLS[targetSoftware] || null;
}

export function getProbeTimeoutMs(targetSoftware, timeoutMs = 6000) {
  const minimum = MIN_PROBE_TIMEOUT_MS[targetSoftware] || 6000;
  return Math.max(timeoutMs, minimum);
}

async function probeAgentSession(targetSoftware, agentBaseUrl, fetchImpl) {
  if (targetSoftware === 'aci') {
    return probeAciAgent(agentBaseUrl, fetchImpl);
  }
  if (targetSoftware === 'real_quantum') {
    return probeRqAgent(agentBaseUrl, fetchImpl);
  }
  return {
    reachable: true,
    ready: true,
    reason: null,
  };
}

export function selectProbeFieldIds({
  caseId,
  formType,
  generationRunId = null,
  targetSoftware = inferTargetSoftware(formType),
  fieldIds = null,
  maxFields = 4,
} = {}) {
  if (Array.isArray(fieldIds) && fieldIds.length > 0) {
    return unique(fieldIds.map(fieldId => String(fieldId || '').trim()));
  }

  if (!caseId || !formType) return [];

  const draftModel = buildFormDraftModel({
    caseId,
    formType,
    generationRunId,
    targetSoftware,
  });

  return draftModel.fields
    .filter(field =>
      field.hasText
      && field.supported
      && field.calibrated
      && field.textLength >= 20,
    )
    .sort((left, right) => scoreProbeCandidate(right) - scoreProbeCandidate(left))
    .slice(0, maxFields)
    .map(field => field.fieldId);
}

async function postProbe(agentBaseUrl, payload, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${agentBaseUrl}/test-field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
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
  } finally {
    clearTimeout(timer);
  }
}

export async function probeDestinationFields({
  formType,
  targetSoftware = inferTargetSoftware(formType),
  fieldIds = [],
  agentBaseUrl = getAgentBaseUrl(targetSoftware),
  timeoutMs = 6000,
  fetchImpl = fetch,
} = {}) {
  const normalizedFieldIds = unique(fieldIds.map(fieldId => String(fieldId || '').trim()));
  const probeTimeoutMs = getProbeTimeoutMs(targetSoftware, timeoutMs);

  if (!formType) {
    return {
      reachable: false,
      ready: false,
      foundCount: 0,
      probedCount: 0,
      fieldResults: [],
      reason: 'formType is required',
      agentBaseUrl,
    };
  }

  if (!agentBaseUrl) {
    return {
      reachable: false,
      ready: false,
      foundCount: 0,
      probedCount: normalizedFieldIds.length,
      fieldResults: [],
      reason: `No agent URL is configured for ${targetSoftware}`,
      agentBaseUrl: null,
    };
  }

  if (!normalizedFieldIds.length) {
    return {
      reachable: false,
      ready: false,
      sessionReady: false,
      foundCount: 0,
      probedCount: 0,
      fieldResults: [],
      reason: 'No candidate fields are available for destination probing',
      agentBaseUrl,
    };
  }

  const sessionProbe = await probeAgentSession(targetSoftware, agentBaseUrl, fetchImpl);
  if (!sessionProbe.reachable || !sessionProbe.ready) {
    return {
      targetSoftware,
      agentBaseUrl,
      reachable: sessionProbe.reachable,
      ready: false,
      sessionReady: sessionProbe.ready,
      reason: sessionProbe.reason,
      foundCount: 0,
      probedCount: 0,
      fieldResults: [],
      sessionProbe,
    };
  }

  const fieldResults = [];
  let reachable = false;

  for (const fieldId of normalizedFieldIds) {
    const mapping = resolveMapping(fieldId, formType, targetSoftware);
    const probe = await postProbe(agentBaseUrl, { fieldId, formType }, probeTimeoutMs, fetchImpl);
    const found = probe.ok && probe.body?.found === true;
    if (probe.ok || probe.status > 0) reachable = true;

    fieldResults.push({
      fieldId,
      humanLabel: mapping.humanLabel,
      found,
      reachable: probe.ok || probe.status > 0,
      status: probe.status,
      detail: probe.body?.error || probe.body?.message || probe.error?.message || null,
      body: probe.body || null,
    });
  }

  const foundCount = fieldResults.filter(result => result.found).length;
  const ready = reachable && foundCount > 0;
  let reason = null;

  if (!reachable) {
    reason = `${targetSoftware} agent is not reachable`;
  } else if (!ready) {
    reason = 'Live destination session is ready, but no probe field could be located';
  }

  return {
    targetSoftware,
    agentBaseUrl,
    reachable,
    ready,
    sessionReady: true,
    reason,
    foundCount,
    probedCount: fieldResults.length,
    fieldResults,
    sessionProbe,
  };
}
