-- ════════════════════════════════════════════════════════════════════════════════
-- PostgreSQL Schema for CACC Writer
-- ════════════════════════════════════════════════════════════════════════════════
-- This is the complete PostgreSQL DDL translation of all SQLite tables.
-- Generated from migration files: phase6-phase20, pipeline, brain, and core schema.
-- Total tables: ~110
--
-- Key Translation Rules:
--   - TEXT PRIMARY KEY → TEXT PRIMARY KEY
--   - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
--   - datetime('now') → NOW()
--   - REAL → DOUBLE PRECISION
--   - TEXT (for JSON) → JSONB (optional upgrade)
--   - All tables created in cacc schema
--   - All indexes namespaced to schema

CREATE SCHEMA IF NOT EXISTS cacc;

-- ════════════════════════════════════════════════════════════════════════════════
-- CORE ASSIGNMENT & CASE MANAGEMENT
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_assignments_case_id ON cacc.assignments(case_id);

CREATE TABLE cacc.case_records (
  case_id TEXT PRIMARY KEY,
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  pipeline_stage TEXT NOT NULL DEFAULT 'intake',
  workflow_status TEXT NOT NULL DEFAULT 'facts_incomplete',
  address TEXT NOT NULL DEFAULT '',
  borrower TEXT NOT NULL DEFAULT '',
  unresolved_issues_json TEXT NOT NULL DEFAULT '[]',
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_case_records_updated_at ON cacc.case_records(updated_at);

CREATE TABLE cacc.case_facts (
  case_id TEXT PRIMARY KEY,
  facts_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (case_id) REFERENCES cacc.case_records(case_id) ON DELETE CASCADE
);

CREATE TABLE cacc.case_outputs (
  case_id TEXT PRIMARY KEY,
  outputs_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (case_id) REFERENCES cacc.case_records(case_id) ON DELETE CASCADE
);

CREATE TABLE cacc.case_history (
  case_id TEXT PRIMARY KEY,
  history_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (case_id) REFERENCES cacc.case_records(case_id) ON DELETE CASCADE
);

-- ════════════════════════════════════════════════════════════════════════════════
-- REPORT PLANNING & GENERATION
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.report_plans (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (assignment_id) REFERENCES cacc.assignments(id)
);
CREATE INDEX idx_report_plans_assignment_id ON cacc.report_plans(assignment_id);

CREATE TABLE cacc.generation_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  assignment_id TEXT,
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  context_build_ms INTEGER,
  report_plan_ms INTEGER,
  retrieval_ms INTEGER,
  analysis_ms INTEGER,
  parallel_draft_ms INTEGER,
  validation_ms INTEGER,
  assembly_ms INTEGER,
  section_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  partial_complete INTEGER DEFAULT 0,
  retrieval_cache_hit INTEGER DEFAULT 0,
  memory_items_scanned INTEGER DEFAULT 0,
  memory_items_used INTEGER DEFAULT 0,
  warnings_json TEXT DEFAULT '[]',
  metrics_json TEXT DEFAULT '{}',
  error_text TEXT,
  voice_profile_id TEXT,
  retrieval_pack_version TEXT DEFAULT 'v1',
  draft_package_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_generation_runs_case_id ON cacc.generation_runs(case_id);
CREATE INDEX idx_generation_runs_status ON cacc.generation_runs(status);

CREATE TABLE cacc.section_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generator_profile TEXT,
  prompt_version TEXT,
  dependencies_json TEXT DEFAULT '[]',
  section_policy_json TEXT DEFAULT '{}',
  dependency_snapshot_json TEXT DEFAULT '{}',
  attempt_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  dependency_wait_ms INTEGER,
  input_chars INTEGER,
  output_chars INTEGER,
  warnings_count INTEGER DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_text TEXT,
  retrieval_source_ids_json TEXT DEFAULT '[]',
  estimated_cost_usd DOUBLE PRECISION,
  voice_hints_json TEXT,
  retrieval_score_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES cacc.generation_runs(id)
);
CREATE INDEX idx_section_jobs_run_id ON cacc.section_jobs(run_id);
CREATE INDEX idx_section_jobs_status ON cacc.section_jobs(status);

