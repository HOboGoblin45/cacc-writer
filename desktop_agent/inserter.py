"""
desktop_agent/inserter.py
--------------------------
Phase 3 ACI insertion engine — click-to-activate strategy.

Instead of the old TX32 label-proximity approach, this module:
1. Finds the ACI window
2. Clicks the appropriate tab on the ACISectionTabs bar
3. Clicks the field position on the ACIFormView to activate it (turns yellow)
4. Waits for the edit control to appear
5. Pastes text via clipboard (Ctrl+A, Ctrl+V)
6. Verifies by reading back from the edit control

All field positions are stored as ratios in field_maps/1004.json,
so they work at any window size.
"""

import json
import os
import time
import logging
import ctypes
from datetime import datetime

log = logging.getLogger('cacc_agent')

# ── Optional imports ──────────────────────────────────────────────────────────

try:
    import pyperclip
    PYPERCLIP_AVAILABLE = True
except ImportError:
    PYPERCLIP_AVAILABLE = False

try:
    from pywinauto import Application
    from pywinauto.keyboard import send_keys
    PYWINAUTO_AVAILABLE = True
except ImportError:
    PYWINAUTO_AVAILABLE = False

try:
    import win32gui
    import win32con
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

try:
    from PIL import ImageGrab
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ── Paths ─────────────────────────────────────────────────────────────────────

AGENT_DIR      = os.path.dirname(os.path.abspath(__file__))
FIELD_MAPS_DIR = os.path.join(AGENT_DIR, 'field_maps')
SCREENSHOTS_DIR = os.path.join(AGENT_DIR, 'screenshots')

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# ── Edit control classes we recognize ─────────────────────────────────────────

EDIT_CLASSES = {
    'ACITextEditField',
    'ACITextToAddendumEditField',
    'ACINumericEditField',
    'ACIBaseField',
}

# ── Field map cache ───────────────────────────────────────────────────────────

_field_map_cache = {}

def load_field_map(form_type='1004'):
    """Load and cache the field map JSON."""
    if form_type in _field_map_cache:
        return _field_map_cache[form_type]
    path = os.path.join(FIELD_MAPS_DIR, f'{form_type}.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        _field_map_cache[form_type] = data
        return data
    except Exception as e:
        log.error(f"Failed to load field map {path}: {e}")
        return {}

def reload_field_maps():
    """Clear the cache to force reload."""
    _field_map_cache.clear()

# ── ACI window discovery ─────────────────────────────────────────────────────

def find_aci_hwnd():
    """Find the ACI Report window handle."""
    if not WIN32_AVAILABLE:
        return None
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


def connect_aci():
    """Connect to ACI with pywinauto (win32 backend)."""
    hwnd = find_aci_hwnd()
    if not hwnd:
        return None, None
    try:
        app = Application(backend='win32').connect(handle=hwnd)
        win = app.window(handle=hwnd)
        return app, win
    except Exception as e:
        log.error(f"Failed to connect to ACI: {e}")
        return None, None


def find_child_by_class(parent_hwnd, target_class):
    """Find first visible child window with given class."""
    result = [None]
    def cb(hwnd, _):
        if result[0]:
            return
        if win32gui.GetClassName(hwnd) == target_class and win32gui.IsWindowVisible(hwnd):
            result[0] = hwnd
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except:
        pass
    return result[0]


def find_all_by_class(parent_hwnd, target_class, visible_only=True):
    """Find all descendant windows with given class."""
    results = []
    def cb(hwnd, _):
        if win32gui.GetClassName(hwnd) == target_class:
            if not visible_only or win32gui.IsWindowVisible(hwnd):
                results.append(hwnd)
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except:
        pass
    return results


def get_formview_rect(aci_hwnd):
    """Get the ACIFormView screen rect."""
    hwnd = find_child_by_class(aci_hwnd, 'ACIFormView')
    if hwnd:
        return win32gui.GetWindowRect(hwnd)
    return None


def get_tabs_rect(aci_hwnd):
    """Get the ACISectionTabs screen rect."""
    hwnd = find_child_by_class(aci_hwnd, 'ACISectionTabs')
    if hwnd:
        return win32gui.GetWindowRect(hwnd)
    return None


# ── Click helpers ─────────────────────────────────────────────────────────────

def click_screen(x, y):
    """Click at screen coordinates using ctypes (works without foreground)."""
    ctypes.windll.user32.SetCursorPos(int(x), int(y))
    time.sleep(0.05)
    ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)  # LBUTTONDOWN
    time.sleep(0.05)
    ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)  # LBUTTONUP
    time.sleep(0.1)


