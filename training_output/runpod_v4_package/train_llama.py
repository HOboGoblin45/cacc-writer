#!/usr/bin/env python3
"""
scripts/training/train_llama.py
────────────────────────────────────────────────────────────────────────────────
QLoRA fine-tuning of Llama 3.1 8B Instruct on CACC appraisal data.

Config:
  - Model: meta-llama/Llama-3.1-8B-Instruct
  - Method: QLoRA (4-bit NF4 quantization + LoRA adapters)
  - LoRA: r=64, alpha=16, target all linear layers
  - Training: 3 epochs, batch_size=4, grad_accum=4, lr=2e-4
  - Output: ./output/cacc-appraiser-lora

Usage (RunPod — run from /workspace/ where train.jsonl and val.jsonl live):
  python train_llama.py
  python train_llama.py --train /path/to/train.jsonl --val /path/to/val.jsonl --epochs 5
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import torch
from datasets import Dataset, load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
    set_seed,
)
from peft import (
    LoraConfig,
    TaskType,
    get_peft_model,
    prepare_model_for_kbit_training,
)
from trl import SFTTrainer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

BASE_MODEL = "Qwen/Qwen2.5-14B-Instruct"
OUTPUT_DIR = "./output/cacc-appraiser-lora"
TRAIN_PATH = "./train_v4.jsonl"
VAL_PATH   = "./val_v4.jsonl"

# LoRA hyperparameters
LORA_R = 64
LORA_ALPHA = 16
LORA_DROPOUT = 0.05
LORA_TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]

# Training hyperparameters
NUM_EPOCHS = 3
BATCH_SIZE = 4
GRAD_ACCUM_STEPS = 4
LEARNING_RATE = 2e-4
MAX_SEQ_LENGTH = 2048
WARMUP_RATIO = 0.05
LR_SCHEDULER = "cosine"
WEIGHT_DECAY = 0.01

# ── Chat formatting ────────────────────────────────────────────────────────────

def format_chat_example(example: dict) -> str:
    """Format a chat example into Llama 3.1 instruction format."""
    messages = example.get("messages", [])
    if not messages:
        return ""

    formatted = ""
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "system":
            formatted += f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{content}<|eot_id|>"
        elif role == "user":
            formatted += f"<|start_header_id|>user<|end_header_id|>\n\n{content}<|eot_id|>"
        elif role == "assistant":
            formatted += f"<|start_header_id|>assistant<|end_header_id|>\n\n{content}<|eot_id|>"

    return formatted


def load_jsonl_dataset(data_path: str) -> Dataset:
    """Load a JSONL file and format examples for SFT."""
    logger.info(f"Loading data from: {data_path}")

    records = []
    with open(data_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
                formatted = format_chat_example(record)
                if formatted and len(formatted) > 100:
                    records.append({"text": formatted, "type": record.get("type", "unknown")})
            except json.JSONDecodeError as e:
                logger.warning(f"Line {line_num}: JSON parse error — {e}")

    logger.info(f"Loaded {len(records)} examples")

    # Log distribution by type
    type_counts = {}
    for r in records:
        t = r["type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    for t, c in sorted(type_counts.items()):
        logger.info(f"  {t}: {c} examples")

    return Dataset.from_list(records)


# ── Model setup ────────────────────────────────────────────────────────────────

def load_quantized_model(model_name: str):
    """Load model with 4-bit NF4 quantization for QLoRA."""
    logger.info(f"Loading base model: {model_name}")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,  # nested quantization for memory efficiency
    )

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        attn_implementation="flash_attention_2" if torch.cuda.is_available() else "eager",
    )

    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    return model


def apply_lora(model) -> object:
    """Apply LoRA adapters to the quantized model."""
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=LORA_TARGET_MODULES,
        bias="none",
        inference_mode=False,
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    return model


def load_tokenizer(model_name: str):
    """Load and configure tokenizer."""
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"  # required for SFT
    return tokenizer


# ── Training ───────────────────────────────────────────────────────────────────

def train(
    train_path: str = TRAIN_PATH,
    val_path: str = VAL_PATH,
    output_dir: str = OUTPUT_DIR,
    num_epochs: int = NUM_EPOCHS,
    resume_from: Optional[str] = None,
):
    set_seed(42)

    # Detect GPU
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
        logger.info(f"GPU: {gpu_name} ({vram_gb:.1f} GB VRAM)")
    else:
        logger.warning("No GPU detected — training will be extremely slow on CPU")

    # Load pre-split data (train.jsonl / val.jsonl)
    train_dataset = load_jsonl_dataset(train_path)
    eval_dataset  = load_jsonl_dataset(val_path)
    logger.info(f"Train: {len(train_dataset)} | Eval: {len(eval_dataset)}")

    # Load model + tokenizer
    tokenizer = load_tokenizer(BASE_MODEL)
    model = load_quantized_model(BASE_MODEL)
    model = apply_lora(model)

    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM_STEPS,
        learning_rate=LEARNING_RATE,
        lr_scheduler_type=LR_SCHEDULER,
        warmup_ratio=WARMUP_RATIO,
        weight_decay=WEIGHT_DECAY,
        fp16=False,
        bf16=True,  # use bfloat16 on A100/H100
        optim="paged_adamw_32bit",  # memory-efficient optimizer
        logging_dir=os.path.join(output_dir, "logs"),
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",  # disable wandb/tensorboard unless configured
        dataloader_num_workers=4,
        group_by_length=True,  # batch similar-length sequences for efficiency
        ddp_find_unused_parameters=False,
        resume_from_checkpoint=resume_from,
    )

    # SFT Trainer
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        args=training_args,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        packing=True,  # pack short examples for GPU efficiency
    )

    logger.info("Starting training...")
    trainer.train(resume_from_checkpoint=resume_from)

    logger.info(f"Saving LoRA adapter to: {output_dir}")
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)

    # Save training metadata
    metadata = {
        "base_model": BASE_MODEL,
        "lora_r": LORA_R,
        "lora_alpha": LORA_ALPHA,
        "lora_target_modules": LORA_TARGET_MODULES,
        "num_epochs": num_epochs,
        "batch_size": BATCH_SIZE,
        "grad_accum_steps": GRAD_ACCUM_STEPS,
        "learning_rate": LEARNING_RATE,
        "max_seq_length": MAX_SEQ_LENGTH,
        "train_path": train_path,
        "val_path": val_path,
        "train_examples": len(train_dataset),
        "eval_examples": len(eval_dataset),
    }
    with open(os.path.join(output_dir, "training_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info("Training complete!")
    logger.info(f"  Adapter saved to: {output_dir}")
    logger.info(f"  Next step: python export_to_ollama.py --adapter {output_dir}")

    return trainer


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="QLoRA fine-tune Llama 3.1 8B on CACC appraisal data")
    parser.add_argument("--train", default=TRAIN_PATH, help="Path to train.jsonl")
    parser.add_argument("--val",   default=VAL_PATH,   help="Path to val.jsonl")
    parser.add_argument("--output", default=OUTPUT_DIR, help="Directory to save LoRA adapter")
    parser.add_argument("--epochs", type=int, default=NUM_EPOCHS, help="Number of training epochs")
    parser.add_argument("--resume", default=None, help="Resume from checkpoint path")
    args = parser.parse_args()

    train(
        train_path=args.train,
        val_path=args.val,
        output_dir=args.output,
        num_epochs=args.epochs,
        resume_from=args.resume,
    )


if __name__ == "__main__":
    main()
