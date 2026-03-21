# Appraisal Agent v2.0

AI-powered appraisal narrative generator for **Charles Cresci, Cresci Appraisal & Consulting Company**.

Automates the writing of professional, USPAP-conscious appraisal narratives for all major residential and commercial form types. Inserts generated text directly into ACI (residential) and Real Quantum (commercial) appraisal software.

**Production status:** All 10 hardening phases complete. 28/28 smoke tests passing. 297 KB examples loaded.

---

## What It Does

| Task | Automated? |
|------|-----------|
| Generate narrative sections from subject facts | ✅ AI (OpenAI GPT-4.1) |
| Two-pass draft + review (hallucination cleanup) | ✅ Reviewer pass with JSON issue report |
| Match Charles Cresci's writing style | ✅ Knowledge base (297 examples) |
| Confidence-gated facts (high/medium/low) | ✅ Prevents unsupported claims |
| Geocode subject + comps, inject location context | ✅ Nominatim + Overpass (free, no key) |
| Insert text into ACI (residential) | ✅ pywinauto desktop automation |
| Insert text into Real Quantum (commercial) | ✅ Playwright browser automation |
| Extract facts from uploaded PDFs | ✅ 3-stage OCR pipeline |
| Store and retrieve approved edits | ✅ Local knowledge base (auto-grows) |
| Grade narrative completeness | ✅ AI rubric scoring |
| Pipeline stage tracking per case | ✅ intake→extracting→generating→review→approved→inserting→complete |
| Property inspections | ❌ Manual (by design) |
| Subject property data entry | ❌ Manual (by design) |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser UI (index.html)                   │
│              http://localhost:5178                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────────┐
│         Appraisal Agent Server  appraisal-agent-server.js  :5178     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Modular Generation Layer  (server/)                 │    │
│  │  openaiClient.js  → callAI() singleton               │    │
│  │  knowledgeBase.js → addExample(), getExamples()      │    │
│  │  retrieval.js     → getRelevantExamples() (4-pass)   │    │
│  │  promptBuilder.js → buildPromptMessages() 6-block    │    │
│  │                     buildReviewMessages() (pass 2)   │    │
│  │  geocoder.js      → Nominatim geocoding + Haversine  │    │
│  │  neighborhoodContext.js → Overpass boundary features │    │
│  │  logger.js        → structured JSON logging          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  • Case management (create, upload docs, extract facts)      │
│  • Two-pass AI generation (draft → review/revise)            │
│  • Confidence-gated facts (high/medium/low)                  │
│  • Location context injection (geocode + Overpass)           │
│  • Knowledge base (297 examples, auto-grows on approval)     │
│  • Pipeline stage tracking per case                          │
│  • Form registry (1004, 1025, 1073, 1004c, commercial)       │
└──────┬───────────────────────────────────────┬──────────────┘
       │ /insert-batch                         │ /insert-batch
       │ (residential forms)                   │ (commercial form)
┌──────▼──────────────┐             ┌──────────▼──────────────┐
│   ACI Agent         │             │  Real Quantum Agent      │
│   desktop_agent/    │             │  real_quantum_agent/     │
│   Python/pywinauto  │             │  Python/Playwright       │
│   :5180             │             │  :5181                   │
│                     │             │                          │
│  automation_id →    │             │  CSS selector →          │
│  control_index →    │             │  clipboard fallback      │
│  title label →      │             │  screenshot on failure   │
│  clipboard fallback │             │                          │
│  screenshot on fail │             │                          │
└──────┬──────────────┘             └──────────┬──────────────┘
       │                                       │
┌──────▼──────────────┐             ┌──────────▼──────────────┐
│   ACI Software      │             │  Real Quantum            │
│   (desktop app)     │             │  (web app in Chrome)     │
│   1004/1025/1073/   │             │  commercial reports      │
│   1004c forms       │             │                          │
└─────────────────────┘             └─────────────────────────┘
```

### Generation Pipeline (per field)

```
facts.json + geocode.json
        │
        ▼
getRelevantExamples()   ← KB: approved_edits (1.5×) > curated (1.0×) > imported (0.7×)
        │
        ▼
