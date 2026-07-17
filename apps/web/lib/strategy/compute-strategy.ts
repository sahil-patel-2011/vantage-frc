import type { PoolClient } from "@neondatabase/serverless";
import { deriveFoulRisk, deriveReliability } from "@vantage/intel-research";
import {
  buildAllianceMatchup,
  buildStrategyPlaybook,
  opponentTendencies,
  pickListHintsForAlliance,
  predictMatch,
  signalsFromEventMetrics,
  type Alliance,
  type EventMetricRow,
  type TeamOperationalSignal,
} from "@vantage/prediction-strategy";
import type { StrategyView } from "./types";

function allianceKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: string[] }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

export async function resolveTbaAccess(
  client: PoolClient,
  orgId: string | null,
): Promise<{
  tbaConfigured: boolean;
  platformEnvKey: boolean;
  credentialAvailable: boolean;
  cacheHasSync: boolean;
}> {
  const platformEnvKey = Boolean(process.env.TBA_AUTH_KEY?.trim());
  let credentialAvailable = false;
  try {
    const credentials = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM data_source_credentials
         WHERE source = 'tba'
           AND disabled_at IS NULL
           AND (org_id IS NULL OR org_id IS NOT DISTINCT FROM $1::uuid)
       ) AS ok`,
      [orgId],
    );
    credentialAvailable = Boolean(credentials.rows[0]?.ok);
  } catch {
    credentialAvailable = false;
  }
  // sync_cursors is worker-private; infer cache from readable reference tables.
  const cache = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
            OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1) AS ok`,
  );
  const cacheHasSync = Boolean(cache.rows[0]?.ok);
  return {
    platformEnvKey,
    credentialAvailable,
    cacheHasSync,
    tbaConfigured: platformEnvKey || credentialAvailable || cacheHasSync,
  };
}

async function loadScoutOperations(
  client: PoolClient,
  orgId: string,
  eventKey: string,
  teamKeys: string[],
): Promise<{
  operations: TeamOperationalSignal[];
  opponentFoulRisk: "low" | "medium" | "high" | "unknown";
}> {
  if (!teamKeys.length) return { operations: [], opponentFoulRisk: "unknown" };
  const rows = await client.query<{
    teamKey: string;
    payload: Record<string, unknown>;
    confidence: string | null;
  }>(
    `SELECT team_key AS "teamKey", payload, confidence
     FROM match_scout_entries
     WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
     ORDER BY submitted_at DESC
     LIMIT 400`,
    [orgId, eventKey, teamKeys],
  );
  const byTeam = new Map<
    string,
    Array<{ payload: Record<string, unknown>; confidence: "high" | "normal" | "low" }>
  >();
  for (const row of rows.rows) {
    const confidence =
      row.confidence === "high" || row.confidence === "low" ? row.confidence : "normal";
    const list = byTeam.get(row.teamKey) ?? [];
    list.push({
      payload: row.payload ?? {},
      confidence,
    });
    byTeam.set(row.teamKey, list);
  }
  const operations: TeamOperationalSignal[] = [];
  let worstOpponentFoul: "low" | "medium" | "high" | "unknown" = "unknown";
  for (const teamKey of teamKeys) {
    const observations = byTeam.get(teamKey) ?? [];
    if (!observations.length) continue;
    const reliability = deriveReliability(observations);
    const foulRisk = deriveFoulRisk(observations);
    operations.push({
      teamKey,
      scoutSample: observations.length,
      reliability: reliability.score ?? undefined,
      foulRate: foulRisk.rate ?? undefined,
    });
    if (foulRisk.level === "high") worstOpponentFoul = "high";
    else if (foulRisk.level === "medium" && worstOpponentFoul !== "high")
      worstOpponentFoul = "medium";
    else if (foulRisk.level === "low" && worstOpponentFoul === "unknown")
      worstOpponentFoul = "low";
  }
  return { operations, opponentFoulRisk: worstOpponentFoul };
}

