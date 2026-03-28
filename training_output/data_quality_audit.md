# CACC-Writer Training Data Quality Audit

**Date:** March 26, 2026
**Auditor:** Claude (automated audit)
**Verdict: Frankenstein — functional but messy. Needs cleanup before next training run.**

---

## Executive Summary

The training pipeline works end-to-end and the core training script (`train_llama.py`) is well-architected. However, the data layer has accumulated significant technical debt: **29% of validation data leaks into training**, **27.5% of training examples are exact duplicates**, system prompts are inconsistent across 6–9 variants, and the `training_output/` folder contains 8+ JSONL files from different pipeline stages with no clear lineage. The extraction and processing scripts have hardcoded paths, silent error handling, and version mismatches between what they produce and what downstream scripts expect.

The model will train, but you can't trust your validation metrics, and roughly a quarter of your training compute is wasted on duplicate examples.

---

## 1. Training Data Files — Current State

### File Inventory

| File | Examples | Role | Quality |
|------|----------|------|---------|
| `train_v3.jsonl` | 1,348 | Active training set | Has issues (see below) |
| `val_v3.jsonl` | 150 | Active validation set | Has issues (see below) |
| `expert_reasoning_data.jsonl` | 838 | Intermediate — reasoning examples | 30% duplicates |
| `llama_training_data_deduped.jsonl` | 660 | Deduplicated intermediate | Cleanest file (0 duplicates) |
| `llama_training_data.jsonl` | ~800+ | Pre-dedup version | Superseded |
| `decision_training_data.jsonl` | varies | Decision pipeline output | Intermediate |
| `training_data.jsonl` | varies | Early version | Superseded |
| `combined_v2.jsonl` | varies | Combined v2 | Superseded |
| `train.jsonl` / `val.jsonl` | varies | v1 splits | Superseded |
| `train_v2.jsonl` / `val_v2.jsonl` | varies | v2 splits | Superseded |

**Problem:** 8+ JSONL files with no documentation about which are current vs. legacy. Only `train_v3.jsonl` and `val_v3.jsonl` appear to be the active training set, but the others create confusion and risk accidentally training on the wrong file.

---

## 2. Critical Issues

### 2.1 Data Leakage — Train/Val Contamination (CRITICAL)

**44 validation examples (29.3%) appear identically in the training set.**

This means your validation loss and metrics are artificially optimistic. The model has already memorized nearly a third of the validation set during training. Any evaluation metrics from this split are unreliable.

**Impact:** You cannot trust any reported validation performance. The model may be more overfit than metrics suggest.

**Fix:** Remove all 44 overlapping examples from validation, then re-split from the deduplicated pool to ensure completely disjoint sets.

### 2.2 Massive Duplication in Training Set (CRITICAL)

**371 examples (27.5%) in `train_v3.jsonl` are exact duplicates** across 166 duplicate groups.

Top offenders:
- "Write condition of the property section..." — 5 identical copies
- "Write additional features section..." — 4 identical copies
- "Write comments on sales comparison..." — 4 identical copies
- "Write neighborhood market conditions..." — 4 identical copies
- "Write highest and best use section..." — 4 identical copies

Additionally, `expert_reasoning_data.jsonl` has a **30% duplication rate** (252 of 838 examples).

**Impact:** 27.5% of training compute is wasted. Duplicated examples get disproportionate weight, biasing the model toward those specific phrasings.

**Fix:** Deduplicate all files. After dedup, training set drops to ~977 unique examples.

### 2.3 Inconsistent System Prompts (HIGH)

**6–9 distinct system prompt variants** are used across the training data:

| Variant | Frequency | Description |
|---------|-----------|-------------|
| Base prompt | ~50% | Core Charles Cresci appraiser persona |
| Base + full appraisal instructions | ~25% | Adds detailed USPAP writing guidelines |
| Base only (shorter) | ~12% | Minimal version |
| Reconciliation-specific | ~6.5% | Adds reconciliation guidance |
| Adjustment-specific | ~0.7% | Adds FNMA adjustment percentages |
| Condition/quality-specific | ~0.5% | Adds Fannie Mae rating definitions |
| Task-specific guidance | varies | Various one-off additions |

All variants describe Charles Cresci as a USPAP-compliant appraiser, but they differ in:
- Whether commercial/agricultural expertise is mentioned
- Whether FNMA adjustment percentage guidelines are included
- How detailed the writing instructions are
- Whether specific rating systems (C1–C6, Q1–Q6) are referenced

**Impact:** The model receives mixed signals about its role and capabilities. During inference, a single system prompt is used — so some training examples teach behavior that won't be triggered by the inference prompt.

