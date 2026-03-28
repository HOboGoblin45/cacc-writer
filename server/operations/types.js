/**
 * server/operations/types.js
 * ---------------------------
 * Phase 10 — Business Operations Layer
 *
 * JSDoc type definitions for all Phase 10 types.
 */

// ── Event Categories ──────────────────────────────────────────────────────────

/**
 * @typedef {'case' | 'generation' | 'qc' | 'insertion' | 'memory' | 'document' | 'system'} AuditCategory
 */

/**
 * @typedef {'info' | 'warn' | 'error'} AuditSeverity
 */

/**
 * @typedef {'user' | 'system' | 'agent' | 'orchestrator'} AuditActor
 */

/**
 * @typedef {'case' | 'generation_run' | 'section_job' | 'qc_run' | 'qc_finding' |
 *           'insertion_run' | 'insertion_item' | 'memory_item' | 'document' |
 *           'extraction' | 'fact'} EntityType
 */

// ── Event Types ───────────────────────────────────────────────────────────────

/**
 * @typedef {'case.created' | 'case.updated' | 'case.archived' | 'case.restored' |
 *           'case.deleted' | 'case.status_changed' | 'case.pipeline_advanced' |
 *           'case.facts_updated' |
 *           'assignment.context_built' | 'assignment.intelligence_updated' |
 *           'document.uploaded' | 'document.classified' | 'document.extracted' |
 *           'document.fact_reviewed' |
 *           'generation.run_started' | 'generation.run_completed' | 'generation.run_failed' |
 *           'generation.section_approved' | 'generation.section_rejected' |
 *           'generation.section_edited' |
 *           'memory.approved' | 'memory.rejected' | 'memory.deactivated' |
 *           'memory.reactivated' |
 *           'qc.run_started' | 'qc.run_completed' |
 *           'qc.finding_dismissed' | 'qc.finding_resolved' | 'qc.finding_reopened' |
 *           'insertion.run_started' | 'insertion.run_completed' | 'insertion.run_failed' |
 *           'insertion.item_verified' | 'insertion.item_retried' |
 *           'system.startup' | 'system.export_created' | 'system.health_check'
 * } AuditEventType
 */

// ── Timeline Icons ────────────────────────────────────────────────────────────

/**
 * @typedef {'create' | 'edit' | 'upload' | 'extract' | 'generate' | 'approve' |
 *           'reject' | 'qc' | 'insert' | 'verify' | 'archive' | 'restore' |
 *           'error' | 'info' | 'delete' | 'status' | 'memory' | 'dismiss'
 * } TimelineIcon
 */

// ── Core Types ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AuditEvent
 * @property {string} id
 * @property {AuditEventType} event_type
 * @property {AuditCategory} category
 * @property {string|null} case_id
 * @property {EntityType|null} entity_type
 * @property {string|null} entity_id
 * @property {AuditActor} actor
 * @property {string} summary
 * @property {Object} detail_json - Structured payload (before/after state, affected fields)
 * @property {AuditSeverity} severity
 * @property {string} created_at - ISO 8601 timestamp
 */

/**
 * @typedef {Object} CaseTimelineEvent
 * @property {string} id
 * @property {string} case_id
 * @property {AuditEventType} event_type
 * @property {AuditCategory} category
 * @property {string} summary
 * @property {EntityType|null} entity_type
 * @property {string|null} entity_id
 * @property {TimelineIcon|null} icon
 * @property {Object} detail_json
 * @property {string} created_at
 */

/**
 * @typedef {Object} OperationalMetric
 * @property {string} id
 * @property {string} metric_type
 * @property {string} period_start
 * @property {string} period_end
 * @property {Object} data_json
 * @property {string} created_at
 */

// ── Audit Logger Input ────────────────────────────────────────────────────────

/**
 * @typedef {Object} AuditEventInput
 * @property {AuditEventType} eventType
 * @property {AuditCategory} category
 * @property {string} [caseId]
 * @property {EntityType} [entityType]
 * @property {string} [entityId]
 * @property {AuditActor} [actor='user']
 * @property {string} summary
 * @property {Object} [detail={}]
 * @property {AuditSeverity} [severity='info']
 */

