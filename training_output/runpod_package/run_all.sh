#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# run_all.sh — Full CACC Appraiser training pipeline
# Run from /workspace/ on a RunPod GPU pod
#
# Usage:
#   export HF_TOKEN=hf_your_token_here
#   bash /workspace/run_all.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       CACC Appraiser — Full Training Pipeline                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Working directory: $SCRIPT_DIR"
echo ""

# ── Step 1: Setup ─────────────────────────────────────────────────────────────
echo "━━━ Step 1/3: Setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash setup_runpod.sh --local
echo ""

# ── Step 2: Train ─────────────────────────────────────────────────────────────
echo "━━━ Step 2/3: Training ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
python train_llama.py \
  --train "$SCRIPT_DIR/train.jsonl" \
  --val   "$SCRIPT_DIR/val.jsonl" \
  --output "$SCRIPT_DIR/output/cacc-appraiser-lora" \
  --epochs 3
echo ""

# ── Step 3: Export ────────────────────────────────────────────────────────────
echo "━━━ Step 3/3: Export to Ollama ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
python export_to_ollama.py \
  --adapter "$SCRIPT_DIR/output/cacc-appraiser-lora" \
  --merged-output "$SCRIPT_DIR/output/cacc-appraiser-merged" \
  --gguf-output   "$SCRIPT_DIR/output/gguf"
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   Pipeline Complete!                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Output files in: $SCRIPT_DIR/output/"
echo "    cacc-appraiser-lora/   — LoRA adapter"
echo "    cacc-appraiser-merged/ — Merged HF model"
echo "    gguf/                  — GGUF + Modelfile"
echo ""
echo "  Download the output folder to your local machine, then:"
echo "    ollama create cacc-appraiser -f output/gguf/Modelfile"
echo "    ollama run cacc-appraiser"
