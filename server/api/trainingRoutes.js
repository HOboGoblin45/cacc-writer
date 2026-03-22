/**
 * server/api/trainingRoutes.js
 * Training data export routes for fine-tuning custom models.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getTrainingReadiness, exportOpenAIFormat, exportHuggingFaceFormat, exportLoraFormat } from '../ai/trainingDataExporter.js';

const router = Router();

// GET /training/readiness — check if enough data for fine-tuning
router.get('/training/readiness', authMiddleware, (req, res) => {
  const readiness = getTrainingReadiness(req.user.userId);
  res.json({ ok: true, ...readiness });
});

// GET /training/export/openai — download OpenAI JSONL
router.get('/training/export/openai', authMiddleware, (req, res) => {
  const result = exportOpenAIFormat(req.user.userId);
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  res.type('application/jsonl').set('Content-Disposition', 'attachment; filename="training-openai.jsonl"').send(result.content);
});

// GET /training/export/huggingface — download HuggingFace JSON
router.get('/training/export/huggingface', authMiddleware, (req, res) => {
  const result = exportHuggingFaceFormat(req.user.userId);
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  res.type('application/json').set('Content-Disposition', 'attachment; filename="training-hf.json"').send(result.content);
});

// GET /training/export/lora — download LoRA Alpaca format
router.get('/training/export/lora', authMiddleware, (req, res) => {
  const result = exportLoraFormat(req.user.userId);
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  res.type('application/json').set('Content-Disposition', 'attachment; filename="training-lora.json"').send(result.content);
});

export default router;
