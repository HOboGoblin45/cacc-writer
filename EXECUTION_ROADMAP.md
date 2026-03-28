# Appraisal Agent — SaaS Execution Roadmap

> Last updated: March 27, 2026

## Launch Model

**Cloud SaaS (multi-tenant hosted product)**

Golden path: **Import → Facts → Generate → Review → Export (PDF/DOCX download)**

Desktop insertion into ACI/Real Quantum is deferred to a future desktop companion app.

## Active Production Scope

| Form Type | Status | Notes |
|-----------|--------|-------|
| 1004 (Single-Family Residential) | **Active** | Proven golden-path end-to-end |
| Commercial (Real Quantum) | **Active** | Proven golden-path end-to-end |
| 1025 (Small Residential Income) | Deferred | No proven golden-path yet |
| 1073 (Individual Condo Unit) | Deferred | No proven golden-path yet |
| 1004C (Manufactured Home) | Deferred | Low usage frequency |

---

## Phase 1 — Tenant Isolation (Complete)

Per-user SQLite databases (`data/users/{userId}/cacc.db`). Case CRUD operations routed through `getUserDb(userId)`. Shared DB used only in development mode.

## Phase 2 — Auth Hardening (Complete)

Auth middleware blocks unauthenticated requests in production (`NODE_ENV=production`). JWT_SECRET required on startup. Development fallback uses `dev-local` userId (not `default`).

## Phase 3 — Billing Integration (Complete)

Stripe checkout, webhook (with signature verification), subscription status, and customer portal endpoints. All billing routes guarded by `requireStripe` middleware (503 when Stripe unconfigured).

## Phase 4 — Frontend Auth + Export (Complete)

Signup and login pages. Auth guard in `app.js` intercepts fetch() calls with JWT. Step 5 converted from "Insert" to "Export" with PDF/DOCX download and clipboard copy. ACI insertion preserved but gated behind `window.DESKTOP_MODE`.

## Phase 4.5 — ★ Proprietary AI Engine & Brain Visualization (PRIORITY)

Harden and productionize the proprietary fine-tuned Llama 3.1 8B model (RunPod vLLM) and 3D Knowledge Brain dashboard. This is the platform's core differentiator.

**Existing (built):** Fine-tuned `cacc-appraiser-v6` on RunPod RTX 4090, D3.js knowledge graph in `brain.html`, FastAPI backend with NetworkX graph engine, WebSocket AI chat, Express proxy routes in `brainRoutes.js`.

**Next steps:**
- Model versioning & automated eval framework
- 3D graph upgrade (Three.js or d3-force-3d) with per-user graph isolation
- Persist graph data to database (survives pod restarts)
- Context-aware AI chat with current case data
- Fallback to OpenAI/Gemini when proprietary model unavailable
- RunPod production serverless endpoint with auto-scaling
- GPU cost tracking per user

## Phase 5 — Cloud Deployment

Docker containerization, managed hosting (AWS/GCP/Railway), HTTPS, production environment variables, health check endpoints.

## Phase 6 — Cloud File Storage

Migrate from local filesystem case directories to S3-compatible object storage. User uploads stored per-tenant.

## Phase 7 — Shared Knowledge Base with Tenant Boundaries

Cross-tenant knowledge base that improves generation quality over time. Tenant-specific voice models and approved narrative patterns. Privacy boundaries enforced at the data layer.

## Phase 8 — Additional Form Types

Prove golden-path for 1025 and 1073 form types. Move from deferred to active only after end-to-end generation+export is verified.

## Phase 9 — API Access for Integrations

REST API with API key authentication for third-party integrations. Webhook notifications for case status changes.

## Phase 10 — Desktop Companion App

Windows desktop app for ACI/Real Quantum field insertion. Communicates with cloud server via authenticated API. Enables the full loop: cloud generation → desktop insertion.
