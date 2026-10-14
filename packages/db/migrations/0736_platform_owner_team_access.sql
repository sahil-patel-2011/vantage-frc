-- The platform owner manages any team's members and what each person can open.
--
-- Team admin already lets a team's owner and mentors choose each person's access (role,
-- sections they can open, extra powers), but only from inside the team: every check there is
-- "is the caller an owner or admin of this team". The platform owner runs Vantage and needs to
-- set the same access from Platform admin, on a team they are not on (or are on with less access).
--
-- Two narrow SECURITY DEFINER functions, the same shape as 0733: each checks is_platform_owner()
-- itself, so other platform admins get nothing new. The writes are the very rows Team admin
-- writes (memberships.role, membership_capabilities, membership_hub_access), so every existing
-- RLS policy and assertHubTabAccess call keeps deciding access. Owners are never changed here:
-- ownership moves only when the owner hands the team over. Each change is written to the
-- platform audit (admin_actions) and the team's own membership audit, and a role change reaches
-- the person through the same team_role_changed notice Team admin sends.
--
-- Safe to re-run: CREATE OR REPLACE only.

-- ---------------------------------------------------------------- read a team's members
CREATE OR REPLACE FUNCTION platform_owner_team_members(target_org uuid)
RETURNS TABLE (
  member_id uuid, member_name text, member_email text, member_role org_role,
  capabilities text[], hub_access jsonb, joined_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can manage a team''s members from Platform admin'
      USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  RETURN QUERY
    SELECT m.user_id,
           COALESCE(u.name, ''),
           u.email,
           m.role,
           ARRAY(SELECT c.capability::text FROM membership_capabilities c
                  WHERE c.org_id = m.org_id AND c.user_id = m.user_id ORDER BY 1),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('hubId', h.hub_id, 'allowedTabIds', to_jsonb(h.allowed_tab_ids))
                                      ORDER BY h.hub_id)
                       FROM membership_hub_access h
                      WHERE h.org_id = m.org_id AND h.user_id = m.user_id), '[]'::jsonb),
           m.created_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.org_id = target_org
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'scout' THEN 2 ELSE 3 END, u.name;
END $$;
REVOKE ALL ON FUNCTION platform_owner_team_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_owner_team_members(uuid) TO vantage_app;

