-- The older deployed schema stores item_key/checked_at with a composite key.
-- Fresh installations use id/check_key/completed_at. Keep both interfaces so
-- existing checkmarks and the previous application release remain usable.
ALTER TABLE member_onboarding_checks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE member_onboarding_checks ADD COLUMN IF NOT EXISTS check_key text;
ALTER TABLE member_onboarding_checks ADD COLUMN IF NOT EXISTS item_key text;
ALTER TABLE member_onboarding_checks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE member_onboarding_checks ADD COLUMN IF NOT EXISTS checked_at timestamptz;

UPDATE member_onboarding_checks SET
  id = COALESCE(id, gen_random_uuid()),
  check_key = COALESCE(check_key, item_key),
  item_key = COALESCE(item_key, check_key),
  completed_at = COALESCE(completed_at, checked_at),
  checked_at = COALESCE(checked_at, completed_at)
WHERE id IS NULL OR check_key IS NULL OR item_key IS NULL OR completed_at IS NULL OR checked_at IS NULL;

ALTER TABLE member_onboarding_checks ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE member_onboarding_checks ALTER COLUMN id SET NOT NULL;
ALTER TABLE member_onboarding_checks ALTER COLUMN check_key SET NOT NULL;
ALTER TABLE member_onboarding_checks ALTER COLUMN item_key SET NOT NULL;
ALTER TABLE member_onboarding_checks ALTER COLUMN completed_at SET NOT NULL;
ALTER TABLE member_onboarding_checks ALTER COLUMN checked_at SET NOT NULL;
-- Fill a new timestamp in the trigger, after seeing which interface the caller
-- supplied. Two independent defaults would conceal an explicitly supplied date.
ALTER TABLE member_onboarding_checks ALTER COLUMN completed_at DROP DEFAULT;
ALTER TABLE member_onboarding_checks ALTER COLUMN checked_at DROP DEFAULT;

DO $$
DECLARE wanted record;
BEGIN
  FOR wanted IN SELECT * FROM (VALUES
    ('onboarding_check_id_compat', ARRAY['id']::text[]),
    ('onboarding_check_key_compat', ARRAY['org_id','user_id','track_key','check_key']::text[]),
    ('onboarding_item_key_compat', ARRAY['org_id','user_id','track_key','item_key']::text[])
  ) AS definitions(name,columns) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid='member_onboarding_checks'::regclass AND i.indisunique AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname::text ORDER BY k.position)
          FROM unnest(i.indkey) WITH ORDINALITY AS k(number,position)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number
          WHERE k.position<=i.indnkeyatts)=wanted.columns
    ) THEN
      EXECUTE format('CREATE UNIQUE INDEX %I ON member_onboarding_checks(%s)',wanted.name,
        (SELECT string_agg(format('%I',c),',') FROM unnest(wanted.columns) AS c));
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sync_onboarding_check_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.check_key IS DISTINCT FROM OLD.check_key AND NEW.item_key IS NOT DISTINCT FROM OLD.item_key THEN
      NEW.item_key := NEW.check_key;
    ELSIF NEW.item_key IS DISTINCT FROM OLD.item_key AND NEW.check_key IS NOT DISTINCT FROM OLD.check_key THEN
      NEW.check_key := NEW.item_key;
    END IF;
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at AND NEW.checked_at IS NOT DISTINCT FROM OLD.checked_at THEN
      NEW.checked_at := NEW.completed_at;
    ELSIF NEW.checked_at IS DISTINCT FROM OLD.checked_at AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN
      NEW.completed_at := NEW.checked_at;
    END IF;
  ELSE
    NEW.check_key := COALESCE(NEW.check_key, NEW.item_key);
    NEW.item_key := COALESCE(NEW.item_key, NEW.check_key);
    NEW.completed_at := COALESCE(NEW.completed_at, NEW.checked_at, statement_timestamp());
    NEW.checked_at := COALESCE(NEW.checked_at, NEW.completed_at);
  END IF;
  IF NEW.check_key IS DISTINCT FROM NEW.item_key OR NEW.completed_at IS DISTINCT FROM NEW.checked_at THEN
    RAISE EXCEPTION 'Onboarding check aliases disagree' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS onboarding_check_columns_compat ON member_onboarding_checks;
CREATE TRIGGER onboarding_check_columns_compat BEFORE INSERT OR UPDATE ON member_onboarding_checks
FOR EACH ROW EXECUTE FUNCTION sync_onboarding_check_columns();
