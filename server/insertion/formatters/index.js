/**
 * server/insertion/formatters/index.js
 * --------------------------------------
 * Phase 9: Formatter dispatcher.
 *
 * Routes formatting requests to the appropriate destination-specific formatter.
 * Keeps canonical text separate from formatted output.
 */

import { formatForAci } from './aciFormatter.js';
import { formatForRq } from './rqFormatter.js';

/**
 * Format canonical text for a specific destination.
 *
 * @param {import('../types.js').FormatInput} input
 * @returns {import('../types.js').FormatOutput}
 */
export function formatForDestination(input) {
  const { targetSoftware } = input;

  switch (targetSoftware) {
    case 'aci':
      return formatForAci(input);

    case 'real_quantum':
      return formatForRq(input);

    default:
      return {
        formattedText: input.canonicalText || '',
        mode: 'plain_text',
        warnings: [`Unknown target software: ${targetSoftware} — returning canonical text unmodified`],
        truncated: false,
        originalLength: (input.canonicalText || '').length,
        formattedLength: (input.canonicalText || '').length,
      };
  }
}

/**
 * Get the formatting mode for a target software.
 *
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @returns {import('../types.js').FormattingMode}
 */
export function getFormattingMode(targetSoftware) {
  switch (targetSoftware) {
    case 'aci': return 'plain_text';
    case 'real_quantum': return 'html';
    default: return 'plain_text';
  }
}
