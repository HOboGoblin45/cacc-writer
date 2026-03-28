/**
 * server/ai/stmNormalizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * STM (Section Text Munger) Output Normalizer
 *
 * Runs inline between AI output and scoring to clean, normalize, and optionally
 * fix AI-generated section text. Three-pass processing:
 *
 * 1. Regex cleanup (always): Strip preambles, postambles, enforce voice, etc.
 * 2. Character limit enforcement: Truncate intelligently if needed
 * 3. Optional LLM pass: Route to narrativeRewriter for synthesis/analysis sections
 *
 * Metrics collection tracks original length, cleaning changes, truncation, and
 * whether the LLM pass was used.
 */

import log from '../logger.js';
import { rewriteSection, REWRITE_MODES } from './narrativeRewriter.js';

/**
 * AI preamble patterns — common artifacts from various AI models
 */
const PREAMBLE_PATTERNS = [
  /^Sure,\s+here\s+is/i,
  /^Here's\s+the/i,
  /^Certainly[!.]/i,
  /^Of\s+course[!.]/i,
  /^Based\s+on\s+the\s+information\s+provided,/i,
  /^I'll\s+write/i,
  /^Let\s+me\s+write/i,
  /^Here\s+is\s+the/i,
  /^The\s+following\s+is/i,
  /^This\s+is\s+the/i,
];

/**
 * AI postamble patterns — common endings from various AI models
 */
const POSTAMBLE_PATTERNS = [
  /\s+Let\s+me\s+know\s+if\s+you.*(?=[.!?]|$)/i,
  /\s+Feel\s+free\s+to\s+ask.*(?=[.!?]|$)/i,
  /\s+I\s+hope\s+this\s+helps.*(?=[.!?]|$)/i,
  /\s+Please\s+let\s+me\s+know.*(?=[.!?]|$)/i,
  /\s+Is\s+there\s+anything\s+else.*(?=[.!?]|$)/i,
  /\s+Thank\s+you.*(?=[.!?]|$)/i,
  /\s+Best\s+regards.*(?=[.!?]|$)/i,
  /\s+Feel\s+free.*$/i,
  /\s+Let\s+me\s+know.*$/i,
];

/**
 * Professional voice replacements for appraisal context
 */
const VOICE_REPLACEMENTS = [
  { pattern: /\bthe\s+home\b/gi, replacement: 'the subject property' },
  { pattern: /\bthe\s+house\b/gi, replacement: 'the subject' },
  { pattern: /\bthis\s+house\b/gi, replacement: 'the subject dwelling' },
  { pattern: /\bbuyers?\b/gi, replacement: 'purchasers' },
  { pattern: /\bseller\b/gi, replacement: 'seller' },
  { pattern: /\bvendor\b/gi, replacement: 'vendor' },
];

/**
 * Markdown/formatting artifacts that shouldn't be in appraisal text
 */