// ── Timeline Query Options ────────────────────────────────────────────────────

/**
 * @typedef {Object} TimelineQueryOptions
 * @property {string} caseId
 * @property {AuditCategory} [category]
 * @property {number} [limit=50]
 * @property {number} [offset=0]
 * @property {string} [since] - ISO 8601 timestamp
 * @property {string} [until] - ISO 8601 timestamp
 */

// ── Audit Query Options ───────────────────────────────────────────────────────

/**
 * @typedef {Object} AuditQueryOptions
 * @property {string} [caseId]
 * @property {AuditCategory} [category]
 * @property {AuditEventType} [eventType]
 * @property {EntityType} [entityType]
 * @property {string} [entityId]
 * @property {AuditSeverity} [severity]
 * @property {string} [since]
 * @property {string} [until]
 * @property {number} [limit=100]
 * @property {number} [offset=0]
 */

// ── Metrics Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DailySummaryMetric
 * @property {number} casesCreated
 * @property {number} casesArchived
 * @property {number} generationRunsStarted
 * @property {number} generationRunsCompleted
 * @property {number} generationRunsFailed
 * @property {number} sectionsGenerated
 * @property {number} sectionsApproved
 * @property {number} qcRunsCompleted
 * @property {number} qcFindingsTotal
 * @property {number} qcFindingsResolved
 * @property {number} insertionRunsCompleted
 * @property {number} insertionItemsVerified
 * @property {number} memoryItemsApproved
 * @property {number} documentsUploaded
 */

/**
 * @typedef {Object} CaseThroughputMetric
 * @property {number} avgDaysToComplete
 * @property {number} medianDaysToComplete
 * @property {number} casesCompleted
 * @property {number} casesInProgress
 */

// ── Health Diagnostics ────────────────────────────────────────────────────────

/**
 * @typedef {'healthy' | 'degraded' | 'unavailable' | 'offline'} ServiceHealthStatus
 */

/**
 * @typedef {Object} ServiceHealth
 * @property {ServiceHealthStatus} status
 * @property {string} [detail]
 */

/**
 * @typedef {Object} HealthDiagnosticsResult
 * @property {ServiceHealth} database
 * @property {ServiceHealth} documentStorage
 * @property {ServiceHealth} orchestrator
 * @property {ServiceHealth} qcEngine
 * @property {ServiceHealth} aciAgent
 * @property {ServiceHealth} rqAgent
 * @property {Object} dbStats - Table counts, DB size, WAL size
 * @property {string} checkedAt
 */

// ── Retention ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RetentionPolicy
 * @property {number|null} auditEventsDays - null = unlimited
 * @property {number|null} operationalMetricsDays - null = unlimited
 * @property {number|null} retrievalCacheHours - default 1 hour
 * @property {boolean} archivePreservesHistory - default true
 */

/**
 * @typedef {Object} RetentionResult
 * @property {number} auditEventsPurged
 * @property {number} metricsPurged
 * @property {number} cacheEntriesPurged
 * @property {string} executedAt
 */

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CaseExportManifest
 * @property {string} caseId
 * @property {string} exportedAt
 * @property {string} appVersion
 * @property {Object} caseMetadata
 * @property {Object} assignmentIntelligence
 * @property {Object} documentManifest
 * @property {Object} extractionSummary
 * @property {Array} generationRunHistory
 * @property {Array} qcHistory
 * @property {Array} insertionRunHistory
 * @property {Array} auditEvents
 * @property {Object} healthSnapshot
 */

/**
 * @typedef {Object} DashboardData
 * @property {Object} overview - Total cases, active, archived, etc.
 * @property {Object} recentActivity - Last N audit events
 * @property {Object} throughput - Cases completed per period
 * @property {Object} generationStats - Success/fail rates
 * @property {Object} qcStats - Findings by severity
 * @property {Object} insertionStats - Success/verify rates
 * @property {Object} health - Current service health
 */

export default {};
