/**
 * server/migration/phase13Schema.js
 * -----------------------------------
 * Phase 13 — Mobile / Inspection Workflow
 *
 * Schema additions:
 *   - inspections               — inspection scheduling and tracking
 *   - inspection_photos         — photo records captured during inspections
 *   - inspection_measurements   — room/area measurements
 *   - inspection_conditions     — property component condition assessments
 *
 * These tables are additive — they do not modify existing Phase 1-12 tables.
 *
 * Usage:
 *   import { initPhase13Schema } from '../migration/phase13Schema.js';
 *   initPhase13Schema(db);
 */

/**
 * Create Phase 13 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase13Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- inspections — Inspection scheduling and tracking
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each case may have one or more inspections (e.g., initial + re-inspection).
    -- Tracks scheduling, status, and completion metadata.
    --
    -- inspection_type values:
    --   interior | exterior_only | drive_by | desktop | hybrid
    --
    -- inspection_status values:
    --   scheduled | in_progress | completed | cancelled | rescheduled

    CREATE TABLE IF NOT EXISTS inspections (
      id                   TEXT PRIMARY KEY,
      case_id              TEXT NOT NULL,
      inspection_type      TEXT NOT NULL,
      inspection_status    TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_date       TEXT,
      scheduled_time       TEXT,
      actual_date          TEXT,
      inspector_name       TEXT,
      access_instructions  TEXT,
      contact_name         TEXT,
      contact_phone        TEXT,
      weather_conditions   TEXT,
      notes                TEXT,
      duration_minutes     INTEGER,
      photos_count         INTEGER DEFAULT 0,
      measurements_complete INTEGER DEFAULT 0,
      checklist_json       TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inspections_case_id
      ON inspections(case_id);
    CREATE INDEX IF NOT EXISTS idx_inspections_status
      ON inspections(inspection_status);
    CREATE INDEX IF NOT EXISTS idx_inspections_scheduled_date
      ON inspections(scheduled_date);

    -- ══════════════════════════════════════════════════════════════════════════
    -- inspection_photos — Photo records captured during inspections
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each photo is categorized for use in 1004 form photo addenda.
    -- GPS coordinates captured from EXIF data when available.
    --
    -- photo_category values:
    --   front | rear | street | kitchen | bathroom | bedroom | living_room |
    --   dining_room | basement | attic | garage | yard | mechanical |
    --   damage | comparable | other

    CREATE TABLE IF NOT EXISTS inspection_photos (
      id                TEXT PRIMARY KEY,
      inspection_id     TEXT NOT NULL,
      case_id           TEXT NOT NULL,
      photo_category    TEXT NOT NULL,
      label             TEXT,
      file_path         TEXT,
      file_name         TEXT,
      mime_type         TEXT,
      file_size         INTEGER,
      capture_date      TEXT,
      gps_lat           REAL,
      gps_lon           REAL,
      sort_order        INTEGER DEFAULT 0,
      notes             TEXT,
      is_primary        INTEGER DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inspection_photos_inspection_id
      ON inspection_photos(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_photos_case_id
      ON inspection_photos(case_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_photos_category
      ON inspection_photos(photo_category);

    -- ══════════════════════════════════════════════════════════════════════════
    -- inspection_measurements — Room / area measurements
    -- ══════════════════════════════════════════════════════════════════════════
    -- Stores individual room/area measurements for GLA calculation.
    -- Supports rectangular and irregular shapes via dimensions_json.
    --
    -- area_type values:
    --   room | level | exterior | accessory | garage | basement | attic
    --
    -- level values:
    --   main | upper | lower | basement | attic
    --
    -- shape values:
    --   rectangular | l_shaped | irregular | custom

    CREATE TABLE IF NOT EXISTS inspection_measurements (
      id                TEXT PRIMARY KEY,
      inspection_id     TEXT NOT NULL,
      case_id           TEXT NOT NULL,
      area_name         TEXT NOT NULL,
      area_type         TEXT NOT NULL,
      level             TEXT,
      length_ft         REAL,
      width_ft          REAL,
      area_sqft         REAL,
      ceiling_height_ft REAL,
      shape             TEXT DEFAULT 'rectangular',
      dimensions_json   TEXT,
      notes             TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inspection_measurements_inspection_id
      ON inspection_measurements(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_measurements_case_id
      ON inspection_measurements(case_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_measurements_area_type
      ON inspection_measurements(area_type);
    CREATE INDEX IF NOT EXISTS idx_inspection_measurements_level
      ON inspection_measurements(level);

    -- ══════════════════════════════════════════════════════════════════════════
    -- inspection_conditions — Property component condition assessments
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each row records the condition of a specific property component.
    -- Links to photos via photo_ids_json for evidence.
    --
    -- component values:
    --   foundation | exterior_walls | roof | gutters | windows | doors |
    --   flooring | walls_interior | ceiling | plumbing | electrical | hvac |
    --   insulation | appliances | fireplace | pool | deck | driveway | landscaping
    --
    -- condition_rating values:
    --   good | average | fair | poor | not_present | not_inspected

    CREATE TABLE IF NOT EXISTS inspection_conditions (
      id                    TEXT PRIMARY KEY,
      inspection_id         TEXT NOT NULL,
      case_id               TEXT NOT NULL,
      component             TEXT NOT NULL,
      condition_rating      TEXT NOT NULL,
      material              TEXT,
      age_years             INTEGER,
      remaining_life_years  INTEGER,
      deficiency            TEXT,
      repair_needed         INTEGER DEFAULT 0,
      estimated_repair_cost REAL,
      photo_ids_json        TEXT,
      notes                 TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inspection_conditions_inspection_id
      ON inspection_conditions(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_conditions_case_id
      ON inspection_conditions(case_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_conditions_component
      ON inspection_conditions(component);
    CREATE INDEX IF NOT EXISTS idx_inspection_conditions_rating
      ON inspection_conditions(condition_rating);
  `);
}

export default { initPhase13Schema };
