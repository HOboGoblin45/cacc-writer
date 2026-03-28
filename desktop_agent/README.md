# CACC ACI Desktop Automation Agent

Inserts AI-generated appraisal narrative text directly into ACI appraisal software fields using Windows UI Automation.

## How It Works

1. You generate a narrative section in Appraisal Agent (browser)
2. Click **Insert into ACI** on any output card
3. Appraisal Agent calls this agent at `http://localhost:5180/insert`
4. The agent locates the ACI window, finds the correct field, and inserts the text

## Setup

### 1. Install Python dependencies

```bash
cd desktop_agent
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Start the agent

```bash
python agent.py
```

The agent runs on `http://localhost:5180` by default.

### 3. Start ACI

Open ACI appraisal software and load the report you are working on **before** clicking Insert into ACI.

---

## Configuration (`config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `agent_port` | `5180` | Port the agent listens on |
| `aci_window_title` | `"ACI"` | Window title to search for |
| `aci_window_pattern` | `".*ACI.*"` | Regex pattern for window matching |
| `insert_delay_ms` | `200` | Delay between keystrokes (ms) |
| `max_retries` | `3` | Insertion retry attempts |
| `verify_insertion` | `true` | Read field back to confirm insert |

### Finding the correct ACI window title

With ACI open, call:
```
GET http://localhost:5180/list-windows
```
This returns all open window titles. Find the one that matches ACI and update `aci_window_pattern` in `config.json`.

---

## Field Maps (`field_maps/`)

Each form type has a JSON file mapping logical field IDs to the exact UI label text shown in ACI:

```
field_maps/
  1004.json    ← Single Family (URAR)
  1025.json    ← Small Income (2-4 unit)
  1073.json    ← Individual Condo Unit
```

If ACI shows a different label than what's in the field map, edit the `"label"` value in the appropriate JSON file. No code changes needed.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/insert` | Insert text into ACI field |
| `GET` | `/list-windows` | List all open windows (debug) |

### POST /insert

```json
{
  "fieldId": "neighborhood_description",
  "text": "The subject neighborhood is...",
  "formType": "1004"
}
```

Response:
```json
{
  "ok": true,
  "inserted": true,
  "verified": true,
  "method": "direct",
  "fieldId": "neighborhood_description",
  "fieldLabel": "Neighborhood Description"
}
```

---

## Troubleshooting

**"Could not connect to ACI"**
- Make sure ACI is open with a report loaded
- Check that `aci_window_pattern` in `config.json` matches the actual window title
- Run `GET /list-windows` to see all open windows

**"Insertion failed after 3 attempts"**
- The field label in the field map may not match what ACI shows
- Try the clipboard fallback by setting `verify_insertion: false` in config.json
- Check the agent console output for detailed error messages

**"pywinauto not available"**
- Install dependencies: `pip install -r requirements.txt`
- pywinauto requires Windows — it will not work on macOS or Linux

**Agent not starting**
- Check that port 5180 is not in use: `netstat -ano | findstr 5180`
- Make sure you activated the virtual environment before running `python agent.py`
