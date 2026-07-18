-- FRC sponsor pipeline CRM + fundraising goal vs actual (Chief Delphi CRM ask).
-- Org-scoped only — stages and amounts never cross tenants.
-- Stages: prospect → ask → visit → pledged → active → renewal.

DO $$ BEGIN
  CREATE TYPE sponsor_pipeline_stage AS ENUM (
    'prospect',
    'ask',
    'visit',
    'pledged',
    'active',
    'renewal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS pipeline_stage sponsor_pipeline_stage NOT NULL DEFAULT 'prospect',
  ADD COLUMN IF NOT EXISTS ask_amount_usd numeric(12,2)
    CHECK (ask_amount_usd IS NULL OR ask_amount_usd >= 0),
  ADD COLUMN IF NOT EXISTS pledged_amount_usd numeric(12,2)
    CHECK (pledged_amount_usd IS NULL OR pledged_amount_usd >= 0),
  ADD COLUMN IF NOT EXISTS thank_you_due_on date,
  ADD COLUMN IF NOT EXISTS renewal_due_on date;

UPDATE sponsors SET pipeline_stage = CASE status::text
  WHEN 'active' THEN 'active'::sponsor_pipeline_stage
  WHEN 'lapsed' THEN 'renewal'::sponsor_pipeline_stage
  ELSE 'prospect'::sponsor_pipeline_stage
END
WHERE pipeline_stage = 'prospect'
  AND status::text IN ('active', 'lapsed');

CREATE INDEX IF NOT EXISTS sponsors_org_pipeline_idx
  ON sponsors(org_id, pipeline_stage);

DO $$ BEGIN
  ALTER TYPE sponsor_interaction_type ADD VALUE IF NOT EXISTS 'visit';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

COMMENT ON COLUMN sponsors.pipeline_stage IS
  'FRC sponsorship process stage: prospect → ask → visit → pledged → active → renewal';
COMMENT ON COLUMN sponsors.ask_amount_usd IS
  'Season ask target for this sponsor (org-local)';
COMMENT ON COLUMN sponsors.pledged_amount_usd IS
  'Verbal or written pledge before cash/in-kind is recorded';
