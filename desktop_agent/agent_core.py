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
LABEL_STOPWORDS    = frozenset({
    'comment', 'comments', 'analysis', 'description', 'desc', 'narrative',
})

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
_surface_cache: dict = {}


def _load_json_file(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        log.error(f"JSON error {path}: {e}")
        return {}
    except Exception as e:
        log.warning(f"Could not load JSON {path}: {e}")
        return {}


def load_surface_profile(form_type: str) -> dict:
    if form_type in _surface_cache:
        return _surface_cache[form_type]
    path = os.path.join(FIELD_MAPS_DIR, f'{form_type}_surface.json')
    raw = _load_json_file(path)
    profile = {k: v for k, v in raw.items() if not k.startswith('_')}
    _surface_cache[form_type] = profile
    if profile:
        log.info(f"Surface profile: {path} ({len(profile)} fields)")
    return profile

def load_field_map(form_type: str) -> dict:
    if form_type in _map_cache:
        return _map_cache[form_type]
    path = os.path.join(FIELD_MAPS_DIR, f'{form_type}.json')
    raw = _load_json_file(path)
    if not raw:
        log.warning(f"Field map not found: {path}")
        return {}
    fm = {k: v for k, v in raw.items() if not k.startswith('_')}
    surface = load_surface_profile(form_type)
    if surface:
        for field_id, cfg in fm.items():
            hints = surface.get(field_id)
            if not hints:
                continue
            merged = dict(cfg)
            for key in (
                'visual_tab_label', 'visual_tab_ratio', 'page_cluster',
                'pdf_anchor_text', 'adjacent_anchor_text', 'content_kind',
                'expected_elements', 'report_click_ratio',
                'report_clicks', 'report_click_delay_ms',
            ):
                if key in hints:
                    merged[key] = hints[key]
            fm[field_id] = merged
    _map_cache[form_type] = fm
    log.info(f"Field map: {path} ({len(fm)} fields)")
    return fm

def reload_field_maps():
    _map_cache.clear()
    _surface_cache.clear()
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

def _find_aci_window_handle():
    """Find the live ACI top-level window handle using Win32 enumeration."""
    if not WIN32_AVAILABLE:
        return None

    matches = []

    def _enum(hwnd, _extra):
        try:
            title = win32gui.GetWindowText(hwnd) or ''
            cls = win32gui.GetClassName(hwnd) or ''
            if not win32gui.IsWindowVisible(hwnd):
                return
            title_upper = title.upper()
            cls_upper = cls.upper()
            if 'REPORT32MAIN' in cls_upper or 'ACI REPORT' in title_upper or '\\ACI32\\REPORTS\\' in title_upper:
                matches.append(hwnd)
        except Exception:
            return

    try:
        win32gui.EnumWindows(_enum, None)
    except Exception as e:
        log.debug(f'EnumWindows failed: {e}')
        return None

    return matches[0] if matches else None

def connect_win32():
    if not PYWINAUTO_AVAILABLE:
        return None
    hwnd = _find_aci_window_handle()
    if hwnd:
        try:
            return Application(backend='win32').connect(handle=hwnd, timeout=5)
        except Exception as e:
            log.debug(f"win32 handle connect failed: {e}")
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
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.3)
    except Exception as e:
        log.debug(f"SetForegroundWindow: {e}")

def window_signature(win32_win) -> str:
    try:
        return win32_win.window_text() or 'unknown'
    except Exception:
        return 'unknown'

# ── Label matching ────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    return re.sub(r'[\s\-_/\.]+', ' ', (text or '').lower()).strip()


