/**
 * server/qc/types.js
 * --------------------
 * Phase 7 — QC Type Definitions (JSDoc)
 *
 * Canonical type definitions for the QC subsystem.
 * These are JSDoc typedefs — no runtime code, just documentation contracts.
 */

/**
 * @typedef {'blocker' | 'high' | 'medium' | 'low' | 'advisory'} QCSeverity
 */

/**
 * @typedef {'completeness' | 'consistency' | 'assignment_context' | 'section_quality' |
 *           'compliance_signal' | 'placeholder' | 'reconciliation' | 'canonical_field' |
 *           'report_family' | 'unsupported_certainty' | 'general'} QCCategory
 */

/**
 * @typedef {'open' | 'dismissed' | 'resolved'} QCFindingStatus
 */

/**
 * @typedef {'pending' | 'running' | 'completed' | 'failed'} QCRunStatus
 */

/**
 * @typedef {'ready' | 'needs_review' | 'needs_major_work' | 'not_ready' | 'unknown'} DraftReadinessSignal
 */

/**
 * @typedef {'deterministic' | 'heuristic' | 'pattern' | 'llm_assisted'} QCRuleType
 */

/**
 * QC Rule Definition — a single inspectable QC check.
 *
 * @typedef {Object} QCRuleDefinition
 * @property {string}        ruleId                  — unique rule identifier
 * @property {string}        displayName             — human-readable name
 * @property {QCCategory}    category                — rule category
 * @property {QCSeverity}    defaultSeverity         — default severity if triggered
 * @property {string}        scope                   — 'section' | 'cross_section' | 'draft_package' | 'assignment'
 * @property {string[]}      applicableReportFamilies — which report families this rule applies to (empty = all)
 * @property {string[]}      applicableCanonicalFields — which canonical fields this rule checks (empty = all/none)
 * @property {string[]}      applicableFlags          — which assignment flags make this rule relevant (empty = always)
 * @property {string[]}      requiredInputs           — what data the rule needs: 'sections' | 'context' | 'flags' | 'plan' | 'compliance'
 * @property {QCRuleType}    ruleType                 — deterministic | heuristic | pattern | llm_assisted
 * @property {string|null}   sourceReference          — future hook for guideline citation
 * @property {boolean}       active                   — whether the rule is currently enabled
 * @property {string}        description              — brief description of what the rule checks
 * @property {Function}      check                    — the check function: (context: QCRuleContext) => QCCheckResult[]
 */

/**
 * QC Rule Context — all inputs available to a rule's check function.
 *
 * @typedef {Object} QCRuleContext
 * @property {string}        caseId
 * @property {Object}        assignmentContext        — NormalizedAssignmentContext v2
 * @property {Object}        flags                    — DerivedAssignmentFlags
 * @property {Object}        compliance               — ComplianceProfile
 * @property {Object}        sectionPlan              — SectionPlanV2
 * @property {Object}        reportFamily             — ReportFamilyManifest subset
 * @property {Object}        canonicalFields          — { applicable: [], byGroup: {} }
 * @property {Object}        draftPackage             — assembled draft package
 * @property {Object<string, { text: string, ok: boolean }>} sections — section texts keyed by sectionId
 * @property {string}        formType
 * @property {string}        reportFamilyId
 */

/**
 * QC Check Result — output of a single rule evaluation.
 * A rule can produce zero or more results.
 *
 * @typedef {Object} QCCheckResult
 * @property {string}        ruleId
 * @property {QCSeverity}    severity
 * @property {QCCategory}    category
 * @property {string[]}      sectionIds               — affected section IDs
 * @property {string[]}      canonicalFieldIds         — affected canonical field IDs
 * @property {string}        message                   — brief human-readable message
 * @property {string}        [detailMessage]           — longer explanation
 * @property {string}        [suggestedAction]         — what the user should do
 * @property {QCEvidencePayload} [evidence]            — structured evidence
 * @property {string[]}      [sourceRefs]              — guideline references
 */

/**
 * QC Evidence Payload — structured evidence for a finding.
 *
 * @typedef {Object} QCEvidencePayload
 * @property {string}        [type]                    — 'text_match' | 'missing_field' | 'value_conflict' | 'pattern_match' | 'threshold'
 * @property {string}        [expectedValue]
 * @property {string}        [actualValue]
 * @property {string[]}      [matchedPatterns]
 * @property {string[]}      [conflictingSections]
 * @property {string}        [excerpt]                 — relevant text excerpt
 * @property {number}        [charCount]
 * @property {number}        [threshold]
 */

/**
 * QC Finding — a persisted finding from a QC run.
 *
 * @typedef {Object} QCFinding
 * @property {string}        id
 * @property {string}        qcRunId
 * @property {string}        ruleId
 * @property {QCSeverity}    severity
 * @property {QCCategory}    category
 * @property {string[]}      sectionIds
 * @property {string[]}      canonicalFieldIds
 * @property {string}        message
 * @property {string|null}   detailMessage
 * @property {string|null}   suggestedAction
 * @property {QCEvidencePayload} evidence
 * @property {string[]}      sourceRefs
 * @property {QCFindingStatus} status
 * @property {string|null}   resolutionNote
 * @property {string|null}   dismissedAt
 * @property {string|null}   resolvedAt
 * @property {string}        createdAt
 */

/**
 * QC Run — a persisted QC evaluation run.
 *
 * @typedef {Object} QCRun
 * @property {string}        id
 * @property {string}        caseId
 * @property {string|null}   generationRunId
 * @property {string|null}   draftPackageId
 * @property {QCRunStatus}   status
 * @property {string}        ruleSetVersion
 * @property {string|null}   reportFamily
 * @property {string|null}   formType
 * @property {Object}        flagsSnapshot
 * @property {QCSummary}     summary
 * @property {number}        totalRulesEvaluated
 * @property {number}        totalFindings
 * @property {number}        blockerCount
 * @property {number}        highCount
 * @property {number}        mediumCount
 * @property {number}        lowCount
 * @property {number}        advisoryCount
 * @property {DraftReadinessSignal} draftReadiness
 * @property {number}        durationMs
 * @property {string|null}   errorText
 * @property {string|null}   startedAt
 * @property {string|null}   completedAt
 * @property {string}        createdAt
 */

/**
 * QC Summary — rolled-up summary of a QC run.
 *
 * @typedef {Object} QCSummary
 * @property {number}        totalFindings
 * @property {{ blocker: number, high: number, medium: number, low: number, advisory: number }} bySeverity
 * @property {Object<string, number>} byCategory
 * @property {string[]}      missingRequiredSections
 * @property {string[]}      missingCommentaryFamilies
 * @property {number}        crossSectionConflicts
 * @property {number}        placeholderIssues
 * @property {string[]}      topReviewRisks
 * @property {string[]}      fieldsNeedingAttention
 * @property {string[]}      clearedSections
 * @property {DraftReadinessSignal} draftReadiness
 */

/**
 * QC Review Action — user action on a finding.
 *
 * @typedef {Object} QCReviewAction
 * @property {string}        findingId
 * @property {'dismiss' | 'resolve'} action
 * @property {string}        [note]
 */

export default {};
