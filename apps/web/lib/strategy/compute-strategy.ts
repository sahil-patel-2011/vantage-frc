import type { PoolClient } from "@neondatabase/serverless";
import {
  buildAllianceMatchup,
  buildAllianceWinBreakdown,
  buildOperationsFromScoutEntries,
  buildStrategyPlaybook,
  formatScoutProvenance,
  fuseSeasonSignals,
  opponentTendencies,
  pickListHintsForAlliance,
  predictMatch,
  type Alliance,
  type EventMetricRow,
  type MatchResultFact,
  type ScoutEntryRecord,
  type ScoutProvenanceRef,
  type TeamOperationalSignal,
  type YearMetricRow,
} from "@vantage/prediction-strategy";
import { platformTbaEnvConfigured } from "@vantage/reference";
import type { ReferenceAccessInfo, StrategyView, TbaAccessInfo } from "./types";

function allianceKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: string[] }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

function tbaSlice(access: ReferenceAccessInfo): TbaAccessInfo {
  return {
    tbaConfigured: access.tbaConfigured,
    platformEnvKey: access.platformEnvKey,
    credentialAvailable: access.credentialAvailable,
    cacheHasSync: access.cacheHasSync,
  };
}

/** @deprecated Prefer resolveReferenceAccess — kept for callers that only need TBA. */
export async function resolveTbaAccess(
  client: PoolClient,
  orgId: string | null,
): Promise<TbaAccessInfo> {
  return tbaSlice(await resolveReferenceAccess(client, orgId));
}

/**
 * Honest TBA + Statbotics cache status.
 * Statbotics needs no API key; availability is whether Neon has cached rows.
 */