def _label_words(text: str, *, drop_stopwords: bool = True) -> list[str]:
    words = [w for w in normalize(text).split() if len(w) > 2]
    if not drop_stopwords:
        return words
    filtered = [w for w in words if w not in LABEL_STOPWORDS]
    return filtered or words

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
    t_words = _label_words(t)
    c_words = set(_label_words(c)) or set(_label_words(c, drop_stopwords=False))
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

    content_label_ctrl = None
    content_label_score = 0
    content_label_method = 'none'
    for c_entry in content:
        ctext = (c_entry.get('text') or '').strip()
        if not ctext:
            continue
        first_line = ctext.splitlines()[0].strip()
        best_line_score = 0
        best_line_label = ''
        for lbl in all_labels:
            s = score_label(first_line, lbl)
            if s > best_line_score:
                best_line_score = s
                best_line_label = lbl
        if best_line_score > content_label_score:
            content_label_ctrl = c_entry['ctrl']
            content_label_score = best_line_score
            content_label_method = f'content_label:{best_line_label[:30]}'

    if content_label_score >= 60:
        log.info("  TX32 content-label fallback: "
                 f"score={content_label_score} via={content_label_method}")
        return content_label_ctrl, content_label_score, content_label_method

    titled_sections = [t for t in titles if (t.get('text') or '').strip()]
    if titled_sections and len(content) > 1:
        log.warning("  TX32 ambiguous view: visible titled sections exist but no "
                    f"reliable match for '{label}'")
        return None, best_score, 'ambiguous_visible_sections'

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


def find_tx32_by_rect(win32_win, rect: dict | None, tolerance: int = 24):
    """Find a content TX32 whose rectangle closely matches the provided rect."""
    if not rect:
        return None
    try:
        left = int(rect.get('left'))
        top = int(rect.get('top'))
        width = int(rect.get('width'))
        height = int(rect.get('height'))
    except Exception:
        return None

    disc = discover_tx32(win32_win)
    best = None
    best_delta = None
    for entry in disc['content_controls']:
        try:
            r = entry['rect']
            delta = (
                abs(r.left - left)
                + abs(r.top - top)
                + abs((r.right - r.left) - width)
                + abs((r.bottom - r.top) - height)
            )
            if delta <= tolerance * 4 and (best_delta is None or delta < best_delta):
                best = entry['ctrl']
                best_delta = delta
        except Exception:
            continue
    return best


def activate_report_field_anchor(win32_win, field_cfg: dict | None) -> bool:
    if not field_cfg:
        return False
    ratio = field_cfg.get('report_click_ratio')
    if not isinstance(ratio, (list, tuple)) or len(ratio) != 2:
        return False
    try:
        x_ratio = float(ratio[0])
        y_ratio = float(ratio[1])
    except Exception:
        return False

    try:
        form = win32_win.child_window(class_name='ACIFormView')
        r = form.rectangle()
        ctrl_w = r.right - r.left
        ctrl_h = r.bottom - r.top
        if ctrl_w <= 0 or ctrl_h <= 0:
            return False
        click_x = int(ctrl_w * max(0.02, min(0.98, x_ratio)))
        click_y = int(ctrl_h * max(0.02, min(0.98, y_ratio)))
        click_count = max(1, int(field_cfg.get('report_clicks', 1)))
        delay_ms = max(100, int(field_cfg.get('report_click_delay_ms', 700)))
        bring_to_foreground(win32_win)
        time.sleep(0.2)
        for _ in range(click_count):
            form.click_input(coords=(click_x, click_y))
            time.sleep(delay_ms / 1000.0)
        log.info("  Report anchor click "
                 f"({click_x},{click_y}) via {field_cfg.get('label', 'unknown')}")
        return True
    except Exception as e:
        log.debug(f"  Report anchor click failed: {e}")
        return False


def locate_field_tx32(win32_win, field_cfg: dict, form_type: str = '1004'):
    label = field_cfg.get('label', '')
    aliases = field_cfg.get('aliases', [])
    ctrl, score, method = find_tx32_by_label(win32_win, label, aliases)
    if ctrl is not None:
        return ctrl, score, method

    if not activate_report_field_anchor(win32_win, field_cfg):
        return None, score, method

    retry_ctrl, retry_score, retry_method = find_tx32_by_label(win32_win, label, aliases)
    if retry_ctrl is not None:
        return retry_ctrl, retry_score, f'report_anchor:{retry_method}'
    return None, retry_score, f'report_anchor:{retry_method}'

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
    # Live 1004 addendum strip order observed in ACI test session:
    # Subject, Contract, Neighborhood, Site, Improvements, Sales,
    # Reconciliation, Additional, Cost, Income, PUD, ...
    '1004':  ['Subj', 'Contr', 'Neig', 'Site', 'Impro', 'Sales',
              'Reco', 'Additi', 'Cost', 'Income', 'PUD'],
    '1025':  ['Neig', 'Site', 'Impro', 'Income', 'Sales', 'Reco', 'Cost', 'Addend'],
    '1073':  ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
    '1004c': ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
    'default': ['Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Cost', 'Income', 'Addend'],
}

