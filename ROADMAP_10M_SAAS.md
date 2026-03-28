# CACC Writer — Complete Roadmap to $10M SaaS

> Every Feature, Every Module, Fully Perfected
> Date: March 27, 2026
> Target: 100% completion of all existing features + infrastructure required for enterprise-grade SaaS

Philosophy: Nothing gets cut. Every module that exists was envisioned for a reason. The roadmap sequences them so each phase builds on the last and each feature ships when its dependencies are solid.

---

## TABLE OF CONTENTS

1. Architecture Overview — The Complete Product Vision
2. Phase 1: Foundation Hardening (Months 1–3)
3. **Phase 1.5: Proprietary AI Engine & Brain Visualization (Months 2–5) ★ PRIORITY**
4. Phase 2: Multi-Tenant Infrastructure (Months 3–6)
5. Phase 3: AI Engine Perfection (Months 6–9)
6. Phase 4: Voice Generalization & Onboarding (Months 9–11)
7. Phase 5: Desktop Agent Universalization (Months 11–14)
8. Phase 6: Business & Revenue Layer (Months 14–17)
9. Phase 7: Intelligence & Learning Platform (Months 17–20)
10. Phase 8: Integrations Ecosystem (Months 20–23)
11. Phase 9: Enterprise & Scale (Months 23–27)
12. Phase 10: Marketplace & Community (Months 27–30)
13. Phase 11: Mobile & Field Platform (Months 30–33)
14. Phase 12: Perfection & Market Dominance (Months 33–36)
15. Cross-Cutting Concerns (Continuous)
16. Feature Module Completion Matrix
17. Revenue Model & Growth Targets

---

## 1. ARCHITECTURE OVERVIEW — THE COMPLETE PRODUCT VISION

CACC Writer at 100% is a full-lifecycle appraisal production platform with 14 major capability pillars:

| Pillar | Key Modules | Current State |
|--------|------------|---------------|
| 1. AI Narrative Engine | promptBuilder, orchestrator, sectionFactory, retrieval, KB | 60% — works for Charlie's templates |
| 2. Desktop Automation | ACI agent, RQ agent, inserter, field maps | 50% — functional but fragile |
| 3. Document Pipeline | intake, ingestion, PDF extraction, fact extraction | 40% — works for basic orders |
| 4. Comparable Intelligence | comp selection, adjustment grid, paired sales, scoring | 30% — schema + basic logic |
| 5. Quality Control | 6 checkers, approval gate, severity model, contradiction graph | 35% — framework solid, rules incomplete |
| 6. Valuation Analysis | cost approach, income approach, reconciliation engine | 20% — skeleton implementations |
| 7. Voice Engine | voice training, corpus management, style matching | 25% — works for single user |
| 8. Business Operations | pipeline, invoicing, quotes, engagements, scheduling | 15% — schema exists, no frontend |
| 9. Integrations | AMC, MLS, UCDP, Gmail, Sheets, eSign, webhooks | 15% — stubs with partial wiring |
| 10. Learning System | pattern learning, feedback loops, prior retrieval, revision diffs | 20% — services exist, no training loop |
| 11. Export & Delivery | PDF fill, MISMO XML, email delivery, client portal | 35% — PDF filling advancing fast |
| 12. Platform Features | auth, billing, notifications, analytics, automation rules | 15% — scaffolding only |
| 13. Enterprise | whitelabel, collaboration, teams, public API, compliance | 10% — schema stubs |
| 14. Marketplace & Growth | template marketplace, referrals, education center | 5% — vision + schema only |
| **15. Proprietary AI Engine & Brain Visualization** | **fine-tuned Llama 3.1 8B on RunPod, vLLM inference, D3.js 3D knowledge graph, Knowledge Brain dashboard, NetworkX graph engine, WebSocket real-time chat** | **45% — model deployed, dashboard integrated, graph + chat functional** |

### Target Architecture at 100%

