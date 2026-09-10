import type { PoolClient } from "@neondatabase/serverless";
import { deriveFoulRisk, deriveReliability } from "@vantage/intel-research";
import {
  blendPrivateEpa,
  detectPickDataMode,
  deriveScoutCapabilities,
  rankPickCandidates,
  type PickCandidate,
  type PickDataMode,
  type PickTier,
} from "@vantage/prediction-strategy";
import { observationsForStrategyTrust } from "@vantage/scouting/trust";
import type { SchemaDefinition } from "@vantage/scouting";
import { loadScoutFieldRoles } from "./scout-field-roles";
import {
  findFieldPositionFields,
  readFieldPositionHeatmap,
  type FieldPositionHeatmap,
} from "../scouting/heatmap";
import {
  buildEpaDriftCallouts,
  loadRecentAllianceShares,
  pickModeSources,
  type PickAssistDrift,
} from "./pick-assist";

export type PickDeskEntry = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  rank: number;
  tier: PickTier | string | null;
  notes: string | null;
};

export type PickDeskList = {
  id: string;
  name: string;
  eventKey: string;
  updatedAt: string | null;
  entries: PickDeskEntry[];
};

export type PickDeskView = {
  orgId: string;
  eventKey: string;
  eventName: string | null;
  teamNumber: number | null;
  canEdit: boolean;
  candidates: PickCandidate[];
  pickLists: PickDeskList[];
  sources: string[];
  /** full when scouting coverage is usable; low_data_tba for TBA/Statbotics quick pick. */
  pickMode: PickDataMode;
  pickModeReason: string | null;
  scoutedTeams: number;
  teamCount: number;
  /** Divergent last-3 alliance-share vs season EPA callouts (real matches only). */
  epaDrifts: PickAssistDrift[];
  /** Top-accurate scouts rotated into today's pick-desk conversation. */
  strategySeats: PickDeskStrategySeat[];
  /**
   * Where each team was scouted, per field_position question on the published
   * form, keyed by teamKey. Absent entirely when the form has no field_position
   * question; present-but-empty when the question exists and nobody tapped a
   * cell yet, so the team detail can say so honestly instead of inventing heat.
   */
  positionHeatByTeam?: Record<string, FieldPositionHeatmap[]>;
  /** TBA/Statbotics ingest health — pick desk keeps using Neon last-good when degraded. */
  dataSourceHealth?: import("../reference-health").DataSourceHealthView;
};

export type PickDeskStrategySeat = {
  userId: string;
  name: string;
  meetingOn: string;
  reason: string;
  isMe: boolean;
};

export async function loadPickDesk(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<
  | PickDeskView
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      eventKey: string | null;
    }
> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
    role: string;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber",
            c.active_event_key AS "eventKey", e.name AS "eventName", m.role::text AS role
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
  if (!row?.orgId) {
    return {
      status: "setup_required",
      message: "Select a team before building pick lists.",
      orgId: null,
      eventKey: null,
    };
  }
  if (!row.eventKey) {
    return {
      status: "setup_required",
      message: "Select an active event to load event teams and metrics.",
      orgId: row.orgId,
      eventKey: null,
    };
  }

  const metrics = await client.query<{
    teamKey: string;
    teamNumber: number | null;
    nickname: string | null;
    epaTotal: number | null;
    epaAuto: number | null;
    epaEndgame: number | null;
    source: string;
    wins: number | null;
    losses: number | null;
    ties: number | null;
    rank: number | null;
  }>(
    `SELECT DISTINCT ON (m.team_key)
        m.team_key AS "teamKey",
        t.team_number AS "teamNumber",
        t.nickname,
        m.epa_total AS "epaTotal",
        m.epa_auto AS "epaAuto",
        m.epa_endgame AS "epaEndgame",
        m.source,
        m.wins, m.losses, m.ties, m.rank
     FROM team_event_metrics m
     LEFT JOIN teams_ref t ON t.team_key = m.team_key
     WHERE m.event_key = $1
     ORDER BY m.team_key,
       CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
       m.synced_at DESC NULLS LAST`,
    [row.eventKey],
  );

  const teamKeys = metrics.rows.map((item) => item.teamKey);
  const scoutRows = teamKeys.length
    ? await client.query<{
        id: string;
        teamKey: string;
        payload: Record<string, unknown>;
        confidence: string | null;
      }>(
        `SELECT id, team_key AS "teamKey", payload, confidence
         FROM match_scout_entries
         WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
         ORDER BY updated_at DESC
         LIMIT 800`,
        [row.orgId, row.eventKey, teamKeys],
      )
    : {
        rows: [] as Array<{
          id: string;
          teamKey: string;
          payload: Record<string, unknown>;
          confidence: string | null;
        }>,
      };

  const { conflictCountByTeam, loadEntryValidations, trustScoutPayloads } = await import(
    "../scouting-trust"
  );
  const validations = await loadEntryValidations(
    client,
    row.orgId,
    scoutRows.rows.map((scout) => scout.id),
  );
  const trustedByEntry = trustScoutPayloads(
    scoutRows.rows.map((scout) => ({ id: scout.id, payload: scout.payload ?? {} })),
    validations,
  );
  const conflictsByTeam = conflictCountByTeam(
    validations
      .map((validation) => {
        const entry = scoutRows.rows.find((scout) => scout.id === validation.entryId);
        return entry
          ? { teamKey: entry.teamKey, fieldKey: validation.fieldKey, status: validation.status }
          : null;
      })
      .filter(
        (item): item is { teamKey: string; fieldKey: string; status: (typeof validations)[number]["status"] } =>
          Boolean(item),
      ),
  );

  // Published-schema role map so custom form-builder fields reach pick capabilities.
  const fieldRoles = await loadScoutFieldRoles(client, row.orgId, row.eventKey);

  const byTeam = new Map<
    string,
    Array<{ payload: Record<string, unknown>; confidence: "high" | "normal" | "low" }>
  >();
  for (const scout of scoutRows.rows) {
    const confidence =
      scout.confidence === "high" || scout.confidence === "low" ? scout.confidence : "normal";
    const list = byTeam.get(scout.teamKey) ?? [];
    const trusted = trustedByEntry.get(scout.id);
    list.push({ payload: trusted?.trustedPayload ?? scout.payload ?? {}, confidence });
    byTeam.set(scout.teamKey, list);
  }

  const baseCandidates = metrics.rows.map((metric) => {
    const observations = byTeam.get(metric.teamKey) ?? [];
    // Disagreement resolutions demote losing entries to low confidence; prefer trusted rows.
    const trusted = observationsForStrategyTrust(observations);
    const reliability = trusted.length ? deriveReliability(trusted) : null;
    const foulRisk = trusted.length ? deriveFoulRisk(trusted) : null;
    const capabilities = trusted.length
      ? deriveScoutCapabilities(trusted, { roles: fieldRoles })
      : null;
    const pepaRow = blendPrivateEpa({
      teamKey: metric.teamKey,
      publicEpa: metric.epaTotal,
      scout: {
        autoRate: capabilities?.autoRate ?? null,
        teleopRate: capabilities?.teleopRate ?? null,
        endgameRate: capabilities?.endgameRate ?? null,
        sampleSize: trusted.length,
      },
    });
    const hasRecord = metric.wins != null || metric.losses != null || metric.ties != null;
    const conflicts = conflictsByTeam.get(metric.teamKey);
    return {
      teamKey: metric.teamKey,
      teamNumber: metric.teamNumber,
      nickname: metric.nickname,
      epa: metric.epaTotal,
      autoEpa: metric.epaAuto,
      endgameEpa: metric.epaEndgame,
      source: metric.source,
      record: hasRecord
        ? `${metric.wins ?? 0}-${metric.losses ?? 0}-${metric.ties ?? 0}`
        : null,
      rank: metric.rank,
      scoutSample: trusted.length,
      reliability: reliability?.score ?? null,
      foulRate: foulRisk?.rate ?? null,
      pepa: pepaRow.skipped ? null : pepaRow.pepa,
      tbaConflictCount: conflicts?.conflictCount ?? 0,
      tbaConflictFields: conflicts?.conflictFields ?? [],
    };
  });

  const modeInfo = detectPickDataMode(baseCandidates);
  const candidates = rankPickCandidates(baseCandidates, { mode: modeInfo.mode });
  const recentShares = await loadRecentAllianceShares(
    client,
    row.eventKey,
    candidates.map((item) => item.teamKey),
  );
  const epaDrifts = buildEpaDriftCallouts(candidates, recentShares);

  const [lists, seats] = await Promise.all([
    client.query<{
      id: string;
      name: string;
      eventKey: string;
      updatedAt: string | null;
      entries: PickDeskEntry[] | string;
    }>(
      `SELECT l.id, l.name, l.event_key AS "eventKey", l.updated_at::text AS "updatedAt",
              COALESCE(json_agg(json_build_object(
                'teamKey', e.team_key,
                'teamNumber', t.team_number,
                'nickname', t.nickname,
                'rank', e.rank,
                'tier', e.tier,
                'notes', e.notes
              ) ORDER BY e.rank) FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
       FROM pick_lists l
       LEFT JOIN pick_list_entries e ON e.pick_list_id = l.id
       LEFT JOIN teams_ref t ON t.team_key = e.team_key
       WHERE l.org_id = $1 AND l.event_key = $2
       GROUP BY l.id
       ORDER BY l.updated_at DESC`,
      [row.orgId, row.eventKey],
    ),
    client
      .query<{ userId: string; name: string; meetingOn: string; reason: string }>(
        `SELECT s.user_id AS "userId", COALESCE(u.name, 'Team scout') AS name,
                s.meeting_on::text AS "meetingOn", s.reason
         FROM scout_strategy_seats s
         JOIN users u ON u.id = s.user_id
         WHERE s.org_id = $1 AND s.event_key = $2
           AND s.meeting_on >= (CURRENT_DATE - INTERVAL '1 day')
         ORDER BY s.meeting_on DESC, u.name ASC
         LIMIT 12`,
        [row.orgId, row.eventKey],
      )
      .catch(() => ({
        rows: [] as Array<{ userId: string; name: string; meetingOn: string; reason: string }>,
      })),
  ]);

  const baseSources = [...new Set(metrics.rows.map((item) => item.source).filter(Boolean))];

  const positionHeatByTeam = await loadPositionHeatByTeam(client, row.orgId, row.eventKey, byTeam);

  return {
    orgId: row.orgId,
    eventKey: row.eventKey,
    eventName: row.eventName,
    teamNumber: row.teamNumber,
    canEdit: row.role === "owner" || row.role === "admin",
    candidates,
    pickLists: lists.rows.map((list) => ({
      ...list,
      entries: typeof list.entries === "string" ? JSON.parse(list.entries) : list.entries,
    })),
    sources: pickModeSources(modeInfo.mode, baseSources),
    pickMode: modeInfo.mode,
    pickModeReason: modeInfo.reason,
    scoutedTeams: modeInfo.scoutedTeams,
    teamCount: modeInfo.teamCount,
    epaDrifts,
    strategySeats: seats.rows.map((seat) => ({
      ...seat,
      isMe: seat.userId === input.userId,
    })),
    ...(positionHeatByTeam ? { positionHeatByTeam } : {}),
  };
}

