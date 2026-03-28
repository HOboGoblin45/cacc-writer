"""
Generate corpus-backed 1004 surface profiles from sample report PDFs.

Usage:
    python scripts/profile1004Surface.py
    python scripts/profile1004Surface.py --out desktop_agent/field_maps/1004_surface.json
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path

from pypdf import PdfReader


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "voice_pdfs" / "1004"
DEFAULT_OUT = PROJECT_ROOT / "desktop_agent" / "field_maps" / "1004_surface.json"


FIELD_PROFILES = {
    "neighborhood_description": {
        "visual_tab_label": "Neig",
        "visual_tab_ratio": 0.173,
        "pdf_anchor_text": "Neighborhood Description",
        "adjacent_anchor_text": [
            "Market Conditions (including support for the above conclusions)"
        ],
        "content_kind": "narrative_paragraph",
        "expected_elements": [
            "market area identity",
            "land use mix",
            "supply and demand context",
            "marketing time or trend support",
        ],
    },
    "market_conditions": {
        "visual_tab_label": "Neig",
        "visual_tab_ratio": 0.173,
        "pdf_anchor_text": "Market Conditions (including support for the above conclusions)",
        "adjacent_anchor_text": [
            "Neighborhood Description"
        ],
        "content_kind": "market_trend_narrative",
        "expected_elements": [
            "price trend",
            "supply and demand balance",
            "marketing time",
            "supporting sales or market evidence",
        ],
    },
    "site_comments": {
        "visual_tab_label": "Site",
        "visual_tab_ratio": 0.231,
        "pdf_anchor_text": "Dimensions Area Shape View Specific Zoning Classification",
        "adjacent_anchor_text": [
            "Zoning Description",
            "Highest and Best Use"
        ],
        "content_kind": "site_narrative",
        "expected_elements": [
            "site size or dimensions",
            "utilities",
            "zoning or legal access",
            "topography, view, or shape",
        ],
    },
    "improvements_condition": {
        "visual_tab_label": "Impro",
        "visual_tab_ratio": 0.292,
        "pdf_anchor_text": "Describe the condition of the property (including needed repairs, deterioration, renovations, remodeling, etc.).",
        "adjacent_anchor_text": [
            "Are there any physical deficiencies or adverse conditions that affect the livability, soundness, or structural integrity of the property?"
        ],
        "content_kind": "physical_condition_narrative",
        "expected_elements": [
            "overall condition",
            "repairs or renovations",
            "quality or upkeep",
            "observed deficiencies",
        ],
    },
    "functional_utility": {
        "visual_tab_label": "Impro",
        "visual_tab_ratio": 0.292,
        "pdf_anchor_text": "Does the property generally conform to the neighborhood (functional utility, style, condition, use, construction, etc.)?",
        "adjacent_anchor_text": [
            "Are there any physical deficiencies or adverse conditions that affect the livability, soundness, or structural integrity of the property?"
        ],
        "content_kind": "functional_utility_narrative",
        "expected_elements": [
            "conformity to neighborhood",
            "layout adequacy",
            "design utility",
            "functional obsolescence if present",
        ],
    },
    "adverse_conditions": {
        "visual_tab_label": "Site",
        "visual_tab_ratio": 0.231,
        "pdf_anchor_text": "Are there any physical deficiencies or adverse conditions that affect the livability, soundness, or structural integrity of the property?",
        "adjacent_anchor_text": [
            "Describe the condition of the property",
            "Does the property generally conform to the neighborhood"
        ],
        "content_kind": "adverse_condition_narrative",
        "expected_elements": [
            "adverse site or improvement conditions",
            "impact on livability or soundness",
            "repair needs",
            "external or environmental factors",
        ],
    },
    "offering_history": {
        "visual_tab_label": "Sales",
        "visual_tab_ratio": 0.354,
        "pdf_anchor_text": "Report data source(s) used, offering price(s), and date(s).",
        "adjacent_anchor_text": [
            "I did did not analyze the contract for sale for the subject purchase transaction."
        ],
        "content_kind": "listing_and_transfer_history_narrative",
        "expected_elements": [
            "listing or offering source",
            "price history",
            "date history",
            "listing or sale chronology",
        ],
    },
    "contract_analysis": {
        "visual_tab_label": "Sales",
        "visual_tab_ratio": 0.354,
        "pdf_anchor_text": "Explain the results of the analysis of the contract for sale or why the analysis was not performed.",
        "adjacent_anchor_text": [
            "Contract Price",
            "Is the property seller the owner of public record?"
        ],
        "content_kind": "contract_analysis_narrative",
        "expected_elements": [
            "contract terms or absence of contract",
            "arm's-length analysis",
            "concessions or financing relevance",
            "reason if analysis was not performed",
        ],
    },
    "sales_comparison_commentary": {
        "visual_tab_label": "Sales",
        "visual_tab_ratio": 0.354,
        "pdf_anchor_text": "Summary of Sales Comparison Approach.",
        "adjacent_anchor_text": [
            "Analysis of prior sale or transfer history of the subject property and comparable sales",
            "Indicated Value by Sales Comparison Approach"
        ],
        "content_kind": "sales_comparison_narrative",
        "expected_elements": [
            "comparable selection rationale",
            "adjustment pattern support",
            "subject and comp similarity or difference",
            "weighting support",
        ],
    },
    "reconciliation": {
        "visual_tab_label": "Reco",
        "visual_tab_ratio": 0.370,
        "pdf_anchor_text": "Indicated Value by: Sales Comparison Approach",
        "adjacent_anchor_text": [
            "Cost Approach (if developed)",
            "Income Approach (if developed)",
            "This appraisal is made \"as is,\""
        ],
        "content_kind": "reconciliation_narrative",
        "expected_elements": [
            "approach weighting",
            "reason excluded approaches were not developed or were secondary",
            "manual final reconciliation support",
            "as-is or subject-to conditions when relevant",
        ],
    },
    "cost_approach": {
        "visual_tab_label": "Cost",
        "visual_tab_ratio": 0.538,
        "pdf_anchor_text": "Support for the opinion of site value",
        "adjacent_anchor_text": [
            "ESTIMATED REPRODUCTION OR REPLACEMENT COST NEW"
        ],
        "content_kind": "cost_approach_narrative",
        "expected_elements": [
            "site value support",
            "cost source",
            "depreciation or applicability rationale",
            "whether the approach was developed",
        ],
    },
    "income_approach": {
        "visual_tab_label": "Income",
        "visual_tab_ratio": 0.604,
        "pdf_anchor_text": "Summary of Income Approach",
        "adjacent_anchor_text": [
            "Estimated Monthly Market Rent",
            "PROJECT INFORMATION FOR PUDs"
        ],
        "content_kind": "income_approach_narrative",
        "expected_elements": [
            "rent or GRM support",
            "income evidence source",
            "applicability or non-applicability rationale",
            "scope caveat if omitted",
        ],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default=str(DEFAULT_SOURCE_DIR))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    return parser.parse_args()


def extract_page_counts(pdf_dir: Path) -> tuple[list[str], dict]:
    files = sorted(pdf_dir.glob("*.PDF"))
    results = {}
    for field_id, profile in FIELD_PROFILES.items():
        needles = [profile["pdf_anchor_text"], *profile.get("adjacent_anchor_text", [])]
        counts = Counter()
        hits = []
        for path in files:
            matched_page = None
            reader = PdfReader(str(path))
            for page_number, page in enumerate(reader.pages, start=1):
                text = (page.extract_text() or "").replace("\n", " ")
                text_lower = text.lower()
                if any(needle.lower() in text_lower for needle in needles):
                    matched_page = page_number
                    counts[page_number] += 1
                    hits.append({"file": path.name, "page": page_number})
                    break
            if matched_page is None:
                hits.append({"file": path.name, "page": None})
        results[field_id] = {
            **profile,
            "page_cluster": [page for page, _ in counts.most_common(4)],
            "sample_hit_counts": {str(page): count for page, count in counts.most_common()},
            "sample_hits": hits,
        }
    return [path.name for path in files], results


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source_dir).resolve()
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    source_files, field_profiles = extract_page_counts(source_dir)
    output = {
        "_comment": "Corpus-backed surface/profile hints for FNMA 1004 narrative fields.",
        "_source_glob": str(source_dir),
        "_source_count": len(source_files),
        "_source_files": source_files,
        "_generated_on": date.today().isoformat(),
        "_usage": "Use for ACI visual/page targeting, operator diagnostics, and trust checks. These hints do not automate final appraisal judgment.",
        "_schema": {
            "visual_tab_label": "Visible tab prefix in the ACI lower section strip",
            "visual_tab_ratio": "Measured click ratio within the live ACISectionTabs strip for the current 1004 layout",
            "page_cluster": "Most common page numbers in the sample PDF corpus where the section appears",
            "pdf_anchor_text": "Primary PDF text anchor for locating the section",
            "adjacent_anchor_text": "Nearby PDF strings that usually bracket the same section",
            "content_kind": "Expected content shape in the field",
            "expected_elements": "Evidence or facts usually expressed in the narrative",
            "sample_hit_counts": "Observed page frequencies in the corpus",
            "sample_hits": "Per-file first-hit page for the combined anchor set"
        },
        **field_profiles,
    }

    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")

    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
