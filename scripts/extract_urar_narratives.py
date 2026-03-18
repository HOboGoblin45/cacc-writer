#!/usr/bin/env python3
"""
scripts/extract_urar_narratives.py
------------------------------------
Extract narrative text fields from a completed ACI URAR 1004 appraisal PDF.

Usage:
    python scripts/extract_urar_narratives.py <pdf_path>

Output: JSON to stdout with extracted narrative fields.
"""

import sys
import json
import re
import pdfplumber


def extract_all_pages(pdf_path):
    """Extract text from all pages."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append({"page": i + 1, "text": text})
    return pages


def clean_narrative(text, max_chars=600):
    """Clean up a narrative text block."""
    # Remove ACI footer lines
    text = re.sub(r'Freddie Mac Form.*?Fannie Mae Form.*', '', text, flags=re.DOTALL|re.IGNORECASE)
    text = re.sub(r'Produced using ACI.*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'Page \d+ of \d+.*', '', text, flags=re.IGNORECASE)
    
    # Join lines and clean whitespace
    lines = [l.strip() for l in text.split('\n')]
    # Remove lines that are pure numbers or very short
    filtered = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Skip lines that are just numbers/codes
        if re.match(r'^[\d\s$,\.%\-]+$', stripped):
            continue
        # Skip lines under 15 chars that look like labels
        if len(stripped) < 15 and stripped.upper() == stripped:
            continue
        filtered.append(stripped)
    
    result = ' '.join(filtered)
    # Clean internal whitespace
    result = re.sub(r'\s+', ' ', result).strip()
    return result[:max_chars]


def extract_narratives_from_page(text, page_num):
    """Extract narrative fields from a specific page."""
    fields = {}
    
    if page_num == 4:
        # Neighborhood Description
        # In page 4, after form labels, the actual text appears
        # Pattern: look for sentence starting with "The subject neighborhood is bordered"
        # or "The subject is located"
        nbhd_match = re.search(
            r'(The subject (?:neighborhood|is located)[^\n]{40,}(?:\n[^\n]{20,}){0,4})',
            text, re.IGNORECASE
        )
        if nbhd_match:
            raw = nbhd_match.group(1)
            # Also grab the next sentence about schools/employment if present
            after_idx = text.find(nbhd_match.group(0)) + len(nbhd_match.group(0))
            next_part = text[after_idx:after_idx+400]
            # Take lines until we hit form labels
            extra_lines = []
            for line in next_part.split('\n'):
                stripped = line.strip()
                if len(stripped) > 20 and not re.match(r'^(See Attached|Market|Dimensions|Zoning)', stripped, re.I):
                    extra_lines.append(stripped)
                else:
                    break
            fields['neighborhood_description'] = clean_narrative(raw + ' ' + ' '.join(extra_lines))

        # Market Conditions - look for sentences about typical marketing times
        mc_match = re.search(
            r'((?:Typical marketing times|typical market|market conditions are)[^\n]{30,}(?:\n[^\n]{20,}){0,4})',
            text, re.IGNORECASE
        )
        if mc_match:
            fields['market_conditions'] = clean_narrative(mc_match.group(1))

        # Adverse conditions - look for substantive sentence
        adverse_match = re.search(
            r'(There are no\s+apparent adverse site conditions[^\n]{30,}(?:\n[^\n]{20,}){0,3})',
            text, re.IGNORECASE
        )
        if adverse_match:
            fields['adverse_conditions'] = clean_narrative(adverse_match.group(1))

        # Improvements condition - look for C3; or similar rating + narrative
        condition_match = re.search(
            r'(C[1-6];[^\n]{50,}(?:\n[^\n]{30,}){0,4})',
            text, re.IGNORECASE
        )
        if condition_match:
            fields['improvements_condition'] = clean_narrative(condition_match.group(1))

        # Functional utility / additional features
        features_match = re.search(
            r'(The subject features[^\n]{50,}(?:\n[^\n]{30,})?)',
            text, re.IGNORECASE
        )
        if features_match:
            fields['functional_utility'] = clean_narrative(features_match.group(1))

        # Conforms to neighborhood
        conform_match = re.search(
            r'(The subject property\s+generally conforms[^\n]{40,})',
            text, re.IGNORECASE
        )
        if conform_match:
            fields['functional_utility_conformity'] = clean_narrative(conform_match.group(1))

    elif page_num == 5:
        # Sales comparison - look for comp analysis text
        # Pattern: text that discusses adjustments or the comparable sales
        sca_patterns = [
            r'(Comparable #\d+[^\n]{30,}(?:\n[^\n]{20,}){0,5})',
            r'(Due to the range[^\n]{30,}(?:\n[^\n]{20,}){0,3})',
            r'(the final value conclusion[^\n]{30,}(?:\n[^\n]{20,}){0,3})',
            r'(After adjustments[^\n]{30,}(?:\n[^\n]{20,}){0,3})',
        ]
        for pat in sca_patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                candidate = clean_narrative(m.group(1))
                if len(candidate) > 50:
                    existing = fields.get('sales_comparison_commentary', '')
                    if not existing or len(candidate) > len(existing):
                        fields['sales_comparison_commentary'] = candidate

        # Reconciliation — extract Charles's actual analysis, not FNMA boilerplate
        # Charles writes: "The greatest weight is applied to the Sales Comparison Approach..."
        # The FNMA boilerplate "Based on a complete visual inspection..." is NOT Charles's narrative
        recon_patterns = [
            r'(The greatest weight is applied[^\n]{30,}(?:\n[^\n]{20,}){0,6})',
            r'(greatest weight[^\n]{20,}(?:\n[^\n]{20,}){0,4})',
        ]
        for pat in recon_patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                candidate = clean_narrative(m.group(1), max_chars=800)
                if len(candidate) > 50:
                    fields['reconciliation'] = candidate
                    break

    elif page_num in range(6, 16):
        # Check addendum pages for market conditions
        if 'typical marketing times' in text.lower():
            mc_match = re.search(
                r'((?:s are considered average|Typical marketing times)[^\n]{30,}(?:\n[^\n]{20,}){0,3})',
                text, re.IGNORECASE
            )
            if mc_match:
                fields['market_conditions_addendum'] = clean_narrative(mc_match.group(1))

        # Look for highest and best use discussion
        if 'highest and best use' in text.lower():
            hbu_match = re.search(
                r'(The subject is located[^\n]{30,}(?:\n[^\n]{20,}){0,2})',
                text, re.IGNORECASE
            )
            if hbu_match:
                fields['highest_best_use'] = clean_narrative(hbu_match.group(1))

    return fields


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_urar_narratives.py <pdf_path>", "fields": {}}))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        pages = extract_all_pages(pdf_path)
    except Exception as e:
        print(json.dumps({"error": str(e), "fields": {}}))
        sys.exit(1)

    all_fields = {}

    for p in pages:
        f = extract_narratives_from_page(p['text'], p['page'])
        for k, v in f.items():
            if k not in all_fields and v:
                all_fields[k] = v

    result = {
        "fields": all_fields,
        "pages_extracted": len(pages),
        "fields_found": list(all_fields.keys()),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
