"""
map_aci_tree.py - Map the full ACI control hierarchy for field mapping.

Finds ACISectionTabs, ACIFormView, ACIFullAddendumView, and their TX32 children.
Shows which TX32 text boxes belong to which section.

Run: C:\Python313-32\python.exe desktop_agent\map_aci_tree.py
"""

import sys, os, json
from datetime import datetime
import win32gui, win32con

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temp')
os.makedirs(OUTPUT_DIR, exist_ok=True)

INTERESTING_CLASSES = {
    'ACISectionTabs', 'ACIFormView', 'ACIFormViewLayout',
    'ACIFullAddendumView', 'ACIAddendumView', 'ACIPaneTitle',
    'ACIRpdView', 'ACIRpdCompView', 'ACISplitterBar',
    'TX32', 'Edit', 'ComboBox', 'ACIBaseField',
    'ACIEditAddendumtButton',
}


def get_window_info(hwnd):
    """Get basic info about a window handle."""
    try:
        cls = win32gui.GetClassName(hwnd)
        text = win32gui.GetWindowText(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        visible = win32gui.IsWindowVisible(hwnd)
        return {
            'hwnd': hwnd,
            'class': cls,
            'text': text[:300] if text else '',
            'rect': list(rect),
            'width': rect[2] - rect[0],
            'height': rect[3] - rect[1],
            'visible': bool(visible),
        }
    except:
        return None


def build_tree(hwnd, depth=0, max_depth=8):
    """Recursively build control tree, filtering to interesting classes."""
    info = get_window_info(hwnd)
    if not info:
        return None
    
    children = []
    def enum_child(child_hwnd, _):
        # Only direct children (not all descendants)
        if win32gui.GetParent(child_hwnd) == hwnd:
            children.append(child_hwnd)
    
    try:
        win32gui.EnumChildWindows(hwnd, enum_child, None)
    except:
        pass
    
    info['children'] = []
    for child_hwnd in children:
        child_info = get_window_info(child_hwnd)
        if not child_info:
            continue
        cls = child_info.get('class', '')
        
        # Always recurse into structural containers
        if cls in INTERESTING_CLASSES or cls.startswith('ACI') or cls == 'MDIClient' or cls.startswith('OWL_'):
            subtree = build_tree(child_hwnd, depth + 1, max_depth)
            if subtree:
                info['children'].append(subtree)
        elif cls == 'TX32':
            # TX32 leaf — just add info
            info['children'].append(child_info)
        elif depth < 3:
            # At shallow depth, include everything
            subtree = build_tree(child_hwnd, depth + 1, max_depth)
            if subtree:
                info['children'].append(subtree)
    
    return info


def print_tree(node, indent=0, show_tx32_text=True):
    """Pretty-print the tree."""
    prefix = "  " * indent
    cls = node.get('class', '?')
    text = node.get('text', '')
    w, h = node.get('width', 0), node.get('height', 0)
    
    # Highlight important classes
    marker = ''
    if cls == 'TX32':
        marker = ' [TX32]'
    elif cls == 'ACISectionTabs':
        marker = ' [TABS]'
    elif cls == 'ACIFormView':
        marker = ' [FORM]'
    elif cls == 'ACIFullAddendumView':
        marker = ' [ADDENDUM]'
    elif cls == 'ACIPaneTitle':
        marker = ' [TITLE]'
    
    text_preview = ''
    if text and cls == 'TX32':
        preview = text[:100].replace('\n', ' ').replace('\r', '')
        text_preview = f' text="{preview}"'
    elif text and cls != 'TX32':
        text_preview = f' "{text[:60]}"'
    
    vis = '' if node.get('visible') else ' (hidden)'
    print(f"{prefix}{cls}{marker} {w}x{h}{text_preview}{vis}")
    
    for child in node.get('children', []):
        print_tree(child, indent + 1, show_tx32_text)


def find_nodes_by_class(tree, target_class, results=None):
    """Find all nodes with a given class name."""
    if results is None:
        results = []
    if tree.get('class') == target_class:
        results.append(tree)
    for child in tree.get('children', []):
        find_nodes_by_class(child, target_class, results)
    return results


def main():
    print("\n" + "=" * 70)
    print("  ACI Full Control Tree Mapper")
    print("=" * 70)
    
    # Find ACI
    matches = []
    def enum_cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ''
        cls = win32gui.GetClassName(hwnd) or ''
        if 'ACI Report' in title or 'REPORT32MAIN' in cls.upper():
            matches.append((hwnd, title, cls))
    win32gui.EnumWindows(enum_cb, None)
    
    if not matches:
        print("  No ACI window found!")
        sys.exit(1)
    
    hwnd, title, cls = matches[0]
    print(f"\n  Window: {title}")
    print(f"  Handle: {hwnd}")
    
    # Build full tree
    print("\n  Building control tree...\n")
    tree = build_tree(hwnd)
    
    if tree:
        print_tree(tree)
        
        # Summary
        print("\n" + "-" * 70)
        
        # Find all ACISectionTabs
        tabs = find_nodes_by_class(tree, 'ACISectionTabs')
        print(f"\n  ACISectionTabs found: {len(tabs)}")
        for i, tab in enumerate(tabs):
            print(f"    [{i}] {tab['width']}x{tab['height']} at ({tab['rect'][0]},{tab['rect'][1]})")
            # Check for child text
            for child in tab.get('children', []):
                if child.get('text'):
                    print(f"        child: {child.get('class','?')} \"{child['text'][:60]}\"")
        
        # Find all ACIPaneTitle
        titles = find_nodes_by_class(tree, 'ACIPaneTitle')
        print(f"\n  ACIPaneTitle found: {len(titles)}")
        for i, t in enumerate(titles):
            print(f"    [{i}] \"{t.get('text','')[:80]}\" {t['width']}x{t['height']}")
        
        # Find all TX32
        tx32s = find_nodes_by_class(tree, 'TX32')
        print(f"\n  TX32 controls found: {len(tx32s)}")
        visible_tx32 = [t for t in tx32s if t.get('visible')]
        hidden_tx32 = [t for t in tx32s if not t.get('visible')]
        print(f"    Visible: {len(visible_tx32)}")
        print(f"    Hidden:  {len(hidden_tx32)}")
        
        for i, t in enumerate(visible_tx32):
            preview = (t.get('text','')[:80] or '(empty)').replace('\n',' ')
            print(f"    [V{i}] {t['width']}x{t['height']} at ({t['rect'][0]},{t['rect'][1]}) \"{preview}\"")
        
        # Save full tree
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        outfile = os.path.join(OUTPUT_DIR, f'aci_tree_{ts}.json')
        with open(outfile, 'w', encoding='utf-8') as f:
            json.dump(tree, f, indent=2, default=str)
        print(f"\n  Full tree saved to: {outfile}")
    
    print("=" * 70)


if __name__ == '__main__':
    main()
