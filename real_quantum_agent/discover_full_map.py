"""
real_quantum_agent/discover_full_map.py
---------------------------------------
Comprehensive discovery of ALL TinyMCE text fields in Real Quantum,
including sub-sections revealed by binoculars/expand buttons.

For each section this script:
  1. Navigates to the section URL
  2. Finds ALL TinyMCE iframes (visible + hidden)
  3. Finds all buttons/icons that might reveal additional sub-sections
     (binoculars = typically a button with a search/expand icon that opens
      a modal or expands a hidden panel containing more text fields)
  4. Clicks each expand button and re-scans for new iframes
  5. Outputs a complete field map with all discovered iframe IDs

Run this with the RQ agent STOPPED (uses CDP directly, no Flask):
    python real_quantum_agent/discover_full_map.py

Output:
    real_quantum_agent/discovered_full_map.json  â€” complete field map
    real_quantum_agent/discovery_report.txt      â€” human-readable report
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright")
    sys.exit(1)

# â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CDP_URL      = 'http://127.0.0.1:9222'
AGENT_DIR    = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE  = os.path.join(AGENT_DIR, 'config.json')

try:
    with open(CONFIG_FILE) as f:
        cfg = json.load(f)
    RQ_BASE_URL = cfg.get('rq_base_url', 'https://cacc.realquantumapp.com')
except Exception:
    RQ_BASE_URL = 'https://cacc.realquantumapp.com'

# All known section slugs in Real Quantum commercial reports
SECTIONS = [
    ('introduction',        'Introduction'),
    ('market_data',         'Market Data'),
    ('property_data',       'Property Data'),
    ('highest_best_use',    'Highest & Best Use'),
    ('cost_approach',       'Cost Approach'),
    ('sale_valuation',      'Sales Comparison'),
    ('market_rent_analysis','Market Rent Analysis'),
    ('income_approach',     'Income Approach'),
    ('reconciliation',      'Reconciliation'),
]

# â”€â”€ JS helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

SCAN_IFRAMES_JS = """
() => {
    const iframes = document.querySelectorAll('iframe.tox-edit-area__iframe');
    return [...iframes].map(el => {
        const rect = el.getBoundingClientRect();
        return {
            id:      el.id,
            visible: rect.width > 0 && rect.height > 0,
            w:       Math.round(rect.width),
            h:       Math.round(rect.height),
            top:     Math.round(rect.top),
        };
    });
}
"""

SCAN_EXPAND_BUTTONS_JS = """
() => {
    // Find buttons/icons that likely reveal sub-sections:
    // - buttons with binoculars/search/expand icons
    // - buttons near TinyMCE editors
    // - buttons with title/aria-label containing keywords
    // - SVG icons that look like binoculars (search icon)
    // NOTE: className can be SVGAnimatedString on SVG elements â€” always use String()
    const keywords = ['detail', 'expand', 'view', 'more', 'search', 'binocular',
                      'additional', 'remarks', 'notes', 'comment', 'edit'];
    const results = [];

    // Check all buttons and clickable elements
    const candidates = document.querySelectorAll(
        'button, [role="button"], .btn, a[href*="detail"], a[href*="summaries"], ' +
        'a[href="#"], [data-toggle], [data-target], [class*="icon"], [class*="expand"]'
    );

    candidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const text    = (el.textContent || '').trim().toLowerCase().substring(0, 80);
        const title   = (el.title || el.getAttribute('aria-label') || '').toLowerCase();
        // Use String() to safely handle SVGAnimatedString
        const cls     = String(el.className || '').toLowerCase();
        const id      = (el.id || '').toLowerCase();
        const href    = (el.getAttribute('href') || '').toLowerCase();
        const allText = text + ' ' + title + ' ' + cls + ' ' + id + ' ' + href;

        const isKeyword = keywords.some(k => allText.includes(k));
        const hasSVG    = el.querySelector('svg') !== null;
        const isSmall   = rect.width < 80 && rect.height < 80;
        const isDetail  = href.includes('detail') || href.includes('summaries');

        if (isKeyword || (hasSVG && isSmall) || isDetail) {
            results.push({
                tag:     el.tagName.toLowerCase(),
                id:      el.id || '',
                cls:     String(el.className || '').substring(0, 80),
                title:   el.title || el.getAttribute('aria-label') || '',
                text:    text.substring(0, 40),
                href:    href.substring(0, 120),
                x:       Math.round(rect.left + rect.width / 2),
                y:       Math.round(rect.top + rect.height / 2),
                w:       Math.round(rect.width),
                h:       Math.round(rect.height),
            });
        }
    });

    return results;
}
"""

SCAN_ALL_EDITORS_JS = """
() => {
    // Also check tinymce.editors array for any initialized editors
    if (typeof tinymce === 'undefined') return [];
    return tinymce.editors.map(ed => ({
        id:      ed.id,
        visible: ed.iframeElement ? ed.iframeElement.getBoundingClientRect().width > 0 : false,
        mode:    ed.mode ? ed.mode.get() : 'unknown',
    }));
}
"""

SCAN_MODAL_IFRAMES_JS = """
() => {
    // After clicking an expand button, check for new iframes in modals/dialogs
    const modal = document.querySelector(
        '.modal, [role="dialog"], .dialog, [class*="modal"], [class*="overlay"], ' +
        '[class*="popup"], [class*="panel"][style*="display: block"]'
    );
    if (!modal) return { modal: false, iframes: [] };

    const iframes = modal.querySelectorAll('iframe.tox-edit-area__iframe');
    return {
        modal: true,
        modalClass: (modal.className || '').substring(0, 80),
        iframes: [...iframes].map(el => ({
            id:      el.id,
            visible: el.getBoundingClientRect().width > 0,
            w:       Math.round(el.getBoundingClientRect().width),
            h:       Math.round(el.getBoundingClientRect().height),
        }))
    };
}
"""

# â”€â”€ Main discovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def discover_section(page, slug, label, uuid):
    """Navigate to a section and discover all TinyMCE fields including sub-sections."""
    url = f"{RQ_BASE_URL}/assignments/{uuid}/{slug}"
    print(f"\n{'='*60}")
    print(f"SECTION: {label} ({slug})")
    print(f"URL: {url}")
    print('='*60)

    # Navigate
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=15000)
        time.sleep(2.5)
    except Exception as e:
        print(f"  ERROR navigating: {e}")
        return {'slug': slug, 'label': label, 'error': str(e), 'iframes': [], 'sub_sections': []}

    result = {
        'slug':        slug,
        'label':       label,
        'url':         url,
        'iframes':     [],
        'sub_sections': [],
        'expand_buttons': [],
    }

    # Scan initial iframes
    iframes = page.evaluate(SCAN_IFRAMES_JS)
    print(f"  Initial TinyMCE iframes: {len(iframes)}")
    for f in iframes:
        vis = f'visible {f["w"]}x{f["h"]}' if f['visible'] else f'hidden 0x0'
        print(f"    [{vis}] id={f['id']}")
    result['iframes'] = iframes

    # Scan tinymce.editors
    try:
        editors = page.evaluate(SCAN_ALL_EDITORS_JS)
        if editors:
            print(f"  tinymce.editors initialized: {len(editors)}")
            for ed in editors:
                print(f"    id={ed['id']} visible={ed['visible']} mode={ed['mode']}")
    except Exception:
        pass

    # Scan for expand/binoculars buttons
    buttons = page.evaluate(SCAN_EXPAND_BUTTONS_JS)
    print(f"  Expand/binoculars buttons found: {len(buttons)}")
    for b in buttons[:20]:  # cap at 20
        print(f"    [{b['tag']}] id={b['id']} cls={b['cls'][:50]} title='{b['title']}' text='{b['text']}' @ ({b['x']},{b['y']})")
    result['expand_buttons'] = buttons

    # Click each expand button and check for new iframes
    sub_sections = []
    for i, btn in enumerate(buttons[:10]):  # try first 10 buttons
        try:
            print(f"\n  Clicking button {i+1}: '{btn['title'] or btn['text'] or btn['cls'][:30]}' @ ({btn['x']},{btn['y']})")
            page.mouse.click(btn['x'], btn['y'])
            time.sleep(1.5)

            # Check for modal/dialog with new iframes
            modal_result = page.evaluate(SCAN_MODAL_IFRAMES_JS)
            if modal_result.get('modal') and modal_result.get('iframes'):
                print(f"    MODAL OPENED: {modal_result['modalClass'][:60]}")
                for mf in modal_result['iframes']:
                    print(f"      iframe id={mf['id']} visible={mf['visible']} {mf['w']}x{mf['h']}")
                sub_sections.append({
                    'trigger_button': btn,
                    'modal_class': modal_result['modalClass'],
                    'iframes': modal_result['iframes'],
                })
                # Close modal (try Escape)
                page.keyboard.press('Escape')
                time.sleep(0.5)
            else:
                # Check if new iframes appeared on the page (accordion/expand)
                new_iframes = page.evaluate(SCAN_IFRAMES_JS)
                new_visible = [f for f in new_iframes if f['visible'] and f not in iframes]
                if new_visible:
                    print(f"    NEW VISIBLE IFRAMES after click:")
                    for nf in new_visible:
                        print(f"      id={nf['id']} {nf['w']}x{nf['h']}")
                    sub_sections.append({
                        'trigger_button': btn,
                        'modal_class': None,
                        'iframes': new_visible,
                    })

        except Exception as e:
            print(f"    Button click failed: {e}")

    result['sub_sections'] = sub_sections

    # Take screenshot
    try:
        ss_path = os.path.join(AGENT_DIR, f'discovery_{slug}.png')
        page.screenshot(path=ss_path, full_page=True)
        print(f"\n  Screenshot: {ss_path}")
    except Exception:
        pass

    return result


def main():
    print("Appraisal Agent â€” Real Quantum Full Field Map Discovery")
    print("="*60)
    print(f"CDP: {CDP_URL}")
    print(f"RQ Base: {RQ_BASE_URL}")
    print()

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)

        # Find RQ tab
        page = None
        for ctx in browser.contexts:
            for pg in ctx.pages:
                if 'realquantum' in (pg.url or '').lower():
                    page = pg
                    break
            if page:
                break

        if not page:
            print("ERROR: No Real Quantum tab found.")
            print("Launch Chrome with --remote-debugging-port=9222 and open a RQ assignment.")
            sys.exit(1)

        print(f"Found RQ tab: {page.url}")

        # Extract UUID from current URL
        url = page.url
        if '/assignments/' not in url:
            print("ERROR: Not on an assignment page. Navigate to an assignment first.")
            sys.exit(1)

        uuid = url.split('/assignments/')[1].split('/')[0]
        print(f"Assignment UUID: {uuid}")

        # Discover all sections
        all_results = []
        for slug, label in SECTIONS:
            result = discover_section(page, slug, label, uuid)
            all_results.append(result)

        # Write JSON output
        out_json = os.path.join(AGENT_DIR, 'discovered_full_map.json')
        with open(out_json, 'w') as f:
            json.dump(all_results, f, indent=2)
        print(f"\n\nFull map saved: {out_json}")

        # Write human-readable report
        out_txt = os.path.join(AGENT_DIR, 'discovery_report.txt')
        with open(out_txt, 'w') as f:
            f.write("Appraisal Agent â€” Real Quantum Full Field Discovery Report\n")
            f.write("="*60 + "\n\n")
            for r in all_results:
                f.write(f"SECTION: {r['label']} ({r['slug']})\n")
                f.write(f"  URL: {r['url']}\n")
                if r.get('error'):
                    f.write(f"  ERROR: {r['error']}\n\n")
                    continue
                f.write(f"  TinyMCE iframes ({len(r['iframes'])}):\n")
                for fr in r['iframes']:
                    vis = f"visible {fr['w']}x{fr['h']}" if fr['visible'] else "hidden"
                    f.write(f"    [{vis}] {fr['id']}\n")
                if r['sub_sections']:
                    f.write(f"  Sub-sections via expand buttons ({len(r['sub_sections'])}):\n")
                    for ss in r['sub_sections']:
                        btn = ss['trigger_button']
                        f.write(f"    Button: '{btn.get('title') or btn.get('text') or btn['cls'][:40]}'\n")
                        for sf in ss['iframes']:
                            f.write(f"      iframe: {sf['id']}\n")
                f.write("\n")

        print(f"Report saved: {out_txt}")

        # Print summary
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)
        total_iframes = sum(len(r.get('iframes', [])) for r in all_results)
        total_sub     = sum(len(r.get('sub_sections', [])) for r in all_results)
        print(f"Sections scanned:     {len(all_results)}")
        print(f"Total iframes found:  {total_iframes}")
        print(f"Sub-sections found:   {total_sub}")
        print()
        print("Next step: Review discovered_full_map.json and update")
        print("field_maps/commercial.json with all sub-section entries.")


if __name__ == '__main__':
    main()