export type AllianceSlot = {
  seed: number;
  captainTeamKey: string | null;
  firstPickTeamKey: string | null;
  secondPickTeamKey: string | null;
};

export type AllianceBoardState = {
  alliances: AllianceSlot[];
  availableTeamKeys: string[];
  currentSeed: number;
  currentSlot: "captain" | "first" | "second";
  pickListId: string | null;
  notes: string | null;
};

export function emptyAllianceBoardState(teamKeys: string[], allianceCount = 8): AllianceBoardState {
  return {
    alliances: Array.from({ length: allianceCount }, (_, index) => ({
      seed: index + 1,
      captainTeamKey: null,
      firstPickTeamKey: null,
      secondPickTeamKey: null,
    })),
    availableTeamKeys: [...teamKeys],
    currentSeed: 1,
    currentSlot: "captain",
    pickListId: null,
    notes: null,
  };
}

export function normalizeAllianceBoardState(
  raw: unknown,
  fallbackTeamKeys: string[],
): AllianceBoardState {
  if (!raw || typeof raw !== "object") return emptyAllianceBoardState(fallbackTeamKeys);
  const value = raw as Partial<AllianceBoardState>;
  const alliances =
    Array.isArray(value.alliances) && value.alliances.length
      ? value.alliances.map((slot, index) => ({
          seed: typeof slot.seed === "number" ? slot.seed : index + 1,
          captainTeamKey: slot.captainTeamKey ?? null,
          firstPickTeamKey: slot.firstPickTeamKey ?? null,
          secondPickTeamKey: slot.secondPickTeamKey ?? null,
        }))
      : emptyAllianceBoardState(fallbackTeamKeys).alliances;
  return {
    alliances,
    availableTeamKeys: Array.isArray(value.availableTeamKeys)
      ? value.availableTeamKeys.filter((key): key is string => typeof key === "string")
      : fallbackTeamKeys,
    currentSeed: typeof value.currentSeed === "number" ? value.currentSeed : 1,
    currentSlot:
      value.currentSlot === "first" || value.currentSlot === "second" || value.currentSlot === "captain"
        ? value.currentSlot
        : "captain",
    pickListId: typeof value.pickListId === "string" ? value.pickListId : null,
    notes: typeof value.notes === "string" ? value.notes : null,
  };
}

