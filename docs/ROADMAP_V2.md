# CACC Writer — Updated Roadmap v2.0

**Last updated:** March 28, 2026
**Branch:** `main` (merged from `saas-v1-completion`)

---

## What's Been Completed (Phase 1 → Phase 2)

### Phase 1: Core Platform (Complete)
- Express.js server with 80+ route modules
- AI generation pipeline: orchestrator → prompt builder → AI client → draft assembly
- 6 generator profiles (template-heavy through synthesis)
- QC engine with 7 checkers, 38 rules, severity model, approval gate
- Knowledge Brain with D3.js 3D graph, NetworkX backend, WebSocket chat
- Fine-tuned Llama 3.1 8B on RunPod with vLLM inference
- Desktop agents for ACI and Real Quantum field insertion
- Per-user SQLite isolation, JWT auth, Stripe billing

### Phase 2: SaaS Hardening (Complete — 20 commits)
- Zod validation on all 77 route files
- CSRF protection, environment validation, graceful shutdown
- Per-plan rate limiting on AI endpoints (free/starter/pro/enterprise)
- QC pipeline integration into generation orchestrator (non-blocking)
- Fact completeness checker (FACT-001/002/003 rules)
- 1004 golden path quality audit — 7 enhanced prompt templates
- 1025 form parity — complete income property support (16 sections)
- CI/CD pipeline (GitHub Actions), Docker production config
- PostgreSQL + S3/R2 migration plans documented
- Load testing infrastructure (4 scenarios)
- **705 tests passing across 22 test files**

---

## Assessment: G0DM0D3-Inspired Enhancement Pipeline

After cross-referencing the proposed 4 subsystems against the existing codebase, here's what's genuinely valuable, what's redundant, and the recommended implementation order.

### Subsystem 1: STM Output Normalizer — RECOMMENDED (High Value)

**What already exists:**
- QC checker (PLH-001 through PLH-007) detects AI filler, vague language, placeholders, repetition — but only *after* the full draft is assembled, not inline per-section
- `narrativeRewriter.js` has 7 rewrite modes (formal, concise, uspap, fix_issues, etc.) but is manual/one-shot
- `scoreSectionOutput()` computes quality score but doesn't trigger automated cleanup

**What the STM Normalizer adds:**
- *Inline* regex cleanup between AI output and scoring — catches problems before they're persisted
- Zero-cost preamble stripping (removes "Sure, here is..." artifacts)
- Professional voice enforcement ("the home" → "the subject property")
- Character limit enforcement for ACI field constraints
- Optional LLM cleanup pass for synthesis/analysis sections

**Verdict:** Build it. The regex pass is free, always-on, and immediately improves every generation. The existing QC checker operates at the draft-package level (post-assembly), while STM operates at the section level (pre-scoring). They're complementary, not redundant.

**Modifications from original spec:**
- Skip the separate database table for now — log STM metrics into the existing `section_jobs` audit metadata instead
- Wire the LLM pass through `narrativeRewriter.js` in `fix_issues` mode rather than a raw `callAI()` call — reuse existing infrastructure
- Add the `maxChars` enforcement from ACI field maps (already defined in `desktop_agent/field_maps/1004.json`)

### Subsystem 2: AutoTune Context Classifier — RECOMMENDED (Medium-High Value)

**What already exists:**
- 6 static generator profiles with fixed temperature/maxTokens per section
- `scoreSectionOutput()` returns 0–1 quality scores with penalty codes
- `feedbackLoopService.js` tracks pattern confidence via approved/rejected outcomes
- But: *no closed loop from quality scores back to generation parameters*

**What AutoTune adds:**
- Dynamic temperature/maxTokens adjustment based on historical quality data
- Context-aware overrides (relocation narratives get richer neighborhood descriptions, multi-unit properties get more token budget)
- EMA learning that improves generation parameters over time

**Verdict:** Build it, but simplify. The EMA learning loop and context overrides are the real value. Skip the "multi-armed bandit" complexity for now — a simple rolling average with configurable thresholds will deliver 80% of the benefit.

