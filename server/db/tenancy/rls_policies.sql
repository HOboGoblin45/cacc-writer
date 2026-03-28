/**
 * server/db/tenancy/rls_policies.sql
 * ----------------------------------
 * PostgreSQL Row-Level Security (RLS) policy definitions.
 *
 * These policies automatically enforce tenant isolation on all queries.
 * Apply after adding user_id column to all tenant-scoped tables.
 *
 * Session variable: app.current_tenant_id
 * Set by TenantAwareAdapter before each query.
 *
 * Usage (in PostgreSQL):
 *   psql -U postgres -d cacc_writer < rls_policies.sql
 *
 * Or programmatically:
 *   const schema = fs.readFileSync('./rls_policies.sql', 'utf-8');
 *   await db.exec(schema);
 */

-- ══════════════════════════════════════════════════════════════════════════════
-- Enable RLS on all tenant-scoped tables
-- ══════════════════════════════════════════════════════════════════════════════

-- Core case data
ALTER TABLE case_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_plans ENABLE ROW LEVEL SECURITY;

-- Generation & sections
ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_sections ENABLE ROW LEVEL SECURITY;

-- Memory & knowledge
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_memory ENABLE ROW LEVEL SECURITY;

-- Intelligence
ALTER TABLE analysis_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_intelligence ENABLE ROW LEVEL SECURITY;

-- Documents
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_sections ENABLE ROW LEVEL SECURITY;

-- Comparables
ALTER TABLE comp_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_tier_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_acceptance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_rejection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_support_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE paired_sales_library_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_burden_metrics ENABLE ROW LEVEL SECURITY;

-- Quality Control
ALTER TABLE qc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_findings ENABLE ROW LEVEL SECURITY;

-- Insertion & export
ALTER TABLE insertion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE insertion_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE destination_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_templates ENABLE ROW LEVEL SECURITY;

-- Learning & patterns
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_applications ENABLE ROW LEVEL SECURITY;

-- Billing & engagement
ALTER TABLE fee_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_entries ENABLE ROW LEVEL SECURITY;

-- Inspections
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_conditions ENABLE ROW LEVEL SECURITY;

-- Operations
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_archives ENABLE ROW LEVEL SECURITY;

