-- Durable setup runs as the worker, without a database-owner fallback.
CREATE POLICY platform_sheets_hub_worker_read ON platform_sheets_hub
  FOR SELECT TO vantage_worker USING(true);
