"""
discover_aci.py — Simple ACI control discovery for field map building.

USAGE:
    1. Open ACI with a 1004 report
    2. Navigate to the tab/section you want to map
    3. Run: C:\Python313-32\python.exe desktop_agent\discover_aci.py
    4. Repeat for each tab

Outputs all visible controls with their class, text, rect, and automation info.
Saves JSON results to temp/aci_discovery_<timestamp>.json
"""

import sys, os, json, time
from datetime import datetime

try:
    from pywinauto import Application, Desktop
    from pywinauto.controls.common_controls import TabControlWrapper
    import win32gui
    import win32con
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install pywinauto pywin32")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)


def find_aci_window():
    """Find ACI window handle."""
    matches = []
    def enum_cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ''
        cls = win32gui.GetClassName(hwnd) or ''
        if 'ACI Report' in title or 'REPORT32MAIN' in cls.upper() or '\\ACI32\\' in title.upper():
            matches.append((hwnd, title, cls))
    win32gui.EnumWindows(enum_cb, None)
    return matches


def dump_all_controls(app, win):
    """Dump every descendant control with useful info."""
    controls = []
    try:
        for ctrl in win.descendants():
            try:
                rect = ctrl.rectangle()
                info = {
                    'class_name': ctrl.class_name() if hasattr(ctrl, 'class_name') else '',
                    'control_type': ctrl.element_info.control_type if hasattr(ctrl.element_info, 'control_type') else '',
                    'text': (ctrl.window_text() or '')[:200],
                    'automation_id': ctrl.element_info.automation_id if hasattr(ctrl.element_info, 'automation_id') else '',
                    'left': rect.left,
                    'top': rect.top,
                    'right': rect.right,
                    'bottom': rect.bottom,
                    'width': rect.width(),
                    'height': rect.height(),
                    'visible': ctrl.is_visible() if hasattr(ctrl, 'is_visible') else None,
                    'enabled': ctrl.is_enabled() if hasattr(ctrl, 'is_enabled') else None,
                }
                controls.append(info)
            except Exception as e:
                controls.append({'error': str(e)})
    except Exception as e:
        print(f"  Error enumerating descendants: {e}")
    return controls


def dump_tx32_controls(win):
    """Find all TX32 class controls specifically."""
    tx32s = []
    try:
        for ctrl in win.descendants():
            try:
                cls = ctrl.class_name() or ''
                if 'TX32' in cls.upper():
                    rect = ctrl.rectangle()
                    text = ''
                    try:
                        text = (ctrl.window_text() or '')[:500]
                    except:
                        pass
                    tx32s.append({
                        'class_name': cls,
                        'text': text,
                        'left': rect.left,
                        'top': rect.top,
                        'right': rect.right,
                        'bottom': rect.bottom,
                        'width': rect.width(),
                        'height': rect.height(),
                    })
            except:
                continue
    except Exception as e:
        print(f"  Error finding TX32 controls: {e}")
    return tx32s


def dump_win32_children(hwnd, depth=0, max_depth=5):
    """Enumerate child windows using raw Win32 API."""
    children = []
    if depth > max_depth:
        return children
    
    def enum_child(child_hwnd, _):
        try:
            cls = win32gui.GetClassName(child_hwnd) or ''
            text = win32gui.GetWindowText(child_hwnd) or ''
            rect = win32gui.GetWindowRect(child_hwnd)
            children.append({
                'hwnd': child_hwnd,
                'class_name': cls,
                'text': text[:200],
                'left': rect[0],
                'top': rect[1],
                'right': rect[2],
                'bottom': rect[3],
                'width': rect[2] - rect[0],
                'height': rect[3] - rect[1],
                'depth': depth,
                'children': dump_win32_children(child_hwnd, depth + 1, max_depth),
            })
        except:
            pass
    
    try:
        win32gui.EnumChildWindows(hwnd, enum_child, None)
    except:
        pass
    return children


