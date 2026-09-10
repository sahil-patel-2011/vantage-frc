import type { PoolClient } from "@neondatabase/serverless";
import { alliancePartners, resolveOwnAllianceColor, selectNextTbaMatch, teamNumbersFromAllianceJson } from ".";
import { toBriefingMatchCardPayload, type MatchStrategyBriefingPayload } from "./briefing-payload";
import type { MatchStrategyAlliance, MatchStrategyCard, MatchStrategyRoleAssignment } from "./types";

export type MatchStrategySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
};

export type MatchStrategyCardsView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchStrategySetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number;
      eventKey: string;
      eventName: string | null;
      cards: MatchStrategyCard[];
      nextMatchKey: string | null;
      briefingPayload: MatchStrategyBriefingPayload | null;
      computedAt: string;
    };

async function resolveOrgContext(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; eventKey: string | null; eventName: string | null } | null> {
  const result = await client.query<{
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
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

type MatchRow = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  setNumber: number;
  eventKey: string;
  scheduledAt: string | null;
  actualTime: string | null;
  winningAlliance: string | null;
  redAlliance: unknown;
  blueAlliance: unknown;
};

type CardRow = {
  matchKey: string;
  gamePlan: string | null;
  autoAssignment: string | null;
  defenseFocus: string | null;
  keyThreats: string | null;
  driverNotes: string | null;
  roleAssignments: unknown;
  updatedAt: string | null;
};

function buildAlliances(row: MatchRow, teamNumber: number): MatchStrategyAlliance[] {
  const red = teamNumbersFromAllianceJson(row.redAlliance);
  const blue = teamNumbersFromAllianceJson(row.blueAlliance);
  return [
    { color: "red", teamNumbers: red, isOwnAlliance: red.includes(teamNumber) },
    { color: "blue", teamNumbers: blue, isOwnAlliance: blue.includes(teamNumber) },
  ];
}

function mapRoleAssignments(value: unknown): MatchStrategyRoleAssignment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { role: unknown; assignee: unknown } => typeof v === "object" && v !== null)
    .map((v) => ({
      role: typeof v.role === "string" ? v.role : "",
      assignee: typeof v.assignee === "string" ? v.assignee : "",
    }))
    .filter((r) => r.role || r.assignee);
}

