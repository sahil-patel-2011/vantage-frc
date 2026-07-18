-- Sponsor Suite: pitch/renewal deck generator + end-of-season ROI report + auto thank-you/renewal
-- reminders + fundraising goal-vs-actual tracker. Builds on the existing sponsors /
-- sponsor_contributions tables (0035_team_finance_sponsors.sql) — new tables are prefixed
-- sponsor_suite_ so they never collide with the existing finance/sponsor schema.

CREATE TYPE sponsor_suite_deck_kind AS ENUM ('pitch', 'renewal');
CREATE TYPE sponsor_suite_reminder_kind AS ENUM ('thank_you', 'renewal');
CREATE TYPE sponsor_suite_reminder_status AS ENUM ('pending', 'sent', 'dismissed');

-- Season fundraising goal (one row per org/season) that the goal-vs-actual tracker compares
-- against the live sum of sponsor_contributions.
CREATE TABLE sponsor_suite_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  goal_usd numeric(12,2) NOT NULL CHECK (goal_usd >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, season_year)
);

-- Generated pitch/renewal deck outlines. sponsor_id is nullable for a general prospect pitch
-- not yet tied to a specific sponsor record.
CREATE TABLE sponsor_suite_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid REFERENCES sponsors(id) ON DELETE SET NULL,
  kind sponsor_suite_deck_kind NOT NULL,
  season_year integer NOT NULL,
  title text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_suite_decks_org_season_idx ON sponsor_suite_decks(org_id, season_year);

-- End-of-season ROI reports summarizing sponsor_contributions against the season goal.
CREATE TABLE sponsor_suite_roi_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  total_raised_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_raised_usd >= 0),
  total_sponsors integer NOT NULL DEFAULT 0 CHECK (total_sponsors >= 0),
  goal_usd numeric(12,2) CHECK (goal_usd IS NULL OR goal_usd >= 0),
  goal_attainment_pct numeric(6,4) CHECK (goal_attainment_pct IS NULL OR goal_attainment_pct >= 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  narrative text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_suite_roi_reports_org_season_idx ON sponsor_suite_roi_reports(org_id, season_year);

-- Thank-you / renewal reminders per sponsor, surfaced when due.
CREATE TABLE sponsor_suite_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  kind sponsor_suite_reminder_kind NOT NULL,
  due_on date NOT NULL,
  status sponsor_suite_reminder_status NOT NULL DEFAULT 'pending',
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_suite_reminders_org_due_idx ON sponsor_suite_reminders(org_id, status, due_on);

ALTER TABLE sponsor_suite_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_suite_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_suite_roi_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_suite_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_suite_goals_member_read ON sponsor_suite_goals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_suite_goals_member_insert ON sponsor_suite_goals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_suite_goals_member_update ON sponsor_suite_goals FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_suite_goals_member_delete ON sponsor_suite_goals FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY sponsor_suite_decks_member_read ON sponsor_suite_decks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_suite_decks_member_insert ON sponsor_suite_decks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_suite_decks_member_update ON sponsor_suite_decks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_suite_decks_member_delete ON sponsor_suite_decks FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY sponsor_suite_roi_reports_member_read ON sponsor_suite_roi_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_suite_roi_reports_member_insert ON sponsor_suite_roi_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_suite_roi_reports_member_update ON sponsor_suite_roi_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_suite_roi_reports_member_delete ON sponsor_suite_roi_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY sponsor_suite_reminders_member_read ON sponsor_suite_reminders FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_suite_reminders_member_insert ON sponsor_suite_reminders FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_suite_reminders_member_update ON sponsor_suite_reminders FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_suite_reminders_member_delete ON sponsor_suite_reminders FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_suite_goals, sponsor_suite_decks,
  sponsor_suite_roi_reports, sponsor_suite_reminders TO vantage_app, vantage_worker;
