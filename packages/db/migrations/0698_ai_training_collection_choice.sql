-- Eligibility is captured at collection, and current consent is checked again at use.
-- Historical records lack reliable collection-time consent and remain excluded.
ALTER TABLE ai_runs ADD COLUMN training_eligible_at_collection boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION capture_ai_training_choice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.training_eligible_at_collection := NOT EXISTS (
      SELECT 1 FROM org_ai_training_choice c WHERE c.org_id=NEW.org_id AND NOT c.training_allowed
    );
  ELSE
    -- Ordinary updates, including output completion, cannot rewrite collection consent.
    NEW.training_eligible_at_collection := OLD.training_eligible_at_collection;
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'AI activity cannot be moved between teams';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION capture_ai_training_choice() FROM PUBLIC;
CREATE TRIGGER ai_runs_collection_choice BEFORE INSERT OR UPDATE ON ai_runs
  FOR EACH ROW EXECUTE FUNCTION capture_ai_training_choice();

CREATE OR REPLACE VIEW ai_runs_training_eligible AS
  SELECT r.* FROM ai_runs r
  WHERE r.training_eligible_at_collection AND r.status='completed'
    AND NOT EXISTS (
      SELECT 1 FROM org_ai_training_choice c WHERE c.org_id=r.org_id AND NOT c.training_allowed
    );
REVOKE ALL ON ai_runs_training_eligible FROM PUBLIC;

-- Dataset preparation gets only the filtered view, never raw activity or operator access.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='vantage_training') THEN
    CREATE ROLE vantage_training NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO vantage_training;
GRANT SELECT ON ai_runs_training_eligible TO vantage_training;
REVOKE SELECT ON ai_runs_training_eligible FROM vantage_worker;
