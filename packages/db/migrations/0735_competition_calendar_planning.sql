-- A competition is one calendar row, shared by the whole team. Adding one in
-- Competition or Calendar writes the same link; no duplicate planning store.
ALTER TABLE subteam_calendar_events
  ADD COLUMN competition_event_key text REFERENCES events_ref(event_key),
  ADD COLUMN competition_auto_activate boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX calendar_competition_once
  ON subteam_calendar_events(org_id, competition_event_key)
  WHERE competition_event_key IS NOT NULL;
CREATE INDEX calendar_competition_due
  ON subteam_calendar_events(org_id, starts_at DESC)
  WHERE competition_auto_activate AND competition_event_key IS NOT NULL;

-- Ordinary members may schedule meetings, but cannot use a meeting edit to
-- change the team's competition. Enforce this at the database boundary too.
CREATE FUNCTION guard_calendar_competition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.competition_event_key IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.competition_event_key IS NOT NULL) THEN
    IF NOT can_manage_scouting(NEW.org_id) OR is_org_viewer(NEW.org_id) THEN
      RAISE EXCEPTION 'Scouting lead access required to schedule a competition';
    END IF;
    IF NEW.competition_event_key IS NOT NULL AND (
      NEW.subteam_id IS NOT NULL OR NEW.kind <> 'event' OR NEW.rrule IS NOT NULL
      OR NEW.ends_at IS NULL OR NEW.ends_at <= NEW.starts_at
      OR NOT EXISTS (SELECT 1 FROM events_ref e WHERE e.event_key = NEW.competition_event_key
        AND (e.org_id IS NULL OR e.org_id = NEW.org_id))
    ) THEN
      RAISE EXCEPTION 'Choose a team-visible competition, a start and end, and the whole team';
    END IF;
  ELSIF NEW.competition_auto_activate THEN
    RAISE EXCEPTION 'Link a competition before enabling automatic activation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_competition_guard BEFORE INSERT OR UPDATE ON subteam_calendar_events
  FOR EACH ROW EXECUTE FUNCTION guard_calendar_competition();

CREATE POLICY calendar_competition_lead_update ON subteam_calendar_events
  FOR UPDATE TO vantage_app
  USING (competition_event_key IS NOT NULL AND can_manage_scouting(org_id))
  WITH CHECK (competition_event_key IS NOT NULL AND can_manage_scouting(org_id));
CREATE POLICY calendar_competition_delete_guard ON subteam_calendar_events
  AS RESTRICTIVE FOR DELETE TO vantage_app
  USING (competition_event_key IS NULL OR can_manage_scouting(org_id));

-- Existing cron schedules are disabled. Advance approved plans when a member
-- next opens any team feature. This narrowly scoped function lets a reader
-- apply a lead's already-saved plan, never choose or edit an event themselves.
CREATE FUNCTION activate_scheduled_competition_events(requested_org uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE plan record;
BEGIN
  IF current_app_user_id() IS NULL THEN RETURN; END IF;
  FOR plan IN
    SELECT DISTINCT ON (c.org_id) c.org_id, c.competition_event_key,
      c.location, c.created_by, c.starts_at, c.created_at
    FROM subteam_calendar_events c
    JOIN memberships m ON m.org_id = c.org_id AND m.user_id = current_app_user_id()
    JOIN events_ref e ON e.event_key = c.competition_event_key
      AND (e.org_id IS NULL OR e.org_id = c.org_id)
    WHERE (requested_org IS NULL OR c.org_id = requested_org)
      AND c.competition_auto_activate AND c.competition_event_key IS NOT NULL
      AND c.subteam_id IS NULL AND c.kind = 'event' AND c.rrule IS NULL
      AND c.starts_at <= now() AND c.ends_at > now()
    ORDER BY c.org_id, c.starts_at DESC, c.id
  LOOP
    INSERT INTO org_active_context(org_id, active_event_key, active_location, set_by_user_id, set_at)
      VALUES (plan.org_id, plan.competition_event_key, NULLIF(plan.location, ''), plan.created_by, now())
    ON CONFLICT (org_id) DO UPDATE SET
      active_event_key = EXCLUDED.active_event_key,
      active_location = EXCLUDED.active_location,
      set_by_user_id = EXCLUDED.set_by_user_id,
      set_at = EXCLUDED.set_at
    -- A deliberate selection made after this plan started wins. The plan is
    -- applied once, and does not undo a manual override on every page view.
    WHERE org_active_context.set_at < GREATEST(plan.starts_at, plan.created_at);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION activate_scheduled_competition_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_scheduled_competition_events(uuid) TO vantage_app;
