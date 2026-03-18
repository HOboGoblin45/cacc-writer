#!/usr/bin/env python3
"""Deep scan page 4 text to understand structure."""
import pdfplumber

pdf_path = r"C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal\48759.PDF"

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[3]  # Page 4 (0-indexed)
    
    # Extract words with positions
    words = page.extract_words()
    print(f"Page 4: {len(words)} words")
    
    # Get the full text 
    text = page.extract_text()
    print("\nFULL PAGE 4 TEXT:")
    print(text)