_SIDEBAR_ENTRY_BY_FORM = {
    '1004': {
        'entry_name': '1004_05UAD',
        'index': 4,
        'x_ratio': 0.45,
        'first_y_ratio': 0.04,
        'step_y_ratio': 0.075,
    },
}


def get_pane_title(win32_win) -> str:
    try:
        return (win32_win.child_window(class_name='ACIPaneTitle').window_text() or '').strip()
    except Exception:
        return ''


def _click_sidebar_entry(win32_win, entry: dict) -> bool:
    try:
        sidebar = win32_win.child_window(class_name='ACIRpdCompView')
        r = sidebar.rectangle()
        ctrl_w = r.right - r.left
        ctrl_h = r.bottom - r.top
        if ctrl_w <= 0 or ctrl_h <= 0:
            return False
        x_ratio = float(entry.get('x_ratio', 0.45))
        first_y_ratio = float(entry.get('first_y_ratio', 0.04))
        step_y_ratio = float(entry.get('step_y_ratio', 0.075))
        index = int(entry.get('index', 0))
        click_x = int(ctrl_w * x_ratio)
        click_y = int(ctrl_h * (first_y_ratio + index * step_y_ratio))
        if click_y < 2 or click_y >= ctrl_h:
            return False
        bring_to_foreground(win32_win)
        time.sleep(0.2)
        sidebar.click_input(coords=(click_x, click_y))
        time.sleep(0.9)
        return True
    except Exception as e:
        log.debug(f"  Sidebar click failed: {e}")
        return False


def ensure_form_sidebar_surface(win32_win, form_type: str,
                                field_cfg: dict | None = None) -> bool:
    form_key = (form_type or '').lower()
    entry = _SIDEBAR_ENTRY_BY_FORM.get(form_key)
    if not entry:
        return False

    target_title = (field_cfg or {}).get('sidebar_entry_name') or entry.get('entry_name')
    current_title = get_pane_title(win32_win)
    if current_title == target_title:
        return True

    if not _click_sidebar_entry(win32_win, entry):
        return False

    new_title = get_pane_title(win32_win)
    if new_title == target_title:
        log.info(f"  Sidebar surface activated: {target_title}")
        return True

    log.warning(f"  Sidebar activation landed on '{new_title or 'unknown'}' "
                f"instead of '{target_title}'")
    return False


def _click_section_tabs_ratio(win32_win, ratio: float, reason: str) -> bool:
    try:
        bring_to_foreground(win32_win)
        time.sleep(0.2)
        tabs_ctrl = win32_win.child_window(class_name='ACISectionTabs')
        r = tabs_ctrl.rectangle()
        ctrl_w = r.right - r.left
        ctrl_h = r.bottom - r.top
        if ctrl_w <= 0 or ctrl_h <= 0:
            return False
        ratio = max(0.02, min(0.98, float(ratio)))
        click_x = int(ctrl_w * ratio)
        click_y = int(ctrl_h / 2)
        tabs_ctrl.click_input(coords=(click_x, click_y))
        time.sleep(0.8)
        log.info(f"  Tab click via ratio {ratio:.3f} ({reason})")
        return True
    except Exception as e:
        log.debug(f"  Tab ratio click failed: {e}")
        return False


