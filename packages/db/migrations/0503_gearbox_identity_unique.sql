-- Gearbox identity: one saved row per org + season + name + subsystem.
-- 0111 only indexed (org_id, season_year, subsystem), so two concurrent
-- first-saves of the same name could both INSERT. The app upsert already
-- treats name and subsystem as case-insensitive (lower); this unique index
-- matches that key so the losing insert raises 23505 instead of duplicating.

DELETE FROM gearboxes
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY org_id, season_year, lower(name), lower(subsystem)
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM gearboxes
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS gearboxes_identity_uidx
  ON gearboxes (org_id, season_year, lower(name), lower(subsystem));
