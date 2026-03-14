"""
desktop_agent/agent_core.py
----------------------------
CACC Writer — ACI Agent Core Logic (Phase 2)

All non-Flask logic: discovery, targeting, insertion, verification,
learned targets, tab navigation. Imported by agent.py (Flask server).
"""

import json
import os
import re
import time
import logging
from datetime import datetime

# ── Optional imports ──────────────────────────────────────────────────────────

try:
    import pyperclip
    PYPERCLIP_AVAILABLE = True
except ImportError:
    PYPERCLIP_AVAILABLE = False

try:
    from pywinauto import Application, Desktop
    from pywinauto.keyboard import send_keys
    PYWINAUTO_AVAILABLE = True
except ImportError:
    PYWINAUTO_AVAILABLE = False

try:
    import win32gui
    import win32con
    import win32process
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

try:
    from PIL import ImageGrab
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ── Paths ─────────────────────────────────────────────────────────────────────

AGENT_DIR            = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE          = os.path.join(AGENT_DIR, 'config.json')
FIELD_MAPS_DIR       = os.path.join(AGENT_DIR, 'field_maps')
SCREENSHOTS_DIR      = os.path.join(AGENT_DIR, 'screenshots')
LEARNED_TARGETS_FILE = os.path.join(AGENT_DIR, 'learned_targets.json')

# ── Config ────────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

_cfg = _load_config()

ACI_WINDOW_PATTERN = _cfg.get('aci_window_pattern', '.*ACI.*')
INSERT_DELAY_MS    = int(_cfg.get('insert_delay_ms', 200))
MAX_RETRIES        = int(_cfg.get('max_retries', 3))
VERIFY_INSERTION   = bool(_cfg.get('verify_insertion', True))
SCREENSHOT_ON_FAIL = bool(_cfg.get('screenshot_on_failure', True))
AGENT_PORT         = int(_cfg.get('agent_port', 5180))

# TX32 geometry thresholds
TX32_CONTENT_MIN_H = 120
TX32_TITLE_MAX_H   = 70
TX32_MIN_W         = 80

log = logging.getLogger('cacc_agent')

# ── Screenshot ────────────────────────────────────────────────────────────────

def capture_screenshot(label: str) -> str | None:
    if not PIL_AVAILABLE or not SCREENSHOT_ON_FAIL:
        return None
    try:
        os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
        ts   = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe = re.sub(r'[^a-zA-Z0-9_]', '_', label)[:40]
        path = os.path.join(SCREENSHOTS_DIR, f'{safe}_{ts}.png')
        ImageGrab.grab().save(path)
        log.info(f"Screenshot: {path}")
        return path
    except Exception as e:
        log.warning(f"Screenshot failed: {e}")
        return None

# ── Field map loader ──────────────────────────────────────────────────────────

_map_cache: dict = {}


def _load_optional_field_map(path: str) -> dict:
    try:
        with open(path) as f:
            raw = json.load(f)
        return {k: v for k, v in raw.items() if not k.startswith('_')}
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        log.error(f"Field map JSON error {path}: {e}")
        return {}


def load_field_map(form_type: str) -> dict:
    if form_type in _map_cache:
        return _map_cache[form_type]
    path = os.path.join(FIELD_MAPS_DIR, f'{form_type}.json')
    try:
        with open(path) as f:
            raw = json.load(f)
        fm = {k: v for k, v in raw.items() if not k.startswith('_')}
        surface_path = os.path.join(FIELD_MAPS_DIR, f'{form_type}_surface.json')
        surface_map = _load_optional_field_map(surface_path)
        if surface_map:
            for field_id, profile in surface_map.items():
                base = fm.get(field_id, {})
                if isinstance(base, dict):
                    merged = dict(profile)
                    merged.update(base)
                    fm[field_id] = merged
                else:
                    fm[field_id] = profile
            log.info(f"Field surface map: {surface_path} ({len(surface_map)} fields)")
        _map_cache[form_type] = fm
        log.info(f"Field map: {path} ({len(fm)} fields)")
        return fm
    except FileNotFoundError:
        log.warning(f"Field map not found: {path}")
        return {}
    except json.JSONDecodeError as e:
        log.error(f"Field map JSON error {path}: {e}")
        return {}

def reload_field_maps():
    _map_cache.clear()
    log.info("Field map cache cleared.")

# ── Learned targets ───────────────────────────────────────────────────────────

_learned: dict | None = None

