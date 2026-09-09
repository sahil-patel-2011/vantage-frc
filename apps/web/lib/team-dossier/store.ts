import type { PoolClient } from "@neondatabase/serverless";
import type { TeamDossierPayload } from "@vantage/reference";

/**
 * The team dossier as the page and the API see it. One row per org; every
 * field is what a public source said or null.
 */
export type TeamDossierView =
  | { status: "none"; teamNumber: number | null; canBuild: boolean }
  | {
      status: "queued" | "running" | "ready" | "failed";
      teamNumber: number;
      canBuild: boolean;
      profile: TeamDossierPayload["profile"];
      yearsParticipated: number[];
      awards: TeamDossierPayload["awards"];
      events: TeamDossierPayload["events"];
      stats: TeamDossierPayload["stats"];
      sources: Partial<TeamDossierPayload["sources"]>;
      error: string | null;
      computedAt: string | null;
      startedAt: string | null;
      /** From this org's own memberships — the only honest source for people. */
      roster: { owners: number; admins: number; members: number; total: number };
    };

type Row = {
  teamNumber: number;
  status: "queued" | "running" | "ready" | "failed";
  profile: TeamDossierPayload["profile"];
  yearsParticipated: number[];
  awards: TeamDossierPayload["awards"];
  events: TeamDossierPayload["events"];
  stats: TeamDossierPayload["stats"];
  sources: Partial<TeamDossierPayload["sources"]>;
  error: string | null;
  computedAt: string | null;
  startedAt: string | null;
};

/** Older than this and the weekly refresh rebuilds it. */
export const DOSSIER_STALE_DAYS = 7;

/**
 * Which org this request is about: the one asked for if the caller belongs to
 * it, else their highest-role membership. Same rule as the other team pages.
 */
export async function resolveDossierOrg(
  client: PoolClient,
  userId: string,
  requested: string | null,
): Promise<string | null> {
  const row = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requested],
  );
  return row.rows[0]?.orgId ?? null;
}

export async function loadTeamDossier(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<TeamDossierView> {
  const org = await client.query<{ teamNumber: number | null; role: string }>(
    `SELECT o.team_number AS "teamNumber", m.role::text AS role
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id AND m.user_id = $2::uuid
      WHERE o.id = $1::uuid`,
    [input.orgId, input.userId],
  );
  const orgRow = org.rows[0];
  if (!orgRow) throw new Error("forbidden");
  const canBuild = orgRow.role === "owner" || orgRow.role === "admin";

  const [rowResult, roster] = await Promise.all([
    client.query<Row>(
      `SELECT team_number AS "teamNumber", status, profile,
              years_participated AS "yearsParticipated", awards, events, stats, sources, error,
              to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "computedAt",
              to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startedAt"
         FROM team_dossiers WHERE org_id = $1::uuid`,
      [input.orgId],
    ),
    client.query<{ role: string; count: number }>(
      `SELECT role::text AS role, count(*)::int AS count FROM memberships WHERE org_id = $1::uuid GROUP BY role`,
      [input.orgId],
    ),
  ]);
  const row = rowResult.rows[0];
  if (!row) return { status: "none", teamNumber: orgRow.teamNumber, canBuild };

  const counts = { owners: 0, admins: 0, members: 0, total: 0 };
  for (const r of roster.rows) {
    const c = Number(r.count) || 0;
    counts.total += c;
    if (r.role === "owner") counts.owners += c;
    else if (r.role === "admin") counts.admins += c;
    else counts.members += c;
  }

  return {
    status: row.status,
    teamNumber: Number(row.teamNumber),
    canBuild,
    profile: row.profile ?? null,
    yearsParticipated: Array.isArray(row.yearsParticipated) ? row.yearsParticipated.map(Number) : [],
    awards: Array.isArray(row.awards) ? row.awards : [],
    events: Array.isArray(row.events) ? row.events : [],
    stats: row.stats ?? null,
    sources: row.sources ?? {},
    error: row.error,
    computedAt: row.computedAt,
    startedAt: row.startedAt,
    roster: counts,
  };
}

/**
 * Claim the build. Returns the team number when this caller now owns the run,
 * or null when another request already has it (a `running` row younger than
 * ten minutes). A run older than that is treated as abandoned — a serverless
 * function that died mid-build leaves no other trace.
 */
export async function claimDossierBuild(client: PoolClient, orgId: string): Promise<number | null> {
  const claimed = await client.query<{ teamNumber: number }>(
    `INSERT INTO team_dossiers (org_id, team_number, status, started_at)
     SELECT o.id, o.team_number, 'running', now() FROM organizations o WHERE o.id = $1::uuid AND o.team_number IS NOT NULL
     ON CONFLICT (org_id) DO UPDATE
        SET status = 'running', started_at = now(), error = NULL, updated_at = now()
      WHERE team_dossiers.status <> 'running'
         OR team_dossiers.started_at IS NULL
         OR team_dossiers.started_at < now() - interval '10 minutes'
     RETURNING team_number AS "teamNumber"`,
    [orgId],
  );
  const row = claimed.rows[0];
  return row ? Number(row.teamNumber) : null;
}

export async function saveDossier(
  client: PoolClient,
  orgId: string,
  payload: TeamDossierPayload,
): Promise<void> {
  // "ready" even when one source failed: the page shows what it has and names
  // the source that did not answer. Only both failing is a failed build.
  const status = payload.sources.tba.ok || payload.sources.statbotics.ok ? "ready" : "failed";
  const error = status === "failed"
    ? [payload.sources.tba.error, payload.sources.statbotics.error].filter(Boolean).join(" · ") || "Neither source answered"
    : null;
  await client.query(
    `UPDATE team_dossiers
        SET status = $2, profile = $3::jsonb, years_participated = $4::int[], awards = $5::jsonb,
            events = $6::jsonb, stats = $7::jsonb, sources = $8::jsonb, error = $9,
            computed_at = now(), updated_at = now()
      WHERE org_id = $1::uuid`,
    [
      orgId,
      status,
      JSON.stringify(payload.profile),
      payload.yearsParticipated,
      JSON.stringify(payload.awards),
      JSON.stringify(payload.events),
      JSON.stringify(payload.stats),
      JSON.stringify(payload.sources),
      error,
    ],
  );
}

export async function failDossier(client: PoolClient, orgId: string, message: string): Promise<void> {
  await client.query(
    `UPDATE team_dossiers SET status = 'failed', error = $2, updated_at = now() WHERE org_id = $1::uuid`,
    [orgId, message.slice(0, 500)],
  );
}
