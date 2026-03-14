"""
scripts/watchAciState.py
------------------------
Record live ACI window state over time for desktop-agent debugging.

Usage:
    python scripts/watchAciState.py --out temp/aci-watch.json --duration 35
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "desktop_agent"))

import agent_core as core  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="Output JSON path")
    parser.add_argument("--duration", type=float, default=35.0, help="Duration in seconds")
    parser.add_argument("--interval", type=float, default=0.3, help="Polling interval in seconds")
    return parser.parse_args()


def collect_record() -> dict:
    app32 = core.connect_win32()
    if not app32:
        return {"ts": time.time(), "error": "no_win32"}

    win = app32.top_window()
    fg = core.get_foreground_window_info()

    pane_titles = []
    for ctrl in win.descendants(class_name="ACIPaneTitle"):
        try:
            txt = (ctrl.window_text() or "").strip()
            rect = ctrl.rectangle()
            if txt and rect.right > rect.left:
                pane_titles.append({
                    "text": txt,
                    "top": rect.top,
                    "left": rect.left,
                })
        except Exception:
            continue
    pane_titles = sorted(pane_titles, key=lambda e: (e["top"], e["left"]))[:12]

    top_texts = []
    for ctrl in win.descendants():
        try:
            rect = ctrl.rectangle()
            txt = (ctrl.window_text() or "").strip()
            cls = (ctrl.class_name() or "").strip()
            if txt and rect.top < 420 and len(txt) <= 140:
                top_texts.append({
                    "class": cls,
                    "text": txt,
                    "top": rect.top,
                    "left": rect.left,
                })
        except Exception:
            continue
    top_texts = sorted(top_texts, key=lambda e: (e["top"], e["left"]))[:20]

    tx32 = []
    disc = core.discover_tx32(win)
    for entry in disc.get("content_controls", [])[:8]:
        rect = entry["rect"]
        tx32.append({
            "left": rect.left,
            "top": rect.top,
            "width": entry["width"],
            "height": entry["height"],
            "text": entry.get("text", "")[:100],
            "parent_cls": entry.get("parent_cls", ""),
        })

    return {
        "ts": time.time(),
        "foreground": fg,
        "foreground_is_aci": core.is_foreground_window(win),
        "pane_titles": pane_titles,
        "top_texts": top_texts,
        "tx32": tx32,
    }


def main() -> int:
    args = parse_args()
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    records = []
    end = time.time() + max(args.duration, 1.0)
    while time.time() < end:
        try:
            records.append(collect_record())
        except Exception as exc:
            records.append({"ts": time.time(), "error": str(exc)})
        time.sleep(max(args.interval, 0.05))

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(records, handle, indent=2)

    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
