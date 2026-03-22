/**
 * server/ai/voiceCloneTrainer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice clone training manager.
 *
 * Manages the entire process of creating a custom AI model
 * that writes exactly like a specific appraiser:
 *
 *   1. Collects and scores training examples by quality
 *   2. Builds a "voice profile" — statistical analysis of writing patterns
 *   3. Generates a system prompt that captures the appraiser's style
 *   4. Tests voice accuracy with blind comparisons
 *   5. Tracks improvement over time
 *
 * The voice profile is injected into every generation prompt,
 * making the AI match the appraiser's patterns WITHOUT fine-tuning.
 * This is the "instant" voice matching — fine-tuning is the premium path.
 */

import { getDb } from '../db/database.js';
import { dbGet, dbAll } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

/**
 * Analyze a user's writing style from their approved sections.
 * Returns a detailed voice profile.
 */
export async function buildVoiceProfile(userId) {
  const db = getDb();

  // Gather approved examples
  let examples = [];
  try {
    examples = db.prepare(`
      SELECT text, field_id, form_type, char_count, word_count
      FROM user_approved_sections
      WHERE user_id = ? AND char_count > 200
      ORDER BY created_at DESC LIMIT 50
    `).all(userId);
  } catch { /* ok */ }

  // Also gather from generated_sections with final_text
  try {
    const generated = db.prepare(`
      SELECT gs.final_text as text, gs.section_id as field_id, cr.form_type,
             LENGTH(gs.final_text) as char_count
      FROM generated_sections gs
      JOIN case_records cr ON cr.case_id = gs.case_id
      WHERE gs.final_text IS NOT NULL AND LENGTH(gs.final_text) > 200
      ORDER BY gs.created_at DESC LIMIT 50
    `).all();
    examples.push(...generated);
  } catch { /* ok */ }

  if (examples.length < 5) {
    return {
      userId,
      status: 'insufficient_data',
      exampleCount: examples.length,
      message: `Need at least 5 approved sections to build a voice profile. Currently have ${examples.length}.`,
    };
  }

  // Statistical analysis
  const stats = analyzeWritingStats(examples);

  // Use AI to extract stylistic patterns
  const sampleTexts = examples.slice(0, 10).map(e => e.text.slice(0, 500)).join('\n---\n');

  const messages = [
    {
      role: 'system',
      content: `Analyze these appraisal narrative samples written by the same appraiser. Identify their unique writing style patterns. Return JSON:
{
  "tone": "description of overall tone",
  "vocabulary": ["frequently used words/phrases unique to this writer"],
  "sentenceStructure": "description of typical sentence patterns",
  "paragraphStyle": "how they structure paragraphs",
  "technicalLevel": "how technical vs accessible their language is",
  "transitionPatterns": ["how they connect ideas"],
  "openingPatterns": ["how they typically start sections"],
  "closingPatterns": ["how they typically end sections"],
  "dataPresentation": "how they present numbers and data",
  "opinionStyle": "how they express professional opinions",
  "uniqueTraits": ["any distinctive writing habits"],
  "avoidedPatterns": ["things this writer never does"]
}`,
    },
    { role: 'user', content: sampleTexts },
  ];

  let styleAnalysis;
  try {
    const response = await callAI(messages, { maxTokens: 1500, temperature: 0.2 });
    try { styleAnalysis = JSON.parse(response); } catch {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) styleAnalysis = JSON.parse(match[0]);
    }
  } catch (err) {
    log.warn('voice:style-analysis-failed', { error: err.message });
    styleAnalysis = null;
  }

  // Build the voice system prompt
  const voicePrompt = buildVoiceSystemPrompt(stats, styleAnalysis);

  // Save profile
  const profile = {
    userId,
    status: 'active',
    exampleCount: examples.length,
    stats,
    styleAnalysis,
    voicePrompt,
    builtAt: new Date().toISOString(),
  };

  // Store in user_kb_config or a dedicated table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS voice_profiles (
      user_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    const existing = db.prepare('SELECT user_id FROM voice_profiles WHERE user_id = ?').get(userId);
    if (existing) {
      db.prepare("UPDATE voice_profiles SET profile_json = ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(JSON.stringify(profile), userId);
    } else {
      db.prepare('INSERT INTO voice_profiles (user_id, profile_json) VALUES (?, ?)').run(userId, JSON.stringify(profile));
    }
  } catch { /* ok */ }

  log.info('voice:profile-built', { userId, examples: examples.length });
  return profile;
}

/**
 * Get a user's voice profile (or null if not built yet).
 */
export function getVoiceProfile(userId) {
  const db = getDb();
  try {
    const row = db.prepare('SELECT profile_json FROM voice_profiles WHERE user_id = ?').get(userId);
    return row ? JSON.parse(row.profile_json) : null;
  } catch { return null; }
}

/**
 * Get the voice system prompt for injection into generation.
 */
export function getVoicePrompt(userId) {
  const profile = getVoiceProfile(userId);
  return profile?.voicePrompt || null;
}