def main():
    print("\n" + "=" * 70)
    print("  ACI Control Discovery Tool")
    print("=" * 70)
    
    # Find ACI
    matches = find_aci_window()
    if not matches:
        print("\n  ERROR: No ACI window found. Is ACI open with a report?")
        sys.exit(1)
    
    hwnd, title, cls = matches[0]
    print(f"\n  Window: {title}")
    print(f"  Class:  {cls}")
    print(f"  Handle: {hwnd}")
    
    # Connect with both backends
    print("\n  Connecting with win32 backend...")
    try:
        app32 = Application(backend='win32').connect(handle=hwnd)
        win32 = app32.window(handle=hwnd)
        print("  win32: OK")
    except Exception as e:
        print(f"  win32: FAILED - {e}")
        win32 = None
    
    print("  Connecting with uia backend...")
    try:
        app_uia = Application(backend='uia').connect(handle=hwnd)
        win_uia = app_uia.window(handle=hwnd)
        print("  uia: OK")
    except Exception as e:
        print(f"  uia: FAILED - {e}")
        win_uia = None
    
    results = {
        'timestamp': datetime.now().isoformat(),
        'window_title': title,
        'window_class': cls,
        'hwnd': hwnd,
    }
    
    # 1. Raw Win32 child tree
    print("\n  Dumping Win32 child window tree...")
    raw_children = dump_win32_children(hwnd)
    results['win32_children_count'] = len(raw_children)
    
    # Flatten for readability
    def flatten(nodes, out=None):
        if out is None:
            out = []
        for n in nodes:
            kids = n.pop('children', [])
            out.append(n)
            flatten(kids, out)
        return out
    
    flat_children = flatten([dict(c) for c in raw_children])
    results['win32_children_flat'] = flat_children
    
    # Summarize classes
    class_counts = {}
    for c in flat_children:
        cn = c.get('class_name', '?')
        class_counts[cn] = class_counts.get(cn, 0) + 1
    
    print(f"  Total child windows: {len(flat_children)}")
    print("\n  Window classes found:")
    for cn, count in sorted(class_counts.items(), key=lambda x: -x[1]):
        marker = " <<<" if 'TX32' in cn.upper() or 'EDIT' in cn.upper() or 'TAB' in cn.upper() or 'SECTION' in cn.upper() else ""
        print(f"    {cn}: {count}{marker}")
    results['class_counts'] = class_counts
    
    # 2. TX32 controls specifically
    if win32:
        print("\n  Finding TX32 controls (win32 backend)...")
        tx32_w32 = dump_tx32_controls(win32)
        results['tx32_win32'] = tx32_w32
        print(f"  TX32 controls (win32): {len(tx32_w32)}")
        for i, t in enumerate(tx32_w32):
            preview = t['text'][:80].replace('\n', ' ') if t['text'] else '(empty)'
            print(f"    [{i}] {t['width']}x{t['height']} at ({t['left']},{t['top']}) text: {preview}")
    
    if win_uia:
        print("\n  Finding TX32 controls (uia backend)...")
        tx32_uia = dump_tx32_controls(win_uia)
        results['tx32_uia'] = tx32_uia
        print(f"  TX32 controls (uia): {len(tx32_uia)}")
        for i, t in enumerate(tx32_uia):
            preview = t['text'][:80].replace('\n', ' ') if t['text'] else '(empty)'
            print(f"    [{i}] {t['width']}x{t['height']} at ({t['left']},{t['top']}) text: {preview}")
    
    # 3. All UIA controls (for tab discovery)
    if win_uia:
        print("\n  Dumping all UIA controls...")
        all_controls = dump_all_controls(app_uia, win_uia)
        results['uia_controls_count'] = len(all_controls)
        
        # Filter interesting ones
        interesting = [c for c in all_controls if not c.get('error') and (
            c.get('width', 0) > 50 and c.get('height', 0) > 20
        )]
        results['uia_controls_interesting'] = interesting
        print(f"  Total UIA controls: {len(all_controls)}")
        print(f"  Interesting (>50x20): {len(interesting)}")
        
        # Show controls with text
        with_text = [c for c in interesting if c.get('text')]
        print(f"\n  Controls with text ({len(with_text)}):")
        for c in with_text[:50]:
            print(f"    [{c.get('class_name','?')}] {c.get('width')}x{c.get('height')} "
                  f"at ({c.get('left')},{c.get('top')}) "
                  f"auto_id='{c.get('automation_id','')}' "
                  f"text: {c['text'][:80]}")
    
    # Save
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    outfile = os.path.join(OUTPUT_DIR, f'aci_discovery_{ts}.json')
    with open(outfile, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Results saved to: {outfile}")
    print("=" * 70)


if __name__ == '__main__':
    main()