def load_learned() -> dict:
    global _learned
    if _learned is not None:
        return _learned
    try:
        with open(LEARNED_TARGETS_FILE) as f:
            _learned = json.load(f)
        log.info(f"Learned targets: {len(_learned)} entries")
    except FileNotFoundError:
        _learned = {}
    except Exception as e:
        log.warning(f"Could not load learned targets: {e}")
        _learned = {}
    return _learned

def save_learned(form_type: str, field_id: str, data: dict) -> None:
    global _learned
    if not data.get('verified', False):
        log.info(f"Learned target skipped for {form_type}::{field_id} "
                 f"(verification did not pass)")
        return
    targets  = load_learned()
    key      = f'{form_type}::{field_id}'
    existing = targets.get(key, {})
    targets[key] = {
        'formType':         form_type,
        'fieldId':          field_id,
        'label':            data.get('label', ''),
        'tabName':          data.get('tabName', ''),
        'strategy':         data.get('strategy', ''),
        'tx32_rect':        data.get('tx32_rect'),
        'label_matched':    data.get('label_matched', ''),
        'window_signature': data.get('window_signature', ''),
        'success_count':    existing.get('success_count', 0) + 1,
        'last_success':     datetime.now().isoformat(),
        'verified':         data.get('verified', False),
    }
    _learned = targets
    try:
        with open(LEARNED_TARGETS_FILE, 'w') as f:
            json.dump(targets, f, indent=2)
        log.info(f"Learned: {key} (n={targets[key]['success_count']})")
    except Exception as e:
        log.warning(f"Could not save learned target: {e}")

def get_learned(form_type: str, field_id: str) -> dict | None:
    return load_learned().get(f'{form_type}::{field_id}')

# ── ACI connection ────────────────────────────────────────────────────────────

def connect_uia():
    if not PYWINAUTO_AVAILABLE:
        return None
    try:
        return Application(backend='uia').connect(
            title_re=ACI_WINDOW_PATTERN, timeout=5)
    except Exception as e:
        log.error(f"UIA connect failed: {e}")
        return None

def connect_win32():
    if not PYWINAUTO_AVAILABLE:
        return None
    try:
        return Application(backend='win32').connect(
            title_re=ACI_WINDOW_PATTERN, timeout=5)
    except Exception as e:
        log.debug(f"win32 connect failed: {e}")
        return None

def bring_to_foreground(win32_win) -> None:
    if not WIN32_AVAILABLE:
        return
    try:
        hwnd = win32_win.handle
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        fg_hwnd = win32gui.GetForegroundWindow()
        if fg_hwnd and fg_hwnd != hwnd:
            try:
                current_tid = win32process.GetWindowThreadProcessId(fg_hwnd)[0]
                target_tid = win32process.GetWindowThreadProcessId(hwnd)[0]
                if current_tid and target_tid and current_tid != target_tid:
                    win32process.AttachThreadInput(current_tid, target_tid, True)
                    try:
                        win32gui.BringWindowToTop(hwnd)
                        win32gui.SetForegroundWindow(hwnd)
                    finally:
                        win32process.AttachThreadInput(current_tid, target_tid, False)
            except Exception:
                pass
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.3)
    except Exception as e:
        log.debug(f"SetForegroundWindow: {e}")


def get_foreground_window_info() -> dict:
    if not WIN32_AVAILABLE:
        return {'hwnd': None, 'title': '', 'class_name': ''}
    try:
        hwnd = win32gui.GetForegroundWindow()
        return {
            'hwnd': hwnd,
            'title': win32gui.GetWindowText(hwnd) or '',
            'class_name': win32gui.GetClassName(hwnd) or '',
        }
    except Exception:
        return {'hwnd': None, 'title': '', 'class_name': ''}


def is_foreground_window(win32_win) -> bool:
    try:
        return get_foreground_window_info().get('hwnd') == win32_win.handle
    except Exception:
        return False

def window_signature(win32_win) -> str:
    try:
        return win32_win.window_text() or 'unknown'
    except Exception:
        return 'unknown'

# ── Label matching ────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    return re.sub(r'[\s\-_/\.]+', ' ', (text or '').lower()).strip()

def score_label(candidate: str, target: str) -> int:
    """Score label match 0–100."""
    if not candidate or not target:
        return 0
    c = normalize(candidate)
    t = normalize(target)
    if c == t:
        return 100
    if t in c or c in t:
        return 80
    t_words = [w for w in t.split() if len(w) > 3]
    c_words  = set(c.split())
    if t_words and all(w in c_words for w in t_words):
        return 60
    overlap = sum(1 for w in t_words if w in c_words)
    return (30 + overlap * 10) if overlap else 0

# ── TX32 discovery ────────────────────────────────────────────────────────────

