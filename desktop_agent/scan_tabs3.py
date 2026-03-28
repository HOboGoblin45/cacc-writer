"""
scan_tabs3.py - Map ACI tabs using pywinauto click_input on the tab bar.

Uses pywinauto's click_input which does real mouse movement + click.
This works even without foreground focus.

Run: C:\Python313-32\python.exe desktop_agent\scan_tabs3.py
"""

import sys, os, json, time
from datetime import datetime
import win32gui
import ctypes
from pywinauto import Application

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)


def find_aci_hwnd():
    matches = []
    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ''
        cls = win32gui.GetClassName(hwnd) or ''
        if 'ACI Report' in title or 'REPORT32MAIN' in cls.upper():
            matches.append(hwnd)
    win32gui.EnumWindows(cb, None)
    return matches[0] if matches else None


def get_tx32_info(aci_hwnd):
    """Get visible TX32 controls using raw Win32 enumeration."""
    tx32s = []
    all_handles = []
    def cb(hwnd, _):
        if win32gui.GetClassName(hwnd) == 'TX32':
            all_handles.append(hwnd)
    try:
        win32gui.EnumChildWindows(aci_hwnd, cb, None)
    except:
        pass
    
    for hwnd in all_handles:
        if not win32gui.IsWindowVisible(hwnd):
            continue
        rect = win32gui.GetWindowRect(hwnd)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        buf = ctypes.create_unicode_buffer(8192)
        length = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, 8192, buf)
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


def get_pane_title_text(aci_hwnd):
    result = [None]
    def cb(hwnd, _):
        if result[0] is not None:
            return
        if win32gui.GetClassName(hwnd) == 'ACIPaneTitle':
            result[0] = win32gui.GetWindowText(hwnd) or ''
    try:
        win32gui.EnumChildWindows(aci_hwnd, cb, None)
    except:
        pass
    return result[0] or ''


def main():
    print()
    print("=" * 70)
    print("  ACI Tab Scanner v3 (pywinauto click_input)")
    print("=" * 70)

    hwnd = find_aci_hwnd()
    if not hwnd:
        print("  No ACI window found!")
        sys.exit(1)

    title = win32gui.GetWindowText(hwnd)
    print(f"  Window: {title}")

    # Connect with pywinauto win32 backend
    app = Application(backend='win32').connect(handle=hwnd)
    main_win = app.window(handle=hwnd)
    
    # Find ACISectionTabs
    try:
        tabs = main_win.child_window(class_name='ACISectionTabs')
        tabs_rect = tabs.rectangle()
        tabs_w = tabs_rect.width()
        tabs_h = tabs_rect.height()
        print(f"  Tab bar: {tabs_w}x{tabs_h} at ({tabs_rect.left},{tabs_rect.top})")
    except Exception as e:
        print(f"  Cannot find ACISectionTabs: {e}")
        sys.exit(1)

    # Bring ACI to front
    print("  Bringing ACI to foreground...")
    try:
        main_win.set_focus()
        time.sleep(0.5)
    except:
        print("  WARNING: Could not set focus. Clicking may still work via click_input.")

    # Initial state
    pane_text = get_pane_title_text(hwnd)
    print(f"  Current pane: \"{pane_text}\"")
    
    # Scan by clicking across the tab bar
    num_clicks = 30
    sections = []
    seen_titles = set()
    last_title = None
    
    print(f"\n  Scanning {num_clicks} positions...\n")
    
    for i in range(num_clicks):
        # Click position in tab control's client coordinates
        click_x = int(tabs_w * (i + 0.5) / num_clicks)
        click_y = tabs_h // 2
        
        try:
            # click_input uses real mouse — coords relative to the control
            tabs.click_input(coords=(click_x, click_y))
        except Exception as e:
            print(f"  Click failed at ({click_x},{click_y}): {e}")
            continue
        
        time.sleep(0.5)
        
        pane_text = get_pane_title_text(hwnd)
        
        if pane_text == last_title:
            continue
        last_title = pane_text
        
        if pane_text in seen_titles:
            continue
        seen_titles.add(pane_text)
        
        visible_tx32 = get_tx32_info(hwnd)
        content_tx32 = [t for t in visible_tx32 if t['is_content']]
        title_tx32 = [t for t in visible_tx32 if not t['is_content']]
        
        section = {
            'pane_title': pane_text,
            'click_x_client': click_x,
            'tab_x_ratio': round(click_x / tabs_w, 4),
            'content_areas': len(content_tx32),
            'title_strips': len(title_tx32),
            'tx32_details': [],
        }
        
        print(f"  [{len(sections):2d}] Section: \"{pane_text}\"")
        print(f"       client_x={click_x} ratio={section['tab_x_ratio']:.3f}")
        print(f"       TX32: {len(content_tx32)} content, {len(title_tx32)} titles")
        
        for t in visible_tx32:
            detail = {k: v for k, v in t.items() if k != 'hwnd'}
            section['tx32_details'].append(detail)
            kind = 'CONTENT' if t['is_content'] else 'TITLE'
            preview = (t['text'][:100] or '(empty)').replace('\n', ' ').replace('\r', '')
            print(f"       {kind} {t['width']}x{t['height']}: \"{preview}\"")
        
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
        'tabs_width': tabs_w,
        'tabs_height': tabs_h,
        'sections': sections,
    }
    with open(outfile, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    print(f"\n  Saved to: {outfile}")
    print("=" * 70)


if __name__ == '__main__':
    main()
