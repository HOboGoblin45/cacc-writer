#!/usr/bin/env python3
"""Scan addendum pages (after page 6) for narrative content."""
import pdfplumber

pdf_path = r"C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal\48759.PDF"

with pdfplumber.open(pdf_path) as pdf:
    print(f"Total pages: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages[5:]):  # Pages 6+
        text = page.extract_text() or ""
        if len(text.strip()) > 100:
            print(f"\n{'='*60}")
            print(f"PAGE {i+6} ({len(text)} chars):")
            print(text[:1500])
