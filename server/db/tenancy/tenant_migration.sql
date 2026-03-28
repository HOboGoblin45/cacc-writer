/**
 * server/db/tenancy/tenant_migration.sql
 * ======================================
 * SQL to add user_id columns to existing tables for PostgreSQL multi-tenancy.
 *
 * For SQLite: Do NOT run these migrations. Per-user databases already provide isolation.
 * For PostgreSQL: Run these migrations before enabling RLS policies.
 *
 * Strategy:
 * 1. Add user_id column as nullable
 * 2. Backfill existing rows with appropriate user_id values
 * 3. Set NOT NULL constraint and add indexes
 * 4. Add foreign key constraint to users table
 *
 * Tables with user_id (tenant-scoped):
 * - case_records, case_facts, case_outputs, case_history
 * - assignments, report_plans
 * - generation_runs, section_jobs, generated_sections
 * - memory_items, retrieval_cache, approved_memory
 * - analysis_artifacts, assignment_intelligence
 * - case_documents, document_ingest_jobs, document_extractions, extracted_facts, extracted_sections
 * - comp_candidates, comp_scores, comp_tier_assignments, comp_acceptance_events, comp_rejection_events
 * - adjustment_support_records, adjustment_recommendations, paired_sales_library_records, comp_burden_metrics
 * - qc_runs, qc_findings
 * - insertion_runs, insertion_run_items, destination_profiles
 * - export_jobs, delivery_records, export_templates
 * - learned_patterns, pattern_applications
 * - fee_quotes, engagement_records, invoices, pipeline_entries
 * - inspections, inspection_photos, inspection_measurements, inspection_conditions
 * - audit_events, case_timeline_events, operational_metrics, assignment_archives
 * - ingest_jobs, voice_profiles, voice_rules, comp_commentary_memory
 *
 * Tables WITHOUT user_id (system-wide, not tenant-scoped):
 * - users (system users)
 * - access_policies, access_log (system-level)
 * - data_retention_rules, compliance_records (system-level)
 * - model_registry (system-level)
 * - brain_chat_history (if shared across users)
 */

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 1: Add user_id column (nullable) to all tenant-scoped tables
-- ══════════════════════════════════════════════════════════════════════════════

-- Core case data
ALTER TABLE case_records ADD COLUMN user_id TEXT;
ALTER TABLE case_facts ADD COLUMN user_id TEXT;
ALTER TABLE case_outputs ADD COLUMN user_id TEXT;
ALTER TABLE case_history ADD COLUMN user_id TEXT;
ALTER TABLE assignments ADD COLUMN user_id TEXT;
ALTER TABLE report_plans ADD COLUMN user_id TEXT;

-- Generation & sections
ALTER TABLE generation_runs ADD COLUMN user_id TEXT;
ALTER TABLE section_jobs ADD COLUMN user_id TEXT;
ALTER TABLE generated_sections ADD COLUMN user_id TEXT;

-- Memory & knowledge
ALTER TABLE memory_items ADD COLUMN user_id TEXT;
ALTER TABLE retrieval_cache ADD COLUMN user_id TEXT;
ALTER TABLE approved_memory ADD COLUMN user_id TEXT;

-- Intelligence
ALTER TABLE analysis_artifacts ADD COLUMN user_id TEXT;
ALTER TABLE assignment_intelligence ADD COLUMN user_id TEXT;

-- Documents
ALTER TABLE case_documents ADD COLUMN user_id TEXT;
ALTER TABLE document_ingest_jobs ADD COLUMN user_id TEXT;
ALTER TABLE document_extractions ADD COLUMN user_id TEXT;
ALTER TABLE extracted_facts ADD COLUMN user_id TEXT;
ALTER TABLE extracted_sections ADD COLUMN user_id TEXT;

-- Comparables
ALTER TABLE comp_candidates ADD COLUMN user_id TEXT;
ALTER TABLE comp_scores ADD COLUMN user_id TEXT;
ALTER TABLE comp_tier_assignments ADD COLUMN user_id TEXT;
ALTER TABLE comp_acceptance_events ADD COLUMN user_id TEXT;
ALTER TABLE comp_rejection_events ADD COLUMN user_id TEXT;
ALTER TABLE adjustment_support_records ADD COLUMN user_id TEXT;
ALTER TABLE adjustment_recommendations ADD COLUMN user_id TEXT;
ALTER TABLE paired_sales_library_records ADD COLUMN user_id TEXT;
ALTER TABLE comp_burden_metrics ADD COLUMN user_id TEXT;

-- Quality Control
ALTER TABLE qc_runs ADD COLUMN user_id TEXT;
ALTER TABLE qc_findings ADD COLUMN user_id TEXT;

-- Insertion & export
ALTER TABLE insertion_runs ADD COLUMN user_id TEXT;
ALTER TABLE insertion_run_items ADD COLUMN user_id TEXT;
ALTER TABLE destination_profiles ADD COLUMN user_id TEXT;
ALTER TABLE export_jobs ADD COLUMN user_id TEXT;
ALTER TABLE delivery_records ADD COLUMN user_id TEXT;
ALTER TABLE export_templates ADD COLUMN user_id TEXT;

