import { matchStillAheadSql } from "../matches/match-ahead-sql";
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
  buildAllianceMatchup,
  MIN_FIELD_SIZE,
  buildAllianceWinBreakdown,
  fieldCentre,
  shrinkageConstant,
  winLevers,
  buildOperationsFromScoutEntries,
  buildStrategyPlaybook,
  formatScoutProvenance,
  fuseSeasonSignals,
  opponentTendencies,
  pickListHintsForAlliance,
  predictMatch,
  selectStrategyEngine,
  toEngineSummary,
  type Alliance,
  type EventMetricRow,
  type MatchResultFact,
  type ScoutEntryRecord,
  type ScoutProvenanceRef,
  type TeamOperationalSignal,
  type YearMetricRow,
  MAX_SEASONS_COUNTED,
  teamTrend,
} from "@vantage/prediction-strategy";
import type { PrivateEdgeView } from "@vantage/prediction-strategy";
import { platformTbaEnvConfigured } from "@vantage/reference";
import type {
  ReferenceAccessInfo,
  StrategyEngineeringContext,
  StrategyGameRulesContext,
  StrategyPlaybookView,
  StrategyView,
  TbaAccessInfo,
} from "./types";
import { computePrivateEdgeView } from "./compute-private-edge";
import { matchSpecificPlan } from "./match-plan";
import { loadSeasonScales } from "./season-scales";
import { loadScoutFieldRoles } from "./scout-field-roles";
import { projectScoutEntriesForEngine } from "./scout-engine-payload";
import {
  EMPTY_PREDICTION_COPY,
  EMPTY_PREDICTION_NO_RATINGS_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_SETUP_COPY,
  EMPTY_PREDICTION_SETUP_COPY,
} from "./prediction-empty-copy";
import { resolveActiveSeasonYear } from "@vantage/agent";
import { VANTAGE_PRODUCT_VERSION } from "../product-version";
import { readEventScoring } from "../opr/alliance-results";
import { loadEventEntryValidations, trustScoutPayloads } from "../scouting-trust";

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

