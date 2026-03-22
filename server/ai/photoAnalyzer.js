/**
 * server/ai/photoAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered inspection photo analyzer using Gemini Vision.
 *
 * Upload a photo → AI automatically:
 *   - Categorizes it (front, rear, kitchen, bathroom, etc.)
 *   - Generates a professional caption
 *   - Detects condition rating (C1-C6)
 *   - Identifies features (granite counters, hardwood floors, etc.)
 *   - Detects quality rating (Q1-Q6)
 *   - Flags issues (deferred maintenance, damage, safety concerns)
 *   - Estimates measurements from visual cues
 *
 * This replaces hours of manual photo labeling and description writing.
 */

import { analyzeImage } from './geminiProvider.js';
import { dbGet, dbRun } from '../db/database.js';
import { updatePhoto } from '../photos/photoManager.js';
import log from '../logger.js';
import fs from 'fs';

const PHOTO_ANALYSIS_PROMPT = `You are an expert residential real estate appraiser analyzing an inspection photo. Analyze this photo and return a JSON object with:

{
  "category": "front|rear|street|kitchen|bathroom|living|bedroom|basement|garage|exterior|roof|utility|other",
  "caption": "Professional photo caption suitable for an appraisal report (1 sentence)",
  "description": "Detailed description of what's visible (2-3 sentences)",
  "condition": {
    "rating": "C1|C2|C3|C4|C5|C6",
    "notes": "Brief condition assessment"
  },
  "quality": {
    "rating": "Q1|Q2|Q3|Q4|Q5|Q6",
    "notes": "Brief quality assessment"
  },
  "features": ["list of notable features visible"],
  "materials": ["list of visible materials (e.g., vinyl siding, granite counters, hardwood floors)"],
  "issues": ["list of any defects, deferred maintenance, or concerns visible"],
  "updates": ["list of any visible updates or renovations"],
  "estimatedAge": "approximate age range of what's shown if determinable",
  "confidence": "high|medium|low"
}

Be specific and professional. Use appraisal terminology. If you can't determine something, omit that field rather than guessing.`;

const CONDITION_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['front','rear','street','kitchen','bathroom','living','bedroom','basement','garage','exterior','roof','utility','other'] },
    caption: { type: 'string' },
    description: { type: 'string' },
    condition: {
      type: 'object',
      properties: {
        rating: { type: 'string', enum: ['C1','C2','C3','C4','C5','C6'] },
        notes: { type: 'string' },
      },
    },
    quality: {
      type: 'object',
      properties: {
        rating: { type: 'string', enum: ['Q1','Q2','Q3','Q4','Q5','Q6'] },
        notes: { type: 'string' },
      },
    },
    features: { type: 'array', items: { type: 'string' } },
    materials: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
    updates: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high','medium','low'] },
  },
};

/**
 * Analyze a single photo.
 *
 * @param {string} filePath — path to image file
 * @param {Object} [options]
 * @returns {Promise<Object>} analysis results
 */
export async function analyzePhoto(filePath, options = {}) {
  const imageBuffer = fs.readFileSync(filePath);
  const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const startTime = Date.now();

  const response = await analyzeImage(imageBuffer, PHOTO_ANALYSIS_PROMPT, {
    mimeType,
    responseSchema: CONDITION_SCHEMA,
    systemInstruction: 'You are a USPAP-certified residential real estate appraiser with 20 years of experience. Analyze inspection photos with expert precision.',
  });

  let analysis;
  try {
    analysis = JSON.parse(response);
  } catch {
    // Try extracting JSON from response
    const match = response.match(/\{[\s\S]*\}/);
    if (match) analysis = JSON.parse(match[0]);
    else throw new Error('Could not parse photo analysis response');
  }

  const durationMs = Date.now() - startTime;
  log.info('photo-ai:analyzed', { filePath: filePath.split(/[/\\]/).pop(), category: analysis.category, condition: analysis.condition?.rating, durationMs });

  return { ...analysis, durationMs };
}

/**
 * Analyze a photo and update its database record.
 */
