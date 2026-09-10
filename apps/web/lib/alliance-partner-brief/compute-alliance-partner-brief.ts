import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { buildEvidenceNote, buildPartnerStrengths, classifyPartnerRole, PARTNER_ROLE_LABEL } from ".";
import type {
  AllianceBriefSummary,
  AllianceOption,
  AlliancePartnerBriefSetupStep,
  AlliancePartnerBriefView,
  PartnerAnalysis,
  PartnerEpa,
} from "./types";

export type { AlliancePartnerBriefView } from "./types";

type AllianceSlot = {
  seed: number;
  captainTeamKey: string | null;
  firstPickTeamKey: string | null;
  secondPickTeamKey: string | null;
};

function normalizeAlliances(raw: unknown): AllianceSlot[] {
  if (!raw || typeof raw !== "object") return [];
  const alliances = (raw as { alliances?: unknown }).alliances;
  if (!Array.isArray(alliances)) return [];
  return alliances.map((slot, index) => {
    const value = (slot ?? {}) as Partial<AllianceSlot>;
    return {
      seed: typeof value.seed === "number" ? value.seed : index + 1,
      captainTeamKey: typeof value.captainTeamKey === "string" ? value.captainTeamKey : null,
      firstPickTeamKey: typeof value.firstPickTeamKey === "string" ? value.firstPickTeamKey : null,
      secondPickTeamKey: typeof value.secondPickTeamKey === "string" ? value.secondPickTeamKey : null,
    };
  });
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

function setupSteps(orgId: string | null): AlliancePartnerBriefSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Alliance-Partner Brief.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "alliance-board",
      label: "Run alliance selection",
      detail: "Build and finalize picks on an alliance board.",
      href: withOrgHref("/strategy/draft", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

function setupRequiredView(message: string, orgId: string | null, eventKey: string | null): AlliancePartnerBriefView {
  return {
    status: "setup_required",
    message,
    steps: setupSteps(orgId),
    orgId,
    eventKey,
  };
}

type BoardRow = { id: string; name: string; eventKey: string; state: unknown };

async function loadLatestBoard(client: PoolClient, orgId: string, eventKey: string | null): Promise<BoardRow | null> {
  const result = await client.query<BoardRow>(
    `SELECT id, name, event_key AS "eventKey", state
     FROM alliance_boards
     WHERE org_id = $1 AND ($2::text IS NULL OR event_key = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, eventKey],
  );
  return result.rows[0] ?? null;
}

type MetricsRow = {
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
};

type TeamRow = { teamKey: string; teamNumber: number | null; nickname: string | null };

async function loadPartnerAnalyses(
  client: PoolClient,
  input: { orgId: string; eventKey: string; slots: Array<{ teamKey: string; slot: PartnerAnalysis["slot"] }> },
): Promise<PartnerAnalysis[]> {
  if (!input.slots.length) return [];
  const teamKeys = input.slots.map((s) => s.teamKey);

  const [teamResult, metricsResult, matchScoutResult, pitScoutResult] = await Promise.all([
    client.query<TeamRow>(
      `SELECT team_key AS "teamKey", team_number AS "teamNumber", nickname
       FROM teams_ref WHERE team_key = ANY($1::text[])`,
      [teamKeys],
    ),
    client.query<MetricsRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey", epa_total AS "epaTotal", epa_auto AS "epaAuto",
              epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame", rank, wins, losses, ties, source
       FROM team_event_metrics
       WHERE event_key = $1 AND team_key = ANY($2::text[])
       ORDER BY team_key, (source = 'tba') DESC, synced_at DESC`,
      [input.eventKey, teamKeys],
    ),
    client.query<{ teamKey: string; count: string }>(
      `SELECT team_key AS "teamKey", COUNT(*)::text AS count
       FROM match_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
       GROUP BY team_key`,
      [input.orgId, input.eventKey, teamKeys],
    ),
    client.query<{ teamKey: string; count: string }>(
      `SELECT team_key AS "teamKey", COUNT(*)::text AS count
       FROM pit_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
       GROUP BY team_key`,
      [input.orgId, input.eventKey, teamKeys],
    ),
  ]);

  const teamByKey = new Map<string, TeamRow>();
  for (const row of teamResult.rows) teamByKey.set(row.teamKey, row);
  const metricsByKey = new Map<string, MetricsRow>();
  for (const row of metricsResult.rows) metricsByKey.set(row.teamKey, row);
  const matchScoutByKey = new Map<string, number>();
  for (const row of matchScoutResult.rows) matchScoutByKey.set(row.teamKey, Number(row.count) || 0);
  const pitScoutByKey = new Map<string, number>();
  for (const row of pitScoutResult.rows) pitScoutByKey.set(row.teamKey, Number(row.count) || 0);

  return input.slots.map(({ teamKey, slot }) => {
    const team = teamByKey.get(teamKey) ?? null;
    const metricsRow = metricsByKey.get(teamKey) ?? null;
    const epa: PartnerEpa | null = metricsRow
      ? {
          epaTotal: metricsRow.epaTotal,
          epaAuto: metricsRow.epaAuto,
          epaTeleop: metricsRow.epaTeleop,
          epaEndgame: metricsRow.epaEndgame,
          rank: metricsRow.rank,
          wins: Number(metricsRow.wins) || 0,
          losses: Number(metricsRow.losses) || 0,
          ties: Number(metricsRow.ties) || 0,
          source: metricsRow.source,
        }
      : null;
    const matchScoutEntryCount = matchScoutByKey.get(teamKey) ?? 0;
    const pitScoutEntryCount = pitScoutByKey.get(teamKey) ?? 0;
    const role = classifyPartnerRole(epa);
    return {
      teamKey,
      teamNumber: team?.teamNumber ?? null,
      nickname: team?.nickname ?? null,
      slot,
      role,
      roleLabel: PARTNER_ROLE_LABEL[role],
      strengths: buildPartnerStrengths(epa, matchScoutEntryCount, pitScoutEntryCount),
      epa,
      matchScoutEntryCount,
      pitScoutEntryCount,
      evidenceNote: buildEvidenceNote(epa, matchScoutEntryCount, pitScoutEntryCount),
    };
  });
}

