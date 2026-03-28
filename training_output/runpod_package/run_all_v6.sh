#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# run_all_v6.sh — CACC Appraiser v6 training pipeline (5 epochs, 5,195 examples)
# Run from /workspace/ on a RunPod GPU pod
#
# Usage:
#   cd /workspace
#   bash run_all_v6.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     CACC Appraiser v6 — 5-Epoch Training Pipeline            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Working directory: $SCRIPT_DIR"
echo "Dataset: 4,709 train + 486 val = 5,195 examples"
echo "Epochs: 5 | Batch: 4 | Grad Accum: 4 | LR: 2e-4"
echo ""

# ── Step 1: Install compatible library versions ─────────────────────────────
echo "━━━ Step 1/3: Installing compatible libraries ━━━━━━━━━━━━━━━━━━━━━━━━"
pip install trl==0.13.0 transformers==4.47.0 peft==0.14.0 \
    accelerate==1.2.1 bitsandbytes==0.45.0 datasets==3.2.0
echo ""
echo "  Verifying installations..."
python3 -c "
import trl, transformers, peft
print(f'  trl:          {trl.__version__}')
print(f'  transformers: {transformers.__version__}')
print(f'  peft:         {peft.__version__}')
"
echo ""

# ── Step 2: Train ───────────────────────────────────────────────────────────
echo "━━━ Step 2/3: Training (5 epochs) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GPU info:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "  (no nvidia-smi)"
echo ""

python3 train_llama_v6.py \
  --train "$SCRIPT_DIR/train_v6.jsonl" \
  --val   "$SCRIPT_DIR/val_v6.jsonl" \
  --output "$SCRIPT_DIR/output/cacc-appraiser-lora-v6" \
  --epochs 5
echo ""

# ── Step 3: Export ──────────────────────────────────────────────────────────
echo "━━━ Step 3/3: Export to Ollama ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
python3 export_to_ollama.py \
  --adapter "$SCRIPT_DIR/output/cacc-appraiser-lora-v6" \
  --merged-output "$SCRIPT_DIR/output/cacc-appraiser-merged-v6" \
  --gguf-output   "$SCRIPT_DIR/output/gguf-v6"
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   v6 Pipeline Complete!                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Output files in: $SCRIPT_DIR/output/"
echo "    cacc-appraiser-lora-v6/   — LoRA adapter"
echo "    cacc-appraiser-merged-v6/ — Merged HF model"
echo "    gguf-v6/                  — GGUF + Modelfile"
echo ""
echo "  Download the output folder to your local machine, then:"
echo "    ollama create cacc-appraiser -f output/gguf-v6/Modelfile"
echo "    ollama run cacc-appraiser"
