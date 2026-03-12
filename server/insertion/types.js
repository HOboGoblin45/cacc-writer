/**
 * server/insertion/types.js
 * -------------------------
 * Phase 9: JSDoc type definitions for Destination Automation.
 *
 * These types define the contract for all Phase 9 modules.
 * No runtime code — pure type documentation.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {'aci' | 'real_quantum'} TargetSoftware
 */

/**
 * @typedef {'queued' | 'preparing' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'} InsertionRunStatus
 */

/**
 * @typedef {'queued' | 'formatting' | 'inserting' | 'inserted' | 'verified' | 'failed' | 'skipped' | 'fallback_used'} InsertionItemStatus
 */

/**
 * @typedef {'pending' | 'passed' | 'mismatch' | 'unreadable' | 'not_supported' | 'failed' | 'skipped'} VerificationStatus
 */

/**
 * @typedef {'agent_unreachable' | 'agent_timeout' | 'field_not_found' | 'insertion_rejected' | 'verification_mismatch' | 'format_error' | 'qc_blocked' | 'no_text' | 'unknown'} InsertionErrorCode
 */

/**
 * @typedef {'retry' | 'clipboard' | 'manual_prompt' | 'retry_then_clipboard' | 'skip'} FallbackStrategy
 */

/**
 * @typedef {'plain_text' | 'html' | 'rich_text'} FormattingMode
 */

// ── Destination Mapping ───────────────────────────────────────────────────────

/**
 * Resolved destination mapping for a single canonical field.
 * Produced by destinationMapper from fieldRegistry + agent field maps.
 *
 * @typedef {Object} DestinationMapping
 * @property {string} fieldId - Canonical field ID from fieldRegistry
 * @property {string} formType - Form type (e.g. '1004', 'commercial')
 * @property {TargetSoftware} targetSoftware - Target software
 * @property {string} destinationKey - Composite key: '{software}::{formType}::{fieldId}'
 * @property {string} humanLabel - Human-readable field label
 * @property {string} [agentFieldKey] - Key in the agent's field map (may differ from fieldId)
 * @property {FormattingMode} formattingMode - How to format text for this destination
 * @property {string} [tabName] - ACI tab name or RQ nav slug
 * @property {string} [editorTarget] - ACI class/label or RQ TinyMCE selector
 * @property {string} [verificationMode] - Agent verification method
 * @property {FallbackStrategy} fallbackStrategy - Default fallback strategy
 * @property {boolean} calibrated - Whether the agent field map entry is calibrated/verified
 * @property {boolean} supported - Whether this field has a known agent mapping
 */

/**
 * Per-destination capability flags.
 *
 * @typedef {Object} DestinationCapabilities
 * @property {boolean} supportsReadback - Agent can read back inserted text
 * @property {boolean} supportsRichText - Destination accepts HTML/rich text
 * @property {boolean} supportsPartialRetry - Can retry individual fields
 * @property {boolean} supportsAppendMode - Can append instead of replace
 * @property {boolean} requiresFocusTarget - Needs focus/tab navigation before insert
 */

// ── Destination Profile ───────────────────────────────────────────────────────

/**
 * Persisted destination profile / template.
 *
 * @typedef {Object} DestinationProfile
 * @property {string} id
 * @property {string} name
 * @property {TargetSoftware} targetSoftware
 * @property {string} formType
 * @property {string} [baseUrl] - Agent URL override
 * @property {DestinationCapabilities} capabilities
 * @property {DestinationProfileConfig} config
 * @property {boolean} active
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} DestinationProfileConfig
 * @property {number} [timeout] - Request timeout in ms
 * @property {number} [maxRetries] - Max retry attempts per field
 * @property {boolean} [verifyAfter] - Run verification after insertion
 * @property {FallbackStrategy} [defaultFallback] - Default fallback strategy
 * @property {string} [verificationMode] - Verification method
 * @property {number} [chromeDebugPort] - Chrome CDP port for RQ
 */

// ── Insertion Run ─────────────────────────────────────────────────────────────

