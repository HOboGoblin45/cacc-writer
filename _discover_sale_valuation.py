"""
_discover_sale_valuation.py
---------------------------
Discovers TinyMCE iframe IDs on the sale_valuation page via CDP.
Runs directly (not through the Flask agent) to avoid threading constraints.
"""
import json
import sys
import time
sys.path.insert(0, 'real_quantum_agent')

from playwright.sync_api import sync_playwright

CDP_URL = 'http://127.0.0.1:9222'
UUID    = 'feb03938-8e5f-4327-8230-0e31d20a6b2c'
URL     = f'https://cacc.realquantumapp.com/assignments/{UUID}/sale_valuation'

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(CDP_URL)

    # Find the RQ tab
    page = None
    for ctx in browser.contexts:
        for pg in ctx.pages:
            if 'realquantumapp' in (pg.url or ''):
                page = pg
                break
        if page:
            break

    if not page:
        print('ERROR: No Real Quantum tab found')
        sys.exit(1)

    print(f'Current URL: {page.url}')

    # Navigate to sale_valuation if not already there
    if 'sale_valuation' not in page.url:
        print(f'Navigating to: {URL}')
        page.goto(URL, wait_until='domcontentloaded', timeout=15000)
        time.sleep(3)
    else:
        print('Already on sale_valuation page')
        time.sleep(1)

    print(f'Page URL: {page.url}')
    print()

    # Query all TinyMCE iframes
    iframes = page.evaluate("""
        () => {
            const f = document.querySelectorAll('iframe.tox-edit-area__iframe');
            return [...f].map(el => ({
                id: el.id,
                visible: el.getBoundingClientRect().width > 0,
                w: Math.round(el.getBoundingClientRect().width),
                h: Math.round(el.getBoundingClientRect().height)
            }));
        }
    """)

    print(f'TinyMCE iframes on sale_valuation: {len(iframes)}')
    for f in iframes:
        vis = 'visible' if f['visible'] else 'hidden'
        print(f"  id={f['id']}  {vis}  {f['w']}x{f['h']}")

    if not iframes:
        print('No TinyMCE iframes found — checking for any editor elements...')
        els = page.evaluate("""
            () => {
                const all = document.querySelectorAll(
                    'textarea, [class*=tox], [class*=mce], [id*=text_area], iframe'
                );
                return [...all].slice(0, 20).map(e => ({
                    tag: e.tagName,
                    id: e.id,
                    cls: (e.className || '').substring(0, 60)
                }));
            }
        """)
        for e in els:
            print(f"  {e['tag']} id={e['id']} class={e['cls']}")

    # Also check tinymce.editors array
    print()
    try:
        editors = page.evaluate("""
            () => {
                if (typeof tinymce === 'undefined') return [];
                return tinymce.editors.map(ed => ({
                    id: ed.id,
                    mode: ed.mode ? ed.mode.get() : 'unknown'
                }));
            }
        """)
        print(f'tinymce.editors count: {len(editors)}')
        for ed in editors:
            print(f"  editor id={ed['id']} mode={ed['mode']}")
    except Exception as e:
        print(f'tinymce.editors query failed: {e}')

    # Determine the primary iframe ID for sales_comparison
    if iframes:
        primary = iframes[0]
        tinymce_iframe_id = primary['id']
        # TinyMCE editor ID = iframe ID without _ifr suffix
        tinymce_id = tinymce_iframe_id.replace('_ifr', '') if tinymce_iframe_id.endswith('_ifr') else tinymce_iframe_id
        print()
        print('RECOMMENDATION for commercial.json sales_comparison entry:')
        print(f'  "tinymce_id": "{tinymce_id}"')
        print(f'  "tinymce_iframe_id": "{tinymce_iframe_id}"')
        print(f'  "input_selector": "iframe#{tinymce_iframe_id}"')
