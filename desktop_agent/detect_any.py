"""detect_any.py - Show ALL visible child controls in ACIFormView."""
import win32gui, ctypes

def find_aci():
    matches = []
    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd): return
        if 'ACI Report' in (win32gui.GetWindowText(hwnd) or ''):
            matches.append(hwnd)
    win32gui.EnumWindows(cb, None)
    return matches[0] if matches else None

aci = find_aci()
if not aci:
    print("No ACI!"); exit(1)

formview = [None]
all_ctrls = []

def cb(hwnd, _):
    cls = win32gui.GetClassName(hwnd)
    if not win32gui.IsWindowVisible(hwnd): return
    if cls == 'ACIFormView':
        formview[0] = win32gui.GetWindowRect(hwnd)
        return
    # Skip the big containers
    if cls in ('MDIClient','ACIRpdView','ACIRpdCompView','ACISplitterBar',
               'ACIFormViewLayout','ACISectionTabs','ACIPaneTitle',
               'ACIFullAddendumView','ACIAddendumView','OWL_Window','OWL_Window:F'):
        return
    rect = win32gui.GetWindowRect(hwnd)
    w, h = rect[2]-rect[0], rect[3]-rect[1]
    if w < 3 or h < 3: return
    parent = win32gui.GetParent(hwnd)
    pcls = win32gui.GetClassName(parent) if parent else ''
    buf = ctypes.create_unicode_buffer(4096)
    ln = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, 4096, buf)
    text = buf.value[:ln] if ln else ''
    if not text:
        text = win32gui.GetWindowText(hwnd) or ''
    all_ctrls.append({'cls':cls,'pcls':pcls,'rect':list(rect),'w':w,'h':h,'text':text[:100],'hwnd':hwnd})

win32gui.EnumChildWindows(aci, cb, None)

fv = formview[0]
print(f"FormView: ({fv[0]},{fv[1]}) {fv[2]-fv[0]}x{fv[3]-fv[1]}")
print(f"\nAll visible controls ({len(all_ctrls)}):\n")
for c in all_ctrls:
    cx = (c['rect'][0]+c['rect'][2])/2
    cy = (c['rect'][1]+c['rect'][3])/2
    xr = (cx-fv[0])/(fv[2]-fv[0])
    yr = (cy-fv[1])/(fv[3]-fv[1])
    t = c['text'][:60].replace('\n',' ') if c['text'] else '(empty)'
    print(f"  {c['cls']:40s} {c['w']:4d}x{c['h']:<4d} ratio=({xr:.4f},{yr:.4f}) parent={c['pcls']:20s} text={t}")