def _is_tx32_visible(ctrl) -> bool:
    """
    Check if a TX32 control is actually visible on screen.

    ACI keeps multiple overlapping views in the hierarchy (ACIFormView,
    ACIFullAddendumView, ACIAddendumView). Only one is visible at a time.
    We must filter out hidden controls to avoid targeting the wrong view.

    Uses win32gui WS_VISIBLE style check as the most reliable method.
    Falls back to pywinauto is_visible() if win32gui is unavailable.
    """
    if WIN32_AVAILABLE:
        try:
            import win32gui as _w32
            import win32con as _w32c
            hwnd  = ctrl.handle
            style = _w32.GetWindowLong(hwnd, _w32c.GWL_STYLE)
            return bool(style & _w32c.WS_VISIBLE)
        except Exception:
            pass
    try:
        return ctrl.is_visible()
    except Exception:
        return True  # assume visible if we can't check


def discover_tx32(win32_win) -> dict:
    """
    Discover all VISIBLE TX32 controls using descendants() — Phase 2 core fix.

    ACI uses TX32 (TX Text Control) for ALL narrative fields.
    These controls are nested deep in the window hierarchy.
    children() only finds direct children — completely misses TX32.
    descendants() walks the full tree and finds them correctly.

    IMPORTANT: ACI keeps multiple overlapping views in the hierarchy
    (ACIFormView, ACIFullAddendumView, ACIAddendumView). Only one is
    visible at a time. We filter by WS_VISIBLE to avoid targeting
    controls in hidden views.

    Phase 2 fix: each entry now includes parent_cls so that
    find_tx32_by_label can prefer ACIFullAddendumView controls
    (the primary editor for the active section) over ACIAddendumView
    controls (individual section list items).
    """
    title_ctrls   = []
    content_ctrls = []
    all_tx32      = []

    try:
        raw = win32_win.descendants(class_name='TX32')
    except Exception as e:
        log.debug(f"descendants(TX32) failed: {e}")
        return {'title_controls': [], 'content_controls': [],
                'all_tx32': [], 'label_texts': []}

    for ctrl in raw:
        try:
            r = ctrl.rectangle()
            h = r.bottom - r.top
            w = r.right  - r.left
            if w < TX32_MIN_W:
                continue
            # Skip controls in hidden views (addendum vs form view overlap)
            if not _is_tx32_visible(ctrl):
                log.debug(f"  TX32 skip hidden: h={h} w={w}")
                continue
            text = ''
            try:
                text = (ctrl.window_text() or '').strip()[:120]
            except Exception:
                pass
            # Tag with parent class — used by find_tx32_by_label to prefer
            # ACIFullAddendumView (primary editor) over ACIAddendumView (list items)
            parent_cls = ''
            try:
                parent_cls = (ctrl.parent().class_name() or '').strip()
            except Exception:
                pass
            entry = {'ctrl': ctrl, 'rect': r,
                     'left': r.left, 'top': r.top,
                     'width': w, 'height': h, 'text': text,
                     'parent_cls': parent_cls}
            all_tx32.append(entry)
            if h <= TX32_TITLE_MAX_H:
                title_ctrls.append(entry)
            elif h >= TX32_CONTENT_MIN_H:
                content_ctrls.append(entry)
        except Exception:
            continue

    label_texts = [e['text'] for e in title_ctrls if e['text']]
    log.debug(f"TX32: {len(all_tx32)} total (visible), {len(title_ctrls)} title, "
              f"{len(content_ctrls)} content")
    return {
        'title_controls':   title_ctrls,
        'content_controls': content_ctrls,
        'all_tx32':         all_tx32,
        'label_texts':      label_texts,
    }

