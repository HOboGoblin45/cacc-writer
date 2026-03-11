# Phase 10 — Business Operations Layer

## Status: COMPLETE ✅

## Decisions
- No new top-level Ops tab — integrate into existing workflows
- Audit only meaningful state changes (not every API call)
- Unlimited retention by default for operational history
- Structured key exports by default (not full DB snapshot)
- Case-scoped history first, global dashboards second
- Archive = hidden + retained + restorable (not destructive)

## Steps

- [x] 1. Create Phase 10 SQLite schema migration (`server/migration/phase10Schema.js`)
- [x] 2. Wire schema into `server/db/schema.js`
- [x] 3. Create Phase 10 type definitions (`server/operations/types.js`)
- [x] 4. Create audit logger (`server/operations/auditLogger.js`)
- [x] 5. Create operations repository (`server/operations/operationsRepo.js`)
- [x] 6. Create case timeline builder (`server/operations/caseTimeline.js`)
- [x] 7. Create metrics collector (`server/operations/metricsCollector.js`)
- [x] 8. Create health diagnostics (`server/operations/healthDiagnostics.js`)
- [x] 9. Create retention manager (`server/operations/retentionManager.js`)
- [x] 10. Create export enhancer (`server/operations/exportEnhancer.js`)
- [x] 11. Create dashboard builder (`server/operations/dashboardBuilder.js`)
- [x] 12. Create REST endpoints (`server/api/operationsRoutes.js`)
- [x] 13. Wire routes + audit middleware into `cacc-writer-server.js`
- [x] 14. Add audit hooks to existing route files
- [x] 15. Update `server/db/database.js` getTableCounts
- [x] 16. Add case timeline UI to Case tab in `index.html`
- [x] 17. Add timeline/operations JS logic to `app.js`
- [x] 18. Restart server and verify all endpoints
- [x] 19. Test audit trail, timeline, metrics, health, export

## Test Results (2026-03-10)

### Phase 10 API Endpoints — All Passing ✅
| Endpoint | Method | Status | Notes |
|---|---|---|---|
| `/api/operations/health/quick` | GET | 200 | Returns `{"status":"healthy"}` |
| `/api/operations/health/diagnostics` | GET | 200 | DB, doc storage, disk checks |
| `/api/operations/audit` | GET | 200 | Query audit events with filters |
| `/api/operations/audit/types` | GET | 200 | Returns distinct event types |
| `/api/operations/audit/counts` | GET | 200 | Returns counts by category |
| `/api/operations/archived` | GET | 200 | Lists archived cases |
| `/api/operations/retention` | GET | 200 | Returns retention policy |
| `/api/operations/metrics` | GET | 200 | Query operational metrics |
| `/api/operations/metrics/compute` | POST | 200 | Computes all metrics |
| `/api/operations/metrics/daily` | POST | 200 | Computes daily summary |
| `/api/operations/cleanup` | POST | 200 | Runs transient cleanup |
| `/api/operations/dashboard` | GET | 200 | Full dashboard data |
| `/api/operations/dashboard/light` | GET | 200 | Light dashboard (no probes) |

### Cross-Phase Compatibility — All Passing ✅
| Phase | Endpoint | Status |
|---|---|---|
| Phase 7 QC | `/api/qc/registry/stats` | 200 (36 rules active) |
| Phase 9 Insertion | `/api/insertion/profiles` | 200 |
| Phase 9 Insertion | `/api/insertion/mappings/1004` | 200 |
| Core Health | `/api/health` | 200 |

### UI Tabs — All Switching Correctly ✅
- CASE, FACTS, GENERATE, QC GRADE, VOICE, INTEL, DOCS, MEMORY

### Server Startup ✅
- Port 5178
- Audit logger initialized
- Retention cleanup runs on startup
- System startup event emitted

### Thorough Testing (2026-03-10 Session 2) — All Passing ✅

