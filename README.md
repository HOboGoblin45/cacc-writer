<p align="center">
  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect rx='40' width='200' height='200' fill='%23e2b714'/%3E%3Ctext x='100' y='132' text-anchor='middle' font-size='100' font-weight='900' fill='%23111' font-family='system-ui'%3EAA%3C/text%3E%3C/svg%3E" width="80" alt="Appraisal Agent" />
</p>

<h1 align="center">Appraisal Agent</h1>

<p align="center">
  <strong>AI-powered appraisal narrative drafting &amp; insertion system</strong><br/>
  Built for <a href="#">Cresci Appraisal &amp; Consulting Company</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-e2b714?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/tests-621%20passing-3fb950?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/node-18%2B-339933?style=flat-square" alt="Node" />
  <img src="https://img.shields.io/badge/python-3.10%2B-3776AB?style=flat-square" alt="Python" />
  <img src="https://img.shields.io/badge/AI-GPT--4.1-412991?style=flat-square" alt="OpenAI" />
  <img src="https://img.shields.io/badge/license-proprietary-gray?style=flat-square" alt="License" />
</p>

---

## What is this?

Appraisal Agent automates the entire narrative writing process for real estate appraisals. Upload source documents, extract facts, generate USPAP-compliant narratives in your writing style, review & approve, then insert directly into ACI or Real Quantum software — all from one interface.

**Five-step workflow:**

```
Import → Extract Facts → Generate Narratives → Review & Approve → Insert into Software
```

## Key Features

- **🤖 AI Generation** — GPT-4.1 drafts all narrative sections with two-pass review (hallucination cleanup)
- **🎯 Voice Matching** — Knowledge base learns your writing style from approved edits and imported reports
- **📋 5 Form Types** — 1004 URAR, 1025 Small Income, 1073 Condo, 1004C Manufactured, Commercial
- **🖥️ Direct Insertion** — Automated text insertion into ACI (pywinauto) and Real Quantum (Playwright)
- **📄 PDF Extraction** — 3-stage OCR pipeline extracts structured facts from uploaded documents
- **🌍 Geospatial** — Auto-geocodes subject & comps, injects real location context (Nominatim + Overpass)
- **⌨️ Command Palette** — Ctrl+K to search any command, keyboard shortcuts for everything
- **🌓 Dark & Light Themes** — Professional interface with full theme support
- **📡 Real-Time Progress** — SSE-powered live generation monitoring per section
- **🔒 QC Gates** — Pre-insertion quality checks, compliance validation, exception queue

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Browser UI (index.html)                  │
│        5-step wizard • Command palette • SSE          │
│              http://localhost:5178                     │
└─────────────────────┬────────────────────────────────┘
                      │ REST + SSE
┌─────────────────────▼────────────────────────────────┐
│          Appraisal Agent Server (:5178)               │
│                                                       │
│  26 route modules • 216 server files • 71K lines     │
│                                                       │
│  Generation Pipeline:                                 │
│  facts → KB retrieval → prompt build → GPT-4.1 →     │
│  two-pass review → output → approval → KB growth     │
│                                                       │
│  SQLite: cases, runs, QC, audit, exceptions, ops     │
│  Knowledge Base: 411 examples (auto-growing)         │
└──────┬───────────────────────────┬───────────────────┘
       │                           │
┌──────▼──────────┐     ┌─────────▼───────────┐
│  ACI Agent      │     │  Real Quantum Agent  │
│  Python (:5180) │     │  Python (:5181)      │
│  pywinauto      │     │  Playwright/CDP      │
│  click-to-      │     │  CSS selectors       │
│  activate v3    │     │  clipboard fallback  │
└──────┬──────────┘     └─────────┬────────────┘
       │                          │
   ACI Desktop              Chrome/RQ Web
   (residential)            (commercial)
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env
# Edit .env → set OPENAI_API_KEY=sk-...

# 3. Start everything (server + agents)
start-all.bat

# 4. Open browser
# → http://localhost:5178
```

### Individual Components

```bash
# Server only
npm start

# ACI agent (residential insertion)
C:\Python313-32\python.exe desktop_agent\agent_v3.py

# Real Quantum agent (commercial insertion)
python real_quantum_agent\agent.py
```

## Form Types

| Form | Description | Scope | Insert Target |
|------|-------------|-------|---------------|
| **1004** | URAR Single Family | Active | ACI |
| **1025** | Small Residential Income (2-4 unit) | Active | ACI |
| **1073** | Individual Condo Unit | Active | ACI |
| **commercial** | Commercial Narrative | Active | Real Quantum |
| **1004c** | Manufactured Home | Deferred | ACI |

## Generation Pipeline

```
Source Files (XML, PDF)
    │
    ▼
Fact Extraction (OCR + AI)
    │
    ▼
Geocoding (Nominatim + Overpass → location context)
    │
    ▼