def find_tx32_by_label(win32_win, label: str,
                       aliases: list = None) -> tuple:
    """
    Find the TX32 content control nearest to the target label text.

    Phase 2 targeting priority:
      1. Label-proximity scoring (title strip above content area)
      2. ACIFullAddendumView preference — when no label match, prefer the
         ACIFullAddendumView TX32 over ACIAddendumView TX32 controls.
         ACIFullAddendumView is the primary editor for the currently active
         section. ACIAddendumView controls are individual section list items.
      3. Largest content fallback (last resort, score=25)

    Returns: (ctrl | None, score 0–120, method_str)
    """
    all_labels = [label] + (aliases or [])
    disc       = discover_tx32(win32_win)
    content    = disc['content_controls']
    titles     = disc['title_controls']

    if not content:
        return None, 0, 'no_content_tx32'
    if len(content) == 1:
        return content[0]['ctrl'], 75, 'single_content_tx32'

    best_ctrl, best_score, best_method = None, 0, 'none'

    for c_entry in content:
        cr    = c_entry['rect']
        score = 0
        meth  = 'geometry'

        for t_entry in titles:
            tr   = t_entry['rect']
            ttxt = t_entry['text']
            lm, matched = 0, ''
            for lbl in all_labels:
                s = score_label(ttxt, lbl)
                if s > lm:
                    lm, matched = s, lbl
            if lm == 0:
                continue
            if tr.bottom > cr.top + 80:
                continue
            h_overlap = max(0, min(tr.right, cr.right) - max(tr.left, cr.left))
            if h_overlap / max(c_entry['width'], 1) < 0.15:
                continue
            v_dist  = max(0, cr.top - tr.bottom)
            v_bonus = max(0, 20 - int(v_dist / 10))
            s_total = lm + v_bonus
            if s_total > score:
                score = s_total
                meth  = f'label_proximity:{matched[:30]}'

        if score > best_score:
            best_score, best_ctrl, best_method = score, c_entry['ctrl'], meth

    # If label-proximity found a good match (score >= 50), use it
    if best_score >= 50:
        log.info(f"  TX32 label-proximity: score={best_score} via={best_method}")
        return best_ctrl, best_score, best_method

    # No strong label match — prefer ACIFullAddendumView (primary editor)
    # over ACIAddendumView (section list items)
    full_addendum = [c for c in content
                     if c.get('parent_cls') == 'ACIFullAddendumView']
    if full_addendum:
        # Pick the tallest (largest) ACIFullAddendumView control
        best_fa = max(full_addendum, key=lambda c: c['height'])
        log.info(f"  TX32 ACIFullAddendumView fallback: h={best_fa['height']}")
        return best_fa['ctrl'], 40, 'aci_full_addendum_view'

    # Last resort: largest content control by area
    largest = max(content, key=lambda c: c['width'] * c['height'])
    log.info(f"  TX32 largest-content fallback: "
             f"h={largest['height']} w={largest['width']}")
    return largest['ctrl'], 25, 'largest_content_fallback'


def read_tx32(ctrl) -> str:
    """Read text from a TX32 control."""
    try:
        t = ctrl.window_text() or ''
        if t:
            return t
    except Exception:
        pass
    try:
        return ' '.join(t for t in ctrl.texts() if t).strip()
    except Exception:
        return ''

# ── Tab navigation ────────────────────────────────────────────────────────────

_SKIP_CLS = frozenset({'TX32', 'ACIPaneTitle', 'Edit',
                       'RichEdit20W', 'RICHEDIT50W', 'Static'})

# ── ACI tab order maps ────────────────────────────────────────────────────────
# ACI section tabs are owner-drawn — no child windows exist for the buttons.
# Navigation must be done by clicking at calculated X positions within
# the ACISectionTabs control.
#
# Tab order confirmed from live ACI 1004 session (cacc-writer-test.aci).
# Each entry is the prefix used in field_map tab_name values.
# TODO Phase 3: discover tab order dynamically from ACIPaneTitle changes.

_TAB_ORDER = {
    '1004':  ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
    '1025':  ['Neig', 'Site', 'Impro', 'Income', 'Sales', 'Reco', 'Cost', 'Addend'],
    '1073':  ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
    '1004c': ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
    'default': ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
}


