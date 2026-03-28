"""
scan_tabs.py - Click across the ACISectionTabs bar and record what appears.

For each click position, captures:
- The ACIPaneTitle text (tells us which section we're on)
- Which TX32 controls become visible
- Their positions and any text content

Run: C:\Python313-32\python.exe desktop_agent\scan_tabs.py

NOTE: This will click through ACI's tab bar. 
You have 5 seconds to click on ACI after starting this script.
"""

import sys, os, json, time
from datetime import datetime
import win32gui, win32api, win32con
import ctypes

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)


def find_aci():
    matches = []
    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ''
        if 'ACI Report' in title or 'REPORT32MAIN' in win32gui.GetClassName(hwnd).upper():
            matches.append(hwnd)
    win32gui.EnumWindows(cb, None)
    return matches[0] if matches else None


def find_child_by_class(parent_hwnd, target_class):
    result = [None]
    def cb(hwnd, _):
        if result[0]:
            return
        cls = win32gui.GetClassName(hwnd)
        if cls == target_class:
            result[0] = hwnd
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except:
        pass
    return result[0]


def find_all_children_by_class(parent_hwnd, target_class):
    results = []
    def cb(hwnd, _):
        cls = win32gui.GetClassName(hwnd)
        if cls == target_class:
            results.append(hwnd)
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except:
        pass
    return results


def get_visible_tx32s(aci_hwnd):
    tx32s = []
    all_tx32 = find_all_children_by_class(aci_hwnd, 'TX32')
    for hwnd in all_tx32:
        if not win32gui.IsWindowVisible(hwnd):
            continue
        rect = win32gui.GetWindowRect(hwnd)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        # Use WM_GETTEXT to read TX32 content
        buf_size = 4096
        buf = ctypes.create_unicode_buffer(buf_size)
        length = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, buf_size, buf)  # WM_GETTEXT
        text = buf.value[:length] if length > 0 else ''
        if not text:
            text = win32gui.GetWindowText(hwnd) or ''
        tx32s.append({
            'hwnd': hwnd,
            'rect': list(rect),
            'width': w,
            'height': h,
            'text': text[:500],
            'is_content': h > 70,
        })
    return tx32s


def get_pane_title(aci_hwnd):
    hwnd = find_child_by_class(aci_hwnd, 'ACIPaneTitle')
    if hwnd:
        return win32gui.GetWindowText(hwnd) or ''
    return ''


def click_at(x, y):
    ctypes.windll.user32.SetCursorPos(x, y)
    time.sleep(0.05)
    ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.05)
    ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)


def main():
    print()
    print("=" * 70)
    print("  ACI Tab Scanner")
    print("=" * 70)
    
    aci_hwnd = find_aci()
    if not aci_hwnd:
        print("  No ACI window found!")
        sys.exit(1)
    
    title = win32gui.GetWindowText(aci_hwnd)
    print(f"  Window: {title}")
    
    # Bring ACI to foreground using multiple methods
    try:
        # If minimized, restore first
        placement = win32gui.GetWindowPlacement(aci_hwnd)
        if placement[1] == win32con.SW_SHOWMINIMIZED:
            win32gui.ShowWindow(aci_hwnd, win32con.SW_RESTORE)
            time.sleep(0.3)
        
        # Use AllowSetForegroundWindow + SetForegroundWindow
        ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
        win32gui.SetForegroundWindow(aci_hwnd)
        time.sleep(0.5)
        
        fg = win32gui.GetForegroundWindow()
        if fg == aci_hwnd:
            print("  ACI is now in foreground.")
        else:
            print("  WARNING: ACI may not be in foreground.")
            print("  >>> CLICK ON ACI NOW! You have 5 seconds... <<<")
            for i in range(5, 0, -1):
                print(f"    {i}...")
                time.sleep(1)
    except Exception as e:
        print(f"  Could not foreground ACI: {e}")
        print("  >>> CLICK ON ACI NOW! You have 5 seconds... <<<")
        for i in range(5, 0, -1):
            print(f"    {i}...")
            time.sleep(1)
    
    # Re-find after potential window changes
    tabs_hwnd = find_child_by_class(aci_hwnd, 'ACISectionTabs')
    if not tabs_hwnd:
        print("  No ACISectionTabs found!")
        sys.exit(1)
    
    tabs_rect = win32gui.GetWindowRect(tabs_hwnd)
    tabs_w = tabs_rect[2] - tabs_rect[0]
    tabs_h = tabs_rect[3] - tabs_rect[1]
    tabs_y = tabs_rect[1] + tabs_h // 2
    
    print(f"\n  Tab bar: {tabs_w}x{tabs_h} at ({tabs_rect[0]},{tabs_rect[1]})")
    print(f"  Click y={tabs_y}")
    
    # Scan across the tab bar
    num_clicks = 30  # more granular to catch narrow tabs
    sections = []
    seen_titles = set()
    last_title = None
    
    print(f"\n  Scanning {num_clicks} positions...\n")
    
    for i in range(num_clicks):
        x = tabs_rect[0] + int(tabs_w * (i + 0.5) / num_clicks)
        
        click_at(x, tabs_y)
        time.sleep(0.5)
        
        pane_title = get_pane_title(aci_hwnd)
        
        if pane_title == last_title:
            continue
        last_title = pane_title
        
        if pane_title in seen_titles:
            continue
        seen_titles.add(pane_title)
        
        visible_tx32 = get_visible_tx32s(aci_hwnd)
        content_tx32 = [t for t in visible_tx32 if t['is_content']]
        title_tx32 = [t for t in visible_tx32 if not t['is_content']]
        
        section = {
            'pane_title': pane_title,
            'click_x': x,
            'click_y': tabs_y,
            'tab_x_ratio': round((x - tabs_rect[0]) / tabs_w, 4),
            'visible_tx32_count': len(visible_tx32),
            'content_areas': len(content_tx32),
            'title_strips': len(title_tx32),
            'tx32_details': [],
        }
        
        print(f"  [{len(sections):2d}] Section: {pane_title}")
        print(f"       x={x} ratio={section['tab_x_ratio']:.3f}")
        print(f"       TX32: {len(content_tx32)} content, {len(title_tx32)} titles")
        
        for t in visible_tx32:
            detail = {k: v for k, v in t.items() if k != 'hwnd'}
            section['tx32_details'].append(detail)
            kind = 'CONTENT' if t['is_content'] else 'TITLE'
            preview = (t['text'][:80] or '(empty)').replace('\n', ' ').replace('\r', '')
            print(f"       {kind} {t['width']}x{t['height']}: {preview}")
        
        sections.append(section)
        print()
    
    print("-" * 70)
    print(f"\n  Total sections: {len(sections)}\n")
    for i, s in enumerate(sections):
        print(f"    [{i:2d}] {s['pane_title']:35s} content={s['content_areas']} titles={s['title_strips']} ratio={s['tab_x_ratio']:.3f}")
    
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    outfile = os.path.join(OUTPUT_DIR, f'aci_tab_scan_{ts}.json')
    result = {
        'timestamp': datetime.now().isoformat(),
        'window': title,
        'tabs_rect': list(tabs_rect),
        'tabs_width': tabs_w,
        'sections': sections,
    }
    with open(outfile, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    print(f"\n  Saved to: {outfile}")
    print("=" * 70)


if __name__ == '__main__':
    main()