/**
 * Configuration for an insertion run.
 *
 * @typedef {Object} InsertionRunConfig
 * @property {boolean} [dryRun=false] - Format and map but don't actually insert
 * @property {boolean} [verifyAfter=true] - Run verification after each insertion
 * @property {boolean} [skipQcBlockers=false] - Insert even if QC blockers exist
 * @property {boolean} [requireQcRun=false] - Require at least one completed QC run before insertion
 * @property {boolean} [requireFreshQcForGeneration=true] - When generationRunId is provided, require completed QC tied to the same generation run
 * @property {boolean} [qcOverrideAllowed=true] - Internal snapshot set at prepare-time; if false, skipQcBlockers cannot bypass the gate
 * @property {boolean} [forceReinsert=false] - Re-insert already-verified fields
 * @property {boolean} [rollbackOnVerificationFailure=true] - Restore the previous field value when read-back verification fails
 * @property {number} [maxRetries=3] - Max retry attempts per field
 * @property {FallbackStrategy} [defaultFallback='retry_then_clipboard']
 * @property {string[]} [fieldIds] - Specific fields to insert (null = all eligible)
 * @property {string} [destinationProfileId] - Override destination profile
 */

/**
 * Persisted insertion run entity.
 *
 * @typedef {Object} InsertionRun
 * @property {string} id
 * @property {string} caseId
 * @property {string} [generationRunId]
 * @property {string} formType
 * @property {TargetSoftware} targetSoftware
 * @property {InsertionRunStatus} status
 * @property {number} totalFields
 * @property {number} completedFields
 * @property {number} failedFields
 * @property {number} skippedFields
 * @property {number} verifiedFields
 * @property {string} [qcRunId]
 * @property {number} qcBlockerCount
 * @property {boolean} qcGatePassed
 * @property {InsertionRunConfig} config
 * @property {InsertionRunSummary} summary
 * @property {InsertionReplayPackage} [replayPackage]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {number} [durationMs]
 * @property {string} createdAt
 */

/**
 * Summary statistics for a completed insertion run.
 *
 * @typedef {Object} InsertionRunSummary
 * @property {number} totalFields
 * @property {number} inserted
 * @property {number} verified
 * @property {number} failed
 * @property {number} skipped
 * @property {number} fallbackUsed
 * @property {number} rollbackFields
 * @property {number} durationMs
 * @property {string[]} failedFieldIds
 * @property {string[]} mismatchFieldIds
 * @property {string} readinessSignal - 'ready' | 'needs_review' | 'incomplete' | 'failed'
 */

// ── Insertion Run Item ────────────────────────────────────────────────────────

/**
 * Persisted per-field insertion outcome.
 *
 * @typedef {Object} InsertionRunItem
 * @property {string} id
 * @property {string} insertionRunId
 * @property {string} caseId
 * @property {string} fieldId
 * @property {string} formType
 * @property {TargetSoftware} targetSoftware
 * @property {string} destinationKey
 * @property {InsertionItemStatus} status
 * @property {string} [canonicalText] - Approved/final text before formatting
 * @property {number} canonicalTextLength
 * @property {string} [formattedText] - Destination-specific formatted output
 * @property {number} formattedTextLength
 * @property {VerificationStatus} verificationStatus
 * @property {string} [verificationRaw] - Raw value from agent /read-field
 * @property {string} [verificationNormalized] - Normalized comparison value
 * @property {string} [verificationExpected] - Normalized expected text used in verification
 * @property {string} [preinsertRaw] - Raw field value before insertion
 * @property {string} [preinsertNormalized] - Normalized field value before insertion
 * @property {number} attemptCount
 * @property {number} maxAttempts
 * @property {string} [retryClass] - transport | destination | verification | mapping | data | unknown
 * @property {FallbackStrategy} [fallbackStrategy]
 * @property {boolean} fallbackUsed
 * @property {Object[]} attemptLog
 * @property {boolean} rollbackAttempted
 * @property {string} [rollbackStatus] - restored | failed | skipped
 * @property {string} [rollbackText]
 * @property {string} [rollbackErrorText]
 * @property {Object} [agentResponse] - Raw agent response
 * @property {InsertionErrorCode} [errorCode]
 * @property {string} [errorText]
 * @property {InsertionErrorDetail} [errorDetail]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {number} [durationMs]
 * @property {number} sortOrder
 * @property {string} createdAt
 */