CREATE TABLE cacc.generated_sections (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  draft_text TEXT,
  reviewed_text TEXT,
  final_text TEXT,
  audit_metadata_json TEXT DEFAULT '{}',
  quality_score DOUBLE PRECISION,
  quality_metadata_json TEXT DEFAULT '{}',
  examples_used INTEGER DEFAULT 0,
  approved INTEGER DEFAULT 0,
  approved_at TIMESTAMPTZ,
  inserted_at TIMESTAMPTZ,
  promoted_approved_memory_id TEXT,
  prompt_version TEXT,
  section_policy_json TEXT,
  dependency_snapshot_json TEXT,
  quality_factors_json TEXT,
  freshness_status TEXT DEFAULT 'current',
  stale_reason TEXT,
  stale_since TIMESTAMPTZ,
  regeneration_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (job_id) REFERENCES cacc.section_jobs(id)
);
CREATE INDEX idx_generated_sections_case_id ON cacc.generated_sections(case_id);
CREATE INDEX idx_generated_sections_run_id ON cacc.generated_sections(run_id);
CREATE INDEX idx_generated_sections_section_id ON cacc.generated_sections(section_id, case_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- MEMORY & RETRIEVAL
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.memory_items (
  id TEXT PRIMARY KEY,
  section_type TEXT NOT NULL,
  form_type TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  quality_score DOUBLE PRECISION DEFAULT 75,
  approved INTEGER DEFAULT 0,
  staged INTEGER DEFAULT 0,
  property_type TEXT,
  market_type TEXT,
  city TEXT,
  county TEXT,
  state TEXT,
  assignment_purpose TEXT,
  loan_program TEXT,
  subject_condition TEXT,
  tags_json TEXT DEFAULT '[]',
  metadata_json TEXT DEFAULT '{}',
  source_file TEXT,
  source_report_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_memory_items_section_form ON cacc.memory_items(section_type, form_type);
CREATE INDEX idx_memory_items_approved ON cacc.memory_items(approved, quality_score);

CREATE TABLE cacc.retrieval_cache (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  section_id TEXT,
  pack_json TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_retrieval_cache_assignment ON cacc.retrieval_cache(assignment_id, section_id);
CREATE INDEX idx_retrieval_cache_expires ON cacc.retrieval_cache(expires_at);

CREATE TABLE cacc.analysis_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  section_id TEXT,
  data_json TEXT NOT NULL,
  duration_ms INTEGER,
  warnings_json TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES cacc.generation_runs(id)
);
CREATE INDEX idx_analysis_artifacts_run_id ON cacc.analysis_artifacts(run_id);

CREATE TABLE cacc.ingest_jobs (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sections_extracted INTEGER DEFAULT 0,
  phrases_extracted INTEGER DEFAULT 0,
  error_text TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ingest_jobs_status ON cacc.ingest_jobs(status);

CREATE TABLE cacc.staged_memory_reviews (
  id TEXT PRIMARY KEY,
  ingest_job_id TEXT,
  section_type TEXT NOT NULL,
  form_type TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  source_file TEXT,
  metadata_json TEXT DEFAULT '{}',
  review_status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  promoted_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_staged_reviews_status ON cacc.staged_memory_reviews(review_status);
CREATE INDEX idx_staged_reviews_form ON cacc.staged_memory_reviews(form_type, section_type);

-- ════════════════════════════════════════════════════════════════════════════════
-- ASSIGNMENT INTELLIGENCE (Phase B onwards)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.assignment_intelligence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_assignment_intelligence_case_id ON cacc.assignment_intelligence(case_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- CASE DOCUMENTS & EXTRACTION (Phase C onwards)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.case_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'unknown',
  file_type TEXT NOT NULL DEFAULT 'pdf',
  file_size_bytes INTEGER DEFAULT 0,
  page_count INTEGER DEFAULT 0,
  file_hash TEXT,
  classification_method TEXT DEFAULT 'manual',
  classification_confidence DOUBLE PRECISION DEFAULT 1.0,
  extraction_status TEXT DEFAULT 'pending',
  text_length INTEGER DEFAULT 0,
  notes TEXT,
  tags_json TEXT DEFAULT '[]',
  duplicate_of_document_id TEXT,
  ingestion_warning TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_case_documents_case_id ON cacc.case_documents(case_id);
CREATE INDEX idx_case_documents_doc_type ON cacc.case_documents(doc_type);

CREATE TABLE cacc.document_ingest_jobs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  document_id TEXT,
  original_filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  steps_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  recoverable_actions_json TEXT NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (document_id) REFERENCES cacc.case_documents(id)
);
CREATE INDEX idx_doc_ingest_jobs_case_id ON cacc.document_ingest_jobs(case_id, created_at DESC);
CREATE INDEX idx_doc_ingest_jobs_status ON cacc.document_ingest_jobs(status, updated_at DESC);

CREATE TABLE cacc.document_extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  extraction_method TEXT,
  facts_extracted INTEGER DEFAULT 0,
  sections_extracted INTEGER DEFAULT 0,
  raw_text_length INTEGER DEFAULT 0,
  result_json TEXT DEFAULT '{}',
  error_text TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (document_id) REFERENCES cacc.case_documents(id)
);
CREATE INDEX idx_doc_extractions_document_id ON cacc.document_extractions(document_id);
CREATE INDEX idx_doc_extractions_case_id ON cacc.document_extractions(case_id);

CREATE TABLE cacc.extracted_facts (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  fact_path TEXT NOT NULL,
  fact_value TEXT,
  confidence TEXT DEFAULT 'medium',
  source_page INTEGER,
  source_text TEXT,
  review_status TEXT DEFAULT 'pending',
  merged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (extraction_id) REFERENCES cacc.document_extractions(id),
  FOREIGN KEY (document_id) REFERENCES cacc.case_documents(id)
);
CREATE INDEX idx_extracted_facts_case_id ON cacc.extracted_facts(case_id);
CREATE INDEX idx_extracted_facts_extraction_id ON cacc.extracted_facts(extraction_id);
CREATE INDEX idx_extracted_facts_review ON cacc.extracted_facts(review_status);

CREATE TABLE cacc.extracted_sections (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  section_type TEXT NOT NULL,
  section_label TEXT,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  source_page_start INTEGER,
  source_page_end INTEGER,
  form_type TEXT,
  confidence DOUBLE PRECISION DEFAULT 0.7,
  review_status TEXT DEFAULT 'pending',
  promoted_memory_id TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (extraction_id) REFERENCES cacc.document_extractions(id),
  FOREIGN KEY (document_id) REFERENCES cacc.case_documents(id)
);
CREATE INDEX idx_extracted_sections_case_id ON cacc.extracted_sections(case_id);
CREATE INDEX idx_extracted_sections_review ON cacc.extracted_sections(review_status);
CREATE INDEX idx_extracted_sections_hash ON cacc.extracted_sections(text_hash);

-- ════════════════════════════════════════════════════════════════════════════════
-- COMPARABLE INTELLIGENCE (Phase D/H foundation)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.comp_candidates (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_document_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  is_active INTEGER NOT NULL DEFAULT 1,
  candidate_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, source_key)
);
CREATE INDEX idx_comp_candidates_case_active ON cacc.comp_candidates(case_id, is_active, review_status);

CREATE TABLE cacc.comp_scores (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT NOT NULL,
  overall_score DOUBLE PRECISION NOT NULL,
  coverage_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  weights_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE
);
CREATE INDEX idx_comp_scores_case_candidate ON cacc.comp_scores(case_id, comp_candidate_id);

CREATE TABLE cacc.comp_tier_assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  reasoning_json TEXT NOT NULL DEFAULT '{}',
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE
);
CREATE INDEX idx_comp_tiers_case_candidate ON cacc.comp_tier_assignments(case_id, comp_candidate_id);

CREATE TABLE cacc.comp_acceptance_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT NOT NULL,
  accepted_by TEXT NOT NULL DEFAULT 'appraiser',
  grid_slot TEXT,
  ranking_score DOUBLE PRECISION,
  visible_reasoning_json TEXT NOT NULL DEFAULT '{}',
  became_final_comp INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  accepted_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE
);
CREATE INDEX idx_comp_acceptance_case_candidate ON cacc.comp_acceptance_events(case_id, comp_candidate_id, accepted_at DESC);

CREATE TABLE cacc.comp_rejection_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT NOT NULL,
  rejected_by TEXT NOT NULL DEFAULT 'appraiser',
  reason_code TEXT NOT NULL,
  ranking_score DOUBLE PRECISION,
  visible_reasoning_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  rejected_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE
);
CREATE INDEX idx_comp_rejection_case_candidate ON cacc.comp_rejection_events(case_id, comp_candidate_id, rejected_at DESC);

CREATE TABLE cacc.adjustment_support_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT,
  grid_slot TEXT NOT NULL,
  adjustment_category TEXT NOT NULL,
  subject_value TEXT,
  comp_value TEXT,
  support_type TEXT NOT NULL DEFAULT 'appraiser_judgment_with_explanation',
  support_strength TEXT NOT NULL DEFAULT 'medium',
  suggested_amount DOUBLE PRECISION,
  suggested_range_json TEXT NOT NULL DEFAULT '{}',
  final_amount DOUBLE PRECISION,
  final_range_json TEXT NOT NULL DEFAULT '{}',
  support_evidence_json TEXT NOT NULL DEFAULT '[]',
  rationale_note TEXT,
  decision_status TEXT NOT NULL DEFAULT 'pending',
  recommendation_source TEXT NOT NULL DEFAULT 'heuristic_seed',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE,
  UNIQUE(case_id, grid_slot, adjustment_category)
);
CREATE INDEX idx_adjustment_support_case_candidate ON cacc.adjustment_support_records(case_id, comp_candidate_id, decision_status);

