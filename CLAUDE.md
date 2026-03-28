# CLAUDE.md — Project Intelligence for Real Brain

## What is this project?
**Real Brain** is a full-lifecycle AI-powered appraisal report production platform. It generates lender-ready narrative text for residential and commercial real estate appraisal forms (URAR 1004, 1025, 1073, commercial). Cloud SaaS with optional desktop automation agents for field insertion into ACI and Real Quantum appraisal software.

*(Formerly known as CACC Writer / Appraisal Agent)*

## Architecture

**Express.js server** (`cacc-writer-server.js`, port 5178) with 80+ route modules.

Key layers:
- **Frontend**: Vanilla HTML/JS with Tailwind CSS. Gold (#ffd341) + green (#00A86B) + dark (#10141a) theme. Main workspace in `app.js`, Knowledge Brain in `brain.html`.
- **API**: Express routes in `server/api/`. Auth via JWT (sessionStorage). Per-user SQLite isolation.
- **AI Engine**: `server/orchestrator/` → `server/promptBuilder.js` → `server/ai/` (OpenAI, Gemini, Ollama, or fine-tuned model). Section-by-section narrative generation.
- **Proprietary AI**: Fine-tuned Llama 3.1 8B (`cacc-appraiser-v6`) on RunPod RTX 4090. vLLM inference (port 8000), FastAPI dashboard (port 8080). Proxied via `server/api/brainRoutes.js`.
- **Knowledge Brain**: D3.js force-directed knowledge graph visualization. NetworkX backend on RunPod. WebSocket real-time chat.
- **Database**: SQLite via better-sqlite3. Schema in `server/db/schema.js` with phase migrations in `server/migration/`. Per-user DBs in `data/users/{userId}/cacc.db`.
- **Desktop Agents**: Python (ACI agent on port 5180, RQ agent on port 5181) for automated field insertion into appraisal software.

## Key Directories

```
server/
  api/            — Express route modules (cases, brain, billing, etc.)
  orchestrator/   — Generation orchestration (multi-section pipeline)
  ai/             — AI provider abstraction, platform AI
  db/             — Database connection, schema, repositories
  migration/      — Schema migrations (phase6 through phase19, brain)
  qc/             — Quality control checkers (6 engines)
  intelligence/   — Comp scoring, market analysis
  learning/       — Feedback loop, pattern learning
  security/       — Encryption, rate limiting, backup/restore
  billing/        — Stripe integration
  auth/           — JWT auth, user management
  export/         — PDF filling, MISMO XML
frontend/         — Login, signup, settings, analytics pages
brain.html        — Knowledge Brain dashboard (D3.js 3D graph)
app.js            — Main case workspace (5-step workflow)
```

## Development Conventions

- **ES Modules** throughout (`import`/`export`, `.js` extension)
- **Synchronous better-sqlite3** calls (not async)
- **Repository pattern**: `server/db/repositories/*.js` wraps SQL
- **Logger**: `import log from '../logger.js'` — use `log.info()`, `log.warn()`, `log.error()`
- **Tenant isolation**: Pass `{ db: getUserDb(userId) }` options to repo functions
- **Config**: `.env` → `process.env`. No hardcoded secrets. Production requires `JWT_SECRET`, `CACC_ENCRYPTION_KEY`.
- **Naming**: camelCase for JS, snake_case for SQL columns, kebab-case for routes

## Testing

```bash
npm test              # Runs tests/syntax.test.mjs (syntax check all server files)
node -c server/file.js  # Quick syntax check on a single file
```

Vitest config exists at `vitest.config.mjs` but migration to Vitest is pending.

## Git Workflow

Branch: `saas-v1-completion`. Known issue: persistent `.git/index.lock` files with immutable permissions. Workaround: use `GIT_INDEX_FILE=/tmp/git-index-NAME` with low-level git commands (`git read-tree`, `git write-tree`, `git commit-tree`, `git update-ref`).

## Active Scope

| Form | Status |
|------|--------|
| 1004 (Single-Family) | Active |
| 1025 (Small Residential Income) | Active |
| Commercial (Real Quantum) | Deferred |
| 1073 (Condo) | Deferred |

## Phase 1.5 Priority — Proprietary AI Engine

The fine-tuned Llama model and Knowledge Brain are the platform's core differentiator:
- **Model registry**: `server/migration/brainSchema.js` → `model_registry` table
- **Graph persistence**: `graph_nodes` + `graph_edges` tables in SQLite
- **Chat history**: `brain_chat_history` table
- **Cost tracking**: `ai_cost_log` table
- **Repository**: `server/db/repositories/brainRepo.js`
- **Routes**: `server/api/brainRoutes.js` (fallback provider chain to OpenAI when RunPod is down)
- **Frontend**: `brain.html` fetches config from `/api/brain/config` (no hardcoded pod IDs)
