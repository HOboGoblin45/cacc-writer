"""
real_quantum_agent/agent.py
---------------------------
# =============================================================================
# LEGACY SYSTEM â€” DO NOT EXTEND
# =============================================================================
# This file is part of the original Appraisal Agent v1 ad-hoc agent architecture.
# It remains functional and is now wrapped as a deterministic TOOL by the new
# LangGraph workflow system (server/tools/realQuantumTool.ts).
#
# New automation logic belongs in:  server/tools/realQuantumTool.ts
# New workflow logic belongs in:    server/workflow/appraisalWorkflow.ts
#
# DO NOT add new endpoints or business logic here.
# DO NOT delete this file â€” the new realQuantumTool.ts calls this agent via HTTP.
# =============================================================================

Playwright-based web automation agent for Real Quantum commercial appraisal software.

Purpose:
    Receives generated narrative text from the Appraisal Agent Node.js server and
    inserts it into the correct section of a Real Quantum commercial report
    running in a Chrome/Edge browser window.

Architecture:
    - Runs as a lightweight Flask HTTP server on localhost:5181
    - Node.js server calls POST /insert with { fieldId, text, formType }
    - Agent attaches to an existing Chrome browser session (user stays logged in)
    - Navigates to the correct report section, finds the text area, inserts text
    - Returns { ok, inserted, method } to the Node.js server

Why Playwright (not pywinauto):
    Real Quantum is a web-based SaaS application running in a browser.
    pywinauto automates Win32 desktop controls â€” it cannot reliably target
    elements inside a browser's rendered DOM. Playwright communicates directly
    with the browser via Chrome DevTools Protocol (CDP), giving precise control
    over every DOM element.

Why attach to existing session (not launch new):
    Real Quantum requires authentication. Rather than automating login (fragile,
    breaks on 2FA), we attach to a Chrome instance the user already has open
    and authenticated. The user launches Chrome once with --remote-debugging-port=9222,
    logs into Real Quantum, and the agent reuses that session indefinitely.

Requirements:
    pip install flask playwright pyperclip
    playwright install chromium

How to run:
    1. Launch Chrome with remote debugging:
       chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session
    2. Log into Real Quantum in that Chrome window
    3. Open the commercial report you are working on
    4. python real_quantum_agent/agent.py

How to extend:
    - Update field selectors in field_maps/commercial.json as Real Quantum's
      UI evolves (no code changes needed â€” just update the JSON)
    - Add new section navigation strategies in navigate_to_section() for
      sections that require multi-step navigation (e.g., accordion panels)
    - Add screenshot capture on failure by calling page.screenshot() in the
      except blocks for debugging
"""

import json
import os
import re
import sys
import time
import logging
import asyncio
import threading
import pyperclip
from flask import Flask, request, jsonify

# â”€â”€ Conditional import of Playwright â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Playwright only works when installed. On systems without it, we run in stub
# mode so the server can still start and return meaningful errors.
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("[rq_agent] WARNING: playwright not installed. Run: pip install playwright && playwright install chromium")

# â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

AGENT_DIR        = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE      = os.path.join(AGENT_DIR, 'config.json')
FIELD_MAPS_DIR   = os.path.join(AGENT_DIR, 'field_maps')
SCREENSHOTS_DIR  = os.path.join(AGENT_DIR, 'screenshots')

def load_config():
    """Load agent configuration from config.json."""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[rq_agent] config.json not found at {CONFIG_FILE}. Using defaults.")
        return {}

config = load_config()

AGENT_PORT          = config.get('agent_port', 5181)
CDP_URL             = config.get('cdp_url', 'http://localhost:9222')
INSERT_DELAY_MS     = config.get('insert_delay_ms', 300)
MAX_RETRIES         = config.get('max_retries', 3)
VERIFY_INSERTION    = config.get('verify_insertion', True)
NAVIGATION_TIMEOUT  = config.get('navigation_timeout_ms', 10000)
RQ_BASE_URL         = config.get('rq_base_url', 'https://app.realquantum.com')
SCREENSHOT_ON_FAIL  = config.get('screenshot_on_failure', True)

# â”€â”€ Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

