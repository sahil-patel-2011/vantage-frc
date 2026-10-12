-- Change capture covers the public schema only, where every Vantage table lives (see the note in
-- 0697_recovery_journal.sql). Databases that ran the earlier all-schemas 0697 get the same
-- definitions here; on a fresh install this restates what 0697 already created. Triggers already
-- installed elsewhere stay as they are.
CREATE OR REPLACE FUNCTION install_recovery_capture() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname = 'public'
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

CREATE OR REPLACE VIEW recovery_coverage AS
SELECT n.nspname AS schema_name,c.relname AS table_name,
  EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='vantage_recovery_row' AND t.tgenabled='O') AS rows_covered,
  EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='vantage_recovery_truncate' AND t.tgenabled='O') AS truncation_covered
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p') AND NOT c.relispartition
  AND c.relname NOT IN ('recovery_events','recovery_checkpoints');
REVOKE ALL ON recovery_coverage FROM PUBLIC;
GRANT SELECT ON recovery_coverage TO vantage_worker;

SELECT install_recovery_capture();
