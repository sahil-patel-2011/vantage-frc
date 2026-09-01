-- Automode consulting: Sonnet-class execute may ask Opus/Fable-class to think.
-- Fixed mode always locks to one model (consult_enabled is ignored).

ALTER TABLE org_byok_routing_prefs
  ADD COLUMN IF NOT EXISTS consult_enabled boolean NOT NULL DEFAULT true;