/**
 * Per-team field-position heat for the pick-desk team detail.
 *
 * Reads only what the published match form actually declares: if no
 * field_position question exists, this returns undefined and the panel never
 * renders. If the question exists but nobody has tapped a cell, every team gets
 * an empty heatmap so the desk shows an honest "no positions recorded yet"
 * rather than a smoothed-out placeholder.
 *
 * Degrades to undefined on any lookup failure — a pick desk must never hard-fail
 * because an optional heat panel could not be built.
 */
async function loadPositionHeatByTeam(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
  byTeam: Map<string, Array<{ payload: Record<string, unknown> }>>,
): Promise<Record<string, FieldPositionHeatmap[]> | undefined> {
  if (!byTeam.size) return undefined;
  let definition: SchemaDefinition | null;
  try {
    const result = await client.query<{ schema: unknown }>(
      `SELECT schema
         FROM scout_schemas
        WHERE org_id = $1::uuid AND type = 'match'
        ORDER BY
          (year = (SELECT year FROM events_ref WHERE event_key = $2::text)) DESC NULLS LAST,
          year DESC, version DESC
        LIMIT 1`,
      [orgId, eventKey],
    );
    const raw = result.rows[0]?.schema;
    definition = raw && typeof raw === "object" ? (raw as SchemaDefinition) : null;
  } catch {
    return undefined;
  }
  const positionFields = findFieldPositionFields(definition);
  if (!positionFields.length) return undefined;

  const heatByTeam: Record<string, FieldPositionHeatmap[]> = {};
  for (const [teamKey, observations] of byTeam) {
    heatByTeam[teamKey] = positionFields.map((field) =>
      readFieldPositionHeatmap(observations, field.key, field.config, {
        fieldLabel: field.label,
      }),
    );
  }
  return heatByTeam;
}