```
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (SSR)                        │
│  Landing │ Dashboard │ Case Workspace │ Settings │ Analytics     │
│  Mobile Web │ Client Portal │ Admin Panel │ Marketplace          │
│  ★ Knowledge Brain Dashboard (3D Graph) │ AI Chat/Copilot       │
├─────────────────────────────────────────────────────────────────┤
│                    API Gateway (Express + Auth)                  │
│  JWT Auth │ RBAC │ Rate Limiting │ Tenant Isolation │ API Keys   │
├────────────┬───────────────┬────────────────┬───────────────────┤
│ ★ Propri-  │ AI Engine     │ Intelligence   │ Business Ops      │
│ etary AI   │ Generation    │ Comp Selection │ Pipeline Mgmt     │
│ Fine-tuned │ Voice         │ Adjustments    │ Invoicing         │
│ Llama 3.1  │ QC/Review     │ Market Analysis│ Scheduling        │
│ vLLM+RunPod│ Templates     │ Learning       │ Analytics         │
│ Brain Graph│               │                │                   │
├────────────┼───────────────┼────────────────┼───────────────────┤
│ Automation │               │                │                   │
│ ACI Agent  │ PDF Filling   │ MISMO Export   │                   │
│ RQ Agent   │               │                │                   │
├────────────┴───────────────┴────────────────┴───────────────────┤
│              PostgreSQL + Redis + Pinecone + S3                  │
│  Tenant-isolated │ Connection pooled │ Vector search │ CDN      │
├─────────────────────────────────────────────────────────────────┤
│         Infrastructure (AWS/GCP/Cloudflare + RunPod GPU)        │
│  Docker │ K8s │ CI/CD │ Monitoring │ Backups │ CDN │ Secrets    │
│  ★ RunPod RTX 4090 │ vLLM Inference │ FastAPI + NetworkX       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. PHASE 1: FOUNDATION HARDENING (Months 1–3)

Goal: Make everything that exists today reliable, clean, and tested. Zero new features — only solidification.

### 1.1 — Codebase Cleanup (Weeks 1–2)

| Task | Detail | Files Affected |
|------|--------|---------------|
| Remove dead code | Delete `app-old.js` (8,528 lines), `app.js` (2,066 lines), `workspace.js` (2,706 lines), root `dataPipeline.js` (1,459 lines), all `*-old*` HTML files, `voice_training.bak.json` | ~17,000 lines removed |
| Fix `.gitignore` | Remove null-byte corruption in temp/ entry, add proper exclusions for all temp/debug artifacts | `.gitignore` |
| Purge committed temp data | Remove `temp/` directory contents and `desktop_agent/screenshots/` (58MB) from git history with `git filter-branch` or BFG Repo Cleaner | Git history |
| Relocate root test files | Move all 16 `_test_*.mjs` files from root to `tests/integration/` | 16 files |
| Resolve duplicate modules | Audit `server/services/sectionPolicyService.js` vs `server/sectionFactory/sectionPolicyService.js`, `server/retrieval.js` vs `server/retrieval/` — merge into canonical locations with re-exports for backward compat | ~6 files |
| Add CLAUDE.md | Project intelligence file for Claude Code with architecture overview, conventions, and module map | New file |
| Add `.claude/settings.json` | Tool permissions, allowed commands, project-specific config | New file |

### 1.2 — Security Hardening (Weeks 2–4)

| Task | Detail | Priority |
|------|--------|----------|
| Remove hardcoded encryption fallback | `encryptionService.js` — require `CACC_ENCRYPTION_KEY` env var, throw on startup if missing in production mode | CRITICAL |
| Require JWT_SECRET in production | `authService.js` — fail startup if `NODE_ENV=production` and `JWT_SECRET` not set | CRITICAL ✅ DONE |
| Auth on by default | Flip `CACC_AUTH_ENABLED` default to `true`, make the bypass require explicit `CACC_AUTH_ENABLED=false` only in development | CRITICAL |
| Parameterize all SQL | Audit all 20+ template literal SQL locations — replace column name interpolation with whitelist-validated builder patterns, replace table name interpolation with strict enum checks | HIGH |
| Rate limit all write endpoints | Apply `rateLimitMiddleware` from `server/security/rateLimiter.js` to all POST/PUT/PATCH/DELETE routes, not just `/api/generate` | HIGH |
| CORS environment-conditional | Only include `localhost` origins when `NODE_ENV !== 'production'` | MEDIUM |
| Helmet middleware | Add `helmet` for security headers (CSP, HSTS, X-Frame-Options) | MEDIUM |
| Input validation audit | Ensure every route handler validates body/params with Zod before processing | HIGH |

### 1.3 — Test Infrastructure (Weeks 3–6)

| Task | Detail | Target |
|------|--------|--------|
| Organize test hierarchy | `tests/unit/` (pure logic), `tests/integration/` (API + DB), `tests/e2e/` (full pipeline), `tests/golden/` (fixture-based) | Structure |
| Unit test coverage for core modules | Write tests for: `promptBuilder.js`, `generationOrchestrator.js`, `sectionJobRunner.js`, `draftAssembler.js`, `retrievalPackBuilder.js`, `factConflictEngine.js`, `preDraftGate.js` | 80% coverage |
| API integration tests | Test all critical CRUD paths: create case → upload docs → extract facts → generate → QC → export | 20 test scenarios |
| Golden path stability | `test:golden:1004` must pass 50 consecutive runs against a live AI provider with fixture data | 100% pass rate |
| Vitest migration | Move from `node --test` to Vitest for all unit tests (config already exists at `vitest.config.mjs`) — enables watch mode, coverage reports, parallel execution | All 70 test files |
| CI/CD pipeline | GitHub Actions workflow: lint → typecheck → unit tests → integration tests → golden path (with mock AI) → build Docker image → push to registry | `.github/workflows/ci.yml` |
| Dependency scanning | Add `npm audit` and Dependabot to CI — flag critical vulnerabilities | Automated |

### 1.4 — Core Pipeline Stabilization (Weeks 4–12)

| Task | Detail | Metric |
|------|--------|--------|
| 1004 golden path perfection | Fix every failure mode in the 1004 pipeline: order intake → fact extraction → narrative generation for all 10 priority sections → QC pass → PDF fill → ACI insertion | 95% success rate |
| Commercial golden path | Same for commercial form type through RQ insertion | 85% success rate |
| 1025/1073 generation coverage | Bring deferred forms to generation parity — create curated examples and form-specific templates for both | All priority sections generating |
| PDF filler completeness | Map remaining 1004 PDF fields beyond the current 120+ — target full form coverage including all checkbox fields, signature blocks, and appraiser certification | 95% field coverage |
| Error recovery | Every orchestrator failure should be recoverable without re-running the entire pipeline — implement section-level retry, partial completion with resume | Zero "start over" failures |
| Prompt version pinning | Lock system prompt, style guide, and review pass to versioned files — every generation run records which prompt versions were used for reproducibility | Full audit trail |

### Phase 1 Exit Criteria

- [ ] Zero dead code in repository
- [ ] All security vulnerabilities from audit resolved
- [ ] CI/CD pipeline running on every push
- [ ] 1004 golden path passes 95% of the time
- [ ] 70+ unit tests passing in Vitest
- [ ] Every API endpoint has input validation

---

## 2.5. ★ PHASE 1.5: PROPRIETARY AI ENGINE & BRAIN VISUALIZATION (Months 2–5) — PRIORITY

Goal: Productionize and harden the proprietary AI engine (fine-tuned Llama 3.1 8B) and interactive 3D Knowledge Brain dashboard as the platform's core differentiator. This is a competitive moat — no other appraisal tool has an appraiser-specific fine-tuned LLM with a visual knowledge graph.

> **Why Priority:** The proprietary AI engine and 3D brain visualization are the features that make CACC Writer fundamentally different from template-based competitors. Elevating this to Phase 1.5 ensures the core differentiator is production-ready before scaling infrastructure.

### Existing Assets (Built)

| Asset | Status | Location |
|-------|--------|----------|
| Fine-tuned Llama 3.1 8B model (`cacc-appraiser-v6`) | ✅ Deployed on RunPod RTX 4090 | vLLM on port 8000 |
| FastAPI backend (knowledge graph, comps, market, chat) | ✅ Running | RunPod port 8080 (`appraisal_agent/server.py`) |
| Knowledge Brain dashboard (D3.js force-directed graph) | ✅ Integrated into main UI | `brain.html` (897 lines) |
| Brain proxy routes (Express → RunPod) | ✅ Wired | `server/api/brainRoutes.js` (125 lines) |
| NetworkX knowledge graph engine | ✅ Functional | RunPod FastAPI server |
| WebSocket real-time AI chat | ✅ Functional | `wss://{pod}-8080.proxy.runpod.net/ws/chat` |

