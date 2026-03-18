#!/usr/bin/env python3
"""
scripts/extract_narratives.py
-------------------------------
Extract narrative text fields from a completed URAR 1004 appraisal PDF
using pdfplumber.

Usage:
    python scripts/extract_narratives.py <pdf_path>

Outputs JSON to stdout:
    {
      "fields": {
        "neighborhood_description": "...",
        "market_conditions": "...",
        ...
      },
      "pages_extracted": 6,
      "raw_text": "..."
    }
"""

import sys
import json
import re
import pdfplumber

# Target narrative field names (cacc-writer canonical IDs)
NARRATIVE_FIELDS = [
    "neighborhood_description",
    "market_conditions",
    "improvements_condition",
    "adverse_conditions",
    "functional_utility",
    "sales_comparison_commentary",
    "reconciliation",
]

# Section header patterns that precede each narrative field in URAR
# These are approximate; real PDFs vary by software
SECTION_PATTERNS = {
    "neighborhood_description": [
        r"neighborhood characteristics",
        r"neighborhood description",
        r"one-unit housing trends",
    ],
    "market_conditions": [
        r"market conditions",
        r"1004mc",
        r"market area",
        r"supply.*demand",
    ],
    "improvements_condition": [
        r"condition of improvements",
        r"improvements.*condition",
        r"general description.*interior",
        r"quality.*construction",
    ],
    "adverse_conditions": [
        r"adverse.*condition",
        r"adverse.*factors",
        r"environmental.*condition",
    ],
    "functional_utility": [
        r"functional utility",
        r"additional features",
        r"energy efficient",
    ],
    "sales_comparison_commentary": [
        r"sales comparison.*approach",
        r"comparable.*sale",
        r"adjusted sale price",
        r"analysis.*comparable",
    ],
    "reconciliation": [
        r"reconciliation",
        r"final.*value.*opinion",
        r"indicated value",
        r"approaches.*reconcil",
    ],
}


def extract_text_from_pdf(pdf_path):
    """Extract all text from PDF using pdfplumber."""
    pages_text = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                pages_text.append({"page": i + 1, "text": text})
    except Exception as e:
        return [], str(e)
    return pages_text, None


def find_narrative_blocks(pages_text):
    """
    Attempt to locate narrative text blocks for each known field.

    Strategy: look for sections in the full text that follow known headers,
    then extract the paragraph-length text that follows.
    """
    # Combine all text with page markers
    full_text = ""
    for p in pages_text:
        full_text += f"\n[PAGE {p['page']}]\n{p['text']}\n"

    fields = {}

    for field_id, patterns in SECTION_PATTERNS.items():
        best_match = None
        best_len = 0

        for pattern in patterns:
            # Find all matches of the header pattern
            matches = list(re.finditer(pattern, full_text, re.IGNORECASE | re.DOTALL))
            for m in matches:
                # Extract text after this header up to the next major section
                start = m.end()
                # Look for a block of text (at least 50 chars, up to ~800)
                remaining = full_text[start:start + 1200]
                # Remove form field labels (short lines followed by more labels)
                lines = remaining.split('\n')
                narrative_lines = []
                for line in lines:
                    stripped = line.strip()
                    # Skip empty lines, page markers, short labels
                    if not stripped or stripped.startswith('[PAGE') or len(stripped) < 15:
                        if narrative_lines:
                            break  # End of block
                        continue
                    # Skip lines that look like form fields (ALL CAPS short labels)
                    if len(stripped) < 40 and stripped.upper() == stripped and not any(c in stripped for c in '.;'):
                        continue
                    narrative_lines.append(stripped)
                    if len(' '.join(narrative_lines)) > 600:
                        break

                candidate = ' '.join(narrative_lines).strip()
                if len(candidate) > best_len and len(candidate) > 50:
                    best_len = len(candidate)
                    best_match = candidate

        if best_match:
            fields[field_id] = best_match[:800]

    return fields


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_narratives.py <pdf_path>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        pages_text, error = extract_text_from_pdf(pdf_path)
        if error:
            print(json.dumps({"error": error, "fields": {}}))
            sys.exit(1)

        fields = find_narrative_blocks(pages_text)
        raw_text = "\n".join(p["text"] for p in pages_text)

        print(json.dumps({
            "fields": fields,
            "pages_extracted": len(pages_text),
            "raw_text_preview": raw_text[:2000],
            "raw_length": len(raw_text),
        }, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e), "fields": {}}))
        sys.exit(1)


if __name__ == "__main__":
    main()
