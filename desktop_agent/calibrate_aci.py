"""
desktop_agent/calibrate_aci.py
--------------------------------
Appraisal Agent — ACI Calibration Tool  (Phase 2)

PURPOSE
    Calls the running ACI agent's /calibrate endpoint and displays the
    discovered TX32 controls in a human-readable format.

    Phase 2 fix: the agent now uses descendants() instead of children()
    to find TX32 controls. This script displays the improved output so
    you can understand what ACI controls are visible and update field maps.

USAGE
    1. Open ACI with a 1004 report loaded.
    2. Start the agent:  python desktop_agent/agent.py
    3. Run this script:  python desktop_agent/calibrate_aci.py [tab]

    Optional tab argument navigates to that section first:
        python desktop_agent/calibrate_aci.py Neig
        python desktop_agent/calibrate_aci.py Site
        python desktop_agent/calibrate_aci.py Sales
        python desktop_agent/calibrate_aci.py Reco

    Without a tab argument, calibrates the current view.

WHAT IT SHOWS
    - Window title (confirms ACI is connected)
    - Current active tab
    - All TX32 controls found (title strips + content areas)
    - Label texts visible in title TX32s
    - UIA Edit controls (if any)
    - Probe results for the 5 high-value 1004 fields

OUTPUT
    Also saves results to desktop_agent/calibration_results.json
    for reference and comparison with previous runs.
"""

import sys
import json
import os
import urllib.request
import urllib.error
from datetime import datetime

AGENT_URL  = 'http://localhost:5180'
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'calibration_results.json')

# High-value fields to probe after calibration
PROBE_FIELDS = [
    ('neighborhood_description', '1004'),
    ('site_comments',            '1004'),
    ('improvements_condition',   '1004'),
    ('sales_comparison_commentary', '1004'),
    ('reconciliation',           '1004'),
]


def _get(path: str) -> dict:
    url = AGENT_URL + path
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        print(f"  ERROR: Could not reach agent at {url}")
        print(f"  Make sure agent.py is running: python desktop_agent/agent.py")
        print(f"  Detail: {e}")
        sys.exit(1)


def _post(path: str, body: dict) -> dict:
    url  = AGENT_URL + path
    data = json.dumps(body).encode()
    req  = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        print(f"  ERROR: POST {url} failed: {e}")
        return {'ok': False, 'error': str(e)}


def _bar(n: int, total: int, width: int = 30) -> str:
    filled = int(width * n / max(total, 1))
    return '[' + '█' * filled + '░' * (width - filled) + f'] {n}/{total}'


def _sep(char: str = '─', width: int = 70) -> None:
    print(char * width)


