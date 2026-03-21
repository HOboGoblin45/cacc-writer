# Appraisal Agent â€” Architecture Upgrade Tracking
# ============================================
# LangGraph + LangSmith + Pinecone + Langfuse upgrade
# Started: 2025
# Status: Phase 1 COMPLETE âœ…

## PHASE 0 â€” Freeze Legacy Architecture âœ… COMPLETE

- [x] Identified all legacy agent files
- [x] Added LEGACY SYSTEM â€” DO NOT EXTEND banner to desktop_agent/agent.py
- [x] Added LEGACY SYSTEM â€” DO NOT EXTEND banner to real_quantum_agent/agent.py
- [x] Confirmed legacy server still runs (28/28 smoke tests passing)
- [x] Legacy agents remain functional â€” not deleted, not extended

## PHASE 1 â€” New Project Structure âœ… COMPLETE

### TypeScript Configuration
- [x] tsconfig.json â€” target ES2022, NodeNext modules, outDir dist/, rootDir server/
- [x] package.json â€” updated to v2.0.0, added all new deps + devDeps + build scripts

### New Dependencies Installed
- [x] @langchain/core ^0.3.0
- [x] @langchain/langgraph ^0.2.0
- [x] @langchain/openai ^0.3.0
- [x] @pinecone-database/pinecone ^3.0.0
- [x] langfuse ^3.0.0
- [x] langsmith ^0.1.0
- [x] zod ^3.23.0
- [x] typescript ^5.4.0 (devDep)
- [x] tsx ^4.7.0 (devDep)
- [x] @types/node, @types/express, @types/uuid (devDeps)

### New Module Structure Created
- [x] server/config/openai.ts         â€” ChatOpenAI + OpenAIEmbeddings + generateCompletion()
- [x] server/config/pinecone.ts        â€” Pinecone singleton, getPineconeClient(), getPineconeIndex()
- [x] server/observability/langsmith.ts â€” wrapWithTrace(), createWorkflowRun()
- [x] server/observability/langfuse.ts  â€” logWorkflowRun(), logPrompt(), logRetrieval(), logAutomation()
- [x] server/retrieval/llamaIndex.ts    â€” retrieveExamples(), storeExample(), ingestLocalKBToPinecone()
- [x] server/ingestion/documentParser.ts â€” parseDocument(), ingestDocument(), cleanNarrativeText()
- [x] server/workflow/types.ts          â€” WorkflowState, PipelineStage, FormType, all shared types
- [x] server/agents/draftAgent.ts       â€” draftSection() with Pinecone + LangSmith + Langfuse
- [x] server/agents/reviewAgent.ts      â€” reviewSection(), hasCriticalIssues(), getIssueSummary()
- [x] server/tools/aciTool.ts           â€” ACITool class wrapping HTTP to port 5180
- [x] server/tools/realQuantumTool.ts   â€” RealQuantumTool class wrapping HTTP to port 5181
- [x] server/agents/verificationAgent.ts â€” verifyInsertion(), retryInsertion(), getSoftwareForForm()
- [x] server/workflow/appraisalWorkflow.ts â€” LangGraph StateGraph, 9 nodes, runWorkflow(), runBatchWorkflow()

### TypeScript Build
- [x] npm run build â€” ZERO errors, all 13 modules compiled to dist/
- [x] dist/ contains: agents/, config/, ingestion/, observability/, retrieval/, tools/, workflow/

### New API Endpoints (added to cacc-writer-server.js)
- [x] POST /api/workflow/run          â€” run full workflow for one field
- [x] POST /api/workflow/run-batch    â€” run workflow for 5 production lane fields
- [x] GET  /api/workflow/health       â€” workflow system health check
- [x] POST /api/kb/ingest-to-pinecone â€” ingest local KB to Pinecone vector store
- [x] POST /api/workflow/ingest-pdf   â€” ingest a PDF into Pinecone

### Environment Variables
- [x] .env.example â€” all placeholders documented

### Backward Compatibility
- [x] All 28 existing smoke tests still pass
- [x] All existing endpoints unchanged
- [x] Legacy agents still functional

---

## PHASE 2 â€” Connect OpenAI API âœ… COMPLETE (via server/config/openai.ts)

- [x] ChatOpenAI instance initialized
- [x] OpenAIEmbeddings instance initialized
- [x] generateCompletion(prompt) helper exported
- [x] Graceful degradation if OPENAI_API_KEY not set

---

## PHASE 3 â€” LangSmith Tracing âœ… COMPLETE (via server/observability/langsmith.ts)

- [x] LANGCHAIN_TRACING_V2 env var support
- [x] LANGCHAIN_API_KEY env var support
- [x] createWorkflowRun() â€” creates a traced run per workflow invocation
- [x] wrapWithTrace() â€” wraps any async function in a LangSmith trace
- [x] TRACING_ENABLED flag â€” graceful no-op if not configured

---

## PHASE 4 â€” Langfuse Observability âœ… COMPLETE (via server/observability/langfuse.ts)