KB Retrieval (4-pass: exact → formType+field → field-only → empty)
    │
    ▼
Prompt Assembly (system + style guide + examples + phrases + facts + location)
    │
    ▼
GPT-4.1 Draft → Two-Pass Review (hallucination cleanup)
    │
    ▼
Approval → KB Growth (approved edits weight 1.5×)
    │
    ▼
QC Gate → Insertion into ACI/Real Quantum
```

## Testing

```bash
# Unit tests (308 tests, custom runner)
npm run test:unit

# Integration/smoke tests (147 tests)
npm test

# All test suites
npm run test:all

# Individual suites
node _test_phase2_endpoints.mjs    # 37 tests
node _test_phase3.mjs              # 70 tests
node _test_scope_enforcement.mjs   # 17 tests
node _test_missing_facts.mjs       # 22 tests
node _test_orchestrator_endpoints.mjs  # 30 tests

# Golden path (requires valid API key + running agents)
npm run test:golden:preflight
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+S` | Save facts |
| `Ctrl+Shift+G` | Generate all |
| `Ctrl+Enter` | Insert all |
| `Alt+1` through `Alt+5` | Navigate to step |
| `Escape` | Close palette |

## Knowledge Base

The KB auto-grows as you approve sections. Three tiers:

| Source | Weight | Score | How |
|--------|--------|-------|-----|
| **Approved edits** | 1.5× | 80-90 | Approve a section in the UI |
| **Curated** | 1.0× | 85 | Hand-placed in `knowledge_base/curated_examples/` |
| **Imported** | 0.7× | 70 | Voice PDF import or bulk migration |

**Target:** 10+ reports per form type for best voice matching.

## Voice Training

```bash
# Option A: Single PDF upload via UI
# → Voice Training tab → Select form type → Upload PDF

# Option B: Bulk folder scan
# 1. Drop PDFs into voice_pdfs/<formType>/
# 2. POST /api/voice/import-folder { "formType": "1004" }
```

## API Overview

**26 route modules** covering:

- **Health & Forms** — `/api/health`, `/api/forms`
- **Case Management** — CRUD, pipeline stages, facts, outputs
- **Documents** — Upload, classify, extract facts
- **Generation** — Single field, batch, full draft, regenerate
- **Review & QC** — Section status, approval, QC runs, exceptions
- **Insertion** — Single and batch insertion with verification
- **Knowledge Base** — Status, reindex, migration
- **Voice Training** — PDF import, folder scan, management
- **Geospatial** — Geocoding, location context
- **Operations** — Audit log, case archival, data pipeline
- **Real-Time** — SSE events for generation progress

Full endpoint documentation: see `CHANGELOG.md` and route files in `server/api/`.

## Project Structure

```
appraisal-agent/
├── cacc-writer-server.js      # Main server (Express, port 5178)
├── index.html                 # Frontend UI (5-step wizard)
├── app.js                     # Frontend JavaScript (1300+ lines)
├── styles.css                 # CSS (1400+ lines, dark/light themes)
├── start-all.bat              # One-click startup
│
├── server/                    # Backend (216 files, 71K lines)
│   ├── api/                   # 26 Express route modules
│   ├── db/                    # SQLite schema + migrations
│   ├── insertion/             # Insertion engine, verification, replay
│   ├── intake/                # XML parser, PDF extraction
│   ├── generation/            # Orchestrator, section planning
│   └── utils/                 # Shared utilities
│
├── desktop_agent/             # ACI automation (Python/pywinauto)
│   ├── agent_v3.py            # Flask agent (port 5180)
│   ├── inserter.py            # Click-to-activate insertion engine
│   └── field_maps/            # Form-specific field coordinates
│
├── real_quantum_agent/        # Real Quantum automation (Python/Playwright)
│   ├── agent.py               # Flask agent (port 5181)
│   └── field_maps/            # CSS selector maps
│
├── tests/                     # Test suites
│   ├── unit/                  # 70 unit test files (308 tests)
│   └── helpers/               # Server harness, test utilities
│
├── knowledge_base/            # Voice + style examples (411 entries)
├── forms/                     # Form type registry + configs
└── prompts/                   # AI system prompts + style guide
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server won't start | Check `.env` has `OPENAI_API_KEY`, check port 5178 is free |
| ACI insertion fails | Open ACI with report loaded, start agent: `python desktop_agent/agent_v3.py` |
| RQ insertion fails | Chrome running with `--remote-debugging-port=9222`, logged into RQ |
| Poor generation quality | Import 10+ voice PDFs per form type, approve sections to grow KB |
| Golden path tests fail | Need valid API key + running agents (environment-dependent) |

---

<p align="center">
  <strong>Appraisal Agent v3.1.0</strong> — Cresci Appraisal &amp; Consulting Company<br/>
  <sub>Built with ❤️ by Charles Cresci</sub>
</p>
