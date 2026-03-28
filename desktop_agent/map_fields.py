"""
map_fields.py - Interactive field mapper for ACI 1004.

How it works:
1. Click on a field in ACI (turns yellow)
2. Switch to this terminal
3. Type the field name (e.g. "neighborhood_description")
4. Repeat for each field
5. Type "done" when finished

It detects the active ACITextToAddendumEditField / ACITextEditField position
and records it relative to the ACIFormView (as a ratio, so it works at any size).

Run: C:\Python313-32\python.exe desktop_agent\map_fields.py
"""

import sys, os, json, time
from datetime import datetime
import win32gui
import ctypes

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)

EDIT_CLASSES = {'ACITextToAddendumEditField', 'ACITextEditField', 'ACIBaseField'}


def find_aci():
    matches = []
    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ''
        if 'ACI Report' in title:
            matches.append(hwnd)
    win32gui.EnumWindows(cb, None)
    return matches[0] if matches else None


def get_formview_rect(aci_hwnd):
    """Get the ACIFormView rect."""
    result = [None]
    def cb(hwnd, _):
        if result[0]:
            return
        if win32gui.GetClassName(hwnd) == 'ACIFormView' and win32gui.IsWindowVisible(hwnd):
            result[0] = win32gui.GetWindowRect(hwnd)
    win32gui.EnumChildWindows(aci_hwnd, cb, None)
    return result[0]


def get_active_edit_field(aci_hwnd):
    """Find the currently visible edit field (yellow box)."""
    fields = []
    def cb(hwnd, _):
        cls = win32gui.GetClassName(hwnd)
        if cls in EDIT_CLASSES and win32gui.IsWindowVisible(hwnd):
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            if w > 5 and h > 5:  # skip tiny controls
                buf = ctypes.create_unicode_buffer(4096)
                length = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, 4096, buf)
                text = buf.value[:length] if length > 0 else ''
                fields.append({
                    'hwnd': hwnd,
                    'class': cls,
                    'rect': list(rect),
                    'w': w, 'h': h,
                    'text': text[:200],
                })
    win32gui.EnumChildWindows(aci_hwnd, cb, None)
    return fields


def get_tab_info(aci_hwnd):
    """Get current tab bar position."""
    result = [None]
    def cb(hwnd, _):
        if result[0]:
            return
        if win32gui.GetClassName(hwnd) == 'ACISectionTabs' and win32gui.IsWindowVisible(hwnd):
            result[0] = win32gui.GetWindowRect(hwnd)
    win32gui.EnumChildWindows(aci_hwnd, cb, None)
    return result[0]