def click_ratio(rect, x_ratio, y_ratio):
    """Click at a ratio position within a screen rect (left, top, right, bottom)."""
    left, top, right, bottom = rect
    w = right - left
    h = bottom - top
    x = left + int(w * x_ratio)
    y = top + int(h * y_ratio)
    click_screen(x, y)
    return x, y


# ── Tab navigation ────────────────────────────────────────────────────────────

def navigate_tab(aci_hwnd, tab_click_ratio):
    """Click a tab on the ACISectionTabs bar at the given X ratio."""
    tabs_rect = get_tabs_rect(aci_hwnd)
    if not tabs_rect:
        log.error("ACISectionTabs not found")
        return False
    
    left, top, right, bottom = tabs_rect
    w = right - left
    h = bottom - top
    x = left + int(w * tab_click_ratio)
    y = top + h // 2
    
    click_screen(x, y)
    time.sleep(0.4)
    log.info(f"  Tab click at ratio={tab_click_ratio:.3f} screen=({x},{y})")
    return True


# ── Field activation ──────────────────────────────────────────────────────────

def scroll_to_top(aci_hwnd):
    """Scroll the form view to the top by clicking the ACIPaneTitle then Ctrl+Home."""
    # Find ACIPaneTitle — it's a non-field area at the top we can click safely
    pane_hwnd = find_child_by_class(aci_hwnd, 'ACIPaneTitle')
    if pane_hwnd:
        rect = win32gui.GetWindowRect(pane_hwnd)
        cx = (rect[0] + rect[2]) // 2
        cy = (rect[1] + rect[3]) // 2
        click_screen(cx, cy)
        time.sleep(0.1)
    
    # Now find the ACIFormView and send WM_VSCROLL SB_TOP
    fv_hwnd = find_child_by_class(aci_hwnd, 'ACIFormView')
    if fv_hwnd:
        # SB_TOP = 6, WM_VSCROLL = 0x0115
        ctypes.windll.user32.SendMessageW(fv_hwnd, 0x0115, 6, 0)
        time.sleep(0.1)
        # Also try SB_LINEUP many times
        for _ in range(50):
            ctypes.windll.user32.SendMessageW(fv_hwnd, 0x0115, 0, 0)  # SB_LINEUP
        time.sleep(0.1)
    
    # Also try the left sidebar control
    rpd_hwnd = find_child_by_class(aci_hwnd, 'ACIRpdView')
    if rpd_hwnd:
        ctypes.windll.user32.SendMessageW(rpd_hwnd, 0x0115, 6, 0)
        time.sleep(0.1)
    
    # Final fallback: send Page Up keys to the form
    if fv_hwnd:
        try:
            # Send WM_KEYDOWN for VK_HOME (0x24) with Ctrl
            ctypes.windll.user32.PostMessageW(fv_hwnd, 0x0100, 0x24, 0)  # WM_KEYDOWN VK_HOME
            time.sleep(0.1)
        except:
            pass
    
    time.sleep(0.2)
    log.info("  Scroll reset to top attempted")


