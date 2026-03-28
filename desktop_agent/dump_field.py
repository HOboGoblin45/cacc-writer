"""dump_field.py - Get details on every visible interactive control."""
import sys, os, json, ctypes
import win32gui

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

INTERESTING = {'ACITextEditField', 'ACITextToAddendumEditField', 'ACIBaseField',
               'TX32', 'Edit', 'ACIFormView', 'ACIFullAddendumView',
               'ACIAddendumView', 'ACISectionTabs', 'ACIPaneTitle',
               'Aci.UI.PicklistButton', 'Aci.UI.HelperButton',
               'ACIEditAddendumtButton'}

hwnd = find_aci()
if not hwnd:
    print("No ACI!"); sys.exit(1)

print(f"ACI: {win32gui.GetWindowText(hwnd)}\n")
print("All visible interactive controls:\n")

all_ctrls = []
def cb(child, _):
    try:
        cls = win32gui.GetClassName(child)
        vis = win32gui.IsWindowVisible(child)
        if not vis:
            return
        rect = win32gui.GetWindowRect(child)
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        parent = win32gui.GetParent(child)
        parent_cls = win32gui.GetClassName(parent) if parent else ''
        
        # WM_GETTEXT
        buf = ctypes.create_unicode_buffer(2048)
        length = ctypes.windll.user32.SendMessageW(child, 0x000D, 2048, buf)
        text = buf.value[:length] if length > 0 else ''
        if not text:
            text = win32gui.GetWindowText(child) or ''
        
        all_ctrls.append({
            'hwnd': child,
            'class': cls,
            'parent_class': parent_cls,
            'rect': list(rect),
            'w': w, 'h': h,
            'text': text[:200],
        })
    except:
        pass

win32gui.EnumChildWindows(hwnd, cb, None)

# Show interesting ones
for c in all_ctrls:
    cls = c['class']
    if cls in INTERESTING or 'Edit' in cls or 'Field' in cls or 'TX32' in cls or 'Addendum' in cls:
        preview = c['text'][:100].replace('\n', ' ') if c['text'] else '(empty)'
        print(f"  {cls}")
        print(f"    hwnd={c['hwnd']} parent={c['parent_class']}")
        print(f"    rect=({c['rect'][0]},{c['rect'][1]},{c['rect'][2]},{c['rect'][3]}) {c['w']}x{c['h']}")
        print(f"    text: {preview}")
        print()
