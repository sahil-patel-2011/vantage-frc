import type { PoolClient } from "@neondatabase/serverless";

export type RankingProjectionSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type RankingProjectionView =
  | {
      status: "setup_required";
      message: string;
      steps: RankingProjectionSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      teamKey: string;
      eventKey: string;
      eventName: string;
      currentRank: number | null;
      record: string | null;
      remainingQuals: number;
      playedQuals: number;
      epaTotal: number | null;
      computedAt: string;
    };

function setup(message: string, orgId: string | null): RankingProjectionView {
  const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  return {
    status: "setup_required",
    message,
    orgId,
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      {
        id: "event",
        label: "Set active event",
        detail: "Rankings project from your active event's remaining qualification matches.",
        href: `/command${suffix}`,
      },
    ],
  };
}

export async function computeRankingProjectionView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<RankingProjectionView> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Select a team workspace to project rankings.", null);
  if (!org.teamNumber) return setup("Set your team number so rankings can find your TBA row.", org.orgId);

  const context = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
    [org.orgId],
  );
  const eventKey = context.rows[0]?.eventKey ?? null;
  if (!eventKey) return setup("Connect an active event before projecting remaining qualification matches.", org.orgId);

  const event = await client.query<{ name: string }>(
    `SELECT COALESCE(short_name, name) AS name FROM events_ref WHERE event_key = $1`,
    [eventKey],
  );
  if (!event.rows[0]) return setup("Active event is not in the TBA cache yet — sync live data first.", org.orgId);

  const teamKey = `frc${org.teamNumber}`;
  const [metrics, remaining, played] = await Promise.all([
    client.query<{ rank: number | null; wins: number | null; losses: number | null; ties: number | null; epaTotal: number | null }>(
      `SELECT rank, wins, losses, ties, epa_total AS "epaTotal"
       FROM team_event_metrics
       WHERE team_key = $1 AND event_key = $2
       ORDER BY CASE source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, synced_at DESC
       LIMIT 1`,
      [teamKey, eventKey],
    ),
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM matches_ref
       WHERE event_key = $1 AND comp_level = 'qm' AND winning_alliance IS NULL`,
      [eventKey],
    ),
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM matches_ref
       WHERE event_key = $1 AND comp_level = 'qm' AND winning_alliance IS NOT NULL`,
      [eventKey],
    ),
  ]);

  const row = metrics.rows[0];
  if (!row || row.rank == null) {
    return setup("No TBA ranking row yet for your team at this event — never invent a projected rank.", org.orgId);
  }

  const record =
    row.wins == null ? null : `${row.wins}-${row.losses ?? 0}-${row.ties ?? 0}`;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    teamKey,
    eventKey,
    eventName: event.rows[0].name,
    currentRank: row.rank,
    record,
    remainingQuals: Number(remaining.rows[0]?.count ?? 0),
    playedQuals: Number(played.rows[0]?.count ?? 0),
    epaTotal: row.epaTotal,
    computedAt: new Date().toISOString(),
  };
}
