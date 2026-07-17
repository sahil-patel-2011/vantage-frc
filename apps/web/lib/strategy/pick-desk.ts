import type { PoolClient } from "@neondatabase/serverless";
import { deriveFoulRisk, deriveReliability } from "@vantage/intel-research";
import { rankPickCandidates, type PickCandidate, type PickTier } from "@vantage/prediction-strategy";

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
      message: "Select a team workspace before building pick lists.",
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
        teamKey: string;
        payload: Record<string, unknown>;
        confidence: string | null;
      }>(
        `SELECT team_key AS "teamKey", payload, confidence
         FROM match_scout_entries
         WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
         ORDER BY updated_at DESC
         LIMIT 800`,
        [row.orgId, row.eventKey, teamKeys],
      )
    : { rows: [] as Array<{ teamKey: string; payload: Record<string, unknown>; confidence: string | null }> };

  const byTeam = new Map<
    string,
    Array<{ payload: Record<string, unknown>; confidence: "high" | "normal" | "low" }>
  >();
  for (const scout of scoutRows.rows) {
    const confidence =
      scout.confidence === "high" || scout.confidence === "low" ? scout.confidence : "normal";
    const list = byTeam.get(scout.teamKey) ?? [];
    list.push({ payload: scout.payload ?? {}, confidence });
    byTeam.set(scout.teamKey, list);
  }

  const baseCandidates = metrics.rows.map((metric) => {
    const observations = byTeam.get(metric.teamKey) ?? [];
    const reliability = observations.length ? deriveReliability(observations) : null;
    const foulRisk = observations.length ? deriveFoulRisk(observations) : null;
    const hasRecord = metric.wins != null || metric.losses != null || metric.ties != null;
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
      scoutSample: observations.length,
      reliability: reliability?.score ?? null,
      foulRate: foulRisk?.rate ?? null,
    };
  });

  const candidates = rankPickCandidates(baseCandidates);
  const lists = await client.query<{
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
  );

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
    sources: [...new Set(metrics.rows.map((item) => item.source).filter(Boolean))],
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
