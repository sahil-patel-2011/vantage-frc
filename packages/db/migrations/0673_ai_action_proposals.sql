-- AI write actions wait for a person.
--
-- Before this migration a model turn that called `finance.create_purchase_request` or
-- `cad.create_brief` wrote the row straight away: whatever the model decided — or whatever a
-- fetched web page or a scouting note talked it into — became a purchase request with the
-- asker's name on it. `ai_run_approvals` (0141) is a cost gate for whole runs, not a record of
-- one proposed change, so it does not fit.
--
-- Now a write tool stores a proposal here and returns it; nothing changes until the person who
-- asked (or an owner/admin) presses Confirm. The confirm route replays the tool as the CONFIRMING
-- user, on their own RLS session, so the write is never more privileged than a person pressing
-- the button themselves. `ai_action_proposal_events` is the append-only audit trail.

CREATE TABLE IF NOT EXISTS ai_action_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL REFERENCES users(id),
  run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
  -- The registry is the authority on which tools write; this only keeps the shape sane.
  tool_name text NOT NULL CHECK (tool_name ~ '^[a-z_]+\.[a-z_]+$' AND length(tool_name) <= 80),
  -- The already-validated tool input. Replayed through the tool's own parser on confirm.
  input jsonb NOT NULL,
  -- One plain sentence for the Confirm card ("Create a purchase request for 4 × NEO motor, ~$240").
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'discarded', 'failed', 'expired')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  result jsonb,
  error text CHECK (error IS NULL OR length(error) <= 1000),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_action_proposals_decision_shape CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status = 'expired')
    OR (status IN ('confirmed', 'discarded', 'failed') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_action_proposals_org_status_idx
  ON ai_action_proposals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_action_proposals_proposer_idx
  ON ai_action_proposals (org_id, proposed_by, created_at DESC);

-- What was proposed can never change after the fact — only its decision can.
CREATE OR REPLACE FUNCTION ai_action_proposals_freeze_proposal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
     OR NEW.input IS DISTINCT FROM OLD.input
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'An AI action proposal cannot be edited, only confirmed or discarded'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This AI action proposal was already decided'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_action_proposals_freeze ON ai_action_proposals;
CREATE TRIGGER ai_action_proposals_freeze
  BEFORE UPDATE ON ai_action_proposals
  FOR EACH ROW EXECUTE FUNCTION ai_action_proposals_freeze_proposal();

ALTER TABLE ai_action_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_proposals_read ON ai_action_proposals;
DROP POLICY IF EXISTS ai_action_proposals_insert ON ai_action_proposals;
DROP POLICY IF EXISTS ai_action_proposals_decide ON ai_action_proposals;

-- The person the AI proposed it for, and the team's owners/admins.
CREATE POLICY ai_action_proposals_read ON ai_action_proposals FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      proposed_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

-- Written by the model turn, on the asker's own session, always pending.
CREATE POLICY ai_action_proposals_insert ON ai_action_proposals FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND proposed_by = current_app_user_id()
    AND status = 'pending'
    AND decided_by IS NULL
  );

-- Only the proposing user or an owner/admin decides, and the decision is stamped with who.
CREATE POLICY ai_action_proposals_decide ON ai_action_proposals FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND status = 'pending'
    AND (
      proposed_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  )
  WITH CHECK (
    is_org_member(org_id)
    AND status IN ('confirmed', 'discarded', 'failed')
    AND decided_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE ON ai_action_proposals TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_action_proposals TO vantage_worker;

-- Append-only audit trail: proposed / confirmed / discarded / failed, with who and when.
CREATE TABLE IF NOT EXISTS ai_action_proposal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES ai_action_proposals(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('proposed', 'confirmed', 'discarded', 'failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_action_proposal_events_proposal_idx
  ON ai_action_proposal_events (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS ai_action_proposal_events_org_idx
  ON ai_action_proposal_events (org_id, created_at DESC);

ALTER TABLE ai_action_proposal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_proposal_events_read ON ai_action_proposal_events;
DROP POLICY IF EXISTS ai_action_proposal_events_insert ON ai_action_proposal_events;

CREATE POLICY ai_action_proposal_events_read ON ai_action_proposal_events FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      actor_user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM ai_action_proposals p
        WHERE p.id = proposal_id AND p.proposed_by = current_app_user_id()
      )
    )
  );

CREATE POLICY ai_action_proposal_events_insert ON ai_action_proposal_events FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM ai_action_proposals p
      WHERE p.id = proposal_id AND p.org_id = ai_action_proposal_events.org_id
    )
  );

-- No UPDATE or DELETE for the app role: an audit trail that can be edited is not one.
GRANT SELECT, INSERT ON ai_action_proposal_events TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_action_proposal_events TO vantage_worker;
