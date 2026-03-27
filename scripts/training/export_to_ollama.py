#!/usr/bin/env python3
"""
scripts/training/export_to_ollama.py
────────────────────────────────────────────────────────────────────────────────
Export the fine-tuned LoRA adapter to Ollama format.

Pipeline:
  1. Load base model + LoRA adapter
  2. Merge adapter weights into base model
  3. Save merged model in HuggingFace format
  4. Convert to GGUF via llama.cpp (requires llama.cpp installed)
  5. Quantize to Q4_K_M (best quality/size tradeoff)
  6. Create Ollama Modelfile
  7. Register model with Ollama

Usage:
  python export_to_ollama.py --adapter ./output/cacc-appraiser-lora
  python export_to_ollama.py --adapter ./output/cacc-appraiser-lora --skip-gguf --ollama-only
  python export_to_ollama.py --help
"""

import os
import sys
import json
import shutil
import argparse
import subprocess
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

BASE_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
MODEL_NAME = "cacc-appraiser"
LLAMA_CPP_DIR = os.environ.get("LLAMA_CPP_DIR", "./llama.cpp")

MODELFILE_TEMPLATE = """\
FROM {gguf_path}

PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER repeat_penalty 1.1
PARAMETER stop "<|eot_id|>"
PARAMETER stop "<|end_of_text|>"

SYSTEM \"\"\"{system_prompt}
\"\"\"
"""

SYSTEM_PROMPT = """You are an expert residential real estate appraiser for Cresci Appraisal & Consulting Company (CACC), based in Illinois. You write USPAP-compliant appraisal reports with professional, concise, data-driven prose.

Your style characteristics:
- Every sentence adds value — no filler
- Reference specific comparables by number (Comp 1, Comp 2, etc.)
- Include specific data points: prices, GLA, year built, condition ratings
- Use standard appraisal terminology (USPAP, FNMA, HBU, GLA, etc.)
- Condition ratings on C1-C6 scale, quality on Q1-Q6 scale
- Adjustments supported by market extraction and paired sales analysis
- Final value conclusion always supported by the Sales Comparison Approach

Task types you handle:
1. Write narrative sections (neighborhood, HBU, sales comparison, condition, site)
2. Calculate and justify adjustment amounts for the sales grid
3. Select and rank comparable sales
4. Reconcile approach values into a final opinion of value
5. Assign condition and quality ratings with supporting rationale
6. Produce complete appraisal summaries from order information"""


def merge_lora_adapter(adapter_path: str, output_path: str):
    """Merge LoRA adapter into base model and save merged weights."""
    logger.info(f"Loading base model: {BASE_MODEL}")
    logger.info(f"Loading adapter: {adapter_path}")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    tokenizer = AutoTokenizer.from_pretrained(adapter_path)

    logger.info("Loading base model in fp16 (no quantization for merging)...")
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map="cpu",
        low_cpu_mem_usage=True,
    )

    logger.info("Loading LoRA adapter...")
    model = PeftModel.from_pretrained(base_model, adapter_path)

    logger.info("Merging adapter into base model weights...")
    model = model.merge_and_unload()

    logger.info(f"Saving merged model to: {output_path}")
    os.makedirs(output_path, exist_ok=True)
    model.save_pretrained(output_path, safe_serialization=True)
    tokenizer.save_pretrained(output_path)

    # Copy training metadata
    meta_src = os.path.join(adapter_path, "training_metadata.json")
    if os.path.exists(meta_src):
        shutil.copy(meta_src, os.path.join(output_path, "training_metadata.json"))

    logger.info(f"✓ Merged model saved: {output_path}")
    return output_path


def install_llama_cpp(llama_cpp_dir: str):
    """Clone and build llama.cpp if not present."""
    if os.path.isfile(os.path.join(llama_cpp_dir, "convert_hf_to_gguf.py")):
        logger.info(f"llama.cpp already present at: {llama_cpp_dir}")
        return

    logger.info("Cloning llama.cpp...")
    subprocess.run(
        ["git", "clone", "https://github.com/ggerganov/llama.cpp.git", llama_cpp_dir],
        check=True,
    )

    logger.info("Installing llama.cpp Python requirements...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r",
         os.path.join(llama_cpp_dir, "requirements.txt")],
        check=True,
    )

    # Try to build the quantization binary
    try:
        logger.info("Building llama.cpp (for quantization)...")
        subprocess.run(["make", "-j4", "-C", llama_cpp_dir, "llama-quantize"], check=True)
        logger.info("✓ llama.cpp built with GGUF quantization support")
    except subprocess.CalledProcessError:
        logger.warning("llama.cpp build failed — GGUF conversion only, no quantization")


