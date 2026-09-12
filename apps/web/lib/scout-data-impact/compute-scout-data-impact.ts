import type { PoolClient } from "@neondatabase/serverless";
import { pickCoverageRatio, rankContributions, summarizeByScout, totalEntriesInformingPicks } from ".";
import type { PickImpact, ScoutContribution, ScoutDataImpactPick, ScoutImpactSummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export type ScoutDataImpactSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutDataImpactView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutDataImpactSetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      events: Array<{ eventKey: string; name: string | null }>;
      picks: PickImpact[];
      scoutSummaries: ScoutImpactSummary[];
      totalEntries: number;
      coverageRatio: number;
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

type PickRow = {
  id: string;
  eventKey: string;
  teamKey: string;
  teamNumber: number | null;
  allianceNumber: number;
  pickOrder: number;
  notes: string | null;
  loggedBy: string;
  createdAt: string;
};

type ContributionRow = {
  scoutUserId: string;
  scoutName: string;
  teamKey: string;
  matchKey: string;
};

function mapPick(row: PickRow): ScoutDataImpactPick {
  return {
    id: row.id,
    eventKey: row.eventKey,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    allianceNumber: row.allianceNumber,
    pickOrder: row.pickOrder,
    notes: row.notes,
    loggedBy: row.loggedBy,
    createdAt: row.createdAt,
  };
}

function buildPickImpacts(picks: ScoutDataImpactPick[], contributionRows: ContributionRow[]): PickImpact[] {
  const byTeam = new Map<string, ContributionRow[]>();
  for (const row of contributionRows) {
    const list = byTeam.get(row.teamKey);
    if (list) list.push(row);
    else byTeam.set(row.teamKey, [row]);
  }

  return picks.map((pick) => {
    const rows = byTeam.get(pick.teamKey) ?? [];
    const byScout = new Map<string, { scoutName: string; entryCount: number; matchKeys: Set<string> }>();
    for (const row of rows) {
      const existing = byScout.get(row.scoutUserId);
      if (existing) {
        existing.entryCount += 1;
        existing.matchKeys.add(row.matchKey);
      } else {
        byScout.set(row.scoutUserId, {
          scoutName: row.scoutName,
          entryCount: 1,
          matchKeys: new Set([row.matchKey]),
        });
      }
    }
    const contributions: ScoutContribution[] = [...byScout.entries()].map(([scoutUserId, value]) => ({
      scoutUserId,
      scoutName: value.scoutName,
      entryCount: value.entryCount,
      matchKeys: [...value.matchKeys].sort(),
    }));
    return {
      pick,
      totalEntries: rows.length,
      contributions: rankContributions(contributions),
    };
  });
}

export async function computeScoutDataImpactView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null },
): Promise<ScoutDataImpactView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to see how your scouting data informed alliance picks.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      eventKey: input.eventKey ?? null,
    };
  }

  const eventsResult = await client.query<{ eventKey: string; name: string | null }>(
    `SELECT DISTINCT p.event_key AS "eventKey", e.name AS name
     FROM scout_data_impact_picks p
     LEFT JOIN events_ref e ON e.event_key = p.event_key
     WHERE p.org_id = $1
     ORDER BY p.event_key DESC`,
    [org.orgId],
  );
  const events = eventsResult.rows;

  const eventKey = input.eventKey && events.some((e) => e.eventKey === input.eventKey)
    ? input.eventKey
    : events[0]?.eventKey ?? null;

  if (!eventKey) {
    return {
      status: "setup_required",
      message: "No alliance picks have been logged yet. Log your final alliance-selection picks to see which scouting entries informed them.",
      steps: [
        {
          id: "log-picks",
          label: "Log alliance picks",
          detail: "Record each pick after alliance selection wraps up",
          href: "/scout-data-impact",
        },
      ],
      orgId: org.orgId,
      eventKey: null,
    };
  }

  const pickRowsResult = await client.query<PickRow>(
    `SELECT p.id, p.event_key AS "eventKey", p.team_key AS "teamKey", t.team_number AS "teamNumber",
            p.alliance_number AS "allianceNumber", p.pick_order AS "pickOrder", p.notes,
            p.logged_by AS "loggedBy", p.created_at::text AS "createdAt"
     FROM scout_data_impact_picks p
     LEFT JOIN teams_ref t ON t.team_key = p.team_key
     WHERE p.org_id = $1 AND p.event_key = $2
     ORDER BY p.alliance_number ASC, p.pick_order ASC`,
    [org.orgId, eventKey],
  );
  const picks = pickRowsResult.rows.map(mapPick);
  const teamKeys = picks.map((p) => p.teamKey);

  let contributionRows: ContributionRow[] = [];
  if (teamKeys.length > 0) {
    const contributionResult = await client.query<ContributionRow>(
      `SELECT m.scout_user_id AS "scoutUserId", u.name AS "scoutName", m.team_key AS "teamKey", m.match_key AS "matchKey"
       FROM match_scout_entries m
       JOIN users u ON u.id = m.scout_user_id
       WHERE m.org_id = $1 AND m.event_key = $2 AND m.team_key = ANY($3::text[])`,
      [org.orgId, eventKey, teamKeys],
    );
    contributionRows = contributionResult.rows;
  }

  const pickImpacts = buildPickImpacts(picks, contributionRows);
  const scoutSummaries = summarizeByScout(pickImpacts);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    events,
    picks: pickImpacts,
    scoutSummaries,
    totalEntries: totalEntriesInformingPicks(pickImpacts),
    coverageRatio: pickCoverageRatio(pickImpacts),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logPick(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    teamKey: string;
    allianceNumber: number;
    pickOrder: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_data_impact_picks (org_id, event_key, team_key, alliance_number, pick_order, notes, logged_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, event_key, team_key)
     DO UPDATE SET alliance_number = EXCLUDED.alliance_number, pick_order = EXCLUDED.pick_order, notes = EXCLUDED.notes`,
    [input.orgId, input.eventKey, input.teamKey, input.allianceNumber, input.pickOrder, input.notes, input.userId],
  );
}

export async function deletePick(
  client: PoolClient,
  input: { orgId: string; pickId: string },
): Promise<void> {
  await client.query(`DELETE FROM scout_data_impact_picks WHERE id = $1 AND org_id = $2`, [
    input.pickId,
    input.orgId,
  ]);
}

export async function acknowledgeImpact(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_data_impact_acknowledgments (org_id, event_key, scout_user_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (org_id, event_key, scout_user_id) DO UPDATE SET acknowledged_at = now()`,
    [input.orgId, input.eventKey, input.userId],
  );
}
