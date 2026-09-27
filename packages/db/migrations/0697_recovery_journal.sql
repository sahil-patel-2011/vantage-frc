-- Transactional change capture. Application writes and their recovery events commit
-- together. Export acknowledges individual IDs, never a high-water mark that could skip
-- an earlier ID allocated by a transaction which commits later.
CREATE TABLE recovery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id bigint NOT NULL,
  schema_name text NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE','TRUNCATE')),
  before_record text,
  after_record text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  exported_at timestamptz,
  export_batch uuid
);
CREATE INDEX recovery_events_pending ON recovery_events(id) WHERE exported_at IS NULL;
ALTER TABLE recovery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recovery_events FROM PUBLIC,vantage_app,vantage_auth,vantage_marketing;
GRANT SELECT,INSERT,UPDATE,DELETE ON recovery_events TO vantage_worker;
GRANT USAGE,SELECT ON SEQUENCE recovery_events_id_seq TO vantage_worker;
CREATE POLICY recovery_worker ON recovery_events TO vantage_worker USING(true) WITH CHECK(true);

CREATE TABLE recovery_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('snapshot','journal')),
  state text NOT NULL CHECK(state IN ('writing','verified','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  resources jsonb NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash text,
  error text
);
ALTER TABLE recovery_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recovery_checkpoints FROM PUBLIC,vantage_app,vantage_auth,vantage_marketing;
GRANT SELECT,INSERT,UPDATE,DELETE ON recovery_checkpoints TO vantage_worker;
CREATE POLICY recovery_checkpoints_worker ON recovery_checkpoints TO vantage_worker USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION capture_recovery_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO recovery_events(transaction_id,schema_name,table_name,operation,before_record,after_record)
    VALUES(txid_current(),TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_OP,
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::text ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::text ELSE NULL END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION capture_recovery_change() FROM PUBLIC;

CREATE OR REPLACE FUNCTION install_recovery_capture() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','neon_auth') AND n.nspname NOT LIKE 'pg_%'
      AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND c.relname NOT IN ('recovery_events','recovery_checkpoints')
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=format('%I.%I',t.schema_name,t.table_name)::regclass AND tgname='vantage_recovery_row') THEN
      EXECUTE format('CREATE TRIGGER vantage_recovery_row AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION capture_recovery_change()',t.schema_name,t.table_name);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=format('%I.%I',t.schema_name,t.table_name)::regclass AND tgname='vantage_recovery_truncate') THEN
      EXECUTE format('CREATE TRIGGER vantage_recovery_truncate AFTER TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION capture_recovery_change()',t.schema_name,t.table_name);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION install_recovery_capture() FROM PUBLIC;
SELECT install_recovery_capture();

CREATE VIEW recovery_coverage AS
SELECT n.nspname AS schema_name,c.relname AS table_name,
  EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='vantage_recovery_row' AND t.tgenabled='O') AS rows_covered,
  EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='vantage_recovery_truncate' AND t.tgenabled='O') AS truncation_covered
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','neon_auth') AND n.nspname NOT LIKE 'pg_%'
  AND c.relkind IN ('r','p') AND NOT c.relispartition
  AND c.relname NOT IN ('recovery_events','recovery_checkpoints');
REVOKE ALL ON recovery_coverage FROM PUBLIC;
GRANT SELECT ON recovery_coverage TO vantage_worker;
