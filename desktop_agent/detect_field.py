"""detect_field.py - Detect the currently active (yellow) field in ACI."""
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

fields = []
formview = [None]

def cb(hwnd, _):
    cls = win32gui.GetClassName(hwnd)
    if not win32gui.IsWindowVisible(hwnd): return
    if cls == 'ACIFormView':
        formview[0] = win32gui.GetWindowRect(hwnd)
    if cls in ('ACITextToAddendumEditField', 'ACITextEditField', 'ACIBaseField'):
        r = win32gui.GetWindowRect(hwnd)
        w, h = r[2]-r[0], r[3]-r[1]
        if w > 5 and h > 5:
            buf = ctypes.create_unicode_buffer(4096)
            ln = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, 4096, buf)
            fields.append({'cls': cls, 'rect': list(r), 'w': w, 'h': h,
                           'text': (buf.value[:ln] if ln else '')[:100], 'hwnd': hwnd})

win32gui.EnumChildWindows(aci, cb, None)
fv = formview[0]
print(f"FormView: ({fv[0]},{fv[1]}) {fv[2]-fv[0]}x{fv[3]-fv[1]}")

if not fields:
    print("NO ACTIVE FIELD DETECTED")
else:
    for f in fields:
        cx = (f['rect'][0] + f['rect'][2]) / 2
        cy = (f['rect'][1] + f['rect'][3]) / 2
        xr = (cx - fv[0]) / (fv[2] - fv[0])
        yr = (cy - fv[1]) / (fv[3] - fv[1])
        print(f"  CLASS: {f['cls']}")
        print(f"  SIZE:  {f['w']}x{f['h']}")
        print(f"  RECT:  ({f['rect'][0]},{f['rect'][1]},{f['rect'][2]},{f['rect'][3]})")
        print(f"  RATIO: ({xr:.4f}, {yr:.4f})")
        print(f"  TEXT:  {f['text'][:80] or '(empty)'}")
        print(f"  HWND:  {f['hwnd']}")