-- ---------------------------------------------------------------- set one member's access
-- new_role: admin (Mentor or coach), scout (Student) or viewer (Parent or guest).
-- new_capabilities: the extra powers Team admin's editor manages (manage_budget and edit_docs
--   have their own screens and are left alone).
-- new_hub_access: [{"hubId": "competition", "allowedTabIds": []}, …]; [] means every section.
-- role_notice: the team_role_changed payload, worded by the app; written only when the role
--   actually changes.
CREATE OR REPLACE FUNCTION platform_owner_set_member_access(
  target_org uuid,
  target_user uuid,
  new_role org_role,
  new_capabilities text[],
  new_hub_access jsonb,
  role_notice jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  managed text[] := ARRAY['manage_api_keys','manage_team_settings','manage_members','manage_billing','manage_scouting'];
  hub_ids text[] := ARRAY['competition','team','business','build','ai','media'];
  old_role org_role;
  target_email text;
  caps text[] := '{}';
  hubs jsonb := '[]'::jsonb;
  before_caps text[];
  before_hubs jsonb;
  entry jsonb;
  hub text;
BEGIN
  IF actor IS NULL OR NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can manage a team''s members from Platform admin'
      USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  IF new_role IS NULL OR new_role NOT IN ('admin','scout','viewer') THEN
    RAISE EXCEPTION 'Choose Mentor or coach, Student, or Parent or guest.' USING ERRCODE = '22023';
  END IF;
  IF target_user = actor THEN
    RAISE EXCEPTION 'Change your own access from your own row on that team''s Members and invites.'
      USING ERRCODE = '22023', DETAIL = 'vantage:self';
  END IF;

  -- The same lock Team admin takes, so two people changing one team never interleave.
  PERFORM 1 FROM organizations WHERE id = target_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found' USING ERRCODE = 'P0002'; END IF;

  SELECT m.role, u.email INTO old_role, target_email
    FROM memberships m JOIN users u ON u.id = m.user_id
   WHERE m.org_id = target_org AND m.user_id = target_user;
  IF old_role IS NULL THEN
    RAISE EXCEPTION 'That person is not on this team.' USING ERRCODE = 'P0002';
  END IF;
  IF old_role = 'owner' THEN
    RAISE EXCEPTION 'A team owner always has full access. Ownership changes only when the owner hands the team over.'
      USING ERRCODE = '42501', DETAIL = 'vantage:owner_protected';
  END IF;
  -- A team always keeps someone who can run it (Team admin's admin-tenure rule).
  IF old_role = 'admin' AND new_role <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM memberships x
     WHERE x.org_id = target_org AND x.user_id <> target_user AND x.role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'They are the only one who can run this team. Make someone else a mentor or coach first.'
      USING ERRCODE = '22023';
  END IF;

  -- Mentors and coaches open everything and hold every power, so only students and parents keep
  -- sections and extra powers.
  IF new_role <> 'admin' THEN
    caps := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(new_capabilities, '{}'::text[])) c ORDER BY 1);
    IF EXISTS (SELECT 1 FROM unnest(caps) c WHERE NOT (c = ANY(managed))) THEN
      RAISE EXCEPTION 'Unknown extra power' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(new_hub_access, '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Sections must be a list' USING ERRCODE = '22023';
    END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(new_hub_access, '[]'::jsonb)) LOOP
      hub := entry->>'hubId';
      IF hub IS NULL OR NOT (hub = ANY(hub_ids)) THEN
        RAISE EXCEPTION 'Unknown section: %', COALESCE(hub, '(none)') USING ERRCODE = '22023';
      END IF;
      IF hubs @> jsonb_build_array(jsonb_build_object('hubId', hub)) THEN CONTINUE; END IF;
      hubs := hubs || jsonb_build_array(jsonb_build_object(
        'hubId', hub,
        'allowedTabIds', COALESCE((
          SELECT jsonb_agg(DISTINCT btrim(t) ORDER BY btrim(t))
            FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(entry->'allowedTabIds') = 'array' THEN entry->'allowedTabIds' ELSE '[]'::jsonb END) t
           WHERE btrim(t) <> ''), '[]'::jsonb)));
    END LOOP;
    -- A scouting lead opens every Competition page (as setMemberCapabilities enforces).
    IF 'manage_scouting' = ANY(caps) AND jsonb_array_length(hubs) > 0 THEN
      hubs := COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(hubs) h WHERE h->>'hubId' <> 'competition'), '[]'::jsonb)
              || jsonb_build_array(jsonb_build_object('hubId', 'competition', 'allowedTabIds', '[]'::jsonb));
    END IF;
    hubs := COALESCE((SELECT jsonb_agg(h ORDER BY h->>'hubId') FROM jsonb_array_elements(hubs) h), '[]'::jsonb);
  END IF;

  before_caps := ARRAY(SELECT c.capability::text FROM membership_capabilities c
                        WHERE c.org_id = target_org AND c.user_id = target_user AND c.capability::text = ANY(managed)
                        ORDER BY 1);
  before_hubs := COALESCE((SELECT jsonb_agg(jsonb_build_object('hubId', h.hub_id, 'allowedTabIds', to_jsonb(h.allowed_tab_ids))
                                            ORDER BY h.hub_id)
                             FROM membership_hub_access h
                            WHERE h.org_id = target_org AND h.user_id = target_user), '[]'::jsonb);

  IF new_role IS DISTINCT FROM old_role THEN
    UPDATE memberships SET role = new_role WHERE org_id = target_org AND user_id = target_user;
  END IF;
  IF caps IS DISTINCT FROM before_caps THEN
    DELETE FROM membership_capabilities
     WHERE org_id = target_org AND user_id = target_user AND capability::text = ANY(managed);
    INSERT INTO membership_capabilities(org_id, user_id, capability, granted_by)
      SELECT target_org, target_user, c::org_capability, actor FROM unnest(caps) c;
  END IF;
  IF hubs IS DISTINCT FROM before_hubs THEN
    DELETE FROM membership_hub_access WHERE org_id = target_org AND user_id = target_user;
    INSERT INTO membership_hub_access(org_id, user_id, hub_id, allowed_tab_ids, granted_by)
      SELECT target_org, target_user, h->>'hubId',
             ARRAY(SELECT jsonb_array_elements_text(h->'allowedTabIds')), actor
        FROM jsonb_array_elements(hubs) h;
  END IF;

  IF new_role IS NOT DISTINCT FROM old_role AND caps IS NOT DISTINCT FROM before_caps
     AND hubs IS NOT DISTINCT FROM before_hubs THEN
    RETURN;
  END IF;

  INSERT INTO admin_actions(actor_user_id, action, target_org_id, target_user_id, payload)
  VALUES (actor, 'team.member_access.updated', target_org, target_user, jsonb_build_object(
    'before', jsonb_build_object('role', old_role, 'capabilities', to_jsonb(before_caps), 'hubAccess', before_hubs),
    'after', jsonb_build_object('role', new_role, 'capabilities', to_jsonb(caps), 'hubAccess', hubs)));
  INSERT INTO membership_audit_events(org_id, actor_user_id, action, target_email_hash, metadata)
  VALUES (target_org, actor, 'member.access.updated_by_platform_owner',
          encode(digest(lower(btrim(target_email)), 'sha256'), 'hex'),
          jsonb_build_object('userId', target_user,
            'before', jsonb_build_object('role', old_role, 'capabilities', to_jsonb(before_caps), 'hubAccess', before_hubs),
            'after', jsonb_build_object('role', new_role, 'capabilities', to_jsonb(caps), 'hubAccess', hubs)));

  IF new_role IS DISTINCT FROM old_role AND jsonb_typeof(role_notice) = 'object' THEN
    INSERT INTO notifications(user_id, org_id, type, payload)
    VALUES (target_user, target_org, 'team_role_changed', role_notice);
  END IF;
END $$;
REVOKE ALL ON FUNCTION platform_owner_set_member_access(uuid, uuid, org_role, text[], jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_owner_set_member_access(uuid, uuid, org_role, text[], jsonb, jsonb) TO vantage_app;
