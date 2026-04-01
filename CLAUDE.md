# CLAUDE.md — Project Intelligence for Real Brain

## What is this project?

**Real Brain** (v3.1.0) is a full-lifecycle AI-powered appraisal report production platform. It generates lender-ready narrative text for residential and commercial real estate appraisal forms (URAR 1004, 1025, 1073, commercial). Cloud SaaS with optional desktop automation agents for field insertion into ACI and Real Quantum appraisal software. An Electron desktop app is also available.

*(Formerly known as CACC Writer / Appraisal Agent)*

## Architecture

**Express.js v4 server** (`cacc-writer-server.js`, port 5178) with 96 route modules and ~470 server-side source files.

### Key layers

- **Frontend**: Vanilla HTML/JS with Tailwind CSS. Gold (#ffd341) + green (#00A86B) + dark (#10141a) theme. Main workspace in `app.js`, Knowledge Brain in `brain.html`. Additional pages: `dashboard.html`, `inspection.html`, `admin.html`, `landing.html`, `pricing.html`.
- **API**: Express routes in `server/api/` (96 files). Auth via JWT (sessionStorage). Per-user SQLite isolation.
- **AI Engine**: `server/orchestrator/` → `server/promptBuilder.js` → `server/ai/` (OpenAI, Anthropic, Gemini, Ollama, RunPod serverless, or fine-tuned model). Section-by-section narrative generation with model fallback chain (`server/ai/modelFallbackChain.js`).
- **LangGraph Agents**: `server/agents/` contains TypeScript-based LangGraph agents (`draftAgent.ts`, `reviewAgent.ts`, `verificationAgent.ts`) for multi-step AI workflows. Configured via `server/workflow/appraisalWorkflow.ts`.
- **Proprietary AI**: Fine-tuned Llama 3.1 8B (`cacc-appraiser-v6`) on RunPod serverless. Proxied via `server/api/brainRoutes.js` with fallback to OpenAI.
- **Knowledge Brain**: D3.js force-directed knowledge graph visualization. NetworkX backend on RunPod. WebSocket real-time chat.
- **Observability**: LangFuse (`server/observability/langfuse.ts`) and LangSmith (`server/observability/langsmith.ts`) for AI tracing. Cost tracking via `server/middleware/costTracker.js`.
- **Database**: SQLite via better-sqlite3 (v12.x). Schema in `server/db/schema.js` with phase migrations (phase6–phase28) in `server/migration/`. Per-user DBs in `data/users/{userId}/cacc.db`. PostgreSQL adapter layer exists (`server/db/adapters/`, `server/db/postgresql/`) for future migration.
- **Storage**: Pluggable adapter pattern (`server/storage/`) — Local, S3, R2 backends with DualWrite support.
- **Desktop Agents**: Python (ACI agent, Real Quantum agent) for automated field insertion. Playwright-based automation for web-based RQ forms.
- **Electron Desktop**: `desktop/electron/main.cjs` with Electron Forge packaging (`desktop/forge.config.cjs`).

## Key Directories

```
server/
  api/              — 96 Express route modules
  orchestrator/     — Generation orchestration (draft assembler, section job runner)
  ai/               — 35 AI provider/engine files (OpenAI, Anthropic, Gemini, Ollama, RunPod, etc.)
  agents/           — LangGraph agents (draft, review, verification)
  workflow/         — TypeScript workflow definitions (LangGraph)
  db/               — Database connection, schema, repositories, adapters, tenancy
    repositories/   — 11 repository modules (cases, generation, memory, brain, etc.)
    adapters/       — SQLite/PostgreSQL adapter abstraction
    tenancy/        — Multi-tenant DB isolation
  migration/        — Schema migrations (phase6–phase28, brain, pipeline)
  qc/               — Quality control engine (8 checkers, rule registry, severity model)
    checkers/       — Individual QC checker implementations
  intelligence/     — Comp scoring, market analysis, section planning, compliance profiles
  learning/         — Feedback loop, pattern learning, revision diffs, suggestion ranking
  security/         — Encryption, rate limiting, backup/restore, audit, SOC2 compliance
  billing/          — Stripe integration (subscriptions, invoices, usage tracking, portal)
  auth/             — JWT auth, OAuth, user management
  export/           — PDF filling, MISMO XML, UAD 3.6 export, bundle service
  ingestion/        — Document parsing, classification, OCR, staging
  training/         — Self-training pipeline (ACI/decision extraction, self-training analyzer)
  config/           — Core sections, field definitions, env validation, startup checks, UAD 3.6 config
  context/          — Assignment context builder, report planner, retrieval pack builder
  middleware/       — Auth, CSRF, rate limiting, cost tracking, API versioning, error handling
  services/         — Generation, section freshness, section policy, valuation calculator
  integrations/     — Gmail, Google Sheets, AMC, MLS, Mercury, Zillow, UCDP, eSignature, webhooks
  operations/       — Audit logging, metrics, health diagnostics, retention, dashboard
  valuation/        — Cost approach, income approach, reconciliation engines
  storage/          — Pluggable storage adapters (Local, S3, R2, DualWrite)
  compliance/       — Regulatory & workfile compliance
  memory/           — Memory staging, types, retrieval ranking
  tools/            — LangGraph tool definitions (ACI, Real Quantum)
  observability/    — LangFuse, LangSmith tracing
  utils/            — Case utils, sanitization, retry helpers, graceful shutdown
  photos/           — Photo manager
  mobile/           — Mobile API routes
  realtime/         — Collaboration service
  whitelabel/       — White-label configuration
  growth/           — Referral system
  notifications/    — Notification service
  scheduling/       — Inspection scheduler
  data/             — Address verification, field registry, flood/zoning analysis
  pipeline/         — Full report pipeline
  generators/       — Generator profiles
  engines/          — Comp commentary engine
  sectionFactory/   — Section governance & policy services
  generation/       — Batch generator
  workspace/        — 1004 workspace definition, workspace service
  revisions/        — Revision tracker
  templates/        — Report templates
frontend/           — Login, signup, settings, analytics, onboarding, questionnaire pages
brain.html          — Knowledge Brain dashboard (D3.js graph)
app.js              — Main case workspace (5-step workflow)
desktop/            — Electron app (main.cjs, forge.config.cjs)
scripts/            — CI, migration, golden path, benchmarks, training scripts
tests/              — 113 test files across vitest, unit, integration, and load tests
fixtures/           — Golden path test fixtures
benchmarks/         — Performance benchmarks
prompts/            — Prompt templates
forms/              — Form field definitions
docs/               — Documentation
deploy/             — Deployment configs
```

## Development Conventions

- **ES Modules** throughout (`import`/`export`, `.js` extension). TypeScript used selectively for agents/workflow (`server/agents/`, `server/workflow/`, `server/tools/`).
- **Synchronous better-sqlite3** calls (not async). `AsyncQueryRunner` and `AsyncRepoWrapper` exist for gradual async migration.
- **Repository pattern**: `server/db/repositories/*.js` wraps SQL. 11 repositories covering cases, generation, memory, brain, comps, STM, voice embeddings, etc.
- **Logger**: `import log from '../logger.js'` — use `log.info()`, `log.warn()`, `log.error()`. File logging via `server/fileLogger.js`.
- **Tenant isolation**: Pass `{ db: getUserDb(userId) }` options to repo functions. Tenancy layer in `server/db/tenancy/`.
- **Config**: `.env` → `process.env`. No hardcoded secrets. Production requires `JWT_SECRET`, `CACC_ENCRYPTION_KEY`. Validated at startup by `server/config/envValidator.js`.
- **Naming**: camelCase for JS, snake_case for SQL columns, kebab-case for routes.
- **Error handling**: Centralized via `server/middleware/errorHandler.js`. Response envelope pattern via `server/utils/responseEnvelope.js`.
- **Security**: Helmet, CORS, CSRF protection, rate limiting, request timeouts (separate AI and API timeouts). SOC2 compliance module exists.
- **AI provider abstraction**: `server/ai/platformAI.js` as primary interface. Model fallback chain (`server/ai/modelFallbackChain.js`) handles provider failures. Provider health monitoring via `server/ai/providerHealth.js`.
- **Async Express patch**: `server/utils/patchExpressAsync.js` wraps async route handlers (Express 4 doesn't catch promise rejections).

## Testing

```bash
npm test                        # Vitest — runs unit + vitest suite (113 test files)
npm run test:syntax             # Syntax check all server files
npm run test:smoke              # Integration smoke test against running server
npm run test:unit               # Unit tests via custom runner
npm run test:unit:vitest        # Unit tests via Vitest
npm run test:golden             # Golden path end-to-end test
npm run test:golden:1004        # Golden path for 1004 form
npm run test:golden:commercial  # Golden path for commercial form
npm run test:all                # Vitest + smoke tests
npm run ci:check                # Typecheck + Vitest + Phase C benchmarks + smoke
npm run test:ci                 # Local CI script
npm run test:load               # Load testing
npm run test:load:smoke         # Load test smoke
npm run test:peak               # Peak hours load scenario
npm run test:soak               # Soak testing
npm run benchmark:phase-c       # Phase C performance benchmarks
npm run benchmark:phase-c:check # Check benchmark thresholds
```

**Vitest config** (`vitest.config.mjs`): includes `tests/unit/*.test.mjs` and `tests/vitest/**/*.test.mjs`. Tests run sequentially (`fileParallelism: false`), 60s timeout. Coverage via v8 on `server/**/*.js` (excludes migrations and schema).

**Quick syntax check** on a single file: `node -c server/file.js`

## Build & TypeScript

```bash
npm run build           # Compile TypeScript (tsconfig.json)
npm run build:watch     # Watch mode
npm run typecheck       # Type check without emitting
npm run validate:registry  # Validate field registry
```

TypeScript is used for: agents (`server/agents/*.ts`), workflow (`server/workflow/*.ts`), tools (`server/tools/*.ts`), observability (`server/observability/*.ts`), config (`server/config/openai.ts`, `server/config/pinecone.ts`), retrieval (`server/retrieval/llamaIndex.ts`), ingestion (`server/ingestion/documentParser.ts`).

## Running the Server

```bash
npm start               # node cacc-writer-server.js (port 5178)
npm run dev             # node --watch cacc-writer-server.js (auto-restart on changes)
npm run start:electron  # Launch Electron desktop app
```

## Git Workflow

Primary development branch: `saas-v1-completion`. Known issue: persistent `.git/index.lock` files with immutable permissions. Workaround: use `GIT_INDEX_FILE=/tmp/git-index-NAME` with low-level git commands (`git read-tree`, `git write-tree`, `git commit-tree`, `git update-ref`).

## Key Dependencies

| Package | Purpose |
|---------|---------|
| express (v4.x) | HTTP server framework |
| better-sqlite3 (v12.x) | SQLite driver (synchronous) |
| openai (v6.x) | OpenAI API client |
| @langchain/langgraph | Agent workflow orchestration |
| @langchain/openai | LangChain OpenAI integration |
| @pinecone-database/pinecone | Vector database (cloud) |
| stripe (v20.x) | Payment processing |
| jsonwebtoken | JWT authentication |
| zod | Schema validation |
| pdf-lib, pdfkit, pdf-parse, pdfjs-dist | PDF generation/parsing |
| langfuse, langsmith | AI observability |
| googleapis | Google API integration |
| multer | File upload handling |
| helmet, cors, express-rate-limit | Security middleware |
| vitest (v4.x) | Test framework |
| typescript (v5.x) | Type checking & compilation |
| electron (v41.x) | Desktop app shell |

## Active Scope

| Form | Status |
|------|--------|
| 1004 (Single-Family) | Active |
| 1025 (Small Residential Income) | Active |
| Commercial (Real Quantum) | Active (workspace defined) |
| 1073 (Condo) | Deferred |

## UAD 3.6 Readiness

The platform is actively preparing for the **UAD 3.6 mandate (November 2, 2026)**. UAD 3.6 replaces all existing form numbers with a single dynamic URAR (29 sections — 17 always-display, 12 conditional, 4 repeatable). Key files:

- **Config**: `server/config/uad36FormConfig.js` — UAD 3.6 form field definitions
- **Export**: `server/export/uad36ExportService.js` — MISMO 3.6 XML + ZIP package generation
- **QC**: `server/qc/checkers/uad36ComplianceChecker.js` — UAD 3.6 compliance validation
- **Routes**: `server/api/uad36Routes.js` — UAD 3.6 API endpoints
- **Tests**: `tests/vitest/uad36.test.mjs` — UAD 3.6 test coverage

## Proprietary AI Engine

The fine-tuned Llama model and Knowledge Brain are the platform's core differentiator:
- **Model registry**: `server/migration/brainSchema.js` → `model_registry` table
- **Graph persistence**: `graph_nodes` + `graph_edges` tables in SQLite
- **Chat history**: `brain_chat_history` table
- **Cost tracking**: `ai_cost_log` table
- **Repository**: `server/db/repositories/brainRepo.js`
- **Routes**: `server/api/brainRoutes.js` (fallback provider chain to OpenAI when RunPod is down)
- **Frontend**: `brain.html` fetches config from `/api/brain/config` (no hardcoded pod IDs)
- **RunPod serverless**: `server/ai/runpodServerless.js` — serverless inference for cost reduction

## Migration Schema Phases

The database evolves via numbered phase migrations in `server/migration/`:
- **phase6–phase9**: Core schema (cases, generation, memory)
- **phase10–phase15**: Comps intelligence, QC, learning, billing
- **phase16–phase19**: Desktop agents, integrations, operations
- **phase20–phase28**: UAD 3.6, self-training, advanced analytics, compliance, workflows
- **brainSchema.js**: Knowledge Brain tables (graph, chat, model registry)
- **pipelineSchema.js**: Report pipeline tables

## Rebuild Priorities (from Architecture Audit)

1. **Express v4 → v5 upgrade** — async middleware, ReDoS-safe routing (low-risk, days)
2. **SQLite WAL mode + production PRAGMAs** — concurrent reads, 2-20x write perf
3. **Replace Pinecone with LanceDB or sqlite-vec** — eliminate cloud vector DB dependency
4. **Restructure narrative generation** — from monolithic addenda to 29 section-specific generators for UAD 3.6
5. **Add OpenCV template matching** to pywinauto desktop agents — visual anchor-relative positioning
6. **Evaluate ACI Sky migration path** and MISMO XML import as desktop automation bypass