function normalizeScoutSource(
  source: string | null | undefined,
): ScoutEntryRecord["source"] {
  if (source === "manual" || source === "voice" || source === "import" || source === "video") {
    return source;
  }
  return undefined;
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
  // Three facts, none of which needs the previous answer. One wave.
  const [credentials, cache, statCounts] = await Promise.all([
    client
      .query<{ ok: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM data_source_credentials
           WHERE source = 'tba'
             AND disabled_at IS NULL
             AND (org_id IS NULL OR org_id IS NOT DISTINCT FROM $1::uuid)
         ) AS ok`,
        [orgId],
      )
      .catch(() => ({ rows: [{ ok: false }] })),
    client.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
              OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1) AS ok`,
    ),
    client
      .query<{ eventMetricRows: number; yearMetricRows: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM team_event_metrics WHERE source = 'statbotics') AS "eventMetricRows",
           (SELECT COUNT(*)::int FROM team_year_metrics WHERE source = 'statbotics') AS "yearMetricRows"`,
      )
      .catch(() => ({ rows: [{ eventMetricRows: 0, yearMetricRows: 0 }] })),
  ]);
  const credentialAvailable = Boolean(credentials.rows[0]?.ok);
  // sync_cursors is worker-private; infer cache from readable reference tables.
  const cacheHasSync = Boolean(cache.rows[0]?.ok);
  const eventMetricRows = Number(statCounts.rows[0]?.eventMetricRows ?? 0);
  const yearMetricRows = Number(statCounts.rows[0]?.yearMetricRows ?? 0);

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

/** Load kickoff rules / design priorities for one seasonYear only — never mix prior seasons. */
export async function loadSeasonGameRules(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<StrategyGameRulesContext> {
  const kickoffHref = `/kickoff?orgId=${encodeURIComponent(orgId)}&season=${seasonYear}`;
  try {
    const [notes, priorities, intel] = await Promise.all([
      client.query<{
        id: string;
        question: string;
        answer: string;
        ruleRef: string;
        status: string;
      }>(
        `SELECT id, question, answer, rule_ref AS "ruleRef", status
         FROM kickoff_rule_notes
         WHERE org_id=$1::uuid AND season_year=$2
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 40`,
        [orgId, seasonYear],
      ),
      client.query<{
        id: string;
        capability: string;
        rationale: string;
        weight: number;
        status: string;
      }>(
        `SELECT id, capability, rationale, weight, status
         FROM design_priorities
         WHERE org_id=$1::uuid AND season_year=$2
         ORDER BY weight DESC, created_at ASC
         LIMIT 40`,
        [orgId, seasonYear],
      ),
      client.query<{ summary: { constraints?: string[] } | null }>(
        `SELECT summary FROM kickoff_game_intelligence
         WHERE org_id=$1::uuid AND season_year=$2
         ORDER BY created_at DESC LIMIT 1`,
        [orgId, seasonYear],
      ),
    ]);
    const constraints = Array.isArray(intel.rows[0]?.summary?.constraints)
      ? intel.rows[0]!.summary!.constraints!.map((row) => String(row).trim()).filter(Boolean)
      : [];
    const ruleNotes = notes.rows;
    const designPriorities = priorities.rows;
    if (!ruleNotes.length && !designPriorities.length && !constraints.length) {
      return {
        seasonYear,
        status: "empty",
        message: `No ${seasonYear} game rules or design priorities yet. Add them on Kickoff — strategy and CAD will not use prior-season rules.`,
        kickoffHref,
        constraints: [],
        ruleNotes: [],
        designPriorities: [],
      };
    }
    return {
      seasonYear,
      status: "ready",
      message: `${seasonYear} kickoff rules loaded (${constraints.length} constraint${constraints.length === 1 ? "" : "s"}, ${ruleNotes.length} note${ruleNotes.length === 1 ? "" : "s"}).`,
      kickoffHref,
      constraints,
      ruleNotes,
      designPriorities,
    };
  } catch {
    return {
      seasonYear,
      status: "setup_required",
      message: `Kickoff rules tables are not available yet for ${seasonYear}.`,
      kickoffHref,
      constraints: [],
      ruleNotes: [],
      designPriorities: [],
    };
  }
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

  // Published-schema role map so custom form-builder fields reach strategy.
  // Roles do not depend on the entries, so they share the entries' round trip.
  const [fieldRoles, matchRows, pitRows, eventValidations] = await Promise.all([
    loadScoutFieldRoles(client, orgId, eventKey),
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
    loadEventEntryValidations(client, orgId, eventKey, teamKeys).catch(() => []),
  ]);

  const loadedIds = new Set(matchRows.rows.map((row) => row.id));
  const validations = eventValidations.filter((row) => loadedIds.has(row.entryId));
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
          source: normalizeScoutSource(row.source),
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
        source: normalizeScoutSource(row.source),
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

  const built = buildOperationsFromScoutEntries(projectScoutEntriesForEngine(entries, fieldRoles), {
    roles: fieldRoles,
  });
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
    "tbaConfigured" | "tbaAccess" | "referenceAccess" | "gameRules" | "engine" | "productVersion"
  > &
    Partial<Pick<Extract<StrategyView, { status: "setup_required" | "empty" }>, "engine" | "productVersion">>,
  gameRules?: StrategyGameRulesContext,
): Extract<StrategyView, { status: "setup_required" | "empty" }> {
  return {
    ...fields,
    tbaConfigured: access.tbaConfigured,
    tbaAccess: tbaSlice(access),
    referenceAccess: access,
    ...(gameRules ? { gameRules } : {}),
  };
}

export async function computeStrategyView(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    matchKey?: string | null;
    /**
     * Paint path. The match is still predicted for the page. The save, the
     * engineering links, and Private Edge wait, because those are the long
     * chain and the page does not need them to draw.
     */
    readOnly?: boolean;
  },
): Promise<StrategyView> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    role: string;
    eventKey: string | null;
    eventName: string | null;
    eventYear: number | null;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role,
            c.active_event_key AS "eventKey", e.name AS "eventName", e.year AS "eventYear"
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
  const dataHref = row?.orgId ? `/team/data?orgId=${encodeURIComponent(row.orgId)}` : "/team/data";
  const seasonYear = resolveActiveSeasonYear({
    seasonYear: row?.eventYear,
    activeEventKey: row?.eventKey,
  });
  const teamKeyEarly = row?.teamNumber ? `frc${row.teamNumber}` : null;
  // Access, rules, plan, and the match do not depend on each other once the
  // team row is known. One wave, not four.
  const [access, gameRules, entitlement, match] = await Promise.all([
    resolveReferenceAccess(client, row?.orgId ?? null),
    row?.orgId ? loadSeasonGameRules(client, row.orgId, seasonYear) : Promise.resolve(undefined),
    row?.orgId
      ? client.query<{ planCode: string | null }>(
          `SELECT plan_code AS "planCode" FROM org_entitlements WHERE org_id = $1::uuid LIMIT 1`,
          [row.orgId],
        )
      : Promise.resolve({ rows: [] as Array<{ planCode: string | null }> }),
    row?.eventKey && teamKeyEarly
      ? client.query<{
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
                 AND ${matchStillAheadSql("m")}
               ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
               LIMIT 1`,
          input.matchKey ? [row.eventKey, input.matchKey] : [row.eventKey, teamKeyEarly],
        )
      : Promise.resolve({
          rows: [] as Array<{
            matchKey: string;
            compLevel: string;
            matchNumber: number;
            year: number | null;
            redAlliance: unknown;
            blueAlliance: unknown;
          }>,
        }),
  ]);
  const planCode = entitlement.rows[0]?.planCode?.trim().toLowerCase() || "free";
  const enginePolicy = selectStrategyEngine(planCode);
  const engine = toEngineSummary(enginePolicy, planCode);

  const baseSteps = [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Pick which FRC team you are working as.",
      href: "/workspace",
      done: Boolean(row?.orgId),
    },
    {
      id: "event",
            label: "Set active event",
      detail: "Set the active competition context",
      href: "/workspace",
      done: Boolean(row?.eventKey),
    },
    {
      id: "tba",
      label: "Sync Team Data",
      detail: access.platformEnvKey
        ? "A Team Data key is set — rankings can sync"
        : access.credentialAvailable
          ? "A Team Data key is saved — tap Sync under Team → Data"
          : access.cacheHasSync
            ? "Saved rankings from an earlier sync"
            : "Connect Team Data, then sync",
      href: dataHref,
      done: access.tbaConfigured,
    },
    {
      id: "statbotics",
      label: "Sync ratings",
      detail: access.statbotics.cacheHasMetrics
        ? `${access.statbotics.eventMetricRows} event + ${access.statbotics.yearMetricRows} year rating rows saved`
        : "No ratings saved yet — tap Sync under Team → Data. Strategy can still use cached official-record numbers when they exist.",
      href: dataHref,
      done: access.statbotics.cacheHasMetrics,
    },
  ];

  if (!row?.orgId) {
    return setupPayload(access, {
      status: "setup_required",
      message: "Choose your team before running win/loss strategy.",
      steps: baseSteps,
      orgId: null,
      eventKey: null,
      eventName: null,
      teamNumber: null,
      engine,
      productVersion: VANTAGE_PRODUCT_VERSION,
    });
  }

  if (!row.eventKey || !row.teamNumber) {
    return setupPayload(
      access,
      {
        status: "setup_required",
        message: "Set your active event and team number to load a match schedule.",
        steps: baseSteps,
        orgId: row.orgId,
        eventKey: row.eventKey,
        eventName: row.eventName,
        teamNumber: row.teamNumber,
        actorRole: row.role,
        engine,
        productVersion: VANTAGE_PRODUCT_VERSION,
      },
      gameRules,
    );
  }

  const teamKey = teamKeyEarly!;
  const upcoming = match.rows[0];
  if (!upcoming) {
    const message = !access.tbaConfigured
      ? EMPTY_PREDICTION_NO_SCHEDULE_SETUP_COPY
      : EMPTY_PREDICTION_NO_SCHEDULE_COPY;
    // Nothing ahead: name the last match we played so the tab can offer to review it.
    const last = input.matchKey
      ? null
      : (
          await client.query<{ matchKey: string; compLevel: string; matchNumber: number }>(
            `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber"
             FROM matches_ref m
             WHERE m.event_key = $1
               AND (m.red_alliance->'teamKeys' ? $2 OR m.blue_alliance->'teamKeys' ? $2)
             ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time) DESC NULLS LAST, m.match_number DESC
             LIMIT 1`,
            [row.eventKey, teamKey],
          )
        ).rows[0] ?? null;
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
      actorRole: row.role,
      lastMatch: last,
      engine,
      productVersion: VANTAGE_PRODUCT_VERSION,
    }, gameRules);
  }

  const red = allianceKeys(upcoming.redAlliance);
  const blue = allianceKeys(upcoming.blueAlliance);
  const allTeams = [...new Set([...red, ...blue])];
  if (red.length < 1 || blue.length < 1) {
    return setupPayload(access, {
      status: "empty",
      message: "Match alliances are incomplete in the synced schedule. Wait for a sync or pick another match.",
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      actorRole: row.role,
      engine,
      productVersion: VANTAGE_PRODUCT_VERSION,
    }, gameRules);
  }

  const year = upcoming.year ?? new Date().getFullYear();
  // Ratings, scouting, history, the field, and pick lists need the match's
  // teams and nothing else from each other.
  const [
    metricsResult,
    eventScoring,
    yearMetricsResult,
    seasonScales,
    scoutLoaded,
    matchHistory,
    fieldResult,
    pickLists,
  ] = await Promise.all([
    client.query<{
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
    ),
    readEventScoring(client, row.eventKey!),
    client.query<{
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
      [allTeams, year - (MAX_SEASONS_COUNTED - 1), year],
    ),
    loadSeasonScales(client, year),
    loadScoutOperations(client, row.orgId, row.eventKey!, allTeams),
    client.query<{
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
    ),
    client.query<{ teamKey: string; epaTotal: number | null; matches: number | null }>(
      `SELECT DISTINCT ON (team_key)
          team_key AS "teamKey",
          epa_total AS "epaTotal",
          NULLIF((source_payload->>'matches')::int, 0) AS matches
       FROM team_event_metrics
       WHERE event_key = $1
       ORDER BY team_key,
         CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
         synced_at DESC NULLS LAST`,
      [row.eventKey],
    ),
    client.query<{
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
    ),
  ]);

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

  // What each robot has scored at this event, from the played quals. A robot Statbotics has not
  // rated is rated by that instead of being left out: without it, an event with no Statbotics
  // numbers (every event in production today) had no prediction at all.
  const hasEpa = new Set(metricRows.filter((metric) => metric.epaTotal != null).map((metric) => metric.teamKey));
  for (const robot of eventScoring.opr) {
    if (hasEpa.has(robot.teamKey) || !allTeams.includes(robot.teamKey)) continue;
    // Replace the robot's TBA row (OPR stored, EPA null) rather than adding a second row behind
    // it: the matchup brief reads a robot's first row, so the rating the prediction used has to
    // be the row it finds. Its record and rank come along.
    const at = metricRows.findIndex((metric) => metric.teamKey === robot.teamKey);
    const previous = at >= 0 ? metricRows[at] : undefined;
    const fromOpr: EventMetricRow = {
      teamKey: robot.teamKey,
      year,
      eventKey: row.eventKey!,
      source: "event-opr",
      epaTotal: robot.total,
      epaAuto: robot.auto,
      epaEndgame: robot.endgame,
      wins: previous?.wins ?? null,
      losses: previous?.losses ?? null,
      ties: previous?.ties ?? null,
      rank: previous?.rank ?? null,
      // How many quals the OPR rests on; the TBA record would count the same matches.
      matches: robot.matches,
      syncedAt: previous?.syncedAt ?? null,
    };
    if (at >= 0) metricRows[at] = fromOpr;
    else metricRows.push(fromOpr);
  }

  // Season-long year ratings for up to ten seasons — prefer Statbotics when both sources exist.
  // Older seasons count for little (season-weight.ts) and are read on this season's scale.
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
          ? EMPTY_PREDICTION_COPY
          : EMPTY_PREDICTION_NO_RATINGS_COPY
        : EMPTY_PREDICTION_SETUP_COPY,
      steps: baseSteps,
      orgId: row.orgId,
      eventKey: row.eventKey,
      eventName: row.eventName,
      teamNumber: row.teamNumber,
      engine,
      productVersion: VANTAGE_PRODUCT_VERSION,
    }, gameRules);
  }

  const ourAlliance: Alliance = red.includes(teamKey) ? "red" : "blue";
  const opponentKeys = ourAlliance === "red" ? blue : red;
  const { operations, opponentFoulRisk, provenance: scoutProvenance } = scoutLoaded;

  const opponentOps = operations.filter((op) => opponentKeys.includes(op.teamKey));
  let foulForPlaybook = opponentFoulRisk;
  if (opponentOps.length) {
    const rates = opponentOps.map((op) => op.foulRate ?? 0);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    foulForPlaybook =
      avg >= 1.5 ? "high" : avg >= 0.5 ? "medium" : rates.some((r) => r > 0) ? "low" : "unknown";
  }

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

  // Small-sample correction needs a field, and the field is the event — not the
  // six robots in this match. A rookie who drew two strong alliances tops the
  // rankings on Friday morning, and without this every pick list built that
  // morning inherits the mistake.
  const fieldSamples = fieldResult.rows
    .filter((metric) => metric.epaTotal != null && Number(metric.matches ?? 0) > 0)
    .map((metric) => ({
      teamKey: metric.teamKey,
      rating: Number(metric.epaTotal),
      matches: Number(metric.matches),
    }));
  const fieldMiddle = fieldCentre(fieldSamples.map((sample) => sample.rating));
  // Below a real field there is nothing to regress toward, and shrinking a
  // handful of teams toward their own average only makes them look alike.
  const shrink =
    fieldMiddle != null && fieldSamples.length >= MIN_FIELD_SIZE
      ? { centre: fieldMiddle, k: shrinkageConstant(fieldSamples).k }
      : undefined;

  const predictionInput = {
    matchKey: upcoming.matchKey,
    currentYear: year,
    eventLabel: row.eventName ?? row.eventKey,
    red,
    blue,
    seasons,
    operations,
    matchResults,
    engineId: enginePolicy.engineId,
    shrink,
    seasonScales,
    eventScoringLevel: eventScoring.averageAllianceScore,
  };

  const prediction = predictMatch(predictionInput);
  const allianceBreakdown = buildAllianceWinBreakdown(predictionInput);

  let playbook: StrategyPlaybookView = buildStrategyPlaybook({
    prediction,
    ourAlliance,
    opponentFoulRisk: foulForPlaybook,
  });

  const leverTeamKey = `frc${row.teamNumber}`;
  // What the drive team could actually change. Derived from the same ratings the
  // prediction above used, so the advice and the number can never disagree.
  const ourSide = ourAlliance === "red" ? allianceBreakdown.red : allianceBreakdown.blue;
  const theirSide = ourAlliance === "red" ? allianceBreakdown.blue : allianceBreakdown.red;
  const levers = winLevers({
    teamKey: leverTeamKey,
    currentYear: year,
    seasons,
    operational: operations.find((op) => op.teamKey === leverTeamKey),
    partnerRating: ourSide
      .filter((contribution) => contribution.teamKey !== leverTeamKey)
      .reduce((total, contribution) => total + contribution.rating, 0),
    opponents: theirSide.map((contribution) => ({
      teamKey: contribution.teamKey,
      rating: contribution.rating,
    })),
    engineId: enginePolicy.engineId,
    seasonScales,
  });

  // This match's plan from its own levers and scouting; the engine's fixed lines become tips.
  const specificPlan = matchSpecificPlan({
    levers,
    ourTeamKey: leverTeamKey,
    partners: ourSide.map((contribution) => contribution.teamKey).filter((teamKey) => teamKey !== leverTeamKey),
    opponents: theirSide.map((contribution) => contribution.teamKey),
    operations,
    ourRatings: ourSide.map((contribution) => ({ teamKey: contribution.teamKey, rating: contribution.rating })),
  });
  if (specificPlan.length) {
    playbook = { ...playbook, priorities: specificPlan, generalTips: playbook.priorities };
  }

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
    engineId: enginePolicy.engineId,
    engineTier: enginePolicy.tier,
    planCode,
    scoutSample: operations.reduce((sum, op) => sum + op.scoutSample, 0),
    scoutEntryIds: [...new Set(operations.flatMap((op) => op.scoutEntryIds ?? []))].slice(0, 48),
    scoutProvenanceSummary: formatScoutProvenance(scoutProvenance, 10),
    qualityNotes: operations.flatMap((op) => op.qualityNotes ?? []).slice(0, 8),
    sources: [...new Set(sources.map((item) => item.source))],
    yearSignalCount: yearMetricRows.filter((metric) => metric.epaTotal != null).length,
    eventSignalCount: metricRows.filter((metric) => metric.epaTotal != null).length,
    productVersion: VANTAGE_PRODUCT_VERSION,
  };

  const scoredAt = new Date().toISOString();
  // Paint skips the save, the engineering links, and Private Edge. Those are a
  // chain of writes. The page already has the prediction. A later save (the
  // explicit recompute, or readOnly left false) stores it for Home and the pit TV.
  let engineeringContext: StrategyEngineeringContext[] = [];
  let privateEdge: PrivateEdgeView | undefined;
  if (!input.readOnly) {
  // Stored for the team (briefing, pit TV, Home) when the viewer may write predictions. A scout
  // may not (RLS), and the whole view failed for them with "Choose your team": the strategy is
  // still computed and shown, only not saved.
  await withSavepoint(
    client,
    async () => {
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
    },
    undefined,
  );

  // Deploys may briefly run before the cross-feature graph migration lands, so
  // this read is optional — under a savepoint, because the plain catch aborted
  // the transaction and took Private Edge and everything after it down too.
  engineeringContext = await withSavepoint(
    client,
    async () =>
      (
        await client.query<StrategyEngineeringContext>(
        `SELECT j.id AS "jobId",j.title,j.status,j.platform,
                COALESCE(j.brief->'requirements','[]'::jsonb) AS requirements,
                COALESCE(j.brief->'constraints','[]'::jsonb) AS constraints,
                COALESCE(j.brief->'risks','[]'::jsonb) AS risks,
                CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id',a.id,'type',a.type,'title',a.title,'version',a.version
                ) END AS "latestArtifact",
                j.updated_at::text AS "updatedAt"
         FROM feature_context_links l
         JOIN cad_jobs j ON j.org_id=l.org_id AND j.id::text=l.target_id
           AND l.target_kind='cad_job'
         LEFT JOIN LATERAL (
           SELECT id,type,title,version FROM cad_artifacts
           WHERE org_id=j.org_id AND job_id=j.id AND type<>'engineering_brief'
           ORDER BY created_at DESC LIMIT 1
         ) a ON true
         WHERE l.org_id=$1 AND l.source_kind='strategy_match' AND l.source_id=$2
         ORDER BY j.updated_at DESC LIMIT 6`,
          [row.orgId, upcoming.matchKey],
        )
      ).rows,
    [],
  );

  const ourTeamKey = `frc${row.teamNumber}`;
  const publicEpaByTeam = new Map(metricRows.map((metric) => [metric.teamKey, metric.epaTotal]));
  // Private Edge is the optional half of the strategy view. Savepointed so a
  // failure there costs the Edge panel and not the whole match strategy screen —
  // the bare catch left the transaction aborted, and everything the caller read
  // afterwards came back empty on a competition day.
  privateEdge = await withSavepoint(
    client,
    () =>
      computePrivateEdgeView(client, {
        orgId: row.orgId,
        eventKey: row.eventKey!,
        matchKey: upcoming.matchKey,
        ourTeamKey,
        ourAlliance,
        red,
        blue,
        operations,
        publicEpaByTeam,
      }),
    undefined,
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
    levers,
    playbook,
    matchup,
    tendencies,
    pickListHints,
    teamTrends: Object.fromEntries(
      allTeams.map((teamKey) => {
        const trend = teamTrend(
          yearMetricRows
            .filter((metric) => metric.teamKey === teamKey && metric.epaTotal != null)
            .map((metric) => ({ year: metric.year, epa: Number(metric.epaTotal), matches: metric.matches })),
          seasonScales,
          year,
          `Team ${teamKey.replace(/^frc/, "")}`,
        );
        return [teamKey, { direction: trend.direction, lines: trend.lines }];
      }),
    ),
    scoutProvenance: scoutProvenance.slice(0, 80),
    operations,
    engineeringContext,
    gameRules: gameRules!,
    privateEdge,
    sources,
    computedAt: scoredAt,
    engine,
    productVersion: VANTAGE_PRODUCT_VERSION,
  };
}
