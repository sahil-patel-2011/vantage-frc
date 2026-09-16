-- Link a shift-balancer scout to a real team member.
--
-- The balancer plans who scouts which match, but its roster is free text, so a
-- finished plan could only ever become a CSV and a printed tablet sheet. The
-- student it was planned for never saw it: schedule, pre-match briefing, Event
-- Day command and the Home dashboard all read scout_assignments, which is keyed
-- by user_id, and nothing ever wrote a plan into it.
--
-- user_id is nullable on purpose. A parent volunteer or a student without an
-- account is still a scout the balancer should rotate fairly; they just cannot
-- receive a personal assignment. Rows without a member are skipped at publish
-- rather than blocked here.
--
-- ON DELETE SET NULL, not CASCADE: removing someone from the team must not
-- delete the shift history that explains who covered which matches.

ALTER TABLE shift_balancer_scouts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- One member cannot be two scouts in the same team's roster, or the fatigue cap
-- is computed against a person who is really two rows and they get double shifts.
CREATE UNIQUE INDEX IF NOT EXISTS shift_balancer_scouts_org_user_idx
  ON shift_balancer_scouts (org_id, user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN shift_balancer_scouts.user_id IS
  'Team member this scout is, when they have an account. Null for volunteers without one; those rows rotate in the plan but receive no scout_assignments row.';
