# CACC Writer — Core vs Post-100 Scope Classification

Last updated: 2026-03-13
Reference: `docs/DEFINITION_OF_DONE.md` defines what 100% means.

---

## Classification Buckets

| Bucket | Meaning |
|--------|---------|
| **core-to-100** | Must be finished, working, and trusted before the product is considered complete. Maps directly to one of the ten Definition of Done conditions. |
| **post-100** | Valuable but not required for daily appraisal operations. Build only after the core OS is trusted in production use. |
| **defer / do-not-build-now** | Out of scope for the foreseeable future, or actively harmful to build before the core is stable. |

---

## Core-to-100

### Case Record & Workflow (DoD #1, #10)
| Feature | Status | Module |
|---------|--------|--------|
| Case creation with assignment details | Accepted (Phase B) | `server/caseRecord/*` |
| Workflow state machine | Accepted (Phase B) | `server/workflow/*` |
| Case projection and persistence | Accepted (Phase B) | `caseRecordService.js` |
| Quote/engagement → case creation linkage | Backend accepted (Phase I), **UI linkage needed** | `server/business/*` |
| Due-date dashboard tied to case status | Backend accepted (Phase I), **UI dashboard needed** | `pipelineService.js` |
| Case-header business status summary | **Needed** | — |
| Overdue/risk queue for upcoming deadlines | **Needed** | — |

### Document Intake & Extraction (DoD #2)
| Feature | Status | Module |
|---------|--------|--------|
| Document upload and classification | Accepted (Phase C) | `server/ingestion/*` |
| Extraction pipeline (PDF, text, structured) | Accepted (Phase C) | `documentParser.ts`, extractors |
| Extraction persistence | Accepted (Phase C) | DB schema |

### Fact Integrity & Verification (DoD #3)
| Feature | Status | Module |
|---------|--------|--------|
| Fact conflict engine | Accepted (Phase C) | `factConflictEngine.js` |
| Fact decision queue | Accepted (Phase C) | `factDecisionQueue.js` |
| Pre-draft gate enforcement | Accepted (Phase C) | `preDraftGate.js` |
| Missing-facts severity dashboard (1004) | **Needed** | — |
| Missing-facts severity dashboard (commercial) | **Needed** | — |

### Report Family & Workspace (DoD #4)
| Feature | Status | Module |
|---------|--------|--------|
| 1004 workspace definition (20 sections + 5 addenda) | Accepted (Phase D0) | `1004WorkspaceDefinition.js` |
| Commercial workspace definition | **Needs expansion by property type** | `server/workspace/*` |
| Scope enforcement (active/deferred) | Accepted | `productionScope.js` |
| Workspace projection service | Accepted (Phase D0) | `workspaceService.js` |

### Section Generation & Governance (DoD #5)
| Feature | Status | Module |
|---------|--------|--------|
| Section policy and prompt pinning | Accepted (Phase D) | `sectionPolicyService.js` |
| Section governance metadata | Accepted (Phase D) | `sectionGovernanceService.js` |
| Staleness invalidation on fact change | Accepted (Phase D) | `markSectionStale`, `invalidateDownstream` |
| Section governance cards in workspace UI | **Needed** — metadata exists in backend but not surfaced | — |
| "Ready to generate" / "ready to finalize" checklists | **Needed** | — |
| Section version compare / restore UX | **Needed** | — |
| 1004 all 10 priority sections generation | Done | `generatorProfiles.js` |
| Commercial all 5 priority sections generation | Done | `generatorProfiles.js` |

### Valuation Support (DoD #6)
| Feature | Status | Module |
|---------|--------|--------|
| Comparable intelligence and scoring | Accepted (Phase H) | `comparableIntelligence/*` |
| Comp-grid editor with slot management | Accepted (Phase H) | `compGridService.js` |
| Income approach support | Accepted (Phase H) | `incomeApproachService.js` |
| Cost approach support | Accepted (Phase H) | `costApproachService.js` |
| Reconciliation service | Accepted (Phase H) | `reconciliationService.js` |
| Unified valuation desk UX | **Needed** — services exist, integrated UI does not | — |
| Comp candidate queue with reason history | Backend accepted, **UI queue needed** | — |
| Adjustment support notebook | **Needed** | — |
| Contradiction/burden visibility per comp | **Needed** | — |
| Reconciliation memo builder | **Needed** | — |
| Exportable value support pack | **Needed** | — |

### QC & Contradiction Resolution (DoD #7)
| Feature | Status | Module |
|---------|--------|--------|
| QC run engine with severity model | Accepted (Phase E) | `server/qc/*` |
| Contradiction graph + resolution lifecycle | Accepted (Phase E) | `contradictionGraph/*` |
| Contradiction gate for finalization | Accepted (Phase E) | `contradictionGateService.js` |
| QC readiness signals in UI | Done | `index.html` |

### Insertion & Export (DoD #8)
| Feature | Status | Module |
|---------|--------|--------|
| ACI insertion with verification/readback | Accepted (Phase F) | `server/insertion/*` |
| Real Quantum insertion | Accepted (Phase F) | `server/insertion/*` |
| Replay/rollback for failed insertions | Accepted (Phase F) | `insertionRunEngine.js` |
| ACI insertion reliability summary panel | **Needed** — readback data exists, UI panel needed | — |
| Real Quantum insertion replay/operator UX | **Needed** — backend exists, operator UI needed | — |
| Bundle/PDF export | Accepted | `server/export/*` |

