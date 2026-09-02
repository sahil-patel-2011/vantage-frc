-- Local development only: let the migration-created NOLOGIN roles connect so
-- scripts/dev-local-db.mjs can run the app with real RLS against localhost.
-- Never run this against a hosted database.
ALTER ROLE vantage_app LOGIN PASSWORD 'local';
ALTER ROLE vantage_auth LOGIN PASSWORD 'local';
ALTER ROLE vantage_worker LOGIN PASSWORD 'local';
ALTER ROLE vantage_marketing LOGIN PASSWORD 'local';
