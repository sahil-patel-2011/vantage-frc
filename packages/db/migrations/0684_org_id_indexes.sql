-- Index org_id on every team table that did not have an index leading on it.
--
-- Row-level security filters each of these tables by team (is_org_member(org_id) and
-- friends), and most screens list "this team's rows". Without an index that is a
-- sequential scan of every team's rows, which is invisible with one team and grows
-- linearly with every team that joins. Found by a read-only catalog audit
-- (pg_index.indkey[0] = org_id) on 2026-09-23: 48 tables.
--
-- Plain CREATE INDEX IF NOT EXISTS: these tables are small today, so the brief lock is
-- cheap, and the runner applies each migration in one transaction (CONCURRENTLY is not
-- allowed there). Names follow <table>_org_id_idx. Nothing else changes.

CREATE INDEX IF NOT EXISTS agent_config_revisions_org_id_idx ON agent_config_revisions (org_id);
CREATE INDEX IF NOT EXISTS agent_context_usage_org_id_idx ON agent_context_usage (org_id);
CREATE INDEX IF NOT EXISTS agent_threads_org_id_idx ON agent_threads (org_id);
CREATE INDEX IF NOT EXISTS ai_credit_grants_org_id_idx ON ai_credit_grants (org_id);
CREATE INDEX IF NOT EXISTS ai_run_steps_org_id_idx ON ai_run_steps (org_id);
CREATE INDEX IF NOT EXISTS alliance_board_share_tokens_org_id_idx ON alliance_board_share_tokens (org_id);
CREATE INDEX IF NOT EXISTS artifact_links_org_id_idx ON artifact_links (org_id);
CREATE INDEX IF NOT EXISTS assembly_manual_steps_org_id_idx ON assembly_manual_steps (org_id);
CREATE INDEX IF NOT EXISTS award_items_org_id_idx ON award_items (org_id);
CREATE INDEX IF NOT EXISTS base44_bridge_nonces_org_id_idx ON base44_bridge_nonces (org_id);
CREATE INDEX IF NOT EXISTS base44_usage_events_org_id_idx ON base44_usage_events (org_id);
CREATE INDEX IF NOT EXISTS beta_enrollments_org_id_idx ON beta_enrollments (org_id);
CREATE INDEX IF NOT EXISTS bug_reports_org_id_idx ON bug_reports (org_id);
CREATE INDEX IF NOT EXISTS cad_checkpoints_org_id_idx ON cad_checkpoints (org_id);
CREATE INDEX IF NOT EXISTS cad_job_steps_org_id_idx ON cad_job_steps (org_id);
CREATE INDEX IF NOT EXISTS cad_review_queue_signoffs_org_id_idx ON cad_review_queue_signoffs (org_id);
CREATE INDEX IF NOT EXISTS data_source_credentials_org_id_idx ON data_source_credentials (org_id);
CREATE INDEX IF NOT EXISTS display_tokens_org_id_idx ON display_tokens (org_id);
CREATE INDEX IF NOT EXISTS drive_share_events_org_id_idx ON drive_share_events (org_id);
CREATE INDEX IF NOT EXISTS driver_cycles_org_id_idx ON driver_cycles (org_id);
CREATE INDEX IF NOT EXISTS finance_budget_plans_org_id_idx ON finance_budget_plans (org_id);
CREATE INDEX IF NOT EXISTS form_answers_org_id_idx ON form_answers (org_id);
CREATE INDEX IF NOT EXISTS form_assignments_org_id_idx ON form_assignments (org_id);
CREATE INDEX IF NOT EXISTS form_questions_org_id_idx ON form_questions (org_id);
CREATE INDEX IF NOT EXISTS form_responses_org_id_idx ON form_responses (org_id);
CREATE INDEX IF NOT EXISTS grant_application_items_org_id_idx ON grant_application_items (org_id);
CREATE INDEX IF NOT EXISTS judge_practice_sessions_org_id_idx ON judge_practice_sessions (org_id);
CREATE INDEX IF NOT EXISTS library_resource_links_org_id_idx ON library_resource_links (org_id);
CREATE INDEX IF NOT EXISTS maintenance_items_org_id_idx ON maintenance_items (org_id);
CREATE INDEX IF NOT EXISTS match_strategies_org_id_idx ON match_strategies (org_id);
CREATE INDEX IF NOT EXISTS mfa_step_up_sessions_org_id_idx ON mfa_step_up_sessions (org_id);
CREATE INDEX IF NOT EXISTS notifications_org_id_idx ON notifications (org_id);
CREATE INDEX IF NOT EXISTS pick_list_entries_org_id_idx ON pick_list_entries (org_id);
CREATE INDEX IF NOT EXISTS picklist_collab_entries_org_id_idx ON picklist_collab_entries (org_id);
CREATE INDEX IF NOT EXISTS picklist_collab_votes_org_id_idx ON picklist_collab_votes (org_id);
CREATE INDEX IF NOT EXISTS prediction_scenarios_org_id_idx ON prediction_scenarios (org_id);
CREATE INDEX IF NOT EXISTS product_handoffs_org_id_idx ON product_handoffs (org_id);
CREATE INDEX IF NOT EXISTS recognition_nominations_org_id_idx ON recognition_nominations (org_id);
CREATE INDEX IF NOT EXISTS recognition_votes_org_id_idx ON recognition_votes (org_id);
CREATE INDEX IF NOT EXISTS research_jobs_org_id_idx ON research_jobs (org_id);
CREATE INDEX IF NOT EXISTS scout_assisted_count_taps_org_id_idx ON scout_assisted_count_taps (org_id);
CREATE INDEX IF NOT EXISTS scout_crossval_fields_org_id_idx ON scout_crossval_fields (org_id);
CREATE INDEX IF NOT EXISTS showcase_sections_org_id_idx ON showcase_sections (org_id);
CREATE INDEX IF NOT EXISTS showcase_share_tokens_org_id_idx ON showcase_share_tokens (org_id);
CREATE INDEX IF NOT EXISTS sponsor_contacts_org_id_idx ON sponsor_contacts (org_id);
CREATE INDEX IF NOT EXISTS sponsor_interactions_org_id_idx ON sponsor_interactions (org_id);
CREATE INDEX IF NOT EXISTS training_records_org_id_idx ON training_records (org_id);
CREATE INDEX IF NOT EXISTS video_notes_org_id_idx ON video_notes (org_id);
