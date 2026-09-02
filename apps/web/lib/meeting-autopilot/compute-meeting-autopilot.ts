import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureValue, type RenderOutcome } from "../ai-render/render";
import { AGENDA_ITEM_KINDS, buildAgendaItems, parseActionItemsFromMinutes, summarizeAgendaSources } from ".";
import type {
  ActionItem,
  ActionItemStatus,
  AgendaItem,
  AgendaSourceCounts,
  AgendaSourceInput,
  MeetingAgenda,
  MeetingAgendaStatus,
} from "./types";

export { AGENDA_ITEM_KINDS };

export type MeetingAutopilotSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MeetingAutopilotView =
  | {
      status: "setup_required";
      message: string;
      steps: MeetingAutopilotSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      liveAgendaItems: AgendaItem[];
      sourceCounts: AgendaSourceCounts;
      agendas: MeetingAgenda[];
      actionItems: ActionItem[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isAgendaStatus(value: unknown): value is MeetingAgendaStatus {
  return value === "draft" || value === "finalized";
}

function isActionItemStatus(value: unknown): value is ActionItemStatus {
  return value === "open" || value === "done";
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

type BlockerRow = { id: string; title: string; subsystem: string; blockedReason: string | null; priority: string };
type OverdueTaskRow = { id: string; title: string; subsystem: string; dueOn: string; priority: string };
type DecisionRow = { id: string; title: string; category: string; createdAt: string };
type FmeaRow = { id: string; title: string; subsystemName: string; severity: number; occurrence: number; detection: number };

async function loadAgendaSources(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<AgendaSourceInput> {
  const [blockerResult, overdueResult, decisionResult, fmeaResult] = await Promise.all([
    client.query<BlockerRow>(
      `SELECT id, title, subsystem, blocked_reason AS "blockedReason", priority
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2 AND status = 'blocked'
       ORDER BY updated_at DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<OverdueTaskRow>(
      `SELECT id, title, subsystem, due_on::text AS "dueOn", priority
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2 AND status NOT IN ('done', 'archived')
         AND due_on IS NOT NULL AND due_on < current_date
       ORDER BY due_on ASC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<DecisionRow>(
      `SELECT id, title, category, created_at::text AS "createdAt"
       FROM decision_records
       WHERE org_id = $1 AND season_year = $2 AND status = 'proposed'
       ORDER BY created_at DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<FmeaRow>(
      `SELECT id, title, subsystem_name AS "subsystemName", severity, occurrence, detection
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2 AND status = 'open'
       ORDER BY (occurrence * severity * detection) DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
  ]);

  return {
    blockers: blockerResult.rows,
    overdueTasks: overdueResult.rows,
    decisions: decisionResult.rows,
    fmeaFailures: fmeaResult.rows,
  };
}

type AgendaRow = {
  id: string;
  seasonYear: number;
  title: string;
  meetingOn: string | null;
  agendaItems: AgendaItem[] | null;
  blockerCount: number;
  overdueTaskCount: number;
  decisionCount: number;
  fmeaCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function mapAgenda(row: AgendaRow): MeetingAgenda {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    meetingOn: row.meetingOn,
    agendaItems: Array.isArray(row.agendaItems) ? row.agendaItems : [],
    sourceCounts: {
      blockers: Number(row.blockerCount) || 0,
      overdueTasks: Number(row.overdueTaskCount) || 0,
      decisions: Number(row.decisionCount) || 0,
      fmea: Number(row.fmeaCount) || 0,
    },
    status: isAgendaStatus(row.status) ? row.status : "draft",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type ActionItemRow = {
  id: string;
  agendaId: string;
  title: string;
  owner: string | null;
  dueOn: string | null;
  status: string;
  sourceExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapActionItem(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    agendaId: row.agendaId,
    title: row.title,
    owner: row.owner,
    dueOn: row.dueOn,
    status: isActionItemStatus(row.status) ? row.status : "open",
    sourceExcerpt: row.sourceExcerpt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function computeMeetingAutopilotView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MeetingAutopilotView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build meeting agendas from open blockers, overdue tasks, unresolved decisions, and open FMEA.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [sources, agendaResult, actionItemResult, seasonResult] = await Promise.all([
    loadAgendaSources(client, org.orgId, seasonYear),
    client.query<AgendaRow>(
      `SELECT id, season_year AS "seasonYear", title, meeting_on::text AS "meetingOn", agenda_items AS "agendaItems",
              blocker_count AS "blockerCount", overdue_task_count AS "overdueTaskCount",
              decision_count AS "decisionCount", fmea_count AS "fmeaCount", status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM meeting_autopilot_agendas
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [org.orgId, seasonYear],
    ),
    client.query<ActionItemRow>(
      `SELECT ai.id, ai.agenda_id AS "agendaId", ai.title, ai.owner, ai.due_on::text AS "dueOn", ai.status,
              ai.source_excerpt AS "sourceExcerpt", ai.created_at AS "createdAt", ai.updated_at AS "updatedAt"
       FROM meeting_autopilot_action_items ai
       JOIN meeting_autopilot_agendas a ON a.id = ai.agenda_id
       WHERE ai.org_id = $1 AND a.season_year = $2
       ORDER BY ai.created_at DESC
       LIMIT 200`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM meeting_autopilot_agendas WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    liveAgendaItems: buildAgendaItems(sources),
    sourceCounts: summarizeAgendaSources(sources),
    agendas: agendaResult.rows.map(mapAgenda),
    actionItems: actionItemResult.rows.map(mapActionItem),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function generateAgenda(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; title: string; meetingOn: string | null },
): Promise<RenderOutcome> {
  const sources = await loadAgendaSources(client, input.orgId, input.seasonYear);
  const counts = summarizeAgendaSources(sources);

  // Real model call on the org's adapter with the deterministic agenda as fallback: the
  // items themselves (kind, source, title, weight) come from open blockers / overdue tasks /
  // unresolved decisions / open FMEA; only each item's detail line may be rewritten.
  const { value: agenda, render } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "meeting_autopilot",
    value: buildAgendaItems(sources),
    editableKeys: ["detail"],
    instructions: `Meeting agenda "${input.title}"${input.meetingOn ? ` for ${input.meetingOn}` : ""} (${input.seasonYear} season). Rewrite each item's detail as one plain sentence that tells the room what needs deciding or unblocking; keep names, subsystems, dates and counts exactly as given.`,
    metadata: { seasonYear: input.seasonYear, itemCount: counts.blockers + counts.overdueTasks + counts.decisions + counts.fmea },
  });

  await client.query(
    `INSERT INTO meeting_autopilot_agendas (
       org_id, season_year, title, meeting_on, agenda_items,
       blocker_count, overdue_task_count, decision_count, fmea_count, created_by
     ) VALUES ($1,$2,$3,$4::date,$5::jsonb,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.meetingOn,
      JSON.stringify(agenda),
      counts.blockers,
      counts.overdueTasks,
      counts.decisions,
      counts.fmea,
      input.userId,
    ],
  );
  return render;
}

export async function draftMinutesActionItems(
  client: PoolClient,
  input: { orgId: string; userId: string; agendaId: string; minutesText: string },
): Promise<{ count: number; render: RenderOutcome }> {
  // Real model call on the org's adapter with the deterministic parse as fallback: the
  // action items, owners, due dates and source excerpts are extracted from the minutes
  // text; only each item's title may be rewritten into a clean imperative.
  const { value: parsed, render } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "meeting_autopilot",
    value: parseActionItemsFromMinutes(input.minutesText),
    editableKeys: ["title"],
    instructions: "Action items parsed from meeting minutes. Rewrite each title as a short imperative task (verb first) that matches its sourceExcerpt; keep owners, due dates and excerpts exactly as given and add no items.",
    metadata: { agendaId: input.agendaId },
  });

  for (const item of parsed.slice(0, 100)) {
    await client.query(
      `INSERT INTO meeting_autopilot_action_items (
         org_id, agenda_id, title, owner, due_on, source_excerpt, created_by
       ) VALUES ($1,$2,$3,$4,$5::date,$6,$7)`,
      [input.orgId, input.agendaId, item.title, item.owner, item.dueOn, item.sourceExcerpt, input.userId],
    );
  }
  return { count: parsed.length, render };
}

export async function updateActionItemStatus(
  client: PoolClient,
  input: { orgId: string; actionItemId: string; status: ActionItemStatus },
): Promise<void> {
  await client.query(
    `UPDATE meeting_autopilot_action_items SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.actionItemId, input.orgId],
  );
}

export async function updateAgendaStatus(
  client: PoolClient,
  input: { orgId: string; agendaId: string; status: MeetingAgendaStatus },
): Promise<void> {
  await client.query(
    `UPDATE meeting_autopilot_agendas SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.agendaId, input.orgId],
  );
}

export async function deleteAgenda(client: PoolClient, input: { orgId: string; agendaId: string }): Promise<void> {
  await client.query(`DELETE FROM meeting_autopilot_agendas WHERE id = $1 AND org_id = $2`, [
    input.agendaId,
    input.orgId,
  ]);
}

export async function deleteActionItem(
  client: PoolClient,
  input: { orgId: string; actionItemId: string },
): Promise<void> {
  await client.query(`DELETE FROM meeting_autopilot_action_items WHERE id = $1 AND org_id = $2`, [
    input.actionItemId,
    input.orgId,
  ]);
}