function allianceOptions(slots: AllianceSlot[], ourTeamKey: string | null): AllianceOption[] {
  return slots.map((slot) => ({
    seed: slot.seed,
    captainTeamKey: slot.captainTeamKey,
    firstPickTeamKey: slot.firstPickTeamKey,
    secondPickTeamKey: slot.secondPickTeamKey,
    isOurAlliance: ourTeamKey != null
      ? [slot.captainTeamKey, slot.firstPickTeamKey, slot.secondPickTeamKey].includes(ourTeamKey)
      : false,
  }));
}

async function loadSavedBrief(
  client: PoolClient,
  input: { orgId: string; eventKey: string; allianceSeed: number },
): Promise<AllianceBriefSummary | null> {
  const result = await client.query<{
    id: string;
    ourTeamKey: string;
    partnerTeamKeys: string[];
    partners: PartnerAnalysis[];
    updatedAt: string;
  }>(
    `SELECT id, our_team_key AS "ourTeamKey", partner_team_keys AS "partnerTeamKeys",
            partners, updated_at::text AS "updatedAt"
     FROM alliance_partner_brief_briefs
     WHERE org_id = $1 AND event_key = $2 AND alliance_seed = $3`,
    [input.orgId, input.eventKey, input.allianceSeed],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    eventKey: input.eventKey,
    allianceSeed: input.allianceSeed,
    ourTeamKey: row.ourTeamKey,
    partnerTeamKeys: row.partnerTeamKeys,
    partners: row.partners,
    generatedAt: row.updatedAt,
  };
}

