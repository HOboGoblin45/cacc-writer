/**
 * server/insertion/fallbackHandler.js
 * -------------------------------------
 * Phase 9: Fallback and recovery logic for failed insertions.
 *
 * Strategies:
 *   retry               — retry the same insertion method
 *   clipboard           — copy text to clipboard for manual paste
 *   manual_prompt       — surface to user for manual intervention
 *   retry_then_clipboard — retry N times, then fall back to clipboard
 *   skip                — skip this field entirely
 */

/**
 * Determine the next action for a failed insertion item.
 *
 * @param {Object} params
 * @param {string} params.fallbackStrategy - Configured fallback strategy
 * @param {number} params.attemptCount - Current attempt count
 * @param {number} params.maxAttempts - Max retry attempts
 * @param {string} params.errorCode - Error code from the failure
 * @param {string} params.targetSoftware - Target software
 * @returns {FallbackDecision}
 */
export function decideFallback({
  fallbackStrategy = 'retry_then_clipboard',
  attemptCount = 1,
  maxAttempts = 3,
  errorCode = 'unknown',
  targetSoftware = 'aci',
}) {
  // Errors that should not be retried
  const noRetryErrors = new Set([
    'field_not_found',    // Field doesn't exist in the agent's map
    'format_error',       // Text formatting failed
    'qc_blocked',         // QC gate blocked this field
    'no_text',            // No text to insert
  ]);

  // Errors where retry might help
  const retryableErrors = new Set([
    'agent_unreachable',
    'agent_timeout',
    'insertion_rejected',
    'unknown',
  ]);

  // If the error is non-retryable, go straight to fallback
  if (noRetryErrors.has(errorCode)) {
    if (errorCode === 'field_not_found' || errorCode === 'no_text') {
      return {
        action: 'skip',
        reason: `Non-retryable error: ${errorCode}`,
        shouldRetry: false,
        shouldClipboard: false,
        shouldPromptUser: false,
      };
    }
    return {
      action: 'manual_prompt',
      reason: `Non-retryable error: ${errorCode} — requires manual intervention`,
      shouldRetry: false,
      shouldClipboard: false,
      shouldPromptUser: true,
    };
  }

  switch (fallbackStrategy) {
    case 'retry':
      if (attemptCount < maxAttempts) {
        return {
          action: 'retry',
          reason: `Attempt ${attemptCount}/${maxAttempts} — retrying`,
          shouldRetry: true,
          shouldClipboard: false,
          shouldPromptUser: false,
        };
      }
      return {
        action: 'manual_prompt',
        reason: `All ${maxAttempts} retry attempts exhausted`,
        shouldRetry: false,
        shouldClipboard: false,
        shouldPromptUser: true,
      };

    case 'clipboard':
      return {
        action: 'clipboard',
        reason: 'Falling back to clipboard copy',
        shouldRetry: false,
        shouldClipboard: true,
        shouldPromptUser: true,
      };

    case 'retry_then_clipboard':
      if (attemptCount < maxAttempts) {
        return {
          action: 'retry',
          reason: `Attempt ${attemptCount}/${maxAttempts} — retrying before clipboard fallback`,
          shouldRetry: true,
          shouldClipboard: false,
          shouldPromptUser: false,
        };
      }
      return {
        action: 'clipboard',
        reason: `All ${maxAttempts} retry attempts exhausted — falling back to clipboard`,
        shouldRetry: false,
        shouldClipboard: true,
        shouldPromptUser: true,
      };

    case 'manual_prompt':
      return {
        action: 'manual_prompt',
        reason: 'Manual intervention requested',
        shouldRetry: false,
        shouldClipboard: false,
        shouldPromptUser: true,
      };

    case 'skip':
      return {
        action: 'skip',
        reason: 'Field skipped per fallback strategy',
        shouldRetry: false,
        shouldClipboard: false,
        shouldPromptUser: false,
      };

    default:
      // Default: retry once, then prompt
      if (attemptCount < 2) {
        return {
          action: 'retry',
          reason: 'Default fallback: one retry attempt',
          shouldRetry: true,
          shouldClipboard: false,
          shouldPromptUser: false,
        };
      }
      return {
        action: 'manual_prompt',
        reason: 'Default fallback: manual intervention after retry',
        shouldRetry: false,
        shouldClipboard: false,
        shouldPromptUser: true,
      };
  }
}

/**
 * Copy text to system clipboard via agent.
 * Falls back to returning the text for manual copy.
 *
 * @param {string} text - Text to copy
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @param {string} agentBaseUrl
 * @returns {Promise<ClipboardResult>}
 */
export async function copyToClipboard(text, targetSoftware, agentBaseUrl) {
  try {
    // Try agent clipboard endpoint if available
    const response = await fetch(`${agentBaseUrl}/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        success: true,
        method: 'agent_clipboard',
        message: 'Text copied to clipboard via agent',
      };
    }
  } catch {
    // Agent doesn't support clipboard — that's fine
  }

  // Return the text for the UI to handle clipboard copy
  return {
    success: false,
    method: 'manual',
    message: 'Text available for manual clipboard copy in the UI',
    text,
  };
}

/**
 * @typedef {Object} FallbackDecision
 * @property {'retry' | 'clipboard' | 'manual_prompt' | 'skip'} action
 * @property {string} reason
 * @property {boolean} shouldRetry
 * @property {boolean} shouldClipboard
 * @property {boolean} shouldPromptUser
 */

/**
 * @typedef {Object} ClipboardResult
 * @property {boolean} success
 * @property {'agent_clipboard' | 'manual'} method
 * @property {string} message
 * @property {string} [text] - Text for manual copy (only if success=false)
 */