/**
 * Structured failure detail.
 *
 * @typedef {Object} InsertionErrorDetail
 * @property {number} [agentStatus] - HTTP status from agent
 * @property {string} [agentMessage] - Error message from agent
 * @property {string} [stackTrace]
 * @property {string} [fieldState] - State of the field at time of failure
 */

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Input to a destination formatter.
 *
 * @typedef {Object} FormatInput
 * @property {string} canonicalText - The approved/final text
 * @property {string} fieldId - Canonical field ID
 * @property {string} formType
 * @property {TargetSoftware} targetSoftware
 * @property {FormattingMode} formattingMode
 * @property {DestinationMapping} mapping
 */

/**
 * Output from a destination formatter.
 *
 * @typedef {Object} FormatOutput
 * @property {string} formattedText - Destination-ready text
 * @property {FormattingMode} mode - Formatting mode used
 * @property {string[]} warnings - Any formatting warnings
 * @property {boolean} truncated - Whether text was truncated
 * @property {number} originalLength
 * @property {number} formattedLength
 */

// ── Verification ──────────────────────────────────────────────────────────────

/**
 * Result of a verification read-back check.
 *
 * @typedef {Object} VerificationResult
 * @property {VerificationStatus} status
 * @property {string} [rawValue] - Raw text read back from agent
 * @property {string} [normalizedValue] - Normalized for comparison
 * @property {string} [expectedNormalized] - Normalized expected text
 * @property {number} [similarityScore] - 0-1 similarity score
 * @property {string} [mismatchDetail] - Description of mismatch if any
 * @property {number} durationMs
 */

// ── QC Gate ───────────────────────────────────────────────────────────────────

/**
 * QC gate check result before insertion.
 *
 * @typedef {Object} QCGateResult
 * @property {boolean} passed - Whether the gate allows insertion
 * @property {string} [qcRunId] - QC run used for the check
 * @property {number} blockerCount - Number of blocker-severity findings
 * @property {number} highCount - Number of high-severity findings
 * @property {string[]} blockerMessages - Summary of blocker findings
 * @property {string[]} highMessages - Summary of high findings
 * @property {string} recommendation - 'proceed' | 'review_first' | 'blocked'
 * @property {string} [reason] - 'clean' | 'high_findings' | 'blocker_findings' | 'missing_qc_run' | 'missing_fresh_generation_qc' | 'no_qc_run'
 * @property {boolean} [overrideAllowed] - Whether skipQcBlockers may bypass this gate result
 */

// ── Mapping Preview ───────────────────────────────────────────────────────────

/**
 * Preview of a field mapping before insertion.
 * Shown to user for confirmation.
 *
 * @typedef {Object} MappingPreviewItem
 * @property {string} fieldId
 * @property {string} humanLabel
 * @property {TargetSoftware} targetSoftware
 * @property {string} destinationKey
 * @property {FormattingMode} formattingMode
 * @property {string} [tabName]
 * @property {string} textSnippet - First ~100 chars of canonical text
 * @property {number} textLength
 * @property {boolean} supported - Has agent mapping
 * @property {boolean} calibrated - Agent mapping is calibrated
 * @property {boolean} hasText - Has approved/final text to insert
 * @property {string} [previousInsertionStatus] - Status from last insertion attempt
 */

/**
 * Full mapping preview for a run.
 *
 * @typedef {Object} MappingPreview
 * @property {string} caseId
 * @property {string} formType
 * @property {TargetSoftware} targetSoftware
 * @property {string} destinationProfileId
 * @property {MappingPreviewItem[]} items
 * @property {number} totalFields
 * @property {number} supportedFields
 * @property {number} unsupportedFields
 * @property {number} fieldsWithText
 * @property {number} fieldsWithoutText
 * @property {number} alreadyVerified
 * @property {QCGateResult} [qcGate]
 */

/**
 * Replay package for deterministic re-run or manual remediation.
 *
 * @typedef {Object} InsertionReplayPackage
 * @property {string} runId
 * @property {string} caseId
 * @property {string} formType
 * @property {TargetSoftware} targetSoftware
 * @property {string} generatedAt
 * @property {{ failedCount: number, mismatchCount: number, rollbackCount: number }} summary
 * @property {Array<{
 *   fieldId: string,
 *   destinationKey: string,
 *   status: string,
 *   verificationStatus: string,
 *   retryClass: string,
 *   formattedText: string,
 *   preinsertRaw?: string,
 *   verificationRaw?: string,
 *   rollbackStatus?: string,
 *   errorCode?: string,
 *   errorText?: string,
 *   attemptLog?: Object[],
 * }>} items
 */

export default {};