def main():
    print()
    print("=" * 60)
    print("  ACI 1004 Field Mapper")
    print("=" * 60)
    print()
    print("  Instructions:")
    print("  1. Click a field in ACI (turns yellow)")
    print("  2. Come back here and type the field name")
    print("  3. Repeat for all narrative fields")
    print("  4. Type 'done' when finished")
    print("  5. Type 'skip' to skip/re-detect without saving")
    print("  6. Type 'screenshot' to save a screenshot")
    print("  7. Type 'list' to see mapped fields so far")
    print()
    print("  Suggested field names:")
    print("    neighborhood_description")
    print("    market_conditions")
    print("    site_comments")
    print("    improvements_condition")
    print("    functional_utility")
    print("    adverse_conditions")
    print("    sales_comparison_commentary")
    print("    reconciliation")
    print()

    aci_hwnd = find_aci()
    if not aci_hwnd:
        print("  No ACI window found!")
        sys.exit(1)
    print(f"  ACI: {win32gui.GetWindowText(aci_hwnd)}")

    form_rect = get_formview_rect(aci_hwnd)
    if not form_rect:
        print("  No ACIFormView found!")
        sys.exit(1)
    
    fv_left, fv_top, fv_right, fv_bottom = form_rect
    fv_w = fv_right - fv_left
    fv_h = fv_bottom - fv_top
    print(f"  FormView: {fv_w}x{fv_h} at ({fv_left},{fv_top})")
    print()

    mapped = []

    while True:
        name = input("  Field name (or done/skip/screenshot/list): ").strip()
        
        if name.lower() == 'done':
            break
        
        if name.lower() == 'list':
            print(f"\n  Mapped {len(mapped)} fields:")
            for m in mapped:
                print(f"    {m['field_name']:35s} tab={m.get('tab','?'):10s} "
                      f"ratio=({m['x_ratio']:.4f}, {m['y_ratio']:.4f}) "
                      f"class={m['edit_class']}")
            print()
            continue
        
        if name.lower() == 'screenshot':
            try:
                from PIL import ImageGrab
                rect = win32gui.GetWindowRect(aci_hwnd)
                img = ImageGrab.grab(bbox=rect)
                ts = datetime.now().strftime('%H%M%S')
                path = os.path.join(OUTPUT_DIR, f'aci_map_{ts}.png')
                img.save(path)
                print(f"  Saved: {path}")
            except Exception as e:
                print(f"  Screenshot error: {e}")
            continue

        # Re-get form rect in case window was resized
        form_rect = get_formview_rect(aci_hwnd)
        if form_rect:
            fv_left, fv_top, fv_right, fv_bottom = form_rect
            fv_w = fv_right - fv_left
            fv_h = fv_bottom - fv_top

        # Detect active field
        fields = get_active_edit_field(aci_hwnd)
        
        if not fields:
            print("  >> No active edit field detected! Click a field in ACI first.")
            continue
        
        # Use the largest one (most likely the narrative field)
        field = max(fields, key=lambda f: f['w'] * f['h'])
        
        # Calculate position relative to FormView
        field_cx = (field['rect'][0] + field['rect'][2]) / 2  # center X
        field_cy = (field['rect'][1] + field['rect'][3]) / 2  # center Y
        
        x_ratio = (field_cx - fv_left) / fv_w
        y_ratio = (field_cy - fv_top) / fv_h
        
        # Ask for tab name
        tab = input(f"  Tab name for '{name}' (e.g. Neig, Site, Impro, Sales, Reco): ").strip()
        
        entry = {
            'field_name': name,
            'tab': tab,
            'edit_class': field['class'],
            'screen_rect': field['rect'],
            'field_size': [field['w'], field['h']],
            'x_ratio': round(x_ratio, 4),
            'y_ratio': round(y_ratio, 4),
            'formview_rect': list(form_rect),
            'current_text': field['text'][:100],
        }
        
        mapped.append(entry)
        
        if name.lower() != 'skip':
            print(f"  >> Mapped: {name}")
            print(f"     Position: ({field['rect'][0]},{field['rect'][1]}) {field['w']}x{field['h']}")
            print(f"     Ratio:   ({x_ratio:.4f}, {y_ratio:.4f})")
            print(f"     Class:   {field['class']}")
            print(f"     Text:    {field['text'][:60] or '(empty)'}")
        print()

    # Save results
    if mapped:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        outfile = os.path.join(OUTPUT_DIR, f'aci_field_map_{ts}.json')
        result = {
            'timestamp': datetime.now().isoformat(),
            'window': win32gui.GetWindowText(aci_hwnd),
            'formview': {'left': fv_left, 'top': fv_top, 'width': fv_w, 'height': fv_h},
            'fields': mapped,
        }
        with open(outfile, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)
        print(f"\n  Saved {len(mapped)} fields to: {outfile}")
        
        # Also print summary
        print(f"\n  {'Field':35s} {'Tab':10s} {'X Ratio':>8s} {'Y Ratio':>8s}")
        print("  " + "-" * 65)
        for m in mapped:
            print(f"  {m['field_name']:35s} {m.get('tab',''):10s} {m['x_ratio']:8.4f} {m['y_ratio']:8.4f}")
    
    print("\n  Done!")


if __name__ == '__main__':
    main()