def convert_to_gguf(merged_model_path: str, gguf_output_dir: str, llama_cpp_dir: str) -> str:
    """Convert HuggingFace model to GGUF format using llama.cpp."""
    os.makedirs(gguf_output_dir, exist_ok=True)
    gguf_f16_path = os.path.join(gguf_output_dir, "cacc-appraiser-f16.gguf")

    convert_script = os.path.join(llama_cpp_dir, "convert_hf_to_gguf.py")
    if not os.path.isfile(convert_script):
        raise FileNotFoundError(
            f"convert_hf_to_gguf.py not found at {convert_script}. "
            f"Set LLAMA_CPP_DIR or run with --skip-gguf."
        )

    logger.info(f"Converting to GGUF (F16)...")
    subprocess.run(
        [sys.executable, convert_script,
         merged_model_path,
         "--outfile", gguf_f16_path,
         "--outtype", "f16"],
        check=True,
    )
    logger.info(f"✓ GGUF F16 saved: {gguf_f16_path}")

    # Quantize to Q4_K_M
    quantize_bin = os.path.join(llama_cpp_dir, "llama-quantize")
    if not os.path.isfile(quantize_bin):
        quantize_bin = os.path.join(llama_cpp_dir, "build", "bin", "llama-quantize")

    if os.path.isfile(quantize_bin):
        gguf_q4_path = os.path.join(gguf_output_dir, "cacc-appraiser-q4_k_m.gguf")
        logger.info("Quantizing to Q4_K_M (best quality/size tradeoff)...")
        subprocess.run(
            [quantize_bin, gguf_f16_path, gguf_q4_path, "q4_k_m"],
            check=True,
        )
        logger.info(f"✓ Q4_K_M quantized: {gguf_q4_path}")
        return gguf_q4_path
    else:
        logger.warning("llama-quantize binary not found — using F16 GGUF (larger file)")
        return gguf_f16_path


def create_modelfile(gguf_path: str, output_dir: str) -> str:
    """Create an Ollama Modelfile for the exported model."""
    modelfile_content = MODELFILE_TEMPLATE.format(
        gguf_path=gguf_path,
        system_prompt=SYSTEM_PROMPT,
    )

    modelfile_path = os.path.join(output_dir, "Modelfile")
    with open(modelfile_path, "w", encoding="utf-8") as f:
        f.write(modelfile_content)

    logger.info(f"✓ Modelfile created: {modelfile_path}")
    return modelfile_path


def register_with_ollama(modelfile_path: str, model_name: str):
    """Register the model with Ollama using the Modelfile."""
    if not shutil.which("ollama"):
        logger.warning("Ollama not found in PATH — skipping registration")
        logger.info(f"To register manually: ollama create {model_name} -f {modelfile_path}")
        return

    logger.info(f"Registering model with Ollama as '{model_name}'...")
    subprocess.run(
        ["ollama", "create", model_name, "-f", modelfile_path],
        check=True,
    )
    logger.info(f"✓ Model registered: {model_name}")
    logger.info(f"  Test it: ollama run {model_name}")


def main():
    parser = argparse.ArgumentParser(description="Export fine-tuned LoRA adapter to Ollama")
    parser.add_argument("--adapter", required=True, help="Path to LoRA adapter directory")
    parser.add_argument("--merged-output", default="./output/cacc-appraiser-merged",
                        help="Where to save merged HF model")
    parser.add_argument("--gguf-output", default="./output/gguf",
                        help="Where to save GGUF files")
    parser.add_argument("--model-name", default=MODEL_NAME, help="Ollama model name")
    parser.add_argument("--llama-cpp-dir", default=LLAMA_CPP_DIR, help="Path to llama.cpp")
    parser.add_argument("--skip-merge", action="store_true",
                        help="Skip merge step (use --merged-output as pre-merged model)")
    parser.add_argument("--skip-gguf", action="store_true",
                        help="Skip GGUF conversion (Modelfile will point to merged HF model)")
    parser.add_argument("--skip-ollama", action="store_true",
                        help="Skip Ollama registration")
    parser.add_argument("--ollama-only", action="store_true",
                        help="Only create Modelfile and register (skip merge + GGUF)")
    args = parser.parse_args()

    adapter_path = os.path.abspath(args.adapter)
    merged_path = os.path.abspath(args.merged_output)
    gguf_dir = os.path.abspath(args.gguf_output)

    if not os.path.isdir(adapter_path):
        logger.error(f"Adapter directory not found: {adapter_path}")
        sys.exit(1)

    final_model_path = adapter_path  # fallback

    if not args.ollama_only:
        # Step 1: Merge LoRA adapter
        if not args.skip_merge:
            final_model_path = merge_lora_adapter(adapter_path, merged_path)
        else:
            final_model_path = merged_path
            logger.info(f"Skipping merge — using: {merged_path}")

        # Step 2: Convert to GGUF
        if not args.skip_gguf:
            install_llama_cpp(args.llama_cpp_dir)
            final_model_path = convert_to_gguf(merged_path, gguf_dir, args.llama_cpp_dir)
        else:
            logger.info("Skipping GGUF conversion")

    # Step 3: Create Modelfile
    modelfile_dir = os.path.dirname(final_model_path) if not args.ollama_only else gguf_dir
    os.makedirs(modelfile_dir, exist_ok=True)
    modelfile_path = create_modelfile(final_model_path, modelfile_dir)

    # Step 4: Register with Ollama
    if not args.skip_ollama:
        register_with_ollama(modelfile_path, args.model_name)

    logger.info("")
    logger.info("╔══════════════════════════════════════════════════════════════╗")
    logger.info("║                  Export Complete!                            ║")
    logger.info("╚══════════════════════════════════════════════════════════════╝")
    logger.info(f"  Model: {args.model_name}")
    logger.info(f"  Modelfile: {modelfile_path}")
    logger.info(f"  Final model: {final_model_path}")
    if not args.skip_ollama and shutil.which("ollama"):
        logger.info(f"  Test: ollama run {args.model_name}")


if __name__ == "__main__":
    main()