const MARKDOWN_ARTIFACTS = [
  /\*\*/g, // bold markers
  /__/g,   // bold markers
  /##\s*/g, // headers
  /###\s*/g,
  /####\s*/g,
  /`+/g,    // code backticks
];

/**
 * Strip leading preambles from AI output
 */
function stripPreambles(text) {
  let cleaned = text;
  for (const pattern of PREAMBLE_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '').trim();
      break; // Only strip first matching preamble
    }
  }
  return cleaned;
}

/**
 * Strip trailing postambles from AI output
 */
function stripPostambles(text) {
  let cleaned = text;
  for (const pattern of POSTAMBLE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }
  return cleaned;
}

/**
 * Enforce professional appraisal voice
 */
function enforceProfessionalVoice(text) {
  let cleaned = text;
  for (const { pattern, replacement } of VOICE_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned;
}

/**
 * Remove markdown artifacts
 */
function stripMarkdownArtifacts(text) {
  let cleaned = text;
  for (const pattern of MARKDOWN_ARTIFACTS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

/**
 * Normalize whitespace: double spaces, excessive newlines
 */
function normalizeWhitespace(text) {
  let cleaned = text
    // Normalize CRLF to LF first (before single \r handling)
    .replace(/\r\n/g, '\n')
    // Convert any remaining \r to \n
    .replace(/\r/g, '\n')
    // Convert smart quotes to straight quotes
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Remove double spaces (but preserve intentional paragraph breaks)
    .replace(/  +/g, ' ')
    // Collapse excessive newlines (> 2 consecutive)
    .replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Find the last sentence boundary before a maximum character position
 */
function findSentenceBoundary(text, maxChars) {
  if (text.length <= maxChars) {
    return text.length;
  }

  // Look backwards from maxChars for sentence-ending punctuation
  let searchText = text.substring(0, maxChars);

  // Prefer period, then exclamation, then question mark
  for (const delimiter of ['.', '!', '?']) {
    const lastIndex = searchText.lastIndexOf(delimiter);
    if (lastIndex > maxChars * 0.7) {
      // Accept if it's in the last 30% of the window
      return lastIndex + 1;
    }
  }

  // Fallback: look for space (word boundary)
  const lastSpace = searchText.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.7) {
    return lastSpace;
  }

  // Last resort: hard truncation
  return maxChars;
}

/**
 * Truncate text intelligently at sentence/word boundary
 */
function truncateIntelligently(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const boundary = findSentenceBoundary(text, maxChars);
  const truncated = text.substring(0, boundary).trim();

  return { text: truncated, truncated: true };
}

/**
 * Compute simple quality heuristics for LLM pass decision
 */
function computeQualityHeuristics(text) {
  const placeholderCount = (text.match(/\[INSERT\]/gi) || []).length;
  const wordCount = text.split(/\s+/).length;
  const hasShortText = wordCount < 20;
  const hasExcessivePlaceholders = placeholderCount >= 2;

  return {
    placeholderCount,
    wordCount,
    hasShortText,
    hasExcessivePlaceholders,
  };
}

/**
 * Main normalizer function
 *
 * @param {string} rawText — Raw AI output text
 * @param {object} options — Configuration
 *   @param {string} [options.sectionId] — Section identifier for routing
 *   @param {string} [options.formType] — Form type (1004, 1025, etc.)
 *   @param {number} [options.maxChars] — Maximum character limit (optional)
 *   @param {boolean} [options.enableLlmPass] — Enable LLM fix_issues pass (default: false)
 *   @param {number} [options.qualityThreshold] — Quality score threshold (0-1, default: 0.7)
 *   @param {string} [options.userId] — User ID for database operations
 *   @param {string} [options.caseId] — Case ID for LLM pass context
 * @returns {Promise<object>} { text, metrics: { ... } }
 */
export async function normalizeOutput(rawText, options = {}) {
  const startTime = Date.now();
  const {
    sectionId,
    formType,
    maxChars,
    enableLlmPass = false,
    qualityThreshold = 0.7,
    caseId,
  } = options;

  // Track original state
  const originalLength = (rawText || '').length;
  const originalText = rawText || '';
  let metrics = {
    originalLength,
    cleanedLength: 0,
    truncated: false,
    regexChanges: 0,
    llmPassUsed: false,
    preambleStripped: false,
    postambleStripped: false,
    durationMs: 0,
  };

  try {
    // ── Pass 1: Regex cleanup ────────────────────────────────────────────────

    let text = originalText;

    // Check for preambles
    const beforePreamble = text;
    text = stripPreambles(text);
    if (text !== beforePreamble) {
      metrics.preambleStripped = true;
      metrics.regexChanges += 1;
    }

    // Strip markdown artifacts (before voice replacement so word boundaries work)
    const beforeMarkdown = text;
    text = stripMarkdownArtifacts(text);
    if (text !== beforeMarkdown) {
      metrics.regexChanges += 1;
    }

    // Enforce professional voice (after markdown removal for proper word boundaries)
    const beforeVoice = text;
    text = enforceProfessionalVoice(text);
    if (text !== beforeVoice) {
      metrics.regexChanges += 1;
    }

    // Check for postambles (after voice enforcement)
    const beforePostamble = text;
    text = stripPostambles(text);
    if (text !== beforePostamble) {
      metrics.postambleStripped = true;
      metrics.regexChanges += 1;
    }

    // Normalize whitespace (including quote and CRLF normalization)
    const beforeNormalize = text;
    text = normalizeWhitespace(text);
    if (text !== beforeNormalize) {
      metrics.regexChanges += 1;
    }

    // ── Pass 2: Character limit enforcement ──────────────────────────────────

    if (maxChars && text.length > maxChars) {
      const { text: truncated, truncated: wasTruncated } = truncateIntelligently(text, maxChars);
      text = truncated;
      metrics.truncated = wasTruncated;
      if (wasTruncated) {
        log.warn('stm:truncated', {
          sectionId,
          originalChars: originalLength,
          truncatedChars: text.length,
          maxChars,
        });
      }
    }

    metrics.cleanedLength = text.length;

    // ── Pass 3: Optional LLM cleanup pass ────────────────────────────────────

    if (enableLlmPass && caseId && sectionId) {
      const heuristics = computeQualityHeuristics(text);
      const estimatedQuality = 1.0
        - (heuristics.placeholderCount * 0.15)
        - (heuristics.hasShortText ? 0.2 : 0)
        - (heuristics.hasExcessivePlaceholders ? 0.25 : 0);

      if (estimatedQuality < qualityThreshold) {
        try {
          const rewriteResult = await rewriteSection(caseId, sectionId, {
            mode: 'fix_issues',
            issues: [
              heuristics.hasShortText ? 'Section too short, expand with more detail' : null,
              heuristics.hasExcessivePlaceholders ? `${heuristics.placeholderCount} unresolved placeholders detected` : null,
            ].filter(Boolean),
          });

          if (rewriteResult?.rewritten) {
            text = rewriteResult.rewritten;
            metrics.llmPassUsed = true;
            log.info('stm:llmpass_applied', {
              sectionId,
              estimatedQualityBefore: estimatedQuality.toFixed(2),
              lengthBefore: metrics.cleanedLength,
              lengthAfter: text.length,
            });
          }
        } catch (err) {
          // LLM pass is optional — log failure but don't throw
          log.warn('stm:llmpass_failed', {
            sectionId,
            error: err.message,
          });
        }
      }
    }

    // ── Final result ─────────────────────────────────────────────────────────

    metrics.cleanedLength = text.length;
    metrics.durationMs = Date.now() - startTime;

    return {
      text,
      metrics,
    };
  } catch (err) {
    log.error('stm:normalizer_error', {
      sectionId,
      error: err.message,
      originalLength,
    });
    // On error, return original text with error flag
    metrics.durationMs = Date.now() - startTime;
    return {
      text: originalText,
      metrics: {
        ...metrics,
        error: err.message,
      },
    };
  }
}

export default { normalizeOutput };