-- Learning & patterns
ALTER TABLE learned_patterns ADD COLUMN user_id TEXT;
ALTER TABLE pattern_applications ADD COLUMN user_id TEXT;

-- Billing & engagement
ALTER TABLE fee_quotes ADD COLUMN user_id TEXT;
ALTER TABLE engagement_records ADD COLUMN user_id TEXT;
ALTER TABLE invoices ADD COLUMN user_id TEXT;
ALTER TABLE pipeline_entries ADD COLUMN user_id TEXT;

-- Inspections
ALTER TABLE inspections ADD COLUMN user_id TEXT;
ALTER TABLE inspection_photos ADD COLUMN user_id TEXT;
ALTER TABLE inspection_measurements ADD COLUMN user_id TEXT;
ALTER TABLE inspection_conditions ADD COLUMN user_id TEXT;

-- Operations
ALTER TABLE audit_events ADD COLUMN user_id TEXT;
ALTER TABLE case_timeline_events ADD COLUMN user_id TEXT;
ALTER TABLE operational_metrics ADD COLUMN user_id TEXT;
ALTER TABLE assignment_archives ADD COLUMN user_id TEXT;

-- Ingest & voice
ALTER TABLE ingest_jobs ADD COLUMN user_id TEXT;
ALTER TABLE voice_profiles ADD COLUMN user_id TEXT;
ALTER TABLE voice_rules ADD COLUMN user_id TEXT;
ALTER TABLE comp_commentary_memory ADD COLUMN user_id TEXT;

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 2: Backfill user_id values
-- ══════════════════════════════════════════════════════════════════════════════
-- IMPORTANT: This step requires domain knowledge about how users are related to data.
--
-- For CACC Writer, the mapping should be:
-- - case_records.user_id = assignments.user_id (via assignment_id FK)
-- - All child records inherit user_id from their parent
--
-- Example for case_records (assumes assignment relationship):
-- UPDATE case_records
-- SET user_id = (SELECT user_id FROM assignments WHERE assignments.case_id = case_records.id LIMIT 1)
-- WHERE user_id IS NULL;
--
-- This step must be customized based on actual data model relationships.
-- See: server/db/repositories/caseRecordRepo.js for assignment-to-user relationships.

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 3: Add NOT NULL constraints
-- ══════════════════════════════════════════════════════════════════════════════
-- Only run after backfilling all values (Phase 2)

-- Core case data
ALTER TABLE case_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE case_facts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE case_outputs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE case_history ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE assignments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE report_plans ALTER COLUMN user_id SET NOT NULL;

-- Generation & sections
ALTER TABLE generation_runs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE section_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE generated_sections ALTER COLUMN user_id SET NOT NULL;

-- Memory & knowledge
ALTER TABLE memory_items ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE retrieval_cache ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE approved_memory ALTER COLUMN user_id SET NOT NULL;

-- Intelligence
ALTER TABLE analysis_artifacts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE assignment_intelligence ALTER COLUMN user_id SET NOT NULL;

-- Documents
ALTER TABLE case_documents ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE document_ingest_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE document_extractions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE extracted_facts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE extracted_sections ALTER COLUMN user_id SET NOT NULL;

-- Comparables
ALTER TABLE comp_candidates ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_scores ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_tier_assignments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_acceptance_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_rejection_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE adjustment_support_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE adjustment_recommendations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE paired_sales_library_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_burden_metrics ALTER COLUMN user_id SET NOT NULL;

-- Quality Control
ALTER TABLE qc_runs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE qc_findings ALTER COLUMN user_id SET NOT NULL;

-- Insertion & export
ALTER TABLE insertion_runs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE insertion_run_items ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE destination_profiles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE export_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE delivery_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE export_templates ALTER COLUMN user_id SET NOT NULL;

-- Learning & patterns
ALTER TABLE learned_patterns ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pattern_applications ALTER COLUMN user_id SET NOT NULL;

-- Billing & engagement
ALTER TABLE fee_quotes ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE engagement_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pipeline_entries ALTER COLUMN user_id SET NOT NULL;

-- Inspections
ALTER TABLE inspections ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE inspection_photos ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE inspection_measurements ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE inspection_conditions ALTER COLUMN user_id SET NOT NULL;

-- Operations
ALTER TABLE audit_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE case_timeline_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE operational_metrics ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE assignment_archives ALTER COLUMN user_id SET NOT NULL;