-- Ingest & voice
ALTER TABLE ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_commentary_memory ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Policies: SELECT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE POLICY case_records_select ON case_records
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_facts_select ON case_facts
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_outputs_select ON case_outputs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_history_select ON case_history
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignments_select ON assignments
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY report_plans_select ON report_plans
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generation_runs_select ON generation_runs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY section_jobs_select ON section_jobs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generated_sections_select ON generated_sections
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY memory_items_select ON memory_items
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY retrieval_cache_select ON retrieval_cache
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY approved_memory_select ON approved_memory
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY analysis_artifacts_select ON analysis_artifacts
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_intelligence_select ON assignment_intelligence
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_documents_select ON case_documents
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_ingest_jobs_select ON document_ingest_jobs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_extractions_select ON document_extractions
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_facts_select ON extracted_facts
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_sections_select ON extracted_sections
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_candidates_select ON comp_candidates
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_scores_select ON comp_scores
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_tier_assignments_select ON comp_tier_assignments
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_acceptance_events_select ON comp_acceptance_events
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_rejection_events_select ON comp_rejection_events
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_support_records_select ON adjustment_support_records
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_recommendations_select ON adjustment_recommendations
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY paired_sales_library_records_select ON paired_sales_library_records
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_burden_metrics_select ON comp_burden_metrics
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_runs_select ON qc_runs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_findings_select ON qc_findings
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_runs_select ON insertion_runs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_run_items_select ON insertion_run_items
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY destination_profiles_select ON destination_profiles
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_jobs_select ON export_jobs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY delivery_records_select ON delivery_records
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_templates_select ON export_templates
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY learned_patterns_select ON learned_patterns
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pattern_applications_select ON pattern_applications
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY fee_quotes_select ON fee_quotes
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY engagement_records_select ON engagement_records
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY invoices_select ON invoices
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pipeline_entries_select ON pipeline_entries
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspections_select ON inspections
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_photos_select ON inspection_photos
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_measurements_select ON inspection_measurements
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_conditions_select ON inspection_conditions
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY audit_events_select ON audit_events
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_timeline_events_select ON case_timeline_events
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY operational_metrics_select ON operational_metrics
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_archives_select ON assignment_archives
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY ingest_jobs_select ON ingest_jobs
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_profiles_select ON voice_profiles
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_rules_select ON voice_rules
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_commentary_memory_select ON comp_commentary_memory
  FOR SELECT USING (user_id = current_setting('app.current_tenant_id'));

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Policies: INSERT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE POLICY case_records_insert ON case_records
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_facts_insert ON case_facts
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_outputs_insert ON case_outputs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_history_insert ON case_history
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignments_insert ON assignments
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY report_plans_insert ON report_plans
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generation_runs_insert ON generation_runs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY section_jobs_insert ON section_jobs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generated_sections_insert ON generated_sections
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY memory_items_insert ON memory_items
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY retrieval_cache_insert ON retrieval_cache
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY approved_memory_insert ON approved_memory
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY analysis_artifacts_insert ON analysis_artifacts
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_intelligence_insert ON assignment_intelligence
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_documents_insert ON case_documents
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_ingest_jobs_insert ON document_ingest_jobs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_extractions_insert ON document_extractions
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_facts_insert ON extracted_facts
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_sections_insert ON extracted_sections
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_candidates_insert ON comp_candidates
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_scores_insert ON comp_scores
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_tier_assignments_insert ON comp_tier_assignments
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_acceptance_events_insert ON comp_acceptance_events
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_rejection_events_insert ON comp_rejection_events
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_support_records_insert ON adjustment_support_records
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_recommendations_insert ON adjustment_recommendations
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY paired_sales_library_records_insert ON paired_sales_library_records
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_burden_metrics_insert ON comp_burden_metrics
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_runs_insert ON qc_runs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_findings_insert ON qc_findings
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_runs_insert ON insertion_runs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_run_items_insert ON insertion_run_items
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY destination_profiles_insert ON destination_profiles
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_jobs_insert ON export_jobs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY delivery_records_insert ON delivery_records
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_templates_insert ON export_templates
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY learned_patterns_insert ON learned_patterns
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pattern_applications_insert ON pattern_applications
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY fee_quotes_insert ON fee_quotes
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY engagement_records_insert ON engagement_records
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY invoices_insert ON invoices
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pipeline_entries_insert ON pipeline_entries
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspections_insert ON inspections
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_photos_insert ON inspection_photos
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_measurements_insert ON inspection_measurements
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_conditions_insert ON inspection_conditions
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_timeline_events_insert ON case_timeline_events
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY operational_metrics_insert ON operational_metrics
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_archives_insert ON assignment_archives
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY ingest_jobs_insert ON ingest_jobs
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_profiles_insert ON voice_profiles
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_rules_insert ON voice_rules
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_commentary_memory_insert ON comp_commentary_memory
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_tenant_id'));

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Policies: UPDATE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE POLICY case_records_update ON case_records
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_facts_update ON case_facts
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_outputs_update ON case_outputs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_history_update ON case_history
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignments_update ON assignments
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY report_plans_update ON report_plans
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generation_runs_update ON generation_runs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY section_jobs_update ON section_jobs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generated_sections_update ON generated_sections
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY memory_items_update ON memory_items
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY retrieval_cache_update ON retrieval_cache
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY approved_memory_update ON approved_memory
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY analysis_artifacts_update ON analysis_artifacts
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_intelligence_update ON assignment_intelligence
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_documents_update ON case_documents
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_ingest_jobs_update ON document_ingest_jobs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_extractions_update ON document_extractions
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_facts_update ON extracted_facts
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_sections_update ON extracted_sections
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_candidates_update ON comp_candidates
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_scores_update ON comp_scores
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_tier_assignments_update ON comp_tier_assignments
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_acceptance_events_update ON comp_acceptance_events
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_rejection_events_update ON comp_rejection_events
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_support_records_update ON adjustment_support_records
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_recommendations_update ON adjustment_recommendations
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY paired_sales_library_records_update ON paired_sales_library_records
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_burden_metrics_update ON comp_burden_metrics
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_runs_update ON qc_runs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_findings_update ON qc_findings
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_runs_update ON insertion_runs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_run_items_update ON insertion_run_items
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY destination_profiles_update ON destination_profiles
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_jobs_update ON export_jobs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY delivery_records_update ON delivery_records
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_templates_update ON export_templates
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY learned_patterns_update ON learned_patterns
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pattern_applications_update ON pattern_applications
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY fee_quotes_update ON fee_quotes
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY engagement_records_update ON engagement_records
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY invoices_update ON invoices
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pipeline_entries_update ON pipeline_entries
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspections_update ON inspections
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_photos_update ON inspection_photos
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_measurements_update ON inspection_measurements
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_conditions_update ON inspection_conditions
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY audit_events_update ON audit_events
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_timeline_events_update ON case_timeline_events
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY operational_metrics_update ON operational_metrics
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_archives_update ON assignment_archives
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY ingest_jobs_update ON ingest_jobs
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_profiles_update ON voice_profiles
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_rules_update ON voice_rules
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_commentary_memory_update ON comp_commentary_memory
  FOR UPDATE USING (user_id = current_setting('app.current_tenant_id'))
  WITH CHECK (user_id = current_setting('app.current_tenant_id'));

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS Policies: DELETE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE POLICY case_records_delete ON case_records
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_facts_delete ON case_facts
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_outputs_delete ON case_outputs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_history_delete ON case_history
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignments_delete ON assignments
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY report_plans_delete ON report_plans
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generation_runs_delete ON generation_runs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY section_jobs_delete ON section_jobs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY generated_sections_delete ON generated_sections
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY memory_items_delete ON memory_items
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY retrieval_cache_delete ON retrieval_cache
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY approved_memory_delete ON approved_memory
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY analysis_artifacts_delete ON analysis_artifacts
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_intelligence_delete ON assignment_intelligence
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_documents_delete ON case_documents
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_ingest_jobs_delete ON document_ingest_jobs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY document_extractions_delete ON document_extractions
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_facts_delete ON extracted_facts
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY extracted_sections_delete ON extracted_sections
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_candidates_delete ON comp_candidates
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_scores_delete ON comp_scores
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_tier_assignments_delete ON comp_tier_assignments
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_acceptance_events_delete ON comp_acceptance_events
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_rejection_events_delete ON comp_rejection_events
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_support_records_delete ON adjustment_support_records
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY adjustment_recommendations_delete ON adjustment_recommendations
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY paired_sales_library_records_delete ON paired_sales_library_records
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_burden_metrics_delete ON comp_burden_metrics
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_runs_delete ON qc_runs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY qc_findings_delete ON qc_findings
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_runs_delete ON insertion_runs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY insertion_run_items_delete ON insertion_run_items
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY destination_profiles_delete ON destination_profiles
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_jobs_delete ON export_jobs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY delivery_records_delete ON delivery_records
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY export_templates_delete ON export_templates
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY learned_patterns_delete ON learned_patterns
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pattern_applications_delete ON pattern_applications
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY fee_quotes_delete ON fee_quotes
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY engagement_records_delete ON engagement_records
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY invoices_delete ON invoices
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY pipeline_entries_delete ON pipeline_entries
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspections_delete ON inspections
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_photos_delete ON inspection_photos
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_measurements_delete ON inspection_measurements
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY inspection_conditions_delete ON inspection_conditions
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY audit_events_delete ON audit_events
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY case_timeline_events_delete ON case_timeline_events
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY operational_metrics_delete ON operational_metrics
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY assignment_archives_delete ON assignment_archives
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY ingest_jobs_delete ON ingest_jobs
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_profiles_delete ON voice_profiles
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY voice_rules_delete ON voice_rules
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));

CREATE POLICY comp_commentary_memory_delete ON comp_commentary_memory
  FOR DELETE USING (user_id = current_setting('app.current_tenant_id'));
