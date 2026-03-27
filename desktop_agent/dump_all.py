"""
dump_all.py - Dump EVERY child window of ACI with full detail.
No filtering. Just raw truth.

Run: C:\Python313-32\python.exe desktop_agent\dump_all.py
"""

import sys, os, json
from datetime import datetime
import win32gui, win32con
import ctypes

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)


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


def dump_children(parent, depth=0, max_depth=6):
    """Get direct children of a window."""
    children = []
    
    def cb(hwnd, _):
        if win32gui.GetParent(hwnd) != parent:
            return  # skip non-direct children
        try:
            cls = win32gui.GetClassName(hwnd)
            text = win32gui.GetWindowText(hwnd) or ''
            rect = win32gui.GetWindowRect(hwnd)
            vis = bool(win32gui.IsWindowVisible(hwnd))
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            
            entry = {
                'hwnd': hwnd,
                'class': cls,
                'text': text[:200],
                'rect': list(rect),
                'w': w, 'h': h,
                'visible': vis,
                'depth': depth,
            }
            
            if depth < max_depth:
                entry['children'] = dump_children(hwnd, depth + 1, max_depth)
            
            children.append(entry)
        except:
            pass
    
    try:
        win32gui.EnumChildWindows(parent, cb, None)
    except:
        pass
    return children


def print_tree(nodes, indent=0):
    for n in nodes:
        prefix = "  " * indent
        cls = n['class']
        text = n.get('text', '')
        vis = '' if n.get('visible') else ' [hidden]'
        w, h = n.get('w', 0), n.get('h', 0)
        
        text_str = f' "{text[:60]}"' if text else ''
        print(f"{prefix}{cls} {w}x{h}{text_str}{vis} (hwnd={n['hwnd']})")
        
        for child in n.get('children', []):
            print_tree([child], indent + 1)


def main():
    hwnd = find_aci()
    if not hwnd:
        print("No ACI found!")
        sys.exit(1)
    
    title = win32gui.GetWindowText(hwnd)
    print(f"\nACI: {title}")
    print(f"Handle: {hwnd}\n")
    
    tree = dump_children(hwnd, max_depth=4)
    print_tree(tree)
    
    # Also count all descendants by class
    print("\n\nAll descendants by class:")
    class_counts = {}
    all_handles = []
    def cb(h, _):
        cls = win32gui.GetClassName(h)
        vis = win32gui.IsWindowVisible(h)
        key = f"{cls} ({'vis' if vis else 'hid'})"
        class_counts[key] = class_counts.get(key, 0) + 1
        all_handles.append((h, cls, vis))
    try:
        win32gui.EnumChildWindows(hwnd, cb, None)
    except:
        pass
    
    for k, v in sorted(class_counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")
    
    # Save
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    outfile = os.path.join(OUTPUT_DIR, f'aci_dump_{ts}.json')
    with open(outfile, 'w', encoding='utf-8') as f:
        json.dump({'window': title, 'tree': tree}, f, indent=2, default=str)
    print(f"\nSaved: {outfile}")


if __name__ == '__main__':
    main()