def dismiss_addendum_dialog(max_wait=2.0):
    """Check for and dismiss the 'addendum text will fit' dialog by clicking Yes.
    Polls for up to max_wait seconds since the dialog may take a moment to appear."""
    start = time.time()
    while time.time() - start < max_wait:
        try:
            yes_buttons = []
            
            def find_yes_in_dialogs(hwnd, _):
                if not win32gui.IsWindowVisible(hwnd):
                    return
                title = win32gui.GetWindowText(hwnd) or ''
                cls = win32gui.GetClassName(hwnd) or ''
                # Look for any dialog-like window (ACI Report, #32770, or any with Yes/No)
                if 'ACI' in title or cls == '#32770' or 'Report' in title:
                    def scan_children(child, _):
                        try:
                            if not win32gui.IsWindowVisible(child):
                                return
                            text = win32gui.GetWindowText(child) or ''
                            cls2 = win32gui.GetClassName(child) or ''
                            if ('Yes' in text or '&Yes' in text) and 'Button' in cls2:
                                yes_buttons.append(child)
                        except:
                            pass
                    try:
                        win32gui.EnumChildWindows(hwnd, scan_children, None)
                    except:
                        pass
            
            win32gui.EnumWindows(find_yes_in_dialogs, None)
            
            if yes_buttons:
                yes_hwnd = yes_buttons[0]
                rect = win32gui.GetWindowRect(yes_hwnd)
                cx = (rect[0] + rect[2]) // 2
                cy = (rect[1] + rect[3]) // 2
                click_screen(cx, cy)
                time.sleep(0.5)
                log.info("  Dismissed addendum overflow dialog (clicked Yes)")
                return True
        except Exception as e:
            log.debug(f"  Dialog scan error: {e}")
        
        time.sleep(0.3)
    
    return False


def ensure_form_view(aci_hwnd):
    """If ACI switched to addendum view, click back to form view via left sidebar."""
    # Check if ACIFormView is visible
    fv_hwnd = find_child_by_class(aci_hwnd, 'ACIFormView')
    if fv_hwnd and win32gui.IsWindowVisible(fv_hwnd):
        return True  # Already on form view
    
    # ACIFormView is hidden — we're on addendum view
    # Click the 1004_05UAD item in the left sidebar (ACIRpdCompView)
    rpd_hwnd = find_child_by_class(aci_hwnd, 'ACIRpdCompView')
    if rpd_hwnd:
        rect = win32gui.GetWindowRect(rpd_hwnd)
        # Click near the top of the sidebar (first document entry)
        cx = (rect[0] + rect[2]) // 2
        cy = rect[1] + 40  # roughly where 1004_05UAD is
        click_screen(cx, cy)
        time.sleep(0.5)
        log.info("  Clicked sidebar to return to form view")
    
    return fv_hwnd and win32gui.IsWindowVisible(fv_hwnd)


def activate_field(aci_hwnd, field_click_ratio):
    """Click on the ACIFormView at the given [x, y] ratio to activate a field.
    Clicking a new field automatically deactivates the previous one in ACI."""
    fv_rect = get_formview_rect(aci_hwnd)
    if not fv_rect:
        log.error("ACIFormView not found")
        return False
    
    x_ratio, y_ratio = field_click_ratio
    sx, sy = click_ratio(fv_rect, x_ratio, y_ratio)
    time.sleep(0.3)
    log.info(f"  Field click at ratio=({x_ratio:.4f},{y_ratio:.4f}) screen=({sx},{sy})")
    return True


def find_active_edit(aci_hwnd):
    """Find the currently active (yellow) edit control."""
    for cls_name in EDIT_CLASSES:
        for hwnd in find_all_by_class(aci_hwnd, cls_name, visible_only=True):
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            if w > 5 and h > 5:
                return hwnd, cls_name, rect
    return None, None, None