buildPromptMessages()   ← [system] [style] [examples] [phrases] [facts] [location?] [field tpl] [request]
        │
        ▼
callAI() → draft text
        │
        ▼ (if twoPass=true)
buildReviewMessages()   ← checks: unsupported claims, tone, USPAP, confidence violations
        │
        ▼
callAI() → { revisedText, issues[], confidence, changesMade }
        │
        ▼
outputs.json  →  approve  →  addExample() → KB grows
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- OpenAI API key
- ACI appraisal software (for residential insertion)
- Real Quantum account (for commercial insertion)

### 1. Install Node.js dependencies

```bash
npm install
```

### 2. Configure environment

```bash
copy .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-...
```

### 3. Set up ACI agent (residential)

```bash
cd desktop_agent
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Set up Real Quantum agent (commercial)

```bash
cd real_quantum_agent
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### 5. Start everything

Double-click **`start-all.bat`** — this starts the server and both agents in separate windows.

Or start individually:
- Server only: `start-server.bat`
- ACI agent only: `python desktop_agent/agent.py`
- Real Quantum agent only: `start-rq-agent.bat`

---

## Form Types Supported

| Form | Description | Insert Target |
|------|-------------|--------------|
| `1004` | URAR Single Family Residential | ACI |
| `1025` | Small Residential Income (2-4 unit) | ACI |
| `1073` | Individual Condominium Unit | ACI |
| `1004c` | Manufactured Home | ACI |
| `commercial` | Commercial Narrative | Real Quantum |

---

## Project Structure

```
appraisal-agent/
├── appraisal-agent-server.js     ← Main production server (port 5178) ← SINGLE RUNTIME
├── index.html                ← Browser UI
├── app.js                    ← Frontend JavaScript
├── start-server.bat          ← Start server only
├── start-rq-agent.bat        ← Start Real Quantum agent
├── start-all.bat             ← Start everything
├── _test_smoke.mjs           ← Smoke test suite (28 tests)
├── .env                      ← Your API key (gitignored)
│
├── server/                   ← Modular generation layer (imported by main server)
│   ├── server.js             ← ⚠️ DEPRECATED as standalone — use appraisal-agent-server.js
│   ├── openaiClient.js       ← OpenAI singleton + callAI()
│   ├── knowledgeBase.js      ← addExample(), getExamples(), indexExamples()
│   ├── retrieval.js          ← getRelevantExamples() (4-pass fallback)
│   ├── promptBuilder.js      ← buildPromptMessages() 6-block pipeline
│   │                            buildReviewMessages() two-pass reviewer
│   ├── geocoder.js           ← Nominatim geocoding, Haversine, cardinal direction
│   ├── neighborhoodContext.js← Overpass API boundary features, formatLocationContextBlock()
│   └── logger.js             ← Structured JSON logger (debug/info/warn/error)
│
├── forms/                    ← Form registry
│   ├── index.js              ← FORM_REGISTRY, getFormConfig(), listForms()
│   ├── 1004.js               ← Single Family config + facts schema
│   ├── 1025.js               ← Small Income config
│   ├── 1073.js               ← Condo Unit config
│   ├── 1004c.js              ← Manufactured Home config
│   └── commercial.js         ← Commercial config
│
├── prompts/                  ← AI system prompts
│   ├── system_cacc_writer.txt ← Appraisal Agent role + confidence rules
│   ├── style_guide_cresci.txt ← Charles Cresci writing style guide
│   └── review_pass.txt       ← Two-pass reviewer system prompt (JSON output)
│
├── knowledge_base/           ← Local example storage (297 examples loaded)
│   ├── index.json            ← Master index (auto-rebuilt on addExample/reindex)
│   ├── approved_edits/       ← Appraiser-approved edits (qualityScore 80–90, weight 1.5×)
│   ├── curated_examples/     ← Hand-curated examples per form type (weight 1.0×)
│   │   ├── 1004/
│   │   ├── 1025/
│   │   ├── 1073/
│   │   └── commercial/
│   ├── phrase_bank/
│   │   └── phrases.json      ← 12 reusable clauses (flood zone, HBU, zoning, etc.)
│   └── raw_imports/          ← Source files for bulk import
│
├── desktop_agent/            ← ACI automation (residential)
│   ├── agent.py              ← Flask + pywinauto agent (port 5180)
│   │                            Endpoints: /health /insert /insert-batch /test-field
│   │                                       /calibrate /reload-maps
│   ├── config.json           ← ACI window pattern, delays, retries
│   ├── requirements.txt      ← flask, pywinauto, pyperclip, pillow
│   ├── README.md             ← ACI agent setup + calibration guide
│   └── field_maps/
│       ├── 1004.json         ← 1004 field → automation_id + control_index + label
│       ├── 1025.json         ← 1025 field map
│       ├── 1073.json         ← 1073 field map
│       └── commercial.json   ← Commercial fallback
│
├── real_quantum_agent/       ← Real Quantum automation (commercial)
│   ├── agent.py              ← Flask + Playwright agent (port 5181)
│   │                            Endpoints: /health /insert /insert-batch /test-field
│   │                                       /reload-maps /screenshot
│   ├── config.json           ← CDP URL, browser, timeouts
│   ├── requirements.txt      ← flask, playwright, pyperclip, pillow
│   ├── selector_discovery.py ← Discover CSS selectors from live RQ session
│   ├── README.md             ← Real Quantum agent setup guide
│   └── field_maps/
│       └── commercial.json   ← 8 real commercial field → CSS selector entries
│
├── voice_pdfs/               ← Drop completed appraisal PDFs here for import
│   ├── 1004/
│   ├── 1025/
│   ├── 1073/
│   ├── 1004c/
│   └── commercial/
│
└── cases/                    ← Active case files (gitignored)
    └── <caseId>/
        ├── meta.json         ← address, borrower, formType, pipelineStage
        ├── facts.json        ← extracted facts with confidence levels
        ├── outputs.json      ← generated sections (approved=true/false)
        ├── feedback.json     ← per-field ratings and edits
        ├── geocode.json      ← subject + comp geocode results (cached)
        ├── history.json      ← last 3 versions per field
        └── documents/        ← uploaded PDFs
```

