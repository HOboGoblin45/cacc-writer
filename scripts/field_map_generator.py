#!/usr/bin/env python3
"""Appraisal Agent field-map tools.

Modes:
  --aci-diag      Diagnostic-only ACI surface scanner
  --rq-discover   Real Quantum field discovery via Playwright/CDP
  --merge         Safe merge that protects live-confirmed anchors
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
ACI_FIELDMAP_PATH = REPO_ROOT / "desktop_agent" / "field_maps" / "1004.json"
RQ_FIELDMAP_PATH = REPO_ROOT / "real_quantum_agent" / "field_maps" / "commercial.json"
DIAG_OUTPUT_DIR = REPO_ROOT / "scripts" / "diagnostics"
DISCOVERY_OUTPUT_DIR = REPO_ROOT / "scripts" / "discovery"
ACI_POPUP_CLASSES = {"ThunderRT6FormDC", "#32770", "TX32Popup", "ACIWorksheet"}


def _safe_rect(element):
    try:
        rect = element.rectangle()
        return {
            "left": rect.left,
            "top": rect.top,
            "width": rect.width(),
            "height": rect.height(),
        }
    except Exception:
        return None


def _to_snake_case(text):
    text = re.sub(r"[^\w\s]", "", text or "")
    text = re.sub(r"\s+", "_", text.strip())
    text = re.sub(r"([A-Z])", r"_\1", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text.lower()[:60]


def _save_json(path, payload):
    os.makedirs(path.parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False, default=str)


def aci_diagnostic_scan(window_title_regex=r".*Report32Main.*|.*ACI.*Report.*",
                        backend="uia", capture_screenshot=True):
    try:
        from pywinauto import Desktop
    except ImportError:
        print("ERROR: pywinauto not installed. Run: pip install pywinauto")
        sys.exit(1)

    desktop = Desktop(backend=backend)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    diag = {
        "metadata": {
            "type": "aci_diagnostic",
            "timestamp": datetime.now().isoformat(),
            "backend": backend,
            "warning": "Diagnostic only. Do not overwrite desktop_agent/field_maps/1004.json with this.",
        },
        "report32main": None,
        "window_hierarchy": [],
        "tx32_controls": [],
        "section_tabs": [],
        "form_views": [],
        "popups": [],
        "helper_buttons": [],
        "editable_controls": [],
        "surface_anchors": [],
    }

    report_main = None
    for win in desktop.windows():
        try:
            cls = win.element_info.class_name or ""
            title = win.window_text() or ""
            if cls == "Report32Main":
                report_main = win
                break
            if report_main is None and re.search(window_title_regex, title, re.IGNORECASE):
                report_main = win
        except Exception:
            continue

    if report_main is None:
        diag["metadata"]["status"] = "REPORT32MAIN_NOT_FOUND"
        outfile = DIAG_OUTPUT_DIR / f"aci_diag_{timestamp}.json"
        _save_json(outfile, diag)
        print(f"Diagnostic saved: {outfile}")
        return diag

    diag["report32main"] = {
        "title": report_main.window_text(),
        "class_name": report_main.element_info.class_name or "",
        "handle": getattr(report_main, "handle", None),
        "rect": _safe_rect(report_main),
    }

    def walk(element, depth=0, max_depth=15):
        if depth > max_depth:
            return
        try:
            cls = element.element_info.class_name or ""
            ctrl_type = element.element_info.control_type or ""
            title = element.window_text() if hasattr(element, "window_text") else (element.element_info.name or "")
            try:
                visible = element.is_visible()
            except Exception:
                visible = None
            try:
                enabled = element.is_enabled()
            except Exception:
                enabled = None
            entry = {
                "class_name": cls,
                "control_type": ctrl_type,
                "title": title,
                "automation_id": element.element_info.automation_id or "",
                "rect": _safe_rect(element),
                "is_visible": visible,
                "is_enabled": enabled,
                "depth": depth,
            }
            diag["window_hierarchy"].append({
                "depth": depth,
                "class": cls,
                "type": ctrl_type,
                "title": title[:80],
                "visible": visible,
            })
            if cls == "TX32" or "TX32" in cls:
                diag["tx32_controls"].append(entry)
            elif cls in ("ACISectionTabs", "SectionTab"):
                diag["section_tabs"].append(entry)
            elif cls == "ACIFormView" or "FormView" in cls:
                diag["form_views"].append(entry)
            elif cls in ACI_POPUP_CLASSES:
                diag["popups"].append(entry)
            elif ctrl_type == "Button" and visible:
                diag["helper_buttons"].append(entry)
            elif ctrl_type in ("Edit", "ComboBox", "CheckBox", "Document"):
                diag["editable_controls"].append(entry)
            for child in element.children():
                walk(child, depth + 1, max_depth)
        except Exception:
            return

    walk(report_main)

    main_rect = diag["report32main"]["rect"]
    if main_rect:
        for tx in diag["tx32_controls"]:
            rect = tx.get("rect")
            if not rect:
                continue
            diag["surface_anchors"].append({
                "title": tx.get("title", ""),
                "ratio": {
                    "x": round((rect["left"] - main_rect["left"]) / max(main_rect["width"], 1), 4),
                    "y": round((rect["top"] - main_rect["top"]) / max(main_rect["height"], 1), 4),
                    "w": round(rect["width"] / max(main_rect["width"], 1), 4),
                    "h": round(rect["height"] / max(main_rect["height"], 1), 4),
                },
            })

    if capture_screenshot:
        try:
            from PIL import ImageGrab
            screenshot_path = DIAG_OUTPUT_DIR / f"aci_diag_{timestamp}.png"
            if main_rect:
                img = ImageGrab.grab(
                    bbox=(main_rect["left"], main_rect["top"],
                          main_rect["left"] + main_rect["width"],
                          main_rect["top"] + main_rect["height"])
                )
            else:
                img = ImageGrab.grab()
            os.makedirs(DIAG_OUTPUT_DIR, exist_ok=True)
            img.save(str(screenshot_path))
            diag["metadata"]["screenshot"] = str(screenshot_path)
        except Exception as exc:
            diag["metadata"]["screenshot_error"] = str(exc)

    if ACI_FIELDMAP_PATH.exists():
        try:
            with open(ACI_FIELDMAP_PATH, "r", encoding="utf-8") as fh:
                live_map = json.load(fh)
            live_fields = live_map if isinstance(live_map, list) else live_map.get("fields", [])
            diag["live_fieldmap_comparison"] = {
                "live_field_count": len(live_fields),
                "discovered_tx32_count": len(diag["tx32_controls"]),
                "discovered_editable_count": len(diag["editable_controls"]),
            }
        except Exception:
            pass

    diag["metadata"]["status"] = "COMPLETE"
    outfile = DIAG_OUTPUT_DIR / f"aci_diag_{timestamp}.json"
    _save_json(outfile, diag)
    print(f"Diagnostic saved: {outfile}")
    return diag


def rq_discover(url=None, cdp_endpoint=None, output_dir=None):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: Playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    output_dir = Path(output_dir or DISCOVERY_OUTPUT_DIR)
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    with sync_playwright() as p:
        browser = None
        page = None
        if cdp_endpoint:
            browser = p.chromium.connect_over_cdp(cdp_endpoint)
            pages = [page for context in browser.contexts for page in context.pages]
            if url:
                page = next((pg for pg in reversed(pages) if url in pg.url), None)
            if page is None:
                page = next((pg for pg in reversed(pages) if "realquantum" in pg.url.lower()), None)
        if page is None:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={"width": 1920, "height": 1080})
            page = context.new_page()
            if url:
                page.goto(url)

        input("Press Enter when the Real Quantum form page is ready to scan...")
        page_context = {"url": page.url, "title": page.title()}

        controls = page.evaluate("""() => {
            const selectors = [
              'input','textarea','select','[contenteditable="true"]',
              '[role="textbox"]','[role="combobox"]','[role="checkbox"]',
              '[role="radio"]','[role="spinbutton"]','[role="slider"]','[role="listbox"]'
            ];
            const out = [];
            document.querySelectorAll(selectors.join(', ')).forEach((el, index) => {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return;
              const candidates = [];
              if (el.id && !/^(ember|react|svelte|ng-|\\d)/.test(el.id)) {
                candidates.push({ selector: '#' + CSS.escape(el.id), strategy: 'id', stability: 'high' });
              }
              for (const attr of ['data-testid','data-field','data-name','data-id']) {
                const val = el.getAttribute(attr);
                if (val) candidates.push({ selector: `[${attr}="${val}"]`, strategy: attr, stability: 'high' });
              }
              if (el.name) candidates.push({ selector: `[name="${el.name}"]`, strategy: 'name', stability: 'high' });
              if (el.getAttribute('aria-label')) {
                candidates.push({ selector: `[aria-label="${el.getAttribute('aria-label')}"]`, strategy: 'aria-label', stability: 'medium' });
              }
              let label = '';
              if (el.id) {
                const lbl = document.querySelector('label[for="' + el.id + '"]');
                if (lbl) label = lbl.textContent.trim();
              }
              if (!label) label = el.getAttribute('aria-label') || '';
              if (!label) label = el.getAttribute('placeholder') || '';
              if (!label) {
                const prev = el.previousElementSibling;
                if (prev && ['LABEL','SPAN','DIV'].includes(prev.tagName)) {
                  const text = prev.textContent.trim();
                  if (text.length < 80) label = text;
                }
              }
              out.push({
                index,
                tagName: el.tagName.toLowerCase(),
                inputType: el.type || el.getAttribute('role') || 'text',
                id: el.id || null,
                name: el.name || null,
                label,
                placeholder: el.getAttribute('placeholder') || '',
                selectorCandidates: candidates,
                isEnabled: !el.disabled,
                isReadOnly: el.readOnly || false,
                maxLength: el.maxLength > 0 ? el.maxLength : null,
                bounds: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
              });
            });
            return out;
        }""")

        field_map = []
        for ctrl in controls:
            best = next((cand for cand in ctrl["selectorCandidates"] if cand["stability"] == "high"), None)
            if best is None and ctrl["selectorCandidates"]:
                best = ctrl["selectorCandidates"][0]
            field_map.append({
                "fieldId": _generate_web_field_id(ctrl),
                "selector": best["selector"] if best else None,
                "selectorCandidates": ctrl["selectorCandidates"],
                "label": ctrl["label"],
                "tagName": ctrl["tagName"],
                "inputType": ctrl["inputType"],
                "fallback": "clipboard",
                "maxLength": ctrl["maxLength"],
                "isEnabled": ctrl["isEnabled"],
                "isReadOnly": ctrl["isReadOnly"],
                "bounds": ctrl["bounds"],
                "pageContext": page_context,
                "_raw_id": ctrl["id"],
                "_raw_name": ctrl["name"],
                "_needs_review": True,
                "_discovered_at": datetime.now().isoformat(),
            })

        screenshot_path = output_dir / f"rq_discovery_{timestamp}.png"
        page.screenshot(path=str(screenshot_path), full_page=True)

        output = {
            "metadata": {
                "source": "real_quantum_web",
                "page_url": page_context["url"],
                "page_title": page_context["title"],
                "discovered_at": datetime.now().isoformat(),
                "total_controls": len(field_map),
                "editable_controls": len([f for f in field_map if f["isEnabled"] and not f["isReadOnly"]]),
                "screenshot": str(screenshot_path),
            },
            "fields": field_map,
        }
        outfile = output_dir / f"rq_discovery_{timestamp}.json"
        _save_json(outfile, output)

        clean_map = [{
            "fieldId": entry["fieldId"],
            "selector": entry["selector"],
            "selectorCandidates": entry["selectorCandidates"],
            "label": entry["label"],
            "fallback": "clipboard",
            "maxLength": entry["maxLength"],
            "pageContext": entry["pageContext"],
        } for entry in field_map if entry["isEnabled"] and not entry["isReadOnly"]]
        clean_outfile = output_dir / f"rq_fieldmap_{timestamp}.json"
        _save_json(clean_outfile, clean_map)

        print(f"Full discovery: {outfile}")
        print(f"Clean field map: {clean_outfile}")
        return output


def _generate_web_field_id(ctrl):
    for source in [ctrl.get("name"), ctrl.get("id"), ctrl.get("label"), ctrl.get("placeholder", "")]:
        if source and len(source) > 2:
            return _to_snake_case(source)
    return f"{ctrl['tagName']}_{ctrl['index']}"


def safe_merge(discovery_file, existing_file=None, output_file=None):
    existing_file = existing_file or str(RQ_FIELDMAP_PATH)
    output_file = output_file or str(DISCOVERY_OUTPUT_DIR / "merged_fieldmap.json")
    with open(discovery_file, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    discovered = raw.get("fields", raw) if isinstance(raw, dict) else raw

    if os.path.exists(existing_file):
        with open(existing_file, "r", encoding="utf-8") as fh:
            raw_existing = json.load(fh)
        existing = raw_existing.get("fields", raw_existing) if isinstance(raw_existing, dict) else raw_existing
    else:
        existing = []

    existing_idx = {entry.get("fieldId", ""): entry for entry in existing if entry.get("fieldId")}
    anchor_keys = {"selector", "selectorCandidates", "automation_id", "control_index", "report_click_ratio", "insertMethod"}
    merged = []

    for field in discovered:
        fid = field.get("fieldId")
        if not fid:
            continue
        live = existing_idx.pop(fid, None)
        if live is None:
            field["_status"] = "NEW"
            field["_needs_review"] = True
            merged.append(field)
            continue
        if live.get("_live_confirmed"):
            live["_last_scanned"] = datetime.now().isoformat()
            live["_scan_still_visible"] = True
            merged.append(live)
            continue
        changes = []
        for key in anchor_keys:
            if key in field and key in live and field[key] != live[key]:
                changes.append({"key": key, "old": str(live[key])[:100], "new": str(field[key])[:100]})
        if changes:
            live["_changes_detected"] = changes
            if "selectorCandidates" in field:
                live["_new_selectorCandidates"] = field["selectorCandidates"]
        live["_last_scanned"] = datetime.now().isoformat()
        merged.append(live)

    for _, entry in existing_idx.items():
        entry["_status"] = "NOT_IN_SCAN"
        entry["_note"] = "May be hidden TX32, popup-only, or worksheet-context field. Do NOT delete."
        entry["_last_scanned"] = datetime.now().isoformat()
        entry["_scan_still_visible"] = False
        merged.append(entry)

    _save_json(Path(output_file), merged)
    print(f"Merged field map: {output_file}")
    return merged


def main():
    parser = argparse.ArgumentParser(description="Appraisal Agent - Field Map Tools")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--aci-diag", action="store_true", help="ACI diagnostic scan")
    mode.add_argument("--rq-discover", action="store_true", help="Real Quantum form discovery")
    mode.add_argument("--merge", nargs=3, metavar=("DISCOVERY", "EXISTING", "OUTPUT"),
                      help="Safe merge: discovery + existing -> output")
    parser.add_argument("--aci-title", type=str, default=r".*Report32Main.*|.*ACI.*Report.*")
    parser.add_argument("--aci-backend", type=str, default="uia", choices=["uia", "win32"])
    parser.add_argument("--no-screenshot", action="store_true")
    parser.add_argument("--url", type=str)
    parser.add_argument("--cdp-endpoint", type=str)
    parser.add_argument("--output-dir", type=str)
    args = parser.parse_args()

    if args.aci_diag:
        aci_diagnostic_scan(args.aci_title, args.aci_backend, not args.no_screenshot)
    elif args.rq_discover:
        rq_discover(args.url, args.cdp_endpoint, args.output_dir)
    elif args.merge:
        safe_merge(args.merge[0], args.merge[1], args.merge[2])


if __name__ == "__main__":
    main()

