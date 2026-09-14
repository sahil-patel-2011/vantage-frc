import type { PoolClient } from "@neondatabase/serverless";
import {
  deriveFoulRisk,
  deriveReliability,
  robotArchetypes,
  scoreAllianceChemistry,
  type AllianceChemistryResult,
  type Metric,
} from "@vantage/intel-research";
import { resolveTbaAccess } from "../strategy/compute-strategy";

export type ChemistryView = {
  status: "live" | "setup_required" | "empty";
  message?: string;
  orgId: string;
  eventKey: string | null;
  eventName: string | null;
  teamNumber: number | null;
  teamKey: string | null;
  tbaConfigured: boolean;
  teamKeys: string[];
  chemistry: AllianceChemistryResult | null;
  teams: Array<{
    teamKey: string;
    teamNumber: number | null;
    nickname: string | null;
    epaTotal: number | null;
    source: string | null;
    reliability: number | null;
    foulRate: number | null;
    scoutSample: number;
    archetypes: string[];
  }>;
  suggestions: Array<{ teamKey: string; teamNumber: number | null; reason: string }>;
  computedAt: string;
};

function allianceKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: string[] }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

function parseTeamKey(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (/^frc\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `frc${trimmed}`;
  return null;
}

export async function loadAllianceChemistry(
  client: PoolClient,
  input: { orgId: string; userId: string; teamKeys?: string[] },
): Promise<ChemistryView> {
  const computedAt = new Date().toISOString();
  const membership = await client.query<{
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
  }>(
    `SELECT o.team_number AS "teamNumber", c.active_event_key AS "eventKey", e.name AS "eventName"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.org_id = $1 AND m.user_id = $2
     LIMIT 1`,
    [input.orgId, input.userId],
  );
  const row = membership.rows[0];
  if (!row) {
    return {
      status: "setup_required",
      message: "Organization membership required.",
      orgId: input.orgId,
      eventKey: null,
      eventName: null,
      teamNumber: null,
      teamKey: null,
      tbaConfigured: false,
      teamKeys: [],
      chemistry: null,
      teams: [],
      suggestions: [],
      computedAt,
    };
  }

  const teamKey = row.teamNumber ? `frc${row.teamNumber}` : null;
  const tbaAccess = await resolveTbaAccess(client, input.orgId);
  let selected = (input.teamKeys ?? [])
    .map(parseTeamKey)
    .filter((key): key is string => Boolean(key));

  // Default: our next-match alliance partners (including us) when no explicit keys
  if (!selected.length && row.eventKey && teamKey) {
    const next = await client.query<{ redAlliance: unknown; blueAlliance: unknown }>(
      `SELECT red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
       FROM matches_ref
       WHERE event_key = $1
         AND (red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2)
         AND COALESCE(actual_time, predicted_time, event_time) > now()
       ORDER BY COALESCE(actual_time, predicted_time, event_time)
       LIMIT 1`,
      [row.eventKey, teamKey],
    );
    if (next.rows[0]) {
      const red = allianceKeys(next.rows[0].redAlliance);
      const blue = allianceKeys(next.rows[0].blueAlliance);
      selected = red.includes(teamKey) ? red : blue.includes(teamKey) ? blue : [];
    }
  }

  selected = [...new Set(selected)].slice(0, 3);

  if (!row.eventKey) {
    return {
      status: "setup_required",
      message: "Set your active event on Event day before scoring alliance chemistry.",
      orgId: input.orgId,
      eventKey: null,
      eventName: null,
      teamNumber: row.teamNumber,
      teamKey,
      tbaConfigured: tbaAccess.tbaConfigured,
      teamKeys: selected,
      chemistry: null,
      teams: [],
      suggestions: [],
      computedAt,
    };
  }

  if (selected.length < 2) {
    return {
      status: "empty",
      message:
        "Pick 2–3 team numbers (or wait for your next alliance on the schedule) to score chemistry.",
      orgId: input.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      teamKey,
      tbaConfigured: tbaAccess.tbaConfigured,
      teamKeys: selected,
      chemistry: null,
      teams: [],
      suggestions: [],
      computedAt,
    };
  }

  const metrics = await client.query<{
    teamKey: string;
    epaTotal: number | null;
    epaAuto: number | null;
    epaTeleop: number | null;
    epaEndgame: number | null;
    rank: number | null;
    wins: number | null;
    losses: number | null;
    ties: number | null;
    source: string;
    year: number;
  }>(
    `SELECT DISTINCT ON (team_key)
            team_key AS "teamKey", epa_total AS "epaTotal", epa_auto AS "epaAuto",
            epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame",
            rank, wins, losses, ties, source, $2::int AS year
     FROM team_event_metrics
     WHERE event_key = $1 AND team_key = ANY($3::text[])
     ORDER BY team_key,
              CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
              synced_at DESC`,
    [row.eventKey, Number(String(row.eventKey).slice(0, 4)) || new Date().getFullYear(), selected],
  );

  const nicknames = await client.query<{ teamKey: string; nickname: string | null }>(
    `SELECT team_key AS "teamKey", nickname FROM teams_ref WHERE team_key = ANY($1::text[])`,
    [selected],
  );
  const nickByKey = new Map(nicknames.rows.map((n) => [n.teamKey, n.nickname]));

  const scoutRows = await client.query<{
    teamKey: string;
    payload: Record<string, unknown>;
    confidence: string | null;
  }>(
    `SELECT team_key AS "teamKey", payload, confidence
     FROM match_scout_entries
     WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
     ORDER BY synced_at DESC
     LIMIT 300`,
    [input.orgId, row.eventKey, selected],
  );

  const byTeam = new Map<string, Array<{ payload: Record<string, unknown>; confidence: "high" | "normal" | "low" }>>();
  for (const entry of scoutRows.rows) {
    const confidence =
      entry.confidence === "high" || entry.confidence === "low" ? entry.confidence : "normal";
    const list = byTeam.get(entry.teamKey) ?? [];
    list.push({ payload: entry.payload ?? {}, confidence });
    byTeam.set(entry.teamKey, list);
  }

  const metricByKey = new Map(metrics.rows.map((m) => [m.teamKey, m]));
  const teamInputs = selected.map((key) => {
    const m = metricByKey.get(key);
    const observations = byTeam.get(key) ?? [];
    const reliability = deriveReliability(observations);
    const foul = deriveFoulRisk(observations);
    const metric: Metric | null = m
      ? {
          year: m.year,
          epaTotal: m.epaTotal,
          epaAuto: m.epaAuto,
          epaTeleop: m.epaTeleop,
          epaEndgame: m.epaEndgame,
          rank: m.rank,
          wins: m.wins,
          losses: m.losses,
          ties: m.ties,
          source: m.source,
          eventKey: row.eventKey ?? undefined,
        }
      : null;
    const archetypes = metric ? robotArchetypes([metric], observations) : [];
    return {
      teamKey: key,
      metric,
      reliability: reliability.score,
      foulRate: foul.rate,
      scoutSample: observations.length,
      archetypes,
    };
  });

  const chemistry = scoreAllianceChemistry(teamInputs);

  // Suggest high-EPA event teams not already selected (pick-list adjacent)
  const suggestions = await client.query<{ teamKey: string; epaTotal: number | null }>(
    `SELECT DISTINCT ON (team_key)
            team_key AS "teamKey", epa_total AS "epaTotal"
     FROM team_event_metrics
     WHERE event_key = $1 AND team_key <> ALL($2::text[])
     ORDER BY team_key,
              CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
              synced_at DESC`,
    [row.eventKey, selected],
  );
  const topSuggestions = suggestions.rows
    .filter((s) => s.epaTotal != null)
    .sort((a, b) => (b.epaTotal ?? 0) - (a.epaTotal ?? 0))
    .slice(0, 5)
    .map((s) => ({
      teamKey: s.teamKey,
      teamNumber: Number(/^frc(\d+)$/i.exec(s.teamKey)?.[1] ?? 0) || null,
      reason: `Event rating ${Math.round((s.epaTotal ?? 0) * 10) / 10} — try as a third seat`,
    }));

  return {
    status: "live",
    orgId: input.orgId,
    eventKey: row.eventKey,
    eventName: row.eventName,
    teamNumber: row.teamNumber,
    teamKey,
    tbaConfigured: tbaAccess.tbaConfigured,
    teamKeys: selected,
    chemistry,
    teams: teamInputs.map((t) => ({
      teamKey: t.teamKey,
      teamNumber: Number(/^frc(\d+)$/i.exec(t.teamKey)?.[1] ?? 0) || null,
      nickname: nickByKey.get(t.teamKey) ?? null,
      epaTotal: t.metric?.epaTotal ?? null,
      source: t.metric?.source ?? null,
      reliability: t.reliability ?? null,
      foulRate: t.foulRate ?? null,
      scoutSample: t.scoutSample ?? 0,
      archetypes: t.archetypes ?? [],
    })),
    suggestions: topSuggestions,
    computedAt,
  };
}