**Modifications from original spec:**
- The EMA tables (`autotune_performance`, `autotune_ema_state`) are worth building — they provide the data infrastructure for future ML optimization
- Wire `wasApproved` into `feedbackLoopService.js` as specified — this closes the learning loop
- Keep it behind `AUTOTUNE_ENABLED=true` (default on) since it only *adjusts* existing profiles, never replaces them
- Remove the `assignmentPurpose` override for relocation — the prompt templates already handle this via `buildAssignmentContextBlock()` in promptBuilder.js

### Subsystem 3: Parallel Prompt Racing — DEFER (Low Priority)

**What already exists:**
- Concurrency limiter (MAX_CONCURRENT=8) with slot-based queuing
- Circuit breaker and exponential backoff retry
- Rate limits per user tier (10–1000 AI calls/hour)

**Why defer:**
- Cost multiplier of 2–3x per section is significant at scale
- The existing rate limiter already constrains API calls per user — racing would eat into those limits fast
- The prompt variant strategies described are essentially different system hints — these can be A/B tested *sequentially* through AutoTune's EMA loop without the cost of parallel execution
- The scoring function described (composite of quality score + length + fact coverage + voice similarity) is valuable but belongs in the quality scoring layer, not a racing framework

**Verdict:** Don't build the racer now. Instead, fold the *variant strategies* into AutoTune as configurable system hint overrides that get A/B tested over time. Build the composite scoring function as an enhancement to `scoreSectionOutput()`. If a customer later demands real-time A/B testing, the infrastructure (callAI concurrency, scoring) will be ready.

**What to salvage:**
- The variant strategy definitions (structure-first vs. data-forward for retrieval-guided, four-tests vs. conclusion-first for logic-template) — add these as alternative `systemHintOverride` options in AutoTune
- The composite scoring function — enhance `scoreSectionOutput()` with fact coverage and voice consistency dimensions

### Subsystem 4: ULTRAPLINIAN Evaluation Engine — PARTIAL (Build Quick Tier Only)

**What already exists:**
- `reviewAgent.ts` — two-pass LLM review for unsupported claims, fact mismatch, tone, USPAP compliance
- Pinecone vector DB configured with 1536-dim embeddings
- LangSmith + Langfuse observability tracing
- QC engine with 38 deterministic/pattern rules

**Assessment:**
- The "quick" tier (regex fact-matching, completeness keywords, prohibited phrases, placeholder detection) is essentially what the QC engine already does. Adding a few more targeted checks is low-cost and valuable.
- The "standard" tier (embedding similarity against voice examples via Pinecone) is genuinely new and valuable for voice consistency scoring.
- The "deep" tier (LLM rubric grading) largely duplicates what `reviewAgent.ts` already does — both use an LLM call to grade factual accuracy, USPAP compliance, and completeness.

**Verdict:** Build the embedding-based voice consistency scoring (standard tier) and integrate it into `scoreSectionOutput()`. Skip the LLM rubric grading (deep tier) — it's redundant with the existing review agent. Keep the "quick" tier checks minimal since QC engine PLH-001 through PLH-007 already covers most of them.

**What to salvage:**
- Voice consistency via Pinecone cosine similarity — this is the one dimension not covered anywhere in the current system. Build it as a `voiceConsistencyScorer.js` that the scoring pipeline can call.
- The `precompute_reference_embeddings.mjs` script — useful for establishing quality baselines
- The verdict mapping (pass/revise/fail) — wire into the existing QC approval gate thresholds

---

## Updated Roadmap: Phase 3 → Phase 5

### Phase 3: Narrative Intelligence Pipeline (4–6 weeks)
*The refined version of the G0DM0D3 proposal — building only what adds genuine value.*

| Task | Priority | Est. | Dependencies |
|------|----------|------|-------------|
| **STM Output Normalizer** | P0 | 1 week | None — zero-cost regex, immediate value |
| **AutoTune Classifier + EMA learning** | P1 | 2 weeks | STM (for cleaner quality signals) |
| **Voice Consistency Scorer** (Pinecone) | P1 | 1 week | Pinecone configured (already done) |
| **Phase 20 schema migration** | P0 | 2 days | None |
| **Enhancement routes + diagnostics** | P2 | 3 days | Schema migration |
| **Composite scoring enhancement** | P1 | 1 week | Voice scorer, STM |
| **Integration tests** | P1 | 3 days | All above |