export async function computeStrategyView(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    matchKey?: string | null;
  },
): Promise<StrategyView> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber",
            c.active_event_key AS "eventKey", e.name AS "eventName"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );

  const row = membership.rows[0];
  const access = await resolveTbaAccess(client, row?.orgId ?? null);
  const dataHref = row?.orgId ? `/team/data?orgId=${encodeURIComponent(row.orgId)}` : "/team/data";

  const baseSteps = [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization",
      href: "/workspace",
      done: Boolean(row?.orgId),
    },
    {
      id: "event",
      label: "Select event / location",
      detail: "Set the active competition context",
      href: "/workspace",
      done: Boolean(row?.eventKey),
    },
    {
      id: "tba",
      label: "Sync TBA",
      detail: access.platformEnvKey
        ? "Platform TBA_AUTH_KEY configured — reference cache can sync"
        : access.credentialAvailable
          ? "Org/platform TBA credential saved — sync fills Neon cache"
          : access.cacheHasSync
            ? "Neon TBA cache has prior sync data"
            : "Set TBA_AUTH_KEY or save a TBA credential, then sync",
      href: dataHref,
      done: access.tbaConfigured,
    },
  ];

  if (!row?.orgId) {
    return {
      status: "setup_required",
      message: "Select a team workspace before running win/loss strategy.",
      steps: baseSteps,
      orgId: null,
      eventKey: null,
      eventName: null,
      teamNumber: null,
      tbaConfigured: access.tbaConfigured,
      tbaAccess: access,
    };
  }

  if (!row.eventKey || !row.teamNumber) {
    return {
      status: "setup_required",
      message: "Select an active event and team number to load a match schedule.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      tbaConfigured: access.tbaConfigured,
      tbaAccess: access,
    };
  }

  const teamKey = `frc${row.teamNumber}`;
  const match = await client.query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    year: number | null;
    redAlliance: unknown;
    blueAlliance: unknown;
  }>(
    input.matchKey
      ? `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                e.year, m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m
         JOIN events_ref e ON e.event_key = m.event_key
         WHERE m.event_key = $1 AND m.match_key = $2
         LIMIT 1`
      : `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                e.year, m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m
         JOIN events_ref e ON e.event_key = m.event_key
         WHERE m.event_key = $1
           AND (
             m.red_alliance->'teamKeys' ? $2
             OR m.blue_alliance->'teamKeys' ? $2
           )
           AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now() - interval '6 hours'
         ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
         LIMIT 1`,
    input.matchKey ? [row.eventKey, input.matchKey] : [row.eventKey, teamKey],
  );

  const upcoming = match.rows[0];
  if (!upcoming) {
    const message = !access.tbaConfigured
      ? "No match schedule in Neon yet, and TBA is not configured. Set TBA_AUTH_KEY (or save a TBA credential under Team → Data), then sync."
      : "No prediction yet — need a match schedule for your team at this event from TBA, plus team metrics.";
    return {
      status: access.tbaConfigured ? "empty" : "setup_required",
      message,
      steps: baseSteps.map((step) =>
        step.id === "tba" ? step : { ...step, done: step.id === "workspace" || step.id === "event" ? true : step.done },
      ),
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      tbaConfigured: access.tbaConfigured,
      tbaAccess: access,
    };
  }

  const red = allianceKeys(upcoming.redAlliance);
  const blue = allianceKeys(upcoming.blueAlliance);
  const allTeams = [...new Set([...red, ...blue])];
  if (red.length < 1 || blue.length < 1) {
    return {
      status: "empty",
      message: "Match alliances are incomplete in the synced schedule. Wait for TBA sync or pick another match.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      tbaConfigured: access.tbaConfigured,
      tbaAccess: access,
    };
  }

  const year = upcoming.year ?? new Date().getFullYear();
  const metricsResult = await client.query<{
    teamKey: string;
    epaTotal: number | null;
    epaAuto: number | null;
    epaEndgame: number | null;
    source: string;
    syncedAt: string | null;
    matchesHint: number | null;
    wins: number | null;
    losses: number | null;
    ties: number | null;
    rank: number | null;
  }>(
    `SELECT DISTINCT ON (team_key)
        team_key AS "teamKey",
        epa_total AS "epaTotal",
        epa_auto AS "epaAuto",
        epa_endgame AS "epaEndgame",
        source,
        synced_at::text AS "syncedAt",
        NULLIF((source_payload->>'matches')::int, 0) AS "matchesHint",
        wins, losses, ties, rank
     FROM team_event_metrics
     WHERE event_key = $1 AND team_key = ANY($2::text[])
     ORDER BY team_key,
       CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
       synced_at DESC NULLS LAST`,
    [row.eventKey, allTeams],
  );

  const metricRows: EventMetricRow[] = metricsResult.rows.map((metric) => ({
    teamKey: metric.teamKey,
    year,
    eventKey: row.eventKey!,
    source: metric.source,
    epaTotal: metric.epaTotal,
    epaAuto: metric.epaAuto,
    epaEndgame: metric.epaEndgame,
    wins: metric.wins,
    losses: metric.losses,
    ties: metric.ties,
    rank: metric.rank,
    matches: metric.matchesHint,
  }));

  const seasons = signalsFromEventMetrics(metricRows);
  if (seasons.length < Math.min(4, allTeams.length)) {
    return {
      status: access.tbaConfigured || access.cacheHasSync ? "empty" : "setup_required",
      message: access.tbaConfigured
        ? "No prediction yet — need team metrics from TBA/Statbotics (and optional scouting) before the model can run."
        : "Team metrics are missing and TBA is not configured. Set TBA_AUTH_KEY or a TBA credential, then sync the event.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      tbaConfigured: access.tbaConfigured,
      tbaAccess: access,
    };
  }

  const ourAlliance: Alliance = red.includes(teamKey) ? "red" : "blue";
  const opponentKeys = ourAlliance === "red" ? blue : red;
  const { operations, opponentFoulRisk } = await loadScoutOperations(
    client,
    row.orgId,
    row.eventKey,
    allTeams,
  );

  // Foul risk for playbook should focus on opponents
  const opponentOps = operations.filter((op) => opponentKeys.includes(op.teamKey));
  let foulForPlaybook = opponentFoulRisk;
  if (opponentOps.length) {
    const rates = opponentOps.map((op) => op.foulRate ?? 0);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    foulForPlaybook = avg >= 1.5 ? "high" : avg >= 0.5 ? "medium" : rates.some((r) => r > 0) ? "low" : "unknown";
  }

  const prediction = predictMatch({
    matchKey: upcoming.matchKey,
    currentYear: year,
    eventLabel: row.eventName ?? row.eventKey,
    red,
    blue,
    seasons,
    operations,
  });

  const playbook = buildStrategyPlaybook({
    prediction,
    ourAlliance,
    opponentFoulRisk: foulForPlaybook,
  });

  const matchup = buildAllianceMatchup({
    red,
    blue,
    metrics: metricRows,
    operations,
  });

  const tendencies = opponentTendencies({
    opponentKeys,
    metrics: metricRows,
    operations,
  });

  const pickLists = await client.query<{
    teamKey: string;
    listName: string;
    rank: number;
    tier: string | null;
    notes: string | null;
  }>(
    `SELECT e.team_key AS "teamKey", l.name AS "listName", e.rank, e.tier, e.notes
     FROM pick_list_entries e
     JOIN pick_lists l ON l.id = e.pick_list_id
     WHERE l.org_id = $1 AND l.event_key = $2 AND e.team_key = ANY($3::text[])
     ORDER BY e.rank, l.name`,
    [row.orgId, row.eventKey, allTeams],
  );

  const pickListHints = pickListHintsForAlliance(
    allTeams,
    pickLists.rows.map((entry) => ({
      teamKey: entry.teamKey,
      listName: entry.listName,
      rank: entry.rank,
      tier: entry.tier,
      notes: entry.notes,
    })),
  );

  const sources = metricsResult.rows
    .filter((metric) => metric.epaTotal != null)
    .map((metric) => ({
      source: metric.source,
      syncedAt: metric.syncedAt,
      teamKey: metric.teamKey,
    }));

  const features = {
    red,
    blue,
    ourAlliance,
    eventKey: row.eventKey,
    scoutSample: operations.reduce((sum, op) => sum + op.scoutSample, 0),
    sources: [...new Set(sources.map((item) => item.source))],
  };

  const scoredAt = new Date().toISOString();
  await client.query(
    `INSERT INTO predictions (
       org_id, match_key, model_version, p_red, p_blue,
       confidence_low, confidence_high, effective_sample_size,
       key_factors, features, caveats, created_by, scored_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::timestamptz
     )
     ON CONFLICT (org_id, match_key, model_version) DO UPDATE SET
       p_red = EXCLUDED.p_red,
       p_blue = EXCLUDED.p_blue,
       confidence_low = EXCLUDED.confidence_low,
       confidence_high = EXCLUDED.confidence_high,
       effective_sample_size = EXCLUDED.effective_sample_size,
       key_factors = EXCLUDED.key_factors,
       features = EXCLUDED.features,
       caveats = EXCLUDED.caveats,
       scored_at = EXCLUDED.scored_at`,
    [
      row.orgId,
      upcoming.matchKey,
      prediction.modelVersion,
      prediction.pRed,
      prediction.pBlue,
      prediction.confidenceLow,
      prediction.confidenceHigh,
      prediction.effectiveSampleSize,
      JSON.stringify(prediction.keyFactors),
      JSON.stringify(features),
      JSON.stringify(prediction.caveats),
      input.userId,
      scoredAt,
    ],
  );

  const predictionId = await client.query<{ id: string }>(
    `SELECT id FROM predictions WHERE org_id = $1 AND match_key = $2 AND model_version = $3`,
    [row.orgId, upcoming.matchKey, prediction.modelVersion],
  );

  await client.query(`DELETE FROM match_strategies WHERE org_id = $1 AND match_key = $2`, [
    row.orgId,
    upcoming.matchKey,
  ]);
  if (predictionId.rows[0]?.id) {
    await client.query(
      `INSERT INTO match_strategies (
         org_id, match_key, prediction_id, alliance, plan, created_by
       ) VALUES ($1, $2, $3::uuid, $4, $5::jsonb, $6)`,
      [
        row.orgId,
        upcoming.matchKey,
        predictionId.rows[0].id,
        ourAlliance,
        JSON.stringify({ playbook, matchup: matchup.considerations, tendencies }),
        input.userId,
      ],
    );
  }

  return {
    status: "live",
    orgId: row.orgId,
    eventKey: row.eventKey,
    eventName: row.eventName,
    teamNumber: row.teamNumber,
    tbaConfigured: access.tbaConfigured,
    tbaAccess: access,
    matchKey: upcoming.matchKey,
    compLevel: upcoming.compLevel,
    matchNumber: upcoming.matchNumber,
    ourAlliance,
    red,
    blue,
    prediction,
    playbook,
    matchup,
    tendencies,
    pickListHints,
    sources,
    computedAt: scoredAt,
  };
}
