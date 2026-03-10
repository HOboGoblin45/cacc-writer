# Phase 10 — Business Operations Layer

## Status: IN PROGRESS

## Decisions
- No new top-level Ops tab — integrate into existing workflows
- Audit only meaningful state changes (not every API call)
- Unlimited retention by default for operational history
- Structured key exports by default (not full DB snapshot)
- Case-scoped history first, global dashboards second
- Archive = hidden + retained + restorable (not destructive)

## Steps

- [ ] 1. Create Phase 10 SQLite schema migration (`server/migration/phase10Schema.js`)
- [ ] 2. Wire schema into `server/db/schema.js`
- [ ] 3. Create Phase 10 type definitions (`server/operations/types.js`)
- [ ] 4. Create audit logger (`server/operations/auditLogger.js`)
- [ ] 5. Create operations repository (`server/operations/operationsRepo.js`)
- [ ] 6. Create case timeline builder (`server/operations/caseTimeline.js`)
- [ ] 7. Create metrics collector (`server/operations/metricsCollector.js`)
- [ ] 8. Create health diagnostics (`server/operations/healthDiagnostics.js`)
- [ ] 9. Create retention manager (`server/operations/retentionManager.js`)
- [ ] 10. Create export enhancer (`server/operations/exportEnhancer.js`)
- [ ] 11. Create dashboard builder (`server/operations/dashboardBuilder.js`)
- [ ] 12. Create REST endpoints (`server/api/operationsRoutes.js`)
- [ ] 13. Wire routes + audit middleware into `cacc-writer-server.js`
- [ ] 14. Add audit hooks to existing route files
- [ ] 15. Update `server/db/database.js` getTableCounts
- [ ] 16. Add case timeline UI to Case tab in `index.html`
- [ ] 17. Add timeline/operations JS logic to `app.js`
- [ ] 18. Restart server and verify all endpoints
- [ ] 19. Test audit trail, timeline, metrics, health, export
