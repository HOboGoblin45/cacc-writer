# ACI 1004 Surface Profiles

This file documents the corpus-backed surface hints used for Phase 1 hardening of ACI 1004 insertion.

## Purpose

The live March 13, 2026 ACI audit showed that the owner-drawn `Sales` and `Reco` tabs can fail to navigate deterministically, which makes prior "all fields confirmed" calibration claims unsafe. The project now carries a separate corpus-backed profile file at:

- `desktop_agent/field_maps/1004_surface.json`

These profiles are derived from the sample report corpus under:

- `voice_pdfs/1004/*.PDF`

They are used to:

- keep field/page expectations grounded in real 1004 report structure
- support future visual navigation work
- make diagnostics and operator review more trustworthy
- prevent drift in the high-priority `Sales` and `Reco` narratives

## Regeneration

Run:

```powershell
npm run profile:1004-surface
```

or:

```powershell
python scripts/profile1004Surface.py
```

## Current trust model

- `Neighborhood`, `Site`, and `Improvements` lanes still retain live support.
- `Offering History`, `Contract Analysis`, `Sales Comparison Commentary`, and `Reconciliation` are now explicitly marked `corpus_backed_pending_navigation_fix` in `desktop_agent/field_maps/1004.json`.
- This does not automate any final appraisal judgment. It only improves field targeting truth and insertion safety.
