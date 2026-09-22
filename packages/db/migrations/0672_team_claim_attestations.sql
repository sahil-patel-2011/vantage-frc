-- The statement a person made when they claimed an FRC team number.
--
-- Claiming a number that is not on Vantage yet (/claim → claim_frc_team_workspace,
-- 0429) is first-come-first-served. The database can check that the account is
-- verified and that the number exists, but it cannot check that the person
-- actually belongs to that team. What it can do is keep an exact record of what
-- they said when they claimed it: the words shown, which version of those
-- words, who, when, and a one-way hash of the network address it came from.
-- That record is what a team's real mentors and Vantage rely on if a claim is
-- disputed (Terms of Service, "Team identities and team numbers").
--
-- The row is written in the same transaction as the claim, so a team is never
-- created without its statement: if this insert fails, the claim rolls back.
--
-- Append-only from the product: there is no UPDATE or DELETE policy. Rows go
-- away with the team (org cascade) or the account (user cascade) — account
-- deletion removes the person's data, including this.
--
-- `ip_hash` is the salted SHA-256 prefix from apps/web/lib/rate-limit.ts
-- `anonymizeIp`. A raw IP address is never stored.

CREATE TABLE IF NOT EXISTS team_claim_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999),
  statement_version text NOT NULL CHECK (length(statement_version) BETWEEN 1 AND 64),
  statement text NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{8,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_claim_attestations_org_idx
  ON team_claim_attestations (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_claim_attestations_team_idx
  ON team_claim_attestations (team_number, created_at DESC);

ALTER TABLE team_claim_attestations ENABLE ROW LEVEL SECURITY;

-- Read: the team's owners and admins, and platform admins (who handle disputes).
DROP POLICY IF EXISTS team_claim_attestations_read ON team_claim_attestations;
CREATE POLICY team_claim_attestations_read ON team_claim_attestations
  FOR SELECT TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR is_platform_admin()
  );

-- Insert: only the claiming person, for themselves, for a team they now own,
-- and only for that team's own number. The claim route runs this inside the
-- same withRls transaction as claim_frc_team_workspace, which has just made the
-- caller the owner — has_org_role sees that uncommitted membership row.
DROP POLICY IF EXISTS team_claim_attestations_insert_own ON team_claim_attestations;
CREATE POLICY team_claim_attestations_insert_own ON team_claim_attestations
  FOR INSERT TO vantage_app
  WITH CHECK (
    user_id = current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner']::org_role[])
    AND EXISTS (
      SELECT 1
        FROM organizations o
       WHERE o.id = team_claim_attestations.org_id
         AND o.team_number = team_claim_attestations.team_number
    )
  );

GRANT SELECT, INSERT ON team_claim_attestations TO vantage_app, vantage_worker;