def read_edit_text(hwnd):
    """Read text from an edit control. Tries WM_GETTEXT first, then clipboard readback."""
    # Method 1: WM_GETTEXT
    buf = ctypes.create_unicode_buffer(32768)
    length = ctypes.windll.user32.SendMessageW(hwnd, 0x000D, 32768, buf)
    if length > 0:
        return buf.value[:length]
    
    # Method 2: Clipboard readback (Ctrl+A, Ctrl+C)
    if PYPERCLIP_AVAILABLE:
        try:
            # Save current clipboard
            old_clip = ''
            try:
                old_clip = pyperclip.paste()
            except:
                pass
            
            # Select all and copy
            pyperclip.copy('')  # clear clipboard
            time.sleep(0.05)
            send_keys('^a')
            time.sleep(0.05)
            send_keys('^c')
            time.sleep(0.1)
            
            text = pyperclip.paste() or ''
            
            # Restore cursor position (Home key to deselect)
            send_keys('{HOME}')
            time.sleep(0.05)
            
            if text:
                return text
        except:
            pass
    
    return ''


def set_edit_text(hwnd, text):
    """Set text in the edit control via WM_SETTEXT, with clipboard paste fallback."""
    if not PYPERCLIP_AVAILABLE:
        log.error("pyperclip not available")
        return False
    
    # Click directly on the edit control to ensure IT has focus (not some other field)
    try:
        rect = win32gui.GetWindowRect(hwnd)
        cx = (rect[0] + rect[2]) // 2
        cy = (rect[1] + rect[3]) // 2
        click_screen(cx, cy)
        time.sleep(0.15)
    except:
        pass
    
    # Copy to clipboard and paste
    pyperclip.copy(text)
    time.sleep(0.05)
    
    # Select all text in this field, then paste
    send_keys('^a')
    time.sleep(0.05)
    send_keys('^v')
    time.sleep(0.2)
    
    log.info(f"  Text set via clipboard paste ({len(text)} chars)")
    
    # Handle addendum overflow dialog if it appears
    time.sleep(0.3)
    dismiss_addendum_dialog()
    
    return True


# ── Screenshot ────────────────────────────────────────────────────────────────

def capture_screenshot(label=''):
    """Capture ACI screenshot for debugging."""
    if not PIL_AVAILABLE:
        return None
    hwnd = find_aci_hwnd()
    if not hwnd:
        return None
    try:
        rect = win32gui.GetWindowRect(hwnd)
        img = ImageGrab.grab(bbox=rect)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        name = f'aci_{label}_{ts}.png' if label else f'aci_{ts}.png'
        path = os.path.join(SCREENSHOTS_DIR, name)
        img.save(path)
        log.info(f"  Screenshot: {path}")
        return path
    except Exception as e:
        log.warning(f"  Screenshot failed: {e}")
        return None


# ── Main insertion function ───────────────────────────────────────────────────

