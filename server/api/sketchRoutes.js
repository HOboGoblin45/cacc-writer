/**
 * server/api/sketchRoutes.js
 * ---------------------------
 * AI Sketch Digitizer routes
 *
 * Mounted at: /api (in cacc-writer-server.js)
 *
 * Routes:
 *   POST /cases/:caseId/sketch/analyze  — Upload photo, AI returns room layout
 *   POST /cases/:caseId/sketch/save     — Save sketch JSON + update GLA in facts
 *   GET  /cases/:caseId/sketch          — Load saved sketch data
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import OpenAI from 'openai';
import log from '../logger.js';
import { CASES_DIR } from '../utils/caseUtils.js';
import { validateParams, validateBody, CommonSchemas } from '../middleware/validateRequest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const sketchParamsSchema = CommonSchemas.caseId;

const sketchAnalyzeBodySchema = z.object({});

const sketchSaveBodySchema = z.object({
  rooms: z.array(z.object({}).passthrough()).default([]),
  canvasData: z.any().nullable().optional(),
  totalGla: z.number().int().min(0).default(0),
  stories: z.number().int().min(1).optional(),
  notes: z.string().optional(),
});

// Memory storage — we only need the buffer to base64-encode it
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|jpg|png|webp|gif)/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are accepted'), ok);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function caseDir(caseId) {
  return path.join(CASES_DIR, caseId);
}

function sketchPath(caseId) {
  return path.join(caseDir(caseId), 'sketch.json');
}

async function loadFacts(caseId) {
  try {
    const p = path.join(caseDir(caseId), 'facts.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveFacts(caseId, facts) {
  const p = path.join(caseDir(caseId), 'facts.json');
  await fs.writeFile(p, JSON.stringify(facts, null, 2), 'utf8');
}

// ── POST /cases/:caseId/sketch/analyze ───────────────────────────────────────

router.post('/cases/:caseId/sketch/analyze', validateParams(sketchParamsSchema), upload.single('photo'), validateBody(sketchAnalyzeBodySchema), async (req, res) => {
  const { caseId } = req.validatedParams;

  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No photo uploaded' });
  }

  try {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'OpenAI API key not configured' });
    }

    const openai = new OpenAI({ apiKey });

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const prompt = `Analyze this hand-drawn floor plan sketch of a residential property. Extract all rooms with their approximate dimensions and relative positions.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "rooms": [
    {
      "id": "room_1",
      "type": "living_room",
      "label": "Living Room",
      "length": 15,
      "width": 12,
      "area": 180,
      "floor": "first",
      "x": 50,
      "y": 50,
      "includeInGla": true
    }
  ],
  "totalGla": 1456,
  "stories": 2,
  "notes": "any observations about the sketch"
}

Valid room types: living_room, kitchen, dining_room, bedroom, bathroom, basement, garage, utility, closet, hallway, foyer, porch, patio, office, other

Estimate dimensions in feet. Position rooms relative to each other using pixel coordinates (x,y) where top-left of house is (50,50) and each foot = approximately 20 pixels. Rooms should NOT overlap.

Include ALL rooms visible in the sketch. Set includeInGla to false for basement, garage, porch, patio.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || '{}';

    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const data = JSON.parse(jsonStr);

    log.info('sketch:analyze', { caseId, roomCount: data.rooms?.length, totalGla: data.totalGla });
    res.json({ ok: true, data });
  } catch (err) {
    log.error('sketch:analyze:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/sketch/save ─────────────────────────────────────────

router.post('/cases/:caseId/sketch/save', validateParams(sketchParamsSchema), validateBody(sketchSaveBodySchema), async (req, res) => {
  const { caseId } = req.validatedParams;
  const { rooms = [], canvasData = null, totalGla = 0, stories, notes } = req.validated;

  try {
    await fs.mkdir(caseDir(caseId), { recursive: true });

    const sketchData = {
      caseId,
      rooms,
      canvasData,
      totalGla,
      stories,
      notes,
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(sketchPath(caseId), JSON.stringify(sketchData, null, 2), 'utf8');

    // Update facts.json with GLA if available
    if (totalGla && totalGla > 0) {
      const facts = await loadFacts(caseId);
      facts.grossLivingArea = String(totalGla);
      facts.gla = String(totalGla);
      await saveFacts(caseId, facts);
    }

    log.info('sketch:save', { caseId, roomCount: rooms.length, totalGla });
    res.json({ ok: true, message: 'Sketch saved', totalGla });
  } catch (err) {
    log.error('sketch:save:error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/sketch ────────────────────────────────────────────────

router.get('/cases/:caseId/sketch', validateParams(sketchParamsSchema), async (req, res) => {
  const { caseId } = req.validatedParams;
  try {
    const raw = await fs.readFile(sketchPath(caseId), 'utf8');
    const data = JSON.parse(raw);
    res.json({ ok: true, data });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ ok: true, data: null }); // No sketch yet — that's fine
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
