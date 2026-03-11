# Phase 6 — Memory, Voice, and Proprietary Writing Engine

## Implementation Progress

### Step 1: Data Model Foundation
- [ ] `server/memory/memoryTypes.js` — JSDoc typedefs for all Phase 6 data shapes
- [ ] `server/migration/phase6Schema.js` — Phase 6 schema additions
- [ ] `server/db/schema.js` — Wire Phase 6 migration into startup

### Step 2: Repository Layer
- [ ] `server/db/repositories/memoryRepo.js` — Approved Memory Repository

### Step 3: Service Layer
- [ ] `server/memory/approvedMemoryStore.js` — Approved Memory Store
- [ ] `server/memory/voiceProfileService.js` — Voice Profile System
- [ ] `server/memory/compCommentaryMemory.js` — Comparable Commentary Memory
- [ ] `server/memory/memoryStagingService.js` — Memory Staging / Approval Workflow

### Step 4: Retrieval Engine
- [ ] `server/memory/retrievalRankingEngine.js` — Deterministic + scored retrieval ranking

### Step 5: Retrieval Pack V2
- [ ] `server/memory/retrievalPackBuilderV2.js` — Enhanced Retrieval Pack Builder

### Step 6: Orchestrator Wiring
- [ ] Modify `server/orchestrator/generationOrchestrator.js` — Use V2 retrieval
- [ ] Modify `server/orchestrator/sectionJobRunner.js` — Consume voice hints
- [ ] Modify `server/promptBuilder.js` — Accept voice profile + disallowed phrases

### Step 7: API Routes
- [ ] `server/api/memoryV2Routes.js` — Phase 6 endpoints
- [ ] Modify `cacc-writer-server.js` — Mount new routes

### Step 8: Basic UI
- [ ] Add Memory/Voice review UI surfaces to `index.html`