### 1.5.1 — AI Model Hardening (Weeks 1–4)

| Task | Detail | Priority |
|------|--------|----------|
| Model versioning & registry | Track model versions (v6, v7, ...) with metadata: training data hash, hyperparameters, eval scores. Store in `model_registry` table. Enable rollback to prior version. | HIGH |
| Training data pipeline | Automated pipeline: collect user-approved narratives → clean → format → upload to training corpus. Track provenance (which cases, which appraiser's voice). | HIGH |
| Continuous fine-tuning schedule | Monthly retraining cadence with accumulated approved narratives. A/B test new model vs current on held-out eval set before promoting to production. | HIGH |
| Multi-GPU inference scaling | Move from single RTX 4090 to multi-GPU or multi-pod for concurrent users. Configure vLLM tensor parallelism or deploy multiple replicas behind a load balancer. | MEDIUM |
| Fallback provider chain | If RunPod/vLLM is down, gracefully fall back to OpenAI/Gemini with a warning banner. Ensure generation never hard-fails due to proprietary model downtime. | CRITICAL |
| Latency optimization | Profile end-to-end latency: API call → vLLM inference → response. Target <3s for typical section generation. Implement KV cache warming, continuous batching tuning. | MEDIUM |
| Model evaluation framework | Automated eval suite: BLEU/ROUGE against golden examples, USPAP compliance scoring, hallucination detection rate, voice similarity scoring per user. Run on every candidate model before promotion. | HIGH |

### 1.5.2 — Knowledge Brain Dashboard Hardening (Weeks 2–5)

| Task | Detail | Priority |
|------|--------|----------|
| 3D graph rendering upgrade | Migrate from D3.js 2D force-directed to full 3D with Three.js or d3-force-3d. Add depth, rotation, zoom, camera controls for true 3D knowledge exploration. | HIGH |
| Graph data persistence | Store knowledge graph state in the database (nodes, edges, weights, metadata). Currently lives only in RunPod memory — must survive pod restarts. | CRITICAL |
| Per-user knowledge graphs | Each tenant gets their own knowledge graph layer on top of the shared base graph. User-specific nodes (their cases, their comps, their patterns) isolated. | HIGH |
| Real-time graph updates | When a user completes a case, new nodes/edges automatically appear in their brain visualization. WebSocket push from server on case completion events. | MEDIUM |
| Graph search & filtering | Search nodes by keyword, filter by type (case, comp, market area, pattern), highlight connected subgraphs. Add a search bar and filter panel to the brain UI. | MEDIUM |
| Brain insights panel | AI-powered insight cards: "Your most common adjustment pattern is...", "You've appraised 12 properties in this subdivision", "Market trend: prices up 4% in 60645". Generated from graph analysis. | HIGH |
| Offline/cached mode | Cache the last-loaded graph state in IndexedDB so the brain dashboard loads instantly even when RunPod is cold-starting. Show "live" vs "cached" indicator. | MEDIUM |

### 1.5.3 — AI Chat & Copilot Integration (Weeks 3–6)

| Task | Detail | Priority |
|------|--------|----------|
| Context-aware chat | The AI chat should have access to the currently open case's facts, comps, and generated sections. Ask questions like "Why did you adjust the comp at 123 Main St by -$5,000?" and get a case-specific answer. | HIGH |
| Chat history persistence | Store chat history per case in the database. Users can resume conversations across sessions. | MEDIUM |
| Copilot suggestions | While the user edits a generated section, the AI proactively suggests improvements, catches inconsistencies, and offers alternative phrasing. Display as subtle inline suggestions (like GitHub Copilot). | HIGH |
| Voice-aware responses | The AI chat should respond in the user's trained voice style when generating or suggesting narrative text. Pull voice profile from the user's KB. | MEDIUM |
| Multi-modal input | Accept photo uploads in chat (e.g., inspection photos) and have the AI describe property conditions, identify features, suggest narrative language. Uses the fine-tuned model's vision capabilities or a separate vision model. | MEDIUM |

### 1.5.4 — Infrastructure & Deployment (Weeks 4–8)

| Task | Detail | Priority |
|------|--------|----------|
| RunPod production hardening | Move from single dev pod to production serverless endpoint. Auto-scaling based on request volume. Health checks and auto-restart on failure. | CRITICAL |
| SSL/TLS for all AI endpoints | Ensure all RunPod proxy routes use HTTPS. Validate SSL certificates. Pin RunPod pod IDs via environment variables, not hardcoded. | HIGH |
| API key rotation for RunPod | Rotate RunPod API keys on a schedule. Store in secrets manager (AWS Secrets Manager, Doppler, or Vault). | MEDIUM |
| Cost monitoring & alerting | Track GPU-hours consumed per user, per case. Set budget alerts. Display cost dashboard in admin panel. Implement usage-based billing tie-in for enterprise tier. | HIGH |
| Monitoring & observability | Prometheus metrics from vLLM (tokens/sec, queue depth, latency p50/p95/p99). Grafana dashboard for AI engine health. Alert on degraded performance. | MEDIUM |

### Phase 1.5 Exit Criteria

- [ ] Fine-tuned model serving with <3s latency for section generation
- [ ] Model versioning with automated eval and rollback capability
- [ ] 3D knowledge graph rendering with per-user isolation
- [ ] Graph data persisted to database (survives pod restarts)
- [ ] AI chat context-aware with current case data
- [ ] Fallback to cloud provider when proprietary model unavailable
- [ ] RunPod production endpoint with auto-scaling and health monitoring
- [ ] GPU cost tracking per user operational

---

## 3. PHASE 2: MULTI-TENANT INFRASTRUCTURE (Months 3–6)

Goal: Two appraisers can safely use the system without seeing each other's data.

### 2.1 — Database Migration: SQLite → PostgreSQL (Weeks 1–4)

| Task | Detail |
|------|--------|
| Choose ORM | Drizzle ORM (type-safe, lightweight, great migration support) — or Prisma if you prefer the ecosystem. Drizzle recommended for this codebase because it's closer to raw SQL patterns you already use. |
| Schema translation | Convert all 87 `CREATE TABLE` statements from SQLite syntax to PostgreSQL. Key differences: `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))` → `TEXT PRIMARY KEY DEFAULT gen_random_uuid()`, `datetime('now')` → `NOW()`, `AUTOINCREMENT` → `SERIAL`, `json_extract` → `->>`/`->>` operators. |
| Add `user_id` to every table | Every data table gets a `user_id TEXT NOT NULL` column with a foreign key to `users.id`. Create composite indexes on `(user_id, ...)` for every query pattern. |
| Row-level security (RLS) | Enable PostgreSQL RLS policies: `CREATE POLICY tenant_isolation ON cases USING (user_id = current_setting('app.current_user_id'))`. Set the session variable in middleware. |
| Migration framework | Implement proper numbered migrations with up/down. Replace the 15 `phase*Schema.js` files with sequential migration files. |
| Connection pooling | PgBouncer or built-in pool (Drizzle supports connection pools natively). Configure pool size per environment. |
| Data layer refactor | Replace all `dbAll`, `dbGet`, `dbRun`, `dbTransaction` calls with ORM equivalents. The `db/repositories/` pattern stays — just swap the underlying engine. |
| Dual-mode operation | Keep SQLite support for local development and testing with an `DB_PROVIDER=sqlite` flag. |

### 2.2 — File Storage Migration (Weeks 3–5)

| Task | Detail |
|------|--------|
| S3/R2 for file storage | Move from filesystem `cases/` directory to S3-compatible object storage (Cloudflare R2 recommended — free egress, compatible with S3 SDK). |
| Per-tenant path namespacing | All files stored under `{user_id}/{case_id}/` prefix. Knowledge base under `{user_id}/kb/`. Voice corpus under `{user_id}/voice/`. |
| Local filesystem adapter | Keep filesystem mode for development: `STORAGE_PROVIDER=local` |
| Upload pipeline | All file uploads go through the storage service, never directly to filesystem. Multer → storage service → return URL/path. |

### 2.3 — Authentication & Authorization Completion (Weeks 4–8)

| Task | Detail |
|------|--------|
| Merge auth systems | Currently two auth implementations: `server/middleware/authMiddleware.js` (API key based) and `server/auth/authService.js` (JWT/bcrypt). Merge into one canonical auth system. |
| JWT with refresh tokens | Access token: 15 minute expiry. Refresh token: 7 day expiry, stored in HTTP-only secure cookie. Token rotation on refresh. |
| OAuth2 integration | "Sign in with Google" — appraisers love this. Use Passport.js or `arctic` library. Add Apple Sign-In for mobile. |
| Password reset flow | Forgot password → email link → reset page. Use `nodemailer` (already a dependency) with SendGrid/Resend as the transport. |
| Role-based access control | Roles: `admin`, `appraiser`, `trainee`, `reviewer`, `client_viewer` (for portal). Permissions matrix: which roles can access which endpoints. |
| API key system for public API | Per-user API keys with scoped permissions (read, write, generate, export). Rate limits per key. Key rotation support. Stored hashed in `api_keys` table. |
| Session management | Active sessions table — users can see and revoke active sessions from settings. Audit log of all login/logout events. |
| Tenant-scoped middleware | Every request that passes auth gets `req.tenantId` set. All downstream queries use this for isolation. Create a `withTenant(query)` helper that automatically injects the filter. |

### 2.4 — Frontend Rewrite Phase 1 (Weeks 5–12)

| Task | Detail |
|------|--------|
| Framework selection | Next.js 15 (App Router) with TypeScript, Tailwind CSS, shadcn/ui component library. Deploy to Vercel or Cloudflare Pages. |
| API client | Generated typed client from OpenAPI spec (use `@hey-api/openapi-ts` or write Zod schemas that mirror the backend). Every API call is type-safe. |
| Auth flow | Login page, registration, OAuth, password reset, email verification. JWT stored in HTTP-only cookie, refresh token rotation. Protected route wrapper. |
| Landing page | Marketing landing with pricing, features, testimonials, demo CTA. SSR for SEO. Convert existing `landing.html` design language to React components. |
| Dashboard | Case list with filtering/sorting/search, pipeline overview, recent activity, quick stats (reports this month, generation success rate, average completion time). |
| Case workspace | The main working interface — fact editor, generation controls, section preview, QC results, insertion controls, export options. Rebuild from `frontend/caseworkspace/code.html`. |
| Settings | Profile, subscription, AI provider config, voice model, notification preferences, API keys, team management (stub for Phase 9). Rebuild from `frontend/settings/`. |
| Analytics | Report production stats, AI usage, turnaround times, quality scores over time. Rebuild from `frontend/analytics/`. |

### Phase 2 Exit Criteria

- [ ] PostgreSQL running in production with all data migrated
- [ ] Every query scoped to authenticated user's tenant
- [ ] JWT auth with refresh tokens, OAuth, password reset all working
- [ ] Next.js frontend deployed with auth flow, dashboard, case workspace, settings
- [ ] S3/R2 file storage with per-tenant isolation
- [ ] Two test accounts can operate simultaneously with zero data leakage

---

## 4. PHASE 3: AI ENGINE PERFECTION (Months 6–9)

Goal: The AI generates lender-ready narratives for every section of every form type, every time.

> **Note:** This phase builds on the proprietary AI foundation established in Phase 1.5. The fine-tuned Llama model, Knowledge Brain dashboard, and 3D graph infrastructure are already production-hardened by this point. Phase 3 focuses on prompt engineering, section coverage, QC, and provider abstraction on top of that foundation.

### 3.1 — Prompt Engineering Hardening

| Task | Detail |
|------|--------|
| Section-specific system prompts | Break the monolithic 203-line `system_cacc_writer.txt` into per-section prompt modules. Each section gets its own template rules, example structures, and field-specific instructions. |
| Prompt version registry | Every prompt file gets a semver version. The generation orchestrator records which prompt versions produced each output. Enables A/B testing and rollback. |
| Dynamic few-shot selection | Current retrieval pulls examples by field ID. Enhance to also match by: property type, location, market conditions, loan program. A FHA condo in Chicago should retrieve FHA condo Chicago examples. |
| Confidence-adaptive generation | When facts are low-confidence or missing, the AI should seamlessly write around them with professional hedging — not produce `[INSERT]` placeholders. |
| Anti-hallucination guardrails | Post-generation regex/NLP scan for invented statistics, dates, prices, or measurements not present in the facts block. Flag and re-generate with explicit correction instructions. |
| Token optimization | Profile token usage per section. Implement intelligent context windowing — only include the most relevant examples and facts for each section. |

### 3.2 — Section Coverage Expansion

**1004 Single-Family (10 priority + 8 remaining):**

| Section | Status | Work Needed |
|---------|--------|-------------|
| `neighborhood_description` | ✅ Production | Maintain |
| `market_conditions` | ✅ Production | Maintain |
| `site_description` | ✅ Production | Maintain |
| `improvements_description` | ✅ Production | Maintain |
| `condition_description` | ✅ Production | Maintain |
| `contract_analysis` | ✅ Production | Maintain |
| `concessions_analysis` | ✅ Production | Maintain |
| `highest_best_use` | ✅ Production | Maintain |
| `sales_comparison_summary` | ✅ Production | Maintain |
| `reconciliation` | ✅ Production | Maintain |
| `adverse_conditions` | ✅ Production | Maintain |
| `functional_utility` | ✅ Production | Maintain |
| `prior_sales_subject` | ✅ Production | Maintain |
| `listing_history` | ✅ Production | Maintain |
| `cost_approach_summary` | 🔶 Partial | Connect to `costApproachEngine.js`, create templates |
| `income_approach_summary` | 🔶 Partial | Connect to `incomeApproachEngine.js`, create templates |
| `additional_comments` | 🔶 Partial | Build contextual rules for when extra comments are needed |
| `appraiser_certification` | 🔶 Partial | Template-based with state-specific language |

### 3.3 — AI Provider Abstraction

| Task | Detail |
|------|--------|
| Provider interface | Abstract `callAI()` into a provider pattern: `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, `AnthropicProvider`. Each implements `generate(messages, options) → string`. |
| Anthropic Claude support | Add Claude as a first-class generation provider. Claude's long context window (200K) is ideal for large fact blocks with many examples. |
| Per-section provider routing | Allow different providers for different tasks: Gemini for document extraction (cheap), Claude/GPT-4.1 for narrative generation (quality), Ollama for development (free). |
| Cost tracking per request | Log token usage and estimated cost for every AI call. Aggregate per user, per case, per section. Feed into billing for usage-based pricing tiers. |
| Streaming responses | Replace `responses.create()` with streaming for the UI. Users see narrative generating in real-time instead of waiting 10–20 seconds. |

### 3.4 — QC Engine Completion

| Checker | Current | Target |
|---------|---------|--------|
| `crossSectionConsistencyChecker` | 754 lines, functional | Add rules: GLA consistency across sections, address consistency, date consistency, value consistency between approaches |
| `contradictionGraphChecker` | Functional | Add: temporal contradiction detection (dates out of order), mathematical contradiction detection (adjustments don't sum) |
| `complianceSignalChecker` | Functional | Add: USPAP Standard 1 checklist, FNMA Selling Guide checks, FHA/VA-specific compliance rules |
| `placeholderGenericityChecker` | Functional | Add: detect vague language, detect template artifacts |
| `comparableIntelligenceChecker` | Functional | Add: comp distance limits, comp age limits, comp similarity scoring against subject |
| `requiredCoverageChecker` | Functional | Add: per-form-type required section matrix, per-lender additional requirements |
| NEW: `lenderSpecificChecker` | — | Configurable per-lender rules |
| NEW: `uspap2024Checker` | — | Full USPAP 2024–2025 edition checklist with citation references |
| NEW: `stateSpecificChecker` | — | Illinois IDPFR-specific rules, expandable to other states |

### Phase 3 Exit Criteria

- [ ] All 1004 sections generating at lender-ready quality
- [ ] 1025 and 1073 generating all sections with form-specific adaptations
- [ ] Commercial generating all narrative sections
- [ ] QC engine catches 95% of issues that a human reviewer would flag
- [ ] Streaming generation visible in frontend
- [ ] AI cost tracking per user/case operational

---

## 5. PHASE 4: VOICE GENERALIZATION & ONBOARDING (Months 9–11)

Goal: Any appraiser can onboard their writing style in under 1 hour and get personalized generation.

### 4.1 — Self-Serve Voice Training Pipeline

| Step | Implementation |
|------|---------------|
| Upload wizard | User uploads 5–20 completed PDF appraisal reports through a guided UI flow |
| Automated extraction | `server/ai/platformAI.js` + Gemini extracts all narrative sections from uploaded reports |
| Section classification | AI classifies each extracted narrative into its section type |
| Style profile generation | Analyze extracted narratives for: sentence structure patterns, vocabulary preferences, phrase frequency, template structures, typical paragraph length |
| Voice quality scoring | Rate each extracted example 1–100 on: completeness, USPAP compliance, professional tone, specificity. Only examples scoring >60 enter the voice profile. |
| Per-user KB population | Store voice examples in per-user Pinecone namespace. Each user's retrieval only hits their own namespace + the shared phrase bank. |
| A/B validation | Generate a sample section using the user's voice profile. Show it alongside the original. User confirms "this sounds like me" before activation. |

### Phase 4 Exit Criteria

- [ ] New user can onboard, train voice model, and generate first report in <60 minutes
- [ ] Voice profiles produce narratives that match the user's style with >85% similarity score
- [ ] Incremental learning from user edits operational
- [ ] Onboarding completion rate >70%

---

## 6. PHASE 5: DESKTOP AGENT UNIVERSALIZATION (Months 11–14)

Goal: Support the top 4 appraisal software platforms, not just ACI and Real Quantum.

### 5.1 — ACI Agent Hardening

| Task | Detail |
|------|--------|
| Field map completeness | Ensure `field_maps/1004.json` covers every writable field in the 1004 form |
| Tab navigation reliability | Build a state machine that tracks which tab is active and can recover from navigation failures |
| Multi-version support | Test against ACI versions from the last 3 years. Create version-specific field map overrides. |
| Error recovery | Capture screenshot + control tree state for diagnostics. Attempt alternate insertion strategies. |
| Batch insertion optimization | Group adjacent fields and insert them in a single tab navigation pass. |

### 5.2 — TOTAL by a]la mode Support (NEW)

TOTAL is the #2 appraisal software platform. New Python agent: `total_agent/agent.py`.

### 5.3 — ClickFORMS Support (NEW)

ClickFORMS is #3. New Python agent: `clickforms_agent/agent.py`.

### 5.4 — Agent Abstraction Layer

Unified agent interface: `POST /insert`, `POST /read`, `POST /navigate`, `GET /status`, `GET /screenshot`. Agent registry auto-discovers which agents are running on startup.

### Phase 5 Exit Criteria

- [ ] ACI insertion success rate >95% for all 1004 fields
- [ ] TOTAL agent functional for 1004 form with >90% insertion success
- [ ] ClickFORMS agent functional for 1004 form
- [ ] Agent health dashboard in frontend

---

## 7. PHASE 6: BUSINESS & REVENUE LAYER (Months 14–17)

Goal: Every business operation an appraisal firm needs is built into the platform.

### 6.1 — Stripe Billing Completion

Checkout flow for all 4 plans, usage metering, subscription management, webhook handling, invoice generation, 14-day free trial.

### 6.2 — Pipeline Management

Kanban-style view: New Orders → Scheduled → Inspected → In Progress → Review → Submitted → Paid. Auto-stage advancement, due date tracking, AMC order tracking.

### 6.3 — Fee Quoting & Engagement

Quote generation, engagement letters, invoicing, QuickBooks Online integration, pipeline analytics.

### 6.4 — Scheduling

Inspection scheduler with Google Calendar sync, route optimization, client notifications, availability management.

### 6.5 — Notifications

In-app, email, and webhook notification channels.

### Phase 6 Exit Criteria

- [ ] Stripe billing processing real payments
- [ ] Pipeline board functional with auto-stage advancement
- [ ] Fee quoting generates accurate quotes
- [ ] Calendar integration scheduling inspections
- [ ] Notification system delivering across all channels

---

## 8. PHASE 7: INTELLIGENCE & LEARNING PLATFORM (Months 17–20)

Goal: The system gets smarter with every report.

### 7.1 — Comparable Intelligence Completion (2,653 lines → production)
### 7.2 — Learning System Activation (2,378 lines → production)
### 7.3 — Valuation Engine Completion (572 lines → production)
### 7.4 — Market Intelligence

### Phase 7 Exit Criteria

- [ ] Comp scoring and ranking operational with 12-dimension model
- [ ] Feedback loop learning from every user edit
- [ ] Cost and income approach engines producing calculations
- [ ] Market intelligence dashboard showing local market trends

---

## 9. PHASE 8: INTEGRATIONS ECOSYSTEM (Months 20–23)

Goal: Connect to every external system an appraiser interacts with.

### 8.1 — AMC Order Platforms (Mercury, Global DMS, Dart, Reggora)
### 8.2 — MLS Connectivity (RESO Web API, MRED)
### 8.3 — Submission Platforms (UCDP/EAD, FHA, MISMO XML)
### 8.4 — Document & Communication Integrations (Gmail, Sheets, eSign, Calendar, Webhooks)
### 8.5 — Data Enrichment (County assessor crawling, flood zone, USPS)

### Phase 8 Exit Criteria

- [ ] At least one AMC platform bidirectionally integrated
- [ ] MLS data retrieval working for at least one MLS
- [ ] UCDP submission successfully submitting test reports
- [ ] Gmail auto-parsing order emails into cases

---

## 10. PHASE 9: ENTERPRISE & SCALE (Months 23–27)

Goal: Support appraisal firms with 5–50 appraisers.

### 9.1 — Team Collaboration (firm management, case assignment, review workflow, real-time presence)
### 9.2 — Client Portal (secure links, status tracking, revision requests)
### 9.3 — White-Label (custom branding, custom domain, branded exports)
### 9.4 — Public API (REST + OpenAPI, API keys, rate limiting, SDKs)
### 9.5 — Compliance & Audit (workfile compliance, regulatory, audit log, SOC 2 readiness)
### 9.6 — Automation Rules (visual rule builder, triggers, conditions, actions, templates)

### Phase 9 Exit Criteria

- [ ] 5-person firm operating with role-based access and review workflows
- [ ] Client portal delivering status updates
- [ ] White-label operational with custom domain support
- [ ] Public API documented and serving external integrations
- [ ] SOC 2 technical controls in place

---

## 11. PHASE 10: MARKETPLACE & COMMUNITY (Months 27–30)

### 10.1 — Template Marketplace (Stripe Connect, 30% commission)
### 10.2 — Referral & Growth System (referral codes, affiliate partnerships)
### 10.3 — Education Center (tutorials, best practices, CE credit tracking)

---

## 12. PHASE 11: MOBILE & FIELD PLATFORM (Months 30–33)

### 11.1 — Mobile Inspection App (React Native, offline-first, photo capture, voice notes, measurements)
### 11.2 — Sketch Digitizer Enhancement (photo-to-floor-plan, hand-drawn parsing)
### 11.3 — Photo Addendum Generator (URAR-compliant pages, AI captions)

---

## 13. PHASE 12: PERFECTION & MARKET DOMINANCE (Months 33–36)

### 12.1 — UAD 3.6 / Redesigned URAR Readiness
### 12.2 — Performance Optimization (full report <30s, 500+ concurrent users)
### 12.3 — Analytics & Business Intelligence
### 12.4 — Data Backups & Disaster Recovery
### 12.5 — Forecasting & Advanced AI

---

## 14. CROSS-CUTTING CONCERNS (Continuous)

### Monitoring & Observability
Sentry (Phase 1), Datadog/Grafana (Phase 2), Langfuse/LangSmith (Phase 3), Uptime monitoring (Phase 2)

### TypeScript Migration
Phase 1: JSDoc types. Phase 2: New code in TS. Phase 3–6: Incremental conversion. Phase 7+: Full TS.

### Security
Dependency scanning (every CI run), pen testing (annually), security audit (every phase gate), encryption key rotation (90 days), access review (quarterly).

---

## 15. FEATURE MODULE COMPLETION MATRIX

| Module | Lines | Current % | Target Phase |
|--------|-------|-----------|-------------|
| `server/orchestrator/` | 2,078 | 65% | Phase 1 |
| `server/promptBuilder.js` | 585 | 70% | Phase 3 |
| `server/ai/` (23 modules) | 4,266 | 25% | Phase 3/7 |
| `server/intelligence/` | 3,745 | 30% | Phase 7 |
| `server/comparableIntelligence/` | 2,653 | 30% | Phase 7 |
| `server/valuation/` | 572 | 20% | Phase 7 |
| `server/learning/` | 2,378 | 20% | Phase 7 |
| `desktop_agent/` (ACI) | ~4,000 | 50% | Phase 5 |
| `server/ingestion/` | 2,909 | 40% | Phase 3 |
| `server/dataPipeline/` | 3,608 | 25% | Phase 8 |
| `server/export/` | 4,076 | 35% | Phase 3 |
| `server/qc/` | 3,984 | 35% | Phase 3 |
| `server/auth/` | 329 | 40% | Phase 2 |
| `server/security/` | 2,884 | 30% | Phase 2 |
| `server/billing/` | 449 | 20% | Phase 6 |
| `server/db/` | 3,791 | 50% | Phase 2 |
| `server/business/` | 3,026 | 15% | Phase 6 |
| `server/integrations/` | 2,477 | 15% | Phase 8 |
| `server/marketplace/` | 246 | 5% | Phase 10 |
| **`brain.html` + `brainRoutes.js` (Proprietary AI)** | **~1,020** | **45%** | **Phase 1.5 ★** |
| **RunPod FastAPI (`appraisal_agent/server.py`)** | **~800** | **50%** | **Phase 1.5 ★** |
| **Fine-tuned model pipeline (training + eval)** | **~200** | **25%** | **Phase 1.5 ★** |

---

## 16. REVENUE MODEL & GROWTH TARGETS

### Pricing Tiers

| Tier | Price | Reports/mo | Key Features | Target User |
|------|-------|-----------|-------------|-------------|
| Free | $0 | 5 | Basic generation, 1 form type, no insertion | Tire-kickers, trainees |
| Starter | $49/mo | 30 | All form types, voice training, PDF export | Part-time appraisers |
| Professional | $149/mo | 100 | + ACI/RQ insertion, QC engine, comp intelligence, priority AI | Full-time appraisers |
| Enterprise | $299/mo | Unlimited | + Teams, white-label, API, automation, custom model, dedicated support | Firms (5–50 users) |
| Marketplace | 30% commission | — | Template sales, adjustment packs, market data | Top producers |

### Growth Milestones

| Milestone | Users | MRR | ARR | Timeline |
|-----------|-------|-----|-----|----------|
| Alpha launch | 10 (hand-picked) | $0 | $0 | Month 6 |
| Beta launch | 50 | $3,500 | $42K | Month 9 |
| Public launch | 200 | $20K | $240K | Month 12 |
| Product-market fit | 500 | $55K | $660K | Month 18 |
| Growth phase | 1,500 | $175K | $2.1M | Month 24 |
| Scale phase | 3,000 | $400K | $4.8M | Month 30 |
| Dominance | 5,600+ | $835K+ | $10M+ | Month 36 |

### Key Assumptions

- 78,000 licensed residential appraisers in the US
- 5,600 users at $149/mo average = $10M ARR (7.2% market penetration)
- 30% annual churn requires 2,400 new users/year at steady state
- Primary acquisition: word of mouth, AMC partnerships, state associations, SEO/content

---

## FINAL NOTE

Every feature in this codebase was envisioned because it solves a real problem appraisers face. The **proprietary AI engine** (fine-tuned Llama 3.1 8B) creates a technology moat that no template-based competitor can replicate. The **3D Knowledge Brain** creates a visualization moat — appraisers can see their expertise growing as a living knowledge graph. The marketplace creates a community moat. The learning system creates a data moat. The voice engine creates a switching cost moat. The automation rules create a workflow dependency moat. Together, they make CACC Writer not just a tool, but the operating system for the appraisal profession.

The proprietary AI and brain visualization are elevated to Phase 1.5 because they are the features that make this product fundamentally different. Every competitor uses generic GPT wrappers. CACC Writer has its own appraiser-trained model, its own knowledge graph, and its own 3D brain interface. That's the moat.

The $10M product is not a fantasy. It's an engineering plan with a clear sequence. Build it right, in order, and every phase funds the next.