CREATE TABLE cacc.adjustment_recommendations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT,
  grid_slot TEXT NOT NULL,
  adjustment_category TEXT NOT NULL,
  recommendation_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE,
  UNIQUE(case_id, grid_slot, adjustment_category)
);

CREATE TABLE cacc.paired_sales_library_records (
  id TEXT PRIMARY KEY,
  market_area TEXT,
  property_type TEXT,
  date_range_start TEXT,
  date_range_end TEXT,
  variable_analyzed TEXT NOT NULL,
  support_method TEXT NOT NULL,
  sample_size INTEGER,
  conclusion TEXT,
  confidence TEXT,
  narrative_summary TEXT,
  linked_assignments_json TEXT NOT NULL DEFAULT '[]',
  linked_comp_sets_json TEXT NOT NULL DEFAULT '[]',
  creator TEXT,
  reviewer TEXT,
  approval_status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_paired_sales_library_variable ON cacc.paired_sales_library_records(variable_analyzed, approval_status);

CREATE TABLE cacc.comp_burden_metrics (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  comp_candidate_id TEXT,
  grid_slot TEXT NOT NULL,
  gross_adjustment_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_adjustment_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  burden_by_category_json TEXT NOT NULL DEFAULT '{}',
  major_mismatch_count INTEGER NOT NULL DEFAULT 0,
  data_confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  date_relevance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  location_confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  overall_stability_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (comp_candidate_id) REFERENCES cacc.comp_candidates(id) ON DELETE CASCADE,
  UNIQUE(case_id, grid_slot)
);

CREATE TABLE cacc.reconciliation_support_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  support_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 6: VOICE & APPROVED MEMORY
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.approved_memory (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL DEFAULT 'narrative_section',
  source_type TEXT NOT NULL DEFAULT 'imported',
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE,
  source_document_id TEXT,
  source_run_id TEXT,
  source_section_id TEXT,
  case_id TEXT,
  report_family TEXT,
  form_type TEXT,
  property_type TEXT,
  assignment_type TEXT,
  canonical_field_id TEXT,
  section_group TEXT,
  market_type TEXT,
  county TEXT,
  city TEXT,
  state TEXT,
  loan_program TEXT,
  subject_condition TEXT,
  style_tags_json TEXT DEFAULT '[]',
  issue_tags_json TEXT DEFAULT '[]',
  quality_score DOUBLE PRECISION DEFAULT 75,
  approval_status TEXT DEFAULT 'approved',
  approval_timestamp TIMESTAMPTZ,
  approved_by TEXT,
  provenance_note TEXT,
  notes TEXT,
  active INTEGER DEFAULT 1,
  pinned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_approved_memory_bucket ON cacc.approved_memory(bucket, active);
CREATE INDEX idx_approved_memory_field ON cacc.approved_memory(canonical_field_id, form_type, active);
CREATE INDEX idx_approved_memory_family ON cacc.approved_memory(report_family, active);
CREATE INDEX idx_approved_memory_approval ON cacc.approved_memory(approval_status, active);
CREATE INDEX idx_approved_memory_quality ON cacc.approved_memory(quality_score DESC);
CREATE INDEX idx_approved_memory_source ON cacc.approved_memory(source_type, active);

CREATE TABLE cacc.voice_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  report_family TEXT,
  canonical_field_id TEXT,
  tone TEXT,
  sentence_length TEXT,
  hedging_degree TEXT,
  terminology_preference TEXT,
  reconciliation_style TEXT,
  section_opening_style TEXT,
  section_closing_style TEXT,
  preferred_phrases_json TEXT DEFAULT '[]',
  forbidden_phrases_json TEXT DEFAULT '[]',
  phrasing_patterns_json TEXT DEFAULT '[]',
  custom_dimensions_json TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_voice_profiles_scope ON cacc.voice_profiles(scope, active);
CREATE INDEX idx_voice_profiles_family ON cacc.voice_profiles(report_family, active);
CREATE INDEX idx_voice_profiles_field ON cacc.voice_profiles(canonical_field_id, active);

CREATE TABLE cacc.voice_rules (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_value TEXT NOT NULL,
  priority INTEGER DEFAULT 50,
  canonical_field_id TEXT,
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES cacc.voice_profiles(id)
);
CREATE INDEX idx_voice_rules_profile ON cacc.voice_rules(profile_id, active);
CREATE INDEX idx_voice_rules_type ON cacc.voice_rules(rule_type, active);
CREATE INDEX idx_voice_rules_field ON cacc.voice_rules(canonical_field_id, active);

CREATE TABLE cacc.comp_commentary_memory (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE,
  commentary_type TEXT NOT NULL DEFAULT 'general',
  subject_property_type TEXT,
  comp_property_type TEXT,
  market_density TEXT,
  urban_suburban_rural TEXT,
  report_family TEXT,
  form_type TEXT,
  canonical_field_id TEXT,
  issue_tags_json TEXT DEFAULT '[]',
  adjustment_categories_json TEXT DEFAULT '[]',
  quality_score DOUBLE PRECISION DEFAULT 75,
  approval_status TEXT DEFAULT 'approved',
  approved_by TEXT,
  source_document_id TEXT,
  source_run_id TEXT,
  case_id TEXT,
  provenance_note TEXT,
  active INTEGER DEFAULT 1,
  pinned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comp_commentary_type ON cacc.comp_commentary_memory(commentary_type, active);
CREATE INDEX idx_comp_commentary_family ON cacc.comp_commentary_memory(report_family, active);
CREATE INDEX idx_comp_commentary_quality ON cacc.comp_commentary_memory(quality_score DESC);

CREATE TABLE cacc.memory_staging_candidates (
  id TEXT PRIMARY KEY,
  candidate_source TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  target_bucket TEXT,
  canonical_field_id TEXT,
  report_family TEXT,
  form_type TEXT,
  property_type TEXT,
  case_id TEXT,
  source_document_id TEXT,
  source_run_id TEXT,
  source_section_id TEXT,
  style_tags_json TEXT DEFAULT '[]',
  issue_tags_json TEXT DEFAULT '[]',
  quality_score DOUBLE PRECISION DEFAULT 50,
  word_count INTEGER DEFAULT 0,
  review_status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_notes TEXT,
  promoted_memory_id TEXT,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_staging_candidates_status ON cacc.memory_staging_candidates(review_status);
CREATE INDEX idx_staging_candidates_source ON cacc.memory_staging_candidates(candidate_source, review_status);
CREATE INDEX idx_staging_candidates_field ON cacc.memory_staging_candidates(canonical_field_id, review_status);
CREATE INDEX idx_staging_candidates_hash ON cacc.memory_staging_candidates(text_hash);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 7: QUALITY CONTROL
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.qc_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  generation_run_id TEXT,
  draft_package_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rule_set_version TEXT NOT NULL DEFAULT '1.0',
  report_family TEXT,
  form_type TEXT,
  flags_snapshot_json TEXT DEFAULT '{}',
  summary_json TEXT DEFAULT '{}',
  total_rules_evaluated INTEGER DEFAULT 0,
  total_findings INTEGER DEFAULT 0,
  blocker_count INTEGER DEFAULT 0,
  high_count INTEGER DEFAULT 0,
  medium_count INTEGER DEFAULT 0,
  low_count INTEGER DEFAULT 0,
  advisory_count INTEGER DEFAULT 0,
  draft_readiness TEXT DEFAULT 'unknown',
  duration_ms INTEGER DEFAULT 0,
  error_text TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_qc_runs_case_id ON cacc.qc_runs(case_id);
CREATE INDEX idx_qc_runs_generation_run_id ON cacc.qc_runs(generation_run_id);
CREATE INDEX idx_qc_runs_status ON cacc.qc_runs(status);

CREATE TABLE cacc.qc_findings (
  id TEXT PRIMARY KEY,
  qc_run_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT 'general',
  section_ids_json TEXT DEFAULT '[]',
  canonical_field_ids_json TEXT DEFAULT '[]',
  message TEXT NOT NULL,
  detail_message TEXT,
  suggested_action TEXT,
  evidence_json TEXT DEFAULT '{}',
  source_refs_json TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  dismissed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (qc_run_id) REFERENCES cacc.qc_runs(id)
);
CREATE INDEX idx_qc_findings_qc_run_id ON cacc.qc_findings(qc_run_id);
CREATE INDEX idx_qc_findings_rule_id ON cacc.qc_findings(rule_id);
CREATE INDEX idx_qc_findings_severity ON cacc.qc_findings(severity);
CREATE INDEX idx_qc_findings_status ON cacc.qc_findings(status);
CREATE INDEX idx_qc_findings_category ON cacc.qc_findings(category);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 9: INSERTION & DESTINATION AUTOMATION
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.insertion_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  generation_run_id TEXT,
  form_type TEXT NOT NULL,
  target_software TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total_fields INTEGER DEFAULT 0,
  completed_fields INTEGER DEFAULT 0,
  failed_fields INTEGER DEFAULT 0,
  skipped_fields INTEGER DEFAULT 0,
  verified_fields INTEGER DEFAULT 0,
  qc_run_id TEXT,
  qc_blocker_count INTEGER DEFAULT 0,
  qc_gate_passed INTEGER DEFAULT 1,
  config_json TEXT DEFAULT '{}',
  summary_json TEXT DEFAULT '{}',
  replay_package_json TEXT DEFAULT '{}',
  rollback_fields INTEGER DEFAULT 0,
  original_run_id TEXT,
  run_type TEXT DEFAULT 'standard',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_insertion_runs_case_id ON cacc.insertion_runs(case_id);
CREATE INDEX idx_insertion_runs_status ON cacc.insertion_runs(status);
CREATE INDEX idx_insertion_runs_gen_run ON cacc.insertion_runs(generation_run_id);

CREATE TABLE cacc.insertion_run_items (
  id TEXT PRIMARY KEY,
  insertion_run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  target_software TEXT NOT NULL,
  destination_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  canonical_text TEXT,
  canonical_text_length INTEGER DEFAULT 0,
  formatted_text TEXT,
  formatted_text_length INTEGER DEFAULT 0,
  verification_status TEXT DEFAULT 'pending',
  verification_raw TEXT,
  verification_normalized TEXT,
  verification_expected TEXT,
  preinsert_raw TEXT,
  preinsert_normalized TEXT,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  retry_class TEXT,
  fallback_strategy TEXT,
  fallback_used INTEGER DEFAULT 0,
  attempt_log_json TEXT DEFAULT '[]',
  rollback_attempted INTEGER DEFAULT 0,
  rollback_status TEXT,
  rollback_text TEXT,
  rollback_error_text TEXT,
  agent_response_json TEXT DEFAULT '{}',
  error_code TEXT,
  error_text TEXT,
  error_detail_json TEXT,
  diff_json TEXT,
  similarity_score DOUBLE PRECISION,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (insertion_run_id) REFERENCES cacc.insertion_runs(id)
);
CREATE INDEX idx_insertion_items_run_id ON cacc.insertion_run_items(insertion_run_id);
CREATE INDEX idx_insertion_items_case_field ON cacc.insertion_run_items(case_id, field_id);
CREATE INDEX idx_insertion_items_status ON cacc.insertion_run_items(status);
CREATE INDEX idx_insertion_items_verification ON cacc.insertion_run_items(verification_status);

CREATE TABLE cacc.destination_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_software TEXT NOT NULL,
  form_type TEXT NOT NULL,
  base_url TEXT,
  supports_readback INTEGER DEFAULT 1,
  supports_rich_text INTEGER DEFAULT 0,
  supports_partial_retry INTEGER DEFAULT 1,
  supports_append_mode INTEGER DEFAULT 0,
  requires_focus_target INTEGER DEFAULT 0,
  config_json TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_dest_profiles_software ON cacc.destination_profiles(target_software, form_type);
CREATE INDEX idx_dest_profiles_active ON cacc.destination_profiles(active);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 10: BUSINESS OPERATIONS LAYER
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  case_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  actor TEXT NOT NULL DEFAULT 'user',
  summary TEXT NOT NULL,
  detail_json TEXT DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_events_case_id ON cacc.audit_events(case_id);
CREATE INDEX idx_audit_events_event_type ON cacc.audit_events(event_type);
CREATE INDEX idx_audit_events_category ON cacc.audit_events(category);
CREATE INDEX idx_audit_events_entity ON cacc.audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_events_created_at ON cacc.audit_events(created_at);
CREATE INDEX idx_audit_events_severity ON cacc.audit_events(severity);

CREATE TABLE cacc.case_timeline_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  icon TEXT,
  detail_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_case_timeline_case_id ON cacc.case_timeline_events(case_id);
CREATE INDEX idx_case_timeline_created_at ON cacc.case_timeline_events(case_id, created_at);
CREATE INDEX idx_case_timeline_category ON cacc.case_timeline_events(category);

CREATE TABLE cacc.operational_metrics (
  id TEXT PRIMARY KEY,
  metric_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_op_metrics_type ON cacc.operational_metrics(metric_type);
CREATE INDEX idx_op_metrics_period ON cacc.operational_metrics(period_start, period_end);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 11: LEARNING / MEMORY SYSTEM
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.assignment_archives (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  subject_snapshot_json TEXT NOT NULL DEFAULT '{}',
  comp_set_json TEXT NOT NULL DEFAULT '{}',
  adjustments_json TEXT NOT NULL DEFAULT '{}',
  narratives_json TEXT NOT NULL DEFAULT '{}',
  reconciliation_json TEXT NOT NULL DEFAULT '{}',
  qc_snapshot_json TEXT NOT NULL DEFAULT '{}',
  edit_diff_json TEXT NOT NULL DEFAULT '{}',
  suggestion_decisions_json TEXT NOT NULL DEFAULT '{}',
  property_type TEXT,
  market_area TEXT,
  price_range_low DOUBLE PRECISION,
  price_range_high DOUBLE PRECISION,
  archived_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_assignment_archives_case_id ON cacc.assignment_archives(case_id);
CREATE INDEX idx_assignment_archives_form_type ON cacc.assignment_archives(form_type);
CREATE INDEX idx_assignment_archives_property_type ON cacc.assignment_archives(property_type);
CREATE INDEX idx_assignment_archives_market_area ON cacc.assignment_archives(market_area);
CREATE INDEX idx_assignment_archives_price_range ON cacc.assignment_archives(price_range_low, price_range_high);
CREATE INDEX idx_assignment_archives_status ON cacc.assignment_archives(status);
CREATE INDEX idx_assignment_archives_archived_at ON cacc.assignment_archives(archived_at);

CREATE TABLE cacc.learned_patterns (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_data_json TEXT NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (archive_id) REFERENCES cacc.assignment_archives(id)
);
CREATE INDEX idx_learned_patterns_archive_id ON cacc.learned_patterns(archive_id);
CREATE INDEX idx_learned_patterns_case_id ON cacc.learned_patterns(case_id);
CREATE INDEX idx_learned_patterns_type ON cacc.learned_patterns(pattern_type);
CREATE INDEX idx_learned_patterns_key ON cacc.learned_patterns(pattern_key);
CREATE INDEX idx_learned_patterns_type_key ON cacc.learned_patterns(pattern_type, pattern_key);
CREATE INDEX idx_learned_patterns_confidence ON cacc.learned_patterns(confidence DESC);

CREATE TABLE cacc.pattern_applications (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  applied_context TEXT NOT NULL,
  outcome TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (pattern_id) REFERENCES cacc.learned_patterns(id)
);
CREATE INDEX idx_pattern_applications_pattern_id ON cacc.pattern_applications(pattern_id);
CREATE INDEX idx_pattern_applications_case_id ON cacc.pattern_applications(case_id);
CREATE INDEX idx_pattern_applications_outcome ON cacc.pattern_applications(outcome);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 12: BUSINESS OPERATIONS - QUOTES, ENGAGEMENTS, INVOICES, PIPELINE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.fee_quotes (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  property_address TEXT NOT NULL,
  property_type TEXT,
  form_type TEXT,
  complexity TEXT,
  rush_requested INTEGER DEFAULT 0,
  base_fee DOUBLE PRECISION NOT NULL,
  complexity_adjustment DOUBLE PRECISION DEFAULT 0,
  rush_fee DOUBLE PRECISION DEFAULT 0,
  total_fee DOUBLE PRECISION NOT NULL,
  estimated_turnaround_days INTEGER,
  quote_status TEXT DEFAULT 'draft',
  valid_until TIMESTAMPTZ,
  notes TEXT,
  fee_schedule_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  converted_case_id TEXT
);
CREATE INDEX idx_fee_quotes_case_id ON cacc.fee_quotes(case_id);
CREATE INDEX idx_fee_quotes_client_name ON cacc.fee_quotes(client_name);
CREATE INDEX idx_fee_quotes_quote_status ON cacc.fee_quotes(quote_status);
CREATE INDEX idx_fee_quotes_created_at ON cacc.fee_quotes(created_at);

CREATE TABLE cacc.engagement_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  quote_id TEXT,
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  engagement_type TEXT NOT NULL,
  engagement_status TEXT DEFAULT 'pending',
  order_number TEXT,
  order_date TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  accepted_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  cancelled_date TIMESTAMPTZ,
  fee_agreed DOUBLE PRECISION NOT NULL,
  fee_adjustments_json TEXT,
  scope_of_work TEXT,
  special_instructions TEXT,
  contact_info_json TEXT,
  status_history_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_engagement_records_case_id ON cacc.engagement_records(case_id);
CREATE INDEX idx_engagement_records_quote_id ON cacc.engagement_records(quote_id);
CREATE INDEX idx_engagement_records_engagement_status ON cacc.engagement_records(engagement_status);
CREATE INDEX idx_engagement_records_order_number ON cacc.engagement_records(order_number);
CREATE INDEX idx_engagement_records_due_date ON cacc.engagement_records(due_date);
CREATE INDEX idx_engagement_records_client_name ON cacc.engagement_records(client_name);

CREATE TABLE cacc.invoices (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  engagement_id TEXT,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_status TEXT DEFAULT 'draft',
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  billing_address TEXT,
  line_items_json TEXT NOT NULL,
  subtotal DOUBLE PRECISION NOT NULL,
  adjustments_json TEXT,
  tax_amount DOUBLE PRECISION DEFAULT 0,
  total_amount DOUBLE PRECISION NOT NULL,
  amount_paid DOUBLE PRECISION DEFAULT 0,
  balance_due DOUBLE PRECISION NOT NULL,
  payment_terms TEXT DEFAULT 'net_30',
  issued_date TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  paid_date TIMESTAMPTZ,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  reminder_count INTEGER DEFAULT 0,
  last_reminder_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_invoices_case_id ON cacc.invoices(case_id);
CREATE INDEX idx_invoices_engagement_id ON cacc.invoices(engagement_id);
CREATE INDEX idx_invoices_invoice_status ON cacc.invoices(invoice_status);
CREATE INDEX idx_invoices_due_date ON cacc.invoices(due_date);
CREATE INDEX idx_invoices_client_name ON cacc.invoices(client_name);

CREATE TABLE cacc.pipeline_entries (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  quote_id TEXT,
  engagement_id TEXT,
  stage TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  property_address TEXT NOT NULL,
  client_name TEXT NOT NULL,
  form_type TEXT,
  assigned_appraiser TEXT,
  due_date TIMESTAMPTZ,
  fee DOUBLE PRECISION,
  notes TEXT,
  tags_json TEXT,
  stage_entered_at TIMESTAMPTZ NOT NULL,
  stage_history_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_pipeline_entries_case_id ON cacc.pipeline_entries(case_id);
CREATE INDEX idx_pipeline_entries_quote_id ON cacc.pipeline_entries(quote_id);
CREATE INDEX idx_pipeline_entries_engagement_id ON cacc.pipeline_entries(engagement_id);
CREATE INDEX idx_pipeline_entries_stage ON cacc.pipeline_entries(stage);
CREATE INDEX idx_pipeline_entries_priority ON cacc.pipeline_entries(priority);
CREATE INDEX idx_pipeline_entries_due_date ON cacc.pipeline_entries(due_date);
CREATE INDEX idx_pipeline_entries_assigned_appraiser ON cacc.pipeline_entries(assigned_appraiser);
CREATE INDEX idx_pipeline_entries_client_name ON cacc.pipeline_entries(client_name);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 13: MOBILE / INSPECTION WORKFLOW
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.inspections (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  inspection_type TEXT NOT NULL,
  inspection_status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_date TEXT,
  scheduled_time TEXT,
  actual_date TIMESTAMPTZ,
  inspector_name TEXT,
  access_instructions TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  weather_conditions TEXT,
  notes TEXT,
  duration_minutes INTEGER,
  photos_count INTEGER DEFAULT 0,
  measurements_complete INTEGER DEFAULT 0,
  checklist_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_inspections_case_id ON cacc.inspections(case_id);
CREATE INDEX idx_inspections_status ON cacc.inspections(inspection_status);
CREATE INDEX idx_inspections_scheduled_date ON cacc.inspections(scheduled_date);

CREATE TABLE cacc.inspection_photos (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  photo_category TEXT NOT NULL,
  label TEXT,
  file_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  capture_date TIMESTAMPTZ,
  gps_lat DOUBLE PRECISION,
  gps_lon DOUBLE PRECISION,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  is_primary INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inspection_photos_inspection_id ON cacc.inspection_photos(inspection_id);
CREATE INDEX idx_inspection_photos_case_id ON cacc.inspection_photos(case_id);
CREATE INDEX idx_inspection_photos_category ON cacc.inspection_photos(photo_category);

CREATE TABLE cacc.inspection_measurements (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  area_name TEXT NOT NULL,
  area_type TEXT NOT NULL,
  level TEXT,
  length_ft DOUBLE PRECISION,
  width_ft DOUBLE PRECISION,
  area_sqft DOUBLE PRECISION,
  ceiling_height_ft DOUBLE PRECISION,
  shape TEXT DEFAULT 'rectangular',
  dimensions_json TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inspection_measurements_inspection_id ON cacc.inspection_measurements(inspection_id);
CREATE INDEX idx_inspection_measurements_case_id ON cacc.inspection_measurements(case_id);
CREATE INDEX idx_inspection_measurements_area_type ON cacc.inspection_measurements(area_type);
CREATE INDEX idx_inspection_measurements_level ON cacc.inspection_measurements(level);

CREATE TABLE cacc.inspection_conditions (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  component TEXT NOT NULL,
  condition_rating TEXT NOT NULL,
  material TEXT,
  age_years INTEGER,
  remaining_life_years INTEGER,
  deficiency TEXT,
  repair_needed INTEGER DEFAULT 0,
  estimated_repair_cost DOUBLE PRECISION,
  photo_ids_json TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inspection_conditions_inspection_id ON cacc.inspection_conditions(inspection_id);
CREATE INDEX idx_inspection_conditions_case_id ON cacc.inspection_conditions(case_id);
CREATE INDEX idx_inspection_conditions_component ON cacc.inspection_conditions(component);
CREATE INDEX idx_inspection_conditions_rating ON cacc.inspection_conditions(condition_rating);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 14: EXPORT LAYER
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.export_jobs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  export_status TEXT DEFAULT 'queued',
  output_format TEXT,
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  page_count INTEGER,
  include_photos INTEGER DEFAULT 1,
  include_addenda INTEGER DEFAULT 1,
  include_maps INTEGER DEFAULT 1,
  include_sketches INTEGER DEFAULT 1,
  watermark TEXT DEFAULT 'none',
  recipient_name TEXT,
  recipient_email TEXT,
  delivery_method TEXT,
  delivery_status TEXT DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  options_json TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_export_jobs_case_id ON cacc.export_jobs(case_id);
CREATE INDEX idx_export_jobs_export_type ON cacc.export_jobs(export_type);
CREATE INDEX idx_export_jobs_export_status ON cacc.export_jobs(export_status);
CREATE INDEX idx_export_jobs_created_at ON cacc.export_jobs(created_at);

CREATE TABLE cacc.delivery_records (
  id TEXT PRIMARY KEY,
  export_job_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  delivery_method TEXT NOT NULL,
  recipient_name TEXT,
  recipient_email TEXT,
  portal_name TEXT,
  tracking_number TEXT,
  delivery_status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmation_method TEXT,
  notes TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_delivery_records_export_job_id ON cacc.delivery_records(export_job_id);
CREATE INDEX idx_delivery_records_case_id ON cacc.delivery_records(case_id);
CREATE INDEX idx_delivery_records_delivery_status ON cacc.delivery_records(delivery_status);
CREATE INDEX idx_delivery_records_delivery_method ON cacc.delivery_records(delivery_method);

CREATE TABLE cacc.export_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  export_type TEXT NOT NULL,
  form_type TEXT,
  description TEXT,
  config_json TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_export_templates_export_type ON cacc.export_templates(export_type);
CREATE INDEX idx_export_templates_form_type ON cacc.export_templates(form_type);
CREATE INDEX idx_export_templates_active ON cacc.export_templates(active);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 15: SECURITY & GOVERNANCE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'appraiser',
  status TEXT DEFAULT 'active',
  permissions_json TEXT,
  preferences_json TEXT,
  last_login_at TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_users_username ON cacc.users(username);
CREATE INDEX idx_users_role ON cacc.users(role);
CREATE INDEX idx_users_status ON cacc.users(status);
CREATE INDEX idx_users_email ON cacc.users(email);

CREATE TABLE cacc.access_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  conditions_json TEXT,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_access_policies_role ON cacc.access_policies(role);
CREATE INDEX idx_access_policies_resource_type ON cacc.access_policies(resource_type);
CREATE INDEX idx_access_policies_active ON cacc.access_policies(active);

CREATE TABLE cacc.access_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  case_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success INTEGER DEFAULT 1,
  denial_reason TEXT,
  detail_json TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_access_log_user_id ON cacc.access_log(user_id);
CREATE INDEX idx_access_log_action ON cacc.access_log(action);
CREATE INDEX idx_access_log_resource_type ON cacc.access_log(resource_type);
CREATE INDEX idx_access_log_case_id ON cacc.access_log(case_id);
CREATE INDEX idx_access_log_created_at ON cacc.access_log(created_at);
CREATE INDEX idx_access_log_success ON cacc.access_log(success);

CREATE TABLE cacc.data_retention_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  action TEXT NOT NULL,
  conditions_json TEXT,
  active INTEGER DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  items_processed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_data_retention_rules_resource_type ON cacc.data_retention_rules(resource_type);
CREATE INDEX idx_data_retention_rules_active ON cacc.data_retention_rules(active);
CREATE INDEX idx_data_retention_rules_next_run_at ON cacc.data_retention_rules(next_run_at);

CREATE TABLE cacc.compliance_records (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  compliance_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  checked_at TIMESTAMPTZ,
  checked_by TEXT,
  findings_json TEXT,
  remediation_json TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_compliance_records_case_id ON cacc.compliance_records(case_id);
CREATE INDEX idx_compliance_records_compliance_type ON cacc.compliance_records(compliance_type);
CREATE INDEX idx_compliance_records_status ON cacc.compliance_records(status);
CREATE INDEX idx_compliance_records_checked_at ON cacc.compliance_records(checked_at);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 16: CONTRADICTION RESOLUTION PERSISTENCE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.contradiction_resolutions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  contradiction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  actor TEXT NOT NULL DEFAULT 'appraiser',
  note TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  history_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, contradiction_id)
);
CREATE INDEX idx_contradiction_resolutions_case_status ON cacc.contradiction_resolutions(case_id, status);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 17: VALUATION WORKSPACE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.income_approach_data (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  rent_comps_json TEXT NOT NULL DEFAULT '[]',
  monthly_market_rent DOUBLE PRECISION,
  grm DOUBLE PRECISION,
  expenses_json TEXT NOT NULL DEFAULT '{}',
  gross_income DOUBLE PRECISION,
  net_income DOUBLE PRECISION,
  indicated_value DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cacc.cost_approach_data (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  land_value DOUBLE PRECISION,
  land_value_source TEXT,
  replacement_cost_new DOUBLE PRECISION,
  cost_method TEXT DEFAULT 'cost_manual',
  cost_per_sqft DOUBLE PRECISION,
  gla_sqft DOUBLE PRECISION,
  extras_json TEXT NOT NULL DEFAULT '[]',
  physical_depreciation DOUBLE PRECISION DEFAULT 0,
  functional_depreciation DOUBLE PRECISION DEFAULT 0,
  external_depreciation DOUBLE PRECISION DEFAULT 0,
  total_depreciation DOUBLE PRECISION DEFAULT 0,
  depreciated_value DOUBLE PRECISION,
  site_improvements DOUBLE PRECISION DEFAULT 0,
  indicated_value DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cacc.reconciliation_data (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  sales_comparison_value DOUBLE PRECISION,
  sales_comparison_weight DOUBLE PRECISION DEFAULT 0,
  income_value DOUBLE PRECISION,
  income_weight DOUBLE PRECISION DEFAULT 0,
  cost_value DOUBLE PRECISION,
  cost_weight DOUBLE PRECISION DEFAULT 0,
  final_opinion_value DOUBLE PRECISION,
  reconciliation_narrative TEXT,
  approach_applicability_json TEXT NOT NULL DEFAULT '{}',
  supporting_data_json TEXT NOT NULL DEFAULT '{}',
  as_is_value DOUBLE PRECISION,
  as_completed_value DOUBLE PRECISION,
  effective_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 18: CONTROLLED LEARNING LOOP
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.revision_diffs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  draft_text TEXT,
  final_text TEXT,
  diff_json TEXT NOT NULL DEFAULT '{}',
  change_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  form_type TEXT,
  property_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_revision_diffs_case ON cacc.revision_diffs(case_id);
CREATE INDEX idx_revision_diffs_section ON cacc.revision_diffs(case_id, section_id);

CREATE TABLE cacc.suggestion_outcomes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  suggestion_id TEXT,
  section_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL DEFAULT 'narrative',
  original_text TEXT,
  suggested_text TEXT,
  final_text TEXT,
  accepted INTEGER NOT NULL DEFAULT 0,
  modified INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  form_type TEXT,
  property_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_suggestion_outcomes_case ON cacc.suggestion_outcomes(case_id);
CREATE INDEX idx_suggestion_outcomes_section ON cacc.suggestion_outcomes(section_id, form_type);
CREATE INDEX idx_suggestion_outcomes_type ON cacc.suggestion_outcomes(suggestion_type, accepted);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 19: SECURITY COMPLETION & PRODUCTIZATION
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.encryption_keys (
  id TEXT PRIMARY KEY,
  key_alias TEXT NOT NULL UNIQUE,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_encryption_keys_alias ON cacc.encryption_keys(key_alias);
CREATE INDEX idx_encryption_keys_status ON cacc.encryption_keys(status);

CREATE TABLE cacc.backup_records (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL DEFAULT 'full',
  file_path TEXT,
  file_size_bytes INTEGER,
  file_hash TEXT,
  table_counts_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  error_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX idx_backup_records_status ON cacc.backup_records(status);
CREATE INDEX idx_backup_records_created_at ON cacc.backup_records(created_at);

CREATE TABLE cacc.backup_schedule (
  id TEXT PRIMARY KEY DEFAULT 'default',
  interval_hours INTEGER NOT NULL DEFAULT 24,
  retention_days INTEGER NOT NULL DEFAULT 30,
  max_backups INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cacc.tenant_configs (
  id TEXT PRIMARY KEY,
  tenant_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  settings_json TEXT NOT NULL DEFAULT '{}',
  feature_flags_json TEXT NOT NULL DEFAULT '{}',
  billing_plan TEXT DEFAULT 'standard',
  billing_status TEXT DEFAULT 'active',
  max_users INTEGER DEFAULT 10,
  max_cases INTEGER DEFAULT 1000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tenant_configs_name ON cacc.tenant_configs(tenant_name);
CREATE INDEX idx_tenant_configs_status ON cacc.tenant_configs(status);

CREATE TABLE cacc.feature_flags (
  id TEXT PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  tenant_scope TEXT DEFAULT 'global',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_feature_flags_key ON cacc.feature_flags(flag_key);
CREATE INDEX idx_feature_flags_enabled ON cacc.feature_flags(enabled);

CREATE TABLE cacc.billing_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  event_type TEXT NOT NULL,
  amount DOUBLE PRECISION,
  currency TEXT DEFAULT 'USD',
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_billing_events_tenant_id ON cacc.billing_events(tenant_id);
CREATE INDEX idx_billing_events_event_type ON cacc.billing_events(event_type);
CREATE INDEX idx_billing_events_created_at ON cacc.billing_events(created_at);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 20: AUTOTUNE, VOICE EMBEDDINGS, STM NORMALIZATION
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.autotune_ema_state (
  id SERIAL PRIMARY KEY,
  context_key TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL,
  section_id TEXT NOT NULL,
  avg_score DOUBLE PRECISION DEFAULT 0.5,
  avg_tokens_used DOUBLE PRECISION DEFAULT 500,
  optimal_temperature DOUBLE PRECISION DEFAULT 0.7,
  optimal_max_tokens DOUBLE PRECISION DEFAULT 1000,
  optimal_top_p DOUBLE PRECISION DEFAULT 0.9,
  sample_count INTEGER DEFAULT 0,
  alpha DOUBLE PRECISION DEFAULT 0.3,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_autotune_ema_context_key ON cacc.autotune_ema_state(context_key);
CREATE INDEX idx_autotune_ema_form_type ON cacc.autotune_ema_state(form_type);
CREATE INDEX idx_autotune_ema_section_id ON cacc.autotune_ema_state(section_id);
CREATE INDEX idx_autotune_ema_created_at ON cacc.autotune_ema_state(created_at);

CREATE TABLE cacc.autotune_outcomes (
  id SERIAL PRIMARY KEY,
  context_key TEXT NOT NULL,
  section_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  quality_score DOUBLE PRECISION,
  tokens_used INTEGER,
  was_approved INTEGER DEFAULT 0,
  temperature_used DOUBLE PRECISION,
  max_tokens_used INTEGER,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_autotune_outcomes_context_key ON cacc.autotune_outcomes(context_key);
CREATE INDEX idx_autotune_outcomes_section_id ON cacc.autotune_outcomes(section_id);
CREATE INDEX idx_autotune_outcomes_form_type ON cacc.autotune_outcomes(form_type);
CREATE INDEX idx_autotune_outcomes_user_id ON cacc.autotune_outcomes(user_id);
CREATE INDEX idx_autotune_outcomes_created_at ON cacc.autotune_outcomes(created_at);

CREATE TABLE cacc.voice_reference_embeddings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  section_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  source TEXT DEFAULT 'approved_narrative',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, form_type, section_id, text_hash)
);
CREATE INDEX idx_voice_embeddings_user_id ON cacc.voice_reference_embeddings(user_id);
CREATE INDEX idx_voice_embeddings_form_type ON cacc.voice_reference_embeddings(form_type);
CREATE INDEX idx_voice_embeddings_section_id ON cacc.voice_reference_embeddings(section_id);
CREATE INDEX idx_voice_embeddings_created_at ON cacc.voice_reference_embeddings(created_at);

CREATE TABLE cacc.stm_normalization_log (
  id SERIAL PRIMARY KEY,
  section_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  original_length INTEGER,
  cleaned_length INTEGER,
  regex_changes INTEGER DEFAULT 0,
  llm_pass_used INTEGER DEFAULT 0,
  preamble_stripped INTEGER DEFAULT 0,
  postamble_stripped INTEGER DEFAULT 0,
  truncated INTEGER DEFAULT 0,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stm_normalization_section_id ON cacc.stm_normalization_log(section_id);
CREATE INDEX idx_stm_normalization_form_type ON cacc.stm_normalization_log(form_type);
CREATE INDEX idx_stm_normalization_user_id ON cacc.stm_normalization_log(user_id);
CREATE INDEX idx_stm_normalization_created_at ON cacc.stm_normalization_log(created_at);

-- ════════════════════════════════════════════════════════════════════════════════
-- PIPELINE: CLOUDFLARE BROWSER RENDERING DATA PIPELINE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.pipeline_cache (
  case_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  crawl_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cacc.pipeline_crawl_jobs (
  id SERIAL PRIMARY KEY,
  case_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'custom',
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  records_json TEXT,
  browser_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_pipeline_crawl_jobs_case ON cacc.pipeline_crawl_jobs(case_id);

CREATE TABLE cacc.pipeline_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  schema_key TEXT,
  prompt TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════════
-- PHASE 1.5: PROPRIETARY AI ENGINE & KNOWLEDGE BRAIN
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE cacc.model_registry (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  base_model TEXT NOT NULL DEFAULT 'meta-llama/Llama-3.1-8B',
  status TEXT NOT NULL DEFAULT 'training' CHECK (status IN ('training', 'evaluating', 'staged', 'active', 'retired', 'failed')),
  training_data_hash TEXT,
  training_samples INTEGER DEFAULT 0,
  hyperparams_json TEXT NOT NULL DEFAULT '{}',
  eval_scores_json TEXT NOT NULL DEFAULT '{}',
  deployed_endpoint TEXT,
  deployed_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_name, version)
);
CREATE INDEX idx_model_registry_status ON cacc.model_registry(status);
CREATE INDEX idx_model_registry_name_version ON cacc.model_registry(model_name, version);

CREATE TABLE cacc.graph_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  node_type TEXT NOT NULL CHECK (node_type IN ('case', 'property', 'comp', 'market_area', 'pattern', 'concept', 'appraiser', 'adjustment', 'section')),
  label TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  embedding_json TEXT,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_graph_nodes_user ON cacc.graph_nodes(user_id);
CREATE INDEX idx_graph_nodes_type ON cacc.graph_nodes(node_type);
CREATE INDEX idx_graph_nodes_user_type ON cacc.graph_nodes(user_id, node_type);

CREATE TABLE cacc.graph_edges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_id TEXT NOT NULL REFERENCES cacc.graph_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES cacc.graph_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('related_to', 'comparable_to', 'located_in', 'derived_from', 'adjusted_by', 'generated_for', 'similar_pattern', 'market_trend', 'appraised_by')),
  weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_graph_edges_source ON cacc.graph_edges(source_id);
CREATE INDEX idx_graph_edges_target ON cacc.graph_edges(target_id);
CREATE INDEX idx_graph_edges_user ON cacc.graph_edges(user_id);
CREATE INDEX idx_graph_edges_type ON cacc.graph_edges(edge_type);

CREATE TABLE cacc.brain_chat_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model_id TEXT,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_brain_chat_user_case ON cacc.brain_chat_history(user_id, case_id);
CREATE INDEX idx_brain_chat_created ON cacc.brain_chat_history(created_at);

CREATE TABLE cacc.ai_cost_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT,
  model_id TEXT,
  provider TEXT NOT NULL DEFAULT 'runpod' CHECK (provider IN ('runpod', 'openai', 'gemini', 'anthropic', 'ollama')),
  operation TEXT NOT NULL DEFAULT 'generate' CHECK (operation IN ('generate', 'chat', 'embed', 'extract', 'eval')),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  gpu_seconds DOUBLE PRECISION DEFAULT 0,
  estimated_cost DOUBLE PRECISION DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ai_cost_user ON cacc.ai_cost_log(user_id);
CREATE INDEX idx_ai_cost_user_date ON cacc.ai_cost_log(user_id, created_at);
CREATE INDEX idx_ai_cost_provider ON cacc.ai_cost_log(provider);

-- ════════════════════════════════════════════════════════════════════════════════
-- MIGRATION TRACKING TABLE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cacc._migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

