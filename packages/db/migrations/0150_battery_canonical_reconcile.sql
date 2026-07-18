-- CD #48: soft reconcile for environments where legacy batteries still exist.
-- 0150_battery_canonical.sql (lexicographically earlier) already migrates and
-- DROPs batteries / battery_readings when present. This file is a no-op after
-- that drop, and only copies leftover rows when the legacy tables remain.

DO $$
BEGIN
  IF to_regclass('public.batteries') IS NULL THEN
    COMMENT ON TABLE battery_packs IS 'Canonical FRC battery fleet (CD #48). Prefer over batteries.';
    COMMENT ON TABLE battery_logs IS 'Canonical append-only battery events/measurements (CD #48). Prefer over battery_readings.';
  ELSE
    INSERT INTO battery_packs (org_id, label, brand, nominal_ah, purchase_date, status, notes, created_by, created_at, updated_at)
    SELECT
      b.org_id,
      b.asset_tag AS label,
      NULL::text AS brand,
      NULL::numeric AS nominal_ah,
      b.acquired_at AS purchase_date,
      CASE b.status
        WHEN 'service' THEN 'quarantine'
        WHEN 'retired' THEN 'retired'
        ELSE 'active'
      END AS status,
      COALESCE(b.retirement_reason, '') AS notes,
      COALESCE(
        (SELECT m.user_id FROM memberships m WHERE m.org_id = b.org_id ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at LIMIT 1),
        (SELECT u.id FROM users u ORDER BY u.created_at LIMIT 1)
      ) AS created_by,
      b.created_at,
      b.updated_at
    FROM batteries b
    WHERE NOT EXISTS (
      SELECT 1 FROM battery_packs p WHERE p.org_id = b.org_id AND lower(p.label) = lower(b.asset_tag)
    )
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = b.org_id);

    IF to_regclass('public.battery_readings') IS NOT NULL THEN
      INSERT INTO battery_logs (
        org_id, battery_id, kind, resting_voltage, internal_resistance_mohm, match_key, note, logged_by, created_at
      )
      SELECT
        r.org_id,
        p.id AS battery_id,
        CASE
          WHEN r.internal_resistance_milliohms IS NOT NULL THEN 'resistance_test'
          WHEN r.voltage IS NOT NULL THEN 'note'
          ELSE 'note'
        END AS kind,
        r.voltage AS resting_voltage,
        r.internal_resistance_milliohms AS internal_resistance_mohm,
        NULL::text AS match_key,
        trim(concat_ws(' · ',
          'Migrated from pit battery_readings',
          NULLIF(r.source, ''),
          CASE WHEN r.charger_cycles IS NOT NULL THEN 'charger cycles ' || r.charger_cycles::text ELSE NULL END
        )) AS note,
        r.recorded_by AS logged_by,
        COALESCE(r.measured_at, r.created_at) AS created_at
      FROM battery_readings r
      JOIN batteries b ON b.id = r.battery_id AND b.org_id = r.org_id
      JOIN battery_packs p ON p.org_id = b.org_id AND lower(p.label) = lower(b.asset_tag)
      WHERE NOT EXISTS (
        SELECT 1
        FROM battery_logs l
        WHERE l.org_id = r.org_id
          AND l.battery_id = p.id
          AND l.logged_by = r.recorded_by
          AND l.created_at = COALESCE(r.measured_at, r.created_at)
          AND l.note LIKE 'Migrated from pit battery_readings%'
      );
    END IF;

    COMMENT ON TABLE battery_packs IS 'Canonical FRC battery fleet (CD #48). Prefer over batteries.';
    COMMENT ON TABLE battery_logs IS 'Canonical append-only battery events/measurements (CD #48). Prefer over battery_readings.';
    COMMENT ON TABLE batteries IS 'Legacy pit fleet table; superseded by battery_packs after 0150 migrate-copy.';
    IF to_regclass('public.battery_readings') IS NOT NULL THEN
      COMMENT ON TABLE battery_readings IS 'Legacy pit readings; superseded by battery_logs after 0150 migrate-copy.';
    END IF;
  END IF;
END $$;