export async function resolveReferenceAccess(
  client: PoolClient,
  orgId: string | null,
): Promise<ReferenceAccessInfo> {
  const platformEnvKey = platformTbaEnvConfigured();
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

  let eventMetricRows = 0;
  let yearMetricRows = 0;
  try {
    const statCounts = await client.query<{
      eventMetricRows: number;
      yearMetricRows: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM team_event_metrics WHERE source = 'statbotics') AS "eventMetricRows",
         (SELECT COUNT(*)::int FROM team_year_metrics WHERE source = 'statbotics') AS "yearMetricRows"`,
    );
    eventMetricRows = Number(statCounts.rows[0]?.eventMetricRows ?? 0);
    yearMetricRows = Number(statCounts.rows[0]?.yearMetricRows ?? 0);
  } catch {
    eventMetricRows = 0;
    yearMetricRows = 0;
  }

  return {
    platformEnvKey,
    credentialAvailable,
    cacheHasSync,
    tbaConfigured: platformEnvKey || credentialAvailable || cacheHasSync,
    statbotics: {
      cacheHasMetrics: eventMetricRows > 0 || yearMetricRows > 0,
      eventMetricRows,
      yearMetricRows,
    },
  };
}

function normalizeConfidence(value: string | null): "high" | "normal" | "low" {
  if (value === "high" || value === "low") return value;
  return "normal";
}

async function loadScoutOperations(
  client: PoolClient,
  orgId: string,
  eventKey: string,
  teamKeys: string[],
): Promise<{
  operations: TeamOperationalSignal[];
  opponentFoulRisk: "low" | "medium" | "high" | "unknown";
  provenance: ScoutProvenanceRef[];
}> {
  if (!teamKeys.length) return { operations: [], opponentFoulRisk: "unknown", provenance: [] };

  const [matchRows, pitRows] = await Promise.all([
    client.query<{
      id: string;
      teamKey: string;
      matchKey: string | null;
      scoutUserId: string | null;
      payload: Record<string, unknown>;
      confidence: string | null;
      updatedAt: string | null;
      source: string | null;
      videoReviewId: string | null;
      videoAtSeconds: number | null;
    }>(
      `SELECT id, team_key AS "teamKey", match_key AS "matchKey",
              scout_user_id::text AS "scoutUserId", payload, confidence,
              updated_at::text AS "updatedAt", source,
              video_review_id::text AS "videoReviewId", video_at_seconds AS "videoAtSeconds"
       FROM match_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
       ORDER BY updated_at DESC
       LIMIT 400`,
      [orgId, eventKey, teamKeys],
    ),
    client.query<{
      id: string;
      teamKey: string;
      scoutUserId: string | null;
      payload: Record<string, unknown>;
      confidence: string | null;
      updatedAt: string | null;
    }>(
      `SELECT id, team_key AS "teamKey", scout_user_id::text AS "scoutUserId",
              payload, confidence, updated_at::text AS "updatedAt"
       FROM pit_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
       ORDER BY updated_at DESC
       LIMIT 200`,
      [orgId, eventKey, teamKeys],
    ),
  ]);

  const { loadEntryValidations, trustScoutPayloads } = await import("../scouting-trust");
  const validations = await loadEntryValidations(
    client,
    orgId,
    matchRows.rows.map((row) => row.id),
  );
  const trustedByEntry = trustScoutPayloads(
    matchRows.rows.map((row) => ({ id: row.id, payload: row.payload ?? {} })),
    validations,
  );

  const conflictProvenance: ScoutProvenanceRef[] = [];
  const entries: ScoutEntryRecord[] = [
    ...matchRows.rows.map((row) => {
      const trusted = trustedByEntry.get(row.id);
      if (trusted?.excludedFields.length) {
        conflictProvenance.push({
          entryId: row.id,
          entryType: "match",
          teamKey: row.teamKey,
          matchKey: row.matchKey,
          scoutUserId: row.scoutUserId,
          influence: "tba_conflict_excluded",
          weight: 0,
          source:
            row.source === "manual" ||
            row.source === "voice" ||
            row.source === "import" ||
            row.source === "video"
              ? row.source
              : undefined,
          videoReviewId: row.videoReviewId,
          videoAtSeconds: row.videoAtSeconds,
        });
      }
      return {
        id: row.id,
        teamKey: row.teamKey,
        entryType: "match" as const,
        matchKey: row.matchKey,
        scoutUserId: row.scoutUserId,
        payload: trusted?.trustedPayload ?? row.payload ?? {},
        confidence: normalizeConfidence(row.confidence),
        updatedAt: row.updatedAt,
        source:
          row.source === "manual" ||
          row.source === "voice" ||
          row.source === "import" ||
          row.source === "video"
            ? row.source
            : undefined,
        videoReviewId: row.videoReviewId,
        videoAtSeconds: row.videoAtSeconds,
      };
    }),
    ...pitRows.rows.map((row) => ({
      id: row.id,
      teamKey: row.teamKey,
      entryType: "pit" as const,
      matchKey: null,
      scoutUserId: row.scoutUserId,
      payload: row.payload ?? {},
      confidence: normalizeConfidence(row.confidence),
      updatedAt: row.updatedAt,
    })),
  ];

  const built = buildOperationsFromScoutEntries(entries);
  const operations: TeamOperationalSignal[] = built.map((row) => ({
    teamKey: row.teamKey,
    scoutSample: row.scoutSample,
    reliability: row.reliability,
    foulRate: row.foulRate,
    qualityWeight: row.qualityWeight,
    autoCapability: row.autoCapability,
    teleopCapability: row.teleopCapability,
    endgameCapability: row.endgameCapability,
    defenseLikely: row.defenseLikely,
    pitNotes: row.pitNotes,
    scoutEntryIds: [...new Set(row.provenance.map((ref) => ref.entryId))],
    qualityNotes: [
      ...row.quality.transparency,
      ...(conflictProvenance.some((ref) => ref.teamKey === row.teamKey)
        ? [
            "Some scout fields contradicted TBA official results and were excluded from strategy scoring.",
          ]
        : []),
    ],
    videoRescoutCount: row.videoRescoutCount,
    videoReviewIds: row.videoReviewIds,
  }));

  const provenance = [...built.flatMap((row) => row.provenance), ...conflictProvenance];
  let worstOpponentFoul: "low" | "medium" | "high" | "unknown" = "unknown";
  for (const op of operations) {
    const rate = op.foulRate ?? 0;
    const level = rate >= 1.5 ? "high" : rate >= 0.5 ? "medium" : rate > 0 ? "low" : "unknown";
    if (level === "high") worstOpponentFoul = "high";
    else if (level === "medium" && worstOpponentFoul !== "high") worstOpponentFoul = "medium";
    else if (level === "low" && worstOpponentFoul === "unknown") worstOpponentFoul = "low";
  }
  return { operations, opponentFoulRisk: worstOpponentFoul, provenance };
}

function setupPayload(
  access: ReferenceAccessInfo,
  fields: Omit<
    Extract<StrategyView, { status: "setup_required" | "empty" }>,
    "tbaConfigured" | "tbaAccess" | "referenceAccess"
  >,
): Extract<StrategyView, { status: "setup_required" | "empty" }> {
  return {
    ...fields,
    tbaConfigured: access.tbaConfigured,
    tbaAccess: tbaSlice(access),
    referenceAccess: access,
  };
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
  const access = await resolveReferenceAccess(client, row?.orgId ?? null);
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
    {
      id: "statbotics",
      label: "Cache Statbotics EPA",
      detail: access.statbotics.cacheHasMetrics
        ? `Neon has ${access.statbotics.eventMetricRows} event + ${access.statbotics.yearMetricRows} year Statbotics rows`
        : "No Statbotics EPA in Neon yet — run reference sync (public API; no key). Strategy can still use TBA OPR/EPA when present.",
      href: dataHref,
      done: access.statbotics.cacheHasMetrics,
    },
  ];

  if (!row?.orgId) {
    return setupPayload(access, {
      status: "setup_required",
      message: "Select a team workspace before running win/loss strategy.",
      steps: baseSteps,
      orgId: null,
      eventKey: null,
      eventName: null,
      teamNumber: null,
    });
  }

  if (!row.eventKey || !row.teamNumber) {
    return setupPayload(access, {
      status: "setup_required",
      message: "Select an active event and team number to load a match schedule.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
    });
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
    return setupPayload(access, {
      status: access.tbaConfigured ? "empty" : "setup_required",
      message,
      steps: baseSteps.map((step) =>
        step.id === "tba" || step.id === "statbotics"
          ? step
          : { ...step, done: step.id === "workspace" || step.id === "event" ? true : step.done },
      ),
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
    });
  }

  const red = allianceKeys(upcoming.redAlliance);
  const blue = allianceKeys(upcoming.blueAlliance);
  const allTeams = [...new Set([...red, ...blue])];
  if (red.length < 1 || blue.length < 1) {
    return setupPayload(access, {
      status: "empty",
      message: "Match alliances are incomplete in the synced schedule. Wait for TBA sync or pick another match.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
    });
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
    syncedAt: metric.syncedAt,
  }));

  // Season-long year EPA (current + prior two) — prefer Statbotics when both sources exist.
  const yearMetricsResult = await client.query<{
    teamKey: string;
    year: number;
    epaTotal: number | null;
    epaAuto: number | null;
    epaEndgame: number | null;
    source: string;
    syncedAt: string | null;
    matchesHint: number | null;
  }>(
    `SELECT DISTINCT ON (team_key, year)
        team_key AS "teamKey",
        year,
        epa_total AS "epaTotal",
        epa_auto AS "epaAuto",
        epa_endgame AS "epaEndgame",
        source,
        synced_at::text AS "syncedAt",
        NULLIF((source_payload->>'matches')::int, 0) AS "matchesHint"
     FROM team_year_metrics
     WHERE team_key = ANY($1::text[])
       AND year BETWEEN $2 AND $3
     ORDER BY team_key, year,
       CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
       synced_at DESC NULLS LAST`,
    [allTeams, year - 2, year],
  );

  const yearMetricRows: YearMetricRow[] = yearMetricsResult.rows.map((metric) => ({
    teamKey: metric.teamKey,
    year: metric.year,
    source: metric.source,
    epaTotal: metric.epaTotal,
    epaAuto: metric.epaAuto,
    epaEndgame: metric.epaEndgame,
    matches: metric.matchesHint,
    syncedAt: metric.syncedAt,
  }));

  const seasons = fuseSeasonSignals({
    eventMetrics: metricRows,
    yearMetrics: yearMetricRows,
  });

  if (seasons.length < Math.min(4, allTeams.length)) {
    const hasAnyReference =
      access.tbaConfigured || access.cacheHasSync || access.statbotics.cacheHasMetrics;
    return setupPayload(access, {
      status: hasAnyReference ? "empty" : "setup_required",
      message: hasAnyReference
        ? access.statbotics.cacheHasMetrics
          ? "No prediction yet — need event/year EPA covering enough alliance robots (and optional scouting) before the model can run."
          : "No prediction yet — Statbotics EPA cache is empty. Sync reference data so event/year metrics land in Neon, or wait for TBA metric rows."
        : "Team metrics are missing and TBA is not configured. Set TBA_AUTH_KEY or a TBA credential, then sync the event (Statbotics EPA syncs with the worker).",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
    });
  }

  const ourAlliance: Alliance = red.includes(teamKey) ? "red" : "blue";
  const opponentKeys = ourAlliance === "red" ? blue : red;
  const { operations, opponentFoulRisk, provenance: scoutProvenance } = await loadScoutOperations(
    client,
    row.orgId,
    row.eventKey,
    allTeams,
  );

  const opponentOps = operations.filter((op) => opponentKeys.includes(op.teamKey));
  let foulForPlaybook = opponentFoulRisk;
  if (opponentOps.length) {
    const rates = opponentOps.map((op) => op.foulRate ?? 0);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    foulForPlaybook =
      avg >= 1.5 ? "high" : avg >= 0.5 ? "medium" : rates.some((r) => r > 0) ? "low" : "unknown";
  }

  const matchHistory = await client.query<{
    matchKey: string;
    winningAlliance: string | null;
    redAlliance: unknown;
    blueAlliance: unknown;
  }>(
    `SELECT m.match_key AS "matchKey",
            m.winning_alliance AS "winningAlliance",
            m.red_alliance AS "redAlliance",
            m.blue_alliance AS "blueAlliance"
     FROM matches_ref m
     WHERE m.event_key = $1
       AND m.winning_alliance IN ('red', 'blue')
       AND m.match_key <> $2
       AND (
         m.red_alliance->'teamKeys' ?| $3::text[]
         OR m.blue_alliance->'teamKeys' ?| $3::text[]
       )
     ORDER BY COALESCE(m.actual_time, m.post_result_time, m.event_time) DESC NULLS LAST
     LIMIT 24`,
    [row.eventKey, upcoming.matchKey, allTeams],
  );

  const matchResults: MatchResultFact[] = matchHistory.rows.map((matchRow) => {
    const redKeys = allianceKeys(matchRow.redAlliance);
    const blueKeys = allianceKeys(matchRow.blueAlliance);
    const redScore =
      matchRow.redAlliance && typeof matchRow.redAlliance === "object"
        ? ((matchRow.redAlliance as { score?: number | null }).score ?? null)
        : null;
    const blueScore =
      matchRow.blueAlliance && typeof matchRow.blueAlliance === "object"
        ? ((matchRow.blueAlliance as { score?: number | null }).score ?? null)
        : null;
    return {
      matchKey: matchRow.matchKey,
      eventKey: row.eventKey!,
      winningAlliance:
        matchRow.winningAlliance === "red" || matchRow.winningAlliance === "blue"
          ? matchRow.winningAlliance
          : null,
      red: redKeys,
      blue: blueKeys,
      redScore,
      blueScore,
    };
  });

  const predictionInput = {
    matchKey: upcoming.matchKey,
    currentYear: year,
    eventLabel: row.eventName ?? row.eventKey,
    red,
    blue,
    seasons,
    operations,
    matchResults,
  };

  const prediction = predictMatch(predictionInput);
  const allianceBreakdown = buildAllianceWinBreakdown(predictionInput);

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

  const sources = [
    ...metricsResult.rows
      .filter((metric) => metric.epaTotal != null)
      .map((metric) => ({
        source: metric.source,
        syncedAt: metric.syncedAt,
        teamKey: metric.teamKey,
      })),
    ...yearMetricsResult.rows
      .filter((metric) => metric.epaTotal != null)
      .map((metric) => ({
        source: metric.source,
        syncedAt: metric.syncedAt,
        teamKey: metric.teamKey,
      })),
  ];

  const features = {
    red,
    blue,
    ourAlliance,
    eventKey: row.eventKey,
    scoutSample: operations.reduce((sum, op) => sum + op.scoutSample, 0),
    scoutEntryIds: [...new Set(operations.flatMap((op) => op.scoutEntryIds ?? []))].slice(0, 48),
    scoutProvenanceSummary: formatScoutProvenance(scoutProvenance, 10),
    qualityNotes: operations.flatMap((op) => op.qualityNotes ?? []).slice(0, 8),
    sources: [...new Set(sources.map((item) => item.source))],
    yearSignalCount: yearMetricRows.filter((metric) => metric.epaTotal != null).length,
    eventSignalCount: metricRows.filter((metric) => metric.epaTotal != null).length,
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
        JSON.stringify({
          playbook,
          matchup: matchup.considerations,
          tendencies,
          scoutProvenance: scoutProvenance.slice(0, 80),
          operations: operations.map((op) => ({
            teamKey: op.teamKey,
            scoutSample: op.scoutSample,
            reliability: op.reliability,
            foulRate: op.foulRate,
            qualityWeight: op.qualityWeight,
            autoCapability: op.autoCapability,
            teleopCapability: op.teleopCapability,
            endgameCapability: op.endgameCapability,
            defenseLikely: op.defenseLikely,
            pitNotes: op.pitNotes,
            scoutEntryIds: op.scoutEntryIds,
            qualityNotes: op.qualityNotes,
          })),
        }),
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
    tbaAccess: tbaSlice(access),
    referenceAccess: access,
    matchKey: upcoming.matchKey,
    compLevel: upcoming.compLevel,
    matchNumber: upcoming.matchNumber,
    ourAlliance,
    red,
    blue,
    prediction,
    allianceBreakdown,
    playbook,
    matchup,
    tendencies,
    pickListHints,
    scoutProvenance: scoutProvenance.slice(0, 80),
    operations,
    sources,
    computedAt: scoredAt,
  };
}