---

## API Endpoints

### Main Server (port 5178)

**Health & Forms**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Quick health check |
| `GET` | `/api/health/detailed` | Full health: KB counts, agents, uptime |
| `GET` | `/api/forms` | List all form types |
| `GET` | `/api/forms/:formType` | Get form config (fields, docTypes, voiceFields) |

**Case Management**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/cases/create` | Create new case |
| `GET` | `/api/cases` | List all cases (sorted by updatedAt) |
| `GET` | `/api/cases/:id` | Get case details (meta, facts, outputs, docSummary) |
| `PATCH` | `/api/cases/:id` | Update case metadata |
| `DELETE` | `/api/cases/:id` | Delete case |
| `PATCH` | `/api/cases/:id/status` | Set status: active / submitted / archived |
| `PATCH` | `/api/cases/:id/pipeline` | Set pipeline stage |
| `PUT` | `/api/cases/:id/facts` | Save/merge facts |
| `GET` | `/api/cases/:id/history` | Get section version history |

**Document & Facts**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/cases/:id/upload` | Upload PDF (3-stage OCR) |
| `POST` | `/api/cases/:id/extract-facts` | Extract structured facts from docs |
| `POST` | `/api/cases/:id/questionnaire` | Generate targeted questions for missing facts |
| `POST` | `/api/cases/:id/grade` | Grade narrative completeness (USPAP rubric) |

**Generation**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/generate` | Generate single field (modular pipeline) |
| `POST` | `/api/generate-batch` | Generate multiple fields (concurrent, twoPass option) |
| `POST` | `/api/cases/:id/generate-all` | Generate all form fields for a case |
| `POST` | `/api/cases/:id/review-section` | Two-pass review a draft section |

**Approval & Insertion**
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/api/cases/:id/outputs/:fieldId` | Approve/edit a section (saves to KB) |
| `POST` | `/api/cases/:id/feedback` | Save field feedback + rating (saves to KB) |
| `POST` | `/api/cases/:id/insert-all` | Insert all approved sections via agent |
| `POST` | `/api/insert-aci` | Insert single field into ACI |
| `POST` | `/api/insert-rq` | Insert single field into Real Quantum |