logging.basicConfig(
    level=logging.INFO,
    format='[rq_agent] %(asctime)s %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('rq_agent')

# â”€â”€ Field map loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_field_map_cache = {}

def reload_field_maps():
    """Clear the field map cache so maps are reloaded from disk on next use."""
    _field_map_cache.clear()
    log.info("Field map cache cleared.")

def load_field_map(form_type: str) -> dict:
    """
    Load the field map for a given form type.

    Field maps define how to navigate to and interact with each section
    in Real Quantum's web interface.

    Example entry in field_maps/commercial.json:
    {
      "site_description": {
        "label": "Site Description",
        "nav_selector": "a[data-section='site']",
        "input_selector": "textarea[name='site_description']",
        "input_type": "textarea",
        "clear_method": "select_all"
      }
    }
    """
    if form_type in _field_map_cache:
        return _field_map_cache[form_type]

    map_file = os.path.join(FIELD_MAPS_DIR, f'{form_type}.json')
    try:
        with open(map_file, 'r') as f:
            field_map = json.load(f)
            _field_map_cache[form_type] = field_map
            log.info(f"Loaded field map: {map_file} ({len(field_map)} fields)")
            return field_map
    except FileNotFoundError:
        log.warning(f"Field map not found: {map_file}")
        return {}
    except json.JSONDecodeError as e:
        log.error(f"Invalid JSON in field map {map_file}: {e}")
        return {}

# â”€â”€ Screenshot helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def capture_screenshot(page, label: str) -> str | None:
    """
    Capture a screenshot of the current browser page and save to screenshots/.
    Returns the file path, or None if capture failed.
    Called automatically on insertion failure for debugging.
    """
    if not SCREENSHOT_ON_FAIL or page is None:
        return None
    try:
        os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
        from datetime import datetime
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_label = label.replace(' ', '_').replace('/', '_')[:40]
        filepath = os.path.join(SCREENSHOTS_DIR, f'fail_{safe_label}_{ts}.png')
        page.screenshot(path=filepath, full_page=False)
        log.info(f"Screenshot saved: {filepath}")
        return filepath
    except Exception as e:
        log.warning(f"Screenshot capture failed: {e}")
        return None

# â”€â”€ Playwright browser connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# Global Playwright state â€” reused across requests for performance
_playwright_instance = None
_browser_instance    = None
_page_instance       = None
_last_connection_error = None

def reset_browser_connection():
    """Tear down cached Playwright browser state so a fresh CDP attach can be attempted."""
    global _playwright_instance, _browser_instance, _page_instance
    try:
        if _page_instance and not _page_instance.is_closed():
            _page_instance = None
    except Exception:
        _page_instance = None

    try:
        if _browser_instance:
            _browser_instance.close()
    except Exception:
        pass
    finally:
        _browser_instance = None

    try:
        if _playwright_instance:
            _playwright_instance.stop()
    except Exception:
        pass
    finally:
        _playwright_instance = None

def list_cdp_targets():
    """Return raw CDP targets for diagnostics without requiring a Playwright attach."""
    import urllib.request
    import urllib.error

    list_url = CDP_URL.rstrip('/') + '/json/list'
    try:
        with urllib.request.urlopen(list_url, timeout=3) as response:
            payload = json.loads(response.read().decode('utf-8'))
            if isinstance(payload, list):
                return payload
            return []
    except Exception:
        return []

def summarize_targets(targets):
    summaries = []
    for target in targets[:10]:
        summaries.append({
            'title': target.get('title', ''),
            'url': target.get('url', ''),
            'type': target.get('type', ''),
        })
    return summaries

def is_rq_target(url: str) -> bool:
    candidate = (url or '').lower()
    base = RQ_BASE_URL.lower().replace('https://', '').replace('http://', '')
    return 'realquantum' in candidate or 'realquantumapp' in candidate or base in candidate

def get_page():
    """
    Attach to the existing Chrome browser session via Chrome DevTools Protocol.

    The user must have launched Chrome with:
        chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session

    Returns:
        Playwright Page object pointing to the active Real Quantum tab,
        or None if connection fails.

    How to extend:
        - To support multiple tabs, iterate browser.contexts[0].pages and
          find the one whose URL contains 'realquantum.com'
        - To support Edge instead of Chrome, change the CDP URL port or
          launch Edge with --remote-debugging-port=9222
    """
    global _playwright_instance, _browser_instance, _page_instance, _last_connection_error

    if not PLAYWRIGHT_AVAILABLE:
        _last_connection_error = 'playwright not available'
        return None

    for attempt in range(2):
        try:
            if _page_instance and not _page_instance.is_closed():
                return _page_instance

            if _playwright_instance is None:
                _playwright_instance = sync_playwright().start()

            log.info(f"Connecting to Chrome at {CDP_URL} (attempt {attempt + 1})...")
            _browser_instance = _playwright_instance.chromium.connect_over_cdp(CDP_URL)

            contexts = _browser_instance.contexts
            if not contexts:
                _last_connection_error = 'No browser contexts found'
                log.error("No browser contexts found. Make sure Chrome is open with a Real Quantum report.")
                reset_browser_connection()
                continue

            rq_page = None
            for context in contexts:
                for page in context.pages:
                    url = page.url or ''
                    if is_rq_target(url):
                        rq_page = page
                        log.info(f"Found Real Quantum tab: {url}")
                        break
                if rq_page:
                    break

            if not rq_page:
                targets = list_cdp_targets()
                if targets:
                    _last_connection_error = (
                        'CDP is reachable, but no Real Quantum page target matched. '
                        f'Visible targets: {summarize_targets(targets)}'
                    )
                else:
                    _last_connection_error = 'CDP is reachable, but no browser page targets were returned'
                log.warning(_last_connection_error)
                reset_browser_connection()
                continue

            _page_instance = rq_page
            _last_connection_error = None
            return rq_page
        except Exception as e:
            _last_connection_error = str(e)
            log.error(f"Failed to connect to Chrome: {e}")
            log.info("Make sure Chrome is running with: --remote-debugging-port=9222")
            reset_browser_connection()

    return None

# â”€â”€ Section navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _navigate_to_url(page, slug: str) -> bool:
    """
    Navigate to a Real Quantum section by URL slug.

    Extracts the assignment UUID from the current page URL and constructs
    the target URL: {RQ_BASE_URL}/assignments/{uuid}/{slug}

    This is the most reliable navigation method for Real Quantum because:
    - It works regardless of sidebar state or scroll position
    - It avoids fragile CSS selector clicks on nav elements
    - It handles deep-linked sections directly

    Args:
        page: Playwright Page object
        slug: Section URL slug (e.g. 'reconciliation', 'highest_best_use')

    Returns:
        True if navigation succeeded, False otherwise.
    """
    current_url = page.url or ''

    # Extract assignment UUID from current URL
    if '/assignments/' not in current_url:
        log.warning(f"Cannot extract assignment UUID from URL: {current_url}")
        return False

    uuid = current_url.split('/assignments/')[1].split('/')[0]
    target_url = f"{RQ_BASE_URL}/assignments/{uuid}/{slug}"

    # Skip navigation if already on this section
    current_slug = current_url.rstrip('/').split('/')[-1].split('#')[0]
    if current_slug == slug:
        log.info(f"Already on section: {slug}")
        return True

    try:
        log.info(f"Navigating to section: {slug} â†’ {target_url}")
        page.goto(target_url, wait_until='domcontentloaded', timeout=NAVIGATION_TIMEOUT)
        # Wait for TinyMCE to initialize (editors load asynchronously after DOM)
        time.sleep(2.0)
        return True
    except PlaywrightTimeout:
        log.warning(f"Navigation timeout for slug: {slug}")
        return False
    except Exception as e:
        log.error(f"URL navigation failed for slug '{slug}': {e}")
        return False


def _navigate_tab_click(page, field_config: dict) -> bool:
    """
    Tab-click navigation strategy for sections with sub-tabs (e.g. Market Data).

    After URL navigation, clicks the sub-tab whose text matches `tab_text`
    to make the target TinyMCE iframe visible.

    Discovered patterns:
      - Market Data: tabs are <a class="text-center"> with text like
        "regional overview", "industry overview", "national overview"
      - Clicking the tab makes the corresponding hidden iframe visible (0x0 â†’ 736x106)

    Args:
        page:         Playwright Page object
        field_config: Field map entry with 'tab_text' and optional 'tab_selector'

    Returns:
        True if tab was clicked successfully, False otherwise.
    """
    tab_text     = field_config.get('tab_text', '')
    tab_selector = field_config.get('tab_selector', 'a.text-center')

    if not tab_text:
        return True  # No tab click needed

    try:
        # Find the tab by text content within the tab_selector elements
        tab_locator = page.locator(f"{tab_selector}:has-text('{tab_text}')")
        count = tab_locator.count()
        if count == 0:
            # Fallback: any link with matching text
            tab_locator = page.get_by_text(tab_text, exact=False)
            count = tab_locator.count()

        if count == 0:
            log.warning(f"Tab not found: '{tab_text}' (selector: {tab_selector})")
            return False

        tab_locator.first.click()
        time.sleep(1.2)  # Wait for iframe to become visible after tab click
        log.info(f"Clicked tab: '{tab_text}'")
        return True

    except Exception as e:
        log.warning(f"Tab click failed for '{tab_text}': {e}")
        return False


def navigate_to_section(page, field_config: dict) -> bool:
    """
    Navigate to the correct section of the Real Quantum report.

    Navigation strategy (in order):
        1. nav_url_slug  â€” direct URL navigation (most reliable, preferred)
        2. tab_click     â€” click a sub-tab after URL navigation (Market Data sub-sections)
        3. nav_selector  â€” CSS selector click on sidebar nav element
        4. nav_text      â€” text-based click on sidebar nav element

    The `navigation_strategy` field in the field map controls which post-navigation
    step is taken after URL navigation:
        - "visible"   â†’ no extra step needed (iframe already visible)
        - "scroll"    â†’ _insert_tinymce Strategy 2 handles scroll-into-view
        - "tab_click" â†’ click the sub-tab to make the iframe visible
        - "detail_page" â†’ handled separately via /insert-detail-page endpoint

    Args:
        page:         Playwright Page object
        field_config: Field map entry

    Returns:
        True if navigation succeeded or was not needed, False on failure.
    """
    nav_url_slug        = field_config.get('nav_url_slug', '')
    nav_selector        = field_config.get('nav_selector', '')
    nav_text            = field_config.get('nav_text', '')
    navigation_strategy = field_config.get('navigation_strategy', 'visible')

    # Step 1: URL-based navigation (preferred â€” most reliable for Real Quantum)
    if nav_url_slug:
        ok = _navigate_to_url(page, nav_url_slug)
        if not ok:
            return False

        # Step 2: Post-navigation action based on strategy
        if navigation_strategy == 'tab_click':
            return _navigate_tab_click(page, field_config)

        # scroll and visible strategies: _insert_tinymce handles the rest
        return True

    if not nav_selector and not nav_text:
        log.info("No navigation required for this field.")
        return True

    try:
        if nav_selector:
            page.wait_for_selector(nav_selector, timeout=NAVIGATION_TIMEOUT)
            page.click(nav_selector)
            log.info(f"Navigated via selector: {nav_selector}")
        elif nav_text:
            page.get_by_text(nav_text, exact=False).first.click()
            log.info(f"Navigated via text: {nav_text}")

        time.sleep(INSERT_DELAY_MS / 1000)
        return True

    except PlaywrightTimeout:
        log.warning(f"Navigation timeout for selector: {nav_selector}")
        return False
    except Exception as e:
        log.error(f"Navigation failed: {e}")
        return False

# â”€â”€ Text insertion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def insert_text(page, field_config: dict, text: str) -> bool:
    """
    Locate the target text field in Real Quantum and insert the narrative text.

    Insertion strategy (tried in order):
        1. Direct fill via CSS selector (fastest, most reliable)
        2. Click + select all + type (for fields that need focus first)
        3. Clipboard paste fallback (for rich text editors / TinyMCE)

    Args:
        page:         Playwright Page object
        field_config: Field map entry with 'input_selector' and 'input_type'
        text:         The narrative text to insert

    Returns:
        True if insertion succeeded, False otherwise.

    How to extend:
        - For TinyMCE rich text editors (common in web appraisal software),
          add input_type: "tinymce" to the field map and handle it by
          executing JavaScript: page.evaluate("tinymce.activeEditor.setContent(...)")
        - For CodeMirror editors, use page.evaluate() to set the editor value
    """
    input_selector = field_config.get('input_selector', '')
    input_type     = field_config.get('input_type', 'textarea')
    clear_method   = field_config.get('clear_method', 'select_all')

    if not input_selector:
        log.error("No input_selector defined in field map. Update field_maps/commercial.json.")
        return False

    # â”€â”€ Strategy 1: TinyMCE rich text editor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if input_type == 'tinymce':
        return _insert_tinymce(page, field_config, text)

    # â”€â”€ Strategy 2: Direct fill (standard textarea/input) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try:
        page.wait_for_selector(input_selector, timeout=NAVIGATION_TIMEOUT)
        element = page.locator(input_selector).first

        if clear_method == 'select_all':
            element.click()
            element.select_text()
        elif clear_method == 'triple_click':
            element.triple_click()
        else:
            element.click()

        element.fill(text)
        log.info(f"Inserted text via direct fill: {input_selector} ({len(text)} chars)")
        return True

    except PlaywrightTimeout:
        log.warning(f"Selector not found: {input_selector}. Trying clipboard fallback.")
    except Exception as e:
        log.warning(f"Direct fill failed: {e}. Trying clipboard fallback.")

    # â”€â”€ Strategy 3: Clipboard paste fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return fallback_clipboard(page, field_config, text)

_last_tinymce_polls = 0  # polls taken in most recent _wait_for_tinymce_init call


def _wait_for_tinymce_init(page, tinymce_id: str, max_attempts: int = 10, interval_ms: int = 500) -> bool:
    """Poll until tinymce.get(id) is initialized or timeout (max_attempts * interval_ms ms).

    Updates the module-level _last_tinymce_polls counter for diagnostic reporting.
    """
    global _last_tinymce_polls
    _last_tinymce_polls = 0
    for i in range(max_attempts):
        try:
            ready = page.evaluate(
                f"typeof tinymce !== 'undefined' && tinymce.get('{tinymce_id}') !== null"
            )
            if ready:
                _last_tinymce_polls = i + 1
                log.info(f"TinyMCE '{tinymce_id}' ready after {i + 1} poll(s)")
                return True
        except Exception as e:
            log.debug(f"TinyMCE poll {i + 1} error: {e}")
        time.sleep(interval_ms / 1000.0)
    _last_tinymce_polls = max_attempts
    log.warning(
        f"TinyMCE '{tinymce_id}' not initialized after {max_attempts} polls "
        f"({max_attempts * interval_ms}ms)"
    )
    return False


def _strip_html(html: str) -> str:
    """Strip HTML tags from a string, normalize whitespace, and return plain text."""
    if not html:
        return ''
    # Replace block-level closing tags with newlines before stripping
    text = re.sub(r'</(?:p|div|br|li|h[1-6])>', '\n', html, flags=re.IGNORECASE)
    # Strip remaining HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Decode common HTML entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    # Collapse whitespace: multiple spaces/tabs to single space, preserve newlines
    text = re.sub(r'[^\S\n]+', ' ', text)
    # Collapse multiple newlines
    text = re.sub(r'\n\s*\n', '\n', text)
    return text.strip()


def _insert_tinymce(page, field_config: dict, text: str) -> bool:
    """
    Insert text into a TinyMCE rich text editor.

    Real Quantum uses TinyMCE for all narrative text fields. Each editor
    renders inside an iframe with ID pattern: {field_name}_text_area_ifr
    The TinyMCE editor ID is the same without the _ifr suffix.

    Insertion strategy (tried in order):
        1. tinymce.get(id).setContent() â€” fastest, most reliable
        2. Scroll iframe into view + click + select-all + type â€” for hidden editors
        3. Clipboard paste into iframe body â€” last resort

    Args:
        page:         Playwright Page object
        field_config: Field map entry (should have 'tinymce_id' and 'tinymce_iframe_id')
        text:         Plain text to insert

    Returns:
        True if insertion succeeded, False otherwise.
    """
    tinymce_id       = field_config.get('tinymce_id', '')
    tinymce_iframe_id = field_config.get('tinymce_iframe_id', '')
    editor_index     = field_config.get('editor_index', 0)

    # â”€â”€ Strategy 1: TinyMCE JS API (fastest) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try:
        if tinymce_id:
            # Wait for TinyMCE to be initialized with this editor ID
            page.wait_for_function(
                f"typeof tinymce !== 'undefined' && tinymce.get('{tinymce_id}') !== null",
                timeout=8000
            )
            js = f"tinymce.get('{tinymce_id}').setContent({json.dumps(text)})"
        else:
            page.wait_for_function(
                "typeof tinymce !== 'undefined' && tinymce.editors.length > 0",
                timeout=8000
            )
            js = f"tinymce.editors[{editor_index}].setContent({json.dumps(text)})"

        page.evaluate(js)
        log.info(f"Inserted via TinyMCE JS API: editor_id={tinymce_id or editor_index} ({len(text)} chars)")
        return True

    except Exception as e:
        log.warning(f"TinyMCE JS API failed: {e}. Trying iframe interaction fallback.")

    # â”€â”€ Strategy 2: Scroll iframe into view + interact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Handles hidden editors (sub-tabs not yet visible on page load)
    if tinymce_iframe_id:
        try:
            iframe_sel = f"iframe#{tinymce_iframe_id}"
            # Scroll the iframe into view to trigger TinyMCE initialization
            page.evaluate(f"""
                const el = document.querySelector('{iframe_sel}');
                if (el) el.scrollIntoView({{behavior: 'instant', block: 'center'}});
            """)
            # Poll for TinyMCE init instead of static sleep (up to 5 seconds)
            initialized = _wait_for_tinymce_init(page, tinymce_id) if tinymce_id else False

            # Retry TinyMCE JS API after scroll
            if tinymce_id and initialized:
                page.evaluate(f"tinymce.get('{tinymce_id}').setContent({json.dumps(text)})")
                log.info(f"Inserted via TinyMCE JS (after scroll): {tinymce_id}")
                return True

            # Click inside the iframe body and paste
            iframe_el = page.frame_locator(f"iframe#{tinymce_iframe_id}")
            body = iframe_el.locator('body')
            body.click()
            page.keyboard.press('Control+a')
            time.sleep(0.05)
            pyperclip.copy(text)
            page.keyboard.press('Control+v')
            time.sleep(0.3)
            log.info(f"Inserted via iframe body click+paste: {tinymce_iframe_id}")
            return True

        except Exception as e2:
            log.warning(f"Iframe interaction fallback failed: {e2}. Trying clipboard fallback.")

    # â”€â”€ Strategy 3: Clipboard paste (last resort) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return fallback_clipboard(page, field_config, text)

def fallback_clipboard(page, field_config: dict, text: str) -> bool:
    """
    Clipboard fallback: copy text to clipboard, focus the field, paste.

    This is the most reliable method for fields that don't respond to
    direct fill() â€” including custom editors, contenteditable divs, and
    some React-controlled inputs.

    Args:
        page:         Playwright Page object
        field_config: Field map entry
        text:         The narrative text to insert

    Returns:
        True if paste succeeded, False otherwise.
    """
    input_selector = field_config.get('input_selector', '')

    try:
        # Copy to Windows clipboard
        pyperclip.copy(text)
        time.sleep(0.1)

        if input_selector:
            try:
                page.wait_for_selector(input_selector, timeout=5000)
                page.click(input_selector)
                time.sleep(0.1)
            except Exception:
                log.warning(f"Could not click selector for clipboard paste: {input_selector}")

        # Select all existing content and paste
        page.keyboard.press('Control+a')
        time.sleep(0.05)
        page.keyboard.press('Control+v')
        time.sleep(INSERT_DELAY_MS / 1000)

        log.info(f"Inserted text via clipboard paste ({len(text)} chars)")
        return True

    except Exception as e:
        log.error(f"Clipboard fallback failed: {e}")
        return False

# â”€â”€ Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _normalize_for_comparison(text: str) -> str:
    """Normalize text for verification comparison: strip HTML, collapse whitespace, lowercase."""
    stripped = _strip_html(text)
    # Collapse all whitespace (spaces, newlines, tabs) to single space
    normalized = re.sub(r'\s+', ' ', stripped).strip().lower()
    # Normalize quotes and dashes
    normalized = normalized.replace('\u201c', '"').replace('\u201d', '"')
    normalized = normalized.replace('\u2018', "'").replace('\u2019', "'")
    normalized = normalized.replace('\u2014', '--').replace('\u2013', '-')
    return normalized


def verify_insertion(page, field_config: dict, expected_text: str) -> bool:
    """
    Read the field value back and verify the text was inserted correctly.

    Scrolls the TinyMCE iframe back into view and polls for editor init
    before readback (fixes verification failures on scroll-strategy fields).

    Compares first 200 characters after normalizing both sides: stripping
    HTML, collapsing whitespace, and lowercasing.

    Args:
        page:          Playwright Page object
        field_config:  Field map entry
        expected_text: The text that was inserted

    Returns:
        True if verification passed, False otherwise (non-fatal).
    """
    try:
        input_type = field_config.get('input_type', 'textarea')
        tinymce_id = field_config.get('tinymce_id', '')
        tinymce_iframe_id = field_config.get('tinymce_iframe_id', '')

        # For TinyMCE fields: scroll iframe into view and wait for init before readback
        if input_type == 'tinymce' and tinymce_iframe_id:
            try:
                page.evaluate(f"""
                    const el = document.querySelector('iframe#{tinymce_iframe_id}');
                    if (el) el.scrollIntoView({{behavior: 'instant', block: 'center'}});
                """)
                time.sleep(0.3)
            except Exception:
                pass  # Best-effort scroll

            # Poll for TinyMCE init before attempting readback
            if tinymce_id:
                _wait_for_tinymce_init(page, tinymce_id, max_attempts=6, interval_ms=400)

        raw_actual = read_field_value(page, field_config)
        actual_normalized = _normalize_for_comparison(raw_actual)
        expected_normalized = _normalize_for_comparison(expected_text)

        # Compare first 200 chars of normalized text
        check_len = 200
        check_expected = expected_normalized[:check_len]
        check_actual = actual_normalized[:check_len]

        # Pass if expected snippet is found anywhere in actual, OR if first N chars match closely
        passed = (check_expected in actual_normalized) or (check_expected == check_actual)

        if not passed and len(check_expected) > 50:
            # Fallback: check if first 50 chars match (handles minor truncation)
            passed = check_expected[:50] in actual_normalized

        if passed:
            log.info("Verification passed âœ“")
        else:
            log.warning(f"Verification FAILED.")
            log.warning(f"  Expected (first 60): '{check_expected[:60]}...'")
            log.warning(f"  Actual   (first 60): '{check_actual[:60]}...'")
        return passed

    except Exception as e:
        log.warning(f"Verification error (non-fatal): {e}")
        return False

def read_field_value(page, field_config: dict) -> str:
    """
    Read the current field value from the active Real Quantum section.

    For TinyMCE fields: scrolls the iframe into view and polls for editor
    initialization before attempting readback. This fixes empty readback
    on scroll-strategy fields where iframes are hidden/lazy-loaded.

    Returns plain text for both TinyMCE and direct input fields.
    Raises on transport/selector errors so the caller can surface diagnostics.
    """
    input_type = field_config.get('input_type', 'textarea')

    if input_type == 'tinymce':
        tinymce_id        = field_config.get('tinymce_id', '')
        tinymce_iframe_id = field_config.get('tinymce_iframe_id', '')
        editor_index      = field_config.get('editor_index', 0)

        # Scroll iframe into view to ensure TinyMCE is initialized for readback
        if tinymce_iframe_id:
            try:
                page.evaluate(f"""
                    const el = document.querySelector('iframe#{tinymce_iframe_id}');
                    if (el) el.scrollIntoView({{behavior: 'instant', block: 'center'}});
                """)
                time.sleep(0.3)
            except Exception as e:
                log.debug(f"Scroll before readback failed (non-fatal): {e}")

        # Poll for TinyMCE init before readback (fixes empty reads on scroll-strategy fields)
        if tinymce_id:
            _wait_for_tinymce_init(page, tinymce_id, max_attempts=8, interval_ms=400)

        try:
            if tinymce_id:
                actual = page.evaluate(f"tinymce.get('{tinymce_id}') ? tinymce.get('{tinymce_id}').getContent({{format:'text'}}) : ''")
            else:
                actual = page.evaluate(f"tinymce.editors[{editor_index}] ? tinymce.editors[{editor_index}].getContent({{format:'text'}}) : ''")
        except Exception:
            if tinymce_iframe_id:
                iframe_el = page.frame_locator(f"iframe#{tinymce_iframe_id}")
                actual = iframe_el.locator('body').text_content() or ''
            else:
                actual = ''
        return actual or ''

    input_selector = field_config.get('input_selector', '')
    if not input_selector:
        raise ValueError('No input_selector defined for readback')

    element = page.locator(input_selector).first
    return element.input_value() or element.text_content() or ''

# â”€â”€ Flask HTTP server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

flask_app = Flask(__name__)

@flask_app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    page = get_page() if PLAYWRIGHT_AVAILABLE else None
    targets = list_cdp_targets() if PLAYWRIGHT_AVAILABLE else []
    return jsonify({
        'ok':        True,
        'agent':     'cacc-rq-agent',
        'playwright': PLAYWRIGHT_AVAILABLE,
        'connected': page is not None,
        'port':      AGENT_PORT,
        'cdp_url':   CDP_URL,
        'rq_base_url': RQ_BASE_URL,
        'last_error': _last_connection_error,
        'target_count': len(targets),
        'targets': summarize_targets(targets),
    })

@flask_app.route('/insert', methods=['POST'])
def insert():
    """
    Main insertion endpoint called by the Node.js server.

    Request JSON:
        {
          "fieldId":  "site_description",
          "text":     "The subject site is located...",
          "formType": "commercial"
        }

    Response JSON:
        {
          "ok": true,
          "inserted": true,
          "verified": true,
          "method": "direct_fill" | "tinymce" | "clipboard" | "stub",
          "fieldId": "site_description",
          "fieldLabel": "Site Description"
        }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId',  '')).strip()
    text      = str(data.get('text',     '')).strip()
    form_type = str(data.get('formType', 'commercial')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not text:
        return jsonify({'ok': False, 'error': 'text is required'}), 400

    # â”€â”€ Stub mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not PLAYWRIGHT_AVAILABLE:
        log.info(f"[STUB] Would insert into '{field_id}' ({len(text)} chars)")
        return jsonify({
            'ok':      True,
            'inserted': False,
            'method':  'stub',
            'message': 'playwright not installed. Run: pip install playwright && playwright install chromium',
        })

    # â”€â”€ Load field map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    field_map    = load_field_map(form_type)
    field_config = field_map.get(field_id, {})
    field_label  = field_config.get('label', field_id)

    if not field_config:
        log.warning(f"No field config found for '{field_id}' in {form_type} field map.")
        log.warning("Update real_quantum_agent/field_maps/commercial.json with the correct selectors.")

    log.info(f"Inserting into '{field_label}' (fieldId={field_id}, chars={len(text)})")

    # â”€â”€ Connect to browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    page = get_page()
    if not page:
        return jsonify({
            'ok':   False,
            'error': (
                'Could not connect to Chrome. '
                'Launch Chrome with: chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session '
                'then log into Real Quantum and open your report.'
            ),
        }), 503

    # â”€â”€ Navigate to section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    nav_ok = navigate_to_section(page, field_config)
    if not nav_ok:
        log.warning(f"Navigation failed for '{field_label}'. Attempting insertion anyway.")

    # â”€â”€ Insert with retries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    success = False
    for attempt in range(1, MAX_RETRIES + 1):
        log.info(f"Insertion attempt {attempt}/{MAX_RETRIES}")
        success = insert_text(page, field_config, text)
        if success:
            break
        time.sleep(0.5)

    if not success:
        screenshot_path = capture_screenshot(page, f'insert_fail_{field_id}')
        return jsonify({
            'ok':         False,
            'error':      f"Insertion failed after {MAX_RETRIES} attempts. Check selectors in field_maps/commercial.json.",
            'screenshot': screenshot_path,
        }), 500

    # â”€â”€ Verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    verified = True
    if VERIFY_INSERTION:
        time.sleep(0.3)
        verified = verify_insertion(page, field_config, text)
        if not verified:
            capture_screenshot(page, f'verify_fail_{field_id}')

    return jsonify({
        'ok':           True,
        'inserted':     True,
        'verified':     verified,
        'method':       field_config.get('input_type', 'direct_fill'),
        'fieldId':      field_id,
        'fieldLabel':   field_label,
        'tinymce_polls': _last_tinymce_polls,
    })

@flask_app.route('/insert-batch', methods=['POST'])
def insert_batch():
    """
    Insert text into multiple Real Quantum fields in sequence.

    Request:
        {
          "formType": "commercial",
          "fields": [
            { "fieldId": "site_description", "text": "..." },
            { "fieldId": "reconciliation",   "text": "..." }
          ]
        }

    Response:
        { ok, results: { fieldId: { ok, method, verified } }, errors: { fieldId: msg } }
    """
    data      = request.get_json(force=True, silent=True) or {}
    form_type = str(data.get('formType', 'commercial')).strip()
    fields    = data.get('fields', [])

    if not isinstance(fields, list) or not fields:
        return jsonify({'ok': False, 'error': 'fields must be a non-empty array'}), 400
    if len(fields) > 20:
        return jsonify({'ok': False, 'error': 'Maximum 20 fields per batch'}), 400

    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({
            'ok': True,
            'results': {f.get('fieldId', '?'): {'ok': True, 'method': 'stub'} for f in fields},
            'errors': {},
            'message': 'stub mode',
        })

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome.'}), 503

    field_map = load_field_map(form_type)
    results   = {}
    errors    = {}

    for item in fields:
        field_id = str(item.get('fieldId', '')).strip()
        text     = str(item.get('text', '')).strip()

        if not field_id or not text:
            errors[field_id or '?'] = 'fieldId and text are required'
            continue

        field_config = field_map.get(field_id, {})
        field_label  = field_config.get('label', field_id)
        log.info(f"BATCH INSERT '{field_label}' ({len(text)} chars)")

        # Navigate to section
        navigate_to_section(page, field_config)

        # Insert with retries
        success = False
        for attempt in range(1, MAX_RETRIES + 1):
            success = insert_text(page, field_config, text)
            if success:
                break
            time.sleep(0.5)

        if success:
            verified = True
            if VERIFY_INSERTION:
                time.sleep(0.3)
                verified = verify_insertion(page, field_config, text)
            results[field_id] = {
                'ok': True, 'method': field_config.get('input_type', 'direct_fill'),
                'verified': verified, 'fieldLabel': field_label,
                'tinymce_polls': _last_tinymce_polls,
            }
        else:
            capture_screenshot(page, f'batch_fail_{field_id}')
            errors[field_id] = f"Insertion failed after {MAX_RETRIES} attempts"

        time.sleep(INSERT_DELAY_MS / 1000)

    return jsonify({'ok': True, 'results': results, 'errors': errors})

@flask_app.route('/test-field', methods=['POST'])
def test_field():
    """
    Dry-run: check whether a field's selector can be found on the current page,
    without inserting any text. Use this to verify field maps before a real run.

    Request:  { fieldId, formType }
    Response: { ok, found, nav_found, input_found, fieldId, fieldLabel, url }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', 'commercial')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400

    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': True, 'found': False, 'message': 'stub mode â€” playwright not available'})

    field_map    = load_field_map(form_type)
    field_config = field_map.get(field_id, {})
    field_label  = field_config.get('label', field_id)

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome.'}), 503

    # Test navigation selector
    nav_selector = field_config.get('nav_selector', '')
    nav_found    = False
    if nav_selector:
        try:
            nav_found = page.locator(nav_selector).count() > 0
        except Exception:
            nav_found = False

    # Navigate to section first (so input selector is visible)
    navigate_to_section(page, field_config)
    time.sleep(0.5)

    # Test input selector
    input_selector = field_config.get('input_selector', '')
    input_found    = False
    input_type     = field_config.get('input_type', 'textarea')

    if input_type == 'tinymce':
        try:
            tinymce_id        = field_config.get('tinymce_id', '')
            tinymce_iframe_id = field_config.get('tinymce_iframe_id', '')
            if tinymce_id:
                result = page.evaluate(f"typeof tinymce !== 'undefined' && tinymce.get('{tinymce_id}') !== null")
            else:
                result = page.evaluate("typeof tinymce !== 'undefined' && tinymce.editors.length > 0")

            # Fallback: check DOM presence for hidden/lazy-initialized iframes.
            # Hidden iframes (0x0) are not yet registered with tinymce.get() but DO
            # exist in the DOM â€” the scroll strategy will activate them at insert time.
            if not result and tinymce_iframe_id:
                result = page.evaluate(
                    f"document.querySelector('iframe#{tinymce_iframe_id}') !== null"
                )
                if result:
                    log.info(f"test-field: iframe#{tinymce_iframe_id} found in DOM (hidden â€” scroll strategy will activate)")

            input_found = bool(result)
        except Exception:
            input_found = False
    elif input_selector:
        try:
            input_found = page.locator(input_selector).count() > 0
        except Exception:
            input_found = False

    found = input_found  # nav is optional; input is required
    return jsonify({
        'ok':            True,
        'found':         found,
        'nav_found':     nav_found,
        'input_found':   input_found,
        'fieldId':       field_id,
        'fieldLabel':    field_label,
        'formType':      form_type,
        'nav_selector':  nav_selector,
        'input_selector': input_selector,
        'input_type':    input_type,
        'url':           page.url,
    })

@flask_app.route('/reload-maps', methods=['POST'])
def reload_maps():
    """
    Clear the field map cache so updated field_maps/*.json files are reloaded
    on the next insertion request. Call this after editing field maps.
    """
    reload_field_maps()
    return jsonify({'ok': True, 'message': 'Field map cache cleared. Maps will reload on next request.'})

@flask_app.route('/read-field', methods=['POST'])
def read_field():
    """
    Read the current value of a Real Quantum field after navigating to its section.

    Request:  { fieldId, formType }
    Response: { ok, success, value, fieldId, fieldLabel, url }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', 'commercial')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400

    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': True, 'success': False, 'value': '', 'message': 'stub mode'})

    field_map    = load_field_map(form_type)
    field_config = field_map.get(field_id, {})
    field_label  = field_config.get('label', field_id)

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome.'}), 503

    try:
        navigate_to_section(page, field_config)
        time.sleep(0.3)
        value = read_field_value(page, field_config)
        return jsonify({
            'ok': True,
            'success': True,
            'value': value,
            'fieldId': field_id,
            'fieldLabel': field_label,
            'url': page.url,
        })
    except Exception as e:
        return jsonify({
            'ok': False,
            'success': False,
            'error': str(e),
            'fieldId': field_id,
            'fieldLabel': field_label,
            'url': page.url if page else None,
        }), 500

@flask_app.route('/list-sections', methods=['GET'])  # noqa: E302
def list_sections():
    """
    Debug endpoint: list all interactive elements on the current Real Quantum page.
    Use this to discover the correct CSS selectors for each section.

    Returns a list of { tag, id, name, class, text, selector } objects.
    """
    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': False, 'error': 'playwright not available'})

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome'})

    try:
        elements = page.evaluate("""
            () => {
                const results = [];
                const selectors = [
                    'textarea', 'input[type="text"]', '[contenteditable="true"]',
                    '.tox-edit-area', '.mce-content-body', 'nav a', '.nav-item',
                    '[data-section]', '[data-field]', '[data-tab]',
                    'button', '.tab', '.section-link'
                ];
                selectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            results.push({
                                tag:      el.tagName.toLowerCase(),
                                id:       el.id || '',
                                name:     el.name || el.getAttribute('name') || '',
                                cls:      el.className || '',
                                text:     (el.textContent || el.value || '').trim().slice(0, 80),
                                selector: sel,
                                dataAttrs: Object.fromEntries(
                                    [...el.attributes]
                                    .filter(a => a.name.startsWith('data-'))
                                    .map(a => [a.name, a.value])
                                )
                            });
                        }
                    });
                });
                return results;
            }
        """)
        return jsonify({'ok': True, 'url': page.url, 'elements': elements, 'count': len(elements)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})

@flask_app.route('/screenshot', methods=['GET'])
def screenshot():
    """
    Debug endpoint: take a screenshot of the current Real Quantum page.
    Saves to real_quantum_agent/debug_screenshot.png
    """
    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': False, 'error': 'playwright not available'})

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome'})

    try:
        path = os.path.join(AGENT_DIR, 'debug_screenshot.png')
        page.screenshot(path=path, full_page=True)
        return jsonify({'ok': True, 'saved': path, 'url': page.url})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})

@flask_app.route('/list-detail-pages', methods=['POST'])
def list_detail_pages():
    """
    Binoculars support: list all detail sub-page links on a section page.

    Navigates to the given section (e.g. sale_valuation) and finds all
    <a class="details_link"> elements â€” these are the binoculars icons that
    open individual comparable sale detail pages.

    Request:  { sectionSlug: "sale_valuation", formType: "commercial" }
    Response: { ok, links: [ { href, text, index } ], count, url }

    Use the returned href values with /insert-detail-page to insert text
    into each comparable's detail page.
    """
    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': False, 'error': 'playwright not available'})

    data         = request.get_json(force=True, silent=True) or {}
    section_slug = str(data.get('sectionSlug', 'sale_valuation')).strip()
    link_selector = str(data.get('linkSelector', 'a.details_link')).strip()

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome.'}), 503

    # Navigate to the section
    nav_ok = _navigate_to_url(page, section_slug)
    if not nav_ok:
        return jsonify({'ok': False, 'error': f'Could not navigate to section: {section_slug}'}), 500

    try:
        links = page.evaluate(f"""
            () => {{
                const els = document.querySelectorAll('{link_selector}');
                return [...els].map((el, i) => {{
                    const rect = el.getBoundingClientRect();
                    return {{
                        href:    el.href || el.getAttribute('href') || '',
                        text:    (el.textContent || '').trim().substring(0, 80),
                        index:   i,
                        visible: rect.width > 0 && rect.height > 0,
                    }};
                }});
            }}
        """)
        log.info(f"Found {len(links)} detail links on {section_slug}")
        return jsonify({'ok': True, 'links': links, 'count': len(links), 'url': page.url})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@flask_app.route('/insert-detail-page', methods=['POST'])
def insert_detail_page():
    """
    Binoculars support: navigate to a detail sub-page and insert text.

    This handles the pattern where clicking the binoculars icon on a section
    (e.g. Sales Comparison) opens a detail page for an individual comparable sale
    at a URL like:
        /assignments/{uuid}/assignment_sale_valuation_summaries/{item_uuid}/details.html

    The agent navigates to that URL, discovers all TinyMCE iframes on the page,
    and inserts text into the specified one (by index or iframe ID).

    Request JSON:
        {
          "detailUrl":      "https://cacc.realquantumapp.com/assignments/.../details.html",
          "text":           "The comparable sale at 123 Main St...",
          "tinymceIndex":   0,          // which TinyMCE editor on the detail page (default 0)
          "tinymceId":      "optional_known_id"  // if known, use this instead of index
        }

    Response JSON:
        { ok, inserted, verified, method, url, editorsFound, editorUsed }
    """
    if not PLAYWRIGHT_AVAILABLE:
        return jsonify({'ok': False, 'error': 'playwright not available'})

    data          = request.get_json(force=True, silent=True) or {}
    detail_url    = str(data.get('detailUrl', '')).strip()
    text          = str(data.get('text', '')).strip()
    tinymce_index = int(data.get('tinymceIndex', 0))
    tinymce_id    = str(data.get('tinymceId', '')).strip()

    if not detail_url:
        return jsonify({'ok': False, 'error': 'detailUrl is required'}), 400
    if not text:
        return jsonify({'ok': False, 'error': 'text is required'}), 400

    page = get_page()
    if not page:
        return jsonify({'ok': False, 'error': 'Could not connect to Chrome.'}), 503

    # Navigate to the detail page
    try:
        log.info(f"Navigating to detail page: {detail_url}")
        page.goto(detail_url, wait_until='domcontentloaded', timeout=NAVIGATION_TIMEOUT)
        time.sleep(2.0)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Navigation to detail page failed: {e}'}), 500

    # Discover TinyMCE editors on this page
    try:
        iframes = page.evaluate("""
            () => {
                const els = document.querySelectorAll('iframe.tox-edit-area__iframe');
                return [...els].map((el, i) => ({
                    id:      el.id,
                    index:   i,
                    visible: el.getBoundingClientRect().width > 0,
                    w:       Math.round(el.getBoundingClientRect().width),
                    h:       Math.round(el.getBoundingClientRect().height),
                }));
            }
        """)
        log.info(f"Detail page has {len(iframes)} TinyMCE iframes")
        for f in iframes:
            log.info(f"  [{f['index']}] id={f['id']} visible={f['visible']} {f['w']}x{f['h']}")
    except Exception as e:
        iframes = []
        log.warning(f"Could not scan iframes on detail page: {e}")

    if not iframes:
        capture_screenshot(page, 'detail_page_no_iframes')
        return jsonify({
            'ok': False,
            'error': 'No TinyMCE iframes found on detail page',
            'url': page.url,
        }), 500

    # Determine which editor to use
    editor_id = tinymce_id
    if not editor_id and tinymce_index < len(iframes):
        editor_id = iframes[tinymce_index]['id'].replace('_ifr', '')

    if not editor_id:
        return jsonify({'ok': False, 'error': f'No editor found at index {tinymce_index}'}), 500

    # Build a synthetic field_config for the detail page editor
    detail_field_config = {
        'input_type':        'tinymce',
        'tinymce_id':        editor_id,
        'tinymce_iframe_id': editor_id + '_ifr',
        'input_selector':    f'iframe#{editor_id}_ifr',
        'clear_method':      'select_all',
        'navigation_strategy': 'scroll',
    }

    # Insert with retries
    success = False
    for attempt in range(1, MAX_RETRIES + 1):
        log.info(f"Detail page insertion attempt {attempt}/{MAX_RETRIES} into editor: {editor_id}")
        success = _insert_tinymce(page, detail_field_config, text)
        if success:
            break
        time.sleep(0.5)

    if not success:
        capture_screenshot(page, f'detail_page_fail_{editor_id[:30]}')
        return jsonify({
            'ok': False,
            'error': f'Insertion failed after {MAX_RETRIES} attempts on detail page',
            'url': page.url,
            'editorsFound': len(iframes),
        }), 500

    # Verify
    verified = True
    if VERIFY_INSERTION:
        time.sleep(0.3)
        verified = verify_insertion(page, detail_field_config, text)

    return jsonify({
        'ok':          True,
        'inserted':    True,
        'verified':    verified,
        'method':      'tinymce',
        'url':         page.url,
        'editorsFound': len(iframes),
        'editorUsed':  editor_id,
    })

# â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if __name__ == '__main__':
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    log.info(f"CACC Real Quantum Agent v2.0 starting on port {AGENT_PORT}")
    log.info(f"Playwright available: {PLAYWRIGHT_AVAILABLE}")
    log.info(f"CDP URL (Chrome remote debugging): {CDP_URL}")
    log.info(f"Field maps directory: {FIELD_MAPS_DIR}")
    log.info(f"Screenshots directory: {SCREENSHOTS_DIR}")
    log.info("")
    log.info("SETUP REMINDER:")
    log.info("  1. Launch Chrome: chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session")
    log.info("  2. Log into Real Quantum and open your commercial report")
    log.info("  3. Then use Appraisal Agent to generate and insert narratives")
    log.info("")
    # threaded=False is required: Playwright sync API is not thread-safe.
    # All requests must be handled in the same thread that created the Playwright instance.
    # This is correct for a single-user tool â€” requests are handled sequentially.
    flask_app.run(host='127.0.0.1', port=AGENT_PORT, debug=False, threaded=False)