def main():
    tab_arg = sys.argv[1] if len(sys.argv) > 1 else ''

    print()
    _sep('═')
    print('  Appraisal Agent — ACI Calibration Tool  (Phase 2)')
    _sep('═')
    print()

    # ── Health check ──────────────────────────────────────────────────────────
    print('Checking agent health...')
    health = _get('/health')
    if not health.get('ok'):
        print('  ERROR: Agent returned not-ok on /health')
        sys.exit(1)

    print(f"  Agent:      {health.get('agent')} v{health.get('version')}")
    print(f"  Phase:      {health.get('phase')}")
    print(f"  pywinauto:  {health.get('pywinauto')}")
    print(f"  pyperclip:  {health.get('pyperclip')}")
    print(f"  win32:      {health.get('win32')}")
    print(f"  Learned:    {health.get('learned_targets')} entries")
    print()

    if not health.get('pywinauto'):
        print('  WARNING: pywinauto not available — agent is in stub mode.')
        print('  Install: pip install pywinauto pyperclip pillow pywin32')
        print()

    # ── Calibrate ─────────────────────────────────────────────────────────────
    tab_suffix = f'?tab={tab_arg}' if tab_arg else ''
    print(f"Running calibration{' (tab: ' + tab_arg + ')' if tab_arg else ''}...")
    cal = _get(f'/calibrate{tab_suffix}')

    if not cal.get('ok'):
        print(f"  ERROR: Calibration failed: {cal.get('error')}")
        sys.exit(1)

    print()
    _sep()
    print(f"  Window:      {cal.get('window')}")
    print(f"  Current tab: {cal.get('current_tab')}")
    print(f"  Tab requested: {cal.get('tab_requested') or '(none)'}")
    _sep()
    print()

    total_tx32 = cal.get('total_tx32', 0)
    tx32_ctrls = cal.get('tx32_controls', [])

    if total_tx32 == 0:
        print('  ⚠  NO TX32 CONTROLS FOUND.')
        print()
        print('  Possible causes:')
        print('  1. ACI is not open or no report is loaded.')
        print('  2. The ACI window pattern does not match.')
        print(f"     Current pattern: {health.get('agent')} — check config.json aci_window_pattern")
        print('  3. Run GET http://localhost:5180/list-windows to see open windows.')
        print()
    else:
        print(f"  TX32 controls found: {total_tx32}")
        print()

        # Separate by type
        title_ctrls   = [c for c in tx32_ctrls if c.get('type') == 'title']
        content_ctrls = [c for c in tx32_ctrls if c.get('type') == 'content']
        mid_ctrls     = [c for c in tx32_ctrls if c.get('type') == 'mid']

        print(f"  Title strips  (h ≤ 70px):  {len(title_ctrls)}")
        print(f"  Content areas (h ≥ 120px): {len(content_ctrls)}")
        print(f"  Mid-size      (70-120px):  {len(mid_ctrls)}")
        print()

        if title_ctrls:
            print('  LABEL TEXTS (from title TX32 strips):')
            for c in title_ctrls:
                txt = c.get('text', '').strip()
                if txt:
                    print(f"    • {txt[:60]}")
            print()

        if content_ctrls:
            print('  CONTENT AREAS (editable TX32 fields):')
            for i, c in enumerate(content_ctrls):
                txt = c.get('text', '').strip()
                print(f"    [{i}] left={c['left']:4d} top={c['top']:4d} "
                      f"w={c['width']:4d} h={c['height']:4d}"
                      + (f"  text='{txt[:40]}'" if txt else ''))
            print()

        if mid_ctrls:
            print('  MID-SIZE TX32 (may be labels or small editors):')
            for c in mid_ctrls:
                txt = c.get('text', '').strip()
                print(f"    left={c['left']:4d} top={c['top']:4d} "
                      f"w={c['width']:4d} h={c['height']:4d}"
                      + (f"  text='{txt[:40]}'" if txt else ''))
            print()

    # UIA Edit controls
    uia_ctrls = cal.get('uia_edit_controls', [])
    if uia_ctrls:
        print(f"  UIA Edit controls: {len(uia_ctrls)}")
        for c in uia_ctrls[:10]:
            aid = c.get('automation_id', '')
            cls = c.get('class_name', '')
            print(f"    auto_id='{aid}' class='{cls}' "
                  f"left={c['left']} top={c['top']} "
                  f"w={c['width']} h={c['height']}")
        print()

    # Label texts summary
    label_texts = cal.get('label_texts', [])
    if label_texts:
        print(f"  All visible label texts ({len(label_texts)}):")
        for lt in label_texts:
            print(f"    • {lt[:60]}")
        print()

    # ── Probe high-value fields ───────────────────────────────────────────────
    print()
    _sep()
    print('  PROBING HIGH-VALUE FIELDS')
    _sep()
    print()

    probe_results = {}
    for field_id, form_type in PROBE_FIELDS:
        print(f"  Probing: {field_id} ({form_type})...")
        result = _post('/probe', {'fieldId': field_id, 'formType': form_type})
        probe_results[field_id] = result

        if not result.get('ok'):
            print(f"    ✗ Error: {result.get('error')}")
            continue

        disc  = result.get('tx32_discovered', {})
        best  = result.get('best_candidate')
        score = result.get('score', 0)
        meth  = result.get('method', '')
        tab   = result.get('tabName', '')
        nav   = result.get('tabNavigated', False)

        status = '✓' if best else '✗'
        print(f"    {status} tab='{tab}' navigated={nav} "
              f"tx32_total={disc.get('total',0)} "
              f"content={disc.get('content',0)} "
              f"score={score} method={meth}")

        if best and not best.get('error'):
            preview = best.get('text_preview', '').strip()[:50]
            print(f"      Best: left={best.get('left')} top={best.get('top')} "
                  f"w={best.get('width')} h={best.get('height')}"
                  + (f"  existing='{preview}'" if preview else ''))

        learned = result.get('learned_target')
        if learned:
            print(f"      Learned: strategy={learned.get('strategy')} "
                  f"n={learned.get('success_count')} "
                  f"last={learned.get('last_success','')[:10]}")
        print()

    # ── Save results ──────────────────────────────────────────────────────────
    output = {
        'timestamp':     datetime.now().isoformat(),
        'tab_requested': tab_arg or None,
        'health':        health,
        'calibration':   cal,
        'probe_results': probe_results,
    }
    try:
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"  Results saved: {OUTPUT_FILE}")
    except Exception as e:
        print(f"  WARNING: Could not save results: {e}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    _sep('═')
    found_count = sum(
        1 for r in probe_results.values()
        if r.get('ok') and r.get('best_candidate') and not r.get('best_candidate', {}).get('error')
    )
    print(f"  SUMMARY: {found_count}/{len(PROBE_FIELDS)} high-value fields located")
    print()

    if total_tx32 == 0:
        print('  ACTION REQUIRED: No TX32 controls found.')
        print('  → Make sure ACI is open with a 1004 report loaded.')
        print('  → Check aci_window_pattern in desktop_agent/config.json')
        print('  → Run: GET http://localhost:5180/list-windows')
    elif found_count == len(PROBE_FIELDS):
        print('  ✓ All high-value fields located. Agent is ready for insertion.')
        print('  → Run: python _test_aci_live.py 1004')
    elif found_count >= 3:
        print('  ✓ Most fields located. Agent should work for primary fields.')
        print('  → Run: python _test_aci_live.py 1004')
        print('  → For missing fields, try calibrating with specific tab:')
        print('    python desktop_agent/calibrate_aci.py <TabName>')
    else:
        print('  ⚠  Few fields located. Check TX32 discovery above.')
        print('  → Try calibrating with a specific tab:')
        print('    python desktop_agent/calibrate_aci.py Neig')
        print('    python desktop_agent/calibrate_aci.py Site')
        print('    python desktop_agent/calibrate_aci.py Sales')

    _sep('═')
    print()


if __name__ == '__main__':
    main()