def _navigate_tab_by_position(win32_win, tab_name: str,
                               form_type: str = '1004',
                               tab_ratio: float | None = None) -> bool:
    """
    Click ACISectionTabs at the calculated X position for the target tab.

    ACI's section tabs are owner-drawn — there are no child windows for the
    individual tab buttons. The only way to click them programmatically is to
    calculate the X coordinate based on the known tab order and the control width.

    IMPORTANT: The window must be in the foreground before clicking.
    Returns True if the click was sent.
    """
    tl       = tab_name.lower()
    order    = _TAB_ORDER.get(form_type, _TAB_ORDER['default'])
    tab_idx  = None

    for i, t in enumerate(order):
        if tl in t.lower() or t.lower() in tl:
            tab_idx = i
            break

    if tab_ratio is None and tab_idx is None:
        log.debug(f"  Tab '{tab_name}' not in known order for form {form_type}")
        return False

    try:
        # Bring window to foreground before clicking owner-drawn tabs
        bring_to_foreground(win32_win)
        time.sleep(0.2)
        if not is_foreground_window(win32_win):
            fg = get_foreground_window_info()
            log.warning(f"  Cannot click tab '{tab_name}': ACI is not foreground "
                        f"(foreground='{fg.get('title','')[:80]}')")
            return False

        tabs_ctrl = win32_win.child_window(class_name='ACISectionTabs')
        r         = tabs_ctrl.rectangle()
        ctrl_w    = r.right - r.left
        ctrl_h    = r.bottom - r.top
        if tab_ratio is not None:
            click_x = int(ctrl_w * max(0.0, min(1.0, tab_ratio)))
            tab_w = None
        else:
            n_tabs    = len(order)
            tab_w     = ctrl_w / n_tabs
            click_x   = int(tab_idx * tab_w + tab_w / 2)
        click_y   = int(ctrl_h / 2)
        tabs_ctrl.click_input(coords=(click_x, click_y))
        # Give ACI time to redraw the section
        time.sleep(0.8)
        if tab_ratio is not None:
            log.info(f"  Tab '{tab_name}' via measured ratio click "
                     f"(ratio={tab_ratio:.3f} x={click_x} ctrl_w={ctrl_w} form={form_type})")
        else:
            log.info(f"  Tab '{tab_name}' via position click "
                     f"(idx={tab_idx} x={click_x} ctrl_w={ctrl_w} "
                     f"tab_w={tab_w:.0f} form={form_type})")
        return True
    except Exception as e:
        log.debug(f"  Tab position click failed: {e}")
        return False


def navigate_to_main_form(win32_win) -> bool:
    """
    If ACI is currently showing an addendum view, navigate back to the main form.

    ACI can show either:
      - Main form view (ACIFormView) — where section tabs apply
      - Addendum view (ACIFullAddendumView / ACIAddendumView) — separate overlay

    When the addendum view is active, clicking ACISectionTabs has no effect on
    the main form. We need to return to the main form first.

    Strategy: look for an ACIEditAddendumtButton or similar control and click
    the main form area, or use Escape key to dismiss the addendum view.
    """
    try:
        # Check if addendum view is active by looking for ACIFullAddendumView
        addendum = win32_win.child_window(class_name='ACIFullAddendumView')
        r = addendum.rectangle()
        if r.right - r.left > 0 and r.bottom - r.top > 0:
            log.info("  Addendum view detected — attempting to return to main form")
            # Try pressing Escape to dismiss addendum
            bring_to_foreground(win32_win)
            time.sleep(0.2)
            if not is_foreground_window(win32_win):
                fg = get_foreground_window_info()
                log.warning("  Cannot return to main form because ACI is not foreground "
                            f"(foreground='{fg.get('title','')[:80]}')")
                return False
            send_keys('{ESC}')
            time.sleep(0.5)
            # Try clicking the ACIFormView area directly
            try:
                form_view = win32_win.child_window(class_name='ACIFormView')
                fvr = form_view.rectangle()
                if fvr.right - fvr.left > 0:
                    form_view.click_input(coords=(
                        (fvr.right - fvr.left) // 2,
                        (fvr.bottom - fvr.top) // 2,
                    ))
                    time.sleep(0.5)
                    log.info("  Clicked ACIFormView to return to main form")
                    return True
            except Exception:
                pass
            return True
    except Exception:
        pass
    return False


def navigate_tab(win32_win, tab_name: str, form_type: str = '1004',
                 tab_ratio: float | None = None) -> bool:
    """
    Navigate to a section tab. Returns True if a click was sent.

    Strategy order:
      1. ACISectionTabs child windows (text-based) — works if tabs have window text
      2. Button descendants (text-based) — fallback for some ACI versions
      3. Any descendant with matching text — broad fallback
      4. Position-based click on ACISectionTabs — PRIMARY for owner-drawn tabs
         (ACI 1004/1025/1073 confirmed: tabs are owner-drawn, no child windows)
    """
    if not tab_name:
        return True
    tl = tab_name.lower()

    # 1. ACISectionTabs child windows (text-based)
    try:
        tabs = win32_win.child_window(class_name='ACISectionTabs')
        for child in tabs.children():
            txt = (child.window_text() or '').strip()
            if tl in txt.lower():
                child.click_input()
                time.sleep(0.5)
                log.info(f"  Tab '{txt}' via ACISectionTabs child text")
                return True
    except Exception:
        pass

    # 2. Button controls (text-based)
    try:
        for btn in win32_win.descendants(control_type='Button'):
            txt = (btn.window_text() or '').strip()
            if tl in txt.lower() and 0 < len(txt) < 35:
                btn.click_input()
                time.sleep(0.5)
                log.info(f"  Tab '{txt}' via Button")
                return True
    except Exception:
        pass

    # 3. Any descendant with matching text (filtered)
    try:
        for child in win32_win.descendants():
            try:
                txt = (child.window_text() or '').strip()
                cls = (child.class_name() or '').strip()
                if tl in txt.lower() and cls not in _SKIP_CLS and 0 < len(txt) < 40:
                    child.click_input()
                    time.sleep(0.5)
                    log.info(f"  Tab '{txt}' via descendant (cls={cls})")
                    return True
            except Exception:
                continue
    except Exception:
        pass

    # 4. Position-based click on ACISectionTabs (owner-drawn tabs — PRIMARY for ACI)
    # ACI confirmed: ACISectionTabs has no child windows for tab buttons.
    # Tabs are painted directly on the control surface.
    if _navigate_tab_by_position(win32_win, tab_name, form_type, tab_ratio):
        return True

    log.warning(f"  Tab '{tab_name}' not found by any strategy")
    return False

