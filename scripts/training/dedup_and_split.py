#!/usr/bin/env python3
"""
Deduplicate llama_training_data.jsonl and split into train/val sets.

Near-dedup strategy: bucket by (type, first-100-chars-of-assistant-response),
then compare full assistant text within buckets using SequenceMatcher.
This is fast because examples with truly different content won't share a bucket.
"""

import json
import random
import difflib
from pathlib import Path
from collections import defaultdict

MAIN = Path(__file__).resolve().parents[2]
IN_FILE    = MAIN / "training_output/llama_training_data.jsonl"
OUT_FILE   = MAIN / "training_output/llama_training_data_deduped.jsonl"
TRAIN_FILE = MAIN / "training_output/train.jsonl"
VAL_FILE   = MAIN / "training_output/val.jsonl"

SIMILARITY_THRESHOLD = 0.95
BUCKET_PREFIX_LEN = 100  # chars to use as bucket key

def assistant_content(r):
    for m in r["messages"]:
        if m["role"] == "assistant":
            return m["content"]
    return ""

def main():
    # ── Load ──────────────────────────────────────────────────────────────────
    records = []
    with open(IN_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"Original count: {len(records)}")

    # ── Exact dedup ───────────────────────────────────────────────────────────
    seen_exact = set()
    after_exact = []
    for r in records:
        key = json.dumps(r["messages"], sort_keys=True, ensure_ascii=False)
        if key not in seen_exact:
            seen_exact.add(key)
            after_exact.append(r)
    exact_removed = len(records) - len(after_exact)
    print(f"After exact dedup: {len(after_exact)}  (removed {exact_removed})")

    # ── Near-dedup (bucketed) ─────────────────────────────────────────────────
    # Key: (type, first-100-chars of assistant response)
    # Within each bucket, do pairwise SequenceMatcher check
    buckets = defaultdict(list)   # bucket_key -> list of (record, full_asst_text)
    after_near = []
    near_removed = 0

    for r in after_exact:
        typ = r.get("type", "unknown")
        asst = assistant_content(r)
        bucket_key = (typ, asst[:BUCKET_PREFIX_LEN])

        # Check against others in the same bucket
        is_dup = False
        for (prev_r, prev_asst) in buckets[bucket_key]:
            ratio = difflib.SequenceMatcher(None, asst, prev_asst, autojunk=False).quick_ratio()
            if ratio >= SIMILARITY_THRESHOLD:
                # quick_ratio can over-estimate, confirm with full ratio
                ratio = difflib.SequenceMatcher(None, asst, prev_asst, autojunk=False).ratio()
                if ratio >= SIMILARITY_THRESHOLD:
                    is_dup = True
                    break

        if not is_dup:
            buckets[bucket_key].append((r, asst))
            after_near.append(r)
        else:
            near_removed += 1

    print(f"After near-dedup: {len(after_near)}  (removed {near_removed} more)")
    print(f"Total removed: {len(records) - len(after_near)}")

    # Per-type stats
    type_counts_before = defaultdict(int)
    type_counts_after  = defaultdict(int)
    for r in after_exact:
        type_counts_before[r.get("type","unknown")] += 1
    for r in after_near:
        type_counts_after[r.get("type","unknown")] += 1
    print(f"\n  {'Type':<30} {'Before':>8} {'After':>7} {'Removed':>8}")
    for typ in sorted(type_counts_before):
        b = type_counts_before[typ]
        a = type_counts_after[typ]
        print(f"  {typ:<30} {b:>8} {a:>7} {b-a:>8}")

    # ── Write deduped ─────────────────────────────────────────────────────────
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        for r in after_near:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nWrote deduped: {OUT_FILE}")

    # ── Stratified 90/10 split ────────────────────────────────────────────────
    random.seed(42)
    by_type = defaultdict(list)
    for r in after_near:
        by_type[r.get("type", "unknown")].append(r)

    train_set, val_set = [], []
    for typ, group in sorted(by_type.items()):
        shuffled = group[:]
        random.shuffle(shuffled)
        n_val = max(1, round(len(shuffled) * 0.1))
        val_set.extend(shuffled[:n_val])
        train_set.extend(shuffled[n_val:])

    random.shuffle(train_set)
    random.shuffle(val_set)

    train_by_type = defaultdict(int)
    val_by_type   = defaultdict(int)
    for r in train_set:
        train_by_type[r.get("type","unknown")] += 1
    for r in val_set:
        val_by_type[r.get("type","unknown")] += 1

    print(f"\nTrain/val split (90/10 stratified):")
    print(f"  Total train: {len(train_set)} | Total val: {len(val_set)}")
    print(f"  {'Type':<30} {'Train':>8} {'Val':>6}")
    for typ in sorted(set(list(train_by_type) + list(val_by_type))):
        print(f"  {typ:<30} {train_by_type[typ]:>8} {val_by_type[typ]:>6}")

    with open(TRAIN_FILE, "w", encoding="utf-8") as f:
        for r in train_set:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    with open(VAL_FILE, "w", encoding="utf-8") as f:
        for r in val_set:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nWrote train: {TRAIN_FILE}  ({len(train_set)} lines)")
    print(f"Wrote val:   {VAL_FILE}  ({len(val_set)} lines)")
    print("\nDone.")

if __name__ == "__main__":
    main()