def insert_field(aci_hwnd, field_id, text, form_type='1004', section=None):
    """
    Insert text into a single ACI field using click-to-activate.
    
    Args:
        aci_hwnd: ACI window handle
        field_id: Field identifier (e.g. 'neighborhood_description')
        text: Text to insert
        form_type: Form type (default '1004')
        section: Optional section override (e.g. 'narratives', 'subject')
    
    Returns:
        dict with ok, field_id, inserted, verified, method, error
    """
    field_map = load_field_map(form_type)
    
    # Find the field config — search through sections
    field_cfg = None
    field_tab = None
    field_tab_ratio = None
    
    if section and section in field_map:
        sec = field_map[section]
        if field_id in sec:
            field_cfg = sec[field_id]
            field_tab = sec.get('_tab')
            field_tab_ratio = sec.get('_tab_click_ratio')
    
    if not field_cfg:
        # Search all sections
        for sec_name, sec_data in field_map.items():
            if sec_name.startswith('_'):
                continue
            if not isinstance(sec_data, dict):
                continue
            if field_id in sec_data:
                field_cfg = sec_data[field_id]
                field_tab = sec_data.get('_tab', field_cfg.get('tab'))
                field_tab_ratio = sec_data.get('_tab_click_ratio', field_cfg.get('tab_click_ratio'))
                break
    
    if not field_cfg:
        return {
            'ok': False,
            'field_id': field_id,
            'error': f"Field '{field_id}' not found in {form_type} field map",
        }
    
    # Get tab and field click ratios
    tab_ratio = field_cfg.get('tab_click_ratio', field_tab_ratio)
    field_ratio = field_cfg.get('field_click_ratio')
    
    if not field_ratio:
        return {
            'ok': False,
            'field_id': field_id,
            'error': f"No field_click_ratio for '{field_id}'",
        }
    
    label = field_cfg.get('label', field_id)
    log.info(f"INSERT '{label}' (id={field_id}, {len(text)} chars)")
    
    # Bring ACI to foreground
    try:
        ctypes.windll.user32.AllowSetForegroundWindow(-1)
        win32gui.SetForegroundWindow(aci_hwnd)
        time.sleep(0.3)
    except:
        log.warning("  Could not foreground ACI")
    
    # Step 0: Ensure we're on the form view (not addendum view)
    ensure_form_view(aci_hwnd)
    
    # Step 1: Navigate to tab
    if tab_ratio is not None:
        navigate_tab(aci_hwnd, tab_ratio)
        time.sleep(0.3)
    
    # Step 2: Click on the field to activate it
    if not activate_field(aci_hwnd, field_ratio):
        return {
            'ok': False,
            'field_id': field_id,
            'error': 'Failed to click field position',
        }
    time.sleep(0.3)
    
    # Step 3: Find the active edit control
    edit_hwnd, edit_cls, edit_rect = find_active_edit(aci_hwnd)
    if not edit_hwnd:
        # Retry — click again
        log.warning("  No edit control found, retrying click...")
        activate_field(aci_hwnd, field_ratio)
        time.sleep(0.5)
        edit_hwnd, edit_cls, edit_rect = find_active_edit(aci_hwnd)
    
    if not edit_hwnd:
        shot = capture_screenshot(f'no_edit_{field_id}')
        return {
            'ok': False,
            'field_id': field_id,
            'error': 'No edit control appeared after clicking field',
            'screenshot': shot,
        }
    
    log.info(f"  Edit control: {edit_cls} at {edit_rect}")
    
    # Step 4: Paste text
    if not set_edit_text(edit_hwnd, text):
        return {
            'ok': False,
            'field_id': field_id,
            'error': 'Failed to paste text into edit control',
        }
    
    # Step 5: Verify — re-click the field to read it back
    verified = False
    verify_text = ''
    time.sleep(0.2)
    
    verify_mode = field_cfg.get('verification_mode', 'edit_readback')
    if verify_mode != 'skip':
        verify_text = read_edit_text(edit_hwnd)
        # Normalize for comparison
        text_norm = ' '.join(text.split()).strip().lower()
        verify_norm = ' '.join(verify_text.split()).strip().lower()
        
        if text_norm and verify_norm:
            # Check if at least the first 50 chars match
            check_len = min(50, len(text_norm))
            verified = verify_norm[:check_len] == text_norm[:check_len]
        elif not text_norm:
            verified = True  # empty text insertion is trivially verified
    else:
        verified = True  # skip verification
    
    status = '✓' if verified else '✗'
    log.info(f"  {status} Inserted '{label}' ({len(text)} chars, verified={verified})")
    
    return {
        'ok': True,
        'field_id': field_id,
        'label': label,
        'inserted': True,
        'verified': verified,
        'method': 'click_to_activate',
        'edit_class': edit_cls,
        'verify_text_preview': verify_text[:100] if verify_text else '',
    }