def get_current_tab(win32_win) -> str:
    try:
        tabs = win32_win.child_window(class_name='ACISectionTabs')
        for child in tabs.children():
            try:
                if child.is_active() or child.get_toggle_state():
                    return (child.window_text() or '').strip()
            except Exception:
                pass
        children = tabs.children()
        if children:
            return (children[0].window_text() or '').strip()
    except Exception:
        pass
    return 'unknown'

# ── Individual insertion strategies ──────────────────────────────────────────

def _ins_tx32(field_cfg: dict, text: str) -> tuple:
    """
    Primary ACI strategy: TX32 clipboard insert with label-proximity targeting.
    Returns: (success, method_str, tx32_ctrl | None, diagnostics_dict)
    """
    if not (PYPERCLIP_AVAILABLE and PYWINAUTO_AVAILABLE):
        return False, 'tx32_unavailable', None, {}

    diag = {}
    surface_keys = (
        'visual_tab_label',
        'page_cluster',
        'pdf_anchor_text',
        'adjacent_anchor_text',
        'content_kind',
        'expected_elements',
        'live_calibration_status',
    )
    surface_profile = {
        key: field_cfg.get(key)
        for key in surface_keys
        if field_cfg.get(key) not in (None, '', [])
    }
    if surface_profile:
        diag['surface_profile'] = surface_profile
    try:
        app32 = connect_win32()
        if not app32:
            return False, 'tx32_no_win32', None, {}

        win = app32.top_window()
        bring_to_foreground(win)
        if not is_foreground_window(win):
            fg = get_foreground_window_info()
            return False, 'tx32_not_foreground', None, {
                'aci_title': window_signature(win),
                'foreground_title': fg.get('title', ''),
                'foreground_class': fg.get('class_name', ''),
            }

        tab = (field_cfg.get('tab_name') or '').strip()
        tab_ratio = field_cfg.get('visual_tab_ratio')
        if tab:
            nav_ok = navigate_tab(win, tab, form_type, tab_ratio)
            diag['tab_name']      = tab
            diag['tab_ratio']     = tab_ratio
            diag['tab_navigated'] = nav_ok
            if nav_ok:
                time.sleep(0.5)

        label   = field_cfg.get('label', '')
        aliases = field_cfg.get('aliases', [])
        ctrl, score, method = find_tx32_by_label(win, label, aliases)

        diag['label_text']  = label
        diag['tx32_score']  = score
        diag['tx32_method'] = method

        if ctrl is None:
            return False, 'tx32_no_target', None, diag

        try:
            r = ctrl.rectangle()
            diag['tx32_rect'] = {
                'left': r.left, 'top': r.top,
                'width': r.right - r.left, 'height': r.bottom - r.top,
            }
            log.info(f"  TX32: left={r.left} top={r.top} "
                     f"h={r.bottom - r.top} score={score} via={method}")
        except Exception:
            pass

        pyperclip.copy(text)
        time.sleep(0.05)
        ctrl.click_input()
        time.sleep(0.3)
        send_keys('^a')
        time.sleep(0.1)
        send_keys('^v')
        time.sleep(0.25)

        log.info(f"  ✓ TX32 insert (score={score} via={method})")
        return True, f'tx32:{method}', ctrl, diag

    except Exception as e:
        log.debug(f"  TX32 failed: {e}")
        return False, 'tx32_exception', None, {'error': str(e)[:200]}


def _ins_automation_id(main_win, aid: str, text: str) -> bool:
    for ct in ('Edit', 'Document', 'Custom', None):
        try:
            kw = {'auto_id': aid}
            if ct:
                kw['control_type'] = ct
            ctrl = main_win.child_window(**kw)
            ctrl.set_focus()
            ctrl.select()
            ctrl.type_keys(text, with_spaces=True, pause=0.01)
            log.info(f"  ✓ automation_id='{aid}'")
            return True
        except Exception:
            pass
    return False