### Archive & Learning (DoD #9)
| Feature | Status | Module |
|---------|--------|--------|
| Completed-assignment archival | Accepted (Phase J) | `assignmentArchiveService.js` |
| Revision-diff learning | Accepted (Phase J) | `revisionDiffService.js` |
| Suggestion ranking from finalized work | Accepted (Phase J) | `suggestionRankingService.js` |
| Learning explanation per section | Accepted (Phase J) | `learningExplanationService.js` |
| Learning dashboard (acceptance/rejection metrics) | **Needed** | — |
| "Why this suggestion" drawer in workspace | **Needed** | — |
| Memory health tools (stale/duplicate/weak pruning) | **Needed** | — |

### System Reliability (DoD #10)
| Feature | Status | Module |
|---------|--------|--------|
| Electron desktop packaging | Done | `desktop/*` |
| RBAC/auth/encryption | Accepted (Phase K) | `server/security/*` |
| Backup/restore | Accepted (Phase K) | `backupRestoreService.js` |
| Backup scheduler UI | **Needed** | — |
| Restore verification workflow | **Needed** | — |
| Audit-log viewer for critical events | **Needed** | — |
| Machine migration runbook | **Needed** | — |

### Inspection Capture (DoD #2, #3, #10)
| Feature | Status | Module |
|---------|--------|--------|
| Inspection service with lifecycle | Accepted (Phase G) | `server/inspection/*` |
| Photo/measurement/condition capture | Accepted (Phase G) | Photo/measurement/condition services |
| Mobile-friendly inspection mode | **Needed** | — |
| Room/exterior checklist templates | **Needed** | — |
| Photo tagging by room/component | **Needed** | — |
| Voice note to observation flow | **Needed** | — |
| Post-inspection summary into prompt context | **Needed** | — |

### Cloudflare Research Pipeline (DoD #3, #6)
| Feature | Status | Module |
|---------|--------|--------|
| Crawl infrastructure (subject/comp/market) | Done | `server/dataPipeline/*`, `dataPipeline.js` |
| Crawl settings UI | Done | `index.html` Pipeline tab |
| Crawl preset library for appraisal sources | **Needed** | — |
| Extracted fact cards with provenance/conflict | **Needed** — raw extraction exists, structured cards do not | — |
| Duplicate detection | **Needed** | — |
| Verification queues for extracted web data | **Needed** | — |
| Push-to-case-facts with integrity review | Partial | `dataPipeline.js` |

### Golden-Path Validation
| Feature | Status | Module |
|---------|--------|--------|
| 1004 end-to-end case fixture | **Needed** | — |
| Commercial end-to-end case fixture | **Needed** | — |
| Automated validation harness | **Needed** | — |
| Golden path test plan | **Needed** | — |

---

## Post-100

These features are valuable but belong after the core appraisal OS is trusted in daily use.

| Feature | Reason for Post-100 |
|---------|---------------------|
| Multi-tenant SaaS operation | Personal business comes first; tenant separation is accepted (Phase L) but activation is post-100. |
| Feature flag management UI | Infrastructure exists (Phase L); management tooling is post-100. |
| Billing/subscription management | Infrastructure exists (Phase L); payment flows are post-100. |
| Client-facing portal | Not needed for personal operations. |
| Team collaboration / multi-user concurrent editing | Single appraiser first. |
| Advanced analytics / reporting dashboard (business metrics) | Nice to have after core workflow is solid. |
| API marketplace / third-party integrations | Post-100 extensibility. |
| White-label / rebranding capabilities | Post-100 commercialization. |
| Automated engagement letter generation | Useful but not in the critical path to completing assignments. |
| Public MLS integration (live feed) | Valuable but complex; manual upload covers the need at 100%. |
| MISMO XML export | Regulatory compliance expansion — not required for current daily operations. |
| Advanced report comparison (case-to-case) | Useful for review but not required for assignment completion. |
| Phrase blacklist / style preference enforcement in voice profiles | Refinement of learning system — post-100 polish. |
| Report-family-specific memory retrieval weighting | Learning refinement — post-100. |

---

## Defer / Do-Not-Build-Now

These are explicitly out of scope. Building them now would dilute focus from the core product.

| Feature | Reason |
|---------|--------|
| 1025 form family (Small Residential Income) | Deferred per `SCOPE.md`. Activate only after 1004 + commercial are production-trusted. |
| 1073 form family (Individual Condo Unit) | Deferred per `SCOPE.md`. Same activation gate. |
| 1004C form family (Manufactured Home) | Deferred per `SCOPE.md`. Same activation gate. |
| Multi-unit / condo / co-op specialized workflows | Beyond current form scope. |
| Mobile native app (iOS/Android) | Desktop Electron is the platform. Mobile-friendly web views for inspection are core-to-100; a native app is not. |
| AI-driven comparable selection | Violates "do not automate final comp decisions" rule. |
| Automated adjustment calculation | Violates "do not automate final adjustment decisions" rule. |
| Automated value opinion / final reconciliation | Violates "do not automate final value decisions" rule. |
| Hidden quality scoring that influences output without appraiser visibility | Violates "no hidden scoring logic" rule. |
| Real-time market data feeds | Infrastructure complexity without proportional value at this stage. |
| Blockchain-based report verification | No current business need. |
| Integration with specific AMC order platforms | Useful later, but manual intake covers the need now. |

---

## How to Use This Document

1. **Before starting new work**, find the feature in this document. If it is not listed, classify it into one of the three buckets and add it here before beginning.
2. **Core-to-100 items marked "Needed"** are the remaining work to reach 100%. Prioritize them according to the phase sequence in the roadmap.
3. **Post-100 items** should not be worked on until the Definition of Done conditions are all met.
4. **Defer items** should not be worked on at all until post-100 items are triaged and the core OS is changing daily business operations.