**Fix:** Standardize to 1–2 system prompts. Use the most comprehensive version for all examples, or use exactly two: one for standard narrative writing and one for full appraisal tasks.

### 2.4 System Prompt Duplication Across Codebase (HIGH)

The system prompt is defined in **4+ different places** with subtle differences:
- `train_llama.py` — embedded in training data
- `export_to_ollama.py` — hardcoded in Modelfile generation
- `importToOllama.mjs` — different variant (references Qwen instead of Llama)
- `server/config/llamaConfig.js` — yet another variant

**Impact:** The inference-time system prompt may differ from what the model was trained on, causing distribution shift.

**Fix:** Create a single source of truth (e.g., `system_prompt.txt`) and have all scripts read from it.

---

## 3. Moderate Issues

### 3.1 Type Distribution Imbalance

Training set has **29 task type categories**, but validation only has **13**. Fourteen training types have zero validation examples:
- `expert_reasoning` (14 training examples, 0 validation)
- `market_analysis` (5 training, 0 validation)
- `condition_quality` (4 training, 0 validation)
- `farm_appraisal`, `manufactured_home`, `farm_methodology`, `hbu_analysis`, and others

**Impact:** Cannot evaluate model performance on these task types.

**Fix:** Ensure every type with >5 training examples has at least 1–2 validation examples after re-splitting.

### 3.2 Response Length Variance

- Shortest response: 27 characters ("Too many adjustments needed")
- Longest response: 4,307 characters (full narrative section)
- That's a 158x variation

8 examples have responses under 50 characters. These may be low-quality or incomplete examples that teach the model to give terse, unhelpful responses.

**Fix:** Review and either remove or expand the 8 ultra-short responses. Set a minimum response length threshold (e.g., 100 characters).

### 3.3 Incomplete Metadata

- 44% of training examples are missing `QuestionId`
- 48% are missing `Source`
- 46% are missing `AnsweredAt`

**Impact:** Makes debugging and traceability difficult. If a training example produces bad behavior, you can't trace it back to its origin.

**Fix:** Backfill metadata where possible. For new examples, make metadata mandatory in the extraction pipeline.

### 3.4 Validator Type List Out of Sync

`validate_data.mjs` has a `VALID_TYPES` array that:
- Contains a duplicate entry (`adjustment_reasoning` listed twice)
- Is missing types that `autoFillFromXML.mjs` generates: `market_analysis`, `farm_methodology`, `farm_appraisal`, `hbu_analysis`
- Has inconsistent naming: `condition_quality` vs `condition_rating`, `reconciliation` vs `reconciliation_reasoning`

**Impact:** Unknown types pass validation silently, so bad data can slip through.

**Fix:** Sync the validator's type list with all extraction scripts. Remove the duplicate entry.

---

## 4. Pipeline & Script Assessment

### 4.1 Training Script — `train_llama.py` (GOOD)

The core training script is **well-architected**:
- Proper QLoRA implementation (4-bit NF4 quantization + LoRA rank 64)
- Correct model: `meta-llama/Llama-3.1-8B-Instruct`
- Reasonable hyperparameters (LR 2e-4, effective batch 16, 2048 max seq length)
- Proper Llama 3.1 chat formatting with special tokens
- SFTTrainer with packing for efficiency
- Saves training metadata for reproducibility

Minor issues: assumes `/workspace/train.jsonl` exists (no validation), filters examples <100 chars silently.

### 4.2 Extraction Scripts (MESSY)

**`autoFillFromXML.mjs`** — Generates training examples from XML appraisal exports. Functional but fragile:
- Hardcoded area data (Bloomington/Normal adjustment rates)
- Incomplete HTML entity decoding
- Template-generated examples for market analysis and adjustment reasoning may not reflect actual Charles Cresci writing voice

**`extractFarmAppraisals.mjs`** — Parses AX7 binary files. Very ad-hoc:
- Uses latin1 regex on binary data (works but unreliable)
- Hardcoded county assumptions
- Windows-specific paths embedded

### 4.3 Processing Pipeline (FUNCTIONAL BUT FRAGILE)

**`dedup_and_split.py`** — Good dedup strategy (exact + near-duplicate with 0.95 threshold), stratified split. But:
- Hardcoded paths
- Silent `except: pass` error handling
- Only checks assistant message for duplicates (ignores user prompt similarity)

**`validate_data.mjs`** — Comprehensive validation with good reporting. But type list is out of sync (see 3.4).

