#!/usr/bin/env python3
"""Find pages with substantial unique narrative content."""
import pdfplumber
import re

pdf_path = r"C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal\48759.PDF"

# Form boilerplate patterns to filter out
BOILERPLATE = [
    "Fannie Mae Form", "Freddie Mac Form", "produced using ACI",
    "appraiser's certification", "SCOPE OF WORK", "definition of market value",
    "STATEMENT OF ASSUMPTIONS", "Uniform Standards",
]

def is_boilerplate(text):
    t = text.lower()
    return any(b.lower() in t for b in BOILERPLATE)

with pdfplumber.open(pdf_path) as pdf:
    print(f"Total pages: {len(pdf.pages)}\n")
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        stripped = text.strip()
        
        # Look for pages with substantial text that aren't pure boilerplate
        if len(stripped) > 200:
            # Check for field-value patterns (actual content)
            has_normal = "normal" in stripped.lower()
            has_maple = "maple" in stripped.lower()
            has_cresci = "cresci" in stripped.lower()
            has_numbers = bool(re.search(r'\$[\d,]+', stripped))
            
            # Pages with actual appraisal data
            if has_normal or has_maple or has_numbers or has_cresci:
                print(f"PAGE {i+1} ({len(stripped)} chars) - contains real data:")
                # Print just the unique-looking lines
                lines = stripped.split('\n')
                unique_lines = [l for l in lines if len(l.strip()) > 30 and not is_boilerplate(l)]
                for l in unique_lines[:20]:
                    print(f"  {l.strip()[:120]}")
                print()