**Deliverables:**
- `server/ai/stmNormalizer.js` — regex cleanup + optional LLM pass
- `server/ai/autoTuneClassifier.js` — dynamic parameter tuning with EMA
- `server/ai/voiceConsistencyScorer.js` — Pinecone embedding similarity
- `server/api/enhancementRoutes.js` — diagnostic endpoints
- `server/migration/phase20Schema.js` — AutoTune + STM tables
- `scripts/precompute_reference_embeddings.mjs` — baseline embeddings

**NOT building (deferred):**
- Prompt racer (cost too high, variant strategies folded into AutoTune)
- ULTRAPLINIAN deep tier (redundant with reviewAgent.ts)
- stm_normalization_log table (log to existing audit metadata instead)

### Phase 4: Infrastructure Migration (12–18 weeks)
*Execute the plans already documented in `docs/migration/`.*

| Task | Priority | Est. | Dependencies |
|------|----------|------|-------------|
| **Database abstraction layer** | P0 | 3 weeks | None |
| **Repository consolidation** (173 files with raw SQL) | P0 | 4 weeks | Abstraction layer |
| **PostgreSQL schema translation** | P1 | 2 weeks | Repository consolidation |
| **Row-level security multi-tenancy** | P1 | 2 weeks | Schema translation |
| **Async conversion** (sync → async/await) | P0 | 3 weeks | All above |
| **Cloudflare R2 storage adapter** | P1 | 1 week | None (can parallel) |
| **Knowledge base → R2 migration** | P2 | 1 week | R2 adapter |
| **Data migration + cutover** | P0 | 2 weeks | Everything |

### Phase 5: Scale & Commercial Readiness (6–8 weeks)

| Task | Priority | Est. | Dependencies |
|------|----------|------|-------------|
| **1073 Condo form support** | P1 | 3 weeks | Phase 3 quality pipeline |
| **Commercial form (Real Quantum)** | P2 | 4 weeks | Phase 4 infrastructure |
| **UAD 3.6 form support** (mandatory Nov 2, 2026) | P0 | 3 weeks | Phase 3 pipeline |
| **Desktop agent calibration** (1025 ACI fields) | P1 | 1 week | 1025 form complete |
| **Multi-model fallback chain** (OpenAI → Gemini → Ollama) | P1 | 1 week | Phase 3 AutoTune |
| **Stripe subscription enforcement** | P2 | 1 week | Phase 4 infrastructure |
| **SOC 2 compliance prep** | P2 | 2 weeks | Phase 4 encryption/audit |

---

## Decision Summary

| G0DM0D3 Subsystem | Decision | Reasoning |
|---|---|---|
| **STM Normalizer** | BUILD NOW | Zero-cost regex pass, fills gap between AI output and scoring |
| **AutoTune Classifier** | BUILD NOW | Closes the learning loop, profiles currently static and never improve |
| **Prompt Racer** | DEFER | 2–3x cost, variant strategies better served via AutoTune A/B testing |
| **ULTRAPLINIAN (Quick)** | SKIP | QC engine already covers these checks |
| **ULTRAPLINIAN (Standard)** | BUILD as Voice Scorer | Pinecone voice consistency is genuinely missing |
| **ULTRAPLINIAN (Deep)** | SKIP | Redundant with existing reviewAgent.ts |
| **Phase 20 Schema** | BUILD NOW | Required for AutoTune data storage |
| **Enhancement Routes** | BUILD NOW | Diagnostic visibility for new subsystems |

---

## Architecture After Phase 3

```
buildPromptMessages()
    ↓
[AutoTune adjusts temperature/maxTokens based on EMA history]
    ↓
callAI() → raw output
    ↓
[STM Normalizer: regex cleanup → optional LLM fix_issues pass]
    ↓
scoreSectionOutput() [ENHANCED: + fact coverage + voice consistency via Pinecone]
    ↓
[QC Engine: 38+ rules including FACT-001/002/003]
    ↓
reviewAgent (LLM two-pass review)
    ↓
feedbackLoop → [ENHANCED: records AutoTune outcomes, updates EMA state]
```

This pipeline adds 3 new touch points (AutoTune, STM, voice scoring) without replacing anything that already works.