- [x] Langfuse client initialized
- [x] logWorkflowRun() â€” logs each workflow stage
- [x] logPrompt() â€” logs prompt + completion pairs
- [x] logRetrieval() â€” logs retrieval queries + results
- [x] logAutomation() â€” logs ACI/RQ insertion attempts
- [x] Graceful no-op if LANGFUSE_* env vars not set

---

## PHASE 5 â€” LlamaIndex Retrieval Layer âœ… COMPLETE (via server/retrieval/llamaIndex.ts)

- [x] Pinecone connection via getPineconeIndex()
- [x] retrieveExamples(fieldId, formType, topK) â€” semantic search
- [x] storeExample() â€” upsert approved section to Pinecone
- [x] ingestLocalKBToPinecone() â€” bulk ingest local KB JSON files
- [x] Local KB fallback when Pinecone not configured

---

## PHASE 6 â€” Document Ingestion Pipeline âœ… COMPLETE (via server/ingestion/documentParser.ts)

- [x] parseDocument() â€” parse PDF/text files
- [x] ingestDocument() â€” parse + store to Pinecone
- [x] cleanNarrativeText() â€” normalize appraisal text
- [x] Metadata: form_type, property_type, section_name, field_id, quality_score, approved_flag

---

## PHASE 7 â€” Draft Agent âœ… COMPLETE (via server/agents/draftAgent.ts)

- [x] draftSection(state) â€” retrieve examples + build prompt + call OpenAI
- [x] Returns: draft_text, examples_used, facts_used
- [x] LangSmith tracing per draft call
- [x] Langfuse logging per draft call

---

## PHASE 8 â€” Review Agent âœ… COMPLETE (via server/agents/reviewAgent.ts)

- [x] reviewSection(state) â€” review draft for USPAP compliance + tone
- [x] hasCriticalIssues(review) â€” gate for re-draft
- [x] getIssueSummary(review) â€” human-readable issue list
- [x] Returns: revisedText, issues[], confidence, changesMade

---

## PHASE 9 â€” ACI Tool âœ… COMPLETE (via server/tools/aciTool.ts)

- [x] ACITool class â€” deterministic HTTP wrapper for port 5180
- [x] openTab(), findField(), insertText(), readText(), verifyText()
- [x] insertAndVerify() â€” combined insert + verify
- [x] isAvailable() â€” health check
- [x] Singleton aciTool export

---

## PHASE 10 â€” Real Quantum Tool âœ… COMPLETE (via server/tools/realQuantumTool.ts)

- [x] RealQuantumTool class â€” deterministic HTTP wrapper for port 5181
- [x] navigateSection(), resolveEditor(), insertText(), readText(), verifyText()
- [x] insertAndVerify() â€” combined insert + verify
- [x] isAvailable() â€” health check
- [x] Singleton realQuantumTool export

---

## PHASE 11 â€” Verification Agent âœ… COMPLETE (via server/agents/verificationAgent.ts)

- [x] verifyInsertion(state) â€” confirm inserted text matches expected
- [x] retryInsertion(state) â€” retry once on failure
- [x] getSoftwareForForm(formType) â€” route to aci or realquantum
- [x] Logs failure and stops workflow if retry also fails

---

## PHASE 12 â€” LangGraph Workflow âœ… COMPLETE (via server/workflow/appraisalWorkflow.ts)

- [x] StateGraph with 9 nodes
- [x] Nodes: create_case, parse_documents, extract_facts, retrieve_examples,
           draft_section, review_section, insert_section, verify_insert, save_output
- [x] Conditional edges: verify_insert â†’ save_output | END
- [x] runWorkflow() â€” single field
- [x] runBatchWorkflow() â€” 5 production lane fields
- [x] getWorkflow() â€” singleton compiled graph
- [x] LangGraph Annotation fix: all fields use value: (x,y)=>y reducer

---

## PHASE 13 â€” Store Completed Sections âœ… COMPLETE (via save_output node)

- [x] Every successful section saved to Pinecone via storeExample()
- [x] Metadata: approved_flag=true, caseId, workflowRun=true, verifiedAt
- [x] Enables continuous improvement of retrieval quality

---

## SCOPE ENFORCEMENT â€” âœ… COMPLETE (implemented as separate track)

> Active production scope is now enforced across the full stack.
> See `TODO_SCOPE_CORRECTION.md` for full implementation details.
> See `SCOPE.md` for the scope definition and enforcement table.

**What was implemented:**
- `server/config/productionScope.js` â€” central scope config (ACTIVE_FORMS, DEFERRED_FORMS, guards, logging)
- `forms/index.js` â€” `getActiveForms()`, `getDeferredForms()`, scope metadata on `listForms()`
- `cacc-writer-server.js` â€” API scope enforcement on 6 endpoints; deferred forms blocked; legacy cases load with `scopeStatus:'deferred'`
- `index.html` â€” two-section form picker CSS + HTML; deferred banner; deferred badge
- `app.js` â€” form picker logic; `showDeferredFormBanner()`; `setScopeGenerateEnabled()`; limited mode for legacy deferred cases

**Active forms:** `1004`, `commercial`
**Deferred (preserved, not extended):** `1025`, `1073`, `1004c`