-- Ingest & voice
ALTER TABLE ingest_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE voice_profiles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE voice_rules ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE comp_commentary_memory ALTER COLUMN user_id SET NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 4: Create indexes on user_id for query performance
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_case_records_user_id ON case_records(user_id);
CREATE INDEX idx_case_facts_user_id ON case_facts(user_id);
CREATE INDEX idx_case_outputs_user_id ON case_outputs(user_id);
CREATE INDEX idx_case_history_user_id ON case_history(user_id);
CREATE INDEX idx_assignments_user_id ON assignments(user_id);
CREATE INDEX idx_report_plans_user_id ON report_plans(user_id);
CREATE INDEX idx_generation_runs_user_id ON generation_runs(user_id);
CREATE INDEX idx_section_jobs_user_id ON section_jobs(user_id);
CREATE INDEX idx_generated_sections_user_id ON generated_sections(user_id);
CREATE INDEX idx_memory_items_user_id ON memory_items(user_id);
CREATE INDEX idx_retrieval_cache_user_id ON retrieval_cache(user_id);
CREATE INDEX idx_approved_memory_user_id ON approved_memory(user_id);
CREATE INDEX idx_analysis_artifacts_user_id ON analysis_artifacts(user_id);
CREATE INDEX idx_assignment_intelligence_user_id ON assignment_intelligence(user_id);
CREATE INDEX idx_case_documents_user_id ON case_documents(user_id);
CREATE INDEX idx_document_ingest_jobs_user_id ON document_ingest_jobs(user_id);
CREATE INDEX idx_document_extractions_user_id ON document_extractions(user_id);
CREATE INDEX idx_extracted_facts_user_id ON extracted_facts(user_id);
CREATE INDEX idx_extracted_sections_user_id ON extracted_sections(user_id);
CREATE INDEX idx_comp_candidates_user_id ON comp_candidates(user_id);
CREATE INDEX idx_comp_scores_user_id ON comp_scores(user_id);
CREATE INDEX idx_comp_tier_assignments_user_id ON comp_tier_assignments(user_id);
CREATE INDEX idx_comp_acceptance_events_user_id ON comp_acceptance_events(user_id);
CREATE INDEX idx_comp_rejection_events_user_id ON comp_rejection_events(user_id);
CREATE INDEX idx_adjustment_support_records_user_id ON adjustment_support_records(user_id);
CREATE INDEX idx_adjustment_recommendations_user_id ON adjustment_recommendations(user_id);
CREATE INDEX idx_paired_sales_library_records_user_id ON paired_sales_library_records(user_id);
CREATE INDEX idx_comp_burden_metrics_user_id ON comp_burden_metrics(user_id);
CREATE INDEX idx_qc_runs_user_id ON qc_runs(user_id);
CREATE INDEX idx_qc_findings_user_id ON qc_findings(user_id);
CREATE INDEX idx_insertion_runs_user_id ON insertion_runs(user_id);
CREATE INDEX idx_insertion_run_items_user_id ON insertion_run_items(user_id);
CREATE INDEX idx_destination_profiles_user_id ON destination_profiles(user_id);
CREATE INDEX idx_export_jobs_user_id ON export_jobs(user_id);
CREATE INDEX idx_delivery_records_user_id ON delivery_records(user_id);
CREATE INDEX idx_export_templates_user_id ON export_templates(user_id);
CREATE INDEX idx_learned_patterns_user_id ON learned_patterns(user_id);
CREATE INDEX idx_pattern_applications_user_id ON pattern_applications(user_id);
CREATE INDEX idx_fee_quotes_user_id ON fee_quotes(user_id);
CREATE INDEX idx_engagement_records_user_id ON engagement_records(user_id);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_pipeline_entries_user_id ON pipeline_entries(user_id);
CREATE INDEX idx_inspections_user_id ON inspections(user_id);
CREATE INDEX idx_inspection_photos_user_id ON inspection_photos(user_id);
CREATE INDEX idx_inspection_measurements_user_id ON inspection_measurements(user_id);
CREATE INDEX idx_inspection_conditions_user_id ON inspection_conditions(user_id);
CREATE INDEX idx_audit_events_user_id ON audit_events(user_id);
CREATE INDEX idx_case_timeline_events_user_id ON case_timeline_events(user_id);
CREATE INDEX idx_operational_metrics_user_id ON operational_metrics(user_id);
CREATE INDEX idx_assignment_archives_user_id ON assignment_archives(user_id);
CREATE INDEX idx_ingest_jobs_user_id ON ingest_jobs(user_id);
CREATE INDEX idx_voice_profiles_user_id ON voice_profiles(user_id);
CREATE INDEX idx_voice_rules_user_id ON voice_rules(user_id);
CREATE INDEX idx_comp_commentary_memory_user_id ON comp_commentary_memory(user_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 5: Add foreign key constraints (optional, for referential integrity)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE case_records ADD CONSTRAINT fk_case_records_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE assignments ADD CONSTRAINT fk_assignments_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ... repeat for other major tables

-- ══════════════════════════════════════════════════════════════════════════════
-- Verification Queries
-- ══════════════════════════════════════════════════════════════════════════════

-- Check for NULL user_id values (should be empty after Phase 3)
-- SELECT COUNT(*) FROM case_records WHERE user_id IS NULL;

-- Check user_id distribution
-- SELECT user_id, COUNT(*) FROM case_records GROUP BY user_id ORDER BY COUNT(*) DESC;

-- Verify indexes exist
-- SELECT * FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%user_id%';
