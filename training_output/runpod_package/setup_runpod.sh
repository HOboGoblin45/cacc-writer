#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/training/setup_runpod.sh
# RunPod setup: install deps, authenticate, download base model, upload data
#
# Usage:
#   export HF_TOKEN=hf_xxx
#   export RUNPOD_SSH=root@xxx.runpod.io
#   bash setup_runpod.sh
#
# Run on RunPod pod (after SSH in):
#   bash setup_runpod.sh --local
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOCAL_MODE=false
SKIP_MODEL_DOWNLOAD=false
DATA_FILE="training_output/llama_training_data.jsonl"
REMOTE_WORK_DIR="/workspace/cacc-training"

# Parse args
for arg in "$@"; do
  case $arg in
    --local) LOCAL_MODE=true ;;
    --skip-model) SKIP_MODEL_DOWNLOAD=true ;;
    --data=*) DATA_FILE="${arg#*=}" ;;
  esac
done

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        CACC Appraiser — RunPod Training Setup                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. System packages ────────────────────────────────────────────────────────
echo "▶ Step 1: Installing system packages..."
apt-get update -qq
apt-get install -y -qq git git-lfs curl wget rsync unzip build-essential
git lfs install

# ── 2. Python dependencies ────────────────────────────────────────────────────
echo ""
echo "▶ Step 2: Installing Python dependencies..."
pip install --upgrade pip --quiet

pip install --quiet \
  torch==2.5.1 \
  torchvision \
  torchaudio \
  --index-url https://download.pytorch.org/whl/cu124

pip install --quiet \
  transformers==4.47.0 \
  accelerate==1.2.1 \
  peft==0.14.0 \
  bitsandbytes==0.45.0 \
  datasets==3.2.0 \
  trl==0.13.0 \
  sentencepiece \
  protobuf \
  einops \
  scipy \
  safetensors

# Optional: Flash Attention 2 for faster training on A100/H100
if python -c "import torch; assert torch.cuda.get_device_capability()[0] >= 8" 2>/dev/null; then
  echo "  ✓ Ampere+ GPU detected, installing Flash Attention 2..."
  pip install --quiet flash-attn --no-build-isolation
else
  echo "  ⚠ Flash Attention 2 requires Ampere+ GPU — skipping"
fi

echo "  ✓ All Python packages installed"

# ── 3. Hugging Face authentication ───────────────────────────────────────────
echo ""
echo "▶ Step 3: Authenticating with Hugging Face..."

if [ -z "${HF_TOKEN:-}" ]; then
  echo "  ⚠ HF_TOKEN not set. Set it with: export HF_TOKEN=hf_xxx"
  echo "  You need to accept Llama 3.1 terms at https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct"
  read -p "  Enter your HF token (or press Enter to skip): " HF_TOKEN
fi

if [ -n "${HF_TOKEN:-}" ]; then
  huggingface-cli login --token "$HF_TOKEN"
  echo "  ✓ Authenticated with Hugging Face"
else
  echo "  ⚠ Skipping HF authentication — model download may fail"
fi

# ── 4. Create workspace directories ──────────────────────────────────────────
echo ""
echo "▶ Step 4: Creating workspace directories..."
mkdir -p "$REMOTE_WORK_DIR"/{data,output,logs,cache}
cd "$REMOTE_WORK_DIR"

# Set HF cache to workspace (persistent storage)
export HF_HOME="$REMOTE_WORK_DIR/cache/huggingface"
export TRANSFORMERS_CACHE="$REMOTE_WORK_DIR/cache/transformers"
mkdir -p "$HF_HOME" "$TRANSFORMERS_CACHE"

echo "  ✓ Workspace: $REMOTE_WORK_DIR"

# ── 5. Download Llama 3.1 8B Instruct ────────────────────────────────────────
if [ "$SKIP_MODEL_DOWNLOAD" = false ]; then
  echo ""
  echo "▶ Step 5: Downloading Llama 3.1 8B Instruct (~16 GB)..."
  echo "  This may take 10-20 minutes depending on network speed..."

  python3 -c "
