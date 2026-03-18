#!/usr/bin/env python3
"""Check if ACI PDF has form fields with actual narrative data."""
import pdfplumber
import pypdf

pdf_path = r"C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal\48759.PDF"

# Try pypdf for form field extraction
try:
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    fields = reader.get_fields()
    if fields:
        print(f"Found {len(fields)} form fields via pypdf")
        # Print fields that have substantial text values
        narrative_fields = {}
        for name, field in fields.items():
            val = field.get('/V', '')
            if val and isinstance(val, str) and len(val) > 50:
                narrative_fields[name] = val
                print(f"\nField: {name}")
                print(f"  Value: {val[:200]}")
        
        if narrative_fields:
            print(f"\n\nFound {len(narrative_fields)} narrative-length fields")
        else:
            print("\nNo narrative-length text fields found")
    else:
        print("No form fields found via pypdf")
except ImportError:
    print("pypdf not available")
except Exception as e:
    print(f"pypdf error: {e}")
