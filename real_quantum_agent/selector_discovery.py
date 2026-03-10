"""
real_quantum_agent/selector_discovery.py
-----------------------------------------
Helper script to discover CSS selectors in Real Quantum's web interface.

Run this ONCE after opening your commercial report in Chrome to get a full
dump of all interactive elements on the page. Use the output to update
field_maps/commercial.json with the correct selectors.

Usage:
    1. Launch Chrome with remote debugging:
       chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session
    2. Log into Real Quantum and open a commercial report
    3. Navigate to the section you want to map (e.g., Site Description)
    4. Run: python real_quantum_agent/selector_discovery.py
    5. Review the output and copy the correct selectors into field_maps/commercial.json

Output files:
    real_quantum_agent/discovered_elements.json  — full element dump
    real_quantum_agent/selector_report.txt       — human-readable report
"""

import json
import os
import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed.")
    print("Run: pip install playwright && playwright install chromium")
    sys.exit(1)

AGENT_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(AGENT_DIR, 'config.json')

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

config   = load_config()
CDP_URL  = config.get('cdp_url', 'http://localhost:9222')
RQ_URL   = config.get('rq_base_url', 'https://app.realquantum.com')

def discover_elements():
    print(f"\n{'='*60}")
    print("CACC Writer — Real Quantum Selector Discovery")
    print(f"{'='*60}")
    print(f"Connecting to Chrome at {CDP_URL}...")
    print("Make sure Chrome is open with your Real Quantum report.\n")

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            print(f"ERROR: Could not connect to Chrome: {e}")
            print(f"\nLaunch Chrome with:")
            print(f"  chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\rq-session")
            return

        # Find Real Quantum tab
        page = None
        for context in browser.contexts:
            for pg in context.pages:
                if 'realquantum' in (pg.url or '').lower():
                    page = pg
                    break
            if page:
                break

        if not page and browser.contexts and browser.contexts[0].pages:
            page = browser.contexts[0].pages[0]
            print(f"WARNING: Real Quantum tab not found by URL. Using: {page.url}")
        elif page:
            print(f"Found Real Quantum tab: {page.url}")
        else:
            print("ERROR: No browser tabs found.")
            return

        print(f"\nCurrent page URL: {page.url}")
        print(f"Page title: {page.title()}\n")

        # ── Collect all interactive elements ──────────────────────────────────
        print("Scanning page for interactive elements...")

        elements = page.evaluate("""
            () => {
                const results = [];

                // Target all potentially relevant elements
                const queries = [
                    { sel: 'textarea',                    type: 'textarea' },
                    { sel: 'input[type="text"]',          type: 'text_input' },
                    { sel: '[contenteditable="true"]',    type: 'contenteditable' },
                    { sel: '.tox-edit-area iframe',       type: 'tinymce_iframe' },
                    { sel: '.mce-content-body',           type: 'tinymce_body' },
                    { sel: 'nav a',                       type: 'nav_link' },
                    { sel: '.nav-item a',                 type: 'nav_item' },
                    { sel: '[data-section]',              type: 'data_section' },
                    { sel: '[data-field]',                type: 'data_field' },
                    { sel: '[data-tab]',                  type: 'data_tab' },
                    { sel: '.tab-link',                   type: 'tab_link' },
                    { sel: '.section-nav a',              type: 'section_nav' },
                    { sel: 'button[type="button"]',       type: 'button' },
                    { sel: 'label',                       type: 'label' },
                    { sel: '.form-group',                 type: 'form_group' },
                    { sel: '[class*="section"]',          type: 'section_class' },
                    { sel: '[class*="narrative"]',        type: 'narrative_class' },
                    { sel: '[class*="editor"]',           type: 'editor_class' },
                    { sel: '[id*="description"]',         type: 'id_description' },
                    { sel: '[id*="narrative"]',           type: 'id_narrative' },
                    { sel: '[id*="analysis"]',            type: 'id_analysis' },
                    { sel: '[id*="approach"]',            type: 'id_approach' },
                    { sel: '[name]',                      type: 'named_element' },
                ];

                queries.forEach(({ sel, type }) => {
                    try {
                        document.querySelectorAll(sel).forEach(el => {
                            const rect = el.getBoundingClientRect();
                            if (rect.width === 0 && rect.height === 0) return;

                            // Build a unique CSS selector for this element
                            let uniqueSel = el.tagName.toLowerCase();
                            if (el.id)   uniqueSel += '#' + el.id;
                            if (el.name) uniqueSel += '[name="' + el.name + '"]';

                            const dataAttrs = {};
                            [...el.attributes]
                                .filter(a => a.name.startsWith('data-'))
                                .forEach(a => dataAttrs[a.name] = a.value);

                            results.push({
                                query_type:   type,
                                tag:          el.tagName.toLowerCase(),
                                id:           el.id || '',
                                name:         el.name || el.getAttribute('name') || '',
                                class_list:   [...el.classList].join(' '),
                                text_content: (el.textContent || '').trim().slice(0, 120),
                                placeholder:  el.placeholder || '',
                                value_preview:(el.value || '').trim().slice(0, 60),
                                unique_sel:   uniqueSel,
                                data_attrs:   dataAttrs,
                                visible:      rect.width > 0 && rect.height > 0,
                                rect:         { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
                            });
                        });
                    } catch(e) {}
                });

                // Deduplicate by unique_sel
                const seen = new Set();
                return results.filter(r => {
                    const key = r.unique_sel + r.query_type;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }
        """)

        print(f"Found {len(elements)} unique interactive elements.\n")

        # ── Save full JSON dump ───────────────────────────────────────────────
        json_out = os.path.join(AGENT_DIR, 'discovered_elements.json')
        with open(json_out, 'w') as f:
            json.dump({'url': page.url, 'title': page.title(), 'elements': elements}, f, indent=2)
        print(f"Full element dump saved to: {json_out}")

        # ── Generate human-readable report ────────────────────────────────────
        report_lines = [
            "REAL QUANTUM SELECTOR DISCOVERY REPORT",
            f"URL: {page.url}",
            f"Title: {page.title()}",
            f"Total elements: {len(elements)}",
            "=" * 70,
            "",
        ]

        # Group by type
        by_type = {}
        for el in elements:
            t = el['query_type']
            by_type.setdefault(t, []).append(el)

        priority_types = ['textarea', 'contenteditable', 'tinymce_body', 'tinymce_iframe',
                          'nav_link', 'nav_item', 'section_nav', 'data_section', 'data_field',
                          'id_description', 'id_narrative', 'id_analysis', 'id_approach',
                          'named_element', 'label']

        for t in priority_types:
            if t not in by_type:
                continue
            report_lines.append(f"\n{'─'*50}")
            report_lines.append(f"TYPE: {t.upper()} ({len(by_type[t])} found)")
            report_lines.append(f"{'─'*50}")
            for el in by_type[t]:
                report_lines.append(f"  Tag:        {el['tag']}")
                if el['id']:
                    report_lines.append(f"  ID:         #{el['id']}")
                if el['name']:
                    report_lines.append(f"  Name:       {el['name']}")
                if el['class_list']:
                    report_lines.append(f"  Classes:    {el['class_list'][:80]}")
                if el['placeholder']:
                    report_lines.append(f"  Placeholder:{el['placeholder'][:80]}")
                if el['text_content']:
                    report_lines.append(f"  Text:       {el['text_content'][:80]}")
                if el['data_attrs']:
                    report_lines.append(f"  Data attrs: {el['data_attrs']}")
                report_lines.append(f"  Selector:   {el['unique_sel']}")
                report_lines.append(f"  Position:   x={el['rect']['x']} y={el['rect']['y']} w={el['rect']['w']} h={el['rect']['h']}")
                report_lines.append("")

        report_lines.extend([
            "",
            "=" * 70,
            "NEXT STEPS:",
            "1. Find the textarea/input for each section above",
            "2. Copy its 'Selector' or build one from its ID/name",
            "3. Update real_quantum_agent/field_maps/commercial.json",
            "   with the correct 'input_selector' and 'nav_selector' values",
            "4. Navigate to each section in Real Quantum and re-run this script",
            "   to get section-specific selectors",
            "",
            "EXAMPLE field map entry:",
            '  "site_description": {',
            '    "label": "Site Description",',
            '    "nav_selector": "a[href*=\'site\']",',
            '    "input_selector": "textarea#site_description_text",',
            '    "input_type": "textarea",',
            '    "clear_method": "select_all"',
            '  }',
        ])

        report_out = os.path.join(AGENT_DIR, 'selector_report.txt')
        with open(report_out, 'w') as f:
            f.write('\n'.join(report_lines))
        print(f"Human-readable report saved to: {report_out}")

        # ── Print summary to console ──────────────────────────────────────────
        print("\n" + "=" * 60)
        print("QUICK SUMMARY — Textareas and Inputs Found:")
        print("=" * 60)
        for el in elements:
            if el['query_type'] in ('textarea', 'text_input', 'contenteditable', 'named_element'):
                name_or_id = el['id'] or el['name'] or '(no id/name)'
                print(f"  {el['tag']:12} id={el['id'] or '—':30} name={el['name'] or '—':30} text={el['text_content'][:40]}")

        print(f"\nOpen {report_out} for the full report.")
        print(f"Open {json_out} for the raw JSON dump.")
        print("\nUpdate real_quantum_agent/field_maps/commercial.json with the correct selectors.")

if __name__ == '__main__':
    discover_elements()
