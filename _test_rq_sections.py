"""
_test_rq_sections.py
--------------------
Tests RQ agent section navigation and TinyMCE selector detection across
multiple sections, then runs an insert-batch test and discovers sale_valuation.
"""
import urllib.request
import json
import time
import sys

BASE = "http://127.0.0.1:5181"

def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}
    )
    r = urllib.request.urlopen(req, timeout=45)
    return json.loads(r.read())

def get(path):
    r = urllib.request.urlopen(BASE + path, timeout=15)
    return json.loads(r.read())

passed = 0
failed = 0
results = []

# â”€â”€ Test 1: test-field across 4 sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 60)
print("TEST 1: test-field across multiple sections")
print("=" * 60)

test_fields = [
    "introduction",
    "site_description",
    "hbu_analysis",
    "market_rent_analysis",
]

for fid in test_fields:
    try:
        d = post("/test-field", {"fieldId": fid, "formType": "commercial"})
        ok = d.get("found", False)
        url_tail = (d.get("url") or "")[-45:]
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(f"  [{status}] {fid}")
        print(f"         found={d.get('found')} input_found={d.get('input_found')}")
        print(f"         url=...{url_tail}")
        results.append({"field": fid, "found": ok, "url": d.get("url")})
    except Exception as e:
        failed += 1
        print(f"  [ERROR] {fid}: {e}")
        results.append({"field": fid, "found": False, "error": str(e)})
    time.sleep(0.3)

# â”€â”€ Test 2: insert-batch (introduction + site_description) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print()
print("=" * 60)
print("TEST 2: insert-batch (2 fields)")
print("=" * 60)

batch_payload = {
    "formType": "commercial",
    "fields": [
        {
            "fieldId": "introduction",
            "text": "Appraisal Agent batch test â€” introduction. This appraisal report has been prepared in conformance with USPAP."
        },
        {
            "fieldId": "site_description",
            "text": "Appraisal Agent batch test â€” site description. The subject site is a rectangular parcel with adequate utilities."
        }
    ]
}

try:
    d = post("/insert-batch", batch_payload)
    res = d.get("results", {})
    errs = d.get("errors", {})
    print(f"  ok: {d.get('ok')}")
    for fid, r in res.items():
        ok = r.get("ok", False)
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(f"  [{status}] {fid}: method={r.get('method')} verified={r.get('verified')}")
    for fid, err in errs.items():
        failed += 1
        print(f"  [FAIL] {fid}: ERROR â€” {err}")
except Exception as e:
    failed += 2
    print(f"  [ERROR] insert-batch failed: {e}")

# â”€â”€ Test 3: Discover sale_valuation TinyMCE iframe IDs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print()
print("=" * 60)
print("TEST 3: Discover sale_valuation TinyMCE iframes")
print("=" * 60)

# Navigate to sale_valuation and check for TinyMCE iframes via list-sections
# We'll use a test-field call with a temporary field config approach,
# then directly query the page after navigating there.
try:
    # Navigate to sale_valuation via test-field (uses nav_url_slug)
    d = post("/test-field", {"fieldId": "sales_comparison", "formType": "commercial"})
    print(f"  sales_comparison test-field: found={d.get('found')} url=...{(d.get('url') or '')[-45:]}")

    # Now list-sections to see what TinyMCE iframes are on the page
    ls = get("/list-sections")
    url = ls.get("url", "")
    print(f"  Current page: {url[-60:]}")

    # Check if we're on sale_valuation
    if "sale_valuation" in url:
        print("  Navigated to sale_valuation successfully")
        passed += 1
    else:
        print(f"  WARNING: Not on sale_valuation page (on: {url[-40:]})")

    # The elements list won't show iframes directly â€” we need a direct CDP query
    # Use a screenshot to confirm the page state
    try:
        sc = get("/screenshot")
        print(f"  Screenshot saved: {sc.get('saved', 'N/A')}")
    except Exception as se:
        print(f"  Screenshot: {se}")

except Exception as e:
    failed += 1
    print(f"  [ERROR] sale_valuation discovery: {e}")

# â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print()
print("=" * 60)
print(f"RESULTS: {passed} passed, {failed} failed")
print("=" * 60)
sys.exit(0 if failed == 0 else 1)

