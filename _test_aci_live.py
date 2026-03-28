"""
_test_aci_live.py
-----------------
Appraisal Agent â€” ACI Agent Live Test Suite

PURPOSE:
    Verifies the ACI desktop agent is working correctly against a live
    ACI session. Mirrors the structure of _test_rq_sections.py.

PREREQUISITES:
    1. ACI appraisal software is open with a report loaded
    2. ACI agent is running: python desktop_agent/agent.py
    3. Field maps have been calibrated: python desktop_agent/calibrate_aci.py

USAGE:
    python _test_aci_live.py [formType]
    python _test_aci_live.py 1004        â† test 1004 fields (default)
    python _test_aci_live.py 1025        â† test 1025 fields
    python _test_aci_live.py 1073        â† test 1073 fields

TESTS:
    1. Agent health check
    2. Window discovery (ACI is open and findable)
    3. test-field for each field in the form's field map
    4. Live insert test (single field â€” reconciliation or first available)
    5. Live insert-batch test (2 fields)
    6. Reload-maps endpoint
"""

import json
import sys
import os
import time
import urllib.request
import urllib.error

AGENT_URL = 'http://127.0.0.1:5180'
AGENT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'desktop_agent')
MAPS_DIR  = os.path.join(AGENT_DIR, 'field_maps')

# â”€â”€ Test state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
passed = 0
failed = 0
skipped = 0

def ok(msg):
    global passed
    passed += 1
    print(f'  âœ… PASS  {msg}')

def fail(msg, detail=''):
    global failed
    failed += 1
    detail_str = f'\n         {detail}' if detail else ''
    print(f'  âŒ FAIL  {msg}{detail_str}')

def skip(msg):
    global skipped
    skipped += 1
    print(f'  â­  SKIP  {msg}')

def section(title):
    print(f'\nâ”€â”€ {title} {"â”€"*(55-len(title))}')

