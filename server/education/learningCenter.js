/**
 * server/education/learningCenter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * In-app learning center and onboarding system.
 *
 * Reduces churn by helping users get value FAST:
 *   1. Interactive onboarding wizard (first-time user flow)
 *   2. Feature tutorials with progress tracking
 *   3. AI-powered help (ask anything about the platform)
 *   4. Best practices library
 *   5. USPAP refresher content
 *   6. Certification tracking
 *   7. CE credit tracking (continuing education hours)
 *
 * Users who complete onboarding have 3x higher retention.
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureLearningSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_onboarding (
      user_id     TEXT PRIMARY KEY,
      steps_json  TEXT DEFAULT '{}',
      completed   INTEGER DEFAULT 0,
      started_at  TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ce_credits (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      provider    TEXT NOT NULL,
      course_name TEXT NOT NULL,
      hours       REAL NOT NULL,
      credit_type TEXT DEFAULT 'CE',
      completion_date TEXT NOT NULL,
      expiration_date TEXT,
      certificate_path TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ce_user ON ce_credits(user_id);

    CREATE TABLE IF NOT EXISTS license_tracking (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      license_type TEXT NOT NULL,
      license_number TEXT NOT NULL,
      state       TEXT NOT NULL,
      issue_date  TEXT,
      expiration_date TEXT NOT NULL,
      renewal_requirements TEXT,
      ce_hours_required REAL,
      ce_hours_completed REAL DEFAULT 0,
      status      TEXT DEFAULT 'active',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_license_user ON license_tracking(user_id);
  `);
}

// Onboarding steps
const ONBOARDING_STEPS = [
  { id: 'profile', label: 'Complete your profile', description: 'Add your name, license number, and company info', points: 10 },
  { id: 'first_case', label: 'Create your first case', description: 'Start a new appraisal case', points: 15 },
  { id: 'upload_order', label: 'Upload an order form', description: 'Try the AI PDF extraction', points: 20 },
  { id: 'generate_section', label: 'Generate a narrative', description: 'AI-generate your first section', points: 20 },
  { id: 'approve_section', label: 'Approve a section', description: 'Review and approve AI output', points: 15 },
  { id: 'export_report', label: 'Export a report', description: 'Download PDF or MISMO XML', points: 15 },
  { id: 'build_voice', label: 'Build your voice profile', description: 'Train the AI on your writing style', points: 25 },
  { id: 'invite_friend', label: 'Invite a colleague', description: 'Share your referral link', points: 30 },
];

/**
 * Get user's onboarding progress.
 */
export function getOnboardingProgress(userId) {
  const db = getDb();
  let record = db.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').get(userId);

  if (!record) {
    db.prepare('INSERT INTO user_onboarding (user_id) VALUES (?)').run(userId);
    record = { user_id: userId, steps_json: '{}', completed: 0 };
  }

  const completedSteps = JSON.parse(record.steps_json || '{}');
  const totalPoints = ONBOARDING_STEPS.reduce((s, step) => s + step.points, 0);
  const earnedPoints = ONBOARDING_STEPS.filter(s => completedSteps[s.id]).reduce((s, step) => s + step.points, 0);

  return {
    steps: ONBOARDING_STEPS.map(s => ({ ...s, completed: Boolean(completedSteps[s.id]), completedAt: completedSteps[s.id] || null })),
    completedCount: Object.keys(completedSteps).length,
    totalSteps: ONBOARDING_STEPS.length,
    earnedPoints,
    totalPoints,
    percentComplete: Math.round((earnedPoints / totalPoints) * 100),
    allComplete: record.completed === 1,
  };
}

/**
 * Mark an onboarding step as complete.
 */
export function completeOnboardingStep(userId, stepId) {
  const db = getDb();
  let record = db.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').get(userId);
  if (!record) {
    db.prepare('INSERT INTO user_onboarding (user_id) VALUES (?)').run(userId);
    record = { steps_json: '{}', completed: 0 };
  }

  const steps = JSON.parse(record.steps_json || '{}');
  if (steps[stepId]) return { alreadyComplete: true };

  steps[stepId] = new Date().toISOString();
  const allDone = ONBOARDING_STEPS.every(s => steps[s.id]);

  db.prepare('UPDATE user_onboarding SET steps_json = ?, completed = ?, completed_at = ? WHERE user_id = ?')
    .run(JSON.stringify(steps), allDone ? 1 : 0, allDone ? new Date().toISOString() : null, userId);

  return { completed: true, stepId, allComplete: allDone };
}

/**
 * AI help assistant — answer any question about the platform.
 */
export async function askHelp(question) {
  const messages = [
    {
      role: 'system',
      content: `You are the Appraisal Agent help assistant. Answer questions about the platform features, USPAP compliance, appraisal best practices, and how to use the software. Be helpful, concise, and professional.

Key features to reference:
- PDF order extraction (upload any PDF → AI extracts all fields)
- One-click batch generation (all 8 narrative sections at once)
- Voice training (AI learns your writing style from approved sections)
- 3 AI providers: OpenAI, Ollama (local/free), Gemini
- Export: UAD 3.6, MISMO 2.6/3.4, PDF, ZIP bundle
- Comp analysis with auto-adjustments
- Photo AI analysis (condition/quality detection)
- UCDP pre-validation
- Inspection scheduling with route optimization
- Client portal for lender status tracking
- Invoice generation and payment tracking
- Workflow automation rules
- Template marketplace
- Referral program (earn 20% on referrals)

If asked about pricing: Free (5 reports/mo), Starter $49 (30), Professional $149 (100), Enterprise $299 (unlimited).`,
    },
    { role: 'user', content: question },
  ];

  return await callAI(messages, { maxTokens: 500, temperature: 0.3 });
}

/**
 * Add CE credit record.
 */
export function addCeCredit(userId, { provider, courseName, hours, creditType, completionDate, expirationDate }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO ce_credits (id, user_id, provider, course_name, hours, credit_type, completion_date, expiration_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, provider, courseName, hours, creditType || 'CE', completionDate, expirationDate || null);

  // Update license CE hours
  db.prepare("UPDATE license_tracking SET ce_hours_completed = ce_hours_completed + ? WHERE user_id = ? AND status = 'active'").run(hours, userId);

  return { creditId: id };
}

/**
 * Get CE credit summary.
 */
export function getCeSummary(userId) {
  const db = getDb();
  const credits = db.prepare('SELECT * FROM ce_credits WHERE user_id = ? ORDER BY completion_date DESC').all(userId);
  const totalHours = credits.reduce((s, c) => s + c.hours, 0);
  const license = db.prepare("SELECT * FROM license_tracking WHERE user_id = ? AND status = 'active' ORDER BY expiration_date").get(userId);

  return {
    totalHours,
    credits,
    license: license || null,
    hoursNeeded: license ? Math.max(0, (license.ce_hours_required || 0) - totalHours) : null,
    renewalDate: license?.expiration_date,
  };
}

/**
 * Add/update license tracking.
 */
export function trackLicense(userId, { licenseType, licenseNumber, state, issueDate, expirationDate, ceHoursRequired }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  db.prepare(`INSERT INTO license_tracking (id, user_id, license_type, license_number, state, issue_date, expiration_date, ce_hours_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, licenseType, licenseNumber, state, issueDate || null, expirationDate, ceHoursRequired || null);
  return { licenseId: id };
}

export { ONBOARDING_STEPS };
export default { ensureLearningSchema, getOnboardingProgress, completeOnboardingStep, askHelp, addCeCredit, getCeSummary, trackLicense };