def _navigate_tab_by_position(win32_win, tab_name: str,
                               form_type: str = '1004',
                               field_cfg: dict | None = None) -> bool:
    """
    Click ACISectionTabs at the calculated X position for the target tab.

    ACI's section tabs are owner-drawn — there are no child windows for the
    individual tab buttons. The only way to click them programmatically is to
    calculate the X coordinate based on the known tab order and the control width.

    IMPORTANT: The window must be in the foreground before clicking.
    Returns True if the click was sent.
    """
    tl = tab_name.lower()
    ratio = field_cfg.get('visual_tab_ratio') if field_cfg else None
    if ratio is not None:
        label = field_cfg.get('visual_tab_label') or tab_name
        if _click_section_tabs_ratio(
            win32_win, ratio, f"surface:{label} form={form_type}"
        ):
            return True

    order = _TAB_ORDER.get(form_type, _TAB_ORDER['default'])
    tab_idx = None

    for i, t in enumerate(order):
        if tl in t.lower() or t.lower() in tl:
            tab_idx = i
            break

    if tab_idx is None:
        log.debug(f"  Tab '{tab_name}' not in known order for form {form_type}")
        return False

    try:
        # Bring window to foreground before clicking owner-drawn tabs
        bring_to_foreground(win32_win)
        time.sleep(0.2)

        tabs_ctrl = win32_win.child_window(class_name='ACISectionTabs')
        r         = tabs_ctrl.rectangle()
        ctrl_w    = r.right - r.left
        ctrl_h    = r.bottom - r.top
        n_tabs    = len(order)
        tab_w     = ctrl_w / n_tabs
        # Click at the center of the target tab
        click_x   = int(tab_idx * tab_w + tab_w / 2)
        click_y   = int(ctrl_h / 2)
        tabs_ctrl.click_input(coords=(click_x, click_y))
        # Give ACI time to redraw the section
        time.sleep(0.8)
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
                 field_cfg: dict | None = None) -> bool:
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

    # For 1004 narrative fields, the left-rail document surface is the real
    # working context. Returning to "main form" can land back on Title and
    # destroy the lower narrative strip entirely.
    if not ensure_form_sidebar_surface(win32_win, form_type, field_cfg):
        # Legacy fallback for forms without a sidebar strategy yet.
        navigate_to_main_form(win32_win)

    # 1. Measured owner-drawn ratio click
    if field_cfg and field_cfg.get('visual_tab_ratio') is not None:
        if _navigate_tab_by_position(win32_win, tab_name, form_type, field_cfg):
            return True

    # 2. ACISectionTabs child windows (text-based)
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

    # 3. Button controls (text-based)
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

    # 4. Any descendant with matching text (filtered)
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

    # 5. Position-based click on ACISectionTabs (equal-width fallback)
    if _navigate_tab_by_position(win32_win, tab_name, form_type, field_cfg):
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

def _ins_tx32(field_cfg: dict, text: str, form_type: str = '1004') -> tuple:
    """
    Primary ACI strategy: TX32 clipboard insert with label-proximity targeting.
    Returns: (success, method_str, tx32_ctrl | None, diagnostics_dict)
    """
    if not (PYPERCLIP_AVAILABLE and PYWINAUTO_AVAILABLE):
        return False, 'tx32_unavailable', None, {}

    diag = {}
    try:
        app32 = connect_win32()
        if not app32:
            return False, 'tx32_no_win32', None, {}

        win = app32.top_window()
        bring_to_foreground(win)

        tab = (field_cfg.get('tab_name') or '').strip()
        if tab:
            nav_ok = navigate_tab(win, tab, form_type, field_cfg)
            diag['tab_name']      = tab
            diag['tab_navigated'] = nav_ok
            if nav_ok:
                time.sleep(0.5)

        label = field_cfg.get('label', '')
        ctrl, score, method = locate_field_tx32(win, field_cfg, form_type)

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
        diag = diag if isinstance(diag, dict) else {}
        diag['error'] = str(e)[:200]
        return False, 'tx32_exception', None, diag


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
        ok, meth, tx32c, diag = _ins_tx32(field_cfg, text, form_type)
        last_diag = diag
        if ok:
            return {'success': True, 'method': f'learned:{meth}',
                    'attempts': ['learned:ok'], 'tx32_ctrl': tx32c,
                    'diagnostics': diag}
        attempts.append('learned:failed')

    # 1. TX32 label-proximity
    ok, meth, tx32c, diag = _ins_tx32(field_cfg, text, form_type)
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
