-- Readiness Score kept its own subsystem list.
--
-- `readiness_score_subsystems` (0223) carried name, weight_lbs, power_draw_amps,
-- wiring_status and code_version_status — a fourth copy of data the team already
-- maintains in the tools that own it:
--
--   name              robot_subsystems              (0104 spec sheet)
--   weight_lbs        weight_components             (0110 weight budget)
--   power_draw_amps   power_loads                   (0107 power budget)
--   wiring_status     subsystem_signoff_records     (0267, gate 'wiring')
--   code_version_st.  subsystem_signoff_records     (0267, gate 'programming')
--
-- Nothing kept the copy in step. Walking a season on a from-zero database:
-- entering two subsystems, a 118 lb configured limit, 41.75 lb of components,
-- 52 A of loads and two approved sign-off gates left Readiness Score reporting
-- `subsystems 0, weight 0/115, power 0/120` and scoring off a lone FMEA row.
-- The absence read as good news — with nothing recorded, weight and power
-- headroom each scored a perfect 1.0, so the index rose the less a team had
-- entered. That is a fabricated readiness number in everything but name, on a
-- surface mentors use to decide whether a robot ships.
--
-- Readiness Score is now a read model over the tables above; the only thing it
-- still owns is its bring-up checklist (readiness_score_checklist_items, kept).
--
-- Preserve anything a team typed here before dropping it: promote subsystem
-- names that have no spec-sheet row into robot_subsystems, carrying the note.
-- Weight/power/wiring/code values are deliberately NOT backfilled — they would
-- land as unattributed duplicates in budgets that already have real lines, and
-- a wrong number is worse than an empty one.

INSERT INTO robot_subsystems (org_id, season_year, name, category, motor_type, notes, created_by, created_at, updated_at)
SELECT r.org_id,
       r.season_year,
       r.name,
       'other',
       '',
       COALESCE(r.notes, ''),
       r.updated_by,
       r.created_at,
       r.updated_at
  FROM readiness_score_subsystems r
 WHERE NOT EXISTS (
         SELECT 1 FROM robot_subsystems s
          WHERE s.org_id = r.org_id
            AND s.season_year = r.season_year
            AND lower(btrim(s.name)) = lower(btrim(r.name))
       );

DROP TABLE readiness_score_subsystems;