**Geospatial**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/cases/:id/geocode` | Geocode subject + comps, save geocode.json |
| `GET` | `/api/cases/:id/location-context` | Get location context block for prompt injection |

**Knowledge Base**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/kb/status` | KB health: counts by type, last updated |
| `POST` | `/api/kb/reindex` | Rebuild index.json from disk |
| `POST` | `/api/kb/migrate-voice` | One-time: migrate voice_training.json → KB |
| `POST` | `/api/similar-examples` | Find similar examples for a field |

**Voice Training**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/voice/import-pdf` | Upload + import single PDF |
| `POST` | `/api/voice/import-folder` | Scan voice_pdfs/<formType>/ for new PDFs |
| `GET` | `/api/voice/examples` | List imported voice examples |
| `GET` | `/api/voice/folder-status` | Check folder for unimported PDFs |
| `DELETE` | `/api/voice/examples/import/:importId` | Delete import batch |
| `DELETE` | `/api/voice/examples/:id` | Delete single example |

**Templates & Agents**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates/neighborhood` | List neighborhood templates |
| `POST` | `/api/templates/neighborhood` | Save neighborhood template |
| `DELETE` | `/api/templates/neighborhood/:id` | Delete template |
| `GET` | `/api/agents/status` | Check ACI + RQ agent reachability |
| `POST` | `/api/agents/aci/start` | Spawn ACI agent process |
| `POST` | `/api/agents/aci/stop` | Kill ACI agent process |
| `POST` | `/api/agents/rq/start` | Spawn RQ agent process |
| `POST` | `/api/agents/rq/stop` | Kill RQ agent process |

### ACI Agent (port 5180)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/insert` | Insert single field (automation_id → control_index → label → clipboard) |
| `POST` | `/insert-batch` | Insert multiple fields with per-field results |
| `POST` | `/test-field` | Dry-run a single field (no text written) |
| `GET` | `/calibrate` | Discover ACI window + scan field maps |
| `POST` | `/reload-maps` | Hot-reload field maps without restart |

### Real Quantum Agent (port 5181)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + Chrome CDP status |
| `POST` | `/insert` | Insert single field (CSS selector → clipboard fallback) |
| `POST` | `/insert-batch` | Insert multiple fields with per-field results |
| `POST` | `/test-field` | Dry-run a single field |
| `POST` | `/reload-maps` | Hot-reload field maps without restart |
| `GET` | `/screenshot` | Screenshot current page (debug) |

---

## Daily Use Workflow

### Starting the system
```
Double-click start-all.bat
→ Opens 3 windows: Appraisal Agent server, ACI agent, RQ agent
→ Open http://localhost:5178 in browser
```

### Processing a report (standard flow)
```
1. Create case → set form type (1004/1025/1073/1004c/commercial)
2. Upload PDFs (appraisal, MLS, contract, etc.)
3. Extract Facts → review extracted facts
4. (Optional) Geocode → POST /api/cases/:id/geocode
   → Injects real distances/directions/neighborhood features into generation
5. Generate All → twoPass: true for high-stakes reports
6. Review sections → approve or edit each one
   → Approved sections auto-save to KB (improves future generation)
7. Insert All → sends all approved sections to ACI or Real Quantum
```

### High-throughput mode (10 reports/day target)
- Use **Generate All** with `twoPass: true` — one click generates + reviews all fields
- Use **Insert All** — one click inserts all approved sections
- Pipeline stages track exactly where each case is: `intake → extracting → generating → review → approved → inserting → complete`

---

## Voice Training

Import completed appraisal PDFs to teach the AI your writing style:

**Option A — Single PDF upload**
1. In Appraisal Agent, go to **Voice Training** tab
2. Select form type and upload a completed report PDF
3. The AI extracts narrative sections and saves them to the KB immediately

**Option B — Folder scan (recommended for bulk import)**
1. Drop PDFs into `voice_pdfs/<formType>/` (e.g., `voice_pdfs/1004/`)
2. Call `POST /api/voice/import-folder` with `{ "formType": "1004" }`
3. Only new (not-yet-imported) PDFs are processed — safe to re-run