---

## PHASES 14â€“15 â€” PENDING (NARROWED SCOPE)

> âš ï¸ Active production scope: **1004 single-family (ACI)** + **commercial (Real Quantum)** only.
> 1025, 1073, 1004c are DEFERRED. See SCOPE.md.

### PHASE 14 â€” Evaluation Dataset
**Lane 1 â€” 1004 (priority)**
- [ ] Build 15 example 1004 cases (facts + section_name + expected_style + expected_text)
- [ ] Cover all 10 priority sections: neighborhood_description, market_conditions,
      site_description, improvements_description, condition_description,
      contract_analysis, concessions_analysis, highest_best_use,
      sales_comparison_summary, reconciliation
- [ ] Store in knowledge_base/eval_dataset/1004/

**Lane 2 â€” commercial (priority)**
- [ ] Build 10 example commercial cases
- [ ] Cover all 5 priority sections: neighborhood, market_overview,
      improvements_description, highest_best_use, reconciliation
- [ ] Store in knowledge_base/eval_dataset/commercial/

**Evaluation scoring (both lanes)**
- [ ] style_similarity â€” cosine similarity vs. approved examples
- [ ] factual_grounding â€” facts cited in output vs. facts provided
- [ ] hallucination_rate â€” claims not supported by input facts
- [ ] software_insert_success â€” ACI (1004) / RQ (commercial) insertion verified

**DEFERRED â€” do not build eval cases for:**
- [ ] ~~1025 eval cases~~ â€” deferred
- [ ] ~~1073 eval cases~~ â€” deferred
- [ ] ~~1004c eval cases~~ â€” deferred

### PHASE 15 â€” Production Lane Tests

**Lane 1 â€” 1004 production test**
- [ ] Run system on one real 1004 single-family assignment
- [ ] Generate all 10 priority sections
- [ ] Verify successful insertion into ACI for each section
- [ ] Confirm all sections stored in Pinecone with approved_flag=true
- [ ] Run `python _test_aci_live.py 1004` â€” confirm pass rate â‰¥ 90%

**Lane 2 â€” commercial production test**
- [ ] Run system on one real commercial assignment
- [ ] Generate all 5 priority sections
- [ ] Verify successful insertion into Real Quantum for each section
- [ ] Confirm all sections stored in Pinecone with approved_flag=true
- [ ] Run `python _test_rq_sections.py` â€” confirm section navigation works

---

## ENVIRONMENT VARIABLES REQUIRED

Copy .env.example to .env and fill in:

```
# Existing (required)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1

# New â€” Pinecone (required for vector retrieval)
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=cacc-writer
PINECONE_ENVIRONMENT=us-east-1

# New â€” LangSmith (optional, for tracing)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_PROJECT=cacc-writer

# New â€” Langfuse (optional, for observability)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

---

## PRODUCTION LANES

### Lane 1 â€” 1004 Single-Family Residential (ACI) â† PRIMARY

| Field ID                    | ACI Tab  | Status  |
|-----------------------------|----------|---------|
| neighborhood_description    | Neig     | Ready   |
| market_conditions           | Neig     | Ready   |
| site_description            | Site     | Ready   |
| improvements_description    | Impr     | Ready   |
| condition_description       | Impr     | Ready   |
| contract_analysis           | SCA      | Ready   |
| concessions_analysis        | SCA      | Ready   |
| highest_best_use            | SCA      | Ready   |
| sales_comparison_summary    | SCA      | Ready   |
| reconciliation              | Recon    | Ready   |

### Lane 2 â€” Commercial (Real Quantum) â† PRIMARY

| Field ID                    | RQ Section      | Status  |
|-----------------------------|-----------------|---------|
| neighborhood                | Introduction    | Ready   |
| market_overview             | MarketData      | Ready   |
| improvements_description    | PropertyData    | Ready   |
| highest_best_use            | HighestBestUse  | Ready   |
| reconciliation              | Reconciliation  | Ready   |

### DEFERRED LANES (do not build now)

| Form Type | Status   |
|-----------|----------|
| 1025      | DEFERRED |
| 1073      | DEFERRED |
| 1004C     | DEFERRED |

---

## BUILD COMMANDS

```bash
npm run build          # compile TypeScript â†’ dist/
npm run typecheck      # type-check without emitting
npm run build:watch    # watch mode
npm start              # start legacy server (port 5178)
npm test               # run 28 smoke tests
```

## WORKFLOW API

```bash
# Run workflow for one field
curl -X POST http://localhost:5178/api/workflow/run \
  -H "Content-Type: application/json" \
  -d '{"caseId":"abc123","formType":"1004","fieldId":"neighborhood_description","facts":{}}'

# Run batch workflow (5 production lane fields)
curl -X POST http://localhost:5178/api/workflow/run-batch \
  -H "Content-Type: application/json" \
  -d '{"caseId":"abc123","formType":"1004","facts":{}}'

# Workflow health check
curl http://localhost:5178/api/workflow/health

# Ingest local KB to Pinecone
curl -X POST http://localhost:5178/api/kb/ingest-to-pinecone

