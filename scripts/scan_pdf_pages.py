#!/usr/bin/env python3
"""Scan PDF pages to find narrative content."""
import sys
import pdfplumber

pdf_path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal\48759.PDF"

with pdfplumber.open(pdf_path) as pdf:
    for i, page in enumerate(pdf.pages[:12]):
        text = page.extract_text() or ""
        if len(text.strip()) > 50:
            print(f"\n{'='*60}")
            print(f"PAGE {i+1} ({len(text)} chars):")
            print(text[:1000])