| Test | Description | Result |
|---|---|---|
| Timeline real case | GET `/api/operations/timeline/0b7bd704` | 200, empty events (expected - Phase 10 just installed) |
| Export real case | GET `/api/operations/export/0b7bd704` | 200, 13 keys in manifest |
| Archive case | POST `/api/operations/archive/4d75eded` | 200, `Case 4d75eded archived` |
| List archived | GET `/api/operations/archived` | 200, shows archived case |
| Restore case | POST `/api/operations/restore/4d75eded` | 200, `Case 4d75eded restored to active` |
| Timeline nonexistent | GET `/api/operations/timeline/NONEXISTENT` | 200, graceful empty |
| Archive nonexistent | POST `/api/operations/archive/NONEXISTENT` | 200, `Case NONEXISTENT not found` |
| Restore nonexistent | POST `/api/operations/restore/NONEXISTENT` | 200, `Case NONEXISTENT not found` |
| Audit filter category | GET `/api/operations/audit?category=system` | 200, filtered events |
| Audit filter eventType | GET `/api/operations/audit?eventType=case.archived` | 200, 1 event |
| Full diagnostics | GET `/api/operations/health/diagnostics` | 200, DB/storage/disk/orchestrator/QC stats |
| Full dashboard | GET `/api/operations/dashboard` | 200, 8 sections |
| Metrics compute | POST `/api/operations/metrics/compute` | 200, daily summary |
| Query stored metrics | GET `/api/operations/metrics` | 200, 5 metrics with correct structure |
| Export nonexistent | GET `/api/operations/export/NONEXISTENT` | 200, graceful empty manifest |
| Timeline archived case | GET `/api/operations/timeline/4d75eded` | 200, 4 events (archive/restore + generation) |
| Timeline field names | camelCase normalized (eventType, createdAt, caseId) | ✅ |
| Double archive | POST archive twice | 200, `Case already archived` (idempotent) |
| Double restore | POST restore on active | 200, `Case is not archived (status: active)` |
| QC registry stats | GET `/api/qc/registry/stats` | 200, 36 rules, 7 categories |
| QC runs for case | GET `/api/cases/0b7bd704/qc-runs` | 200, existing runs with findings |
| QC run detail | GET `/api/qc/runs/:id` | 200, full run object |
| QC run findings | GET `/api/qc/runs/:id/findings` | 200, 1 blocker finding |
| QC run summary | GET `/api/qc/runs/:id/summary` | 200, severity counts + readiness |
| QC finding dismiss | POST `/api/qc/findings/:id/dismiss` | Correct lifecycle behavior |
| QC finding resolve | POST `/api/qc/findings/:id/resolve` | 200 ✅ |
| QC finding reopen | POST `/api/qc/findings/:id/reopen` | 200 ✅ |
| Insertion profiles | GET `/api/insertion/profiles` | 200, ACI + RQ profiles |
| Insertion mappings 1004 | GET `/api/insertion/mappings/1004` | 200, field mappings |
| Insertion mappings commercial | GET `/api/insertion/mappings/commercial` | 200, RQ mappings |
| Cross-phase sweep (15 endpoints) | All phases tested together | 15/15 passed ✅ |
| UI all 8 tabs | Browser verification | All switch correctly ✅ |

## Files Created
1. `server/migration/phase10Schema.js` — audit_events, case_timeline_events, operational_metrics tables
2. `server/operations/types.js` — JSDoc types for all Phase 10 entities
3. `server/operations/auditLogger.js` — Event emission, icon mapping, init
4. `server/operations/operationsRepo.js` — Query/store/purge for all Phase 10 tables
5. `server/operations/caseTimeline.js` — Build case timeline from audit + legacy events
6. `server/operations/metricsCollector.js` — Daily summary, all-metrics computation
7. `server/operations/healthDiagnostics.js` — DB, storage, disk diagnostics
8. `server/operations/retentionManager.js` — Archive/restore, cleanup, retention policy
9. `server/operations/exportEnhancer.js` — Case export manifest, support bundle data
10. `server/operations/dashboardBuilder.js` — Full + light dashboard builders
11. `server/api/operationsRoutes.js` — All REST endpoints

## Files Modified
1. `server/db/schema.js` — Added initPhase10Schema import/call
2. `server/db/database.js` — Added Phase 10 tables to getTableCounts
3. `cacc-writer-server.js` — Import/mount operationsRouter, initAuditLogger, emitSystemEvent, runTransientCleanup
4. `index.html` — Added caseTimelineCard + caseOpsCard divs in case-detail area
5. `app.js` — Added loadCaseTimeline, showCaseOpsCards, archiveCurrentCase, exportCurrentCase functions; init IIFE updated; 60s timeline refresh interval