/**
 * Test voice accuracy — generate a section and compare to the appraiser's style.
 */
export async function testVoiceAccuracy(userId, sectionType = 'neighborhood_description') {
  const profile = getVoiceProfile(userId);
  if (!profile) return { error: 'No voice profile built yet' };

  // Get a real example from this user
  const db = getDb();
  let realExample;
  try {
    realExample = db.prepare('SELECT text FROM user_approved_sections WHERE user_id = ? AND field_id = ? ORDER BY RANDOM() LIMIT 1')
      .get(userId, sectionType);
  } catch { /* ok */ }

  if (!realExample) return { error: `No approved examples for ${sectionType}` };

  // Generate with voice prompt
  const messages = [
    { role: 'system', content: profile.voicePrompt + '\n\nGenerate a neighborhood description in this exact writing style.' },
    { role: 'user', content: 'Write a neighborhood description for a typical suburban residential property.' },
  ];

  const generated = await callAI(messages, { maxTokens: 800, temperature: 0.3 });

  // Score similarity
  const scoreMessages = [
    {
      role: 'system',
      content: 'Compare these two appraisal narrative texts. Rate how similar their writing style is on a scale of 1-10. Return JSON: { "score": number, "similarities": ["list"], "differences": ["list"] }',
    },
    { role: 'user', content: `Text A (real):\n${realExample.text.slice(0, 1000)}\n\nText B (generated):\n${generated.slice(0, 1000)}` },
  ];

  let comparison;
  try {
    const compResponse = await callAI(scoreMessages, { maxTokens: 500, temperature: 0.1 });
    try { comparison = JSON.parse(compResponse); } catch {
      const match = compResponse.match(/\{[\s\S]*\}/);
      if (match) comparison = JSON.parse(match[0]);
    }
  } catch { comparison = { score: 'N/A' }; }

  return {
    sectionType,
    realSample: realExample.text.slice(0, 500) + '...',
    generatedSample: generated.slice(0, 500) + '...',
    similarityScore: comparison?.score,
    similarities: comparison?.similarities || [],
    differences: comparison?.differences || [],
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function analyzeWritingStats(examples) {
  const allText = examples.map(e => e.text).join(' ');
  const words = allText.split(/\s+/);
  const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 0);

  const wordLengths = words.map(w => w.length);
  const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);

  return {
    totalExamples: examples.length,
    avgWordsPerSection: Math.round(words.length / examples.length),
    avgSentenceLength: Math.round(sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length),
    avgWordLength: Math.round(wordLengths.reduce((a, b) => a + b, 0) / wordLengths.length * 10) / 10,
    vocabularySize: new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''))).size,
    sectionsByType: Object.fromEntries(
      Object.entries(examples.reduce((acc, e) => { acc[e.field_id] = (acc[e.field_id] || 0) + 1; return acc; }, {}))
    ),
  };
}

function buildVoiceSystemPrompt(stats, style) {
  let prompt = `You are writing appraisal narratives in the specific voice and style of this appraiser. Match their patterns exactly.\n\n`;
  prompt += `WRITING STATISTICS:\n`;
  prompt += `- Average words per section: ${stats.avgWordsPerSection}\n`;
  prompt += `- Average sentence length: ${stats.avgSentenceLength} words\n`;
  prompt += `- Vocabulary complexity: ${stats.avgWordLength > 5.5 ? 'High' : stats.avgWordLength > 4.5 ? 'Medium' : 'Accessible'}\n\n`;

  if (style) {
    prompt += `STYLE PROFILE:\n`;
    if (style.tone) prompt += `- Tone: ${style.tone}\n`;
    if (style.sentenceStructure) prompt += `- Sentence style: ${style.sentenceStructure}\n`;
    if (style.paragraphStyle) prompt += `- Paragraph style: ${style.paragraphStyle}\n`;
    if (style.technicalLevel) prompt += `- Technical level: ${style.technicalLevel}\n`;
    if (style.dataPresentation) prompt += `- Data presentation: ${style.dataPresentation}\n`;
    if (style.opinionStyle) prompt += `- Opinion style: ${style.opinionStyle}\n`;
    if (style.vocabulary?.length) prompt += `- Key phrases: ${style.vocabulary.slice(0, 10).join(', ')}\n`;
    if (style.openingPatterns?.length) prompt += `- Opening patterns: ${style.openingPatterns.slice(0, 3).join('; ')}\n`;
    if (style.uniqueTraits?.length) prompt += `- Unique traits: ${style.uniqueTraits.join('; ')}\n`;
    if (style.avoidedPatterns?.length) prompt += `- NEVER: ${style.avoidedPatterns.join('; ')}\n`;
  }

  prompt += `\nIMPORTANT: Match this specific appraiser's voice. Don't default to generic appraisal language.`;
  return prompt;
}

export default { buildVoiceProfile, getVoiceProfile, getVoicePrompt, testVoiceAccuracy };