def _ins_class_index(main_win, cls: str, idx: int, text: str) -> bool:
    try:
        ctrls = main_win.children(class_name=cls)
        if not (0 <= idx < len(ctrls)):
            return False
        ctrl = ctrls[idx]
        ctrl.set_focus()
        ctrl.select()
        ctrl.type_keys(text, with_spaces=True, pause=0.01)
        log.info(f"  ✓ class_name='{cls}'[{idx}]")
        return True
    except Exception:
        return False


def _ins_control_index(main_win, idx: int, text: str) -> bool:
    try:
        inputs = []
        for ct in ('Edit', 'Document'):
            try:
                inputs.extend(main_win.children(control_type=ct))
            except Exception:
                pass
        for cls in ('RichEdit20W', 'RICHEDIT50W', 'RichEditD2DPT'):
            try:
                inputs.extend(main_win.children(class_name=cls))
            except Exception:
                pass
        if not (0 <= idx < len(inputs)):
            return False
        ctrl = inputs[idx]
        ctrl.set_focus()
        ctrl.select()
        ctrl.type_keys(text, with_spaces=True, pause=0.01)
        log.info(f"  ✓ control_index={idx}")
        return True
    except Exception:
        return False


def _ins_label_exact(main_win, label: str, text: str) -> bool:
    try:
        ctrl = main_win.child_window(title=label, control_type='Edit')
        ctrl.set_focus()
        ctrl.select()
        ctrl.type_keys(text, with_spaces=True, pause=0.01)
        log.info(f"  ✓ label_exact='{label}'")
        return True
    except Exception:
        return False


def _ins_label_partial(main_win, label: str, text: str) -> bool:
    try:
        ctrl = main_win.child_window(
            title_re=f'.*{re.escape(label)}.*', control_type='Edit')
        ctrl.set_focus()
        ctrl.select()
        ctrl.type_keys(text, with_spaces=True, pause=0.01)
        log.info(f"  ✓ label_partial='{label}'")
        return True
    except Exception:
        return False


def _ins_clipboard(app, label: str, text: str) -> bool:
    if not PYPERCLIP_AVAILABLE:
        return False
    try:
        pyperclip.copy(text)
        time.sleep(INSERT_DELAY_MS / 1000)
        main_win = app.top_window()
        try:
            main_win.child_window(
                title_re=f'.*{re.escape(label)}.*').set_focus()
            time.sleep(0.1)
        except Exception:
            pass
        send_keys('^a')
        time.sleep(0.05)
        send_keys('^v')
        time.sleep(INSERT_DELAY_MS / 1000)
        log.info(f"  ✓ clipboard paste for '{label}'")
        return True
    except Exception as e:
        log.error(f"  clipboard failed: {e}")
        return False

# ── Verification ──────────────────────────────────────────────────────────────

def verify_insertion(app, field_cfg: dict, expected: str,
                     tx32_ctrl=None) -> dict:
    """
    Verify insertion. Tries TX32 read-back first, then UIA fallbacks.
    Returns: { passed, method, actual_preview }
    """
    label  = field_cfg.get('label', 'unknown')
    aid    = field_cfg.get('automation_id') or ''
    check  = expected[:60].strip()

    def _check(actual: str, method: str) -> dict:
        an = normalize(actual[:200])
        cn = normalize(check)
        passed = (cn[:40] in an) if cn else False
        if passed:
            log.info(f"  ✓ Verified via {method} for '{label}'")
        else:
            log.warning(f"  ✗ Verify FAILED via {method} for '{label}'")
        return {'passed': passed, 'method': method, 'actual_preview': actual[:80]}

    # TX32 read-back (most reliable for ACI narrative fields)
    if tx32_ctrl is not None:
        try:
            actual = read_tx32(tx32_ctrl)
            if actual:
                return _check(actual, 'tx32_readback')
        except Exception:
            pass

    if not (PYWINAUTO_AVAILABLE and app):
        return {'passed': False, 'method': 'unavailable', 'actual_preview': ''}

    main_win = app.top_window()

    # UIA automation_id
    if aid:
        try:
            ctrl   = main_win.child_window(auto_id=aid, control_type='Edit')
            actual = ctrl.get_value() or ''
            return _check(actual, 'uia_automation_id')
        except Exception:
            pass

    # UIA label match
    try:
        ctrl   = main_win.child_window(
            title_re=f'.*{re.escape(label)}.*', control_type='Edit')
        actual = ctrl.get_value() or ''
        return _check(actual, 'uia_label_match')
    except Exception:
        pass

    log.warning(f"  Verify: no control found for '{label}'")
    return {'passed': False, 'method': 'no_control_found', 'actual_preview': ''}