export async function computeMatchStrategyCardsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchStrategyCardsView> {
  const context = await resolveOrgContext(client, input.userId, input.requestedOrg);

  const baseSteps: MatchStrategySetupStep[] = [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Pick which FRC team you are working as.",
      href: "/workspace",
      done: Boolean(context?.orgId),
    },
    {
      id: "event",
      label: "Select event",
      detail: "Set the active competition context",
      href: "/workspace",
      done: Boolean(context?.eventKey),
    },
    {
      id: "schedule",
      label: "Sync match schedule",
      detail: "Sync TBA reference data so matches appear here",
      href: "/team/data",
      done: false,
    },
  ];

  if (!context?.orgId) {
    return {
      status: "setup_required",
      message: "Select a team to build printable match strategy cards.",
      steps: baseSteps,
      orgId: null,
      eventKey: null,
    };
  }

  if (!context.eventKey || !context.teamNumber) {
    return {
      status: "setup_required",
      message: "Select an active event and confirm your team number to load the match schedule.",
      steps: baseSteps,
      orgId: context.orgId,
      eventKey: context.eventKey,
    };
  }

  const teamKey = `frc${context.teamNumber}`;
  const matchResult = await client.query<MatchRow>(
    `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
            m.set_number AS "setNumber", m.event_key AS "eventKey",
            COALESCE(m.predicted_time, m.event_time, m.actual_time)::text AS "scheduledAt",
            m.actual_time::text AS "actualTime", m.winning_alliance AS "winningAlliance",
            m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
     FROM matches_ref m
     WHERE m.event_key = $1
       AND (
         COALESCE(m.red_alliance->'teamKeys', '[]'::jsonb) ? $2
         OR COALESCE(m.blue_alliance->'teamKeys', '[]'::jsonb) ? $2
         OR COALESCE(m.red_alliance->'team_keys', '[]'::jsonb) ? $2
         OR COALESCE(m.blue_alliance->'team_keys', '[]'::jsonb) ? $2
       )
     ORDER BY COALESCE(m.predicted_time, m.event_time, m.actual_time) NULLS LAST, m.match_number`,
    [context.eventKey, teamKey],
  );

  if (matchResult.rowCount === 0) {
    return {
      status: "setup_required",
      message: "No matches found for your team at the active event yet. Sync the schedule from TBA.",
      steps: baseSteps.map((step) => (step.id === "schedule" ? { ...step, done: false } : step)),
      orgId: context.orgId,
      eventKey: context.eventKey,
    };
  }

  const cardResult = await client.query<CardRow>(
    `SELECT match_key AS "matchKey", game_plan AS "gamePlan", auto_assignment AS "autoAssignment",
            defense_focus AS "defenseFocus", key_threats AS "keyThreats", driver_notes AS "driverNotes",
            role_assignments AS "roleAssignments", updated_at::text AS "updatedAt"
     FROM match_strategy_cards
     WHERE org_id = $1 AND event_key = $2`,
    [context.orgId, context.eventKey],
  );
  const cardsByMatch = new Map(cardResult.rows.map((row) => [row.matchKey, row]));

  const nextMatchKey = selectNextTbaMatch(matchResult.rows);
  const mapped: MatchStrategyCard[] = matchResult.rows.map((row) => {
    const alliances = buildAlliances(row, context.teamNumber as number);
    const existing = cardsByMatch.get(row.matchKey);
    return {
      id: existing ? row.matchKey : `unsaved:${row.matchKey}`,
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      matchNumber: row.matchNumber,
      setNumber: row.setNumber,
      eventKey: row.eventKey,
      scheduledAt: row.scheduledAt,
      alliances,
      ownAllianceColor: resolveOwnAllianceColor(alliances),
      gamePlan: existing?.gamePlan ?? null,
      autoAssignment: existing?.autoAssignment ?? null,
      defenseFocus: existing?.defenseFocus ?? null,
      keyThreats: existing?.keyThreats ?? null,
      driverNotes: existing?.driverNotes ?? null,
      roleAssignments: mapRoleAssignments(existing?.roleAssignments),
      hasCard: Boolean(existing),
      isNextMatch: row.matchKey === nextMatchKey,
      updatedAt: existing?.updatedAt ?? null,
    };
  });
  const cards =
    nextMatchKey == null
      ? mapped
      : [...mapped.filter((card) => card.isNextMatch), ...mapped.filter((card) => !card.isNextMatch)];
  const nextCard = cards.find((card) => card.isNextMatch) ?? null;
  const briefingPayload = nextCard
    ? toBriefingMatchCardPayload({
        matchKey: nextCard.matchKey,
        partnerNumbers: alliancePartners(nextCard.alliances, context.teamNumber as number),
        gamePlan: nextCard.gamePlan,
        autoAssignment: nextCard.autoAssignment,
        defenseFocus: nextCard.defenseFocus,
        keyThreats: nextCard.keyThreats,
        driverNotes: nextCard.driverNotes,
        roleAssignments: nextCard.roleAssignments,
        updatedAt: nextCard.updatedAt,
        hasCard: nextCard.hasCard,
      })
    : null;

  return {
    status: "live",
    orgId: context.orgId,
    teamNumber: context.teamNumber,
    eventKey: context.eventKey,
    eventName: context.eventName,
    cards,
    nextMatchKey,
    briefingPayload,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertCard(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    matchKey: string;
    eventKey: string;
    gamePlan: string | null;
    autoAssignment: string | null;
    defenseFocus: string | null;
    keyThreats: string | null;
    driverNotes: string | null;
    roleAssignments: MatchStrategyRoleAssignment[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO match_strategy_cards (
       org_id, match_key, event_key, game_plan, auto_assignment, defense_focus,
       key_threats, driver_notes, role_assignments, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)
     ON CONFLICT (org_id, match_key) DO UPDATE SET
       game_plan = EXCLUDED.game_plan,
       auto_assignment = EXCLUDED.auto_assignment,
       defense_focus = EXCLUDED.defense_focus,
       key_threats = EXCLUDED.key_threats,
       driver_notes = EXCLUDED.driver_notes,
       role_assignments = EXCLUDED.role_assignments,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      input.matchKey,
      input.eventKey,
      input.gamePlan,
      input.autoAssignment,
      input.defenseFocus,
      input.keyThreats,
      input.driverNotes,
      JSON.stringify(input.roleAssignments),
      input.userId,
    ],
  );
}

export async function deleteCard(
  client: PoolClient,
  input: { orgId: string; matchKey: string },
): Promise<void> {
  await client.query(`DELETE FROM match_strategy_cards WHERE org_id = $1 AND match_key = $2`, [
    input.orgId,
    input.matchKey,
  ]);
}
