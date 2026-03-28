"""
scan_tabs2.py - Map ACI tabs using SendMessage instead of mouse_event.
Sends WM_LBUTTONDOWN/UP directly to the ACISectionTabs control.

Run: C:\Python313-32\python.exe desktop_agent\scan_tabs2.py
"""

import sys, os, json, time
from datetime import datetime
import win32gui, win32api, win32con
import ctypes
from ctypes import wintypes

WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001

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


def find_all_by_class(parent_hwnd, target_class):
    results = []
    def cb(hwnd, _):
        if win32gui.GetClassName(hwnd) == target_class:
            results.append(hwnd)
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except:
        pass
    return results


def find_first_by_class(parent_hwnd, target_class):
    r = find_all_by_class(parent_hwnd, target_class)
    return r[0] if r else None


def get_visible_tx32s(aci_hwnd):
    tx32s = []
    for hwnd in find_all_by_class(aci_hwnd, 'TX32'):
        if not win32gui.IsWindowVisible(hwnd):
            continue
        rect = win32gui.GetWindowRect(hwnd)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        # WM_GETTEXT
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


def get_pane_titles(aci_hwnd):
    """Get ALL ACIPaneTitle texts."""
    titles = []
    for hwnd in find_all_by_class(aci_hwnd, 'ACIPaneTitle'):
        text = win32gui.GetWindowText(hwnd) or ''
        vis = win32gui.IsWindowVisible(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        titles.append({'text': text, 'visible': bool(vis), 'rect': list(rect), 'hwnd': hwnd})
    return titles


def send_click(hwnd, x, y):
    """Send WM_LBUTTONDOWN + WM_LBUTTONUP to a window at client coords (x, y)."""
    lparam = y << 16 | (x & 0xFFFF)
    win32gui.SendMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lparam)
    time.sleep(0.05)
    win32gui.SendMessage(hwnd, WM_LBUTTONUP, 0, lparam)


def main():
    print()
    print("=" * 70)
    print("  ACI Tab Scanner v2 (SendMessage)")
    print("=" * 70)

    aci_hwnd = find_aci()
    if not aci_hwnd:
        print("  No ACI window found!")
        sys.exit(1)

    title = win32gui.GetWindowText(aci_hwnd)
    print(f"  Window: {title}")

    # Find ALL ACISectionTabs (there may be multiple for different form views)
    all_tabs = find_all_by_class(aci_hwnd, 'ACISectionTabs')
    print(f"  ACISectionTabs controls: {len(all_tabs)}")
    
    for idx, tabs_hwnd in enumerate(all_tabs):
        vis = win32gui.IsWindowVisible(tabs_hwnd)
        rect = win32gui.GetWindowRect(tabs_hwnd)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        print(f"    [{idx}] {w}x{h} at ({rect[0]},{rect[1]}) visible={vis}")
    
    # Use the visible one
    visible_tabs = [(h, win32gui.GetWindowRect(h)) for h in all_tabs if win32gui.IsWindowVisible(h)]
    if not visible_tabs:
        print("  No visible ACISectionTabs!")
        sys.exit(1)
    
    tabs_hwnd, tabs_rect = visible_tabs[0]
    tabs_w = tabs_rect[2] - tabs_rect[0]
    tabs_h = tabs_rect[3] - tabs_rect[1]
    
    print(f"\n  Using tab bar: {tabs_w}x{tabs_h}")
    
    # Also find pane titles
    pane_titles = get_pane_titles(aci_hwnd)
    print(f"  ACIPaneTitle controls: {len(pane_titles)}")
    for pt in pane_titles:
        print(f"    \"{pt['text']}\" visible={pt['visible']}")

    # Scan by sending clicks in client coordinates
    num_clicks = 30
    sections = []
    seen_titles = set()
    last_title = None
    click_y = tabs_h // 2  # client coords, vertical center
    
    print(f"\n  Scanning {num_clicks} positions (client coords, y={click_y})...\n")

    for i in range(num_clicks):
        click_x = int(tabs_w * (i + 0.5) / num_clicks)
        
        send_click(tabs_hwnd, click_x, click_y)
        time.sleep(0.5)
        
        # Read pane title
        pane_hwnd = find_first_by_class(aci_hwnd, 'ACIPaneTitle')
        pane_text = win32gui.GetWindowText(pane_hwnd) if pane_hwnd else ''
        
        if pane_text == last_title:
            continue
        last_title = pane_text
        
        if pane_text in seen_titles:
            continue
        seen_titles.add(pane_text)
        
        visible_tx32 = get_visible_tx32s(aci_hwnd)
        content_tx32 = [t for t in visible_tx32 if t['is_content']]
        title_tx32 = [t for t in visible_tx32 if not t['is_content']]
        
        section = {
            'pane_title': pane_text,
            'click_x_client': click_x,
            'click_y_client': click_y,
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
