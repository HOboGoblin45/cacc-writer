/**
 * server/insertion/agentClient.js
 * --------------------------------
 * Thin client for legacy insertion agents.
 *
 * Normalizes the live HTTP contract used by:
 *   - desktop_agent/agent.py
 *   - real_quantum_agent/agent.py
 *
 * Both agents expect { fieldId, text, formType } for inserts and
 * { fieldId, formType, targetRect? } for read-back.
 * ACI v3 also accepts an optional `section` hint for nested field maps.
 */

function buildError(response, fallbackMessage, body, text) {
  const message = body?.error || body?.message || text || fallbackMessage;
  const err = new Error(message);
  err.httpStatus = response.status;
  err.responseBody = body;
  return err;
}

function normalizeInsertSuccess(body) {
  if (body?.success === true) return true;
  if (body?.inserted === true) return true;
  if (body?.ok === true && body?.inserted !== false && !body?.error) return true;
  return false;
}

export async function callAgentInsert({
  fieldId,
  text,
  formType,
  section = null,
  agentBaseUrl,
  timeout = 15000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${agentBaseUrl}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldId,
        text,
        formType,
        ...(section ? { section } : {}),
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : {};
    } catch {
      body = null;
    }

    if (!response.ok) {
      throw buildError(response, 'Agent rejected insertion', body, responseText);
    }

    const success = normalizeInsertSuccess(body);
    return {
      success,
      message: body?.message || body?.error || '',
      errorCode: success ? null : 'insertion_rejected',
      httpStatus: response.status,
      ...(body && typeof body === 'object' ? body : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function readFieldFromAgent({
  fieldId,
  formType,
  agentBaseUrl,
  section = null,
  targetRect = null,
  timeout = 10000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${agentBaseUrl}/read-field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldId,
        formType,
        ...(section ? { section } : {}),
        targetRect,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : {};
    } catch {
      body = null;
    }

    if (!response.ok) {
      throw buildError(response, 'Agent read-back failed', body, responseText);
    }

    if (body?.ok === false || body?.success === false) {
      throw new Error(body?.error || body?.message || 'Agent read-back failed');
    }

    if (typeof body?.text === 'string') return body.text;
    if (typeof body?.value === 'string') return body.value;
    if (body?.value !== undefined && body?.value !== null) return String(body.value);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
