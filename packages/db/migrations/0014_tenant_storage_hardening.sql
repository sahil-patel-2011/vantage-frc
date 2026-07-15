-- Media object keys are tenant-prefixed. Existing legacy local keys are normalized.
UPDATE scout_media SET storage_key=org_id::text||'/local/'||split_part(storage_key,'/',3)
 WHERE storage_key LIKE 'local/%/%' AND storage_key NOT LIKE org_id::text||'/%';
ALTER TABLE scout_media ADD CONSTRAINT scout_media_org_storage_key_ck
 CHECK(storage_key IS NULL OR storage_key LIKE org_id::text||'/%') NOT VALID;
-- New writes are enforced immediately; validation can be completed after auditing legacy external object keys.

CREATE OR REPLACE FUNCTION current_app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id',true),'')::uuid $$;