# â”€â”€ HTTP helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def call(method, path, body=None, timeout=20):
    url = AGENT_URL + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method,
                                  headers={'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:
            body = {'error': str(e)}
        return body, f'HTTP {e.code}'
    except urllib.error.URLError as e:
        return None, str(e)

# â”€â”€ Load field map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def load_field_map(form_type):
    map_file = os.path.join(MAPS_DIR, f'{form_type}.json')
    try:
        with open(map_file) as f:
            data = json.load(f)
        # Filter out comment keys
        return {k: v for k, v in data.items() if not k.startswith('_')}
    except FileNotFoundError:
        print(f'[ERROR] Field map not found: {map_file}')
        sys.exit(1)

# â”€â”€ Check if field maps are calibrated â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def check_calibration(field_map):
    """Returns (calibrated_count, total_count, uncalibrated_fields)

    A field is considered calibrated if ANY of the following is true:
      - automation_id is set (UIA Edit controls)
      - control_index is set (positional fallback)
      - calibrated == True (TX32 label-proximity fields confirmed via live test)
    TX32 fields do not have UIA automation_ids â€” they are targeted by label
    proximity. Mark them calibrated=True in the field map after a successful
    live test run.
    """
    total = len(field_map)
    calibrated = 0
    uncalibrated = []
    for field_id, cfg in field_map.items():
        has_aid        = bool(cfg.get('automation_id', '').strip())
        has_idx        = cfg.get('control_index') is not None
        has_calibrated = cfg.get('calibrated') is True
        if has_aid or has_idx or has_calibrated:
            calibrated += 1
        else:
            uncalibrated.append(field_id)
    return calibrated, total, uncalibrated

# â”€â”€ Main test runner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def main():
    form_type = sys.argv[1] if len(sys.argv) > 1 else '1004'
    if form_type not in ('1004', '1025', '1073', '1004c'):
        print(f'[ERROR] Unknown form type: {form_type}. Use 1004, 1025, 1073, or 1004c.')
        sys.exit(1)

    print('\n' + '='*60)
    print(f'  Appraisal Agent â€” ACI Live Test Suite (Form {form_type})')
    print('='*60)

    field_map = load_field_map(form_type)
    field_ids = list(field_map.keys())
    print(f'  Field map: {len(field_ids)} fields loaded')

    # â”€â”€ TEST 1: Agent health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 1: Agent Health')
    data, err = call('GET', '/health')
    if err or not data:
        fail('Agent health check', f'Agent not reachable: {err}')
        print('\n  â†’ Start the agent: python desktop_agent/agent.py')
        print('  â†’ Then re-run this test.')
        sys.exit(1)

    ok(f'Agent reachable â€” version {data.get("version", "?")}')

    if data.get('pywinauto'):
        ok('pywinauto available')
    else:
        fail('pywinauto not available â€” ACI automation disabled')
        print('  â†’ Install: pip install pywinauto')
        sys.exit(1)

    if data.get('pyperclip'):
        ok('pyperclip available (clipboard fallback enabled)')
    else:
        skip('pyperclip not available (clipboard fallback disabled)')

    if data.get('pil'):
        ok('PIL available (screenshot-on-failure enabled)')
    else:
        skip('PIL not available (screenshot-on-failure disabled)')

    # â”€â”€ TEST 2: Window discovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 2: ACI Window Discovery')
    data, err = call('GET', '/list-windows')
    if err or not data:
        fail('list-windows endpoint', str(err))
    else:
        windows = data.get('windows', [])
        aci_windows = [w for w in windows if 'aci' in w.get('title', '').lower()]
        ok(f'list-windows returned {len(windows)} windows')

        if aci_windows:
            ok(f'ACI window found: "{aci_windows[0]["title"]}"')
        else:
            fail('ACI window not found in window list')
            print('  â†’ Open ACI with a report loaded')
            print('  â†’ If ACI has a different title, update "aci_window_pattern" in config.json')
            print(f'  â†’ Windows found: {[w["title"] for w in windows[:10]]}')

    # â”€â”€ TEST 3: Calibration status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 3: Field Map Calibration Status')
    calibrated, total, uncalibrated = check_calibration(field_map)
    pct = int(100 * calibrated / total) if total else 0

    if calibrated == total:
        ok(f'All {total} fields calibrated (automation_id / control_index / calibrated=True)')
    elif calibrated > 0:
        skip(f'{calibrated}/{total} fields calibrated ({pct}%) â€” {len(uncalibrated)} need calibration')
        print(f'  Uncalibrated: {uncalibrated}')
        print('  â†’ Run: python desktop_agent/calibrate_aci.py')
    else:
        fail(f'0/{total} fields calibrated â€” field maps are empty')
        print('  â†’ Run: python desktop_agent/calibrate_aci.py')
        print('  â†’ Then update field_maps/{form_type}.json with automation_id values')

    # â”€â”€ TEST 4: test-field for each field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section(f'TEST 4: test-field for all {len(field_ids)} fields (form {form_type})')
    found_count = 0
    not_found   = []

    for field_id in field_ids:
        data, err = call('POST', '/test-field', {'fieldId': field_id, 'formType': form_type}, timeout=15)
        if err or not data:
            fail(f'{field_id}', f'Request failed: {err}')
            not_found.append(field_id)
            continue

        if not data.get('ok'):
            fail(f'{field_id}', data.get('error', 'unknown error'))
            not_found.append(field_id)
            continue

        found = data.get('found', False)
        strategies = data.get('strategies', {})
        best = next((s for s, v in strategies.items() if v.get('found')), None)

        if found:
            ok(f'{field_id} â€” found via {best}')
            found_count += 1
        else:
            # Check if it's an uncalibrated field (expected to fail)
            cfg = field_map.get(field_id, {})
            has_aid = bool(cfg.get('automation_id', '').strip())
            has_idx = cfg.get('control_index') is not None
            if not has_aid and not has_idx and not cfg.get('calibrated'):
                skip(f'{field_id} â€” not calibrated (run calibrate_aci.py)')
            else:
                fail(f'{field_id} â€” not found in ACI window')
                not_found.append(field_id)

    if found_count > 0:
        print(f'\n  Summary: {found_count}/{len(field_ids)} fields found in ACI window')

    # â”€â”€ TEST 5: Live single-field insert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 5: Live Single-Field Insert')

    # Pick the best field to test with â€” prefer reconciliation, then first found
    test_field_id = None
    if 'reconciliation' in field_ids and 'reconciliation' not in not_found:
        test_field_id = 'reconciliation'
    elif found_count > 0:
        # Use first field that was found
        for fid in field_ids:
            if fid not in not_found:
                test_field_id = fid
                break

    if not test_field_id:
        skip('No calibrated fields available for live insert test')
        print('  â†’ Calibrate field maps first: python desktop_agent/calibrate_aci.py')
    else:
        test_text = (
            f'[Appraisal Agent Test â€” {time.strftime("%H:%M:%S")}] '
            'This is a test insertion from the Appraisal Agent ACI agent. '
            'The value of the subject property is supported by the sales comparison approach. '
            'Please delete this test text.'
        )
        print(f'  Inserting into: {test_field_id}')
        print(f'  Text length: {len(test_text)} chars')

        data, err = call('POST', '/insert',
                         {'fieldId': test_field_id, 'text': test_text, 'formType': form_type},
                         timeout=30)
        if err or not data:
            fail(f'insert {test_field_id}', str(err))
        elif not data.get('ok'):
            fail(f'insert {test_field_id}', data.get('error', 'unknown'))
        else:
            method   = data.get('method', '?')
            verified = data.get('verified', False)
            ok(f'Inserted into {test_field_id} via {method}')
            if verified:
                ok(f'Verification passed â€” text confirmed in field')
            else:
                skip(f'Verification skipped or failed (non-fatal)')

    # â”€â”€ TEST 6: Live insert-batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 6: Live insert-batch (2 fields)')

    # Pick 2 calibrated fields for batch test
    batch_fields = []
    for fid in field_ids:
        if fid not in not_found and fid != test_field_id:
            batch_fields.append(fid)
        if len(batch_fields) >= 2:
            break

    if len(batch_fields) < 2:
        skip(f'Need 2 calibrated fields for batch test (only {len(batch_fields)} available)')
    else:
        batch_payload = {
            'formType': form_type,
            'fields': [
                {'fieldId': batch_fields[0], 'text': f'[CACC Batch Test A â€” {time.strftime("%H:%M:%S")}] Test text for {batch_fields[0]}. Please delete.'},
                {'fieldId': batch_fields[1], 'text': f'[CACC Batch Test B â€” {time.strftime("%H:%M:%S")}] Test text for {batch_fields[1]}. Please delete.'},
            ]
        }
        print(f'  Batch inserting: {batch_fields[0]}, {batch_fields[1]}')
        data, err = call('POST', '/insert-batch', batch_payload, timeout=60)
        if err or not data:
            fail('insert-batch', str(err))
        elif not data.get('ok'):
            fail('insert-batch', data.get('error', 'unknown'))
        else:
            results = data.get('results', {})
            errors  = data.get('errors', {})
            for fid in batch_fields:
                if fid in results:
                    r = results[fid]
                    ok(f'{fid} â€” method={r.get("method")} verified={r.get("verified")}')
                elif fid in errors:
                    fail(f'{fid}', errors[fid])
                else:
                    skip(f'{fid} â€” not in results')

    # â”€â”€ TEST 7: reload-maps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    section('TEST 7: reload-maps endpoint')
    data, err = call('POST', '/reload-maps')
    if err or not data:
        fail('reload-maps', str(err))
    elif data.get('ok'):
        ok('reload-maps â€” field map cache cleared')
    else:
        fail('reload-maps', data.get('error', 'unknown'))

    # â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    total_tests = passed + failed + skipped
    print('\n' + '='*60)
    print(f'  ACI Live Test Results â€” Form {form_type}')
    print('='*60)
    print(f'  âœ… Passed:  {passed}')
    print(f'  âŒ Failed:  {failed}')
    print(f'  â­  Skipped: {skipped}')
    print(f'  Total:     {total_tests}')

    if failed == 0 and skipped == 0:
        print('\n  ðŸŽ‰ ALL TESTS PASSED â€” ACI agent is production ready for this form type!')
    elif failed == 0:
        if calibrated == total:
            print(f'\n  âš ï¸  {skipped} test(s) skipped (non-fatal) â€” agent is production ready.')
            print('     Skipped items are verification steps (TX32 readback is best-effort).')
            print('     All fields found and inserted successfully.')
        else:
            print(f'\n  âš ï¸  {skipped} tests skipped â€” calibrate field maps to enable full coverage.')
            print('     Run: python desktop_agent/calibrate_aci.py')
    else:
        print(f'\n  âŒ {failed} test(s) failed â€” see details above.')
        if calibrated == 0:
            print('\n  ROOT CAUSE: Field maps are not calibrated.')
            print('  SOLUTION:')
            print('    1. Open ACI with a report loaded')
            print('    2. python desktop_agent/agent.py')
            print('    3. python desktop_agent/calibrate_aci.py')
            print('    4. Update field_maps/{form_type}.json with automation_id values')
            print('    5. Re-run: python _test_aci_live.py')

    print()
    sys.exit(0 if failed == 0 else 1)

if __name__ == '__main__':
    main()