**`run_pipeline.mjs`** — Orchestration script that calls `fullDecisionPipeline.js`. Works but depends on external module.

### 4.4 Duplicate Scripts

`train_llama.py` exists in **two locations** with identical code:
- `training_output/runpod_package/train_llama.py` (canonical)
- `scripts/training/train_llama.py` (duplicate)

Similarly, `export_to_ollama.py` and `importToOllama.mjs` do overlapping work (export to Ollama) but for different base models (Llama vs Qwen). This is confusing.

### 4.5 Path Mismatches

- `dedup_and_split.py` outputs `train.jsonl` + `val.jsonl`
- `setup_runpod.sh` instructions reference uploading `llama_training_data.jsonl` (unsplit)
- `train_llama.py` expects `./train.jsonl` + `./val.jsonl` (split)

These are inconsistent and could cause someone to upload the wrong file.

---

## 5. What's Actually Good

To be fair, several things are done well:

- **QLoRA training config** is solid and appropriate for the hardware (24GB VRAM)
- **Chat template formatting** is correct and consistent within files (system → user → assistant, always 3 messages)
- **`llama_training_data_deduped.jsonl`** is genuinely clean — 660 unique examples, zero duplicates, good quality
- **Dedup strategy** (exact + near-duplicate at 0.95) is a smart approach
- **Stratified splitting** by type preserves distribution
- **Validation script** catches real issues and gives actionable output
- The voice corpus JSON files suggest systematic data collection by appraisal section

---

## 6. Cleanup Plan

### Phase 1: Immediate (Before Next Training Run)

1. **Deduplicate `train_v3.jsonl`** — Remove 371 duplicate examples → ~977 unique
2. **Fix validation leakage** — Remove 44 overlapping examples from `val_v3.jsonl`
3. **Re-split cleanly** — From the deduplicated pool, do a fresh 90/10 stratified split ensuring zero overlap
4. **Set minimum response length** — Remove or fix the 8 examples with <50 character responses
5. **Standardize system prompts** — Pick one comprehensive system prompt, apply to all examples

Expected result: ~930 training + ~103 validation examples, all unique, consistent formatting.

### Phase 2: Pipeline Hygiene (This Week)

6. **Delete legacy JSONL files** — Archive `train.jsonl`, `val.jsonl`, `train_v2.jsonl`, `val_v2.jsonl`, `combined_v2.jsonl`, `training_data.jsonl`, `llama_training_data.jsonl` to an `archive/` folder
7. **Delete duplicate `train_llama.py`** in `scripts/training/` — keep only the one in `training_output/runpod_package/`
8. **Create `system_prompt.txt`** — Single source of truth, imported by all scripts
9. **Sync validator type list** — Update `VALID_TYPES` in `validate_data.mjs` to match all extraction scripts
10. **Fix `setup_runpod.sh`** — Update data upload instructions to reference `train.jsonl` + `val.jsonl` (not unsplit file)

### Phase 3: Robustness (Next Sprint)

11. **Replace hardcoded paths** with environment variables or a config file
12. **Add error logging** to all extraction scripts (replace empty `catch` blocks)
13. **Add train/val overlap check** as a post-split validation step
14. **Consolidate Ollama export** — Pick one of `export_to_ollama.py` or `importToOllama.mjs`, delete the other
15. **Document the pipeline** — Add a `PIPELINE.md` explaining the data flow from XML → training

### Phase 4: Scale (When Adding More Data)

16. **Add metadata requirements** — Make `QuestionId`, `Source`, and `AnsweredAt` mandatory in extraction
17. **Ensure type coverage in validation** — Every type with ≥5 training examples must have ≥1 validation example
18. **Add automated quality checks** — Response length distribution, system prompt consistency, type balance
19. **Version your datasets** — Use `train_v4.jsonl` naming with a changelog

---

## 7. Bottom Line

**Is this Frankenstein or organized?**

It's Frankenstein with a good skeleton. The training architecture (QLoRA, hyperparameters, chat formatting) is solid. But the data layer has accumulated cruft from iteration: duplicate files from multiple versions, copy-pasted examples, leaking validation data, and inconsistent system prompts. The extraction scripts work but are brittle and poorly integrated.

The good news: the core data (~660 deduplicated examples in `llama_training_data_deduped.jsonl`) is high quality. The problems are all fixable with a focused cleanup effort. Phase 1 above (4–6 hours of work) would eliminate the critical issues. Phase 2 (another day) would make the pipeline professional.

**Priority action: Don't train again until you've deduplicated and fixed the validation leak.** Your current val metrics are meaningless with 29% contamination.