# ── Main insertion engine ─────────────────────────────────────────────────────

def insert_field(app, field_cfg: dict, text: str,
                 form_type: str = '1004', field_id: str = '') -> dict:
    """
    Insert text using escalating strategy (learned-first).

    Order:
      0. Learned target  — reuse previously successful strategy
      1. TX32 label-proximity — primary ACI strategy (Phase 2)
      2. automation_id   — UIA AutomationId
      3. class_name      — RichEdit class + index
      4. control_index   — nth input control
      5. label_exact     — UIA title match
      6. label_partial   — UIA regex title match
      7. clipboard       — last resort

    Returns: { success, method, attempts, tx32_ctrl, diagnostics }
    """
    main_win      = app.top_window()
    label         = field_cfg.get('label', 'unknown')
    aid           = field_cfg.get('automation_id') or ''
    cls           = field_cfg.get('class_name') or ''
    cls_idx       = field_cfg.get('class_index')
    ctrl_idx      = field_cfg.get('control_index')
    attempts      = []
    last_diag     = {}

    log.info(f"  label='{label}' tab='{field_cfg.get('tab_name','')}' "
             f"aliases={field_cfg.get('aliases',[])}")

    # 0. Learned target
    learned = get_learned(form_type, field_id) if field_id else None
    if learned and not learned.get('verified'):
        log.info(f"  [0] Ignoring unverified learned target for {field_id}")
        learned = None
    if learned:
        log.info(f"  [0] Learned target (n={learned.get('success_count',0)} "
                 f"strategy={learned.get('strategy','')})")
        ok, meth, tx32c, diag = _ins_tx32(field_cfg, text)
        last_diag = diag
        if ok:
            return {'success': True, 'method': f'learned:{meth}',
                    'attempts': ['learned:ok'], 'tx32_ctrl': tx32c,
                    'diagnostics': diag}
        attempts.append('learned:failed')

    # 1. TX32 label-proximity
    ok, meth, tx32c, diag = _ins_tx32(field_cfg, text)
    last_diag = diag
    if ok:
        return {'success': True, 'method': meth,
                'attempts': attempts + [meth], 'tx32_ctrl': tx32c,
                'diagnostics': diag}
    attempts.append(f'tx32:{meth}:failed')

    # 2. automation_id
    if aid:
        if _ins_automation_id(main_win, aid, text):
            return {'success': True, 'method': 'automation_id',
                    'attempts': attempts + ['automation_id'],
                    'tx32_ctrl': None, 'diagnostics': {}}
        attempts.append('automation_id:failed')

    # 3. class_name + index
    if cls and cls_idx is not None and isinstance(cls_idx, int):
        if _ins_class_index(main_win, cls, cls_idx, text):
            return {'success': True, 'method': 'class_name',
                    'attempts': attempts + ['class_name'],
                    'tx32_ctrl': None, 'diagnostics': {}}
        attempts.append('class_name:failed')

    # 4. control_index
    if ctrl_idx is not None and isinstance(ctrl_idx, int):
        if _ins_control_index(main_win, ctrl_idx, text):
            return {'success': True, 'method': 'control_index',
                    'attempts': attempts + ['control_index'],
                    'tx32_ctrl': None, 'diagnostics': {}}
        attempts.append('control_index:failed')

    # 5. label_exact
    if _ins_label_exact(main_win, label, text):
        return {'success': True, 'method': 'label_exact',
                'attempts': attempts + ['label_exact'],
                'tx32_ctrl': None, 'diagnostics': {}}
    attempts.append('label_exact:failed')

    # 6. label_partial
    if _ins_label_partial(main_win, label, text):
        return {'success': True, 'method': 'label_partial',
                'attempts': attempts + ['label_partial'],
                'tx32_ctrl': None, 'diagnostics': {}}
    attempts.append('label_partial:failed')

    # 7. clipboard
    if _ins_clipboard(app, label, text):
        return {'success': True, 'method': 'clipboard',
                'attempts': attempts + ['clipboard'],
                'tx32_ctrl': None, 'diagnostics': {}}
    attempts.append('clipboard:failed')

    return {'success': False, 'method': 'none', 'attempts': attempts,
            'tx32_ctrl': None, 'diagnostics': last_diag}