def insert_comp_grid_cell(aci_hwnd, row_id, comp_num, text, form_type='1004'):
    """
    Insert text into a specific cell of the comparable sales grid.
    
    Args:
        aci_hwnd: ACI window handle
        row_id: Row identifier (e.g. 'address', 'sale_price', 'gla')
        comp_num: 1, 2, or 3 (or 0 for subject)
        text: Text to insert
        form_type: Form type
    
    Returns:
        dict with ok, field_id, inserted, verified, etc.
    """
    field_map = load_field_map(form_type)
    grid = field_map.get('sales_comparison_grid', {})
    
    row_cfg = grid.get(row_id)
    if not row_cfg:
        return {'ok': False, 'error': f"Grid row '{row_id}' not found"}
    
    col_offsets = grid.get('_column_offsets', {})
    y = row_cfg.get('y')
    x_type = row_cfg.get('x_type', 'desc')
    
    # Determine X position
    overrides = row_cfg.get('x_offset_override', {})
    comp_key = f'comp{comp_num}' if comp_num > 0 else 'subject'
    
    if comp_key in overrides:
        x = overrides[comp_key]
    elif comp_num == 0:
        x = col_offsets.get(f'subject_{x_type}', col_offsets.get('subject_addr'))
    else:
        x = col_offsets.get(f'comp{comp_num}_{x_type}', col_offsets.get(f'comp{comp_num}_desc'))
    
    if x is None or y is None:
        return {'ok': False, 'error': f"Cannot calculate position for {row_id} comp{comp_num}"}
    
    field_id = f'grid_{row_id}_comp{comp_num}'
    tab_ratio = grid.get('_tab_click_ratio', 0.40)
    
    # Use the standard insert flow
    log.info(f"GRID INSERT '{row_id}' comp{comp_num} at ({x:.4f},{y:.4f})")
    
    # Bring ACI to foreground
    try:
        ctypes.windll.user32.AllowSetForegroundWindow(-1)
        win32gui.SetForegroundWindow(aci_hwnd)
        time.sleep(0.3)
    except:
        pass
    
    # Navigate to Sales tab
    navigate_tab(aci_hwnd, tab_ratio)
    time.sleep(0.3)
    
    # Click the cell
    activate_field(aci_hwnd, [x, y])
    time.sleep(0.3)
    
    # Find edit control
    edit_hwnd, edit_cls, edit_rect = find_active_edit(aci_hwnd)
    if not edit_hwnd:
        time.sleep(0.3)
        activate_field(aci_hwnd, [x, y])
        time.sleep(0.5)
        edit_hwnd, edit_cls, edit_rect = find_active_edit(aci_hwnd)
    
    if not edit_hwnd:
        return {'ok': False, 'field_id': field_id, 'error': 'No edit control for grid cell'}
    
    # Paste
    set_edit_text(edit_hwnd, text)
    time.sleep(0.2)
    
    # Verify
    verify_text = read_edit_text(edit_hwnd)
    text_norm = text.strip().lower()
    verify_norm = verify_text.strip().lower()
    verified = verify_norm.startswith(text_norm[:30]) if text_norm else True
    
    return {
        'ok': True,
        'field_id': field_id,
        'row': row_id,
        'comp': comp_num,
        'inserted': True,
        'verified': verified,
        'method': 'click_to_activate_grid',
    }