**After import:** Each extracted field is saved to both `voice_training.json` (legacy) and the KB (`sourceType: "imported"`, `qualityScore: 70`). Approved edits score 80–90 and outrank imports in retrieval.

**Target:** 10+ reports per form type for best style matching.

---

## Knowledge Base

The KB is the real source of style memory. It auto-grows every time you approve a section.

| Source | Weight | qualityScore | How it gets there |
|--------|--------|-------------|-------------------|
| `approved_edit` | 1.5× | 80–90 | Approve a section in UI or via `/outputs/:fieldId` |
| `curated` | 1.0× | 85 | Hand-place JSON in `knowledge_base/curated_examples/<formType>/` |
| `imported` | 0.7× | 70 | Voice PDF import or `/kb/migrate-voice` |

**Retrieval order (4-pass fallback):**
1. Exact match: formType + fieldId + propertyType + marketType
2. Relax: formType + fieldId only
3. Relax: fieldId only (cross-form)
4. Return empty (prompt builder handles gracefully)

**To add a curated example manually:**
```json
{
  "id": "my-example-001",
  "formType": "1004",
  "fieldId": "neighborhood_description",
  "sourceType": "curated",
  "qualityScore": 85,
  "tags": ["suburban", "stable_market"],
  "text": "The subject neighborhood is located in..."
}
```
Save to `knowledge_base/curated_examples/1004/my-example-001.json`, then call `POST /api/kb/reindex`.

**KB management endpoints:**
- `GET /api/kb/status` — counts by type, last updated
- `POST /api/kb/reindex` — rebuild index from disk
- `POST /api/kb/migrate-voice` — one-time migration of voice_training.json → KB

---

## Geospatial / Location Context

For neighborhood and market fields, Appraisal Agent can inject real location data into the AI prompt:

1. **Geocode the case:** `POST /api/cases/:id/geocode`
   - Geocodes subject address + all comp addresses via Nominatim (free, no API key)
   - Calculates distance (miles) and cardinal direction for each comp
   - Saves to `geocode.json` in the case directory (cached)

2. **Location context is auto-injected** during generation for these fields:
   - `neighborhood_description`, `neighborhood_boundaries`, `market_conditions`
   - `market_conditions_addendum`, `market_area`, `sca_summary`
   - `sales_comparison`, `sales_comparison_commentary`

3. **What gets injected:** Subject lat/lng/city/county, comp distances/directions, nearby roads, land use, parks, water features, rail lines (from OpenStreetMap Overpass API — free, no key)

---

## Extending the System

### Add a new form type
1. Create `forms/<newForm>.js` following the pattern in `forms/1004.js`
2. Register it in `forms/index.js`
3. Add a field map in `desktop_agent/field_maps/<newForm>.json`
4. Add curated examples in `knowledge_base/curated_examples/<newForm>/`

### Add a new phrase bank entry
Edit `knowledge_base/phrase_bank/phrases.json` — no code changes needed.

### Update Real Quantum selectors
Edit `real_quantum_agent/field_maps/commercial.json` — no code changes needed.
Run `python real_quantum_agent/selector_discovery.py` to rediscover selectors after a Real Quantum UI update.

### Switch AI models
Set `OPENAI_MODEL=gpt-4o` in `.env` for faster/cheaper generation.

---

## Troubleshooting

**Server won't start**
- Check `.env` exists and has `OPENAI_API_KEY` set
- Check port 5178 is free: `netstat -ano | findstr 5178`

**"Insert into ACI" fails**
- Make sure ACI is open with a report loaded
- Start the ACI agent: `python desktop_agent/agent.py`
- See `desktop_agent/README.md` for full troubleshooting

**"Insert into Real Quantum" fails**
- Make sure Chrome is running with `--remote-debugging-port=9222`
- Make sure you're logged into Real Quantum with a report open
- Start the RQ agent: `start-rq-agent.bat`
- See `real_quantum_agent/README.md` for full troubleshooting

**AI generates poor quality text**
- Import more voice training PDFs (aim for 10+ per form type)
- Add curated examples to the knowledge base
- Review and approve generated sections to build the approved_edits library
