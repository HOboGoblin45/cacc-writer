# CACC Real Quantum Agent

Inserts AI-generated commercial appraisal narrative text directly into Real Quantum appraisal software using Playwright browser automation.

## How It Works

1. You generate a commercial narrative section in Appraisal Agent (browser)
2. Click **Insert into Real Quantum** on any output card (commercial form only)
3. Appraisal Agent calls this agent at `http://localhost:5181/insert`
4. The agent attaches to your open Chrome session, navigates to the correct section, and inserts the text

## Why Playwright (not pywinauto)

Real Quantum is a **web-based SaaS application** running inside a browser. pywinauto automates Win32 desktop controls and cannot reliably target elements inside a browser's rendered DOM. Playwright communicates directly with Chrome via the Chrome DevTools Protocol (CDP), giving precise control over every element on the page.

---

## Setup

### Step 1 — Install Python dependencies

```bash
cd real_quantum_agent
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### Step 2 — Launch Chrome with remote debugging (one-time setup)

Create a shortcut or run this command once:

```bat
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\rq-session
```

> **Why `--user-data-dir`?** This creates a dedicated Chrome profile for Real Quantum. Your login session is saved here so you only need to log in once.

You can create a `start-chrome-rq.bat` file with this command for convenience.

### Step 3 — Log into Real Quantum

In the Chrome window you just opened, navigate to Real Quantum and log in. Open the commercial report you are working on.

### Step 4 — Discover field selectors (one-time per report type)

With your report open, run the selector discovery script:

```bash
python real_quantum_agent/selector_discovery.py
```

This scans the page and saves:
- `real_quantum_agent/discovered_elements.json` — full element dump
- `real_quantum_agent/selector_report.txt` — human-readable report

Use the report to find the correct CSS selectors for each section and update `field_maps/commercial.json`.

### Step 5 — Update field maps

Edit `real_quantum_agent/field_maps/commercial.json` with the selectors you discovered:

```json
{
  "site_description": {
    "label": "Site Description",
    "nav_selector": "a[href*='site']",
    "input_selector": "textarea#site_description_text",
    "input_type": "textarea",
    "clear_method": "select_all"
  }
}
```

### Step 6 — Start the agent

```bash
python real_quantum_agent/agent.py
```

The agent runs on `http://localhost:5181` by default.

---

## Configuration (`config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `agent_port` | `5181` | Port the agent listens on |
| `cdp_url` | `http://localhost:9222` | Chrome DevTools Protocol URL |
| `rq_base_url` | `https://app.realquantum.com` | Used to identify the correct browser tab |
| `insert_delay_ms` | `300` | Delay after insertion (ms) |
| `max_retries` | `3` | Insertion retry attempts |
| `verify_insertion` | `true` | Read field back to confirm insert |
| `navigation_timeout_ms` | `10000` | Timeout waiting for nav elements (ms) |

---

## Field Maps (`field_maps/commercial.json`)

Each field entry supports these keys:

| Key | Required | Description |
|-----|----------|-------------|
| `label` | Yes | Human-readable field name |
| `nav_selector` | No | CSS selector for the sidebar/tab nav link |
| `nav_text` | No | Visible text of the nav link (fallback) |
| `input_selector` | Yes | CSS selector for the textarea/input |
| `input_type` | Yes | `textarea`, `input`, `tinymce`, `contenteditable` |
| `tinymce_id` | No | TinyMCE editor ID (if `input_type` is `tinymce`) |
| `editor_index` | No | TinyMCE editor index (default: 0) |
| `clear_method` | No | `select_all` (default) or `triple_click` |

### TinyMCE fields

If Real Quantum uses TinyMCE rich text editors, set `input_type: "tinymce"` and provide either `tinymce_id` or `editor_index`:

```json
{
  "site_description": {
    "input_type": "tinymce",
    "tinymce_id": "site_description_editor",
    "label": "Site Description"
  }
}
```

To find TinyMCE editor IDs, open Chrome DevTools Console and run:
```javascript
tinymce.editors.map(e => ({ id: e.id, index: tinymce.editors.indexOf(e) }))
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + connection status |
| `POST` | `/insert` | Insert text into Real Quantum field |
| `GET` | `/list-sections` | Dump all interactive elements (debug) |
| `GET` | `/screenshot` | Take screenshot of current page (debug) |

### POST /insert

```json
{
  "fieldId": "site_description",
  "text": "The subject site is located at the intersection of...",
  "formType": "commercial"
}
```

Response:
```json
{
  "ok": true,
  "inserted": true,
  "verified": true,
  "method": "textarea",
  "fieldId": "site_description",
  "fieldLabel": "Site Description"
}
```

---

## Troubleshooting

**"Could not connect to Chrome"**
- Make sure Chrome is running with `--remote-debugging-port=9222`
- Check that no other process is using port 9222: `netstat -ano | findstr 9222`
- Try navigating to `http://localhost:9222` in another browser — you should see a JSON page

**"Real Quantum tab not found by URL"**
- The agent will fall back to the first open tab
- Make sure your Real Quantum report is the active tab in Chrome

**"No input_selector defined"**
- Run `python real_quantum_agent/selector_discovery.py` to discover selectors
- Update `field_maps/commercial.json` with the correct `input_selector`

**"Insertion failed after 3 attempts"**
- The CSS selector may be wrong or the section may not be loaded
- Try navigating to the section manually in Real Quantum first
- Run `GET http://localhost:5181/screenshot` to see what the agent sees
- Run `GET http://localhost:5181/list-sections` to re-scan the current page

**TinyMCE editor not found**
- Open Chrome DevTools Console and run: `tinymce.editors`
- If it returns editors, set `input_type: "tinymce"` in the field map
- If it returns undefined, Real Quantum uses standard textareas

**Agent not starting**
- Check that port 5181 is not in use: `netstat -ano | findstr 5181`
- Make sure you activated the virtual environment: `venv\Scripts\activate`

---

## Comparison: ACI Agent vs Real Quantum Agent

| | ACI Agent (`desktop_agent/`) | Real Quantum Agent (`real_quantum_agent/`) |
|---|---|---|
| Software type | Win32 desktop app | Web SaaS (browser) |
| Automation library | pywinauto | Playwright |
| Field targeting | UI control labels | CSS selectors |
| Session management | Connects to open window | Attaches to Chrome via CDP |
| Port | 5180 | 5181 |
| Form types | 1004, 1025, 1073, 1004c | commercial |