def insert_sequential(aci_hwnd, first_field_id, texts, form_type='1004', section=None,
                      skip_populated=True):
    """
    Insert multiple values into consecutive fields using Tab to advance.
    
    Click the first field by position, paste text, then Tab to next, paste, etc.
    This avoids the scroll problem entirely since Tab moves between fields
    without changing scroll position.
    
    Args:
        aci_hwnd: ACI window handle
        first_field_id: The field to click first (e.g. 'property_address')
        texts: list of strings to insert in tab order from the first field
        form_type: Form type
        section: Section in field map
        skip_populated: If True, skip fields that already have text (don't overwrite)
    
    Returns:
        dict with ok, results, summary
    """
    field_map = load_field_map(form_type)
    
    # Find the first field config
    field_cfg = None
    tab_ratio = None
    for sec_name, sec_data in field_map.items():
        if sec_name.startswith('_') or not isinstance(sec_data, dict):
            continue
        if first_field_id in sec_data:
            field_cfg = sec_data[first_field_id]
            tab_ratio = sec_data.get('_tab_click_ratio', field_cfg.get('tab_click_ratio'))
            break
    
    if not field_cfg:
        return {'ok': False, 'error': f"Field '{first_field_id}' not found"}
    
    field_ratio = field_cfg.get('field_click_ratio')
    if not field_ratio:
        return {'ok': False, 'error': f"No position for '{first_field_id}'"}
    
    # Bring ACI to foreground
    try:
        ctypes.windll.user32.AllowSetForegroundWindow(-1)
        win32gui.SetForegroundWindow(aci_hwnd)
        time.sleep(0.3)
    except:
        pass
    
    # Navigate to tab
    if tab_ratio is not None:
        navigate_tab(aci_hwnd, tab_ratio)
        time.sleep(0.3)
    
    # Click the first field
    activate_field(aci_hwnd, field_ratio)
    time.sleep(0.3)
    
    results = []
    
    for i, text in enumerate(texts):
        if i > 0:
            # Tab to next field
            try:
                send_keys('{TAB}')
                time.sleep(0.3)
            except:
                pass
        
        # Find whatever edit control is now active
        edit_hwnd, edit_cls, edit_rect = find_active_edit(aci_hwnd)
        if not edit_hwnd:
            results.append({'ok': False, 'index': i, 'error': 'No edit control found'})
            continue
        
        # Check if field already has text
        existing_text = read_edit_text(edit_hwnd).strip()
        if skip_populated and existing_text:
            log.info(f"  Sequential [{i}] SKIPPED — already has: '{existing_text[:40]}'")
            results.append({
                'ok': True,
                'index': i,
                'text': text,
                'inserted': False,
                'skipped': True,
                'existing_text': existing_text[:100],
                'edit_class': edit_cls,
            })
            continue
        
        # Paste
        if not PYPERCLIP_AVAILABLE:
            results.append({'ok': False, 'index': i, 'error': 'pyperclip unavailable'})
            continue
        
        pyperclip.copy(text)
        time.sleep(0.05)
        send_keys('^a')
        time.sleep(0.05)
        send_keys('^v')
        time.sleep(0.2)
        
        log.info(f"  Sequential [{i}] inserted '{text[:30]}' into {edit_cls}")
        results.append({
            'ok': True,
            'index': i,
            'text': text,
            'inserted': True,
            'edit_class': edit_cls,
        })
    
    success = sum(1 for r in results if r.get('ok'))
    return {
        'ok': success == len(texts),
        'results': results,
        'summary': {'total': len(texts), 'success': success, 'failed': len(texts) - success},
    }


def insert_batch(aci_hwnd, fields, form_type='1004', delay_between=0.5):
    """
    Insert multiple fields in sequence.
    
    Args:
        aci_hwnd: ACI window handle
        fields: list of {fieldId, text, section?} dicts
        form_type: Form type
        delay_between: Seconds between insertions
    
    Returns:
        dict with ok, results (list), summary
    """
    results = []
    success_count = 0
    fail_count = 0
    
    for item in fields:
        field_id = item.get('fieldId', '')
        text = item.get('text', '')
        section = item.get('section')
        
        if not field_id or not text:
            results.append({'ok': False, 'field_id': field_id, 'error': 'Missing fieldId or text'})
            fail_count += 1
            continue
        
        result = insert_field(aci_hwnd, field_id, text, form_type, section)
        results.append(result)
        
        if result.get('ok') and result.get('inserted'):
            success_count += 1
        else:
            fail_count += 1
        
        time.sleep(delay_between)
    
    return {
        'ok': fail_count == 0,
        'results': results,
        'summary': {
            'total': len(fields),
            'success': success_count,
            'failed': fail_count,
        }
    }
