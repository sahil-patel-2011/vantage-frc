import type { PoolClient } from "@neondatabase/serverless";
import { summarizeScrimInvites, upcomingScrimInvites } from ".";
import { crossTeamScrimSetupSteps, type CrossTeamScrimSetupStep } from "./cross-team-scrim-related";
import type { ScrimDataShareScope, ScrimInvite, ScrimStatus, ScrimSummary } from "./types";

export const SCRIM_STATUSES: ScrimStatus[] = [
  "proposed",
  "accepted",
  "declined",
  "scheduled",
  "completed",
  "cancelled",
];

export const SCRIM_DATA_SHARE_SCOPES: ScrimDataShareScope[] = [
  "none",
  "match_results",
  "full_scouting",
  "video_only",
];

export type ScrimSetupStep = CrossTeamScrimSetupStep;

export type CrossTeamScrimView =
  | {
      status: "setup_required";
      message: string;
      steps: ScrimSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      invites: ScrimInvite[];
      upcoming: ScrimInvite[];
      summary: ScrimSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type InviteRow = {
  id: string;
  partnerTeamNumber: number;
  partnerTeamName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  proposedDate: string | null;
  location: string | null;
  status: ScrimStatus;
  dataShareScope: ScrimDataShareScope;
  dataShareAgreed: boolean;
  notes: string | null;
  seasonYear: number;
};

function mapInvite(row: InviteRow): ScrimInvite {
  return {
    id: row.id,
    partnerTeamNumber: Number(row.partnerTeamNumber) || 0,
    partnerTeamName: row.partnerTeamName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    proposedDate: row.proposedDate,
    location: row.location,
    status: row.status,
    dataShareScope: row.dataShareScope,
    dataShareAgreed: row.dataShareAgreed,
    notes: row.notes,
    seasonYear: row.seasonYear,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeCrossTeamScrimView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CrossTeamScrimView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to schedule scrims and manage data-sharing agreements with nearby teams.",
      steps: crossTeamScrimSetupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [inviteResult, seasonResult] = await Promise.all([
    client.query<InviteRow>(
      `SELECT id, partner_team_number AS "partnerTeamNumber", partner_team_name AS "partnerTeamName",
              contact_name AS "contactName", contact_email AS "contactEmail",
              proposed_date::text AS "proposedDate", location, status,
              data_share_scope AS "dataShareScope", data_share_agreed AS "dataShareAgreed",
              notes, season_year AS "seasonYear"
       FROM cross_team_scrim_invites
       WHERE org_id = $1 AND season_year = $2
       ORDER BY proposed_date ASC NULLS LAST, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM cross_team_scrim_invites WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const invites = inviteResult.rows.map(mapInvite);
  const summary = summarizeScrimInvites(invites);
  const upcoming = upcomingScrimInvites(invites).slice(0, 10);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    invites,
    upcoming,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createScrimInvite(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    partnerTeamNumber: number;
    partnerTeamName: string | null;
    contactName: string | null;
    contactEmail: string | null;
    proposedDate: string | null;
    location: string | null;
    dataShareScope: ScrimDataShareScope;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cross_team_scrim_invites (
       org_id, partner_team_number, partner_team_name, contact_name, contact_email,
       proposed_date, location, data_share_scope, notes, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)`,
    [
      input.orgId,
      input.partnerTeamNumber,
      input.partnerTeamName,
      input.contactName,
      input.contactEmail,
      input.proposedDate,
      input.location,
      input.dataShareScope,
      input.notes,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateScrimStatus(
  client: PoolClient,
  input: { orgId: string; inviteId: string; status: ScrimStatus },
): Promise<void> {
  await client.query(
    `UPDATE cross_team_scrim_invites SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.inviteId, input.orgId],
  );
}

export async function updateScrimDataShareAgreement(
  client: PoolClient,
  input: { orgId: string; inviteId: string; dataShareScope: ScrimDataShareScope; dataShareAgreed: boolean },
): Promise<void> {
  await client.query(
    `UPDATE cross_team_scrim_invites
     SET data_share_scope = $1, data_share_agreed = $2, updated_at = now()
     WHERE id = $3 AND org_id = $4`,
    [input.dataShareScope, input.dataShareAgreed, input.inviteId, input.orgId],
  );
}

export async function deleteScrimInvite(
  client: PoolClient,
  input: { orgId: string; inviteId: string },
): Promise<void> {
  await client.query(`DELETE FROM cross_team_scrim_invites WHERE id = $1 AND org_id = $2`, [
    input.inviteId,
    input.orgId,
  ]);
}
