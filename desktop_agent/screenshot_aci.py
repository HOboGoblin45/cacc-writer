"""
screenshot_aci.py - Capture ACI window screenshot.
Run: C:\Python313-32\python.exe desktop_agent\screenshot_aci.py
"""
import sys, os, time
import win32gui
from PIL import ImageGrab

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

hwnd = find_aci()
if not hwnd:
    print("No ACI window found!")
    sys.exit(1)

rect = win32gui.GetWindowRect(hwnd)
print(f"ACI rect: {rect}")

# Capture just the ACI window area
img = ImageGrab.grab(bbox=rect)
outpath = os.path.join(OUTPUT_DIR, 'aci_screenshot.png')
img.save(outpath)
print(f"Saved: {outpath}")

# Also capture just the bottom 50px (tab bar area)
tab_img = ImageGrab.grab(bbox=(rect[0], rect[3]-60, rect[2], rect[3]))
tab_path = os.path.join(OUTPUT_DIR, 'aci_tabs_screenshot.png')
tab_img.save(tab_path)
print(f"Tab bar: {tab_path}")
