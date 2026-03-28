# CACC Appraiser — RunPod Fine-Tuning Package

QLoRA fine-tune of `meta-llama/Llama-3.1-8B-Instruct` on CACC appraisal training data.

## Contents

| File | Description |
|------|-------------|
| `train.jsonl` | Training set (593 examples, 90%) |
| `val.jsonl` | Validation set (67 examples, 10%) |
| `train_llama.py` | QLoRA training script (r=64, alpha=16) |
| `setup_runpod.sh` | Installs dependencies and authenticates HF |
| `export_to_ollama.py` | Merges adapter → GGUF → registers with Ollama |
| `run_all.sh` | Chains all three steps end-to-end |

## Step-by-Step RunPod Instructions

### 1. Create RunPod instance

- **GPU**: A100 40GB (recommended) or RTX 4090 24GB
- **Template**: PyTorch 2.x (CUDA 12.4)
- **Disk**: 100 GB container volume + 50 GB network volume (for model cache)

### 2. Upload this entire folder to /workspace/

```bash
# From your local machine:
scp -r runpod_package/ root@<YOUR_POD_IP>:/workspace/
# Or use the RunPod web file manager
```

### 3. SSH into the pod and run setup

```bash
export HF_TOKEN=hf_your_token_here
bash /workspace/setup_runpod.sh --local
```

This installs all Python packages and downloads the base model (~16 GB, 10-20 min).

### 4. Run training

```bash
cd /workspace
python train_llama.py
```

Or with custom options:

```bash
python train_llama.py --train train.jsonl --val val.jsonl --epochs 3
```

Training time estimates:
- A100 40GB: ~1-2 hours for 3 epochs (593 examples)
- RTX 4090 24GB: ~2-3 hours

Checkpoints are saved every 100 steps to `./output/cacc-appraiser-lora/`.

### 5. Export to Ollama format

```bash
python export_to_ollama.py --adapter ./output/cacc-appraiser-lora
```

This merges the LoRA adapter into the base model and converts to GGUF (Q4_K_M).

### 6. Download the output model files

```bash
# From your local machine:
scp -r root@<YOUR_POD_IP>:/workspace/output/ ./output/
```

Key files to download:
- `output/cacc-appraiser-lora/` — LoRA adapter (for future re-training)
- `output/gguf/cacc-appraiser-q4_k_m.gguf` — Quantized model for Ollama
- `output/gguf/Modelfile` — Ollama Modelfile

### 7. Register with Ollama locally

```bash
ollama create cacc-appraiser -f output/gguf/Modelfile
ollama run cacc-appraiser
```

## Quick Start (all-in-one)

```bash
export HF_TOKEN=hf_your_token_here
bash /workspace/run_all.sh
```

## Model Configuration

- **Base model**: `meta-llama/Llama-3.1-8B-Instruct`
- **Method**: QLoRA (4-bit NF4 + LoRA adapters)
- **LoRA rank**: r=64, alpha=16, dropout=0.05
- **Target modules**: q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
- **Epochs**: 3, batch size: 4, grad accumulation: 4 (effective batch: 16)
- **Learning rate**: 2e-4 (cosine schedule, 5% warmup)
- **Max sequence length**: 2048 tokens

## Training Data

- **Original**: 3,650 examples
- **After exact dedup**: 3,244 (-406)
- **After near-dedup (95% similarity)**: 660 (-2,584)
- **Train split**: 593 examples (90%)
- **Val split**: 67 examples (10%)

### Distribution by type

| Type | Train | Val |
|------|------:|----:|
| adjustment_reasoning | 8 | 1 |
| comp_selection | 0 | 1 |
| condition_quality | 3 | 1 |
| full_appraisal | 327 | 36 |
| narrative_writing | 165 | 18 |
| reconciliation | 90 | 10 |

## HuggingFace Access

You must accept the Llama 3.1 license at:
https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct

Then generate a token at: https://huggingface.co/settings/tokens