import os
os.environ['HF_HOME'] = '$REMOTE_WORK_DIR/cache/huggingface'
from transformers import AutoModelForCausalLM, AutoTokenizer
print('  Downloading tokenizer...')
tok = AutoTokenizer.from_pretrained('meta-llama/Llama-3.1-8B-Instruct')
print('  Downloading model weights...')
model = AutoModelForCausalLM.from_pretrained(
    'meta-llama/Llama-3.1-8B-Instruct',
    torch_dtype='auto',
    device_map='cpu',
)
print('  ✓ Model downloaded successfully')
del model
"
  echo "  ✓ Llama 3.1 8B Instruct cached"
else
  echo "▶ Step 5: Skipping model download (--skip-model)"
fi

# ── 6. Upload training data ───────────────────────────────────────────────────
if [ "$LOCAL_MODE" = false ]; then
  echo ""
  echo "▶ Step 6: Upload training data from local machine"
  echo "  Run this command on your LOCAL machine:"
  echo ""
  echo "    scp ${DATA_FILE} \${RUNPOD_SSH}:${REMOTE_WORK_DIR}/data/llama_training_data.jsonl"
  echo ""
  echo "  Or use rsync for large files:"
  echo "    rsync -avz --progress ${DATA_FILE} \${RUNPOD_SSH}:${REMOTE_WORK_DIR}/data/"
  echo ""
else
  # Running locally on RunPod
  if [ -f "/workspace/llama_training_data.jsonl" ]; then
    cp /workspace/llama_training_data.jsonl "$REMOTE_WORK_DIR/data/"
    echo "  ✓ Training data copied from /workspace/"
  fi
fi

# ── 7. Upload training script ─────────────────────────────────────────────────
echo ""
echo "▶ Step 7: Training scripts"

# Write the training script directly to the pod
cat > "$REMOTE_WORK_DIR/run_training.sh" << 'TRAINING_SCRIPT'
#!/bin/bash
set -euo pipefail
cd /workspace/cacc-training

export HF_HOME="/workspace/cacc-training/cache/huggingface"
export TRANSFORMERS_CACHE="/workspace/cacc-training/cache/transformers"
export CUDA_VISIBLE_DEVICES=0

echo "Starting CACC Appraiser fine-tuning..."
echo "GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader)"
echo "VRAM: $(nvidia-smi --query-gpu=memory.total --format=csv,noheader)"

python3 train_llama.py \
  --data data/llama_training_data.jsonl \
  --output output/cacc-appraiser-lora \
  --epochs 3

echo "Training complete! Adapter saved to: output/cacc-appraiser-lora"
echo "Next: python3 export_to_ollama.py --adapter output/cacc-appraiser-lora"
TRAINING_SCRIPT

chmod +x "$REMOTE_WORK_DIR/run_training.sh"
echo "  ✓ Training runner created: $REMOTE_WORK_DIR/run_training.sh"

# ── 8. GPU verification ───────────────────────────────────────────────────────
echo ""
echo "▶ Step 8: GPU verification..."
if command -v nvidia-smi &>/dev/null; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
  python3 -c "
import torch
if torch.cuda.is_available():
    print(f'  PyTorch CUDA: {torch.version.cuda}')
    print(f'  GPU count: {torch.cuda.device_count()}')
    for i in range(torch.cuda.device_count()):
        gb = torch.cuda.get_device_properties(i).total_memory / 1e9
        print(f'  GPU {i}: {torch.cuda.get_device_name(i)} ({gb:.1f} GB)')
else:
    print('  ⚠ CUDA not available in PyTorch')
"
else
  echo "  ⚠ nvidia-smi not found — are you on a GPU pod?"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete!                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Workspace: $REMOTE_WORK_DIR"
echo ""
echo "  Next steps:"
echo "  1. Upload training data (if not done):"
echo "     scp training_output/llama_training_data.jsonl \\"
echo "         \${RUNPOD_SSH}:${REMOTE_WORK_DIR}/data/"
echo ""
echo "  2. Copy train_llama.py to the pod:"
echo "     scp scripts/training/train_llama.py \\"
echo "         \${RUNPOD_SSH}:${REMOTE_WORK_DIR}/"
echo ""
echo "  3. SSH in and start training:"
echo "     ssh \${RUNPOD_SSH}"
echo "     cd ${REMOTE_WORK_DIR}"
echo "     bash run_training.sh"
echo ""
echo "  Estimated training time:"
echo "     A100 (40GB): ~2-3 hours for 3 epochs"
echo "     RTX 4090 (24GB): ~4-5 hours for 3 epochs"
echo "     RTX 3090 (24GB): ~5-7 hours for 3 epochs"
echo ""