export async function analyzeAndUpdatePhoto(photoId) {
  const db = dbGet.__db || (await import('../db/database.js')).getDb();
  const photo = db.prepare ? db.prepare('SELECT * FROM case_photos WHERE id = ?').get(photoId) : dbGet('SELECT * FROM case_photos WHERE id = ?', [photoId]);

  if (!photo) throw new Error('Photo not found');
  if (!photo.file_path || !fs.existsSync(photo.file_path)) {
    throw new Error('Photo file not found on disk');
  }

  const analysis = await analyzePhoto(photo.file_path);

  // Update the photo record
  updatePhoto(photoId, {
    category: analysis.category || photo.category,
    label: analysis.caption || photo.label,
    ai_description: JSON.stringify(analysis),
    description: analysis.description || photo.description,
  });

  return analysis;
}

/**
 * Analyze ALL photos for a case and generate a condition summary.
 */
export async function analyzeCasePhotos(caseId) {
  const { getDb } = await import('../db/database.js');
  const db = getDb();
  const photos = db.prepare('SELECT * FROM case_photos WHERE case_id = ? ORDER BY sort_order').all(caseId);

  if (photos.length === 0) return { error: 'No photos found for this case' };

  const results = [];
  const conditions = [];
  const qualities = [];
  const allFeatures = new Set();
  const allIssues = [];
  const allMaterials = new Set();

  for (const photo of photos) {
    if (!photo.file_path || !fs.existsSync(photo.file_path)) {
      results.push({ photoId: photo.id, error: 'File not found' });
      continue;
    }

    try {
      const analysis = await analyzePhoto(photo.file_path);

      // Update photo record
      updatePhoto(photo.id, {
        category: analysis.category || photo.category,
        label: analysis.caption || photo.label,
        ai_description: JSON.stringify(analysis),
        description: analysis.description,
      });

      if (analysis.condition?.rating) conditions.push(analysis.condition.rating);
      if (analysis.quality?.rating) qualities.push(analysis.quality.rating);
      (analysis.features || []).forEach(f => allFeatures.add(f));
      (analysis.issues || []).forEach(i => allIssues.push(i));
      (analysis.materials || []).forEach(m => allMaterials.add(m));

      results.push({ photoId: photo.id, category: analysis.category, condition: analysis.condition?.rating, ok: true });
    } catch (err) {
      results.push({ photoId: photo.id, error: err.message });
    }
  }

  // Determine overall condition
  const conditionCounts = {};
  conditions.forEach(c => { conditionCounts[c] = (conditionCounts[c] || 0) + 1; });
  const predominantCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const qualityCounts = {};
  qualities.forEach(q => { qualityCounts[q] = (qualityCounts[q] || 0) + 1; });
  const predominantQuality = Object.entries(qualityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Save summary to case facts
  const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  facts.photoAnalysis = {
    analyzedAt: new Date().toISOString(),
    photosAnalyzed: results.filter(r => r.ok).length,
    predominantCondition,
    predominantQuality,
    features: [...allFeatures],
    materials: [...allMaterials],
    issues: allIssues,
    conditionBreakdown: conditionCounts,
    qualityBreakdown: qualityCounts,
  };

  // Auto-update improvements condition/quality if not set
  if (!facts.improvements) facts.improvements = {};
  if (!facts.improvements.condition && predominantCondition) facts.improvements.condition = predominantCondition;
  if (!facts.improvements.quality && predominantQuality) facts.improvements.quality = predominantQuality;

  db.prepare(`UPDATE case_facts SET facts_json = ?, updated_at = datetime("now") WHERE case_id = ?`)
    .run(JSON.stringify(facts), caseId);

  log.info('photo-ai:case-complete', { caseId, analyzed: results.filter(r => r.ok).length, condition: predominantCondition, quality: predominantQuality });

  return {
    caseId,
    photosAnalyzed: results.filter(r => r.ok).length,
    photosFailed: results.filter(r => r.error).length,
    predominantCondition,
    predominantQuality,
    features: [...allFeatures],
    materials: [...allMaterials],
    issues: allIssues,
    results,
  };
}

export default { analyzePhoto, analyzeAndUpdatePhoto, analyzeCasePhotos };
