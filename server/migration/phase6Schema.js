/**
 * server/migration/phase6Schema.js
 * -----------------------------------
 * Phase 6 — Memory, Voice, and Proprietary Writing Engine
 *
 * Schema additions for Phase 6:
 *   - approved_memory          — first-class approved memory store
 *   - voice_profiles           — structured voice/style profiles
 *   - voice_rules              — individual voice rules per profile
 *   - comp_commentary_memory   — dedicated comparable commentary memory
 *
 * These tables are additive — they do not modify existing Phase 1-5 tables.
 * The existing memory_items table remains for backward compatibility;
 * approved_memory is the new authoritative store for Phase 6+.
 *
 * Column migrations are also included for safe ALTER TABLE additions.
 *
 * Usage:
 *   import { initPhase6Schema } from '../migration/phase6Schema.js';
 *   initPhase6Schema(db);
 */

/**
 * Create Phase 6 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase6Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- approved_memory — First-class approved memory store
    -- ══════════════════════════════════════════════════════════════════════════
    -- This is the authoritative memory store for Phase 6+.
    -- Every item here has been reviewed and approved (or curated).
    -- Raw extracted text, unreviewed candidates, and transient artifacts
    -- do NOT belong here.
    --
    -- Bucket types:
    --   narrative_section   — full approved section narratives
    --   section_fragment    — partial section content
    --   phrase_bank         — reusable phrases/clauses
    --   comp_commentary     — comparable sale commentary (also in comp_commentary_memory)
    --   certification_pattern — certification/addendum boilerplate
    --   addendum_pattern    — addendum language patterns
    --   special_case        — special-case commentary (flood, mixed-use, etc.)
    --   voice_exemplar      — exemplary writing samples for voice calibration

    CREATE TABLE IF NOT EXISTS approved_memory (
      id                  TEXT PRIMARY KEY,
      bucket              TEXT NOT NULL DEFAULT 'narrative_section',
      source_type         TEXT NOT NULL DEFAULT 'imported',
      text                TEXT NOT NULL,
      text_hash           TEXT NOT NULL,

      -- Provenance
      source_document_id  TEXT,
      source_run_id       TEXT,
      source_section_id   TEXT,
      case_id             TEXT,

      -- Classification
      report_family       TEXT,
      form_type           TEXT,
      property_type       TEXT,
      assignment_type     TEXT,
      canonical_field_id  TEXT,
      section_group       TEXT,

      -- Context signals
      market_type         TEXT,
      county              TEXT,
      city                TEXT,
      state               TEXT,
      loan_program        TEXT,
      subject_condition   TEXT,

      -- Tags (JSON arrays)
      style_tags_json     TEXT DEFAULT '[]',
      issue_tags_json     TEXT DEFAULT '[]',

      -- Quality & approval
      quality_score       REAL DEFAULT 75,
      approval_status     TEXT DEFAULT 'approved',
      approval_timestamp  TEXT,
      approved_by         TEXT,
      provenance_note     TEXT,
      notes               TEXT,

      -- State
      active              INTEGER DEFAULT 1,
      pinned              INTEGER DEFAULT 0,

      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_approved_memory_hash
      ON approved_memory(text_hash);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_bucket
      ON approved_memory(bucket, active);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_field
      ON approved_memory(canonical_field_id, form_type, active);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_family
      ON approved_memory(report_family, active);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_approval
      ON approved_memory(approval_status, active);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_quality
      ON approved_memory(quality_score DESC);
    CREATE INDEX IF NOT EXISTS idx_approved_memory_source
      ON approved_memory(source_type, active);

    -- ══════════════════════════════════════════════════════════════════════════
    -- voice_profiles — Structured voice/style profiles
    -- ══════════════════════════════════════════════════════════════════════════
    -- Captures how the appraiser actually writes.
    -- Structured, inspectable, editable — not a black box.
    --
    -- Scope levels:
    --   global         — applies to all generation unless overridden
    --   report_family  — overrides for a specific report family (e.g. 1004, commercial)
    --   canonical_field — hints for a specific section/field

    CREATE TABLE IF NOT EXISTS voice_profiles (
      id                      TEXT PRIMARY KEY,
      name                    TEXT NOT NULL,
      scope                   TEXT NOT NULL DEFAULT 'global',
      report_family           TEXT,
      canonical_field_id      TEXT,

      -- Voice dimensions
      tone                    TEXT,
      sentence_length         TEXT,
      hedging_degree          TEXT,
      terminology_preference  TEXT,
      reconciliation_style    TEXT,
      section_opening_style   TEXT,
      section_closing_style   TEXT,

      -- Phrase lists (JSON arrays)
      preferred_phrases_json  TEXT DEFAULT '[]',
      forbidden_phrases_json  TEXT DEFAULT '[]',
      phrasing_patterns_json  TEXT DEFAULT '[]',

      -- Extensible dimensions (JSON object)
      custom_dimensions_json  TEXT DEFAULT '{}',

      active                  INTEGER DEFAULT 1,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_voice_profiles_scope
      ON voice_profiles(scope, active);
    CREATE INDEX IF NOT EXISTS idx_voice_profiles_family
      ON voice_profiles(report_family, active);
    CREATE INDEX IF NOT EXISTS idx_voice_profiles_field
      ON voice_profiles(canonical_field_id, active);

    -- ══════════════════════════════════════════════════════════════════════════
    -- voice_rules — Individual voice rules per profile
    -- ══════════════════════════════════════════════════════════════════════════
    -- Fine-grained rules that belong to a voice profile.
    -- Allows per-field overrides without duplicating entire profiles.
    --
    -- Rule types:
    --   prefer       — preferred phrasing/pattern
    --   avoid        — forbidden/disfavored phrasing
    --   pattern      — recurring sentence structure
    --   opening      — preferred section opening style
    --   closing      — preferred section closing style
    --   terminology  — preferred terminology choice

    CREATE TABLE IF NOT EXISTS voice_rules (
      id                  TEXT PRIMARY KEY,
      profile_id          TEXT NOT NULL,
      rule_type           TEXT NOT NULL,
      rule_value          TEXT NOT NULL,
      priority            INTEGER DEFAULT 50,
      canonical_field_id  TEXT,
      notes               TEXT,
      active              INTEGER DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (profile_id) REFERENCES voice_profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_voice_rules_profile
      ON voice_rules(profile_id, active);
    CREATE INDEX IF NOT EXISTS idx_voice_rules_type
      ON voice_rules(rule_type, active);
    CREATE INDEX IF NOT EXISTS idx_voice_rules_field
      ON voice_rules(canonical_field_id, active);

    -- ══════════════════════════════════════════════════════════════════════════
    -- comp_commentary_memory — Dedicated comparable commentary memory
    -- ══════════════════════════════════════════════════════════════════════════
    -- Comparable sale commentary is important enough to have its own table.
    -- This is NOT lumped into generic phrase bank logic.
    --
    -- Commentary types:
    --   comp_selection      — why a comp was selected
    --   location_adj        — locational superiority/inferiority
    --   gla_adj             — GLA/size adjustment commentary
    --   age_adj             — age/effective age adjustment
    --   condition_adj       — condition adjustment commentary
    --   design_adj          — design/style adjustment
    --   reconciliation      — comp reconciliation reasoning
    --   comp_set_strength   — comp set quality commentary
    --   no_perfect_comps    — when no ideal comparables exist
    --   rural_market        — rural/small-market specific
    --   mixed_use           — mixed-use property commentary
    --   market_time         — market time adjustment explanation
    --   general             — general comp commentary

    CREATE TABLE IF NOT EXISTS comp_commentary_memory (
      id                      TEXT PRIMARY KEY,
      text                    TEXT NOT NULL,
      text_hash               TEXT NOT NULL,
      commentary_type         TEXT NOT NULL DEFAULT 'general',

      -- Property context
      subject_property_type   TEXT,
      comp_property_type      TEXT,
      market_density          TEXT,
      urban_suburban_rural    TEXT,

      -- Classification
      report_family           TEXT,
      form_type               TEXT,
      canonical_field_id      TEXT,

      -- Tags (JSON arrays)
      issue_tags_json         TEXT DEFAULT '[]',
      adjustment_categories_json TEXT DEFAULT '[]',

      -- Quality & approval
      quality_score           REAL DEFAULT 75,
      approval_status         TEXT DEFAULT 'approved',
      approved_by             TEXT,

      -- Provenance
      source_document_id      TEXT,
      source_run_id           TEXT,
      case_id                 TEXT,
      provenance_note         TEXT,

      -- State
      active                  INTEGER DEFAULT 1,
      pinned                  INTEGER DEFAULT 0,

      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_commentary_hash
      ON comp_commentary_memory(text_hash);
    CREATE INDEX IF NOT EXISTS idx_comp_commentary_type
      ON comp_commentary_memory(commentary_type, active);
    CREATE INDEX IF NOT EXISTS idx_comp_commentary_family
      ON comp_commentary_memory(report_family, active);
    CREATE INDEX IF NOT EXISTS idx_comp_commentary_quality
      ON comp_commentary_memory(quality_score DESC);

    -- ══════════════════════════════════════════════════════════════════════════
    -- memory_staging_candidates — Enhanced staging for Phase 6
    -- ══════════════════════════════════════════════════════════════════════════
    -- Extends the Phase 5 staged_memory_reviews concept with richer metadata.
    -- Candidates from multiple sources flow here before promotion.
    --
    -- Candidate sources:
    --   extracted_narrative  — from prior report extraction (Phase 5)
    --   generated_section    — from a recent generation run
    --   edited_final         — appraiser-corrected final section
    --   phrase_candidate     — potential phrase bank item
    --   comp_commentary_candidate — potential comp commentary
    --   voice_exemplar_candidate  — potential voice exemplar

    CREATE TABLE IF NOT EXISTS memory_staging_candidates (
      id                  TEXT PRIMARY KEY,
      candidate_source    TEXT NOT NULL,
      text                TEXT NOT NULL,
      text_hash           TEXT NOT NULL,

      -- Target classification (may be assigned during review)
      target_bucket       TEXT,
      canonical_field_id  TEXT,
      report_family       TEXT,
      form_type           TEXT,
      property_type       TEXT,

      -- Context
      case_id             TEXT,
      source_document_id  TEXT,
      source_run_id       TEXT,
      source_section_id   TEXT,

      -- Tags (JSON arrays)
      style_tags_json     TEXT DEFAULT '[]',
      issue_tags_json     TEXT DEFAULT '[]',

      -- Quality
      quality_score       REAL DEFAULT 50,
      word_count          INTEGER DEFAULT 0,

      -- Review workflow
      review_status       TEXT DEFAULT 'pending',
      reviewed_at         TEXT,
      reviewed_by         TEXT,
      review_notes        TEXT,

      -- Promotion
      promoted_memory_id  TEXT,
      promoted_at         TEXT,

      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_staging_candidates_status
      ON memory_staging_candidates(review_status);
    CREATE INDEX IF NOT EXISTS idx_staging_candidates_source
      ON memory_staging_candidates(candidate_source, review_status);
    CREATE INDEX IF NOT EXISTS idx_staging_candidates_field
      ON memory_staging_candidates(canonical_field_id, review_status);
    CREATE INDEX IF NOT EXISTS idx_staging_candidates_hash
      ON memory_staging_candidates(text_hash);
  `);

  // Run column migrations for Phase 6 additions to existing tables
  runPhase6Migrations(db);
}

/**
 * Column migrations for Phase 6 additions to existing tables.
 * Uses try/catch per statement — safe to run on every startup.
 *
 * @param {import('better-sqlite3').Database} db
 */
function runPhase6Migrations(db) {
  const migrations = [
    // Add voice_profile_id to generation_runs for tracking which voice was used
    `ALTER TABLE generation_runs ADD COLUMN voice_profile_id TEXT`,

    // Add retrieval_pack_version to generation_runs
    `ALTER TABLE generation_runs ADD COLUMN retrieval_pack_version TEXT DEFAULT 'v1'`,

    // Add promoted_approved_memory_id to generated_sections for tracking promotion
    `ALTER TABLE generated_sections ADD COLUMN promoted_approved_memory_id TEXT`,

    // Add voice_hints_json to section_jobs for debugging
    `ALTER TABLE section_jobs ADD COLUMN voice_hints_json TEXT`,

    // Add retrieval_score_json to section_jobs for explainability
    `ALTER TABLE section_jobs ADD COLUMN retrieval_score_json TEXT`,
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}

export default { initPhase6Schema };
