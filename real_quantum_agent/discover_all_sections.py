"""
real_quantum_agent/discover_all_sections.py
--------------------------------------------
Enhanced multi-section selector discovery for Real Quantum.

Automatically navigates to each key writing section and collects
the TinyMCE iframe IDs and input selectors. Outputs a ready-to-use
field map update for field_maps/commercial.json.

Usage:
    python real_quantum_agent/discover_all_sections.py

Requirements:
    - Chrome running with --remote-debugging-port=9222
    - Logged into Real Quantum with a commercial assignment open
"""

import json
import os
import sys
import time

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

AGENT_DIR   = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(AGENT_DIR, 'config.json')
OUTPUT_FILE = os.path.join(AGENT_DIR, 'discovered_sections.json')
MAP_FILE    = os.path.join(AGENT_DIR, 'field_maps', 'commercial.json')

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

config  = load_config()
CDP_URL = config.get('cdp_url', 'http://127.0.0.1:9222')

# Sections to discover â€” (cacc_field_id, rq_section_slug, label)
SECTIONS_TO_DISCOVER = [
    ('introduction',          'introduction',          'Introduction'),
    ('market_area',           'market_data',           'Market Data'),
    ('property_data',         'property_data',         'Property Data'),
    ('hbu_analysis',          'highest_best_use',      'Highest and Best Use'),
    ('land_valuation',        'land_valuation',        'Land Valuation'),
    ('cost_approach',         'cost_approach',         'Cost Approach'),
    ('sales_comparison',      'sales_comparison',      'Sales Comparison'),
    ('market_rent_analysis',  'market_rent_analysis',  'Market Rent Analysis'),
    ('income_approach',       'income_approach',       'Income Approach'),
    ('reconciliation',        'reconciliation',        'Reconciliation'),
]

def get_tinymce_iframes(page):
    """Return all TinyMCE iframe IDs visible on the current page."""
    return page.evaluate("""
        () => {
            const iframes = document.querySelectorAll('iframe.tox-edit-area__iframe');
            return [...iframes].map(f => ({
                id: f.id,
                visible: f.getBoundingClientRect().width > 0,
                rect: {
                    x: Math.round(f.getBoundingClientRect().x),
                    y: Math.round(f.getBoundingClientRect().y),
                    w: Math.round(f.getBoundingClientRect().width),
                    h: Math.round(f.getBoundingClientRect().height)
                }
            }));
        }
    """)

def get_nav_links(page):
    """Return all sidebar nav links."""
    return page.evaluate("""
        () => {
            const links = document.querySelectorAll('nav a, .sidebar a, aside a, [class*="sidebar"] a, [class*="nav"] a');
            return [...links].map(a => ({
                text: a.textContent.trim(),
                href: a.href,
                classes: a.className
            })).filter(l => l.text && l.href && l.href.includes('/assignments/'));
        }
    """)

def get_text_inputs(page):
    """Return all text inputs and textareas."""
    return page.evaluate("""
        () => {
            const els = document.querySelectorAll('input[type="text"], textarea, select');
            return [...els].map(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id,
                name: el.name || el.getAttribute('name') || '',
                classes: el.className,
                visible: el.getBoundingClientRect().width > 0
            })).filter(e => e.visible);
        }
    """)

