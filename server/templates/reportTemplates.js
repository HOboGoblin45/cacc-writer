/**
 * server/templates/reportTemplates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Report template system — save and reuse complete report configurations.
 *
 * Templates capture:
 *   - Form type and active sections
 *   - Default facts (appraiser info, market conditions, boilerplate)
 *   - AI generation preferences (temperature, max tokens, style)
 *   - Market-specific adjustment factors
 *   - Scope of work text
 *
 * This lets an appraiser set up their preferences once and apply
 * them to every new case instantly.
 */

import crypto from 'crypto';
import { getDb } from '../db/database.js';
import log from '../logger.js';

export function ensureTemplateSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_templates (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      form_type   TEXT NOT NULL DEFAULT '1004',
      is_default  INTEGER DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_templates_user ON report_templates(user_id);
  `);
}

/**
 * Get all templates for a user.
 */
export function getTemplates(userId) {
  const db = getDb();
  const templates = db.prepare('SELECT * FROM report_templates WHERE user_id = ? ORDER BY is_default DESC, name').all(userId);
  return templates.map(t => ({
    ...t,
    config: JSON.parse(t.config_json || '{}'),
    is_default: Boolean(t.is_default),
  }));
}

/**
 * Get a specific template.
 */
export function getTemplate(templateId) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM report_templates WHERE id = ?').get(templateId);
  if (!t) return null;
  return { ...t, config: JSON.parse(t.config_json || '{}'), is_default: Boolean(t.is_default) };
}

/**
 * Get the default template for a user + form type.
 */
export function getDefaultTemplate(userId, formType) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM report_templates WHERE user_id = ? AND form_type = ? AND is_default = 1').get(userId, formType);
  if (!t) return null;
  return { ...t, config: JSON.parse(t.config_json || '{}'), is_default: true };
}

/**
 * Create a new template.
 */
export function createTemplate(userId, { name, description, formType, config, isDefault }) {
  const db = getDb();

  // If setting as default, unset other defaults for this form type
  if (isDefault) {
    db.prepare('UPDATE report_templates SET is_default = 0 WHERE user_id = ? AND form_type = ?').run(userId, formType);
  }

  const id = crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO report_templates (id, user_id, name, description, form_type, is_default, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, description || '', formType || '1004', isDefault ? 1 : 0, JSON.stringify(config || {}));

  log.info('template:created', { userId, templateId: id, name, formType });
  return getTemplate(id);
}

/**
 * Update a template.
 */
export function updateTemplate(templateId, userId, updates) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM report_templates WHERE id = ? AND user_id = ?').get(templateId, userId);
  if (!existing) throw new Error('Template not found');

  if (updates.isDefault) {
    db.prepare('UPDATE report_templates SET is_default = 0 WHERE user_id = ? AND form_type = ?')
      .run(userId, updates.formType || existing.form_type);
  }

  const config = updates.config ? JSON.stringify(updates.config) : existing.config_json;

  db.prepare(`
    UPDATE report_templates
    SET name = ?, description = ?, form_type = ?, is_default = ?, config_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updates.name || existing.name,
    updates.description ?? existing.description,
    updates.formType || existing.form_type,
    updates.isDefault ? 1 : (existing.is_default || 0),
    config,
    templateId
  );

  return getTemplate(templateId);
}

/**
 * Delete a template.
 */
export function deleteTemplate(templateId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM report_templates WHERE id = ? AND user_id = ?').run(templateId, userId);
}

/**
 * Apply a template to a case — sets default facts, preferences, etc.
 */
export function applyTemplate(templateId, caseId, userId) {
  const template = getTemplate(templateId);
  if (!template) throw new Error('Template not found');

  const db = getDb();
  const caseFacts = db.prepare('SELECT * FROM case_facts WHERE case_id = ?').get(caseId);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const config = template.config;

  // Merge template defaults into facts (template values don't override existing non-empty values)
  if (config.defaultFacts) {
    for (const [section, fields] of Object.entries(config.defaultFacts)) {
      if (!facts[section]) facts[section] = {};
      for (const [key, value] of Object.entries(fields)) {
        if (!facts[section][key] || facts[section][key] === '') {
          facts[section][key] = value;
        }
      }
    }
  }

  // Save updated facts
  const now = new Date().toISOString();
  if (caseFacts) {
    db.prepare('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?')
      .run(JSON.stringify(facts), now, caseId);
  } else {
    db.prepare('INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(caseId, JSON.stringify(facts), now, now);
  }

  // Update case form type if template specifies one
  if (template.form_type) {
    db.prepare('UPDATE case_records SET form_type = ?, updated_at = ? WHERE case_id = ?')
      .run(template.form_type, now, caseId);
  }

  log.info('template:applied', { templateId, caseId, userId, formType: template.form_type });

  return { applied: true, templateName: template.name, formType: template.form_type };
}

// ── Built-in starter templates ───────────────────────────────────────────────

export const STARTER_TEMPLATES = {
  'residential-standard': {
    name: 'Residential Standard (1004)',
    description: 'Standard single-family residential appraisal. Most common form type.',
    formType: '1004',
    config: {
      defaultFacts: {
        appraiser: {
          name: '',  // User fills in once
          company: '',
          licenseNumber: '',
          licenseState: 'IL',
        },
        assignment: {
          type: 'Standard',
          purpose: 'Purchase',
          intendedUse: 'Mortgage lending decision',
          propertyRightsAppraised: 'Fee Simple',
        },
      },
      generation: {
        temperature: 0.3,
        maxTokens: 1500,
        style: 'professional',
      },
      marketFactors: {
        glaSfValue: 35,
        ageYearValue: 1500,
        bedroomValue: 5000,
        bathroomValue: 7500,
        garageValue: 10000,
        basementSfValue: 25,
      },
    },
  },
  'condo': {
    name: 'Condominium (1073)',
    description: 'Condominium unit appraisal with HOA and project analysis.',
    formType: '1073',
    config: {
      defaultFacts: {
        assignment: {
          type: 'Standard',
          purpose: 'Purchase',
          propertyRightsAppraised: 'Fee Simple',
        },
      },
      generation: { temperature: 0.3, maxTokens: 1500 },
    },
  },
  'income-property': {
    name: 'Small Income (1025)',
    description: '2-4 unit income property with income approach analysis.',
    formType: '1025',
    config: {
      defaultFacts: {
        assignment: {
          type: 'Standard',
          purpose: 'Purchase',
          propertyRightsAppraised: 'Fee Simple',
        },
      },
      generation: { temperature: 0.3, maxTokens: 2000 },
    },
  },
  'commercial': {
    name: 'Commercial Narrative',
    description: 'Commercial property narrative report with all three approaches.',
    formType: 'commercial',
    config: {
      defaultFacts: {
        assignment: {
          type: 'Standard',
          purpose: 'Purchase',
          propertyRightsAppraised: 'Fee Simple',
        },
      },
      generation: { temperature: 0.25, maxTokens: 2500 },
    },
  },
};

export default {
  ensureTemplateSchema, getTemplates, getTemplate, getDefaultTemplate,
  createTemplate, updateTemplate, deleteTemplate, applyTemplate,
  STARTER_TEMPLATES,
};