export async function computeAlliancePartnerBriefView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null; allianceSeed?: number | null },
): Promise<AlliancePartnerBriefView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return setupRequiredView("Select a team workspace to generate an alliance-partner brief.", null, null);
  }

  const board = await loadLatestBoard(client, org.orgId, input.eventKey ?? null);
  if (!board) {
    return setupRequiredView(
      "Run alliance selection on an alliance board before generating a partner brief.",
      org.orgId,
      input.eventKey ?? null,
    );
  }

  const slots = normalizeAlliances(board.state);
  const ourTeamKey = org.teamNumber ? `frc${org.teamNumber}` : null;
  const options = allianceOptions(slots, ourTeamKey);
  const selectedSeed =
    input.allianceSeed && options.some((o) => o.seed === input.allianceSeed)
      ? input.allianceSeed
      : (options.find((o) => o.isOurAlliance)?.seed ?? null);

  const eventNameResult = await client.query<{ name: string }>(
    `SELECT name FROM events_ref WHERE event_key = $1`,
    [board.eventKey],
  );
  const eventName = eventNameResult.rows[0]?.name ?? null;

  const brief = selectedSeed
    ? await loadSavedBrief(client, { orgId: org.orgId, eventKey: board.eventKey, allianceSeed: selectedSeed })
    : null;

  return {
    status: "live",
    orgId: org.orgId,
    eventKey: board.eventKey,
    eventName,
    allianceBoardId: board.id,
    allianceBoardName: board.name,
    ourTeamKey,
    alliances: options,
    selectedSeed,
    brief,
    computedAt: new Date().toISOString(),
  };
}

/** Metered: builds (and upserts) the partner brief for one alliance seed on the latest board. */
export async function generateAlliancePartnerBrief(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey?: string | null; allianceSeed: number },
): Promise<AlliancePartnerBriefView> {
  const board = await loadLatestBoard(client, input.orgId, input.eventKey ?? null);
  if (!board) throw new Error("No alliance board found for this workspace");

  const slots = normalizeAlliances(board.state);
  const slot = slots.find((s) => s.seed === input.allianceSeed);
  if (!slot) throw new Error("Alliance seed not found on this board");

  const orgResult = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1`,
    [input.orgId],
  );
  const ourTeamKey = orgResult.rows[0]?.teamNumber ? `frc${orgResult.rows[0]!.teamNumber}` : null;

  const memberTeamKeys: Array<{ teamKey: string; slot: PartnerAnalysis["slot"] }> = [
    { teamKey: slot.captainTeamKey, slot: "captain" as const },
    { teamKey: slot.firstPickTeamKey, slot: "first" as const },
    { teamKey: slot.secondPickTeamKey, slot: "second" as const },
  ]
    .filter((entry): entry is { teamKey: string; slot: PartnerAnalysis["slot"] } => Boolean(entry.teamKey))
    .filter((entry) => entry.teamKey !== ourTeamKey);

  if (!memberTeamKeys.length) {
    throw new Error("This alliance has no partner teams to brief yet");
  }

  const requestId = `alliance-partner-brief-${randomUUID()}`;

  const partners = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "alliance-partner-brief",
    requestId,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      eventKey: board.eventKey,
      allianceSeed: input.allianceSeed,
      partnerCount: memberTeamKeys.length,
      note: "Deterministic source-cited role/strength synthesis from event metrics + scouting — no external model charge",
    },
    invoke: async () => {
      const value = await loadPartnerAnalyses(client, { orgId: input.orgId, eventKey: board.eventKey, slots: memberTeamKeys });
      return {
        value,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-alliance-partner-brief-v1",
        provider: "vantage-local",
      };
    },
  });

  const partnerTeamKeys = memberTeamKeys.map((m) => m.teamKey);

  await client.query(
    `INSERT INTO alliance_partner_brief_briefs
       (org_id, event_key, alliance_board_id, alliance_seed, our_team_key, partner_team_keys,
        partners, ai_request_id, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7::jsonb,$8,$9)
     ON CONFLICT (org_id, event_key, alliance_seed) DO UPDATE SET
       alliance_board_id = excluded.alliance_board_id,
       our_team_key = excluded.our_team_key,
       partner_team_keys = excluded.partner_team_keys,
       partners = excluded.partners,
       ai_request_id = excluded.ai_request_id,
       generated_by = excluded.generated_by,
       updated_at = now()`,
    [
      input.orgId,
      board.eventKey,
      board.id,
      input.allianceSeed,
      ourTeamKey ?? partnerTeamKeys[0],
      partnerTeamKeys,
      JSON.stringify(partners),
      requestId,
      input.userId,
    ],
  );

  return computeAlliancePartnerBriefView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    eventKey: board.eventKey,
    allianceSeed: input.allianceSeed,
  });
}