def discover_all():
    print(f"\n{'='*60}")
    print("Appraisal Agent â€” Multi-Section Real Quantum Discovery")
    print(f"{'='*60}")
    print(f"Connecting to Chrome at {CDP_URL}...\n")

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            print(f"ERROR: Could not connect to Chrome: {e}")
            print(f"Launch Chrome with: chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session")
            return

        # Find Real Quantum tab
        page = None
        assignment_uuid = None
        for context in browser.contexts:
            for pg in context.pages:
                url = pg.url or ''
                if 'realquantumapp.com' in url or 'realquantum.com' in url:
                    page = pg
                    # Extract UUID from URL
                    parts = url.split('/assignments/')
                    if len(parts) > 1:
                        assignment_uuid = parts[1].split('/')[0]
                    break
            if page:
                break

        if not page:
            print("ERROR: No Real Quantum tab found. Make sure you're logged in and have an assignment open.")
            return

        print(f"Found Real Quantum tab: {page.url}")
        print(f"Assignment UUID: {assignment_uuid}\n")

        if not assignment_uuid:
            print("ERROR: Could not extract assignment UUID from URL.")
            return

        base_url = f"https://cacc.realquantumapp.com/assignments/{assignment_uuid}"

        # First: collect nav links from current page
        print("Collecting navigation links...")
        nav_links = get_nav_links(page)
        print(f"Found {len(nav_links)} nav links")
        for link in nav_links:
            print(f"  [{link['text']}] â†’ {link['href']}")

        # Discover each section
        results = {}
        print(f"\n{'â”€'*60}")
        print("Navigating to each section...")
        print(f"{'â”€'*60}\n")

        for (field_id, section_slug, label) in SECTIONS_TO_DISCOVER:
            section_url = f"{base_url}/{section_slug}"
            print(f"â†’ {label} ({section_slug})")
            print(f"  URL: {section_url}")

            try:
                page.goto(section_url, wait_until='domcontentloaded', timeout=15000)
                time.sleep(2)  # Wait for TinyMCE to initialize

                iframes = get_tinymce_iframes(page)
                inputs  = get_text_inputs(page)

                print(f"  TinyMCE iframes: {len(iframes)}")
                for f in iframes:
                    print(f"    id={f['id']} visible={f['visible']} size={f['rect']['w']}x{f['rect']['h']}")

                print(f"  Text inputs/selects: {len(inputs)}")
                for inp in inputs[:5]:
                    print(f"    {inp['tag']} id={inp['id'] or 'â€”'} name={inp['name'] or 'â€”'}")

                results[field_id] = {
                    'label': label,
                    'section_slug': section_slug,
                    'section_url': section_url,
                    'tinymce_iframes': iframes,
                    'text_inputs': inputs,
                    'nav_links': nav_links,
                }
                print()

            except Exception as e:
                print(f"  ERROR navigating to {section_url}: {e}\n")
                results[field_id] = {'error': str(e), 'section_slug': section_slug}

        # Save raw results
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump({'assignment_uuid': assignment_uuid, 'base_url': base_url, 'sections': results}, f, indent=2, ensure_ascii=True)
        print(f"Raw discovery saved to: {OUTPUT_FILE}")

        # â”€â”€ Build field map update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        print(f"\n{'='*60}")
        print("FIELD MAP RECOMMENDATIONS")
        print(f"{'='*60}\n")

        field_map_updates = {}
        for (field_id, section_slug, label) in SECTIONS_TO_DISCOVER:
            data = results.get(field_id, {})
            if 'error' in data:
                print(f"[{field_id}] SKIPPED (error: {data['error']})")
                continue

            iframes = data.get('tinymce_iframes', [])
            # Pick the largest visible iframe (main content area)
            main_iframe = None
            if iframes:
                visible = [f for f in iframes if f['visible']]
                if visible:
                    main_iframe = max(visible, key=lambda f: f['rect']['w'] * f['rect']['h'])

            nav_href = f"{base_url}/{section_slug}"

            entry = {
                'label': label,
                'nav_selector': f"a[href*='/{section_slug}']",
                'nav_text': label,
                'nav_url': nav_href,
                'input_type': 'tinymce',
                'clear_method': 'select_all',
            }

            if main_iframe:
                entry['tinymce_iframe_id'] = main_iframe['id']
                # Derive TinyMCE editor ID from iframe ID (remove _ifr suffix)
                entry['tinymce_id'] = main_iframe['id'].replace('_ifr', '')
                entry['input_selector'] = f"iframe#{main_iframe['id']}"
                print(f"[{field_id}] âœ“ iframe={main_iframe['id']} nav=a[href*='/{section_slug}']")
            else:
                entry['tinymce_iframe_id'] = f"UNKNOWN â€” no TinyMCE found on {section_slug} page"
                entry['input_selector'] = ''
                print(f"[{field_id}] âš  No TinyMCE iframe found on {section_slug} page")

            field_map_updates[field_id] = entry

        # Save field map update
        update_file = os.path.join(AGENT_DIR, 'field_map_update.json')
        with open(update_file, 'w', encoding='utf-8') as f:
            json.dump(field_map_updates, f, indent=2, ensure_ascii=True)
        print(f"\nField map update saved to: {update_file}")
        print("Review this file, then apply it to field_maps/commercial.json")

        return field_map_updates

if __name__ == '__main__':
    discover_all()

