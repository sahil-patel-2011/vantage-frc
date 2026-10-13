-- Personal keys remain owner-only rows. Sharing authorizes inference, never key management.
ALTER TABLE member_llm_keys
  ADD COLUMN share_scope text NOT NULL DEFAULT 'personal'
    CHECK (share_scope IN ('personal', 'team', 'selected')),
  ADD COLUMN share_user_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE member_llm_keys ADD CONSTRAINT member_key_sharing_recipients
  CHECK (cardinality(share_user_ids) <= 100 AND
    ((share_scope = 'selected' AND cardinality(share_user_ids) > 0) OR
     (share_scope <> 'selected' AND cardinality(share_user_ids) = 0)));

CREATE FUNCTION validate_member_key_sharing() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.share_scope = 'selected' AND EXISTS (
    SELECT 1 FROM unnest(NEW.share_user_ids) AS recipient(id)
    WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = NEW.org_id AND m.user_id = recipient.id)
  ) THEN RAISE EXCEPTION 'Choose people who belong to this team.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_member_key_sharing
  BEFORE INSERT OR UPDATE OF org_id, share_scope, share_user_ids ON member_llm_keys
  FOR EACH ROW EXECUTE FUNCTION validate_member_key_sharing();

-- Called only inside authenticated app RLS transactions by the inference resolver.
-- Do not widen member_llm_keys_own: recipients must never update, remove, or list the secret.
CREATE FUNCTION shared_member_llm_keys(p_org uuid) RETURNS SETOF member_llm_keys
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.* FROM member_llm_keys k
  WHERE k.org_id = p_org
    AND p_org = current_app_org_id()
    AND is_org_member(p_org)
    AND k.user_id <> current_app_user_id()
    AND k.enabled
    AND EXISTS (SELECT 1 FROM memberships owner_membership
                WHERE owner_membership.org_id = k.org_id AND owner_membership.user_id = k.user_id)
    AND (k.share_scope = 'team' OR
         (k.share_scope = 'selected' AND current_app_user_id() = ANY(k.share_user_ids)))
  ORDER BY k.priority, k.created_at, k.id
$$;
REVOKE ALL ON FUNCTION shared_member_llm_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared_member_llm_keys(uuid) TO vantage_app, vantage_worker;
