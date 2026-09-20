-- Local dev login roles for the group roles created by the migrations.
DO $$
DECLARE g text;
BEGIN
  FOREACH g IN ARRAY ARRAY['vantage_app','vantage_worker','vantage_auth','vantage_marketing'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g || '_login') THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', g || '_login', 'vantage_local');
    END IF;
    EXECUTE format('GRANT %I TO %I', g, g || '_login');
  END LOOP;
END $$;
